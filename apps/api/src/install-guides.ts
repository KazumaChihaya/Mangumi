import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, list, put, remove, type Database } from "./db.ts";
import { identity, permit } from "./auth.ts";
import { audit, fail, id } from "./security.ts";
import type { Config } from "./config.ts";
export const installGuideSchema = z
  .object({
    id: z.string().uuid().optional(),
    os: z.enum(["iOS", "Android", "Windows", "macOS", "any"]),
    browser: z.enum(["Safari", "Chrome", "Edge", "Firefox", "any"]),
    minVersion: z.number().int().min(0).max(999).default(0),
    maxVersion: z.number().int().min(0).max(999).default(999),
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(3000),
    image: z.string().regex(/^\/api\/media\/[a-z\d-]+$/i),
    order: z.number().int().min(0).max(1000).default(0),
    published: z.boolean(),
    verifiedAt: z.iso.date(),
  })
  .strict();
export function registerInstallGuides(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get("/api/install-guides", async () =>
    (await list(db, "installGuides"))
      .filter((g) => g.published)
      .sort((a, b) => a.order - b.order),
  );
  app.get("/api/admin/install-guides", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "content"]);
    return list(db, "installGuides");
  });
  app.post("/api/admin/install-guides", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "content"]);
      const { guide, reason } = z
        .object({
          guide: installGuideSchema,
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      if (guide.minVersion > guide.maxVersion)
        fail(400, "対象バージョンを確認してください");
      const mediaId = guide.image.split("/").at(-1)!,
        media = await get(q, "media", mediaId);
      if (!media || media.kind !== "image")
        fail(400, "案内用画像をアップロードしてください");
      if (guide.published)
        await put(q, "media", mediaId, { ...media, public: true }, media.owner);
      const key = guide.id ?? id(),
        previous = await get(q, "installGuides", key);
      await put(q, "installGuides", key, { ...guide, id: key });
      await audit(
        q,
        actor.user.id,
        "install.guide",
        key,
        previous,
        guide,
        reason,
        request.ip,
      );
      return { id: key };
    }),
  );
  app.delete("/api/admin/install-guides/:id", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "content"]);
      const { reason } = z
          .object({ reason: z.string().min(5).max(2000) })
          .strict()
          .parse(request.body),
        key = (request.params as any).id;
      const previous = await get(q, "installGuides", key);
      if (!previous) fail(404, "案内が見つかりません");
      await remove(q, "installGuides", key);
      await audit(
        q,
        actor.user.id,
        "install.guide.delete",
        key,
        previous,
        null,
        reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
}
