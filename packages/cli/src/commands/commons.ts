import { Cli, z } from "incur";
import {
  HEALTH_COMMONS_ENTITY_TYPES,
  isHealthCommonsEntityType,
  type HealthCommonsCatalogEntity,
  type HealthCommonsEntityType,
} from "@murphai/contracts";
import {
  HEALTH_COMMONS_PAGE_STATUSES,
  HEALTH_COMMONS_SOURCE_KINDS,
  getGeneratedHealthCommonsCatalogReader,
  type HealthCommonsCatalogReader,
} from "@murphai/health-commons/runtime";
import { emptyArgsSchema } from "@murphai/operator-config/command-helpers";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

const commonsEntityTypeValues = HEALTH_COMMONS_ENTITY_TYPES;
const commonsPageStatusValues = HEALTH_COMMONS_PAGE_STATUSES;
const commonsSourceKindValues = HEALTH_COMMONS_SOURCE_KINDS;
const protocolEntityType = "protocol_variant" as const;
const sourceEntityType = "source_artifact" as const;

const revisionSchema = z.object({
  pageRevisionId: z.string().min(1),
  recipeHash: z.string().min(1).nullable(),
  runSpecRevisionId: z.string().min(1).nullable(),
});

const commonsEntitySummarySchema = z.object({
  key: z.string().min(1),
  slug: z.string().min(1),
  entityType: z.enum(commonsEntityTypeValues),
  title: z.string().min(1),
  summary: z.string().min(1).nullable(),
  status: z.string().min(1).nullable(),
  categories: z.array(z.string().min(1)),
  relativePath: z.string().min(1),
  revision: revisionSchema,
});

const commonsSearchHitSchema = commonsEntitySummarySchema.extend({
  score: z.number().int().positive(),
  matchedFields: z.array(z.string().min(1)),
});

export const commonsSearchResultSchema = z.object({
  catalogHash: z.string().min(1),
  query: z.string().min(1),
  filters: z.object({
    text: z.string().min(1),
    entityTypes: z.array(z.enum(commonsEntityTypeValues)),
    limit: z.number().int().positive().max(200),
  }),
  total: z.number().int().nonnegative(),
  hits: z.array(commonsSearchHitSchema),
});

export const commonsProtocolListResultSchema = z.object({
  catalogHash: z.string().min(1),
  filters: z.object({
    query: z.string().min(1).nullable(),
    status: z.string().min(1).nullable(),
    categories: z.array(z.string().min(1)),
    limit: z.number().int().positive().max(500),
  }),
  total: z.number().int().nonnegative(),
  protocols: z.array(commonsEntitySummarySchema),
});

export const commonsProtocolShowResultSchema = z.object({
  catalogHash: z.string().min(1),
  lookup: z.string().min(1),
  protocol: commonsEntitySummarySchema.extend({
    aliases: z.array(z.string().min(1)),
    attribution: z.unknown().nullable(),
    body: z.string(),
    experimentOnboarding: z.unknown().nullable(),
    lineage: z.unknown().nullable(),
    protocol: z.unknown().nullable(),
    safety: z.unknown().nullable(),
    testPlans: z.array(z.unknown()),
    whyItWorks: z.array(z.string().min(1)),
  }),
});

const sourceSummarySchema = commonsEntitySummarySchema.extend({
  source: z.object({
    authors: z.string().min(1).nullable(),
    citation: z.string().min(1).nullable(),
    kind: z.string().min(1).nullable(),
    title: z.string().min(1).nullable(),
    url: z.string().min(1).nullable(),
    year: z.number().int().nullable(),
  }),
});

export const commonsSourceListResultSchema = z.object({
  catalogHash: z.string().min(1),
  filters: z.object({
    query: z.string().min(1).nullable(),
    kind: z.string().min(1).nullable(),
    protocol: z.string().min(1).nullable(),
    status: z.string().min(1).nullable(),
    limit: z.number().int().positive().max(500),
  }),
  total: z.number().int().nonnegative(),
  sources: z.array(sourceSummarySchema),
});

type CommonsEntityType = (typeof commonsEntityTypeValues)[number];
type SourceArtifactEntity = HealthCommonsCatalogEntity & {
  entityType: typeof sourceEntityType;
  source: NonNullable<HealthCommonsCatalogEntity["source"]>;
};

export function registerCommonsCommands(cli: Cli.Cli) {
  const commons = Cli.create("commons", {
    description:
      "Read-only Health Commons commands for public protocol variants, source pages, and catalog search.",
  });

  commons.command("search", {
    description:
      "Search the public Health Commons catalog without reading or writing private vault protocols.",
    args: z.object({
      query: z
        .string()
        .min(1)
        .optional()
        .describe("Search text. Required when `--text` is omitted."),
    }),
    options: z.object({
      text: z
        .string()
        .min(1)
        .optional()
        .describe("Named search text alias for machine-oriented calls."),
      type: z
        .array(z.string().min(1))
        .optional()
        .describe(
          `Optional Health Commons entity type filter. Repeat --type for multiple values: ${commonsEntityTypeValues.join(", ")}.`,
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(20)
        .describe("Maximum number of catalog hits to return."),
    }),
    examples: [
      {
        description: "Search public protocol variants and source pages for sauna.",
        args: {
          query: "sauna",
        },
      },
      {
        description: "Limit search to public protocol variants.",
        args: {
          query: "norwegian 4x4",
        },
        options: {
          type: ["protocol_variant"],
        },
      },
    ],
    hint:
      "Use `commons protocol show` after a hit when you need the exact public protocol variant and revision ids. Use `protocol` for private vault protocols.",
    output: commonsSearchResultSchema,
    async run({ args, options }) {
      const reader = getGeneratedHealthCommonsCatalogReader();
      const text = normalizeCommonsQuery({
        namedQuery: options.text,
        positionalQuery: args.query,
        commandName: "commons search",
      });
      const entityTypes = normalizeEntityTypes(options.type);
      const hits = reader.search({
        query: text,
        entityTypes: entityTypes.length > 0 ? entityTypes : undefined,
        limit: options.limit,
        includeBody: true,
      });

      return {
        catalogHash: reader.catalogHash,
        query: text,
        filters: {
          text,
          entityTypes,
          limit: options.limit,
        },
        total: hits.length,
        hits: hits.map((hit) => {
          const entity = requireCatalogEntity(reader, hit.entity.key);
          return {
            ...toEntitySummary(entity),
            matchedFields: [...hit.matchedFields],
            score: Math.max(1, Math.round(hit.score)),
          };
        }),
      };
    },
  });

  const protocol = Cli.create("protocol", {
    description:
      "Read public Health Commons protocol variants. Private vault protocols stay under the top-level protocol command.",
  });

  protocol.command("list", {
    description:
      "List public Health Commons protocol variants with optional text, status, and category filters.",
    args: emptyArgsSchema,
    options: z.object({
      query: z
        .string()
        .min(1)
        .optional()
        .describe("Optional text filter over protocol title, summary, aliases, categories, and body."),
      status: z
        .string()
        .min(1)
        .optional()
        .describe(`Optional Health Commons page status filter: ${commonsPageStatusValues.join(", ")}. Use * for all.`),
      category: z
        .array(z.string().min(1))
        .optional()
        .describe("Optional protocol category filter. Repeat --category for multiple values."),
      limit: z
        .number()
        .int()
        .positive()
        .max(500)
        .default(50)
        .describe("Maximum number of public protocol variants to return."),
    }),
    examples: [
      {
        description: "List public protocol variants related to sauna.",
        options: {
          query: "sauna",
          limit: 10,
        },
      },
    ],
    output: commonsProtocolListResultSchema,
    async run({ options }) {
      const reader = getGeneratedHealthCommonsCatalogReader();
      const listOptions = {
        categories: options.category,
        limit: options.limit,
        query: options.query,
        statuses: options.status ? [options.status] : undefined,
      };
      const normalizedFilters = reader.normalizeListOptions(listOptions);
      const protocols = reader
        .listProtocolVariants(listOptions)
        .map((protocol) => toEntitySummary(requireCatalogEntity(reader, protocol.key)));

      return {
        catalogHash: reader.catalogHash,
        filters: {
          query: normalizedFilters.query,
          status: normalizedFilters.statuses[0] ?? null,
          categories: [...normalizedFilters.categories],
          limit: normalizedFilters.limit,
        },
        total: protocols.length,
        protocols,
      };
    },
  });

  protocol.command("show", {
    description:
      "Show one public Health Commons protocol variant by key, slug, or alias, including exact revision ids.",
    args: z.object({
      key: z
        .string()
        .min(1)
        .describe("Health Commons protocol key, slug, or alias."),
    }),
    options: z.object({}),
    examples: [
      {
        description: "Show the public Norwegian 4x4 protocol variant.",
        args: {
          key: "protocol_variant:norwegian-4x4/norwegian-4x4",
        },
      },
    ],
    output: commonsProtocolShowResultSchema,
    async run({ args }) {
      const reader = getGeneratedHealthCommonsCatalogReader();
      const entity = findCommonsEntity(reader, args.key);

      if (!entity || !isProtocolEntity(entity)) {
        throw new VaultCliError(
          "commons_protocol_not_found",
          `No public Health Commons protocol variant matched "${args.key}".`,
        );
      }

      return {
        catalogHash: reader.catalogHash,
        lookup: args.key,
        protocol: {
          ...toEntitySummary(entity),
          aliases: entity.aliases ?? [],
          attribution: entity.attribution ?? null,
          body: entity.body,
          experimentOnboarding: entity.experimentOnboarding ?? null,
          lineage: entity.lineage ?? null,
          protocol: entity.protocol ?? null,
          safety: entity.safety ?? null,
          testPlans: entity.testPlans ?? [],
          whyItWorks: entity.whyItWorks ?? [],
        },
      };
    },
  });

  const source = Cli.create("source", {
    description: "Read public Health Commons source pages.",
  });

  source.command("list", {
    description:
      "List public Health Commons source artifacts with optional text, kind, and status filters.",
    args: emptyArgsSchema,
    options: z.object({
      query: z
        .string()
        .min(1)
        .optional()
        .describe("Optional text filter over source title, summary, citation, and body."),
      kind: z
        .string()
        .min(1)
        .optional()
        .describe(`Optional source kind filter: ${commonsSourceKindValues.join(", ")}. Use * for all.`),
      protocol: z
        .string()
        .min(1)
        .optional()
        .describe("Optional public Health Commons protocol key, slug, or route id to list only sources backing that protocol."),
      status: z
        .string()
        .min(1)
        .optional()
        .describe(`Optional Health Commons page status filter: ${commonsPageStatusValues.join(", ")}. Use * for all.`),
      limit: z
        .number()
        .int()
        .positive()
        .max(500)
        .default(50)
        .describe("Maximum number of source pages to return."),
    }),
    examples: [
      {
        description: "List sauna-related public source pages.",
        options: {
          query: "sauna",
          limit: 10,
        },
      },
    ],
    output: commonsSourceListResultSchema,
    async run({ options }) {
      const reader = getGeneratedHealthCommonsCatalogReader();
      const protocol = options.protocol
        ? findCommonsEntity(reader, options.protocol, [protocolEntityType])
        : null;
      const candidateKeys = options.protocol
        ? protocol && isProtocolEntity(protocol)
          ? reader.collectSourceKeys({ entity: protocol })
          : []
        : undefined;
      const listOptions = {
        candidateKeys,
        limit: options.limit,
        query: options.query,
        sourceKinds: options.kind ? [options.kind] : undefined,
        statuses: options.status ? [options.status] : undefined,
      };
      const normalizedFilters = reader.normalizeListOptions(listOptions);
      const sources = reader
        .listSourceArtifacts(listOptions)
        .map((source) => toSourceSummary(requireSourceEntity(reader, source.key)));

      return {
        catalogHash: reader.catalogHash,
        filters: {
          query: normalizedFilters.query,
          kind: normalizedFilters.sourceKinds[0] ?? null,
          protocol: options.protocol ?? null,
          status: normalizedFilters.statuses[0] ?? null,
          limit: normalizedFilters.limit,
        },
        total: sources.length,
        sources,
      };
    },
  });

  commons.command(protocol);
  commons.command(source);
  cli.command(commons);
}

function normalizeCommonsQuery(input: {
  commandName: string;
  namedQuery?: string;
  positionalQuery?: string;
}): string {
  const positionalQuery = input.positionalQuery?.trim();
  const namedQuery = input.namedQuery?.trim();

  if (input.positionalQuery !== undefined && !positionalQuery) {
    throw new VaultCliError(
      "invalid_query",
      "Positional Health Commons search text must not be blank.",
    );
  }

  if (input.namedQuery !== undefined && !namedQuery) {
    throw new VaultCliError(
      "invalid_query",
      "Health Commons search text passed to `--text` must not be blank.",
    );
  }

  if (positionalQuery && namedQuery && positionalQuery !== namedQuery) {
    throw new VaultCliError(
      "invalid_query",
      "Positional Health Commons search text and `--text` must match when both are provided.",
    );
  }

  const text = positionalQuery ?? namedQuery;
  if (!text) {
    throw new VaultCliError(
      "invalid_query",
      `Search text is required for \`${input.commandName}\`.`,
    );
  }

  return text;
}

function normalizeEntityTypes(input: string[] | undefined): HealthCommonsEntityType[] {
  const values = normalizeRepeatableStrings(input);
  const entityTypes: HealthCommonsEntityType[] = [];

  for (const value of values) {
    if (!isHealthCommonsEntityType(value)) {
      throw new VaultCliError(
        "invalid_entity_type",
        `Unknown Health Commons entity type "${value}". Expected one of: ${commonsEntityTypeValues.join(", ")}.`,
      );
    }
    entityTypes.push(value);
  }

  return entityTypes;
}

function normalizeRepeatableStrings(input: string[] | undefined): string[] {
  if (!input) {
    return [];
  }

  return input
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function findCommonsEntity(
  reader: HealthCommonsCatalogReader,
  lookup: string,
  entityTypes: readonly HealthCommonsEntityType[] = commonsEntityTypeValues,
): HealthCommonsCatalogEntity | undefined {
  const byKey =
    reader.findByKey(lookup) ??
    reader.findBySlug(lookup);

  if (byKey && entityTypes.includes(byKey.entityType)) {
    return byKey;
  }

  const routeMatch = uniqueEntityMatches(
    entityTypes.map((entityType) =>
      reader.findByRouteId({
        entityType,
        routeId: lookup,
      }),
    ),
  )[0];

  if (routeMatch) {
    return routeMatch;
  }

  const normalizedLookup = normalizeLookup(lookup);

  return entityTypes.flatMap((entityType) => reader.listByEntityType(entityType)).find((entity) => {
    if (
      normalizeLookup(entity.key) === normalizedLookup ||
      normalizeLookup(entity.slug) === normalizedLookup
    ) {
      return true;
    }

    return (entity.aliases ?? []).some(
      (alias: string) => normalizeLookup(alias) === normalizedLookup,
    );
  });
}

function uniqueEntityMatches(
  matches: readonly (HealthCommonsCatalogEntity | null)[],
): HealthCommonsCatalogEntity[] {
  const entities: HealthCommonsCatalogEntity[] = [];
  const seen = new Set<string>();

  for (const entity of matches) {
    if (!entity || seen.has(entity.key)) {
      continue;
    }

    seen.add(entity.key);
    entities.push(entity);
  }

  return entities;
}

function requireCatalogEntity(
  reader: HealthCommonsCatalogReader,
  key: string,
): HealthCommonsCatalogEntity {
  const entity = reader.findByKey(key);
  if (!entity) {
    throw new Error(`Health Commons catalog search returned missing entity ${key}.`);
  }

  return entity;
}

function requireSourceEntity(
  reader: HealthCommonsCatalogReader,
  key: string,
): SourceArtifactEntity {
  const entity = requireCatalogEntity(reader, key);
  if (!isSourceEntity(entity)) {
    throw new Error(`Health Commons catalog source list returned non-source entity ${key}.`);
  }

  return entity;
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function isProtocolEntity(
  entity: HealthCommonsCatalogEntity,
): entity is HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType } {
  return entity.entityType === protocolEntityType;
}

function isSourceEntity(
  entity: HealthCommonsCatalogEntity,
): entity is SourceArtifactEntity {
  return entity.entityType === sourceEntityType && entity.source !== undefined;
}

function toEntitySummary(entity: HealthCommonsCatalogEntity) {
  return {
    key: entity.key,
    slug: entity.slug,
    entityType: entity.entityType,
    title: entity.title,
    summary: entity.summary ?? null,
    status: entity.status ?? null,
    categories: entity.categories ?? [],
    relativePath: entity.relativePath,
    revision: {
      pageRevisionId: entity.revision.pageRevisionId,
      recipeHash: entity.revision.recipeHash ?? null,
      runSpecRevisionId: entity.revision.runSpecRevisionId ?? null,
    },
  };
}

function toSourceSummary(entity: SourceArtifactEntity) {
  return {
    ...toEntitySummary(entity),
    source: {
      authors: entity.source.authors ?? null,
      citation: entity.source.citation ?? null,
      kind: entity.source.kind ?? null,
      title: entity.source.title ?? null,
      url: entity.source.url ?? null,
      year: entity.source.year ?? null,
    },
  };
}

function queryMatchedCatalogEntities(
  reader: HealthCommonsCatalogReader,
  input: {
    entityType: CommonsEntityType;
    query?: string;
  },
): HealthCommonsCatalogEntity[] {
  if (!input.query) {
    return reader.listByEntityType(input.entityType);
  }

  return reader
    .search({
      entityTypes: [input.entityType],
      includeBody: true,
      limit: 500,
      query: input.query,
    })
    .map((hit) => requireCatalogEntity(reader, hit.entity.key));
}
