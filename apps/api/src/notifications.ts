import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, list, put, remove, type Database, type Query } from "./db.ts";
import { identity, permit, type User } from "./auth.ts";
import { audit, digest, fail, id, now, once } from "./security.ts";
import { enqueue, notifyUser } from "./jobs.ts";
import type { Config } from "./config.ts";

export const audienceSchema = z
  .object({
    plans: z.array(z.string().max(80)).max(100).optional(),
    users: z.array(z.string().max(100)).max(500).optional(),
    genders: z
      .array(z.enum(["男性", "女性", "その他", "回答しない"]))
      .max(4)
      .optional(),
    permission: z.enum(["any", "subscribed", "unsubscribed"]).default("any"),
    activeSince: z.iso.datetime().optional(),
    inactiveSince: z.iso.datetime().optional(),
  })
  .strict();
export const notificationSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(500),
    path: z
      .string()
      .max(300)
      .regex(/^\/(?!\/)[^\\]*$/)
      .default("/"),
    plan: z.string().max(80).default("Free"),
    audience: audienceSchema.optional(),
    scheduledAt: z.iso.datetime().optional(),
  })
  .strict();
export async function selectAudience(
  q: Query,
  input: z.infer<typeof audienceSchema>,
) {
  const subscribed = new Set(
    (await q.all("SELECT owner_id FROM entities WHERE resource = 'push'")).map(
      (r) => r.owner_id,
    ),
  );
  const activity = new Map(
    (await list(q, "activity")).map((r) => [r.userId, r.at]),
  );
  return (
    await q.all<User>(
      "SELECT * FROM users WHERE status = 'active' AND verified = 1",
    )
  ).filter((user) => {
    const profile = JSON.parse(user.profile);
    const last = activity.get(user.id) ?? user.created_at;
    return (
      (!input.plans?.length || input.plans.includes(profile.plan)) &&
      (!input.users?.length || input.users.includes(user.id)) &&
      (!input.genders?.length || input.genders.includes(profile.gender)) &&
      (input.permission === "any" ||
        subscribed.has(user.id) === (input.permission === "subscribed")) &&
      (!input.activeSince || last >= input.activeSince) &&
      (!input.inactiveSince || last < input.inactiveSince)
    );
  });
}
export async function dispatchCampaign(q: Query, campaignId: string) {
  const campaign = await get(q, "campaigns", campaignId);
  if (!campaign || campaign.status === "取消" || campaign.status !== "予約")
    return;
  const audience = campaign.audience ?? {
    plans: campaign.plan === "Free" ? [] : [campaign.plan],
    permission: "any",
  };
  const users = await selectAudience(q, audience);
  for (let start = 0; start < users.length; start += 25)
    await enqueue(
      q,
      digest(`campaign-chunk:${campaign.id}:${start}`),
      "audience_chunk",
      {
        userIds: users.slice(start, start + 25).map((u) => u.id),
        key: `campaign:${campaign.id}`,
        title: campaign.title,
        body: campaign.body,
        path: campaign.path ?? "/",
        kind: "general",
        context: { campaignId },
      },
    );
  await put(q, "campaigns", campaignId, {
    ...campaign,
    status: users.length ? "配信処理中" : "完了",
    count: users.length,
    startedAt: now(),
  });
}
export async function campaignResults(q: Query, campaign: any) {
  const outcomes = await list(q, "campaignOutcomes", campaign.id);
  const deliveries = (await list(q, "deliveries")).filter(
    (d) => d.campaignId === campaign.id,
  );
  return {
    ...campaign,
    processed: outcomes.length,
    sent: deliveries.filter((d) => d.status === "sent").length,
    failed: deliveries.filter((d) => d.status === "failed").length,
    skipped: outcomes.filter((d) => d.status === "skipped").length,
    clicked: deliveries.filter((d) => !!d.clickedAt).length,
    failures: deliveries
      .filter((d) => d.status === "failed")
      .map((d) => ({ deviceId: d.deviceId, code: d.code, at: d.at })),
  };
}
export function registerNotifications(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  const authorized = async (request: any, q: Query = db) => {
    const actor = await identity(q, request, config, "admin");
    permit(actor, ["super", "content"]);
    return actor;
  };
  app.get("/api/admin/notification-templates", async (request) => {
    await authorized(request);
    return list(db, "notificationTemplates");
  });
  app.post("/api/admin/notification-templates", async (request) =>
    db.transaction(async (q) => {
      const actor = await authorized(request, q);
      const body = z
        .object({
          id: z.string().uuid().optional(),
          name: z.string().trim().min(1).max(100),
          title: z.string().min(1).max(100),
          body: z.string().min(1).max(500),
          path: notificationSchema.shape.path,
          reason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(request.body);
      const key = body.id ?? id(),
        previous = await get(q, "notificationTemplates", key);
      await put(q, "notificationTemplates", key, {
        ...body,
        id: key,
        at: now(),
      });
      await audit(
        q,
        actor.user.id,
        "notification.template",
        key,
        previous,
        body,
        body.reason,
        request.ip,
      );
      return { id: key };
    }),
  );
  app.delete("/api/admin/notification-templates/:id", async (request) =>
    db.transaction(async (q) => {
      const actor = await authorized(request, q);
      const { reason } = z
        .object({ reason: z.string().min(1).max(2000) })
        .parse(request.body);
      const key = (request.params as any).id,
        previous = await get(q, "notificationTemplates", key);
      if (!previous) fail(404, "テンプレートが見つかりません");
      await remove(q, "notificationTemplates", key);
      await audit(
        q,
        actor.user.id,
        "notification.template.delete",
        key,
        previous,
        null,
        reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.post("/api/admin/notification-audience", async (request) => {
    await authorized(request);
    const users = await selectAudience(db, audienceSchema.parse(request.body));
    return {
      count: users.length,
      sample: users
        .slice(0, 20)
        .map((u) => ({ id: u.id, name: JSON.parse(u.profile).name })),
    };
  });
  app.get("/api/admin/notifications", async (request) => {
    await authorized(request);
    return Promise.all(
      (await list(db, "campaigns"))
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .map((c) => campaignResults(db, c)),
    );
  });
  app.post("/api/admin/notifications/test", async (request) =>
    db.transaction(async (q) => {
      const actor = await authorized(request, q),
        body = notificationSchema.parse(request.body);
      const devices = await list(q, "push", actor.user.id);
      if (!devices.length)
        fail(
          409,
          "この管理者アカウントで利用者画面にログインし、通知端末を登録してください",
        );
      await notifyUser(
        q,
        actor.user.id,
        `test:${id()}`,
        body.title,
        body.body,
        body.path,
        "general",
      );
      await audit(
        q,
        actor.user.id,
        "notification.test",
        actor.user.id,
        null,
        body,
        "管理者本人へのテスト送信",
        request.ip,
      );
      return { queued: true, devices: devices.length };
    }),
  );
  app.post("/api/admin/notifications", async (request) =>
    db.transaction(async (q) => {
      const actor = await authorized(request, q),
        body = notificationSchema.parse(request.body);
      return once(
        q,
        `campaign:${actor.user.id}`,
        String(request.headers["idempotency-key"] ?? ""),
        body,
        async () => {
          const key = id();
          await put(q, "campaigns", key, {
            ...body,
            id: key,
            status: "予約",
            count: 0,
            createdAt: now(),
          });
          await enqueue(
            q,
            key,
            "campaign",
            { id: key },
            body.scheduledAt ?? now(),
          );
          await audit(
            q,
            actor.user.id,
            "notification.schedule",
            key,
            null,
            body,
            "運営通知",
            request.ip,
          );
          return { id: key };
        },
      );
    }),
  );
  app.post("/api/admin/notifications/:id/cancel", async (request) =>
    db.transaction(async (q) => {
      const actor = await authorized(request, q),
        key = (request.params as any).id;
      const { reason } = z
          .object({ reason: z.string().min(1).max(2000) })
          .parse(request.body),
        campaign = await get(q, "campaigns", key);
      if (!campaign || campaign.status !== "予約")
        fail(409, "予約中の通知のみ取り消せます");
      await put(q, "campaigns", key, { ...campaign, status: "取消" });
      await q.run(
        "UPDATE jobs SET state = 'cancelled', payload = '{}' WHERE id = ? AND state = 'pending'",
        [key],
      );
      await audit(
        q,
        actor.user.id,
        "notification.cancel",
        key,
        campaign,
        null,
        reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
}
