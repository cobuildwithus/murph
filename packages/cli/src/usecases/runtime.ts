import { loadRuntimeModule } from "../runtime-import.js"
import { VaultCliError } from "../vault-cli-errors.js"
import {
  healthCoreRuntimeMethodNames,
  healthCoreServiceMethodNames,
  healthQueryRuntimeMethodNames,
  healthQueryServiceMethodNames,
} from "../health-cli-descriptors.js"

import type { JsonObject } from "../health-cli-method-types.js"
import type {
  CoreRuntimeModule,
  ImportersRuntime,
  ImportersRuntimeModule,
  IntegratedRuntime,
  QueryRuntimeModule,
} from "./types.js"

const RUNTIME_PACKAGES = Object.freeze([
  "@healthybob/core",
  "@healthybob/importers",
  "@healthybob/query",
  "incur",
])

let integratedRuntimePromise: Promise<IntegratedRuntime> | null = null

export function createUnwiredMethod(name: string): () => Promise<never> {
  return async () => {
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

function createRuntimeUnavailableError(
  operation: string,
  cause: unknown,
) {
  const details =
    cause instanceof Error
      ? {
          cause: cause.message,
          packages: [...RUNTIME_PACKAGES],
        }
      : {
          packages: [...RUNTIME_PACKAGES],
        }

  return new VaultCliError(
    "runtime_unavailable",
    `packages/cli can describe ${operation}, but local execution is blocked until the integrating workspace installs incur and links @healthybob/core, @healthybob/importers, and @healthybob/query.`,
    details,
  )
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
      "initializeVault",
      "validateVault",
      "addMeal",
      "createExperiment",
      "ensureJournalDay",
      "readAssessmentResponse",
      "projectAssessmentResponse",
      "rebuildCurrentProfile",
      "stopRegimenItem",
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
      "lookupRecordById",
      "listRecords",
      "buildExportPack",
      "showSupplement",
      "listSupplements",
      "showSupplementCompound",
      "listSupplementCompounds",
      ...healthQueryRuntimeMethodNames,
    ])
  )
}

function isImportersRuntimeModule(value: unknown): value is ImportersRuntimeModule {
  return isPlainObject(value) && typeof value.createImporters === "function"
}

export async function loadIntegratedRuntime(): Promise<IntegratedRuntime> {
  const runtimePromise =
    integratedRuntimePromise ??
    (integratedRuntimePromise = (async () => {
      try {
        const [coreModule, queryModule] = await Promise.all([
          loadRuntimeModule("@healthybob/core"),
          loadRuntimeModule("@healthybob/query"),
        ])

        if (!isCoreRuntimeModule(coreModule) || !isQueryRuntimeModule(queryModule)) {
          throw new TypeError("Integrated runtime packages did not match the expected module shape.")
        }

        return {
          core: coreModule,
          query: queryModule,
        }
      } catch (error) {
        integratedRuntimePromise = null
        throw createRuntimeUnavailableError(
          "integrated vault-cli services",
          error,
        )
      }
    })())

  return runtimePromise
}

export async function loadImporterRuntime(): Promise<ImportersRuntime> {
  const [{ core }, importersModule] = await Promise.all([
    loadIntegratedRuntime(),
    loadRuntimeModule("@healthybob/importers"),
  ])

  if (!isImportersRuntimeModule(importersModule)) {
    throw createRuntimeUnavailableError(
      "importer-backed vault-cli services",
      new TypeError("Importer runtime package did not match the expected module shape."),
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
