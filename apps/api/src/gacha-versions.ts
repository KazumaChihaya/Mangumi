import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, list, put, type Database, type Query } from "./db.ts";
import { applyProbabilities, prizeSchema } from "./domain.ts";
import { identity, permit } from "./auth.ts";
import { audit, fail, id, now } from "./security.ts";
import { enqueue } from "./jobs.ts";
import type { Config } from "./config.ts";
export async function activateOdds(q: Query, versionId: string) {
  const version = await get(q, "oddsSchedules", versionId);
  if (!version || version.status !== "予約" || version.effectiveAt > now())
    return;
  await applyProbabilities(q, version.items, version.id);
  await put(q, "oddsSchedules", version.id, {
    ...version,
    status: "適用済み",
    appliedAt: now(),
  });
  await audit(
    q,
    version.actorId,
    "gacha.odds.activate",
    version.id,
    null,
    { effectiveAt: version.effectiveAt },
    version.reason,
    "worker",
  );
}
export async function activateDueOdds(q: Query) {
  for (const version of (await list(q, "oddsSchedules"))
    .filter((v) => v.status === "予約" && v.effectiveAt <= now())
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt)))
    await activateOdds(q, version.id);
}
export function registerGachaVersions(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get("/api/admin/gacha/versions", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "content"]);
    return {
      current: await get(db, "probabilities", "current"),
      history: await list(db, "probabilityVersions"),
      scheduled: await list(db, "oddsSchedules"),
    };
  });
  app.post("/api/admin/gacha/versions", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "content"]);
      const body = z
        .object({
          items: z.array(prizeSchema).min(1).max(100),
          effectiveAt: z.iso.datetime(),
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      if (
        body.items.reduce((n, p) => n + Math.round(p.weight * 100), 0) !== 10000
      )
        fail(400, "提供割合の合計を100%にしてください");
      for (const prize of body.items)
        if (prize.assetId) {
          const media = await get(q, "media", prize.assetId);
          if (
            !media ||
            media.kind !==
              (prize.kind === "voice" ? "rewardAudio" : "rewardImage")
          )
            fail(400, "景品ファイルを確認してください");
        }
      const key = id();
      await put(q, "oddsSchedules", key, {
        ...body,
        id: key,
        actorId: actor.user.id,
        status: "予約",
        createdAt: now(),
      });
      if (body.effectiveAt <= now()) await activateOdds(q, key);
      else
        await enqueue(
          q,
          `odds:${key}`,
          "odds",
          { versionId: key },
          body.effectiveAt,
        );
      await audit(
        q,
        actor.user.id,
        "gacha.odds.schedule",
        key,
        null,
        body,
        body.reason,
        request.ip,
      );
      return { id: key };
    }),
  );
  app.post("/api/admin/gacha/versions/:id/cancel", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "content"]);
      const version = await get(q, "oddsSchedules", (request.params as any).id),
        body = z
          .object({ reason: z.string().min(5).max(2000) })
          .strict()
          .parse(request.body);
      if (!version || version.status !== "予約")
        fail(409, "予約中の版のみ取り消せます");
      await put(q, "oddsSchedules", version.id, { ...version, status: "取消" });
      await audit(
        q,
        actor.user.id,
        "gacha.odds.cancel",
        version.id,
        version,
        null,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
}
