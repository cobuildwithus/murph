import { afterEach, describe, expect, it, vi } from "vitest";

type PoolConfig = {
  connectionString?: string;
  max?: number;
  statement_timeout?: number;
};

async function importLabelsModuleWithMockPool() {
  vi.resetModules();

  const poolConfigs: PoolConfig[] = [];
  const query = vi.fn(async <T>() => ({ rows: [] as T[] }));

  class MockPool {
    query = query;

    constructor(config: PoolConfig) {
      poolConfigs.push(config);
    }
  }

  vi.doMock("pg", () => ({
    default: {
      Pool: MockPool,
    },
  }));

  const labelsModule = await import("../src/lib/supplements");

  return {
    labelsModule,
    poolConfigs,
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
    vi.resetModules();
  });

  it("falls back to the legacy supplement database URL and sets a pool statement timeout", async () => {
    delete process.env.MURPH_LABELS_DB_URL;
    process.env.MURPH_SUPPLEMENT_DB_URL = "postgres://legacy.example.test/labels";

    const { labelsModule, poolConfigs } = await importLabelsModuleWithMockPool();

    await labelsModule.searchSupplements({
      q: "creatine",
      limit: 1,
      includeOffMarket: false,
    });

    expect(poolConfigs).toEqual([
      {
        connectionString: "postgres://legacy.example.test/labels",
        max: 3,
        statement_timeout: 8_000,
      },
    ]);
  });

  it("prefers the shared labels database URL and reuses one pool for foods and supplements", async () => {
    process.env.MURPH_LABELS_DB_URL = "postgres://labels.example.test/labels";
    process.env.MURPH_SUPPLEMENT_DB_URL = "postgres://legacy.example.test/labels";

    const { labelsModule, poolConfigs } = await importLabelsModuleWithMockPool();

    await labelsModule.searchSupplements({
      q: "creatine",
      limit: 1,
      includeOffMarket: false,
    });
    await labelsModule.searchFoods({
      q: "yogurt",
      limit: 1,
      includeOffMarket: false,
    });

    expect(poolConfigs).toEqual([
      {
        connectionString: "postgres://labels.example.test/labels",
        max: 3,
        statement_timeout: 8_000,
      },
    ]);
  });
});
