import { createHash } from "node:crypto";

import {
  normalizeIanaTimeZone,
  type WorkoutSession,
  type WorkoutSet,
  type WorkoutSetType,
} from "@murphai/contracts";

import {
  normalizeFlexibleTimestamp,
  parseDelimitedRows,
} from "./csv-sample-import-planner.ts";

const DEFAULT_DELIMITER = ",";
const DEFAULT_SOURCE = "strong";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_ROWS = 50_000;
const MAX_WORKOUTS = 10_000;
const MAX_OUTPUT_WARNINGS = 12;

const STRONG_HEADER_KEYS = [
  "date",
  "workoutname",
  "duration",
  "exercisename",
  "setorder",
  "weight",
  "reps",
  "distance",
  "seconds",
  "notes",
  "workoutnotes",
  "rpe",
] as const;

export type WorkoutCsvWeightUnit = "lb" | "kg";
export type WorkoutCsvDistanceUnit = "m" | "km" | "mi";
export type WorkoutCsvSource = "strong" | "hevy";

export interface WorkoutCsvPlannerInput {
  text: string;
  timeZone: string;
  source?: WorkoutCsvSource;
  delimiter?: string;
  weightUnit?: WorkoutCsvWeightUnit;
  distanceUnit?: WorkoutCsvDistanceUnit;
}

export interface PlannedWorkoutCsvSession {
  sourceSessionKey: string;
  sourceWorkoutId: string;
  occurredAt: string;
  title: string;
  durationMinutes?: number;
  distanceKm?: number;
  note?: string;
  workout: WorkoutSession;
}

export interface WorkoutCsvSkipReasonCount {
  reason: string;
  count: number;
}

export interface WorkoutCsvImportPlan {
  source: WorkoutCsvSource;
  detectedSource: WorkoutCsvSource | null;
  delimiter: string;
  timeZone: string;
  headers: string[];
  rowCount: number;
  repairedRowCount: number;
  ignoredRowCount: number;
  skippedRowCount: number;
  skipReasons: WorkoutCsvSkipReasonCount[];
  estimatedWorkouts: number;
  requiresWeightUnit: boolean;
  weightUnit: WorkoutCsvWeightUnit | null;
  requiresDistanceUnit: boolean;
  distanceUnit: WorkoutCsvDistanceUnit | null;
  importable: boolean;
  warnings: string[];
  sessions: PlannedWorkoutCsvSession[];
}

interface WorkoutCsvSessionExercise {
  name: string;
  order: number;
  groupId?: string;
  note?: string;
  sets: WorkoutSet[];
}

interface MutableWorkoutCsvSession {
  sourceSessionKey: string;
  sourceWorkoutId: string;
  title: string;
  occurredAt: string;
  endedAt?: string;
  durationMinutes?: number;
  distanceKm?: number;
  note?: string;
  exercises: WorkoutCsvSessionExercise[];
}

interface NormalizedCsvRows {
  rows: string[][];
  repairedRowCount: number;
  skippedRowCount: number;
  skipReasons: Map<string, number>;
}

function normalizeHeaderName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeSource(value: WorkoutCsvSource | undefined): WorkoutCsvSource {
  return value ?? DEFAULT_SOURCE;
}

function detectSource(headers: readonly string[]): WorkoutCsvSource | null {
  const normalizedHeaders = new Set(headers.map(normalizeHeaderName));

  if (
    normalizedHeaders.has("exerciseimage")
    || normalizedHeaders.has("primarymuscles")
    || normalizedHeaders.has("secondarymuscles")
  ) {
    return "hevy";
  }

  return hasCurrentStrongHeaders(headers) ? "strong" : null;
}

function hasSharedWorkoutHeaders(headers: readonly string[]): boolean {
  const normalizedHeaders = new Set(headers.map(normalizeHeaderName));
  return normalizedHeaders.has("workoutname")
    && normalizedHeaders.has("exercisename")
    && normalizedHeaders.has("setorder");
}

function findHeaderIndex(headers: readonly string[], aliases: readonly string[]): number | undefined {
  const normalizedHeaders = headers.map(normalizeHeaderName);
  for (const alias of aliases) {
    const index = normalizedHeaders.indexOf(normalizeHeaderName(alias));
    if (index >= 0) {
      return index;
    }
  }
  return undefined;
}

function valueAt(row: readonly string[], index: number | undefined): string | undefined {
  return index === undefined ? undefined : normalizeOptionalText(row[index]);
}

function hasCurrentStrongHeaders(headers: readonly string[]): boolean {
  return headers.length === STRONG_HEADER_KEYS.length
    && headers.every((header, index) => normalizeHeaderName(header) === STRONG_HEADER_KEYS[index]);
}

function isStrongDuration(value: string | undefined): boolean {
  const normalized = normalizeOptionalText(value);
  return normalized !== undefined
    && (
      /^\d+(?:\.\d+)?$/u.test(normalized)
      || /^(?:(?:\d+(?:\.\d+)?)h\s*)?(?:(?:\d+(?:\.\d+)?)m\s*)?(?:(?:\d+(?:\.\d+)?)s\s*)?$/iu.test(normalized)
    )
    && /\d/u.test(normalized);
}

function isStrongSetOrder(value: string | undefined): boolean {
  const normalized = normalizeOptionalText(value)?.toUpperCase();
  return normalized !== undefined
    && (/^\d+$/u.test(normalized) || normalized === "W" || normalized === "D" || normalized === "F");
}

function isOptionalNumber(value: string | undefined): boolean {
  const normalized = normalizeOptionalText(value);
  return normalized === undefined || /^[+-]?\d+(?:\.\d+)?$/u.test(normalized.replace(/,/gu, ""));
}

function isPlausibleStrongRow(row: readonly string[]): boolean {
  return row.length === STRONG_HEADER_KEYS.length
    && isStrongDuration(row[2])
    && /[hms]/iu.test(row[2] ?? "")
    && isStrongSetOrder(row[4])
    && [5, 6, 7, 8, 11].every((index) => isOptionalNumber(row[index]));
}

function repairStrongTextFieldComma(row: readonly string[], headerLength: number): string[] | undefined {
  const extraCellCount = row.length - headerLength;
  if (extraCellCount <= 0) {
    return undefined;
  }

  const candidates = [1, 3, 9, 10]
    .map((textFieldIndex) => [
      ...row.slice(0, textFieldIndex),
      row.slice(textFieldIndex, textFieldIndex + extraCellCount + 1).join(","),
      ...row.slice(textFieldIndex + extraCellCount + 1),
    ])
    .filter(isPlausibleStrongRow);

  return candidates.length === 1 ? candidates[0] : undefined;
}

function incrementReason(reasons: Map<string, number>, reason: string): void {
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
}

function normalizeRows(
  headers: readonly string[],
  rows: readonly string[][],
  detectedSource: WorkoutCsvSource | null,
): NormalizedCsvRows {
  const normalizedRows: string[][] = [];
  const skipReasons = new Map<string, number>();
  let repairedRowCount = 0;
  let skippedRowCount = 0;

  for (const row of rows) {
    if (row.every((cell) => cell.trim().length === 0)) {
      continue;
    }

    if (row.length === headers.length) {
      normalizedRows.push(row);
      continue;
    }

    if (detectedSource === "strong" && hasCurrentStrongHeaders(headers)) {
      const repaired = repairStrongTextFieldComma(row, headers.length);
      if (repaired) {
        normalizedRows.push(repaired);
        repairedRowCount += 1;
        continue;
      }
    }

    skippedRowCount += 1;
    incrementReason(skipReasons, "column count does not match the header");
  }

  return {
    rows: normalizedRows,
    repairedRowCount,
    skippedRowCount,
    skipReasons,
  };
}

function parseStrictNumber(value: string | undefined): number | undefined {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }
  const candidate = normalized.replace(/,/gu, "");
  if (!/^[+-]?\d+(?:\.\d+)?$/u.test(candidate)) {
    return undefined;
  }
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNonnegativeNumber(value: string | undefined): number | undefined {
  const parsed = parseStrictNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function parseNonnegativeInteger(value: string | undefined): number | undefined {
  const parsed = parseNonnegativeNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  const parsed = parseNonnegativeNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function parseBooleanLike(value: string | undefined): boolean {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1";
}

function parseWeightValue(value: string | undefined): {
  weight?: number;
  unit?: WorkoutCsvWeightUnit;
} {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (!normalized) return {};
  const match = normalized.match(/^([+-]?\d{1,3}(?:,?\d{3})*(?:\.\d+)?)\s*(?:(lb|lbs|pound|pounds|kg|kgs|kilogram|kilograms))?$/u);
  if (!match) return {};
  const weight = Number(match[1]?.replace(/,/gu, ""));
  if (!Number.isFinite(weight) || weight < 0) return {};
  const rawUnit = match[2];
  return {
    weight,
    ...(rawUnit?.startsWith("lb") || rawUnit?.startsWith("pound")
      ? { unit: "lb" as const }
      : rawUnit?.startsWith("kg") || rawUnit?.startsWith("kilo")
        ? { unit: "kg" as const }
        : {}),
  };
}

function parseDistanceValue(value: string | undefined): {
  distance?: number;
  unit?: WorkoutCsvDistanceUnit;
} {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (!normalized) return {};
  const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)\s*(?:(m|meter|meters|metre|metres|km|kilometer|kilometers|kilometre|kilometres|mi|mile|miles))?$/u);
  if (!match) return {};
  const distance = Number(match[1]);
  if (!Number.isFinite(distance) || distance < 0) return {};
  const rawUnit = match[2];
  return {
    distance,
    ...(rawUnit === "km" || rawUnit?.startsWith("kilo")
      ? { unit: "km" as const }
      : rawUnit === "mi" || rawUnit?.startsWith("mile")
        ? { unit: "mi" as const }
        : rawUnit
          ? { unit: "m" as const }
          : {}),
  };
}

function parseSetDurationSeconds(value: string | undefined): number | undefined {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (/^\d+(?:\.\d+)?$/u.test(normalized)) {
    const seconds = Number(normalized);
    return seconds > 0 ? Math.round(seconds) : undefined;
  }

  const colonParts = normalized.split(":");
  if (
    (colonParts.length === 2 || colonParts.length === 3)
    && colonParts.every((part) => /^\d+(?:\.\d+)?$/u.test(part.trim()))
  ) {
    const values = colonParts.map(Number);
    const seconds = values.length === 2
      ? (values[0] ?? 0) * 60 + (values[1] ?? 0)
      : (values[0] ?? 0) * 3600 + (values[1] ?? 0) * 60 + (values[2] ?? 0);
    return seconds > 0 ? Math.round(seconds) : undefined;
  }

  let seconds = 0;
  let matchedLength = 0;
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gu)) {
    const amount = Number(match[1]);
    const unit = match[2] ?? "";
    if (!Number.isFinite(amount)) return undefined;
    seconds += amount * (/^(?:hours?|hrs?|h)$/u.test(unit) ? 3600 : /^(?:minutes?|mins?|m)$/u.test(unit) ? 60 : 1);
    matchedLength += match[0].replace(/\s/gu, "").length;
  }
  return seconds > 0 && matchedLength === normalized.replace(/\s/gu, "").length
    ? Math.round(seconds)
    : undefined;
}

function parseDurationMinutes(value: string | undefined): number | undefined {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (/^\d+(?:\.\d+)?$/u.test(normalized)) {
    const minutes = Number(normalized);
    return minutes > 0 && minutes <= 24 * 60 ? Math.max(1, Math.round(minutes)) : undefined;
  }

  const colonParts = normalized.split(":");
  if (
    (colonParts.length === 2 || colonParts.length === 3)
    && colonParts.every((part) => /^\d+(?:\.\d+)?$/u.test(part.trim()))
  ) {
    const values = colonParts.map(Number);
    const seconds = values.length === 2
      ? (values[0] ?? 0) * 60 + (values[1] ?? 0)
      : (values[0] ?? 0) * 3600 + (values[1] ?? 0) * 60 + (values[2] ?? 0);
    return seconds > 0 && seconds <= 24 * 60 * 60
      ? Math.max(1, Math.round(seconds / 60))
      : undefined;
  }

  let seconds = 0;
  let matchedLength = 0;
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gu)) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) {
      return undefined;
    }
    const unit = match[2] ?? "";
    seconds += amount * (/^(?:hours?|hrs?|h)$/u.test(unit) ? 3600 : /^(?:minutes?|mins?|m)$/u.test(unit) ? 60 : 1);
    matchedLength += match[0].replace(/\s/gu, "").length;
  }

  if (
    matchedLength !== normalized.replace(/\s/gu, "").length
    || seconds <= 0
    || seconds > 24 * 60 * 60
  ) {
    return undefined;
  }
  return Math.max(1, Math.round(seconds / 60));
}

function normalizeWorkoutTimestamp(
  dateValue: string | undefined,
  timeValue: string | undefined,
  timeZone: string,
): string | undefined {
  const date = normalizeOptionalText(dateValue);
  const time = normalizeOptionalText(timeValue);
  if (time && /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/u.test(time)) {
    return normalizeFlexibleTimestamp(time, timeZone);
  }
  const timestamp = [date, time].filter(Boolean).join(" ");
  return timestamp ? normalizeFlexibleTimestamp(timestamp, timeZone) : undefined;
}

function inferDistanceUnitFromHeader(header: string | undefined): WorkoutCsvDistanceUnit | undefined {
  const normalized = normalizeHeaderName(header ?? "");
  if (normalized.endsWith("km") || normalized.includes("kilometer")) return "km";
  if (normalized.endsWith("mi") || normalized.includes("mile")) return "mi";
  if (normalized.endsWith("meters") || normalized.endsWith("metres")) return "m";
  return undefined;
}

function toDistanceMeters(value: number, unit: WorkoutCsvDistanceUnit): number {
  if (unit === "km") return value * 1000;
  if (unit === "mi") return value * 1609.344;
  return value;
}

function normalizeWeightUnit(value: string | undefined): WorkoutCsvWeightUnit | undefined {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (normalized?.startsWith("lb") || normalized?.startsWith("pound")) return "lb";
  if (normalized?.startsWith("kg") || normalized?.startsWith("kilo")) return "kg";
  return undefined;
}

function inferWeightUnitFromHeader(header: string | undefined): WorkoutCsvWeightUnit | undefined {
  const normalized = normalizeHeaderName(header ?? "");
  if (normalized.endsWith("kg") || normalized.includes("kilogram")) return "kg";
  if (normalized.endsWith("lb") || normalized.endsWith("lbs") || normalized.includes("pound")) return "lb";
  return undefined;
}

function toKilograms(value: number, unit: WorkoutCsvWeightUnit): number {
  return unit === "lb" ? value * 0.45359237 : value;
}

function normalizeSetType(value: string | undefined, detectedSource: WorkoutCsvSource | null): WorkoutSetType {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (detectedSource === "strong") {
    if (normalized === "w") return "warmup";
    if (normalized === "d") return "dropset";
    if (normalized === "f") return "failure";
    return "normal";
  }
  if (normalized?.includes("warm")) return "warmup";
  if (normalized?.includes("drop")) return "dropset";
  if (normalized?.includes("fail")) return "failure";
  return "normal";
}

function stableWorkoutSessionKey(rawTimestamp: string): string {
  return createHash("sha256")
    .update(rawTimestamp.trim())
    .digest("hex")
    .slice(0, 40);
}

function stableWorkoutSourceId(source: WorkoutCsvSource, sourceSessionKey: string): string {
  const digest = createHash("sha256")
    .update(`${source}\0${sourceSessionKey}`)
    .digest("hex")
    .slice(0, 40);
  return `${source}-workout-${digest}`;
}

function resolveExerciseMode(exercise: WorkoutCsvSessionExercise): WorkoutSession["exercises"][number]["mode"] {
  if (exercise.sets.some((set) => typeof set.assistanceKg === "number")) return "assisted_bodyweight";
  if (exercise.sets.some((set) => typeof set.addedWeightKg === "number")) return "weighted_bodyweight";
  if (exercise.sets.some((set) => typeof set.bodyweightKg === "number")) return "bodyweight";
  const hasDistance = exercise.sets.some((set) => typeof set.distanceMeters === "number" && set.distanceMeters > 0);
  const hasDuration = exercise.sets.some((set) => typeof set.durationSeconds === "number" && set.durationSeconds > 0);
  const hasLoadOrReps = exercise.sets.some((set) =>
    (typeof set.weight === "number" && set.weight > 0)
    || (typeof set.reps === "number" && set.reps > 0));

  if (hasDistance && hasDuration) return "cardio";
  if (hasDuration && !hasLoadOrReps) return "duration";
  return "weight_reps";
}

function toWarnings(input: {
  detectedSource: WorkoutCsvSource | null;
  requiresSourceSelection: boolean;
  repairedRowCount: number;
  ignoredRowCount: number;
  skippedRowCount: number;
  invalidDurationCount: number;
  requiresWeightUnit: boolean;
  requiresDistanceUnit: boolean;
  hasExerciseColumn: boolean;
}): string[] {
  const warnings: string[] = [];
  if (input.requiresSourceSelection) {
    warnings.push("The CSV headers are shared by Strong and Hevy; pass --source strong or --source hevy before importing.");
  } else if (!input.detectedSource) {
    warnings.push("The CSV header does not match a supported workout export.");
  }
  if (!input.hasExerciseColumn) {
    warnings.push("No exercise column was detected.");
  }
  if (input.repairedRowCount > 0) {
    warnings.push(`${input.repairedRowCount} row(s) contained an unquoted text-field comma and were repaired deterministically.`);
  }
  if (input.ignoredRowCount > 0) {
    warnings.push(`${input.ignoredRowCount} Strong rest-timer metadata row(s) were omitted because they are not workout sets.`);
  }
  if (input.skippedRowCount > 0) {
    warnings.push(`${input.skippedRowCount} row(s) could not be mapped safely; structured import is blocked.`);
  }
  if (input.invalidDurationCount > 0) {
    warnings.push(`${input.invalidDurationCount} workout duration(s) were invalid or outside the supported 24-hour range and will be omitted while their sets are preserved.`);
  }
  if (input.requiresWeightUnit) {
    warnings.push("Positive weights have no unit in this export; pass --weight-unit lb or --weight-unit kg before importing.");
  }
  if (input.requiresDistanceUnit) {
    warnings.push("Positive distances have no unit in this export; pass --distance-unit m, --distance-unit km, or --distance-unit mi before importing.");
  }
  return warnings.slice(0, MAX_OUTPUT_WARNINGS);
}

function buildSessions(input: {
  headers: readonly string[];
  rows: readonly string[][];
  source: WorkoutCsvSource;
  detectedSource: WorkoutCsvSource | null;
  timeZone: string;
  weightUnit?: WorkoutCsvWeightUnit;
  distanceUnit?: WorkoutCsvDistanceUnit;
  skipReasons: Map<string, number>;
}): {
  sessions: PlannedWorkoutCsvSession[];
  skippedRowCount: number;
  ignoredRowCount: number;
  invalidDurationCount: number;
  requiresWeightUnit: boolean;
  requiresDistanceUnit: boolean;
} {
  const { headers } = input;
  const workoutNameIndex = findHeaderIndex(headers, ["workout name", "workout", "routine name", "routine", "name", "title"]);
  const dateIndex = findHeaderIndex(headers, ["date", "workout date", "session date", "day"]);
  const startTimeIndex = findHeaderIndex(headers, ["start time", "start", "started at", "started"]);
  const endTimeIndex = findHeaderIndex(headers, ["end time", "end", "ended at", "ended"]);
  const durationIndex = findHeaderIndex(headers, ["duration minutes", "duration min", "duration"]);
  const workoutNoteIndex = input.detectedSource === "strong"
    ? findHeaderIndex(headers, ["workout notes"])
    : findHeaderIndex(headers, ["workout notes", "workout note", "session note", "description", "note", "notes"]);
  const exerciseNameIndex = findHeaderIndex(headers, ["exercise name", "exercise title", "exercise", "movement"]);
  const exerciseNoteIndex = input.detectedSource === "strong"
    ? findHeaderIndex(headers, ["notes"])
    : findHeaderIndex(headers, ["exercise notes", "exercise note", "movement note"]);
  const setOrderIndex = findHeaderIndex(headers, ["set order", "set number", "set index", "set"]);
  const repsIndex = findHeaderIndex(headers, ["reps", "rep"]);
  const weightIndex = findHeaderIndex(headers, [
    "weight",
    "weight kg",
    "weight lb",
    "weight lbs",
    "load",
    "load kg",
    "load lb",
    "load lbs",
  ]);
  const weightUnitIndex = findHeaderIndex(headers, ["weight unit", "load unit"]);
  const distanceIndex = findHeaderIndex(headers, [
    "distance",
    "distance km",
    "distance mi",
    "distance miles",
    "distance meters",
    "distance metres",
    "set distance",
  ]);
  const secondsIndex = findHeaderIndex(headers, ["seconds", "duration seconds"]);
  const rpeIndex = findHeaderIndex(headers, ["rpe"]);
  const setTypeIndex = findHeaderIndex(headers, ["set type", "type"]);
  const groupIndex = findHeaderIndex(headers, ["group", "group id", "superset", "superset id", "circuit"]);
  const bodyweightIndex = findHeaderIndex(headers, ["bodyweight kg", "body weight kg", "bodyweight", "body weight"]);
  const assistanceIndex = findHeaderIndex(headers, ["assistance kg", "assisted weight kg", "assistance", "assisted weight"]);
  const addedWeightIndex = findHeaderIndex(headers, ["added weight kg", "extra weight kg", "added weight", "extra weight"]);
  const warmupIndex = findHeaderIndex(headers, ["warmup", "warm up"]);
  const dropsetIndex = findHeaderIndex(headers, ["dropset", "drop set"]);
  const failureIndex = findHeaderIndex(headers, ["failure"]);
  const bodyweightHeaderUnit = bodyweightIndex === undefined
    ? undefined
    : inferWeightUnitFromHeader(headers[bodyweightIndex]);
  const assistanceHeaderUnit = assistanceIndex === undefined
    ? undefined
    : inferWeightUnitFromHeader(headers[assistanceIndex]);
  const addedWeightHeaderUnit = addedWeightIndex === undefined
    ? undefined
    : inferWeightUnitFromHeader(headers[addedWeightIndex]);
  const weightHeaderUnit = weightIndex === undefined
    ? undefined
    : inferWeightUnitFromHeader(headers[weightIndex]);

  const sessions = new Map<string, MutableWorkoutCsvSession>();
  const titleByOccurredAt = new Map<string, string>();
  const invalidDurationSessionIds = new Set<string>();
  let skippedRowCount = 0;
  let ignoredRowCount = 0;
  let hasUnitlessPositiveWeight = false;
  let hasUnitlessPositiveDistance = false;
  const headerDistanceUnit = distanceIndex === undefined
    ? undefined
    : inferDistanceUnitFromHeader(headers[distanceIndex]);

  for (const row of input.rows) {
    const title = valueAt(row, workoutNameIndex);
    const rawDate = valueAt(row, dateIndex);
    const rawStartTime = valueAt(row, startTimeIndex);
    const rawTimestamp = [rawDate, rawStartTime].filter(Boolean).join(" ");
    const exerciseName = valueAt(row, exerciseNameIndex);
    const occurredAt = normalizeWorkoutTimestamp(rawDate, rawStartTime, input.timeZone);
    const rawSetOrder = valueAt(row, setOrderIndex);

    if (!title || !rawTimestamp || !occurredAt || !exerciseName) {
      skippedRowCount += 1;
      incrementReason(input.skipReasons, "missing or invalid workout identity fields");
      continue;
    }
    if (input.detectedSource === "strong" && rawSetOrder?.trim().toLowerCase() === "rest timer") {
      ignoredRowCount += 1;
      continue;
    }
    if (input.detectedSource === "strong" && !isStrongSetOrder(rawSetOrder)) {
      skippedRowCount += 1;
      incrementReason(input.skipReasons, "unsupported Strong set-order marker");
      continue;
    }

    const repsText = valueAt(row, repsIndex);
    const weightText = valueAt(row, weightIndex);
    const distanceText = valueAt(row, distanceIndex);
    const secondsText = valueAt(row, secondsIndex);
    const rpeText = valueAt(row, rpeIndex);
    const reps = parseNonnegativeInteger(repsText);
    const parsedWeight = parseWeightValue(weightText);
    const weight = parsedWeight.weight;
    const parsedDistance = parseDistanceValue(distanceText);
    const distance = parsedDistance.distance;
    const durationSeconds = parseSetDurationSeconds(secondsText);
    const rpe = parseNonnegativeNumber(rpeText);
    const bodyweightText = valueAt(row, bodyweightIndex);
    const assistanceText = valueAt(row, assistanceIndex);
    const addedWeightText = valueAt(row, addedWeightIndex);
    const parsedBodyweight = parseWeightValue(bodyweightText);
    const parsedAssistance = parseWeightValue(assistanceText);
    const parsedAddedWeight = parseWeightValue(addedWeightText);
    if (
      (repsText !== undefined && reps === undefined)
      || (weightText !== undefined && weight === undefined)
      || (distanceText !== undefined && distance === undefined)
      || (secondsText !== undefined && parseNonnegativeNumber(secondsText) !== 0 && durationSeconds === undefined)
      || (rpeText !== undefined && (rpe === undefined || rpe > 10))
      || (bodyweightText !== undefined && parsedBodyweight.weight === undefined)
      || (assistanceText !== undefined && parsedAssistance.weight === undefined)
      || (addedWeightText !== undefined && parsedAddedWeight.weight === undefined)
    ) {
      skippedRowCount += 1;
      incrementReason(input.skipReasons, "invalid numeric set value");
      continue;
    }

    const weightUnitCell = normalizeWeightUnit(valueAt(row, weightUnitIndex));
    const declaredWeightUnits = [parsedWeight.unit, weightUnitCell, weightHeaderUnit]
      .filter((unit): unit is WorkoutCsvWeightUnit => unit !== undefined);
    if (new Set(declaredWeightUnits).size > 1) {
      skippedRowCount += 1;
      incrementReason(input.skipReasons, "weight units conflict within CSV metadata");
      continue;
    }
    const declaredWeightUnit = parsedWeight.unit ?? weightUnitCell ?? weightHeaderUnit;
    if (input.weightUnit && declaredWeightUnit && input.weightUnit !== declaredWeightUnit) {
      skippedRowCount += 1;
      incrementReason(input.skipReasons, "explicit weight unit conflicts with CSV metadata");
      continue;
    }
    const resolvedWeightUnit = declaredWeightUnit ?? input.weightUnit;
    if (typeof weight === "number" && weight > 0 && !resolvedWeightUnit) {
      hasUnitlessPositiveWeight = true;
    }
    const auxiliaryLoads = [
      { parsed: parsedBodyweight, headerUnit: bodyweightHeaderUnit },
      { parsed: parsedAssistance, headerUnit: assistanceHeaderUnit },
      { parsed: parsedAddedWeight, headerUnit: addedWeightHeaderUnit },
    ];
    if (auxiliaryLoads.some(({ parsed, headerUnit }) =>
      parsed.unit && headerUnit && parsed.unit !== headerUnit)) {
      skippedRowCount += 1;
      incrementReason(input.skipReasons, "weight units conflict within CSV metadata");
      continue;
    }
    if (auxiliaryLoads.some(({ parsed, headerUnit }) =>
      input.weightUnit && (parsed.unit ?? headerUnit) && input.weightUnit !== (parsed.unit ?? headerUnit))) {
      skippedRowCount += 1;
      incrementReason(input.skipReasons, "explicit weight unit conflicts with CSV metadata");
      continue;
    }
    if (auxiliaryLoads.some(({ parsed, headerUnit }) =>
      typeof parsed.weight === "number"
      && parsed.weight > 0
      && !(parsed.unit ?? headerUnit ?? input.weightUnit))) {
      hasUnitlessPositiveWeight = true;
    }
    const [bodyweightKg, assistanceKg, addedWeightKg] = auxiliaryLoads.map(({ parsed, headerUnit }) => {
      if (parsed.weight === undefined) return undefined;
      const unit = parsed.unit ?? headerUnit ?? input.weightUnit;
      return parsed.weight === 0 ? 0 : unit ? toKilograms(parsed.weight, unit) : undefined;
    });
    const declaredDistanceUnit = parsedDistance.unit ?? headerDistanceUnit;
    if (input.distanceUnit && declaredDistanceUnit && input.distanceUnit !== declaredDistanceUnit) {
      skippedRowCount += 1;
      incrementReason(input.skipReasons, "explicit distance unit conflicts with CSV metadata");
      continue;
    }
    const resolvedDistanceUnit = declaredDistanceUnit ?? input.distanceUnit;
    if (typeof distance === "number" && distance > 0 && !resolvedDistanceUnit) {
      hasUnitlessPositiveDistance = true;
    }

    const distanceMeters = distance !== undefined && distance > 0 && resolvedDistanceUnit
      ? toDistanceMeters(distance, resolvedDistanceUnit)
      : undefined;
    const priorTitle = titleByOccurredAt.get(occurredAt);
    if (priorTitle && priorTitle !== title) {
      skippedRowCount += 1;
      incrementReason(input.skipReasons, "ambiguous workout identity at the same timestamp");
      continue;
    }
    titleByOccurredAt.set(occurredAt, title);

    const sourceSessionKey = stableWorkoutSessionKey(rawTimestamp);
    const sourceWorkoutId = stableWorkoutSourceId(input.source, sourceSessionKey);
    let session = sessions.get(sourceWorkoutId);
    if (!session) {
      session = {
        sourceSessionKey,
        sourceWorkoutId,
        title,
        occurredAt,
        exercises: [],
      };
      sessions.set(sourceWorkoutId, session);
    }
    const rawDuration = valueAt(row, durationIndex);
    const durationMinutes = parseDurationMinutes(rawDuration);
    if (session.durationMinutes === undefined && rawDuration !== undefined) {
      if (durationMinutes === undefined) {
        invalidDurationSessionIds.add(sourceWorkoutId);
      } else {
        session.durationMinutes = durationMinutes;
        invalidDurationSessionIds.delete(sourceWorkoutId);
      }
    }
    const rawEndTime = valueAt(row, endTimeIndex);
    session.endedAt = session.endedAt ?? (rawEndTime
      ? normalizeWorkoutTimestamp(rawDate, rawEndTime, input.timeZone)
      : undefined);
    if (distanceMeters !== undefined) {
      session.distanceKm = (session.distanceKm ?? 0) + distanceMeters / 1000;
    }
    session.note = session.note ?? valueAt(row, workoutNoteIndex);

    let exercise = session.exercises.at(-1);
    if (!exercise || exercise.name !== exerciseName) {
      exercise = {
        name: exerciseName,
        order: session.exercises.length + 1,
        groupId: valueAt(row, groupIndex),
        note: valueAt(row, exerciseNoteIndex),
        sets: [],
      };
      session.exercises.push(exercise);
    }
    exercise.groupId = exercise.groupId ?? valueAt(row, groupIndex);
    exercise.note = exercise.note ?? valueAt(row, exerciseNoteIndex);

    const normalizedGenericType = normalizeSetType(valueAt(row, setTypeIndex), input.detectedSource);
    const type = input.detectedSource === "strong"
      ? normalizeSetType(rawSetOrder, input.detectedSource)
      : normalizedGenericType !== "normal"
        ? normalizedGenericType
        : parseBooleanLike(valueAt(row, warmupIndex))
          ? "warmup"
          : parseBooleanLike(valueAt(row, dropsetIndex))
            ? "dropset"
            : parseBooleanLike(valueAt(row, failureIndex))
              ? "failure"
              : "normal";
    const requestedOrder = input.detectedSource === "strong"
      ? undefined
      : parseNonnegativeInteger(rawSetOrder);
    const set: WorkoutSet = {
      order: requestedOrder && requestedOrder > 0 ? requestedOrder : exercise.sets.length + 1,
      type,
      ...(reps !== undefined ? { reps } : {}),
      ...(weight !== undefined && weight > 0 ? { weight } : {}),
      ...(resolvedWeightUnit && weight !== undefined && weight > 0
        ? { weightUnit: resolvedWeightUnit }
        : {}),
      ...(durationSeconds !== undefined ? { durationSeconds: Math.round(durationSeconds) } : {}),
      ...(distanceMeters !== undefined
        ? { distanceMeters }
        : {}),
      ...(rpe !== undefined ? { rpe } : {}),
      ...(bodyweightKg !== undefined ? { bodyweightKg } : {}),
      ...(assistanceKg !== undefined ? { assistanceKg } : {}),
      ...(addedWeightKg !== undefined ? { addedWeightKg } : {}),
    };
    if (
      set.reps !== undefined
      || set.weight !== undefined
      || set.durationSeconds !== undefined
      || set.distanceMeters !== undefined
      || set.rpe !== undefined
      || set.bodyweightKg !== undefined
      || set.assistanceKg !== undefined
      || set.addedWeightKg !== undefined
    ) {
      exercise.sets.push(set);
    }
  }

  const planned = [...sessions.values()].map((session): PlannedWorkoutCsvSession => {
    const endedAt = session.endedAt
      ?? (session.durationMinutes
        ? new Date(new Date(session.occurredAt).getTime() + session.durationMinutes * 60_000).toISOString()
        : undefined);
    const exercises = session.exercises
      .filter((exercise) => exercise.sets.length > 0)
      .map((exercise) => {
        const unitOverride = exercise.sets.find((set) => set.weightUnit)?.weightUnit;
        return {
          ...exercise,
          mode: resolveExerciseMode(exercise),
          ...(unitOverride ? { unitOverride } : {}),
        };
      });
    return {
      sourceSessionKey: session.sourceSessionKey,
      sourceWorkoutId: session.sourceWorkoutId,
      occurredAt: session.occurredAt,
      title: session.title,
      ...(session.durationMinutes ? { durationMinutes: session.durationMinutes } : {}),
      ...(session.distanceKm ? { distanceKm: session.distanceKm } : {}),
      ...(session.note ? { note: session.note } : {}),
      workout: {
        sourceApp: input.source,
        sourceWorkoutId: session.sourceWorkoutId,
        startedAt: session.occurredAt,
        ...(endedAt ? { endedAt } : {}),
        routineName: session.title,
        ...(session.note ? { sessionNote: session.note } : {}),
        exercises,
      },
    };
  });

  return {
    sessions: planned,
    skippedRowCount,
    ignoredRowCount,
    invalidDurationCount: invalidDurationSessionIds.size,
    requiresWeightUnit: hasUnitlessPositiveWeight && !input.weightUnit,
    requiresDistanceUnit: hasUnitlessPositiveDistance && !input.distanceUnit && !headerDistanceUnit,
  };
}

export function planWorkoutCsvImport(input: WorkoutCsvPlannerInput): WorkoutCsvImportPlan {
  const byteSize = new TextEncoder().encode(input.text).byteLength;
  if (byteSize === 0) {
    throw new TypeError("Workout CSV is empty.");
  }
  if (byteSize > MAX_FILE_BYTES) {
    throw new TypeError(`Workout CSV exceeds the ${MAX_FILE_BYTES}-byte limit.`);
  }

  const timeZone = normalizeIanaTimeZone(input.timeZone);
  if (!timeZone) {
    throw new TypeError("Workout CSV import requires a valid vault time zone.");
  }
  const delimiter = input.delimiter ?? DEFAULT_DELIMITER;
  if (delimiter.length !== 1) {
    throw new TypeError("Workout CSV delimiter must be one character.");
  }

  const parsedRows = parseDelimitedRows(input.text, delimiter);
  const headerRow = parsedRows[0];
  if (!headerRow) {
    throw new TypeError("Workout CSV must include a header row.");
  }
  const headers = headerRow.map((header) => header.replace(/^\uFEFF/u, "").trim());
  const normalizedHeaders = headers.map(normalizeHeaderName);
  if (headers.length === 0 || normalizedHeaders.some((header) => header.length === 0)) {
    throw new TypeError("Workout CSV header cells must be non-empty.");
  }
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new TypeError("Workout CSV headers must be unique.");
  }

  const inferredSource = detectSource(headers);
  const explicitSource = input.source;
  const explicitDialect = explicitSource;
  const unambiguousSource = inferredSource;
  if (explicitDialect && unambiguousSource && explicitDialect !== unambiguousSource) {
    throw new TypeError(
      `Workout CSV source ${explicitDialect} conflicts with unambiguous ${unambiguousSource} headers.`,
    );
  }
  const detectedSource = explicitDialect ?? inferredSource;
  const source = explicitSource ?? normalizeSource(detectedSource ?? undefined);
  const normalized = normalizeRows(headers, parsedRows.slice(1), detectedSource);
  if (normalized.rows.length + normalized.skippedRowCount > MAX_DATA_ROWS) {
    throw new TypeError(`Workout CSV exceeds the ${MAX_DATA_ROWS}-row limit.`);
  }

  const built = buildSessions({
    headers,
    rows: normalized.rows,
    source,
    detectedSource,
    timeZone,
    weightUnit: input.weightUnit,
    distanceUnit: input.distanceUnit,
    skipReasons: normalized.skipReasons,
  });
  const skippedRowCount = normalized.skippedRowCount + built.skippedRowCount;
  if (built.sessions.length > MAX_WORKOUTS) {
    throw new TypeError(`Workout CSV exceeds the ${MAX_WORKOUTS}-workout limit.`);
  }

  const warnings = toWarnings({
    detectedSource,
    requiresSourceSelection:
      explicitDialect === undefined
      && detectedSource === null
      && hasSharedWorkoutHeaders(headers),
    repairedRowCount: normalized.repairedRowCount,
    ignoredRowCount: built.ignoredRowCount,
    skippedRowCount,
    invalidDurationCount: built.invalidDurationCount,
    requiresWeightUnit: built.requiresWeightUnit,
    requiresDistanceUnit: built.requiresDistanceUnit,
    hasExerciseColumn: findHeaderIndex(headers, ["exercise name", "exercise", "movement"]) !== undefined,
  });

  return {
    source,
    detectedSource,
    delimiter,
    timeZone,
    headers,
    rowCount: normalized.rows.length + normalized.skippedRowCount,
    repairedRowCount: normalized.repairedRowCount,
    ignoredRowCount: built.ignoredRowCount,
    skippedRowCount,
    skipReasons: [...normalized.skipReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
    estimatedWorkouts: built.sessions.length,
    requiresWeightUnit: built.requiresWeightUnit,
    weightUnit: input.weightUnit ?? null,
    requiresDistanceUnit: built.requiresDistanceUnit,
    distanceUnit: input.distanceUnit ?? null,
    importable:
      detectedSource !== null
      && built.sessions.length > 0
      && skippedRowCount === 0
      && !built.requiresWeightUnit
      && !built.requiresDistanceUnit,
    warnings,
    sessions: built.sessions,
  };
}
