import { Cli, z } from "incur";
import { ALLERGY_CRITICALITIES, ALLERGY_STATUSES } from "@murphai/contracts";
import type { upsertAllergy } from "@murphai/core";
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

const allergySlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Expected a lowercase kebab-case slug.");
const allergyStatusSchema = z.enum(ALLERGY_STATUSES);
const allergyCriticalitySchema = z.enum(ALLERGY_CRITICALITIES);

export const allergySaveResultSchema = z.object({
  vault: pathSchema,
  allergyId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
});

function repeatedRelationOptionSchema(description: string) {
  return z.array(z.string().min(1)).optional().describe(description);
}

function buildAllergySaveInput(input: {
  allergyId?: string;
  criticality?: z.infer<typeof allergyCriticalitySchema>;
  note?: string;
  reaction?: string;
  recordedOn?: string;
  relatedConditionId?: string[];
  slug?: string;
  status?: z.infer<typeof allergyStatusSchema>;
  substance: string;
  title: string;
  vault: string;
}): Parameters<typeof upsertAllergy>[0] {
  return {
    vaultRoot: input.vault,
    allergyId: input.allergyId,
    slug: input.slug,
    title: input.title,
    substance: input.substance,
    status: input.status,
    criticality: input.criticality,
    reaction: input.reaction,
    recordedOn: input.recordedOn,
    relatedConditionIds: normalizeRepeatableFlagOption(
      input.relatedConditionId,
      "related-condition-id",
    ),
    note: input.note,
  };
}

function toAllergySaveResult(
  vault: string,
  result: Awaited<ReturnType<typeof upsertAllergy>>,
) {
  return {
    vault,
    allergyId: String(result.record.entity.allergyId),
    lookupId: String(result.record.entity.allergyId),
    path: result.record.document.relativePath,
    created: Boolean(result.created),
  };
}

export function registerAllergyCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const allergy = createHealthEntityCrudGroup(services, "allergy");

  allergy.command("save", {
    args: z.object({
      title: z.string().min(1).max(160).describe("Allergy title or name."),
    }),
    description: "Create or update one allergy from typed command fields.",
    examples: [
      {
        args: {
          title: "Peanut allergy",
        },
        description: "Save an allergy without a JSON payload file.",
        options: {
          criticality: "high",
          reaction: "Hives",
          substance: "Peanut",
          vault: "./vault",
        },
      },
    ],
    hint: "Use allergy import-json only when importing an advanced JSON payload from @file.json or stdin.",
    options: withBaseOptions({
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Optional existing allergy id to update."),
      slug: allergySlugSchema
        .optional()
        .describe("Optional stable lowercase kebab-case slug."),
      substance: z
        .string()
        .min(1)
        .max(160)
        .describe("Allergy substance, such as Peanut or Penicillin."),
      status: allergyStatusSchema.optional().describe("Optional allergy status."),
      criticality: allergyCriticalitySchema
        .optional()
        .describe("Optional allergy criticality."),
      reaction: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional reaction summary."),
      recordedOn: localDateSchema
        .optional()
        .describe("Optional calendar day when the allergy was recorded."),
      relatedConditionId: repeatedRelationOptionSchema(
        "Optional related condition id. Repeat --related-condition-id for multiple values.",
      ),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("Optional allergy note."),
    }),
    output: allergySaveResultSchema,
    async run(context) {
      const { upsertAllergy } = await import("@murphai/core");
      const result = await upsertAllergy(
        buildAllergySaveInput({
          allergyId: context.options.id,
          title: context.args.title,
          slug: context.options.slug,
          substance: context.options.substance,
          status: context.options.status,
          criticality: context.options.criticality,
          reaction: context.options.reaction,
          recordedOn: context.options.recordedOn,
          relatedConditionId: context.options.relatedConditionId,
          note: context.options.note,
          vault: context.options.vault,
        }),
      );
      const saved = toAllergySaveResult(context.options.vault, result);

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: "allergy show",
            args: {
              id: saved.allergyId,
            },
            description: "Show the saved allergy record.",
            options: {
              vault: true,
            },
          },
          {
            command: "allergy list",
            description: "List allergies.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });

  cli.command(allergy);
}
