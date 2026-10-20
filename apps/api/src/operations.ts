import type { FastifyInstance } from "fastify";
import { z } from "zod";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { get, list, put, type Database, type Query } from "./db.ts";
import { identity, permit, roleNames, type User } from "./auth.ts";
import { audit, fail, id, now, once } from "./security.ts";
import { enqueue, notifyUser } from "./jobs.ts";
import type { Config } from "./config.ts";

export const brandSchema = z
  .object({
    name: z.string().min(1).max(80),
    short: z.string().min(1).max(20),
    description: z.string().max(300),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    button: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    logoAlt: z.string().max(100).optional(),
    notificationIcon: z
      .string()
      .regex(/^\/api\/media\/[a-zA-Z0-9-]+$/)
      .optional(),
    logo: z
      .string()
      .regex(/^\/api\/media\/[a-zA-Z0-9-]+$/)
      .optional(),
    icon: z
      .string()
      .regex(/^\/api\/media\/[a-zA-Z0-9-]+$/)
      .optional(),
    terms: z.url().startsWith("https://").optional(),
    privacy: z.url().startsWith("https://").optional(),
    commerce: z.url().startsWith("https://").optional(),
    ogp: z
      .string()
      .regex(/^\/api\/media\/[a-zA-Z0-9-]+$/)
      .optional(),
    emailLogo: z
      .string()
      .regex(/^\/api\/media\/[a-zA-Z0-9-]+$/)
      .optional(),
    installGuide: z
      .string()
      .regex(/^\/api\/media\/[a-zA-Z0-9-]+$/)
      .optional(),
    contact: z.string().max(254).optional(),
  })
  .strict();
export async function publishBrand(q: Query, versionId: string) {
  const version = await get(q, "brandVersions", versionId);
  if (!version) fail(404, "ブランドの版が見つかりません");
  const settings = await get(q, "settings", "global");
  for (const key of [
    "icon",
    "logo",
    "ogp",
    "emailLogo",
    "installGuide",
    "notificationIcon",
  ] as const) {
    const mediaId = version.values[key]?.split("/").at(-1);
    const media = mediaId ? await get(q, "media", mediaId) : undefined;
    if (media)
      await put(q, "media", mediaId, { ...media, public: true }, media.owner);
  }
  await put(q, "settings", "global", {
    ...settings,
    name: version.values.name,
    accent: version.values.accent,
    background: version.values.background,
    button: version.values.button,
  });
  await put(q, "brand", "current", {
    ...version.values,
    version: versionId,
    publishedAt: now(),
  });
  await put(q, "records", "A076", {
    id: "A076",
    values: {
      logo: version.values.logo ?? "",
      icon: version.values.icon ?? "",
    },
  });
  await put(q, "records", "A081", {
    id: "A081",
    values: {
      terms: version.values.terms ?? "",
      privacy: version.values.privacy ?? "",
      commerce: version.values.commerce ?? "",
      contact: version.values.contact ?? "",
    },
  });
}
export function registerOperations(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.post("/api/admin/users/:id/overrides", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const body = z
        .object({
          feature: z.enum([
            "calendar.view",
            "notification.receive",
            "story.view",
            "dm.send",
            "dm.audio.send",
            "voice.join",
            "voice.speak",
            "voice.create",
            "gacha.draw",
            "tip.send",
          ]),
          allowed: z.boolean(),
          expiresAt: z.iso.datetime(),
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      if (body.expiresAt <= now()) fail(400, "適用終了日時を確認してください");
      const userId = (request.params as any).id;
      if (!(await q.all("SELECT id FROM users WHERE id = ?", [userId])).length)
        fail(404, "会員が見つかりません");
      const previous = await get(q, "overrides", userId);
      const next = {
        features: { ...previous?.features, [body.feature]: body.allowed },
        expires: { ...previous?.expires, [body.feature]: body.expiresAt },
        expiresAt: body.expiresAt,
      };
      await put(q, "overrides", userId, next, userId);
      await audit(
        q,
        actor.user.id,
        "member.entitlement",
        userId,
        previous,
        next,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.get("/api/admin/analytics", async (request) => {
    const actor = await identity(db, request, config, "admin");
    const users = await db.all<User>("SELECT * FROM users");
    const members = users.filter((user) => user.role === "member");
    const tips = await list(db, "tips");
    const reports = await list(db, "reports");
    const devices = await list(db, "push");
    const sessions = await db.all(
      "SELECT * FROM sessions WHERE touched_at > ? AND expires_at > ?",
      [new Date(Date.now() - 30 * 86400000).toISOString(), now()],
    );
    const activity = await list(db, "activity");
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const active = members.filter(
      (user) =>
        user.status === "active" &&
        activity.some((event) => event.userId === user.id && event.at > since),
    );
    const permitted = active.filter((user) =>
      devices.some(
        (device) => device.id && user.id === (device.userId ?? device.ownerId),
      ),
    );
    const rows = await db.all(
      "SELECT owner_id FROM entities WHERE resource = 'push'",
    );
    const rate = active.length
      ? active.filter((user) => rows.some((row) => row.owner_id === user.id))
          .length / active.length
      : 0;
    return {
      members: members.length,
      verified: members.filter(
        (user) => user.verified && user.status === "active",
      ).length,
      active30Days: active.length,
      notificationOptInRate: rate,
      unresolvedReports: reports.filter(
        (report) => report.status !== "対応済み" && report.status !== "却下",
      ).length,
      liveRooms: (await list(db, "rooms")).filter(
        (room) => room.status === "開催中",
      ).length,
      revenue: ["super", "finance"].includes(actor.user.role)
        ? tips
            .filter((tip) => tip.paymentStatus === "paid")
            .reduce((total, tip) => total + tip.amount - (tip.refunded ?? 0), 0)
        : null,
      definitions: {
        active:
          "直近30日にログイン利用があり、停止されていない一般会員（管理者・公式配信者を除く）",
        notificationOptInRate:
          "アクティブ会員のうち、有効な通知端末を1台以上持つ会員の割合",
        revenue: "決済成功の金額から返金額を差し引いた累計額（手数料控除前）",
      },
    };
  });
  app.get("/api/admin/jobs", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "content"]);
    return db.all(
      "SELECT id,kind,due_at,state,attempts,result FROM jobs ORDER BY due_at DESC LIMIT 200",
    );
  });
  app.post("/api/admin/jobs/:id/retry", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const { reason } = z
        .object({ reason: z.string().min(5).max(2000) })
        .strict()
        .parse(request.body);
      const job = (
        await q.all("SELECT id,state FROM jobs WHERE id = ?", [
          (request.params as any).id,
        ])
      )[0];
      if (!job || job.state !== "failed")
        fail(409, "失敗したジョブのみ再試行できます");
      await q.run(
        "UPDATE jobs SET state = 'pending', attempts = 0, due_at = ?, locked_until = NULL WHERE id = ?",
        [now(), job.id],
      );
      await audit(
        q,
        actor.user.id,
        "job.retry",
        job.id,
        job,
        { state: "pending" },
        reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.post("/api/admin/reports/:id/action", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "moderator"]);
      const body = z
        .object({
          action: z.enum(["warn", "suspend", "remove", "dismiss"]),
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      const report = await get(q, "reports", (request.params as any).id);
      if (!report) fail(404, "通報が見つかりません");
      const targetId =
        report.type === "user"
          ? report.target
          : (report.evidence.sender ??
            report.evidence.userId ??
            report.evidence.hostId);
      const target = (
        await q.all<User>("SELECT * FROM users WHERE id = ?", [targetId ?? ""])
      )[0];
      if (target && roleNames[target.role] && actor.user.role !== "super")
        fail(403, "管理者への措置にはスーパー管理者が必要です");
      if (target?.id === actor.user.id && body.action === "suspend")
        fail(400, "自分自身を停止できません");
      if (body.action === "suspend" && target) {
        await q.run("UPDATE users SET status = 'suspended' WHERE id = ?", [
          target.id,
        ]);
        await q.run("DELETE FROM sessions WHERE user_id = ?", [target.id]);
        await enqueue(q, `suspend:${report.id}`, "voice_kick_user", {
          userId: target.id,
        });
      }
      if (body.action === "warn" && target)
        await notifyUser(
          q,
          target.id,
          `warning:${report.id}`,
          "運営からのお知らせ",
          "コミュニティガイドラインをご確認ください",
          "/support",
        );
      if (body.action === "remove" && report.type === "message") {
        const message = await get(q, "messages", report.target);
        if (message)
          await put(
            q,
            "messages",
            message.id,
            {
              ...message,
              text: "運営により削除されました",
              mediaId: undefined,
              retracted: true,
            },
            message.conversationId,
          );
      }
      report.status = body.action === "dismiss" ? "却下" : "対応済み";
      report.assignee = actor.user.id;
      report.decision = body;
      report.resolvedAt = now();
      await put(q, "reports", report.id, report, report.reporter);
      await audit(
        q,
        actor.user.id,
        `moderation.${body.action}`,
        report.id,
        null,
        body,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.patch("/api/admin/support/:id", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "support"]);
      const body = z
        .object({
          status: z.enum(["未対応", "対応中", "対応済み"]),
          reply: z.string().max(10000),
          reason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(request.body);
      const ticket = await get(q, "support", (request.params as any).id);
      if (!ticket) fail(404, "問い合わせが見つかりません");
      await put(
        q,
        "support",
        ticket.id,
        { ...ticket, status: body.status, reply: body.reply, repliedAt: now() },
        ticket.userId,
      );
      await audit(
        q,
        actor.user.id,
        "support.reply",
        ticket.id,
        null,
        body,
        body.reason,
        request.ip,
      );
      await notifyUser(
        q,
        ticket.userId,
        `support:${ticket.id}:${now()}`,
        "お問い合わせへの返信",
        "お問い合わせの履歴をご確認ください",
        "/support",
      );
      return { ok: true };
    }),
  );
  app.get("/api/brand", async () => (await get(db, "brand", "current")) ?? {});
  app.get("/api/admin/brand/versions", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "content"]);
    return list(db, "brandVersions");
  });
  app.post("/api/admin/brand", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "content"]);
      const body = z
        .object({
          values: brandSchema,
          publishAt: z.iso.datetime().optional(),
          publish: z.boolean(),
          reason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(request.body);
      for (const key of [
        "icon",
        "logo",
        "ogp",
        "emailLogo",
        "installGuide",
        "notificationIcon",
      ] as const)
        if (
          body.values[key] &&
          !(await get(q, "media", body.values[key]!.split("/").at(-1)!))
        )
          fail(400, "素材が見つかりません");
      const versionId = id();
      await put(q, "brandVersions", versionId, {
        id: versionId,
        values: body.values,
        at: now(),
        actor: actor.user.id,
      });
      if (body.publish) {
        if (body.publishAt && body.publishAt > now())
          await enqueue(
            q,
            `brand:${versionId}`,
            "brand",
            { versionId },
            body.publishAt,
          );
        else await publishBrand(q, versionId);
      }
      await audit(
        q,
        actor.user.id,
        "brand.version",
        versionId,
        await get(q, "brand", "current"),
        body,
        body.reason,
        request.ip,
      );
      return { id: versionId };
    }),
  );
  app.post("/api/admin/brand/:id/restore", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "content"]);
      const { reason } = z
        .object({ reason: z.string().min(1).max(2000) })
        .strict()
        .parse(request.body);
      const versionId = (request.params as any).id;
      await publishBrand(q, versionId);
      await audit(
        q,
        actor.user.id,
        "brand.restore",
        versionId,
        null,
        null,
        reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.get("/manifest.json", async (_request, reply) => {
    const brand = (await get(db, "brand", "current")) ?? {};
    const settings = await get(db, "settings", "global");
    return reply
      .type("application/manifest+json")
      .header("Cache-Control", "no-cache")
      .send({
        id: "/",
        name: brand.name ?? settings.name,
        short_name: brand.short ?? settings.name,
        description: brand.description ?? "マン組の公式ファンアプリ",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: brand.accent ?? settings.accent,
        background_color: brand.background ?? "#08030b",
        icons: [192, 512].map((size) => ({
          src: `/api/brand/icon/${size}?v=${brand.version ?? "initial"}`,
          sizes: `${size}x${size}`,
          type: "image/png",
          purpose: "any",
        })),
      });
  });
  app.get("/api/brand/icon/:size", async (request, reply) => {
    const size = z.enum(["192", "512"]).parse((request.params as any).size);
    const brand = await get(db, "brand", "current");
    const mediaId = brand?.icon?.split("/").at(-1);
    const file = mediaId
      ? resolve(config.files, mediaId)
      : resolve(config.webRoot, "assets/avatar.jpg");
    const image = await sharp(await readFile(file))
      .resize(Number(size), Number(size), {
        fit: "contain",
        background: "#08030b",
      })
      .png()
      .toBuffer();
    return reply
      .type("image/png")
      .header("Cache-Control", "public, max-age=300")
      .send(image);
  });
}
