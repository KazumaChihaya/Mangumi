import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import type { Database, Query } from "./db.ts";
import { put, get } from "./db.ts";
import type { Config } from "./config.ts";
import {
  audit,
  digest,
  emailSchema,
  fail,
  hashPassword,
  id,
  later,
  now,
  passwordSchema,
  seal,
  secret,
  totpSecret,
  unseal,
  verifyTotp,
  networkAllowed,
} from "./security.ts";

export type User = {
  id: string;
  email: string;
  password_hash: string;
  profile: string;
  role: string;
  status: string;
  verified: number;
  mfa_secret?: string;
  mfa_pending?: string;
  mfa_step: number;
  recovery?: string;
  created_at: string;
};
export type Identity = {
  user: User;
  session: Record<string, any>;
  area: "member" | "admin";
};
const adminRoles = ["super", "content", "moderator", "support", "finance"];
export const roleNames: Record<string, string> = {
  super: "スーパー管理者",
  content: "コンテンツ管理者",
  moderator: "モデレーター",
  support: "サポート担当",
  finance: "経理担当",
};
export function cookieName(config: Config, area: string) {
  return `${config.production ? "__Host-" : ""}mangumi-${area}`;
}
export async function identity(
  q: Query,
  request: FastifyRequest,
  config: Config,
  area: "member" | "admin",
  verified = true,
  mfa = true,
): Promise<Identity> {
  const token = request.cookies[cookieName(config, area)];
  if (!token) fail(401, "ログインしてください", "unauthenticated");
  const session = (
    await q.all(
      "SELECT * FROM sessions WHERE id = ? AND area = ? AND expires_at > ?",
      [digest(token), area, now()],
    )
  )[0];
  if (!session)
    fail(401, "セッションの有効期限が切れました", "unauthenticated");
  const user = (
    await q.all<User>("SELECT * FROM users WHERE id = ?", [session.user_id])
  )[0];
  if (!user || user.status !== "active")
    fail(403, "このアカウントは利用できません");
  if (area === "admin") {
    const settings = await get(q, "settings", "global");
    if (!networkAllowed(settings.adminNetworks, request.ip))
      fail(403, "このネットワークから管理画面を利用できません");
    if (
      Date.now() - Date.parse(session.touched_at) >
      (settings.adminSessionMinutes ?? 30) * 60000
    )
      fail(401, "管理セッションの有効期限が切れました");
  }
  if (verified && !user.verified)
    fail(403, "メールアドレスを確認してください", "email_unverified");
  if (
    area === "admin" &&
    (!adminRoles.includes(user.role) || (mfa && !session.mfa))
  )
    fail(403, "管理者の二要素認証が必要です", "mfa_required");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers["x-csrf-token"] !== session.csrf
  )
    fail(403, "ページを再読み込みして操作してください", "csrf");
  if (Date.now() - Date.parse(session.touched_at) > 60000) {
    await q.run("UPDATE sessions SET touched_at = ? WHERE id = ?", [
      now(),
      session.id,
    ]);
    await put(q, "activity", user.id, { userId: user.id, at: now() }, user.id);
  }
  return { user, session, area };
}
export function permit(actor: Identity, roles: string[]) {
  if (
    actor.area !== "admin" ||
    !actor.session.mfa ||
    !roles.includes(actor.user.role)
  )
    fail(403, "この操作を行う権限がありません");
}
export async function createSession(
  q: Query,
  user: User,
  area: "member" | "admin",
  request: FastifyRequest,
  reply: FastifyReply,
  config: Config,
) {
  const token = secret(),
    csrf = secret();
  const settings = await get(q, "settings", "global");
  if (area === "admin" && !networkAllowed(settings.adminNetworks, request.ip))
    fail(403, "このネットワークから管理画面を利用できません");
  const duration =
    area === "admin" ? (settings.adminSessionMinutes ?? 30) * 60 : 7 * 86400;
  const session = {
    id: digest(token),
    user_id: user.id,
    area,
    csrf,
    mfa: 0,
    expires_at: later(duration),
    touched_at: now(),
    agent: String(request.headers["user-agent"] ?? "").slice(0, 500),
    ip: request.ip,
  };
  await q.run(
    "INSERT INTO sessions (id,user_id,area,csrf,mfa,expires_at,touched_at,agent,ip) VALUES (?,?,?,?,?,?,?,?,?)",
    Object.values(session),
  );
  await put(q, "activity", user.id, { userId: user.id, at: now() }, user.id);
  reply.setCookie(cookieName(config, area), token, {
    path: "/",
    httpOnly: true,
    secure: config.production,
    sameSite: "strict",
    maxAge: duration,
  });
  return {
    csrf,
    mfaRequired: area === "admin",
    enrollmentRequired: area === "admin" && !user.mfa_secret,
    verified: !!user.verified,
    onboardingRequired: JSON.parse(user.profile).onboarded === false,
  };
}
export async function mailToken(
  q: Query,
  user: User,
  purpose: string,
  email: string,
  config: Config,
) {
  const value = secret();
  await q.run("DELETE FROM tokens WHERE user_id = ? AND purpose = ?", [
    user.id,
    purpose,
  ]);
  await q.run(
    "INSERT INTO tokens (id,user_id,purpose,payload,expires_at) VALUES (?,?,?,?,?)",
    [
      digest(value),
      user.id,
      purpose,
      JSON.stringify({ email }),
      later(purpose === "reset" ? 1800 : 86400),
    ],
  );
  const url = new URL(
    purpose === "reset" ? "/u/U013" : "/u/U011",
    config.origin,
  );
  url.searchParams.set("token", value);
  url.searchParams.set("purpose", purpose);
  await q.run(
    "INSERT INTO jobs (id,kind,payload,due_at,state,attempts) VALUES (?,?,?,?,?,0)",
    [
      id(),
      "mail",
      JSON.stringify({
        tokenHash: digest(value),
        to: email,
        subject:
          purpose === "reset" ? "パスワードを再設定" : "メールアドレスの確認",
        text: `まんぞうラブの${purpose === "reset" ? "パスワード再設定" : "メール確認"}はこちらです。\n${url.href}\n心当たりがない場合は、このメールを破棄してください。`,
      }),
      now(),
      "pending",
    ],
  );
}
export function registerAuth(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const body = z
        .object({
          email: emailSchema,
          password: passwordSchema,
          name: z.string().trim().min(2).max(30),
          gender: z.enum(["男性", "女性", "その他", "回答しない"]),
          termsVersion: z.string().min(1).max(100),
          avatar: z
            .string()
            .regex(/^\/api\/media\/[a-zA-Z0-9-]+$/)
            .max(500),
        })
        .strict()
        .parse(request.body);
      const password = await hashPassword(body.password);
      await db.transaction(async (q) => {
        if (
          (await q.all("SELECT id FROM users WHERE email = ?", [body.email]))
            .length
        )
          fail(409, "このメールアドレスでは登録できません");
        const settings = await get(q, "settings", "global");
        if (config.production) {
          const brand = await get(q, "brand", "current");
          if (!brand?.terms || !brand?.privacy || !brand?.contact)
            fail(
              503,
              "運営者の利用規約・個人情報方針・お問い合わせ先の公開準備が必要です",
            );
        }
        if (body.termsVersion !== settings.termsVersion)
          fail(409, "最新の利用規約を確認してください");
        const avatarFile = await get(
          q,
          "media",
          body.avatar.split("/").at(-1)!,
        );
        if (!avatarFile || avatarFile.kind !== "avatar")
          fail(400, "プロフィール写真をアップロードしてください");
        if (
          settings?.ngWords
            ?.split(/[,、\n]/)
            .map((word: string) => word.trim())
            .filter(Boolean)
            .some((word: string) => body.name.includes(word))
        )
          fail(400, "別のニックネームを選んでください");
        const profile = {
          name: body.name,
          gender: body.gender,
          publicGender: false,
          avatar: body.avatar,
          plan: "Free",
          onboarded: false,
        };
        if (
          !profile.avatar.startsWith("/assets/") &&
          !profile.avatar.startsWith("/api/media/")
        )
          fail(400, "写真をアップロードしてください");
        const user: User = {
          id: id(),
          email: body.email,
          password_hash: password,
          profile: JSON.stringify(profile),
          role: "member",
          status: "active",
          verified: 0,
          mfa_step: -1,
          created_at: now(),
        };
        if (avatarFile.owner !== "staging")
          fail(400, "プロフィール写真を新しくアップロードしてください");
        await put(
          q,
          "media",
          avatarFile.id,
          { ...avatarFile, owner: user.id },
          user.id,
        );
        await q.run(
          "INSERT INTO users (id,email,password_hash,profile,role,status,verified,created_at) VALUES (?,?,?,?,?,?,?,?)",
          [
            user.id,
            user.email,
            password,
            user.profile,
            user.role,
            user.status,
            0,
            user.created_at,
          ],
        );
        await put(
          q,
          "terms",
          user.id,
          {
            userId: user.id,
            version: body.termsVersion,
            acceptedAt: now(),
            ip: request.ip,
          },
          user.id,
        );
        await put(q, "wallet", user.id, { balance: 0 }, user.id);
        await mailToken(q, user, "verify", user.email, config);
        await audit(
          q,
          user.id,
          "register",
          user.id,
          null,
          { email: user.email, plan: "Free" },
          "会員登録",
          request.ip,
        );
      });
      return reply.code(201).send({ ok: true });
    },
  );
  for (const area of ["member", "admin"] as const) {
    const prefix = area === "admin" ? "/api/admin/auth" : "/api/auth";
    app.post(
      `${prefix}/login`,
      { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
      async (request, reply) => {
        const body = z
          .object({ email: emailSchema, password: z.string().min(1).max(128) })
          .strict()
          .parse(request.body);
        const user = (
          await db.all<User>("SELECT * FROM users WHERE email = ?", [
            body.email,
          ])
        )[0];
        const valid = user
          ? await argon2.verify(user.password_hash, body.password)
          : await argon2.verify(await dummyPassword, body.password);
        if (
          !valid ||
          !user ||
          user.status !== "active" ||
          (area === "admin" && !adminRoles.includes(user.role))
        )
          fail(401, "メールアドレスまたはパスワードをご確認ください");
        return db.transaction((q) =>
          createSession(q, user, area, request, reply, config),
        );
      },
    );
    app.get(`${prefix}/session`, async (request) => {
      const actor = await identity(db, request, config, area, false, false);
      return {
        csrf: actor.session.csrf,
        verified: !!actor.user.verified,
        role: actor.user.role,
        mfa: !!actor.session.mfa,
        enrollmentRequired: !actor.user.mfa_secret,
      };
    });
    app.post(`${prefix}/logout`, async (request, reply) => {
      const actor = await identity(db, request, config, area, false, false);
      await db.transaction((q) =>
        q.run("DELETE FROM sessions WHERE id = ?", [actor.session.id]),
      );
      reply.clearCookie(cookieName(config, area), { path: "/" });
      return { ok: true };
    });
  }
  app.post(
    "/api/auth/resend",
    { config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } },
    async (request) => {
      const { email } = z
        .object({ email: emailSchema })
        .strict()
        .parse(request.body);
      await db.transaction(async (q) => {
        const user = (
          await q.all<User>(
            "SELECT * FROM users WHERE email = ? AND verified = 0 AND status = 'active'",
            [email],
          )
        )[0];
        if (user) await mailToken(q, user, "verify", email, config);
      });
      return { ok: true };
    },
  );
  app.post("/api/auth/verify", async (request) => {
    const { token } = z
      .object({ token: z.string().min(20).max(100) })
      .strict()
      .parse(request.body);
    return db.transaction(async (q) => {
      const row = (
        await q.all(
          "SELECT * FROM tokens WHERE id = ? AND expires_at > ? AND purpose IN ('verify','email')",
          [digest(token), now()],
        )
      )[0];
      if (!row) fail(400, "リンクが無効または期限切れです");
      const { email } = JSON.parse(row.payload);
      if (
        (
          await q.all("SELECT id FROM users WHERE email = ? AND id <> ?", [
            email,
            row.user_id,
          ])
        ).length
      )
        fail(409, "メールアドレスを変更できません");
      await q.run("UPDATE users SET verified = 1, email = ? WHERE id = ?", [
        email,
        row.user_id,
      ]);
      if (
        row.purpose === "verify" &&
        !(await get(q, "welcomeGranted", row.user_id))
      ) {
        const settings = await get(q, "settings", "global");
        const count = settings.welcomeTickets ?? 5;
        const wallet = (await get(q, "wallet", row.user_id)) ?? { balance: 0 };
        wallet.balance += count;
        await put(q, "wallet", row.user_id, wallet, row.user_id);
        await put(q, "welcomeGranted", row.user_id, { at: now() }, row.user_id);
        await put(
          q,
          "ticketLedger",
          id(),
          {
            delta: count,
            balance: wallet.balance,
            reason: "登録特典",
            at: now(),
          },
          row.user_id,
        );
      }
      await q.run(
        "DELETE FROM tokens WHERE user_id = ? AND purpose IN ('verify','email')",
        [row.user_id],
      );
      if (row.purpose === "email")
        await q.run("DELETE FROM sessions WHERE user_id = ?", [row.user_id]);
      return { ok: true };
    });
  });
  app.post(
    "/api/auth/password/request",
    { config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } },
    async (request) => {
      const { email } = z
        .object({ email: emailSchema })
        .strict()
        .parse(request.body);
      await db.transaction(async (q) => {
        const user = (
          await q.all<User>(
            "SELECT * FROM users WHERE email = ? AND status = 'active'",
            [email],
          )
        )[0];
        if (user) await mailToken(q, user, "reset", email, config);
      });
      return { ok: true };
    },
  );
  app.post("/api/auth/password/reset", async (request) => {
    const body = z
      .object({ token: z.string().min(20).max(100), password: passwordSchema })
      .strict()
      .parse(request.body);
    const password = await hashPassword(body.password);
    await db.transaction(async (q) => {
      const row = (
        await q.all(
          "SELECT * FROM tokens WHERE id = ? AND purpose = 'reset' AND expires_at > ?",
          [digest(body.token), now()],
        )
      )[0];
      if (!row) fail(400, "リンクが無効または期限切れです");
      await q.run("UPDATE users SET password_hash = ? WHERE id = ?", [
        password,
        row.user_id,
      ]);
      await q.run(
        "DELETE FROM tokens WHERE user_id = ? AND purpose = 'reset'",
        [row.user_id],
      );
      await q.run("DELETE FROM sessions WHERE user_id = ?", [row.user_id]);
      await audit(
        q,
        row.user_id,
        "password.reset",
        row.user_id,
        null,
        null,
        "パスワード再設定",
        request.ip,
      );
    });
    return { ok: true };
  });
  app.post("/api/me/email", async (request) => {
    const actor = await identity(db, request, config, "member", false);
    const body = z
      .object({ email: emailSchema, password: z.string().max(128) })
      .strict()
      .parse(request.body);
    if (!(await argon2.verify(actor.user.password_hash, body.password)))
      fail(403, "パスワードをご確認ください");
    await db.transaction((q) =>
      mailToken(q, actor.user, "email", body.email, config),
    );
    return { ok: true };
  });
  app.get("/api/me/sessions", async (request) => {
    const actor = await identity(db, request, config, "member");
    return (
      await db.all(
        "SELECT id,agent,touched_at,expires_at FROM sessions WHERE user_id = ? AND area = 'member' AND expires_at > ?",
        [actor.user.id, now()],
      )
    ).map((row) => ({ ...row, current: row.id === actor.session.id }));
  });
  app.post("/api/me/onboarding", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      await q.run("UPDATE users SET profile = ? WHERE id = ?", [
        JSON.stringify({ ...JSON.parse(actor.user.profile), onboarded: true }),
        actor.user.id,
      ]);
      return { ok: true };
    }),
  );
  app.delete("/api/me/sessions/:id", async (request) => {
    const actor = await identity(db, request, config, "member");
    const sessionId = z
      .string()
      .max(100)
      .parse((request.params as any).id);
    await db.transaction((q) =>
      q.run(
        "DELETE FROM sessions WHERE user_id = ?" +
          (sessionId === "all" ? "" : " AND id = ?"),
        sessionId === "all" ? [actor.user.id] : [actor.user.id, sessionId],
      ),
    );
    return { ok: true };
  });
  app.post("/api/me/close", async (request) => {
    const actor = await identity(db, request, config, "member");
    const { password } = z
      .object({ password: z.string().max(128) })
      .strict()
      .parse(request.body);
    if (!(await argon2.verify(actor.user.password_hash, password)))
      fail(403, "パスワードをご確認ください");
    if (
      ["active", "trialing", "past_due"].includes(
        (await get(db, "subscription", actor.user.id))?.status,
      )
    )
      fail(409, "先に有料プランを解約してください");
    await db.transaction(async (q) => {
      await q.run(
        "UPDATE users SET status = 'closed', email = ?, profile = ? WHERE id = ?",
        [
          `closed-${actor.user.id}@invalid.test`,
          JSON.stringify({
            name: "退会済み",
            plan: "Free",
            avatar: "/assets/avatar.jpg",
            gender: "回答しない",
            publicGender: false,
          }),
          actor.user.id,
        ],
      );
      await q.run("DELETE FROM sessions WHERE user_id = ?", [actor.user.id]);
      await q.run(
        "DELETE FROM entities WHERE resource IN ('push','preferences') AND owner_id = ?",
        [actor.user.id],
      );
      await audit(
        q,
        actor.user.id,
        "account.close",
        actor.user.id,
        null,
        null,
        "利用者による退会",
        request.ip,
      );
    });
    return { ok: true };
  });
  app.post("/api/admin/auth/mfa/enroll", async (request) => {
    const actor = await identity(db, request, config, "admin", true, false);
    if (actor.user.mfa_secret) fail(409, "二要素認証は登録済みです");
    const value = totpSecret();
    await db.transaction((q) =>
      q.run("UPDATE users SET mfa_pending = ? WHERE id = ?", [
        seal(value, config.key),
        actor.user.id,
      ]),
    );
    return {
      secret: value,
      uri: `otpauth://totp/${encodeURIComponent(`Mangumi:${actor.user.email}`)}?secret=${value}&issuer=Mangumi&algorithm=SHA1&digits=6&period=30`,
    };
  });
  app.post(
    "/api/admin/auth/mfa/verify",
    { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
    async (request) => {
      const { code } = z
        .object({ code: z.string().min(6).max(100) })
        .strict()
        .parse(request.body);
      return db.transaction(async (q) => {
        const actor = await identity(q, request, config, "admin", true, false);
        const encrypted = actor.user.mfa_secret ?? actor.user.mfa_pending;
        if (!encrypted) fail(409, "先に二要素認証を登録してください");
        const step = verifyTotp(
          unseal(encrypted, config.key),
          code,
          Number(actor.user.mfa_step),
        );
        const recovery: string[] = JSON.parse(actor.user.recovery ?? "[]");
        const recoveryIndex = recovery.indexOf(digest(code));
        if (step < 0 && recoveryIndex < 0)
          fail(403, "認証コードをご確認ください");
        let codes: string[] | undefined;
        if (!actor.user.mfa_secret) {
          codes = Array.from({ length: 8 }, () => secret().slice(0, 20));
          await q.run(
            "UPDATE users SET mfa_secret = mfa_pending, mfa_pending = NULL, recovery = ? WHERE id = ?",
            [JSON.stringify(codes.map(digest)), actor.user.id],
          );
        } else if (recoveryIndex >= 0) {
          recovery.splice(recoveryIndex, 1);
          await q.run("UPDATE users SET recovery = ? WHERE id = ?", [
            JSON.stringify(recovery),
            actor.user.id,
          ]);
        }
        if (step >= 0)
          await q.run("UPDATE users SET mfa_step = ? WHERE id = ?", [
            step,
            actor.user.id,
          ]);
        await q.run("UPDATE sessions SET mfa = 1 WHERE id = ?", [
          actor.session.id,
        ]);
        await audit(
          q,
          actor.user.id,
          "admin.mfa.login",
          actor.user.id,
          null,
          null,
          "二要素認証",
          request.ip,
        );
        return { ok: true, recoveryCodes: codes };
      });
    },
  );
}
const dummyPassword = hashPassword("dummy-password-never-used-2026");
