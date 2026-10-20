import { z } from "zod";
import { schemas, storySchema, prizeSchema, mutationSchema } from "./domain.ts";
import { brandSchema } from "./operations.ts";
import { notificationSchema, audienceSchema } from "./notifications.ts";
import { retentionSchema } from "./retention.ts";
import { campaignSchema } from "./campaigns.ts";
import { installGuideSchema } from "./install-guides.ts";
import { qualitySchema, alertPolicySchema } from "./monitoring.ts";
import { checkoutSchema } from "./checkout.ts";
import { featurePolicySchema } from "./limits.ts";
import { featureDefinitionSchema } from "./features.ts";
import { emailTemplateSchema } from "./email.ts";
import { features } from "../../member/src/features.ts";
const s = z.string(),
  identifier = s.min(1).max(100),
  reason = s.min(5).max(2000),
  email = z.email(),
  code = s.min(6).max(100),
  date = z.iso.datetime();
const object = (shape: Record<string, z.ZodType>) => z.object(shape).strict();
const arbitrary = z.record(z.string(), z.unknown());
const empty = object({}),
  ok = object({ ok: z.boolean() });
const reasons = object({ reason });
const bodies: Record<string, z.ZodType> = {
  "POST /api/admin/monitoring": object({ policy: alertPolicySchema, reason }),
  "POST /api/admin/features": object({
    feature: featureDefinitionSchema,
    reason,
  }),
  "POST /api/admin/email-templates": object({
    template: emailTemplateSchema,
    reason,
  }),
  "POST /api/auth/register": object({
    name: s.trim().min(2).max(30),
    email,
    password: s.min(12).max(128),
    gender: z.enum(["男性", "女性", "その他", "回答しない"]),
    avatar: s,
    termsVersion: s,
  }),
  "POST /api/auth/verify": object({ token: s.min(20).max(100) }),
  "POST /api/auth/password/reset": object({
    token: s.min(20).max(100),
    password: s.min(12).max(128),
  }),
  "POST /api/me/email": object({ email, password: s }),
  "POST /api/me/close": object({ password: s, reason: s.max(2000).optional() }),
  "POST /api/me/frame": object({ drawId: s.max(100).nullable() }),
  "POST /api/admin/auth/mfa/verify": object({ code }),
  "POST /api/official/stories": storySchema.omit({
    id: true,
    authorId: true,
    viewed: true,
  }),
  "POST /api/official/voice-rooms": object({
    title: s.min(1).max(200),
    plan: s,
    startsAt: date.optional(),
    maxSpeakers: z.number().int().min(1).max(20).optional(),
    maxMinutes: z.number().int().min(1).max(1440).optional(),
    maxListeners: z.number().int().min(1).max(10000).optional(),
    description: s.max(5000).optional(),
    visibility: z.enum(["public", "plan", "invite"]).optional(),
    invited: z.array(identifier).max(1000).optional(),
    reactions: z.boolean().optional(),
  }),
  "POST /api/voice-rooms/{id}/reaction": object({
    emoji: z.enum(["❤️", "👏", "🔥", "😂", "🎉"]),
  }),
  "POST /api/voice-rooms/{id}/moderate": object({
    userId: identifier,
    action: z.enum([
      "speaker",
      "listener",
      "cohost",
      "mute",
      "remove",
      "ban",
      "end",
    ]),
    reason: s.min(1).max(2000),
  }),
  "POST /api/voice-rooms/{id}/quality": qualitySchema,
  "POST /api/conversations": object({ peer: identifier }),
  "POST /api/conversations/{id}/messages": object({
    text: s.max(2000).optional(),
    mediaId: identifier.optional(),
  }),
  "PATCH /api/conversations/{id}": object({
    muted: z.boolean().optional(),
    read: z.boolean().optional(),
  }),
  "DELETE /api/messages/{id}": object({ scope: z.enum(["self", "retract"]) }),
  "POST /api/blocks": object({ userId: identifier }),
  "POST /api/reports": object({
    type: z.enum(["message", "room", "user", "tip"]),
    targetId: identifier,
    reason,
  }),
  "POST /api/billing/checkout": checkoutSchema,
  "POST /api/billing/cancel": object({ confirmed: z.literal(true) }),
  "POST /api/admin/refunds": object({
    tipId: identifier,
    amount: z.number().int().min(1),
    reason,
    code: s.length(6),
  }),
  "POST /api/admin/users/{id}/overrides": object({
    feature: z.enum(Object.keys(features) as [string, ...string[]]),
    allowed: z.boolean(),
    expiresAt: date,
    reason,
  }),
  "POST /api/admin/reports/{id}/action": object({
    action: z.enum(["warn", "suspend", "remove", "dismiss"]),
    reason,
  }),
  "PATCH /api/admin/support/{id}": object({
    status: z.enum(["未対応", "対応中", "対応済み"]),
    reply: s.max(10000),
    reason: s.min(1).max(2000),
  }),
  "POST /api/admin/brand": object({
    values: brandSchema,
    publish: z.boolean(),
    publishAt: date.optional(),
    reason: s.min(1).max(2000),
  }),
  "POST /api/admin/members/{id}/plan": object({
    planId: identifier,
    applyAt: date.optional(),
    reason,
  }),
  "POST /api/admin/members/{id}/status": object({
    action: z.enum(["warn", "suspend", "restore"]),
    until: date.optional(),
    reason,
  }),
  "POST /api/admin/members/{id}/requests": object({
    type: z.enum(["情報開示", "情報訂正", "データ削除", "退会対応"]),
    verified: z.literal(true),
    reason,
  }),
  "PATCH /api/admin/members/{id}/requests/{requestId}": object({
    status: z.enum(["調査中", "対応完了", "却下"]),
    reason,
    name: s.min(2).max(30).optional(),
  }),
  "POST /api/admin/notification-audience": audienceSchema,
  "POST /api/admin/notifications": notificationSchema,
  "POST /api/admin/notifications/test": notificationSchema,
  "POST /api/admin/notification-templates": object({
    id: z.uuid().optional(),
    name: s.min(1).max(100),
    title: s.min(1).max(100),
    body: s.min(1).max(500),
    path: notificationSchema.shape.path,
    reason: s.min(1).max(2000),
  }),
  "PUT /api/admin/retention": object({ policy: retentionSchema, reason }),
  "POST /api/admin/retention/run": object({
    reason,
    confirmed: z.literal(true),
  }),
  "POST /api/admin/gacha/versions": object({
    items: z.array(prizeSchema).min(1).max(100),
    effectiveAt: date,
    reason,
  }),
  "POST /api/admin/gacha/campaigns": object({
    campaign: campaignSchema,
    reason,
  }),
  "POST /api/admin/install-guides": object({
    guide: installGuideSchema,
    reason,
  }),
  "POST /api/commands": mutationSchema,
  "POST /api/gacha/draw": object({
    count: z.number().int().min(1).max(10),
    campaignId: identifier.optional(),
  }),
  "POST /api/gacha/daily-tickets": object({
    campaignId: identifier.optional(),
  }),
  "POST /api/admin/gacha/grant": object({
    userId: identifier,
    tickets: z.number().int().min(1).max(10000).optional(),
    prize: s.max(200).optional(),
    reason,
  }),
  "POST /api/admin/users": object({
    name: s.min(2).max(30),
    email,
    role: z.enum([
      "super",
      "content",
      "moderator",
      "support",
      "finance",
      "official",
    ]),
    reason,
  }),
  "PATCH /api/admin/users/{id}/role": object({
    role: z.enum([
      "member",
      "official",
      "super",
      "content",
      "moderator",
      "support",
      "finance",
    ]),
    reason,
  }),
  "POST /api/push-subscriptions": object({
    endpoint: z.url().max(2000),
    keys: object({ p256dh: s, auth: s }),
    expirationTime: z.number().nullable().optional(),
  }),
};
for (const area of ["auth", "admin/auth"])
  bodies[`POST /api/${area}/login`] = object({
    email,
    password: s.min(1).max(128),
  });
for (const path of ["/api/auth/resend", "/api/auth/password/request"])
  bodies[`POST ${path}`] = object({ email });
for (const path of [
  "/api/admin/reports/{id}/evidence",
  "/api/admin/jobs/{id}/retry",
  "/api/admin/brand/{id}/restore",
  "/api/admin/members/{id}/sessions/revoke",
  "/api/admin/members/{id}/export",
  "/api/admin/notifications/{id}/cancel",
  "/api/admin/gacha/versions/{id}/cancel",
])
  bodies[`POST ${path}`] = reasons;
for (const path of [
  "/api/admin/notification-templates/{id}",
  "/api/admin/install-guides/{id}",
])
  bodies[`DELETE ${path}`] = reasons;
const toSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "openapi-3.0", unrepresentable: "any" });
const responses: Record<string, z.ZodType> = {
  "POST /api/billing/checkout": object({ url: z.url(), sessionId: s }),
  "POST /api/billing/portal": object({ url: z.url() }),
  "POST /api/conversations": object({ id: s }),
  "POST /api/gacha/draw": object({
    results: z.array(
      object({
        id: s,
        title: s,
        rarity: s,
        image: s,
        at: date,
        version: s,
        assetId: s.optional(),
        kind: z.enum(["photo", "voice", "frame"]).optional(),
        campaignId: s.optional(),
        prizeId: s,
      }),
    ),
    balance: z.number().int(),
  }),
  "POST /api/gacha/daily-tickets": object({ balance: z.number().int() }),
  "POST /api/voice-rooms/{id}/token": object({
    token: s,
    url: s,
    role: z.enum(["host", "cohost", "speaker", "listener"]),
  }),
  "POST /api/uploads": object({
    id: s,
    url: s,
    duration: z.number().optional(),
  }),
  "POST /api/media/{id}/url": object({ url: s }),
  "POST /api/admin/notification-audience": object({
    count: z.number().int(),
    sample: z.array(object({ id: s, name: s })),
  }),
  "POST /api/admin/notifications/test": object({
    queued: z.boolean(),
    devices: z.number().int(),
  }),
  "POST /api/admin/notifications": object({ id: s }),
  "POST /api/admin/notification-templates": object({ id: s }),
  "POST /api/admin/gacha/versions": object({ id: s }),
  "POST /api/admin/gacha/campaigns": object({ id: s }),
  "GET /api/health": object({ ok: z.boolean(), time: date }),
  "GET /api/brand": brandSchema
    .partial()
    .extend({ version: s.optional(), publishedAt: date.optional() }),
  "GET /api/gacha/campaigns": z.array(
    campaignSchema
      .omit({ oddsVersion: true })
      .extend({ id: s, oddsVersion: s.optional() }),
  ),
  "GET /api/install-guides": z.array(installGuideSchema),
  "GET /api/admin/install-guides": z.array(installGuideSchema),
};
export function apiSpecification(raw: any) {
  const doc = structuredClone(raw);
  doc.info.description =
    "PWA・管理画面で共用するREST API。日時はUTC ISO 8601。管理者はMFA必須。変更操作は同一Origin、X-Mangumi-Request、CSRFが必要。金銭・抽選などの再送には同じIdempotency-Keyを使用します。";
  doc.components.schemas = {
    ...doc.components.schemas,
    Brand: toSchema(brandSchema),
    Campaign: toSchema(campaignSchema),
    FeaturePolicy: toSchema(featurePolicySchema),
    Problem: toSchema(object({ code: s, message: s })),
  };
  doc.components.securitySchemes = {
    memberCookie: {
      type: "apiKey",
      in: "cookie",
      name: "__Host-mangumi-member",
    },
    adminCookie: { type: "apiKey", in: "cookie", name: "__Host-mangumi-admin" },
  };
  for (const [path, item] of Object.entries<any>(doc.paths))
    for (const [method, operation] of Object.entries<any>(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const key = `${method.toUpperCase()} ${path}`;
      operation.operationId = method + path.replace(/[^a-zA-Z0-9]+/g, "_");
      operation.tags = [
        path.includes("/admin/")
          ? "admin"
          : path.includes("/auth/")
            ? "authentication"
            : (path.split("/")[2] ?? "public"),
      ];
      operation.summary = key;
      const publicRoute =
        /^\/api\/(health|readiness|config|features|openapi.json|brand(?:\/icon\/\{size\})?|install-guides|auth\/(register|login|resend|verify|password\/(request|reset))|admin\/auth\/login|webhooks\/(stripe|livekit))$/.test(
          path,
        ) || path === "/manifest.json";
      operation.security = publicRoute
        ? []
        : [{ [path.includes("/admin/") ? "adminCookie" : "memberCookie"]: [] }];
      operation.parameters = [
        ...(path.match(/\{[^}]+\}/g) ?? []).map((p: string) => ({
          name: p.slice(1, -1),
          in: "path",
          required: true,
          schema: { type: "string", maxLength: 100 },
        })),
      ];
      if (!["get"].includes(method) && !path.includes("/webhooks/"))
        for (const name of [
          "X-Mangumi-Request",
          "X-CSRF-Token",
          "Idempotency-Key",
        ])
          operation.parameters.push({
            name,
            in: "header",
            required: name === "X-Mangumi-Request",
            schema: { type: "string" },
            description:
              name === "Idempotency-Key"
                ? "再送時に同じ8〜100文字のキーを使用（抽選・決済・commands・補填・配信・プラン変更で必須）"
                : "",
          });
      if (bodies[key])
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: toSchema(bodies[key]) } },
        };
      else if (method !== "get" && !["/api/uploads"].includes(path))
        operation.requestBody = {
          required: false,
          content: {
            [path.includes("/webhooks/")
              ? "application/webhook+json"
              : "application/json"]: {
              schema: path.includes("/webhooks/")
                ? {
                    type: "object",
                    additionalProperties: true,
                    description: "事業者の署名対象となる未加工のイベントJSON",
                  }
                : toSchema(empty),
            },
          },
        };
      if (path === "/api/uploads")
        operation.requestBody = {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        };
      for (const status of [400, 401, 403, 404, 409, 413, 429, 503])
        operation.responses[status] = {
          description: (
            {
              400: "入力形式・検証エラー",
              401: "ログインが必要",
              403: "権限・CSRF・署名エラー",
              404: "対象なし",
              409: "競合・在庫・業務上限",
              413: "容量超過",
              429: "レート・プラン回数上限",
              503: "メンテナンス・外部接続設定待ち",
            } as any
          )[status],
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Problem" },
            },
          },
        };
      operation.responses[200] ??= { description: "成功" };
      operation.responses[200].content = {
        "application/json": { schema: toSchema(responses[key] ?? arbitrary) },
      };
      if (["/api/media/{id}", "/api/brand/icon/{size}"].includes(path))
        operation.responses[200].content = {
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        };
      const query: Record<string, string> = {};
      if (path === "/api/state") query.campaign = "ガチャキャンペーンID";
      if (path === "/api/admin/members" || path === "/api/admin/audit")
        Object.assign(query, {
          query: "検索語",
          page: "0から始まるページ番号",
        });
      if (path === "/api/admin/revenue")
        Object.assign(query, {
          from: "開始UTC日時",
          to: "終了UTC日時（含まない）",
          recipient: "受取人ID",
        });
      if (path === "/api/conversations/{id}/messages")
        Object.assign(query, {
          before: "前ページ末尾のUTC日時",
          beforeId: "同一時刻のID",
        });
      if (path === "/api/uploads")
        Object.assign(query, {
          kind: "avatar / image / audio / rewardImage / rewardAudio / video",
          conversationId: "音声の会話ID",
        });
      for (const [name, description] of Object.entries(query))
        operation.parameters.push({
          name,
          in: "query",
          required: path === "/api/uploads" && name === "kind",
          schema: { type: "string" },
          description,
        });
    }
  return doc;
}
