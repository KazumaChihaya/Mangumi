import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../src/app.ts";
import { config as configuration } from "../src/config.ts";
import { services } from "../src/services.ts";
import { hashPassword, id, now, digest } from "../src/security.ts";
import { processJobs } from "../src/jobs.ts";
import { get, put } from "../src/db.ts";
const directory = resolve("../../.local/live-tests");
const config = configuration({
  NODE_ENV: "test",
  PORT: "4193",
  APP_ORIGIN: "http://127.0.0.1:4193",
  SQLITE_PATH: ":memory:",
  UPLOAD_DIR: resolve(directory, "uploads"),
  WEB_ROOT: resolve("../member/dist-live"),
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  WORKERS: "off",
  LIVEKIT_URL: process.env.MANGUMI_TEST_LIVEKIT_URL ?? "",
  LIVEKIT_API_KEY: process.env.MANGUMI_TEST_LIVEKIT_URL ? "mangumitest" : "",
  LIVEKIT_API_SECRET: process.env.MANGUMI_TEST_LIVEKIT_URL
    ? "mangumi-local-test-secret-only-20261020-42"
    : "",
});
await mkdir(directory, { recursive: true });
const external = {
  ...services(config),
  mail: async (body: any) => {
    await writeFile(
      resolve(directory, `mail-${digest(body.to)}.json`),
      JSON.stringify(body),
    );
  },
};
const { app, db } = await createApp({
  config,
  services: external,
  logger: false,
  rateLimit: false,
});
await db.transaction(async (q) => {
  const free = await get(q, "plans", "free");
  await put(q, "plans", "free", {
    ...free,
    features: [...free.features, "投げ銭"],
  });
  for (const [role, email, name] of [
    ["super", "admin@example.test", "テスト運営"],
    ["member", "fan@example.test", "テストファン"],
    ["official", "official@example.test", "まんぞう"],
  ]) {
    await q.run(
      "INSERT INTO users (id,email,password_hash,profile,role,status,verified,created_at) VALUES (?,?,?,?,?,'active',1,?)",
      [
        id(),
        email,
        await hashPassword("Mangumi-test-password-42!"),
        JSON.stringify({
          name,
          avatar: "/assets/avatar.jpg",
          gender: "回答しない",
          publicGender: false,
          plan: "Free",
        }),
        role,
        now(),
      ],
    );
  }
});
if (config.livekitUrl)
  await db.transaction(async (q) => {
    const official = (
      await q.all("SELECT id FROM users WHERE role = 'official'")
    )[0];
    await q.run(
      "INSERT INTO entities (resource,id,owner_id,body) VALUES ('rooms','voice-test','',?)",
      [
        JSON.stringify({
          id: "voice-test",
          title: "音声通信テスト",
          host: "まんぞう",
          hostId: official.id,
          listeners: 0,
          status: "開催中",
          plan: "Free",
        }),
      ],
    );
  });
let active: Promise<void> | undefined;
const timer = setInterval(() => {
  if (!active)
    active = processJobs(db, external).finally(() => {
      active = undefined;
    });
}, 200);
await app.listen({ port: config.port, host: "127.0.0.1" });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    clearInterval(timer);
    await active;
    await app.close();
    process.exit(0);
  });
