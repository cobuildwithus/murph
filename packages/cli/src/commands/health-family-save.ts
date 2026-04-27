import { Cli, z } from "incur";
import {
  ID_PREFIXES,
  isContractId,
} from "@murphai/contracts";
import {
  upsertFamilyMember,
} from "@murphai/core";
import { withBaseOptions } from "@murphai/operator-config/command-helpers";
import { pathSchema } from "@murphai/operator-config/vault-cli-contracts";
import { normalizeRepeatableFlagOption } from "@murphai/vault-usecases";
import { suggestedCommandsCta } from "./command-factory-primitives.js";
import type { VaultServices } from "@murphai/vault-usecases";
import {
  createHealthEntityCrudGroup,
} from "./health-entity-command-registry.js";

const familySlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Expected a lowercase kebab-case slug.");
const variantIdSchema = z
  .string()
  .refine(
    (value) => isContractId(value, ID_PREFIXES.variant),
    `Expected a genetic variant id matching ${ID_PREFIXES.variant}_<ULID>.`,
  );

function repeatedFamilyOptionSchema(description: string) {
  return z.array(z.string().min(1)).optional().describe(description);
}

function repeatedVariantOptionSchema(description: string) {
  return z.array(variantIdSchema).optional().describe(description);
}

export const familySaveResultSchema = z.object({
  vault: pathSchema,
  familyMemberId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
});

function buildFamilySaveInput(input: {
  condition?: string[];
  deceased?: boolean;
  familyMemberId?: string;
  note?: string;
  relatedVariantId?: string[];
  relationship: string;
  slug?: string;
  title: string;
  vault: string;
}): Parameters<typeof upsertFamilyMember>[0] {
  return {
    vaultRoot: input.vault,
    familyMemberId: input.familyMemberId,
    slug: input.slug,
    title: input.title,
    relationship: input.relationship,
    conditions: normalizeRepeatableFlagOption(input.condition, "condition"),
    deceased: input.deceased,
    relatedVariantIds: normalizeRepeatableFlagOption(
      input.relatedVariantId,
      "related-variant-id",
    ),
    note: input.note,
  };
}

function toFamilySaveResult(
  vault: string,
  result: Awaited<ReturnType<typeof upsertFamilyMember>>,
) {
  const familyMemberId = String(result.record.entity.familyMemberId);

  return {
    vault,
    familyMemberId,
    lookupId: familyMemberId,
    path: result.record.document.relativePath,
    created: Boolean(result.created),
  };
}

export function registerFamilySaveCommand(family: Cli.Cli) {
  family.command("save", {
    args: z.object({
      title: z.string().min(1).max(160).describe("Family member title or name."),
    }),
    description: "Create or update one family member from typed command fields.",
    examples: [
      {
        args: {
          title: "Mother",
        },
        description: "Save a family member without a JSON payload file.",
        options: {
          condition: ["hypertension"],
          relationship: "mother",
          vault: "./vault",
        },
      },
    ],
    hint: "Use family import-json only when importing an advanced JSON payload from @file.json or stdin.",
    options: withBaseOptions({
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Optional existing family member id to update."),
      slug: familySlugSchema
        .optional()
        .describe("Optional stable lowercase kebab-case slug."),
      relationship: z
        .string()
        .min(1)
        .max(160)
        .describe("Family relationship label, such as mother, father, sibling, or maternal uncle."),
      condition: repeatedFamilyOptionSchema(
        "Optional family-history condition. Repeat --condition for multiple values.",
      ),
      deceased: z
        .boolean()
        .optional()
        .describe("Optional deceased flag for this family member."),
      relatedVariantId: repeatedVariantOptionSchema(
        "Optional related genetic variant id. Repeat --related-variant-id for multiple values.",
      ),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("Optional note about this family member."),
    }),
    output: familySaveResultSchema,
    async run(context) {
      const result = await upsertFamilyMember(
        buildFamilySaveInput({
          familyMemberId: context.options.id,
          title: context.args.title,
          slug: context.options.slug,
          relationship: context.options.relationship,
          condition: context.options.condition,
          deceased: context.options.deceased,
          relatedVariantId: context.options.relatedVariantId,
          note: context.options.note,
          vault: context.options.vault,
        }),
      );
      const saved = toFamilySaveResult(context.options.vault, result);

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: "family show",
            args: {
              id: saved.familyMemberId,
            },
            description: "Show the saved family member.",
            options: {
              vault: true,
            },
          },
          {
            command: "family list",
            description: "List family members.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });
}

export function registerFamilyCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const family = createHealthEntityCrudGroup(services, "family");
  registerFamilySaveCommand(family);
  cli.command(family);
}
