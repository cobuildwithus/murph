import { Cli, z } from "incur";
import {
  REGIMEN_KINDS,
  REGIMEN_STATUSES,
  type FrontmatterObject,
  type FrontmatterValue,
} from "@murphai/contracts";
import { requestIdFromOptions, withBaseOptions } from "@murphai/operator-config/command-helpers";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  localDateSchema,
  pathSchema,
  savedEntitySnapshotSchema,
} from "@murphai/operator-config/vault-cli-contracts";
import {
  healthListResultSchema,
  healthShowResultSchema,
  inputFileOptionSchema,
  loadJsonInputObject,
  normalizeInputFileOption,
  type VaultServices,
} from "@murphai/vault-usecases";
import { suggestedCommandsCta } from "./command-factory-primitives.js";

const protocolSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Expected a lowercase kebab-case slug.");

const regimenKindSchema = z.enum(REGIMEN_KINDS);
const regimenStatusSchema = z.enum(REGIMEN_STATUSES);

const regimenImportJsonResultSchema = z.object({
  vault: pathSchema,
  regimenId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
});
const regimenTypedSaveResultSchema = regimenImportJsonResultSchema.extend({
  entity: savedEntitySnapshotSchema,
});

const regimenScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal("regimen"),
  payload: z.record(z.string(), z.unknown()),
});

const privateProtocolUpsertResultSchema = z.object({
  vault: pathSchema,
  protocolId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: protocolSlugSchema,
  path: pathSchema,
  protocolRevisionId: z.string().min(1),
  effectiveSpecHash: z.string().min(1),
  created: z.boolean(),
});

const privateProtocolSummarySchema = z.object({
  id: z.string().min(1),
  protocolId: z.string().min(1),
  slug: protocolSlugSchema.nullable(),
  title: z.string().min(1),
  status: z.string().min(1).nullable(),
  commonsProtocolRef: z.record(z.string(), z.unknown()).nullable(),
  effectiveSpecHash: z.string().min(1).nullable(),
  protocolRevisionId: z.string().min(1).nullable(),
  updatedAt: z.string().min(1).nullable(),
  path: pathSchema,
  tags: z.array(z.string().min(1)),
  summary: z.string().min(1).nullable(),
});
const privateProtocolDetailSchema = privateProtocolSummarySchema.extend({
  effectiveSpec: z.record(z.string(), z.unknown()).nullable(),
});

const privateProtocolShowResultSchema = z.object({
  vault: pathSchema,
  protocol: privateProtocolDetailSchema,
});

const privateProtocolListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: z.string().min(1).optional(),
    commonsProtocol: z.string().min(1).optional(),
    limit: z.number().int().positive().max(200),
  }),
  protocols: z.array(privateProtocolSummarySchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
});
type PrivateProtocolListItem = z.infer<typeof privateProtocolListResultSchema>["protocols"][number];

const stopResultSchema = z.object({
  vault: pathSchema,
  regimenId: z.string().min(1),
  lookupId: z.string().min(1),
  stoppedOn: localDateSchema.nullable(),
  status: z.string().min(1),
})

function repeatedRelationOptionSchema(description: string) {
  return z.array(z.string().min(1)).optional().describe(description);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFrontmatterValue(value: unknown): value is FrontmatterValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isFrontmatterValue);
  }

  return isFrontmatterObject(value);
}

function isFrontmatterObject(value: unknown): value is FrontmatterObject {
  return isJsonRecord(value) && Object.values(value).every(isFrontmatterValue);
}

function optionalPayloadString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

async function loadPrivateProtocolUpsertPayload(inputFile: string): Promise<{
  protocolId?: string;
  slug?: string;
  title?: string;
  body?: string;
  frontmatter: FrontmatterObject;
}> {
  const payload = await loadJsonInputObject(inputFile, "protocol payload");
  const nestedFrontmatter = payload.frontmatter;
  const frontmatter = isFrontmatterObject(nestedFrontmatter)
    ? nestedFrontmatter
    : payload;

  if (!isFrontmatterObject(frontmatter)) {
    throw new VaultCliError(
      "invalid_payload",
      "Protocol frontmatter must contain only YAML-compatible JSON values.",
    );
  }

  return {
    protocolId:
      optionalPayloadString(payload, "protocolId") ??
      optionalPayloadString(frontmatter, "protocolId"),
    slug:
      optionalPayloadString(payload, "slug") ??
      optionalPayloadString(frontmatter, "slug"),
    title:
      optionalPayloadString(payload, "title") ??
      optionalPayloadString(frontmatter, "title"),
    body: optionalPayloadString(payload, "body"),
    frontmatter,
  };
}

function toPrivateProtocolListItem(
  protocol: z.infer<typeof privateProtocolDetailSchema>,
): PrivateProtocolListItem {
  return {
    id: protocol.id,
    protocolId: protocol.protocolId,
    slug: protocol.slug,
    title: protocol.title,
    status: protocol.status,
    commonsProtocolRef: protocol.commonsProtocolRef,
    effectiveSpecHash: protocol.effectiveSpecHash,
    protocolRevisionId: protocol.protocolRevisionId,
    updatedAt: protocol.updatedAt,
    path: protocol.path,
    tags: protocol.tags,
    summary: protocol.summary,
  };
}

export function registerProtocolCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const regimen = Cli.create("regimen", {
    description: "Private regimen registry commands for medication, supplement, therapy, and habit records.",
  });

  regimen.command("scaffold", {
    args: z.object({}),
    description: "Print a starter regimen JSON payload.",
    options: withBaseOptions(),
    output: regimenScaffoldResultSchema,
    run({ options }) {
      return services.core.scaffoldRegimen({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      });
    },
  });

  regimen.command("list", {
    args: z.object({}),
    description: "List private regimen records.",
    options: withBaseOptions({
      status: z.string().min(1).optional().describe("Optional regimen status to filter by."),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: healthListResultSchema,
    run({ options }) {
      return services.query.listRegimens({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        status: options.status,
        limit: options.limit,
      });
    },
  });

  regimen.command("show", {
    args: z.object({
      id: z.string().min(1).describe("Regimen id or slug to resolve."),
    }),
    description: "Show one private regimen record.",
    options: withBaseOptions(),
    output: healthShowResultSchema,
    run({ args, options }) {
      return services.query.showRegimen({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        id: args.id,
      });
    },
  });

  regimen.command("import-json", {
    args: z.object({}),
    description: "Import one regimen from an explicit JSON payload file or stdin.",
    examples: [
      {
        description: "Import one regimen from a JSON payload file.",
        options: {
          input: "@regimen.json",
          vault: "./vault",
        },
      },
    ],
    hint: "--input accepts @file.json or - for advanced regimen payload imports.",
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: regimenImportJsonResultSchema,
    async run(context) {
      const result = await services.core.upsertRegimen({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        input: normalizeInputFileOption(context.options.input),
      });

      return context.ok(result, {
        cta: suggestedCommandsCta([
          {
            command: "regimen show",
            args: {
              id: result.regimenId,
            },
            description: "Show the imported regimen record.",
            options: {
              vault: true,
            },
          },
          {
            command: "regimen list",
            description: "List regimens.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });

  regimen.command("save", {
    args: z.object({
      title: z.string().min(1).max(160).describe("Regimen title or name."),
    }),
    description: "Create or update one regimen from typed command fields.",
    examples: [
      {
        args: {
          title: "Morning light walk",
        },
        description: "Save a typed habit regimen without a JSON payload file.",
        options: {
          kind: "habit",
          schedule: "10 minutes after waking",
          vault: "./vault",
        },
      },
    ],
    hint: "Use regimen import-json only when importing an advanced JSON payload from @file.json or stdin.",
    options: withBaseOptions({
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Optional existing regimen id to update."),
      slug: protocolSlugSchema
        .optional()
        .describe("Optional stable lowercase kebab-case slug."),
      kind: regimenKindSchema.describe("Regimen kind."),
      status: regimenStatusSchema.optional().describe("Optional regimen status."),
      startedOn: localDateSchema
        .optional()
        .describe("Optional calendar day when the regimen started."),
      stoppedOn: localDateSchema
        .optional()
        .describe("Optional calendar day when the regimen stopped."),
      schedule: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional schedule or timing note."),
      brand: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional product brand for supplement-like regimens."),
      manufacturer: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional product manufacturer for supplement-like regimens."),
      servingSize: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional serving-size label for supplement-like regimens."),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("Optional note for record provenance, uncertainty, or context."),
      substance: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional substance or intervention label."),
      dose: z
        .number()
        .nonnegative()
        .optional()
        .describe("Optional numeric dose."),
      unit: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe("Optional unit for the dose."),
      ingredientCompound: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional primary ingredient or compound name."),
      ingredientLabel: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional ingredient label as it appears on the product."),
      ingredientAmount: z
        .number()
        .nonnegative()
        .optional()
        .describe("Optional amount for the primary ingredient."),
      ingredientUnit: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe("Optional unit for the primary ingredient amount."),
      ingredientNote: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("Optional note for the primary ingredient. Requires --ingredient-compound."),
      ingredientActive: z
        .boolean()
        .optional()
        .describe("Optional active flag for the primary ingredient."),
      group: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional regimen group path for organizing records."),
      relatedGoalId: repeatedRelationOptionSchema(
        "Optional related goal id. Repeat --related-goal-id for multiple values.",
      ),
      relatedConditionId: repeatedRelationOptionSchema(
        "Optional related condition id. Repeat --related-condition-id for multiple values.",
      ),
      relatedRegimenId: repeatedRelationOptionSchema(
        "Optional related regimen id. Repeat --related-regimen-id for multiple values.",
      ),
    }),
    output: regimenTypedSaveResultSchema,
    async run(context) {
      const saved = await services.core.saveRegimen({
        brand: context.options.brand,
        dose: context.options.dose,
        group: context.options.group,
        ingredientActive: context.options.ingredientActive,
        ingredientAmount: context.options.ingredientAmount,
        ingredientCompound: context.options.ingredientCompound,
        ingredientLabel: context.options.ingredientLabel,
        ingredientNote: context.options.ingredientNote,
        ingredientUnit: context.options.ingredientUnit,
        kind: context.options.kind,
        manufacturer: context.options.manufacturer,
        note: context.options.note,
        regimenId: context.options.id,
        relatedConditionId: context.options.relatedConditionId,
        relatedGoalId: context.options.relatedGoalId,
        relatedRegimenId: context.options.relatedRegimenId,
        requestId: requestIdFromOptions(context.options),
        schedule: context.options.schedule,
        servingSize: context.options.servingSize,
        slug: context.options.slug,
        startedOn: context.options.startedOn,
        status: context.options.status,
        stoppedOn: context.options.stoppedOn,
        substance: context.options.substance,
        title: context.args.title,
        unit: context.options.unit,
        vault: context.options.vault,
      });

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: "regimen show",
            args: {
              id: saved.regimenId,
            },
            description: "Show the saved regimen record.",
            options: {
              vault: true,
            },
          },
          {
            command: "regimen list",
            description: "List regimens.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });

  regimen.command("stop", {
    args: z.object({
      regimenId: z.string().min(1),
    }),
    description: "Stop one regimen while preserving its canonical id.",
    examples: [
      {
        args: {
          regimenId: "<regimen-id>",
        },
        description: "Stop a regimen today.",
        options: {
          vault: "./vault",
        },
      },
      {
        args: {
          regimenId: "<regimen-id>",
        },
        description: "Stop a regimen on a specific calendar day.",
        options: {
          stoppedOn: "2026-03-12",
          vault: "./vault",
        },
      },
    ],
    hint: "Use the canonical regimen id so the stop event is attached to the existing registry record.",
    options: withBaseOptions({
      stoppedOn: localDateSchema.optional(),
    }),
    output: stopResultSchema,
    async run(context) {
      const result = await services.core.stopRegimen({
        regimenId: context.args.regimenId,
        stoppedOn: context.options.stoppedOn,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      });

      return context.ok(result, {
        cta: suggestedCommandsCta([
          {
            command: "regimen show",
            args: {
              id: context.args.regimenId,
            },
            description: "Show the stopped regimen record.",
            options: {
              vault: true,
            },
          },
          {
            command: "regimen list",
            description: "List stopped regimens.",
            options: {
              status: "stopped",
              vault: true,
            },
          },
        ]),
      });
    },
  });

  cli.command(regimen);

  const protocol = Cli.create("protocol", {
    description: "Private Health Commons-backed protocol adaptation commands.",
  });

  protocol.command("import-json", {
    args: z.object({}),
    description: "Import one private Health Commons-backed protocol adaptation from JSON.",
    examples: [
      {
        description: "Import a JSON object that is the full protocol frontmatter.",
        options: {
          input: "@protocol-frontmatter.json",
          vault: "./vault",
        },
      },
      {
        description: "Import a JSON object with nested frontmatter plus a Markdown body.",
        options: {
          input: "@protocol-with-body.json",
          vault: "./vault",
        },
      },
    ],
    hint: "--input accepts @file.json or - and may contain either full protocol frontmatter or { frontmatter, body }.",
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: privateProtocolUpsertResultSchema,
    async run(context) {
      const payload = await loadPrivateProtocolUpsertPayload(
        normalizeInputFileOption(context.options.input),
      );

      return services.core.upsertPrivateProtocol({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        protocolId: payload.protocolId,
        slug: payload.slug,
        allowSlugRename:
          payload.protocolId !== undefined && payload.slug !== undefined,
        title: payload.title,
        body: payload.body,
        frontmatter: payload.frontmatter,
      });
    },
  });

  protocol.command("list", {
    args: z.object({}),
    description: "List private Health Commons-backed protocol adaptations.",
    options: withBaseOptions({
      status: z.string().min(1).optional().describe("Optional private protocol status to filter by."),
      commonsProtocol: z
        .string()
        .min(1)
        .optional()
        .describe("Optional public Health Commons protocol key, slug, or route id to filter by."),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: privateProtocolListResultSchema,
    async run({ options }) {
      const result = await services.query.listPrivateProtocols({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        status: options.status,
        commonsProtocol: options.commonsProtocol,
        limit: options.limit,
      });

      return {
        ...result,
        protocols: result.protocols.map(toPrivateProtocolListItem),
      };
    },
  });

  protocol.command("show", {
    args: z.object({
      id: z.string().min(1).describe("Private protocol id or slug to resolve."),
    }),
    description: "Show one private Health Commons-backed protocol adaptation.",
    options: withBaseOptions(),
    output: privateProtocolShowResultSchema,
    run({ args, options }) {
      return services.query.showPrivateProtocol({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        id: args.id,
      });
    },
  });

  cli.command(protocol);
}
