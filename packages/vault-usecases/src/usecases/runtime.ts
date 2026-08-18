import { loadRuntimeModule } from "../runtime-import.js"
import { createRuntimeUnavailableError } from "../runtime-errors.js"
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors"
import {
  healthCoreRuntimeMethodNames,
  healthCoreServiceMethodNames,
  healthQueryRuntimeMethodNames,
  healthQueryServiceMethodNames,
} from "../health-cli-descriptors.js"

import type { JsonObject } from "../health-cli-method-types.js"
import type {
  CoreRuntimeModule,
  ImportersFactoryRuntimeModule,
  ImportersRuntime,
  IntegratedRuntime,
  QueryRuntimeModule,
} from "./types.js"

let coreRuntimePromise: Promise<CoreRuntimeModule> | null = null
let queryRuntimePromise: Promise<QueryRuntimeModule> | null = null
let integratedRuntimePromise: Promise<IntegratedRuntime> | null = null

function toRuntimeUnavailableCause(error: unknown): unknown {
  if (
    error instanceof VaultCliError
    && error.code === "runtime_unavailable"
    && typeof error.context?.cause === "string"
  ) {
    return error.context.cause
  }

  return error
}

export function createUnwiredMethod<
  TArgs extends unknown[] = [],
  TResult = never,
>(name: string): (...args: TArgs) => Promise<TResult> {
  return async (..._args: TArgs) => {
    throw new VaultCliError(
      "not_implemented",
      `CLI integration for ${name} is not wired yet.`,
    )
  }
}

export function createUnwiredHealthMethodSet<TMethods extends string>(
  names: readonly TMethods[],
  group: "core" | "query",
) {
  return Object.fromEntries(
    names.map((name) => [name, createUnwiredMethod(`${group}.${name}`)]),
  ) as Record<TMethods, () => Promise<never>>
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasCallableMembers(
  value: JsonObject,
  members: string[],
) {
  return members.every((member) => typeof value[member] === "function")
}

function isCoreRuntimeModule(value: unknown): value is CoreRuntimeModule {
  return (
    isPlainObject(value) &&
    Array.isArray(value.REQUIRED_DIRECTORIES) &&
    hasCallableMembers(value, [
      "applyCanonicalWriteBatch",
      "resolveWorkoutSourceImportStatus",
      "initializeVault",
      "validateVault",
      "repairVault",
      "repairExperimentMedia",
      "repairJunctionWorkoutHeartRateZones",
      "runIntegrationIngestMigration",
      "detectWearableStorageMigrationCandidates",
      "runWearableStorageMigrationPass",
      "addMeal",
      "createExperiment",
      "ensureJournalDay",
      "upsertProtocol",
      "readAssessmentResponse",
      "projectAssessmentResponse",
      "stopRegimen",
      ...healthCoreRuntimeMethodNames,
    ])
  )
}

function isQueryRuntimeModule(value: unknown): value is QueryRuntimeModule {
  return (
    isPlainObject(value) &&
    hasCallableMembers(value, [
      "readVault",
      "readVaultTolerant",
      "lookupEntityById",
      "listEntities",
      "buildExportPack",
      "showSupplement",
      "listSupplements",
      "showSupplementCompound",
      "listSupplementCompounds",
      "summarizeWearableLatestRuntime",
      "summarizeWearableMetricLatestRuntime",
      "summarizeWearableMetricTrendRuntime",
      "summarizeWearableSleepRuntime",
      "summarizeWearableSleepPatternRuntime",
      "buildPersonalPatternReportRuntime",
      "summarizeWearableActivityRuntime",
      "summarizeWearableBodyStateRuntime",
      "summarizeWearableDayRuntime",
      "summarizeWearableRecoveryRuntime",
      "summarizeWearableSourceHealthRuntime",
      "explainWearableDriftRuntime",
      ...healthQueryRuntimeMethodNames,
    ])
  )
}

function isImportersRuntimeModule(value: unknown): value is ImportersFactoryRuntimeModule {
  return (
    isPlainObject(value)
    && typeof value.createImporters === "function"
  )
}

export async function loadImportersRuntimeModule(): Promise<ImportersFactoryRuntimeModule> {
  return loadRuntimeModule<ImportersFactoryRuntimeModule>("@murphai/importers")
}

export async function loadCoreRuntime(): Promise<CoreRuntimeModule> {
  const runtimePromise =
    coreRuntimePromise ??
    (coreRuntimePromise = (async () => {
      try {
        const coreModule = await loadRuntimeModule("@murphai/core")

        if (!isCoreRuntimeModule(coreModule)) {
          throw new TypeError("Core runtime package did not match the expected module shape.")
        }

        return coreModule
      } catch (error) {
        coreRuntimePromise = null
        throw createRuntimeUnavailableError("core-backed vault-cli services", error)
      }
    })())

  return runtimePromise
}

export async function loadQueryRuntime(): Promise<QueryRuntimeModule> {
  const runtimePromise =
    queryRuntimePromise ??
    (queryRuntimePromise = (async () => {
      try {
        const queryModule = await loadRuntimeModule("@murphai/query")

        if (!isQueryRuntimeModule(queryModule)) {
          throw new TypeError("Query runtime package did not match the expected module shape.")
        }

        return queryModule
      } catch (error) {
        queryRuntimePromise = null
        throw createRuntimeUnavailableError("query-backed vault-cli services", error)
      }
    })())

  return runtimePromise
}

export async function loadIntegratedRuntime(): Promise<IntegratedRuntime> {
  const runtimePromise =
    integratedRuntimePromise ??
    (integratedRuntimePromise = (async () => {
      try {
        const [core, query] = await Promise.all([
          loadCoreRuntime(),
          loadQueryRuntime(),
        ])

        return {
          core,
          query,
        }
      } catch (error) {
        integratedRuntimePromise = null
        throw createRuntimeUnavailableError(
          "integrated vault-cli services",
          toRuntimeUnavailableCause(error),
        )
      }
    })())

  return runtimePromise
}

export async function loadImporterRuntime(): Promise<ImportersRuntime> {
  let core!: CoreRuntimeModule
  let importersModule!: ImportersFactoryRuntimeModule

  try {
    const [loadedCore, loadedImportersModule] = await Promise.all([
      loadCoreRuntime(),
      loadImportersRuntimeModule(),
    ])

    if (!isImportersRuntimeModule(loadedImportersModule)) {
      throw new TypeError("Importer runtime package did not match the expected module shape.")
    }
    core = loadedCore
    importersModule = loadedImportersModule
  } catch (error) {
    throw createRuntimeUnavailableError(
      "importer-backed vault-cli services",
      toRuntimeUnavailableCause(error),
    )
  }

  return importersModule.createImporters({
    corePort: core,
  })
}

export {
  healthCoreServiceMethodNames,
  healthQueryServiceMethodNames,
}
