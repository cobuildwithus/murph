import {
  type JsonValue,
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
import type {
  CoreWriteServices,
  ImporterServices,
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
  createUnwiredMethod,
  loadCoreRuntime,
  loadImporterRuntime,
  loadQueryRuntime,
} from "./runtime.js"
import {
  asEntityEnvelope,
  asListEnvelope,
  describeLookupConstraint,
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
import { toVaultCliError } from "./vault-usecase-helpers.js"

const PUBLIC_WEARABLE_PROVENANCE_KEYS = new Set([
  "candidateId",
  "candidates",
  "dataOrigin",
  "externalRef",
  "paths",
  "recordIds",
])

const OMIT_COMPACT_WEARABLE_VALUE = Symbol("omit compact wearable value")
const COMPACT_WEARABLE_ARRAY_LIMIT = 8
const COMPACT_WEARABLE_DRIFT_SIGNAL_LIMIT = 8
const COMPACT_WEARABLE_TREND_POINT_LIMIT = 14
const COMPACT_WEARABLE_STRING_LENGTH = 160

type CompactWearableValue = JsonValue | typeof OMIT_COMPACT_WEARABLE_VALUE

function compactWearableCommandSummary(value: unknown): JsonObject | null {
  const compact = compactWearableValue(value)

  if (!isJsonObjectRecord(compact)) {
    return null
  }

  return compact as JsonObject
}

function compactWearableCommandSummaryArray(value: readonly unknown[]): JsonObject[] {
  const compact = compactWearableValue(value)

  if (!Array.isArray(compact)) {
    return []
  }

  return compact.filter((entry): entry is JsonObject => isJsonObjectRecord(entry))
}

function limitedCompactWearableCommandSummaryArray(
  value: readonly unknown[],
  limit: number,
): JsonObject[] {
  return compactWearableCommandSummaryArray(value).slice(0, limit)
}

function compactWearableLatestCommandSummary(value: unknown): JsonObject | null {
  const compact = compactWearableCommandSummary(value)

  if (!isJsonObjectRecord(compact)) {
    return null
  }

  const latest = { ...compact }
  delete latest.activity
  delete latest.bodyState
  delete latest.recovery
  delete latest.sleep
  delete latest.sourceHealth
  return latest as JsonObject
}

function compactWearableDriftCommandSummary(value: unknown): JsonObject | null {
  const compact = compactWearableCommandSummary(value)

  if (!isJsonObjectRecord(compact)) {
    return null
  }

  const drift = { ...compact }
  const latest = compactWearableLatestCommandSummary(compact.latest)

  if (latest === null) {
    delete drift.latest
  } else {
    drift.latest = latest
  }

  return drift as JsonObject
}

function compactWearableValue(value: unknown): CompactWearableValue {
  if (Array.isArray(value)) {
    return value
      .map((entry) => compactWearableValue(entry))
      .filter((entry): entry is JsonValue => entry !== OMIT_COMPACT_WEARABLE_VALUE)
  }

  if (!isJsonObjectRecord(value)) {
    if (typeof value === "string") {
      const normalized = value.trim()
      if (normalized.length === 0) {
        return null
      }

      return normalized.length <= COMPACT_WEARABLE_STRING_LENGTH
        ? normalized
        : `${normalized.slice(0, COMPACT_WEARABLE_STRING_LENGTH - 3).trimEnd()}...`
    }

    return isJsonValue(value) ? value : null
  }

  if (isWearableResolvedMetricObject(value)) {
    return compactWearableResolvedMetric(value)
  }

  if (isWearableMetricConfidenceObject(value)) {
    return compactWearableMetricConfidence(value)
  }

  if (isWearableSummaryConfidenceObject(value)) {
    return compactWearableSummaryConfidence(value)
  }

  const redacted: Record<string, unknown> = {}

  for (const [key, child] of Object.entries(value)) {
    if (PUBLIC_WEARABLE_PROVENANCE_KEYS.has(key)) {
      continue
    }

    const compactChild = compactWearableValue(child)

    if (compactChild === OMIT_COMPACT_WEARABLE_VALUE || compactChild === null) {
      continue
    }

    if (Array.isArray(compactChild)) {
      if (
        compactChild.length === 0
        && key !== "providers"
        && key !== "signals"
        && key !== "points"
      ) {
        continue
      }

      redacted[key] = compactChild.slice(0, compactWearableArrayLimitForKey(key))
      continue
    }

    redacted[key] = compactChild
  }

  return redacted as JsonObject
}

function compactWearableResolvedMetric(metric: Record<string, unknown>): CompactWearableValue {
  const selection = metric.selection
  const confidence = metric.confidence

  if (!isJsonObjectRecord(selection) || !isJsonObjectRecord(confidence)) {
    return OMIT_COMPACT_WEARABLE_VALUE
  }

  const selectedValue = selection.value
  const confidenceLevel = typeof confidence.level === "string" ? confidence.level : "none"
  const conflictingProviders = Array.isArray(confidence.conflictingProviders)
    ? confidence.conflictingProviders.filter((provider): provider is string => typeof provider === "string" && provider.length > 0)
    : []
  const exactDuplicateCount = typeof confidence.exactDuplicateCount === "number"
    ? confidence.exactDuplicateCount
    : 0
  const candidateCount = typeof confidence.candidateCount === "number"
    ? confidence.candidateCount
    : 0

  if (
    selectedValue === null
    && confidenceLevel === "none"
    && conflictingProviders.length === 0
    && exactDuplicateCount === 0
  ) {
    return OMIT_COMPACT_WEARABLE_VALUE
  }

  const compact: JsonObject = {
    confidence: confidenceLevel,
    metric: typeof metric.metric === "string" ? metric.metric : "",
    value: typeof selectedValue === "number" ? selectedValue : null,
  }

  copyCompactStringField(selection, compact, "unit")
  copyCompactStringField(selection, compact, "provider")
  copyCompactStringField(selection, compact, "fallbackFromMetric")
  copyCompactStringField(selection, compact, "fallbackReason")

  if (candidateCount > 1) {
    compact.candidateCount = candidateCount
  }

  if (conflictingProviders.length > 0) {
    compact.conflictingProviders = conflictingProviders
  }

  if (exactDuplicateCount > 0) {
    compact.exactDuplicateCount = exactDuplicateCount
  }

  return compact
}

function compactWearableArrayLimitForKey(key: string): number {
  if (key === "signals") {
    return COMPACT_WEARABLE_DRIFT_SIGNAL_LIMIT
  }

  if (key === "points") {
    return COMPACT_WEARABLE_TREND_POINT_LIMIT
  }

  return COMPACT_WEARABLE_ARRAY_LIMIT
}

function compactWearableMetricConfidence(confidence: Record<string, unknown>): JsonObject {
  const compact: JsonObject = {
    level: typeof confidence.level === "string" ? confidence.level : "none",
  }
  const candidateCount = typeof confidence.candidateCount === "number" ? confidence.candidateCount : 0
  const conflictingProviders = Array.isArray(confidence.conflictingProviders)
    ? confidence.conflictingProviders.filter((provider): provider is string => typeof provider === "string" && provider.length > 0)
    : []
  const exactDuplicateCount = typeof confidence.exactDuplicateCount === "number" ? confidence.exactDuplicateCount : 0

  if (candidateCount > 1) {
    compact.candidateCount = candidateCount
  }

  if (conflictingProviders.length > 0) {
    compact.conflictingProviders = conflictingProviders
  }

  if (exactDuplicateCount > 0) {
    compact.exactDuplicateCount = exactDuplicateCount
  }

  return compact
}

function compactWearableSummaryConfidence(confidence: Record<string, unknown>): JsonObject {
  const compact: JsonObject = {
    level: typeof confidence.level === "string" ? confidence.level : "none",
  }

  copyCompactStringArrayField(confidence, compact, "selectedProviders")
  copyCompactStringArrayField(confidence, compact, "conflictingMetrics")
  copyCompactStringArrayField(confidence, compact, "lowConfidenceMetrics")
  copyCompactStringArrayField(confidence, compact, "notes")

  return compact
}

function copyCompactStringField(
  source: Record<string, unknown>,
  target: JsonObject,
  key: string,
): void {
  const value = source[key]

  if (typeof value === "string" && value.length > 0) {
    target[key] = value
  }
}

function copyCompactStringArrayField(
  source: Record<string, unknown>,
  target: JsonObject,
  key: string,
): void {
  const value = source[key]

  if (!Array.isArray(value)) {
    return
  }

  const strings = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)

  if (strings.length > 0) {
    target[key] = strings
  }
}

function isWearableResolvedMetricObject(value: Record<string, unknown>): boolean {
  return "metric" in value && "selection" in value && "confidence" in value
}

function isWearableMetricConfidenceObject(value: Record<string, unknown>): boolean {
  return "candidateCount" in value
    && "conflictingProviders" in value
    && "exactDuplicateCount" in value
    && "level" in value
    && "reasons" in value
}

function isWearableSummaryConfidenceObject(value: Record<string, unknown>): boolean {
  return "conflictingMetrics" in value
    && "lowConfidenceMetrics" in value
    && "selectedProviders" in value
    && "level" in value
    && "notes" in value
}

function isJsonValue(value: unknown): value is JsonValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

function isJsonObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function createIntegratedCoreServices(): CoreWriteServices {
  return {
    async init(input: CommandContext & {
      timezone?: string
    }) {
      const { vault } = input
      const core = await loadCoreRuntime()
      await core.initializeVault({
        vaultRoot: vault,
        timezone: input.timezone ?? resolveSystemTimeZone(),
      })
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
      const result = await core.repairVault({ vaultRoot: vault })
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
      photo?: string
      audio?: string
      note?: string
      occurredAt?: string
      source?: "manual" | "import" | "device" | "derived"
      ingredients?: string[]
      nutrition?: import('@murphai/contracts').MealNutrition
    }) {
      const { vault, photo, audio, note, occurredAt, source, ingredients, nutrition } = input
      const core = await loadCoreRuntime()
      const result = await core.addMeal({
        vaultRoot: vault,
        photoPath: photo,
        audioPath: audio,
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
      return logExperimentSessionRecord(input)
    },
    async logExperimentSessionJson(input: CommandContext & {
      lookup: string
      inputFile: string
    }) {
      return logExperimentSessionRecordFromInput(input)
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
        throw toVaultCliError(error, {
          DOCUMENT_EXACT_SOURCE_DELETED: { code: 'conflict' },
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
    async hasWorkoutHistoryForRawSource(input: CommandContext & { rawRef: string }) {
      const core = await loadCoreRuntime()
      return {
        vault: input.vault,
        rawRef: input.rawRef,
        imported: await core.hasEventKindReferencedRawRef({
          vaultRoot: input.vault,
          rawRef: input.rawRef,
          kind: 'activity_session',
        }),
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
      from?: string
      to?: string
    }) {
      const query = await loadQueryRuntime()
      const result = await query.readMealNutritionTotals(input.vault, {
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
        totals: result.totals,
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
      const readModel = await query.readVault(vault)
      const entity = query.lookupEntityById(readModel, id)

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

      return {
        date: normalized.date,
        filters: normalized.filters,
        summary: summary === null ? null : compactWearableCommandSummary(summary),
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

      return {
        filters: normalized.filters,
        summary: summary === null ? null : compactWearableLatestCommandSummary(summary),
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
        summary: summary === null ? null : compactWearableCommandSummary(summary),
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
        summary: summary === null ? null : compactWearableCommandSummary(summary),
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
        summary: summary === null ? null : compactWearableDriftCommandSummary(summary),
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
    async showPersonalPatterns(input: CommandContext & {
      date?: string
      windowDays?: number
    }) {
      const windowDays = input.windowDays ?? 120
      const query = await loadQueryRuntime()
      const report = await query.buildPersonalPatternReportRuntime(input.vault, {
        asOf: input.date,
        windowDays,
      })

      return {
        filters: {
          date: input.date ?? null,
          windowDays,
        },
        report,
      }
    },
    async listWearableSleep(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableSleepRuntime(input.vault, normalized.queryFilters)
      const items = limitedCompactWearableCommandSummaryArray(rawItems, normalized.filters.limit)

      return {
        filters: normalized.filters,
        items,
        count: items.length,
      }
    },
    async listWearableActivity(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableActivityRuntime(input.vault, normalized.queryFilters)
      const items = limitedCompactWearableCommandSummaryArray(rawItems, normalized.filters.limit)

      return {
        filters: normalized.filters,
        items,
        count: items.length,
      }
    },
    async listWearableBodyState(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableBodyStateRuntime(input.vault, normalized.queryFilters)
      const items = limitedCompactWearableCommandSummaryArray(rawItems, normalized.filters.limit)

      return {
        filters: normalized.filters,
        items,
        count: items.length,
      }
    },
    async listWearableRecovery(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableRecoveryRuntime(input.vault, normalized.queryFilters)
      const items = limitedCompactWearableCommandSummaryArray(rawItems, normalized.filters.limit)

      return {
        filters: normalized.filters,
        items,
        count: items.length,
      }
    },
    async listWearableSources(input: CommandContext & {
      date?: string
      from?: string
      to?: string
      providers?: string[]
      limit: number
    }) {
      const normalized = normalizeWearableSummaryInput(input)
      const query = await loadQueryRuntime()
      const rawItems = await query.summarizeWearableSourceHealthRuntime(input.vault, normalized.queryFilters)
      const items = limitedCompactWearableCommandSummaryArray(rawItems, normalized.filters.limit)

      return {
        filters: normalized.filters,
        items,
        count: items.length,
      }
    },
    async exportPack(input: CommandContext & {
      from: string
      to: string
      experiment?: string
      out?: string
    }) {
      const { vault, from, to, experiment, out } = input
      const query = await loadQueryRuntime()
      const readModel = await query.readVaultTolerant(vault)
      const pack = query.buildExportPack(readModel, {
        from,
        to,
        experimentSlug: experiment,
      })

      await materializeExportPack(vault, pack.files)

      if (out) {
        await materializeExportPack(out, pack.files)
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

function normalizeWearableSummaryInput(input: {
  date?: string
  from?: string
  to?: string
  providers?: string[]
  limit: number
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
    limit: number
  }
} {
  const normalized = normalizeWearableSurfaceInput(input)
  const limit = normalizeWearableLimit(input.limit)

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
      limit,
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

function createIntegratedVaultServiceGroups(): VaultServices {
  return {
    core: createIntegratedCoreServices(),
    importers: createIntegratedImporterServices(),
    query: createIntegratedQueryServices(),
  }
}

function createUnwiredServiceGroup<
  TServiceGroup extends object,
>(
  groupName: string,
  integratedServices: TServiceGroup,
): TServiceGroup {
  const unwiredServices = {} as {
    [TKey in keyof TServiceGroup]: TServiceGroup[TKey]
  }

  for (const methodName of Object.keys(integratedServices) as Array<keyof TServiceGroup & string>) {
    unwiredServices[methodName] = createUnwiredMethod(
      `${groupName}.${methodName}`,
    ) as TServiceGroup[typeof methodName]
  }

  return unwiredServices
}

export function createIntegratedVaultServices(
  _dependencies: Record<string, unknown> = {},
): VaultServices {
  return createIntegratedVaultServiceGroups()
}

export function createUnwiredVaultServices(
  _dependencies: Record<string, unknown> = {},
): VaultServices {
  const integratedServices = createIntegratedVaultServiceGroups()

  return {
    core: createUnwiredServiceGroup("core", integratedServices.core),
    importers: createUnwiredServiceGroup("importers", integratedServices.importers),
    query: createUnwiredServiceGroup("query", integratedServices.query),
  }
}
