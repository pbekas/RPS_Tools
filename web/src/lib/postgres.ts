import "server-only";

import { readFileSync } from "fs";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  // Reuse the pool across Next.js development reloads.
  // eslint-disable-next-line no-var
  var __rpsPostgresPool: Pool | undefined;
}

function sslConfig(): false | { ca?: string; rejectUnauthorized: boolean } {
  if (process.env.PGSSLMODE === "disable") return false;
  const rootCert = process.env.PGSSLROOTCERT?.trim();
  if (rootCert) {
    return {
      ca: readFileSync(rootCert, "utf8"),
      rejectUnauthorized: true,
    };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("PGSSLROOTCERT is required for verified PostgreSQL TLS");
  }
  return { rejectUnauthorized: false };
}

function poolConfig(): ConstructorParameters<typeof Pool>[0] {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return {
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: sslConfig(),
    };
  }

  const host = process.env.PGHOST?.trim();
  const user = process.env.PGUSER?.trim();
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE?.trim() || "rps_call_qa";
  if (!host || !user || !password) {
    throw new Error(
      "DATABASE_URL or PGHOST/PGUSER/PGPASSWORD is required for PostgreSQL"
    );
  }

  return {
    host,
    port: Number(process.env.PGPORT || "5432"),
    database,
    user,
    password,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslConfig(),
  };
}

export function getPostgresPool(): Pool {
  if (!global.__rpsPostgresPool) {
    global.__rpsPostgresPool = new Pool(poolConfig());
  }
  return global.__rpsPostgresPool;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await getPostgresPool().query<T>(text, values);
  return result.rows;
}

export async function pingPostgres(): Promise<boolean> {
  const rows = await query<{ ok: number }>("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
