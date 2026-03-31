import { loadRuntimeModule } from "@murph/assistant-core/runtime-import"
import { createRuntimeUnavailableError } from "@murph/assistant-core/runtime-errors"
import { VaultCliError } from "@murph/assistant-core/vault-cli-errors"
import {
  healthCoreRuntimeMethodNames,
  healthCoreServiceMethodNames,
  healthQueryRuntimeMethodNames,
  healthQueryServiceMethodNames,
} from "@murph/assistant-core/health-cli-descriptors"

import type { JsonObject } from "@murph/assistant-core/health-cli-method-types"
import type {
  CoreRuntimeModule,
  ImportersFactoryRuntimeModule,
  ImportersRuntime,
  IntegratedRuntime,
  QueryRuntimeModule,
} from "./types.js"

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
      "initializeVault",
      "validateVault",
      "repairVault",
      "addMeal",
      "createExperiment",
      "ensureJournalDay",
      "readAssessmentResponse",
      "projectAssessmentResponse",
      "rebuildCurrentProfile",
      "stopProtocolItem",
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

function isImportersRuntimeModule(value: unknown): value is ImportersFactoryRuntimeModule {
  return isPlainObject(value) && typeof value.createImporters === "function"
}

export async function loadImportersRuntimeModule(): Promise<ImportersFactoryRuntimeModule> {
  return loadRuntimeModule<ImportersFactoryRuntimeModule>("@murph/importers")
}

export async function loadIntegratedRuntime(): Promise<IntegratedRuntime> {
  const runtimePromise =
    integratedRuntimePromise ??
    (integratedRuntimePromise = (async () => {
      try {
        const [coreModule, queryModule] = await Promise.all([
          loadRuntimeModule("@murph/core"),
          loadRuntimeModule("@murph/query"),
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
    loadImportersRuntimeModule(),
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
