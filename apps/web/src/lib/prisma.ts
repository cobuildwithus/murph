import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __murphHostedWebPrisma?: PrismaClient;
};

function createPrismaAdapter(): PrismaPg {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new TypeError("DATABASE_URL is required for the hosted device-sync control plane.");
  }

  return new PrismaPg({ connectionString: normalizePrismaConnectionString(databaseUrl) });
}

function createPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: createPrismaAdapter(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const prisma = globalForPrisma.__murphHostedWebPrisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__murphHostedWebPrisma = prisma;
}

export function getPrisma(): PrismaClient {
  return prisma;
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
