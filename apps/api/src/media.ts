import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { mkdir, readFile, writeFile, stat, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffprobe from "@ffprobe-installer/ffprobe";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.ts";
import { get, put, list } from "./db.ts";
import { identity, permit } from "./auth.ts";
import type { Config } from "./config.ts";
import { fail, id, now, once } from "./security.ts";
import { planLimits, entitled, contentVisible } from "./domain.ts";
import { featurePolicy } from "./limits.ts";
import { availableCampaigns, campaignOdds } from "./campaigns.ts";

async function probeDuration(info: any, path: string): Promise<number> {
  const duration = Number(info.format?.duration);
  if (Number.isFinite(duration) && duration > 0) return duration;
  // MediaRecorder's streaming WebM has no container duration. Read packet end times.
  const { stdout } = await promisify(execFile)(
    process.env.FFPROBE_PATH || ffprobe.path,
    [
      "-v",
      "error",
      "-show_packets",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      path,
    ],
    { timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  let end = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const [start, length] = line.split(",").map(Number);
    if (Number.isFinite(start))
      end = Math.max(end, start + (Number.isFinite(length) ? length : 0));
  }
  return end;
}

export function mediaSignature(
  mediaId: string,
  user: string,
  expires: string,
  key: string,
) {
  return createHmac("sha256", Buffer.from(key, "base64"))
    .update(`${mediaId}:${user}:${expires}`)
    .digest("base64url");
}
export function registerMedia(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.post("/api/me/frame", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const { drawId } = z
        .object({ drawId: z.string().max(100).nullable() })
        .strict()
        .parse(request.body);
      return once(
        q,
        `frame:${actor.user.id}`,
        String(request.headers["idempotency-key"] ?? ""),
        { drawId },
        async () => {
          const profile = JSON.parse(actor.user.profile),
            baseAvatar = profile.baseAvatar ?? profile.avatar;
          if (!drawId) {
            await q.run("UPDATE users SET profile = ? WHERE id = ?", [
              JSON.stringify({
                ...profile,
                avatar: baseAvatar,
                baseAvatar: undefined,
                frameDrawId: undefined,
              }),
              actor.user.id,
            ]);
            return { ok: true };
          }
          const draw = (await list(q, "draws", actor.user.id)).find(
            (item) => item.id === drawId,
          );
          if (!draw || draw.kind !== "frame" || !draw.assetId)
            fail(403, "獲得済みのフレームを選んでください");
          const frame = await get(q, "media", draw.assetId);
          if (!frame || frame.kind !== "rewardImage")
            fail(400, "フレーム素材を確認してください");
          const frameBytes = await readFile(resolve(config.files, frame.id));
          if (!(await sharp(frameBytes).metadata()).hasAlpha)
            fail(400, "透明な背景のフレーム素材が必要です");
          const avatarId = baseAvatar.startsWith("/api/media/")
            ? baseAvatar.split("/").at(-1)
            : null;
          const avatar = avatarId && (await get(q, "media", avatarId));
          if (avatarId && avatar?.kind !== "avatar")
            fail(400, "プロフィール写真を確認してください");
          const source = avatarId
            ? resolve(config.files, avatarId)
            : resolve(config.webRoot, "assets/avatar.jpg");
          const overlay = await sharp(frameBytes)
            .resize(256, 256, {
              fit: "contain",
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer();
          const output = await sharp(await readFile(source))
            .resize(256, 256, { fit: "cover" })
            .composite([{ input: overlay }])
            .webp({ quality: 90 })
            .toBuffer();
          const mediaId = id();
          await writeFile(resolve(config.files, mediaId), output, {
            mode: 0o600,
          });
          await put(
            q,
            "media",
            mediaId,
            {
              id: mediaId,
              owner: actor.user.id,
              kind: "avatar",
              mime: "image/webp",
              size: output.length,
              at: now(),
            },
            actor.user.id,
          );
          await q.run("UPDATE users SET profile = ? WHERE id = ?", [
            JSON.stringify({
              ...profile,
              baseAvatar,
              frameDrawId: drawId,
              avatar: `/api/media/${mediaId}`,
            }),
            actor.user.id,
          ]);
          return { ok: true };
        },
      );
    }),
  );
  app.post(
    "/api/uploads",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request) => {
      const query = z
        .object({
          kind: z.enum([
            "avatar",
            "image",
            "audio",
            "rewardImage",
            "rewardAudio",
            "video",
          ]),
          conversationId: z.string().max(100).optional(),
        })
        .strict()
        .parse(request.query);
      let owner = "staging";
      const audio = query.kind === "audio" || query.kind === "rewardAudio";
      const adminUpload = [
        "image",
        "rewardImage",
        "rewardAudio",
        "video",
      ].includes(query.kind);
      if (
        query.kind !== "avatar" ||
        request.cookies[`${config.production ? "__Host-" : ""}mangumi-member`]
      ) {
        const actor = await identity(
          db,
          request,
          config,
          adminUpload && request.headers["x-mangumi-area"] === "admin"
            ? "admin"
            : "member",
        );
        owner = actor.user.id;
        if (adminUpload) {
          if (actor.area === "admin") permit(actor, ["super", "content"]);
          else if (
            actor.user.role !== "official" ||
            !["image", "video"].includes(query.kind)
          )
            fail(403, "投稿権限がありません");
        }
        if (query.kind === "audio") {
          await entitled(db, actor.user, "dm.audio.send");
          const conversation = query.conversationId
            ? await get(db, "conversations", query.conversationId)
            : undefined;
          if (!conversation?.members.includes(owner))
            fail(403, "会話に参加していません");
        }
      }
      const upload = await request.file({
        limits: {
          fileSize:
            audio || query.kind === "video"
              ? 20 * 1024 * 1024
              : 5 * 1024 * 1024,
          files: 1,
          fields: 0,
        },
      });
      if (!upload) fail(400, "ファイルを選んでください");
      const data = await upload.toBuffer();
      if (query.kind === "audio") {
        const account = (
          await db.all<any>("SELECT * FROM users WHERE id = ?", [owner])
        )[0];
        const policy =
          account && (await featurePolicy(db, account, "dm.audio.send"));
        if (policy?.bytes && data.length > policy.bytes)
          fail(413, "プランの音声容量上限を超えています");
      }
      const mediaId = id();
      await mkdir(config.files, { recursive: true });
      let output = data,
        mime = "",
        duration: number | undefined;
      if (query.kind === "video") {
        const temporary = resolve(config.files, `${mediaId}.probe`);
        await writeFile(temporary, data, { mode: 0o600 });
        try {
          const { stdout } = await promisify(execFile)(
            process.env.FFPROBE_PATH || ffprobe.path,
            [
              "-v",
              "error",
              "-show_format",
              "-show_streams",
              "-of",
              "json",
              temporary,
            ],
            { timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true },
          );
          const info = JSON.parse(stdout),
            videos = info.streams.filter(
              (stream: any) => stream.codec_type === "video",
            );
          duration = await probeDuration(info, temporary);
          if (
            !Number.isFinite(duration) ||
            duration <= 0 ||
            duration > 60 ||
            videos.length !== 1 ||
            videos[0].width > 1920 ||
            videos[0].height > 1920 ||
            info.streams.some(
              (stream: any) => !["audio", "video"].includes(stream.codec_type),
            )
          )
            fail(400, "動画は60秒以内・1920px以下にしてください");
          mime = /mp4|mov/.test(info.format.format_name)
            ? "video/mp4"
            : /webm|matroska/.test(info.format.format_name)
              ? "video/webm"
              : "";
          if (!mime) fail(400, "MP4またはWebMを選んでください");
        } catch (error) {
          if (error instanceof Error && "statusCode" in error) throw error;
          fail(400, "動画を読み取れませんでした");
        } finally {
          await unlink(temporary).catch(() => {});
        }
      } else if (audio) {
        const temporary = resolve(config.files, `${mediaId}.probe`);
        await writeFile(temporary, data, { mode: 0o600 });
        try {
          const { stdout } = await promisify(execFile)(
            process.env.FFPROBE_PATH || ffprobe.path,
            [
              "-v",
              "error",
              "-show_format",
              "-show_streams",
              "-of",
              "json",
              temporary,
            ],
            { timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true },
          );
          const info = JSON.parse(stdout);
          duration = await probeDuration(info, temporary);
          const settings = await get(db, "settings", "global");
          const account = (
            await db.all("SELECT * FROM users WHERE id = ?", [owner])
          )[0];
          const limits = account ? await planLimits(db, account as any) : {};
          const policy = account
            ? await featurePolicy(db, account as any, "dm.audio.send")
            : undefined;
          if (policy?.seconds && duration! > policy.seconds)
            fail(400, "プランの録音時間上限を超えています");
          const maximum = Math.min(
            settings.audioSeconds,
            limits.audioSeconds ?? 300,
          );
          if (
            !Number.isFinite(duration) ||
            duration <= 0 ||
            duration > maximum ||
            !info.streams?.length ||
            info.streams.some((stream: any) => stream.codec_type !== "audio")
          )
            fail(400, `音声は${settings.audioSeconds}秒以内にしてください`);
          const format = info.format.format_name;
          mime = /webm|matroska/.test(format)
            ? "audio/webm"
            : /ogg/.test(format)
              ? "audio/ogg"
              : /mp3/.test(format)
                ? "audio/mpeg"
                : /mov|mp4/.test(format)
                  ? "audio/mp4"
                  : /wav/.test(format)
                    ? "audio/wav"
                    : "";
          if (!mime) fail(400, "対応していない音声形式です");
        } catch (error) {
          if (error instanceof Error && "statusCode" in error) throw error;
          fail(400, "音声ファイルを読み取れませんでした");
        } finally {
          await unlink(temporary).catch(() => {});
        }
      } else {
        try {
          const image = sharp(data, {
            limitInputPixels: 20_000_000,
            animated: false,
          });
          const metadata = await image.metadata();
          if (!["jpeg", "png", "webp"].includes(metadata.format ?? ""))
            fail(400, "JPEG・PNG・WebPを選んでください");
          output = await image
            .rotate()
            .resize(
              query.kind === "avatar"
                ? { width: 256, height: 256, fit: "cover" }
                : {
                    width: 1920,
                    height: 1920,
                    fit: "inside",
                    withoutEnlargement: true,
                  },
            )
            .webp({ quality: 88 })
            .toBuffer();
          mime = "image/webp";
        } catch {
          fail(400, "画像ファイルを読み取れませんでした");
        }
      }
      await writeFile(resolve(config.files, mediaId), output, { mode: 0o600 });
      await db.transaction((q) =>
        put(
          q,
          "media",
          mediaId,
          {
            id: mediaId,
            owner,
            kind: query.kind,
            conversationId: query.conversationId,
            mime,
            duration,
            size: output.length,
            at: now(),
          },
          owner,
        ),
      );
      return { id: mediaId, url: `/api/media/${mediaId}`, duration };
    },
  );
  app.post("/api/media/:id/url", async (request) => {
    const actor = await identity(
      db,
      request,
      config,
      request.headers["x-mangumi-area"] === "admin" ? "admin" : "member",
    );
    const mediaId = z
      .string()
      .uuid()
      .parse((request.params as any).id);
    const media = await get(db, "media", mediaId);
    if (!media) fail(404, "ファイルが見つかりません");
    if (media.kind !== "audio" && !media.kind.startsWith("reward"))
      return { url: `/api/media/${mediaId}` };
    if (media.kind.startsWith("reward")) {
      if (actor.area === "admin") permit(actor, ["super", "content"]);
      else if (
        !(await list(db, "draws", actor.user.id)).some(
          (draw) => draw.assetId === mediaId,
        )
      )
        fail(403, "この景品をまだ獲得していません");
    } else {
      const conversation = await get(db, "conversations", media.conversationId);
      if (!conversation?.members.includes(actor.user.id))
        fail(403, "ファイルを閲覧できません");
      if (
        !(await list(db, "messages", media.conversationId)).some(
          (message) => message.mediaId === mediaId && !message.retracted,
        )
      )
        fail(404, "この音声は取り消されています");
    }
    const expires = String(Date.now() + 300000);
    return {
      url: `/api/media/${mediaId}?user=${actor.user.id}&expires=${expires}&signature=${mediaSignature(mediaId, actor.user.id, expires, config.key)}&area=${actor.area}`,
    };
  });
  app.get("/api/media/:id", async (request, reply) => {
    const mediaId = z
      .string()
      .uuid()
      .parse((request.params as any).id);
    const media = await get(db, "media", mediaId);
    if (!media) fail(404, "ファイルが見つかりません");
    const protectedImage =
      ["image", "video"].includes(media.kind) && !media.public;
    if (protectedImage) {
      let administrator = false;
      try {
        permit(await identity(db, request, config, "admin"), [
          "super",
          "content",
        ]);
        administrator = true;
      } catch {}
      if (!administrator) {
        const actor = await identity(db, request, config, "member");
        const url = `/api/media/${mediaId}`;
        const stories = (await list(db, "stories")).filter(
          (story) => story.image === url && contentVisible(story, actor.user),
        );
        const schedules = (await list(db, "schedules")).filter(
          (schedule) =>
            schedule.image === url && contentVisible(schedule, actor.user),
        );
        const odds = await get(db, "probabilities", "current"),
          campaign = await get(db, "gacha", "global");
        let rewardPreview =
          campaign.status === "公開" &&
          odds.items.some((prize: any) => prize.image === url);
        for (const item of await availableCampaigns(db, actor.user))
          if (
            (await campaignOdds(db, item))?.items.some(
              (prize: any) => prize.image === url,
            )
          )
            rewardPreview = true;
        const owned = (await list(db, "draws", actor.user.id)).some(
          (draw) => draw.image === url,
        );
        let allowed =
          owned ||
          (media.owner === actor.user.id && actor.user.role === "official");
        for (const [present, feature] of [
          [stories.length, "story.view"],
          [schedules.length, "calendar.view"],
          [rewardPreview, "gacha.draw"],
        ] as const)
          if (present) {
            try {
              await entitled(db, actor.user, feature);
              allowed = true;
            } catch {}
          }
        if (!allowed) fail(403, "この画像・動画を閲覧できません");
      }
    }
    const privateMedia =
      media.kind === "audio" || media.kind.startsWith("reward");
    if (privateMedia) {
      const query = z
        .object({
          user: z.string(),
          expires: z.string().regex(/^\d+$/),
          signature: z.string().min(40).max(100),
          area: z.enum(["member", "admin"]).optional(),
          reportId: z.string().max(100).optional(),
        })
        .strict()
        .parse(request.query);
      const actor = await identity(
        db,
        request,
        config,
        query.area === "admin" ? "admin" : "member",
      );
      const expected = mediaSignature(
        mediaId,
        actor.user.id,
        query.expires,
        config.key,
      );
      if (
        query.user !== actor.user.id ||
        Number(query.expires) < Date.now() ||
        Number(query.expires) > Date.now() + 301000 ||
        expected.length !== query.signature.length ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(query.signature))
      )
        fail(403, "音声リンクの有効期限が切れました");
      const conversation = await get(db, "conversations", media.conversationId);
      if (media.kind.startsWith("reward")) {
        if (actor.area === "admin") permit(actor, ["super", "content"]);
        else if (
          !(await list(db, "draws", actor.user.id)).some(
            (draw) => draw.assetId === mediaId,
          )
        )
          fail(403, "この景品をまだ獲得していません");
      } else if (actor.area === "admin") {
        permit(actor, ["super", "moderator"]);
        const access = await get(
          db,
          "evidenceAccess",
          `${actor.session.id}_${query.reportId}`,
        );
        if (
          !access ||
          access.mediaId !== mediaId ||
          access.expiresAt < Date.now()
        )
          fail(403, "通報から閲覧目的を記録してください");
      } else {
        if (!conversation?.members.includes(actor.user.id))
          fail(403, "ファイルを閲覧できません");
        if (
          !(await list(db, "messages", media.conversationId)).some(
            (message) => message.mediaId === mediaId && !message.retracted,
          )
        )
          fail(404, "この音声は取り消されています");
      }
    }
    reply.header(
      "Cache-Control",
      privateMedia || protectedImage
        ? "private, no-store"
        : "public, max-age=3600",
    );
    reply
      .header("Content-Type", media.mime)
      .header("X-Content-Type-Options", "nosniff")
      .header("Accept-Ranges", "bytes");
    const path = resolve(config.files, mediaId);
    const size = (await stat(path)).size;
    if (request.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
      if (!range)
        return reply
          .code(416)
          .header("Content-Range", `bytes */${size}`)
          .send();
      const start = Number(range[1]),
        end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size)
        return reply
          .code(416)
          .header("Content-Range", `bytes */${size}`)
          .send();
      return reply
        .code(206)
        .header("Content-Range", `bytes ${start}-${end}/${size}`)
        .header("Content-Length", end - start + 1)
        .send(createReadStream(path, { start, end }));
    }
    return reply.header("Content-Length", size).send(createReadStream(path));
  });
}
