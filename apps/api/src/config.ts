import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export type Config = ReturnType<typeof config>;
export function config(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const address = new URL(env.APP_ORIGIN ?? "http://localhost:3001");
  if (
    address.username ||
    address.password ||
    address.pathname !== "/" ||
    address.search ||
    address.hash ||
    !["http:", "https:"].includes(address.protocol)
  )
    throw new Error("APP_ORIGIN must be an HTTP(S) origin without a path");
  const origin = address.origin;
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  let key = env.ENCRYPTION_KEY ?? "";
  if (!key && !production) {
    const path = resolve(".local/encryption-key");
    mkdirSync(resolve(".local"), { recursive: true });
    if (!existsSync(path))
      writeFileSync(path, randomBytes(32).toString("base64"), {
        mode: 0o600,
        flag: "wx",
      });
    key = readFileSync(path, "utf8").trim();
  }
  if (Buffer.from(key, "base64").length !== 32)
    throw new Error("ENCRYPTION_KEY must encode 32 random bytes");
  if (production && !origin.startsWith("https://"))
    throw new Error("APP_ORIGIN must use HTTPS in production");
  return {
    production,
    origin,
    key,
    port,
    database: env.DATABASE_URL ?? "",
    sqlite: env.SQLITE_PATH ?? resolve(".local/mangumi.sqlite"),
    files: resolve(env.UPLOAD_DIR ?? ".local/uploads"),
    webRoot: resolve(env.WEB_ROOT ?? "../member/dist-live"),
    smtpUrl: env.SMTP_URL ?? "",
    mailFrom: env.MAIL_FROM ?? "",
    vapidPublic: env.VAPID_PUBLIC_KEY ?? "",
    vapidPrivate: env.VAPID_PRIVATE_KEY ?? "",
    vapidSubject: env.VAPID_SUBJECT ?? "",
    expoAccessToken: env.EXPO_ACCESS_TOKEN ?? "",
    appleBundleId: env.APPLE_BUNDLE_ID ?? "",
    appleTeamId: env.APPLE_TEAM_ID ?? "",
    appleAppId: env.APPLE_APP_ID ? Number(env.APPLE_APP_ID) : undefined,
    appleEnvironment: env.APPLE_ENVIRONMENT ?? "Production",
    appleRootCertificates: env.APPLE_ROOT_CERTIFICATES ?? "",
    googlePackage: env.GOOGLE_PLAY_PACKAGE ?? "",
    androidCertificateHashes: (env.ANDROID_CERT_SHA256 ?? "")
      .split(",")
      .filter((v) => /^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(v)),
    googleNotificationAudience: env.GOOGLE_NOTIFICATION_AUDIENCE ?? "",
    googleNotificationEmail: env.GOOGLE_NOTIFICATION_EMAIL ?? "",
    stripeKey: env.STRIPE_SECRET_KEY ?? "",
    stripeWebhook: env.STRIPE_WEBHOOK_SECRET ?? "",
    livekitUrl: env.LIVEKIT_URL ?? "",
    livekitKey: env.LIVEKIT_API_KEY ?? "",
    livekitSecret: env.LIVEKIT_API_SECRET ?? "",
    workers: env.WORKERS !== "off",
    log: env.LOG_LEVEL ?? "info",
  };
}
