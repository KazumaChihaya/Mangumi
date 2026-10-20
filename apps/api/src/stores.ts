import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, list, put, type Database, type Query } from "./db.ts";
import { identity, permit, type User } from "./auth.ts";
import { audit, digest, fail, id, now, later, once, seal } from "./security.ts";
import type { Config } from "./config.ts";
import type { Services } from "./services.ts";
import type { StoreTransaction } from "./store-provider.ts";
import { reserveTip } from "./tipping.ts";
export const storeProductSchema = z
  .object({
    platform: z.enum(["ios", "android"]),
    productId: z.string().regex(/^[a-zA-Z0-9_.-]{1,150}$/),
    title: z.string().min(1).max(100),
    kind: z.enum(["coins", "subscription"]),
    amount: z.number().int().min(100).max(1000000),
    currency: z.literal("JPY"),
    credits: z.number().int().min(1).max(1000000).optional(),
    planId: z.string().max(100).optional(),
    period: z.enum(["month", "year"]).optional(),
    published: z.boolean(),
  })
  .strict();
const tip = z
  .object({
    amount: z.number().int().min(100).max(100000),
    recipient: z.string().min(1).max(100),
    message: z.string().max(500),
    visibility: z.enum(["private", "public"]).default("private"),
  })
  .strict();
export const storeIntentSchema = z
  .object({
    platform: z.enum(["ios", "android"]),
    productId: z.string().max(150),
    tip: tip.optional(),
  })
  .strict();
export const storeVerifySchema = z
  .object({
    platform: z.enum(["ios", "android"]),
    productId: z.string().max(150),
    proof: z.string().min(10).max(30000),
    intentId: z.string().max(100).optional(),
  })
  .strict();
const productKey = (platform: string, sku: string) =>
  digest(`${platform}:${sku}`);
async function apply(
  q: Query,
  user: User,
  product: any,
  transaction: StoreTransaction,
  intentId?: string,
  reversed = false,
) {
  const t = transaction,
    receiptId = productKey(t.platform, t.id),
    ownerKey = productKey(t.platform, t.originalId),
    previous = await get(q, "storeReceipts", receiptId);
  const prepared = intentId
    ? await get(q, "storeIntents", intentId)
    : undefined;
  // A prepared order and an existing receipt retain their original entitlement.
  product = previous?.product ?? prepared?.product ?? product;
  if (
    t.platform !== product.platform ||
    t.productId !== product.productId ||
    t.quantity !== 1 ||
    t.accountId !== (t.platform === "ios" ? user.id : digest(user.id))
  )
    fail(403, "購入者または商品が一致しません");
  if (
    !Number.isFinite(Date.parse(t.purchasedAt)) ||
    Date.parse(t.purchasedAt) > Date.now() + 300000
  )
    fail(403, "購入日時を確認できません");
  if (
    (previous && previous.userId !== user.id) ||
    ((await get(q, "storeOwners", ownerKey))?.userId ?? user.id) !== user.id
  )
    fail(403, "他の会員に紐付いた購入です");
  await put(q, "storeOwners", ownerKey, { userId: user.id }, user.id);
  const revoked = reversed ? false : t.revoked || previous?.revoked === true;
  let wallet = (await get(q, "nativeWallet", user.id)) ?? { balance: 0 };
  const credits = previous?.credits ?? product.credits ?? 0;
  if (product.kind === "coins") {
    let delta = 0;
    if (!previous && !revoked) delta = credits;
    else if (previous?.credited && !previous.revoked && revoked)
      delta = -credits;
    else if (previous?.revoked && reversed) delta = credits;
    if (delta) {
      wallet = { balance: wallet.balance + delta };
      await put(q, "nativeWallet", user.id, wallet, user.id);
      const entryId = id();
      await put(
        q,
        "nativeLedger",
        entryId,
        {
          id: entryId,
          receiptId,
          delta,
          balance: wallet.balance,
          at: now(),
          reason: delta > 0 ? "ストア購入・返金取消" : "ストア返金",
        },
        user.id,
      );
    }
  }
  const receipt = {
    ...previous,
    userId: user.id,
    ...t,
    idInStore: t.id,
    id: receiptId,
    revoked,
    credits,
    credited: previous?.credited || (product.kind === "coins" && !revoked),
    amount: t.amount ?? previous?.amount ?? product.amount,
    currency: t.currency ?? previous?.currency ?? "JPY",
    amountSource:
      t.amount === undefined ? (previous?.amountSource ?? "catalog") : "store",
    kind: product.kind,
    product,
    at: previous?.at ?? now(),
    updatedAt: now(),
  };
  await put(q, "storeReceipts", receiptId, receipt, user.id);
  if (product.kind === "subscription") {
    if (!t.expiresAt || !Number.isFinite(Date.parse(t.expiresAt)))
      fail(403, "契約期限を確認できません");
    const current = await get(q, "storeSubscription", user.id),
      plan = await get(q, "plans", product.planId);
    if (
      !current ||
      current.expiresAt <= t.expiresAt ||
      (current.receiptId === receiptId && revoked)
    ) {
      const active = !revoked && t.expiresAt > now(),
        profile = JSON.parse(user.profile);
      await put(
        q,
        "storeSubscription",
        user.id,
        {
          userId: user.id,
          provider: t.platform,
          productId: t.productId,
          originalId: t.originalId,
          receiptId,
          planId: product.planId,
          expiresAt: t.expiresAt,
          status: active ? "active" : "expired",
          purchasedAt: t.purchasedAt,
        },
        user.id,
      );
      await q.run("UPDATE users SET profile = ? WHERE id = ?", [
        JSON.stringify({
          ...profile,
          plan: active && plan ? plan.name : "Free",
        }),
        user.id,
      ]);
    }
  }
  const intent = intentId && (await get(q, "storeIntents", intentId));
  if (
    intent &&
    (intent.userId !== user.id ||
      intent.platform !== t.platform ||
      intent.productId !== t.productId)
  )
    fail(403, "購入申込が一致しません");
  if (intent && !intent.completedAt && !revoked && intent.expiresAt > now()) {
    if (previous?.intentId && previous.intentId !== intentId)
      return {
        accepted: true,
        receiptId,
        intentId: previous.intentId,
        balance: wallet.balance,
      };
    if (Date.parse(t.purchasedAt) < Date.parse(intent.at) - 120000)
      fail(409, "この購入は申込より前のものです");
    const pendingTip = intent.tipId && (await get(q, "tips", intent.tipId));
    if (pendingTip?.paymentStatus === "pending") {
      if (wallet.balance < pendingTip.amount)
        fail(409, "応援コインが不足しています");
      await put(
        q,
        "nativeWallet",
        user.id,
        { balance: wallet.balance - pendingTip.amount },
        user.id,
      );
      await put(
        q,
        "tips",
        pendingTip.id,
        {
          ...pendingTip,
          provider: t.platform,
          paymentStatus: "paid",
          status: "応援完了",
          storeReceiptId: receiptId,
          paidAt: now(),
        },
        user.id,
      );
      const entryId = id();
      await put(
        q,
        "nativeLedger",
        entryId,
        {
          id: entryId,
          tipId: pendingTip.id,
          delta: -pendingTip.amount,
          balance: wallet.balance - pendingTip.amount,
          at: now(),
          reason: "応援に使用",
        },
        user.id,
      );
    }
    await put(
      q,
      "storeIntents",
      intent.id,
      { ...intent, completedAt: now(), receiptId },
      user.id,
    );
    await put(q, "storeReceipts", receiptId, { ...receipt, intentId }, user.id);
  }
  return {
    accepted: true,
    receiptId,
    intentId: (await get(q, "storeReceipts", receiptId))?.intentId,
    balance: (await get(q, "nativeWallet", user.id))?.balance ?? 0,
  };
}
export function registerStores(
  app: FastifyInstance,
  db: Database,
  config: Config,
  external: Services,
) {
  app.get("/api/admin/store-products", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "finance"]);
    return list(db, "storeProducts");
  });
  app.post("/api/admin/store-products", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const { product, reason } = z
        .object({
          product: storeProductSchema,
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      if (product.kind === "coins" && !product.credits)
        fail(400, "コイン数を設定してください");
      if (
        product.kind === "subscription" &&
        !(await get(q, "plans", product.planId ?? ""))
      )
        fail(400, "対象プランを設定してください");
      const key = productKey(product.platform, product.productId),
        previous = await get(q, "storeProducts", key);
      if (previous && previous.kind !== product.kind)
        fail(409, "商品の種類は変更できません");
      await put(q, "storeProducts", key, { ...product, id: key });
      await audit(
        q,
        actor.user.id,
        "store.product",
        key,
        previous,
        product,
        reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.get("/api/native/store/catalog", async (request) => {
    const actor = await identity(db, request, config, "member"),
      settings = await get(db, "settings", "global");
    return {
      enabled: settings.billingEnabled,
      userId: actor.user.id,
      accountToken: actor.user.id,
      obfuscatedAccountId: digest(actor.user.id),
      products: settings.billingEnabled
        ? (await list(db, "storeProducts")).filter((p) => p.published)
        : [],
      balance: (await get(db, "nativeWallet", actor.user.id))?.balance ?? 0,
      subscription: await get(db, "storeSubscription", actor.user.id),
    };
  });
  app.post("/api/native/store/intents", async (request) => {
    const input = storeIntentSchema.parse(request.body);
    await identity(db, request, config, "member");
    await external.storeReady(input.platform);
    return db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member"),
        body = storeIntentSchema.parse(request.body);
      if (!(await get(q, "nativeAuth", actor.session.id)))
        fail(403, "アプリ専用の購入です");
      if (!(await get(q, "settings", "global")).billingEnabled)
        fail(409, "現在、有料決済は受付を停止しています");
      return once(
        q,
        `store-intent:${actor.user.id}`,
        String(request.headers["idempotency-key"] ?? ""),
        body,
        async () => {
          const product = await get(
            q,
            "storeProducts",
            productKey(body.platform, body.productId),
          );
          if (!product?.published) fail(409, "この商品は購入できません");
          if (
            (await list(q, "storeIntents", actor.user.id)).some(
              (i) => !i.completedAt && i.expiresAt > now(),
            )
          )
            fail(409, "購入処理中です。先の購入を完了または取り消してください");
          if (product.kind === "subscription") {
            const stripe = await get(q, "subscription", actor.user.id),
              current = await get(q, "storeSubscription", actor.user.id);
            if (
              ["active", "trialing", "past_due"].includes(stripe?.status) ||
              (current?.status === "active" && current.expiresAt > now())
            )
              fail(409, "契約中です。契約管理から変更してください");
            const plan = await get(q, "plans", product.planId);
            if (
              !plan?.published ||
              (plan.opensAt && plan.opensAt > now()) ||
              (plan.closesAt && plan.closesAt <= now())
            )
              fail(409, "プランの受付期間外です");
          }
          if (body.tip && product.kind !== "coins")
            fail(400, "応援にはコイン商品を選択してください");
          if (
            body.tip &&
            ((await get(q, "nativeWallet", actor.user.id))?.balance ?? 0) +
              product.credits <
              body.tip.amount
          )
            fail(400, "コイン数が応援金額に足りません");
          const intentId = id(),
            tipId = body.tip
              ? await reserveTip(q, actor.user, body.tip, body.platform)
              : undefined;
          await put(
            q,
            "storeIntents",
            intentId,
            {
              id: intentId,
              userId: actor.user.id,
              platform: body.platform,
              productId: body.productId,
              product,
              tipId,
              at: now(),
              expiresAt: later(1800),
            },
            actor.user.id,
          );
          await put(
            q,
            "storeAccounts",
            actor.user.id,
            { userId: actor.user.id },
            actor.user.id,
          );
          await put(
            q,
            "storeAccounts",
            digest(actor.user.id),
            { userId: actor.user.id },
            actor.user.id,
          );
          return {
            intentId,
            accountToken: actor.user.id,
            obfuscatedAccountId: digest(actor.user.id),
          };
        },
      );
    });
  });
  app.post("/api/native/store/intents/:id/cancel", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member"),
        intent = await get(q, "storeIntents", (request.params as any).id);
      if (!intent || intent.userId !== actor.user.id)
        fail(404, "申込が見つかりません");
      if (intent.completedAt) fail(409, "処理済みです");
      await put(
        q,
        "storeIntents",
        intent.id,
        { ...intent, expiresAt: now(), cancelledAt: now() },
        actor.user.id,
      );
      const item = intent.tipId && (await get(q, "tips", intent.tipId));
      if (item?.paymentStatus === "pending")
        await put(
          q,
          "tips",
          item.id,
          { ...item, paymentStatus: "cancelled", status: "取消" },
          actor.user.id,
        );
      return { ok: true };
    }),
  );
  app.post("/api/native/store/verify", async (request) => {
    const actor = await identity(db, request, config, "member"),
      body = storeVerifySchema.parse(request.body),
      product = await get(
        db,
        "storeProducts",
        productKey(body.platform, body.productId),
      );
    if (!product) fail(404, "商品が見つかりません");
    const transaction = await external.verifyStore(body, product.kind);
    return db.transaction(async (q) => {
      const current = await identity(q, request, config, "member");
      if (!(await get(q, "nativeAuth", current.session.id)))
        fail(403, "アプリ専用の購入です");
      const result = await apply(
        q,
        current.user,
        product,
        transaction,
        body.intentId,
      );
      const receipt = await get(q, "storeReceipts", result.receiptId);
      if (body.platform === "android")
        await put(
          q,
          "storeReceipts",
          result.receiptId,
          {
            ...receipt,
            tokenHash: digest(body.proof),
            encryptedToken: seal(body.proof, config.key),
          },
          current.user.id,
        );
      return { ...result, kind: product.kind };
    });
  });
  app.post("/api/native/tips", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member"),
        body = tip.parse(request.body);
      if (!(await get(q, "settings", "global")).billingEnabled)
        fail(409, "現在、応援を受付していません");
      return once(
        q,
        `coin-tip:${actor.user.id}`,
        String(request.headers["idempotency-key"] ?? ""),
        body,
        async () => {
          const wallet = (await get(q, "nativeWallet", actor.user.id)) ?? {
            balance: 0,
          };
          if (wallet.balance < body.amount)
            fail(409, "応援コインが不足しています");
          const tipId = await reserveTip(q, actor.user, body, "native-coins"),
            item = await get(q, "tips", tipId);
          await put(
            q,
            "nativeWallet",
            actor.user.id,
            { balance: wallet.balance - body.amount },
            actor.user.id,
          );
          await put(
            q,
            "tips",
            tipId,
            {
              ...item,
              paymentStatus: "paid",
              status: "応援完了",
              paidAt: now(),
            },
            actor.user.id,
          );
          const ledgerId = id();
          await put(
            q,
            "nativeLedger",
            ledgerId,
            {
              id: ledgerId,
              tipId,
              delta: -body.amount,
              balance: wallet.balance - body.amount,
              at: now(),
              reason: "応援に使用",
            },
            actor.user.id,
          );
          return { tipId, balance: wallet.balance - body.amount };
        },
      );
    }),
  );
  app.post("/api/webhooks/apple", async (request) => {
    const body = z
      .object({ signedPayload: z.string().max(60000) })
      .parse(JSON.parse((request.body as Buffer).toString()));
    const event = await external.appleNotification(body.signedPayload);
    return db.transaction(async (q) => {
      if (
        (
          await q.all(
            "SELECT id FROM webhook_events WHERE id = ? AND provider = 'apple'",
            [event.eventId],
          )
        ).length
      )
        return { ok: true };
      if (!event.transaction) {
        await q.run(
          "INSERT INTO webhook_events (id,provider,processed_at) VALUES (?,'apple',?)",
          [event.eventId, now()],
        );
        return { ok: true };
      }
      const owner = await get(q, "storeAccounts", event.transaction.accountId),
        product = await get(
          q,
          "storeProducts",
          productKey("ios", event.transaction.productId),
        );
      if (!owner || !product) fail(409, "購入者と商品の登録を待っています");
      const user = (
        await q.all<User>("SELECT * FROM users WHERE id = ?", [owner.userId])
      )[0];
      if (!user) fail(404, "購入者が見つかりません");
      await apply(
        q,
        user,
        product,
        event.transaction,
        undefined,
        event.reversed,
      );
      await q.run(
        "INSERT INTO webhook_events (id,provider,processed_at) VALUES (?,'apple',?)",
        [event.eventId, now()],
      );
      return { ok: true };
    });
  });
  app.post("/api/webhooks/google-play", async (request) => {
    await external.googleNotification(
      String(request.headers.authorization ?? ""),
    );
    const envelope = z
      .object({
        message: z.object({
          messageId: z.string().max(100),
          data: z.string().max(60000),
        }),
      })
      .parse(JSON.parse((request.body as Buffer).toString()));
    const message = JSON.parse(
      Buffer.from(envelope.message.data, "base64").toString("utf8"),
    );
    if (message.packageName !== config.googlePackage)
      fail(403, "パッケージが一致しません");
    if (message.testNotification) return { ok: true };
    const change =
      message.subscriptionNotification ??
      message.oneTimeProductNotification ??
      message.voidedPurchaseNotification;
    if (!change?.purchaseToken) fail(400, "購入トークンを確認してください");
    const known = (await list(db, "storeReceipts")).find(
      (r) =>
        r.platform === "android" &&
        r.tokenHash === digest(change.purchaseToken),
    );
    const productId = change.subscriptionId ?? change.sku ?? known?.productId,
      product = await get(
        db,
        "storeProducts",
        productKey("android", productId),
      );
    if (!product) fail(409, "商品の登録を待っています");
    const transaction = await external.verifyStore(
      { platform: "android", productId, proof: change.purchaseToken },
      product.kind,
    );
    if (message.voidedPurchaseNotification) transaction.revoked = true;
    return db.transaction(async (q) => {
      if (
        (
          await q.all(
            "SELECT id FROM webhook_events WHERE id = ? AND provider = 'google-play'",
            [envelope.message.messageId],
          )
        ).length
      )
        return { ok: true };
      const owner = await get(q, "storeAccounts", transaction.accountId),
        user =
          owner &&
          (
            await q.all<User>("SELECT * FROM users WHERE id = ?", [
              owner.userId,
            ])
          )[0];
      if (!user) fail(409, "購入者の登録を待っています");
      await apply(q, user, product, transaction);
      await q.run(
        "INSERT INTO webhook_events (id,provider,processed_at) VALUES (?,'google-play',?)",
        [envelope.message.messageId, now()],
      );
      return { ok: true };
    });
  });
}
export async function expireStoreMemberships(db: Database) {
  await db.transaction(async (q) => {
    for (const item of await list(q, "storeSubscription")) {
      if (item.status !== "active" || item.expiresAt > now()) continue;
      const user = (
        await q.all<User>("SELECT * FROM users WHERE id = ?", [
          item.userId ??
            (
              await get(
                q,
                "storeOwners",
                productKey(item.provider, item.originalId),
              )
            )?.userId,
        ])
      )[0];
      if (!user) continue;
      const profile = JSON.parse(user.profile),
        plan = await get(q, "plans", item.planId),
        stripe = await get(q, "subscription", user.id);
      if (
        profile.plan === plan?.name &&
        !["active", "trialing"].includes(stripe?.status)
      )
        await q.run("UPDATE users SET profile = ? WHERE id = ?", [
          JSON.stringify({ ...profile, plan: "Free" }),
          user.id,
        ]);
      await put(
        q,
        "storeSubscription",
        user.id,
        { ...item, status: "expired" },
        user.id,
      );
    }
    for (const intent of await list(q, "storeIntents"))
      if (
        !intent.completedAt &&
        !intent.expiredAt &&
        intent.expiresAt <= now()
      ) {
        await put(
          q,
          "storeIntents",
          intent.id,
          { ...intent, expiredAt: now() },
          intent.userId,
        );
        const item = intent.tipId && (await get(q, "tips", intent.tipId));
        if (item?.paymentStatus === "pending")
          await put(
            q,
            "tips",
            item.id,
            { ...item, paymentStatus: "cancelled", status: "期限切れ" },
            intent.userId,
          );
      }
  });
}
