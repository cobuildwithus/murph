import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __healthybobHostedWebPrismaAdapter?: PrismaPg;
  __healthybobHostedWebPrisma?: PrismaClient;
};

function createPrismaAdapter(): PrismaPg {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new TypeError("DATABASE_URL is required for the hosted device-sync control plane.");
  }

  return new PrismaPg({ connectionString: databaseUrl });
}

export function getPrisma(): PrismaClient {
  if (globalForPrisma.__healthybobHostedWebPrisma) {
    return globalForPrisma.__healthybobHostedWebPrisma;
  }

  const adapter = globalForPrisma.__healthybobHostedWebPrismaAdapter ?? createPrismaAdapter();
  const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__healthybobHostedWebPrismaAdapter = adapter;
    globalForPrisma.__healthybobHostedWebPrisma = prisma;
  }

  return prisma;
}
