import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, put, type Database } from "./db.ts";
import { identity } from "./auth.ts";
import { contentVisible, entitled } from "./domain.ts";
import { fail, now } from "./security.ts";
import type { Config } from "./config.ts";
import { claimContentView, contentAccess } from "./content-access.ts";
export const reminderSchema = z
  .object({ minutes: z.array(z.number().int().min(1).max(10080)).max(5) })
  .strict();
export function registerReminders(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.post("/api/schedules/:id/view", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member"),
        schedule = await get(q, "schedules", (request.params as any).id);
      await entitled(q, actor.user, "calendar.view");
      if (!schedule || !contentVisible(schedule, actor.user))
        fail(404, "配信予定が見つかりません");
      await claimContentView(q, actor.user, "calendar.view", schedule);
      return schedule;
    }),
  );
  app.get("/api/schedules/:id/reminders", async (request) => {
    const actor = await identity(db, request, config, "member"),
      schedule = await get(db, "schedules", (request.params as any).id);
    await entitled(db, actor.user, "calendar.view");
    if (!schedule || !contentVisible(schedule, actor.user))
      fail(404, "配信予定が見つかりません");
    if (
      !(await contentAccess(db, actor.user, "calendar.view", schedule)).allowed
    )
      fail(403, "プランの対象外です");
    const saved = await get(
      db,
      "scheduleReminders",
      `${actor.user.id}_${schedule.id}`,
    );
    return {
      minutes:
        saved?.minutes ??
        (schedule.reminderMinutes?.length ? schedule.reminderMinutes : null),
      enabled: schedule.notify !== false,
    };
  });
  app.put("/api/schedules/:id/reminders", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "member"),
        schedule = await get(q, "schedules", (request.params as any).id),
        body = reminderSchema.parse(request.body);
      await entitled(q, actor.user, "calendar.view");
      if (!schedule || !contentVisible(schedule, actor.user))
        fail(404, "配信予定が見つかりません");
      if (
        !(await contentAccess(q, actor.user, "calendar.view", schedule)).allowed
      )
        fail(403, "プランの対象外です");
      await put(
        q,
        "scheduleReminders",
        `${actor.user.id}_${schedule.id}`,
        {
          scheduleId: schedule.id,
          minutes: [...new Set(body.minutes)],
          at: now(),
        },
        actor.user.id,
      );
      return { ok: true };
    }),
  );
}
