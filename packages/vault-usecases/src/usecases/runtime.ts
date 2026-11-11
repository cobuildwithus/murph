import { timeCliPhase } from "@murphai/runtime-state/node/cli-timing"
import { loadRuntimeModule } from "../runtime-import.js"
import { createRuntimeUnavailableError } from "../runtime-errors.js"
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors"
import {
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

let queryRuntimePromise: Promise<QueryRuntimeModule> | null = null

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

/** Fixed diagnostic span for the public service seam's cold integrated-services import. */
export function timeServiceRuntimeLoad<T>(load: () => Promise<T>): Promise<T> {
  return timeCliPhase("service-runtime-load", load)
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

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasCallableMembers(
  value: JsonObject,
  members: string[],
) {
  return members.every((member) => typeof value[member] === "function")
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
  // Every call's native import, including module-cache hits; there is no shared promise.
  return timeCliPhase("importers-runtime-load", () =>
    loadRuntimeModule<ImportersFactoryRuntimeModule>("@murphai/importers"))
}

export async function loadCoreRuntime(): Promise<CoreRuntimeModule> {
  try {
    return await import("@murphai/core")
  } catch (error) {
    throw createRuntimeUnavailableError("core-backed vault-cli services", error)
  }
}

export async function loadQueryRuntime(): Promise<QueryRuntimeModule> {
  const runtimePromise =
    queryRuntimePromise ??
    (queryRuntimePromise = (async () => {
      try {
        // Cold shared-promise owner only; the shape check below is excluded.
        const queryModule = await timeCliPhase("query-runtime-load", () => loadRuntimeModule("@murphai/query"))

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
  try {
    const [core, query] = await Promise.all([loadCoreRuntime(), loadQueryRuntime()])
    return { core, query }
  } catch (error) {
    throw createRuntimeUnavailableError(
      "integrated vault-cli services",
      toRuntimeUnavailableCause(error),
    )
  }
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
