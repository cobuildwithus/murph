import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { assertHostedWebDatabaseUrlConfigured } from "./hosted-web/database-env";
import {
  isPrismaOperationTimingActive,
  recordPrismaOperationTiming,
} from "./prisma-operation-timing";
import { installHostedWebWarningFilters } from "./process-warnings";

const globalForPrisma = globalThis as typeof globalThis & {
  __murphHostedWebPrisma?: PrismaClient;
};

const DEFAULT_DATABASE_POOL_MAX = 5;
const DATABASE_POOL_MAX = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
const PG_CONNECTION_TIMEOUT_MS = 5_000;
const PG_IDLE_TIMEOUT_MS = 30_000;
const PRISMA_TRANSACTION_MAX_WAIT_MS = 10_000;
const PRISMA_TRANSACTION_TIMEOUT_MS = 15_000;

installHostedWebWarningFilters();

export interface CreatePrismaClientInput {
  databaseUrl: string;
  poolMax?: number;
}

function createPrismaAdapter(input: CreatePrismaClientInput): PrismaPg {
  const poolMax = input.poolMax;
  return new PrismaPg({
    connectionString: normalizePrismaConnectionString(input.databaseUrl),
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
    max: typeof poolMax === "number" && Number.isFinite(poolMax) && poolMax > 0
      ? poolMax
      : DEFAULT_DATABASE_POOL_MAX,
  });
}

export function createPrismaClient(input: CreatePrismaClientInput): PrismaClient {
  const logLevels = resolvePrismaLogLevels();

  const client = new PrismaClient({
    adapter: createPrismaAdapter(input),
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
        if (!isPrismaOperationTimingActive()) {
          return query(args);
        }

        const startedAtMs = Date.now();
        const record = () => {
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
