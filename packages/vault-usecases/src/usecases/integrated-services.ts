import {
  type ExperimentStatus,
  resolveSystemTimeZone,
  VAULT_LAYOUT,
} from "@murphai/contracts"
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors"
import { ALL_QUERY_ENTITY_FAMILIES } from "@murphai/query/entity-families"
import { readMemoryDocument as readMemoryDocumentSnapshot } from "@murphai/query"

import type {
  ListFilters,
} from "@murphai/operator-config/vault-cli-contracts"
import type {
  CommandContext,
  JsonObject,
} from "../health-cli-method-types.js"
import type { QueryEntityFamily } from "../query-runtime.js"
import type {
  CoreWriteServices,
  ImporterServices,
  IntegratedVaultServiceDependencies,
  ProjectAssessmentInput,
  QueryEntity,
  QueryServices,
  VaultServices,
} from "./types.js"
import {
  createExplicitHealthCoreServices,
  createExplicitHealthQueryServices,
} from "./explicit-health-family-services.js"
import {
  loadCoreRuntime,
  loadImporterRuntime,
  loadQueryRuntime,
} from "./runtime.js"
import {
  asEntityEnvelope,
  asListEnvelope,
  describeLookupConstraint,
  inferEntityKind,
  materializeExportPack,
  matchesGenericKindFilter,
  normalizeIssues,
  toGenericListItem,
  toGenericShowEntity,
} from "./shared.js"
import {
  normalizeRepeatableEnumFlagOption,
  normalizeRepeatableFlagOption,
} from "../option-utils.js"
import {
  listDocumentRecords as listDocumentsUseCase,
  showDocumentManifest as showDocumentImportManifestUseCase,
  showDocumentRecord as showDocumentUseCase,
} from "./document-meal-read.js"
import {
  addSampleRecordsFromInput,
  eventScaffoldKindSchema,
  listEventRecords,
  listProviderRecords,
  scaffoldEventPayload,
  scaffoldProviderPayload,
  showEventRecord,
  showProviderRecord,
  upsertEventRecordFromInput,
  upsertProviderRecordFromInput,
} from "./provider-event.js"
import {
  addDailyFoodRecord,
  deleteFoodRecord,
  editFoodRecord,
  listFoodRecords,
  renameFoodRecord,
  scaffoldFoodPayload,
  showFoodRecord,
  unscheduleDailyFoodRecord,
  upsertFoodRecordFromInput,
} from "./food.js"
import {
  listRecipeRecords,
  scaffoldRecipePayload,
  showRecipeRecord,
  upsertRecipeRecordFromInput,
} from "./recipe.js"

import {
  applyExperimentOnboardingRecord,
  analyzeExperimentOutcomeRecord,
  appendJournalText,
  attachExperimentSessionRecord,
  checkpointExperimentRecord,
  checkpointExperimentRecordFromInput,
  detachExperimentSessionRecord,
  logExperimentContextRecord,
  logExperimentContextRecordFromInput,
  logExperimentSessionRecord,
  logExperimentSessionRecordFromInput,
  listExperimentLifecycleFrontmatterRecords,
  listExperimentRecords,
  listJournalRecords,
  planExperimentRecord,
  showExperimentFollowupDue,
  showExperimentProgress,
  showExperimentProgressCard,
  showExperimentRecord,
  showJournalRecord,
  showVaultStats as showVaultStatsUseCase,
  showVaultSummary as showVaultSummaryUseCase,
  startExperimentFromPlanRecord,
  stopExperimentRecord,
  updateExperimentRecord,
  updateVaultSummary,
  writeExperimentOutcomeRecord,
  createExperimentRecord,
  ensureJournalRecord,
  linkJournalEventIds,
  linkJournalStreams,
  unlinkJournalEventIds,
  unlinkJournalStreams,
} from "./experiment-journal-vault.js"
import { addCaptureRecord } from "./capture.js"
import {
  toAssessmentProjectVaultCliError,
  toImporterInputFileVaultCliError,
  toVaultCliError,
  toVaultCliFilesystemError,
  toVaultInitializationCliError,
  toVaultMetadataCliError,
} from "./vault-usecase-helpers.js"
import {
  compactWearableDaySummary,
  compactWearableDriftSummary,
  compactWearableLatestSummary,
  compactWearableList,
  compactWearableMetricSummary,
} from "./wearable-command-output.js"

function genericShowFamily(id: string): QueryEntityFamily | null {
  const entityKind = inferEntityKind(id)
  if (entityKind === "document" || entityKind === "meal") {
    return "event"
  }

  return ALL_QUERY_ENTITY_FAMILIES.find((family) => family === entityKind) ?? null
}

function createIntegratedCoreServices(
  dependencies: IntegratedVaultServiceDependencies,
): CoreWriteServices {
  return {
    async init(input: CommandContext & {
      timezone?: string
    }) {
      const { vault } = input
      const core = await loadCoreRuntime()
      try {
        await core.initializeVault({
          vaultRoot: vault,
          timezone: input.timezone ?? resolveSystemTimeZone(),
        })
      } catch (error) {
        throw toVaultInitializationCliError(error)
      }
      return {
        vault,
        created: true,
        directories: [...core.REQUIRED_DIRECTORIES],
        files: [VAULT_LAYOUT.metadata, VAULT_LAYOUT.coreDocument],
      }
    },
    async validate(input: CommandContext) {
      const { vault } = input
      const core = await loadCoreRuntime()
      const result = await core.validateVault({ vaultRoot: vault })
      return {
        vault,
        valid: result.valid,
        issues: normalizeIssues(result.issues),
      }
    },
    async repairVault(input: CommandContext) {
      const { vault } = input
      const core = await loadCoreRuntime()
      let result: Awaited<ReturnType<typeof core.repairVault>>
      try {
        result = await core.repairVault({ vaultRoot: vault })
      } catch (error) {
        throw toVaultMetadataCliError(error)
      }
      return {
        vault,
        metadataFile: result.metadataFile,
        title: result.title,
        timezone: result.timezone,
        createdDirectories: result.createdDirectories,
        updated: result.updated,
        auditPath: result.auditPath,
      }
    },
    async repairExperimentMedia(input) {
      const { vault } = input
      const core = await loadCoreRuntime()
      return core.repairExperimentMedia({
        apply: input.apply,
        vaultRoot: vault,
      })
    },
    async repairJunctionWorkoutHeartRateZones(input) {
      const { vault } = input
      const core = await loadCoreRuntime()
      const result = await core.repairJunctionWorkoutHeartRateZones({
        apply: input.apply,
        vaultRoot: vault,
      })

      return {
        mode: result.mode,
        hasWork: result.hasWork,
        mutated: result.mutated,
        scannedEventCount: result.scannedEventCount,
        candidateCount: result.candidateCount,
        unverifiedCandidateCount: result.unverifiedCandidateCount,
        repairedCount: result.repairedCount,
        touchedPathCount: result.touchedPaths.length,
        auditPath: result.auditPath,
      }
    },
    async repairIntegrationIngests(input) {
      const { vault } = input
      const core = await loadCoreRuntime()
      return core.runIntegrationIngestMigration({
        vaultRoot: vault,
        apply: input.apply,
        finalize: input.finalize,
        maxBundles: input.maxBundles,
        maxBytes: input.maxBytes,
      })
    },
    async repairWearableStorage(input) {
      const { vault } = input
      const core = await loadCoreRuntime()
      const detection = await core.detectWearableStorageMigrationCandidates({
        includeRecentDenseRaw: input.includeRecentDenseRaw,
        vaultRoot: vault,
      })

      if (!input.apply) {
        const hasSelectedWork =
          detection.legacyReceiptPayloadCount > 0
          || detection.legacyCanonicalArtifactCount > 0
          || (
            input.pruneDenseRaw === true
            && detection.retentionEligibleDenseProviderRawTimeseriesCount > 0
          )
        return {
          mode: "dry-run",
          hasWork: hasSelectedWork,
          suspectedBytes: detection.suspectedBytes,
          legacyReceiptPayloadCount: detection.legacyReceiptPayloadCount,
          legacyCanonicalArtifactCount: detection.legacyCanonicalArtifactCount,
          denseProviderSampleShardCount: detection.denseProviderSampleShardCount,
          denseProviderRawTimeseriesCount: detection.denseProviderRawTimeseriesCount,
          retentionEligibleDenseProviderRawTimeseriesBytes:
            detection.retentionEligibleDenseProviderRawTimeseriesBytes ?? 0,
          retentionEligibleDenseProviderRawTimeseriesCount:
            detection.retentionEligibleDenseProviderRawTimeseriesCount,
          mutated: false,
          hasMore: hasSelectedWork,
          bytesBefore: 0,
          bytesAfter: 0,
          bytesFreed: 0,
          compactedReceiptCount: 0,
          denseRawBytesAfter: 0,
          denseRawBytesBefore: 0,
          denseRawBytesFreed: 0,
          tombstonedCanonicalArtifactCount: 0,
          tombstonedDenseRawArtifactCount: 0,
          skippedCount: 0,
          touchedPathCount: 0,
        }
      }

      const result = await core.runWearableStorageMigrationPass({
        vaultRoot: vault,
        maxFiles: input.maxFiles,
        maxBytes: input.maxBytes,
        pruneDenseRaw: input.pruneDenseRaw,
        includeRecentDenseRaw: input.includeRecentDenseRaw,
      })

      return {
        mode: "apply",
        hasWork: result.mutated || result.hasMore,
        suspectedBytes: detection.suspectedBytes,
        legacyReceiptPayloadCount: detection.legacyReceiptPayloadCount,
        legacyCanonicalArtifactCount: detection.legacyCanonicalArtifactCount,
        denseProviderSampleShardCount: detection.denseProviderSampleShardCount,
        denseProviderRawTimeseriesCount: detection.denseProviderRawTimeseriesCount,
        retentionEligibleDenseProviderRawTimeseriesBytes:
          detection.retentionEligibleDenseProviderRawTimeseriesBytes ?? 0,
        retentionEligibleDenseProviderRawTimeseriesCount:
          detection.retentionEligibleDenseProviderRawTimeseriesCount,
        mutated: result.mutated,
        hasMore: result.hasMore,
        bytesBefore: result.bytesBefore,
        bytesAfter: result.bytesAfter,
        bytesFreed: result.bytesFreed,
        compactedReceiptCount: result.compactedReceiptCount,
        denseRawBytesAfter: result.denseRawBytesAfter ?? 0,
        denseRawBytesBefore: result.denseRawBytesBefore ?? 0,
        denseRawBytesFreed: result.denseRawBytesFreed ?? 0,
        tombstonedCanonicalArtifactCount: result.tombstonedCanonicalArtifactCount,
        tombstonedDenseRawArtifactCount: result.tombstonedDenseRawArtifactCount,
        skippedCount: result.skippedCount,
        touchedPathCount: result.touchedPaths.length,
      }
    },
    async addMeal(input: CommandContext & {
      name?: string
      photo?: string
      audio?: string
      note?: string
      occurredAt?: string
      source?: "manual" | "import" | "device" | "derived"
      ingredients?: string[]
      nutrition?: import('@murphai/contracts').MealNutrition
    }) {
      const { vault, photo, audio, name, note, occurredAt, source, ingredients, nutrition } = input
      const core = await loadCoreRuntime()
      const result = await core.addMeal({
        vaultRoot: vault,
        photoPath: photo,
        audioPath: audio,
        name,
        note,
        occurredAt,
        source,
        ingredients,
        nutrition,
      })

      return {
        vault,
        mealId: result.mealId,
        eventId: result.event.id,
        lookupId: result.mealId,
        occurredAt: result.event.occurredAt ?? null,
        photoPath: result.photo?.relativePath ?? null,
        audioPath: result.audio?.relativePath ?? null,
        manifestFile: result.manifestPath,
        name: result.event.title === "Meal" ? null : result.event.title ?? null,
        note: result.event.note ?? note ?? null,
        source: result.event.source ?? null,
        ingredients: result.event.ingredients ?? null,
        nutrition: result.event.nutrition ?? null,
      }
    },
    async addCapture(input: CommandContext & {
      media?: string[]
      mediaPaths?: string[]
      title?: string
      note?: string
      occurredAt?: string
      source?: "manual" | "import" | "device" | "derived"
      label?: string
      bodySite?: string
      collection?: string
      tags?: string[]
      relatedIds?: string[]
      externalRef?: JsonObject
      links?: unknown
      timeZone?: string
      inputFile?: string
      captures?: Array<{
        media?: string[]
        mediaPaths?: string[]
        title?: string
        note?: string
        occurredAt?: string
        source?: "manual" | "import" | "device" | "derived"
        label?: string
        bodySite?: string
        collection?: string
        tags?: string[]
        relatedIds?: string[]
        externalRef?: JsonObject
        links?: unknown
        timeZone?: string
      }>
    }) {
      return addCaptureRecord(input)
    },
    async createExperiment(input: CommandContext & {
      slug: string
      title?: string
      hypothesis?: string
      startedOn?: string
      status?: ExperimentStatus
    }) {
      return createExperimentRecord(input)
    },
    async planExperiment(input: CommandContext & {
      inputFile?: string
      payload?: JsonObject
    }) {
      return planExperimentRecord(input)
    },
    async startExperiment(input: CommandContext & {
      inputFile?: string
      payload?: JsonObject
    }) {
      return startExperimentFromPlanRecord(input)
    },
    async updateExperiment(input) {
      return updateExperimentRecord({
        ...input,
        tags: input.tags === undefined ? undefined : [...input.tags],
      })
    },
    async applyExperimentOnboarding(input) {
      return applyExperimentOnboardingRecord(input)
    },
    async checkpointExperiment(input) {
      return checkpointExperimentRecord(input)
    },
    async checkpointExperimentJson(input: CommandContext & {
      inputFile: string
    }) {
      return checkpointExperimentRecordFromInput(input)
    },
    async stopExperiment(input: CommandContext & {
      lookup: string
      occurredAt?: string
      note?: string
    }) {
      return stopExperimentRecord(input)
    },
    async logExperimentSession(input) {
      return logExperimentSessionRecord(input, dependencies)
    },
    async logExperimentSessionJson(input: CommandContext & {
      lookup: string
      inputFile: string
    }) {
      return logExperimentSessionRecordFromInput(input, dependencies)
    },
    async attachExperimentSession(input) {
      return attachExperimentSessionRecord(input)
    },
    async detachExperimentSession(input) {
      return detachExperimentSessionRecord(input)
    },
    async logExperimentContext(input) {
      return logExperimentContextRecord(input)
    },
    async logExperimentContextJson(input: CommandContext & {
      lookup: string
      inputFile: string
    }) {
      return logExperimentContextRecordFromInput(input)
    },
    async writeExperimentOutcome(input: CommandContext & {
      lookup: string
      asOf?: string
    }) {
      return writeExperimentOutcomeRecord(input)
    },
    async ensureJournal(input: CommandContext & {
      date: string
    }) {
      const result = await ensureJournalRecord(input)
      return {
        ...result,
        date: input.date,
      }
    },
    async appendJournal(input: CommandContext & {
      date: string
      text: string
    }) {
      return appendJournalText(input)
    },
    async linkJournalEvents(input: CommandContext & {
      date: string
      eventIds: string[]
    }) {
      return linkJournalEventIds(input)
    },
    async unlinkJournalEvents(input: CommandContext & {
      date: string
      eventIds: string[]
    }) {
      return unlinkJournalEventIds(input)
    },
    async linkJournalStreams(input: CommandContext & {
      date: string
      sampleStreams: string[]
    }) {
      return linkJournalStreams(input)
    },
    async unlinkJournalStreams(input: CommandContext & {
      date: string
      sampleStreams: string[]
    }) {
      return unlinkJournalStreams(input)
    },
    async scaffoldProvider(input: CommandContext) {
      return {
        vault: input.vault,
        noun: "provider" as const,
        payload: scaffoldProviderPayload(),
      }
    },
    async upsertProvider(input: CommandContext & {
      inputFile: string
    }) {
      return upsertProviderRecordFromInput(input)
    },
    async scaffoldRecipe(input: CommandContext) {
      return {
        vault: input.vault,
        noun: 'recipe' as const,
        payload: scaffoldRecipePayload(),
      }
    },
    async upsertRecipe(input: CommandContext & {
      inputFile: string
    }) {
      return upsertRecipeRecordFromInput(input)
    },
    async scaffoldFood(input: CommandContext) {
      return {
        vault: input.vault,
        noun: 'food' as const,
        payload: scaffoldFoodPayload(),
      }
    },
    async upsertFood(input: CommandContext & {
      inputFile: string
    }) {
      return upsertFoodRecordFromInput(input)
    },
    async renameFood(input: CommandContext & {
      lookup: string
      title: string
      slug?: string
    }) {
      return renameFoodRecord(input)
    },
    async editFood(input: CommandContext & {
      lookup: string
      inputFile?: string
      set?: string[]
      clear?: string[]
    }) {
      return editFoodRecord(input)
    },
    async deleteFood(input: CommandContext & {
      lookup: string
    }) {
      return deleteFoodRecord(input)
    },
    async addDailyFood(input: CommandContext & {
      title: string
      time: string
      note?: string
      slug?: string
    }) {
      return addDailyFoodRecord(input)
    },
    async unscheduleDailyFood(input: CommandContext & {
      lookup: string
    }) {
      return unscheduleDailyFoodRecord(input)
    },
    async scaffoldEvent(input: CommandContext & {
      kind: string
    }) {
      const kind = eventScaffoldKindSchema.parse(input.kind)
      return {
        vault: input.vault,
        noun: "event" as const,
        kind,
        payload: scaffoldEventPayload(kind),
      }
    },
    async upsertEvent(input: CommandContext & {
      inputFile: string
    }) {
      return upsertEventRecordFromInput(input)
    },
    async addSamples(input: CommandContext & {
      inputFile: string
    }) {
      return addSampleRecordsFromInput(input)
    },
    async updateVault(input: CommandContext & {
      title?: string
      timezone?: string
    }) {
      return updateVaultSummary(input)
    },
    async projectAssessment(input: ProjectAssessmentInput) {
      const { vault, assessmentId } = input
      const core = await loadCoreRuntime()
      try {
        const assessment = await core.readAssessmentResponse({
          vaultRoot: vault,
          assessmentId,
        })
        const proposal = await core.projectAssessmentResponse({
          assessmentResponse: assessment,
        })

        return {
          vault,
          assessmentId,
          proposal,
        }
      } catch (error) {
        throw toAssessmentProjectVaultCliError(error)
      }
    },
    ...createExplicitHealthCoreServices(async () => {
      const core = await loadCoreRuntime()
      return { core }
    }),
  } satisfies CoreWriteServices
}

function createIntegratedImporterServices(): ImporterServices {
  return {
    async importDocument(input) {
      const { vault, file, title, occurredAt, note, source, reuseExact } = input
      const importers = await loadImporterRuntime()
      let result: Awaited<ReturnType<typeof importers.importDocument>>
      try {
        result = await importers.importDocument({
          filePath: file,
          vaultRoot: vault,
          title,
          occurredAt,
          note,
          source,
          reuseExact,
        })
      } catch (error) {
        const inputFileError = toImporterInputFileVaultCliError(error, file)
        if (inputFileError !== error) {
          throw inputFileError
        }
        throw toVaultCliError(error, {
          DOCUMENT_EXACT_SOURCE_DELETED: { code: 'conflict' },
          RAW_MANIFEST_INVALID: { code: 'conflict' },
          RAW_REFERENCE_MISSING: { code: 'conflict' },
        })
      }

      return {
        vault,
        sourceFile: file,
        rawFile: result.raw.relativePath,
        manifestFile: result.manifestPath,
        documentId: result.documentId,
        eventId: result.event.id,
        lookupId: result.documentId,
        created: result.created,
      }
    },
    async importSamplesCsv(input) {
      const { vault, file, stream, tsColumn, valueColumn, unit } = input
      const importers = await loadImporterRuntime()
      const runtimeInput = {
        filePath: file,
        vaultRoot: vault,
        stream,
        tsColumn,
        valueColumn,
        unit,
      }
      const result = await importers.importCsvSamples(runtimeInput)

      return {
        vault,
        sourceFile: file,
        timeZone: result.timeZone,
        tsColumn: result.tsColumn,
        importedCount: result.importedCount,
        skippedCount: result.skippedCount,
        lookupIds: result.lookupIds,
        ledgerFiles: result.ledgerFiles,
        streams: result.imports.map((entry) => entry.stream),
        imports: result.imports.map((entry) => ({
          stream: entry.stream,
          unit: entry.unit,
          timeZone: entry.timeZone,
          tsColumn: entry.tsColumn,
          valueColumn: entry.valueColumn,
          importedCount: entry.importedCount,
          skippedCount: entry.skippedCount,
          skipReasons: entry.skipReasons,
          transformId: entry.transformId,
          manifestFile: entry.manifestPath,
          lookupIds: entry.lookupIds,
          ledgerFiles: entry.ledgerFiles,
        })),
        inferred: {
          timeZone: result.timeZone,
          tsColumn: result.tsColumn,
          metadataColumns: result.metadataColumns,
          imports: result.imports.map((entry) => ({
            stream: entry.stream,
            valueColumn: entry.valueColumn,
          })),
        },
      }
    },
    async importAssessmentResponse(input) {
      const { vault, file } = input
      const importers = await loadImporterRuntime()
      const result = await importers.importAssessmentResponse({
        filePath: file,
        vaultRoot: vault,
      })

      return {
        vault,
        sourceFile: file,
        rawFile: result.raw.relativePath,
        manifestFile: result.manifestPath,
        assessmentId: result.assessment.id,
        lookupId: result.assessment.id,
        ledgerFile: result.ledgerPath,
      }
    },
  } satisfies ImporterServices
}

function createIntegratedQueryServices(): QueryServices {
  return {
    ...createExplicitHealthQueryServices(async () => {
      const query = await loadQueryRuntime()
      return { query }
    }),
    async readMemoryDocument(input: CommandContext) {
      return {
        vault: input.vault,
        document: await readMemoryDocumentSnapshot(input.vault),
      }
    },
    async showDocument(input: CommandContext & {
      id: string
    }) {
      return showDocumentUseCase(input.vault, input.id)
    },
    async listDocuments(input: CommandContext & {
      from?: string
      limit?: number
      to?: string
    }) {
      return listDocumentsUseCase(input)
    },
    async resolveWorkoutImportStatusForRawSource(input: CommandContext & { rawRef: string }) {
      const core = await loadCoreRuntime()
      let status: Awaited<ReturnType<typeof core.resolveWorkoutSourceImportStatus>>
      try {
        status = await core.resolveWorkoutSourceImportStatus({
          vaultRoot: input.vault,
          rawRef: input.rawRef,
        })
      } catch (error) {
        throw toVaultCliError(error, {
          DOCUMENT_EXACT_SOURCE_DELETED: { code: 'conflict' },
          EVENT_BATCH_SOURCE_DOCUMENT_NOT_LIVE: { code: 'conflict' },
          EVENT_BATCH_SOURCE_RAW_REF_MISSING: { code: 'conflict' },
          RAW_MANIFEST_INVALID: { code: 'conflict' },
          RAW_REFERENCE_MISSING: { code: 'conflict' },
        })
      }
      return {
        vault: input.vault,
        rawRef: input.rawRef,
        status,
      }
    },
    async showDocumentManifest(input: CommandContext & {
      id: string
    }) {
      return showDocumentImportManifestUseCase(input.vault, input.id)
    },
    async showProvider(input: CommandContext & {
      lookup: string
    }) {
      return showProviderRecord(input.vault, input.lookup)
    },
    async listProviders(input: CommandContext & {
      status?: string
      limit: number
    }) {
      return listProviderRecords(input)
    },
    async showRecipe(input: CommandContext & {
      lookup: string
    }) {
      return showRecipeRecord(input.vault, input.lookup)
    },
    async listRecipes(input: CommandContext & {
      status?: string
      limit: number
    }) {
      return listRecipeRecords(input)
    },
    async showFood(input: CommandContext & {
      lookup: string
    }) {
      return showFoodRecord(input.vault, input.lookup)
    },
    async listFoods(input: CommandContext & {
      status?: string
      limit: number
    }) {
      return listFoodRecords(input)
    },
    async showMealNutritionTotals(input: CommandContext & {
      resolveGoals?: boolean
      from?: string
      to?: string
    }) {
      const query = await loadQueryRuntime()
      const result = await query.readMealNutritionTotals(input.vault, {
        resolveGoals: input.resolveGoals,
        from: input.from,
        to: input.to,
      })

      return {
        ...(result.goalContext ? { goalContext: result.goalContext } : {}),
        vault: input.vault,
        filters: {
          from: result.from,
          to: result.to,
        },
        mealCount: result.mealCount,
        totals: result.totals,
        days: result.days,
      }
    },
    async showMealNutrientTotals(input: CommandContext & {
      from?: string
      to?: string
    }) {
      const query = await loadQueryRuntime()
      const result = await query.readMealNutrientTotals(input.vault, {
        from: input.from,
        to: input.to,
      })

      return {
        vault: input.vault,
        filters: {
          from: result.from,
          to: result.to,
        },
        mealCount: result.mealCount,
        nutrients: result.nutrients,
        days: result.days,
      }
    },
    async showEvent(input: CommandContext & {
      eventId: string
    }) {
      return showEventRecord(input.vault, input.eventId)
    },
    async listEvents(input: CommandContext & {
      kind?: string
      from?: string
      to?: string
      tag?: string[]
      experiment?: string
      limit: number
    }) {
      return listEventRecords(input)
    },
    async showExperiment(input: CommandContext & {
      lookup: string
    }) {
      return showExperimentRecord(input.vault, input.lookup)
    },
    async listExperiments(input: CommandContext & {
      status?: ExperimentStatus
      limit: number
    }) {
      return listExperimentRecords(input)
    },
    async listExperimentLifecycleFrontmatter(input: CommandContext & {
      shouldYield?: (() => boolean) | null
    }) {
      return listExperimentLifecycleFrontmatterRecords({
        vault: input.vault,
        shouldYield: input.shouldYield ?? null,
      })
    },
    async showExperimentProgress(input: CommandContext & {
      lookup: string
      asOf?: string
    }) {
      return showExperimentProgress(input)
    },
    async showExperimentProgressCard(input: CommandContext & {
      lookup: string
      asOf?: string
      confounders?: ReadonlyArray<{ date: string; label: string }>
    }) {
      return showExperimentProgressCard(input)
    },
    async showExperimentFollowupDue(input: CommandContext & {
      lookup: string
      kind: 'missed-log' | 'weekly-digest'
      date?: string
    }) {
      return showExperimentFollowupDue(input)
    },
    async analyzeExperimentOutcome(input: CommandContext & {
      lookup: string
      asOf?: string
    }) {
      return analyzeExperimentOutcomeRecord(input)
    },
    async showJournal(input: CommandContext & {
      date: string
    }) {
      return showJournalRecord(input.vault, input.date)
    },
    async listJournals(input: CommandContext & {
      from?: string
      to?: string
      limit: number
    }) {
      return listJournalRecords(input)
    },
    async showVault(input: CommandContext) {
      return showVaultSummaryUseCase(input.vault)
    },
    async showVaultStats(input: CommandContext) {
      return showVaultStatsUseCase(input.vault)
    },
    async show(input: CommandContext & {
      id: string
    }) {
      const { vault, id } = input
      const constraint = describeLookupConstraint(id)

      if (constraint) {
        throw new VaultCliError("invalid_lookup_id", constraint, {
          id,
        })
      }

      const query = await loadQueryRuntime()
      const family = genericShowFamily(id)
      const entity = family
        ? await query.resolveCanonicalEntityInFamily(vault, family, id)
        : null

      if (!entity) {
        throw new VaultCliError("not_found", `No entity found for "${id}".`)
      }

      return {
        vault,
        entity: toGenericShowEntity(entity),
      }
    },
    async list(input: CommandContext & ListFilters) {
      const {
        vault,
        recordType,
        kind,
        status,
        stream,
        experiment,
        from,
        to,
        tag,
        limit,
      } = input
      const query = await loadQueryRuntime()
      const recordTypes =
        normalizeRepeatableEnumFlagOption(
          recordType,
          "record-type",
          ALL_QUERY_ENTITY_FAMILIES,
        ) ?? []
      const readModel = await query.readVault(vault)
      const streams = normalizeRepeatableFlagOption(stream, "stream") ?? []
      const tags = normalizeRepeatableFlagOption(tag, "tag") ?? []
      const items = query
        .listEntities(readModel, {
          families: recordTypes.length > 0 ? recordTypes : undefined,
          statuses: status ? [status] : undefined,
          streams: streams.length > 0 ? streams : undefined,
          experimentSlug: experiment,
          from,
          tags: tags.length > 0 ? tags : undefined,
          to,
        })
        .filter((entity: QueryEntity) => matchesGenericKindFilter(entity, kind))
        .slice(0, limit)
        .map(toGenericListItem)

      return asListEnvelope(vault, {
        recordType: recordTypes,
        kind,
        status,
        stream: streams,
        experiment,
        from,
        to,
        tag: tags,
        limit,
      }, items)
    },
    async showWearableDay(input: CommandContext & {
      date: string
      providers?: string[]
    }) {
      const normalized = normalizeWearableDayInput(input)
      const query = await loadQueryRuntime()
      const summary = await query.summarizeWearableDayRuntime(input.vault, normalized.date, {
        providers: normalizeWearableProviderQueryFilter(input.providers, normalized.filters.providers),
      })

      const compact = compactWearableDaySummary(summary)

      return {
        date: normalized.date,
        filters: normalized.filters,
        summary: compact.value,
        ...(compact.units ? { units: compact.units } : {}),
      }
    },
    async showWearableLatest(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
    }) {
      const normalized = normalizeWearableSurfaceInput(input)
      const query = await loadQueryRuntime()
      const summary = await query.summarizeWearableLatestRuntime(input.vault, normalized.queryFilters)

      const compact = compactWearableLatestSummary(summary)

      return {
        filters: normalized.filters,
        summary: compact.value,
        ...(compact.units ? { units: compact.units } : {}),
      }
    },
    async showWearableMetricLatest(input: CommandContext & {
      metric: string
      date?: string
      from?: string
      to?: string
      providers?: string[]
      windowDays?: number
    }) {
      const normalized = normalizeWearableMetricInput(input)
      const query = await loadQueryRuntime()
      const summary = await query.summarizeWearableMetricLatestRuntime(input.vault, normalized.metric, normalized.queryFilters)

      return {
        filters: normalized.filters,
        summary: compactWearableMetricSummary(summary),
      }
    },
    async showWearableMetricTrend(input: CommandContext & {
      metric: string
      date?: string
      from?: string
      to?: string
      providers?: string[]
      windowDays?: number
    }) {
      const normalized = normalizeWearableMetricInput(input)
      const query = await loadQueryRuntime()
      const summary = await query.summarizeWearableMetricTrendRuntime(input.vault, normalized.metric, normalized.queryFilters)

      return {
        filters: normalized.filters,
        summary: compactWearableMetricSummary(summary),
      }
    },
    async showWearableDrift(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      windowDays?: number
    }) {
      const normalized = normalizeWearableMetricInput({
        ...input,
        metric: "drift",
      })
      const query = await loadQueryRuntime()
      const summary = await query.explainWearableDriftRuntime(input.vault, normalized.queryFilters)

      return {
        filters: {
          date: normalized.filters.date,
          from: normalized.filters.from,
          to: normalized.filters.to,
          providers: normalized.filters.providers,
          windowDays: normalized.filters.windowDays,
        },
        summary: compactWearableDriftSummary(summary),
      }
    },
    async showWearableSleepPattern(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      timeZone?: string
      windowDays?: number
    }) {
      const normalized = normalizeWearableSleepPatternInput(input)
      const query = await loadQueryRuntime()
      const summary = await query.summarizeWearableSleepPatternRuntime(
        input.vault,
        normalized.queryFilters,
      )

      return {
        filters: normalized.filters,
        summary,
      }
    },
    async listWearableSleep(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit?: number
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableSleepRuntime(input.vault, normalized.queryFilters)
      return wearableListResult(normalized.filters, rawItems)
    },
    async listWearableActivity(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit?: number
      includeWorkoutDetails?: boolean
      includeWorkoutSummaries?: boolean
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableActivityRuntime(
        input.vault,
        normalized.queryFilters,
      )
      return wearableListResult(normalized.filters, rawItems, (item) => {
        if (input.includeWorkoutDetails) {
          return item
        }
        const summary: Record<string, unknown> = { ...item }
        if (input.includeWorkoutSummaries) {
          summary.workoutFeatures = item.workoutFeatures.map(({ splits: _splits, ...workout }) => ({
            ...workout,
            splitsOmitted: true,
          }))
        } else {
          delete summary.workoutFeatures
        }
        return summary
      })
    },
    async listWearableBodyState(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit?: number
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableBodyStateRuntime(input.vault, normalized.queryFilters)
      return wearableListResult(normalized.filters, rawItems)
    },
    async listWearableRecovery(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit?: number
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableRecoveryRuntime(input.vault, normalized.queryFilters)
      return wearableListResult(normalized.filters, rawItems)
    },
    async listWearableSources(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit?: number
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableSourceHealthRuntime(input.vault, normalized.queryFilters)
      return wearableListResult(normalized.filters, rawItems)
    },
    async exportPack(input: CommandContext & {
      from: string
      to: string
      experiment?: string
      out?: string
    }) {
      const { vault, from, to, experiment, out } = input
      const query = await loadQueryRuntime()
      const [readModel, audits] = await Promise.all([
        query.readVaultTolerant(vault),
        query.readCanonicalEntityFamilySource(vault, 'audit'),
      ])
      readModel.entities = [...readModel.entities, ...audits].sort(
        query.compareCanonicalEntities,
      )
      const pack = query.buildExportPack(readModel, {
        from,
        to,
        experimentSlug: experiment,
      })

      try {
        await materializeExportPack(vault, pack.files)
      } catch (error) {
        throw toVaultCliFilesystemError(error, {
          message: 'The export pack could not be stored in the vault.',
          fieldPath: 'vault',
        })
      }

      if (out) {
        try {
          await materializeExportPack(out, pack.files)
        } catch (error) {
          throw toVaultCliFilesystemError(error, {
            message: 'The export pack could not be written to the output directory.',
            fieldPath: 'out',
          })
        }
      }

      return {
        vault,
        from,
        to,
        experiment: experiment ?? null,
        outDir: out ?? null,
        packId: pack.packId,
        files: pack.files.map((file: { path: string }) => file.path),
      }
    },
  } satisfies QueryServices
}

// Lists are newest first. The query returns every summary in the requested
// range, so a cut page says how many matching summaries it left out.
function wearableListResult<TFilters extends { limit: number }, TItem>(
  filters: TFilters,
  rawItems: readonly TItem[],
  projectItem: (item: TItem) => unknown = (item) => item,
) {
  const page = rawItems.slice(0, filters.limit)
  const list = compactWearableList(page.map(projectItem))
  const remaining = rawItems.length - page.length

  return {
    filters,
    ...list,
    count: list.items.length,
    ...(remaining > 0 ? { truncated: true as const, remaining } : {}),
  }
}

function normalizeWearableDayInput(input: {
  date: string
  providers?: string[]
}): {
  date: string
  filters: {
    providers: string[]
  }
} {
  const date = input.date.trim()
  const providers = normalizeWearableProviders(input.providers)

  return {
    date,
    filters: {
      providers,
    },
  }
}

function normalizeWearableSurfaceInput(input: {
  date?: string
  from?: string
  to?: string
  providers?: string[]
}): {
  filters: {
    date: string | null
    from: string | null
    to: string | null
    providers: string[]
  }
  queryFilters: {
    date?: string
    from?: string
    to?: string
    providers?: string[]
  }
} {
  const date = typeof input.date === 'string' && input.date.trim() ? input.date.trim() : undefined
  const providers = normalizeWearableProviders(input.providers)
  const from = date ? undefined : normalizeOptionalString(input.from)
  const to = date ? undefined : normalizeOptionalString(input.to)

  return {
    filters: {
      date: date ?? null,
      from: date ?? from ?? null,
      to: date ?? to ?? null,
      providers,
    },
    queryFilters: {
      date,
      from,
      to,
      providers: normalizeWearableProviderQueryFilter(input.providers, providers),
    },
  }
}

function normalizeWearableMetricInput(input: {
  metric: string
  date?: string
  from?: string
  to?: string
  providers?: string[]
  windowDays?: number
}): {
  filters: {
    date: string | null
    from: string | null
    to: string | null
    providers: string[]
    metric: string
    windowDays: number
  }
  metric: string
  queryFilters: {
    date?: string
    from?: string
    to?: string
    providers?: string[]
    windowDays: number
  }
} {
  const normalized = normalizeWearableSurfaceInput(input)
  const metric = input.metric.trim()
  const windowDays = normalizeWearableWindowDays(input.windowDays)

  return {
    filters: {
      ...normalized.filters,
      metric,
      windowDays,
    },
    metric,
    queryFilters: {
      ...normalized.queryFilters,
      windowDays,
    },
  }
}

function normalizeWearableSleepPatternInput(input: {
  date?: string
  from?: string
  to?: string
  providers?: string[]
  timeZone?: string
  windowDays?: number
}): {
  filters: {
    date: string | null
    from: string | null
    to: string | null
    providers: string[]
    timeZone: string | null
    windowDays: number
  }
  queryFilters: {
    date?: string
    from?: string
    to?: string
    providers?: string[]
    timeZone?: string
    windowDays: number
  }
} {
  const normalized = normalizeWearableSurfaceInput(input)
  const timeZone = normalizeOptionalString(input.timeZone)
  const windowDays = normalizeWearableSleepPatternWindowDays(input.windowDays)

  return {
    filters: {
      ...normalized.filters,
      timeZone: timeZone ?? null,
      windowDays,
    },
    queryFilters: {
      ...normalized.queryFilters,
      timeZone,
      windowDays,
    },
  }
}

// Without --limit, a date range returns every day in it up to this cap
// (two weeks of the richest summaries stays inside the agent-visible output
// budget) and an open read returns the newest few.
const WEARABLE_LIST_RANGE_DEFAULT_LIMIT = 14
const WEARABLE_LIST_RECENT_DEFAULT_LIMIT = 3

function normalizeWearableSummaryInput(input: {
  date?: string
  from?: string
  to?: string
  providers?: string[]
  limit?: number
}): {
  filters: {
    date: string | null
    from: string | null
    to: string | null
    providers: string[]
    limit: number
  }
  queryFilters: {
    from?: string
    to?: string
    providers?: string[]
  }
} {
  const normalized = normalizeWearableSurfaceInput(input)
  const hasDateFilter = normalized.filters.from !== null || normalized.filters.to !== null
  const limit = input.limit === undefined
    ? hasDateFilter ? WEARABLE_LIST_RANGE_DEFAULT_LIMIT : WEARABLE_LIST_RECENT_DEFAULT_LIMIT
    : normalizeWearableLimit(input.limit)

  return {
    filters: {
      ...normalized.filters,
      limit,
    },
    queryFilters: {
      ...(normalized.queryFilters.date
        ? {
            from: normalized.queryFilters.date,
            to: normalized.queryFilters.date,
          }
        : {
            from: normalized.queryFilters.from,
            to: normalized.queryFilters.to,
          }),
      providers: normalized.queryFilters.providers,
    },
  }
}

function normalizeWearableProviders(providers: readonly string[] | undefined): string[] {
  return [...new Set(
    (providers ?? [])
      .map((provider) => provider.trim())
      .filter((provider) => provider.length > 0),
  )]
}

function normalizeWearableProviderQueryFilter(
  inputProviders: readonly string[] | undefined,
  normalizedProviders: readonly string[],
): string[] | undefined {
  if (inputProviders === undefined || inputProviders.length === 0) {
    return undefined
  }

  return [...normalizedProviders]
}

function normalizeWearableLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    return 5
  }

  return Math.min(limit, 200)
}

function normalizeWearableWindowDays(windowDays: number | undefined): number {
  if (!Number.isInteger(windowDays) || (windowDays ?? 0) <= 0) {
    return 7
  }

  return Math.min(windowDays ?? 7, 30)
}

function normalizeWearableSleepPatternWindowDays(windowDays: number | undefined): number {
  if (!Number.isInteger(windowDays) || (windowDays ?? 0) <= 0) {
    return 28
  }

  return Math.min(windowDays ?? 28, 366)
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function createIntegratedVaultServices(
  dependencies: IntegratedVaultServiceDependencies = {},
): VaultServices {
  return {
    core: createIntegratedCoreServices(dependencies),
    importers: createIntegratedImporterServices(),
    query: createIntegratedQueryServices(),
  }
}
