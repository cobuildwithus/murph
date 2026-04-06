import { readFile } from 'node:fs/promises'
import { extractIsoDatePrefix } from '@murphai/contracts'
import {
  loadQueryRuntime as loadBaseQueryRuntime,
  type QueryRuntimeModule,
  type QueryVaultReadModel as QueryReadModel,
  type QueryCanonicalEntity as QueryRecord,
} from '../query-runtime.js'
import { createRuntimeUnavailableError as buildRuntimeUnavailableError } from '@murphai/operator-config/runtime-errors'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  inferEntityKind,
  isQueryableRecordId,
} from '../usecases/shared.js'

type JsonObject = Record<string, unknown>
export type { QueryReadModel, QueryRecord, QueryRuntimeModule }

export interface CommandEntityLink {
  id: string
  kind: string
  queryable: boolean
}

export interface CommandShowEntity {
  id: string
  kind: string
  title: string | null
  occurredAt: string | null
  path: string | null
  markdown: string | null
  data: JsonObject
  links: CommandEntityLink[]
}

export type CommandListItem = CommandShowEntity

export interface SampleCommandListItem extends CommandListItem {
  quality: string | null
  stream: string | null
}

export interface AuditCommandListItem extends CommandListItem {
  action: string | null
  actor: string | null
  status: string | null
  commandName: string | null
  summary: string | null
}

let queryRuntimePromise: Promise<QueryRuntimeModule> | null = null

export async function loadQueryRuntime(
  operation = 'samples/audit query reads',
): Promise<QueryRuntimeModule> {
  queryRuntimePromise ??= (async () => {
    try {
      const runtime = await loadBaseQueryRuntime()

      if (
        typeof runtime.readVault !== 'function' ||
        typeof runtime.lookupEntityById !== 'function' ||
        typeof runtime.listEntities !== 'function'
      ) {
        throw new TypeError('Query runtime package did not match the expected module shape.')
      }

      return runtime
    } catch (error) {
      queryRuntimePromise = null
      throw buildRuntimeUnavailableError(operation, error)
    }
  })()

  return queryRuntimePromise
}

export function toCommandShowEntity(
  record: QueryRecord,
  extraLinkKeys: string[] = [],
): CommandShowEntity {
  return toCommandShowEntityWithLinks(
    record,
    toCommandEntityLinks(record, { extraLinkKeys }),
  )
}

export function toOwnedEventCommandShowEntity(
  record: QueryRecord,
  extraLinkKeys: string[] = [],
): CommandShowEntity {
  return toCommandShowEntityWithLinks(
    record,
    toCommandEntityLinks(record, {
      extraLinkKeys,
      includeRelatedIds: false,
      sort: false,
    }),
  )
}

function toCommandShowEntityWithLinks(
  record: QueryRecord,
  links: CommandEntityLink[],
): CommandShowEntity {
  return {
    id: record.entityId || record.primaryLookupId,
    kind: record.kind || record.family,
    title: record.title ?? null,
    occurredAt: record.occurredAt ?? null,
    path: record.path ?? null,
    markdown: record.body ?? null,
    data: record.attributes,
    links,
  }
}

export function toSampleCommandListItem(
  record: QueryRecord,
): SampleCommandListItem {
  return {
    ...toCommandShowEntity(record),
    data: {
      ...record.attributes,
      status: record.status ?? undefined,
      stream: record.stream ?? undefined,
    },
    quality: record.status ?? null,
    stream: record.stream ?? null,
  }
}

export function toAuditCommandListItem(
  record: QueryRecord,
): AuditCommandListItem {
  return {
    ...toCommandShowEntity(record),
    action: firstString(record.attributes, ['action']),
    actor: firstString(record.attributes, ['actor']),
    status: record.status ?? null,
    commandName: firstString(record.attributes, ['commandName', 'command_name']),
    summary: firstString(record.attributes, ['summary']),
  }
}

export function matchesOptionalString(
  value: string | null,
  expected?: string,
): boolean {
  return !expected || value === expected
}

export function matchesDateRange(
  value: string | null | undefined,
  from?: string,
  to?: string,
): boolean {
  if (!value) {
    return !from && !to
  }

  const date = extractIsoDatePrefix(value) ?? value
  if (from && date < from) {
    return false
  }

  if (to && date > to) {
    return false
  }

  return true
}

export function compareByLatest(
  left: QueryRecord,
  right: QueryRecord,
): number {
  const leftDate = left.occurredAt ?? ''
  const rightDate = right.occurredAt ?? ''

  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate)
  }

  return (left.entityId || left.primaryLookupId).localeCompare(
    right.entityId || right.primaryLookupId,
  )
}

export function compareNullableDates(
  left: string | null,
  right: string | null,
): number {
  const normalizedLeft = left ?? ''
  const normalizedRight = right ?? ''

  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft.localeCompare(normalizedRight)
  }

  return 0
}

export function applyLimit<T>(items: T[], limit?: number): T[] {
  return typeof limit === 'number' ? items.slice(0, limit) : items
}

export function asObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
}

export function firstString(
  value: JsonObject | null | undefined,
  keys: string[],
): string | null {
  if (!value) {
    return null
  }

  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  return null
}

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export { createRuntimeUnavailableError } from '@murphai/operator-config/runtime-errors'

export async function readJsonObject(
  absolutePath: string,
  label: string,
): Promise<JsonObject> {
  let contents: string

  try {
    contents = await readFile(absolutePath, 'utf8')
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new VaultCliError('not_found', `${label} is missing.`)
    }

    throw error
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    throw new VaultCliError(
      'invalid_json',
      `${label} is not valid JSON.`,
      error instanceof Error ? { cause: error.message } : undefined,
    )
  }

  if (!isJsonObject(parsed)) {
    throw new VaultCliError('invalid_json', `${label} must contain a JSON object.`)
  }

  return parsed
}

export function isMissingPathError(
  error: unknown,
): error is NodeJS.ErrnoException {
  const candidate = error as NodeJS.ErrnoException | null

  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    'code' in candidate &&
    candidate.code === 'ENOENT'
  )
}

function toCommandEntityLinks(
  record: QueryRecord,
  options: {
    extraLinkKeys?: string[]
    includeRelatedIds?: boolean
    seedIds?: readonly string[]
    sort?: boolean
  } = {},
): CommandEntityLink[] {
  const ids = new Set<string>()
  const {
    extraLinkKeys = [],
    includeRelatedIds = true,
    seedIds = [],
    sort = true,
  } = options

  for (const seedId of seedIds) {
    if (typeof seedId === 'string' && seedId.trim().length > 0) {
      ids.add(seedId.trim())
    }
  }

  if (includeRelatedIds) {
    for (const relatedId of record.relatedIds ?? []) {
      if (typeof relatedId === 'string' && relatedId.trim().length > 0) {
        ids.add(relatedId.trim())
      }
    }
  }

  for (const key of extraLinkKeys) {
    for (const extraId of arrayOfStrings(record.attributes[key])) {
      ids.add(extraId)
    }
  }

  const linkIds = [...ids]
  if (sort) {
    linkIds.sort((left, right) => left.localeCompare(right))
  }

  return linkIds
    .map((id) => ({
      id,
      kind: inferEntityKind(id),
      queryable: isQueryableRecordId(id),
    }))
}
