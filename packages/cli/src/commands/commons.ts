import { Cli, z } from "incur";
import {
  type HealthCommonsCatalogEntity,
} from "@murphai/contracts";
import {
  HEALTH_COMMONS_PAGE_STATUSES,
  getGeneratedHealthCommonsCatalogReader,
  type HealthCommonsCatalogReader,
} from "@murphai/health-commons/runtime";
import { emptyArgsSchema } from "@murphai/operator-config/command-helpers";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

const commonsPageStatusValues = HEALTH_COMMONS_PAGE_STATUSES;
const protocolEntityType = "protocol_variant" as const;
const familyEntityType = "experiment_family" as const;
const commonsProtocolEntityTypeValues = [
  protocolEntityType,
  familyEntityType,
] as const;

type CommonsProtocolEntityType = typeof commonsProtocolEntityTypeValues[number];
type CommonsProtocolEntity = HealthCommonsCatalogEntity & {
  entityType: CommonsProtocolEntityType;
};
type ProtocolEntity = HealthCommonsCatalogEntity & {
  entityType: typeof protocolEntityType;
};
type FamilyEntity = HealthCommonsCatalogEntity & {
  entityType: typeof familyEntityType;
};

const revisionSchema = z.object({
  pageRevisionId: z.string().min(1),
  recipeHash: z.string().min(1).nullable(),
  runSpecRevisionId: z.string().min(1).nullable(),
});

const commonsEntitySummarySchema = z.object({
  key: z.string().min(1),
  slug: z.string().min(1),
  entityType: z.enum(commonsProtocolEntityTypeValues),
  entityTypeLabel: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1).nullable(),
  status: z.string().min(1).nullable(),
  categories: z.array(z.string().min(1)),
  relativePath: z.string().min(1),
  revision: revisionSchema,
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

export function registerCommonsCommands(cli: Cli.Cli) {
  const commons = Cli.create("commons", {
    description:
      "Read-only Health Commons commands for public protocol variants and protocol-family exploration.",
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
        .map((protocol) => toEntitySummary(requireProtocolEntity(reader, protocol.key)));

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
        .default(5)
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

  commons.command(protocol);
  cli.command(commons);
}

function findCommonsEntity(
  reader: HealthCommonsCatalogReader,
  lookup: string,
  entityTypes: readonly CommonsProtocolEntityType[],
): CommonsProtocolEntity | undefined {
  const byKey =
    reader.findByKey(lookup) ??
    reader.findBySlug(lookup);

  if (byKey && hasProtocolEntityType(byKey, entityTypes)) {
    return byKey;
  }

  const routeMatch = uniqueEntityMatches(
    entityTypes.map((entityType) =>
      reader.findByRouteId({
        entityType,
        routeId: lookup,
      }),
    ),
  ).find((entity) => hasProtocolEntityType(entity, entityTypes));

  if (routeMatch) {
    return routeMatch;
  }

  const normalizedLookup = normalizeLookup(lookup);

  for (const entityType of entityTypes) {
    for (const entity of reader.listByEntityType(entityType)) {
      if (!hasProtocolEntityType(entity, entityTypes)) {
        continue;
      }

      if (
        normalizeLookup(entity.key) === normalizedLookup ||
        normalizeLookup(entity.slug) === normalizedLookup
      ) {
        return entity;
      }

      if ((entity.aliases ?? []).some((alias: string) => normalizeLookup(alias) === normalizedLookup)) {
        return entity;
      }
    }
  }

  return undefined;
}

function hasProtocolEntityType(
  entity: HealthCommonsCatalogEntity,
  entityTypes: readonly CommonsProtocolEntityType[],
): entity is CommonsProtocolEntity {
  return entityTypes.some((entityType) => entity.entityType === entityType);
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
    throw new Error(`Health Commons catalog referenced missing entity ${key}.`);
  }

  return entity;
}

function requireProtocolEntity(
  reader: HealthCommonsCatalogReader,
  key: string,
): ProtocolEntity {
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
): entity is ProtocolEntity {
  return entity.entityType === protocolEntityType;
}

function isFamilyEntity(
  entity: HealthCommonsCatalogEntity,
): entity is FamilyEntity {
  return entity.entityType === familyEntityType;
}

function toEntitySummary(entity: CommonsProtocolEntity) {
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

function toProtocolShowDetail(
  entity: ProtocolEntity,
) {
  const hasOnboarding = entity.experimentOnboarding !== undefined
    && entity.experimentOnboarding !== null;

  return {
    ...toEntitySummary(entity),
    experimentOnboarding: entity.experimentOnboarding ?? null,
    protocol: entity.protocol ?? null,
    safety: entity.safety ?? null,
    testPlans: entity.testPlans ?? [],
    whyItWorks: hasOnboarding ? [] : entity.whyItWorks ?? [],
  };
}

type ProtocolExploreMatchReason = "direct_protocol" | "direct_family" | "query_match";

type ProtocolExploreMatch = {
  matchReason: ProtocolExploreMatchReason;
  protocol: ProtocolEntity;
};

type ProtocolExploreVariant = {
  protocol: ProtocolEntity;
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
  protocol: ProtocolEntity,
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
): FamilyEntity[] {
  return (entity.relations ?? [])
    .filter((relation) => relation.type === "parent_family")
    .map((relation) => reader.findByKey(relation.target))
    .filter((target): target is FamilyEntity =>
      Boolean(target && target.entityType === familyEntityType),
    );
}

function protocolVariantsRelatedTo(
  reader: HealthCommonsCatalogReader,
  entity: HealthCommonsCatalogEntity,
): ProtocolEntity[] {
  return (entity.relations ?? [])
    .filter((relation) => relation.type === "related_protocol")
    .map((relation) => reader.findByKey(relation.target))
    .filter((target): target is ProtocolEntity =>
      Boolean(target && target.entityType === protocolEntityType),
    )
    .map((target) => target);
}

function protocolVariantsForFamily(
  reader: HealthCommonsCatalogReader,
  family: FamilyEntity,
  seenFamilyKeys = new Set<string>(),
): ProtocolEntity[] {
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
  family: FamilyEntity,
): FamilyEntity[] {
  return (family.relations ?? [])
    .filter((relation) => relation.type === "child_family")
    .map((relation) => reader.findByKey(relation.target))
    .filter((target): target is FamilyEntity =>
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
  protocol: ProtocolEntity,
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

function describeCommonsEntityType(entityType: CommonsProtocolEntityType): string {
  return entityType === protocolEntityType ? "protocol" : "experiment family";
}
