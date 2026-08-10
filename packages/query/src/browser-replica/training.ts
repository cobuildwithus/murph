import { BROWSER_VAULT_TRAINING_SESSION_SCHEMA } from "@murphai/contracts/browser-vault";

import type { CanonicalEntity } from "../canonical-entities.ts";

const TRAINING_LOOKBACK_DAYS = 183;
const MAX_EXERCISES = 150;
const MAX_SETS_PER_EXERCISE = 150;
const MAX_TOTAL_SETS_PER_SESSION = 300;
const STRENGTH_ACTIVITY_TYPES = new Set([
  "strength",
  "strength-training",
  "weight-training",
  "weightlifting",
  "resistance-training",
]);

export function projectBrowserTrainingSession(input: {
  activityKind: string | null;
  entity: CanonicalEntity;
  generatedAt: string;
}): Record<string, unknown> | null {
  const source = input.entity.frontmatter ?? input.entity.attributes;
  const workout = readRecord(source.workout);
  const sourceApp = readString(workout?.sourceApp);
  const workoutStartedAt = readString(workout?.startedAt);
  const workoutEndedAt = readString(workout?.endedAt);
  const exercises = projectExercises(workout?.exercises);
  const strengthExercises = projectLegacyExercises(source.strengthExercises);
  if (exercises === null || strengthExercises === null) {
    return null;
  }

  const activityType = normalizeActivityType(
    readString(source.activityType) ?? input.activityKind,
  );
  const activeLiveWorkout =
    sourceApp === "murph-live"
    && workoutStartedAt !== null
    && workoutEndedAt === null;
  const explicitStrength =
    activityType !== null && STRENGTH_ACTIVITY_TYPES.has(activityType);

  if (
    !activeLiveWorkout
    && !explicitStrength
    && exercises.length === 0
    && strengthExercises.length === 0
  ) {
    return null;
  }

  const localDate = resolveProjectionDate(
    input.entity,
    workoutStartedAt ?? readString(source.startedAt),
  );
  if (!activeLiveWorkout && !isWithinLookback(localDate, input.generatedAt)) {
    return null;
  }

  const training: Record<string, unknown> = {
    activityType: activityType ?? "strength-training",
    schema: BROWSER_VAULT_TRAINING_SESSION_SCHEMA,
  };
  assignScalar(training, "title", source.title ?? input.entity.title);
  assignScalar(training, "note", source.note);
  assignScalar(training, "durationMinutes", source.durationMinutes);
  assignScalar(
    training,
    "startedAt",
    workoutStartedAt ?? readString(source.startedAt) ?? input.entity.occurredAt,
  );
  assignScalar(
    training,
    "endedAt",
    workoutEndedAt
      ?? readString(source.endedAt)
      ?? readString(source.completedAt),
  );
  training.state = activeLiveWorkout ? "in_progress" : "completed";
  assignScalar(training, "routineName", workout?.routineName);
  assignScalar(training, "sessionNote", workout?.sessionNote);

  if (Array.isArray(workout?.exercises)) {
    training.exercises = exercises;
  }
  if (strengthExercises.length > 0) {
    training.strengthExercises = strengthExercises;
  }

  return training;
}

function projectExercises(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > MAX_EXERCISES) {
    return null;
  }

  const projectedExercises: Record<string, unknown>[] = [];
  let totalSetCount = 0;
  for (let exerciseIndex = 0; exerciseIndex < value.length; exerciseIndex += 1) {
    const exercise = readRecord(value[exerciseIndex]);
    const name = readString(exercise?.name);
    if (!exercise || !name) {
      continue;
    }
    const sets = projectSets(exercise.sets);
    if (sets === null) {
      return null;
    }
    totalSetCount += sets.length;
    if (totalSetCount > MAX_TOTAL_SETS_PER_SESSION) {
      return null;
    }

    const projected: Record<string, unknown> = {
      name,
      order: readPositiveInteger(exercise.order) ?? exerciseIndex + 1,
      sets,
    };
    for (const key of ["note", "sourceExerciseId", "unitOverride"] as const) {
      assignScalar(projected, key, exercise[key]);
    }
    projectedExercises.push(projected);
  }
  return projectedExercises;
}

function projectSets(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > MAX_SETS_PER_EXERCISE) {
    return null;
  }

  return value.flatMap((entry, setIndex) => {
    const set = readRecord(entry);
    if (!set) {
      return [];
    }

    const projected: Record<string, unknown> = {
      order: readPositiveInteger(set.order) ?? setIndex + 1,
    };
    for (const key of [
      "addedWeightKg",
      "assistanceKg",
      "bodyweightKg",
      "distanceMeters",
      "durationSeconds",
      "note",
      "reps",
      "rpe",
      "weight",
      "weightUnit",
    ] as const) {
      assignScalar(projected, key, set[key]);
    }
    return [projected];
  });
}

function projectLegacyExercises(
  value: unknown,
): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > MAX_EXERCISES) {
    return null;
  }

  const projectedExercises: Record<string, unknown>[] = [];
  let totalSetCount = 0;
  for (const entry of value) {
    const exercise = readRecord(entry);
    if (!exercise) {
      continue;
    }
    const name = readString(exercise.exercise) ?? readString(exercise.name);
    if (!name) {
      continue;
    }

    const setCount = readPositiveInteger(exercise.setCount) ?? 0;
    totalSetCount += setCount;
    if (totalSetCount > MAX_TOTAL_SETS_PER_SESSION) {
      return null;
    }

    const projected: Record<string, unknown> = { exercise: name };
    for (const key of [
      "load",
      "loadDescription",
      "loadUnit",
      "repsPerSet",
      "setCount",
    ] as const) {
      assignScalar(projected, key, exercise[key]);
    }
    projectedExercises.push(projected);
  }
  return projectedExercises;
}

function assignScalar(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length > 0) {
      target[key] = normalized;
    }
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
    return;
  }
  if (typeof value === "boolean") {
    target[key] = value;
  }
}

function resolveProjectionDate(
  entity: CanonicalEntity,
  startedAt: string | null,
): string | null {
  if (isIsoDate(entity.date)) {
    return entity.date;
  }
  const startedDate = startedAt?.slice(0, 10) ?? null;
  if (isIsoDate(startedDate)) {
    return startedDate;
  }
  const occurredDate = entity.occurredAt?.slice(0, 10) ?? null;
  return isIsoDate(occurredDate) ? occurredDate : null;
}

function isWithinLookback(
  localDate: string | null,
  generatedAt: string,
): boolean {
  if (!localDate) {
    return false;
  }
  const currentDate = generatedAt.slice(0, 10);
  // The replica does not know the browser's time zone. Retain one local-date
  // boundary on either side of the UTC-derived window; the browser applies the
  // exact member-local lookback after decrypting the replica.
  const cutoff = addDays(currentDate, -TRAINING_LOOKBACK_DAYS);
  const latestDate = addDays(currentDate, 1);
  return localDate >= cutoff && localDate <= latestDate;
}

function normalizeActivityType(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase().replace(/[_\s]+/gu, "-");
  return normalized || null;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number"
      && Number.isSafeInteger(value)
      && value > 0
    ? value
    : null;
}
