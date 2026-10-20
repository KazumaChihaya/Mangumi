import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import swagger, { type FastifyDynamicSwaggerOptions } from "@fastify/swagger";
import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { Database, get, put, list, remove } from "./db.ts";
import { config as loadConfig, type Config } from "./config.ts";
import { services, type Services } from "./services.ts";
import {
  identity,
  permit,
  registerAuth,
  roleNames,
  mailToken,
  type User,
} from "./auth.ts";
import {
  blankState,
  draw,
  initializeDomain,
  mutate,
  snapshot,
  prizeSchema,
  entitled,
  schemas,
  mutationSchema,
} from "./domain.ts";
import {
  audit,
  fail,
  hashPassword,
  id,
  now,
  once,
  Problem,
  secret,
} from "./security.ts";
import { registerMedia } from "./media.ts";
import { registerSocial } from "./social.ts";
import { registerBilling } from "./billing.ts";
import {
  enqueue,
  notifyAudience,
  processJobs,
  scheduleReminders,
  scheduleEngagement,
} from "./jobs.ts";
import { registerOperations } from "./operations.ts";
import { registerMembers } from "./members.ts";
import { registerNotifications } from "./notifications.ts";
import { registerRetention, runRetention } from "./retention.ts";
import { registerReports } from "./reports.ts";
import { registerGachaVersions } from "./gacha-versions.ts";
import { registerCampaigns } from "./campaigns.ts";
import { registerInstallGuides } from "./install-guides.ts";
import { registerMonitoring, maintenanceSweep } from "./monitoring.ts";
import { registerNativeAuth } from "./native-auth.ts";
import { registerStores, expireStoreMemberships } from "./stores.ts";
import { apiSpecification } from "./openapi.ts";
import { registerFeatures } from "./features.ts";
import { registerEmailTemplates } from "./email.ts";
import { registerReminders } from "./reminders.ts";
import { registerTipMessages } from "./tip-messages.ts";

export async function createApp(
  options: {
    config?: Config;
    db?: Database;
    services?: Services;
    logger?: boolean;
    rateLimit?: boolean;
  } = {},
) {
  const config = options.config ?? loadConfig();
  const db = options.db ?? new Database(config);
  await db.initialize();
  await db.transaction(initializeDomain);
  const external = options.services ?? services(config);
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger:
      options.logger === false
        ? false
        : {
            level: config.log,
            redact: [
              "req.headers.cookie",
              "req.headers.authorization",
              "req.headers.x-csrf-token",
              "req.body",
            ],
            serializers: {
              req: (request) => ({
                method: request.method,
                url: request.url?.split("?")[0],
                remoteAddress: request.ip,
              }),
            },
          },
    trustProxy: config.production
      ? ["127.0.0.1", "::1", "172.16.0.0/12"]
      : false,
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: config.origin,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-CSRF-Token",
      "X-Mangumi-Request",
      "X-Mangumi-Area",
      "Idempotency-Key",
    ],
  });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    max: options.rateLimit === false && !config.production ? 100000 : 120,
    allowList:
      options.rateLimit === false && !config.production
        ? () => true
        : undefined,
    timeWindow: "1 minute",
  });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Mangumi API", version: "1.0.0" },
      servers: [{ url: config.origin }],
      components: {
        schemas: Object.fromEntries(
          Object.entries({
            ...schemas,
            Prize: prizeSchema,
            Command: mutationSchema,
          }).map(([name, schema]) => [
            name,
            z.toJSONSchema(schema, {
              target: "openapi-3.0",
              unrepresentable: "any",
            }),
          ]),
        ),
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "__Host-mangumi-member",
          },
        },
      },
    } as FastifyDynamicSwaggerOptions["openapi"],
  });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    ["application/json", "application/webhook+json"],
    { parseAs: "buffer" },
    (request, body, done) => {
      if (request.url.startsWith("/api/webhooks/")) return done(null, body);
      try {
        done(null, JSON.parse((body as Buffer).toString("utf8")));
      } catch {
        done(new Problem(400, "JSON形式をご確認ください"));
      }
    },
  );
  app.addHook("onRequest", async (request) => {
    if (
      !request.url.startsWith("/api/") ||
      ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      request.url.startsWith("/api/webhooks/")
    )
      return;
    const nativeTransport =
      !request.headers.origin &&
      request.headers["x-mangumi-request"] === "1" &&
      (/^Bearer [A-Za-z0-9_-]{32,100}$/.test(
        String(request.headers.authorization ?? ""),
      ) ||
        [
          "/api/native/exchange",
          "/api/native/refresh",
          "/api/native/web-login",
        ].includes(request.url.split("?")[0]));
    if (nativeTransport) return;
    if (
      request.headers.origin !== config.origin ||
      request.headers["x-mangumi-request"] !== "1"
    )
      fail(403, "このサイトから操作してください", "origin");
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (
      request.url.startsWith("/api/") &&
      !request.url.startsWith("/api/media/")
    )
      reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((error: any, request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        code: "validation",
        message: error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(" / "),
      });
    const status =
      error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : error instanceof Problem
          ? error.statusCode
          : 500;
    if (status >= 500)
      request.log.error(
        { err: { name: error.name, code: error.code } },
        "request failed",
      );
    reply.code(status).send({
      code: error instanceof Problem ? error.code : "request_failed",
      message:
        status === 500
          ? "処理できませんでした。時間をおいて再度お試しください"
          : error.message,
    });
  });
  const readiness = () => ({
    database: true,
    mail: !!config.smtpUrl && !!config.mailFrom,
    push:
      !!config.vapidPublic && !!config.vapidPrivate && !!config.vapidSubject,
    payments: !!config.stripeKey && !!config.stripeWebhook,
    voice: !!external.roomService,
  });
  app.get("/api/health", async () => {
    await db.all("SELECT 1 AS healthy");
    return { ok: true, time: now() };
  });
  app.get("/api/readiness", async (_request, reply) => {
    const state = readiness();
    if (config.production && !Object.values(state).every(Boolean))
      reply.code(503);
    return state;
  });
  app.get("/api/config", async () => {
    const settings = await get(db, "settings", "global");
    return {
      name: settings.name,
      termsVersion: settings.termsVersion,
      billingEnabled: settings.billingEnabled,
      vapidPublic: config.vapidPublic,
      providers: readiness(),
    };
  });
  app.get("/api/openapi.json", async () => apiSpecification(app.swagger()));
  registerAuth(app, db, config);
  registerNativeAuth(app, db, config);
  registerStores(app, db, config, external);
  registerMedia(app, db, config);
  registerSocial(app, db, config, external);
  registerBilling(app, db, config, external);
  registerOperations(app, db, config);
  registerMembers(app, db, config);
  registerNotifications(app, db, config);
  registerRetention(app, db, config);
  registerReports(app, db, config);
  registerGachaVersions(app, db, config);
  registerCampaigns(app, db, config);
  registerInstallGuides(app, db, config);
  const checkAlerts = registerMonitoring(app, db, config);
  registerFeatures(app, db, config);
  registerEmailTemplates(app, db, config);
  registerReminders(app, db, config);
  registerTipMessages(app, db, config);
  app.get("/api/state", async (request) =>
    db.transaction(async (q) => {
      const area =
        request.headers["x-mangumi-area"] === "admin" ? "admin" : "member";
      let actor;
      try {
        actor = await identity(q, request, config, area, false);
      } catch (error) {
        if (
          !(error instanceof Problem) ||
          ![401, 403].includes(error.statusCode)
        )
          throw error;
      }
      const state = await snapshot(
        q,
        actor,
        z
          .object({ campaign: z.string().max(100).default("global") })
          .parse(request.query).campaign,
      );
      return {
        state,
        area,
        role: actor?.user.role ?? "guest",
        userId: actor?.user.id ?? null,
      };
    }),
  );
  app.post("/api/commands", async (request) =>
    db.transaction(async (q) => {
      const area =
        request.headers["x-mangumi-area"] === "admin" ? "admin" : "member";
      const actor = await identity(q, request, config, area);
      if (
        area === "member" &&
        (await get(q, "settings", "global"))?.maintenance
      )
        fail(503, "ただいまメンテナンス中です");
      await once(
        q,
        `command:${actor.user.id}:${area}`,
        String(request.headers["idempotency-key"] ?? ""),
        request.body,
        () => mutate(q, actor, request.body, request.ip),
      );
      return {
        state: await snapshot(
          q,
          actor,
          z
            .object({ campaign: z.string().max(100).default("global") })
            .parse(request.query).campaign,
        ),
        role: actor.user.role,
        userId: actor.user.id,
      };
    }),
  );
  app.post("/api/gacha/draw", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const { count, campaignId } = z
        .object({
          count: z.number().int().min(1).max(10),
          campaignId: z.string().max(100).default("global"),
        })
        .strict()
        .parse(request.body);
      return draw(
        q,
        actor,
        count,
        String(request.headers["idempotency-key"] ?? ""),
        campaignId,
      );
    }),
  );
  app.post("/api/gacha/daily-tickets", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      await entitled(q, actor.user, "gacha.draw");
      const { campaignId } = z
        .object({ campaignId: z.string().max(100).default("global") })
        .parse(request.body ?? {});
      const campaign = await get(
          q,
          campaignId === "global" ? "gacha" : "gachaCampaigns",
          campaignId,
        ),
        today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      if (
        !campaign ||
        campaign.status !== "公開" ||
        today < campaign.start ||
        today > campaign.end ||
        !campaign.dailyTickets
      )
        fail(409, "現在、毎日の無料チケット配布はありません");
      if (
        campaign.plan &&
        campaign.plan !== "Free" &&
        JSON.parse(actor.user.profile).plan !== campaign.plan
      )
        fail(403, "対象のプランではありません");
      return once(
        q,
        `daily-ticket:${actor.user.id}`,
        String(request.headers["idempotency-key"] ?? ""),
        { day: today, campaignId },
        async () => {
          const claimId = `${actor.user.id}_${campaignId}_${today}`;
          if (await get(q, "dailyClaims", claimId))
            fail(409, "本日の無料チケットは受け取り済みです");
          const wallet = (await get(q, "wallet", actor.user.id)) ?? {
            balance: 0,
          };
          wallet.balance += campaign.dailyTickets;
          await put(q, "wallet", actor.user.id, wallet, actor.user.id);
          await put(
            q,
            "dailyClaims",
            claimId,
            { at: now(), amount: campaign.dailyTickets },
            actor.user.id,
          );
          await put(
            q,
            "ticketLedger",
            id(),
            {
              delta: campaign.dailyTickets,
              balance: wallet.balance,
              reason: "毎日の無料チケット",
              at: now(),
            },
            actor.user.id,
          );
          return { balance: wallet.balance };
        },
      );
    }),
  );
  app.post("/api/admin/gacha/grant", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "content"]);
      const body = z
        .object({
          userId: z.string().max(100),
          tickets: z.number().int().min(0).max(10000).optional(),
          prize: z.string().max(200).optional(),
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      if (
        !(
          await q.all(
            "SELECT id FROM users WHERE id = ? AND status = 'active'",
            [body.userId],
          )
        ).length
      )
        fail(404, "会員が見つかりません");
      return once(
        q,
        `grant:${actor.user.id}`,
        String(request.headers["idempotency-key"] ?? ""),
        body,
        async () => {
          if (body.tickets !== undefined) {
            const wallet = (await get(q, "wallet", body.userId)) ?? {
              balance: 0,
            };
            wallet.balance += body.tickets;
            await put(q, "wallet", body.userId, wallet, body.userId);
            await put(
              q,
              "ticketLedger",
              id(),
              {
                delta: body.tickets,
                reason: body.reason,
                actor: actor.user.id,
                at: now(),
                balance: wallet.balance,
              },
              body.userId,
            );
          }
          if (body.prize) {
            const current = await get(q, "probabilities", "current");
            const prize = current.items.find(
              (item: any) => item.title === body.prize,
            );
            if (!prize) fail(400, "景品を選んでください");
            const item = {
              id: id(),
              ...prize,
              at: now(),
              version: `compensation:${current.version}`,
            };
            delete item.weight;
            await put(q, "draws", item.id, item, body.userId);
          }
          await audit(
            q,
            actor.user.id,
            "gacha.compensation",
            body.userId,
            null,
            body,
            body.reason,
            request.ip,
          );
          return { ok: true };
        },
      );
    }),
  );
  app.post("/api/admin/users", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const body = z
        .object({
          name: z.string().min(2).max(30),
          email: z.email().transform((value) => value.toLowerCase()),
          role: z.enum([
            "super",
            "content",
            "moderator",
            "support",
            "finance",
            "official",
          ]),
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      if (
        (await q.all("SELECT id FROM users WHERE email = ?", [body.email]))
          .length
      )
        fail(409, "登録済みのメールアドレスです");
      const user = {
        id: id(),
        email: body.email,
        profile: JSON.stringify({
          name: body.name,
          avatar: "/assets/avatar.jpg",
          gender: "回答しない",
          publicGender: false,
          plan: "Free",
        }),
        role: body.role,
        status: "active",
        verified: 1,
        mfa_step: -1,
        password_hash: await hashPassword(secret()),
        created_at: now(),
      } as User;
      await q.run(
        "INSERT INTO users (id,email,profile,role,status,verified,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?)",
        [
          user.id,
          user.email,
          user.profile,
          user.role,
          user.status,
          1,
          user.password_hash,
          user.created_at,
        ],
      );
      await mailToken(q, user, "reset", user.email, config);
      await audit(
        q,
        actor.user.id,
        "admin.invite",
        user.id,
        null,
        { email: user.email, role: user.role },
        body.reason,
        request.ip,
      );
      return { id: user.id };
    }),
  );
  app.patch("/api/admin/users/:id/role", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const body = z
        .object({
          role: z.enum([
            "member",
            "official",
            "super",
            "content",
            "moderator",
            "support",
            "finance",
          ]),
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      const userId = (request.params as any).id;
      const target = (
        await q.all<User>("SELECT * FROM users WHERE id = ?", [userId])
      )[0];
      if (!target) fail(404, "会員が見つかりません");
      if (
        target.role === "super" &&
        body.role !== "super" &&
        (
          await q.all(
            "SELECT id FROM users WHERE role = 'super' AND status = 'active'",
          )
        ).length < 2
      )
        fail(409, "最後のスーパー管理者は変更できません");
      await q.run("UPDATE users SET role = ? WHERE id = ?", [
        body.role,
        userId,
      ]);
      await q.run("DELETE FROM sessions WHERE user_id = ?", [userId]);
      await enqueue(q, `role:${userId}:${id()}`, "voice_kick_user", { userId });
      await audit(
        q,
        actor.user.id,
        "admin.role",
        userId,
        { role: target.role },
        body,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.get("/api/admin/operations", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super"]);
    return {
      providers: readiness(),
      jobs: await db.all(
        "SELECT state, COUNT(*) AS count FROM jobs GROUP BY state",
      ),
      storage: "local-volume",
      database: config.database ? "mariadb" : "sqlite",
    };
  });
  app.post("/api/push-subscriptions", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const subscription = z
        .object({
          endpoint: z.url().max(2000),
          keys: z
            .object({
              p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,150}=?$/),
              auth: z.string().regex(/^[A-Za-z0-9_-]{20,50}=?$/),
            })
            .strict(),
          expirationTime: z.number().nullable().optional(),
        })
        .strict()
        .parse(request.body);
      const endpoint = new URL(subscription.endpoint);
      if (
        endpoint.protocol !== "https:" ||
        ![
          "fcm.googleapis.com",
          "updates.push.services.mozilla.com",
          "web.push.apple.com",
        ].includes(endpoint.hostname) ||
        endpoint.port ||
        endpoint.username ||
        endpoint.password
      )
        fail(400, "対応するブラウザのPush購読を登録してください");
      const devices = await list(q, "push", actor.user.id);
      const existing = devices.find(
        (device) => device.subscription.endpoint === subscription.endpoint,
      );
      if (!existing && devices.length >= 10)
        fail(409, "通知端末は10台までです");
      const deviceId = existing?.id ?? id();
      await put(
        q,
        "push",
        deviceId,
        {
          id: deviceId,
          subscription,
          at: now(),
          agent: String(request.headers["user-agent"] ?? "").slice(0, 300),
        },
        actor.user.id,
      );
      return { id: deviceId };
    }),
  );
  app.delete("/api/push-subscriptions/:id", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const devices = await list(q, "push", actor.user.id);
      if (!devices.some((device) => device.id === (request.params as any).id))
        fail(404, "端末が見つかりません");
      await remove(q, "push", (request.params as any).id);
      return { ok: true };
    }),
  );
  app.get("/api/push-subscriptions", async (request) => {
    const actor = await identity(db, request, config, "member");
    return (await list(db, "push", actor.user.id)).map((device) => ({
      id: device.id,
      at: device.at,
      agent: device.agent,
    }));
  });
  app.post("/api/notifications/:id/click", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const delivery = await get(q, "deliveries", (request.params as any).id);
      if (delivery?.userId !== actor.user.id) fail(404, "通知が見つかりません");
      delivery.clickedAt = now();
      await put(q, "deliveries", delivery.id, delivery, actor.user.id);
      return { ok: true };
    }),
  );
  // Serve the production export on the API origin; Pages remains a separate UI preview.
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== "GET" || request.url.startsWith("/api/"))
      return reply.code(404).send({ message: "ページが見つかりません" });
    const pathname = decodeURIComponent(
      new URL(request.url, config.origin).pathname,
    );
    const base = resolve(config.webRoot, "." + pathname);
    if (
      base !== config.webRoot &&
      !base.startsWith(resolve(config.webRoot) + sep)
    )
      return reply.code(403).send();
    for (const path of [base, `${base}.html`, resolve(base, "index.html")]) {
      try {
        if (!(await stat(path)).isFile()) continue;
        const mime: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".jpg": "image/jpeg",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".webp": "image/webp",
          ".woff2": "font/woff2",
        };
        let contents: Buffer | string = await readFile(path);
        if (extname(path) === ".html") {
          const brand = (await get(db, "brand", "current")) ?? {
            name: (await get(db, "settings", "global"))?.name ?? "まんぞうラブ",
            description:
              "マン組の公式ファンアプリ。配信、スペース、DM、ストーリーを楽しめます。",
          };
          if (brand) {
            const escape = (value: string) =>
              value.replace(
                /[&<>"']/g,
                (char) =>
                  ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;",
                  })[char]!,
              );
            contents = contents
              .toString()
              .replace(
                /<title\b[^>]*>[\s\S]*?<\/title>/i,
                `<title>${escape(brand.name)}</title>`,
              )
              .replace(/<meta name="description"[^>]*>/, "");
            contents = contents.replace(
              "</head>",
              `<meta name="description" content="${escape(brand.description)}"><meta property="og:title" content="${escape(brand.name)}"><meta property="og:description" content="${escape(brand.description)}"><meta property="og:url" content="${escape(config.origin)}">${brand.ogp ? `<meta property="og:image" content="${escape(new URL(brand.ogp, config.origin).href)}">` : ""}<link rel="apple-touch-icon" href="/api/brand/icon/192"></head>`,
            );
          }
        }
        return reply
          .header(
            "Content-Type",
            mime[extname(path)] ?? "application/octet-stream",
          )
          .header(
            "Cache-Control",
            /\.html$|sw\.js$|manifest\.json$/.test(path)
              ? "no-cache"
              : "public, max-age=3600",
          )
          .send(contents);
      } catch {}
    }
    return reply.code(404).send("ページが見つかりません");
  });
  let active: Promise<void> | undefined;
  const interval = config.workers
    ? setInterval(() => {
        if (!active)
          active = scheduleReminders(db)
            .then(() => scheduleEngagement(db))
            .then(() => processJobs(db, external))
            .then(() => runRetention(db, config))
            .then(() => checkAlerts())
            .then(() => maintenanceSweep(db, external))
            .then(() => expireStoreMemberships(db))
            .catch((error) =>
              app.log.error(
                { code: error.code ?? "worker_failed" },
                "worker failed",
              ),
            )
            .finally(() => {
              active = undefined;
            });
      }, 5000)
    : undefined;
  interval?.unref();
  app.addHook("onClose", async () => {
    if (interval) clearInterval(interval);
    await active;
    await db.close();
  });
  return { app, db, external, config };
}
