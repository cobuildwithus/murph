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

describe("hosted web warning filters", () => {
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

  it("suppresses the repeated SQLite experimental warning without hiding other warnings", async () => {
    const forwardedWarnings: unknown[][] = [];

    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      forwardedWarnings.push([warning, ...args]);
    }) as typeof process.emitWarning;

    const { installHostedWebWarningFilters } = await import("@/src/lib/process-warnings");

    installHostedWebWarningFilters();

    process.emitWarning(
      "SQLite is an experimental feature and might change at any time",
      "ExperimentalWarning",
    );
    process.emitWarning(
      "SQLite is an experimental feature and might change at any time (extra context)",
      "ExperimentalWarning",
    );
    process.emitWarning(
      "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.",
      "DeprecationWarning",
    );
    process.emitWarning("Different experimental warning", "ExperimentalWarning");
    process.emitWarning("Plain runtime warning", "Warning");

    expect(forwardedWarnings).toEqual([
      [
        "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.",
        "DeprecationWarning",
      ],
      ["Different experimental warning", "ExperimentalWarning"],
      ["Plain runtime warning", "Warning"],
    ]);
  });

  it("is idempotent", async () => {
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) =>
      originalEmitWarning(warning, ...(args as []))) as typeof process.emitWarning;

    const { installHostedWebWarningFilters } = await import("@/src/lib/process-warnings");

    installHostedWebWarningFilters();
    const wrappedEmitWarning = process.emitWarning;
    installHostedWebWarningFilters();

    expect(process.emitWarning).toBe(wrappedEmitWarning);
  });
});
