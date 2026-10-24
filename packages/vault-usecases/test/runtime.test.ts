import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";
import { normalizeCliTiming, type CliTiming } from "@murphai/runtime-state/cli-timing";

import {
  healthCoreRuntimeMethodNames,
  healthQueryRuntimeMethodNames,
} from "../src/health-cli-descriptors.ts";
import { createRuntimeUnavailableError } from "../src/runtime-errors.ts";
import { createUnwiredMethod } from "../src/usecases/runtime.ts";
import { loadRuntimeModule } from "../src/runtime-import.ts";
import { importWithMocks } from "./mock-import.ts";

function createAsyncFunctionRecord(names: readonly string[]) {
  return Object.fromEntries(names.map((name) => [name, vi.fn(async () => undefined)]));
}

function createCoreRuntimeStub() {
  return {
    REQUIRED_DIRECTORIES: ["journal"],
    applyCanonicalWriteBatch: vi.fn(async () => undefined),
    resolveWorkoutSourceImportStatus: vi.fn(async () => 'not_imported' as const),
    initializeVault: vi.fn(async () => undefined),
    validateVault: vi.fn(async () => ({ valid: true, issues: [] })),
    repairVault: vi.fn(async () => ({ updated: false, createdDirectories: [] })),
    repairExperimentMedia: vi.fn(async () => ({ mutated: false })),
    repairJunctionWorkoutHeartRateZones: vi.fn(async () => ({ mutated: false })),
    runIntegrationIngestMigration: vi.fn(async () => ({
      mode: "dry-run",
      storedFormatVersion: 2,
      hasWork: false,
      hasMore: false,
      candidateBundleCount: 0,
      copiedBundleCount: 0,
      detachedBundleCount: 0,
      deletableFileCount: 0,
      sourceBytes: 0,
      journalBytes: 0,
      blockerCount: 0,
      blockersByCode: {},
      blockerExamples: [],
      mutated: false,
      appendedBundleCount: 0,
      detachedEventRowCount: 0,
      deletedFileCount: 0,
      finalized: false,
      auditPaths: [],
    })),
    detectWearableStorageMigrationCandidates: vi.fn(async () => ({ hasWork: false })),
    runWearableStorageMigrationPass: vi.fn(async () => ({ mutated: false })),
    addMeal: vi.fn(async () => undefined),
    createExperiment: vi.fn(async () => undefined),
    ensureJournalDay: vi.fn(async () => undefined),
    stopRegimen: vi.fn(async () => undefined),
    upsertProtocol: vi.fn(async () => undefined),
    readAssessmentResponse: vi.fn(async () => null),
    projectAssessmentResponse: vi.fn(async () => null),
    ...createAsyncFunctionRecord(healthCoreRuntimeMethodNames),
  };
}

function createQueryRuntimeStub() {
  return {
    readVault: vi.fn(async () => undefined),
    readVaultTolerant: vi.fn(async () => undefined),
    lookupEntityById: vi.fn(async () => null),
    listEntities: vi.fn(async () => []),
    buildExportPack: vi.fn(async () => undefined),
    showSupplement: vi.fn(async () => null),
    listSupplements: vi.fn(async () => []),
    showSupplementCompound: vi.fn(async () => null),
    listSupplementCompounds: vi.fn(async () => []),
    summarizeWearableLatestRuntime: vi.fn(async () => undefined),
    summarizeWearableMetricLatestRuntime: vi.fn(async () => undefined),
    summarizeWearableMetricTrendRuntime: vi.fn(async () => undefined),
    summarizeWearableSleepRuntime: vi.fn(async () => undefined),
    summarizeWearableSleepPatternRuntime: vi.fn(async () => undefined),
    summarizeWearableActivityRuntime: vi.fn(async () => undefined),
    summarizeWearableBodyStateRuntime: vi.fn(async () => undefined),
    summarizeWearableDayRuntime: vi.fn(async () => undefined),
    summarizeWearableRecoveryRuntime: vi.fn(async () => undefined),
    summarizeWearableSourceHealthRuntime: vi.fn(async () => undefined),
    explainWearableDriftRuntime: vi.fn(async () => undefined),
    ...createAsyncFunctionRecord(healthQueryRuntimeMethodNames),
  };
}

afterEach(() => {
  vi.doUnmock("../src/runtime-import.ts");
  vi.doUnmock("../src/usecases/runtime.js");
  vi.restoreAllMocks();
});

test("loadRuntimeModule resolves workspace or built-in modules dynamically", async () => {
  const pathModule = await loadRuntimeModule<typeof import("node:path")>("node:path");

  assert.equal(typeof pathModule.join, "function");
});

test("createRuntimeUnavailableError preserves package guidance with and without an Error cause", () => {
  const withCause = createRuntimeUnavailableError("integrated vault-cli services", new Error("boom"));
  const withoutCause = createRuntimeUnavailableError("integrated vault-cli services", "boom");

  assert.equal(withCause.code, "runtime_unavailable");
  assert.equal(
    withCause.message,
    "Local runtime for integrated vault-cli services is unavailable until the integrating workspace installs incur and links @murphai/core, @murphai/importers, and @murphai/query.",
  );
  assert.deepEqual(withCause.context, {
    cause: "boom",
    packages: ["@murphai/core", "@murphai/importers", "@murphai/query", "incur"],
  });
  assert.deepEqual(withoutCause.context, {
    packages: ["@murphai/core", "@murphai/importers", "@murphai/query", "incur"],
  });
});

test("createUnwiredMethod rejects with a shared not_implemented error", async () => {
  await assert.rejects(createUnwiredMethod("query.showGoal")(), {
    name: "VaultCliError",
    code: "not_implemented",
    message: "CLI integration for query.showGoal is not wired yet.",
  });
});

test("repairWearableStorage dry-run scopes dense raw hasMore to selected work", async () => {
  const coreRuntime = createCoreRuntimeStub();
  coreRuntime.detectWearableStorageMigrationCandidates = vi.fn(async () => ({
    denseProviderRawTimeseriesCount: 1,
    denseProviderSampleShardCount: 0,
    hasWork: true,
    legacyCanonicalArtifactCount: 0,
    legacyReceiptPayloadCount: 0,
    retentionEligibleDenseProviderRawTimeseriesBytes: 2048,
    retentionEligibleDenseProviderRawTimeseriesCount: 1,
    suspectedBytes: 4096,
  }));
  const runtimeModule = {
    createUnwiredMethod,
    loadCoreRuntime: vi.fn(async () => coreRuntime),
    loadImporterRuntime: vi.fn(async () => {
      throw new Error("loadImporterRuntime should not be called");
    }),
    loadQueryRuntime: vi.fn(async () => {
      throw new Error("loadQueryRuntime should not be called");
    }),
  };
  const integratedServicesModule = await importWithMocks<typeof import("../src/usecases/integrated-services.ts")>(
    "../src/usecases/integrated-services.ts",
    {
      "../src/usecases/runtime.js": () => runtimeModule,
    },
  );
  const services = integratedServicesModule.createIntegratedVaultServices();

  const defaultDryRun = await services.core.repairWearableStorage({
    requestId: "repair-default",
    vault: "fixture-vault",
  });

  assert.equal(defaultDryRun.hasWork, false);
  assert.equal(defaultDryRun.hasMore, false);
  assert.equal(defaultDryRun.denseProviderRawTimeseriesCount, 1);
  assert.equal(defaultDryRun.retentionEligibleDenseProviderRawTimeseriesBytes, 2048);
  assert.equal(defaultDryRun.retentionEligibleDenseProviderRawTimeseriesCount, 1);

  const denseDryRun = await services.core.repairWearableStorage({
    pruneDenseRaw: true,
    requestId: "repair-dense-raw",
    vault: "fixture-vault",
  });

  assert.equal(denseDryRun.hasWork, true);
  assert.equal(denseDryRun.hasMore, true);
});

test("repairIntegrationIngests delegates to the core migration primitive", async () => {
  const runIntegrationIngestMigration = vi.fn(async (_input: unknown) => ({
    mode: "apply",
    storedFormatVersion: 2,
    hasWork: false,
    hasMore: false,
    candidateBundleCount: 0,
    copiedBundleCount: 0,
    detachedBundleCount: 0,
    deletableFileCount: 0,
    sourceBytes: 0,
    journalBytes: 0,
    blockerCount: 0,
    blockersByCode: {},
    blockerExamples: [],
    mutated: false,
    appendedBundleCount: 0,
    detachedEventRowCount: 0,
    deletedFileCount: 0,
    finalized: false,
    auditPaths: [],
  }));
  const coreRuntime = {
    ...createCoreRuntimeStub(),
    runIntegrationIngestMigration,
  };
  const runtimeModule = {
    createUnwiredMethod,
    loadCoreRuntime: vi.fn(async () => coreRuntime),
    loadImporterRuntime: vi.fn(async () => {
      throw new Error("loadImporterRuntime should not be called");
    }),
    loadQueryRuntime: vi.fn(async () => {
      throw new Error("loadQueryRuntime should not be called");
    }),
  };
  const integratedServicesModule = await importWithMocks<typeof import("../src/usecases/integrated-services.ts")>(
    "../src/usecases/integrated-services.ts",
    {
      "../src/usecases/runtime.js": () => runtimeModule,
    },
  );
  const services = integratedServicesModule.createIntegratedVaultServices();

  const result = await services.core.repairIntegrationIngests({
    apply: true,
    finalize: false,
    maxBundles: 2,
    maxBytes: 1024,
    requestId: "repair-integration",
    vault: "fixture-vault",
  });

  assert.equal(result.mode, "apply");
  assert.deepEqual(runIntegrationIngestMigration.mock.calls[0]?.[0], {
    apply: true,
    finalize: false,
    maxBundles: 2,
    maxBytes: 1024,
    vaultRoot: "fixture-vault",
  });
});

test("repairWearableStorage apply surfaces dense raw byte metrics", async () => {
  const runWearableStorageMigrationPass = vi.fn(async (_input: unknown) => ({
    bytesAfter: 128,
    bytesBefore: 8192,
    bytesFreed: 8064,
    compactedReceiptCount: 0,
    denseRawBytesAfter: 128,
    denseRawBytesBefore: 8192,
    denseRawBytesFreed: 8064,
    hasMore: false,
    mutated: true,
    skippedCount: 1,
    tombstonedCanonicalArtifactCount: 0,
    tombstonedDenseRawArtifactCount: 2,
    touchedPaths: ["raw/integrations/wearable-provider/2026/04/import/01.json"],
  }));
  const coreRuntime = {
    ...createCoreRuntimeStub(),
    detectWearableStorageMigrationCandidates: vi.fn(async () => ({
      denseProviderRawTimeseriesCount: 2,
      denseProviderSampleShardCount: 0,
      hasWork: true,
      legacyCanonicalArtifactCount: 0,
      legacyReceiptPayloadCount: 0,
      retentionEligibleDenseProviderRawTimeseriesBytes: 4096,
      retentionEligibleDenseProviderRawTimeseriesCount: 2,
      suspectedBytes: 4096,
    })),
    runWearableStorageMigrationPass,
  };
  const runtimeModule = {
    createUnwiredMethod,
    loadCoreRuntime: vi.fn(async () => coreRuntime),
    loadImporterRuntime: vi.fn(async () => {
      throw new Error("loadImporterRuntime should not be called");
    }),
    loadQueryRuntime: vi.fn(async () => {
      throw new Error("loadQueryRuntime should not be called");
    }),
  };
  const integratedServicesModule = await importWithMocks<typeof import("../src/usecases/integrated-services.ts")>(
    "../src/usecases/integrated-services.ts",
    {
      "../src/usecases/runtime.js": () => runtimeModule,
    },
  );
  const services = integratedServicesModule.createIntegratedVaultServices();

  const result = await services.core.repairWearableStorage({
    apply: true,
    maxBytes: 1024,
    maxFiles: 5,
    pruneDenseRaw: true,
    requestId: "repair-dense-raw-apply",
    vault: "fixture-vault",
  });

  assert.equal(result.mode, "apply");
  assert.equal(result.retentionEligibleDenseProviderRawTimeseriesBytes, 4096);
  assert.equal(result.retentionEligibleDenseProviderRawTimeseriesCount, 2);
  assert.equal(result.denseRawBytesBefore, 8192);
  assert.equal(result.denseRawBytesAfter, 128);
  assert.equal(result.denseRawBytesFreed, 8064);
  assert.equal(result.tombstonedDenseRawArtifactCount, 2);
  assert.equal(result.touchedPathCount, 1);
  assert.deepEqual(runWearableStorageMigrationPass.mock.calls[0]?.[0], {
    includeRecentDenseRaw: undefined,
    maxBytes: 1024,
    maxFiles: 5,
    pruneDenseRaw: true,
    vaultRoot: "fixture-vault",
  });
});

test("loadCoreRuntime validates module shape and caches the successful runtime", async () => {
  const coreRuntime = createCoreRuntimeStub();
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      return coreRuntime;
    }
    throw new Error(`Unexpected specifier: ${specifier}`);
  });

  const runtimeModule = await importWithMocks<typeof import("../src/usecases/runtime.ts")>(
    "../src/usecases/runtime.ts",
    {
      "../src/runtime-import.ts": () => ({
        loadRuntimeModule: vi.fn(loadRuntimeModuleMock),
      }),
    },
  );
  const firstRuntime = await runtimeModule.loadCoreRuntime();
  const secondRuntime = await runtimeModule.loadCoreRuntime();

  assert.equal(firstRuntime, coreRuntime);
  assert.equal(secondRuntime, firstRuntime);
  assert.deepEqual(loadRuntimeModuleMock.mock.calls, [["@murphai/core"]]);
});

test("loadQueryRuntime clears the cache after a shape mismatch and retries cleanly", async () => {
  const queryRuntime = createQueryRuntimeStub();
  let attempt = 0;
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/query") {
      attempt += 1;
      return attempt === 1 ? {} : queryRuntime;
    }
    throw new Error(`Unexpected specifier: ${specifier}`);
  });

  const runtimeModule = await importWithMocks<typeof import("../src/usecases/runtime.ts")>(
    "../src/usecases/runtime.ts",
    {
      "../src/runtime-import.ts": () => ({
        loadRuntimeModule: vi.fn(loadRuntimeModuleMock),
      }),
    },
  );

  await assert.rejects(() => runtimeModule.loadQueryRuntime(), {
    name: "VaultCliError",
    code: "runtime_unavailable",
    message:
      "Local runtime for query-backed vault-cli services is unavailable until the integrating workspace installs incur and links @murphai/core, @murphai/importers, and @murphai/query.",
  });

  const recoveredRuntime = await runtimeModule.loadQueryRuntime();
  assert.equal(recoveredRuntime, queryRuntime);
  assert.deepEqual(loadRuntimeModuleMock.mock.calls, [["@murphai/query"], ["@murphai/query"]]);
});

test("query-runtime-load times only cold shared loads, excludes the shape check and keeps reset semantics", async () => {
  const queryRuntime = createQueryRuntimeStub();
  const importFailure = new Error("synthetic import failure");
  const original = process.hrtime.bigint;
  let clock = 0n;
  const advance = (ms: number) => { clock += BigInt(ms) * 1_000_000n; };
  let attempt = 0;
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    assert.equal(specifier, "@murphai/query");
    attempt += 1;
    advance(5);
    if (attempt === 1) throw importFailure;
    if (attempt === 2) return {};
    // The shape check reads this member after the timed load has resolved.
    return Object.defineProperty({ ...queryRuntime }, "readVault", {
      enumerable: true,
      get() { advance(7); return queryRuntime.readVault; },
    });
  });
  const runtimeModule = await importWithMocks<typeof import("../src/usecases/runtime.ts")>(
    "../src/usecases/runtime.ts",
    { "../src/runtime-import.ts": () => ({ loadRuntimeModule: loadRuntimeModuleMock }) },
  );
  // Same post-reset module instance (and AsyncLocalStorage) as runtime.ts.
  const { timeCliDispatch, withCliTiming } = await import("@murphai/runtime-state/node/cli-timing");
  function timed<T>(run: () => Promise<T>) {
    let report: CliTiming | undefined;
    let result: T | undefined;
    const outcome = withCliTiming(() => timeCliDispatch("wearables latest", async () => { result = await run(); }),
      (value) => { report = value; }).then(() => result);
    const loads = () => {
      assert.ok(report);
      assert.deepEqual(normalizeCliTiming(report), report);
      return report.commands[0]!.phases.filter((phase) => phase.phase.endsWith("-load"))
        .map((phase) => [phase.phase, phase.count, phase.sumUs]);
    };
    return { outcome, loads };
  }
  const unavailable = { name: "VaultCliError", code: "runtime_unavailable" };

  process.hrtime.bigint = () => clock;
  try {
    const failedImport = timed(() => runtimeModule.loadQueryRuntime());
    await assert.rejects(failedImport.outcome, { ...unavailable, context: {
      cause: "synthetic import failure",
      packages: ["@murphai/core", "@murphai/importers", "@murphai/query", "incur"],
    } });
    assert.deepEqual(failedImport.loads(), [["query-runtime-load", 1, 5_000]]);

    const failedShape = timed(() => runtimeModule.loadQueryRuntime());
    await assert.rejects(failedShape.outcome, unavailable);
    assert.deepEqual(failedShape.loads(), [["query-runtime-load", 1, 5_000]]);

    const cold = timed(() => Promise.all([runtimeModule.loadQueryRuntime(), runtimeModule.loadQueryRuntime()]));
    const [first, second] = (await cold.outcome) ?? [];
    assert.ok(first);
    assert.equal(first, second);
    // One shared-promise owner; the 7 ms shape-check getter is outside the span.
    assert.deepEqual(cold.loads(), [["query-runtime-load", 1, 5_000]]);

    const warm = timed(() => runtimeModule.loadQueryRuntime());
    assert.equal(await warm.outcome, first);
    assert.deepEqual(warm.loads(), []);
    assert.equal(await runtimeModule.loadQueryRuntime(), first);
  } finally {
    process.hrtime.bigint = original;
  }
  assert.equal(loadRuntimeModuleMock.mock.calls.length, 3);
});

test("importers-runtime-load times each importer import call and preserves its value and error", async () => {
  const importersModule = { createImporters: vi.fn() };
  const importFailure = new Error("synthetic importer import failure");
  const original = process.hrtime.bigint;
  let clock = 0n;
  let attempt = 0;
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    assert.equal(specifier, "@murphai/importers");
    attempt += 1;
    clock += BigInt(attempt) * 1_000_000n; // 1 ms, then 2 ms, then 3 ms.
    if (attempt === 1) throw importFailure;
    return importersModule;
  });
  const runtimeModule = await importWithMocks<typeof import("../src/usecases/runtime.ts")>(
    "../src/usecases/runtime.ts",
    { "../src/runtime-import.ts": () => ({ loadRuntimeModule: loadRuntimeModuleMock }) },
  );
  // Same post-reset module instance (and AsyncLocalStorage) as runtime.ts.
  const { timeCliDispatch, withCliTiming } = await import("@murphai/runtime-state/node/cli-timing");
  let report: CliTiming | undefined;

  process.hrtime.bigint = () => clock;
  try {
    await withCliTiming(() => timeCliDispatch("meal add", async () => {
      await assert.rejects(runtimeModule.loadImportersRuntimeModule(), (error: unknown) => error === importFailure);
      assert.equal(await runtimeModule.loadImportersRuntimeModule(), importersModule);
      assert.equal(await runtimeModule.loadImportersRuntimeModule(), importersModule);
    }), (value) => { report = value; });
  } finally {
    process.hrtime.bigint = original;
  }

  assert.ok(report);
  assert.deepEqual(normalizeCliTiming(report), report);
  // No shared promise or retry owner: one sample per existing loader call.
  assert.deepEqual(report.commands[0]!.phases.filter((phase) => phase.phase.endsWith("-load"))
    .map((phase) => [phase.phase, phase.count, phase.sumUs]), [["importers-runtime-load", 3, 6_000]]);
  assert.equal(loadRuntimeModuleMock.mock.calls.length, 3);
  assert.equal(importersModule.createImporters.mock.calls.length, 0);
  // Outside a CLI scope the loader is unchanged and records nothing.
  assert.equal(await runtimeModule.loadImportersRuntimeModule(), importersModule);
});

for (const lookupKind of ["exact", "owner"] as const) {
  test(`event-core-load times ${lookupKind} imports without timing reads or changing results/errors`, async () => {
    const originalClock = process.hrtime.bigint;
    let clock = 0n;
    const advance = (ms: number) => { clock += BigInt(ms) * 1_000_000n; };
    const event: import("@murphai/contracts").MealEventRecord = {
      schemaVersion: "murph.event.v1", id: "evt_00000000000000000000000001",
      kind: "meal", mealId: "meal_00000000000000000000000002", source: "manual",
      occurredAt: "2026-01-01T12:00:00.000Z", recordedAt: "2026-01-01T12:00:00.000Z",
      dayKey: "2026-01-01",
      // Conversion/structuredClone touches this after the import has ended.
      get title() { advance(11); return "PRIVATE_SENTINEL"; },
    };
    const ledgerFile = "ledger/events/2026/2026-01.jsonl";
    const read = vi.fn(async () => { advance(7); return { eventId: event.id, ledgerFile, event }; });
    const importFailure = Object.assign(new Error("PRIVATE_SENTINEL"), { details: { payload: "PRIVATE_SENTINEL" } });
    let rejectImport = false;
    const load = vi.fn(async (specifier: string) => {
      assert.equal(specifier, "@murphai/core");
      advance(5);
      if (rejectImport) throw importFailure;
      return { readEvent: read, readOwnedEvent: read };
    });
    const module = await importWithMocks<typeof import("../src/usecases/exact-event-record.ts")>(
      "../src/usecases/exact-event-record.ts",
      { "../src/runtime-import.ts": () => ({ loadRuntimeModule: load }) },
    );
    const { timeCliDispatch, withCliTiming } = await import("@murphai/runtime-state/node/cli-timing");
    const run = () => lookupKind === "exact"
      ? module.readExactEventRecord({ vault: "./PRIVATE_SENTINEL", lookup: ` ${event.id} `, entityLabel: "meal" })
      : module.readOwnedEventRecord({ vault: "./PRIVATE_SENTINEL", lookup: ` ${event.mealId} `, kind: "meal" });
    const reports: CliTiming[] = [];
    const timed = async (action: () => Promise<void>) =>
      withCliTiming(() => timeCliDispatch("meal show", action), (report) => { reports.push(report); });

    process.hrtime.bigint = () => clock;
    try {
      const untimed = await run();
      const values: Awaited<ReturnType<typeof run>>[] = [];
      await timed(async () => { values.push(await run(), await run()); });
      for (const value of values) {
        assert.deepEqual(value, untimed);
        assert.equal(value.event, event);
      }
      assert.equal(read.mock.calls.length, 3);
      assert.equal(load.mock.calls.length, 3);
      rejectImport = true;
      await assert.rejects(timed(async () => { await run(); }), (error: unknown) => error === importFailure);
      // Disabled instrumentation preserves the identical loader rejection too.
      await assert.rejects(run(), (error: unknown) => error === importFailure);
      assert.equal(read.mock.calls.length, 3);
      assert.equal(load.mock.calls.length, 5);
    } finally {
      process.hrtime.bigint = originalClock;
    }

    assert.equal(reports.length, 2);
    for (const [index, report] of reports.entries()) {
      assert.deepEqual(normalizeCliTiming(report), report);
      const command = report.commands[0]!;
      assert.equal(command.outcome, index === 0 ? "ok" : "error");
      const count = index === 0 ? 2 : 1;
      assert.deepEqual(command.phases.filter((phase) => phase.phase.startsWith("event-")), [{
        phase: "event-core-load", count, sumUs: count * 5_000, maxUs: 5_000,
        buckets: [count, 0, 0, 0, 0, 0, 0, 0],
      }]);
      assert.equal(report.droppedSpans, 0);
      assert.equal(report.droppedCalls, 0);
      assert.equal(/PRIVATE_SENTINEL|evt_|meal_|ledger\//u.test(JSON.stringify(report)), false);
    }
    // Successful dispatch includes read and conversion work; the load phase does not.
    assert.ok(reports[0]!.commands[0]!.phases.find((phase) => phase.phase === "dispatch")!.sumUs > 24_000);
  });
}

test("loadIntegratedRuntime composes cached owner loaders and retries only the failed owner", async () => {
  const coreRuntime = createCoreRuntimeStub();
  const queryRuntime = createQueryRuntimeStub();
  let coreAttempts = 0;
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      coreAttempts += 1;
      return coreAttempts === 1 ? {} : coreRuntime;
    }
    if (specifier === "@murphai/query") {
      return queryRuntime;
    }
    throw new Error(`Unexpected specifier: ${specifier}`);
  });

  const runtimeModule = await importWithMocks<typeof import("../src/usecases/runtime.ts")>(
    "../src/usecases/runtime.ts",
    {
      "../src/runtime-import.ts": () => ({
        loadRuntimeModule: vi.fn(loadRuntimeModuleMock),
      }),
    },
  );

  await assert.rejects(() => runtimeModule.loadIntegratedRuntime(), {
    name: "VaultCliError",
    code: "runtime_unavailable",
    message:
      "Local runtime for integrated vault-cli services is unavailable until the integrating workspace installs incur and links @murphai/core, @murphai/importers, and @murphai/query.",
  });

  const recoveredRuntime = await runtimeModule.loadIntegratedRuntime();
  assert.equal(recoveredRuntime.core, coreRuntime);
  assert.equal(recoveredRuntime.query, queryRuntime);
  assert.deepEqual(loadRuntimeModuleMock.mock.calls, [
    ["@murphai/core"],
    ["@murphai/query"],
    ["@murphai/core"],
  ]);
});

test("loadImporterRuntime creates importers from core without loading query", async () => {
  const coreRuntime = createCoreRuntimeStub();
  const importersRuntime = { importer: true };
  const createImporters = vi.fn(() => importersRuntime);
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      return coreRuntime;
    }
    if (specifier === "@murphai/importers") {
      return {
        createImporters,
      };
    }
    throw new Error(`Unexpected specifier: ${specifier}`);
  });

  const runtimeModule = await importWithMocks<typeof import("../src/usecases/runtime.ts")>(
    "../src/usecases/runtime.ts",
    {
      "../src/runtime-import.ts": () => ({
        loadRuntimeModule: vi.fn(loadRuntimeModuleMock),
      }),
    },
  );
  const result = await runtimeModule.loadImporterRuntime();

  assert.equal(result, importersRuntime);
  assert.deepEqual(createImporters.mock.calls, [[{ corePort: coreRuntime }]]);
  assert.deepEqual(loadRuntimeModuleMock.mock.calls, [
    ["@murphai/core"],
    ["@murphai/importers"],
  ]);
});

test("loadImporterRuntime reports invalid importer factory shapes through the shared runtime error", async () => {
  const coreRuntime = createCoreRuntimeStub();
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      return coreRuntime;
    }
    if (specifier === "@murphai/importers") {
      return {};
    }
    throw new Error(`Unexpected specifier: ${specifier}`);
  });

  const runtimeModule = await importWithMocks<typeof import("../src/usecases/runtime.ts")>(
    "../src/usecases/runtime.ts",
    {
      "../src/runtime-import.ts": () => ({
        loadRuntimeModule: vi.fn(loadRuntimeModuleMock),
      }),
    },
  );

  await assert.rejects(() => runtimeModule.loadImporterRuntime(), {
    name: "VaultCliError",
    code: "runtime_unavailable",
    message:
      "Local runtime for importer-backed vault-cli services is unavailable until the integrating workspace installs incur and links @murphai/core, @murphai/importers, and @murphai/query.",
  });
});

test("loadImporterRuntime preserves the importer-backed error label when core loading fails", async () => {
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      return {};
    }
    if (specifier === "@murphai/importers") {
      return {
        createImporters: vi.fn(),
      };
    }
    throw new Error(`Unexpected specifier: ${specifier}`);
  });

  const runtimeModule = await importWithMocks<typeof import("../src/usecases/runtime.ts")>(
    "../src/usecases/runtime.ts",
    {
      "../src/runtime-import.ts": () => ({
        loadRuntimeModule: vi.fn(loadRuntimeModuleMock),
      }),
    },
  );

  await assert.rejects(() => runtimeModule.loadImporterRuntime(), {
    name: "VaultCliError",
    code: "runtime_unavailable",
    message:
      "Local runtime for importer-backed vault-cli services is unavailable until the integrating workspace installs incur and links @murphai/core, @murphai/importers, and @murphai/query.",
  });
});

test("loadImporterRuntime preserves importer factory construction errors", async () => {
  const coreRuntime = createCoreRuntimeStub();
  const createImportersError = new Error("factory boom");
  const createImporters = vi.fn(() => {
    throw createImportersError;
  });
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      return coreRuntime;
    }
    if (specifier === "@murphai/importers") {
      return {
        createImporters,
      };
    }
    throw new Error(`Unexpected specifier: ${specifier}`);
  });

  const runtimeModule = await importWithMocks<typeof import("../src/usecases/runtime.ts")>(
    "../src/usecases/runtime.ts",
    {
      "../src/runtime-import.ts": () => ({
        loadRuntimeModule: vi.fn(loadRuntimeModuleMock),
      }),
    },
  );

  await assert.rejects(
    () => runtimeModule.loadImporterRuntime(),
    (error: unknown) => {
      assert.equal(error, createImportersError);
      return true;
    },
  );
  assert.deepEqual(createImporters.mock.calls, [[{ corePort: coreRuntime }]]);
});
