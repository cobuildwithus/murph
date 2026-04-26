import { Cli, z } from "incur";
import {
  ID_PREFIXES,
  isContractId,
  VARIANT_SIGNIFICANCES,
  VARIANT_ZYGOSITIES,
} from "@murphai/contracts";
import { upsertGeneticVariant } from "@murphai/core";
import { withBaseOptions } from "@murphai/operator-config/command-helpers";
import { pathSchema } from "@murphai/operator-config/vault-cli-contracts";
import {
  normalizeRepeatableFlagOption,
  type VaultServices,
} from "@murphai/vault-usecases";
import {
  createHealthEntityCrudGroup,
} from "./health-entity-command-registry.js";
import { suggestedCommandsCta } from "./command-factory-primitives.js";

const geneticVariantSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Expected a lowercase kebab-case slug.");
const geneticVariantIdSchema = z
  .string()
  .refine(
    (value) => isContractId(value, ID_PREFIXES.variant),
    `Expected a genetic variant id matching ${ID_PREFIXES.variant}_<ULID>.`,
  );
const familyMemberIdSchema = z
  .string()
  .refine(
    (value) => isContractId(value, ID_PREFIXES.family),
    `Expected a family member id matching ${ID_PREFIXES.family}_<ULID>.`,
  );
const geneticVariantZygositySchema = z.enum(VARIANT_ZYGOSITIES);
const geneticVariantSignificanceSchema = z.enum(VARIANT_SIGNIFICANCES);

export const geneticsSaveResultSchema = z.object({
  vault: pathSchema,
  variantId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
});

function repeatedFamilyMemberOptionSchema(description: string) {
  return z.array(familyMemberIdSchema).optional().describe(description);
}

function toGeneticsSaveResult(
  vault: string,
  result: Awaited<ReturnType<typeof upsertGeneticVariant>>,
) {
  return {
    vault,
    variantId: String(result.record.entity.variantId),
    lookupId: String(result.record.entity.variantId),
    path: result.record.document.relativePath,
    created: Boolean(result.created),
  };
}

export function registerGeneticsCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const genetics = createHealthEntityCrudGroup(services, "genetics", {
    jsonImportCommandName: "import-json",
    registerUpsert: false,
  });

  genetics.command("save", {
    args: z.object({
      title: z.string().min(1).max(160).describe("Genetic variant title or name."),
    }),
    description: "Create or update one genetic variant from typed command fields.",
    examples: [
      {
        args: {
          title: "APOE e4 allele",
        },
        description: "Save a genetic variant without a JSON payload file.",
        options: {
          gene: "APOE",
          significance: "risk_factor",
          vault: "./vault",
        },
      },
    ],
    hint: "Use genetics import-json only when importing an advanced JSON payload from @file.json or stdin.",
    options: withBaseOptions({
      id: geneticVariantIdSchema
        .optional()
        .describe("Optional existing genetic variant id to update."),
      slug: geneticVariantSlugSchema
        .optional()
        .describe("Optional stable lowercase kebab-case slug."),
      gene: z
        .string()
        .min(1)
        .max(80)
        .describe("Gene symbol or gene name for this variant."),
      zygosity: geneticVariantZygositySchema
        .optional()
        .describe("Optional variant zygosity."),
      significance: geneticVariantSignificanceSchema
        .optional()
        .describe("Optional variant significance."),
      inheritance: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional inheritance pattern or note."),
      sourceFamilyMemberId: repeatedFamilyMemberOptionSchema(
        "Optional source family member id. Repeat --source-family-member-id for multiple values.",
      ),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("Optional note for this genetic variant."),
    }),
    output: geneticsSaveResultSchema,
    async run(context) {
      const result = await upsertGeneticVariant({
        vaultRoot: context.options.vault,
        variantId: context.options.id,
        slug: context.options.slug,
        title: context.args.title,
        gene: context.options.gene,
        zygosity: context.options.zygosity,
        significance: context.options.significance,
        inheritance: context.options.inheritance,
        sourceFamilyMemberIds: normalizeRepeatableFlagOption(
          context.options.sourceFamilyMemberId,
          "source-family-member-id",
        ),
        note: context.options.note,
      });
      const saved = toGeneticsSaveResult(context.options.vault, result);

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: "genetics show",
            args: {
              id: saved.variantId,
            },
            description: "Show the saved genetic variant.",
            options: {
              vault: true,
            },
          },
          {
            command: "genetics list",
            description: "List genetic variants.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });

  cli.command(genetics);
}
