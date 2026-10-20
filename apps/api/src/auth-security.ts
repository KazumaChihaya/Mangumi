import type { FastifyRequest } from "fastify";
import { get, put, type Query } from "./db.ts";
import type { User } from "./auth.ts";
import type { Config } from "./config.ts";
import { digest, id, later, now } from "./security.ts";
import { enqueue, notifyUser } from "./jobs.ts";
export async function securityNotice(
  q: Query,
  user: User,
  title: string,
  body: string,
  config: Config,
) {
  if (!user.verified) return;
  const event = id(),
    text = `${body}\n日時: ${now()}\n心当たりがない場合はログイン中の端末を解除し、パスワードを再設定してください。\n${config.origin}/u/U098`;
  await put(
    q,
    "securityEvents",
    event,
    {
      id: event,
      userId: user.id,
      title,
      at: now(),
      expiresAt: later(180 * 86400),
    },
    user.id,
  );
  await enqueue(q, digest(`security-mail:${event}`), "mail", {
    to: user.email,
    subject: title,
    text,
  });
  await notifyUser(
    q,
    user.id,
    `security:${event}`,
    title,
    body,
    "/u/U098",
    "security",
    { urgent: "1" },
  );
}
export async function recordLogin(
  q: Query,
  user: User,
  area: string,
  request: FastifyRequest,
  config: Config,
) {
  const agent = String(request.headers["user-agent"] ?? "不明な端末").slice(
      0,
      300,
    ),
    key = digest(`${user.id}:${area}:${agent}:${request.ip}`);
  if (await get(q, "knownLogins", key)) return;
  const prior = (
    await q.all(
      "SELECT id FROM entities WHERE resource = 'knownLogins' AND owner_id = ?",
      [user.id],
    )
  ).length;
  await put(
    q,
    "knownLogins",
    key,
    { id: key, area, at: now(), expiresAt: later(180 * 86400) },
    user.id,
  );
  if (prior)
    await securityNotice(
      q,
      user,
      "新しい端末・接続元でログインがありました",
      `端末: ${agent}\n接続元: ${request.ip}`,
      config,
    );
}
