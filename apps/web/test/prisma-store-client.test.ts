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
  const transaction = vi.fn();
  const PrismaClient = vi.fn().mockImplementation(function (options: unknown) {
    const client: Record<string, unknown> = {
      $disconnect: vi.fn(),
      $transaction: transaction,
      options,
    };
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
    transaction,
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
const PGBOUNCER_MAX_CLIENT_CONN_MESSAGE =
  "no more connections allowed (max_client_conn)";

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
    mocks.transaction.mockReset();
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
      max: 15,
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
      max: 15,
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
    {
      category: "connection_limit",
      message: "remaining connection slots are reserved for roles with the SUPERUSER attribute; private-password",
      nested: false,
    },
    {
      category: "connection_limit",
      message: "too many connections for role \"private-user\"; private-password",
      nested: true,
    },
    {
      category: "connection_limit",
      message: "sorry, too many clients already; private-password",
      nested: false,
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

  it.each([
    { nested: false },
    { nested: true },
  ])("classifies SQLSTATE 53300 codes without logging them (nested: $nested)", async ({
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
    // The message avoids every fallback phrasing so only the code classifies.
    const driverFailure = Object.assign(
      new Error("connection rejected; private-password"),
      { code: "53300" },
    );
    const operationFailure = nested
      ? Object.assign(new Error("adapter failure"), { cause: driverFailure })
      : driverFailure;

    await expect(extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query: async () => Promise.reject(operationFailure),
    })).rejects.toBe(operationFailure);

    expect(warn).toHaveBeenCalledWith("Hosted web database pool failure.", {
      category: "connection_limit",
      idleConnections: 0,
      totalConnections: 0,
      waitingRequests: 0,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-password");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("53300");
  });

  it.each([
    {
      code: "08P01",
      expectedCategory: "connection_limit",
      message: PGBOUNCER_MAX_CLIENT_CONN_MESSAGE,
      nested: false,
      scenario: "top-level DriverAdapterError",
    },
    {
      code: "08P01",
      expectedCategory: "connection_limit",
      message: PGBOUNCER_MAX_CLIENT_CONN_MESSAGE,
      nested: true,
      scenario: "nested DriverAdapterError",
    },
    {
      code: "08P01",
      expectedCategory: null,
      message: "invalid frontend message type; private-password",
      nested: false,
      scenario: "unrelated 08P01 protocol violation",
    },
    {
      code: "08P01",
      expectedCategory: null,
      message: `${PGBOUNCER_MAX_CLIENT_CONN_MESSAGE}; private-password`,
      nested: false,
      scenario: "same SQLSTATE with a non-exact message",
    },
    {
      code: "XX000",
      expectedCategory: null,
      message: PGBOUNCER_MAX_CLIENT_CONN_MESSAGE,
      nested: false,
      scenario: "matching message with a different SQLSTATE",
    },
  ])("handles the PgBouncer max-client classifier for $scenario", async ({
    code,
    expectedCategory,
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
    const driverFailure = Object.assign(new Error(message), {
      cause: {
        detail: "private-password",
        kind: "postgres",
        originalCode: code,
        originalMessage: message,
      },
      name: "DriverAdapterError",
    });
    const operationFailure = nested
      ? Object.assign(new Error("adapter failure"), { cause: driverFailure })
      : driverFailure;

    await expect(extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query: async () => Promise.reject(operationFailure),
    })).rejects.toBe(operationFailure);

    if (expectedCategory === null) {
      expect(warn).not.toHaveBeenCalled();
    } else {
      expect(warn).toHaveBeenCalledWith("Hosted web database pool failure.", {
        category: expectedCategory,
        idleConnections: 0,
        totalConnections: 0,
        waitingRequests: 0,
      });
    }
    const serializedLogs = JSON.stringify(warn.mock.calls);
    expect(serializedLogs).not.toContain(message);
    expect(serializedLogs).not.toContain(code);
    expect(serializedLogs).not.toContain("private-password");
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

  it("retries a transaction that never started and reports every attempt", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { getPrisma } = await import("@/src/lib/prisma");

    const prisma = getPrisma();
    mocks.transaction
      .mockRejectedValueOnce(transactionStartTimeout())
      .mockResolvedValueOnce("committed");

    await expect(prisma.$transaction(async () => "committed"))
      .resolves.toBe("committed");

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledExactlyOnceWith("Hosted web database pool failure.", {
      category: "transaction_start_timeout",
      idleConnections: 0,
      totalConnections: 0,
      waitingRequests: 0,
    });
  });

  it("stops retrying a transaction start after the attempt budget", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    const prisma = getPrisma();
    const failure = transactionStartTimeout();
    mocks.transaction.mockRejectedValue(failure);

    await expect(prisma.$transaction(async () => "unused")).rejects.toBe(failure);

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a transaction-start timeout caused by local saturation", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    const prisma = getPrisma();
    const pool = mocks.poolInstances[0];
    if (!pool) {
      throw new Error("Expected the Prisma pool to be captured.");
    }
    pool.idleCount = 0;
    pool.totalCount = 15;
    pool.waitingCount = 0;
    const failure = transactionStartTimeout();
    mocks.transaction.mockRejectedValue(failure);

    await expect(prisma.$transaction(async () => "unused")).rejects.toBe(failure);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(pressureLogs(warn)).toEqual([{
      idleConnections: 0,
      totalConnections: 15,
      waitingRequests: 0,
    }]);
  });

  it("never replays a transaction that already ran", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    const prisma = getPrisma();
    // Same P2028 code, but the transaction opened and then expired, so its
    // callback may already have run and must not be replayed.
    const expired = Object.assign(
      new Error("Transaction API error: Transaction already closed."),
      { code: "P2028" },
    );
    mocks.transaction.mockRejectedValue(expired);

    await expect(prisma.$transaction(async () => "unused")).rejects.toBe(expired);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("never replays a retry-classified failure after the transaction callback starts", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const { getPrisma } = await import("@/src/lib/prisma");
      const prisma = getPrisma();
      const callbackEffect = vi.fn();
      const failure = transactionStartTimeout();
      mocks.transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) =>
          callback({ transaction: true }),
      );

      await expect(prisma.$transaction(async () => {
        callbackEffect();
        throw failure;
      })).rejects.toBe(failure);

      expect(callbackEffect).toHaveBeenCalledOnce();
      expect(mocks.transaction).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(failureCategories(warn)).toEqual(["transaction_start_timeout"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards non-transaction client members untouched", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const { getPrisma } = await import("@/src/lib/prisma");

    const prisma = getPrisma();
    const constructed = mocks.PrismaClient.mock.results[0]?.value as
      Record<string, unknown>;

    expect(prisma.$disconnect).toBe(constructed.$disconnect);
    expect((prisma as unknown as Record<string, unknown>).options)
      .toBe(constructed.options);
  });

  it("retries an operation whose connection checkout timed out", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();
    const extension = mocks.extensions[0];
    if (!extension) {
      throw new Error("Expected the Prisma query extension to be captured.");
    }
    const query = vi.fn()
      .mockRejectedValueOnce(new Error("timeout exceeded when trying to connect"))
      .mockResolvedValueOnce("rows");

    await expect(extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query,
    })).resolves.toBe("rows");

    expect(query).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledExactlyOnceWith("Hosted web database pool failure.", {
      category: "pool_checkout_timeout",
      idleConnections: 0,
      totalConnections: 0,
      waitingRequests: 0,
    });
  });

  it("does not retry a checkout timeout caused by local saturation", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();
    const pool = mocks.poolInstances[0];
    const extension = mocks.extensions[0];
    if (!pool || !extension) {
      throw new Error("Expected the Prisma pool and query extension to be captured.");
    }
    pool.idleCount = 0;
    pool.totalCount = 15;
    pool.waitingCount = 0;
    const failure = Object.assign(new Error("checkout timed out"), {
      code: "P2024",
    });
    const query = vi.fn().mockRejectedValue(failure);

    await expect(extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query,
    })).rejects.toBe(failure);

    expect(query).toHaveBeenCalledOnce();
    expect(pressureLogs(warn)).toEqual([{
      idleConnections: 0,
      totalConnections: 15,
      waitingRequests: 0,
    }]);
  });

  it("does not begin an ambiguous retry after the pool becomes saturated", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();
    const pool = mocks.poolInstances[0];
    const extension = mocks.extensions[0];
    if (!pool || !extension) {
      throw new Error("Expected the Prisma pool and query extension to be captured.");
    }
    const failure = Object.assign(new Error("checkout timed out"), {
      code: "P2024",
    });
    const query = vi.fn().mockImplementationOnce(async () => {
      setTimeout(() => {
        pool.idleCount = 0;
        pool.totalCount = 15;
        pool.waitingCount = 0;
      }, 0);
      throw failure;
    });

    await expect(extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query,
    })).rejects.toBe(failure);

    expect(query).toHaveBeenCalledOnce();
    expect(pressureLogs(warn)).toEqual([{
      idleConnections: 0,
      totalConnections: 15,
      waitingRequests: 0,
    }]);
  });

  it("does not schedule a retry when the failed attempt fills the pool", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const random = vi.spyOn(Math, "random");
    vi.useFakeTimers();
    try {
      const { getPrisma } = await import("@/src/lib/prisma");

      getPrisma();
      const pool = mocks.poolInstances[0];
      const extension = mocks.extensions[0];
      if (!pool || !extension) {
        throw new Error("Expected the Prisma pool and query extension to be captured.");
      }
      const failure = Object.assign(new Error("checkout timed out"), {
        code: "P2024",
      });
      const query = vi.fn().mockImplementationOnce(async () => {
        pool.idleCount = 0;
        pool.totalCount = 15;
        pool.waitingCount = 0;
        throw failure;
      });

      const operation = extension.query.$allOperations({
        args: {},
        operation: "queryRaw",
        query,
      });
      const rejection = expect(operation).rejects.toBe(failure);
      await vi.runAllTimersAsync();

      await rejection;
      expect(query).toHaveBeenCalledOnce();
      expect(random).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(failureCategories(warn)).toEqual(["pool_checkout_timeout"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["minimum", 0, 50],
    ["maximum", 1 - Number.EPSILON, 250],
  ])("waits for the %s jitter boundary before its only retry", async (
    _label,
    randomValue,
    expectedDelayMs,
  ) => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    vi.spyOn(Math, "random").mockReturnValue(randomValue);
    vi.useFakeTimers();
    try {
      const { getPrisma } = await import("@/src/lib/prisma");

      getPrisma();
      const extension = mocks.extensions[0];
      if (!extension) {
        throw new Error("Expected the Prisma query extension to be captured.");
      }
      const query = vi.fn()
        .mockRejectedValueOnce(new Error("timeout exceeded when trying to connect"))
        .mockResolvedValueOnce("rows");
      const operation = extension.query.$allOperations({
        args: {},
        operation: "queryRaw",
        query,
      });
      await Promise.resolve();

      expect(query).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(expectedDelayMs - 1);
      expect(query).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);

      await expect(operation).resolves.toBe("rows");
      expect(query).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry operation failures that may have reached Postgres", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();
    const extension = mocks.extensions[0];
    if (!extension) {
      throw new Error("Expected the Prisma query extension to be captured.");
    }
    const failure = Object.assign(new Error("connection closed"), { code: "P1017" });
    const query = vi.fn().mockRejectedValue(failure);

    await expect(extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query,
    })).rejects.toBe(failure);

    expect(query).toHaveBeenCalledOnce();
  });

  it("warns before the first caller queues against a full pool", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();
    const pool = mocks.poolInstances[0];
    const extension = mocks.extensions[0];
    if (!pool || !extension) {
      throw new Error("Expected the Prisma pool and query extension to be captured.");
    }
    pool.idleCount = 0;
    pool.totalCount = 15;
    pool.waitingCount = 0;

    const order: string[] = [];
    warn.mockImplementation((message: unknown) => {
      if (message === "Hosted web database pool pressure.") {
        order.push("sampled");
      }
    });
    const run = () => extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query: async () => {
        order.push("attempted");
        return "rows";
      },
    });

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    await run();
    await run();
    await run();

    // Three contended operations, but the pool is sampled at most once per
    // interval so a burst cannot flood the log.
    expect(pressureLogs(warn)).toEqual([{
      idleConnections: 0,
      totalConnections: 15,
      waitingRequests: 0,
    }]);
    // Sampling must precede the attempt, otherwise the warning only appears
    // after the very checkout it exists to pre-empt.
    expect(order[0]).toBe("sampled");
    expect(order[1]).toBe("attempted");

    // Sustained pressure must report again once the interval elapses; a
    // one-shot latch would go quiet exactly when the pool is worst.
    nowSpy.mockReturnValue(1_000_000 + 10_000);
    await run();
    expect(pressureLogs(warn)).toHaveLength(2);

    nowSpy.mockRestore();
  });

  it("throttles each pool independently", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "test",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { createPrismaClient } = await import("@/src/lib/prisma");

    createPrismaClient({
      databaseUrl: "postgresql://example.invalid/first?sslmode=require",
      poolMax: 1,
    });
    createPrismaClient({
      databaseUrl: "postgresql://example.invalid/second?sslmode=require",
      poolMax: 1,
    });
    const [poolA, poolB] = mocks.poolInstances;
    const [extensionA, extensionB] = mocks.extensions;
    if (!poolA || !poolB || !extensionA || !extensionB) {
      throw new Error("Expected two pools and two query extensions to be captured.");
    }
    for (const pool of [poolA, poolB]) {
      pool.idleCount = 0;
      pool.totalCount = 1;
      pool.waitingCount = 2;
    }

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    const query = async () => "rows";
    await extensionA.query.$allOperations({ args: {}, operation: "queryRaw", query });
    await extensionB.query.$allOperations({ args: {}, operation: "queryRaw", query });

    // Same instant, two pools: one pool's sample must not silence the other.
    expect(pressureLogs(warn)).toHaveLength(2);
    nowSpy.mockRestore();
  });

  it("stays silent while no caller is waiting for a connection", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();
    const pool = mocks.poolInstances[0];
    const extension = mocks.extensions[0];
    if (!pool || !extension) {
      throw new Error("Expected the Prisma pool and query extension to be captured.");
    }
    pool.idleCount = 12;
    pool.totalCount = 15;
    pool.waitingCount = 0;

    await extension.query.$allOperations({
      args: {},
      operation: "queryRaw",
      query: async () => "rows",
    });

    expect(pressureLogs(warn)).toEqual([]);
  });

  it("reports connection-held time separately from acquisition wait", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const { getPrisma } = await import("@/src/lib/prisma");
      const prisma = getPrisma();
      mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
        return callback({ transaction: true });
      });

      await expect(prisma.$transaction(async () => {
        vi.advanceTimersByTime(6_000);
        return "committed";
      })).resolves.toBe("committed");

      expect(slowTransactionLogs(warn, "hold")).toEqual([{ durationMs: 6_000 }]);
      expect(slowTransactionLogs(warn, "acquisition")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports acquisition wait without calling it connection-held time", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const { getPrisma } = await import("@/src/lib/prisma");
      const prisma = getPrisma();
      mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
        vi.advanceTimersByTime(6_000);
        return callback({ transaction: true });
      });

      await expect(prisma.$transaction(async () => "committed"))
        .resolves.toBe("committed");

      expect(slowTransactionLogs(warn, "acquisition"))
        .toEqual([{ durationMs: 6_000 }]);
      expect(slowTransactionLogs(warn, "hold")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a slow failed acquisition without reporting connection-held time", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const { getPrisma } = await import("@/src/lib/prisma");
      const prisma = getPrisma();
      const pool = mocks.poolInstances[0];
      if (!pool) {
        throw new Error("Expected the Prisma pool to be captured.");
      }
      pool.idleCount = 0;
      pool.totalCount = 15;
      pool.waitingCount = 0;
      const callback = vi.fn();
      const failure = transactionStartTimeout();
      mocks.transaction.mockImplementation(async () => {
        vi.advanceTimersByTime(6_000);
        throw failure;
      });

      await expect(prisma.$transaction(callback)).rejects.toBe(failure);

      expect(callback).not.toHaveBeenCalled();
      expect(mocks.transaction).toHaveBeenCalledOnce();
      expect(slowTransactionLogs(warn, "acquisition"))
        .toEqual([{ durationMs: 6_000 }]);
      expect(slowTransactionLogs(warn, "hold")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("labels a slow batch transaction as total wall time", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const { getPrisma } = await import("@/src/lib/prisma");
      const prisma = getPrisma();
      mocks.transaction.mockImplementation(async () => {
        vi.advanceTimersByTime(6_000);
        return ["committed"];
      });

      await expect(prisma.$transaction([])).resolves.toEqual(["committed"]);

      expect(slowTransactionLogs(warn, "batch"))
        .toEqual([{ durationMs: 6_000 }]);
      expect(slowTransactionLogs(warn, "hold")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report an ordinary short transaction", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    const prisma = getPrisma();
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({ transaction: true }),
    );

    await expect(prisma.$transaction(async () => "committed"))
      .resolves.toBe("committed");

    expect(slowTransactionLogs(warn, "hold")).toEqual([]);
    expect(slowTransactionLogs(warn, "acquisition")).toEqual([]);
  });

  it("records the effective pool size and whether it was configured", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_POOL_MAX: "9",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    getPrisma();

    expect(info).toHaveBeenCalledExactlyOnceWith(
      "Hosted web database pool configured.",
      { maxConnections: 9, source: "configured" },
    );
  });

  it("marks an inherited pool size as the default rather than a decision", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/db?sslmode=require",
    };
    delete process.env.DATABASE_POOL_MAX;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { getPrisma } = await import("@/src/lib/prisma");

    const first = getPrisma();
    const second = getPrisma();

    // The shared client is built once, so this stays a boot diagnostic; moving
    // it into the lookup would turn it into request-path log volume.
    expect(second).toBe(first);
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "Hosted web database pool configured.",
      { maxConnections: 15, source: "default" },
    );
  });
});

function pressureLogs(warn: { mock: { calls: unknown[][] } }): unknown[] {
  return warn.mock.calls
    .filter((call) => call[0] === "Hosted web database pool pressure.")
    .map((call) => call[1]);
}

function failureCategories(warn: { mock: { calls: unknown[][] } }): unknown[] {
  return warn.mock.calls
    .filter((call) => call[0] === "Hosted web database pool failure.")
    .map((call) => (call[1] as { category: unknown }).category);
}

function slowTransactionLogs(
  warn: { mock: { calls: unknown[][] } },
  category: "acquisition" | "batch" | "hold",
): unknown[] {
  return warn.mock.calls
    .filter(
      (call) => call[0] === `Hosted web database slow ${category === "batch"
        ? "batch transaction"
        : `transaction ${category}`}.`,
    )
    .map((call) => call[1]);
}


function transactionStartTimeout(): Error {
  return Object.assign(
    new Error("Transaction API error: Unable to start a transaction in the given time."),
    { code: "P2028" },
  );
}
