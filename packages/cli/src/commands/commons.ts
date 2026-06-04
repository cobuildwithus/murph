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
const familyEntityType = "experiment_family" as const;
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
  entityTypeLabel: z.string().min(1),
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
    experimentOnboarding: z.unknown().nullable(),
    protocol: z.unknown().nullable(),
    safety: z.unknown().nullable(),
    testPlans: z.array(z.unknown()),
    whyItWorks: z.array(z.string().min(1)),
  }),
});

const protocolTraitsSchema = z.object({
  cautionLevel: z.string().min(1).nullable(),
  externalProtocol: z.boolean(),
  highCaution: z.boolean(),
  murphCanonical: z.boolean(),
  sourceAttributed: z.boolean(),
});

const protocolExploreVariantSchema = z.object({
  protocol: commonsEntitySummarySchema,
  traits: protocolTraitsSchema,
});

export const commonsProtocolExploreResultSchema = z.object({
  catalogHash: z.string().min(1),
  lookup: z.string().min(1),
  filters: z.object({
    query: z.string().min(1).nullable(),
    limit: z.number().int().positive().max(100),
  }),
  matchedEntity: commonsEntitySummarySchema.nullable(),
  starterCandidate: protocolExploreVariantSchema.nullable(),
  groups: z.array(z.object({
    matchedProtocol: commonsEntitySummarySchema,
    matchReason: z.enum(["direct_protocol", "direct_family", "query_match"]),
    traits: protocolTraitsSchema,
    parentFamilies: z.array(commonsEntitySummarySchema),
    relatedProtocolVariants: z.array(protocolExploreVariantSchema),
    starterCandidate: protocolExploreVariantSchema.nullable(),
  })),
});

export const commonsGetResultSchema = z.object({
  catalogHash: z.string().min(1),
  lookup: z.string().min(1),
  entity: commonsEntitySummarySchema.extend({
    aliases: z.array(z.string().min(1)),
    attribution: z.unknown().nullable(),
    biomarker: z.unknown().nullable(),
    body: z.string(),
    experimentOnboarding: z.unknown().nullable(),
    lineage: z.unknown().nullable(),
    measurementMethod: z.unknown().nullable(),
    measurementPlan: z.unknown().nullable(),
    protocol: z.unknown().nullable(),
    safety: z.unknown().nullable(),
    source: z.unknown().nullable(),
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

type SourceArtifactEntity = HealthCommonsCatalogEntity & {
  entityType: typeof sourceEntityType;
  source: NonNullable<HealthCommonsCatalogEntity["source"]>;
};

export function registerCommonsCommands(cli: Cli.Cli) {
  const commons = Cli.create("commons", {
    description:
      "Read-only Health Commons commands for public protocols, biomarkers, sources, measurement methods, and catalog search.",
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
        .default(5)
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
      "Use `commons protocol show` after a hit when you need the exact public protocol variant and revision ids. Use top-level `protocol` only for saved private adaptations.",
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

  commons.command("get", {
    description:
      "Show one public Health Commons entity by key, slug, or route id, including measurement-method and protocol measurement-plan fields when present.",
    args: z.object({
      key: z
        .string()
        .min(1)
        .describe("Health Commons key, slug, or route id."),
    }),
    options: z.object({
      type: z
        .string()
        .min(1)
        .optional()
        .describe(
          `Optional Health Commons entity type disambiguator: ${commonsEntityTypeValues.join(", ")}.`,
        ),
    }),
    examples: [
      {
        description: "Show a public protocol by route id.",
        args: {
          key: "finnish-sauna",
        },
      },
      {
        description: "Show a public measurement method by route id.",
        args: {
          key: "standardized-photo-score-workflow",
        },
        options: {
          type: "measurement_method",
        },
      },
    ],
    hint:
      "Measurement methods are separate Health Commons entities; do not treat them as biomarkers or outcome pages.",
    output: commonsGetResultSchema,
    async run({ args, options }) {
      const reader = getGeneratedHealthCommonsCatalogReader();
      const entityTypes = options.type ? normalizeEntityTypes([options.type]) : undefined;
      const entity = findCommonsEntity(reader, args.key, entityTypes);

      if (!entity) {
        const typeSuffix = entityTypes && entityTypes.length > 0
          ? ` with type ${entityTypes.join(", ")}`
          : "";
        throw new VaultCliError(
          "commons_entity_not_found",
          `No public Health Commons entity matched "${args.key}"${typeSuffix}.`,
        );
      }

      return {
        catalogHash: reader.catalogHash,
        lookup: args.key,
        entity: toEntityDetail(entity),
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
      const entity = findCommonsEntity(reader, args.key, [protocolEntityType]);

      if (!entity || !isProtocolEntity(entity)) {
        throw new VaultCliError(
          "commons_protocol_not_found",
          `No public Health Commons protocol variant matched "${args.key}".`,
        );
      }

      return {
        catalogHash: reader.catalogHash,
        lookup: args.key,
        protocol: toProtocolShowDetail(entity),
      };
    },
  });

  protocol.command("explore", {
    description:
      "Explore protocol-family context for a public Health Commons protocol query, key, slug, or family.",
    args: z.object({
      lookup: z
        .string()
        .min(1)
        .describe("Protocol query, protocol key/slug/alias, or experiment-family key/slug/alias."),
    }),
    options: z.object({
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .default(10)
        .describe("Maximum number of matched protocol groups to return before family expansion."),
    }),
    examples: [
      {
        description: "Explore sauna protocol variants and family context.",
        args: {
          lookup: "sauna",
        },
      },
      {
        description: "Explore variants related to the dry-sauna family.",
        args: {
          lookup: "dry-sauna",
        },
      },
    ],
    hint:
      "Use this during experiment onboarding when a broad query or named protocol may have lower-burden family variants.",
    output: commonsProtocolExploreResultSchema,
    async run({ args, options }) {
      const reader = getGeneratedHealthCommonsCatalogReader();
      const matchedEntity = findCommonsEntity(reader, args.lookup, [
        familyEntityType,
        protocolEntityType,
      ]);
      const matchedProtocols = resolveProtocolExploreMatches({
        limit: options.limit,
        lookup: args.lookup,
        matchedEntity,
        reader,
      });
      const groups = matchedProtocols.map((entry) =>
        buildProtocolExploreGroup(reader, entry.protocol, entry.matchReason),
      );
      const starterCandidate = chooseStarterCandidate(
        uniqueProtocolVariants(groups.flatMap((group) => [
          {
            protocol: requireProtocolEntity(reader, group.matchedProtocol.key),
            traits: group.traits,
          },
          ...group.relatedProtocolVariants.map((variant) => ({
            protocol: requireProtocolEntity(reader, variant.protocol.key),
            traits: variant.traits,
          })),
        ])).map((entry) => ({
          protocol: toEntitySummary(entry.protocol),
          traits: entry.traits,
        })),
      );

      return {
        catalogHash: reader.catalogHash,
        lookup: args.lookup,
        filters: {
          query: matchedEntity ? null : args.lookup,
          limit: options.limit,
        },
        matchedEntity: matchedEntity ? toEntitySummary(matchedEntity) : null,
        starterCandidate,
        groups,
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

function requireProtocolEntity(
  reader: HealthCommonsCatalogReader,
  key: string,
): HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType } {
  const entity = requireCatalogEntity(reader, key);
  if (!isProtocolEntity(entity)) {
    throw new Error(`Health Commons protocol exploration returned non-protocol entity ${key}.`);
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

function isFamilyEntity(
  entity: HealthCommonsCatalogEntity,
): entity is HealthCommonsCatalogEntity & { entityType: typeof familyEntityType } {
  return entity.entityType === familyEntityType;
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
    entityTypeLabel: describeCommonsEntityType(entity.entityType),
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

function toEntityDetail(entity: HealthCommonsCatalogEntity) {
  return {
    ...toEntitySummary(entity),
    aliases: entity.aliases ?? [],
    attribution: entity.attribution ?? null,
    biomarker: entity.biomarker ?? null,
    body: entity.body,
    experimentOnboarding: entity.experimentOnboarding ?? null,
    lineage: entity.lineage ?? null,
    measurementMethod: entity.measurementMethod ?? null,
    measurementPlan:
      entity.entityType === protocolEntityType
        ? entity.measurementPlan ?? null
        : null,
    protocol: entity.protocol ?? null,
    safety: entity.safety ?? null,
    source: entity.source ?? null,
    testPlans: entity.testPlans ?? [],
    whyItWorks: entity.whyItWorks ?? [],
  };
}

function toProtocolShowDetail(
  entity: HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType },
) {
  const hasOnboarding = entity.experimentOnboarding !== undefined
    && entity.experimentOnboarding !== null;

  return {
    ...toEntitySummary(entity),
    experimentOnboarding: toProtocolShowOnboarding(entity.experimentOnboarding),
    protocol: hasOnboarding ? null : entity.protocol ?? null,
    safety: hasOnboarding ? null : entity.safety ?? null,
    testPlans: hasOnboarding ? [] : entity.testPlans ?? [],
    whyItWorks: hasOnboarding ? [] : entity.whyItWorks ?? [],
  };
}

function toProtocolShowOnboarding(value: unknown): unknown | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    return value;
  }

  return {
    setupSlots: value.setupSlots ?? null,
    safetyScreen: value.safetyScreen ?? null,
    planDefaults: value.planDefaults ?? null,
    logging: value.logging ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

type ProtocolExploreMatchReason = "direct_protocol" | "direct_family" | "query_match";

type ProtocolExploreMatch = {
  matchReason: ProtocolExploreMatchReason;
  protocol: HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType };
};

type ProtocolExploreVariant = {
  protocol: HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType };
  traits: ReturnType<typeof toProtocolTraits>;
};

function resolveProtocolExploreMatches(input: {
  limit: number;
  lookup: string;
  matchedEntity: HealthCommonsCatalogEntity | undefined;
  reader: HealthCommonsCatalogReader;
}): ProtocolExploreMatch[] {
  if (input.matchedEntity && isProtocolEntity(input.matchedEntity)) {
    return [{
      matchReason: "direct_protocol",
      protocol: input.matchedEntity,
    }];
  }

  if (input.matchedEntity && isFamilyEntity(input.matchedEntity)) {
    return protocolVariantsForFamily(input.reader, input.matchedEntity)
      .slice(0, input.limit)
      .map((protocol) => ({
        matchReason: "direct_family",
        protocol,
      }));
  }

  return input.reader
    .listProtocolVariants({
      limit: input.limit,
      query: input.lookup,
    })
    .map((protocol) => ({
      matchReason: "query_match",
      protocol: requireProtocolEntity(input.reader, protocol.key),
    }));
}

function buildProtocolExploreGroup(
  reader: HealthCommonsCatalogReader,
  protocol: HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType },
  matchReason: ProtocolExploreMatchReason,
) {
  const parentFamilies = parentFamilyEntities(reader, protocol);
  const relatedProtocolVariants = uniqueProtocolVariants([
    ...protocolVariantsRelatedTo(reader, protocol).map((relatedProtocol) => ({
      protocol: relatedProtocol,
      traits: toProtocolTraits(relatedProtocol),
    })),
    ...parentFamilies.flatMap((family) =>
      protocolVariantsForFamily(reader, family).map((relatedProtocol) => ({
        protocol: relatedProtocol,
        traits: toProtocolTraits(relatedProtocol),
      })),
    ),
  ])
    .filter((variant) => variant.protocol.key !== protocol.key)
    .map((variant) => ({
      protocol: toEntitySummary(variant.protocol),
      traits: variant.traits,
    }));
  const traits = toProtocolTraits(protocol);

  return {
    matchedProtocol: toEntitySummary(protocol),
    matchReason,
    traits,
    parentFamilies: parentFamilies.map(toEntitySummary),
    relatedProtocolVariants,
    starterCandidate: chooseStarterCandidate([
      {
        protocol: toEntitySummary(protocol),
        traits,
      },
      ...relatedProtocolVariants,
    ]),
  };
}

function parentFamilyEntities(
  reader: HealthCommonsCatalogReader,
  entity: HealthCommonsCatalogEntity,
): HealthCommonsCatalogEntity[] {
  return (entity.relations ?? [])
    .filter((relation) => relation.type === "parent_family")
    .map((relation) => reader.findByKey(relation.target))
    .filter((target): target is HealthCommonsCatalogEntity =>
      Boolean(target && target.entityType === familyEntityType),
    );
}

function protocolVariantsRelatedTo(
  reader: HealthCommonsCatalogReader,
  entity: HealthCommonsCatalogEntity,
): (HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType })[] {
  return (entity.relations ?? [])
    .filter((relation) => relation.type === "related_protocol")
    .map((relation) => reader.findByKey(relation.target))
    .filter((target): target is HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType } =>
      Boolean(target && target.entityType === protocolEntityType),
    )
    .map((target) => target);
}

function protocolVariantsForFamily(
  reader: HealthCommonsCatalogReader,
  family: HealthCommonsCatalogEntity,
  seenFamilyKeys = new Set<string>(),
): (HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType })[] {
  if (seenFamilyKeys.has(family.key)) {
    return [];
  }

  seenFamilyKeys.add(family.key);
  const directRelated = protocolVariantsRelatedTo(reader, family);
  const byParentFamily = reader.listByEntityType(protocolEntityType)
    .map((entity) => requireProtocolEntity(reader, entity.key))
    .filter((protocol) =>
      (protocol.relations ?? []).some((relation) =>
        relation.type === "parent_family" && relation.target === family.key,
      ),
    );
  const fromChildFamilies = childFamilyEntities(reader, family).flatMap(
    (childFamily) => protocolVariantsForFamily(reader, childFamily, seenFamilyKeys),
  );

  return uniqueProtocolVariants([
    ...directRelated.map((protocol) => ({
      protocol,
      traits: toProtocolTraits(protocol),
    })),
    ...byParentFamily.map((protocol) => ({
      protocol,
      traits: toProtocolTraits(protocol),
    })),
    ...fromChildFamilies.map((protocol) => ({
      protocol,
      traits: toProtocolTraits(protocol),
    })),
  ]).map((variant) => variant.protocol);
}

function childFamilyEntities(
  reader: HealthCommonsCatalogReader,
  family: HealthCommonsCatalogEntity,
): HealthCommonsCatalogEntity[] {
  return (family.relations ?? [])
    .filter((relation) => relation.type === "child_family")
    .map((relation) => reader.findByKey(relation.target))
    .filter((target): target is HealthCommonsCatalogEntity =>
      Boolean(target && target.entityType === familyEntityType),
    );
}

function uniqueProtocolVariants(
  input: readonly ProtocolExploreVariant[],
): ProtocolExploreVariant[] {
  const variants: ProtocolExploreVariant[] = [];
  const seen = new Set<string>();

  for (const variant of input) {
    if (seen.has(variant.protocol.key)) {
      continue;
    }

    seen.add(variant.protocol.key);
    variants.push(variant);
  }

  return variants;
}

function chooseStarterCandidate(
  variants: readonly {
    protocol: ReturnType<typeof toEntitySummary>;
    traits: ReturnType<typeof toProtocolTraits>;
  }[],
) {
  const sorted = variants.slice().sort((left, right) => {
    const scoreDelta = protocolStarterScore(right) - protocolStarterScore(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.protocol.title.localeCompare(right.protocol.title);
  });

  return sorted[0] ?? null;
}

function protocolStarterScore(input: {
  protocol: ReturnType<typeof toEntitySummary>;
  traits: ReturnType<typeof toProtocolTraits>;
}): number {
  let score = 0;

  if (input.traits.murphCanonical) {
    score += 100;
  }
  if (!input.traits.externalProtocol && !input.traits.sourceAttributed) {
    score += 20;
  }
  if (input.protocol.status === "field-testing") {
    score += 5;
  }
  if (input.traits.cautionLevel === "low") {
    score += 6;
  } else if (input.traits.cautionLevel === "moderate") {
    score += 3;
  } else if (input.traits.highCaution) {
    score -= 5;
  }

  return score;
}

function toProtocolTraits(
  protocol: HealthCommonsCatalogEntity & { entityType: typeof protocolEntityType },
) {
  const categories = new Set(protocol.categories ?? []);
  const cautionLevel = extractCautionLevel(protocol.safety);

  return {
    cautionLevel,
    externalProtocol: categories.has("external-protocol"),
    highCaution: cautionLevel === "high",
    murphCanonical: categories.has("murph-canonical"),
    sourceAttributed: categories.has("source-attributed"),
  };
}

function extractCautionLevel(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const cautionLevel = (value as { cautionLevel?: unknown }).cautionLevel;
  return typeof cautionLevel === "string" && cautionLevel.trim()
    ? cautionLevel.trim()
    : null;
}

function describeCommonsEntityType(entityType: HealthCommonsEntityType): string {
  switch (entityType) {
    case "mission":
      return "mission";
    case "domain":
      return "domain";
    case "biomarker":
      return "biomarker";
    case "measurement_method":
      return "measurement method";
    case "goal_template":
      return "goal template";
    case "experiment_family":
      return "experiment family";
    case "protocol_variant":
      return "protocol";
    case "source_person":
      return "source person";
    case "source_artifact":
      return "source";
    case "disambiguation":
      return "disambiguation";
  }

  return "entity";
}
