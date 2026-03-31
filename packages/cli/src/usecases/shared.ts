import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_SPECIMEN_TYPES,
  healthEntityDefinitions,
} from "@murph/contracts"

import { VaultCliError } from "@murph/assistant-core/vault-cli-errors"
import {
  inferHealthEntityKind,
  isHealthQueryableRecordId,
} from "@murph/assistant-core/health-cli-descriptors"
import { loadJsonInputObject } from "@murph/assistant-core/json-input"
import {
  describeQueryLookupConstraint,
  inferQueryIdEntityKind,
  isQueryableQueryLookupId,
} from "@murph/assistant-core/query-runtime"
import {
  applyRecordPatch,
  type JsonObject as RecordMutationJsonObject,
} from "./record-mutations.js"

import type {
  HealthEntityEnvelope,
  JsonObject,
} from "@murph/assistant-core/health-cli-method-types"
import type { VaultValidateResult } from "@murph/assistant-core/vault-cli-contracts"
import type {
  QueryEntity,
} from "./types.js"

const DEFAULT_GENERIC_LIST_EXCLUDED_FAMILIES = new Set([
  "audit",
  "core",
])
const BLOOD_TEST_SPECIMEN_TYPE_SET = new Set<string>(BLOOD_TEST_SPECIMEN_TYPES)

function isBloodTestEntity(entity: QueryEntity) {
  if (entity.family !== "history" || entity.kind !== "test") {
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
    path: String(issue.path ?? "vault.json"),
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
  "currentProfilePath",
])

export async function readJsonPayload(
  filePath: string,
  label = "payload",
): Promise<JsonObject> {
  return loadJsonInputFile(filePath, label)
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
  const patched = await applyRecordPatch({
    record: structuredClone(input.record) as RecordMutationJsonObject,
    inputFile: input.inputFile,
    set: input.set,
    clear: input.clear,
    patchLabel: input.patchLabel,
  })
  const payload = input.parsePayload({
    ...patched.record,
    [input.entityIdField]: input.entityId,
  })

  return {
    payload,
    clearedFields: patched.clearedFields,
    allowSlugRename: patched.touchedTopLevelFields.has("slug"),
  }
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
  data: JsonObject
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
    "relatedProtocolIds",
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
  if (entity.family === "current_profile" || entity.family === "profile_snapshot") {
    return "profile"
  }

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

    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, file.contents, "utf8")
  }
}

export function toJournalLookupId(date: string) {
  return `journal:${date}`
}
