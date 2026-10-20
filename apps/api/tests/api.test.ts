import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import Stripe from "stripe";
import sharp from "sharp";
import { createApp } from "../src/app.ts";
import { config as configuration } from "../src/config.ts";
import {
  id,
  hashPassword,
  now,
  totp,
  unseal,
  digest,
} from "../src/security.ts";
import { Database, get, list, put } from "../src/db.ts";
import { services } from "../src/services.ts";
import {
  processJobs,
  enqueue,
  scheduleReminders,
  quietDelay,
} from "../src/jobs.ts";
import { retentionPreview, runRetention } from "../src/retention.ts";
import { wallTimeToISO } from "../../member/src/dates.ts";
import { activateDueOdds } from "../src/gacha-versions.ts";
import { brandedEmail } from "../src/email.ts";
import { createBackup, restoreBackup } from "../src/backup.ts";
import { checkOperationalAlerts, maintenanceSweep } from "../src/monitoring.ts";
import { expireStoreMemberships } from "../src/stores.ts";

test("content view quotas apply to actual content and media, preserve retries and enforce target restrictions", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      headers = await f.login(fan),
      admin = await f.login(await f.user("super"), "admin", true),
      media = await uploadFile(f, admin, "image");
    await f.db.transaction(async (q) => {
      const plan = await get(q, "plans", "free");
      await put(q, "plans", "free", {
        ...plan,
        policies: {
          "calendar.view": {
            allowed: true,
            level: "view",
            day: 1,
            targets: ["schedule-one", "schedule-two"],
          },
          "story.view": { allowed: true, level: "view", day: 1 },
        },
      });
      for (const key of ["schedule-one", "schedule-two", "outside-target"])
        await put(q, "schedules", key, {
          id: key,
          title: key,
          description: "protected-description",
          url: "https://youtube.com/watch?v=test",
          image: media.url,
          date: "2099-01-01",
          time: "20:00",
          plan: "Free",
          status: "公開",
        });
      await put(q, "stories", "quota-story", {
        id: "quota-story",
        title: "閲覧制限付き",
        image: media.url,
        highlight: true,
        plan: "Free",
        status: "公開",
      });
    });
    const snapshot = (await f.app.inject({ url: "/api/state", headers })).json()
      .state;
    assert.equal(snapshot.schedules.length, 2);
    assert.equal(snapshot.schedules[0].description, "");
    assert.equal(snapshot.stories[0].image, "/assets/icon.svg");
    assert.equal(
      (await f.app.inject({ url: media.url, headers })).statusCode,
      403,
    );
    for (let i = 0; i < 2; i++) {
      const viewed = await f.app.inject({
        method: "POST",
        url: "/api/schedules/schedule-one/view",
        headers,
        payload: {},
      });
      assert.equal(viewed.statusCode, 200, viewed.body);
      assert.equal(viewed.json().description, "protected-description");
    }
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/schedules/schedule-two/view",
          headers,
          payload: {},
        })
      ).statusCode,
      429,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/schedules/outside-target/view",
          headers,
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await f.app.inject({ url: media.url, headers })).statusCode,
      200,
    );
    const acknowledge = await f.app.inject({
      method: "POST",
      url: "/api/commands",
      headers,
      payload: {
        changes: [
          { resource: "stories", id: "quota-story", after: { viewed: true } },
        ],
        action: "ストーリー閲覧",
        reason: "閲覧回数を確認する",
      },
    });
    assert.equal(acknowledge.statusCode, 200, acknowledge.body);
    assert.equal(acknowledge.json().state.stories[0].image, media.url);
  } finally {
    await f.close();
  }
});

test("Google refund notifications resolve an unseen product and an old renewal refund preserves the latest subscription", async () => {
  const f = await fixture();
  try {
    const fan = await f.user();
    await put(
      f.db,
      "storeAccounts",
      digest(fan.id),
      { userId: fan.id },
      fan.id,
    );
    await put(f.db, "plans", "play-plan", {
      id: "play-plan",
      name: "Play Gold",
      published: true,
      price: 1000,
      features: [],
    });
    const sku = "play.gold.monthly",
      product = {
        platform: "android",
        productId: sku,
        kind: "subscription",
        planId: "play-plan",
        amount: 1000,
        currency: "JPY",
        published: true,
      };
    await put(f.db, "storeProducts", digest(`android:${sku}`), product);
    const expiresAt = new Date(Date.now() + 86400000).toISOString(),
      proof = "synthetic-google-token-test-only";
    f.config.googlePackage = "test.mangumi.app";
    let inactive = false;
    (f.external as any).googleNotification = async () => {};
    (f.external as any).verifyStore = async (input: any) => ({
      platform: "android",
      id: "latest-order-2",
      originalId: digest(proof),
      productId: sku,
      accountId: digest(fan.id),
      purchasedAt: now(),
      expiresAt,
      revoked: inactive,
      quantity: 1,
    });
    const event = {
      packageName: f.config.googlePackage,
      voidedPurchaseNotification: {
        purchaseToken: proof,
        productType: 1,
        orderId: "earlier-order-1",
      },
    };
    const response = await f.app.inject({
      method: "POST",
      url: "/api/webhooks/google-play",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer synthetic-test-identity",
      },
      payload: JSON.stringify({
        message: {
          messageId: "voided-before-device-verification",
          data: Buffer.from(JSON.stringify(event)).toString("base64"),
        },
      }),
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(
      (await get(f.db, "storeSubscription", fan.id)).status,
      "active",
    );
    assert.equal((await list(f.db, "storeReceipts", fan.id))[0].revoked, false);
    const native = await nativeLogin(f, fan, "android"),
      payload = { platform: "android", productId: sku, proof };
    inactive = true;
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/native/store/verify",
          headers: native.headers,
          payload,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await get(f.db, "storeSubscription", fan.id)).status,
      "expired",
    );
    inactive = false;
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/native/store/verify",
          headers: native.headers,
          payload,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await get(f.db, "storeSubscription", fan.id)).status,
      "active",
      "a recovered Play subscription can resume the same verified period",
    );
    event.voidedPurchaseNotification.orderId = "latest-order-2";
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/webhooks/google-play",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer synthetic-test-identity",
          },
          payload: JSON.stringify({
            message: {
              messageId: "current-period-refunded",
              data: Buffer.from(JSON.stringify(event)).toString("base64"),
            },
          }),
        })
      ).statusCode,
      200,
    );
    await f.app.inject({
      method: "POST",
      url: "/api/native/store/verify",
      headers: native.headers,
      payload,
    });
    assert.equal(
      (await get(f.db, "storeSubscription", fan.id)).status,
      "expired",
      "a refunded period stays revoked even if older client state is retried",
    );
  } finally {
    await f.close();
  }
});

const password = "Mangumi-test-password-42!";

test("native token rotation preserves voice access while device revocation and lost plan rights disconnect the SFU", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official"),
      native = await nativeLogin(f, fan),
      roomId = "session-bound-voice",
      participantId = `${roomId}_${fan.id}`,
      removed: any[] = [];
    await put(f.db, "rooms", roomId, {
      id: roomId,
      title: "端末失効の確認",
      hostId: official.id,
      host: "公式",
      status: "開催中",
      plan: "Free",
    });
    (f.external as any).roomService = {
      removeParticipant: async (...args: any[]) => {
        removed.push(args);
      },
    };
    const join = await f.app.inject({
      method: "POST",
      url: `/api/voice-rooms/${roomId}/token`,
      headers: native.headers,
      payload: {},
    });
    assert.equal(join.statusCode, 200, join.body);
    const renewed = await f.app.inject({
      method: "POST",
      url: "/api/native/refresh",
      headers: { "x-mangumi-request": "1" },
      payload: {
        nonce: native.nonce,
        refreshToken: native.tokens.refreshToken,
      },
    });
    assert.equal(renewed.statusCode, 200, renewed.body);
    const current = digest(renewed.json().accessToken);
    assert.equal(
      (await get(f.db, "participants", participantId)).sessionId,
      current,
    );
    await maintenanceSweep(f.db, f.external);
    await processJobs(f.db, f.external);
    assert.equal(removed.length, 0);
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/me/sessions/${current}`,
          headers: native.web,
        })
      ).statusCode,
      200,
    );
    await put(f.db, "maintenance", "last", { at: "2000-01-01T00:00:00.000Z" });
    await maintenanceSweep(f.db, f.external);
    await processJobs(f.db, f.external);
    assert.equal(removed.length, 1);
    assert.equal(await get(f.db, "participants", participantId), undefined);
    (f.external as any).receiver = {
      receive: async () => ({
        id: "reconnect-with-revoked-voice-token",
        event: "participant_joined",
        room: { name: roomId },
        participant: { identity: fan.id, sid: "synthetic-sfu-connection" },
      }),
    };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/webhooks/livekit",
          headers: { "content-type": "application/json" },
          payload: "{}",
        })
      ).statusCode,
      200,
    );
    await processJobs(f.db, f.external);
    assert.equal(
      removed.length,
      2,
      "a reconnect without an authorized API reservation is removed",
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/voice-rooms/${roomId}/token`,
          headers: native.web,
          payload: {},
        })
      ).statusCode,
      200,
    );
    const plan = await get(f.db, "plans", "free");
    await put(f.db, "plans", "free", {
      ...plan,
      policies: { "voice.join": { allowed: false, level: "view" } },
    });
    await put(f.db, "maintenance", "last", { at: "2000-01-01T00:00:00.000Z" });
    await maintenanceSweep(f.db, f.external);
    await processJobs(f.db, f.external);
    assert.equal(removed.length, 3);
  } finally {
    await f.close();
  }
});
async function uploadFile(
  f: Awaited<ReturnType<typeof fixture>>,
  headers: Record<string, string>,
  kind: string,
  bytes?: Buffer,
) {
  const form = new FormData();
  const image =
    bytes ??
    (await sharp({
      create: { width: 64, height: 32, channels: 3, background: "#ee2255" },
    })
      .png()
      .toBuffer());
  form.append(
    "file",
    new Blob([new Uint8Array(image)], { type: "image/png" }),
    "image.png",
  );
  const request = new Request("http://localhost/upload", {
    method: "POST",
    body: form,
  });
  const response = await f.app.inject({
    method: "POST",
    url: `/api/uploads?kind=${kind}`,
    headers: {
      ...headers,
      "content-type": request.headers.get("content-type")!,
    },
    payload: Buffer.from(await request.arrayBuffer()),
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as { id: string; url: string };
}
async function fixture(persistent = false) {
  const directory = await mkdtemp(join(tmpdir(), "mangumi-api-"));
  const config = configuration({
    NODE_ENV: "test",
    APP_ORIGIN: "http://localhost:3001",
    SQLITE_PATH: persistent ? join(directory, "database.sqlite") : ":memory:",
    DATABASE_URL: process.env.MANGUMI_TEST_DATABASE_URL ?? "",
    UPLOAD_DIR: directory,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    WORKERS: "off",
    STRIPE_WEBHOOK_SECRET: "whsec_local_test",
  });
  if (config.database) {
    const url = new URL(config.database);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(
      url.pathname,
      "/mangumi_test",
      "Only the isolated test database may be cleared",
    );
  }
  const database = new Database(config);
  await database.initialize();
  if (config.database) {
    for (const table of [
      "users",
      "sessions",
      "tokens",
      "entities",
      "idempotency",
      "jobs",
      "audit_logs",
      "webhook_events",
    ])
      await database.run(`DELETE FROM ${table}`);
  }
  const sent: any[] = [],
    pushed: any[] = [],
    checkouts: any[] = [];
  const stripe = new Stripe("sk_test_local_not_a_real_key");
  stripe.customers.create = (async () => ({ id: "cus_test" })) as any;
  stripe.checkout.sessions.create = (async (body: any) => {
    checkouts.push(body);
    return {
      id: `cs_${checkouts.length}`,
      url: "https://checkout.stripe.com/c/pay/test",
    };
  }) as any;
  const external = {
    ...services(config),
    stripe,
    requireStripe: () => stripe,
    mail: async (body: any) => {
      sent.push(body);
    },
    push: async (subscription: any, body: any) => {
      pushed.push({ subscription, body });
    },
    voiceToken: async (
      room: string,
      userId: string,
      name: string,
      publish: boolean,
    ) => ({
      token: JSON.stringify({ room, userId, name, publish }),
      url: "wss://voice.example.test",
    }),
  };
  const { app, db } = await createApp({
    config,
    db: database,
    services: external,
    logger: false,
  });
  async function user(role = "member", email = `${id()}@example.test`) {
    const userId = id();
    await db.transaction(async (q) => {
      await q.run(
        "INSERT INTO users (id,email,password_hash,profile,role,status,verified,created_at) VALUES (?,?,?,?,?,'active',1,?)",
        [
          userId,
          email,
          await hashPassword(password),
          JSON.stringify({
            name:
              role === "official" ? "まんぞう" : `会員${userId.slice(0, 4)}`,
            avatar: "/assets/avatar.jpg",
            gender: "回答しない",
            publicGender: false,
            plan: "Free",
          }),
          role,
          now(),
        ],
      );
      await put(q, "wallet", userId, { balance: 5 }, userId);
    });
    return { id: userId, email };
  }
  async function login(
    account: { email: string },
    area = "member",
    mfa = false,
  ) {
    const prefix = area === "admin" ? "/admin/auth" : "/auth";
    const response = await app.inject({
      method: "POST",
      url: `/api${prefix}/login`,
      headers: { origin: config.origin, "x-mangumi-request": "1" },
      payload: { email: account.email, password },
    });
    assert.equal(response.statusCode, 200, response.body);
    const cookie = response.cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const headers = {
      cookie,
      origin: config.origin,
      "x-mangumi-request": "1",
      "x-mangumi-area": area,
      "x-csrf-token": response.json().csrf,
      "idempotency-key": id(),
    };
    if (mfa) {
      const enroll = await app.inject({
        method: "POST",
        url: "/api/admin/auth/mfa/enroll",
        headers,
        payload: {},
      });
      assert.equal(enroll.statusCode, 200, enroll.body);
      const verify = await app.inject({
        method: "POST",
        url: "/api/admin/auth/mfa/verify",
        headers,
        payload: { code: totp(enroll.json().secret) },
      });
      assert.equal(verify.statusCode, 200, verify.body);
    }
    return headers;
  }
  return {
    app,
    db,
    config,
    external,
    user,
    login,
    sent,
    pushed,
    checkouts,
    close: async () => {
      await app.close();
      const target = relative(resolve(tmpdir()), resolve(directory));
      assert.ok(
        target.startsWith("mangumi-api-") &&
          !target.includes("..") &&
          !isAbsolute(target),
      );
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function nativeLogin(
  f: Awaited<ReturnType<typeof fixture>>,
  account: { email: string },
  platform = "ios",
) {
  const web = await f.login(account),
    nonce = id(),
    linked = await f.app.inject({
      method: "POST",
      url: "/api/native/link",
      headers: web,
      payload: { nonce, platform },
    });
  assert.equal(linked.statusCode, 200, linked.body);
  const response = await f.app.inject({
    method: "POST",
    url: "/api/native/exchange",
    headers: { "x-mangumi-request": "1" },
    payload: { nonce, code: linked.json().code },
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    web,
    nonce,
    tokens: response.json(),
    headers: {
      authorization: `Bearer ${response.json().accessToken}`,
      "x-mangumi-request": "1",
      "idempotency-key": id(),
    },
  };
}
test("native sessions bind one-time codes, rotate credentials and reject revoked devices or cookie tokens as bearer", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official"),
      native = await nativeLogin(f, fan);
    const fakeCookie = decodeURIComponent(native.web.cookie.split("=")[1]);
    assert.equal(
      (
        await f.app.inject({
          url: "/api/me/sessions",
          headers: { authorization: `Bearer ${fakeCookie}` },
        })
      ).statusCode,
      401,
    );
    const contact = await f.app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: native.headers,
      payload: { peer: official.id },
    });
    assert.equal(contact.statusCode, 200, contact.body);
    assert.equal(
      (
        await f.app.inject({
          url: "/api/admin/members",
          headers: native.headers,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/native/refresh",
          headers: {
            "x-mangumi-request": "1",
            origin: "https://outside.example.test",
          },
          payload: {
            nonce: native.nonce,
            refreshToken: native.tokens.refreshToken,
          },
        })
      ).statusCode,
      403,
    );
    const refreshPayload = {
        nonce: native.nonce,
        refreshToken: native.tokens.refreshToken,
      },
      head = { "x-mangumi-request": "1" };
    const refreshed = await f.app.inject({
      method: "POST",
      url: "/api/native/refresh",
      headers: head,
      payload: refreshPayload,
    });
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    const retried = await f.app.inject({
      method: "POST",
      url: "/api/native/refresh",
      headers: head,
      payload: refreshPayload,
    });
    assert.deepEqual(
      retried.json(),
      refreshed.json(),
      "a lost refresh response can be retried for the same installation",
    );
    assert.equal(
      (await f.app.inject({ url: "/api/me/sessions", headers: native.headers }))
        .statusCode,
      401,
    );
    const active = {
      ...native.headers,
      authorization: `Bearer ${refreshed.json().accessToken}`,
    };
    const ticket = await f.app.inject({
      method: "POST",
      url: "/api/native/web-ticket",
      headers: active,
      payload: { nonce: native.nonce, path: "/u/U022" },
    });
    assert.equal(ticket.statusCode, 200, ticket.body);
    const login = await f.app.inject({
      method: "POST",
      url: "/api/native/web-login",
      headers: head,
      payload: { nonce: native.nonce, ticket: ticket.json().ticket },
    });
    assert.equal(login.statusCode, 303, login.body);
    assert.equal(login.headers.location, "/u/U022");
    assert.ok(login.cookies.some((c) => c.httpOnly));
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/native/web-login",
          headers: head,
          payload: { nonce: native.nonce, ticket: ticket.json().ticket },
        })
      ).statusCode,
      401,
    );
    const lostDevice = digest(refreshed.json().accessToken);
    await f.db.run("DELETE FROM sessions WHERE id = ?", [lostDevice]);
    const revoked = await f.app.inject({
      method: "POST",
      url: "/api/native/refresh",
      headers: head,
      payload: {
        nonce: native.nonce,
        refreshToken: refreshed.json().refreshToken,
      },
    });
    assert.equal(revoked.statusCode, 401);
    const replayAfterRevoke = await f.app.inject({
      method: "POST",
      url: "/api/native/refresh",
      headers: head,
      payload: refreshPayload,
    });
    assert.equal(replayAfterRevoke.statusCode, 401);
  } finally {
    await f.close();
  }
});
test("native push uses the same preferences and tracks Expo receipts without resurrecting an unregistered device", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      native = await nativeLogin(f, fan);
    const registration = await f.app.inject({
      method: "POST",
      url: "/api/native/push",
      headers: native.headers,
      payload: {
        token: "ExpoPushToken[synthetic-device-42]",
        label: "iPhone test",
      },
    });
    assert.equal(registration.statusCode, 200, registration.body);
    (f.external as any).push = async () => ({ receiptId: "synthetic-receipt" });
    (f.external as any).pushReceipts = async () => ({
      "synthetic-receipt": {
        status: "error",
        details: { error: "DeviceNotRegistered" },
      },
    });
    await enqueue(f.db, "native-push-test", "push", {
      userId: fan.id,
      title: "お知らせ",
      body: "テスト配信",
      path: "/",
      notificationKind: "general",
    });
    await processJobs(f.db, f.external);
    assert.equal((await list(f.db, "deliveries", fan.id))[0].status, "sent");
    await f.db.run("UPDATE jobs SET due_at = ? WHERE kind = 'expo_receipts'", [
      new Date(Date.now() - 1000).toISOString(),
    ]);
    await processJobs(f.db, f.external);
    assert.equal((await list(f.db, "push", fan.id)).length, 0);
    assert.equal(
      (await list(f.db, "deliveries", fan.id))[0].code,
      "DeviceNotRegistered",
    );
  } finally {
    await f.close();
  }
});
test("verified native purchases fund coins once, tips consume atomically and refunds cannot be replayed into credit", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      other = await f.user(),
      official = await f.user("official"),
      native = await nativeLogin(f, fan),
      admin = await f.login(await f.user("super"), "admin", true);
    await f.db.transaction(async (q) => {
      const settings = await get(q, "settings", "global");
      await put(q, "settings", "global", { ...settings, billingEnabled: true });
      const plan = await get(q, "plans", "free");
      await put(q, "plans", "free", {
        ...plan,
        features: [...plan.features, "投げ銭"],
      });
    });
    const product = {
      platform: "ios",
      productId: "test.coins500",
      title: "500コイン",
      kind: "coins",
      amount: 500,
      currency: "JPY",
      credits: 500,
      published: true,
    };
    const saved = await f.app.inject({
      method: "POST",
      url: "/api/admin/store-products",
      headers: admin,
      payload: { product, reason: "アプリの応援商品を登録する" },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    let revoked = false;
    (f.external as any).storeReady = async () => {};
    (f.external as any).verifyStore = async () => ({
      platform: "ios",
      id: "store-transaction-1",
      originalId: "store-transaction-1",
      productId: product.productId,
      accountId: fan.id,
      purchasedAt: now(),
      revoked,
      quantity: 1,
      amount: 500,
      currency: "JPY",
    });
    const intent = await f.app.inject({
      method: "POST",
      url: "/api/native/store/intents",
      headers: native.headers,
      payload: {
        platform: "ios",
        productId: product.productId,
        tip: {
          amount: 100,
          recipient: official.id,
          message: "応援しています",
          visibility: "private",
        },
      },
    });
    assert.equal(intent.statusCode, 200, intent.body);
    const proof = {
      platform: "ios",
      productId: product.productId,
      proof: "synthetic-jws-test-only",
      intentId: intent.json().intentId,
    };
    await f.app.inject({
      method: "POST",
      url: "/api/admin/store-products",
      headers: admin,
      payload: {
        product: { ...product, credits: 999 },
        reason: "将来購入分のコイン数を変更",
      },
    });
    for (let i = 0; i < 3; i++) {
      const verified = await f.app.inject({
        method: "POST",
        url: "/api/native/store/verify",
        headers: native.headers,
        payload: proof,
      });
      assert.equal(verified.statusCode, 200, verified.body);
    }
    assert.equal((await get(f.db, "nativeWallet", fan.id)).balance, 400);
    assert.equal(
      (await list(f.db, "tips", fan.id)).filter(
        (t) => t.paymentStatus === "paid",
      ).length,
      1,
    );
    const second = await nativeLogin(f, other);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/native/store/verify",
          headers: second.headers,
          payload: proof,
        })
      ).statusCode,
      403,
    );
    const spendHeaders = { ...native.headers, "idempotency-key": id() };
    for (let i = 0; i < 2; i++) {
      const spend = await f.app.inject({
        method: "POST",
        url: "/api/native/tips",
        headers: spendHeaders,
        payload: {
          amount: 100,
          recipient: official.id,
          message: "コインから応援",
        },
      });
      assert.equal(spend.statusCode, 200, spend.body);
    }
    assert.equal((await get(f.db, "nativeWallet", fan.id)).balance, 300);
    revoked = true;
    const refund = await f.app.inject({
      method: "POST",
      url: "/api/native/store/verify",
      headers: native.headers,
      payload: proof,
    });
    assert.equal(refund.statusCode, 200, refund.body);
    assert.equal((await get(f.db, "nativeWallet", fan.id)).balance, -200);
    assert.equal(
      (await list(f.db, "tips", fan.id)).find((t) => t.storeReceiptId)
        ?.paymentStatus,
      "refunded",
    );
    revoked = false;
    await f.app.inject({
      method: "POST",
      url: "/api/native/store/verify",
      headers: native.headers,
      payload: proof,
    });
    assert.equal(
      (await get(f.db, "nativeWallet", fan.id)).balance,
      -200,
      "an older receipt cannot undo a verified refund",
    );
    const noBalance = await f.app.inject({
      method: "POST",
      url: "/api/native/tips",
      headers: { ...native.headers, "idempotency-key": id() },
      payload: { amount: 100, recipient: official.id, message: "不足時" },
    });
    assert.equal(noBalance.statusCode, 409);
    (f.external as any).appleNotification = async () => ({
      eventId: "refund-reversed-event-test",
      reversed: true,
      transaction: await (f.external as any).verifyStore(),
    });
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/webhooks/apple",
            headers: { "content-type": "application/json" },
            payload: JSON.stringify({
              signedPayload: "synthetic-signed-payload",
            }),
          })
        ).statusCode,
        200,
      );
    assert.equal(
      (await get(f.db, "nativeWallet", fan.id)).balance,
      300,
      "only an authenticated refund reversal restores the original credits, once",
    );
    assert.equal(
      (await list(f.db, "tips", fan.id)).find((t) => t.storeReceiptId)
        ?.paymentStatus,
      "paid",
    );
  } finally {
    await f.close();
  }
});
test("native subscriptions require verified ownership and automatically expire without a client success claim", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      native = await nativeLogin(f, fan),
      admin = await f.login(await f.user("super"), "admin", true);
    await f.db.transaction(async (q) => {
      await put(q, "plans", "native-gold", {
        id: "native-gold",
        name: "Native Gold",
        price: 1000,
        published: true,
        features: ["公式DM"],
      });
      await put(q, "settings", "global", {
        ...(await get(q, "settings", "global")),
        billingEnabled: true,
      });
    });
    const product = {
      platform: "ios",
      productId: "test.monthly",
      title: "月額プラン",
      kind: "subscription",
      amount: 1000,
      currency: "JPY",
      planId: "native-gold",
      period: "month",
      published: true,
    };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/admin/store-products",
          headers: admin,
          payload: { product, reason: "アプリの月額プランを登録" },
        })
      ).statusCode,
      200,
    );
    let expiresAt = new Date(Date.now() + 86400000).toISOString();
    (f.external as any).storeReady = async () => {};
    (f.external as any).verifyStore = async () => ({
      platform: "ios",
      id: "subscription-1",
      originalId: "subscription-original",
      productId: product.productId,
      accountId: fan.id,
      purchasedAt: now(),
      expiresAt,
      revoked: false,
      quantity: 1,
    });
    const confirmed = await f.app.inject({
      method: "POST",
      url: "/api/native/store/verify",
      headers: native.headers,
      payload: {
        platform: "ios",
        productId: product.productId,
        proof: "synthetic-subscription-proof",
      },
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(
      JSON.parse(
        (await f.db.all("SELECT profile FROM users WHERE id = ?", [fan.id]))[0]
          .profile,
      ).plan,
      "Native Gold",
    );
    const subscription = await get(f.db, "storeSubscription", fan.id);
    await put(
      f.db,
      "storeSubscription",
      fan.id,
      { ...subscription, expiresAt: new Date(Date.now() - 1000).toISOString() },
      fan.id,
    );
    await expireStoreMemberships(f.db);
    assert.equal(
      JSON.parse(
        (await f.db.all("SELECT profile FROM users WHERE id = ?", [fan.id]))[0]
          .profile,
      ).plan,
      "Free",
    );
  } finally {
    await f.close();
  }
});

test("native stores reject missing provider verification and forged notifications before granting an entitlement", async () => {
  const f = await fixture();
  try {
    const native = await nativeLogin(f, await f.user());
    const response = await f.app.inject({
      method: "POST",
      url: "/api/native/store/intents",
      headers: native.headers,
      payload: { platform: "ios", productId: "not.configured" },
    });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal((await list(f.db, "storeIntents")).length, 0);
    for (const [url, payload] of [
      ["apple", { signedPayload: "forged.not-a-real-signature" }],
      ["google-play", { message: { messageId: "forged", data: "e30=" } }],
    ] as const) {
      const result = await f.app.inject({
        method: "POST",
        url: `/api/webhooks/${url}`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(payload),
      });
      assert.ok(result.statusCode >= 400, result.body);
    }
    assert.equal((await list(f.db, "storeReceipts")).length, 0);
  } finally {
    await f.close();
  }
});

test("per-schedule reminders respect custom timing, individual opt-out and disabling already queued notifications", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      headers = await f.login(fan),
      other = await f.user(),
      admin = await f.login(await f.user("super"), "admin", true),
      scheduleId = id(),
      startsAt = new Date(Date.now() + 5 * 60000).toISOString();
    await put(
      f.db,
      "schedules",
      scheduleId,
      {
        id: scheduleId,
        title: "個別通知設定の配信",
        date: startsAt.slice(0, 10),
        time: "20:00",
        startsAt,
        plan: "Free",
        status: "公開",
        notify: true,
        reminderMinutes: [5],
      },
      undefined,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "PUT",
          url: `/api/schedules/${scheduleId}/reminders`,
          headers,
          payload: { minutes: [] },
        })
      ).statusCode,
      200,
    );
    await scheduleReminders(f.db);
    const jobs = await f.db.all("SELECT * FROM jobs WHERE kind = 'push'");
    assert.ok(jobs.some((j) => JSON.parse(j.payload).userId === other.id));
    assert.ok(!jobs.some((j) => JSON.parse(j.payload).userId === fan.id));
    const schedule = await get(f.db, "schedules", scheduleId);
    await put(f.db, "schedules", scheduleId, { ...schedule, notify: false });
    await put(
      f.db,
      "push",
      "reminder-test-device",
      { subscription: { endpoint: "https://push.example.test/synthetic" } },
      other.id,
    );
    await processJobs(f.db, f.external);
    assert.equal(f.pushed.length, 0);
    const metadata = await f.app.inject({
      url: `/api/schedules/${scheduleId}/reminders`,
      headers,
    });
    assert.equal(metadata.json().enabled, false);
  } finally {
    await f.close();
  }
});

test("private tip messages are recipient-only, public messages hide blocked and refunded senders", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official"),
      viewer = await f.user(),
      recipient = await f.login(official),
      reader = await f.login(viewer);
    for (const [key, visibility, refunded] of [
      ["private", "private", 0],
      ["public", "public", 0],
      ["refund", "public", 100],
    ] as const)
      await put(
        f.db,
        "tips",
        key,
        {
          id: key,
          userId: fan.id,
          recipient: official.id,
          message: key,
          visibility,
          paymentStatus: "paid",
          amount: 100,
          refunded,
          at: now(),
        },
        fan.id,
      );
    assert.deepEqual(
      (await f.app.inject({ url: "/api/tips/messages", headers: reader }))
        .json()
        .map((r: any) => r.message),
      ["public"],
    );
    assert.equal(
      (
        await f.app.inject({ url: "/api/tips/messages", headers: recipient })
      ).json().length,
      2,
    );
    await put(
      f.db,
      "blocks",
      `${viewer.id}_${fan.id}`,
      { userId: fan.id },
      viewer.id,
    );
    assert.equal(
      (
        await f.app.inject({ url: "/api/tips/messages", headers: reader })
      ).json().length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("new-device logins and password changes queue durable security notices and revoke existing native sessions", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      native = await nativeLogin(f, fan);
    const login = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: {
        origin: f.config.origin,
        "x-mangumi-request": "1",
        "user-agent": "Synthetic new device",
      },
      payload: { email: fan.email, password },
    });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal((await list(f.db, "securityEvents", fan.id)).length, 1);
    const head = { origin: f.config.origin, "x-mangumi-request": "1" };
    await f.app.inject({
      method: "POST",
      url: "/api/auth/password/request",
      headers: head,
      payload: { email: fan.email },
    });
    await processJobs(f.db, f.external);
    const mail = f.sent.find((m) => m.text.includes("/u/U013?token=")),
      token = new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get(
        "token",
      );
    const reset = await f.app.inject({
      method: "POST",
      url: "/api/auth/password/reset",
      headers: head,
      payload: { token, password: "Changed-synthetic-password-42!" },
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(
      (await f.app.inject({ url: "/api/me/sessions", headers: native.headers }))
        .statusCode,
      401,
    );
    await processJobs(f.db, f.external);
    assert.ok(f.sent.some((m) => m.subject.includes("パスワード")));
    assert.equal((await list(f.db, "securityEvents", fan.id)).length, 2);
  } finally {
    await f.close();
  }
});

test("operational alerts enforce role, thresholds, cooldown, recovery and durable mail delivery", async () => {
  const f = await fixture();
  try {
    const admin = await f.login(await f.user("super"), "admin", true),
      member = await f.login(await f.user());
    assert.equal(
      (await f.app.inject({ url: "/api/admin/monitoring", headers: member }))
        .statusCode,
      401,
    );
    const support = await f.login(await f.user("support"), "admin", true);
    assert.equal(
      (await f.app.inject({ url: "/api/admin/monitoring", headers: support }))
        .statusCode,
      403,
    );
    const policy = {
      enabled: true,
      recipients: ["ops@example.test"],
      p95Ms: 500,
      errorPercent: 10,
      minimumRequests: 20,
      failedJobs: 1,
      cooldownMinutes: 30,
    };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/admin/monitoring",
          headers: admin,
          payload: {
            policy: { ...policy, recipients: [] },
            reason: "異常通知先の検証",
          },
        })
      ).statusCode,
      400,
    );
    const saved = await f.app.inject({
      method: "POST",
      url: "/api/admin/monitoring",
      headers: admin,
      payload: { policy, reason: "運用アラートを有効にする" },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const advance = async () => {
      const state = await get(f.db, "monitoring", "state");
      await put(f.db, "monitoring", "state", {
        ...state,
        checkedAt: new Date(Date.now() - 70000).toISOString(),
      });
    };
    await checkOperationalAlerts(f.db, [
      { route: "GET /api/state", requests: 2, errors: 2, p95Ms: 800 },
    ]);
    await processJobs(f.db, f.external);
    assert.equal(f.sent.length, 0, "small samples do not trigger API alerts");
    await advance();
    const samples = [
      { route: "GET /api/state", requests: 20, errors: 3, p95Ms: 800 },
    ];
    await checkOperationalAlerts(f.db, samples);
    await processJobs(f.db, f.external);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].to, "ops@example.test");
    assert.match(f.sent[0].text, /p95 800ms/);
    assert.match(f.sent[0].text, /15.0%/);
    await advance();
    await checkOperationalAlerts(f.db, samples);
    await processJobs(f.db, f.external);
    assert.equal(f.sent.length, 1, "ongoing incident respects cooldown");
    await advance();
    await checkOperationalAlerts(f.db, []);
    await processJobs(f.db, f.external);
    assert.equal(f.sent.length, 2);
    assert.match(f.sent[1].subject, /回復/);
    await advance();
    await enqueue(f.db, "test-failed-job", "mail", {
      to: "nobody@example.test",
    });
    await f.db.run("UPDATE jobs SET state = 'failed' WHERE id = ?", [
      "test-failed-job",
    ]);
    await checkOperationalAlerts(f.db, []);
    await processJobs(f.db, f.external);
    assert.equal(f.sent.length, 3);
    assert.match(f.sent[2].text, /失敗ジョブ 1件/);
    const history = await f.app.inject({
      url: "/api/admin/monitoring",
      headers: admin,
    });
    assert.equal(history.json().history.length, 3);
    assert.ok(
      (
        await f.db.all(
          "SELECT id FROM audit_logs WHERE action = 'monitoring.policy'",
        )
      ).length,
    );
  } finally {
    await f.close();
  }
});

test("public HTML includes the current escaped brand title and OGP before JavaScript runs", async () => {
  const f = await fixture();
  try {
    f.config.webRoot = join(f.config.files, "static-web");
    await mkdir(f.config.webRoot);
    await writeFile(
      join(f.config.webRoot, "index.html"),
      '<!DOCTYPE html><html><head><title data-rh="true"></title><meta name="description" content="old"></head><body>app</body></html>',
    );
    const initial = await f.app.inject({ url: "/" });
    assert.equal(initial.statusCode, 200);
    assert.ok(initial.body.includes("<title>まんぞうラブ</title>"));
    await put(f.db, "brand", "current", {
      name: 'マン組 <Love> & "Fan"',
      description: "公式 <案内>",
    });
    const branded = await f.app.inject({ url: "/" });
    assert.ok(
      branded.body.includes(
        "<title>マン組 &lt;Love&gt; &amp; &quot;Fan&quot;</title>",
      ),
    );
    assert.ok(
      branded.body.includes(
        'property="og:title" content="マン組 &lt;Love&gt; &amp; &quot;Fan&quot;"',
      ),
    );
    assert.ok(!branded.body.includes('content="old"'));
  } finally {
    await f.close();
  }
});

test("registration, one-time email verification, reset and session revocation", async () => {
  const f = await fixture();
  try {
    const email = "new-fan@example.test";
    const picture = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(picture)], { type: "image/png" }),
      "avatar.png",
    );
    const uploadRequest = new Request("http://localhost", {
      method: "POST",
      body: form,
    });
    const upload = await f.app.inject({
      method: "POST",
      url: "/api/uploads?kind=avatar",
      headers: {
        origin: f.config.origin,
        "x-mangumi-request": "1",
        "content-type": uploadRequest.headers.get("content-type")!,
      },
      payload: Buffer.from(await uploadRequest.arrayBuffer()),
    });
    assert.equal(upload.statusCode, 200, upload.body);
    const response = await f.app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: f.config.origin, "x-mangumi-request": "1" },
      payload: {
        name: "新しいファン",
        email,
        password,
        gender: "回答しない",
        termsVersion: "2026-10-20",
        avatar: upload.json().url,
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    const user = (
      await f.db.all("SELECT * FROM users WHERE email = ?", [email])
    )[0];
    assert.ok(user.password_hash.startsWith("$argon2id$"));
    const headers = await f.login({ email });
    const denied = await f.app.inject({
      method: "POST",
      url: "/api/gacha/draw",
      headers,
      payload: { count: 1 },
    });
    assert.equal(denied.statusCode, 403);
    await processJobs(f.db, f.external);
    const token = new URL(f.sent[0].text.split("\n")[1]).searchParams.get(
      "token",
    );
    const verify = () =>
      f.app.inject({
        method: "POST",
        url: "/api/auth/verify",
        headers,
        payload: { token },
      });
    assert.equal((await verify()).statusCode, 200);
    assert.equal((await verify()).statusCode, 400);
    assert.equal((await get(f.db, "wallet", user.id)).balance, 5);
    await f.app.inject({
      method: "POST",
      url: "/api/auth/password/request",
      headers,
      payload: { email },
    });
    await processJobs(f.db, f.external);
    const resetToken = new URL(
      f.sent.at(-1).text.split("\n")[1],
    ).searchParams.get("token");
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/password/reset",
          headers,
          payload: { token: resetToken, password: "Changed-password-42!" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/auth/session", headers })).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/password/reset",
          headers,
          payload: { token: resetToken, password },
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.close();
  }
});
test("origin, CSRF, mandatory MFA and admin role checks reject forged mutations", async () => {
  const f = await fixture();
  try {
    const account = await f.user("content"),
      headers = await f.login(account, "admin");
    const command = {
      changes: [{ resource: "settings", after: { name: "改ざん" } }],
      reason: "test",
      action: "test",
    };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/commands",
          headers,
          payload: command,
        })
      ).statusCode,
      403,
    );
    const enroll = await f.app.inject({
      method: "POST",
      url: "/api/admin/auth/mfa/enroll",
      headers,
      payload: {},
    });
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/admin/auth/mfa/verify",
          headers,
          payload: { code: totp(enroll.json().secret) },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/commands",
          headers,
          payload: command,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/commands",
          headers: { ...headers, origin: "https://attacker.example" },
          payload: command,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/commands",
          headers: { ...headers, "x-csrf-token": "wrong" },
          payload: command,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/admin/auth/mfa/verify",
          headers,
          payload: { code: totp(enroll.json().secret) },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});
test("administrator changes persist, members cannot grant themselves a plan or tickets", async () => {
  const f = await fixture();
  try {
    const admin = await f.user("super"),
      fan = await f.user();
    const adminHeaders = await f.login(admin, "admin", true),
      headers = await f.login(fan);
    const schedule = {
      id: id(),
      title: "正式な配信",
      date: "2026-12-31",
      time: "20:00",
      host: "まんぞう",
      status: "公開",
      image: "/assets/thumb_1.jpg",
      url: "https://youtube.com/",
      description: "配信のお知らせ",
      plan: "Free",
    };
    const write = await f.app.inject({
      method: "POST",
      url: "/api/commands",
      headers: adminHeaders,
      payload: {
        changes: [{ resource: "schedules", id: schedule.id, after: schedule }],
        action: "予定作成",
        reason: "公開予定を登録",
      },
    });
    assert.equal(write.statusCode, 200, write.body);
    const state = await f.app.inject({ url: "/api/state", headers });
    assert.equal(state.json().state.schedules[0].title, "正式な配信");
    const tamper = await f.app.inject({
      method: "POST",
      url: "/api/commands",
      headers,
      payload: {
        changes: [
          { resource: "profile", after: { plan: "VIP", verified: true } },
        ],
        action: "test",
        reason: "test",
      },
    });
    assert.equal(tamper.statusCode, 400);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/commands",
          headers: { ...headers, "idempotency-key": id() },
          payload: {
            changes: [{ resource: "tickets", after: 999 }],
            action: "test",
            reason: "test",
          },
        })
      ).statusCode,
      403,
    );
    assert.ok(
      (
        await f.db.all("SELECT * FROM audit_logs WHERE target = ?", [
          `schedules/${schedule.id}`,
        ])
      ).length,
    );
  } finally {
    await f.close();
  }
});
test("gacha retries consume once, odds versions and prize names remain immutable", async () => {
  const f = await fixture();
  try {
    const admin = await f.user("super"),
      fan = await f.user();
    const adminHeaders = await f.login(admin, "admin", true),
      headers = await f.login(fan);
    const items = [
      {
        title: "限定写真",
        rarity: "R",
        weight: 100,
        image: "/assets/thumb_1.jpg",
      },
    ];
    await f.db.transaction(async (q) => {
      await put(q, "probabilities", "current", {
        version: "version-original",
        items,
      });
      await put(q, "gacha", "global", {
        title: "無料ガチャ",
        status: "公開",
        start: "2020-01-01",
        end: "2099-12-31",
      });
    });
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        f.app.inject({
          method: "POST",
          url: "/api/gacha/draw",
          headers,
          payload: { count: 1 },
        }),
      ),
    );
    assert.ok(
      responses.every((response) => response.statusCode === 200),
      responses.map((response) => response.body).join("\n"),
    );
    assert.equal(
      new Set(responses.map((response) => response.json().results[0].id)).size,
      1,
    );
    assert.equal((await get(f.db, "wallet", fan.id)).balance, 4);
    assert.equal((await list(f.db, "draws", fan.id)).length, 1);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/gacha/draw",
          headers,
          payload: { count: 2 },
        })
      ).statusCode,
      409,
    );
    const change = await f.app.inject({
      method: "POST",
      url: "/api/commands",
      headers: adminHeaders,
      payload: {
        changes: [
          {
            resource: "probabilities",
            after: [{ ...items[0], title: "新しい写真" }],
          },
        ],
        action: "確率変更",
        reason: "新キャンペーン",
      },
    });
    assert.equal(change.statusCode, 200, change.body);
    assert.equal((await list(f.db, "draws", fan.id))[0].title, "限定写真");
    assert.equal(
      (await list(f.db, "draws", fan.id))[0].version,
      "version-original",
    );
    assert.equal(
      (await get(f.db, "probabilityVersions", "version-original")).items[0]
        .title,
      "限定写真",
    );
  } finally {
    await f.close();
  }
});
test("DM ownership, mutual blocks and evidence snapshots survive retraction", async () => {
  const f = await fixture();
  try {
    const first = await f.user(),
      other = await f.user(),
      official = await f.user("official"),
      moderator = await f.user("moderator");
    const headers = await f.login(first),
      otherHeaders = await f.login(other),
      officialHeaders = await f.login(official),
      modHeaders = await f.login(moderator, "admin", true);
    const create = await f.app.inject({
      method: "POST",
      url: "/api/conversations",
      headers,
      payload: { peer: official.id },
    });
    assert.equal(create.statusCode, 200, create.body);
    const conversationId = create.json().id;
    const message = await f.app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers,
      payload: { text: "応援しています！" },
    });
    assert.equal(message.statusCode, 200, message.body);
    assert.equal(
      (
        await f.app.inject({
          url: `/api/conversations/${conversationId}/messages`,
          headers: otherHeaders,
        })
      ).statusCode,
      404,
    );
    const report = await f.app.inject({
      method: "POST",
      url: "/api/reports",
      headers: officialHeaders,
      payload: {
        type: "message",
        targetId: message.json().id,
        reason: "調査用の通報証跡",
      },
    });
    assert.equal(report.statusCode, 200, report.body);
    await f.app.inject({
      method: "DELETE",
      url: `/api/messages/${message.json().id}`,
      headers,
      payload: { scope: "retract" },
    });
    const evidence = await f.app.inject({
      method: "POST",
      url: `/api/admin/reports/${report.json().id}/evidence`,
      headers: modHeaders,
      payload: { reason: "通報対応の調査" },
    });
    assert.equal(evidence.statusCode, 200, evidence.body);
    assert.equal(evidence.json().evidence.text, "応援しています！");
    await f.app.inject({
      method: "POST",
      url: "/api/blocks",
      headers,
      payload: { userId: official.id },
    });
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/conversations/${conversationId}/messages`,
          headers: { ...officialHeaders, "idempotency-key": id() },
          payload: { text: "返信です" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});
test("Stripe hosted checkout stays pending until a signed webhook, duplicate events are harmless", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official"),
      headers = await f.login(fan);
    await f.db.transaction(async (q) => {
      const settings = await get(q, "settings", "global");
      settings.billingEnabled = true;
      await put(q, "settings", "global", settings);
      const plan = await get(q, "plans", "free");
      await put(q, "plans", "free", {
        ...plan,
        features: [...plan.features, "投げ銭"],
      });
    });
    const response = await f.app.inject({
      method: "POST",
      url: "/api/billing/checkout",
      headers,
      payload: {
        kind: "tip",
        recipient: official.id,
        amount: 500,
        message: "ありがとう",
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    const tip = (await list(f.db, "tips", fan.id))[0];
    assert.equal(tip.paymentStatus, "pending");
    const event = {
      id: "evt_test",
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_test",
          amount_received: 500,
          currency: "jpy",
          metadata: { tip_id: tip.id, user_id: fan.id },
        },
      },
    };
    const payload = JSON.stringify(event);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/webhooks/stripe",
          headers: {
            "content-type": "application/json",
            "stripe-signature": "fake",
          },
          payload,
        })
      ).statusCode,
      400,
    );
    const signature = f.external.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: f.config.stripeWebhook,
    });
    for (let repeat = 0; repeat < 2; repeat++)
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/webhooks/stripe",
            headers: {
              "content-type": "application/json",
              "stripe-signature": signature,
            },
            payload,
          })
        ).statusCode,
        200,
      );
    assert.equal((await get(f.db, "tips", tip.id)).paymentStatus, "paid");
    assert.equal(
      (await f.db.all("SELECT * FROM webhook_events WHERE id = 'evt_test'"))
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("notification jobs are atomically claimed and expired subscriptions are removed", async () => {
  const f = await fixture();
  try {
    const fan = await f.user();
    await f.db.transaction(async (q) => {
      await put(
        q,
        "preferences",
        fan.id,
        { settings: { quiet: false } },
        fan.id,
      );
      await put(
        q,
        "push",
        "test-device",
        { id: "test-device", subscription: { endpoint: "test" } },
        fan.id,
      );
      await enqueue(q, "unique-job", "push", {
        userId: fan.id,
        title: "通知",
        body: "配信が始まります",
        path: "/",
        notificationKind: "general",
      });
    });
    await Promise.all([
      processJobs(f.db, f.external),
      processJobs(f.db, f.external),
    ]);
    assert.equal(f.pushed.length, 1);
    assert.equal((await list(f.db, "deliveries", fan.id)).length, 1);
    assert.ok(
      quietDelay(
        { quiet: true, quietFrom: "23:00", quietTo: "08:00" },
        Date.parse("2026-10-20T00:00:00+09:00"),
      ) > 0,
    );
    assert.equal(
      quietDelay(
        { quiet: true, quietFrom: "23:00", quietTo: "08:00" },
        Date.parse("2026-10-20T12:00:00+09:00"),
      ),
      0,
    );
  } finally {
    await f.close();
  }
});
test("voice tokens preserve listener permissions and reject a member's self-promotion", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official"),
      headers = await f.login(fan);
    const roomId = id();
    await f.db.transaction((q) =>
      put(q, "rooms", roomId, {
        id: roomId,
        title: "本物のルーム",
        host: "まんぞう",
        hostId: official.id,
        status: "開催中",
        plan: "Free",
        listeners: 0,
      }),
    );
    const token = await f.app.inject({
      method: "POST",
      url: `/api/voice-rooms/${roomId}/token`,
      headers,
      payload: {},
    });
    assert.equal(token.statusCode, 200, token.body);
    assert.equal(JSON.parse(token.json().token).publish, false);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/voice-rooms/${roomId}/moderate`,
          headers,
          payload: { userId: fan.id, action: "speaker", reason: "自分を登壇" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

test("uploaded content stays private, owned rewards require a session and signed links cannot be shared", async () => {
  const f = await fixture();
  try {
    const admin = await f.user("super"),
      fan = await f.user(),
      other = await f.user();
    const adminHeaders = await f.login(admin, "admin", true),
      headers = await f.login(fan),
      otherHeaders = await f.login(other);
    const image = await uploadFile(f, adminHeaders, "image"),
      reward = await uploadFile(f, adminHeaders, "rewardImage");
    assert.equal((await f.app.inject({ url: image.url })).statusCode, 401);
    assert.equal(
      (await f.app.inject({ url: image.url, headers })).statusCode,
      403,
    );
    await f.db.transaction(async (q) => {
      await put(q, "stories", "story-private-test", {
        id: "story-private-test",
        title: "限定写真",
        image: image.url,
        plan: "Free",
        status: "公開",
        highlight: false,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      await put(
        q,
        "draws",
        "reward-test",
        {
          id: "reward-test",
          title: "獲得写真",
          image: image.url,
          assetId: reward.id,
          at: now(),
        },
        fan.id,
      );
    });
    const visible = await f.app.inject({ url: image.url, headers });
    assert.equal(visible.statusCode, 200, visible.body);
    assert.equal(visible.headers["cache-control"], "private, no-store");
    const dimensions = await sharp(visible.rawPayload).metadata();
    assert.equal(
      dimensions.width! / dimensions.height!,
      2,
      "Artwork proportions must stay intact",
    );
    const signed = await f.app.inject({
      method: "POST",
      url: `${reward.url}/url`,
      headers,
      payload: {},
    });
    assert.equal(signed.statusCode, 200, signed.body);
    assert.equal(
      (await f.app.inject({ url: signed.json().url, headers })).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: signed.json().url, headers: otherHeaders }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${reward.url}/url`,
          headers: otherHeaders,
          payload: {},
        })
      ).statusCode,
      403,
    );
    const expired = new URL(signed.json().url, f.config.origin);
    expired.searchParams.set("expires", "1");
    assert.equal(
      (await f.app.inject({ url: expired.pathname + expired.search, headers }))
        .statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

test("insufficient finite inventory rolls back an entire batch and stock changes preserve distributed counts", async () => {
  const f = await fixture();
  try {
    const admin = await f.user("super"),
      fan = await f.user();
    const adminHeaders = await f.login(admin, "admin", true),
      headers = await f.login(fan);
    const prize = {
      id: "finite-prize",
      title: "限定1個",
      image: "/assets/thumb_1.jpg",
      rarity: "R",
      weight: 100,
      stock: 1,
    };
    await f.db.transaction(async (q) => {
      await put(q, "probabilities", "current", {
        version: "finite-v1",
        items: [prize],
      });
      await put(q, "gacha", "global", {
        title: "在庫確認",
        status: "公開",
        start: "2020-01-01",
        end: "2099-12-31",
      });
    });
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/gacha/draw",
          headers,
          payload: { count: 2 },
        })
      ).statusCode,
      409,
    );
    assert.equal((await get(f.db, "wallet", fan.id)).balance, 5);
    assert.equal((await list(f.db, "draws", fan.id)).length, 0);
    assert.equal(await get(f.db, "inventory", prize.id), undefined);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/gacha/draw",
          headers: { ...headers, "idempotency-key": id() },
          payload: { count: 1 },
        })
      ).statusCode,
      200,
    );
    assert.equal((await get(f.db, "inventory", prize.id)).remaining, 0);
    const edit = (stock: number) =>
      f.app.inject({
        method: "POST",
        url: "/api/commands",
        headers: { ...adminHeaders, "idempotency-key": id() },
        payload: {
          changes: [
            { resource: "probabilities", after: [{ ...prize, stock }] },
          ],
          action: "景品在庫変更",
          reason: "配布済みの数量を保持",
        },
      });
    assert.equal((await edit(3)).statusCode, 200);
    assert.equal((await get(f.db, "inventory", prize.id)).remaining, 2);
    assert.equal((await edit(0)).statusCode, 400);
    await f.db.transaction(async (q) => {
      const free = await get(q, "plans", "free");
      await put(q, "plans", "free", { ...free, features: [] });
    });
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/gacha/draw",
          headers: { ...headers, "idempotency-key": id() },
          payload: { count: 1 },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

test("official creators publish their own files and members cannot create rooms or stories", async () => {
  const f = await fixture();
  try {
    const official = await f.user("official"),
      fan = await f.user();
    const headers = await f.login(official),
      fanHeaders = await f.login(fan);
    const image = await uploadFile(f, headers, "image");
    const story = {
      title: "公式投稿",
      image: image.url,
      mediaType: "image",
      status: "公開",
      plan: "Free",
      highlight: false,
    };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/official/stories",
          headers: fanHeaders,
          payload: story,
        })
      ).statusCode,
      403,
    );
    const posted = await f.app.inject({
      method: "POST",
      url: "/api/official/stories",
      headers,
      payload: story,
    });
    assert.equal(posted.statusCode, 200, posted.body);
    assert.equal(posted.json().authorId, official.id);
    assert.equal(
      (await f.app.inject({ url: image.url, headers: fanHeaders })).statusCode,
      200,
    );
    const room = await f.app.inject({
      method: "POST",
      url: "/api/official/voice-rooms",
      headers,
      payload: {
        title: "公式トーク",
        plan: "Free",
        startsAt: new Date(Date.now() + 3600000).toISOString(),
      },
    });
    assert.equal(room.statusCode, 200, room.body);
    assert.equal(room.json().hostId, official.id);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/voice-rooms/${room.json().id}/start`,
          headers: fanHeaders,
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/voice-rooms/${room.json().id}/start`,
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
  } finally {
    await f.close();
  }
});

test("TOTP matches RFC 6238 reference vectors", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totp(secret, 1), "287082");
  assert.equal(totp(secret, Math.floor(1111111109 / 30)), "081804");
  assert.equal(totp(secret, Math.floor(2000000000 / 30)), "279037");
});

test("scheduled member changes, expiry, audited disclosure and session revocation perform real operations", async () => {
  const f = await fixture();
  try {
    const admin = await f.user("super"),
      support = await f.user("support"),
      fan = await f.user();
    const adminHeaders = await f.login(admin, "admin", true),
      supportHeaders = await f.login(support, "admin", true),
      headers = await f.login(fan);
    await f.db.transaction((q) =>
      put(q, "plans", "vip-test", {
        id: "vip-test",
        name: "VIP",
        price: 0,
        features: ["配信予定"],
        published: true,
      }),
    );
    const url = `/api/admin/members/${fan.id}`;
    const change = await f.app.inject({
      method: "POST",
      url: `${url}/plan`,
      headers: adminHeaders,
      payload: {
        planId: "vip-test",
        applyAt: new Date(Date.now() + 3600000).toISOString(),
        reason: "本人からのプラン変更依頼",
      },
    });
    assert.equal(change.statusCode, 200, change.body);
    assert.equal(
      JSON.parse(
        (await f.db.all("SELECT profile FROM users WHERE id = ?", [fan.id]))[0]
          .profile,
      ).plan,
      "Free",
    );
    await f.db.run("UPDATE jobs SET due_at = ? WHERE kind = 'plan_change'", [
      now(),
    ]);
    await processJobs(f.db, f.external);
    assert.equal(
      JSON.parse(
        (await f.db.all("SELECT profile FROM users WHERE id = ?", [fan.id]))[0]
          .profile,
      ).plan,
      "VIP",
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${url}/plan`,
          headers: supportHeaders,
          payload: { planId: "free", reason: "権限のないプラン変更" },
        })
      ).statusCode,
      403,
    );
    const disclose = await f.app.inject({
      method: "POST",
      url: `${url}/export`,
      headers: supportHeaders,
      payload: { reason: "本人確認済みの開示依頼", verified: true },
    });
    assert.equal(disclose.statusCode, 200, disclose.body);
    assert.equal(disclose.json().account.email, fan.email);
    assert.ok(
      !/password_hash|mfa_secret|csrf|paymentIntent/.test(disclose.body),
    );
    assert.ok(
      (
        await f.db.all(
          "SELECT id FROM audit_logs WHERE action = 'member.export' AND target = ?",
          [fan.id],
        )
      ).length,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${url}/sessions/revoke`,
          headers: supportHeaders,
          payload: { reason: "紛失端末からの不正操作を防止" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/auth/session", headers })).statusCode,
      401,
    );
    const suspend = await f.app.inject({
      method: "POST",
      url: `${url}/status`,
      headers: { ...adminHeaders, "idempotency-key": id() },
      payload: {
        action: "suspend",
        until: new Date(Date.now() + 3600000).toISOString(),
        reason: "期限付き停止のテスト",
      },
    });
    assert.equal(suspend.statusCode, 200, suspend.body);
    await f.db.transaction(async (q) => {
      const suspension = await get(q, "suspensions", fan.id);
      await put(
        q,
        "suspensions",
        fan.id,
        { ...suspension, until: now() },
        fan.id,
      );
    });
    await f.db.run("UPDATE jobs SET due_at = ? WHERE kind = 'restore_user'", [
      now(),
    ]);
    await processJobs(f.db, f.external);
    assert.equal(
      (await f.db.all("SELECT status FROM users WHERE id = ?", [fan.id]))[0]
        .status,
      "active",
    );
    const request = await f.app.inject({
      method: "POST",
      url: `${url}/requests`,
      headers: supportHeaders,
      payload: {
        type: "情報訂正",
        verified: true,
        reason: "本人の訂正依頼を確認",
      },
    });
    assert.equal(request.statusCode, 200, request.body);
    const resolve = await f.app.inject({
      method: "PATCH",
      url: `${url}/requests/${request.json().id}`,
      headers: supportHeaders,
      payload: {
        status: "対応完了",
        name: "訂正済み会員",
        reason: "本人確認に基づいて訂正",
      },
    });
    assert.equal(resolve.statusCode, 200, resolve.body);
    assert.equal(
      JSON.parse(
        (await f.db.all("SELECT profile FROM users WHERE id = ?", [fan.id]))[0]
          .profile,
      ).name,
      "訂正済み会員",
    );
  } finally {
    await f.close();
  }
});

test("annual plan checkout validates the provider price and signed subscription events grant the plan", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      headers = await f.login(fan);
    const plan = {
      id: "annual-test",
      name: "年額テスト",
      price: 500,
      yearPrice: 5000,
      stripePrice: "price_month",
      stripeYearPrice: "price_year",
      published: true,
      features: ["配信予定"],
      trialDays: 7,
    };
    await f.db.transaction(async (q) => {
      const settings = await get(q, "settings", "global");
      await put(q, "settings", "global", { ...settings, billingEnabled: true });
      await put(q, "plans", plan.id, plan);
    });
    f.external.stripe.prices.retrieve = (async () => ({
      id: "price_year",
      active: true,
      currency: "jpy",
      unit_amount: 4999,
      recurring: { interval: "year", interval_count: 1 },
    })) as any;
    const checkout = () =>
      f.app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        headers,
        payload: { kind: "plan", planId: plan.id, period: "year" },
      });
    assert.equal((await checkout()).statusCode, 409);
    f.external.stripe.prices.retrieve = (async () => ({
      id: "price_year",
      active: true,
      currency: "jpy",
      unit_amount: 5000,
      recurring: { interval: "year", interval_count: 1 },
    })) as any;
    const response = await checkout();
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(f.checkouts[0].line_items[0].price, "price_year");
    assert.equal(
      JSON.parse(
        (await f.db.all("SELECT profile FROM users WHERE id = ?", [fan.id]))[0]
          .profile,
      ).plan,
      "Free",
    );
    f.external.stripe.subscriptions.retrieve = (async () => ({
      id: "sub_annual",
      customer: "cus_test",
      metadata: { user_id: fan.id, plan_id: plan.id },
      items: { data: [{ price: { id: "price_year" } }] },
      status: "trialing",
      trial_start: Math.floor(Date.now() / 1000),
      cancel_at_period_end: false,
    })) as any;
    const payload = JSON.stringify({
      id: "evt_annual",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_annual" } },
    });
    const signature = f.external.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: f.config.stripeWebhook,
    });
    const event = await f.app.inject({
      method: "POST",
      url: "/api/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      payload,
    });
    assert.equal(event.statusCode, 200, event.body);
    assert.equal(
      JSON.parse(
        (await f.db.all("SELECT profile FROM users WHERE id = ?", [fan.id]))[0]
          .profile,
      ).plan,
      plan.name,
    );
    assert.equal((await get(f.db, "subscription", fan.id)).trialUsed, true);
  } finally {
    await f.close();
  }
});

test("a refunded request can be retried with the same MFA proof without creating a second provider refund", async () => {
  const f = await fixture();
  try {
    const admin = await f.user("super"),
      fan = await f.user();
    const headers = await f.login(admin, "admin", true),
      tipId = id();
    await f.db.transaction((q) =>
      put(
        q,
        "tips",
        tipId,
        {
          id: tipId,
          userId: fan.id,
          amount: 1000,
          paymentStatus: "paid",
          paymentIntent: "pi_refund_test",
          at: now(),
        },
        fan.id,
      ),
    );
    let calls = 0;
    f.external.stripe.refunds.create = (async () => {
      calls++;
      return { id: "re_test", status: "pending" };
    }) as any;
    const user = (
      await f.db.all("SELECT mfa_secret,mfa_step FROM users WHERE id = ?", [
        admin.id,
      ])
    )[0];
    const code = totp(
      unseal(user.mfa_secret, f.config.key),
      Number(user.mfa_step) + 1,
    );
    const request = () =>
      f.app.inject({
        method: "POST",
        url: "/api/admin/refunds",
        headers,
        payload: {
          tipId,
          amount: 500,
          reason: "本人からの返金依頼を確認",
          code,
        },
      });
    const first = await request(),
      retry = await request();
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.deepEqual(first.json(), retry.json());
    assert.equal(calls, 1);
    assert.equal((await list(f.db, "refunds")).length, 1);
  } finally {
    await f.close();
  }
});

test("a server restart preserves the login, draw result and consumption idempotency", async () => {
  const f = await fixture(true);
  let replacement: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const fan = await f.user(),
      headers = await f.login(fan);
    await f.db.transaction(async (q) => {
      await put(q, "gacha", "global", {
        title: "永続化確認",
        status: "公開",
        start: "2020-01-01",
        end: "2099-12-31",
      });
      await put(q, "probabilities", "current", {
        version: "restart-v1",
        items: [
          {
            title: "再起動後も残る景品",
            image: "/assets/thumb_1.jpg",
            rarity: "R",
            weight: 100,
          },
        ],
      });
    });
    const before = await f.app.inject({
      method: "POST",
      url: "/api/gacha/draw",
      headers,
      payload: { count: 1 },
    });
    assert.equal(before.statusCode, 200, before.body);
    await f.app.close();
    replacement = await createApp({
      config: f.config,
      services: f.external,
      logger: false,
    });
    assert.equal(
      (await replacement.app.inject({ url: "/api/auth/session", headers }))
        .statusCode,
      200,
    );
    const retry = await replacement.app.inject({
      method: "POST",
      url: "/api/gacha/draw",
      headers,
      payload: { count: 1 },
    });
    assert.equal(retry.statusCode, 200, retry.body);
    assert.deepEqual(retry.json(), before.json());
    assert.equal((await get(replacement.db, "wallet", fan.id)).balance, 4);
    assert.equal((await list(replacement.db, "draws", fan.id)).length, 1);
  } finally {
    await replacement?.app.close();
    await f.close();
  }
});

test("daily tickets are granted once per Japanese calendar day and configured draw costs are applied", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      headers = await f.login(fan);
    await f.db.transaction(async (q) => {
      await put(q, "gacha", "global", {
        title: "毎日のガチャ",
        status: "公開",
        start: "2020-01-01",
        end: "2099-12-31",
        dailyTickets: 2,
        ticketCost: 2,
        maxBatch: 5,
      });
      await put(q, "probabilities", "current", {
        version: "daily-v1",
        items: [
          {
            title: "写真",
            image: "/assets/thumb_1.jpg",
            rarity: "R",
            weight: 100,
          },
        ],
      });
    });
    const claim = () =>
      f.app.inject({
        method: "POST",
        url: "/api/gacha/daily-tickets",
        headers,
        payload: {},
      });
    const [first, retry] = await Promise.all([claim(), claim()]);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal((await get(f.db, "wallet", fan.id)).balance, 7);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/gacha/daily-tickets",
          headers: { ...headers, "idempotency-key": id() },
          payload: {},
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/gacha/draw",
          headers: { ...headers, "idempotency-key": id() },
          payload: { count: 2 },
        })
      ).statusCode,
      200,
    );
    assert.equal((await get(f.db, "wallet", fan.id)).balance, 3);
    assert.equal(
      (await list(f.db, "ticketLedger", fan.id)).find(
        (entry) => entry.reason === "抽選",
      ).delta,
      -4,
    );
  } finally {
    await f.close();
  }
});

test("only an acquired transparent frame can be applied and the original avatar is restored", async () => {
  const f = await fixture();
  try {
    const admin = await f.user("super"),
      fan = await f.user(),
      other = await f.user();
    const adminHeaders = await f.login(admin, "admin", true),
      headers = await f.login(fan),
      otherHeaders = await f.login(other);
    const avatar = await uploadFile(f, headers, "avatar");
    await f.db.run("UPDATE users SET profile = ? WHERE id = ?", [
      JSON.stringify({
        name: "フレーム利用者",
        avatar: avatar.url,
        plan: "Free",
      }),
      fan.id,
    ]);
    const bytes = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect x="1" y="1" width="62" height="30" fill="none" stroke="red" stroke-width="2"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    const frame = await uploadFile(f, adminHeaders, "rewardImage", bytes);
    await f.db.transaction((q) =>
      put(
        q,
        "draws",
        "frame-test",
        {
          id: "frame-test",
          title: "透明フレーム",
          kind: "frame",
          assetId: frame.id,
          at: now(),
        },
        fan.id,
      ),
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/me/frame",
          headers: otherHeaders,
          payload: { drawId: "frame-test" },
        })
      ).statusCode,
      403,
    );
    const apply = await f.app.inject({
      method: "POST",
      url: "/api/me/frame",
      headers,
      payload: { drawId: "frame-test" },
    });
    assert.equal(apply.statusCode, 200, apply.body);
    const profile = JSON.parse(
      (await f.db.all("SELECT profile FROM users WHERE id = ?", [fan.id]))[0]
        .profile,
    );
    assert.equal(profile.baseAvatar, avatar.url);
    assert.notEqual(profile.avatar, avatar.url);
    const rendered = await f.app.inject({ url: profile.avatar });
    assert.equal(rendered.statusCode, 200);
    const metadata = await sharp(rendered.rawPayload).metadata();
    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 256);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/me/frame",
          headers: { ...headers, "idempotency-key": id() },
          payload: { drawId: null },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      JSON.parse(
        (await f.db.all("SELECT profile FROM users WHERE id = ?", [fan.id]))[0]
          .profile,
      ).avatar,
      avatar.url,
    );
  } finally {
    await f.close();
  }
});

test("feature quotas cover weekly and monthly periods, targets and idempotent retries", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official"),
      h = await f.login(fan);
    await f.db.transaction(async (q) => {
      const p = await get(q, "plans", "free");
      await put(q, "plans", "free", {
        ...p,
        policies: {
          "dm.send": {
            allowed: true,
            level: "send",
            week: 1,
            month: 2,
            targets: [official.id],
          },
        },
      });
    });
    const conversation = await f.app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: h,
      payload: { peer: official.id },
    });
    const url = `/api/conversations/${conversation.json().id}/messages`;
    const first = await f.app.inject({
      method: "POST",
      url,
      headers: h,
      payload: { text: "週の最初" },
    });
    assert.equal(first.statusCode, 200, first.body);
    const retry = await f.app.inject({
      method: "POST",
      url,
      headers: h,
      payload: { text: "週の最初" },
    });
    assert.deepEqual(retry.json(), first.json());
    const exceeded = await f.app.inject({
      method: "POST",
      url,
      headers: { ...h, "idempotency-key": id() },
      payload: { text: "上限超過" },
    });
    assert.equal(exceeded.statusCode, 429, exceeded.body);
    const counters = await list(f.db, "usage", fan.id);
    assert.equal(counters.length, 2);
    assert.ok(counters.every((c) => c.count === 1));
    const admin = await f.login(await f.user("super"), "admin", true);
    const p = await get(f.db, "plans", "free");
    const invalid = await f.app.inject({
      method: "POST",
      url: "/api/commands",
      headers: admin,
      payload: {
        changes: [
          {
            resource: "plans",
            id: "free",
            after: {
              ...p,
              policies: { "invented.feature": { allowed: true } },
            },
          },
        ],
        action: "機能割当",
        reason: "未知のキーを検証",
      },
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await f.close();
  }
});

test("notification audiences, templates, cancellation and terminal delivery results are real", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      other = await f.user(),
      admin = await f.login(await f.user("super"), "admin", true);
    await f.db.transaction(async (q) => {
      await put(
        q,
        "push",
        "good",
        {
          id: "good",
          subscription: { endpoint: "https://fcm.googleapis.com/good" },
        },
        fan.id,
      );
      await put(q, "activity", fan.id, { userId: fan.id, at: now() }, fan.id);
    });
    const audience = { users: [fan.id, other.id], permission: "subscribed" };
    const preview = await f.app.inject({
      method: "POST",
      url: "/api/admin/notification-audience",
      headers: admin,
      payload: audience,
    });
    assert.equal(preview.json().count, 1);
    const template = await f.app.inject({
      method: "POST",
      url: "/api/admin/notification-templates",
      headers: admin,
      payload: {
        name: "配信案内",
        title: "配信開始",
        body: "お楽しみに",
        path: "/u/U028",
        reason: "定例配信の案内",
      },
    });
    assert.equal(template.statusCode, 200, template.body);
    const created = await f.app.inject({
      method: "POST",
      url: "/api/admin/notifications",
      headers: admin,
      payload: { title: "配信開始", body: "お楽しみに", audience },
    });
    assert.equal(created.statusCode, 200, created.body);
    await processJobs(f.db, f.external);
    const campaigns = await f.app.inject({
      url: "/api/admin/notifications",
      headers: admin,
    });
    const result = campaigns
      .json()
      .find((r: any) => r.id === created.json().id);
    assert.equal(result.status, "完了");
    assert.equal(result.count, 1);
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.ok((await get(f.db, "push", "good"))?.lastSuccessAt);
    const scheduled = await f.app.inject({
      method: "POST",
      url: "/api/admin/notifications",
      headers: { ...admin, "idempotency-key": id() },
      payload: {
        title: "予約",
        body: "取り消す",
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
    const cancel = await f.app.inject({
      method: "POST",
      url: `/api/admin/notifications/${scheduled.json().id}/cancel`,
      headers: admin,
      payload: { reason: "公開時期を変更するため" },
    });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal(
      (await get(f.db, "campaigns", scheduled.json().id))?.status,
      "取消",
    );
  } finally {
    await f.close();
  }
});

test("retention deletes expired content and orphan files but holds report evidence and owned rewards", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official"),
      h = await f.login(fan);
    const orphan = await uploadFile(f, h, "avatar"),
      held = await uploadFile(f, h, "avatar");
    const old = new Date(Date.now() - 400 * 86400000).toISOString();
    await f.db.transaction(async (q) => {
      for (const file of [orphan, held]) {
        const media = await get(q, "media", file.id);
        await put(q, "media", file.id, { ...media, at: old }, fan.id);
      }
      await put(
        q,
        "messages",
        "expired",
        {
          id: "expired",
          sender: fan.id,
          conversationId: "conversation",
          at: old,
        },
        "conversation",
      );
      await put(
        q,
        "messages",
        "evidence",
        { id: "evidence", sender: fan.id, mediaId: held.id, at: old },
        "conversation",
      );
      await put(q, "reports", "report", {
        id: "report",
        target: "evidence",
        status: "未対応",
        evidence: { mediaId: held.id },
      });
      await put(q, "retention", "policy", {
        enabled: true,
        dmDays: 30,
        storyDays: 7,
        orphanDays: 7,
        reportHoldDays: 365,
      });
    });
    const preview = await retentionPreview(f.db);
    assert.deepEqual(preview.entities, [
      { resource: "messages", id: "expired" },
    ]);
    assert.ok(preview.files.some((f) => f.id === orphan.id));
    assert.ok(!preview.files.some((f) => f.id === held.id));
    await runRetention(f.db, f.config, "test", "保存方針の検証", true);
    assert.equal(await get(f.db, "messages", "expired"), undefined);
    assert.ok(await get(f.db, "messages", "evidence"));
    await assert.rejects(readFile(join(f.config.files, orphan.id)), {
      code: "ENOENT",
    });
    assert.ok((await readFile(join(f.config.files, held.id))).length);
  } finally {
    await f.close();
  }
});

test("calendar timezones reject nonexistent DST times and scheduled publication respects UTC", async () => {
  assert.equal(
    wallTimeToISO("2026-10-20", "20:00", "Asia/Tokyo"),
    "2026-10-20T11:00:00.000Z",
  );
  assert.equal(
    wallTimeToISO("2026-07-01", "20:00", "America/New_York"),
    "2026-07-02T00:00:00.000Z",
  );
  assert.throws(() => wallTimeToISO("2026-03-08", "02:30", "America/New_York"));
  const f = await fixture();
  try {
    const h = await f.login(await f.user("super"), "admin", true),
      fan = await f.login(await f.user());
    const schedule = {
      id: id(),
      title: "世界配信",
      date: "2026-07-01",
      time: "20:00",
      timezone: "America/New_York",
      host: "まんぞう",
      status: "予約",
      publishAt: new Date(Date.now() - 1000).toISOString(),
      image: "/assets/thumb_1.jpg",
      url: "https://youtube.com/",
      description: "世界の時刻",
      plan: "Free",
    };
    const create = await f.app.inject({
      method: "POST",
      url: "/api/commands",
      headers: h,
      payload: {
        changes: [{ resource: "schedules", id: schedule.id, after: schedule }],
        action: "配信予定作成",
        reason: "時刻の検証",
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const state = await f.app.inject({ url: "/api/state", headers: fan });
    assert.equal(
      state.json().state.schedules[0].startsAt,
      "2026-07-02T00:00:00.000Z",
    );
  } finally {
    await f.close();
  }
});

test("scheduled odds activate once and concurrent campaigns retain their fixed probability version", async () => {
  const f = await fixture();
  try {
    const admin = await f.login(await f.user("super"), "admin", true),
      fan = await f.login(await f.user());
    const prize = {
      id: id(),
      title: "初版",
      rarity: "N",
      weight: 100,
      image: "/assets/thumb_1.jpg",
    };
    const create = await f.app.inject({
      method: "POST",
      url: "/api/admin/gacha/versions",
      headers: admin,
      payload: {
        items: [prize],
        effectiveAt: new Date(Date.now() - 1000).toISOString(),
        reason: "初版を正式に公開",
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const version = create.json().id;
    const campaign = await f.app.inject({
      method: "POST",
      url: "/api/admin/gacha/campaigns",
      headers: admin,
      payload: {
        campaign: {
          title: "記念祭",
          status: "公開",
          start: "2026-01-01",
          end: "2099-12-31",
          oddsVersion: version,
          ticketCost: 1,
          maxBatch: 1,
          maxPerUser: 3,
          dailyTickets: 2,
        },
        reason: "期間限定の記念祭",
      },
    });
    assert.equal(campaign.statusCode, 200, campaign.body);
    const newer = await f.app.inject({
      method: "POST",
      url: "/api/admin/gacha/versions",
      headers: admin,
      payload: {
        items: [{ ...prize, id: id(), title: "新版" }],
        effectiveAt: new Date(Date.now() + 60000).toISOString(),
        reason: "次回の景品を予約",
      },
    });
    await f.db.transaction(async (q) => {
      const v = await get(q, "oddsSchedules", newer.json().id);
      await put(q, "oddsSchedules", v.id, {
        ...v,
        effectiveAt: new Date(Date.now() - 1000).toISOString(),
      });
      await activateDueOdds(q);
    });
    const state = await f.app.inject({
      url: `/api/state?campaign=${campaign.json().id}`,
      headers: fan,
    });
    assert.equal(state.json().state.probabilities[0].title, "初版");
    const draw = await f.app.inject({
      method: "POST",
      url: "/api/gacha/draw",
      headers: fan,
      payload: { count: 1, campaignId: campaign.json().id },
    });
    assert.equal(draw.statusCode, 200, draw.body);
    assert.equal(draw.json().results[0].title, "初版");
    assert.equal(draw.json().results[0].version, version);
  } finally {
    await f.close();
  }
});

test("branded email escapes content, keeps logo proportions and never embeds an external logo URL", () => {
  const html = brandedEmail(
    { name: "マン組", emailLogo: "/api/media/a1-b2", accent: "#ffd45c" },
    "確認<script>",
    "こちら\nhttps://example.test/verify?token=abc&x=1",
    "https://app.example.test",
  );
  assert.ok(html.includes("height:auto"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("token=abc&amp;x=1"));
  assert.ok(!html.includes("<script>"));
  assert.ok(
    !brandedEmail(
      { emailLogo: "https://outside.test/logo.png" },
      "確認",
      "本文",
      "https://app.example.test",
    ).includes("outside.test"),
  );
});

test("encrypted backup restores database and files into an empty target and rejects tampering without partial data", async () => {
  const f = await fixture(),
    target = new Database({ database: "", sqlite: ":memory:" }),
    rejected = new Database({ database: "", sqlite: ":memory:" });
  try {
    const fan = await f.user(),
      headers = await f.login(fan),
      picture = await uploadFile(f, headers, "avatar");
    await f.db.transaction(async (q) => {
      const settings = await get(q, "settings", "global");
      await put(q, "settings", "global", { ...settings, maintenance: true });
    });
    const key = randomBytes(32).toString("base64"),
      path = join(f.config.files, "verification.mgbak");
    const saved = await createBackup(f.db, f.config, key, path);
    assert.equal(saved.files, 1);
    assert.ok(saved.records > 0);
    const encrypted = await readFile(path);
    assert.ok(!encrypted.includes(Buffer.from(fan.email)));
    await target.initialize();
    await rejected.initialize();
    const restored = { files: join(f.config.files, "restored") },
      bad = { files: join(f.config.files, "rejected") };
    const result = await restoreBackup(target, restored, key, path);
    assert.equal(result.files, 1);
    assert.equal(
      (await target.all("SELECT email FROM users WHERE id = ?", [fan.id]))[0]
        .email,
      fan.email,
    );
    assert.deepEqual(
      await readFile(join(restored.files, picture.id)),
      await readFile(join(f.config.files, picture.id)),
    );
    await assert.rejects(
      restoreBackup(target, restored, key, path),
      /空の新しい/,
    );
    encrypted[encrypted.length - 1] ^= 1;
    const tampered = join(f.config.files, "tampered.mgbak");
    await writeFile(tampered, encrypted);
    await assert.rejects(restoreBackup(rejected, bad, key, tampered));
    assert.equal(
      (await rejected.all("SELECT COUNT(*) AS count FROM users"))[0].count,
      0,
    );
    await assert.rejects(readFile(join(bad.files, picture.id)), {
      code: "ENOENT",
    });
  } finally {
    await target.close();
    await rejected.close();
    await f.close();
  }
});

test("a slow payment provider does not hold the database lock or lose the pending spending reservation", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official"),
      headers = await f.login(fan);
    await f.db.transaction(async (q) => {
      const settings = await get(q, "settings", "global");
      await put(q, "settings", "global", { ...settings, billingEnabled: true });
      const plan = await get(q, "plans", "free");
      await put(q, "plans", "free", {
        ...plan,
        features: [...plan.features, "投げ銭"],
      });
    });
    let started!: () => void, release!: () => void;
    const pending = new Promise<void>((r) => (release = r)),
      entered = new Promise<void>((r) => (started = r));
    const original = f.external.stripe.checkout.sessions.create;
    f.external.stripe.checkout.sessions.create = (async (...args: any[]) => {
      started();
      await pending;
      return original.apply(f.external.stripe.checkout.sessions, args as any);
    }) as any;
    const checkout = f.app.inject({
      method: "POST",
      url: "/api/billing/checkout",
      headers,
      payload: {
        kind: "tip",
        amount: 1000,
        recipient: official.id,
        message: "応援",
      },
    });
    const running = checkout.then((r) => r);
    await entered;
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Database lock held during provider I/O")),
        3000,
      ).unref(),
    );
    try {
      const state = await Promise.race([
        f.app.inject({ url: "/api/state", headers }),
        deadline,
      ]);
      assert.equal(state.statusCode, 200);
      assert.equal(
        (await list(f.db, "tips", fan.id))[0].paymentStatus,
        "pending",
      );
    } finally {
      release();
    }
    assert.equal((await running).statusCode, 200);
  } finally {
    await f.close();
  }
});
test("signed charge refunds update fee-aware reports and revenue access remains role restricted", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official"),
      admin = await f.login(await f.user("super"), "admin", true);
    const tipId = id();
    await f.db.transaction((q) =>
      put(
        q,
        "tips",
        tipId,
        {
          id: tipId,
          userId: fan.id,
          recipient: official.id,
          at: now(),
          amount: 5000,
          paymentIntent: "pi_report",
          paymentStatus: "paid",
          status: "完了",
        },
        fan.id,
      ),
    );
    const payload = JSON.stringify({
      id: "evt_report_refund",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_report",
          payment_intent: "pi_report",
          currency: "jpy",
          amount: 5000,
          amount_refunded: 1000,
          refunded: false,
          balance_transaction: { id: "txn_report", fee: 180 },
        },
      },
    });
    const signature = f.external.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: f.config.stripeWebhook,
    });
    const webhook = await f.app.inject({
      method: "POST",
      url: "/api/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      payload,
    });
    assert.equal(webhook.statusCode, 200, webhook.body);
    const report = await f.app.inject({
      url: "/api/admin/revenue",
      headers: admin,
    });
    assert.deepEqual(report.json().total, {
      count: 1,
      gross: 5000,
      refunded: 1000,
      fees: 180,
      feePending: 0,
      net: 3820,
    });
    assert.equal((await get(f.db, "tips", tipId))?.status, "一部返金");
    const memberHeaders = await f.login(fan);
    assert.equal(
      (
        await f.app.inject({
          url: "/api/admin/revenue",
          headers: memberHeaders,
        })
      ).statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});

test("authentication email templates are validated and applied to the real queued mail", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      admin = await f.login(await f.user("super"), "admin", true);
    const saved = await f.app.inject({
      method: "POST",
      url: "/api/admin/email-templates",
      headers: admin,
      payload: {
        template: {
          purpose: "reset",
          subject: "{{app}}の再設定",
          text: "{{name}}さん\n{{url}}",
        },
        reason: "ブランド文面の適用",
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const invalid = await f.app.inject({
      method: "POST",
      url: "/api/admin/email-templates",
      headers: admin,
      payload: {
        template: { purpose: "reset", subject: "確認", text: "リンクがない" },
        reason: "入力検証の確認",
      },
    });
    assert.equal(invalid.statusCode, 400);
    const requested = await f.app.inject({
      method: "POST",
      url: "/api/auth/password/request",
      headers: { origin: f.config.origin, "x-mangumi-request": "1" },
      payload: { email: fan.email },
    });
    assert.equal(requested.statusCode, 200, requested.body);
    await processJobs(f.db, f.external);
    assert.equal(f.sent[0].subject, "まんぞうラブの再設定");
    assert.ok(f.sent[0].text.includes("/u/U013?token="));
    assert.ok(
      f.sent[0].html.includes("height:auto") ||
        f.sent[0].html.includes("まんぞうラブ"),
    );
    const spec = await f.app.inject({ url: "/api/openapi.json" });
    assert.ok(
      spec.json().paths["/api/billing/checkout"].post.requestBody.content[
        "application/json"
      ].schema.oneOf,
    );
  } finally {
    await f.close();
  }
});

test("hiding a paid plan from new applicants preserves its existing member rights and quotas", async () => {
  const f = await fixture();
  try {
    const fan = await f.user(),
      official = await f.user("official");
    await f.db.transaction(async (q) => {
      await put(q, "plans", "gold", {
        id: "gold",
        name: "Gold",
        price: 1000,
        published: false,
        features: ["公式DM"],
        policies: { "dm.send": { allowed: true, level: "send", week: 1 } },
      });
      const user = (
        await q.all("SELECT profile FROM users WHERE id = ?", [fan.id])
      )[0];
      await q.run("UPDATE users SET profile = ? WHERE id = ?", [
        JSON.stringify({ ...JSON.parse(user.profile), plan: "Gold" }),
        fan.id,
      ]);
    });
    const headers = await f.login(fan),
      state = await f.app.inject({ url: "/api/state", headers });
    assert.equal(state.json().state.entitlements["dm.send"], true);
    assert.ok(state.json().state.plans.some((p: any) => p.name === "Gold"));
    const conversation = await f.app.inject({
      method: "POST",
      url: "/api/conversations",
      headers,
      payload: { peer: official.id },
    });
    assert.equal(conversation.statusCode, 200, conversation.body);
    const url = `/api/conversations/${conversation.json().id}/messages`;
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url,
          headers,
          payload: { text: "既存会員の権限" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url,
          headers: { ...headers, "idempotency-key": id() },
          payload: { text: "回数上限は維持" },
        })
      ).statusCode,
      429,
    );
  } finally {
    await f.close();
  }
});
