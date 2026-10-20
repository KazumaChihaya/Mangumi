import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { consume, featurePolicy } from "./limits.ts";
import { TrackSource } from "livekit-server-sdk";
import { get, list, put, remove, type Database, type Query } from "./db.ts";
import { audit, digest, fail, id, now, once } from "./security.ts";
import { identity, permit, type Identity, type User } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Services } from "./services.ts";
import {
  contentVisible,
  entitled,
  planLimits,
  storySchema,
  queueStory,
} from "./domain.ts";
import { notifyUser, enqueue } from "./jobs.ts";
import { mediaSignature } from "./media.ts";
import { voiceAuthorized } from "./voice-access.ts";

export async function blocked(q: Query, first: string, second: string) {
  return !!(
    (await get(q, "blocks", `${first}_${second}`)) ||
    (await get(q, "blocks", `${second}_${first}`))
  );
}
async function conversation(q: Query, actor: Identity, conversationId: string) {
  const row = await get(q, "conversations", conversationId);
  if (!row || !row.members.includes(actor.user.id))
    fail(404, "会話が見つかりません");
  const peer = row.members.find((member: string) => member !== actor.user.id);
  return { ...row, peer };
}
async function requireContact(q: Query, actor: Identity, peerId: string) {
  if (await blocked(q, actor.user.id, peerId))
    fail(403, "ブロック中は連絡できません");
  const peer = (
    await q.all<User>(
      "SELECT * FROM users WHERE id = ? AND status = 'active' AND verified = 1",
      [peerId],
    )
  )[0];
  if (!peer || peer.id === actor.user.id) fail(404, "相手が見つかりません");
  const settings = await get(q, "settings", "global");
  if (
    settings.dmPolicy === "不可" ||
    (actor.user.role !== "official" && peer.role !== "official")
  )
    fail(403, "DMは会員と公式配信者の間で利用できます");
  return peer;
}
const key = (request: FastifyRequest) =>
  String(request.headers["idempotency-key"] ?? "");
export function registerSocial(
  app: FastifyInstance,
  db: Database,
  config: Config,
  external: Services,
) {
  app.post("/api/official/stories", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      if (actor.user.role !== "official") fail(403, "公式配信者専用の機能です");
      await entitled(q, actor.user, "story.view");
      await consume(q, actor.user, "story.view", {
        level: "create",
        created:
          (await list(q, "stories")).filter(
            (s) =>
              s.authorId === actor.user.id &&
              (!s.expiresAt || s.expiresAt > now()),
          ).length + 1,
      });
      const body = storySchema
        .omit({ id: true, authorId: true, viewed: true })
        .parse(request.body);
      if (
        !(await list(q, "plans")).some(
          (plan) => plan.name === body.plan && plan.published,
        )
      )
        fail(400, "公開対象のプランを確認してください");
      const media = await get(q, "media", body.image.split("/").at(-1) ?? "");
      if (
        !media ||
        media.owner !== actor.user.id ||
        !["image", "video"].includes(media.kind)
      )
        fail(400, "投稿するファイルをアップロードしてください");
      const publishAt = body.publishAt ?? now(),
        expiresAt =
          body.expiresAt ??
          new Date(Date.parse(publishAt) + 86400000).toISOString();
      if (expiresAt <= publishAt) fail(400, "公開終了日時を確認してください");
      const story = {
        ...body,
        id: id(),
        authorId: actor.user.id,
        publishAt,
        expiresAt,
      };
      await put(q, "stories", story.id, story);
      await queueStory(q, story);
      await audit(
        q,
        actor.user.id,
        "official.story.create",
        story.id,
        null,
        story,
        "公式配信者の投稿",
        request.ip,
      );
      return story;
    }),
  );
  app.post("/api/official/voice-rooms", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      if (actor.user.role !== "official") fail(403, "公式配信者専用の機能です");
      const body = z
        .object({
          title: z.string().trim().min(1).max(200),
          plan: z.string().max(80),
          startsAt: z.iso.datetime().optional(),
          maxSpeakers: z.number().int().min(1).max(20).default(8),
          maxMinutes: z.number().int().min(1).max(1440).default(120),
          maxListeners: z.number().int().min(1).max(10000).optional(),
          description: z.string().max(5000).optional(),
          visibility: z.enum(["public", "plan", "invite"]).default("public"),
          invited: z.array(z.string().max(100)).max(1000).default([]),
          reactions: z.boolean().default(true),
        })
        .strict()
        .parse(request.body);
      await entitled(q, actor.user, "voice.create");
      await consume(q, actor.user, "voice.create", {
        level: "create",
        created:
          (await list(q, "rooms")).filter(
            (r) => r.hostId === actor.user.id && r.status !== "終了",
          ).length + 1,
      });
      if (
        !(await list(q, "plans")).some(
          (plan) => plan.name === body.plan && plan.published,
        )
      )
        fail(400, "対象プランを確認してください");
      const room = {
        ...body,
        id: id(),
        host: JSON.parse(actor.user.profile).name,
        hostId: actor.user.id,
        listeners: 0,
        status: body.startsAt && body.startsAt > now() ? "開催予定" : "開催中",
        ...(!body.startsAt || body.startsAt <= now()
          ? { startedAt: now() }
          : {}),
      };
      await put(q, "rooms", room.id, room);
      await audit(
        q,
        actor.user.id,
        "official.voice.create",
        room.id,
        null,
        room,
        "公式配信者のルーム作成",
        request.ip,
      );
      return room;
    }),
  );
  app.post("/api/voice-rooms/:id/start", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const room = await get(q, "rooms", (request.params as any).id);
      if (
        !room ||
        room.hostId !== actor.user.id ||
        actor.user.role !== "official"
      )
        fail(403, "ホストのみ開始できます");
      if (room.status !== "開催予定")
        fail(409, "開催予定のルームのみ開始できます");
      await put(q, "rooms", room.id, {
        ...room,
        status: "開催中",
        startedAt: now(),
      });
      return { ok: true };
    }),
  );
  app.post(
    "/api/voice-rooms/:id/reaction",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) =>
      db.transaction(async (q) => {
        const actor = await identity(q, request, config, "member");
        const room = await get(q, "rooms", (request.params as any).id);
        if (!room || (await blocked(q, actor.user.id, room.hostId)))
          fail(403, "リアクションを送信できません");
        if (room.reactions === false)
          fail(409, "このルームはリアクションを受け付けていません");
        const participant = await get(
          q,
          "participants",
          `${room.id}_${actor.user.id}`,
        );
        if (!participant) fail(403, "ルームに参加してください");
        const { emoji } = z
          .object({ emoji: z.enum(["❤️", "👏", "🔥", "😂", "🎉"]) })
          .strict()
          .parse(request.body);
        await put(
          q,
          "participants",
          participant.id,
          { ...participant, reaction: emoji, reactionAt: now() },
          room.id,
        );
        return { ok: true };
      }),
  );
  app.get("/api/officials", async (request) => {
    await identity(
      db,
      request,
      config,
      request.headers["x-mangumi-area"] === "admin" ? "admin" : "member",
    );
    return (
      await db.all<User>(
        "SELECT * FROM users WHERE role = 'official' AND status = 'active' AND verified = 1",
      )
    ).map((user) => ({
      id: user.id,
      name: JSON.parse(user.profile).name,
      avatar: JSON.parse(user.profile).avatar,
    }));
  });
  app.get("/api/conversations", async (request) => {
    const actor = await identity(db, request, config, "member");
    return db.transaction(async (q) => {
      const rows = (await list(q, "conversations")).filter((row) =>
        row.members.includes(actor.user.id),
      );
      const output = [];
      for (const row of rows) {
        const peer = row.members.find(
          (member: string) => member !== actor.user.id,
        );
        const user = (
          await q.all<User>("SELECT * FROM users WHERE id = ?", [peer])
        )[0];
        const preference = await get(
          q,
          "conversationPrefs",
          `${row.id}_${actor.user.id}`,
        );
        const messages = (await list(q, "messages", row.id)).filter(
          (message) => !message.hiddenFor?.includes(actor.user.id),
        );
        output.push({
          id: row.id,
          peer,
          name: user ? JSON.parse(user.profile).name : "退会済み",
          avatar: user ? JSON.parse(user.profile).avatar : "/assets/avatar.jpg",
          muted: !!preference?.muted,
          blocked: await blocked(q, actor.user.id, peer),
          unread: messages.filter(
            (message) =>
              message.sender !== actor.user.id &&
              message.at > (preference?.readAt ?? ""),
          ).length,
          lastAt:
            messages
              .map((message) => message.at)
              .sort()
              .at(-1) ?? row.createdAt,
        });
      }
      return output.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    });
  });
  app.post("/api/conversations", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      await entitled(q, actor.user, "dm.send");
      const { peer } = z
        .object({ peer: z.string().min(1).max(100) })
        .strict()
        .parse(request.body);
      await requireContact(q, actor, peer);
      const conversationId = digest([actor.user.id, peer].sort().join(":"));
      if (!(await get(q, "conversations", conversationId)))
        await put(q, "conversations", conversationId, {
          id: conversationId,
          members: [actor.user.id, peer],
          createdAt: now(),
        });
      return { id: conversationId };
    }),
  );
  app.get("/api/conversations/:id/messages", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const row = await conversation(q, actor, (request.params as any).id);
      const cursor = z
        .object({
          before: z.string().max(30).optional(),
          beforeId: z.string().max(100).optional(),
        })
        .parse(request.query);
      const peer = await get(q, "conversationPrefs", `${row.id}_${row.peer}`);
      return (await list(q, "messages", row.id))
        .filter(
          (message) =>
            !message.hiddenFor?.includes(actor.user.id) &&
            (!cursor.before ||
              message.at < cursor.before ||
              (message.at === cursor.before &&
                !!cursor.beforeId &&
                message.id < cursor.beforeId)),
        )
        .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
        .slice(0, 100)
        .reverse()
        .map(({ hiddenFor, ...message }) => ({
          ...message,
          mine: message.sender === actor.user.id,
          status:
            message.at <= (peer?.readAt ?? "") &&
            message.sender === actor.user.id
              ? "read"
              : "delivered",
        }));
    }),
  );
  app.post(
    "/api/conversations/:id/messages",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) =>
      db.transaction(async (q) => {
        const actor = await identity(q, request, config, "member");
        const row = await conversation(q, actor, (request.params as any).id);
        const body = z
          .object({
            text: z.string().trim().max(2000).default(""),
            mediaId: z.string().max(100).optional(),
          })
          .strict()
          .refine(
            (body) => !!body.text || !!body.mediaId,
            "メッセージを入力してください",
          )
          .parse(request.body);
        await entitled(
          q,
          actor.user,
          body.mediaId ? "dm.audio.send" : "dm.send",
        );
        await requireContact(q, actor, row.peer);
        return once(
          q,
          `message:${actor.user.id}`,
          key(request),
          { conversation: row.id, ...body },
          async () => {
            const limits = await planLimits(q, actor.user);
            const file = body.mediaId
              ? await get(q, "media", body.mediaId)
              : undefined;
            await consume(
              q,
              actor.user,
              body.mediaId ? "dm.audio.send" : "dm.send",
              {
                target: row.peer,
                bytes: file?.size,
                seconds: file?.duration,
                level: "send",
              },
            );
            const todayMessages = (await list(q, "messages")).filter(
              (message) =>
                message.sender === actor.user.id &&
                new Date(Date.parse(message.at) + 9 * 3600000)
                  .toISOString()
                  .slice(0, 10) ===
                  new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
            ).length;
            if (todayMessages >= (limits.dmPerDay ?? 100))
              fail(409, "本日のメッセージ上限に達しています");
            const settings = await get(q, "settings", "global");
            const words = settings.ngWords
              .split(/[,、\n]/)
              .map((word: string) => word.trim())
              .filter(Boolean);
            if (words.some((word: string) => body.text.includes(word)))
              fail(400, "送信できない言葉が含まれています");
            for (const link of body.text.match(
              /(?:https?:\/\/|www\.)[^\s<>]+/gi,
            ) ?? []) {
              let allowed = false;
              try {
                const url = new URL(
                  link.startsWith("www.") ? `https://${link}` : link,
                );
                allowed =
                  url.protocol === "https:" &&
                  !url.username &&
                  !url.password &&
                  !url.port &&
                  (settings.dmAllowedHosts ?? []).includes(
                    url.hostname.toLowerCase(),
                  );
              } catch {}
              if (!allowed) fail(400, "許可されていないURLが含まれています");
            }
            if (body.mediaId) {
              const media = await get(q, "media", body.mediaId);
              if (
                !media ||
                media.owner !== actor.user.id ||
                media.kind !== "audio" ||
                media.conversationId !== row.id
              )
                fail(403, "この音声は添付できません");
            }
            const message = {
              id: id(),
              text: body.text,
              mediaId: body.mediaId,
              audio: !!body.mediaId,
              sender: actor.user.id,
              conversationId: row.id,
              at: now(),
              status: "delivered",
              retracted: false,
              ...((
                await featurePolicy(
                  q,
                  actor.user,
                  body.mediaId ? "dm.audio.send" : "dm.send",
                )
              )?.retentionDays
                ? {
                    expiresAt: new Date(
                      Date.now() +
                        (await featurePolicy(
                          q,
                          actor.user,
                          body.mediaId ? "dm.audio.send" : "dm.send",
                        ))!.retentionDays! *
                          86400000,
                    ).toISOString(),
                  }
                : {}),
            };
            await put(q, "messages", message.id, message, row.id);
            const preferences = await get(
              q,
              "conversationPrefs",
              `${row.id}_${row.peer}`,
            );
            if (!preferences?.muted)
              await notifyUser(
                q,
                row.peer,
                `message:${message.id}`,
                "マン組の新しいメッセージ",
                "アプリでメッセージを確認してください",
                `/u/U056?item=${row.id}`,
                "dm",
                { senderId: actor.user.id, conversationId: row.id },
              );
            return message;
          },
        );
      }),
  );
  app.patch("/api/conversations/:id", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const row = await conversation(q, actor, (request.params as any).id);
      const body = z
        .object({ muted: z.boolean().optional(), read: z.boolean().optional() })
        .strict()
        .parse(request.body);
      const current =
        (await get(q, "conversationPrefs", `${row.id}_${actor.user.id}`)) ?? {};
      await put(
        q,
        "conversationPrefs",
        `${row.id}_${actor.user.id}`,
        {
          ...current,
          ...(body.muted === undefined ? {} : { muted: body.muted }),
          ...(body.read ? { readAt: now() } : {}),
        },
        actor.user.id,
      );
      return { ok: true };
    }),
  );
  app.delete("/api/messages/:id", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const message = await get(q, "messages", (request.params as any).id);
      if (!message) fail(404, "メッセージが見つかりません");
      await conversation(q, actor, message.conversationId);
      const { scope } = z
        .object({ scope: z.enum(["self", "retract"]) })
        .strict()
        .parse(request.body);
      if (scope === "retract") {
        if (message.sender !== actor.user.id)
          fail(403, "自分のメッセージのみ取り消せます");
        message.text = "送信を取り消しました";
        message.mediaId = undefined;
        message.retracted = true;
      } else
        message.hiddenFor = [
          ...new Set([...(message.hiddenFor ?? []), actor.user.id]),
        ];
      await put(q, "messages", message.id, message, message.conversationId);
      return { ok: true };
    }),
  );
  app.get("/api/blocks", async (request) => {
    const actor = await identity(db, request, config, "member");
    return list(db, "blocks", actor.user.id);
  });
  app.post("/api/blocks", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const { userId } = z
        .object({ userId: z.string().max(100) })
        .strict()
        .parse(request.body);
      if (
        userId === actor.user.id ||
        !(await q.all("SELECT id FROM users WHERE id = ?", [userId])).length
      )
        fail(400, "対象を確認してください");
      await put(
        q,
        "blocks",
        `${actor.user.id}_${userId}`,
        { id: `${actor.user.id}_${userId}`, userId, at: now() },
        actor.user.id,
      );
      return { ok: true };
    }),
  );
  app.delete("/api/blocks/:id", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      await remove(
        q,
        "blocks",
        `${actor.user.id}_${(request.params as any).id}`,
      );
      return { ok: true };
    }),
  );
  app.post("/api/reports", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const body = z
        .object({
          type: z.enum(["message", "room", "user", "tip"]),
          targetId: z.string().min(1).max(100),
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(request.body);
      const table = {
        message: "messages",
        room: "rooms",
        user: "users",
        tip: "tips",
      }[body.type];
      let evidence: any;
      if (body.type === "user") {
        const user = (
          await q.all<User>("SELECT * FROM users WHERE id = ?", [body.targetId])
        )[0];
        if (user) evidence = { id: user.id, profile: JSON.parse(user.profile) };
      } else evidence = await get(q, table, body.targetId);
      if (!evidence) fail(404, "対象が見つかりません");
      if (body.type === "message")
        await conversation(q, actor, evidence.conversationId);
      if (body.type === "tip" && evidence.userId !== actor.user.id)
        fail(403, "対象を閲覧できません");
      const report = {
        id: id(),
        type: body.type,
        target: body.targetId,
        reason: body.reason,
        reporter: actor.user.id,
        status: "未対応",
        assignee: "未割当",
        evidence: structuredClone(evidence),
        at: now(),
      };
      await put(q, "reports", report.id, report, actor.user.id);
      return { id: report.id };
    }),
  );
  app.post("/api/admin/reports/:id/evidence", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super", "moderator"]);
      const { reason } = z
        .object({ reason: z.string().min(5).max(2000) })
        .strict()
        .parse(request.body);
      const report = await get(q, "reports", (request.params as any).id);
      if (!report) fail(404, "通報が見つかりません");
      await audit(
        q,
        actor.user.id,
        "report.evidence.read",
        report.id,
        null,
        null,
        reason,
        request.ip,
      );
      if (report.evidence.mediaId) {
        const expires = String(Date.now() + 300000);
        await put(
          q,
          "evidenceAccess",
          `${actor.session.id}_${report.id}`,
          { mediaId: report.evidence.mediaId, expiresAt: Number(expires) },
          actor.user.id,
        );
        report.audioUrl = `/api/media/${report.evidence.mediaId}?user=${actor.user.id}&expires=${expires}&signature=${mediaSignature(report.evidence.mediaId, actor.user.id, expires, config.key)}&area=admin&reportId=${report.id}`;
      }
      return report;
    }),
  );
  app.post("/api/voice-rooms/:id/token", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      await entitled(q, actor.user, "voice.join");
      const room = await get(q, "rooms", (request.params as any).id);
      if (
        !room ||
        !["開催中", "公開"].includes(room.status) ||
        !contentVisible({ ...room, status: "公開" }, actor.user)
      )
        fail(403, "このルームには参加できません");
      if (
        (await get(q, "roomBans", `${room.id}_${actor.user.id}`)) ||
        (await blocked(q, actor.user.id, room.hostId))
      )
        fail(403, "このルームには参加できません");
      const participants = await list(q, "participants", room.id);
      for (const participant of participants)
        if (participant.expiresAt && participant.expiresAt < now())
          await remove(q, "participants", participant.id);
      const liveParticipants = participants.filter(
        (participant) =>
          !participant.expiresAt || participant.expiresAt >= now(),
      );
      const settings = await get(q, "settings", "global");
      const existing = liveParticipants.find(
        (row) => row.userId === actor.user.id,
      );
      if (
        !existing &&
        liveParticipants.length >=
          Math.min(settings.roomLimit, room.maxListeners ?? 10000)
      )
        fail(409, "満員です。しばらくしてからお試しください");
      await consume(q, actor.user, "voice.join", {
        count: existing ? 0 : 1,
        target: room.hostId,
        concurrent:
          (await list(q, "participants")).filter(
            (p) =>
              p.userId === actor.user.id &&
              (!p.expiresAt || p.expiresAt > now()),
          ).length + (existing ? 0 : 1),
        level: "view",
      });
      const role =
        room.hostId === actor.user.id ? "host" : (existing?.role ?? "listener");
      if (["host", "cohost", "speaker"].includes(role))
        await entitled(q, actor.user, "voice.speak");
      const response = await external.voiceToken(
        room.id,
        actor.user.id,
        JSON.parse(actor.user.profile).name,
        ["host", "cohost", "speaker"].includes(role),
      );
      await put(
        q,
        "participants",
        `${room.id}_${actor.user.id}`,
        {
          ...existing,
          id: `${room.id}_${actor.user.id}`,
          userId: actor.user.id,
          name: JSON.parse(actor.user.profile).name,
          roomId: room.id,
          sessionId: actor.session.id,
          role,
          joinedAt: now(),
          expiresAt: new Date(Date.now() + 180000).toISOString(),
        },
        room.id,
      );
      return { ...response, role };
    }),
  );
  app.get("/api/voice-rooms/:id/participants", async (request) => {
    const actor = await identity(
      db,
      request,
      config,
      request.headers["x-mangumi-area"] === "admin" ? "admin" : "member",
    );
    const room = await get(db, "rooms", (request.params as any).id);
    if (actor.area === "member") await entitled(db, actor.user, "voice.join");
    else permit(actor, ["super", "content", "moderator"]);
    if (
      !room ||
      (actor.area !== "admin" &&
        !contentVisible({ ...room, status: "公開" }, actor.user))
    )
      fail(403, "ルームを閲覧できません");
    return (await list(db, "participants", room.id)).map(
      ({ sessionId, ...participant }) => participant,
    );
  });
  app.post("/api/voice-rooms/:id/hand", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      await entitled(q, actor.user, "voice.speak");
      const participant = await get(
        q,
        "participants",
        `${(request.params as any).id}_${actor.user.id}`,
      );
      if (!participant) fail(403, "ルームに参加してください");
      const room = await get(q, "rooms", participant.roomId);
      if (!room || (await blocked(q, actor.user.id, room.hostId)))
        fail(403, "登壇申請を送信できません");
      participant.hand = z
        .object({ raised: z.boolean() })
        .strict()
        .parse(request.body).raised;
      await put(
        q,
        "participants",
        participant.id,
        participant,
        participant.roomId,
      );
      return { ok: true };
    }),
  );
  app.post("/api/voice-rooms/:id/leave", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member");
      const roomId = (request.params as any).id;
      if (external.roomService)
        await external.roomService
          .removeParticipant(roomId, actor.user.id)
          .catch(() => {});
      await remove(q, "participants", `${roomId}_${actor.user.id}`);
      return { ok: true };
    }),
  );
  app.post("/api/voice-rooms/:id/moderate", async (request) =>
    db.transaction(async (q) => {
      const area =
        request.headers["x-mangumi-area"] === "admin" ? "admin" : "member";
      const actor = await identity(q, request, config, area);
      const room = await get(q, "rooms", (request.params as any).id);
      if (!room) fail(404, "ルームが見つかりません");
      const host = await get(q, "participants", `${room.id}_${actor.user.id}`);
      if (area === "admin") permit(actor, ["super", "moderator", "content"]);
      else if (room.hostId !== actor.user.id && host?.role !== "cohost")
        fail(403, "司会権限が必要です");
      const body = z
        .object({
          userId: z.string().max(100),
          action: z.enum([
            "speaker",
            "listener",
            "cohost",
            "mute",
            "remove",
            "ban",
            "end",
          ]),
          reason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(request.body);
      if (!external.roomService) fail(503, "音声サーバーが未設定です");
      if (body.action === "end") {
        if (host?.role === "cohost" && area !== "admin")
          fail(403, "ホストのみ終了できます");
        await external.roomService.deleteRoom(room.id);
        room.status = "終了";
        await put(q, "rooms", room.id, room);
        for (const participant of await list(q, "participants", room.id)) {
          await notifyUser(
            q,
            participant.userId,
            `voice-end:${room.id}`,
            "音声ルームが終了しました",
            room.title,
            "/space",
            "voice",
          );
          await remove(q, "participants", participant.id);
        }
      } else {
        const target = await get(
          q,
          "participants",
          `${room.id}_${body.userId}`,
        );
        if (!target || room.hostId === body.userId)
          fail(400, "対象の参加者を確認してください");
        if (
          body.action === "cohost" &&
          room.hostId !== actor.user.id &&
          area !== "admin"
        )
          fail(403, "ホスト権限が必要です");
        if (["remove", "ban"].includes(body.action)) {
          if (body.action === "ban")
            await put(q, "roomBans", target.id, {
              userId: body.userId,
              roomId: room.id,
              at: now(),
            });
          await external.roomService.removeParticipant(room.id, body.userId);
          await remove(q, "participants", target.id);
        } else if (body.action === "mute") {
          const participant = await external.roomService.getParticipant(
            room.id,
            body.userId,
          );
          for (const track of participant.tracks)
            await external.roomService.mutePublishedTrack(
              room.id,
              body.userId,
              track.sid,
              true,
            );
        } else {
          if (body.action !== "listener") {
            const speaker = (
              await q.all<User>("SELECT * FROM users WHERE id = ?", [
                body.userId,
              ])
            )[0];
            if (!speaker || speaker.status !== "active")
              fail(403, "登壇できません");
            await entitled(q, speaker, "voice.speak");
            await consume(q, speaker, "voice.speak", {
              count: target.role === body.action ? 0 : 1,
              target: room.hostId,
              level: "send",
            });
          }
          const speakers = (await list(q, "participants", room.id)).filter(
            (row) => ["speaker", "cohost", "host"].includes(row.role),
          );
          if (
            body.action !== "listener" &&
            speakers.length >= (room.maxSpeakers ?? 8)
          )
            fail(409, "登壇人数の上限です");
          await external.roomService.updateParticipant(room.id, body.userId, {
            permission: {
              canPublish: body.action !== "listener",
              canPublishSources: [TrackSource.MICROPHONE],
              canSubscribe: true,
              canPublishData: true,
            },
          });
          target.role = body.action;
          target.hand = false;
          await put(q, "participants", target.id, target, room.id);
        }
      }
      await audit(
        q,
        actor.user.id,
        `voice.${body.action}`,
        `${room.id}/${body.userId}`,
        null,
        null,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
  app.post("/api/webhooks/livekit", async (request) => {
    if (!external.receiver) fail(503, "音声サーバーが未設定です");
    let event;
    try {
      event = await external.receiver.receive(
        (request.body as Buffer).toString(),
        request.headers.authorization,
      );
    } catch {
      fail(400, "Webhookの署名を確認できませんでした");
    }
    await db.transaction(async (q) => {
      if (
        (await q.all("SELECT id FROM webhook_events WHERE id = ?", [event.id]))
          .length
      )
        return;
      const roomId = event.room?.name,
        userId = event.participant?.identity;
      if (roomId && userId) {
        const participant = await get(q, "participants", `${roomId}_${userId}`);
        const validSession =
          participant &&
          (!participant.sessionId || (await voiceAuthorized(q, participant)));
        if (event.event === "participant_joined" && !validSession)
          await enqueue(
            q,
            digest(`invalid-voice:${event.id}`),
            "voice_kick_connection",
            { roomId, userId },
          );
        if (validSession && event.event === "participant_joined")
          await put(
            q,
            "participants",
            participant.id,
            { ...participant, sid: event.participant?.sid, expiresAt: null },
            roomId,
          );
        if (
          participant &&
          event.event === "participant_left" &&
          participant.sid === event.participant?.sid
        ) {
          await remove(q, "participants", participant.id);
          const room = await get(q, "rooms", roomId);
          if (room?.hostId === userId)
            await enqueue(
              q,
              digest(`host-left:${roomId}:${event.id}`),
              "host_check",
              { roomId },
              new Date(Date.now() + 120000).toISOString(),
            );
        }
      }
      await q.run(
        "INSERT INTO webhook_events (id,provider,processed_at) VALUES (?,?,?)",
        [event.id, "livekit", now()],
      );
    });
    return { ok: true };
  });
}
