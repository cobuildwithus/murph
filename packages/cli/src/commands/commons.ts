import { Cli, z } from "incur";
import {
  HEALTH_COMMONS_GOAL_CATEGORIES,
} from "@murphai/contracts";
import {
  HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT,
  getGeneratedHealthCommonsWebGoalIndex,
  searchGeneratedHealthCommonsKnowledge,
} from "@murphai/health-commons/runtime";
import { emptyArgsSchema } from "@murphai/operator-config/command-helpers";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

type CommonsGoalIndexEntry = ReturnType<
  typeof getGeneratedHealthCommonsWebGoalIndex
>["goals"][number];
type CommonsKnowledgeItem = ReturnType<
  typeof searchGeneratedHealthCommonsKnowledge
>["items"][number];

const goalRevisionSchema = z.object({
  pageRevisionId: z.string().min(1),
  workflowSpecRevisionId: z.string().min(1),
});

const commonsGoalSummarySchema = z.object({
  aliases: z.array(z.string().min(1)),
  category: z.enum(HEALTH_COMMONS_GOAL_CATEGORIES),
  goalPhrase: z.string().min(1),
  indexable: z.literal(true),
  key: z.string().min(1),
  outcomeKind: z.string().min(1),
  parentGoalKey: z.string().min(1).nullable(),
  quality: z.string().min(1),
  revision: goalRevisionSchema,
  routeId: z.string().min(1),
  safetyTier: z.string().min(1),
  slug: z.string().min(1),
  startPrompt: z.string().min(1),
  status: z.string().min(1),
  sources: z.array(z.object({
    label: z.string().min(1),
    url: z.string().url().startsWith("https://"),
  })).min(2),
  successSignals: z.array(z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    label: z.string().min(1),
  })),
  summary: z.string().min(1),
  title: z.string().min(1),
  workflow: z.object({
    kind: z.string().min(1),
    ownerSkillIds: z.array(z.string().min(1)).min(1),
  }),
});

// List rows carry only what matching needs; `commons goal show` owns the guide.
export const commonsGoalListResultSchema = z.object({
  total: z.number().int().nonnegative(),
  goals: z.array(z.object({
    key: z.string().min(1),
    title: z.string().min(1),
    goalPhrase: z.string().min(1),
    aliases: z.array(z.string().min(1)),
  })),
});

export const commonsGoalShowResultSchema = z.object({
  catalogHash: z.string().min(1),
  lookup: z.string().min(1),
  goal: commonsGoalSummarySchema,
});

// Entity fields appear only when an item belongs to a topic member other than
// the resolved topic itself.
const commonsKnowledgeItemSchema = z.object({
  kind: z.enum(["claim", "safety", "source_finding"]),
  text: z.string().min(1),
  caveat: z.string().min(1).nullable(),
  strength: z.string().min(1).nullable(),
  entityKey: z.string().min(1).optional(),
  entityTitle: z.string().min(1).optional(),
  sources: z.array(z.object({
    title: z.string().min(1),
    year: z.number().int().nullable(),
    designKind: z.string().min(1).nullable(),
    url: z.string().url().nullable(),
  })).min(1).max(4),
});

// `warning` is present only when the generated index is unavailable.
export const commonsKnowledgeSearchResultSchema = z.object({
  topic: z.object({
    key: z.string().min(1),
    title: z.string().min(1),
  }).nullable(),
  candidates: z.array(z.object({
    key: z.string().min(1),
    title: z.string().min(1),
  })).max(3),
  items: z.array(commonsKnowledgeItemSchema).max(HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT),
  safety: commonsKnowledgeItemSchema.nullable(),
  warning: z.string().min(1).optional(),
});

export function registerCommonsCommands(cli: Cli.Cli) {
  const commons = Cli.create("commons", {
    description:
      "Read-only Health Commons commands for public goals and evidence.",
  });

  const goal = Cli.create("goal", {
    description:
      "Find public outcome guides. Private member goals stay under the top-level goal command.",
  });

  const knowledge = Cli.create("knowledge", {
    description:
      "Search bounded source-backed Health Commons knowledge without starting an experiment.",
  });

  goal.command("list", {
    description:
      "List public Health Commons outcome guides with optional text and category filters.",
    args: emptyArgsSchema,
    options: z.object({
      query: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional text filter over title, goal phrase, summary, aliases, and category."),
      category: z
        .array(z.enum(HEALTH_COMMONS_GOAL_CATEGORIES))
        .optional()
        .describe("Optional goal category. Repeat --category for multiple values."),
      limit: z
        .number()
        .int()
        .positive()
        .max(500)
        .default(10)
        .describe("Maximum number of public goal guides to return."),
    }),
    examples: [{
      description: "Find goals related to resting heart rate.",
      options: {
        query: "resting heart rate",
        limit: 5,
      },
    }],
    output: commonsGoalListResultSchema,
    run({ options }) {
      let index: ReturnType<typeof getGeneratedHealthCommonsWebGoalIndex>;
      try {
        index = getGeneratedHealthCommonsWebGoalIndex();
      } catch {
        throw new VaultCliError(
          "commons_goal_artifact_unavailable",
          "Health Commons goal guides are unavailable; regenerate the packaged Health Commons artifacts and retry.",
        );
      }

      const query = options.query?.trim() || null;
      const normalizedQuery = query === null ? null : normalizeCommonsGoalText(query);
      const categories = options.category ?? [];
      const goals = index.goals
        .filter((entry) => categories.length === 0 || categories.includes(entry.category))
        .filter((entry) => {
          if (normalizedQuery === null) {
            return true;
          }
          if (!normalizedQuery) {
            return false;
          }
          return commonsGoalSearchValues(entry)
            .some((value) => normalizeCommonsGoalText(value).includes(normalizedQuery));
        });

      return {
        total: goals.length,
        goals: goals.slice(0, options.limit).map((entry) => ({
          key: entry.key,
          title: entry.title,
          goalPhrase: entry.goalPhrase,
          aliases: entry.aliases,
        })),
      };
    },
  });

  goal.command("show", {
    description:
      "Show one compact public Health Commons outcome guide by key, slug, route id, or alias, including exact revision ids.",
    args: z.object({
      key: z.string().trim().min(1).describe("Health Commons goal key, slug, route id, or alias."),
    }),
    options: z.object({}),
    examples: [{
      description: "Show the public resting-heart-rate goal guide.",
      args: { key: "lower-resting-heart-rate" },
    }],
    output: commonsGoalShowResultSchema,
    run({ args }) {
      let index: ReturnType<typeof getGeneratedHealthCommonsWebGoalIndex>;
      try {
        index = getGeneratedHealthCommonsWebGoalIndex();
      } catch {
        throw new VaultCliError(
          "commons_goal_artifact_unavailable",
          "Health Commons goal guides are unavailable; regenerate the packaged Health Commons artifacts and retry.",
        );
      }

      const normalizedLookup = normalizeCommonsGoalText(args.key);
      const matches = normalizedLookup
        ? index.goals.filter((entry) =>
            commonsGoalLookupValues(entry)
              .some((value) => normalizeCommonsGoalText(value) === normalizedLookup)
          )
        : [];
      const match = matches.length === 1 ? matches[0] : null;
      if (!match) {
        throw new VaultCliError(
          "commons_goal_not_found",
          `No public Health Commons goal guide matched "${args.key}".`,
        );
      }

      return {
        catalogHash: index.catalogHash,
        lookup: args.key,
        goal: toGoalSummary(match),
      };
    },
  });

  knowledge.command("search", {
    description:
      "Return a small source-backed evidence and safety packet for one complete health question.",
    args: z.object({
      query: z.string().trim().min(2).max(500).regex(/[\p{L}\p{N}]/u),
    }),
    options: z.object({
      limit: z.number().int().positive().max(HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT).default(3),
    }),
    examples: [{
      description: "Find evidence and safety context about dry sauna.",
      args: {
        query: "How should I track deep sleep minutes?",
      },
      options: { limit: 3 },
    }],
    output: commonsKnowledgeSearchResultSchema,
    run({ args, options }) {
      let result: ReturnType<typeof searchGeneratedHealthCommonsKnowledge>;
      try {
        result = searchGeneratedHealthCommonsKnowledge({
          limit: options.limit,
          query: args.query,
        });
      } catch {
        return commonsKnowledgeSearchResultSchema.parse({
          topic: null,
          candidates: [],
          items: [],
          safety: null,
          warning: "Health Commons knowledge index is unavailable; continue without corpus context.",
        });
      }
      const topicKey = result.topic?.key ?? null;
      return commonsKnowledgeSearchResultSchema.parse({
        topic: result.topic,
        candidates: result.candidates,
        items: result.items.map((item) => toCompactKnowledgeItem(item, topicKey)),
        safety: result.safety && toCompactKnowledgeItem(result.safety, topicKey),
      });
    },
  });

  commons.command(goal);
  commons.command(knowledge);
  cli.command(commons);
}

function toGoalSummary(
  entry: CommonsGoalIndexEntry,
) {
  return {
    aliases: entry.aliases,
    category: entry.category,
    goalPhrase: entry.goalPhrase,
    indexable: true as const,
    key: entry.key,
    outcomeKind: entry.outcomeKind,
    parentGoalKey: entry.parentGoalKey,
    quality: entry.quality,
    revision: {
      pageRevisionId: entry.revision.pageRevisionId,
      workflowSpecRevisionId: entry.revision.workflowSpecRevisionId,
    },
    routeId: entry.routeId,
    safetyTier: entry.safetyTier,
    slug: entry.slug,
    startPrompt: entry.startPrompt,
    status: entry.status,
    sources: entry.sources,
    successSignals: entry.successSignals,
    summary: entry.summary,
    title: entry.title,
    workflow: entry.workflow,
  };
}

function toCompactKnowledgeItem(item: CommonsKnowledgeItem, topicKey: string | null) {
  return {
    kind: item.kind,
    text: item.text,
    caveat: item.caveat,
    strength: item.strength,
    ...(item.entityKey === topicKey
      ? {}
      : { entityKey: item.entityKey, entityTitle: item.entityTitle }),
    sources: item.sources.map((source) => ({
      title: source.title,
      year: source.year,
      designKind: source.designKind,
      url: source.url
        ?? (source.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/` : null)
        ?? (source.doi ? `https://doi.org/${source.doi}` : null),
    })),
  };
}

function commonsGoalLookupValues(entry: CommonsGoalIndexEntry): readonly string[] {
  return [
    entry.key,
    entry.slug,
    entry.routeId,
    entry.title,
    entry.goalPhrase,
    entry.startPrompt,
    ...entry.aliases,
  ];
}

function commonsGoalSearchValues(entry: CommonsGoalIndexEntry): readonly string[] {
  return [
    ...commonsGoalLookupValues(entry),
    entry.summary,
    entry.category,
  ];
}

function normalizeCommonsGoalText(value: string): string {
  const words = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);

  return (words ?? [])
    .join(" ")
    .replace(/\b(?:v o 2|vo 2)\b/gu, "vo2")
    .replace(/\b(?:r h r|rhr)\b/gu, "resting heart rate")
    .replace(/\biron man\b/gu, "ironman");
}
