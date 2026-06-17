import { appendImmunization } from "@murphai/core";
import { EVENT_SOURCES } from "@murphai/contracts";
import { withBaseOptions } from "@murphai/operator-config/command-helpers";
import {
  isoTimestampSchema,
  occurredAtOptionSchema,
  pathSchema,
  timeZoneSchema,
} from "@murphai/operator-config/vault-cli-contracts";
import {
  normalizeRepeatableFlagOption,
  type VaultServices,
} from "@murphai/vault-usecases";
import { Cli, z } from "incur";

import { suggestedCommandsCta } from "./command-factory-primitives.js";
import { createHealthEntityCrudGroup } from "./health-entity-command-registry.js";

type ImmunizationAppendInput = Parameters<typeof appendImmunization>[0];

const sourceSchema = z.enum(EVENT_SOURCES);
const rawVaultPathSchema = z
  .string()
  .regex(
    /^raw\/[A-Za-z0-9._/-]+$/u,
    "Expected a vault-relative raw/... path.",
  )
  .refine(
    (value) => value.split("/").every((segment) => segment !== "." && segment !== ".."),
    "raw/... paths cannot contain . or .. segments.",
  );

export const immunizationSaveResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema.optional(),
  created: z.boolean(),
});

function buildImmunizationAppendInput(input: {
  lotNumber?: string;
  manufacturer?: string;
  note?: string;
  occurredAt?: string;
  rawRef?: string[];
  recordedAt?: string;
  route?: string;
  series?: string;
  site?: string;
  source?: z.infer<typeof sourceSchema>;
  tag?: string[];
  targetDisease?: string[];
  timeZone?: string;
  title?: string;
  vaccineName: string;
  vault: string;
}): ImmunizationAppendInput {
  return {
    vaultRoot: input.vault,
    occurredAt: input.occurredAt ?? new Date(),
    recordedAt: input.recordedAt,
    timeZone: input.timeZone,
    source: input.source,
    title: input.title ?? input.vaccineName,
    note: input.note,
    tags: normalizeRepeatableFlagOption(input.tag, "tag"),
    rawRefs: normalizeRepeatableFlagOption(input.rawRef, "raw-ref"),
    vaccineName: input.vaccineName,
    manufacturer: input.manufacturer,
    lotNumber: input.lotNumber,
    route: input.route,
    site: input.site,
    series: input.series,
    targetDiseases: normalizeRepeatableFlagOption(input.targetDisease, "target-disease"),
  };
}

async function saveImmunization(input: Parameters<typeof buildImmunizationAppendInput>[0]) {
  const appended = await appendImmunization(buildImmunizationAppendInput(input));
  return {
    eventId: String(appended.record.id),
    ledgerFile: appended.relativePath,
    created: true,
  };
}

function toImmunizationSaveResult(
  vault: string,
  result: Awaited<ReturnType<typeof saveImmunization>>,
) {
  return {
    vault,
    eventId: result.eventId,
    lookupId: result.eventId,
    ledgerFile: result.ledgerFile,
    created: result.created,
  };
}

export function registerImmunizationCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const immunization = createHealthEntityCrudGroup(services, "immunization");

  immunization.command("save", {
    args: z.object({
      vaccineName: z.string().min(1).max(160).describe("Administered vaccine name."),
    }),
    description: "Create one immunization event from typed command fields.",
    examples: [
      {
        args: {
          vaccineName: "Influenza",
        },
        description: "Save one immunization without a JSON payload file.",
        options: {
          occurredAt: "2026-03-12",
          manufacturer: "Example manufacturer",
          lotNumber: "LOT123",
          route: "intramuscular",
          site: "left deltoid",
          targetDisease: ["influenza"],
          vault: "./vault",
        },
      },
    ],
    hint: "Use immunization import-json when preserving source links, raw refs, or external refs from an imported document.",
    options: withBaseOptions({
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe("Optional occurrence timestamp or YYYY-MM-DD date. Defaults to now."),
      recordedAt: isoTimestampSchema
        .optional()
        .describe("Optional recorded timestamp with explicit UTC offset."),
      timeZone: timeZoneSchema.optional().describe("Optional IANA timezone."),
      source: sourceSchema.optional().describe("Optional event source."),
      title: z.string().min(1).max(160).optional().describe("Optional event title. Defaults to the vaccine name."),
      note: z.string().min(1).max(4000).optional().describe("Optional event note."),
      tag: z
        .array(z.string().min(1))
        .optional()
        .describe("Optional event tag. Repeat --tag for multiple values."),
      rawRef: z
        .array(rawVaultPathSchema)
        .optional()
        .describe("Optional vault-relative raw/... path. Repeat --raw-ref for multiple values."),
      manufacturer: z.string().min(1).max(160).optional().describe("Optional vaccine manufacturer."),
      lotNumber: z.string().min(1).max(120).optional().describe("Optional vaccine lot number."),
      route: z.string().min(1).max(80).optional().describe("Optional administration route."),
      site: z.string().min(1).max(80).optional().describe("Optional administration site."),
      series: z.string().min(1).max(120).optional().describe("Optional series label."),
      targetDisease: z
        .array(z.string().min(1).max(120))
        .optional()
        .describe("Optional target disease. Repeat --target-disease for multiple values."),
    }),
    output: immunizationSaveResultSchema,
    async run(context) {
      const result = await saveImmunization({
        occurredAt: context.options.occurredAt,
        recordedAt: context.options.recordedAt,
        timeZone: context.options.timeZone,
        source: context.options.source,
        title: context.options.title,
        note: context.options.note,
        tag: context.options.tag,
        rawRef: context.options.rawRef,
        vaccineName: context.args.vaccineName,
        manufacturer: context.options.manufacturer,
        lotNumber: context.options.lotNumber,
        route: context.options.route,
        site: context.options.site,
        series: context.options.series,
        targetDisease: context.options.targetDisease,
        vault: context.options.vault,
      });
      const saved = toImmunizationSaveResult(context.options.vault, result);

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: "immunization show",
            args: {
              id: saved.eventId,
            },
            description: "Show the saved immunization.",
            options: {
              vault: true,
            },
          },
          {
            command: "immunization list",
            description: "List immunizations.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });

  cli.command(immunization);
}
