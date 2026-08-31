import { Cli, z } from "incur";
import {
  GOAL_HORIZONS,
  GOAL_STATUSES,
  commonsGoalRefSchema,
} from "@murphai/contracts";
import type { upsertGoal } from "@murphai/core";
import { getGeneratedHealthCommonsWebGoalIndex } from "@murphai/health-commons/runtime";
import { withBaseOptions } from "@murphai/operator-config/command-helpers";
import { localDateSchema, pathSchema } from "@murphai/operator-config/vault-cli-contracts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  normalizeRepeatableFlagOption,
  type VaultServices,
} from "@murphai/vault-usecases";
import {
  createHealthEntityCrudGroup,
} from "./health-entity-command-registry.js";
import { suggestedCommandsCta } from "./command-factory-primitives.js";

const goalSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Expected a lowercase kebab-case slug.");
const goalStatusSchema = z.enum(GOAL_STATUSES);
const goalHorizonSchema = z.enum(GOAL_HORIZONS);

export const goalSaveResultSchema = z.object({
  vault: pathSchema,
  goalId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
});

function repeatedRelationOptionSchema(description: string) {
  return z.array(z.string().min(1)).optional().describe(description);
}

function buildGoalWindow(input: {
  startAt?: string;
  targetAt?: string;
}): Parameters<typeof upsertGoal>[0]["window"] {
  if (input.startAt === undefined && input.targetAt === undefined) {
    return undefined;
  }

  return {
    startAt: input.startAt,
    targetAt: input.targetAt,
  };
}

function buildCommonsGoalRef(input: {
  key?: string;
  pageRevisionId?: string;
  workflowSpecRevisionId?: string;
}): Parameters<typeof upsertGoal>[0]["commonsGoalRef"] {
  const values = [input.key, input.pageRevisionId, input.workflowSpecRevisionId];
  const suppliedCount = values.filter((value) => value !== undefined).length;

  if (suppliedCount === 0) {
    return undefined;
  }
  if (suppliedCount !== values.length) {
    throw new VaultCliError(
      "invalid_option",
      "--commons-goal-key, --commons-page-revision-id, and --commons-workflow-revision-id must be provided together.",
    );
  }

  const parsed = commonsGoalRefSchema.safeParse({
    key: input.key,
    pageRevisionId: input.pageRevisionId,
    workflowSpecRevisionId: input.workflowSpecRevisionId,
  });
  if (!parsed.success) {
    throw new VaultCliError(
      "invalid_option",
      "Health Commons goal lineage must use a goal_template key and exact sha256 revision ids.",
    );
  }

  let index: ReturnType<typeof getGeneratedHealthCommonsWebGoalIndex>;
  try {
    index = getGeneratedHealthCommonsWebGoalIndex();
  } catch {
    throw new VaultCliError(
      "commons_goal_artifact_unavailable",
      "Health Commons goal guides are unavailable; regenerate the packaged Health Commons artifacts and retry.",
    );
  }

  const current = index.goals.find((goal) => goal.key === parsed.data.key);
  if (!current) {
    throw new VaultCliError(
      "commons_goal_not_found",
      `Health Commons goal ${parsed.data.key} is not available. Show the goal again before saving.`,
    );
  }

  if (
    current.revision.pageRevisionId !== parsed.data.pageRevisionId ||
    current.revision.workflowSpecRevisionId !== parsed.data.workflowSpecRevisionId
  ) {
    throw new VaultCliError(
      "invalid_option",
      `Health Commons goal ${parsed.data.key} changed after this setup was prepared. Show the goal again and reopen any changed setup before saving.`,
    );
  }

  return parsed.data;
}

function buildGoalSaveInput(input: {
  commonsGoalKey?: string;
  commonsPageRevisionId?: string;
  commonsWorkflowRevisionId?: string;
  domain?: string[];
  goalId?: string;
  horizon?: z.infer<typeof goalHorizonSchema>;
  parentGoalId?: string;
  priority?: number;
  relatedExperimentId?: string[];
  relatedGoalId?: string[];
  slug?: string;
  startAt?: string;
  status?: z.infer<typeof goalStatusSchema>;
  targetAt?: string;
  title?: string;
  vault: string;
}): Parameters<typeof upsertGoal>[0] {
  return {
    vaultRoot: input.vault,
    goalId: input.goalId,
    slug: input.slug,
    title: input.title,
    status: input.status,
    horizon: input.horizon,
    priority: input.priority,
    window: buildGoalWindow(input),
    parentGoalId: input.parentGoalId,
    relatedGoalIds: normalizeRepeatableFlagOption(
      input.relatedGoalId,
      "related-goal-id",
    ),
    relatedExperimentIds: normalizeRepeatableFlagOption(
      input.relatedExperimentId,
      "related-experiment-id",
    ),
    commonsGoalRef: buildCommonsGoalRef({
      key: input.commonsGoalKey,
      pageRevisionId: input.commonsPageRevisionId,
      workflowSpecRevisionId: input.commonsWorkflowRevisionId,
    }),
    domains: normalizeRepeatableFlagOption(input.domain, "domain"),
  };
}

function toGoalSaveResult(
  vault: string,
  result: Awaited<ReturnType<typeof upsertGoal>>,
) {
  return {
    vault,
    goalId: String(result.record.entity.goalId),
    lookupId: String(result.record.entity.goalId),
    path: result.record.document.relativePath,
    created: Boolean(result.created),
  };
}

export function registerGoalCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const goal = createHealthEntityCrudGroup(services, "goal");

  goal.command("save", {
    args: z.object({
      title: z.string().min(1).max(160).optional().describe("Goal title or name."),
    }),
    description: "Create or update one goal from typed command fields.",
    examples: [
      {
        args: {
          title: "Sleep through the night",
        },
        description: "Save a goal without a JSON payload file.",
        options: {
          domain: ["sleep"],
          horizon: "long_term",
          priority: 2,
          status: "active",
          vault: "./vault",
        },
      },
    ],
    hint: "Use goal import-json only when importing an advanced JSON payload from @file.json or stdin.",
    options: withBaseOptions({
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Optional existing goal id to update."),
      slug: goalSlugSchema
        .optional()
        .describe("Optional stable lowercase kebab-case slug."),
      status: goalStatusSchema.optional().describe("Optional goal status."),
      horizon: goalHorizonSchema.optional().describe("Optional goal horizon."),
      priority: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Optional goal priority from 1 to 10."),
      startAt: localDateSchema
        .optional()
        .describe("Optional goal window start date."),
      targetAt: localDateSchema
        .optional()
        .describe("Optional goal window target date."),
      parentGoalId: z
        .string()
        .min(1)
        .optional()
        .describe("Optional parent goal id."),
      relatedGoalId: repeatedRelationOptionSchema(
        "Optional related goal id. Repeat --related-goal-id for multiple values.",
      ),
      relatedExperimentId: repeatedRelationOptionSchema(
        "Optional related experiment id. Repeat --related-experiment-id for multiple values.",
      ),
      commonsGoalKey: z
        .string()
        .min(1)
        .optional()
        .describe("Public Health Commons goal_template key used to create this private goal."),
      commonsPageRevisionId: z
        .string()
        .min(1)
        .optional()
        .describe("Exact Health Commons goal page sha256 revision id."),
      commonsWorkflowRevisionId: z
        .string()
        .min(1)
        .optional()
        .describe("Exact Health Commons goal workflow sha256 revision id."),
      domain: repeatedRelationOptionSchema(
        "Optional goal domain. Repeat --domain for multiple values.",
      ),
    }),
    output: goalSaveResultSchema,
    async run(context) {
      if (context.args.title === undefined && context.options.id === undefined) {
        throw new VaultCliError(
          "invalid_option",
          "A goal title is required when creating a goal. Omit the title only when updating an existing goal with --id.",
        );
      }
      const { upsertGoal } = await import("@murphai/core");
      const result = await upsertGoal(
        buildGoalSaveInput({
          goalId: context.options.id,
          title: context.args.title,
          slug: context.options.slug,
          status: context.options.status,
          horizon: context.options.horizon,
          priority: context.options.priority,
          startAt: context.options.startAt,
          targetAt: context.options.targetAt,
          parentGoalId: context.options.parentGoalId,
          relatedGoalId: context.options.relatedGoalId,
          relatedExperimentId: context.options.relatedExperimentId,
          commonsGoalKey: context.options.commonsGoalKey,
          commonsPageRevisionId: context.options.commonsPageRevisionId,
          commonsWorkflowRevisionId: context.options.commonsWorkflowRevisionId,
          domain: context.options.domain,
          vault: context.options.vault,
        }),
      );
      const saved = toGoalSaveResult(context.options.vault, result);

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: "goal show",
            args: {
              id: saved.goalId,
            },
            description: "Show the saved goal record.",
            options: {
              vault: true,
            },
          },
          {
            command: "goal list",
            description: "List goals.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });

  cli.command(goal);
}
