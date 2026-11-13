import type {
  RecordListEntity,
  RecordReadEntity,
} from '@murphai/operator-config/vault-cli-contracts'

// Agent-facing record reads. The model re-reads every byte of a tool result on
// later calls, so a read says each fact once and leaves out storage detail.
// Shared vault-usecases shapes stay complete for their in-process callers.

interface SourceEntityRef {
  id: string
  kind: string
  queryable: boolean
}

export interface SourceRecordEntity {
  id: string
  kind: string
  title: string | null
  occurredAt: string | null
  path: string | null
  markdown?: string | null
  excerpt?: string | null
  data: Record<string, unknown>
  links: readonly SourceEntityRef[]
}

type JsonObject = Record<string, unknown>

// Core rewrites these registry bodies from their frontmatter on every save.
const GENERATED_BODY_KINDS = new Set([
  'allergy',
  'condition',
  'family',
  'genetics',
  'goal',
  'regimen',
  'supplement',
])
// A family list summary counts its condition history, so its excerpt stays.
const LIST_EXCERPT_KEPT_KINDS = new Set(['family'])
const STORAGE_DATA_KEYS = new Set(['schemaVersion', 'docType', 'dataOrigin', 'dataOriginKeyCount'])
const DETAIL_ONLY_DATA_KEYS = new Set(['rawRefs', 'rawRefsCount', 'timeZone'])

export function projectRecordShowResult<TResult extends { entity: SourceRecordEntity }>(
  result: TResult,
): Omit<TResult, 'entity'> & { entity: RecordReadEntity } {
  return { ...result, entity: projectRecordReadEntity(result.entity, { path: true }) }
}

export function projectRecordListResult<TResult extends { items: readonly SourceRecordEntity[] }>(
  result: TResult,
): Omit<TResult, 'items'> & { items: RecordListEntity[] } {
  return { ...result, items: result.items.map(projectRecordListEntity) }
}

/** A complete record; `path` only for a single-record show. */
export function projectRecordReadEntity(
  entity: SourceRecordEntity,
  options: { path: boolean },
): RecordReadEntity {
  const path = options.path && entity.path && !isLedgerShardPath(entity.path) ? entity.path : null
  const markdown = entity.markdown && !bodyRestatesData(entity, entity.markdown) ? entity.markdown : null
  return withOwnLinks({
    ...projectRecordHead(entity),
    ...(path ? { path } : {}),
    ...(markdown ? { markdown } : {}),
    data: projectRecordData(entity, true),
  }, entity)
}

export function projectRecordListEntity(entity: SourceRecordEntity): RecordListEntity {
  const excerpt = entity.excerpt &&
    (LIST_EXCERPT_KEPT_KINDS.has(entity.kind) || !bodyRestatesData(entity, null))
    ? entity.excerpt
    : null
  return withOwnLinks({
    ...projectRecordHead(entity),
    data: projectRecordData(entity, false),
    ...(excerpt ? { excerpt } : {}),
  }, entity)
}

function projectRecordHead(entity: SourceRecordEntity) {
  return {
    id: entity.id,
    kind: entity.kind,
    ...(entity.title !== null ? { title: entity.title } : {}),
    ...(entity.occurredAt !== null ? { occurredAt: entity.occurredAt } : {}),
  }
}

// A ledger row's body is its own `note` or `summary`; a registry body is
// generated from the same fields `data` carries.
function bodyRestatesData(entity: SourceRecordEntity, markdown: string | null): boolean {
  if (GENERATED_BODY_KINDS.has(entity.kind)) {
    return true
  }
  if (!entity.path || !isLedgerShardPath(entity.path)) {
    return false
  }
  const { note, summary } = entity.data
  return markdown === null
    ? typeof note === 'string' || typeof summary === 'string'
    : markdown === note || markdown === summary
}

function isLedgerShardPath(path: string): boolean {
  return path.endsWith('.jsonl')
}

function projectRecordData(entity: SourceRecordEntity, detail: boolean): JsonObject {
  const { data } = entity
  const dataOrigin = isPlainObject(data.dataOrigin) ? data.dataOrigin : null
  const projected: JsonObject = {}

  for (const [key, value] of Object.entries(data)) {
    if (
      STORAGE_DATA_KEYS.has(key) ||
      (!detail && DETAIL_ONLY_DATA_KEYS.has(key)) ||
      // A device import's provenance collapses to `provider`.
      (dataOrigin !== null && key === 'externalRef') ||
      restatesEntity(entity, key, value)
    ) {
      continue
    }
    const kept = detail ? projectDetailValue(key, value, entity.id) : value
    if (kept !== undefined) {
      projected[key] = kept
    }
  }

  const provider = readString(dataOrigin?.sourceProviderSlug) ?? readString(dataOrigin?.aggregatorProvider)
  if (provider && projected.provider === undefined) {
    projected.provider = provider
  }
  return projected
}

function restatesEntity(entity: SourceRecordEntity, key: string, value: unknown): boolean {
  switch (key) {
    case 'id':
    case 'kind':
    case 'title':
    case 'occurredAt':
      return value === entity[key]
    case 'eventIds': {
      const ownIds = readOwnIds(entity)
      return Array.isArray(value) && value.every((id) => ownIds.has(String(id)))
    }
    default:
      // Family id aliases such as entityId, mealId, goalId, or regimenId.
      return value === entity.id
  }
}

function projectDetailValue(key: string, value: unknown, id: string): unknown {
  if (value === null) {
    return undefined
  }
  if (Array.isArray(value)) {
    const items = key === 'links'
      ? value.filter((link) => !isPlainObject(link) || link.targetId !== id)
      : value.map((item) => (isPlainObject(item) ? withoutNullFields(item) : item))
    return items.length > 0 ? items : undefined
  }
  if (isPlainObject(value) && Object.keys(value).length === 0) {
    return undefined
  }
  return value
}

function withOwnLinks<TEntity extends RecordReadEntity | RecordListEntity>(
  projected: TEntity,
  entity: SourceRecordEntity,
): TEntity {
  const ownIds = readOwnIds(entity)
  const links = entity.links.filter((link) => !ownIds.has(link.id))
  return links.length > 0 ? { ...projected, links } : projected
}

// The entity id and, for a meal, its own event id.
function readOwnIds(entity: SourceRecordEntity): Set<string> {
  return new Set([entity.id, ...(typeof entity.data.id === 'string' ? [entity.data.id] : [])])
}

function withoutNullFields(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null))
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
