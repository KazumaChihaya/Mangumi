import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { get, list, put, type Database } from "./db.ts";
import { identity, permit } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Services } from "./services.ts";
import { audit, fail, id, now, once, unseal, verifyTotp } from "./security.ts";
import { registerCheckout } from "./checkout.ts";

const requestKey = (request: FastifyRequest) =>
  String(request.headers["idempotency-key"] ?? "");
export function registerBilling(
  app: FastifyInstance,
  db: Database,
  config: Config,
  external: Services,
) {
  registerCheckout(app, db, config, external);
  app.post("/api/billing/cancel", async (request) => {
    const body = z
        .object({ confirmed: z.literal(true) })
        .strict()
        .parse(request.body),
      stripe = external.requireStripe();
    const prepared = await db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      return once(
        q,
        `cancel:${actor.user.id}`,
        requestKey(request),
        body,
        async () => {
          const subscription = await get(q, "subscription", actor.user.id),
            reference = await get(q, "paymentCustomer", actor.user.id);
          if (
            !subscription ||
            !["active", "trialing", "past_due"].includes(subscription.status) ||
            !reference
          )
            fail(409, "解約できる契約がありません");
          const plan = await get(q, "plans", subscription.planId);
          await audit(
            q,
            actor.user.id,
            "subscription.cancel.request",
            subscription.id,
            null,
            { mode: plan?.cancellation ?? "period_end" },
            "本人による解約申込",
            request.ip,
          );
          return {
            id: subscription.id,
            userId: actor.user.id,
            customer: reference.id,
            mode: plan?.cancellation ?? "period_end",
          };
        },
      );
    });
    const current = await stripe.subscriptions.retrieve(prepared.id);
    if (
      current.customer !== prepared.customer ||
      current.metadata.user_id !== prepared.userId
    )
      fail(403, "契約の所有者を確認できません");
    if (current.status !== "canceled") {
      const options = {
        idempotencyKey: `cancel-${prepared.userId}-${requestKey(request)}`,
      };
      if (prepared.mode === "immediate")
        await stripe.subscriptions.cancel(prepared.id, {}, options);
      else
        await stripe.subscriptions.update(
          prepared.id,
          { cancel_at_period_end: true },
          options,
        );
    }
    return { accepted: true, mode: prepared.mode };
  });
  app.post("/api/billing/portal", async (request) => {
    const actor = await identity(db, request, config, "member");
    const reference = await get(db, "paymentCustomer", actor.user.id);
    if (!reference) fail(404, "契約情報がありません");
    const session = await external
      .requireStripe()
      .billingPortal.sessions.create({
        customer: reference.id,
        return_url: new URL("/me", config.origin).href,
      });
    return { url: session.url };
  });
  app.get("/api/billing/status", async (request) => {
    const actor = await identity(db, request, config, "member");
    return {
      subscription: await get(db, "subscription", actor.user.id),
      storeSubscription: await get(db,"storeSubscription",actor.user.id),
      tips: await list(db, "tips", actor.user.id),
      paymentMethod: (await get(db, "paymentCustomer", actor.user.id))
        ?.paymentMethod,
    };
  });
  app.post("/api/admin/refunds", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "finance"]);
      const body = z
        .object({
          tipId: z.string().max(100),
          amount: z.number().int().min(1),
          reason: z.string().min(5).max(2000),
          code: z.string().length(6),
        })
        .strict()
        .parse(request.body);
      return once(
        q,
        `refund:${actor.user.id}`,
        requestKey(request),
        body,
        async () => {
          const step = verifyTotp(
            unseal(actor.user.mfa_secret!, config.key),
            body.code,
            Number(actor.user.mfa_step),
          );
          if (step < 0) fail(403, "新しい二要素認証コードを入力してください");
          const tip = await get(q, "tips", body.tipId);
          if(tip?.provider && tip.provider !== "stripe") fail(409,"ストア購入の返金はApp Store／Google Playで処理してください。コイン使用をStripeから返金することはできません");
          const allocatedRefunds = (await list(q, "refunds"))
            .filter(
              (refund) =>
                refund.tipId === body.tipId &&
                !["failed", "canceled"].includes(refund.status),
            )
            .reduce((sum, refund) => sum + refund.amount, 0);
          if (
            !tip ||
            tip.paymentStatus !== "paid" ||
            body.amount >
              tip.amount - Math.max(tip.refunded ?? 0, allocatedRefunds)
          )
            fail(400, "返金対象と金額を確認してください");
          const refund = await external.requireStripe().refunds.create(
            {
              payment_intent: tip.paymentIntent,
              amount: body.amount,
              metadata: {
                reason: body.reason.slice(0, 500),
                actor_id: actor.user.id,
              },
            },
            {
              idempotencyKey: `refund-${actor.user.id}-${requestKey(request)}`,
            },
          );
          await put(q, "refunds", refund.id, {
            id: refund.id,
            tipId: tip.id,
            amount: body.amount,
            status: refund.status,
            reason: body.reason,
            at: now(),
          });
          await q.run("UPDATE users SET mfa_step = ? WHERE id = ?", [
            step,
            actor.user.id,
          ]);
          await audit(
            q,
            actor.user.id,
            "payment.refund",
            tip.id,
            tip,
            { refundId: refund.id, amount: body.amount },
            body.reason,
            request.ip,
          );
          return { id: refund.id, status: refund.status };
        },
      );
    }),
  );
  app.post("/api/webhooks/stripe", async (request) => {
    if (!config.stripeWebhook) fail(503, "Webhookの設定が必要です");
    const stripe = external.requireStripe();
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body as Buffer,
        String(request.headers["stripe-signature"] ?? ""),
        config.stripeWebhook,
      );
    } catch {
      fail(400, "Webhookの署名を確認できませんでした");
    }
    const data = event.data.object as any;
    let charge: any, balance: any;
    if (
      ["charge.succeeded", "charge.updated", "charge.refunded"].includes(
        event.type,
      )
    ) {
      charge = data;
      if (typeof data.balance_transaction === "string")
        balance = await stripe.balanceTransactions.retrieve(
          data.balance_transaction,
        );
      else if (data.balance_transaction) balance = data.balance_transaction;
    }
    await db.transaction(async (q) => {
      if (
        (await q.all("SELECT id FROM webhook_events WHERE id = ?", [event.id]))
          .length
      )
        return;
      if (charge) {
        const tip = (await list(q, "tips")).find(
          (t) =>
            t.paymentIntent === charge.payment_intent ||
            t.id === charge.metadata?.tip_id,
        );
        if (tip && charge.currency === "jpy" && charge.amount === tip.amount) {
          await put(
            q,
            "tips",
            tip.id,
            {
              ...tip,
              chargeId: charge.id,
              ...(balance ? { providerFee: balance.fee, feeAt: now() } : {}),
              refunded: Math.max(
                charge.amount_refunded ?? 0,
                tip.refunded ?? 0,
              ),
              ...(charge.amount_refunded || tip.refunded
                ? {
                    status:
                      Math.max(
                        charge.amount_refunded ?? 0,
                        tip.refunded ?? 0,
                      ) >= tip.amount
                        ? "返金済み"
                        : "一部返金",
                    paymentStatus:
                      Math.max(
                        charge.amount_refunded ?? 0,
                        tip.refunded ?? 0,
                      ) >= tip.amount
                        ? "refunded"
                        : tip.paymentStatus,
                  }
                : {}),
            },
            tip.userId,
          );
        }
        for (const invoice of await list(q, "invoices"))
          if (invoice.chargeId === charge.id && balance)
            await put(q, "invoices", invoice.id, {
              ...invoice,
              providerFee: balance.fee,
              refunded: charge.amount_refunded ?? 0,
            });
      } else if (event.type === "invoice.paid") {
        if (data.currency === "jpy" && data.status === "paid")
          await put(q, "invoices", data.id, {
            id: data.id,
            at: new Date(
              (data.status_transitions?.paid_at ?? event.created) * 1000,
            ).toISOString(),
            customer:
              typeof data.customer === "string"
                ? data.customer
                : data.customer?.id,
            chargeId:
              typeof data.charge === "string" ? data.charge : data.charge?.id,
            amount: data.amount_paid,
            refunded: 0,
            status: "paid",
          });
      } else if (event.type === "payment_intent.succeeded") {
        const tip = await get(q, "tips", data.metadata?.tip_id);
        if (tip) {
          if (
            tip.amount !== data.amount_received ||
            data.currency !== "jpy" ||
            data.metadata.user_id !== tip.userId
          )
            fail(400, "決済内容が一致しません");
          tip.paymentStatus =
            (tip.refunded ?? 0) >= tip.amount ? "refunded" : "paid";
          tip.status = tip.refunded
            ? tip.refunded >= tip.amount
              ? "返金済み"
              : "一部返金"
            : "完了";
          tip.paymentIntent = data.id;
          await put(q, "tips", tip.id, tip, tip.userId);
        }
      } else if (event.type === "checkout.session.expired") {
        const tip = await get(q, "tips", data.metadata?.tip_id);
        if (tip?.paymentStatus === "pending") {
          tip.paymentStatus = "cancelled";
          tip.status = "期限切れ";
          await put(q, "tips", tip.id, tip, tip.userId);
        }
      } else if (
        event.type === "checkout.session.completed" &&
        data.mode === "setup"
      ) {
        const intent = await stripe.setupIntents.retrieve(data.setup_intent);
        if (
          intent.status === "succeeded" &&
          typeof intent.payment_method === "string"
        ) {
          const method = await stripe.paymentMethods.retrieve(
            intent.payment_method,
          );
          const reference = await get(
            q,
            "paymentCustomer",
            data.metadata.user_id,
          );
          if (!reference || reference.id !== data.customer)
            fail(400, "決済の顧客が一致しません");
          reference.paymentMethod = {
            id: method.id,
            brand: method.card?.brand,
            last4: method.card?.last4,
            expMonth: method.card?.exp_month,
            expYear: method.card?.exp_year,
          };
          await put(
            q,
            "paymentCustomer",
            data.metadata.user_id,
            reference,
            data.metadata.user_id,
          );
        }
      } else if (event.type.startsWith("customer.subscription.")) {
        const subscription = await stripe.subscriptions.retrieve(data.id);
        const userId = subscription.metadata.user_id,
          planId = subscription.metadata.plan_id;
        const plan = await get(q, "plans", planId);
        const reference = await get(q, "paymentCustomer", userId);
        if (
          userId &&
          reference?.id === subscription.customer &&
          plan &&
          subscription.items.data.some(
            (item) =>
              item.price.id === plan.stripePrice ||
              item.price.id === plan.stripeYearPrice,
          )
        ) {
          const user = (
            await q.all("SELECT profile FROM users WHERE id = ?", [userId])
          )[0];
          if (user) {
            const active = ["active", "trialing"].includes(subscription.status);
            await q.run("UPDATE users SET profile = ? WHERE id = ?", [
              JSON.stringify({
                ...JSON.parse(user.profile),
                plan: active ? plan.name : "Free",
              }),
              userId,
            ]);
            await put(
              q,
              "subscription",
              userId,
              {
                id: subscription.id,
                planId,
                status: subscription.status,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                trialUsed:
                  !!subscription.trial_start ||
                  !!(await get(q, "subscription", userId))?.trialUsed,
              },
              userId,
            );
          }
        }
      } else if (
        event.type === "refund.updated" ||
        event.type === "refund.failed"
      ) {
        const refund = await get(q, "refunds", data.id);
        if (refund)
          await put(q, "refunds", data.id, { ...refund, status: data.status });
      } else if (
        event.type === "payment_intent.payment_failed" ||
        event.type === "payment_intent.canceled"
      ) {
        const tip = await get(q, "tips", data.metadata?.tip_id);
        if (tip?.paymentStatus === "pending")
          await put(
            q,
            "tips",
            tip.id,
            { ...tip, paymentStatus: "failed", status: "決済失敗" },
            tip.userId,
          );
      } else if (
        event.type === "charge.dispute.created" ||
        event.type === "charge.dispute.closed"
      ) {
        for (const tip of (await list(q, "tips")).filter(
          (tip) => tip.paymentIntent === data.payment_intent,
        ))
          await put(
            q,
            "tips",
            tip.id,
            {
              ...tip,
              disputed: data.status,
              status: data.status === "won" ? "完了" : "支払い異議申立て",
            },
            tip.userId,
          );
      } else if (event.type === "charge.refunded") {
        for (const tip of (await list(q, "tips")).filter(
          (tip) => tip.paymentIntent === data.payment_intent,
        )) {
          tip.refunded = data.amount_refunded;
          tip.status = data.refunded ? "返金済み" : "一部返金";
          if (data.refunded) tip.paymentStatus = "refunded";
          await put(q, "tips", tip.id, tip, tip.userId);
        }
      }
      await q.run(
        "INSERT INTO webhook_events (id,provider,processed_at) VALUES (?,?,?)",
        [event.id, "stripe", now()],
      );
    });
    return { received: true };
  });
}
