import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  PrismaClient,
  PrismaPg,
} = vi.hoisted(() => {
  const PrismaClient = vi.fn().mockImplementation(function (options: unknown) {
    return { options };
  });
  const PrismaPg = vi.fn().mockImplementation(function (options: unknown) {
    return { options };
  });

  return {
    PrismaClient,
    PrismaPg,
  };
});

vi.mock("@prisma/client", () => ({ PrismaClient }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg }));

const ORIGINAL_ENV = { ...process.env };

function resetPrismaGlobal(): void {
  const globalState = globalThis as typeof globalThis & {
    __murphHostedWebPrisma?: unknown;
  };
  delete globalState.__murphHostedWebPrisma;
}

describe("prisma module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    resetPrismaGlobal();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    resetPrismaGlobal();
  });

  it("removes libpq-style system certificate sentinels that the pg adapter treats as file paths", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@example.com/db?sslmode=require";

    const { normalizePrismaConnectionString } = await import("@/src/lib/prisma");
    const normalized = normalizePrismaConnectionString(
      "postgresql://user:pass@example.com/db?sslmode=require&sslrootcert=system",
    );
    const url = new URL(normalized);

    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.has("sslrootcert")).toBe(false);
  });

  it("leaves ordinary Postgres URLs unchanged", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@example.com/db?sslmode=require";

    const { normalizePrismaConnectionString } = await import("@/src/lib/prisma");
    const databaseUrl = "postgresql://user:pass@example.com/db?sslmode=require";

    expect(normalizePrismaConnectionString(databaseUrl)).toBe(databaseUrl);
  });

  it("fails at import time when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;

    await expect(import("@/src/lib/prisma")).rejects.toThrow(
      "DATABASE_URL is required for the hosted device-sync control plane.",
    );
  });

  it("creates one production Prisma client per module load and reuses it from getPrisma", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@example.com/db?sslmode=require",
    };

    const prismaModule = await import("@/src/lib/prisma");
    const prismaA = prismaModule.getPrisma();
    const prismaB = prismaModule.getPrisma();

    expect(prismaA).toBe(prismaB);
    expect(PrismaPg).toHaveBeenCalledTimes(1);
    expect(PrismaClient).toHaveBeenCalledTimes(1);
  });
});
