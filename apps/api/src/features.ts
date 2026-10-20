import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { list, get, put, type Database } from "./db.ts";
import { identity, permit } from "./auth.ts";
import { audit } from "./security.ts";
import type { Config } from "./config.ts";
import { features } from "../../member/src/features.ts";
export const featureDefinitionSchema = z
  .object({
    key: z.enum(Object.keys(features) as [string, ...string[]]),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
  })
  .strict();
export function registerFeatures(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get("/api/admin/plan-counts", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super"]);
    const users = await db.all<any>(
      "SELECT profile FROM users WHERE status <> 'closed'",
    );
    return Object.fromEntries(
      (await list(db, "plans")).map((plan) => [
        plan.id,
        users.filter((user) => JSON.parse(user.profile).plan === plan.name)
          .length,
      ]),
    );
  });
  app.get("/api/features", async () => {
    const saved = await list(db, "featureDefinitions");
    return Object.entries(features).map(([key, name]) => ({
      key,
      name,
      description: "",
      ...saved.find((f) => f.key === key),
    }));
  });
  app.post("/api/admin/features", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const body = z
          .object({
            feature: featureDefinitionSchema,
            reason: z.string().min(5).max(2000),
          })
          .strict()
          .parse(request.body),
        old = await get(q, "featureDefinitions", body.feature.key);
      await put(q, "featureDefinitions", body.feature.key, body.feature);
      await audit(
        q,
        actor.user.id,
        "feature.definition",
        body.feature.key,
        old,
        body.feature,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
}
