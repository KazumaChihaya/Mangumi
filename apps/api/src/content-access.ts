import { get, put, type Query } from "./db.ts";
import type { User } from "./auth.ts";
import { featurePolicy, consume } from "./limits.ts";
import { fail, now } from "./security.ts";
const resource = (feature: string) =>
  feature === "story.view" ? "storyViews" : "calendarViews";
export async function contentAccess(
  q: Query,
  user: User,
  feature: string,
  item: any,
) {
  return contentRule(
    await featurePolicy(q, user, feature),
    item,
    !!(await get(q, resource(feature), `${user.id}_${item.id}`)),
  );
}
export function contentRule(
  policy: Awaited<ReturnType<typeof featurePolicy>>,
  item: any,
  viewed: boolean,
) {
  const candidates = [item.id, item.authorId, item.hostId, item.host].filter(
      Boolean,
    ),
    target = policy?.targets?.length
      ? candidates.find((v) => policy.targets!.includes(v))
      : (candidates[1] ?? item.id);
  const allowed = !policy?.targets?.length || !!target;
  const limited =
    !!policy &&
    [policy.day, policy.week, policy.month].some((v) => v !== undefined);
  return { allowed, limited, viewed, target };
}
export async function claimContentView(
  q: Query,
  user: User,
  feature: string,
  item: any,
) {
  const access = await contentAccess(q, user, feature, item);
  if (!access.allowed)
    fail(403, "このコンテンツはプランの対象外です", "plan_required");
  if (!access.viewed) {
    await consume(q, user, feature, { level: "view", target: access.target });
    await put(
      q,
      resource(feature),
      `${user.id}_${item.id}`,
      {
        [feature === "story.view" ? "storyId" : "scheduleId"]: item.id,
        at: now(),
      },
      user.id,
    );
  }
}
