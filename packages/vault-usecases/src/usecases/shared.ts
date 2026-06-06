import { randomBytes } from "node:crypto"
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_SPECIMEN_TYPES,
  VAULT_LAYOUT,
  healthEntityDefinitions,
  jsonObjectSchema,
  safeParseContract,
  type RawImportManifest,
  type JsonObject,
} from "@murphai/contracts"

import { VaultCliError } from "@murphai/operator-config/vault-cli-errors"
import {
  inferHealthEntityKind,
  isHealthQueryableRecordId,
} from "../health-cli-descriptors.js"
import { loadJsonInputObject } from "../json-input.js"
import { loadRuntimeModule } from "../runtime-import.js"
import { createRuntimeUnavailableError } from "../runtime-errors.js"
import {
  describeQueryLookupConstraint,
  inferQueryIdEntityKind,
  isQueryableQueryLookupId,
} from "../query-id-families.js"
import {
  applyRecordPatch,
  type JsonObject as RecordMutationJsonObject,
} from "./record-mutations.js"

import type {
  HealthEntityEnvelope,
} from "../health-cli-method-types.js"
import type {
  ListEntity,
  VaultValidateResult,
} from "@murphai/operator-config/vault-cli-contracts"
import type {
  QueryEntity,
} from "./types.js"

const DEFAULT_GENERIC_LIST_EXCLUDED_FAMILIES = new Set([
  "audit",
  "core",
])
const BLOOD_TEST_SPECIMEN_TYPE_SET = new Set<string>(BLOOD_TEST_SPECIMEN_TYPES)
const LEGACY_RAW_MANIFEST_BASENAME = "manifest.json"

interface SharedCoreRuntime {
  parseRawImportManifest(value: unknown): RawImportManifest
}

function isSharedCoreRuntime(value: unknown): value is SharedCoreRuntime {
  return (
    typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "parseRawImportManifest") === "function"
  )
}

async function loadSharedCoreRuntime(): Promise<SharedCoreRuntime> {
  const runtime = await loadRuntimeModule<unknown>("@murphai/core")
  if (!isSharedCoreRuntime(runtime)) {
    throw new TypeError("Core runtime package did not match the expected module shape.")
  }
  return runtime
}

function isBloodTestEntity(entity: QueryEntity) {
  if (
    entity.family !== "event" ||
    (entity.kind !== "test" && entity.kind !== "blood_test")
  ) {
    return false
  }

  const testCategory =
    typeof entity.attributes.testCategory === "string"
      ? entity.attributes.testCategory.trim().toLowerCase()
      : null
  const specimenType =
    typeof entity.attributes.specimenType === "string"
      ? entity.attributes.specimenType.trim().toLowerCase()
      : null

  return (
    testCategory === BLOOD_TEST_CATEGORY ||
    (specimenType !== null && BLOOD_TEST_SPECIMEN_TYPE_SET.has(specimenType))
  )
}

export function normalizeIssues(
  issues: Array<{
    code?: string
    path?: string
    message?: string
    severity?: string
  }> = [],
): VaultValidateResult["issues"] {
  return issues.map((issue) => ({
    code: String(issue.code ?? "validation_issue"),
    path: String(issue.path ?? VAULT_LAYOUT.metadata),
    message: String(issue.message ?? "Validation issue."),
    severity:
      issue.severity === "warning" || issue.severity === "error"
        ? issue.severity
        : "error",
  }))
}

export function inferEntityKind(id: string) {
  const healthKind = inferHealthEntityKind(id)
  if (healthKind) {
    return healthKind
  }

  if (isHealthQueryableRecordId(id)) {
    return "entity"
  }

  if (isProviderLookupId(id)) {
    return "provider"
  }

  return inferQueryIdEntityKind(id)
}

export function isQueryableRecordId(id: string) {
  return isHealthQueryableRecordId(id) || isQueryableQueryLookupId(id)
}

export function describeLookupConstraint(id: string) {
  if (isHealthQueryableRecordId(id) || isProviderLookupId(id)) {
    return null
  }

  return describeQueryLookupConstraint(id)
}

function isProviderLookupId(id: string) {
  return id.startsWith("prov_")
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stripUndefinedJsonFields(value: unknown): unknown {
  if (value === undefined) {
    return undefined
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedJsonFields(entry))
      .filter((entry) => entry !== undefined)
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, stripUndefinedJsonFields(entry)] as const)
        .filter(([, entry]) => entry !== undefined),
    )
  }

  return value
}

export function toKeyedRecord(value: object): JsonObject {
  const result = safeParseContract(
    jsonObjectSchema,
    stripUndefinedJsonFields(value),
  )
  if (!result.success) {
    throw new VaultCliError("contract_invalid", "Expected a JSON-compatible object.", {
      issues: result.errors,
    })
  }

  return result.data
}

export function firstRawString(
  record: object,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = Reflect.get(record, key)
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }

  return null
}

export function readRegistryRecordEntity(record: object): Record<string, unknown> {
  const entity = Reflect.get(record, "entity")
  return typeof entity === "object" && entity !== null && !Array.isArray(entity)
    ? toKeyedRecord(entity)
    : toKeyedRecord(record)
}

export function readRegistryRecordDocument(record: object): Record<string, unknown> {
  const document = Reflect.get(record, "document")
  return typeof document === "object" && document !== null && !Array.isArray(document)
    ? toKeyedRecord(document)
    : toKeyedRecord(record)
}

const RESERVED_PAYLOAD_KEYS = new Set([
  "vault",
  "vaultRoot",
  "absolutePath",
  "relativePath",
  "path",
  "auditPath",
  "manifestPath",
  "ledgerPath",
  "lookupId",
  "created",
])

export async function readJsonPayload(
  filePath: string,
  label = "payload",
): Promise<JsonObject> {
  return loadJsonInputFile(filePath, label)
}

export async function readRawImportManifest(
  vault: string,
  manifestFile: string,
): Promise<RawImportManifest> {
  const { resolveVaultRelativePath } = await import("./vault-usecase-helpers.js")
  const manifestPath = await resolveVaultRelativePath(vault, manifestFile)
  let manifestText: string

  try {
    manifestText = await readFile(manifestPath, "utf8")
  } catch (error) {
    throw new VaultCliError(
      "manifest_missing",
      `Manifest file "${manifestFile}" is missing from the vault.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  let manifest: unknown

  try {
    manifest = JSON.parse(manifestText)
  } catch (error) {
    throw new VaultCliError(
      "manifest_invalid",
      `Manifest file "${manifestFile}" is not valid JSON.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  if (!isPlainObject(manifest)) {
    throw new VaultCliError(
      "manifest_invalid",
      `Manifest file "${manifestFile}" must contain a JSON object.`,
    )
  }

  let parseRawImportManifest: SharedCoreRuntime["parseRawImportManifest"]
  try {
    ({ parseRawImportManifest } = await loadSharedCoreRuntime())
  } catch (error) {
    throw createRuntimeUnavailableError("raw import manifest reads", error)
  }

  try {
    return parseRawImportManifest(manifest)
  } catch (error) {
    throw new VaultCliError(
      "manifest_invalid",
      `Manifest file "${manifestFile}" does not match the raw import manifest contract.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

function isRawManifestFileName(fileName: string) {
  return (
    fileName === LEGACY_RAW_MANIFEST_BASENAME
    || (fileName.startsWith("manifest.") && fileName.endsWith(".json"))
  )
}

export async function resolveRawImportManifestFile(
  vault: string,
  rawDirectory: string,
): Promise<string> {
  const { resolveVaultRelativePath } = await import("./vault-usecase-helpers.js")
  const absoluteDirectory = await resolveVaultRelativePath(vault, rawDirectory)
  let manifestNames: string[]

  try {
    manifestNames = (await readdir(absoluteDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && isRawManifestFileName(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    throw new VaultCliError(
      "manifest_missing",
      `Raw import directory "${rawDirectory}" is missing from the vault.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  if (manifestNames.length === 0) {
    throw new VaultCliError(
      "manifest_missing",
      `Raw import directory "${rawDirectory}" does not contain a raw import manifest.`,
    )
  }

  const manifestName =
    manifestNames.find((name) => name === LEGACY_RAW_MANIFEST_BASENAME)
    ?? manifestNames.at(-1)

  if (!manifestName) {
    throw new VaultCliError(
      "manifest_missing",
      `Raw import directory "${rawDirectory}" does not contain a raw import manifest.`,
    )
  }

  return path.posix.join(rawDirectory, manifestName)
}

export async function loadJsonInputFile(
  input: string,
  label: string,
): Promise<JsonObject> {
  return loadJsonInputObject(input, label)
}

export async function preparePatchedUpsertPayload<TPayload extends JsonObject>(input: {
  record: TPayload
  entityIdField: keyof TPayload & string
  entityId: string
  inputFile?: string
  set?: readonly string[]
  clear?: readonly string[]
  patchLabel: string
  parsePayload(value: unknown): TPayload
}): Promise<{
  payload: TPayload
  clearedFields: ReadonlySet<string>
  allowSlugRename: boolean
}> {
  const set = input.set?.filter((assignment) => !pathAssignmentTargetsField(assignment, input.entityIdField))
  const clear = input.clear?.filter((path) => path.trim() !== input.entityIdField)
  const clearedEntityId = input.clear?.some((path) => path.trim() === input.entityIdField) ?? false
  if (
    typeof input.inputFile !== "string" &&
    (set?.length ?? 0) === 0 &&
    (clear?.length ?? 0) === 0
  ) {
    return {
      payload: input.parsePayload({
        ...input.record,
        [input.entityIdField]: input.entityId,
      }),
      clearedFields: clearedEntityId ? new Set<string>([input.entityIdField]) : new Set<string>(),
      allowSlugRename: false,
    }
  }

  const patched = await applyRecordPatch({
    record: structuredClone(input.record) as RecordMutationJsonObject,
    inputFile: input.inputFile,
    set,
    clear,
    patchLabel: input.patchLabel,
  })
  const payload = input.parsePayload({
    ...patched.record,
    [input.entityIdField]: input.entityId,
  })

  return {
    payload,
    clearedFields: clearedEntityId
      ? new Set<string>([...patched.clearedFields, input.entityIdField])
      : patched.clearedFields,
    allowSlugRename: patched.touchedTopLevelFields.has("slug"),
  }
}

function pathAssignmentTargetsField(assignment: string, field: string): boolean {
  const separatorIndex = assignment.indexOf("=")
  return separatorIndex > 0 && assignment.slice(0, separatorIndex).trim() === field
}

export function assertNoReservedPayloadKeys(payload: JsonObject) {
  const reservedKeys = Object.keys(payload).filter((key) => RESERVED_PAYLOAD_KEYS.has(key))

  if (reservedKeys.length > 0) {
    throw new VaultCliError(
      "invalid_payload",
      `Payload file may not set reserved field${reservedKeys.length === 1 ? "" : "s"}: ${reservedKeys.join(", ")}.`,
      {
        reservedKeys,
      },
    )
  }
}

export function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new VaultCliError("invalid_payload", `${fieldName} must be an array of non-empty strings.`)
  }

  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))

  if (items.some((entry) => entry.length === 0)) {
    throw new VaultCliError("invalid_payload", `${fieldName} must be an array of non-empty strings.`)
  }

  return items.length > 0 ? items : undefined
}

export function requirePayloadObjectField(payload: JsonObject, fieldName: string): JsonObject {
  const value = payload[fieldName]

  if (!isPlainObject(value)) {
    throw new VaultCliError(
      "invalid_payload",
      `Payload file must include a plain-object "${fieldName}" field.`,
    )
  }

  return value
}

export function asEntityEnvelope(
  vault: string,
  entity: HealthEntityEnvelope["entity"] | null,
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

export function asListEnvelope<
  TFilters extends {
    limit: number
  },
  TItem,
>(
  vault: string,
  filters: TFilters,
  items: TItem[],
): {
  vault: string
  filters: TFilters
  items: TItem[]
  count: number
  nextCursor: string | null
} {
  return {
    vault,
    filters,
    items,
    count: items.length,
    nextCursor: null,
  }
}

export function recordPath(record: JsonObject) {
  const relativePath =
    typeof record.relativePath === "string"
      ? record.relativePath
      : typeof record.document === "object" &&
          record.document !== null &&
          !Array.isArray(record.document) &&
          typeof (record.document as JsonObject).relativePath === "string"
        ? (record.document as JsonObject).relativePath
        : undefined
  return typeof relativePath === "string" ? relativePath : undefined
}

export function buildScaffoldPayload(noun: string) {
  const definition = healthEntityDefinitions.find((entry) => entry.noun === noun)
  if (!definition?.scaffoldTemplate) {
    throw new VaultCliError("invalid_payload", `No scaffold template is defined for ${noun}.`)
  }

  return definition.scaffoldTemplate
}

export function buildEntityLinks(record: {
  data: Record<string, unknown>
  relatedIds?: string[]
}) {
  const linkIds = new Set<string>()

  const appendLinkId = (value: unknown) => {
    if (typeof value !== "string") {
      return
    }

    const normalized = value.trim()
    if (normalized.length === 0) {
      return
    }

    linkIds.add(normalized)
  }

  const appendLinkArray = (value: unknown) => {
    if (!Array.isArray(value)) {
      return
    }

    for (const entry of value) {
      appendLinkId(entry)
    }
  }

  appendLinkArray(record.relatedIds)

  const arrayLinkKeys = [
    "relatedIds",
    "eventIds",
    "sourceAssessmentIds",
    "sourceEventIds",
    "topGoalIds",
    "relatedGoalIds",
    "relatedConditionIds",
    "relatedRegimenIds",
    "relatedExperimentIds",
    "sourceFamilyMemberIds",
    "relatedVariantIds",
  ] as const
  for (const key of arrayLinkKeys) {
    appendLinkArray(record.data[key])
  }

  const scalarLinkKeys = [
    "snapshotId",
    "parentGoalId",
  ] as const
  for (const key of scalarLinkKeys) {
    appendLinkId(record.data[key])
  }

  return [...linkIds].map((id) => ({
    id,
    kind: inferEntityKind(id),
    queryable: isQueryableRecordId(id),
  }))
}

function normalizeGenericEntityKind(entity: QueryEntity) {
  if (isBloodTestEntity(entity)) {
    return "blood_test"
  }

  const healthDefinition = healthEntityDefinitions.find(
    (definition) => definition.kind === entity.family,
  )
  const canonicalListKind =
    healthDefinition?.listKinds?.length === 1 ? healthDefinition.listKinds[0] : null

  if (canonicalListKind) {
    return canonicalListKind
  }

  return entity.kind || entity.family
}

export function summarizeListMarkdown(
  markdown: string | null | undefined,
  maxLength = 220,
) {
  if (typeof markdown !== "string") {
    return null
  }

  const withoutFrontmatter = markdown.replace(
    /^---\s*\n[\s\S]*?\n---\s*\n?/u,
    "",
  )

  const normalized = withoutFrontmatter
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_`>#-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()

  if (normalized.length === 0) {
    return null
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function toListEntity(input: {
  id: string
  kind: string
  title: string | null
  occurredAt: string | null
  path: string | null
  markdown?: string | null
  data: Record<string, unknown>
  links: ListEntity["links"]
  excerpt?: string | null
}): ListEntity {
  const entity: ListEntity = {
    id: input.id,
    kind: input.kind,
    title: input.title,
    occurredAt: input.occurredAt,
    path: input.path,
    data: input.data,
    links: input.links,
  }

  const normalizedExplicitExcerpt =
    typeof input.excerpt === "string"
      ? input.excerpt.trim()
      : input.excerpt
  const normalizedExcerpt =
    normalizedExplicitExcerpt === null
      ? null
      : typeof normalizedExplicitExcerpt === "string" && normalizedExplicitExcerpt.length > 0
        ? normalizedExplicitExcerpt
        : summarizeListMarkdown(input.markdown)

  if (typeof normalizedExcerpt === "string" && normalizedExcerpt.length > 0) {
    entity.excerpt = normalizedExcerpt
  }

  return entity
}

export function toGenericShowEntity(entity: QueryEntity) {
  return {
    id: entity.entityId,
    kind: normalizeGenericEntityKind(entity),
    title: entity.title ?? null,
    occurredAt: entity.occurredAt ?? null,
    path: entity.path ?? null,
    markdown: entity.body ?? null,
    data: entity.attributes,
    links: buildEntityLinks({
      data: entity.attributes,
      relatedIds: entity.relatedIds,
    }),
  }
}

export function toGenericListItem(entity: QueryEntity) {
  return toListEntity({
    id: entity.entityId,
    kind: normalizeGenericEntityKind(entity),
    title: entity.title ?? null,
    occurredAt: entity.occurredAt ?? null,
    path: entity.path ?? null,
    markdown: entity.body ?? null,
    data: entity.attributes,
    links: buildEntityLinks({
      data: entity.attributes,
      relatedIds: entity.relatedIds,
    }),
  })
}

export function matchesGenericKindFilter(entity: QueryEntity, kind?: string) {
  if (!kind) {
    return !DEFAULT_GENERIC_LIST_EXCLUDED_FAMILIES.has(entity.family)
  }

  return (
    normalizeGenericEntityKind(entity) === kind ||
    entity.kind === kind ||
    entity.family === kind
  )
}

export async function materializeExportPack(
  outDir: string,
  files: Array<{ path: string; contents: string }>,
) {
  const absoluteOutDir = path.resolve(outDir)

  for (const file of files) {
    const relativePath = String(file.path ?? "").trim().replace(/\\/g, "/")

    if (
      relativePath.length === 0 ||
      path.posix.isAbsolute(relativePath) ||
      /^[A-Za-z]:/u.test(relativePath)
    ) {
      throw new VaultCliError("invalid_export_pack", `Export pack emitted an invalid file path "${file.path}".`)
    }

    const targetPath = path.resolve(absoluteOutDir, relativePath)
    const containment = path.relative(absoluteOutDir, targetPath)

    if (
      containment === ".." ||
      containment.startsWith(`..${path.sep}`) ||
      path.isAbsolute(containment)
    ) {
      throw new VaultCliError(
        "invalid_export_pack",
        `Export pack file path escaped the requested output directory: "${file.path}".`,
      )
    }

    const targetDirectory = await ensureExportPackMaterializationDirectory(
      absoluteOutDir,
      path.dirname(relativePath),
    )
    await writeExportPackFileSafely({
      contents: file.contents,
      originalPath: file.path,
      targetDirectory,
      targetPath,
    })
  }
}

async function ensureExportPackMaterializationDirectory(
  absoluteOutDir: string,
  relativeDirectory: string,
): Promise<string> {
  await mkdir(absoluteOutDir, { recursive: true })
  await assertExportPackMaterializationPathIsDirectory(absoluteOutDir, ".")

  const segments = relativeDirectory
    .replace(/\\/gu, "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
  let current = absoluteOutDir

  for (const segment of segments) {
    current = path.join(current, segment)
    await mkdir(current, { recursive: false }).catch(async (error) => {
      if (!isAlreadyExistsError(error)) {
        throw error
      }
    })
    await assertExportPackMaterializationPathIsDirectory(current, segment)
  }

  return current
}

async function writeExportPackFileSafely(input: {
  contents: string
  originalPath: string
  targetDirectory: string
  targetPath: string
}): Promise<void> {
  await assertExportPackMaterializationTargetIsSafe(input.targetPath, input.originalPath)
  const tempPath = path.join(
    input.targetDirectory,
    `.${path.basename(input.targetPath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  )

  try {
    await writeFile(tempPath, input.contents, "utf8")
    await rename(tempPath, input.targetPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function assertExportPackMaterializationPathIsDirectory(
  candidatePath: string,
  displayPath: string,
): Promise<void> {
  const stats = await lstat(candidatePath)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new VaultCliError(
      "invalid_export_pack",
      `Export pack output path traversed a non-directory or symbolic link: "${displayPath}".`,
    )
  }
}

async function assertExportPackMaterializationTargetIsSafe(
  targetPath: string,
  originalPath: string,
): Promise<void> {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink() || stats.isDirectory()) {
      throw new VaultCliError(
        "invalid_export_pack",
        `Export pack file path targeted a non-file or symbolic link: "${originalPath}".`,
      )
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  )
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

export function toJournalLookupId(date: string) {
  return `journal:${date}`
}
