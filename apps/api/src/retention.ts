import { z } from "zod";
import { unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { FastifyInstance } from "fastify";
import { get, list, put, remove, type Database, type Query } from "./db.ts";
import { audit, fail, id, now } from "./security.ts";
import { identity, permit } from "./auth.ts";
import type { Config } from "./config.ts";

export const retentionSchema = z
  .object({
    enabled: z.boolean(),
    dmDays: z.number().int().min(1).max(3650),
    storyDays: z.number().int().min(1).max(3650),
    orphanDays: z.number().int().min(1).max(365),
    reportHoldDays: z.number().int().min(1).max(3650),
  })
  .strict();
const defaults = {
  enabled: false,
  dmDays: 365,
  storyDays: 30,
  orphanDays: 7,
  reportHoldDays: 365,
};
export async function retentionPreview(q: Query, timestamp = Date.now()) {
  const policy = (await get(q, "retention", "policy")) ?? defaults;
  const cutoff = (days: number) =>
    new Date(timestamp - days * 86400000).toISOString();
  const reports = (await list(q, "reports")).filter(
    (r) =>
      !["対応済み", "却下"].includes(r.status) ||
      !r.resolvedAt ||
      r.resolvedAt > cutoff(policy.reportHoldDays) ||
      r.holdUntil > now(),
  );
  const holds = JSON.stringify(reports);
  const entities: { resource: string; id: string }[] = [];
  for (const message of await list(q, "messages")) {
    const expired = message.expiresAt
      ? message.expiresAt < new Date(timestamp).toISOString()
      : message.at < cutoff(policy.dmDays);
    if (
      expired &&
      !holds.includes(message.id) &&
      (!message.mediaId || !holds.includes(message.mediaId))
    )
      entities.push({ resource: "messages", id: message.id });
  }
  for (const story of await list(q, "stories"))
    if (
      !story.highlight &&
      story.expiresAt &&
      story.expiresAt < cutoff(policy.storyDays) &&
      !holds.includes(story.id)
    )
      entities.push({ resource: "stories", id: story.id });
  const removed = new Set(entities.map((r) => `${r.resource}:${r.id}`));
  const references =
    (
      await q.all(
        "SELECT resource, id, body FROM entities WHERE resource NOT IN ('media', 'retentionFiles', 'retentionRuns', 'usage')",
      )
    )
      .filter((r) => !removed.has(`${r.resource}:${r.id}`))
      .map((r) => r.body)
      .join("\n") +
    (await q.all("SELECT profile FROM users")).map((r) => r.profile).join("\n");
  const files = (await list(q, "media")).filter(
    (file) =>
      file.at < cutoff(policy.orphanDays) &&
      !references.includes(file.id) &&
      !holds.includes(file.id),
  );
  return {
    policy,
    entities,
    files: files.map((f) => ({ id: f.id, size: f.size, kind: f.kind })),
    heldReports: reports.length,
    bytes: files.reduce((n, f) => n + (f.size ?? 0), 0),
  };
}
export async function runRetention(
  db: Database,
  config: Config,
  actor = "worker",
  reason = "保存期間の自動処理",
  force = false,
) {
  const result = await db.transaction(async (q) => {
    const last = await get(q, "retention", "last");
    const policy = await get(q, "retention", "policy");
    if (
      (!force && last?.at > new Date(Date.now() - 3600000).toISOString()) ||
      !policy?.enabled
    )
      return undefined;
    const preview = await retentionPreview(q);
    for (const row of preview.entities) await remove(q, row.resource, row.id);
    for (const file of preview.files) {
      if (!z.string().uuid().safeParse(file.id).success) continue;
      await remove(q, "media", file.id);
      await put(q, "retentionFiles", file.id, { id: file.id, at: now() });
    }
    await q.run("DELETE FROM sessions WHERE expires_at < ?", [now()]);
    await q.run("DELETE FROM tokens WHERE expires_at < ?", [now()]);
    const summary = {
      id: id(),
      at: now(),
      deletedRecords: preview.entities.length,
      queuedFiles: preview.files.length,
      bytes: preview.bytes,
      heldReports: preview.heldReports,
    };
    await put(q, "retentionRuns", summary.id, summary);
    await put(q, "retention", "last", summary);
    await audit(
      q,
      actor,
      "retention.run",
      summary.id,
      null,
      summary,
      reason,
      "worker",
    );
    return summary;
  });
  // The durable queue survives process failure between the DB commit and unlink.
  for (const file of await list(db, "retentionFiles")) {
    if (!z.string().uuid().safeParse(file.id).success) continue;
    const target = resolve(config.files, file.id);
    if (dirname(target) !== resolve(config.files))
      fail(500, "保存領域を確認できません");
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await db.transaction((q) => remove(q, "retentionFiles", file.id));
  }
  return result ?? { skipped: true };
}
export function registerRetention(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get("/api/admin/retention", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super"]);
    return {
      ...(await retentionPreview(db)),
      runs: (await list(db, "retentionRuns"))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 50),
    };
  });
  app.put("/api/admin/retention", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const body = z
        .object({
          policy: retentionSchema,
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      const previous = await get(q, "retention", "policy");
      await put(q, "retention", "policy", body.policy);
      await audit(
        q,
        actor.user.id,
        "retention.policy",
        "policy",
        previous,
        body.policy,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.post("/api/admin/retention/run", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super"]);
    const { reason, confirmed } = z
      .object({
        reason: z.string().min(5).max(2000),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(request.body);
    return runRetention(db, config, actor.user.id, reason, confirmed);
  });
}
