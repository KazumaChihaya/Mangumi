import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { get, list, put, type Database, type Query } from "./db.ts";
import { identity, permit, type Identity } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Services } from "./services.ts";
import { audit, fail, id, now, once, unseal, verifyTotp } from "./security.ts";
import { entitled } from "./domain.ts";

const requestKey = (request: FastifyRequest) =>
  String(request.headers["idempotency-key"] ?? "");
async function customer(q: Query, actor: Identity, external: Services) {
  const previous = await get(q, "paymentCustomer", actor.user.id);
  if (previous) return previous.id;
  const created = await external
    .requireStripe()
    .customers.create(
      { email: actor.user.email, metadata: { user_id: actor.user.id } },
      { idempotencyKey: `customer-${actor.user.id}` },
    );
  await put(
    q,
    "paymentCustomer",
    actor.user.id,
    { id: created.id },
    actor.user.id,
  );
  return created.id;
}
export function registerBilling(
  app: FastifyInstance,
  db: Database,
  config: Config,
  external: Services,
) {
  app.post("/api/billing/checkout", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const settings = await get(q, "settings", "global");
      if (!settings.billingEnabled)
        fail(409, "現在、有料決済は受付を停止しています");
      const body = z
        .discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("tip"),
              amount: z.number().int().min(100),
              recipient: z.string().min(1).max(100),
              message: z.string().max(500),
            })
            .strict(),
          z
            .object({
              kind: z.literal("plan"),
              planId: z.string().min(1).max(100),
              period: z.enum(["month", "year"]).default("month"),
            })
            .strict(),
          z.object({ kind: z.literal("setup") }).strict(),
        ])
        .parse(request.body);
      return once(
        q,
        `checkout:${actor.user.id}`,
        requestKey(request),
        body,
        async () => {
          const stripe = external.requireStripe();
          const customerId = await customer(q, actor, external);
          const returnUrl = new URL("/u/U100", config.origin).href;
          const common = {
            customer: customerId,
            success_url: `${returnUrl}?payment=processing`,
            cancel_url: `${returnUrl}?payment=cancelled`,
            client_reference_id: actor.user.id,
          };
          let checkout;
          if (body.kind === "setup") {
            checkout = await stripe.checkout.sessions.create(
              {
                ...common,
                mode: "setup",
                currency: "jpy",
                metadata: { user_id: actor.user.id, purpose: "setup" },
              },
              {
                idempotencyKey: `setup-${actor.user.id}-${requestKey(request)}`,
              },
            );
          } else if (body.kind === "plan") {
            const plan = await get(q, "plans", body.planId);
            if (
              (plan?.opensAt && plan.opensAt > now()) ||
              (plan?.closesAt && plan.closesAt <= now())
            )
              fail(409, "このプランは申込期間外です");
            if (!plan?.published || !plan.stripePrice || plan.price <= 0)
              fail(400, "このプランは申込できません");
            const existing = await get(q, "subscription", actor.user.id);
            if (
              existing &&
              ["active", "trialing", "past_due"].includes(existing.status)
            )
              fail(409, "現在のプラン変更・解約は契約管理から行ってください");
            const priceId =
              body.period === "year" ? plan.stripeYearPrice : plan.stripePrice;
            if (!priceId) fail(400, "この支払い期間は未設定です");
            const price = await stripe.prices.retrieve(priceId);
            if (
              !price.active ||
              price.currency !== "jpy" ||
              price.unit_amount !==
                (body.period === "year" ? plan.yearPrice : plan.price) ||
              price.recurring?.interval !== body.period ||
              price.recurring.interval_count !== 1
            )
              fail(
                409,
                "決済サービスの価格と掲載価格が一致していません。運営へお問い合わせください",
              );
            checkout = await stripe.checkout.sessions.create(
              {
                ...common,
                mode: "subscription",
                line_items: [
                  {
                    price:
                      body.period === "year"
                        ? (plan.stripeYearPrice ??
                          fail(400, "年額プランが未設定です"))
                        : plan.stripePrice,
                    quantity: 1,
                  },
                ],
                subscription_data: {
                  ...(plan.trialDays && !existing?.trialUsed
                    ? { trial_period_days: plan.trialDays }
                    : {}),
                  metadata: { user_id: actor.user.id, plan_id: plan.id },
                },
                metadata: { user_id: actor.user.id, plan_id: plan.id },
              },
              {
                idempotencyKey: `plan-${actor.user.id}-${requestKey(request)}`,
              },
            );
          } else {
            await entitled(q, actor.user, "tip.send");
            if (body.amount > settings.tipMax)
              fail(400, `金額は${settings.tipMax}円までです`);
            const recipient = (
              await q.all(
                "SELECT id FROM users WHERE id = ? AND role = 'official' AND status = 'active'",
                [body.recipient],
              )
            )[0];
            if (!recipient) fail(400, "受取対象を選んでください");
            const tips = await list(q, "tips", actor.user.id);
            const month = now().slice(0, 7),
              today = now().slice(0, 10);
            const pending = tips.filter((tip) =>
              ["pending", "paid"].includes(tip.paymentStatus),
            );
            if (
              pending
                .filter((tip) => tip.at.startsWith(today))
                .reduce((total, tip) => total + tip.amount, 0) +
                body.amount >
                settings.tipMax * 5 ||
              pending
                .filter((tip) => tip.at.startsWith(month))
                .reduce((total, tip) => total + tip.amount, 0) +
                body.amount >
                settings.tipMax * 20
            )
              fail(409, "応援金額の期間上限に達しています");
            const tipId = id();
            checkout = await stripe.checkout.sessions.create(
              {
                ...common,
                mode: "payment",
                line_items: [
                  {
                    price_data: {
                      currency: "jpy",
                      product_data: { name: "マン組への応援" },
                      unit_amount: body.amount,
                    },
                    quantity: 1,
                  },
                ],
                payment_intent_data: {
                  metadata: { tip_id: tipId, user_id: actor.user.id },
                  setup_future_usage: "off_session",
                },
                metadata: { tip_id: tipId, user_id: actor.user.id },
              },
              { idempotencyKey: `tip-${actor.user.id}-${requestKey(request)}` },
            );
            await put(
              q,
              "tips",
              tipId,
              {
                id: tipId,
                userId: actor.user.id,
                amount: body.amount,
                recipient: body.recipient,
                message: body.message,
                status: "決済待ち",
                paymentStatus: "pending",
                checkoutId: checkout.id,
                at: now(),
              },
              actor.user.id,
            );
          }
          return { url: checkout.url, sessionId: checkout.id };
        },
      );
    }),
  );
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
    await db.transaction(async (q) => {
      if (
        (await q.all("SELECT id FROM webhook_events WHERE id = ?", [event.id]))
          .length
      )
        return;
      if (event.type === "payment_intent.succeeded") {
        const tip = await get(q, "tips", data.metadata?.tip_id);
        if (tip) {
          if (
            tip.amount !== data.amount_received ||
            data.currency !== "jpy" ||
            data.metadata.user_id !== tip.userId
          )
            fail(400, "決済内容が一致しません");
          tip.paymentStatus = "paid";
          tip.status = "完了";
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
