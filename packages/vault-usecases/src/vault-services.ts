/**
 * Neutral vault service surface shared by the CLI shell and headless assistant consumers.
 */
import {
  healthCoreServiceMethodNames,
  healthQueryServiceMethodNames,
} from "./health-cli-descriptors.js"
import { createUnwiredMethod } from "./usecases/runtime.js"

import type {
  CoreWriteServices,
  ImporterServices,
  QueryServices,
  VaultServices,
} from "./usecases/types.js"

export type { CommandContext } from "./usecases/types.js"
export type {
  CoreWriteServices,
  ImporterServices,
  QueryServices,
  VaultServices,
} from "./usecases/types.js"

type AsyncServiceMethod = (...args: any[]) => Promise<unknown>
type AsyncMethodKeys<TServiceGroup> = {
  [TKey in keyof TServiceGroup]-?:
    TServiceGroup[TKey] extends AsyncServiceMethod ? TKey : never
}[keyof TServiceGroup] & string
type IntegratedVaultServiceDependencies = Record<string, unknown>

const coreServiceMethodNames = [
  "init",
  "validate",
  "repairVault",
  "repairExperimentMedia",
  "repairJunctionWorkoutHeartRateZones",
  "repairIntegrationIngests",
  "repairWearableStorage",
  "addMeal",
  "addCapture",
  "createExperiment",
  "planExperiment",
  "startExperiment",
  "upsertPrivateProtocol",
  "updateExperiment",
  "applyExperimentOnboarding",
  "checkpointExperiment",
  "checkpointExperimentJson",
  "stopExperiment",
  "logExperimentSession",
  "logExperimentSessionJson",
  "attachExperimentSession",
  "detachExperimentSession",
  "logExperimentContext",
  "logExperimentContextJson",
  "writeExperimentOutcome",
  "ensureJournal",
  "appendJournal",
  "linkJournalEvents",
  "unlinkJournalEvents",
  "linkJournalStreams",
  "unlinkJournalStreams",
  "scaffoldProvider",
  "upsertProvider",
  "scaffoldRecipe",
  "upsertRecipe",
  "scaffoldFood",
  "upsertFood",
  "renameFood",
  "editFood",
  "deleteFood",
  "addDailyFood",
  "unscheduleDailyFood",
  "scaffoldEvent",
  "upsertEvent",
  "addSamples",
  "updateVault",
  "projectAssessment",
  "scaffoldRegimen",
  "upsertRegimen",
  "saveRegimen",
  "saveSupplement",
  "stopRegimen",
  ...healthCoreServiceMethodNames,
] satisfies ReadonlyArray<keyof CoreWriteServices & string>

const importerServiceMethodNames = [
  "importDocument",
  "importSamplesCsv",
  "importAssessmentResponse",
] satisfies ReadonlyArray<keyof ImporterServices & string>

const queryServiceMethodNames = [
  "readMemoryDocument",
  "showRegimen",
  "listRegimens",
  "showPrivateProtocol",
  "listPrivateProtocols",
  "showSupplement",
  "listSupplements",
  "showSupplementCompound",
  "listSupplementCompounds",
  "showDocument",
  "listDocuments",
  "showDocumentManifest",
  "hasWorkoutHistoryForRawSource",
  "showProvider",
  "listProviders",
  "showRecipe",
  "listRecipes",
  "showFood",
  "listFoods",
  "showMealNutritionTotals",
  "showMealNutrientTotals",
  "showEvent",
  "listEvents",
  "showExperiment",
  "listExperiments",
  "listExperimentLifecycleFrontmatter",
  "showExperimentProgress",
  "showExperimentProgressCard",
  "showExperimentFollowupDue",
  "analyzeExperimentOutcome",
  "showJournal",
  "listJournals",
  "showVault",
  "showVaultStats",
  "show",
  "list",
  "showWearableDay",
  "showWearableLatest",
  "showWearableMetricLatest",
  "showWearableMetricTrend",
  "showWearableDrift",
  "showWearableSleepPattern",
  "showPersonalPatterns",
  "listWearableSleep",
  "listWearableActivity",
  "listWearableBodyState",
  "listWearableRecovery",
  "listWearableSources",
  "exportPack",
  ...healthQueryServiceMethodNames,
] satisfies ReadonlyArray<keyof QueryServices & string>

function createLoaderBackedMethod<
  TServiceGroup,
  TMethodName extends AsyncMethodKeys<TServiceGroup>,
>(
  methodName: TMethodName,
  loadGroup: () => Promise<TServiceGroup>,
): TServiceGroup[TMethodName] {
  type TMethod = Extract<TServiceGroup[TMethodName], AsyncServiceMethod>

  return (async (...args: Parameters<TMethod>) => {
    const group = await loadGroup()
    const method = group[methodName]
    return (method as TMethod)(...args)
  }) as TServiceGroup[TMethodName]
}

function createLoaderBackedServiceGroup<
  TServiceGroup,
  TMethodName extends AsyncMethodKeys<TServiceGroup>,
>(
  methodNames: readonly TMethodName[],
  loadGroup: () => Promise<TServiceGroup>,
): Pick<TServiceGroup, TMethodName> {
  const services = {} as Pick<TServiceGroup, TMethodName>

  for (const methodName of methodNames) {
    services[methodName] = createLoaderBackedMethod(methodName, loadGroup)
  }

  return services
}

function createUnwiredServiceGroup<
  TServiceGroup,
  TMethodName extends AsyncMethodKeys<TServiceGroup>,
>(
  groupName: string,
  methodNames: readonly TMethodName[],
): Pick<TServiceGroup, TMethodName> {
  const services = {} as Pick<TServiceGroup, TMethodName>

  for (const methodName of methodNames) {
    type TMethod = Extract<TServiceGroup[TMethodName], AsyncServiceMethod>
    services[methodName] = createUnwiredMethod<
      Parameters<TMethod>,
      Awaited<ReturnType<TMethod>>
    >(`${groupName}.${methodName}`) as TServiceGroup[TMethodName]
  }

  return services
}

function createIntegratedServicesLoader(): () => Promise<VaultServices> {
  let servicesPromise: Promise<VaultServices> | null = null

  return async () => {
    servicesPromise ??= import("./usecases/integrated-services.js")
      .then(({ createIntegratedVaultServices }) => createIntegratedVaultServices())
      .catch((error) => {
        servicesPromise = null
        throw error
      })

    return servicesPromise
  }
}

export function createIntegratedVaultServices(
  _dependencies: IntegratedVaultServiceDependencies = {},
): VaultServices {
  const loadServices = createIntegratedServicesLoader()

  return {
    core: createLoaderBackedServiceGroup<CoreWriteServices, keyof CoreWriteServices & string>(
      coreServiceMethodNames,
      async () => (await loadServices()).core,
    ),
    importers: createLoaderBackedServiceGroup<ImporterServices, keyof ImporterServices & string>(
      importerServiceMethodNames,
      async () => (await loadServices()).importers,
    ),
    query: createLoaderBackedServiceGroup<QueryServices, keyof QueryServices & string>(
      queryServiceMethodNames,
      async () => (await loadServices()).query,
    ),
  }
}

export function createUnwiredVaultServices(
  _dependencies: IntegratedVaultServiceDependencies = {},
): VaultServices {
  return {
    core: createUnwiredServiceGroup<CoreWriteServices, keyof CoreWriteServices & string>(
      "core",
      coreServiceMethodNames,
    ),
    importers: createUnwiredServiceGroup<ImporterServices, keyof ImporterServices & string>(
      "importers",
      importerServiceMethodNames,
    ),
    query: createUnwiredServiceGroup<QueryServices, keyof QueryServices & string>(
      "query",
      queryServiceMethodNames,
    ),
  }
}
