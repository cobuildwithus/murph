import { afterEach, describe, expect, it, vi } from "vitest";

describe("runtime-state sqlite runtime loading", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not call createRequire while importing the module", async () => {
    const createRequire = vi.fn(() => {
      throw new Error("createRequire should not run at import time");
    });

    vi.doMock("node:module", () => ({
      createRequire,
    }));

    await import("../src/sqlite.ts");

    expect(createRequire).not.toHaveBeenCalled();
  });

  it("creates and reuses the sqlite require only when the sqlite constructor is needed", async () => {
    class FakeDatabaseSync {
      public static instances: FakeDatabaseSync[] = [];
      public readonly execCalls: string[] = [];

      public constructor(
        public readonly databasePath: string,
        public readonly options: { readOnly: boolean; timeout: number },
      ) {
        FakeDatabaseSync.instances.push(this);
      }

      public exec(statement: string): void {
        this.execCalls.push(statement);
      }

      public prepare(): { get: () => undefined } {
        return {
          get: () => undefined,
        };
      }
    }

    const requireMock = vi.fn((specifier: string) => {
      expect(specifier).toBe("node:sqlite");
      return {
        DatabaseSync: FakeDatabaseSync,
      };
    });
    const createRequire = vi.fn(() => requireMock);

    vi.doMock("node:module", () => ({
      createRequire,
    }));

    const sqliteModule = await import("../src/sqlite.ts");

    expect(createRequire).not.toHaveBeenCalled();

    const firstDatabase = sqliteModule.openSqliteRuntimeDatabase("/tmp/runtime-state-first.sqlite", {
      create: false,
      foreignKeys: false,
    });
    const secondDatabase = sqliteModule.openSqliteRuntimeDatabase("/tmp/runtime-state-second.sqlite", {
      create: false,
      foreignKeys: false,
      timeoutMs: 1234,
    });

    expect(createRequire).toHaveBeenCalledTimes(1);
    expect(requireMock).toHaveBeenCalledTimes(1);
    expect(firstDatabase).toBeInstanceOf(FakeDatabaseSync);
    expect(secondDatabase).toBeInstanceOf(FakeDatabaseSync);
    expect(FakeDatabaseSync.instances).toHaveLength(2);
    expect(FakeDatabaseSync.instances[0]?.options).toEqual({
      readOnly: false,
      timeout: sqliteModule.DEFAULT_SQLITE_TIMEOUT_MS,
    });
    expect(FakeDatabaseSync.instances[1]?.options).toEqual({
      readOnly: false,
      timeout: 1234,
    });
  });
});
