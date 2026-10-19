import { z } from "zod";
import { randomInt } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { seed, type DemoState } from "../../member/src/model.ts";
import { get, list, put, remove, type Query } from "./db.ts";
import {
  audit,
  digest,
  fail,
  id,
  now,
  once,
  networkAllowed,
  validNetwork,
} from "./security.ts";
import { permit, roleNames, type Identity, type User } from "./auth.ts";
import { features } from "../../member/src/features.ts";

const text = z.string().trim().min(1).max(200);
const resourceId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const asset = z
  .string()
  .max(500)
  .refine(
    (value) =>
      value.startsWith("/assets/") ||
      /^\/api\/media\/[a-zA-Z0-9_-]+$/.test(value),
    "アップロード済みの画像を選んでください",
  );
const status = z.enum([
  "下書き",
  "予約",
  "公開",
  "終了",
  "アーカイブ",
  "中止",
  "延期",
  "開催中",
  "受付中",
  "開催予定",
  "停止",
  "非公開",
]);
const plan = z.string().min(1).max(80);
const scheduleSchema = z
  .object({
    id: resourceId,
    title: text,
    date: z.iso.date(),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    host: text,
    status,
    image: asset,
    url: z.url().startsWith("https://"),
    description: z.string().max(10000),
    plan,
    publishAt: z.iso.datetime().optional(),
    endAt: z.iso.datetime().optional(),
    recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
    reminderMinutes: z
      .array(z.number().int().min(1).max(10080))
      .max(5)
      .optional(),
  })
  .strict();
export const storySchema = z
  .object({
    id: resourceId,
    title: text,
    image: asset,
    status,
    plan,
    viewed: z.boolean().optional(),
    highlight: z.boolean(),
    mediaType: z.enum(["image", "video"]).optional(),
    authorId: resourceId.optional(),
    publishAt: z.iso.datetime().optional(),
    expiresAt: z.iso.datetime().optional(),
    link: z.url().startsWith("https://").optional(),
  })
  .strict();
const roomSchema = z
  .object({
    id: resourceId,
    title: text,
    host: text,
    listeners: z.number().int().min(0).max(100000),
    status,
    plan,
    hostId: resourceId.optional(),
    maxSpeakers: z.number().int().min(1).max(50).optional(),
    startsAt: z.iso.datetime().optional(),
  })
  .strict();
const planSchema = z
  .object({
    id: resourceId,
    name: plan,
    price: z.number().int().min(0).max(1000000),
    features: z.array(z.string().min(1).max(100)).max(30),
    published: z.boolean(),
    stripePrice: z.string().startsWith("price_").max(150).optional(),
    stripeYearPrice: z.string().startsWith("price_").max(150).optional(),
    yearPrice: z.number().int().min(0).max(10000000).optional(),
    description: z.string().max(2000).optional(),
    trialDays: z.number().int().min(0).max(90).optional(),
    opensAt: z.iso.datetime().optional(),
    closesAt: z.iso.datetime().optional(),
    dmPerDay: z.number().int().min(0).max(10000).optional(),
    audioSeconds: z.number().int().min(1).max(300).optional(),
    gachaPerDay: z.number().int().min(0).max(10000).optional(),
  })
  .strict();
const noticeSchema = z
  .object({
    id: resourceId,
    title: text,
    body: z.string().max(10000),
    read: z.boolean().optional(),
    status,
  })
  .strict();
export const prizeSchema = z
  .object({
    id: resourceId.optional(),
    title: text,
    rarity: z.enum(["SSR", "SR", "R", "N"]),
    weight: z
      .number()
      .min(0)
      .max(100)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
        "提供割合は小数点以下2桁までです",
      ),
    image: asset,
    stock: z.number().int().min(0).optional(),
    assetId: z.string().uuid().optional(),
    kind: z.enum(["photo", "voice", "frame"]).optional(),
  })
  .strict();
export const settingsSchema = z
  .object({
    name: text,
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    maintenance: z.boolean(),
    maintenanceText: z.string().max(2000),
    notifyDM: z.boolean(),
    notifyStory: z.boolean(),
    notifySchedule: z.boolean(),
    quiet: z.boolean(),
    quietFrom: z.string().regex(/^\d{2}:\d{2}$/),
    quietTo: z.string().regex(/^\d{2}:\d{2}$/),
    recording: z.literal(false),
    roomLimit: z.number().int().min(2).max(10000),
    audioSeconds: z.number().int().min(1).max(300),
    retention: z.number().int().min(1).max(3650),
    tipMax: z.number().int().min(100).max(100000),
    dmPolicy: z.enum(["公式配信者のみ", "不可"]),
    ngWords: z.string().max(5000),
    phase: z.string().max(100),
    billingEnabled: z.boolean().optional(),
    welcomeTickets: z.number().int().min(0).max(100).optional(),
    termsVersion: z.string().min(1).max(100).optional(),
    adminSessionMinutes: z.number().int().min(5).max(1440).optional(),
    adminNetworks: z
      .array(
        z
          .string()
          .max(100)
          .refine(validNetwork, "IPアドレスまたはCIDRを指定してください"),
      )
      .max(100)
      .optional(),
  })
  .strict();
export const schemas: Record<string, z.ZodType> = {
  schedules: scheduleSchema,
  stories: storySchema,
  rooms: roomSchema,
  plans: planSchema,
  notices: noticeSchema,
};
export const permissions: Record<string, string[]> = {
  schedules: ["super", "content"],
  stories: ["super", "content"],
  notices: ["super", "content"],
  rooms: ["super", "content", "moderator"],
  plans: ["super"],
  settings: ["super"],
  gacha: ["super", "content"],
  probabilities: ["super", "content"],
  records: ["super"],
  members: ["super", "moderator", "support"],
  reports: ["super", "moderator"],
};
export async function initializeDomain(q: Query) {
  if (!(await get(q, "settings", "global"))) {
    await put(q, "settings", "global", {
      ...seed.settings,
      phase: "正式サービス",
      recording: false,
      billingEnabled: false,
      welcomeTickets: 5,
      termsVersion: "2026-10-20",
    });
    await put(q, "plans", "free", {
      id: "free",
      name: "Free",
      price: 0,
      features: [
        "配信予定",
        "ストーリー",
        "公式DM",
        "音声ルーム",
        "無料ガチャ",
      ],
      published: true,
    });
    await put(q, "gacha", "global", {
      title: "マン組ガチャ",
      status: "下書き",
      start: "2026-01-01",
      end: "2099-12-31",
    });
    await put(q, "probabilities", "current", { version: id(), items: [] });
  }
}
export function blankState(): DemoState {
  const state = structuredClone(seed);
  state.profile = {
    ...state.profile,
    name: "ゲスト",
    email: "",
    verified: false,
    signedIn: false,
  };
  for (const name of [
    "schedules",
    "stories",
    "rooms",
    "messages",
    "members",
    "draws",
    "probabilities",
    "probabilityVersions",
    "tips",
    "reports",
    "notices",
    "campaigns",
    "sessions",
    "admins",
    "audit",
    "support",
  ] as const)
    (state[name] as unknown[]) = [];
  state.records = {};
  state.tickets = 0;
  state.activeRoom = null;
  state.adminAuthenticated = false;
  return state;
}
export async function entitled(q: Query, user: User, feature: string) {
  const labels: Record<string, string> = {
    "calendar.view": "配信予定",
    "notification.receive": "配信予定",
    "story.view": "ストーリー",
    "dm.send": "公式DM",
    "dm.audio.send": "公式DM",
    "voice.join": "音声ルーム",
    "voice.speak": "音声ルーム",
    "voice.create": "音声ルーム",
    "gacha.draw": "無料ガチャ",
    "tip.send": "投げ銭",
  };
  const profile = JSON.parse(user.profile);
  const plans = await list(q, "plans");
  const current = plans.find(
    (item) => item.name === profile.plan && item.published,
  );
  const override = await get(q, "overrides", user.id);
  if (
    (override?.expires?.[feature] ?? override?.expiresAt) > now() &&
    typeof override.features?.[feature] === "boolean"
  ) {
    if (override.features[feature]) return;
    fail(403, "この機能は利用できません");
  }
  if (
    !current ||
    !current.features.some(
      (name: string) =>
        name === feature ||
        name === labels[feature] ||
        ((feature === "dm.send" || feature === "dm.audio.send") &&
          name === "DM"),
    )
  )
    fail(403, "この機能は現在のプランでは利用できません", "plan_required");
}
export async function planLimits(q: Query, user: User) {
  return (
    (await list(q, "plans")).find(
      (plan) => plan.name === JSON.parse(user.profile).plan,
    ) ?? {}
  );
}
export async function queueStory(q: Query, story: any) {
  if (story.status !== "公開") return;
  const key = digest(`story:${story.id}:${story.publishAt}`);
  if (!(await q.all("SELECT id FROM jobs WHERE id = ?", [key])).length)
    await q.run(
      "INSERT INTO jobs (id,kind,payload,due_at,state,attempts) VALUES (?,?,?,?,?,0)",
      [
        key,
        "story",
        JSON.stringify({ storyId: story.id, publishAt: story.publishAt }),
        story.publishAt || now(),
        "pending",
      ],
    );
}
export function contentVisible(item: any, user: User | undefined) {
  if (
    item.status !== "公開" &&
    item.status !== "開催中" &&
    item.status !== "開催予定"
  )
    return false;
  if (item.publishAt && item.publishAt > now()) return false;
  if (!item.highlight && item.expiresAt && item.expiresAt <= now())
    return false;
  return (
    item.plan === "Free" ||
    (!!user && JSON.parse(user.profile).plan === item.plan)
  );
}
export async function snapshot(q: Query, actor?: Identity) {
  const state = blankState();
  state.entitlements = {};
  state.settings = (await get(q, "settings", "global"))!;
  state.plans = await list(q, "plans");
  if (actor?.area !== "admin")
    state.plans = state.plans.filter((item) => item.published);
  state.gacha = (await get(q, "gacha", "global"))!;
  for (const record of await list(q, "records"))
    if (/^A0(75|76|77|78|79|81)$/.test(record.id))
      state.records[record.id] = record.values;
  const probability = await get(q, "probabilities", "current");
  state.probabilities = probability.items;
  state.probabilityVersion = probability.version;
  for (const name of ["schedules", "stories", "rooms", "notices"] as const) {
    const rows = await list(q, name);
    (state as any)[name] =
      actor?.area === "admin"
        ? rows
        : rows.filter((item) =>
            contentVisible({ plan: "Free", ...item }, actor?.user),
          );
  }
  if (!actor) {
    state.schedules = [];
    state.notices = [];
    state.stories = [];
    state.rooms = [];
    return state;
  }
  state.profile = {
    ...JSON.parse(actor.user.profile),
    email: actor.user.email,
    verified: !!actor.user.verified,
    signedIn: true,
  };
  if (!actor.user.verified) {
    state.schedules = [];
    state.notices = [];
    state.stories = [];
    state.rooms = [];
    return state;
  }
  const preferences = await get(q, "preferences", actor.user.id);
  if (actor.area === "member") {
    for (const feature of Object.keys(features)) {
      try {
        await entitled(q, actor.user, feature);
        state.entitlements[feature] = true;
      } catch {
        state.entitlements[feature] = false;
      }
    }
    for (const [resource, feature] of [
      ["schedules", "calendar.view"],
      ["stories", "story.view"],
      ["rooms", "voice.join"],
    ] as const) {
      try {
        await entitled(q, actor.user, feature);
      } catch {
        state[resource] = [] as any;
      }
    }
    state.settings = { ...state.settings, ...preferences?.settings };
    state.reminders = preferences?.reminders ?? ["1時間前", "10分前"];
    state.blocked = preferences?.blocked ?? false;
    state.conversationMuted = preferences?.conversationMuted ?? false;
  }
  state.tickets = (await get(q, "wallet", actor.user.id))?.balance ?? 0;
  state.draws = (await list(q, "draws", actor.user.id)).sort((a, b) =>
    b.at.localeCompare(a.at),
  );
  state.tips = (await list(q, "tips", actor.user.id)).sort((a, b) =>
    b.at.localeCompare(a.at),
  );
  state.support = await list(q, "support", actor.user.id);
  state.paymentMethod = !!(await get(q, "paymentCustomer", actor.user.id))
    ?.paymentMethod;
  const views = await list(q, "storyViews", actor.user.id);
  const noticeReads = await list(q, "noticeReads", actor.user.id);
  state.notices = state.notices.map((notice) => ({
    ...notice,
    read: noticeReads.some((read) => read.noticeId === notice.id),
  }));
  state.stories = state.stories.map((story) => ({
    ...story,
    viewed: views.some((view) => view.storyId === story.id),
  }));
  state.sessions = (
    await q.all(
      "SELECT id,agent FROM sessions WHERE user_id = ? AND expires_at > ?",
      [actor.user.id, now()],
    )
  ).map((row) => ({
    id: row.id,
    name: row.agent,
    current: row.id === actor.session.id,
    location: "",
  }));
  if (actor.area === "admin") {
    state.adminAuthenticated = true;
    const users = await q.all<User>(
      "SELECT * FROM users ORDER BY created_at DESC",
    );
    state.admins = users
      .filter(
        (user) =>
          actor.user.role === "super" &&
          (roleNames[user.role] || user.role === "official"),
      )
      .map((user) => ({
        id: user.id,
        name: JSON.parse(user.profile).name,
        role: roleNames[user.role] ?? "公式配信者",
        mfa: !!user.mfa_secret,
        status: user.status === "active" ? "有効" : "停止",
      }));
    if (["super", "moderator", "support"].includes(actor.user.role)) {
      // Member searches use the paged endpoint instead of sending every account to every screen.
      state.members = [];
      if (["super", "support"].includes(actor.user.role))
        state.support = await list(q, "support");
    }
    if (["super", "moderator"].includes(actor.user.role))
      state.reports = (await list(q, "reports")).map(
        ({ evidence, ...report }) => report,
      );
    if (["super", "finance"].includes(actor.user.role))
      state.tips = await list(q, "tips");
    if (["super", "content"].includes(actor.user.role))
      state.draws = await list(q, "draws");
    state.probabilityVersions = await list(q, "probabilityVersions");
    const records = await list(q, "records");
    state.records = Object.fromEntries(
      records
        .filter((record) => canReadRecord(actor, record.id))
        .map((record) => [record.id, record.values]),
    );
    state.campaigns = await list(q, "campaigns");
    const logs = await q.all(
      "SELECT * FROM audit_logs" +
        (actor.user.role === "super" ? "" : " WHERE actor_id = ?") +
        " ORDER BY created_at DESC LIMIT 500",
      actor.user.role === "super" ? [] : [actor.user.id],
    );
    state.audit = logs.map((row) => ({
      id: row.id,
      action: row.action,
      target: row.target,
      before: row.before_json,
      after: row.after_json,
      reason: row.reason,
      at: row.created_at,
      actor: users.find((user) => user.id === row.actor_id)
        ? JSON.parse(users.find((user) => user.id === row.actor_id)!.profile)
            .name
        : row.actor_id,
      ip: row.ip,
    }));
  }
  return state;
}
export function canReadRecord(actor: Identity, screen: string) {
  const number = Number(screen.slice(1));
  const role =
    number >= 90
      ? ["super"]
      : number >= 82
        ? ["super"]
        : number >= 75
          ? ["super", "content"]
          : number >= 67
            ? ["super", "content"]
            : number >= 60
              ? ["super", "finance"]
              : number >= 52
                ? ["super", "moderator"]
                : number >= 45
                  ? ["super", "content", "moderator"]
                  : number >= 25
                    ? ["super", "content"]
                    : number >= 18
                      ? ["super"]
                      : ["super", "support", "moderator"];
  return role.includes(actor.user.role);
}
export const mutationSchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            resource: z.string().max(50),
            id: resourceId.optional(),
            before: z.unknown().optional(),
            after: z.unknown().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    reason: z.string().min(1).max(2000),
    action: z.string().min(1).max(100),
  })
  .strict();
export async function mutate(
  q: Query,
  actor: Identity,
  input: unknown,
  ip: string,
) {
  const body = mutationSchema.parse(input);
  for (const change of body.changes) {
    const { resource, id: entityId = "global", before, after } = change;
    if (actor.area === "member") {
      if (resource === "profile") {
        const patch = z
          .object({
            name: z.string().trim().min(2).max(30),
            gender: z.enum(["男性", "女性", "その他", "回答しない"]),
            publicGender: z.boolean(),
            avatar: asset,
          })
          .partial()
          .strict()
          .parse(after);
        if (patch.name) {
          const settings = await get(q, "settings", "global");
          if (
            settings.ngWords
              .split(/[,、\n]/)
              .map((word: string) => word.trim())
              .filter(Boolean)
              .some((word: string) => patch.name!.includes(word))
          )
            fail(400, "別のニックネームを選んでください");
        }
        await q.run("UPDATE users SET profile = ? WHERE id = ?", [
          JSON.stringify({ ...JSON.parse(actor.user.profile), ...patch }),
          actor.user.id,
        ]);
        actor.user.profile = JSON.stringify({
          ...JSON.parse(actor.user.profile),
          ...patch,
        });
        if (patch.avatar) {
          const profile = JSON.parse(actor.user.profile);
          delete profile.baseAvatar;
          delete profile.frameDrawId;
          actor.user.profile = JSON.stringify(profile);
          await q.run("UPDATE users SET profile = ? WHERE id = ?", [
            actor.user.profile,
            actor.user.id,
          ]);
        }
      } else if (
        ["reminders", "conversationMuted", "blocked", "settings"].includes(
          resource,
        )
      ) {
        const saved = (await get(q, "preferences", actor.user.id)) ?? {};
        if (resource === "reminders")
          saved.reminders = z
            .array(z.enum(["24時間前", "1時間前", "10分前"]))
            .max(3)
            .parse(after);
        else if (resource === "settings")
          saved.settings = {
            ...saved.settings,
            ...z
              .object({
                notifyDM: z.boolean(),
                notifyStory: z.boolean(),
                notifySchedule: z.boolean(),
                quiet: z.boolean(),
                quietFrom: z.string().regex(/^\d{2}:\d{2}$/),
                quietTo: z.string().regex(/^\d{2}:\d{2}$/),
              })
              .partial()
              .strict()
              .parse(after),
          };
        else saved[resource] = z.boolean().parse(after);
        await put(q, "preferences", actor.user.id, saved, actor.user.id);
      } else if (resource === "stories") {
        await entitled(q, actor.user, "story.view");
        const story = await get(q, "stories", entityId);
        if (
          !story ||
          !contentVisible(story, actor.user) ||
          !(after as any)?.viewed
        )
          fail(403, "閲覧できないストーリーです");
        await put(
          q,
          "storyViews",
          `${actor.user.id}_${entityId}`,
          { storyId: entityId, at: now() },
          actor.user.id,
        );
      } else if (resource === "notices") {
        if (!(after as any)?.read || !(await get(q, "notices", entityId)))
          fail(400, "お知らせが見つかりません");
        await put(
          q,
          "noticeReads",
          `${actor.user.id}_${entityId}`,
          { noticeId: entityId, at: now() },
          actor.user.id,
        );
      } else if (resource === "support") {
        const data = z
          .object({
            id: resourceId,
            subject: text,
            body: z.string().min(1).max(10000),
            status: z.string().max(30),
          })
          .strict()
          .parse(after);
        await put(
          q,
          "support",
          data.id,
          { ...data, userId: actor.user.id, status: "未対応", at: now() },
          actor.user.id,
        );
      } else fail(403, "このデータは専用の操作から変更してください");
    } else {
      if (!permissions[resource]) fail(403, "変更できないデータです");
      if (resource !== "records") permit(actor, permissions[resource]);
      if (resource === "members") {
        const patch = z
          .object({
            id: resourceId,
            name: text,
            email: z.email(),
            plan,
            status: z.enum(["有効", "停止", "一時停止", "永久停止", "退会"]),
            joined: z.string(),
          })
          .strict()
          .parse(after);
        const user = (
          await q.all<User>("SELECT * FROM users WHERE id = ?", [entityId])
        )[0];
        if (!user) fail(404, "会員が見つかりません");
        if (patch.email.toLowerCase() !== user.email.toLowerCase())
          fail(400, "メールアドレスは本人による確認手続きから変更してください");
        if (
          actor.user.role !== "super" &&
          patch.plan !== JSON.parse(user.profile).plan
        )
          fail(403, "プラン変更の権限がありません");
        if (
          actor.user.role === "support" &&
          patch.status !== (user.status === "active" ? "有効" : "停止")
        )
          fail(403, "会員停止の権限がありません");
        if (user.id === actor.user.id && patch.status !== "有効")
          fail(400, "自分自身を停止できません");
        if (roleNames[user.role] && actor.user.role !== "super")
          fail(403, "管理者の変更権限がありません");
        if (!(await list(q, "plans")).some((item) => item.name === patch.plan))
          fail(400, "プランが存在しません");
        await q.run("UPDATE users SET profile = ?, status = ? WHERE id = ?", [
          JSON.stringify({
            ...JSON.parse(user.profile),
            name: patch.name,
            plan: patch.plan,
          }),
          patch.status === "有効" ? "active" : "suspended",
          entityId,
        ]);
        if (patch.status !== "有効")
          await q.run("DELETE FROM sessions WHERE user_id = ?", [entityId]);
        if (patch.status !== "有効")
          await q.run(
            "INSERT INTO jobs (id,kind,payload,due_at,state,attempts) VALUES (?,?,?,?,?,0)",
            [
              id(),
              "voice_kick_user",
              JSON.stringify({ userId: entityId }),
              now(),
              "pending",
            ],
          );
      } else if (resource === "settings") {
        const old = await get(q, "settings", "global");
        const patch = settingsSchema.partial().parse(after);
        if (patch.adminNetworks && !networkAllowed(patch.adminNetworks, ip))
          fail(400, "現在の接続元IPを許可リストに含めてください");
        await put(
          q,
          "settings",
          "global",
          settingsSchema.parse({ ...old, ...patch }),
        );
      } else if (resource === "records") {
        if (!/^A\d{3}$/.test(entityId)) fail(400, "設定IDが正しくありません");
        if (!canReadRecord(actor, entityId))
          fail(403, "設定の権限がありません");
        const values = z
          .record(z.string().max(80), z.string().max(10000))
          .parse(after);
        if (
          Object.keys(values).some((key) =>
            /secret|password|private|apiKey/i.test(key),
          )
        )
          fail(400, "秘密情報は環境設定に保存してください");
        await put(q, "records", entityId, { id: entityId, values });
      } else if (resource === "probabilities") {
        const items = z.array(prizeSchema).min(1).max(100).parse(after);
        if (
          items.reduce(
            (sum, item) => sum + Math.round(item.weight * 100),
            0,
          ) !== 10000
        )
          fail(400, "提供割合の合計を厳密に100%にしてください");
        const current = await get(q, "probabilities", "current");
        for (const prize of items) {
          if (prize.assetId) {
            const file = await get(q, "media", prize.assetId);
            if (
              !file ||
              file.kind !==
                (prize.kind === "voice" ? "rewardAudio" : "rewardImage")
            )
              fail(400, "景品に合う専用ファイルをアップロードしてください");
          }
          const key = prize.id ?? digest(`${prize.title}:${prize.image}`);
          const old = current.items.find(
            (item: any) =>
              (item.id ?? digest(`${item.title}:${item.image}`)) === key,
          );
          const inventory = await get(q, "inventory", key);
          if (prize.stock !== old?.stock) {
            const distributed =
              old?.stock !== undefined && inventory?.remaining !== undefined
                ? old.stock - inventory.remaining
                : (await list(q, "draws")).filter(
                    (draw) =>
                      draw.prizeId === key ||
                      (!draw.prizeId &&
                        draw.title === prize.title &&
                        draw.image === prize.image),
                  ).length;
            if (prize.stock !== undefined && prize.stock < distributed)
              fail(400, "在庫総数は配布済みの数量以上にしてください");
            await put(q, "inventory", key, {
              remaining:
                prize.stock === undefined
                  ? undefined
                  : prize.stock - distributed,
            });
          }
        }
        if (current.items.length)
          await put(q, "probabilityVersions", current.version, {
            ...current,
            at: now(),
          });
        await put(q, "probabilities", "current", { version: id(), items });
      } else if (resource === "gacha") {
        const data = z
          .object({
            title: text,
            status,
            start: z.iso.date(),
            end: z.iso.date(),
            description: z.string().max(5000).optional(),
            plan: z.string().max(80).optional(),
            ticketCost: z.number().int().min(1).max(100).optional(),
            maxBatch: z.number().int().min(1).max(10).optional(),
            dailyTickets: z.number().int().min(0).max(100).optional(),
            maxPerUser: z.number().int().min(1).max(1000000).optional(),
          })
          .strict()
          .parse(after);
        if (data.end < data.start) fail(400, "開催期間を確認してください");
        if (
          data.status === "公開" &&
          !(await get(q, "probabilities", "current"))?.items.length
        )
          fail(400, "先に景品と提供割合を設定してください");
        await put(q, resource, "global", data);
      } else if (resource === "reports") {
        const current = await get(q, resource, entityId);
        if (!current) fail(404, "通報が見つかりません");
        const patch = z
          .object({ status: z.string().max(40), assignee: z.string().max(100) })
          .partial()
          .strict()
          .parse(after);
        await put(q, resource, entityId, { ...current, ...patch });
      } else {
        const current = await get(q, resource, entityId);
        const cleanBefore =
          before && typeof before === "object"
            ? ({ ...before } as any)
            : before;
        if (cleanBefore && resource === "stories") delete cleanBefore.viewed;
        if (current && cleanBefore && !isDeepStrictEqual(current, cleanBefore))
          fail(409, "別の操作で更新されています。再読み込みしてください");
        if (after === undefined || after === null) {
          if (resource === "plans" && current?.name === "Free")
            fail(400, "Freeプランは削除できません");
          if (
            resource === "plans" &&
            current &&
            (await q.all<User>("SELECT * FROM users")).some(
              (user) => JSON.parse(user.profile).plan === current.name,
            )
          )
            fail(409, "所属会員がいるプランは削除できません");
          await remove(q, resource, entityId);
        } else {
          const parsed = schemas[resource].parse(after) as any;
          if (parsed.id !== entityId) fail(400, "対象IDが一致しません");
          if (resource === "plans") {
            if (
              (await list(q, "plans")).some(
                (item) => item.id !== entityId && item.name === parsed.name,
              )
            )
              fail(409, "同じ名前のプランが存在します");
            if (parsed.name === "Free" && entityId !== "free")
              fail(400, "Freeプランは追加できません");
            if (current && current.name !== parsed.name) {
              for (const user of await q.all<User>("SELECT * FROM users")) {
                const profile = JSON.parse(user.profile);
                if (profile.plan === current.name)
                  await q.run("UPDATE users SET profile = ? WHERE id = ?", [
                    JSON.stringify({ ...profile, plan: parsed.name }),
                    user.id,
                  ]);
              }
            }
          }
          if (
            resource === "plans" &&
            current?.name === "Free" &&
            (parsed.name !== "Free" || parsed.price !== 0 || !parsed.published)
          )
            fail(400, "Freeプランは常に無料で公開してください");
          if (resource === "stories") {
            delete parsed.viewed;
            parsed.publishAt ??= now();
            parsed.expiresAt ??= new Date(Date.now() + 86400000).toISOString();
          }
          if (resource === "rooms") {
            parsed.listeners = 0;
            parsed.hostId ??= actor.user.id;
          }
          await put(q, resource, entityId, parsed);
          if (resource === "stories") await queueStory(q, parsed);
        }
      }
      await audit(
        q,
        actor.user.id,
        body.action,
        `${resource}/${entityId}`,
        before,
        after,
        body.reason,
        ip,
      );
    }
  }
  return { ok: true };
}
export async function draw(
  q: Query,
  actor: Identity,
  count: number,
  requestKey: string,
) {
  await entitled(q, actor.user, "gacha.draw");
  return once(q, `gacha:${actor.user.id}`, requestKey, { count }, async () => {
    const campaign = await get(q, "gacha", "global");
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (
      campaign.status !== "公開" ||
      today < campaign.start ||
      today > campaign.end
    )
      fail(409, "現在開催中のガチャはありません");
    const wallet = (await get(q, "wallet", actor.user.id)) ?? { balance: 0 };
    if (
      campaign.plan &&
      campaign.plan !== "Free" &&
      JSON.parse(actor.user.profile).plan !== campaign.plan
    )
      fail(403, "このキャンペーンは対象プラン限定です");
    if (count > (campaign.maxBatch ?? 10))
      fail(400, "一度に抽選できる回数を超えています");
    const cost = count * (campaign.ticketCost ?? 1);
    const ownDraws = (await list(q, "draws", actor.user.id)).filter(
      (draw) =>
        draw.at.slice(0, 10) >= campaign.start &&
        draw.at.slice(0, 10) <= campaign.end &&
        !draw.version.startsWith("compensation:"),
    );
    if (ownDraws.length + count > (campaign.maxPerUser ?? 1000000))
      fail(409, "キャンペーンの抽選上限に達しています");
    const limits = await planLimits(q, actor.user);
    const todayDraws = (await list(q, "draws", actor.user.id)).filter(
      (draw) =>
        new Date(Date.parse(draw.at) + 9 * 3600000)
          .toISOString()
          .slice(0, 10) === today && !draw.version.startsWith("compensation:"),
    ).length;
    if (todayDraws + count > (limits.gachaPerDay ?? 100))
      fail(409, "本日の抽選上限に達しています");
    if (wallet.balance < cost) fail(409, "チケットが足りません");
    const probabilities = await get(q, "probabilities", "current");
    const items = z.array(prizeSchema).min(1).parse(probabilities.items);
    if (
      items.reduce(
        (total, item) => total + Math.round(item.weight * 100),
        0,
      ) !== 10000
    )
      fail(409, "提供割合を確認してください");
    const results = [];
    for (let index = 0; index < count; index++) {
      let cursor = randomInt(10000);
      const prize = items.find((item) => {
        cursor -= Math.round(item.weight * 100);
        return cursor < 0;
      })!;
      const inventoryKey = prize.id ?? digest(`${prize.title}:${prize.image}`);
      const inventory = (await get(q, "inventory", inventoryKey)) ?? {
        remaining: prize.stock,
      };
      if (inventory.remaining !== undefined) {
        if (inventory.remaining < 1)
          fail(409, "景品の在庫を確認しています。チケットは消費されません");
        inventory.remaining--;
        await put(q, "inventory", inventoryKey, inventory);
      }
      const result = {
        id: id(),
        prizeId: inventoryKey,
        title: prize.title,
        rarity: prize.rarity,
        image: prize.image,
        assetId: prize.assetId,
        kind: prize.kind,
        at: now(),
        version: probabilities.version,
      };
      await put(q, "draws", result.id, result, actor.user.id);
      results.push(result);
    }
    wallet.balance -= cost;
    await put(q, "wallet", actor.user.id, wallet, actor.user.id);
    await put(
      q,
      "ticketLedger",
      id(),
      {
        delta: -cost,
        balance: wallet.balance,
        reason: "抽選",
        at: now(),
        requestKey,
      },
      actor.user.id,
    );
    return { results, balance: wallet.balance };
  });
}
