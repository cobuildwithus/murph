import {
  healthCoreHasInputCapability,
  healthCoreHasResultCapability,
  healthQueryHasListFilterCapability,
  type HealthCoreDescriptorEntry,
  type HealthQueryDescriptorEntry,
  hasHealthCoreDescriptor,
  hasHealthQueryDescriptor,
  healthEntityDescriptors,
} from "../health-cli-descriptors.js"

import type {
  CommandContext,
  EntityLookupInput,
  HealthCoreServiceMethods,
  HealthCoreRuntimeInput,
  HealthCoreRuntimeMethods,
  HealthCoreRuntimeResult,
  HealthListInput,
  HealthQueryServiceMethods,
  HealthQueryRuntimeListMethodName,
  HealthQueryRuntimeMethods,
  HealthQueryRuntimeShowMethodName,
  JsonFileInput,
  JsonObject,
  ProfileSnapshotRuntimeResult,
} from "../health-cli-method-types.js"
import type {
  CoreRuntimeModule,
  QueryRuntimeModule,
} from "./types.js"
import {
  asEntityEnvelope,
  asListEnvelope,
  assertNoReservedPayloadKeys,
  buildEntityLinks,
  buildScaffoldPayload,
  optionalStringArray,
  readJsonPayload,
  recordPath,
  requirePayloadObjectField,
} from "./shared.js"

export function buildHealthCoreRuntimeInput(
  descriptor: HealthCoreDescriptorEntry,
  vault: string,
  payload: JsonObject,
): HealthCoreRuntimeInput {
  assertNoReservedPayloadKeys(payload)

  if (healthCoreHasInputCapability(descriptor, "profile-snapshot-envelope")) {
    const recordedAtValue = payload.recordedAt
    const sourceValue = payload.source
    const profileValue = requirePayloadObjectField(payload, "profile")

    return {
      vaultRoot: vault,
      recordedAt:
        typeof recordedAtValue === "string" ||
        typeof recordedAtValue === "number" ||
        recordedAtValue instanceof Date
          ? recordedAtValue
          : undefined,
      source: typeof sourceValue === "string" ? sourceValue : undefined,
      sourceAssessmentIds: optionalStringArray(payload.sourceAssessmentIds, "sourceAssessmentIds"),
      sourceEventIds: optionalStringArray(payload.sourceEventIds, "sourceEventIds"),
      profile: profileValue,
    }
  }

  return {
    ...payload,
    vaultRoot: vault,
  }
}

export function buildHealthCoreUpsertResult(
  descriptor: HealthCoreDescriptorEntry,
  vault: string,
  result: HealthCoreRuntimeResult,
) {
  if (hasProfileSnapshotResultShape(descriptor)) {
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

  if (healthCoreHasResultCapability(descriptor, "ledger-file")) {
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
    path: healthCoreHasResultCapability(descriptor, "path")
      ? recordPath(recordResult.record)
      : undefined,
    created: Boolean(recordResult.created),
  }
}

function hasProfileSnapshotResultShape(
  descriptor: HealthCoreDescriptorEntry,
) {
  return (
    healthCoreHasResultCapability(descriptor, "ledger-file") &&
    healthCoreHasResultCapability(descriptor, "current-profile-path") &&
    healthCoreHasResultCapability(descriptor, "profile-payload")
  )
}

function projectHealthListFilterFields(
  descriptor: HealthQueryDescriptorEntry,
  input: HealthListInput,
) {
  return {
    from: healthQueryHasListFilterCapability(descriptor, "date-range")
      ? input.from
      : undefined,
    kind: healthQueryHasListFilterCapability(descriptor, "kind")
      ? input.kind
      : undefined,
    status: healthQueryHasListFilterCapability(descriptor, "status")
      ? input.status
      : undefined,
    to: healthQueryHasListFilterCapability(descriptor, "date-range")
      ? input.to
      : undefined,
  }
}

function buildHealthServiceListOptions(
  descriptor: HealthQueryDescriptorEntry,
  input: HealthListInput,
) {
  return {
    ...projectHealthListFilterFields(descriptor, input),
    limit: input.limit,
  }
}

const HEALTH_ENTITY_DATA_OMIT_KEYS = new Set([
  "id",
  "kind",
  "relativePath",
  "path",
  "markdown",
  "body",
])

function firstString(
  record: JsonObject,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function firstRawString(
  record: JsonObject,
  keys: readonly string[],
) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }

  return null
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function normalizeHealthEntityKind(
  descriptor: HealthQueryDescriptorEntry,
  record: JsonObject,
) {
  if (descriptor.kind === "history") {
    return firstString(record, ["kind"]) ?? descriptor.query.genericListKinds?.[0] ?? descriptor.kind
  }

  if (descriptor.query.genericListKinds?.length === 1) {
    return descriptor.query.genericListKinds[0]
  }

  return descriptor.kind
}

function toHealthEntityData(record: JsonObject) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => !HEALTH_ENTITY_DATA_OMIT_KEYS.has(key) && value !== undefined,
    ),
  )
}

function toHealthReadEntity(
  descriptor: HealthQueryDescriptorEntry,
  record: JsonObject,
) {
  const data = toHealthEntityData(record)

  return {
    id: firstString(record, ["id"]) ?? "",
    kind: normalizeHealthEntityKind(descriptor, record),
    title: firstString(record, ["title", "summary", "name", "label"]),
    occurredAt: firstString(record, ["occurredAt", "recordedAt", "capturedAt", "updatedAt", "importedAt"]),
    path: firstString(record, ["relativePath", "path"]),
    markdown: firstRawString(record, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
      relatedIds: stringArray(record.relatedIds),
    }),
  }
}

function buildHealthListFilters(
  descriptor: HealthQueryDescriptorEntry,
  input: HealthListInput,
) {
  return {
    ...projectHealthListFilterFields(descriptor, input),
    limit: input.limit ?? 50,
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

export function createHealthCoreServices(
  loadRuntime: () => Promise<{ core: CoreRuntimeModule }>,
): HealthCoreServiceMethods {
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
      const { core } = await loadRuntime()
      const runtimeMethod = getCoreRuntimeMethod(core, descriptor)
      const result = await runtimeMethod(runtimeInput)

      return buildHealthCoreUpsertResult(descriptor, args.vault, result)
    }
  }

  return services as unknown as HealthCoreServiceMethods
}

export function createHealthQueryServices(
  loadRuntime: () => Promise<{ query: QueryRuntimeModule }>,
): HealthQueryServiceMethods {
  const services: Record<string, unknown> = {}

  for (const descriptor of healthEntityDescriptors.filter(hasHealthQueryDescriptor)) {
    services[descriptor.query.showServiceMethod] = async (input: EntityLookupInput) => {
      const { query } = await loadRuntime()
      const record = await getQueryShowMethod(query, descriptor)(input.vault, input.id)
      return asEntityEnvelope(
        input.vault,
        record ? toHealthReadEntity(descriptor, record) : null,
        `No ${descriptor.query.notFoundLabel} found for "${input.id}".`,
      )
    }

    services[descriptor.query.listServiceMethod] = async (input: HealthListInput) => {
      const { query } = await loadRuntime()
      const records = await getQueryListMethod(query, descriptor)(
        input.vault,
        buildHealthServiceListOptions(descriptor, input),
      )
      return asListEnvelope(
        input.vault,
        buildHealthListFilters(descriptor, input),
        records.map((record) => toHealthReadEntity(descriptor, record)),
      )
    }
  }

  return services as unknown as HealthQueryServiceMethods
}
