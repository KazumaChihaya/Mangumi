import type { Query } from "./db.ts";
import { get, list, put } from "./db.ts";
import type { User } from "./auth.ts";
import { entitled } from "./domain.ts";
import { consume, periodKeys } from "./limits.ts";
import { fail, id, now } from "./security.ts";
export type TipInput = {
  amount: number;
  recipient: string;
  message: string;
  visibility?: "private" | "public";
};
export async function reserveTip(
  q: Query,
  user: User,
  body: TipInput,
  provider = "stripe",
) {
  const settings = await get(q, "settings", "global");
  await entitled(q, user, "tip.send");
  await consume(q, user, "tip.send", { target: body.recipient, level: "send" });
  if (body.amount < (settings.tipMin ?? 100) || body.amount > settings.tipMax)
    fail(400, "応援金額が設定範囲外です");
  if (
    !(
      await q.all(
        "SELECT id FROM users WHERE id = ? AND role = 'official' AND status = 'active'",
        [body.recipient],
      )
    ).length
  )
    fail(400, "受取対象を選んでください");
  if (
    settings.ngWords
      .split(/[,、\n]/)
      .map((w: string) => w.trim())
      .filter(Boolean)
      .some((w: string) => body.message.includes(w))
  )
    fail(400, "送信できない言葉が含まれています");
  const tips = (await list(q, "tips", user.id)).filter((t) =>
      ["pending", "paid"].includes(t.paymentStatus),
    ),
    periods = periodKeys();
  for (const [period, limit] of [
    ["day", settings.tipDaily ?? settings.tipMax * 5],
    ["month", settings.tipMonthly ?? settings.tipMax * 20],
  ] as const)
    if (
      tips
        .filter((t) => periodKeys(Date.parse(t.at))[period] === periods[period])
        .reduce((n, t) => n + t.amount, 0) +
        body.amount >
      limit
    )
      fail(409, "応援金額の期間上限に達しています");
  const tipId = id();
  await put(
    q,
    "tips",
    tipId,
    {
      id: tipId,
      userId: user.id,
      ...body,
      visibility: body.visibility ?? "private",
      provider,
      status: "決済待ち",
      paymentStatus: "pending",
      at: now(),
    },
    user.id,
  );
  return tipId;
}
