import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { config as configuration } from "../src/config.ts";
import { id, now, hashPassword } from "../src/security.ts";
import { put } from "../src/db.ts";
const database = process.env.MANGUMI_TEST_DATABASE_URL ?? "";
if (database) {
  const url = new URL(database);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/mangumi_test");
}
const config = configuration({
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:3001",
  SQLITE_PATH: ":memory:",
  DATABASE_URL: database,
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  WORKERS: "off",
});
const { app, db } = await createApp({
  config,
  logger: false,
  rateLimit: false,
});
const password = "Mangumi-load-test-only-42!",
  passwordHash = await hashPassword(password),
  emails: string[] = [];
try {
  await db.transaction(async (q) => {
    for (let n = 0; n < 200; n++) {
      const userId = id(),
        email = `${userId}@load.example.test`;
      if (n < 8) emails.push(email);
      await q.run(
        "INSERT INTO users (id,email,password_hash,profile,role,status,verified,created_at) VALUES (?,?,?,?,'member','active',1,?)",
        [
          userId,
          email,
          passwordHash,
          JSON.stringify({
            name: `負荷検証${n}`,
            avatar: "/assets/avatar.jpg",
            plan: "Free",
          }),
          now(),
        ],
      );
    }
    for (let n = 0; n < 30; n++) {
      const scheduleId = id();
      await put(q, "schedules", scheduleId, {
        id: scheduleId,
        title: `負荷検証の配信${n}`,
        date: "2026-12-01",
        time: "20:00",
        host: "検証用",
        status: "公開",
        image: "/assets/thumb_1.jpg",
        url: "https://youtube.com/",
        description: "synthetic load fixture",
        plan: "Free",
      });
    }
  });
  const cookies: string[] = [];
  for (const email of emails) {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: config.origin, "x-mangumi-request": "1" },
      payload: { email, password },
    });
    assert.equal(login.statusCode, 200, login.body);
    cookies.push(login.cookies.map((c) => `${c.name}=${c.value}`).join("; "));
  }
  const times: number[] = [];
  const started = performance.now();
  await Promise.all(
    cookies.map(async (cookie) => {
      for (let n = 0; n < 25; n++) {
        const at = performance.now(),
          response = await app.inject({
            url: "/api/state",
            headers: { cookie },
          });
        assert.equal(response.statusCode, 200, response.body);
        assert.ok(response.json().state.schedules.length >= 30);
        times.push(performance.now() - at);
      }
    }),
  );
  times.sort((a, b) => a - b);
  const stats = {
    database: database ? "mariadb" : "sqlite",
    syntheticMembers: 200,
    schedules: 30,
    concurrency: 8,
    requests: times.length,
    p50Ms: times[Math.floor(times.length * 0.5)],
    p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    maxMs: times.at(-1),
    durationMs: performance.now() - started,
  };
  await mkdir(resolve("../../.local"), { recursive: true });
  await writeFile(
    resolve(`../../.local/load-${stats.database}.json`),
    JSON.stringify(stats, null, 2),
  );
  console.log(stats);
  assert.ok(
    stats.p95Ms < 500,
    `p95 ${stats.p95Ms.toFixed(1)} ms exceeds the 500 ms acceptance target for this workload`,
  );
} finally {
  await app.close();
}
