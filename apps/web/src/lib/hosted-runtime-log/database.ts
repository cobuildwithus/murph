import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import pg, { type Pool as PgPool } from "pg";

const { Pool } = pg;

const DEFAULT_HOSTED_RUNTIME_LOG_DATABASE_POOL_MAX = 5;
const MAX_HOSTED_RUNTIME_LOG_DATABASE_POOL_MAX = 10;
const HOSTED_RUNTIME_LOG_DATABASE_CONNECTION_TIMEOUT_MS = 3_000;
const HOSTED_RUNTIME_LOG_DATABASE_IDLE_TIMEOUT_MS = 30_000;
const HOSTED_RUNTIME_LOG_DATABASE_QUERY_TIMEOUT_MS = 12_000;

const globalForHostedRuntimeLogDatabase = globalThis as typeof globalThis & {
  __murphHostedRuntimeLogPool?: PgPool;
};

let hostedRuntimeLogPool = globalForHostedRuntimeLogDatabase.__murphHostedRuntimeLogPool;

export const HOSTED_RUNTIME_LOG_DATABASE_URL_REQUIRED_MESSAGE =
  "HOSTED_RUNTIME_LOG_DATABASE_URL is required in production.";
export const HOSTED_RUNTIME_LOG_DATABASE_MUST_NOT_ALIAS_PRIMARY_MESSAGE =
  "HOSTED_RUNTIME_LOG_DATABASE_URL must not name the primary logical database; the migration preflight separately verifies physical cluster isolation.";
export const HOSTED_RUNTIME_LOG_DATABASE_ENDPOINTS_MUST_MATCH_MESSAGE =
  "HOSTED_RUNTIME_LOG_DATABASE_URL and HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL must name the same database.";

export function readHostedRuntimeLogDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = nonEmpty(environment.HOSTED_RUNTIME_LOG_DATABASE_URL);
  if (!configured) {
    throw new TypeError(HOSTED_RUNTIME_LOG_DATABASE_URL_REQUIRED_MESSAGE);
  }

  return normalizeHostedRuntimeLogConnectionString(configured);
}

export function isHostedRuntimeLogDatabaseConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = nonEmpty(environment.HOSTED_RUNTIME_LOG_DATABASE_URL);
  if (!configured) {
    if (isHostedRuntimeLogProductionEnvironment(environment)) {
      throw new TypeError(HOSTED_RUNTIME_LOG_DATABASE_URL_REQUIRED_MESSAGE);
    }
    return false;
  }

  const direct = nonEmpty(environment.HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL);
  if (direct && !hostedRuntimeLogDatabaseNamesMatch(configured, direct)) {
    throw new TypeError(HOSTED_RUNTIME_LOG_DATABASE_ENDPOINTS_MUST_MATCH_MESSAGE);
  }

  const runtimeLogCandidates = [configured, direct]
    .filter((value): value is string => value !== null);
  const primaryCandidates = [
    nonEmpty(environment.DATABASE_URL),
    nonEmpty(environment.DIRECT_DATABASE_URL),
  ].filter((value): value is string => value !== null);
  const aliasesPrimary = runtimeLogCandidates.some((runtimeLogUrl) =>
    primaryCandidates.some((primaryUrl) =>
      databaseIdentity(runtimeLogUrl) === databaseIdentity(primaryUrl)
    )
  );
  if (aliasesPrimary) {
    throw new TypeError(HOSTED_RUNTIME_LOG_DATABASE_MUST_NOT_ALIAS_PRIMARY_MESSAGE);
  }

  return true;
}

export function resolveHostedRuntimeLogDatabasePoolMax(
  rawValue = process.env.HOSTED_RUNTIME_LOG_DATABASE_POOL_MAX,
): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_HOSTED_RUNTIME_LOG_DATABASE_POOL_MAX)
    : DEFAULT_HOSTED_RUNTIME_LOG_DATABASE_POOL_MAX;
}

export function getHostedRuntimeLogPool(): PgPool {
  if (hostedRuntimeLogPool) {
    return hostedRuntimeLogPool;
  }

  if (!isHostedRuntimeLogDatabaseConfigured()) {
    throw new TypeError(HOSTED_RUNTIME_LOG_DATABASE_URL_REQUIRED_MESSAGE);
  }

  const max = resolveHostedRuntimeLogDatabasePoolMax();
  hostedRuntimeLogPool = new Pool({
    connectionString: readHostedRuntimeLogDatabaseUrl(),
    connectionTimeoutMillis: HOSTED_RUNTIME_LOG_DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: HOSTED_RUNTIME_LOG_DATABASE_IDLE_TIMEOUT_MS,
    max,
    // PlanetScale's transaction-mode PgBouncer rejects statement_timeout as a
    // startup parameter. Migration preflight verifies the runtime role's
    // server-side 10-second bound; this slightly longer client timeout covers
    // transport failures after PostgreSQL has had time to cancel the query.
    query_timeout: HOSTED_RUNTIME_LOG_DATABASE_QUERY_TIMEOUT_MS,
  });
  attachDatabasePool(hostedRuntimeLogPool);
  hostedRuntimeLogPool.on("error", (error: Error) => {
    console.error("Hosted runtime log database idle connection failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  });
  console.info("Hosted runtime log database pool configured.", {
    maxConnections: max,
  });

  if (process.env.NODE_ENV !== "production") {
    globalForHostedRuntimeLogDatabase.__murphHostedRuntimeLogPool =
      hostedRuntimeLogPool;
  }

  return hostedRuntimeLogPool;
}

function normalizeHostedRuntimeLogConnectionString(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  let changed = false;
  for (const key of ["sslcert", "sslkey", "sslrootcert"] as const) {
    if (parsed.searchParams.get(key) === "system") {
      parsed.searchParams.delete(key);
      changed = true;
    }
  }
  return changed ? parsed.toString() : databaseUrl;
}

function hostedRuntimeLogDatabaseNamesMatch(
  runtimeUrl: string,
  directUrl: string,
): boolean {
  const runtimeName = readPostgresDatabaseName(runtimeUrl);
  const directName = readPostgresDatabaseName(directUrl);
  return runtimeName !== null
    && directName !== null
    && runtimeName === directName;
}

function readPostgresDatabaseName(value: string): string | null {
  const normalized = normalizeHostedRuntimeLogConnectionString(value);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return null;
    }
    const name = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function databaseIdentity(value: string): string {
  const normalized = normalizeHostedRuntimeLogConnectionString(value);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return normalized;
    }
    const port = parsed.port || "5432";
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
    return `postgres://${parsed.hostname.toLowerCase()}:${port}/${databaseName}`;
  } catch {
    return normalized;
  }
}

function isHostedRuntimeLogProductionEnvironment(
  environment: NodeJS.ProcessEnv,
): boolean {
  // Next production builds and `next start` also set NODE_ENV=production in
  // local smoke/E2E processes. VERCEL_ENV is the deployment boundary that
  // distinguishes the real hosted production environment from those local
  // production-mode processes and from Vercel previews.
  return nonEmpty(environment.VERCEL_ENV) === "production";
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
