import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  DocumentImportResult,
  ExperimentCreateResult,
  ExportPackResult,
  JournalEnsureResult,
  ListFilters,
  ListResult,
  MealAddResult,
  ShowResult,
  VaultInitResult,
  VaultValidateResult,
  SamplesImportCsvResult,
} from "./vault-cli-contracts.js"
import { VaultCliError } from "./vault-cli-errors.js"
import { loadRuntimeModule } from "./runtime-import.js"

const RUNTIME_PACKAGES = Object.freeze([
  "@healthybob/core",
  "@healthybob/importers",
  "@healthybob/query",
  "incur",
])

export interface CommandContext {
  vault: string
  requestId: string | null
}

type JsonObject = Record<string, unknown>

interface JsonFileInput extends CommandContext {
  input: string
}

interface EntityLookupInput extends CommandContext {
  id: string
}

interface HealthListInput extends CommandContext {
  status?: string
  cursor?: string
  limit?: number
}

interface ProjectAssessmentInput extends CommandContext {
  assessmentId: string
}

interface StopRegimenInput extends CommandContext {
  regimenId: string
  stoppedOn?: string
}

interface HealthScaffoldResult<TNoun extends string> {
  vault: string
  noun: TNoun
  payload: JsonObject
}

interface HealthEntityEnvelope {
  vault: string
  entity: JsonObject
}

interface HealthListEnvelope {
  vault: string
  items: JsonObject[]
  count: number
}

interface AssessmentProjectionResult {
  vault: string
  assessmentId: string
  proposal: JsonObject
}

interface AssessmentImportResult {
  vault: string
  sourceFile: string
  rawFile: string
  manifestFile: string
  assessmentId: string
  lookupId: string
  ledgerFile?: string
}

interface ProfileSnapshotUpsertResult {
  vault: string
  snapshotId: string
  lookupId: string
  ledgerFile?: string
  currentProfilePath?: string
  created: boolean
  profile?: JsonObject
}

interface RebuildCurrentProfileResult {
  vault: string
  profilePath: string
  snapshotId: string | null
  updated: boolean
}

interface UpsertRecordResult {
  vault: string
  lookupId: string
  path?: string
  created: boolean
}

interface StopRegimenResult {
  vault: string
  regimenId: string
  lookupId: string
  stoppedOn: string | null
  status: string
}

interface UpsertHistoryEventResult {
  vault: string
  eventId: string
  lookupId: string
  ledgerFile: string
  created: true
}

export interface CoreWriteServices {
  init(input: CommandContext): Promise<VaultInitResult>
  validate(input: CommandContext): Promise<VaultValidateResult>
  addMeal(
    input: CommandContext & {
      photo: string
      audio?: string
      note?: string
      occurredAt?: string
    },
  ): Promise<MealAddResult>
  createExperiment(
    input: CommandContext & {
      slug: string
    },
  ): Promise<ExperimentCreateResult>
  ensureJournal(
    input: CommandContext & {
      date: string
    },
  ): Promise<JournalEnsureResult>
  projectAssessment(
    input: ProjectAssessmentInput,
  ): Promise<AssessmentProjectionResult>
  scaffoldProfileSnapshot(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'profile'>>
  upsertProfileSnapshot(
    input: JsonFileInput,
  ): Promise<ProfileSnapshotUpsertResult>
  rebuildCurrentProfile(
    input: CommandContext,
  ): Promise<RebuildCurrentProfileResult>
  scaffoldGoal(input: CommandContext): Promise<HealthScaffoldResult<'goal'>>
  upsertGoal(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { goalId: string }>
  scaffoldCondition(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'condition'>>
  upsertCondition(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { conditionId: string }>
  scaffoldAllergy(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'allergy'>>
  upsertAllergy(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { allergyId: string }>
  scaffoldRegimen(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'regimen'>>
  upsertRegimen(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { regimenId: string }>
  stopRegimen(input: StopRegimenInput): Promise<StopRegimenResult>
  scaffoldHistoryEvent(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'history'>>
  upsertHistoryEvent(
    input: JsonFileInput,
  ): Promise<UpsertHistoryEventResult>
  scaffoldFamilyMember(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'family'>>
  upsertFamilyMember(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { familyMemberId: string }>
  scaffoldGeneticVariant(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'genetics'>>
  upsertGeneticVariant(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { variantId: string }>
}

export interface ImporterServices {
  importDocument(
    input: CommandContext & {
      file: string
    },
  ): Promise<DocumentImportResult>
  importSamplesCsv(
    input: CommandContext & {
      file: string
      stream: string
      tsColumn: string
      valueColumn: string
      unit: string
    },
  ): Promise<SamplesImportCsvResult>
  importAssessmentResponse(
    input: CommandContext & {
      file: string
    },
  ): Promise<AssessmentImportResult>
}

export interface QueryServices {
  show(
    input: CommandContext & {
      id: string
    },
  ): Promise<ShowResult>
  list(
    input: CommandContext & ListFilters,
  ): Promise<ListResult>
  exportPack(
    input: CommandContext & {
      from: string
      to: string
      experiment?: string
      out?: string
    },
  ): Promise<ExportPackResult>
  showProfile(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  listProfileSnapshots(input: HealthListInput): Promise<HealthListEnvelope>
  showGoal(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  listGoals(input: HealthListInput): Promise<HealthListEnvelope>
  showCondition(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  listConditions(input: HealthListInput): Promise<HealthListEnvelope>
  showAllergy(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  listAllergies(input: HealthListInput): Promise<HealthListEnvelope>
  showRegimen(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  listRegimens(input: HealthListInput): Promise<HealthListEnvelope>
  showHistoryEvent(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  listHistoryEvents(input: HealthListInput): Promise<HealthListEnvelope>
  showFamilyMember(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  listFamilyMembers(input: HealthListInput): Promise<HealthListEnvelope>
  showGeneticVariant(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  listGeneticVariants(input: HealthListInput): Promise<HealthListEnvelope>
}

export interface VaultCliServices {
  core: CoreWriteServices
  importers: ImporterServices
  query: QueryServices
}

interface CoreRuntimeModule {
  REQUIRED_DIRECTORIES: readonly string[]
  initializeVault(input: {
    vaultRoot: string
  }): Promise<unknown>
  validateVault(input: {
    vaultRoot: string
  }): Promise<{
    valid: boolean
    issues?: Array<Record<string, unknown>>
  }>
  addMeal(input: {
    vaultRoot: string
    photoPath: string
    audioPath?: string
    note?: string
    occurredAt?: string
  }): Promise<{
    mealId: string
    event: {
      id: string
      occurredAt?: string | null
      note?: string | null
    }
    manifestPath: string
    photo: {
      relativePath: string
    }
    audio?: {
      relativePath: string
    } | null
  }>
  createExperiment(input: {
    vaultRoot: string
    slug: string
    title?: string
  }): Promise<{
    created?: boolean
    experiment: {
      id: string
      slug: string
      relativePath: string
    }
  }>
  ensureJournalDay(input: {
    vaultRoot: string
    date: string
  }): Promise<{
    relativePath: string
    created: boolean
  }>
  readAssessmentResponse(input: {
    vaultRoot: string
    assessmentId: string
  }): Promise<JsonObject>
  projectAssessmentResponse(input: {
    assessmentResponse: JsonObject
  }): Promise<JsonObject>
  appendProfileSnapshot(input: {
    vaultRoot: string
    recordedAt?: string | number | Date
    source?: string
    sourceAssessmentIds?: string[]
    sourceEventIds?: string[]
    profile: JsonObject
  }): Promise<{
    snapshot: {
      id: string
      profile: JsonObject
    }
    ledgerPath?: string
    currentProfile: {
      relativePath: string
    }
  }>
  rebuildCurrentProfile(input: {
    vaultRoot: string
  }): Promise<{
    relativePath: string
    snapshot?: {
      id: string
    } | null
    updated: boolean
  }>
  upsertGoal(input: { vaultRoot: string } & JsonObject): Promise<{
    record: JsonObject & { goalId: string }
    created: boolean
  }>
  upsertCondition(input: { vaultRoot: string } & JsonObject): Promise<{
    record: JsonObject & { conditionId: string }
    created: boolean
  }>
  upsertAllergy(input: { vaultRoot: string } & JsonObject): Promise<{
    record: JsonObject & { allergyId: string }
    created: boolean
  }>
  upsertRegimenItem(input: { vaultRoot: string } & JsonObject): Promise<{
    record: JsonObject & { regimenId: string }
    created: boolean
  }>
  stopRegimenItem(input: {
    vaultRoot: string
    regimenId: string
    stoppedOn?: string
  }): Promise<{
    record: {
      regimenId: string
      stoppedOn?: string | null
      status: string
    }
  }>
  appendHistoryEvent(input: { vaultRoot: string } & JsonObject): Promise<{
    record: {
      id: string
    }
    relativePath: string
  }>
  upsertFamilyMember(input: { vaultRoot: string } & JsonObject): Promise<{
    record: JsonObject & { familyMemberId: string }
    created: boolean
  }>
  upsertGeneticVariant(input: { vaultRoot: string } & JsonObject): Promise<{
    record: JsonObject & { variantId: string }
    created: boolean
  }>
}

interface ImportersRuntimeModule {
  createImporters(input?: {
    corePort?: CoreRuntimeModule
  }): {
    importDocument(input: {
      filePath: string
      vaultRoot: string
    }): Promise<{
      raw: {
        relativePath: string
      }
      manifestPath: string
      documentId: string
      event: {
        id: string
      }
    }>
    importCsvSamples(input: {
      filePath: string
      vaultRoot: string
      stream: string
      tsColumn: string
      valueColumn: string
      unit: string
    }): Promise<{
      count: number
      records: Array<{
        id: string
      }>
      transformId: string
      manifestPath: string
      shardPaths: string[]
    }>
    importAssessmentResponse(input: {
      filePath: string
      vaultRoot: string
    }): Promise<{
      assessment: {
        id: string
      }
      manifestPath: string
      raw: {
        relativePath: string
      }
      ledgerPath: string
    }>
  }
}

type ImportersRuntime = ReturnType<ImportersRuntimeModule["createImporters"]>

interface QueryRecord {
  id: string
  recordType: string
  sourcePath?: string | null
  occurredAt?: string | null
  kind?: string | null
  title?: string | null
  body?: string | null
  data: Record<string, unknown>
}

interface QueryRuntimeModule {
  readVault(vaultRoot: string): Promise<unknown>
  lookupRecordById(readModel: unknown, recordId: string): QueryRecord | null
  listRecords(
    readModel: unknown,
    filters?: Record<string, unknown>,
  ): QueryRecord[]
  buildExportPack(
    readModel: unknown,
    options?: Record<string, unknown>,
  ): {
    packId: string
    files: Array<{
      path: string
      contents: string
    }>
  }
  showAssessment(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listAssessments(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  showProfile(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listProfileSnapshots(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  showGoal(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listGoals(vaultRoot: string, options?: Record<string, unknown>): Promise<JsonObject[]>
  showCondition(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listConditions(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  showAllergy(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listAllergies(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  showRegimen(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listRegimens(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  showHistoryEvent(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listHistoryEvents(
    vaultRoot: string,
    options?: {
      kind?: string
      from?: string
      to?: string
      limit?: number
      status?: string
    },
  ): Promise<JsonObject[]>
  showFamilyMember(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listFamilyMembers(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  showGeneticVariant(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  listGeneticVariants(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
}

interface IntegratedRuntime {
  core: CoreRuntimeModule
  query: QueryRuntimeModule
}

let integratedRuntimePromise: Promise<IntegratedRuntime> | null = null

function createUnwiredMethod(name: string): () => Promise<never> {
  return async () => {
    throw new VaultCliError(
      "not_implemented",
      `CLI integration for ${name} is not wired yet.`,
    )
  }
}

function normalizeIssues(
  issues: Array<{
    code?: string
    path?: string
    message?: string
    severity?: string
  }> = [],
): VaultValidateResult["issues"] {
  return issues.map((issue) => ({
    code: String(issue.code ?? "validation_issue"),
    path: String(issue.path ?? "vault.json"),
    message: String(issue.message ?? "Validation issue."),
    severity:
      issue.severity === "warning" || issue.severity === "error"
        ? issue.severity
        : "error",
  }))
}

function inferEntityKind(id: string) {
  if (id === "core") {
    return "core"
  }

  if (id.startsWith("asmt_")) {
    return "assessment"
  }

  if (id.startsWith("psnap_")) {
    return "profile"
  }

  if (id.startsWith("goal_")) {
    return "goal"
  }

  if (id.startsWith("cond_")) {
    return "condition"
  }

  if (id.startsWith("alg_")) {
    return "allergy"
  }

  if (id.startsWith("reg_")) {
    return "regimen"
  }

  if (id.startsWith("fam_")) {
    return "family"
  }

  if (id.startsWith("var_")) {
    return "genetics"
  }

  if (id.startsWith("evt_")) {
    return "event"
  }

  if (id.startsWith("smp_")) {
    return "sample"
  }

  if (id.startsWith("aud_")) {
    return "audit"
  }

  if (id.startsWith("exp_")) {
    return "experiment"
  }

  if (id.startsWith("meal_")) {
    return "meal"
  }

  if (id.startsWith("doc_")) {
    return "document"
  }

  return "entity"
}

function isQueryableRecordId(id: string) {
  return (
    id === "core" ||
    id === "current" ||
    id.startsWith("asmt_") ||
    id.startsWith("psnap_") ||
    id.startsWith("goal_") ||
    id.startsWith("cond_") ||
    id.startsWith("alg_") ||
    id.startsWith("reg_") ||
    id.startsWith("fam_") ||
    id.startsWith("var_") ||
    id.startsWith("aud_") ||
    id.startsWith("evt_") ||
    id.startsWith("exp_") ||
    id.startsWith("smp_") ||
    id.startsWith("audit:") ||
    id.startsWith("event:") ||
    id.startsWith("experiment:") ||
    id.startsWith("journal:") ||
    id.startsWith("sample:")
  )
}

function describeLookupConstraint(id: string) {
  if (id.startsWith("meal_")) {
    return "Meal ids are stable related ids, not query-layer record ids. Use the returned lookupId/eventId with `show` instead."
  }

  if (id.startsWith("doc_")) {
    return "Document ids are stable related ids, not query-layer record ids. Use the returned lookupId/eventId with `show` instead."
  }

  if (id.startsWith("xfm_")) {
    return "Transform ids identify an import batch, not a query-layer record. Use the returned lookupIds or `list --kind sample` instead."
  }

  if (id.startsWith("pack_")) {
    return "Export pack ids identify derived exports, not canonical vault records. Inspect the materialized pack files instead of passing the pack id to `show`."
  }

  return null
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJsonPayload(filePath: string): Promise<JsonObject> {
  const raw = await readFile(filePath, "utf8")
  const parsed = JSON.parse(raw) as unknown

  if (!isPlainObject(parsed)) {
    throw new VaultCliError("invalid_payload", "Payload file must contain a JSON object.")
  }

  return parsed
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)

  return items.length > 0 ? items : undefined
}

function asEntityEnvelope<TEntity extends JsonObject>(
  vault: string,
  entity: TEntity | null,
  notFoundMessage: string,
): HealthEntityEnvelope {
  if (!entity) {
    throw new VaultCliError("not_found", notFoundMessage)
  }

  return {
    vault,
    entity,
  }
}

function asListEnvelope<TEntity extends JsonObject>(
  vault: string,
  items: TEntity[],
): HealthListEnvelope {
  return {
    vault,
    items,
    count: items.length,
  }
}

function recordPath(record: JsonObject) {
  const relativePath = record.relativePath
  return typeof relativePath === "string" ? relativePath : undefined
}

function firstStringField(record: JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }

  return null
}

function toHealthListItem(record: JsonObject, fallbackKind: string) {
  return {
    id: String(record.id ?? ""),
    kind: firstStringField(record, ["kind"]) ?? fallbackKind,
    title: firstStringField(record, ["title", "summary"]) ?? null,
    occurredAt: firstStringField(record, ["occurredAt", "recordedAt", "updatedAt"]) ?? null,
    path: recordPath(record) ?? null,
  }
}

function toHealthShowEntity(record: JsonObject, fallbackKind: string) {
  return {
    id: String(record.id ?? ""),
    kind: firstStringField(record, ["kind"]) ?? fallbackKind,
    title: firstStringField(record, ["title", "summary"]) ?? null,
    occurredAt: firstStringField(record, ["occurredAt", "recordedAt", "updatedAt"]) ?? null,
    path: recordPath(record) ?? null,
    markdown: typeof record.markdown === "string" ? record.markdown : null,
    data: record,
    links: buildEntityLinks({ data: record }),
  }
}

function buildScaffoldPayload(noun: string) {
  switch (noun) {
    case "profile":
      return {
        source: "manual",
        profile: {
          domains: [],
          topGoalIds: [],
        },
      }
    case "goal":
      return {
        title: "Improve sleep quality and duration",
        status: "active",
        horizon: "long_term",
        priority: 1,
        window: {
          startAt: "2026-03-12",
          targetAt: "2026-06-01",
        },
        domains: ["sleep"],
      }
    case "condition":
      return {
        title: "Insomnia symptoms",
        clinicalStatus: "active",
        verificationStatus: "provisional",
        assertedOn: "2026-03-12",
      }
    case "allergy":
      return {
        title: "Penicillin intolerance",
        substance: "Penicillin",
        status: "active",
      }
    case "regimen":
      return {
        title: "Magnesium glycinate",
        kind: "supplement",
        status: "active",
        startedOn: "2026-03-12",
        group: "sleep",
      }
    case "history":
      return {
        kind: "encounter",
        occurredAt: "2026-03-12T09:00:00.000Z",
        title: "Primary care visit",
        encounterType: "office_visit",
        location: "Primary care clinic",
      }
    case "family":
      return {
        title: "Mother",
        relationship: "mother",
        conditions: ["hypertension"],
      }
    case "genetics":
      return {
        title: "MTHFR C677T",
        gene: "MTHFR",
        significance: "risk_factor",
      }
    default:
      throw new VaultCliError("invalid_payload", `No scaffold template is defined for ${noun}.`)
  }
}

function buildEntityLinks(record: {
  data: JsonObject
}) {
  const links: Array<{
    id: string
    kind: string
    queryable: boolean
  }> = []

  const relatedIds = Array.isArray(record.data.relatedIds)
    ? record.data.relatedIds
    : []
  for (const relatedId of relatedIds) {
    if (typeof relatedId === "string" && relatedId.trim()) {
      links.push({
        id: relatedId,
        kind: inferEntityKind(relatedId),
        queryable: isQueryableRecordId(relatedId),
      })
    }
  }

  const eventIds = Array.isArray(record.data.eventIds)
    ? record.data.eventIds
    : []
  for (const eventId of eventIds) {
    if (typeof eventId === "string" && eventId.trim()) {
      links.push({
        id: eventId,
        kind: "event",
        queryable: true,
      })
    }
  }

  return links
}

async function materializeExportPack(
  outDir: string,
  files: Array<{ path: string; contents: string }>,
) {
  for (const file of files) {
    const targetPath = path.join(outDir, file.path)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, file.contents, "utf8")
  }
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
      "appendProfileSnapshot",
      "rebuildCurrentProfile",
      "upsertGoal",
      "upsertCondition",
      "upsertAllergy",
      "upsertRegimenItem",
      "stopRegimenItem",
      "appendHistoryEvent",
      "upsertFamilyMember",
      "upsertGeneticVariant",
    ])
  )
}

function isQueryRuntimeModule(value: unknown): value is QueryRuntimeModule {
  return (
    isPlainObject(value) &&
    hasCallableMembers(value, [
      "readVault",
      "lookupRecordById",
      "listRecords",
      "buildExportPack",
      "showAssessment",
      "listAssessments",
      "showProfile",
      "listProfileSnapshots",
      "showGoal",
      "listGoals",
      "showCondition",
      "listConditions",
      "showAllergy",
      "listAllergies",
      "showRegimen",
      "listRegimens",
      "showHistoryEvent",
      "listHistoryEvents",
      "showFamilyMember",
      "listFamilyMembers",
      "showGeneticVariant",
      "listGeneticVariants",
    ])
  )
}

function isImportersRuntimeModule(value: unknown): value is ImportersRuntimeModule {
  return isPlainObject(value) && typeof value.createImporters === "function"
}

async function loadIntegratedRuntime(): Promise<IntegratedRuntime> {
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

async function loadImporterRuntime(): Promise<ImportersRuntime> {
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

function toJournalLookupId(date: string) {
  return `journal:${date}`
}

export function createIntegratedVaultCliServices(): VaultCliServices {
  const services: VaultCliServices = {
    core: {
      async init(input) {
        const { vault } = input
        const { core } = await loadIntegratedRuntime()
        await core.initializeVault({ vaultRoot: vault })
        return {
          vault,
          created: true,
          directories: [...core.REQUIRED_DIRECTORIES],
          files: ["vault.json", "CORE.md"],
        }
      },
      async validate(input) {
        const { vault } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.validateVault({ vaultRoot: vault })
        return {
          vault,
          valid: result.valid,
          issues: normalizeIssues(result.issues),
        }
      },
      async addMeal(input) {
        const { vault, photo, audio, note, occurredAt } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.addMeal({
          vaultRoot: vault,
          photoPath: photo,
          audioPath: audio,
          note,
          occurredAt,
        })

        return {
          vault,
          mealId: result.mealId,
          eventId: result.event.id,
          lookupId: result.event.id,
          occurredAt: result.event.occurredAt ?? null,
          photoPath: result.photo.relativePath,
          audioPath: result.audio?.relativePath ?? null,
          manifestFile: result.manifestPath,
          note: result.event.note ?? note ?? null,
        }
      },
      async createExperiment(input) {
        const { vault, slug } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.createExperiment({
          vaultRoot: vault,
          slug,
          title: slug,
        })

        return {
          vault,
          experimentId: result.experiment.id,
          lookupId: result.experiment.id,
          slug: result.experiment.slug,
          experimentPath: result.experiment.relativePath,
          created: result.created ?? true,
        }
      },
      async ensureJournal(input) {
        const { vault, date } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.ensureJournalDay({
          vaultRoot: vault,
          date,
        })

        return {
          vault,
          date,
          lookupId: toJournalLookupId(date),
          journalPath: result.relativePath,
          created: result.created,
        }
      },
      async projectAssessment(input) {
        const { vault, assessmentId } = input
        const { core } = await loadIntegratedRuntime()
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
      async scaffoldProfileSnapshot(input) {
        const { vault } = input
        return {
          vault,
          noun: "profile",
          payload: buildScaffoldPayload("profile"),
        }
      },
      async upsertProfileSnapshot(args) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const recordedAtValue = payload.recordedAt
        const sourceValue = payload.source
        const profileValue = payload.profile
        const result = await core.appendProfileSnapshot({
          vaultRoot: vault,
          recordedAt:
            typeof recordedAtValue === "string" ||
            typeof recordedAtValue === "number" ||
            recordedAtValue instanceof Date
              ? recordedAtValue
              : undefined,
          source: typeof sourceValue === "string" ? sourceValue : undefined,
          sourceAssessmentIds: optionalStringArray(payload.sourceAssessmentIds),
          sourceEventIds: optionalStringArray(payload.sourceEventIds),
          profile: isPlainObject(profileValue) ? profileValue : {},
        })

        return {
          vault,
          snapshotId: String(result.snapshot.id),
          lookupId: String(result.snapshot.id),
          ledgerFile: result.ledgerPath,
          currentProfilePath: result.currentProfile.relativePath,
          created: true,
          profile: result.snapshot.profile,
        }
      },
      async rebuildCurrentProfile(input) {
        const { vault } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.rebuildCurrentProfile({
          vaultRoot: vault,
        })

        return {
          vault,
          profilePath: result.relativePath,
          snapshotId: result.snapshot?.id ?? null,
          updated: result.updated,
        }
      },
      async scaffoldGoal(input) {
        const { vault } = input
        return {
          vault,
          noun: "goal",
          payload: buildScaffoldPayload("goal"),
        }
      },
      async upsertGoal(args) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertGoal({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          goalId: String(result.record.goalId),
          lookupId: String(result.record.goalId),
          path: recordPath(result.record),
          created: Boolean(result.created),
        }
      },
      async scaffoldCondition(input) {
        const { vault } = input
        return {
          vault,
          noun: "condition",
          payload: buildScaffoldPayload("condition"),
        }
      },
      async upsertCondition(args) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertCondition({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          conditionId: String(result.record.conditionId),
          lookupId: String(result.record.conditionId),
          path: recordPath(result.record),
          created: Boolean(result.created),
        }
      },
      async scaffoldAllergy(input) {
        const { vault } = input
        return {
          vault,
          noun: "allergy",
          payload: buildScaffoldPayload("allergy"),
        }
      },
      async upsertAllergy(args) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertAllergy({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          allergyId: String(result.record.allergyId),
          lookupId: String(result.record.allergyId),
          path: recordPath(result.record),
          created: Boolean(result.created),
        }
      },
      async scaffoldRegimen(input) {
        const { vault } = input
        return {
          vault,
          noun: "regimen",
          payload: buildScaffoldPayload("regimen"),
        }
      },
      async upsertRegimen(args) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertRegimenItem({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          regimenId: String(result.record.regimenId),
          lookupId: String(result.record.regimenId),
          path: recordPath(result.record),
          created: Boolean(result.created),
        }
      },
      async stopRegimen(input) {
        const { vault, regimenId, stoppedOn } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.stopRegimenItem({
          vaultRoot: vault,
          regimenId,
          stoppedOn,
        })

        return {
          vault,
          regimenId: String(result.record.regimenId),
          lookupId: String(result.record.regimenId),
          stoppedOn: result.record.stoppedOn ?? null,
          status: String(result.record.status),
        }
      },
      async scaffoldHistoryEvent(input) {
        const { vault } = input
        return {
          vault,
          noun: "history",
          payload: buildScaffoldPayload("history"),
        }
      },
      async upsertHistoryEvent(args) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.appendHistoryEvent({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          eventId: String(result.record.id),
          lookupId: String(result.record.id),
          ledgerFile: result.relativePath,
          created: true,
        }
      },
      async scaffoldFamilyMember(input) {
        const { vault } = input
        return {
          vault,
          noun: "family",
          payload: buildScaffoldPayload("family"),
        }
      },
      async upsertFamilyMember(args) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertFamilyMember({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          familyMemberId: String(result.record.familyMemberId),
          lookupId: String(result.record.familyMemberId),
          path: recordPath(result.record),
          created: Boolean(result.created),
        }
      },
      async scaffoldGeneticVariant(input) {
        const { vault } = input
        return {
          vault,
          noun: "genetics",
          payload: buildScaffoldPayload("genetics"),
        }
      },
      async upsertGeneticVariant(args) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertGeneticVariant({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          variantId: String(result.record.variantId),
          lookupId: String(result.record.variantId),
          path: recordPath(result.record),
          created: Boolean(result.created),
        }
      },
    },
    importers: {
      async importDocument(input) {
        const { vault, file } = input
        const importers = await loadImporterRuntime()
        const result = await importers.importDocument({
          filePath: file,
          vaultRoot: vault,
        })

        return {
          vault,
          sourceFile: file,
          rawFile: result.raw.relativePath,
          manifestFile: result.manifestPath,
          documentId: result.documentId,
          eventId: result.event.id,
          lookupId: result.event.id,
        }
      },
      async importSamplesCsv(input) {
        const { vault, file, stream, tsColumn, valueColumn, unit } = input
        const importers = await loadImporterRuntime()
        const result = await importers.importCsvSamples({
          filePath: file,
          vaultRoot: vault,
          stream,
          tsColumn,
          valueColumn,
          unit,
        })

        return {
          vault,
          sourceFile: file,
          stream,
          importedCount: result.count,
          transformId: result.transformId,
          manifestFile: result.manifestPath,
          lookupIds: result.records.map((record) => record.id),
          ledgerFiles: result.shardPaths,
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
    },
    query: {
      async show(input) {
        const { vault, id } = input
        const constraint = describeLookupConstraint(id)

        if (constraint) {
          throw new VaultCliError("invalid_lookup_id", constraint, {
            id,
          })
        }

        const { query } = await loadIntegratedRuntime()

        if (id === "current" || id.startsWith("psnap_")) {
          const entity = await query.showProfile(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No profile found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "profile") }
        }

        if (id.startsWith("asmt_")) {
          const entity = await query.showAssessment(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No assessment found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "assessment") }
        }

        if (id.startsWith("goal_")) {
          const entity = await query.showGoal(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No goal found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "goal") }
        }

        if (id.startsWith("cond_")) {
          const entity = await query.showCondition(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No condition found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "condition") }
        }

        if (id.startsWith("alg_")) {
          const entity = await query.showAllergy(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No allergy found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "allergy") }
        }

        if (id.startsWith("reg_")) {
          const entity = await query.showRegimen(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No regimen found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "regimen") }
        }

        if (id.startsWith("fam_")) {
          const entity = await query.showFamilyMember(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No family member found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "family") }
        }

        if (id.startsWith("var_")) {
          const entity = await query.showGeneticVariant(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No genetic variant found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "genetics") }
        }

        const readModel = await query.readVault(vault)
        const record = query.lookupRecordById(readModel, id)

        if (!record) {
          throw new VaultCliError("not_found", `No record found for "${id}".`)
        }

        return {
          vault,
          entity: {
            id: record.id,
            kind: record.kind ?? record.recordType,
            title: record.title ?? null,
            occurredAt: record.occurredAt ?? null,
            path: record.sourcePath ?? null,
            markdown: record.body ?? null,
            data: record.data,
            links: buildEntityLinks(record),
          },
        }
      },
      async list(input) {
        const { vault, kind, experiment, dateFrom, dateTo, cursor, limit } = input
        const { query } = await loadIntegratedRuntime()

        if (kind === "assessment") {
          const items = (await query.listAssessments(vault, { from: dateFrom, to: dateTo, limit }))
            .map((record) => toHealthListItem(record, "assessment"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "profile") {
          const items = (await query.listProfileSnapshots(vault, { from: dateFrom, to: dateTo, limit }))
            .map((record) => toHealthListItem(record, "profile"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "goal") {
          const items = (await query.listGoals(vault, { limit }))
            .map((record) => toHealthListItem(record, "goal"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "condition") {
          const items = (await query.listConditions(vault, { limit }))
            .map((record) => toHealthListItem(record, "condition"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "allergy") {
          const items = (await query.listAllergies(vault, { limit }))
            .map((record) => toHealthListItem(record, "allergy"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "regimen") {
          const items = (await query.listRegimens(vault, { limit }))
            .map((record) => toHealthListItem(record, "regimen"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "family") {
          const items = (await query.listFamilyMembers(vault, { limit }))
            .map((record) => toHealthListItem(record, "family"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "genetics") {
          const items = (await query.listGeneticVariants(vault, { limit }))
            .map((record) => toHealthListItem(record, "genetics"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind && ["encounter", "procedure", "test", "adverse_effect", "exposure"].includes(kind)) {
          const items = (await query.listHistoryEvents(vault, { kind, from: dateFrom, to: dateTo, limit }))
            .map((record) => toHealthListItem(record, "history"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        const readModel = await query.readVault(vault)
        const items = query
          .listRecords(readModel, {
          kinds: kind ? [kind] : undefined,
          experimentSlug: experiment,
          from: dateFrom,
          to: dateTo,
        })
          .slice(0, limit)
          .map((record) => ({
            id: record.id,
            kind: record.kind ?? record.recordType,
            title: record.title ?? null,
            occurredAt: record.occurredAt ?? null,
            path: record.sourcePath ?? null,
          }))

        return {
          vault,
          filters: {
            kind,
            experiment,
            dateFrom,
            dateTo,
            cursor,
            limit,
          },
          items,
          nextCursor: null,
        }
      },
      async exportPack(input) {
        const { vault, from, to, experiment, out } = input
        const { query } = await loadIntegratedRuntime()
        const readModel = await query.readVault(vault)
        const pack = query.buildExportPack(readModel, {
          from,
          to,
          experimentSlug: experiment,
        })

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
          files: pack.files.map((file) => file.path),
        }
      },
      async showProfile(input) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showProfile(vault, id), `No profile found for "${id}".`)
      },
      async listProfileSnapshots(input) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listProfileSnapshots(vault, { status, limit }))
      },
      async showGoal(input) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showGoal(vault, id), `No goal found for "${id}".`)
      },
      async listGoals(input) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listGoals(vault, { status, limit }))
      },
      async showCondition(input) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showCondition(vault, id), `No condition found for "${id}".`)
      },
      async listConditions(input) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listConditions(vault, { status, limit }))
      },
      async showAllergy(input) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showAllergy(vault, id), `No allergy found for "${id}".`)
      },
      async listAllergies(input) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listAllergies(vault, { status, limit }))
      },
      async showRegimen(input) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showRegimen(vault, id), `No regimen found for "${id}".`)
      },
      async listRegimens(input) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listRegimens(vault, { status, limit }))
      },
      async showHistoryEvent(input) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showHistoryEvent(vault, id), `No history event found for "${id}".`)
      },
      async listHistoryEvents(input) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listHistoryEvents(vault, { status, limit }))
      },
      async showFamilyMember(input) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showFamilyMember(vault, id), `No family member found for "${id}".`)
      },
      async listFamilyMembers(input) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listFamilyMembers(vault, { status, limit }))
      },
      async showGeneticVariant(input) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showGeneticVariant(vault, id), `No genetic variant found for "${id}".`)
      },
      async listGeneticVariants(input) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listGeneticVariants(vault, { status, limit }))
      },
    },
  }

  return services
}

export function createUnwiredVaultCliServices(): VaultCliServices {
  const services: VaultCliServices = {
    core: {
      init: createUnwiredMethod("core.init"),
      validate: createUnwiredMethod("core.validate"),
      addMeal: createUnwiredMethod("core.addMeal"),
      createExperiment: createUnwiredMethod("core.createExperiment"),
      ensureJournal: createUnwiredMethod("core.ensureJournal"),
      projectAssessment: createUnwiredMethod("core.projectAssessment"),
      scaffoldProfileSnapshot: createUnwiredMethod("core.scaffoldProfileSnapshot"),
      upsertProfileSnapshot: createUnwiredMethod("core.upsertProfileSnapshot"),
      rebuildCurrentProfile: createUnwiredMethod("core.rebuildCurrentProfile"),
      scaffoldGoal: createUnwiredMethod("core.scaffoldGoal"),
      upsertGoal: createUnwiredMethod("core.upsertGoal"),
      scaffoldCondition: createUnwiredMethod("core.scaffoldCondition"),
      upsertCondition: createUnwiredMethod("core.upsertCondition"),
      scaffoldAllergy: createUnwiredMethod("core.scaffoldAllergy"),
      upsertAllergy: createUnwiredMethod("core.upsertAllergy"),
      scaffoldRegimen: createUnwiredMethod("core.scaffoldRegimen"),
      upsertRegimen: createUnwiredMethod("core.upsertRegimen"),
      stopRegimen: createUnwiredMethod("core.stopRegimen"),
      scaffoldHistoryEvent: createUnwiredMethod("core.scaffoldHistoryEvent"),
      upsertHistoryEvent: createUnwiredMethod("core.upsertHistoryEvent"),
      scaffoldFamilyMember: createUnwiredMethod("core.scaffoldFamilyMember"),
      upsertFamilyMember: createUnwiredMethod("core.upsertFamilyMember"),
      scaffoldGeneticVariant: createUnwiredMethod("core.scaffoldGeneticVariant"),
      upsertGeneticVariant: createUnwiredMethod("core.upsertGeneticVariant"),
    },
    importers: {
      importDocument: createUnwiredMethod("importers.importDocument"),
      importSamplesCsv: createUnwiredMethod("importers.importSamplesCsv"),
      importAssessmentResponse: createUnwiredMethod("importers.importAssessmentResponse"),
    },
    query: {
      show: createUnwiredMethod("query.show"),
      list: createUnwiredMethod("query.list"),
      exportPack: createUnwiredMethod("query.exportPack"),
      showProfile: createUnwiredMethod("query.showProfile"),
      listProfileSnapshots: createUnwiredMethod("query.listProfileSnapshots"),
      showGoal: createUnwiredMethod("query.showGoal"),
      listGoals: createUnwiredMethod("query.listGoals"),
      showCondition: createUnwiredMethod("query.showCondition"),
      listConditions: createUnwiredMethod("query.listConditions"),
      showAllergy: createUnwiredMethod("query.showAllergy"),
      listAllergies: createUnwiredMethod("query.listAllergies"),
      showRegimen: createUnwiredMethod("query.showRegimen"),
      listRegimens: createUnwiredMethod("query.listRegimens"),
      showHistoryEvent: createUnwiredMethod("query.showHistoryEvent"),
      listHistoryEvents: createUnwiredMethod("query.listHistoryEvents"),
      showFamilyMember: createUnwiredMethod("query.showFamilyMember"),
      listFamilyMembers: createUnwiredMethod("query.listFamilyMembers"),
      showGeneticVariant: createUnwiredMethod("query.showGeneticVariant"),
      listGeneticVariants: createUnwiredMethod("query.listGeneticVariants"),
    },
  }

  return services
}
