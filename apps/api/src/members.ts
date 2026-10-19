import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { get, put, list, type Database, type Query } from "./db.ts";
import {
  identity,
  permit,
  roleNames,
  type User,
  type Identity,
} from "./auth.ts";
import type { Config } from "./config.ts";
import { audit, fail, id, now, once } from "./security.ts";
import { enqueue, notifyUser } from "./jobs.ts";
const reason = z.string().trim().min(5).max(2000);
async function target(q: Query, actor: Identity, userId: string) {
  const user = (
    await q.all<User>("SELECT * FROM users WHERE id = ?", [userId])
  )[0];
  if (!user || (roleNames[user.role] && actor.user.role !== "super"))
    fail(404, "対象の会員が見つかりません");
  return user;
}
function present(user: User) {
  return {
    id: user.id,
    email: user.email,
    profile: JSON.parse(user.profile),
    role: user.role,
    status: user.status,
    verified: !!user.verified,
    joined: user.created_at,
  };
}
async function accountExport(q: Query, user: User) {
  return {
    exportedAt: now(),
    account: present(user),
    preferences: await get(q, "preferences", user.id),
    tickets: await get(q, "wallet", user.id),
    ticketHistory: await list(q, "ticketLedger", user.id),
    collections: await list(q, "draws", user.id),
    tips: (await list(q, "tips", user.id)).map(
      ({ paymentIntent, checkoutId, ...tip }) => tip,
    ),
    support: await list(q, "support", user.id),
  };
}
export function registerMembers(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get("/api/admin/members", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "moderator", "support"]);
    const query = z
      .object({
        query: z.string().max(100).default(""),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .parse(request.query);
    const pattern = `%${query.query.replace(/[%_\\]/g, "")}%`;
    const roleFilter =
      actor.user.role === "super" ? "" : " AND role IN ('member','official')";
    const where = ` WHERE (email LIKE ? OR profile LIKE ?)${roleFilter}`;
    const rows = await db.all<User>(
      `SELECT * FROM users${where} ORDER BY created_at DESC,id LIMIT 50 OFFSET ?`,
      [pattern, pattern, (query.page - 1) * 50],
    );
    return {
      items: rows.map(present),
      page: query.page,
      total: Number(
        (
          await db.all(`SELECT COUNT(*) AS total FROM users${where}`, [
            pattern,
            pattern,
          ])
        )[0].total,
      ),
    };
  });
  app.get("/api/admin/members/:id", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "moderator", "support"]);
    const user = await target(db, actor, (request.params as any).id);
    return {
      ...present(user),
      requests: await list(db, "dataRequests", user.id),
      planChanges: (await list(db, "planChanges", user.id)).filter(
        (item) => item.status === "予約",
      ),
      sessions: await db.all(
        "SELECT id,agent,touched_at,expires_at FROM sessions WHERE user_id = ? AND expires_at > ?",
        [user.id, now()],
      ),
    };
  });
  app.post("/api/admin/members/:id/plan", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const user = await target(q, actor, (request.params as any).id);
      const body = z
        .object({
          planId: z.string().max(100),
          applyAt: z.iso.datetime().optional(),
          reason,
        })
        .strict()
        .parse(request.body);
      const plan = await get(q, "plans", body.planId);
      if (!plan) fail(400, "プランが見つかりません");
      const subscription = await get(q, "subscription", user.id);
      if (["active", "trialing", "past_due"].includes(subscription?.status))
        fail(
          409,
          "有料契約中は契約管理で変更してください。個別の機能権限は一時上書きできます",
        );
      if (body.applyAt && body.applyAt <= now())
        fail(400, "予約日時は未来を指定してください");
      return once(
        q,
        `plan-change:${actor.user.id}`,
        String(request.headers["idempotency-key"] ?? ""),
        body,
        async () => {
          const profile = JSON.parse(user.profile),
            changeId = id();
          for (const previous of (await list(q, "planChanges", user.id)).filter(
            (item) => item.status === "予約",
          ))
            await put(
              q,
              "planChanges",
              previous.id,
              { ...previous, status: "取消" },
              user.id,
            );
          await put(
            q,
            "planChanges",
            changeId,
            {
              id: changeId,
              planId: plan.id,
              previousPlan: profile.plan,
              status: body.applyAt ? "予約" : "適用済み",
              applyAt: body.applyAt ?? now(),
              actorId: actor.user.id,
              reason: body.reason,
            },
            user.id,
          );
          if (body.applyAt)
            await enqueue(
              q,
              `plan-change:${changeId}`,
              "plan_change",
              { changeId, userId: user.id },
              body.applyAt,
            );
          else
            await q.run("UPDATE users SET profile = ? WHERE id = ?", [
              JSON.stringify({ ...profile, plan: plan.name }),
              user.id,
            ]);
          await audit(
            q,
            actor.user.id,
            "member.plan.change",
            user.id,
            { plan: profile.plan },
            { plan: plan.name, applyAt: body.applyAt },
            body.reason,
            request.ip,
          );
          return { ok: true };
        },
      );
    }),
  );
  app.post("/api/admin/members/:id/status", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "moderator"]);
      const user = await target(q, actor, (request.params as any).id);
      const body = z
        .object({
          action: z.enum(["warn", "suspend", "restore"]),
          until: z.iso.datetime().optional(),
          reason,
        })
        .strict()
        .parse(request.body);
      if (body.action === "suspend" && user.id === actor.user.id)
        fail(400, "自分自身を停止できません");
      if (user.status === "closed")
        fail(409, "退会済みのアカウントは復元できません");
      if (body.until && body.until <= now())
        fail(400, "停止期限は未来を指定してください");
      const version = id();
      if (body.action === "warn")
        await notifyUser(
          q,
          user.id,
          `warning:${version}`,
          "運営からのご案内",
          body.reason,
          "/support",
          "security",
        );
      else {
        await q.run("UPDATE users SET status = ? WHERE id = ?", [
          body.action === "restore" ? "active" : "suspended",
          user.id,
        ]);
        await put(
          q,
          "suspensions",
          user.id,
          {
            version,
            reason: body.reason,
            until: body.until,
            active: body.action === "suspend",
          },
          user.id,
        );
        if (body.action === "suspend") {
          await q.run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
          await enqueue(q, `suspension:${version}`, "voice_kick_user", {
            userId: user.id,
          });
          if (body.until)
            await enqueue(
              q,
              `restore:${version}`,
              "restore_user",
              { userId: user.id, version },
              body.until,
            );
        }
      }
      await audit(
        q,
        actor.user.id,
        `member.${body.action}`,
        user.id,
        { status: user.status },
        body,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.post("/api/admin/members/:id/sessions/revoke", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "moderator", "support"]);
      const user = await target(q, actor, (request.params as any).id),
        body = z.object({ reason }).strict().parse(request.body);
      await q.run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
      await enqueue(q, id(), "voice_kick_user", { userId: user.id });
      await audit(
        q,
        actor.user.id,
        "member.sessions.revoke",
        user.id,
        null,
        null,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.post("/api/admin/members/:id/requests", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "support"]);
      const user = await target(q, actor, (request.params as any).id);
      const body = z
        .object({
          type: z.enum(["データ開示", "情報訂正", "データ削除", "退会対応"]),
          verified: z.literal(true),
          reason,
        })
        .strict()
        .parse(request.body);
      const entry = {
        ...body,
        id: id(),
        status: "受付",
        at: now(),
        actorId: actor.user.id,
      };
      await put(q, "dataRequests", entry.id, entry, user.id);
      await audit(
        q,
        actor.user.id,
        "member.request",
        user.id,
        null,
        entry,
        body.reason,
        request.ip,
      );
      return entry;
    }),
  );
  app.post("/api/admin/members/:id/export", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "support"]);
      const user = await target(q, actor, (request.params as any).id),
        body = z
          .object({ reason, verified: z.literal(true) })
          .strict()
          .parse(request.body);
      await audit(
        q,
        actor.user.id,
        "member.export",
        user.id,
        null,
        null,
        body.reason,
        request.ip,
      );
      return accountExport(q, user);
    }),
  );
  app.patch("/api/admin/members/:id/requests/:requestId", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "support"]);
      const user = await target(q, actor, (request.params as any).id),
        entry = (await list(q, "dataRequests", user.id)).find(
          (item) => item.id === (request.params as any).requestId,
        );
      if (!entry) fail(404, "依頼が見つかりません");
      const body = z
        .object({
          status: z.enum(["調査中", "対応完了", "却下"]),
          reason,
          name: z.string().trim().min(2).max(30).optional(),
        })
        .strict()
        .parse(request.body);
      if (entry.status === "対応完了") fail(409, "完了済みの依頼です");
      if (body.status === "対応完了" && entry.type === "情報訂正") {
        if (!body.name)
          fail(
            400,
            "訂正後のニックネームを指定してください。メールは本人の確認手続きから変更します",
          );
        await q.run("UPDATE users SET profile = ? WHERE id = ?", [
          JSON.stringify({ ...JSON.parse(user.profile), name: body.name }),
          user.id,
        ]);
      }
      if (
        body.status === "対応完了" &&
        ["データ削除", "退会対応"].includes(entry.type)
      ) {
        if (roleNames[user.role])
          fail(409, "管理者は先にロールを解除してください");
        if (
          ["active", "trialing", "past_due"].includes(
            (await get(q, "subscription", user.id))?.status,
          )
        )
          fail(409, "先に有料契約の解約を確認してください");
        await q.run(
          "UPDATE users SET status = 'closed', email = ?, profile = ? WHERE id = ?",
          [
            `closed-${user.id}@invalid.test`,
            JSON.stringify({
              name: "退会済み",
              plan: "Free",
              avatar: "/assets/avatar.jpg",
              gender: "回答しない",
              publicGender: false,
            }),
            user.id,
          ],
        );
        await q.run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
        await q.run("DELETE FROM tokens WHERE user_id = ?", [user.id]);
        await q.run(
          "DELETE FROM entities WHERE resource IN ('push','preferences','overrides') AND owner_id = ?",
          [user.id],
        );
        await enqueue(q, id(), "voice_kick_user", { userId: user.id });
      }
      const updated = {
        ...entry,
        status: body.status,
        resolution: body.reason,
        resolvedAt: now(),
      };
      await put(q, "dataRequests", entry.id, updated, user.id);
      await audit(
        q,
        actor.user.id,
        "member.request.resolve",
        user.id,
        { requestId: entry.id, status: entry.status },
        updated,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.get("/api/me/export", async (request) => {
    const actor = await identity(db, request, config, "member");
    return accountExport(db, actor.user);
  });
}
