import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import argon2 from "argon2";
import { BlockList, isIP } from "node:net";
import { z } from "zod";
import type { Query } from "./db.ts";

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const later = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toISOString();
export function validNetwork(value: string) {
  const [address, prefix, extra] = value.split("/");
  const family = isIP(address);
  return (
    !!family &&
    extra === undefined &&
    (prefix === undefined ||
      (/^\d+$/.test(prefix) &&
        Number(prefix) >= 0 &&
        Number(prefix) <= (family === 4 ? 32 : 128)))
  );
}
export function networkAllowed(
  networks: string[] | undefined,
  address: string,
) {
  if (!networks?.length) return true;
  const list = new BlockList();
  for (const network of networks) {
    if (!validNetwork(network)) return false;
    const [ip, prefix] = network.split("/"),
      family = isIP(ip) === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) list.addAddress(ip, family);
    else list.addSubnet(ip, Number(prefix), family);
  }
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  return list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}
export const secret = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class Problem extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = "request_failed",
  ) {
    super(message);
  }
}
export function fail(status: number, message: string, code?: string): never {
  throw new Problem(status, message, code);
}
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const passwordSchema = z
  .string()
  .min(12, "パスワードは12文字以上にしてください")
  .max(128)
  .refine(
    (value) => !/^(password|123456|qwerty|aaaaaaaa)/i.test(value),
    "別のパスワードを選んでください",
  );
export const hashPassword = (value: string) =>
  argon2.hash(value, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
export function seal(value: string, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function unseal(value: string, key: string) {
  const data = Buffer.from(value, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64"),
    data.subarray(0, 12),
  );
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function totpSecret() {
  return Array.from(randomBytes(32), (byte) => alphabet[byte & 31]).join("");
}
export function totp(value: string, step = Math.floor(Date.now() / 30000)) {
  let bits = "";
  for (const char of value)
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  );
}
export function verifyTotp(value: string, code: string, lastStep: number) {
  if (!/^\d{6}$/.test(code)) return -1;
  const step = Math.floor(Date.now() / 30000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (
      candidate > lastStep &&
      timingSafeEqual(Buffer.from(totp(value, candidate)), Buffer.from(code))
    )
      return candidate;
  }
  return -1;
}
export async function audit(
  q: Query,
  actor: string,
  action: string,
  target: string,
  before: unknown,
  after: unknown,
  reason: string,
  ip: string,
) {
  await q.run(
    "INSERT INTO audit_logs (id, actor_id, action, target, reason, before_json, after_json, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id(),
      actor,
      action.slice(0, 100),
      target.slice(0, 200),
      reason,
      JSON.stringify(before ?? null),
      JSON.stringify(after ?? null),
      ip,
      now(),
    ],
  );
}
export async function once<T>(
  q: Query,
  scope: string,
  key: string,
  payload: unknown,
  work: () => Promise<T>,
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    fail(400, "再送防止キーを指定してください");
  const fingerprint = digest(JSON.stringify(payload));
  const previous = (
    await q.all(
      "SELECT * FROM idempotency WHERE scope = ? AND request_key = ?",
      [scope, key],
    )
  )[0];
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      fail(409, "同じキーで異なる内容を送信できません");
    return JSON.parse(previous.response);
  }
  const value = await work();
  await q.run(
    "INSERT INTO idempotency (scope, request_key, fingerprint, response, created_at) VALUES (?, ?, ?, ?, ?)",
    [scope, key, fingerprint, JSON.stringify(value), now()],
  );
  return value;
}
