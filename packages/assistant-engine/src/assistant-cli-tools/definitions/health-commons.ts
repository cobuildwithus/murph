import { z } from 'zod'

import {
  HEALTH_COMMONS_ENTITY_TYPES,
  type HealthCommonsEntityType,
} from '@murphai/contracts'
import {
  HEALTH_COMMONS_PAGE_STATUSES,
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
const FINNISH_DRY_SAUNA_KEY =
  'protocol_variant:dry-sauna/murph-finnish-standard-3x-week'
const healthCommonsStatusFilterValues = [
  ...HEALTH_COMMONS_PAGE_STATUSES,
  '*',
  'all',
  'any',
] as const

const healthCommonsEntityTypeInputSchema = z.enum(HEALTH_COMMONS_ENTITY_TYPES)
const healthCommonsStatusFilterSchema = z.enum(healthCommonsStatusFilterValues)

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
  status: z.array(healthCommonsStatusFilterSchema).min(1).optional(),
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
    includeBody: true,
  })

  return {
    schema: 'murph.health-commons.search-result.v1',
    corpus: healthCommonsPublicCorpus,
    diagnostics: buildHealthCommonsDiagnostics(reader),
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
      diagnostics: buildHealthCommonsDiagnostics(reader),
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
    diagnostics: buildHealthCommonsDiagnostics(reader),
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
  const listOptions = {
    categories: input.categories,
    limit: normalizeLimit(input.limit),
    query: input.query,
    statuses: input.status,
  }
  const normalizedFilters = reader.normalizeListOptions(listOptions)
  const protocols = reader.listProtocolVariants(listOptions)

  return {
    schema: 'murph.health-commons.list-protocols-result.v1',
    corpus: healthCommonsPublicCorpus,
    diagnostics: buildHealthCommonsDiagnostics(reader),
    note: healthCommonsPublicCorpusNote,
    filters: {
      query: normalizedFilters.query,
      categories: normalizedFilters.categories,
      status: normalizedFilters.statuses,
      ignoredWildcards: normalizedFilters.ignoredWildcards,
      limit: normalizedFilters.limit,
    },
    count: protocols.length,
    protocols: protocols.map((protocol) => decorateCompactEntity(protocol)),
  }
}

async function listHealthCommonsSources(input: HealthCommonsListSourcesInput) {
  const reader = getGeneratedHealthCommonsCatalogReader()
  const protocol = input.protocolKeyOrSlug
    ? resolveHealthCommonsEntity(input.protocolKeyOrSlug, ['protocol_variant'])
    : null
  if (
    input.protocolKeyOrSlug &&
    (!protocol || protocol.entityType !== 'protocol_variant')
  ) {
    const normalizedFilters = reader.normalizeListOptions({
      categories: input.categories,
      limit: normalizeLimit(input.limit),
      query: input.query,
    })
    return {
      schema: 'murph.health-commons.list-sources-result.v1',
      corpus: healthCommonsPublicCorpus,
      diagnostics: buildHealthCommonsDiagnostics(reader),
      note: healthCommonsPublicCorpusNote,
      filters: {
        protocolKeyOrSlug: input.protocolKeyOrSlug,
        query: normalizedFilters.query,
        categories: normalizedFilters.categories,
        ignoredWildcards: normalizedFilters.ignoredWildcards,
        limit: normalizedFilters.limit,
      },
      count: 0,
      sources: [],
    }
  }
  const listOptions = {
    candidateKeys: protocol ? reader.collectSourceKeys({ entity: protocol }) : undefined,
    categories: input.categories,
    limit: normalizeLimit(input.limit),
    query: input.query,
  }
  const normalizedFilters = reader.normalizeListOptions(listOptions)
  const sources = reader.listSourceArtifacts(listOptions)

  return {
    schema: 'murph.health-commons.list-sources-result.v1',
    corpus: healthCommonsPublicCorpus,
    diagnostics: buildHealthCommonsDiagnostics(reader),
    note: healthCommonsPublicCorpusNote,
    filters: {
      protocolKeyOrSlug: input.protocolKeyOrSlug ?? null,
      query: normalizedFilters.query,
      categories: normalizedFilters.categories,
      ignoredWildcards: normalizedFilters.ignoredWildcards,
      limit: normalizedFilters.limit,
    },
    count: sources.length,
    sources: sources.map((source) => decorateCompactEntity(source)),
  }
}

function buildHealthCommonsDiagnostics(reader: HealthCommonsCatalogReader) {
  return {
    catalogHash: reader.catalogHash,
    protocolVariantCount: reader.listByEntityType('protocol_variant').length,
    sourceArtifactCount: reader.listByEntityType('source_artifact').length,
    finnishDrySaunaPresent:
      reader.findByKey(FINNISH_DRY_SAUNA_KEY)?.title ?? null,
  }
}

function resolveHealthCommonsEntity(
  lookup: string,
  entityTypes: readonly HealthCommonsEntityType[] = HEALTH_COMMONS_ENTITY_TYPES,
): HealthCommonsEntity | null {
  const reader = getGeneratedHealthCommonsCatalogReader()
  const trimmed = lookup.trim()
  const direct =
    reader.findByKey(trimmed) ??
    reader.findBySlug(trimmed)

  if (direct && entityTypes.includes(direct.entityType)) {
    return direct
  }

  for (const entityType of entityTypes) {
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
