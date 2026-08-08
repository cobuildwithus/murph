import util from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEmitWarning = process.emitWarning;
const SQLITE_WARNING_FILTER_FLAG = Symbol.for("murph.sqliteExperimentalWarningFilterInstalled");
const SQLITE_WARNING_FILTER_INCLUDES_FLAG = Symbol.for(
  "murph.sqliteExperimentalWarningFilterInstalled.includes",
);
const PG_WARNING_FILTER_FLAG = Symbol.for(
  "murph.pgConcurrentQueryDeprecationWarningFilterInstalled",
);
const PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE =
  "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.";
type ProcessWithWarningFilterFlags = NodeJS.Process & {
  [SQLITE_WARNING_FILTER_FLAG]?: boolean;
  [SQLITE_WARNING_FILTER_INCLUDES_FLAG]?: boolean;
  [PG_WARNING_FILTER_FLAG]?: boolean;
};

function deleteWarningFilterFlags(): void {
  delete (process as ProcessWithWarningFilterFlags)[SQLITE_WARNING_FILTER_FLAG];
  delete (process as ProcessWithWarningFilterFlags)[SQLITE_WARNING_FILTER_INCLUDES_FLAG];
  delete (process as ProcessWithWarningFilterFlags)[PG_WARNING_FILTER_FLAG];
}

describe("hosted web warning filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    deleteWarningFilterFlags();
  });

  afterEach(() => {
    process.emitWarning = originalEmitWarning;
    deleteWarningFilterFlags();
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
    process.emitWarning("Different experimental warning", "ExperimentalWarning");
    process.emitWarning("Plain runtime warning", "Warning");

    expect(forwardedWarnings).toEqual([
      ["Different experimental warning", "ExperimentalWarning"],
      ["Plain runtime warning", "Warning"],
    ]);
  });

  it("suppresses only the pg concurrent-query deprecation warning", async () => {
    const forwardedWarnings: unknown[][] = [];

    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      forwardedWarnings.push([warning, ...args]);
    }) as typeof process.emitWarning;

    const { installHostedWebWarningFilters } = await import("@/src/lib/process-warnings");

    installHostedWebWarningFilters();

    // util.deprecate emits (message, "DeprecationWarning", deprecatedFn); the
    // trailing function must not defeat the match.
    const deprecatedFn = () => {};
    process.emitWarning(
      PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE,
      "DeprecationWarning",
      deprecatedFn,
    );
    process.emitWarning(PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE, "DeprecationWarning");
    process.emitWarning(
      "Client.queryQueue is deprecated and will be removed in pg@9.0.",
      "DeprecationWarning",
    );
    process.emitWarning("Some other deprecation", "DeprecationWarning");
    process.emitWarning(PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE, "ExperimentalWarning");
    process.emitWarning("Plain runtime warning", "Warning");

    expect(forwardedWarnings).toEqual([
      [
        "Client.queryQueue is deprecated and will be removed in pg@9.0.",
        "DeprecationWarning",
      ],
      ["Some other deprecation", "DeprecationWarning"],
      [PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE, "ExperimentalWarning"],
      ["Plain runtime warning", "Warning"],
    ]);
  });

  it("suppresses util.deprecate wrappers created before the filter installs", async () => {
    const forwardedWarnings: unknown[][] = [];

    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      forwardedWarnings.push([warning, ...args]);
    }) as typeof process.emitWarning;

    // pg creates its deprecation wrappers at module evaluation, before
    // prisma.ts reaches installHostedWebWarningFilters(), so wrapper creation
    // must not bind the pre-filter emitter. util.deprecate resolves
    // process.emitWarning at call time; this test fails if that ever changes
    // (the pg message would reach the stub above, bypassing the filter).
    const pgDeprecated = util.deprecate(
      () => {},
      PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE,
    );
    const otherDeprecated = util.deprecate(
      () => {},
      "Some other library deprecation.",
    );

    const { installHostedWebWarningFilters } = await import("@/src/lib/process-warnings");

    installHostedWebWarningFilters();

    pgDeprecated();
    otherDeprecated();

    expect(forwardedWarnings).toEqual([
      [
        "Some other library deprecation.",
        "DeprecationWarning",
        expect.any(Function),
      ],
    ]);
  });

  it("detects the pg deprecation across emitWarning argument shapes", async () => {
    const { isPgConcurrentQueryDeprecationWarning } = await import(
      "@/src/lib/process-warnings"
    );

    expect(
      isPgConcurrentQueryDeprecationWarning(PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE, [
        "DeprecationWarning",
      ]),
    ).toBe(true);
    expect(
      isPgConcurrentQueryDeprecationWarning(PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE, [
        { type: "DeprecationWarning" },
      ]),
    ).toBe(true);
    expect(
      isPgConcurrentQueryDeprecationWarning(
        Object.assign(new Error(PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE), {
          name: "DeprecationWarning",
        }),
        [],
      ),
    ).toBe(true);
    expect(
      isPgConcurrentQueryDeprecationWarning(
        `${PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE} (extra context)`,
        ["DeprecationWarning"],
      ),
    ).toBe(false);
    expect(
      isPgConcurrentQueryDeprecationWarning(PG_CONCURRENT_QUERY_DEPRECATION_MESSAGE, []),
    ).toBe(false);
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
