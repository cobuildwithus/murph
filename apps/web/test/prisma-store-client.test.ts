import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  PrismaClient,
  PrismaPg,
} = vi.hoisted(() => {
  const PrismaClient = vi.fn().mockImplementation(function (options: unknown) {
    return { $disconnect: vi.fn(), options };
  });
  const PrismaPg = vi.fn().mockImplementation(function (options: unknown) {
    return { options };
  });

  return {
    PrismaClient,
    PrismaPg,
  };
});

vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();

  return {
    ...actual,
    PrismaClient,
  };
});
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
    process.env.DATABASE_URL = "postgresql://example.invalid/db?sslmode=require";

    const { normalizePrismaConnectionString } = await import("@/src/lib/prisma");
    const normalized = normalizePrismaConnectionString(
      "postgresql://example.invalid/db?sslmode=require&sslrootcert=system",
    );
    const url = new URL(normalized);

    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.has("sslrootcert")).toBe(false);
  });

  it("leaves ordinary Postgres URLs unchanged", async () => {
    process.env.DATABASE_URL = "postgresql://example.invalid/db?sslmode=require";

    const { normalizePrismaConnectionString } = await import("@/src/lib/prisma");
    const databaseUrl = "postgresql://example.invalid/db?sslmode=require";

    expect(normalizePrismaConnectionString(databaseUrl)).toBe(databaseUrl);
  });

  it("fails when creating a Prisma client without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;

    const { getPrisma } = await import("@/src/lib/prisma");

    expect(() => getPrisma()).toThrow(
      "DATABASE_URL is required for the hosted web control plane.",
    );
  });

  it("creates one production Prisma client per module load and reuses it from getPrisma", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };

    const prismaModule = await import("@/src/lib/prisma");
    const prismaA = prismaModule.getPrisma();
    const prismaB = prismaModule.getPrisma();

    expect(prismaA).toBe(prismaB);
    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://example.invalid/db?sslmode=require",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 5,
    });
    expect(PrismaClient).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      transactionOptions: {
        maxWait: 10_000,
        timeout: 15_000,
      },
    });
  });

  it("creates independent factory clients for ephemeral databases", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "test",
    };

    const { createPrismaClient } = await import("@/src/lib/prisma");
    const prismaA = createPrismaClient({
      databaseUrl: "postgresql://example.invalid/first?sslmode=require",
      poolMax: 1,
    });
    const prismaB = createPrismaClient({
      databaseUrl: "postgresql://example.invalid/second?sslmode=require",
      poolMax: 1,
    });

    expect(prismaA).not.toBe(prismaB);
    expect(PrismaPg).toHaveBeenNthCalledWith(1, {
      connectionString: "postgresql://example.invalid/first?sslmode=require",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 1,
    });
    expect(PrismaPg).toHaveBeenNthCalledWith(2, {
      connectionString: "postgresql://example.invalid/second?sslmode=require",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 1,
    });
  });

  it("falls back to the default pool size for invalid factory pool limits", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "test",
    };

    const { createPrismaClient } = await import("@/src/lib/prisma");

    createPrismaClient({
      databaseUrl: "postgresql://example.invalid/db?sslmode=require",
      poolMax: Number.POSITIVE_INFINITY,
    });

    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://example.invalid/db?sslmode=require",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 5,
    });
  });

  it("enables Prisma warn and error logs in development only", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };

    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();

    expect(PrismaClient).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      log: ["warn", "error"],
      transactionOptions: {
        maxWait: 10_000,
        timeout: 15_000,
      },
    });
  });

  it("uses DATABASE_POOL_MAX when it is a positive integer", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_POOL_MAX: "9",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };

    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();

    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://example.invalid/db?sslmode=require",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 9,
    });
  });
});
