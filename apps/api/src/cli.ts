import "./env.ts";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { config } from "./config.ts";
import { createApp } from "./app.ts";
import { apiSpecification } from "./openapi.ts";
import { Database } from "./db.ts";
import { createBackup, restoreBackup } from "./backup.ts";
import {
  audit,
  emailSchema,
  hashPassword,
  id,
  now,
  passwordSchema,
} from "./security.ts";

const command = process.argv[2];
if (command === "keys") {
  const path = resolve(process.env.KEYS_FILE ?? "../../.env.keys.generated");
  const vapid = webpush.generateVAPIDKeys();
  await writeFile(
    path,
    `ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\nBACKUP_KEY=${randomBytes(32).toString("base64")}\nVAPID_PUBLIC_KEY=${vapid.publicKey}\nVAPID_PRIVATE_KEY=${vapid.privateKey}\nMARIADB_PASSWORD=${randomBytes(32).toString("base64url")}\nMARIADB_ROOT_PASSWORD=${randomBytes(32).toString("base64url")}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(`秘密情報を保存しました: ${path}`);
} else if (command === "backup" || command === "restore") {
  const settings = { ...config(), workers: false };
  if (!process.env.BACKUP_FILE || !process.env.BACKUP_KEY)
    throw new Error("Set BACKUP_FILE and BACKUP_KEY");
  if (command === "restore") {
    const target = process.env.RESTORE_DATABASE_URL ?? "";
    if (
      target &&
      !/^\/mangumi_restore_[a-z0-9_]+$/.test(new URL(target).pathname)
    )
      throw new Error("Restore database name must start with mangumi_restore_");
    if (!process.env.RESTORE_UPLOAD_DIR)
      throw new Error("Set a separate RESTORE_UPLOAD_DIR");
    settings.database = target;
    settings.sqlite =
      process.env.RESTORE_SQLITE_PATH ??
      resolve(`.local/restore-${id()}.sqlite`);
    settings.files = resolve(process.env.RESTORE_UPLOAD_DIR);
  }
  const db = new Database(settings);
  await db.initialize();
  try {
    console.log(
      command === "backup"
        ? await createBackup(
            db,
            settings,
            process.env.BACKUP_KEY,
            resolve(process.env.BACKUP_FILE),
          )
        : await restoreBackup(
            db,
            settings,
            process.env.BACKUP_KEY,
            resolve(process.env.BACKUP_FILE),
          ),
    );
  } finally {
    await db.close();
  }
} else {
  const { app, db } = await createApp({
    config: { ...config(), workers: false },
    logger: false,
  });
  try {
    if (command === "admin") {
      const email = emailSchema.parse(process.env.BOOTSTRAP_ADMIN_EMAIL);
      const password = passwordSchema.parse(
        process.env.BOOTSTRAP_ADMIN_PASSWORD,
      );
      await db.transaction(async (q) => {
        if (
          (await q.all("SELECT id FROM users WHERE email = ?", [email])).length
        )
          throw new Error("このメールアドレスは登録済みです");
        const userId = id();
        await q.run(
          "INSERT INTO users (id,email,password_hash,profile,role,status,verified,created_at) VALUES (?,?,?,?,'super','active',1,?)",
          [
            userId,
            email,
            await hashPassword(password),
            JSON.stringify({
              name: "運営管理者",
              gender: "回答しない",
              publicGender: false,
              avatar: "/assets/avatar.jpg",
              plan: "Free",
            }),
            now(),
          ],
        );
        await audit(
          q,
          "console",
          "admin.bootstrap",
          userId,
          null,
          { role: "super" },
          "サーバー管理者による初期管理者作成",
          "console",
        );
      });
      console.log(
        "管理者を作成しました。初回ログインで二要素認証を登録してください。",
      );
    } else if (command === "mfa-reset") {
      const email = emailSchema.parse(process.env.RECOVERY_ADMIN_EMAIL);
      const reason = process.env.RECOVERY_REASON;
      if (!reason || reason.length < 10)
        throw new Error(
          "RECOVERY_REASONに本人確認と復旧の理由を指定してください",
        );
      await db.transaction(async (q) => {
        const user = (
          await q.all(
            "SELECT id FROM users WHERE email = ? AND role IN ('super','content','moderator','support','finance')",
            [email],
          )
        )[0];
        if (!user) throw new Error("対象の管理者が見つかりません");
        await q.run(
          "UPDATE users SET mfa_secret = NULL, mfa_pending = NULL, recovery = NULL, mfa_step = -1 WHERE id = ?",
          [user.id],
        );
        await q.run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
        await audit(
          q,
          "console",
          "admin.mfa.recovery",
          user.id,
          null,
          null,
          reason,
          "console",
        );
      });
      console.log(
        "二要素認証を解除しました。次回ログインで再登録してください。",
      );
    } else if (command === "openapi") {
      await app.ready();
      const path = resolve("../../docs/openapi.json");
      await writeFile(
        path,
        JSON.stringify(apiSpecification(app.swagger()), null, 2),
      );
      console.log(path);
    } else throw new Error("コマンド: admin / mfa-reset / keys / openapi");
  } finally {
    await app.close();
  }
}
