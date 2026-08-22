import { afterEach, describe, expect, it, vi } from "vitest";

describe("runtime-state sqlite open failures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("closes an unusable handle and preserves the configuration error", async () => {
    const configurationError = new Error("pragma configuration failed");
    const closeError = new Error("close failed");
    const closeHandle = vi.fn(() => {
      throw closeError;
    });

    class FailingDatabaseSync {
      exec(): never {
        throw configurationError;
      }

      close = closeHandle;
    }

    vi.spyOn(process, "getBuiltinModule").mockReturnValue({
      DatabaseSync: FailingDatabaseSync,
    } as unknown as typeof import("node:sqlite"));
    vi.resetModules();

    const { openSqliteRuntimeDatabase } = await import("../src/sqlite.ts");

    let caught: unknown;
    try {
      openSqliteRuntimeDatabase("ignored.sqlite");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(configurationError);
    expect(closeHandle).toHaveBeenCalledOnce();
  });
});
