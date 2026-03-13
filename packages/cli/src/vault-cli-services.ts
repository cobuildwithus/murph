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
import {
  type HealthCoreDescriptorEntry,
  type HealthQueryDescriptorEntry,
  findHealthDescriptorForListKind,
  findHealthDescriptorForLookup,
  hasHealthCoreDescriptor,
  hasHealthQueryDescriptor,
  healthCoreServiceMethodNames,
  healthCoreRuntimeMethodNames,
  healthEntityDescriptorByNoun,
  healthEntityDescriptors,
  healthQueryRuntimeMethodNames,
  healthQueryServiceMethodNames,
  inferHealthEntityKind,
  isHealthQueryableRecordId,
} from "./health-cli-descriptors.js"
import type {
  CommandContext,
  EntityLookupInput,
  HealthCoreRuntimeInput,
  HealthCoreRuntimeMethods,
  HealthCoreRuntimeResult,
  HealthCoreServiceMethods,
  HealthEntityEnvelope,
  HealthListEnvelope,
  HealthListInput,
  HealthQueryRuntimeListMethodName,
  HealthQueryRuntimeMethods,
  HealthQueryRuntimeShowMethodName,
  HealthQueryServiceMethods,
  HealthScaffoldResult,
  JsonFileInput,
  JsonObject,
  ProfileSnapshotRuntimeResult,
  ProfileSnapshotUpsertResult,
  UpsertHistoryEventResult,
  UpsertRecordResult,
} from "./health-cli-method-types.js"
import { loadRuntimeModule } from "./runtime-import.js"

export type { CommandContext } from "./health-cli-method-types.js"

const RUNTIME_PACKAGES = Object.freeze([
  "@healthybob/core",
  "@healthybob/importers",
  "@healthybob/query",
  "incur",
])

interface ProjectAssessmentInput extends CommandContext {
  assessmentId: string
}

interface StopRegimenInput extends CommandContext {
  regimenId: string
  stoppedOn?: string
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

interface RebuildCurrentProfileResult {
  vault: string
  profilePath: string
  snapshotId: string | null
  updated: boolean
}

interface StopRegimenResult {
  vault: string
  regimenId: string
  lookupId: string
  stoppedOn: string | null
  status: string
}

export interface CoreWriteServices extends HealthCoreServiceMethods {
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
  rebuildCurrentProfile(
    input: CommandContext,
  ): Promise<RebuildCurrentProfileResult>
  stopRegimen(input: StopRegimenInput): Promise<StopRegimenResult>
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

export interface QueryServices extends HealthQueryServiceMethods {
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
}

export interface VaultCliServices {
  core: CoreWriteServices
  importers: ImporterServices
  query: QueryServices
}

interface CoreRuntimeModule extends HealthCoreRuntimeMethods {
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
  rebuildCurrentProfile(input: {
    vaultRoot: string
  }): Promise<{
    relativePath: string
    snapshot?: {
      id: string
    } | null
    updated: boolean
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

interface QueryRuntimeModule extends HealthQueryRuntimeMethods {
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
  const healthKind = inferHealthEntityKind(id)
  if (healthKind) {
    return healthKind
  }

  if (id === "core") {
    return "core"
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
    isHealthQueryableRecordId(id) ||
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

const RESERVED_PAYLOAD_KEYS = new Set([
  'vault',
  'vaultRoot',
  'absolutePath',
  'relativePath',
  'path',
  'auditPath',
  'manifestPath',
  'ledgerPath',
  'lookupId',
  'created',
  'currentProfilePath',
])

async function readJsonPayload(filePath: string): Promise<JsonObject> {
  const raw = await readFile(filePath, "utf8")
  const parsed = JSON.parse(raw) as unknown

  if (!isPlainObject(parsed)) {
    throw new VaultCliError("invalid_payload", "Payload file must contain a JSON object.")
  }

  return parsed
}

function assertNoReservedPayloadKeys(payload: JsonObject) {
  const reservedKeys = Object.keys(payload).filter((key) => RESERVED_PAYLOAD_KEYS.has(key))

  if (reservedKeys.length > 0) {
    throw new VaultCliError(
      'invalid_payload',
      `Payload file may not set reserved field${reservedKeys.length === 1 ? '' : 's'}: ${reservedKeys.join(', ')}.`,
      {
        reservedKeys,
      },
    )
  }
}

function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new VaultCliError('invalid_payload', `${fieldName} must be an array of non-empty strings.`)
  }

  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))

  if (items.some((entry) => entry.length === 0)) {
    throw new VaultCliError('invalid_payload', `${fieldName} must be an array of non-empty strings.`)
  }

  return items.length > 0 ? items : undefined
}

function requirePayloadObjectField(payload: JsonObject, fieldName: string): JsonObject {
  const value = payload[fieldName]

  if (!isPlainObject(value)) {
    throw new VaultCliError(
      'invalid_payload',
      `Payload file must include a plain-object "${fieldName}" field.`,
    )
  }

  return value
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
    id: String(record.displayId ?? record.id ?? ""),
    kind: firstStringField(record, ["kind"]) ?? fallbackKind,
    title: firstStringField(record, ["title", "summary"]) ?? null,
    occurredAt: firstStringField(record, ["occurredAt", "recordedAt", "updatedAt"]) ?? null,
    path: recordPath(record) ?? null,
  }
}

function toHealthShowEntity(record: JsonObject, fallbackKind: string) {
  return {
    id: String(record.displayId ?? record.id ?? ""),
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
  const descriptor = healthEntityDescriptorByNoun.get(noun)
  if (!descriptor?.core) {
    throw new VaultCliError("invalid_payload", `No scaffold template is defined for ${noun}.`)
  }

  return descriptor.core.payloadTemplate
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

function buildHealthCoreRuntimeInput(
  descriptor: HealthCoreDescriptorEntry,
  vault: string,
  payload: JsonObject,
): HealthCoreRuntimeInput {
  assertNoReservedPayloadKeys(payload)

  if (descriptor.core.upsertMode === "profile-snapshot") {
    const recordedAtValue = payload.recordedAt
    const sourceValue = payload.source
    const profileValue = requirePayloadObjectField(payload, 'profile')

    return {
      vaultRoot: vault,
      recordedAt:
        typeof recordedAtValue === "string" ||
        typeof recordedAtValue === "number" ||
        recordedAtValue instanceof Date
          ? recordedAtValue
          : undefined,
      source: typeof sourceValue === "string" ? sourceValue : undefined,
      sourceAssessmentIds: optionalStringArray(payload.sourceAssessmentIds, 'sourceAssessmentIds'),
      sourceEventIds: optionalStringArray(payload.sourceEventIds, 'sourceEventIds'),
      profile: profileValue,
    }
  }

  return {
    ...payload,
    vaultRoot: vault,
  }
}

function buildHealthCoreUpsertResult(
  descriptor: HealthCoreDescriptorEntry,
  vault: string,
  result: HealthCoreRuntimeResult,
) {
  if (descriptor.core.resultMode === "profile-snapshot") {
    const profileResult = result as ProfileSnapshotRuntimeResult
    return {
      vault,
      snapshotId: String(profileResult.snapshot.id),
      lookupId: String(profileResult.snapshot.id),
      ledgerFile: profileResult.ledgerPath,
      currentProfilePath: profileResult.currentProfile.relativePath,
      created: true,
      profile: profileResult.snapshot.profile,
    }
  }

  if (descriptor.core.resultMode === "history-ledger") {
    const historyResult = result as Awaited<
      ReturnType<HealthCoreRuntimeMethods["appendHistoryEvent"]>
    >
    return {
      vault,
      eventId: String(historyResult.record.id),
      lookupId: String(historyResult.record.id),
      ledgerFile: historyResult.relativePath,
      created: true,
    }
  }

  const recordResult = result as {
    record: JsonObject
    created?: boolean
  }
  const identifier = String(recordResult.record[descriptor.core.resultIdField] ?? "")

  return {
    vault,
    [descriptor.core.resultIdField]: identifier,
    lookupId: identifier,
    path: recordPath(recordResult.record),
    created: Boolean(recordResult.created),
  }
}

function buildHealthServiceListOptions(
  descriptor: HealthQueryDescriptorEntry,
  input: HealthListInput,
) {
  if (descriptor.query.serviceListMode === "status-limit") {
    return {
      status: input.status,
      limit: input.limit,
    }
  }

  return {}
}

function buildHealthGenericListOptions(
  descriptor: HealthQueryDescriptorEntry,
  input: CommandContext & ListFilters,
) {
  switch (descriptor.query.genericListMode) {
    case "date-range-limit":
      return {
        from: input.dateFrom,
        to: input.dateTo,
        limit: input.limit,
      }
    case "history-kind-date-range-limit":
      return {
        kind: input.kind,
        from: input.dateFrom,
        to: input.dateTo,
        limit: input.limit,
      }
    case "limit-only":
      return {
        limit: input.limit,
      }
    default:
      return {}
  }
}

function getCoreRuntimeMethod(
  core: CoreRuntimeModule,
  descriptor: HealthCoreDescriptorEntry,
) {
  return core[descriptor.core.runtimeMethod] as (
    input: HealthCoreRuntimeInput,
  ) => Promise<HealthCoreRuntimeResult>
}

function getQueryShowMethod<TMethodName extends HealthQueryRuntimeShowMethodName>(
  query: QueryRuntimeModule,
  descriptor: HealthQueryDescriptorEntry & {
    query: HealthQueryDescriptorEntry["query"] & { runtimeShowMethod: TMethodName }
  },
): QueryRuntimeModule[TMethodName] {
  return query[descriptor.query.runtimeShowMethod]
}

function getQueryListMethod<TMethodName extends HealthQueryRuntimeListMethodName>(
  query: QueryRuntimeModule,
  descriptor: HealthQueryDescriptorEntry & {
    query: HealthQueryDescriptorEntry["query"] & { runtimeListMethod: TMethodName }
  },
): QueryRuntimeModule[TMethodName] {
  return query[descriptor.query.runtimeListMethod]
}

function createHealthCoreServices(): HealthCoreServiceMethods {
  const services: Record<string, unknown> = {}

  for (const descriptor of healthEntityDescriptors.filter(hasHealthCoreDescriptor)) {
    services[descriptor.core.scaffoldServiceMethod] = async (input: CommandContext) => ({
      vault: input.vault,
      noun: descriptor.core.scaffoldNoun,
      payload: buildScaffoldPayload(descriptor.noun),
    })

    services[descriptor.core.upsertServiceMethod] = async (args: JsonFileInput) => {
      const payload = await readJsonPayload(args.input)
      const runtimeInput = buildHealthCoreRuntimeInput(descriptor, args.vault, payload)
      const { core } = await loadIntegratedRuntime()
      const runtimeMethod = getCoreRuntimeMethod(core, descriptor)
      const result = await runtimeMethod(runtimeInput)

      return buildHealthCoreUpsertResult(descriptor, args.vault, result)
    }
  }

  return services as unknown as HealthCoreServiceMethods
}

function createHealthQueryServices(): HealthQueryServiceMethods {
  const services: Record<string, unknown> = {}

  for (const descriptor of healthEntityDescriptors.filter(hasHealthQueryDescriptor)) {
    services[descriptor.query.showServiceMethod] = async (input: EntityLookupInput) => {
      const { query } = await loadIntegratedRuntime()
      return asEntityEnvelope(
        input.vault,
        await getQueryShowMethod(query, descriptor)(input.vault, input.id),
        `No ${descriptor.query.notFoundLabel} found for "${input.id}".`,
      )
    }

    services[descriptor.query.listServiceMethod] = async (input: HealthListInput) => {
      const { query } = await loadIntegratedRuntime()
      return asListEnvelope(
        input.vault,
        await getQueryListMethod(query, descriptor)(
          input.vault,
          buildHealthServiceListOptions(descriptor, input),
        ),
      )
    }
  }

  return services as unknown as HealthQueryServiceMethods
}

async function materializeExportPack(
  outDir: string,
  files: Array<{ path: string; contents: string }>,
) {
  const absoluteOutDir = path.resolve(outDir)

  for (const file of files) {
    const relativePath = String(file.path ?? '').trim().replace(/\\/g, '/')

    if (
      relativePath.length === 0 ||
      path.posix.isAbsolute(relativePath) ||
      /^[A-Za-z]:/u.test(relativePath)
    ) {
      throw new VaultCliError('invalid_export_pack', `Export pack emitted an invalid file path "${file.path}".`)
    }

    const targetPath = path.resolve(absoluteOutDir, relativePath)
    const containment = path.relative(absoluteOutDir, targetPath)

    if (
      containment === '..' ||
      containment.startsWith(`..${path.sep}`) ||
      path.isAbsolute(containment)
    ) {
      throw new VaultCliError(
        'invalid_export_pack',
        `Export pack file path escaped the requested output directory: "${file.path}".`,
      )
    }

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
      "lookupRecordById",
      "listRecords",
      "buildExportPack",
      ...healthQueryRuntimeMethodNames,
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

function createIntegratedCoreServices(): CoreWriteServices {
  return {
    async init(input: CommandContext) {
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
    async validate(input: CommandContext) {
      const { vault } = input
      const { core } = await loadIntegratedRuntime()
      const result = await core.validateVault({ vaultRoot: vault })
      return {
        vault,
        valid: result.valid,
        issues: normalizeIssues(result.issues),
      }
    },
    async addMeal(input: CommandContext & {
      photo: string
      audio?: string
      note?: string
      occurredAt?: string
    }) {
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
    async createExperiment(input: CommandContext & {
      slug: string
    }) {
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
    async ensureJournal(input: CommandContext & {
      date: string
    }) {
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
    async projectAssessment(input: ProjectAssessmentInput) {
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
    ...createHealthCoreServices(),
    async rebuildCurrentProfile(input: CommandContext) {
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
    async stopRegimen(input: StopRegimenInput) {
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
  } satisfies CoreWriteServices
}

function createIntegratedImporterServices(): ImporterServices {
  return {
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
  } satisfies ImporterServices
}

function createIntegratedQueryServices(): QueryServices {
  return {
    ...createHealthQueryServices(),
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

      const { query } = await loadIntegratedRuntime()
      const descriptor = findHealthDescriptorForLookup(id)
      if (descriptor) {
        const entity = await getQueryShowMethod(query, descriptor)(vault, id)
        if (!entity) {
          throw new VaultCliError(
            "not_found",
            `No ${descriptor.query.notFoundLabel} found for "${id}".`,
          )
        }

        return {
          vault,
          entity: toHealthShowEntity(entity, descriptor.kind),
        }
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
    async list(input: CommandContext & ListFilters) {
      const { vault, kind, experiment, dateFrom, dateTo, limit } = input
      const { query } = await loadIntegratedRuntime()
      const descriptor = findHealthDescriptorForListKind(kind)
      if (descriptor) {
        const items = (
          await getQueryListMethod(query, descriptor)(
            vault,
            buildHealthGenericListOptions(descriptor, input),
          )
        ).map((record) => toHealthListItem(record, descriptor.kind))

        return {
          vault,
          filters: { kind, experiment, dateFrom, dateTo, limit },
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
          limit,
        },
        items,
        nextCursor: null,
      }
    },
    async exportPack(input: CommandContext & {
      from: string
      to: string
      experiment?: string
      out?: string
    }) {
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
  } satisfies QueryServices
}

export function createIntegratedVaultCliServices(): VaultCliServices {
  return {
    core: createIntegratedCoreServices(),
    importers: createIntegratedImporterServices(),
    query: createIntegratedQueryServices(),
  }
}

function createUnwiredHealthMethodSet<TMethods extends string>(
  names: readonly TMethods[],
  group: "core" | "query",
) {
  return Object.fromEntries(
    names.map((name) => [name, createUnwiredMethod(`${group}.${name}`)]),
  ) as Record<TMethods, () => Promise<never>>
}

export function createUnwiredVaultCliServices(): VaultCliServices {
  return {
    core: {
      init: createUnwiredMethod("core.init"),
      validate: createUnwiredMethod("core.validate"),
      addMeal: createUnwiredMethod("core.addMeal"),
      createExperiment: createUnwiredMethod("core.createExperiment"),
      ensureJournal: createUnwiredMethod("core.ensureJournal"),
      projectAssessment: createUnwiredMethod("core.projectAssessment"),
      ...createUnwiredHealthMethodSet(healthCoreServiceMethodNames, "core"),
      rebuildCurrentProfile: createUnwiredMethod("core.rebuildCurrentProfile"),
      stopRegimen: createUnwiredMethod("core.stopRegimen"),
    } satisfies CoreWriteServices,
    importers: {
      importDocument: createUnwiredMethod("importers.importDocument"),
      importSamplesCsv: createUnwiredMethod("importers.importSamplesCsv"),
      importAssessmentResponse: createUnwiredMethod("importers.importAssessmentResponse"),
    } satisfies ImporterServices,
    query: {
      show: createUnwiredMethod("query.show"),
      list: createUnwiredMethod("query.list"),
      exportPack: createUnwiredMethod("query.exportPack"),
      ...createUnwiredHealthMethodSet(healthQueryServiceMethodNames, "query"),
    } satisfies QueryServices,
  }
}
