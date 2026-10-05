import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll } from "vitest";
import { NetlifyDB } from "@netlify/database-dev";
import { Pool } from "pg";

const migration = readFileSync(resolve(process.cwd(), "netlify/database/migrations/20261005000000_reception-persistence.sql"), "utf8");
let emulator: NetlifyDB | undefined;
let connectionString: string | undefined;
const fixtures: Array<{ pool: Pool; admin: Pool; schema: string; disposed: boolean }> = [];

type ReceptionTestDatabaseOptions = {
  connectionString?: string;
  maxConnections?: number;
  beforeQuery?: (sql: string) => void | Promise<void>;
};

async function startEmulator() {
  if (!emulator) {
    emulator = new NetlifyDB({ logger: () => undefined });
    connectionString = await emulator.start();
  }
  return connectionString!;
}

export async function createReceptionTestDatabase(options: ReceptionTestDatabaseOptions = {}) {
  const configuredConnection = options.connectionString ?? process.env.TEST_POSTGRES_URL?.trim();
  const connection = configuredConnection || await startEmulator();
  const schema = `reception_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: connection });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const rawPool = new Pool({ connectionString: connection, max: options.maxConnections ?? 1 });
  let pool: Pool;
  pool = new Proxy(rawPool, {
    get(target, property) {
      if (property === "connect") {
        return async () => {
          const client = await target.connect();
          await client.query(`SET search_path TO ${schema},public`);
          const clientQuery = client.query.bind(client);
          return new Proxy(client, {
            get(clientTarget, clientProperty) {
              if (clientProperty === "query") {
                return async (...args: unknown[]) => {
                  const first = args[0];
                  const sql = typeof first === "string" ? first : typeof first === "object" && first && "text" in first ? String(first.text) : "";
                  await options.beforeQuery?.(sql);
                  return (clientQuery as (...queryArgs: unknown[]) => Promise<unknown>)(...args);
                };
              }
              const value = Reflect.get(clientTarget, clientProperty, clientTarget);
              return typeof value === "function" ? value.bind(clientTarget) : value;
            },
          });
        };
      }
      if (property === "query") {
        return async (...args: unknown[]) => {
          const client = await pool.connect();
          try {
            return await (client.query as (...queryArgs: unknown[]) => Promise<unknown>)(...args);
          } finally {
            client.release();
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Pool;
  const fixture = { pool, admin, schema, disposed: false };
  fixtures.push(fixture);
  try {
    await pool.query(migration);
  } catch (error) {
    await disposeReceptionTestDatabase(fixture);
    throw error;
  }
  return {
    pool,
    schema,
    async dispose() { await disposeReceptionTestDatabase(fixture); },
  };
}

async function disposeReceptionTestDatabase(fixture: (typeof fixtures)[number]) {
  if (fixture.disposed) return;
  fixture.disposed = true;
  await fixture.pool.end();
  await fixture.admin.query(`DROP SCHEMA ${fixture.schema} CASCADE`);
  await fixture.admin.end();
}

afterAll(async () => {
  await Promise.all(fixtures.map(disposeReceptionTestDatabase));
  await emulator?.stop();
  emulator = undefined;
  connectionString = undefined;
  fixtures.length = 0;
});
