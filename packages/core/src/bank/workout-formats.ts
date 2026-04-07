import {
  type WorkoutFormatFrontmatter,
  type WorkoutTemplate,
  workoutFormatFrontmatterSchema,
  workoutTemplateSchema,
} from "@murphai/contracts";

import { validateContract } from "../domains/shared.ts";
import { VaultError } from "../errors.ts";
import { generateRecordId } from "../ids.ts";
import { createMarkdownRegistryApi } from "../registry/api.ts";

import {
  WORKOUT_FORMAT_DOC_TYPE,
  WORKOUT_FORMAT_SCHEMA_VERSION,
  WORKOUT_FORMAT_STATUSES,
  WORKOUT_FORMATS_DIRECTORY,
} from "./types.ts";
import {
  buildDocumentFromAttributes,
  buildMarkdownBody,
  detailList,
  listSection,
  normalizeDomainList,
  normalizeId,
  normalizeSelectorSlug,
  normalizeUpsertSelectorSlug,
  optionalFiniteNumber,
  optionalInteger,
  optionalString,
  requireString,
  resolveOptionalUpsertValue,
  resolveRequiredUpsertValue,
  section,
  stripUndefined,
} from "./shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  ReadWorkoutFormatInput,
  UpsertWorkoutFormatInput,
  UpsertWorkoutFormatResult,
  WorkoutFormatRecord,
  WorkoutFormatStatus,
} from "./types.ts";

function normalizeWorkoutFormatStatus(value: unknown): WorkoutFormatStatus {
  const status = typeof value === "string" ? value.trim() : "";

  if (status.length === 0) {
    return "active";
  }

  if ((WORKOUT_FORMAT_STATUSES as readonly string[]).includes(status)) {
    return status as WorkoutFormatStatus;
  }

  throw new VaultError("VAULT_INVALID_INPUT", `status must be one of ${WORKOUT_FORMAT_STATUSES.join(", ")}.`);
}

function normalizeWorkoutActivityType(value: unknown): string {
  const activityType = requireString(value, "activityType", 160);
  const normalized = normalizeSelectorSlug(activityType);

  if (!normalized) {
    throw new VaultError("VAULT_INVALID_INPUT", "activityType could not be normalized.");
  }

  return normalized;
}

function normalizeTemplate(value: unknown, fieldName = "template"): WorkoutTemplate | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return validateContract(
    workoutTemplateSchema,
    value,
    "VAULT_INVALID_INPUT",
    `${fieldName} is invalid.`,
  );
}

function formatTemplateSet(set: WorkoutTemplate["exercises"][number]["plannedSets"][number]): string {
  const parts: string[] = [];

  if (set.type) {
    parts.push(set.type);
  }

  if (typeof set.targetReps === "number") {
    parts.push(`${set.targetReps} reps`);
  }

  if (typeof set.targetWeight === "number") {
    parts.push(
      `${set.targetWeight}${set.targetWeightUnit ? ` ${set.targetWeightUnit}` : ""}`,
    );
  }

  if (typeof set.targetDurationSeconds === "number") {
    parts.push(`${set.targetDurationSeconds}s`);
  }

  if (typeof set.targetDistanceMeters === "number") {
    parts.push(`${set.targetDistanceMeters}m`);
  }

  if (typeof set.targetRpe === "number") {
    parts.push(`RPE ${set.targetRpe}`);
  }

  return parts.length > 0 ? parts.join(" · ") : `set ${set.order}`;
}

function formatTemplateExerciseLine(exercise: WorkoutTemplate["exercises"][number]): string {
  const group = exercise.groupId ? ` [${exercise.groupId}]` : "";
  const mode = exercise.mode ? ` (${exercise.mode})` : "";
  const setSummary = exercise.plannedSets
    .slice()
    .sort((left, right) => left.order - right.order)
    .map(formatTemplateSet)
    .join("; ");

  return `${exercise.name}${group}${mode}: ${setSummary}`;
}

function validateWorkoutFormatFrontmatter(
  value: unknown,
  relativePath: string,
): WorkoutFormatFrontmatter {
  if (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { workoutFormatId?: unknown }).workoutFormatId !== "string"
  ) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "workoutFormatId is required.",
      { relativePath },
    );
  }

  return validateContract(
    workoutFormatFrontmatterSchema,
    value,
    "VAULT_INVALID_WORKOUT_FORMAT",
    "Workout format registry document has an unexpected shape.",
    { relativePath },
  );
}

function buildBody(record: WorkoutFormatRecord): string {
  const sections = [
    record.summary ? section("Summary", record.summary) : null,
    record.template?.routineNote ? section("Routine Notes", record.template.routineNote) : null,
    record.template?.exercises?.length
      ? listSection(
          "Template Exercises",
          record.template.exercises
            .slice()
            .sort((left, right) => left.order - right.order)
            .map((exercise) => formatTemplateExerciseLine(exercise)),
        )
      : null,
    record.templateText ? section("Saved workout text", record.templateText) : null,
    listSection("Tags", record.tags),
    record.note ? section("Notes", record.note) : null,
  ].filter((sectionValue): sectionValue is string => Boolean(sectionValue));

  return buildMarkdownBody(
    record.title,
    detailList([
      ["Status", record.status],
      ["Activity type", record.activityType],
      ["Default duration", record.durationMinutes ? `${record.durationMinutes} min` : undefined],
      ["Default distance", record.distanceKm !== undefined ? `${record.distanceKm} km` : undefined],
    ]),
    sections,
  );
}

function parseWorkoutFormatRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): WorkoutFormatRecord {
  const frontmatter = validateWorkoutFormatFrontmatter(attributes, relativePath);

  return {
    ...frontmatter,
    relativePath,
    markdown,
  };
}

function buildAttributes(
  record: WorkoutFormatFrontmatter | WorkoutFormatRecord,
): FrontmatterObject {
  return validateContract(
    workoutFormatFrontmatterSchema,
    stripUndefined({
      schemaVersion: WORKOUT_FORMAT_SCHEMA_VERSION,
      docType: WORKOUT_FORMAT_DOC_TYPE,
      workoutFormatId: record.workoutFormatId,
      slug: record.slug,
      title: record.title,
      status: record.status,
      summary: record.summary,
      activityType: record.activityType,
      durationMinutes: record.durationMinutes,
      distanceKm: record.distanceKm,
      template: record.template,
      tags: record.tags,
      note: record.note,
      templateText: record.templateText,
    }),
    "VAULT_INVALID_INPUT",
    "Workout format payload is invalid.",
  ) as unknown as FrontmatterObject;
}

const workoutFormatRegistryApi = createMarkdownRegistryApi<WorkoutFormatRecord>({
  directory: WORKOUT_FORMATS_DIRECTORY,
  recordFromParts: parseWorkoutFormatRecord,
  isExpectedRecord: (record) =>
    record.docType === WORKOUT_FORMAT_DOC_TYPE
    && record.schemaVersion === WORKOUT_FORMAT_SCHEMA_VERSION,
  invalidCode: "VAULT_INVALID_WORKOUT_FORMAT",
  invalidMessage: "Workout format registry document has an unexpected shape.",
  sortRecords: (records) =>
    records.sort(
      (left, right) =>
        left.title.localeCompare(right.title)
        || left.slug.localeCompare(right.slug)
        || left.workoutFormatId.localeCompare(right.workoutFormatId),
    ),
  getRecordId: (record) => record.workoutFormatId,
  getRecordSlug: (record) => record.slug,
  getRecordRelativePath: (record) => record.relativePath,
  conflictCode: "VAULT_WORKOUT_FORMAT_CONFLICT",
  conflictMessage: "Workout format id and slug resolve to different records.",
  readMissingCode: "VAULT_WORKOUT_FORMAT_MISSING",
  readMissingMessage: "Workout format was not found.",
  createRecordId: () => generateRecordId("wfmt"),
  operationType: "workout_format_save",
  summary: (recordId) => `Upsert workout format ${recordId}`,
  audit: {
    action: "workout_format_save",
    commandName: "core.upsertWorkoutFormat",
    summary: (_created, recordId) => `Upserted workout format ${recordId}.`,
  },
});

export async function upsertWorkoutFormat(
  input: UpsertWorkoutFormatInput,
): Promise<UpsertWorkoutFormatResult> {
  const normalizedWorkoutFormatId = normalizeId(input.workoutFormatId, "workoutFormatId", "wfmt");
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = await workoutFormatRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedWorkoutFormatId,
    slug: requestedSlug,
  });
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  const activityType = normalizeWorkoutActivityType(
    input.activityType ?? existingRecord?.activityType,
  );

  return workoutFormatRegistryApi.upsertRecord({
    vaultRoot: input.vaultRoot,
    existingRecord,
    recordId: normalizedWorkoutFormatId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    allowSlugUpdate: input.allowSlugRename === true,
    buildDocument: (target) => {
      const templateText = resolveOptionalUpsertValue(
        input.templateText,
        existingRecord?.templateText,
        (value) => optionalString(value, "templateText", 4000),
      );
      const template = resolveOptionalUpsertValue(
        input.template,
        existingRecord?.template,
        (value) => normalizeTemplate(value),
      );
      if (!template) {
        throw new VaultError("VAULT_INVALID_INPUT", "template is required.");
      }
      const attributes = buildAttributes(
        stripUndefined({
          schemaVersion: WORKOUT_FORMAT_SCHEMA_VERSION,
          docType: WORKOUT_FORMAT_DOC_TYPE,
          workoutFormatId: target.recordId,
          slug: target.slug,
          title,
          status: resolveRequiredUpsertValue(
            input.status,
            existingRecord?.status,
            "active",
            normalizeWorkoutFormatStatus,
          ),
          summary: resolveOptionalUpsertValue(input.summary, existingRecord?.summary, (value) =>
            optionalString(value, "summary", 4000),
          ),
          activityType,
          durationMinutes: resolveOptionalUpsertValue(
            input.durationMinutes,
            existingRecord?.durationMinutes,
            (value) => optionalInteger(value, "durationMinutes", 1, 24 * 60),
          ),
          distanceKm: resolveOptionalUpsertValue(input.distanceKm, existingRecord?.distanceKm, (value) =>
            optionalFiniteNumber(value, "distanceKm", 0, 1_000),
          ),
          template,
          tags: resolveOptionalUpsertValue(input.tags, existingRecord?.tags, (value) =>
            normalizeDomainList(value, "tags"),
          ),
          note: resolveOptionalUpsertValue(input.note, existingRecord?.note, (value) =>
            optionalString(value, "note", 4000),
          ),
          templateText,
        }),
      );

      return buildDocumentFromAttributes({
        attributes,
        relativePath: target.relativePath,
        markdown: existingRecord?.markdown,
        buildBody,
      });
    },
  });
}

export async function listWorkoutFormats(vaultRoot: string): Promise<WorkoutFormatRecord[]> {
  return workoutFormatRegistryApi.listRecords(vaultRoot);
}

export async function readWorkoutFormat({
  vaultRoot,
  workoutFormatId,
  slug,
}: ReadWorkoutFormatInput): Promise<WorkoutFormatRecord> {
  return workoutFormatRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizeId(workoutFormatId, "workoutFormatId", "wfmt"),
    slug: normalizeSelectorSlug(slug),
  });
}
