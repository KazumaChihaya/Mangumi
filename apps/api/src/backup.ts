import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  writeFile,
  readFile,
  stat,
  mkdir,
  rename,
  unlink,
  rmdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { z } from "zod";
import { Database, get, list } from "./db.ts";
import type { Config } from "./config.ts";
import { fail, id } from "./security.ts";
const tables: Record<string, string[]> = {
  users: [
    "id",
    "email",
    "password_hash",
    "profile",
    "role",
    "status",
    "verified",
    "mfa_secret",
    "mfa_pending",
    "mfa_step",
    "recovery",
    "created_at",
  ],
  sessions: [
    "id",
    "user_id",
    "area",
    "csrf",
    "mfa",
    "expires_at",
    "touched_at",
    "agent",
    "ip",
  ],
  tokens: ["id", "user_id", "purpose", "payload", "expires_at"],
  entities: ["resource", "id", "owner_id", "body"],
  idempotency: [
    "scope",
    "request_key",
    "fingerprint",
    "response",
    "created_at",
  ],
  jobs: [
    "id",
    "kind",
    "payload",
    "due_at",
    "state",
    "attempts",
    "locked_until",
    "result",
  ],
  audit_logs: [
    "id",
    "actor_id",
    "action",
    "target",
    "reason",
    "before_json",
    "after_json",
    "ip",
    "created_at",
  ],
  webhook_events: ["id", "provider", "processed_at"],
};
const magic = Buffer.from("MANGUMI-BACKUP-1\n");
function key(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32)
    throw new Error("BACKUP_KEY must encode 32 random bytes");
  return bytes;
}
export async function createBackup(
  db: Database,
  config: Pick<Config, "files">,
  secret: string,
  path: string,
) {
  const encryptionKey = key(secret),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  await writeFile(path, Buffer.concat([magic, iv]), {
    flag: "wx",
    mode: 0o600,
  });
  let records = 0,
    files = 0;
  try {
    await db.transaction(async (q) => {
      if (!(await get(q, "settings", "global"))?.maintenance)
        fail(409, "バックアップ前にメンテナンスを有効にしてください");
      async function* rows() {
        yield JSON.stringify({
          kind: "metadata",
          version: 1,
          at: new Date().toISOString(),
        }) + "\n";
        for (const [table, columns] of Object.entries(tables))
          for (let offset = 0; ; offset += 200) {
            const batch = await q.all(
              `SELECT ${columns.join(",")} FROM ${table} ORDER BY ${columns[0]} LIMIT 200 OFFSET ?`,
              [offset],
            );
            for (const row of batch) {
              records++;
              yield JSON.stringify({ kind: "row", table, row }) + "\n";
            }
            if (batch.length < 200) break;
          }
        for (const media of await list(q, "media")) {
          if (!z.uuid().safeParse(media.id).success)
            throw new Error("Invalid media ID in backup");
          const data = await readFile(resolve(config.files, media.id));
          files++;
          yield JSON.stringify({
            kind: "file",
            id: media.id,
            data: data.toString("base64"),
          }) + "\n";
        }
      }
      await pipeline(
        Readable.from(rows()),
        createGzip(),
        cipher,
        createWriteStream(path, { flags: "a", mode: 0o600 }),
      );
    });
    await writeFile(path, cipher.getAuthTag(), { flag: "a" });
    return { records, files, bytes: (await stat(path)).size };
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
}
export async function restoreBackup(
  db: Database,
  config: Pick<Config, "files">,
  secret: string,
  path: string,
) {
  const encryptionKey = key(secret),
    handle = await import("node:fs/promises").then((fs) => fs.open(path, "r"));
  const size = (await handle.stat()).size,
    header = Buffer.alloc(magic.length + 12),
    tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }
  if (
    size < header.length + 16 ||
    !header.subarray(0, magic.length).equals(magic)
  )
    throw new Error("Invalid backup header");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    header.subarray(magic.length),
  );
  decipher.setAuthTag(tag);
  const directory = resolve(config.files),
    staging = join(directory, `.restore-${id()}`);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const staged: string[] = [],
    moved: string[] = [];
  let records = 0,
    files = 0;
  try {
    await db.transaction(async (q) => {
      for (const table of Object.keys(tables))
        if ((await q.all(`SELECT COUNT(*) AS count FROM ${table}`))[0].count)
          fail(409, "復旧先は空の新しいデータベースを指定してください");
      const uncompressed = createGunzip(),
        done = pipeline(
          createReadStream(path, { start: header.length, end: size - 17 }),
          decipher,
          uncompressed,
        );
      // Observe a failed authentication immediately, then rethrow before commit.
      done.catch(() => {});
      let metadata = false;
      for await (const line of createInterface({
        input: uncompressed,
        crlfDelay: Infinity,
      })) {
        const row = JSON.parse(line);
        if (row.kind === "metadata") {
          if (metadata || row.version !== 1)
            throw new Error("Invalid backup metadata");
          metadata = true;
          continue;
        }
        if (!metadata) throw new Error("Missing backup metadata");
        if (row.kind === "row") {
          const columns = tables[row.table];
          if (
            !columns ||
            !row.row ||
            Object.keys(row.row).some((k) => !columns.includes(k))
          )
            throw new Error("Invalid backup table");
          const values = columns.map((c) => row.row[c] ?? null);
          if (
            values.some(
              (v) =>
                v !== null && typeof v !== "number" && typeof v !== "string",
            )
          )
            throw new Error("Invalid backup value");
          await q.run(
            `INSERT INTO ${row.table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            values,
          );
          records++;
        } else if (row.kind === "file") {
          if (
            !z.uuid().safeParse(row.id).success ||
            typeof row.data !== "string" ||
            row.data.length > 30 * 1024 * 1024
          )
            throw new Error("Invalid backup file");
          await writeFile(
            join(staging, row.id),
            Buffer.from(row.data, "base64"),
            { flag: "wx", mode: 0o600 },
          );
          staged.push(row.id);
          files++;
        } else throw new Error("Invalid backup record");
      }
      await done;
      if (!metadata) throw new Error("Empty backup");
      for (const media of await list(q, "media"))
        if (!staged.includes(media.id))
          throw new Error("Backup media is missing");
      for (const file of staged) {
        if (await stat(join(directory, file)).catch(() => undefined))
          throw new Error("Restore would overwrite a file");
        await rename(join(staging, file), join(directory, file));
        moved.push(file);
      }
    });
    return { records, files };
  } catch (error) {
    for (const file of moved)
      await unlink(join(directory, file)).catch(() => {});
    throw error;
  } finally {
    for (const file of staged)
      await unlink(join(staging, file)).catch(() => {});
    await rmdir(staging).catch(() => {});
  }
}
