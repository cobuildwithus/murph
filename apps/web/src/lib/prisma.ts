import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { attachDatabasePool } from "@vercel/functions";
import pg, { type Pool as PgPool } from "pg";

import { assertHostedWebDatabaseUrlConfigured } from "./hosted-web/database-env";
import {
  isPrismaOperationTimingActive,
  recordPrismaOperationTiming,
} from "./prisma-operation-timing";
import { installHostedWebWarningFilters } from "./process-warnings";

const { Pool } = pg;

const globalForPrisma = globalThis as typeof globalThis & {
  __murphHostedWebPrisma?: PrismaClient;
};

const DEFAULT_DATABASE_POOL_MAX = 15;
const DATABASE_POOL_MAX = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
const PG_CONNECTION_TIMEOUT_MS = 5_000;
const PG_IDLE_TIMEOUT_MS = 30_000;
const PRISMA_TRANSACTION_MAX_WAIT_MS = 10_000;
const PRISMA_TRANSACTION_TIMEOUT_MS = 15_000;

type DatabasePoolFailureCategory =
  | "active_connection_error"
  | "connection_closed"
  | "connection_limit"
  | "connection_timeout"
  | "idle_connection_error"
  | "pool_checkout_timeout"
  | "tls_error"
  | "unreachable";

const DATABASE_POOL_FAILURE_BY_PRISMA_CODE = new Map<
  string,
  DatabasePoolFailureCategory
>([
  ["P1001", "unreachable"],
  ["P1008", "connection_timeout"],
  ["P1011", "tls_error"],
  ["P1017", "connection_closed"],
  ["P2024", "pool_checkout_timeout"],
  ["P2037", "connection_limit"],
]);

const DATABASE_POOL_FAILURE_BY_DRIVER_KIND = new Map<
  string,
  DatabasePoolFailureCategory
>([
  ["ConnectionClosed", "connection_closed"],
  ["DatabaseNotReachable", "unreachable"],
  ["SocketTimeout", "connection_timeout"],
  ["TlsConnectionError", "tls_error"],
  ["TooManyConnections", "connection_limit"],
]);

const DATABASE_POOL_FAILURE_BY_NETWORK_CODE = new Map<
  string,
  DatabasePoolFailureCategory
>([
  ["ECONNABORTED", "connection_closed"],
  ["ECONNREFUSED", "unreachable"],
  ["ECONNRESET", "connection_closed"],
  ["EHOSTUNREACH", "unreachable"],
  ["ENETUNREACH", "unreachable"],
  ["ENOTFOUND", "unreachable"],
  ["EPIPE", "connection_closed"],
  ["ETIMEDOUT", "connection_timeout"],
]);

installHostedWebWarningFilters();

export interface CreatePrismaClientInput {
  databaseUrl: string;
  poolMax?: number;
}

function createPrismaPool(input: CreatePrismaClientInput): PgPool {
  const poolMax = input.poolMax;
  const pool = new Pool({
    connectionString: normalizePrismaConnectionString(input.databaseUrl),
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
    max: typeof poolMax === "number" && Number.isFinite(poolMax) && poolMax > 0
      ? poolMax
      : DEFAULT_DATABASE_POOL_MAX,
  });

  attachDatabasePool(pool);
  return pool;
}

function createPrismaAdapter(pool: PgPool): PrismaPg {
  return new PrismaPg(pool, {
    disposeExternalPool: true,
    onConnectionError: (error) => {
      reportDatabasePoolFailure(
        pool,
        resolveDatabasePoolFailureCategory(error) ?? "active_connection_error",
      );
    },
    onPoolError: () => {
      reportDatabasePoolFailure(pool, "idle_connection_error");
    },
  });
}

export function createPrismaClient(input: CreatePrismaClientInput): PrismaClient {
  const logLevels = resolvePrismaLogLevels();
  const pool = createPrismaPool(input);

  const client = new PrismaClient({
    adapter: createPrismaAdapter(pool),
    ...(logLevels.length > 0 ? { log: logLevels } : {}),
    transactionOptions: {
      maxWait: PRISMA_TRANSACTION_MAX_WAIT_MS,
      timeout: PRISMA_TRANSACTION_TIMEOUT_MS,
    },
  });

  // Diagnostic-only: records per-operation wall time when a request opted in
  // via collectPrismaOperationTimings; a pass-through everywhere else. The
  // extension keeps the full PrismaClient surface, so the assertion below is
  // a type-level boundary only.
  return client.$extends({
    query: {
      $allOperations({ args, model, operation, query }) {
        const timingActive = isPrismaOperationTimingActive();
        const startedAtMs = timingActive ? Date.now() : null;
        const record = () => {
          if (startedAtMs === null) {
            return;
          }
          recordPrismaOperationTiming(
            model ? `${model}.${operation}` : operation,
            Date.now() - startedAtMs,
          );
        };
        return query(args).then(
          (result) => {
            record();
            return result;
          },
          (error: unknown) => {
            record();
            const category = resolveDatabasePoolFailureCategory(error);
            if (category) {
              reportDatabasePoolFailure(pool, category);
            }
            throw error;
          },
        );
      },
    },
  }) as PrismaClient;
}

function createPrisma(): PrismaClient {
  return createPrismaClient({
    databaseUrl: assertHostedWebDatabaseUrlConfigured(),
    poolMax: Number.isFinite(DATABASE_POOL_MAX) && DATABASE_POOL_MAX > 0
      ? DATABASE_POOL_MAX
      : DEFAULT_DATABASE_POOL_MAX,
  });
}

let prisma = globalForPrisma.__murphHostedWebPrisma;

export function getPrisma(): PrismaClient {
  prisma = prisma ?? createPrisma();

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__murphHostedWebPrisma = prisma;
  }

  return prisma;
}

export function resolvePrismaLogLevels(
  nodeEnv = process.env.NODE_ENV,
): ("error" | "warn")[] {
  return nodeEnv === "development" ? ["warn", "error"] : [];
}

export function normalizePrismaConnectionString(databaseUrl: string): string {
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

function resolveDatabasePoolFailureCategory(
  error: unknown,
): DatabasePoolFailureCategory | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);

    const code = readUnknownStringProperty(current, "code")
      ?? readUnknownStringProperty(current, "originalCode");
    const codeCategory = code
      ? DATABASE_POOL_FAILURE_BY_PRISMA_CODE.get(code)
        ?? DATABASE_POOL_FAILURE_BY_NETWORK_CODE.get(code)
      : null;
    if (codeCategory) {
      return codeCategory;
    }

    const kind = readUnknownStringProperty(current, "kind");
    const kindCategory = kind
      ? DATABASE_POOL_FAILURE_BY_DRIVER_KIND.get(kind)
      : null;
    if (kindCategory) {
      return kindCategory;
    }

    const message = readUnknownStringProperty(current, "message")
      ?? readUnknownStringProperty(current, "originalMessage");
    if (message?.includes("timeout exceeded when trying to connect")) {
      return "pool_checkout_timeout";
    }
    if (message?.includes("Connection terminated due to connection timeout")) {
      return "connection_timeout";
    }

    current = readUnknownProperty(current, "cause");
  }

  return null;
}

function reportDatabasePoolFailure(
  pool: PgPool,
  category: DatabasePoolFailureCategory,
): void {
  console.warn("Hosted web database pool failure.", {
    category,
    idleConnections: normalizePoolCount(pool.idleCount),
    totalConnections: normalizePoolCount(pool.totalCount),
    waitingRequests: normalizePoolCount(pool.waitingCount),
  });
}

function normalizePoolCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function readUnknownStringProperty(value: unknown, key: string): string | null {
  const property = readUnknownProperty(value, key);
  return typeof property === "string" ? property : null;
}

function readUnknownProperty(value: unknown, key: string): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }

  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}
