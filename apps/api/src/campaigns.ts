import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, list, put, type Database, type Query } from "./db.ts";
import { identity, permit, type User } from "./auth.ts";
import { audit, fail, id } from "./security.ts";
import type { Config } from "./config.ts";
export const campaignSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    status: z.enum(["下書き", "公開", "停止", "終了"]),
    start: z.iso.date(),
    end: z.iso.date(),
    description: z.string().max(5000).optional(),
    plan: z.string().max(80).default("Free"),
    ticketCost: z.number().int().min(1).max(100).default(1),
    maxBatch: z.number().int().min(1).max(10).default(10),
    dailyTickets: z.number().int().min(0).max(100).default(0),
    maxPerUser: z.number().int().min(1).max(1000000).default(10000),
    oddsVersion: z.string().max(100),
  })
  .strict();
export async function campaignOdds(q: Query, campaign: any) {
  const current = await get(q, "probabilities", "current");
  return !campaign.oddsVersion || current.version === campaign.oddsVersion
    ? current
    : await get(q, "probabilityVersions", campaign.oddsVersion);
}
export async function availableCampaigns(q: Query, user: User) {
  return [
    { ...(await get(q, "gacha", "global")), id: "global" },
    ...(await list(q, "gachaCampaigns")),
  ].filter(
    (c) =>
      c.status === "公開" &&
      (!c.plan ||
        c.plan === "Free" ||
        c.plan === JSON.parse(user.profile).plan),
  );
}
export function registerCampaigns(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get("/api/gacha/campaigns", async (request) => {
    const actor = await identity(db, request, config, "member");
    return availableCampaigns(db, actor.user);
  });
  app.get("/api/admin/gacha/campaigns", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "content"]);
    return list(db, "gachaCampaigns");
  });
  app.post("/api/admin/gacha/campaigns", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "content"]);
      const { campaign, reason } = z
        .object({
          campaign: campaignSchema,
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      if (campaign.end < campaign.start)
        fail(400, "開催期間を確認してください");
      if (!(await campaignOdds(q, campaign)))
        fail(400, "適用済みの確率版を選択してください");
      const key = campaign.id ?? id(),
        previous = await get(q, "gachaCampaigns", key);
      await put(q, "gachaCampaigns", key, { ...campaign, id: key });
      await audit(
        q,
        actor.user.id,
        "gacha.campaign",
        key,
        previous,
        campaign,
        reason,
        request.ip,
      );
      return { id: key };
    }),
  );
}
