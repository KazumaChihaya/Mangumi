import { digest, id, later, now, audit } from "./security.ts";
import { get, list, put, type Database, type Query } from "./db.ts";
import type { Services } from "./services.ts";
import type { User } from "./auth.ts";
import { contentVisible, entitled } from "./domain.ts";
import { publishBrand } from "./operations.ts";

export async function enqueue(
  q: Query,
  key: string,
  kind: string,
  payload: unknown,
  due = now(),
) {
  if ((await q.all("SELECT id FROM jobs WHERE id = ?", [key])).length) return;
  await q.run(
    "INSERT INTO jobs (id,kind,payload,due_at,state,attempts) VALUES (?,?,?,?,?,0)",
    [key, kind, JSON.stringify(payload), due, "pending"],
  );
}
export async function notifyUser(
  q: Query,
  user: string,
  key: string,
  title: string,
  body: string,
  path: string,
  kind = "general",
  context: Record<string, string> = {},
) {
  await enqueue(q, digest(`${key}:${user}`), "push", {
    userId: user,
    title,
    body,
    path,
    notificationKind: kind,
    ...context,
  });
}
export async function notifyAudience(
  q: Query,
  key: string,
  title: string,
  body: string,
  path: string,
  kind: string,
  plan = "Free",
) {
  for (const user of await q.all<User>(
    "SELECT * FROM users WHERE status = 'active' AND verified = 1",
  )) {
    if (plan === "Free" || JSON.parse(user.profile).plan === plan)
      await notifyUser(q, user.id, key, title, body, path, kind);
  }
}
export function quietDelay(preferences: any, timestamp = Date.now()) {
  if (
    !preferences?.quiet ||
    !preferences.quietFrom ||
    !preferences.quietTo ||
    preferences.quietFrom === preferences.quietTo
  )
    return 0;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: preferences.timezone ?? "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const quiet = (time: number) => {
    const clock = formatter.format(time);
    return preferences.quietFrom < preferences.quietTo
      ? clock >= preferences.quietFrom && clock < preferences.quietTo
      : clock >= preferences.quietFrom || clock < preferences.quietTo;
  };
  if (!quiet(timestamp)) return 0;
  for (let minutes = 1; minutes <= 1440; minutes++)
    if (!quiet(timestamp + minutes * 60000)) return minutes * 60;
  return 86400;
}
export async function scheduleReminders(db: Database) {
  await db.transaction(async (q) => {
    const settings = await get(q, "settings", "global");
    if (!settings.notifySchedule) return;
    const schedules = await list(q, "schedules");
    const users = await q.all<User>(
      "SELECT * FROM users WHERE status = 'active' AND verified = 1",
    );
    for (const schedule of schedules) {
      if (!contentVisible(schedule, undefined) && schedule.plan === "Free")
        continue;
      if (schedule.status !== "公開") continue;
      const start = Date.parse(`${schedule.date}T${schedule.time}:00+09:00`);
      if (!Number.isFinite(start) || start < Date.now()) continue;
      for (const user of users) {
        if (!contentVisible(schedule, user)) continue;
        const preferences = await get(q, "preferences", user.id);
        if (preferences?.settings?.notifySchedule === false) continue;
        const reminders = preferences?.reminders ?? ["1時間前", "10分前"];
        const minutes: Record<string, number> = {
          "24時間前": 1440,
          "1時間前": 60,
          "10分前": 10,
        };
        for (const reminder of reminders) {
          const due = new Date(start - minutes[reminder] * 60000).toISOString();
          if (Date.parse(due) < Date.now() - 60000) continue;
          await enqueue(
            q,
            digest(`schedule:${schedule.id}:${start}:${reminder}:${user.id}`),
            "push",
            {
              userId: user.id,
              title: "もうすぐマン組の配信！",
              body: `${schedule.title} · ${schedule.time}`,
              path: `/u/U030?item=${encodeURIComponent(schedule.id)}`,
              notificationKind: "schedule",
              scheduleId: schedule.id,
              startsAt: start,
            },
            due,
          );
        }
      }
    }
  });
}
export async function processJobs(db: Database, external: Services) {
  for (let index = 0; index < 50; index++) {
    const job = await db.transaction(async (q) => {
      const row = (
        await q.all(
          "SELECT * FROM jobs WHERE ((state = 'pending' AND due_at <= ?) OR (state = 'running' AND locked_until <= ?)) AND attempts < 5 ORDER BY due_at LIMIT 1",
          [now(), now()],
        )
      )[0];
      if (!row) return;
      await q.run(
        "UPDATE jobs SET state = 'running', attempts = attempts + 1, locked_until = ? WHERE id = ?",
        [later(120), row.id],
      );
      return { ...row, attempts: row.attempts + 1 } as Record<string, any>;
    });
    if (!job) return;
    const payload = JSON.parse(job.payload);
    try {
      if (job.kind === "mail") {
        const valid =
          !payload.tokenHash ||
          (
            await db.all(
              "SELECT id FROM tokens WHERE id = ? AND expires_at > ?",
              [payload.tokenHash, now()],
            )
          ).length;
        if (valid)
          await external.mail({
            to: payload.to,
            subject: payload.subject,
            text: payload.text,
          });
      } else if (job.kind === "plan_change") {
        await db.transaction(async (q) => {
          const change = await get(q, "planChanges", payload.changeId),
            plan = change && (await get(q, "plans", change.planId));
          const user = (
            await q.all<User>("SELECT * FROM users WHERE id = ?", [
              payload.userId,
            ])
          )[0];
          if (change?.status === "予約" && plan && user?.status === "active") {
            const profile = JSON.parse(user.profile),
              subscription = await get(q, "subscription", user.id);
            const apply =
              profile.plan === change.previousPlan &&
              !["active", "trialing", "past_due"].includes(
                subscription?.status,
              );
            if (apply)
              await q.run("UPDATE users SET profile = ? WHERE id = ?", [
                JSON.stringify({ ...profile, plan: plan.name }),
                user.id,
              ]);
            await put(
              q,
              "planChanges",
              change.id,
              { ...change, status: apply ? "適用済み" : "競合のため取消" },
              user.id,
            );
            await audit(
              q,
              change.actorId,
              "member.plan.scheduled",
              user.id,
              { plan: profile.plan },
              { plan: apply ? plan.name : profile.plan, applied: apply },
              change.reason,
              "worker",
            );
          }
        });
      } else if (job.kind === "restore_user") {
        await db.transaction(async (q) => {
          const suspension = await get(q, "suspensions", payload.userId);
          if (
            suspension?.active &&
            suspension.version === payload.version &&
            suspension.until <= now()
          ) {
            await q.run(
              "UPDATE users SET status = 'active' WHERE id = ? AND status = 'suspended'",
              [payload.userId],
            );
            await put(
              q,
              "suspensions",
              payload.userId,
              { ...suspension, active: false },
              payload.userId,
            );
            await audit(
              q,
              "worker",
              "member.suspension.expired",
              payload.userId,
              { status: "suspended" },
              { status: "active" },
              "停止期限の満了",
              "worker",
            );
          }
        });
      } else if (job.kind === "story") {
        await db.transaction(async (q) => {
          const story = await get(q, "stories", payload.storyId);
          if (
            story &&
            story.publishAt === payload.publishAt &&
            contentVisible(story, {
              profile: JSON.stringify({ plan: story.plan }),
            } as User)
          )
            await notifyAudience(
              q,
              `story:${job.id}`,
              "マン組のストーリーが届きました",
              story.title,
              `/u/U035?item=${encodeURIComponent(story.id)}`,
              "story",
              story.plan,
            );
        });
      } else if (job.kind === "voice_kick_user") {
        for (const participant of (await list(db, "participants")).filter(
          (item) => item.userId === payload.userId,
        )) {
          if (external.roomService)
            await external.roomService
              .removeParticipant(participant.roomId, payload.userId)
              .catch((error) => {
                if (!/not found/i.test(String(error))) throw error;
              });
          await db.transaction((q) =>
            q.run(
              "DELETE FROM entities WHERE resource = 'participants' AND id = ?",
              [participant.id],
            ),
          );
        }
      } else if (job.kind === "brand")
        await db.transaction((q) => publishBrand(q, payload.versionId));
      else if (job.kind === "campaign") {
        await db.transaction(async (q) => {
          await notifyAudience(
            q,
            `campaign:${payload.id}`,
            payload.title,
            payload.body,
            "/",
            "general",
            payload.plan,
          );
          const campaign = await get(q, "campaigns", payload.id);
          if (campaign) {
            campaign.status = "配信処理中";
            await put(q, "campaigns", payload.id, campaign);
          }
        });
      } else if (job.kind === "host_check") {
        const room = await get(db, "rooms", payload.roomId);
        if (
          room &&
          external.roomService &&
          !(await get(db, "participants", `${room.id}_${room.hostId}`))
        ) {
          await external.roomService.deleteRoom(room.id).catch(() => {});
          await db.transaction(async (q) => {
            room.status = "終了";
            await put(q, "rooms", room.id, room);
            for (const participant of await list(q, "participants", room.id))
              await q.run(
                "DELETE FROM entities WHERE resource = 'participants' AND id = ?",
                [participant.id],
              );
          });
        }
      } else if (job.kind === "push") {
        const user = (
          await db.all<User>(
            "SELECT * FROM users WHERE id = ? AND status = 'active' AND verified = 1",
            [payload.userId],
          )
        )[0];
        const preferences = await get(db, "preferences", payload.userId);
        const global = await get(db, "settings", "global");
        const name = (
          {
            dm: "notifyDM",
            story: "notifyStory",
            schedule: "notifySchedule",
          } as Record<string, string>
        )[payload.notificationKind];
        let deliver =
          !!user &&
          (!name ||
            (global[name] !== false &&
              preferences?.settings?.[name] !== false));
        if (deliver && user && name) {
          try {
            await entitled(
              db,
              user,
              payload.notificationKind === "story"
                ? "story.view"
                : payload.notificationKind === "dm"
                  ? "dm.send"
                  : "notification.receive",
            );
          } catch {
            deliver = false;
          }
        }
        if (
          payload.notificationKind === "dm" &&
          (preferences?.conversationMuted || preferences?.blocked)
        )
          deliver = false;
        if (payload.notificationKind === "dm" && payload.senderId) {
          if (
            (await get(
              db,
              "blocks",
              `${payload.userId}_${payload.senderId}`,
            )) ||
            (await get(db, "blocks", `${payload.senderId}_${payload.userId}`))
          )
            deliver = false;
          if (
            (
              await get(
                db,
                "conversationPrefs",
                `${payload.conversationId}_${payload.userId}`,
              )
            )?.muted
          )
            deliver = false;
        }
        if (payload.scheduleId) {
          const schedule = await get(db, "schedules", payload.scheduleId);
          if (
            !schedule ||
            !contentVisible(schedule, user) ||
            Date.parse(`${schedule.date}T${schedule.time}:00+09:00`) !==
              payload.startsAt
          )
            deliver = false;
        }
        const delay = deliver ? quietDelay(preferences?.settings ?? global) : 0;
        if (delay) {
          await db.transaction((q) =>
            q.run(
              "UPDATE jobs SET state = 'pending', due_at = ?, attempts = attempts - 1 WHERE id = ?",
              [later(delay), job.id],
            ),
          );
          continue;
        }
        if (deliver) {
          for (const device of await list(db, "push", payload.userId)) {
            const deliveryId = digest(`${job.id}:${device.id}`);
            if (await get(db, "deliveries", deliveryId)) continue;
            try {
              await external.push(device.subscription, {
                title: payload.title,
                body: payload.body,
                url: payload.path,
                tag: job.id,
                deliveryId,
              });
              await db.transaction((q) =>
                put(
                  q,
                  "deliveries",
                  deliveryId,
                  {
                    id: deliveryId,
                    jobId: job.id,
                    userId: payload.userId,
                    deviceId: device.id,
                    status: "sent",
                    at: now(),
                  },
                  payload.userId,
                ),
              );
            } catch (error: any) {
              if ([404, 410].includes(error.statusCode))
                await db.transaction((q) =>
                  q.run(
                    "DELETE FROM entities WHERE resource = 'push' AND id = ?",
                    [device.id],
                  ),
                );
              else throw error;
            }
          }
        }
      }
      await db.transaction((q) =>
        q.run(
          "UPDATE jobs SET state = 'done', payload = '{}', result = ?, locked_until = NULL WHERE id = ?",
          [JSON.stringify({ at: now() }), job.id],
        ),
      );
    } catch (error: any) {
      await db.transaction((q) =>
        q.run(
          "UPDATE jobs SET state = ?, due_at = ?, result = ?, locked_until = NULL WHERE id = ?",
          [
            job.attempts >= 5 ? "failed" : "pending",
            later(Math.min(3600, 30 * 2 ** job.attempts)),
            JSON.stringify({ code: error.statusCode ?? "delivery_failed" }),
            job.id,
          ],
        ),
      );
    }
  }
}
