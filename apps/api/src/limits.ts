import { z } from "zod";
import { get, list, put, type Query } from "./db.ts";
import { digest, fail, now } from "./security.ts";
import type { User } from "./auth.ts";
import { features } from "../../member/src/features.ts";

export const featurePolicySchema = z
  .object({
    allowed: z.boolean(),
    level: z.enum(["view", "send", "create", "manage"]).default("manage"),
    day: z.number().int().min(0).max(1000000).optional(),
    week: z.number().int().min(0).max(1000000).optional(),
    month: z.number().int().min(0).max(10000000).optional(),
    concurrent: z.number().int().min(0).max(10000).optional(),
    created: z.number().int().min(0).max(100000).optional(),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(20 * 1024 * 1024)
      .optional(),
    seconds: z.number().int().min(1).max(86400).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
    targets: z.array(z.string().min(1).max(100)).max(200).optional(),
  })
  .strict();
export const policiesSchema = z.record(
  z.enum(Object.keys(features) as [string, ...string[]]),
  featurePolicySchema,
);

export async function featurePolicy(q: Query, user: User, feature: string) {
  const plans = await list(q, "plans");
  const plan =
    plans.find((p) => p.name === JSON.parse(user.profile).plan) ??
    plans.find((p) => p.id === "free");
  return plan?.policies?.[feature] as
    z.infer<typeof featurePolicySchema> | undefined;
}
export function periodKeys(at = Date.now()) {
  const date = new Date(at + 9 * 3600000);
  const day = date.toISOString().slice(0, 10);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return { day, week: date.toISOString().slice(0, 10), month: day.slice(0, 7) };
}
// Call inside the business transaction and its idempotency boundary. A rollback
// must roll back quota consumption together with the requested operation.
export async function consume(
  q: Query,
  user: User,
  feature: string,
  options: {
    count?: number;
    target?: string;
    concurrent?: number;
    created?: number;
    bytes?: number;
    seconds?: number;
    level?: "view" | "send" | "create" | "manage";
  } = {},
) {
  if (!(feature in features)) fail(400, "登録されていない機能です");
  const policy = await featurePolicy(q, user, feature);
  if (!policy) return;
  const override = await get(q, "overrides", user.id);
  const allowed =
    (override?.expires?.[feature] ?? override?.expiresAt) > now()
      ? (override.features?.[feature] ?? policy.allowed)
      : policy.allowed;
  if (!allowed)
    fail(403, "この機能は現在のプランでは利用できません", "plan_required");
  const levels = ["view", "send", "create", "manage"];
  if (
    options.level &&
    levels.indexOf(options.level) > levels.indexOf(policy.level)
  )
    fail(403, "この操作に必要な権限レベルがありません", "plan_required");
  if (
    policy.targets?.length &&
    options.target &&
    !policy.targets.includes(options.target)
  )
    fail(403, "この対象はプランに含まれていません", "plan_required");
  for (const key of ["concurrent", "created", "bytes", "seconds"] as const)
    if (
      policy[key] !== undefined &&
      options[key] !== undefined &&
      options[key]! > policy[key]!
    )
      fail(409, "プランの利用上限を超えています", "quota_exceeded");
  const keys = periodKeys();
  for (const period of ["day", "week", "month"] as const) {
    if (policy[period] === undefined) continue;
    const key = digest(`${user.id}:${feature}:${period}:${keys[period]}`);
    const counter = await get(q, "usage", key);
    const count = (counter?.count ?? 0) + (options.count ?? 1);
    if (count > policy[period]!)
      fail(
        429,
        `${features[feature as keyof typeof features]}の利用上限に達しました（${period === "day" ? "日" : period === "week" ? "週" : "月"}）`,
        "quota_exceeded",
      );
    await put(
      q,
      "usage",
      key,
      { id: key, feature, period, start: keys[period], count, at: now() },
      user.id,
    );
  }
}
