import { z } from 'zod'

import {
  HEALTH_COMMONS_ENTITY_TYPES,
  type HealthCommonsEntityType,
} from '@murphai/contracts'
import {
  getGeneratedHealthCommonsCatalogReader,
  type HealthCommonsCatalogReader,
  type HealthCommonsCompactEntity,
  type HealthCommonsEntity,
} from '@murphai/health-commons/runtime'

import { defineAssistantCapabilityTool } from '../definition-factory.js'

const healthCommonsPublicCorpus = {
  id: 'health-commons',
  name: 'Health Commons',
  visibility: 'public',
  description:
    'Public source-backed Health Commons reference corpus; not private vault protocol records.',
  privateVaultRecords: false,
} as const

const healthCommonsPublicCorpusNote =
  'These records come from the public Health Commons corpus, not the user private vault protocol registry.'

const healthCommonsDefaultLimit = 10
const healthCommonsMaxLimit = 50
const healthCommonsDefaultBodyChars = 1_200
const healthCommonsMaxBodyChars = 6_000

const healthCommonsEntityTypeInputSchema = z.enum(HEALTH_COMMONS_ENTITY_TYPES)

const healthCommonsLimitSchema = z
  .number()
  .int()
  .positive()
  .max(healthCommonsMaxLimit)
  .optional()

const healthCommonsSearchInputSchema = z.object({
  query: z.string().trim().min(1),
  entityTypes: z.array(healthCommonsEntityTypeInputSchema).min(1).optional(),
  categories: z.array(z.string().trim().min(1)).min(1).optional(),
  limit: healthCommonsLimitSchema,
})

const healthCommonsGetInputSchema = z.object({
  keyOrSlug: z.string().trim().min(1),
  includeBody: z.boolean().optional(),
  includeRelations: z.boolean().optional(),
  includeSources: z.boolean().optional(),
  includeExperimentOnboarding: z.boolean().optional(),
  maxBodyChars: z
    .number()
    .int()
    .positive()
    .max(healthCommonsMaxBodyChars)
    .optional(),
})

const healthCommonsListProtocolsInputSchema = z.object({
  query: z.string().trim().min(1).optional(),
  categories: z.array(z.string().trim().min(1)).min(1).optional(),
  status: z.array(z.string().trim().min(1)).min(1).optional(),
  limit: healthCommonsLimitSchema,
})

const healthCommonsListSourcesInputSchema = z.object({
  protocolKeyOrSlug: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  categories: z.array(z.string().trim().min(1)).min(1).optional(),
  limit: healthCommonsLimitSchema,
})

type HealthCommonsSearchInput = z.infer<typeof healthCommonsSearchInputSchema>
type HealthCommonsGetInput = z.infer<typeof healthCommonsGetInputSchema>
type HealthCommonsListProtocolsInput = z.infer<
  typeof healthCommonsListProtocolsInputSchema
>
type HealthCommonsListSourcesInput = z.infer<
  typeof healthCommonsListSourcesInputSchema
>

export function createHealthCommonsToolDefinitions() {
  return [
    defineHealthCommonsTool({
      name: 'healthCommons.search',
      description:
        'Search the public Health Commons source-backed reference corpus for protocols, biomarkers, sources, and related pages. Use this first for health improvement, protocol, and experiment discovery; these are not private vault protocol records.',
      inputSchema: healthCommonsSearchInputSchema,
      inputExample: {
        query: 'sleep protocol',
        entityTypes: ['protocol_variant'],
      },
      execute: searchHealthCommons,
    }),
    defineHealthCommonsTool({
      name: 'healthCommons.get',
      description:
        'Get one public Health Commons entity by key, slug, or route id. Use this after search/list results when you need the exact source-backed protocol page, onboarding block, revision ids, relations, or sources.',
      inputSchema: healthCommonsGetInputSchema,
      inputExample: {
        keyOrSlug: 'protocol_variant:red-light-glasses-before-bed/red-light-glasses-before-bed',
        includeExperimentOnboarding: true,
        includeSources: true,
      },
      execute: getHealthCommonsEntity,
    }),
    defineHealthCommonsTool({
      name: 'healthCommons.listProtocols',
      description:
        'List public Health Commons protocol_variant records. Use this for protocol browsing before creating or adapting a private user experiment plan.',
      inputSchema: healthCommonsListProtocolsInputSchema,
      inputExample: {
        query: 'sauna',
      },
      execute: listHealthCommonsProtocols,
    }),
    defineHealthCommonsTool({
      name: 'healthCommons.listSources',
      description:
        'List public Health Commons source_artifact records, optionally scoped to one public protocol. Use this when a user asks what evidence backs a public protocol.',
      inputSchema: healthCommonsListSourcesInputSchema,
      inputExample: {
        protocolKeyOrSlug: 'red-light-glasses-before-bed',
      },
      execute: listHealthCommonsSources,
    }),
  ]
}

function defineHealthCommonsTool<TSchema extends z.ZodTypeAny, TResult>(
  definition: {
    description: string
    execute(input: z.infer<TSchema>): Promise<TResult>
    inputExample: Record<string, unknown>
    inputSchema: TSchema
    name: string
  },
) {
  return defineAssistantCapabilityTool(
    definition,
    {
      origin: 'hand-authored-helper',
      localOnly: true,
      generatedFrom: '@murphai/health-commons',
      policyWrappers: [],
    },
    'native-local',
    'local-service',
  )
}

async function searchHealthCommons(input: HealthCommonsSearchInput) {
  const reader = getGeneratedHealthCommonsCatalogReader()
  const results = reader.search({
    query: input.query,
    entityTypes: input.entityTypes,
    categories: input.categories,
    limit: normalizeLimit(input.limit),
  })

  return {
    schema: 'murph.health-commons.search-result.v1',
    corpus: healthCommonsPublicCorpus,
    note: healthCommonsPublicCorpusNote,
    query: input.query,
    count: results.length,
    results: results.map((result) => ({
      entity: decorateCompactEntity(result.entity),
      matchedFields: result.matchedFields,
      score: result.score,
    })),
  }
}

async function getHealthCommonsEntity(input: HealthCommonsGetInput) {
  const reader = getGeneratedHealthCommonsCatalogReader()
  const entity = resolveHealthCommonsEntity(input.keyOrSlug)

  if (!entity) {
    return {
      schema: 'murph.health-commons.get-result.v1',
      corpus: healthCommonsPublicCorpus,
      note: healthCommonsPublicCorpusNote,
      lookup: input.keyOrSlug,
      entity: null,
      relations: [],
      sources: [],
    }
  }

  const includeRelations = input.includeRelations === true
  const includeSources = input.includeSources === true

  return {
    schema: 'murph.health-commons.get-result.v1',
    corpus: healthCommonsPublicCorpus,
    note: healthCommonsPublicCorpusNote,
    lookup: input.keyOrSlug,
    entity: {
      ...decorateCompactEntity(reader.compactEntity(entity), entity),
      body: input.includeBody === true
        ? truncateText(entity.body, input.maxBodyChars ?? healthCommonsDefaultBodyChars)
        : null,
      bodyIncluded: input.includeBody === true,
      experimentOnboarding:
        input.includeExperimentOnboarding === false
          ? null
          : entity.experimentOnboarding ?? null,
    },
    relations: includeRelations
      ? reader.resolveRelations({ entity, limit: 12 }).map((relation) => ({
          relation: relation.relation,
          entity: decorateCompactEntity(relation.entity),
        }))
      : [],
    sources: includeSources
      ? reader.resolveSources({ entity, limit: 8 }).map((source) => ({
          reasons: source.reasons,
          source: decorateCompactEntity(source.source),
        }))
      : [],
  }
}

async function listHealthCommonsProtocols(input: HealthCommonsListProtocolsInput) {
  const reader = getGeneratedHealthCommonsCatalogReader()
  const statuses = new Set(input.status ?? [])
  const protocols = listHealthCommonsEntities(reader, {
    categories: input.categories,
    entityType: 'protocol_variant',
    query: input.query,
  })
    .map((protocol) => reader.compactEntity(protocol))
    .filter((protocol) => statuses.size === 0 || statuses.has(protocol.status ?? ''))
    .slice(0, normalizeLimit(input.limit))

  return {
    schema: 'murph.health-commons.list-protocols-result.v1',
    corpus: healthCommonsPublicCorpus,
    note: healthCommonsPublicCorpusNote,
    filters: {
      query: input.query ?? null,
      categories: input.categories ?? [],
      status: input.status ?? [],
      limit: normalizeLimit(input.limit),
    },
    count: protocols.length,
    protocols: protocols.map((protocol) => decorateCompactEntity(protocol)),
  }
}

async function listHealthCommonsSources(input: HealthCommonsListSourcesInput) {
  const reader = getGeneratedHealthCommonsCatalogReader()
  const protocol = input.protocolKeyOrSlug
    ? resolveHealthCommonsEntity(input.protocolKeyOrSlug)
    : null
  if (
    input.protocolKeyOrSlug &&
    (!protocol || protocol.entityType !== 'protocol_variant')
  ) {
    return {
      schema: 'murph.health-commons.list-sources-result.v1',
      corpus: healthCommonsPublicCorpus,
      note: healthCommonsPublicCorpusNote,
      filters: {
        protocolKeyOrSlug: input.protocolKeyOrSlug,
        query: input.query ?? null,
        categories: input.categories ?? [],
        limit: normalizeLimit(input.limit),
      },
      count: 0,
      sources: [],
    }
  }
  const normalizedCategories = normalizeCategorySet(input.categories)
  const searchMatchedSourceKeys =
    input.query || normalizedCategories.size > 0
      ? new Set(
          listHealthCommonsEntities(reader, {
            categories: input.categories,
            entityType: 'source_artifact',
            query: input.query,
          }).map((entity) => entity.key),
        )
      : null
  const sources = (protocol
    ? reader.collectSourceKeys({ entity: protocol })
        .map((key) => reader.findByKey(key))
        .filter(
          (source): source is HealthCommonsEntity =>
            source !== null && source.entityType === 'source_artifact',
        )
    : listHealthCommonsEntities(reader, {
        categories: input.categories,
        entityType: 'source_artifact',
        query: input.query,
      }))
    .filter((source) => searchMatchedSourceKeys === null || searchMatchedSourceKeys.has(source.key))
    .map((source) => reader.compactEntity(source))
    .slice(0, normalizeLimit(input.limit))

  return {
    schema: 'murph.health-commons.list-sources-result.v1',
    corpus: healthCommonsPublicCorpus,
    note: healthCommonsPublicCorpusNote,
    filters: {
      protocolKeyOrSlug: input.protocolKeyOrSlug ?? null,
      query: input.query ?? null,
      categories: input.categories ?? [],
      limit: normalizeLimit(input.limit),
    },
    count: sources.length,
    sources: sources.map((source) => decorateCompactEntity(source)),
  }
}

function resolveHealthCommonsEntity(lookup: string): HealthCommonsEntity | null {
  const reader = getGeneratedHealthCommonsCatalogReader()
  const trimmed = lookup.trim()
  const direct =
    reader.findByKey(trimmed) ??
    reader.findBySlug(trimmed)

  if (direct) {
    return direct
  }

  for (const entityType of HEALTH_COMMONS_ENTITY_TYPES) {
    const byRouteId = reader.findByRouteId({
      entityType,
      routeId: trimmed,
    })
    if (byRouteId) {
      return byRouteId
    }
  }

  return null
}

function decorateCompactEntity(
  entity: HealthCommonsCompactEntity,
  fullEntity: HealthCommonsEntity | null = null,
) {
  const resolvedFullEntity =
    fullEntity ?? getGeneratedHealthCommonsCatalogReader().findByKey(entity.key)
  const reader = getGeneratedHealthCommonsCatalogReader()

  return {
    ...entity,
    hasExperimentOnboarding: Boolean(resolvedFullEntity?.experimentOnboarding),
    sourceCount: reader.collectSourceKeys({ entity: resolvedFullEntity }).length,
  }
}

function normalizeCategorySet(
  categories: readonly string[] | undefined,
): ReadonlySet<string> {
  return new Set((categories ?? []).map((category) => category.trim()).filter(Boolean))
}

function normalizeLimit(value: number | undefined): number {
  return Math.min(value ?? healthCommonsDefaultLimit, healthCommonsMaxLimit)
}

function listHealthCommonsEntities(
  reader: HealthCommonsCatalogReader,
  input: {
    categories?: readonly string[]
    entityType: HealthCommonsEntityType
    query?: string
  },
): HealthCommonsEntity[] {
  if (input.query || (input.categories?.length ?? 0) > 0) {
    return reader
      .search({
        categories: input.categories,
        entityTypes: [input.entityType],
        limit: 500,
        query: input.query,
      })
      .map((result) => reader.findByKey(result.entity.key))
      .filter(
        (entity): entity is HealthCommonsEntity =>
          entity !== null && entity.entityType === input.entityType,
      )
  }

  return reader.listByEntityType(input.entityType)
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return {
      text,
      truncated: false,
      maxChars,
    }
  }

  return {
    text: text.slice(0, maxChars),
    truncated: true,
    maxChars,
  }
}
