import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, list, put, type Database } from "./db.ts";
import { identity } from "./auth.ts";
import { entitled } from "./domain.ts";
import { consume, periodKeys } from "./limits.ts";
import { digest, fail, id, now, once } from "./security.ts";
import type { Config } from "./config.ts";
import type { Services } from "./services.ts";
export const checkoutSchema = z.discriminatedUnion("kind", [
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
]);
export function registerCheckout(
  app: FastifyInstance,
  db: Database,
  config: Config,
  external: Services,
) {
  app.post("/api/billing/checkout", async (request) => {
    const stripe = external.requireStripe(),
      body = checkoutSchema.parse(request.body),
      key = String(request.headers["idempotency-key"] ?? "");
    const prepared = await db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member"),
        settings = await get(q, "settings", "global");
      if (!settings.billingEnabled)
        fail(409, "現在、有料決済は受付を停止しています");
      return once(q, `checkout:${actor.user.id}`, key, body, async () => {
        const intentId = id();
        let plan: any, tipId: string | undefined, trialDays: number | undefined;
        if (body.kind === "plan") {
          plan = await get(q, "plans", body.planId);
          const subscription = await get(q, "subscription", actor.user.id);
          if (
            !plan?.published ||
            plan.price <= 0 ||
            !plan.stripePrice ||
            (plan.opensAt && plan.opensAt > now()) ||
            (plan.closesAt && plan.closesAt <= now())
          )
            fail(409, "このプランは申込できません");
          if (
            subscription &&
            ["active", "trialing", "past_due"].includes(subscription.status)
          )
            fail(409, "プラン変更・解約は契約管理から行ってください");
          if (
            (await list(q, "checkoutIntents", actor.user.id)).some(
              (i) =>
                i.body.kind === "plan" &&
                i.expiresAt > now() &&
                i.status !== "failed",
            )
          )
            fail(
              409,
              "申し込み中の決済があります。決済を完了するか、有効期限までお待ちください",
            );
          if (
            !(body.period === "year" ? plan.stripeYearPrice : plan.stripePrice)
          )
            fail(400, "この支払い期間は未設定です");
          if (plan.trialDays && !subscription?.trialUsed)
            trialDays = plan.trialDays;
        } else if (body.kind === "tip") {
          await entitled(q, actor.user, "tip.send");
          await consume(q, actor.user, "tip.send", {
            target: body.recipient,
            level: "send",
          });
          if (
            body.amount < (settings.tipMin ?? 100) ||
            body.amount > settings.tipMax
          )
            fail(400, "応援金額が設定範囲外です");
          if (
            !(
              await q.all(
                "SELECT id FROM users WHERE id = ? AND role = 'official' AND status = 'active'",
                [body.recipient],
              )
            ).length
          )
            fail(400, "受取対象を選んでください");
          const words = settings.ngWords
            .split(/[,、\n]/)
            .map((w: string) => w.trim())
            .filter(Boolean);
          if (words.some((w: string) => body.message.includes(w)))
            fail(400, "送信できない言葉が含まれています");
          const tips = (await list(q, "tips", actor.user.id)).filter((t) =>
            ["pending", "paid"].includes(t.paymentStatus),
          );
          const periods = periodKeys();
          for (const [period, limit] of [
            ["day", settings.tipDaily ?? settings.tipMax * 5],
            ["month", settings.tipMonthly ?? settings.tipMax * 20],
          ] as const)
            if (
              tips
                .filter(
                  (t) =>
                    periodKeys(Date.parse(t.at))[period] === periods[period],
                )
                .reduce((n, t) => n + t.amount, 0) +
                body.amount >
              limit
            )
              fail(409, "応援金額の期間上限に達しています");
          tipId = id();
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
              at: now(),
            },
            actor.user.id,
          );
        }
        await put(
          q,
          "checkoutIntents",
          intentId,
          {
            id: intentId,
            userId: actor.user.id,
            email: actor.user.email,
            body,
            plan,
            trialDays,
            tipId,
            status: "pending",
            at: now(),
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
          actor.user.id,
        );
        return { intentId };
      });
    });
    const lease = id();
    const intent = await db.transaction(async (q) => {
      const value = await get(q, "checkoutIntents", prepared.intentId);
      if (value.result) return value;
      if (value.expiresAt <= now())
        fail(409, "決済の有効期限が切れています。もう一度お申し込みください");
      if (value.lockedUntil > now())
        fail(
          409,
          "決済を準備しています。同じ操作を再試行してください",
          "processing",
        );
      await put(
        q,
        "checkoutIntents",
        value.id,
        {
          ...value,
          lease,
          lockedUntil: new Date(Date.now() + 120000).toISOString(),
        },
        value.userId,
      );
      return value;
    });
    if (intent.result) return intent.result;
    // All provider I/O is outside the global business transaction. The durable
    // reservation above still counts toward limits while the provider is slow.
    try {
      let customer = await get(db, "paymentCustomer", intent.userId);
      if (!customer) {
        const created = await stripe.customers.create(
          { email: intent.email, metadata: { user_id: intent.userId } },
          { idempotencyKey: `customer-${intent.userId}` },
        );
        customer = await db.transaction(async (q) => {
          const previous = await get(q, "paymentCustomer", intent.userId);
          if (previous) return previous;
          const next = { id: created.id };
          await put(q, "paymentCustomer", intent.userId, next, intent.userId);
          return next;
        });
      }
      const saved = intent.body as z.infer<typeof checkoutSchema>,
        plan = intent.plan;
      const returnUrl = new URL("/u/U100", config.origin).href;
      const params: any = {
        customer: customer.id,
        success_url: `${returnUrl}?payment=processing`,
        cancel_url: `${returnUrl}?payment=cancelled`,
        client_reference_id: intent.userId,
        expires_at: Math.floor(Date.parse(intent.expiresAt) / 1000),
      };
      if (saved.kind === "plan") {
        const priceId =
            saved.period === "year" ? plan.stripeYearPrice : plan.stripePrice,
          price = await stripe.prices.retrieve(priceId);
        if (
          !price.active ||
          price.currency !== "jpy" ||
          price.unit_amount !==
            (saved.period === "year" ? plan.yearPrice : plan.price) ||
          price.recurring?.interval !== saved.period ||
          price.recurring.interval_count !== 1
        )
          fail(
            409,
            "決済サービスの価格と掲載価格が一致していません。運営へお問い合わせください",
          );
        Object.assign(params, {
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          subscription_data: {
            ...(intent.trialDays
              ? { trial_period_days: intent.trialDays }
              : {}),
            metadata: { user_id: intent.userId, plan_id: plan.id },
          },
          metadata: { user_id: intent.userId, plan_id: plan.id },
        });
      } else if (saved.kind === "tip")
        Object.assign(params, {
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "jpy",
                product_data: { name: "マン組への応援" },
                unit_amount: saved.amount,
              },
              quantity: 1,
            },
          ],
          payment_intent_data: {
            metadata: { tip_id: intent.tipId, user_id: intent.userId },
            setup_future_usage: "off_session",
          },
          metadata: { tip_id: intent.tipId, user_id: intent.userId },
        });
      else
        Object.assign(params, {
          mode: "setup",
          currency: "jpy",
          metadata: { user_id: intent.userId, purpose: "setup" },
        });
      const checkout = await stripe.checkout.sessions.create(params, {
        idempotencyKey: `${saved.kind}-${intent.userId}-${key}`,
      });
      return await db.transaction(async (q) => {
        const current = await get(q, "checkoutIntents", intent.id);
        if (current.lease !== lease)
          fail(409, "決済処理を再確認してください", "processing");
        const result = { url: checkout.url, sessionId: checkout.id };
        await put(
          q,
          "checkoutIntents",
          intent.id,
          { ...current, result, status: "ready", lockedUntil: null },
          intent.userId,
        );
        if (intent.tipId) {
          const tip = await get(q, "tips", intent.tipId);
          await put(
            q,
            "tips",
            tip.id,
            { ...tip, checkoutId: checkout.id },
            intent.userId,
          );
        }
        return result;
      });
    } catch (error) {
      await db.transaction(async (q) => {
        const current = await get(q, "checkoutIntents", intent.id);
        if (current?.lease === lease)
          await put(
            q,
            "checkoutIntents",
            intent.id,
            { ...current, lockedUntil: null },
            intent.userId,
          );
      });
      throw error;
    }
  });
}
