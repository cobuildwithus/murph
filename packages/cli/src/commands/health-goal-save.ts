import { Cli, z } from "incur";
import { GOAL_HORIZONS, GOAL_STATUSES } from "@murphai/contracts";
import type { upsertGoal } from "@murphai/core";
import { withBaseOptions } from "@murphai/operator-config/command-helpers";
import { localDateSchema, pathSchema } from "@murphai/operator-config/vault-cli-contracts";
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

function buildGoalSaveInput(input: {
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
  title: string;
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
      title: z.string().min(1).max(160).describe("Goal title or name."),
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
      domain: repeatedRelationOptionSchema(
        "Optional goal domain. Repeat --domain for multiple values.",
      ),
    }),
    output: goalSaveResultSchema,
    async run(context) {
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
