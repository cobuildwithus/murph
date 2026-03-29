import {
  deriveWorkoutFormatCompatibilityId,
  type ActivityStrengthExercise,
} from "@murph/contracts";

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
  optionalEnum,
  optionalFiniteNumber,
  optionalInteger,
  optionalString,
  requireMatchingDocType,
  requireObject,
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

const LOAD_UNITS = ["lb", "kg"] as const;

function normalizeWorkoutFormatStatus(value: unknown): WorkoutFormatStatus {
  return optionalEnum(value, WORKOUT_FORMAT_STATUSES, "status") ?? "active";
}

function normalizeWorkoutActivityType(value: unknown): string {
  const activityType = requireString(value, "activityType", 160);
  const normalized = normalizeSelectorSlug(activityType);

  if (!normalized) {
    throw new VaultError("VAULT_INVALID_INPUT", "activityType could not be normalized.");
  }

  return normalized;
}

function normalizeStrengthExercises(
  value: unknown,
  fieldName = "strengthExercises",
): ActivityStrengthExercise[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an array of exercise objects.`);
  }

  if (value.length > 50) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} exceeds the maximum item count.`);
  }

  const exercises = value.map((entry, index) => {
    const exerciseField = `${fieldName}[${index}]`;
    const objectValue = requireObject(entry, exerciseField);
    const exercise = requireString(objectValue.exercise, `${exerciseField}.exercise`, 160);
    const setCount = optionalInteger(objectValue.setCount, `${exerciseField}.setCount`, 1);
    const repsPerSet = optionalInteger(objectValue.repsPerSet, `${exerciseField}.repsPerSet`, 1);
    const load = optionalFiniteNumber(objectValue.load, `${exerciseField}.load`, 0);
    const loadUnit = optionalEnum(objectValue.loadUnit, LOAD_UNITS, `${exerciseField}.loadUnit`);
    const loadDescription = optionalString(
      objectValue.loadDescription,
      `${exerciseField}.loadDescription`,
      240,
    );

    if (setCount === undefined) {
      throw new VaultError("VAULT_INVALID_INPUT", `${exerciseField}.setCount is required.`);
    }

    if (repsPerSet === undefined) {
      throw new VaultError("VAULT_INVALID_INPUT", `${exerciseField}.repsPerSet is required.`);
    }

    if ((load === undefined) !== (loadUnit === undefined)) {
      throw new VaultError(
        "VAULT_INVALID_INPUT",
        `${exerciseField}.load and ${exerciseField}.loadUnit must be provided together.`,
      );
    }

    return stripUndefined({
      exercise,
      setCount,
      repsPerSet,
      load,
      loadUnit,
      loadDescription,
    }) as ActivityStrengthExercise;
  });

  return exercises.length > 0 ? exercises : undefined;
}

function formatStrengthExerciseLine(exercise: ActivityStrengthExercise): string {
  const parts = [`${exercise.exercise} — ${exercise.setCount} sets x ${exercise.repsPerSet} reps`];

  if ("load" in exercise && exercise.load !== undefined && exercise.loadUnit) {
    parts.push(`load: ${exercise.load} ${exercise.loadUnit}`);
  }

  if (exercise.loadDescription) {
    parts.push(exercise.loadDescription);
  }

  return parts.join("; ");
}

function buildBody(record: WorkoutFormatRecord): string {
  const sections = [
    record.summary ? section("Summary", record.summary) : null,
    record.templateText ? section("Saved workout text", record.templateText) : null,
    record.strengthExercises?.length
      ? listSection(
          "Strength Exercises",
          record.strengthExercises.map((exercise) => formatStrengthExerciseLine(exercise)),
        )
      : null,
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
  requireMatchingDocType(
    attributes,
    WORKOUT_FORMAT_SCHEMA_VERSION,
    WORKOUT_FORMAT_DOC_TYPE,
    "VAULT_INVALID_WORKOUT_FORMAT",
    "Workout format registry document has an unexpected shape.",
  );

  const slug = requireString(attributes.slug, "slug", 160);

  return stripUndefined({
    schemaVersion: WORKOUT_FORMAT_SCHEMA_VERSION,
    docType: WORKOUT_FORMAT_DOC_TYPE,
    slug,
    workoutFormatId:
      optionalString(attributes.workoutFormatId, "workoutFormatId", 64)
      ?? deriveWorkoutFormatCompatibilityId(slug),
    title: requireString(attributes.title, "title", 160),
    status: normalizeWorkoutFormatStatus(attributes.status),
    summary: optionalString(attributes.summary, "summary", 4000),
    activityType: normalizeWorkoutActivityType(attributes.activityType ?? attributes.type),
    durationMinutes: optionalInteger(attributes.durationMinutes, "durationMinutes", 1, 24 * 60),
    distanceKm: optionalFiniteNumber(attributes.distanceKm, "distanceKm", 0, 1_000),
    strengthExercises: normalizeStrengthExercises(attributes.strengthExercises),
    tags: normalizeDomainList(attributes.tags, "tags"),
    note: optionalString(attributes.note, "note", 4000),
    templateText: optionalString(attributes.templateText ?? attributes.text, "templateText", 4000),
    relativePath,
    markdown,
  });
}

function buildAttributes(record: WorkoutFormatRecord): FrontmatterObject {
  return stripUndefined({
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
    strengthExercises: record.strengthExercises,
    tags: record.tags,
    note: record.note,
    templateText: record.templateText,
  }) as unknown as FrontmatterObject;
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
  operationType: "workout_format_upsert",
  summary: (recordId) => `Upsert workout format ${recordId}`,
  audit: {
    action: "workout_format_upsert",
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
          strengthExercises: resolveOptionalUpsertValue(
            input.strengthExercises,
            existingRecord?.strengthExercises,
            (value) => normalizeStrengthExercises(value),
          ),
          tags: resolveOptionalUpsertValue(input.tags, existingRecord?.tags, (value) =>
            normalizeDomainList(value, "tags"),
          ),
          note: resolveOptionalUpsertValue(input.note, existingRecord?.note, (value) =>
            optionalString(value, "note", 4000),
          ),
          templateText: resolveOptionalUpsertValue(
            input.templateText,
            existingRecord?.templateText,
            (value) => optionalString(value, "templateText", 4000),
          ),
          relativePath: target.relativePath,
          markdown: existingRecord?.markdown ?? "",
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
