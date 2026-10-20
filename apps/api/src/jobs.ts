import { digest, id, later, now, audit, once } from "./security.ts";
import { get, list, put, type Database, type Query } from "./db.ts";
import type { Services } from "./services.ts";
import type { User } from "./auth.ts";
import { contentVisible, entitled } from "./domain.ts";
import { publishBrand } from "./operations.ts";
import { dispatchCampaign } from "./notifications.ts";
import { brandedEmail } from "./email.ts";
import { scheduleStart } from "../../member/src/dates.ts";
import { activateOdds } from "./gacha-versions.ts";
import { consume } from "./limits.ts";
import { contentAccess } from "./content-access.ts";

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
  context: Record<string, string> = {},
  due = now(),
) {
  await enqueue(
    q,
    digest(`audience:${key}`),
    "audience",
    { key, title, body, path, kind, plan, context },
    due,
  );
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
      if (schedule.notify === false) continue;
      if (!contentVisible(schedule, undefined) && schedule.plan === "Free")
        continue;
      if (
        schedule.status !== "公開" &&
        !(schedule.status === "予約" && schedule.publishAt <= now())
      )
        continue;
      const start = scheduleStart(schedule);
      if (!Number.isFinite(start) || start < Date.now()) continue;
      for (const user of users) {
        if (!contentVisible(schedule, user)) continue;
        const preferences = await get(q, "preferences", user.id);
        if (preferences?.settings?.notifySchedule === false) continue;
        const custom = await get(
          q,
          "scheduleReminders",
          `${user.id}_${schedule.id}`,
        );
        const minutes: Record<string, number> = {
          "24時間前": 1440,
          "1時間前": 60,
          "10分前": 10,
        };
        const timings: number[] =
          custom?.minutes ??
          (schedule.reminderMinutes?.length
            ? schedule.reminderMinutes
            : (
                preferences?.reminders ??
                settings.reminders ?? ["1時間前", "10分前"]
              )
                .map((r: string) => minutes[r])
                .filter(Number.isFinite));
        for (const reminder of new Set(timings)) {
          const due = new Date(start - reminder * 60000).toISOString();
          if (Date.parse(due) < Date.now() - 60000) continue;
          await enqueue(
            q,
            digest(`schedule:${schedule.id}:${start}:${reminder}:${user.id}`),
            "push",
            {
              userId: user.id,
              title: "もうすぐマン組の配信！",
              body: `${schedule.title} · ${schedule.time}`,
              path: `/u/U029?item=${encodeURIComponent(schedule.id)}`,
              notificationKind: "schedule",
              scheduleId: schedule.id,
              startsAt: start,
              reminderMinutes: reminder,
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
      if (job.kind === "audience") {
        await db.transaction(async (q) => {
          const users = (
            await q.all<User>(
              "SELECT * FROM users WHERE status = 'active' AND verified = 1",
            )
          ).filter(
            (user) =>
              payload.plan === "Free" ||
              JSON.parse(user.profile).plan === payload.plan,
          );
          for (let start = 0; start < users.length; start += 25)
            await enqueue(
              q,
              digest(`${job.id}:chunk:${start}`),
              "audience_chunk",
              {
                ...payload,
                userIds: users.slice(start, start + 25).map((u) => u.id),
              },
            );
        });
      } else if (job.kind === "audience_chunk") {
        await db.transaction(async (q) => {
          for (const userId of payload.userIds)
            await notifyUser(
              q,
              userId,
              payload.key,
              payload.title,
              payload.body,
              payload.path,
              payload.kind,
              payload.context,
            );
        });
      } else if (job.kind === "expo_receipts") {
        const receipts = await external.pushReceipts([payload.receiptId]),
          receipt = receipts[payload.receiptId];
        if (!receipt) {
          if (job.attempts >= 5) throw new Error("expo_receipt_missing");
          await db.run(
            "UPDATE jobs SET state = 'pending', due_at = ?, locked_until = NULL WHERE id = ?",
            [later(300), job.id],
          );
          continue;
        }
        await db.transaction(async (q) => {
          const delivery = await get(q, "deliveries", payload.deliveryId);
          if (delivery)
            await put(
              q,
              "deliveries",
              delivery.id,
              {
                ...delivery,
                providerStatus: receipt.status,
                ...(receipt.status === "error"
                  ? {
                      status: "failed",
                      code: receipt.details?.error ?? "expo_error",
                    }
                  : { deliveredAt: now() }),
              },
              delivery.userId,
            );
          if (
            receipt.status === "error" &&
            receipt.details?.error === "DeviceNotRegistered"
          )
            await q.run(
              "DELETE FROM entities WHERE resource = 'push' AND id = ?",
              [payload.deviceId],
            );
        });
      } else if (job.kind === "mail") {
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
            html: brandedEmail(
              await get(db, "brand", "current"),
              payload.subject,
              payload.text,
              external.origin,
            ),
          });
      } else if (job.kind === "odds") {
        await db.transaction((q) => activateOdds(q, payload.versionId));
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
            story.notify !== false &&
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
              { storyId: story.id },
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
        await db.transaction((q) => dispatchCampaign(q, payload.id));
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
            voice: "notifyVoice",
            gacha: "notifyGacha",
            general: "notifyGeneral",
            security: "notifySecurity",
          } as Record<string, string>
        )[payload.notificationKind];
        let deliver =
          !!user &&
          (!name ||
            (global[name] !== false &&
              preferences?.settings?.[name] !== false));
        if (deliver && user) {
          try {
            await entitled(db, user, "notification.receive");
            await entitled(
              db,
              user,
              payload.notificationKind === "story"
                ? "story.view"
                : payload.notificationKind === "dm"
                  ? "dm.send"
                  : payload.notificationKind === "gacha"
                    ? "gacha.draw"
                    : payload.notificationKind === "voice"
                      ? "voice.join"
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
        if (payload.roomId) {
          const room = await get(db, "rooms", payload.roomId);
          if (
            !room ||
            !contentVisible({ ...room, status: "公開" }, user) ||
            (payload.roomStart && room.startsAt !== payload.roomStart) ||
            ["終了", "中止", "停止"].includes(room.status)
          )
            deliver = false;
        }
        if (payload.scheduleId) {
          const schedule = await get(db, "schedules", payload.scheduleId);
          if (
            !schedule ||
            schedule.notify === false ||
            !contentVisible(schedule, user) ||
            scheduleStart(schedule) !== payload.startsAt
          )
            deliver = false;
          if (deliver && schedule && user) {
            try {
              await entitled(db, user, "calendar.view");
              if (
                !(await contentAccess(db, user, "calendar.view", schedule))
                  .allowed
              )
                deliver = false;
            } catch {
              deliver = false;
            }
          }
          if (schedule && payload.reminderMinutes !== undefined) {
            const custom = await get(
                db,
                "scheduleReminders",
                `${payload.userId}_${schedule.id}`,
              ),
              labels: Record<string, number> = {
                "24時間前": 1440,
                "1時間前": 60,
                "10分前": 10,
              };
            const timings =
              custom?.minutes ??
              (schedule.reminderMinutes?.length
                ? schedule.reminderMinutes
                : (
                    preferences?.reminders ??
                    global.reminders ?? ["1時間前", "10分前"]
                  ).map((r: string) => labels[r]));
            if (!timings.includes(payload.reminderMinutes)) deliver = false;
          }
        }
        if (deliver && payload.storyId && user) {
          const story = await get(db, "stories", payload.storyId);
          if (
            !story ||
            !contentVisible(story, user) ||
            !(await contentAccess(db, user, "story.view", story)).allowed
          )
            deliver = false;
        }
        const delay =
          deliver && payload.urgent !== "1"
            ? quietDelay(preferences?.settings ?? global)
            : 0;
        if (delay) {
          await db.transaction((q) =>
            q.run(
              "UPDATE jobs SET state = 'pending', due_at = ?, attempts = attempts - 1 WHERE id = ?",
              [later(delay), job.id],
            ),
          );
          continue;
        }
        const devices = await list(db, "push", payload.userId);
        if (!devices.length) deliver = false;
        if (deliver && user) {
          try {
            await db.transaction((q) =>
              once(
                q,
                `notification-quota:${user.id}`,
                job.id,
                { jobId: job.id },
                async () => {
                  await consume(q, user, "notification.receive", {
                    target: payload.senderId,
                    level: "view",
                  });
                  return { ok: true };
                },
              ),
            );
          } catch (error: any) {
            if (
              error.code === "quota_exceeded" ||
              error.code === "plan_required"
            )
              deliver = false;
            else throw error;
          }
        }
        if (deliver) {
          for (const device of devices) {
            const deliveryId = digest(`${job.id}:${device.id}`);
            if ((await get(db, "deliveries", deliveryId))?.status === "sent")
              continue;
            try {
              const accepted = await external.push(device.subscription, {
                icon:
                  (await get(db, "brand", "current"))?.notificationIcon ??
                  "/api/brand/icon/192",
                title: payload.title,
                body: payload.body,
                url: payload.path,
                tag: job.id,
                deliveryId,
              });
              if (accepted?.receiptId)
                await db.transaction((q) =>
                  enqueue(
                    q,
                    digest(`receipt:${accepted.receiptId}`),
                    "expo_receipts",
                    {
                      receiptId: accepted.receiptId,
                      deliveryId,
                      deviceId: device.id,
                    },
                    later(900),
                  ),
                );
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
                    campaignId: payload.campaignId,
                    at: now(),
                  },
                  payload.userId,
                ),
              );
              await db.transaction(async (q) => {
                const current = await get(q, "push", device.id);
                if (current)
                  await put(
                    q,
                    "push",
                    device.id,
                    { ...current, lastSuccessAt: now() },
                    payload.userId,
                  );
              });
            } catch (error: any) {
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
                    campaignId: payload.campaignId,
                    status: "failed",
                    code: error.statusCode ?? "delivery_failed",
                    at: now(),
                  },
                  payload.userId,
                ),
              );
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
        if (payload.campaignId)
          await recordCampaignOutcome(
            db,
            payload,
            deliver ? "processed" : "skipped",
          );
      }
      await db.transaction((q) =>
        q.run(
          "UPDATE jobs SET state = 'done', payload = '{}', result = ?, locked_until = NULL WHERE id = ?",
          [JSON.stringify({ at: now() }), job.id],
        ),
      );
    } catch (error: any) {
      if (payload.campaignId && job.attempts >= 5)
        await recordCampaignOutcome(db, payload, "failed");
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
async function recordCampaignOutcome(
  db: Database,
  payload: any,
  status: string,
) {
  await db.transaction(async (q) => {
    await put(
      q,
      "campaignOutcomes",
      digest(`${payload.campaignId}:${payload.userId}`),
      { userId: payload.userId, status, at: now() },
      payload.campaignId,
    );
    const campaign = await get(q, "campaigns", payload.campaignId);
    if (
      campaign &&
      (await list(q, "campaignOutcomes", campaign.id)).length >= campaign.count
    )
      await put(q, "campaigns", campaign.id, {
        ...campaign,
        status: "完了",
        completedAt: now(),
      });
  });
}
export async function scheduleEngagement(db: Database) {
  await db.transaction(async (q) => {
    const last = await get(q, "engagement", "last");
    if (last?.at > new Date(Date.now() - 60000).toISOString()) return;
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    for (const room of await list(q, "rooms")) {
      if (room.status === "開催中" && room.startedAt)
        await notifyAudience(
          q,
          `voice-start:${room.id}:${room.startedAt}`,
          "マン組の音声ルームが始まりました",
          room.title,
          `/space?item=${room.id}`,
          "voice",
          room.plan,
          { roomId: room.id },
        );
      if (room.status === "開催予定" && room.startsAt && room.startsAt > now())
        await notifyAudience(
          q,
          `voice-reminder:${room.id}:${room.startsAt}`,
          "まもなく音声ルーム",
          room.title,
          `/space?item=${room.id}`,
          "voice",
          room.plan,
          { roomId: room.id, roomStart: room.startsAt },
          new Date(
            Math.max(Date.now(), Date.parse(room.startsAt) - 600000),
          ).toISOString(),
        );
    }
    for (const campaign of [
      { ...(await get(q, "gacha", "global")), id: "global" },
      ...(await list(q, "gachaCampaigns")),
    ]) {
      if (
        campaign.status !== "公開" ||
        today < campaign.start ||
        today > campaign.end
      )
        continue;
      const plan = campaign.plan ?? "Free",
        path = `/gacha?campaign=${campaign.id}`;
      if (today === campaign.start)
        await notifyAudience(
          q,
          `gacha-start:${campaign.id}:${campaign.start}`,
          "ガチャキャンペーン開始",
          campaign.title,
          path,
          "gacha",
          plan,
        );
      if (campaign.dailyTickets)
        await notifyAudience(
          q,
          `gacha-free:${campaign.id}:${today}`,
          "今日の無料チケット",
          `${campaign.title}で無料チケットを受け取れます`,
          path,
          "gacha",
          plan,
          {},
          new Date(`${today}T09:00:00+09:00`).toISOString(),
        );
      if (today === campaign.end)
        await notifyAudience(
          q,
          `gacha-end:${campaign.id}:${campaign.end}`,
          "キャンペーンは本日まで",
          campaign.title,
          path,
          "gacha",
          plan,
        );
    }
    await put(q, "engagement", "last", { at: now() });
  });
}
