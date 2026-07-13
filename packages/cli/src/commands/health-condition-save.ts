import { Cli, z } from "incur";
import {
  CONDITION_CLINICAL_STATUSES,
  CONDITION_SEVERITIES,
  CONDITION_VERIFICATION_STATUSES,
} from "@murphai/contracts";
import type { upsertCondition } from "@murphai/core";
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

const conditionSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Expected a lowercase kebab-case slug.");
const conditionClinicalStatusSchema = z.enum(CONDITION_CLINICAL_STATUSES);
const conditionVerificationStatusSchema = z.enum(CONDITION_VERIFICATION_STATUSES);
const conditionSeveritySchema = z.enum(CONDITION_SEVERITIES);

export const conditionSaveResultSchema = z.object({
  vault: pathSchema,
  conditionId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
});

function repeatedOptionSchema(description: string) {
  return z.array(z.string().min(1)).optional().describe(description);
}

function buildConditionSaveInput(input: {
  assertedOn?: string;
  bodySite?: string[];
  clinicalStatus?: z.infer<typeof conditionClinicalStatusSchema>;
  conditionId?: string;
  note?: string;
  relatedGoalId?: string[];
  relatedRegimenId?: string[];
  resolvedOn?: string;
  severity?: z.infer<typeof conditionSeveritySchema>;
  slug?: string;
  title: string;
  vault: string;
  verificationStatus?: z.infer<typeof conditionVerificationStatusSchema>;
}): Parameters<typeof upsertCondition>[0] {
  return {
    vaultRoot: input.vault,
    conditionId: input.conditionId,
    slug: input.slug,
    title: input.title,
    clinicalStatus: input.clinicalStatus,
    verificationStatus: input.verificationStatus,
    assertedOn: input.assertedOn,
    resolvedOn: input.resolvedOn,
    severity: input.severity,
    bodySites: normalizeRepeatableFlagOption(input.bodySite, "body-site"),
    relatedGoalIds: normalizeRepeatableFlagOption(
      input.relatedGoalId,
      "related-goal-id",
    ),
    relatedRegimenIds: normalizeRepeatableFlagOption(
      input.relatedRegimenId,
      "related-regimen-id",
    ),
    note: input.note,
  };
}

function toConditionSaveResult(
  vault: string,
  result: Awaited<ReturnType<typeof upsertCondition>>,
) {
  return {
    vault,
    conditionId: String(result.record.entity.conditionId),
    lookupId: String(result.record.entity.conditionId),
    path: result.record.document.relativePath,
    created: Boolean(result.created),
  };
}

export function registerConditionSaveCommand(condition: Cli.Cli) {
  condition.command("save", {
    args: z.object({
      title: z.string().min(1).max(160).describe("Condition title or name."),
    }),
    description: "Create or update one condition from typed command fields.",
    examples: [
      {
        args: {
          title: "Seasonal allergies",
        },
        description: "Save a condition without a JSON payload file.",
        options: {
          assertedOn: "2026-03-12",
          clinicalStatus: "active",
          vault: "./vault",
          verificationStatus: "confirmed",
        },
      },
    ],
    hint: "Use condition import-json only when importing an advanced JSON payload from @file.json or stdin.",
    options: withBaseOptions({
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Optional existing condition id to update."),
      slug: conditionSlugSchema
        .optional()
        .describe("Optional stable lowercase kebab-case slug."),
      clinicalStatus: conditionClinicalStatusSchema
        .optional()
        .describe("Optional clinical status."),
      verificationStatus: conditionVerificationStatusSchema
        .optional()
        .describe("Optional verification status."),
      assertedOn: localDateSchema
        .optional()
        .describe("Optional calendar day when the condition was asserted."),
      resolvedOn: localDateSchema
        .optional()
        .describe("Optional calendar day when the condition resolved."),
      severity: conditionSeveritySchema
        .optional()
        .describe("Optional condition severity."),
      bodySite: repeatedOptionSchema(
        "Optional body site. Repeat --body-site for multiple values.",
      ),
      relatedGoalId: repeatedOptionSchema(
        "Optional related goal id. Repeat --related-goal-id for multiple values.",
      ),
      relatedRegimenId: repeatedOptionSchema(
        "Optional related regimen id. Repeat --related-regimen-id for multiple values.",
      ),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("Optional condition note."),
    }),
    output: conditionSaveResultSchema,
    async run(context) {
      const { upsertCondition } = await import("@murphai/core");
      const result = await upsertCondition(
        buildConditionSaveInput({
          conditionId: context.options.id,
          slug: context.options.slug,
          title: context.args.title,
          clinicalStatus: context.options.clinicalStatus,
          verificationStatus: context.options.verificationStatus,
          assertedOn: context.options.assertedOn,
          resolvedOn: context.options.resolvedOn,
          severity: context.options.severity,
          bodySite: context.options.bodySite,
          relatedGoalId: context.options.relatedGoalId,
          relatedRegimenId: context.options.relatedRegimenId,
          note: context.options.note,
          vault: context.options.vault,
        }),
      );
      const saved = toConditionSaveResult(context.options.vault, result);

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: "condition show",
            args: {
              id: saved.conditionId,
            },
            description: "Show the saved condition record.",
            options: {
              vault: true,
            },
          },
          {
            command: "condition list",
            description: "List conditions.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });
}

export function registerConditionCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const condition = createHealthEntityCrudGroup(services, "condition");
  registerConditionSaveCommand(condition);
  cli.command(condition);
}
