import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { get, put, remove, type Database, type Query } from "./db.ts";
import { identity, createSession, type User } from "./auth.ts";
import {
  digest,
  fail,
  later,
  now,
  secret,
  seal,
  unseal,
  id,
} from "./security.ts";
import type { Config } from "./config.ts";
import { Expo } from "expo-server-sdk";
const nonce = z.string().min(20).max(100);
export const nativeLinkSchema = z
  .object({ nonce, platform: z.enum(["ios", "android"]) })
  .strict();
export const nativeExchangeSchema = z
  .object({ code: z.string().min(32).max(100), nonce })
  .strict();
export const nativeRefreshSchema = z
  .object({ refreshToken: z.string().min(32).max(100), nonce })
  .strict();
const destination = z
  .string()
  .max(500)
  .regex(/^\/(?!\/)[^\\\r\n]*$/)
  .default("/");
async function userFor(q: Query, userId: string) {
  const user = (
    await q.all<User>("SELECT * FROM users WHERE id = ?", [userId])
  )[0];
  if (!user || user.status !== "active" || !user.verified)
    fail(401, "ログインし直してください");
  return user;
}
async function issue(
  q: Query,
  userId: string,
  platform: string,
  binding: string,
  request: FastifyRequest,
  predecessor?: string,
) {
  const replaced = new Set<string>(predecessor ? [predecessor] : []);
  for (const row of await q.all(
    "SELECT id,body FROM entities WHERE resource = 'nativeAuth' AND owner_id = ?",
    [userId],
  )) {
    if (JSON.parse(row.body).binding === binding) {
      replaced.add(row.id);
      await q.run("DELETE FROM sessions WHERE id = ?", [row.id]);
      await remove(q, "nativeAuth", row.id);
    }
  }
  const accessToken = secret(),
    refreshToken = secret(),
    sessionId = digest(accessToken),
    expiresAt = later(3600);
  await q.run(
    "INSERT INTO sessions (id,user_id,area,csrf,mfa,expires_at,touched_at,agent,ip) VALUES (?,?,'member',?,0,?,?,?,?)",
    [
      sessionId,
      userId,
      secret(),
      later(30 * 86400),
      now(),
      `Mangumi ${platform} · ${String(request.headers["user-agent"] ?? "").slice(0, 200)}`,
      request.ip,
    ],
  );
  await put(
    q,
    "nativeAuth",
    sessionId,
    { sessionId, userId, platform, binding, expiresAt },
    userId,
  );
  for (const row of await q.all(
    "SELECT id,owner_id,body FROM entities WHERE resource = 'participants'",
  )) {
    const participant = JSON.parse(row.body);
    if (participant.userId === userId && replaced.has(participant.sessionId))
      await put(
        q,
        "participants",
        row.id,
        { ...participant, sessionId },
        row.owner_id,
      );
  }
  await put(
    q,
    "nativeRefresh",
    digest(refreshToken),
    { sessionId, userId, platform, binding, expiresAt: later(30 * 86400) },
    userId,
  );
  return { accessToken, refreshToken, expiresAt, userId };
}
export function registerNativeAuth(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get(
    "/.well-known/apple-app-site-association",
    async (_request, reply) => {
      if (!/^[A-Z0-9]{10}$/.test(config.appleTeamId) || !config.appleBundleId)
        return reply.code(404).send({ message: "未設定" });
      return {
        applinks: {
          apps: [],
          details: [
            {
              appID: `${config.appleTeamId}.${config.appleBundleId}`,
              paths: [
                "/u/*",
                "/space*",
                "/gacha*",
                "/calendar*",
                "/dm*",
                "/stories*",
              ],
            },
          ],
        },
      };
    },
  );
  app.get("/.well-known/assetlinks.json", async (_request, reply) => {
    if (!config.googlePackage || !config.androidCertificateHashes.length)
      return reply.code(404).send({ message: "未設定" });
    return [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: config.googlePackage,
          sha256_cert_fingerprints: config.androidCertificateHashes,
        },
      },
    ];
  });
  app.post("/api/native/push", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member"),
        native = await get(q, "nativeAuth", actor.session.id);
      if (!native) fail(403, "アプリ専用の操作です");
      const body = z
        .object({
          token: z.string().max(300),
          label: z.string().min(1).max(100),
        })
        .strict()
        .parse(request.body);
      if (!Expo.isExpoPushToken(body.token))
        fail(400, "通知トークンを確認してください");
      const key = digest(body.token);
      for (const row of await q.all(
        "SELECT id,body FROM entities WHERE resource = 'push' AND owner_id = ?",
        [actor.user.id],
      )) {
        if (
          JSON.parse(row.body).nativeBinding === native.binding &&
          row.id !== key
        )
          await remove(q, "push", row.id);
      }
      const devices = await q.all(
        "SELECT id FROM entities WHERE resource = 'push' AND owner_id = ?",
        [actor.user.id],
      );
      if (devices.length >= 10 && !devices.some((d) => d.id === key))
        fail(409, "通知端末は10台までです");
      await put(
        q,
        "push",
        key,
        {
          id: key,
          userId: actor.user.id,
          subscription: { kind: "expo", token: body.token },
          nativeBinding: native.binding,
          registrationVersion: id(),
          label: body.label,
          platform: native.platform,
          at: now(),
        },
        actor.user.id,
      );
      return { id: key };
    }),
  );
  app.post("/api/native/link", async (request) =>
    db.transaction(async (q) => {
      if (request.headers.authorization)
        fail(403, "アプリ内のログイン画面から操作してください");
      const actor = await identity(q, request, config, "member"),
        body = nativeLinkSchema.parse(request.body),
        code = secret();
      await put(
        q,
        "nativeLinks",
        digest(code),
        {
          userId: actor.user.id,
          parent: actor.session.id,
          platform: body.platform,
          binding: digest(body.nonce),
          expiresAt: later(60),
        },
        actor.user.id,
      );
      return { code };
    }),
  );
  app.post(
    "/api/native/exchange",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) =>
      db.transaction(async (q) => {
        const body = nativeExchangeSchema.parse(request.body),
          link = await get(q, "nativeLinks", digest(body.code));
        if (
          !link ||
          link.expiresAt <= now() ||
          link.binding !== digest(body.nonce)
        )
          fail(401, "アプリのログイン連携が期限切れです");
        if (
          !(
            await q.all(
              "SELECT id FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?",
              [link.parent, link.userId, now()],
            )
          ).length
        )
          fail(401, "ログインし直してください");
        await userFor(q, link.userId);
        await remove(q, "nativeLinks", digest(body.code));
        return issue(q, link.userId, link.platform, link.binding, request);
      }),
  );
  app.post(
    "/api/native/refresh",
    { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
    async (request) =>
      db.transaction(async (q) => {
        const body = nativeRefreshSchema.parse(request.body),
          key = digest(body.refreshToken),
          previous = await get(q, "nativeRefresh", key);
        if (
          !previous ||
          previous.expiresAt <= now() ||
          previous.binding !== digest(body.nonce)
        )
          fail(401, "アプリからログインし直してください");
        await userFor(q, previous.userId);
        if (previous.replay) {
          const result = JSON.parse(unseal(previous.replay, config.key));
          if (
            !(
              await q.all(
                "SELECT id FROM sessions WHERE id = ? AND expires_at > ?",
                [digest(result.accessToken), now()],
              )
            ).length
          )
            fail(401, "端末のログインは解除されています");
          return result;
        }
        if (
          !(
            await q.all(
              "SELECT id FROM sessions WHERE id = ? AND expires_at > ?",
              [previous.sessionId, now()],
            )
          ).length
        )
          fail(401, "端末のログインは解除されています");
        await q.run("DELETE FROM sessions WHERE id = ?", [previous.sessionId]);
        await remove(q, "nativeAuth", previous.sessionId);
        const result = await issue(
          q,
          previous.userId,
          previous.platform,
          previous.binding,
          request,
          previous.sessionId,
        );
        await put(
          q,
          "nativeRefresh",
          key,
          {
            userId: previous.userId,
            binding: previous.binding,
            expiresAt: later(30),
            replay: seal(JSON.stringify(result), config.key),
          },
          previous.userId,
        );
        return result;
      }),
  );
  app.post("/api/native/web-ticket", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      if (!(await get(q, "nativeAuth", actor.session.id)))
        fail(403, "アプリ専用の操作です");
      const body = z
          .object({ path: destination, nonce })
          .strict()
          .parse(request.body),
        ticket = secret();
      await put(
        q,
        "nativeWebTickets",
        digest(ticket),
        {
          userId: actor.user.id,
          parent: actor.session.id,
          path: body.path,
          binding: digest(body.nonce),
          expiresAt: later(30),
        },
        actor.user.id,
      );
      return { ticket };
    }),
  );
  app.post("/api/native/web-login", async (request, reply) => {
    const path = await db.transaction(async (q) => {
      const body = z
          .object({ ticket: z.string().min(32).max(100), nonce })
          .strict()
          .parse(request.body),
        ticket = await get(q, "nativeWebTickets", digest(body.ticket));
      if (
        !ticket ||
        ticket.expiresAt <= now() ||
        ticket.binding !== digest(body.nonce)
      )
        fail(401, "ログイン連携が期限切れです");
      if (
        !(
          await q.all(
            "SELECT id FROM sessions WHERE id = ? AND expires_at > ?",
            [ticket.parent, now()],
          )
        ).length
      )
        fail(401, "端末のログインは解除されています");
      const user = await userFor(q, ticket.userId);
      await remove(q, "nativeWebTickets", digest(body.ticket));
      await createSession(q, user, "member", request, reply, config);
      return ticket.path;
    });
    return reply.code(303).header("Location", path).send();
  });
  app.post("/api/native/logout", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const native = await get(q, "nativeAuth", actor.session.id);
      for (const r of await q.all(
        "SELECT id,body FROM entities WHERE resource = 'push' AND owner_id = ?",
        [actor.user.id],
      ))
        if (native && JSON.parse(r.body).nativeBinding === native.binding)
          await remove(q, "push", r.id);
      await q.run("DELETE FROM sessions WHERE id = ?", [actor.session.id]);
      await remove(q, "nativeAuth", actor.session.id);
      for (const r of await q.all(
        "SELECT id,body FROM entities WHERE resource = 'nativeRefresh' AND owner_id = ?",
        [actor.user.id],
      ))
        if (JSON.parse(r.body).sessionId === actor.session.id)
          await remove(q, "nativeRefresh", r.id);
      return { ok: true };
    }),
  );
}
