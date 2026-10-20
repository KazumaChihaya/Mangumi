import type { FastifyInstance } from "fastify";
import { get, list, type Database } from "./db.ts";
import { identity, type User } from "./auth.ts";
import { blocked } from "./social.ts";
import type { Config } from "./config.ts";
export function registerTipMessages(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get("/api/tips/messages", async (request) => {
    const actor = await identity(db, request, config, "member");
    const rows = [];
    for (const item of (await list(db, "tips"))
      .filter(
        (t) =>
          t.paymentStatus === "paid" &&
          !t.refunded &&
          !t.hidden &&
          (t.visibility === "public" || t.recipient === actor.user.id),
      )
      .sort((a, b) => b.at.localeCompare(a.at))) {
      if (rows.length >= 100) break;
      if (await blocked(db, actor.user.id, item.userId)) continue;
      const sender = (
        await db.all<User>(
          "SELECT * FROM users WHERE id = ? AND status = 'active'",
          [item.userId],
        )
      )[0];
      if (!sender) continue;
      rows.push({
        id: item.id,
        name: JSON.parse(sender.profile).name,
        message: item.message,
        at: item.paidAt ?? item.at,
        visibility: item.visibility ?? "private",
        recipient: item.recipient,
        own: item.recipient === actor.user.id,
      });
    }
    return rows;
  });
}
