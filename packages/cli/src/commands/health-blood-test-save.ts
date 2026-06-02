import { VaultError, appendBloodTest, upsertEvent } from "@murphai/core";
import {
  BLOOD_TEST_FASTING_STATUSES,
  BLOOD_TEST_CATEGORY,
  EVENT_SOURCES,
  TEST_RESULT_STATUSES,
  bloodTestResultSchema,
  eventRelationLinkSchema,
  type BloodTestResultRecord,
  type JsonObject,
} from "@murphai/contracts";
import { withBaseOptions } from "@murphai/operator-config/command-helpers";
import {
  isoTimestampSchema,
  occurredAtOptionSchema,
  pathSchema,
  timeZoneSchema,
} from "@murphai/operator-config/vault-cli-contracts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  normalizeRepeatableFlagOption,
  type VaultServices,
} from "@murphai/vault-usecases";
import { Cli, z } from "incur";

import { suggestedCommandsCta } from "./command-factory-primitives.js";
import { createHealthEntityCrudGroup } from "./health-entity-command-registry.js";

type BloodTestResult = BloodTestResultRecord;
type BloodTestAppendInput = Parameters<typeof appendBloodTest>[0];
interface BloodTestLink {
  type: string;
  targetId: string;
}

const resultStatusSchema = z.enum(TEST_RESULT_STATUSES);
const sourceSchema = z.enum(EVENT_SOURCES);
const fastingStatusSchema = z.enum(BLOOD_TEST_FASTING_STATUSES);
const resultFormatHint =
  "Use one JSON object per --result; repeat --result for multiple analytes.";
const specimenTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .describe(
    "Optional specimen type such as blood, whole_blood, serum, plasma, or dried_blood_spot.",
  );
const resultSpecSchema = z
  .string()
  .min(1)
  .describe(
    `Blood-test result as one JSON object. Supported fields include analyte, slug, value, textValue, comparator, unit, flag, biomarkerSlug, referenceRange, and note. ${resultFormatHint}`,
  );
const compactLinkSchema = z
  .string()
  .min(1)
  .describe(
    "Canonical event link as type:targetId or semicolon-separated type=value;targetId=value. Repeat --link for multiple links.",
  );
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

export const bloodTestSaveResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema.optional(),
  created: z.boolean(),
});

function keyValueSpecFormatMessage(optionName: string): string {
  return `Expected --${optionName} entries to use key=value fields. Escape literal semicolons as \\;.`;
}

function splitEscaped(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === separator) {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  if (escaped) {
    current += "\\";
  }

  parts.push(current);
  return parts;
}

function parseKeyValueSpec(
  spec: string,
  optionName: string,
): Map<string, string> {
  const fields = new Map<string, string>();

  for (const rawPart of splitEscaped(spec, ";")) {
    const part = rawPart.trim();
    if (part.length === 0) {
      continue;
    }

    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      throw new VaultCliError(
        "invalid_option",
        keyValueSpecFormatMessage(optionName),
      );
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key.length === 0 || value.length === 0) {
      throw new VaultCliError(
        "invalid_option",
        `Expected --${optionName} entries to include non-empty keys and values.`,
      );
    }

    if (fields.has(key)) {
      throw new VaultCliError(
        "invalid_option",
        `Duplicate --${optionName} field "${key}".`,
      );
    }

    fields.set(key, value);
  }

  return fields;
}

function parseJsonBloodTestResult(spec: string): BloodTestResult {
  let value: unknown;
  try {
    value = JSON.parse(spec) as unknown;
  } catch {
    throw new VaultCliError(
      "invalid_option",
      "Expected --result JSON object to be valid JSON.",
    );
  }

  const parsed = bloodTestResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new VaultCliError(
      "invalid_option",
      "Invalid --result blood-test analyte payload.",
      {
        issues: parsed.error.issues,
      },
    );
  }

  return parsed.data;
}

function parseBloodTestResult(spec: string): BloodTestResult {
  const trimmed = spec.trim();
  if (trimmed.startsWith("{")) {
    return parseJsonBloodTestResult(trimmed);
  }

  if (trimmed.startsWith("[")) {
    throw new VaultCliError(
      "invalid_option",
      "Expected --result JSON input to be one object per analyte, not an array. Repeat --result for each analyte or use blood-test import-json for a full payload.",
    );
  }

  throw new VaultCliError(
    "invalid_option",
    "Expected --result to be a JSON object. Example: --result '{\"analyte\":\"Glucose\",\"value\":92,\"unit\":\"mg/dL\"}'. Repeat --result for multiple analytes or use blood-test import-json for a full payload.",
  );
}

function parseBloodTestResults(specs: readonly string[]): BloodTestResult[] {
  const results = specs.map((spec) => parseBloodTestResult(spec));
  if (results.length === 0) {
    throw new VaultCliError(
      "invalid_option",
      "At least one --result entry is required.",
    );
  }

  return results;
}

function parseBloodTestLink(spec: string): BloodTestLink {
  const shorthandSeparator = spec.indexOf(":");
  const candidate =
    shorthandSeparator > 0 && !spec.includes("=")
      ? {
          type: spec.slice(0, shorthandSeparator).trim(),
          targetId: spec.slice(shorthandSeparator + 1).trim(),
        }
      : Object.fromEntries(parseKeyValueSpec(spec, "link"));

  const parsed = eventRelationLinkSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new VaultCliError("invalid_option", "Invalid --link payload.", {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

function parseBloodTestLinks(specs: readonly string[] | undefined) {
  if (!specs) {
    return undefined;
  }

  const links = specs.map((spec) => parseBloodTestLink(spec));
  return links.length > 0 ? links : undefined;
}

function inferResultStatus(
  results: readonly BloodTestResult[],
): z.infer<typeof resultStatusSchema> {
  let hasNormal = false;
  let hasAbnormal = false;

  for (const result of results) {
    switch (result.flag) {
      case "normal":
        hasNormal = true;
        break;
      case "low":
      case "high":
      case "abnormal":
      case "critical":
        hasAbnormal = true;
        break;
      default:
        break;
    }
  }

  if (hasNormal && hasAbnormal) {
    return "mixed";
  }

  if (hasAbnormal) {
    return "abnormal";
  }

  if (hasNormal) {
    return "normal";
  }

  return "unknown";
}

function bloodTestResultToJsonObject(result: BloodTestResult): JsonObject {
  const payload: JsonObject = {
    analyte: result.analyte,
  };

  for (const [key, value] of Object.entries(result)) {
    if (key === "analyte" || value === undefined) {
      continue;
    }

    if (key === "referenceRange") {
      const referenceRange: JsonObject = {};
      for (const [rangeKey, rangeValue] of Object.entries(value)) {
        if (
          typeof rangeValue === "string" ||
          typeof rangeValue === "number" ||
          typeof rangeValue === "boolean" ||
          rangeValue === null
        ) {
          referenceRange[rangeKey] = rangeValue;
        }
      }
      payload[key] = referenceRange;
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      payload[key] = value;
    }
  }

  return payload;
}

function bloodTestLinkToJsonObject(link: BloodTestLink): JsonObject {
  return {
    type: link.type,
    targetId: link.targetId,
  };
}

function buildBloodTestSavePayload(input: {
  collectedAt?: string;
  eventId?: string;
  fastingStatus?: z.infer<typeof fastingStatusSchema>;
  labName?: string;
  labPanelId?: string;
  link?: string[];
  note?: string;
  occurredAt?: string;
  rawRef?: string[];
  recordedAt?: string;
  reportedAt?: string;
  result: string[];
  resultStatus?: z.infer<typeof resultStatusSchema>;
  source?: z.infer<typeof sourceSchema>;
  specimenType?: string;
  summary?: string;
  tag?: string[];
  testName: string;
  timeZone?: string;
  title: string;
}): JsonObject {
  const results = parseBloodTestResults(input.result);
  const payload: JsonObject = {
    kind: "test",
    title: input.title,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    testName: input.testName,
    resultStatus: input.resultStatus ?? inferResultStatus(results),
    testCategory: BLOOD_TEST_CATEGORY,
    specimenType: input.specimenType ?? BLOOD_TEST_CATEGORY,
    results: results.map((result) => bloodTestResultToJsonObject(result)),
  };

  const optionalFields: JsonObject = {};
  const links = parseBloodTestLinks(input.link);
  const tags = normalizeRepeatableFlagOption(input.tag, "tag");
  const rawRefs = normalizeRepeatableFlagOption(input.rawRef, "raw-ref");

  if (input.eventId !== undefined) optionalFields.eventId = input.eventId;
  if (input.recordedAt !== undefined) optionalFields.recordedAt = input.recordedAt;
  if (input.timeZone !== undefined) optionalFields.timeZone = input.timeZone;
  if (input.source !== undefined) optionalFields.source = input.source;
  if (input.note !== undefined) optionalFields.note = input.note;
  if (tags !== undefined) optionalFields.tags = tags;
  if (links !== undefined) {
    optionalFields.links = links.map((link) => bloodTestLinkToJsonObject(link));
  }
  if (rawRefs !== undefined) optionalFields.rawRefs = rawRefs;
  if (input.summary !== undefined) optionalFields.summary = input.summary;
  if (input.labName !== undefined) optionalFields.labName = input.labName;
  if (input.labPanelId !== undefined) optionalFields.labPanelId = input.labPanelId;
  if (input.collectedAt !== undefined) optionalFields.collectedAt = input.collectedAt;
  if (input.reportedAt !== undefined) optionalFields.reportedAt = input.reportedAt;
  if (input.fastingStatus !== undefined) optionalFields.fastingStatus = input.fastingStatus;

  return {
    ...payload,
    ...optionalFields,
  };
}

function buildBloodTestAppendInput(input: {
  collectedAt?: string;
  eventId?: string;
  fastingStatus?: z.infer<typeof fastingStatusSchema>;
  labName?: string;
  labPanelId?: string;
  link?: string[];
  note?: string;
  occurredAt?: string;
  rawRef?: string[];
  recordedAt?: string;
  reportedAt?: string;
  result: string[];
  resultStatus?: z.infer<typeof resultStatusSchema>;
  source?: z.infer<typeof sourceSchema>;
  specimenType?: string;
  summary?: string;
  tag?: string[];
  testName: string;
  timeZone?: string;
  title: string;
  vault: string;
}): BloodTestAppendInput {
  return {
    vaultRoot: input.vault,
    eventId: input.eventId,
    occurredAt: input.occurredAt ?? new Date(),
    recordedAt: input.recordedAt,
    timeZone: input.timeZone,
    source: input.source,
    title: input.title,
    note: input.note,
    tags: normalizeRepeatableFlagOption(input.tag, "tag"),
    links: parseBloodTestLinks(input.link),
    rawRefs: normalizeRepeatableFlagOption(input.rawRef, "raw-ref"),
    testName: input.testName,
    resultStatus: input.resultStatus,
    summary: input.summary,
    specimenType: input.specimenType,
    labName: input.labName,
    labPanelId: input.labPanelId,
    collectedAt: input.collectedAt,
    reportedAt: input.reportedAt,
    fastingStatus: input.fastingStatus,
    results: parseBloodTestResults(input.result),
  };
}

function isUnsupportedSpecializedEventUpsert(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Event kind "test" is not supported by generic event upsert\./u.test(error.message)
  );
}

async function saveBloodTest(input: Parameters<typeof buildBloodTestAppendInput>[0]) {
  if (input.eventId !== undefined) {
    try {
      const upserted = await upsertEvent({
        vaultRoot: input.vault,
        allowSpecializedKindRewrite: true,
        payload: buildBloodTestSavePayload(input),
      });

      return {
        eventId: upserted.eventId,
        ledgerFile: upserted.ledgerFile,
        created: upserted.created,
      };
    } catch (error) {
      if (error instanceof VaultError && error.code === "EVENT_KIND_MISMATCH") {
        throw new VaultCliError("invalid_input", error.message);
      }
      if (!isUnsupportedSpecializedEventUpsert(error)) {
        throw error;
      }
    }
  }

  const appended = await appendBloodTest(buildBloodTestAppendInput(input));
  return {
    eventId: String(appended.record.id),
    ledgerFile: appended.relativePath,
    created: true,
  };
}

function toBloodTestSaveResult(vault: string, result: Awaited<ReturnType<typeof saveBloodTest>>) {
  return {
    vault,
    eventId: result.eventId,
    lookupId: result.eventId,
    ledgerFile: result.ledgerFile,
    created: result.created,
  };
}

export function registerBloodTestCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const bloodTest = createHealthEntityCrudGroup(services, "blood-test");

  bloodTest.command("save", {
    args: z.object({
      title: z.string().min(1).max(160).describe("Blood-test event title."),
    }),
    description: "Create or update one blood-test event from typed command fields.",
    examples: [
      {
        args: {
          title: "Functional health panel",
        },
        description: "Save one blood test without a JSON payload file.",
        options: {
          occurredAt: "2026-03-12T13:00:00.000Z",
          testName: "functional_health_panel",
          labName: "Function Health",
          fastingStatus: "fasting",
          result: [
            '{"analyte":"Apolipoprotein B","value":87,"unit":"mg/dL","flag":"normal","referenceRange":{"text":"<90"}}',
          ],
          vault: "./vault",
        },
      },
    ],
    hint: "Use blood-test import-json only when importing an advanced or bulk JSON payload from @file.json or stdin.",
    options: withBaseOptions({
      id: z.string().min(1).optional().describe("Optional existing event id to revise."),
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe("Optional occurrence timestamp or YYYY-MM-DD date. Defaults to now."),
      recordedAt: isoTimestampSchema
        .optional()
        .describe("Optional recorded timestamp with explicit UTC offset."),
      timeZone: timeZoneSchema.optional().describe("Optional IANA timezone."),
      source: sourceSchema.optional().describe("Optional event source."),
      note: z.string().min(1).max(4000).optional().describe("Optional event note."),
      tag: z
        .array(z.string().min(1))
        .optional()
        .describe("Optional event tag. Repeat --tag for multiple values."),
      link: z
        .array(compactLinkSchema)
        .optional()
        .describe("Optional event link. Repeat --link for multiple links."),
      rawRef: z
        .array(rawVaultPathSchema)
        .optional()
        .describe("Optional vault-relative raw/... path. Repeat --raw-ref for multiple values."),
      testName: z.string().min(1).max(160).describe("Blood-test panel or test name."),
      resultStatus: resultStatusSchema
        .optional()
        .describe("Optional result status. If omitted, flags infer normal, abnormal, mixed, or unknown."),
      summary: z.string().min(1).max(1000).optional().describe("Optional test summary."),
      specimenType: specimenTypeSchema.optional(),
      labName: z.string().min(1).max(160).optional().describe("Optional lab name."),
      labPanelId: z.string().min(1).max(120).optional().describe("Optional lab panel id."),
      collectedAt: isoTimestampSchema
        .optional()
        .describe("Optional sample collection timestamp with explicit UTC offset."),
      reportedAt: isoTimestampSchema
        .optional()
        .describe("Optional report timestamp with explicit UTC offset."),
      fastingStatus: fastingStatusSchema.optional().describe("Optional fasting status."),
      result: z
        .array(resultSpecSchema)
        .min(1)
        .max(500)
        .describe(`Blood-test result JSON object. ${resultFormatHint}`),
    }),
    output: bloodTestSaveResultSchema,
    async run(context) {
      const result = await saveBloodTest({
        eventId: context.options.id,
        occurredAt: context.options.occurredAt,
        recordedAt: context.options.recordedAt,
        timeZone: context.options.timeZone,
        source: context.options.source,
        title: context.args.title,
        note: context.options.note,
        tag: context.options.tag,
        link: context.options.link,
        rawRef: context.options.rawRef,
        testName: context.options.testName,
        resultStatus: context.options.resultStatus,
        summary: context.options.summary,
        specimenType: context.options.specimenType,
        labName: context.options.labName,
        labPanelId: context.options.labPanelId,
        collectedAt: context.options.collectedAt,
        reportedAt: context.options.reportedAt,
        fastingStatus: context.options.fastingStatus,
        result: context.options.result,
        vault: context.options.vault,
      });
      const saved = toBloodTestSaveResult(context.options.vault, result);

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: "blood-test show",
            args: {
              id: saved.eventId,
            },
            description: "Show the saved blood test.",
            options: {
              vault: true,
            },
          },
          {
            command: "blood-test list",
            description: "List blood tests.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });

  cli.command(bloodTest);
}
