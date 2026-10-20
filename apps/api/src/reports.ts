import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, list, type Database } from "./db.ts";
import { identity, permit } from "./auth.ts";
import type { Config } from "./config.ts";
import { now } from "./security.ts";

export function registerReports(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get("/api/admin/revenue", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "finance"]);
    const query = z
      .object({
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        recipient: z.string().max(100).optional(),
      })
      .parse(request.query);
    const inPeriod = (row: any) =>
      (!query.from || row.at >= query.from) && (!query.to || row.at < query.to);
    const rows = [
      ...(await list(db, "tips"))
        .filter((t) =>
          ["paid", "refunded", "disputed"].includes(t.paymentStatus),
        )
        .map((t) => ({
          id: t.id,
          at: t.at,
          kind: "tip",
          recipient: t.recipient,
          amount: t.amount,
          refunded: t.refunded ?? 0,
          fee: t.providerFee ?? null,
          status: t.paymentStatus,
        })),
      ...(await list(db, "invoices")).map((i) => ({
        ...i,
        kind: "plan",
        recipient: "subscription",
        fee: i.providerFee ?? null,
      })),
    ]
      .filter(inPeriod)
      .filter((r) => !query.recipient || r.recipient === query.recipient)
      .sort((a, b) => b.at.localeCompare(a.at));
    const summary = (items: any[]) => {
      const gross = items.reduce((n, r) => n + r.amount, 0),
        refunded = items.reduce((n, r) => n + (r.refunded ?? 0), 0);
      const feePending = items.filter((r) => r.fee === null).length;
      const fees = items.reduce((n, r) => n + (r.fee ?? 0), 0);
      return {
        count: items.length,
        gross,
        refunded,
        fees,
        feePending,
        net: feePending ? null : gross - refunded - fees,
      };
    };
    return {
      period: {
        from: query.from ?? "開始時",
        to: query.to ?? now(),
        endExclusive: true,
      },
      definitions:
        "成功した決済を対象。返金額と確定した決済手数料を控除。手数料の取得待ちがある場合、差引額は未確定です。期間終了は指定日時を含みません。",
      total: summary(rows),
      recipients: [...new Set(rows.map((r) => r.recipient))].map(
        (recipient) => ({
          recipient,
          ...summary(rows.filter((r) => r.recipient === recipient)),
        }),
      ),
      rows,
    };
  });
  app.get("/api/admin/story-analytics", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super", "content"]);
    const views = await list(db, "storyViews");
    return (await list(db, "stories")).map((story) => ({
      id: story.id,
      title: story.title,
      status: story.status,
      publishAt: story.publishAt,
      expiresAt: story.expiresAt,
      viewers: views.filter((v) => v.storyId === story.id).length,
    }));
  });
}
