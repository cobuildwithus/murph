import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

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
    buildPersonalPatternReportRuntime: vi.fn(async () => undefined),
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
