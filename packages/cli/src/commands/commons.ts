import { Cli, z } from "incur";
import {
  HEALTH_COMMONS_PAGE_STATUSES,
  HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT,
  getGeneratedHealthCommonsProtocolFamilyGraphReader,
  getGeneratedHealthCommonsProtocolIndexReader,
  getGeneratedHealthCommonsProtocolRunSpecReader,
  searchGeneratedHealthCommonsKnowledge,
  type HealthCommonsProtocolEntitySummary,
  type HealthCommonsProtocolFamilyGraphReader,
  type HealthCommonsProtocolIndexEntry,
  type HealthCommonsProtocolRunSpec,
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
type CommonsProtocolEntity =
  | HealthCommonsProtocolEntitySummary
  | HealthCommonsProtocolIndexEntry
  | HealthCommonsProtocolRunSpec;
type ProtocolEntity = HealthCommonsProtocolIndexEntry;

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

const commonsKnowledgeItemSchema = z.object({
  caveat: z.string().min(1).nullable(),
  entityKey: z.string().min(1),
  entityTitle: z.string().min(1),
  kind: z.enum(["claim", "safety", "source_finding"]),
  strength: z.string().min(1).nullable(),
  text: z.string().min(1),
  sources: z.array(z.object({
    authors: z.string().min(1).nullable(),
    designKind: z.string().min(1).nullable(),
    doi: z.string().min(1).nullable(),
    participantCount: z.number().int().nonnegative().nullable(),
    pmid: z.string().min(1).nullable(),
    sourceKey: z.string().min(1),
    title: z.string().min(1),
    url: z.string().url().nullable(),
    year: z.number().int().nullable(),
  })),
});

export const commonsKnowledgeSearchResultSchema = z.object({
  available: z.boolean(),
  candidates: z.array(z.object({
    key: z.string().min(1),
    title: z.string().min(1),
  })).max(3),
  items: z.array(commonsKnowledgeItemSchema),
  query: z.string().min(1),
  safety: commonsKnowledgeItemSchema.nullable(),
  topic: z.object({
    key: z.string().min(1),
    title: z.string().min(1),
  }).nullable(),
  warning: z.string().min(1).nullable(),
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

  const knowledge = Cli.create("knowledge", {
    description:
      "Search bounded source-backed Health Commons knowledge without starting an experiment.",
  });

  knowledge.command("search", {
    description:
      "Return a small source-backed evidence and safety packet for one complete health question.",
    args: z.object({
      query: z.string().min(2).max(500),
    }),
    options: z.object({
      limit: z.number().int().positive().max(HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT).default(3),
    }),
    examples: [{
      description: "Find evidence and safety context about dry sauna.",
      args: {
        query: "Does Finnish dry sauna help immunity, and is it safe after recent fainting?",
      },
      options: { limit: 3 },
    }],
    output: commonsKnowledgeSearchResultSchema,
    run({ args, options }) {
      try {
        return commonsKnowledgeSearchResultSchema.parse({
          available: true,
          ...searchGeneratedHealthCommonsKnowledge({
            limit: options.limit,
            query: args.query,
          }),
          warning: null,
        });
      } catch {
        return commonsKnowledgeSearchResultSchema.parse({
          available: false,
          candidates: [],
          items: [],
          query: args.query,
          safety: null,
          topic: null,
          warning: "Health Commons knowledge index is unavailable; continue without corpus context.",
        });
      }
    },
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
        .default(10)
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
      const reader = getGeneratedHealthCommonsProtocolIndexReader();
      const listOptions = {
        categories: options.category,
        limit: options.limit,
        query: options.query,
        statuses: options.status ? [options.status] : undefined,
      };
      const normalizedFilters = reader.normalizeListOptions(listOptions);
      const protocols = reader
        .listProtocols(listOptions)
        .map(toEntitySummary);

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
      const reader = getGeneratedHealthCommonsProtocolRunSpecReader();
      const entity = reader.findByLookup(args.key);

      if (!entity) {
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
      const reader = getGeneratedHealthCommonsProtocolFamilyGraphReader();
      const matchedEntity = reader.findEntity({
        entityTypes: [familyEntityType, protocolEntityType],
        lookup: args.lookup,
      });
      const matchedProtocols = reader.listProtocolMatches({
        limit: options.limit,
        lookup: args.lookup,
      });
      const groups = matchedProtocols.map((entry) =>
        buildProtocolExploreGroup(reader, entry.protocol, entry.matchReason),
      );
      const starterCandidate = chooseProtocolExploreStarterCandidate({
        matchedEntity,
        groups,
      });

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
  commons.command(knowledge);
  cli.command(commons);
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
  entity: HealthCommonsProtocolRunSpec,
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

type ProtocolExploreVariant<TProtocol extends { key: string }> = {
  protocol: TProtocol;
  traits: ProtocolEntity["traits"];
};

function buildProtocolExploreGroup(
  reader: HealthCommonsProtocolFamilyGraphReader,
  protocol: ProtocolEntity,
  matchReason: ProtocolExploreMatchReason,
) {
  const parentFamilies = reader.parentFamilies(protocol);
  const relatedProtocolVariants = uniqueProtocolVariants([
    ...reader.relatedProtocolVariants(protocol).map((relatedProtocol) => ({
      protocol: relatedProtocol,
      traits: relatedProtocol.traits,
    })),
    ...parentFamilies.flatMap((family) =>
      reader.protocolVariantsForFamily(family).map((relatedProtocol) => ({
        protocol: relatedProtocol,
        traits: relatedProtocol.traits,
      })),
    ),
  ])
    .filter((variant) => variant.protocol.key !== protocol.key)
    .map((variant) => ({
      protocol: toEntitySummary(variant.protocol),
      traits: variant.traits,
    }));
  const traits = protocol.traits;

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

function chooseProtocolExploreStarterCandidate(input: {
  matchedEntity: CommonsProtocolEntity | null;
  groups: ReturnType<typeof buildProtocolExploreGroup>[];
}) {
  if (input.matchedEntity === null) {
    return input.groups[0]?.starterCandidate ?? null;
  }

  return chooseStarterCandidate(
    uniqueProtocolVariants(input.groups.flatMap((group) => [
      {
        protocol: group.matchedProtocol,
        traits: group.traits,
      },
      ...group.relatedProtocolVariants,
    ])),
  );
}

function uniqueProtocolVariants<TProtocol extends { key: string }>(
  input: readonly ProtocolExploreVariant<TProtocol>[],
): ProtocolExploreVariant<TProtocol>[] {
  const variants: ProtocolExploreVariant<TProtocol>[] = [];
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
    traits: ProtocolEntity["traits"];
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
  traits: ProtocolEntity["traits"];
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

function describeCommonsEntityType(entityType: CommonsProtocolEntityType): string {
  return entityType === protocolEntityType ? "protocol" : "experiment family";
}
