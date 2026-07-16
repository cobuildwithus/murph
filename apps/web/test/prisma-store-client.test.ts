import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  interface AdapterOptions {
    disposeExternalPool: boolean;
    onConnectionError: (error: unknown) => void;
    onPoolError: (error: unknown) => void;
  }

  interface FakePool {
    idleCount: number;
    options: Record<string, unknown>;
    totalCount: number;
    waitingCount: number;
  }

  interface QueryExtension {
    query: {
      $allOperations: (input: {
        args: unknown;
        model?: string;
        operation: string;
        query: (args: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
  }

  const adapterOptions: AdapterOptions[] = [];
  const extensions: QueryExtension[] = [];
  const poolInstances: FakePool[] = [];
  const attachDatabasePool = vi.fn();
  const Pool = vi.fn().mockImplementation(function (
    options: Record<string, unknown>,
  ) {
    const pool: FakePool = {
      idleCount: 0,
      options,
      totalCount: 0,
      waitingCount: 0,
    };
    poolInstances.push(pool);
    return pool;
  });
  const PrismaPg = vi.fn().mockImplementation(function (
    pool: unknown,
    options: AdapterOptions,
  ) {
    adapterOptions.push(options);
    return { options, pool };
  });
  const PrismaClient = vi.fn().mockImplementation(function (options: unknown) {
    const client: Record<string, unknown> = { $disconnect: vi.fn(), options };
    client.$extends = vi.fn((extension: QueryExtension) => {
      extensions.push(extension);
      return client;
    });
    return client;
  });

  return {
    adapterOptions,
    attachDatabasePool,
    extensions,
    Pool,
    poolInstances,
    PrismaClient,
    PrismaPg,
  };
});

vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();

  return {
    ...actual,
    PrismaClient: mocks.PrismaClient,
  };
});
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: mocks.PrismaPg }));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: mocks.attachDatabasePool,
}));
vi.mock("pg", () => ({
  default: { Pool: mocks.Pool },
}));

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
    mocks.adapterOptions.length = 0;
    mocks.extensions.length = 0;
    mocks.poolInstances.length = 0;
    process.env = { ...ORIGINAL_ENV };
    resetPrismaGlobal();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("creates, registers, and reuses one production pool", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };

    const prismaModule = await import("@/src/lib/prisma");
    const prismaA = prismaModule.getPrisma();
    const prismaB = prismaModule.getPrisma();
    const pool = mocks.poolInstances[0];

    expect(pool).toBeDefined();
    expect(prismaA).toBe(prismaB);
    expect(mocks.Pool).toHaveBeenCalledTimes(1);
    expect(mocks.Pool).toHaveBeenCalledWith({
      connectionString: "postgresql://example.invalid/db?sslmode=require",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 5,
    });
    expect(mocks.attachDatabasePool).toHaveBeenCalledOnce();
    expect(mocks.attachDatabasePool).toHaveBeenCalledWith(pool);
    expect(mocks.PrismaPg).toHaveBeenCalledOnce();
    expect(mocks.PrismaPg).toHaveBeenCalledWith(pool, {
      disposeExternalPool: true,
      onConnectionError: expect.any(Function),
      onPoolError: expect.any(Function),
    });
    expect(mocks.PrismaClient).toHaveBeenCalledOnce();
    expect(mocks.PrismaClient).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      transactionOptions: {
        maxWait: 10_000,
        timeout: 15_000,
      },
    });
    expect(mocks.Pool.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.attachDatabasePool.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.attachDatabasePool.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.PrismaPg.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.PrismaPg.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.PrismaClient.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("registers independent factory pools before constructing their adapters", async () => {
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
    const [poolA, poolB] = mocks.poolInstances;

    expect(poolA).toBeDefined();
    expect(poolB).toBeDefined();
    expect(poolA).not.toBe(poolB);
    expect(prismaA).not.toBe(prismaB);
    expect(mocks.Pool).toHaveBeenNthCalledWith(1, {
      connectionString: "postgresql://example.invalid/first?sslmode=require",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 1,
    });
    expect(mocks.Pool).toHaveBeenNthCalledWith(2, {
      connectionString: "postgresql://example.invalid/second?sslmode=require",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 1,
    });
    expect(mocks.attachDatabasePool).toHaveBeenNthCalledWith(1, poolA);
    expect(mocks.attachDatabasePool).toHaveBeenNthCalledWith(2, poolB);
    expect(mocks.PrismaPg).toHaveBeenNthCalledWith(1, poolA, expect.objectContaining({
      disposeExternalPool: true,
    }));
    expect(mocks.PrismaPg).toHaveBeenNthCalledWith(2, poolB, expect.objectContaining({
      disposeExternalPool: true,
    }));
    expect(mocks.attachDatabasePool.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.PrismaPg.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.attachDatabasePool.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.PrismaPg.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it("reuses the development client and pool across an HMR-style module reload", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };

    const firstModule = await import("@/src/lib/prisma");
    const firstClient = firstModule.getPrisma();
    vi.resetModules();
    const secondModule = await import("@/src/lib/prisma");
    const secondClient = secondModule.getPrisma();

    expect(secondClient).toBe(firstClient);
    expect(mocks.Pool).toHaveBeenCalledOnce();
    expect(mocks.attachDatabasePool).toHaveBeenCalledOnce();
    expect(mocks.PrismaPg).toHaveBeenCalledOnce();
    expect(mocks.PrismaClient).toHaveBeenCalledOnce();
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

    expect(mocks.Pool).toHaveBeenCalledWith({
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

    expect(mocks.PrismaClient).toHaveBeenCalledWith({
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

    expect(mocks.Pool).toHaveBeenCalledWith({
      connectionString: "postgresql://example.invalid/db?sslmode=require",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 9,
    });
  });

  it("logs only allowlisted metadata for adapter connection failures", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();
    const pool = mocks.poolInstances[0];
    const options = mocks.adapterOptions[0];
    if (!pool || !options) {
      throw new Error("Expected the Prisma pool and adapter options to be captured.");
    }
    pool.idleCount = 2;
    pool.totalCount = 4;
    pool.waitingCount = 3;
    const secretBearingError = Object.assign(
      new Error("postgresql://private-user:private-password@private-host/db SELECT private_data"),
      { code: "ETIMEDOUT" },
    );

    expect(() => options.onConnectionError(secretBearingError)).not.toThrow();
    expect(() => options.onPoolError(secretBearingError)).not.toThrow();

    expect(warn).toHaveBeenNthCalledWith(1, "Hosted web database pool failure.", {
      category: "connection_timeout",
      idleConnections: 2,
      totalConnections: 4,
      waitingRequests: 3,
    });
    expect(warn).toHaveBeenNthCalledWith(2, "Hosted web database pool failure.", {
      category: "idle_connection_error",
      idleConnections: 2,
      totalConnections: 4,
      waitingRequests: 3,
    });
    const serializedLogs = JSON.stringify(warn.mock.calls);
    expect(serializedLogs).not.toContain("private-user");
    expect(serializedLogs).not.toContain("private-password");
    expect(serializedLogs).not.toContain("private-host");
    expect(serializedLogs).not.toContain("private_data");
    expect(serializedLogs).not.toContain("ETIMEDOUT");
  });

  it.each([
    {
      category: "pool_checkout_timeout",
      message: "timeout exceeded when trying to connect; private-password",
      nested: false,
    },
    {
      category: "connection_timeout",
      message: "Connection terminated due to connection timeout; private-password",
      nested: true,
    },
  ])("classifies $category driver messages without logging them", async ({
    category,
    message,
    nested,
  }) => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();
    const extension = mocks.extensions[0];
    if (!extension) {
      throw new Error("Expected the Prisma query extension to be captured.");
    }
    const driverFailure = new Error(message);
    const operationFailure = nested
      ? Object.assign(new Error("adapter failure"), { cause: driverFailure })
      : driverFailure;

    await expect(extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query: async () => Promise.reject(operationFailure),
    })).rejects.toBe(operationFailure);

    expect(warn).toHaveBeenCalledWith("Hosted web database pool failure.", {
      category,
      idleConnections: 0,
      totalConnections: 0,
      waitingRequests: 0,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-password");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(message);
  });

  it("classifies recognized operation failures without logging unknown errors", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();
    const extension = mocks.extensions[0];
    if (!extension) {
      throw new Error("Expected the Prisma query extension to be captured.");
    }
    const poolFailure = Object.assign(
      new Error("checkout failed with private-password"),
      { code: "P2024" },
    );

    await expect(extension.query.$allOperations({
      args: {},
      model: "HostedMember",
      operation: "findUnique",
      query: async () => Promise.reject(poolFailure),
    })).rejects.toBe(poolFailure);
    expect(warn).toHaveBeenCalledWith("Hosted web database pool failure.", {
      category: "pool_checkout_timeout",
      idleConnections: 0,
      totalConnections: 0,
      waitingRequests: 0,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-password");

    warn.mockClear();
    const applicationFailure = new Error("ordinary application failure");
    await expect(extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query: async () => Promise.reject(applicationFailure),
    })).rejects.toBe(applicationFailure);
    expect(warn).not.toHaveBeenCalled();

    const getterFailure = new Error("diagnostic property access failed");
    const errorWithThrowingCode = Object.defineProperty(
      new Error("ordinary driver failure"),
      "code",
      {
        get() {
          throw getterFailure;
        },
      },
    );
    await expect(extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query: async () => Promise.reject(errorWithThrowingCode),
    })).rejects.toBe(errorWithThrowingCode);
    expect(warn).not.toHaveBeenCalled();
  });
});
