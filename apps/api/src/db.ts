import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import mariadb, { type Pool, type PoolConnection } from "mariadb";
import type { Config } from "./config.ts";

export interface Query {
  all<T = Record<string, any>>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<void>;
}
function transactionQuery(source: Query): Query {
  const reads = new Map<string, any[]>();
  return {
    all: async <T = Record<string, any>>(sql: string, params: any[] = []) => {
      const key = JSON.stringify([sql, params]);
      if (!reads.has(key)) reads.set(key, await source.all(sql, params));
      return structuredClone(reads.get(key)) as T[];
    },
    run: async (sql, params = []) => {
      reads.clear();
      await source.run(sql, params);
    },
  };
}
export class Database implements Query {
  private sqlite?: DatabaseSync;
  private pool?: Pool;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(config: Pick<Config, "database" | "sqlite">) {
    if (config.database) {
      const uri = new URL(config.database);
      this.pool = mariadb.createPool({
        host: uri.hostname,
        port: Number(uri.port || 3306),
        user: decodeURIComponent(uri.username),
        password: decodeURIComponent(uri.password),
        database: uri.pathname.slice(1),
        connectionLimit: 8,
        bigIntAsNumber: true,
      });
    } else {
      if (config.sqlite !== ":memory:")
        mkdirSync(dirname(config.sqlite), { recursive: true });
      this.sqlite = new DatabaseSync(config.sqlite);
      this.sqlite.exec(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;",
      );
    }
  }
  async all<T = Record<string, any>>(
    sql: string,
    params: any[] = [],
  ): Promise<T[]> {
    if (this.sqlite) return this.sqlite.prepare(sql).all(...params) as T[];
    return this.pool!.query(sql, params);
  }
  async run(sql: string, params: any[] = []) {
    if (this.sqlite) this.sqlite.prepare(sql).run(...params);
    else await this.pool!.query(sql, params);
  }
  async initialize() {
    const statements = [
      "CREATE TABLE IF NOT EXISTS app_lock (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)",
      `CREATE TABLE IF NOT EXISTS users (id VARCHAR(100) PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, profile TEXT NOT NULL, role VARCHAR(40) NOT NULL DEFAULT 'member',
        status VARCHAR(40) NOT NULL DEFAULT 'active', verified INTEGER NOT NULL DEFAULT 0,
        mfa_secret TEXT, mfa_pending TEXT, mfa_step BIGINT NOT NULL DEFAULT -1, recovery TEXT,
        created_at VARCHAR(30) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS sessions (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(100) NOT NULL,
        area VARCHAR(12) NOT NULL, csrf VARCHAR(64) NOT NULL, mfa INTEGER NOT NULL DEFAULT 0,
        expires_at VARCHAR(30) NOT NULL, touched_at VARCHAR(30) NOT NULL, agent TEXT NOT NULL, ip TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS tokens (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(100) NOT NULL,
        purpose VARCHAR(30) NOT NULL, payload TEXT NOT NULL, expires_at VARCHAR(30) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS entities (resource VARCHAR(50) NOT NULL, id VARCHAR(100) NOT NULL,
        owner_id VARCHAR(100) NOT NULL DEFAULT '', body TEXT NOT NULL,
        PRIMARY KEY (resource, id))`,
      `CREATE TABLE IF NOT EXISTS idempotency (scope VARCHAR(150) NOT NULL, request_key VARCHAR(100) NOT NULL,
        fingerprint VARCHAR(64) NOT NULL, response TEXT NOT NULL, created_at VARCHAR(30) NOT NULL,
        PRIMARY KEY(scope, request_key))`,
      `CREATE TABLE IF NOT EXISTS jobs (id VARCHAR(100) PRIMARY KEY, kind VARCHAR(30) NOT NULL,
        payload TEXT NOT NULL, due_at VARCHAR(30) NOT NULL, state VARCHAR(20) NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, locked_until VARCHAR(30), result TEXT)`,
      `CREATE TABLE IF NOT EXISTS audit_logs (id VARCHAR(100) PRIMARY KEY, actor_id VARCHAR(100) NOT NULL,
        action VARCHAR(100) NOT NULL, target VARCHAR(200) NOT NULL, reason TEXT NOT NULL,
        before_json TEXT NOT NULL, after_json TEXT NOT NULL, ip TEXT NOT NULL, created_at VARCHAR(30) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS webhook_events (id VARCHAR(150) PRIMARY KEY, provider VARCHAR(30) NOT NULL,
        processed_at VARCHAR(30) NOT NULL)`,
      "CREATE INDEX IF NOT EXISTS entities_owner ON entities(resource, owner_id)",
      "CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)",
      "CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state, due_at)",
      "CREATE INDEX IF NOT EXISTS audit_created ON audit_logs(created_at)",
    ];
    for (const sql of statements) await this.run(sql);
    const lock = await this.all("SELECT id FROM app_lock WHERE id = 1");
    if (!lock.length)
      await this.run("INSERT INTO app_lock (id, revision) VALUES (1, 0)");
  }
  async transaction<T>(work: (query: Query) => Promise<T>): Promise<T> {
    // SQLite uses one connection. Queue callbacks so async work cannot interleave transactions.
    if (this.sqlite) {
      const task = this.tail.then(async () => {
        this.sqlite!.exec("BEGIN IMMEDIATE");
        try {
          const value = await work(transactionQuery(this));
          this.sqlite!.exec("COMMIT");
          return value;
        } catch (error) {
          this.sqlite!.exec("ROLLBACK");
          throw error;
        }
      });
      this.tail = task.catch(() => {});
      return task;
    }
    const connection: PoolConnection = await this.pool!.getConnection();
    const query: Query = {
      all: async (sql, params = []) => connection.query(sql, params),
      run: async (sql, params = []) => {
        await connection.query(sql, params);
      },
    };
    try {
      await connection.beginTransaction();
      // The lock gives business mutations the same serial semantics in both databases.
      await query.run(
        "UPDATE app_lock SET revision = revision + 1 WHERE id = 1",
      );
      const value = await work(transactionQuery(query));
      await connection.commit();
      return value;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  async close() {
    await this.tail;
    this.sqlite?.close();
    await this.pool?.end();
  }
}

export async function list<T = any>(
  q: Query,
  resource: string,
  owner?: string,
): Promise<T[]> {
  const rows = await q.all(
    "SELECT body FROM entities WHERE resource = ?" +
      (owner === undefined ? "" : " AND owner_id = ?"),
    owner === undefined ? [resource] : [resource, owner],
  );
  return rows.map((row) => JSON.parse(row.body));
}
export async function get<T = any>(
  q: Query,
  resource: string,
  id: string,
): Promise<T | undefined> {
  if (typeof id !== "string" || !id) return undefined;
  const rows = await q.all(
    "SELECT body FROM entities WHERE resource = ? AND id = ?",
    [resource, id],
  );
  return rows[0] ? JSON.parse(rows[0].body) : undefined;
}
export async function put(
  q: Query,
  resource: string,
  id: string,
  body: unknown,
  owner = "",
) {
  const exists = await get(q, resource, id);
  if (exists)
    await q.run(
      "UPDATE entities SET body = ?, owner_id = ? WHERE resource = ? AND id = ?",
      [JSON.stringify(body), owner, resource, id],
    );
  else
    await q.run(
      "INSERT INTO entities (resource, id, owner_id, body) VALUES (?, ?, ?, ?)",
      [resource, id, owner, JSON.stringify(body)],
    );
}
export async function remove(q: Query, resource: string, id: string) {
  await q.run("DELETE FROM entities WHERE resource = ? AND id = ?", [
    resource,
    id,
  ]);
}
