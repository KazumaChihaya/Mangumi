import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, list, put, remove, type Database } from "./db.ts";
import { identity, permit } from "./auth.ts";
import { audit, digest, fail, now } from "./security.ts";
import { enqueue } from "./jobs.ts";
import type { Config } from "./config.ts";
import type { Services } from "./services.ts";
export const qualitySchema = z
  .object({
    quality: z.enum(["excellent", "good", "poor", "lost", "unknown"]),
    reconnects: z.number().int().min(0).max(10000),
    rtt: z.number().min(0).max(60000).optional(),
    packetLoss: z.number().min(0).max(1).optional(),
  })
  .strict();
export const alertPolicySchema = z
  .object({
    enabled: z.boolean(),
    recipients: z.array(z.email()).max(5),
    p95Ms: z.number().int().min(100).max(60000),
    errorPercent: z.number().min(1).max(100),
    minimumRequests: z.number().int().min(5).max(500),
    failedJobs: z.number().int().min(1).max(10000),
    cooldownMinutes: z.number().int().min(5).max(1440),
  })
  .strict();
const defaultAlertPolicy = {
  enabled: false,
  recipients: [] as string[],
  p95Ms: 500,
  errorPercent: 10,
  minimumRequests: 20,
  failedJobs: 1,
  cooldownMinutes: 30,
};
export type AlertSample = {
  route: string;
  requests: number;
  errors: number;
  p95Ms: number;
};
export async function checkOperationalAlerts(
  db: Database,
  samples: AlertSample[],
) {
  await db.transaction(async (q) => {
    const policy = (await get(q, "monitoring", "policy")) ?? defaultAlertPolicy;
    if (!policy.enabled || !policy.recipients.length) return;
    const state = await get(q, "monitoring", "state");
    if (state?.checkedAt > new Date(Date.now() - 60000).toISOString()) return;
    const failures = Number(
      (
        await q.all("SELECT COUNT(*) AS count FROM jobs WHERE state = 'failed'")
      )[0].count,
    );
    const reasons: string[] = [];
    if (failures >= policy.failedJobs) reasons.push(`失敗ジョブ ${failures}件`);
    for (const sample of samples.filter(
      (s) => s.requests >= policy.minimumRequests,
    )) {
      if (sample.p95Ms > policy.p95Ms)
        reasons.push(`${sample.route}: p95 ${Math.round(sample.p95Ms)}ms`);
      if ((sample.errors / sample.requests) * 100 >= policy.errorPercent)
        reasons.push(
          `${sample.route}: サーバーエラー ${((sample.errors / sample.requests) * 100).toFixed(1)}%`,
        );
    }
    const active = reasons.length > 0,
      changed = active !== Boolean(state?.active),
      due =
        !state?.notifiedAt ||
        state.notifiedAt <=
          new Date(Date.now() - policy.cooldownMinutes * 60000).toISOString();
    const stamp = now();
    if ((active && (changed || due)) || (!active && state?.active)) {
      const title = active
          ? "Mangumi 運用アラート"
          : "Mangumi 運用アラート回復",
        text = active
          ? reasons.slice(0, 30).join("\n")
          : "監視対象の値が設定した閾値内に戻りました。";
      for (const to of [...new Set<string>(policy.recipients)])
        await enqueue(q, digest(`monitor:${stamp}:${to}`), "mail", {
          to,
          subject: title,
          text,
        });
      await put(q, "monitoringAlerts", stamp, {
        id: stamp,
        at: stamp,
        active,
        reasons,
        recipients: policy.recipients,
      });
      const history = (await list(q, "monitoringAlerts")).sort((a, b) =>
        b.at.localeCompare(a.at),
      );
      for (const old of history.slice(100))
        await remove(q, "monitoringAlerts", old.id);
    }
    await put(q, "monitoring", "state", {
      checkedAt: stamp,
      active,
      reasons,
      notifiedAt:
        (active && (changed || due)) || (!active && state?.active)
          ? stamp
          : state?.notifiedAt,
    });
  });
}
export function registerMonitoring(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  const started = Date.now(),
    measurements = new Map<
      string,
      {
        requests: number;
        errors: number;
        durations: number[];
        window: { at: number; duration: number; failed: boolean }[];
      }
    >();
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url;
    if (!route?.startsWith("/api/")) return;
    const key = `${request.method} ${route}`,
      sample = measurements.get(key) ?? {
        requests: 0,
        errors: 0,
        durations: [],
        window: [],
      };
    sample.requests++;
    if (reply.statusCode >= 500) sample.errors++;
    sample.durations.push(reply.elapsedTime);
    if (sample.durations.length > 500) sample.durations.shift();
    sample.window.push({
      at: Date.now(),
      duration: reply.elapsedTime,
      failed: reply.statusCode >= 500,
    });
    sample.window = sample.window
      .filter((s) => s.at > Date.now() - 300000)
      .slice(-500);
    measurements.set(key, sample);
  });
  app.get("/api/admin/monitoring", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super"]);
    return {
      policy: (await get(db, "monitoring", "policy")) ?? defaultAlertPolicy,
      state: await get(db, "monitoring", "state"),
      history: (await list(db, "monitoringAlerts")).sort((a, b) =>
        b.at.localeCompare(a.at),
      ),
    };
  });
  app.post("/api/admin/monitoring", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const { policy, reason } = z
        .object({
          policy: alertPolicySchema,
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      if (policy.enabled && !policy.recipients.length)
        fail(400, "通知先を指定してください");
      const previous = await get(q, "monitoring", "policy");
      await put(q, "monitoring", "policy", policy);
      await audit(
        q,
        actor.user.id,
        "monitoring.policy",
        "global",
        previous,
        policy,
        reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.get("/api/admin/metrics", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super"]);
    const before = performance.now();
    await db.all("SELECT 1");
    const jobs = await db.all(
      "SELECT state, COUNT(*) AS count FROM jobs GROUP BY state",
    );
    return {
      since: new Date(started).toISOString(),
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
      databaseMs: performance.now() - before,
      memoryBytes: process.memoryUsage().rss,
      jobs,
      routes: [...measurements].map(([route, m]) => {
        const times = [...m.durations].sort((a, b) => a - b);
        return {
          route,
          requests: m.requests,
          errors: m.errors,
          p95Ms: times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] ?? 0,
        };
      }),
      voice: await list(db, "voiceQuality"),
      maintenance: await get(db, "maintenance", "last"),
    };
  });
  app.post(
    "/api/voice-rooms/:id/quality",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (request) =>
      db.transaction(async (q) => {
        const actor = await identity(q, request, config, "member"),
          roomId = (request.params as any).id,
          body = qualitySchema.parse(request.body);
        const participant = await get(
          q,
          "participants",
          `${roomId}_${actor.user.id}`,
        );
        if (!participant) fail(403, "ルームに参加してください");
        await put(
          q,
          "voiceQuality",
          `${roomId}_${actor.user.id}`,
          { ...body, roomId, userId: actor.user.id, at: now() },
          roomId,
        );
        return { ok: true };
      }),
  );
  app.get("/api/admin/audit", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super"]);
    const query = z
      .object({
        query: z.string().max(100).default(""),
        page: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .parse(request.query);
    const like = `%${query.query.replace(/[\\%_]/g, "\\$&")}%`,
      where =
        " WHERE (action LIKE ? OR target LIKE ? OR actor_id LIKE ? OR reason LIKE ?)";
    const params = [like, like, like, like];
    return {
      page: query.page,
      total: Number(
        (
          await db.all(
            "SELECT COUNT(*) AS total FROM audit_logs" + where,
            params,
          )
        )[0].total,
      ),
      items: await db.all(
        "SELECT * FROM audit_logs" +
          where +
          " ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ?",
        [...params, query.page * 50],
      ),
    };
  });
  return () =>
    checkOperationalAlerts(
      db,
      [...measurements].map(([route, m]) => {
        const window = m.window.filter((s) => s.at > Date.now() - 300000),
          times = window.map((s) => s.duration).sort((a, b) => a - b);
        return {
          route,
          requests: window.length,
          errors: window.filter((s) => s.failed).length,
          p95Ms: times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] ?? 0,
        };
      }),
    );
}
export async function maintenanceSweep(db: Database, external: Services) {
  const last = await get(db, "maintenance", "last");
  if (last?.at > new Date(Date.now() - 60000).toISOString()) return;
  for (const room of (await list(db, "rooms")).filter(
    (r) =>
      r.status === "開催中" &&
      r.startedAt &&
      r.maxMinutes &&
      Date.parse(r.startedAt) + r.maxMinutes * 60000 <= Date.now(),
  )) {
    if (!external.roomService) continue;
    await external.roomService.deleteRoom(room.id).catch((e: any) => {
      if (!/not found/i.test(String(e))) throw e;
    });
    await db.transaction(async (q) => {
      await put(q, "rooms", room.id, {
        ...room,
        status: "終了",
        endedAt: now(),
      });
      for (const p of await list(q, "participants", room.id))
        await remove(q, "participants", p.id);
    });
  }
  await db.transaction(async (q) => {
    await q.run("DELETE FROM sessions WHERE expires_at < ?", [now()]);
    await q.run("DELETE FROM tokens WHERE expires_at < ?", [now()]);
    for (const intent of (await list(q, "checkoutIntents")).filter(
      (i) => i.expiresAt < now() && !["expired", "failed"].includes(i.status),
    )) {
      await put(
        q,
        "checkoutIntents",
        intent.id,
        { ...intent, status: "expired", result: undefined, lockedUntil: null },
        intent.userId,
      );
      const tip = intent.tipId && (await get(q, "tips", intent.tipId));
      if (tip?.paymentStatus === "pending")
        await put(
          q,
          "tips",
          tip.id,
          { ...tip, paymentStatus: "cancelled", status: "期限切れ" },
          tip.userId,
        );
    }
    for (const item of await list(q, "voiceQuality"))
      if (item.at < new Date(Date.now() - 86400000).toISOString())
        await remove(q, "voiceQuality", `${item.roomId}_${item.userId}`);
    await put(q, "maintenance", "last", { at: now() });
  });
}
