import { afterEach, describe, expect, it, vi } from "vitest";

type PoolConfig = {
  connectionString?: string;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  max?: number;
  statement_timeout?: number;
};

async function importLabelsModuleWithMockPool() {
  vi.resetModules();

  const poolConfigs: PoolConfig[] = [];
  const poolErrorListeners: Array<(error: Error) => void> = [];
  const query = vi.fn(async <T>() => ({ rows: [] as T[] }));
  const attachDatabasePool = vi.fn();

  class MockPool {
    query = query;

    on(event: string, listener: (error: Error) => void) {
      if (event === "error") {
        poolErrorListeners.push(listener);
      }
      return this;
    }

    constructor(config: PoolConfig) {
      poolConfigs.push(config);
    }
  }

  vi.doMock("pg", () => ({
    default: {
      Pool: MockPool,
    },
  }));
  vi.doMock("@vercel/functions", () => ({
    attachDatabasePool,
  }));

  const foodsModule = await import("../src/lib/foods");
  const supplementsModule = await import("../src/lib/supplements");

  return {
    foodsModule,
    attachDatabasePool,
    poolConfigs,
    poolErrorListeners,
    supplementsModule,
  };
}

describe("product label database pool", () => {
  const originalLabelsDatabaseUrl = process.env.MURPH_LABELS_DB_URL;
  const originalSupplementDatabaseUrl = process.env.MURPH_SUPPLEMENT_DB_URL;

  afterEach(() => {
    if (originalLabelsDatabaseUrl === undefined) {
      delete process.env.MURPH_LABELS_DB_URL;
    } else {
      process.env.MURPH_LABELS_DB_URL = originalLabelsDatabaseUrl;
    }

    if (originalSupplementDatabaseUrl === undefined) {
      delete process.env.MURPH_SUPPLEMENT_DB_URL;
    } else {
      process.env.MURPH_SUPPLEMENT_DB_URL = originalSupplementDatabaseUrl;
    }

    vi.doUnmock("pg");
    vi.doUnmock("@vercel/functions");
    vi.resetModules();
  });

  it("requires the shared labels database URL for supplements", async () => {
    delete process.env.MURPH_LABELS_DB_URL;
    process.env.MURPH_SUPPLEMENT_DB_URL = "postgres://legacy.example.test/labels";

    const { poolConfigs, supplementsModule } =
      await importLabelsModuleWithMockPool();

    await expect(
      supplementsModule.searchSupplements({
        q: "creatine",
        limit: 1,
        includeOffMarket: false,
      }),
    ).rejects.toThrow("MURPH_LABELS_DB_URL is required");
    expect(poolConfigs).toEqual([]);
  });

  it("does not use the legacy supplement database URL for foods", async () => {
    delete process.env.MURPH_LABELS_DB_URL;
    process.env.MURPH_SUPPLEMENT_DB_URL = "postgres://legacy.example.test/labels";

    const { foodsModule, poolConfigs } = await importLabelsModuleWithMockPool();

    await expect(
      foodsModule.searchFoods({
        q: "yogurt",
        limit: 1,
        includeOffMarket: false,
      }),
    ).rejects.toThrow("MURPH_LABELS_DB_URL is required");
    expect(poolConfigs).toEqual([]);
  });

  it("uses the shared labels database URL and reuses one pool for foods and supplements", async () => {
    process.env.MURPH_LABELS_DB_URL = "postgres://labels.example.test/labels";
    process.env.MURPH_SUPPLEMENT_DB_URL = "postgres://legacy.example.test/labels";

    const {
      attachDatabasePool,
      foodsModule,
      poolConfigs,
      poolErrorListeners,
      supplementsModule,
    } =
      await importLabelsModuleWithMockPool();

    await supplementsModule.searchSupplements({
      q: "creatine",
      limit: 1,
      includeOffMarket: false,
    });
    await foodsModule.searchFoods({
      q: "yogurt",
      limit: 1,
      includeOffMarket: false,
    });

    expect(poolConfigs).toEqual([
      {
        connectionString: "postgres://labels.example.test/labels",
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        max: 3,
        statement_timeout: 8_000,
      },
    ]);
    expect(attachDatabasePool).toHaveBeenCalledOnce();
    expect(poolErrorListeners).toHaveLength(1);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    poolErrorListeners[0]?.(
      new Error("connection failed at postgres://private.invalid/labels"),
    );
    expect(warn).toHaveBeenCalledWith(
      "Product labels database pool idle connection error.",
    );
    expect(warn.mock.calls.flat().join(" ")).not.toContain("private.invalid");
    warn.mockRestore();
  });
});
