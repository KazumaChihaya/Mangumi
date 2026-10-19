import nodemailer from "nodemailer";
import webpush from "web-push";
import Stripe from "stripe";
import {
  AccessToken,
  RoomServiceClient,
  WebhookReceiver,
  TrackSource,
} from "livekit-server-sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "./config.ts";
import { fail, id } from "./security.ts";

export function services(config: Config) {
  const stripe = config.stripeKey
    ? new Stripe(config.stripeKey, { maxNetworkRetries: 2, timeout: 15000 })
    : undefined;
  const smtp = config.smtpUrl ? new URL(config.smtpUrl) : undefined;
  const mail = smtp
    ? nodemailer.createTransport({
        host: smtp.hostname,
        port: Number(smtp.port || (smtp.protocol === "smtps:" ? 465 : 587)),
        secure: smtp.protocol === "smtps:",
        requireTLS: config.production && smtp.protocol !== "smtps:",
        auth: smtp.username
          ? {
              user: decodeURIComponent(smtp.username),
              pass: decodeURIComponent(smtp.password),
            }
          : undefined,
        connectionTimeout: 10000,
        socketTimeout: 20000,
      })
    : undefined;
  const roomService =
    config.livekitUrl && config.livekitKey && config.livekitSecret
      ? new RoomServiceClient(
          config.livekitUrl.replace(/^ws/, "http"),
          config.livekitKey,
          config.livekitSecret,
        )
      : undefined;
  const receiver = roomService
    ? new WebhookReceiver(config.livekitKey, config.livekitSecret)
    : undefined;
  return {
    stripe,
    roomService,
    receiver,
    async mail(message: { to: string; subject: string; text: string }) {
      if (mail && config.mailFrom) {
        await mail.sendMail({ ...message, from: config.mailFrom });
        return;
      }
      if (config.production) fail(503, "メール配信サービスの設定が必要です");
      const path = resolve(config.files, "../outbox");
      await mkdir(path, { recursive: true });
      await writeFile(
        resolve(path, `${id()}.json`),
        JSON.stringify(message, null, 2),
        { mode: 0o600 },
      );
    },
    async push(subscription: any, payload: unknown) {
      if (!config.vapidPublic || !config.vapidPrivate || !config.vapidSubject)
        fail(503, "Push配信の設定が必要です");
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 3600,
        vapidDetails: {
          publicKey: config.vapidPublic,
          privateKey: config.vapidPrivate,
          subject: config.vapidSubject,
        },
      });
    },
    async voiceToken(
      room: string,
      userId: string,
      name: string,
      publish: boolean,
    ) {
      if (!roomService) fail(503, "音声サーバーの設定が必要です");
      const token = new AccessToken(config.livekitKey, config.livekitSecret, {
        identity: userId,
        name,
        ttl: 120,
      });
      token.addGrant({
        roomJoin: true,
        room,
        canPublish: publish,
        canPublishSources: [TrackSource.MICROPHONE],
        canSubscribe: true,
        canPublishData: true,
      });
      return { token: await token.toJwt(), url: config.livekitUrl };
    },
    requireStripe() {
      return stripe ?? fail(503, "決済サービスの設定が必要です");
    },
  };
}
export type Services = ReturnType<typeof services>;
