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
    addMeal: vi.fn(async () => undefined),
    createExperiment: vi.fn(async () => undefined),
    ensureJournalDay: vi.fn(async () => undefined),
    readAssessmentResponse: vi.fn(async () => null),
    projectAssessmentResponse: vi.fn(async () => null),
    stopProtocolItem: vi.fn(async () => undefined),
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
    summarizeWearableSleep: vi.fn(async () => undefined),
    summarizeWearableActivity: vi.fn(async () => undefined),
    summarizeWearableBodyState: vi.fn(async () => undefined),
    summarizeWearableDay: vi.fn(async () => undefined),
    summarizeWearableRecovery: vi.fn(async () => undefined),
    summarizeWearableSourceHealth: vi.fn(async () => undefined),
    ...createAsyncFunctionRecord(healthQueryRuntimeMethodNames),
  };
}

afterEach(() => {
  vi.doUnmock("../src/runtime-import.ts");
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

test("loadIntegratedRuntime validates module shape and caches the successful runtime", async () => {
  const coreRuntime = createCoreRuntimeStub();
  const queryRuntime = createQueryRuntimeStub();
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      return coreRuntime;
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
  const firstRuntime = await runtimeModule.loadIntegratedRuntime();
  const secondRuntime = await runtimeModule.loadIntegratedRuntime();

  assert.equal(firstRuntime.core, coreRuntime);
  assert.equal(firstRuntime.query, queryRuntime);
  assert.equal(secondRuntime, firstRuntime);
  assert.deepEqual(loadRuntimeModuleMock.mock.calls, [["@murphai/core"], ["@murphai/query"]]);
});

test("loadIntegratedRuntime clears the cache after a shape mismatch and retries cleanly", async () => {
  const coreRuntime = createCoreRuntimeStub();
  const queryRuntime = createQueryRuntimeStub();
  let attempt = 0;
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      return attempt === 0 ? {} : coreRuntime;
    }
    if (specifier === "@murphai/query") {
      const value = queryRuntime;
      attempt += 1;
      return value;
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
  });

  const recoveredRuntime = await runtimeModule.loadIntegratedRuntime();
  assert.equal(recoveredRuntime.core, coreRuntime);
  assert.equal(recoveredRuntime.query, queryRuntime);
  assert.equal(loadRuntimeModuleMock.mock.calls.length, 4);
});

test("loadImporterRuntime validates the importer factory shape before creating services", async () => {
  const coreRuntime = createCoreRuntimeStub();
  const queryRuntime = createQueryRuntimeStub();
  const importersRuntime = { importer: true };
  const createImporters = vi.fn(() => importersRuntime);
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      return coreRuntime;
    }
    if (specifier === "@murphai/query") {
      return queryRuntime;
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
});

test("loadImporterRuntime reports invalid importer factory shapes through the shared runtime error", async () => {
  const coreRuntime = createCoreRuntimeStub();
  const queryRuntime = createQueryRuntimeStub();
  const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
    if (specifier === "@murphai/core") {
      return coreRuntime;
    }
    if (specifier === "@murphai/query") {
      return queryRuntime;
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
  });
});
