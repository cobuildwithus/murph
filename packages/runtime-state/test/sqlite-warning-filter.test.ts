import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEmitWarning = process.emitWarning;
const SQLITE_WARNING_FILTER_FLAG = Symbol.for("murph.sqliteExperimentalWarningFilterInstalled");
const SQLITE_WARNING_FILTER_INCLUDES_FLAG = Symbol.for(
  "murph.sqliteExperimentalWarningFilterInstalled.includes",
);
type ProcessWithSqliteWarningFilterFlag = NodeJS.Process & {
  [SQLITE_WARNING_FILTER_FLAG]?: boolean;
  [SQLITE_WARNING_FILTER_INCLUDES_FLAG]?: boolean;
};

describe("runtime-state sqlite warning filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete (process as ProcessWithSqliteWarningFilterFlag)[SQLITE_WARNING_FILTER_FLAG];
    delete (process as ProcessWithSqliteWarningFilterFlag)[SQLITE_WARNING_FILTER_INCLUDES_FLAG];
  });

  afterEach(() => {
    process.emitWarning = originalEmitWarning;
    delete (process as ProcessWithSqliteWarningFilterFlag)[SQLITE_WARNING_FILTER_FLAG];
    delete (process as ProcessWithSqliteWarningFilterFlag)[SQLITE_WARNING_FILTER_INCLUDES_FLAG];
  });

  it("suppresses only the sqlite experimental warning", async () => {
    const forwardedWarnings: unknown[][] = [];

    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      forwardedWarnings.push([warning, ...args]);
    }) as typeof process.emitWarning;

    const { installSqliteExperimentalWarningFilter } = await import("../src/sqlite-warning-filter.ts");

    installSqliteExperimentalWarningFilter();

    process.emitWarning(
      "SQLite is an experimental feature and might change at any time",
      "ExperimentalWarning",
    );
    process.emitWarning(
      "SQLite is an experimental feature and might change at any time (extra context)",
      "ExperimentalWarning",
    );
    process.emitWarning("Different experimental warning", "ExperimentalWarning");
    process.emitWarning("Plain runtime warning", "Warning");

    expect(forwardedWarnings).toEqual([
      [
        "SQLite is an experimental feature and might change at any time (extra context)",
        "ExperimentalWarning",
      ],
      ["Different experimental warning", "ExperimentalWarning"],
      ["Plain runtime warning", "Warning"],
    ]);
  });

  it("detects Error-based sqlite warnings and installs idempotently", async () => {
    const {
      installSqliteExperimentalWarningFilter,
      installSqliteExperimentalWarningFilterWithOptions,
      isSqliteExperimentalWarning,
    } = await import("../src/sqlite-warning-filter.ts");

    expect(
      isSqliteExperimentalWarning(
        Object.assign(new Error("SQLite is an experimental feature and might change at any time"), {
          name: "ExperimentalWarning",
        }),
        [],
      ),
    ).toBe(true);
    expect(
      isSqliteExperimentalWarning(
        Object.assign(new Error("Different experimental warning"), {
          name: "ExperimentalWarning",
        }),
        [],
      ),
    ).toBe(false);
    expect(
      isSqliteExperimentalWarning(
        "SQLite is an experimental feature and might change at any time",
        [{ type: "ExperimentalWarning" }],
      ),
    ).toBe(true);
    expect(
      isSqliteExperimentalWarning(
        "SQLite is an experimental feature and might change at any time (extra context)",
        ["ExperimentalWarning"],
      ),
    ).toBe(false);
    expect(
      isSqliteExperimentalWarning(
        "SQLite is an experimental feature and might change at any time (extra context)",
        ["ExperimentalWarning"],
        { matchMode: "includes" },
      ),
    ).toBe(true);

    installSqliteExperimentalWarningFilter();
    const wrappedEmitWarning = process.emitWarning;
    installSqliteExperimentalWarningFilter();

    expect(process.emitWarning).toBe(wrappedEmitWarning);

    installSqliteExperimentalWarningFilterWithOptions({
      matchMode: "includes",
    });
    const includesWrappedEmitWarning = process.emitWarning;
    installSqliteExperimentalWarningFilterWithOptions({
      matchMode: "includes",
    });

    expect(process.emitWarning).toBe(includesWrappedEmitWarning);
  });

  it("installs the sqlite warning filter before node:sqlite first loads", async () => {
    const forwardedWarnings: unknown[][] = [];

    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      forwardedWarnings.push([warning, ...args]);
    }) as typeof process.emitWarning;

    // src/sqlite.ts loads node:sqlite through process.getBuiltinModule (no
    // top-level await), which bypasses vitest module mocks, so this test
    // exercises the real builtin: its ExperimentalWarning fires synchronously
    // through process.emitWarning on first load. Guard against vacuity first —
    // the ordering invariant is only provable on the first node:sqlite load in
    // this process. moduleLoadList is real but untyped in @types/node.
    const processWithModuleLoadList = process as NodeJS.Process & {
      moduleLoadList?: readonly string[];
    };
    expect(processWithModuleLoadList.moduleLoadList ?? []).not.toContain(
      "NativeModule sqlite",
    );

    await import("../src/sqlite.ts");

    expect(processWithModuleLoadList.moduleLoadList ?? []).toContain(
      "NativeModule sqlite",
    );
    expect(forwardedWarnings).toEqual([]);
  });
});
