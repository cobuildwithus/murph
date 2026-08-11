import { BROWSER_VAULT_TRAINING_SESSION_SCHEMA } from "@murphai/contracts/browser-vault";
import type {
  BrowserVaultEntity,
  BrowserVaultQueryClient,
} from "@murphai/query/browser-replica-client";

const RECENT_SESSION_LIMIT = 24;
const EXERCISE_PROGRESS_LIMIT = 8;
const SUMMARY_LOOKBACK_DAYS = 30;
const PROGRESS_LOOKBACK_DAYS = 183;
const WEEK_COUNT = 8;

export interface TrainingSetView {
  addedWeightKg: number | null;
  assistanceKg: number | null;
  bodyweightKg: number | null;
  completed: boolean;
  distanceMeters: number | null;
  durationSeconds: number | null;
  id: string;
  note: string | null;
  order: number;
  reps: number | null;
  rpe: number | null;
  weight: number | null;
  weightUnit: string | null;
}

export interface TrainingExerciseView {
  id: string;
  name: string;
  note: string | null;
  order: number;
  sets: TrainingSetView[];
  sourceExerciseId: string | null;
}

export interface TrainingSessionView {
  activityType: string;
  completedSetCount: number;
  date: string;
  distanceKm: number | null;
  durationMinutes: number | null;
  endedAt: string | null;
  exerciseCount: number;
  exercises: TrainingExerciseView[];
  id: string;
  note: string | null;
  setCount: number;
  startedAt: string;
  state: "completed" | "in_progress";
  title: string;
}

export interface TrainingExerciseProgress {
  bestSet: TrainingSetView | null;
  id: string;
  lastPerformedDate: string;
  lastSet: TrainingSetView | null;
  name: string;
  sessionCount: number;
  setCount: number;
}

export interface TrainingSummary {
  exerciseCount: number;
  setCount: number;
  trainingDayCount: number;
  workoutCount: number;
}

export interface TrainingWeek {
  count: number;
  label: string;
  startDate: string;
}

export interface BrowserTrainingView {
  activeSession: TrainingSessionView | null;
  exerciseProgress: TrainingExerciseProgress[];
  generatedAt: string;
  recentSessions: TrainingSessionView[];
  summary: TrainingSummary;
  weeks: TrainingWeek[];
}

export type TrainingHandoffBaseline =
  | {
      activeSessionFingerprint: string;
      activeSessionId: string;
      kind: "continue";
      manualSessionFingerprints: Record<string, string>;
    }
  | {
      kind: "start";
      manualSessionFingerprints: Record<string, string>;
    };

type TrainingSessionRecord = TrainingSessionView & {
  source: string | null;
};

export function createTrainingHandoffBaseline(
  client: BrowserVaultQueryClient,
): TrainingHandoffBaseline {
  const sessions = listTrainingSessions(client);
  const manualSessionFingerprints = collectManualSessionFingerprints(sessions);
  const activeSession = sessions.find(
    (session) => session.state === "in_progress",
  );

  return activeSession
    ? {
        activeSessionFingerprint: fingerprintTrainingSession(activeSession),
        activeSessionId: activeSession.id,
        kind: "continue",
        manualSessionFingerprints,
      }
    : {
        kind: "start",
        manualSessionFingerprints,
      };
}

export function isTrainingHandoffComplete(
  baseline: TrainingHandoffBaseline,
  client: BrowserVaultQueryClient,
): boolean {
  const sessions = listTrainingSessions(client);
  if (baseline.kind === "continue") {
    const originalSession = sessions.find(
      (session) => session.id === baseline.activeSessionId,
    );
    if (originalSession) {
      return fingerprintTrainingSession(originalSession)
        !== baseline.activeSessionFingerprint;
    }

    const replacementActiveSession = sessions.find(
      (session) => session.state === "in_progress",
    );
    if (replacementActiveSession) {
      return true;
    }
  }

  return hasNewOrChangedManualSession(
    baseline.manualSessionFingerprints,
    sessions,
  );
}

export function selectBrowserVaultTraining(
  client: BrowserVaultQueryClient,
  options: { now?: Date; timeZone?: string } = {},
): BrowserTrainingView {
  const generatedAt = client.replica.generatedAt;
  const sessions = listTrainingSessions(client);
  const currentDate = resolveTrainingCurrentDate(
    options.now ?? new Date(),
    options.timeZone,
  );
  const activeSession =
    sessions.find((session) => session.state === "in_progress") ?? null;
  const completedSessions = sessions.filter(
    (session) => session.state === "completed",
  );
  const summarySessions = sessions.filter((session) =>
    isIsoDateWithinLookback(
      session.date,
      currentDate,
      SUMMARY_LOOKBACK_DAYS,
    )
  ).filter(isAggregateEligibleSession);
  const progressSessions = sessions.filter((session) =>
    isIsoDateWithinLookback(
      session.date,
      currentDate,
      PROGRESS_LOOKBACK_DAYS,
    )
  );

  return {
    activeSession,
    exerciseProgress: buildExerciseProgress(progressSessions),
    generatedAt,
    recentSessions: completedSessions.slice(0, RECENT_SESSION_LIMIT),
    summary: buildTrainingSummary(summarySessions),
    weeks: buildTrainingWeeks(
      sessions.filter(isAggregateEligibleSession),
      currentDate,
    ),
  };
}

function listTrainingSessions(
  client: BrowserVaultQueryClient,
): TrainingSessionRecord[] {
  return client.entities
    .list({ families: ["event"], kinds: ["activity_session"] })
    .flatMap(parseTrainingSession)
    .sort(compareSessionsLatestFirst);
}

function collectManualSessionFingerprints(
  sessions: readonly TrainingSessionRecord[],
): Record<string, string> {
  return Object.fromEntries(
    sessions
      .filter((session) => session.source === "manual")
      .map((session) => [session.id, fingerprintTrainingSession(session)]),
  );
}

function hasNewOrChangedManualSession(
  baseline: Readonly<Record<string, string>>,
  sessions: readonly TrainingSessionRecord[],
): boolean {
  return sessions.some(
    (session) => session.source === "manual"
      && baseline[session.id] !== fingerprintTrainingSession(session),
  );
}

function fingerprintTrainingSession(session: TrainingSessionRecord): string {
  return JSON.stringify(session);
}

function parseTrainingSession(entity: BrowserVaultEntity): TrainingSessionRecord[] {
  const training = readRecord(entity.attributes.training);
  if (
    !training
    || readString(training.schema) !== BROWSER_VAULT_TRAINING_SESSION_SCHEMA
  ) {
    return [];
  }

  const startedAt = readString(training.startedAt)
    ?? entity.occurredAt
    ?? (entity.date ? `${entity.date}T12:00:00.000Z` : null);
  if (!startedAt) {
    return [];
  }

  const endedAt = readString(training.endedAt);
  const state = readString(training.state) === "in_progress"
    ? "in_progress"
    : "completed";
  const exercises = parseWorkoutExercises({
    sessionId: entity.id,
    value: training.exercises,
  });
  const normalizedExercises = exercises.length > 0
    ? exercises
    : parseLegacyStrengthExercises({
        sessionId: entity.id,
        value: training.strengthExercises,
      });
  const durationMinutes = readNumber(training.durationMinutes)
    ?? deriveDurationMinutes(startedAt, endedAt);
  const activityType = readString(training.activityType)
    ?? readString(entity.attributes.activityKind)
    ?? (normalizedExercises.length > 0 ? "strength-training" : "activity");
  const title = readString(training.title)
    ?? readString(training.routineName)
    ?? defaultTrainingTitle(activityType);
  const note = readString(training.sessionNote)
    ?? readString(training.note);
  const sets = normalizedExercises.flatMap((exercise) => exercise.sets);

  return [{
    activityType,
    completedSetCount: sets.filter((set) => set.completed).length,
    date: entity.date ?? startedAt.slice(0, 10),
    distanceKm: readNumber(training.distanceKm),
    durationMinutes,
    endedAt,
    exerciseCount: normalizedExercises.length,
    exercises: normalizedExercises,
    id: entity.id,
    note,
    setCount: sets.length,
    source: readString(entity.attributes.source),
    startedAt,
    state,
    title,
  }];
}

function parseWorkoutExercises(input: {
  sessionId: string;
  value: unknown;
}): TrainingExerciseView[] {
  if (!Array.isArray(input.value)) {
    return [];
  }

  return input.value
    .flatMap((value, index) => {
      const exercise = readRecord(value);
      const name = readString(exercise?.name);
      if (!exercise || !name) {
        return [];
      }

      const order = readPositiveInteger(exercise.order) ?? index + 1;
      const sourceExerciseId = readString(exercise.sourceExerciseId);
      const exerciseKey = sourceExerciseId ?? normalizeExerciseName(name);
      const exerciseId = `${exerciseKey}:${order}:${index}`;
      const unitOverride = readString(exercise.unitOverride);
      const sets = Array.isArray(exercise.sets)
        ? exercise.sets.flatMap((setValue, setIndex) => {
            const set = readRecord(setValue);
            if (!set) {
              return [];
            }

            const setOrder = readPositiveInteger(set.order) ?? setIndex + 1;
            return [{
              addedWeightKg: readNumber(set.addedWeightKg),
              assistanceKg: readNumber(set.assistanceKg),
              bodyweightKg: readNumber(set.bodyweightKg),
              completed: hasLoggedTrainingSet(set),
              distanceMeters: readNumber(set.distanceMeters),
              durationSeconds: readNumber(set.durationSeconds),
              id: `${input.sessionId}:${exerciseId}:${setOrder}:${setIndex}`,
              note: readString(set.note),
              order: setOrder,
              reps: readNonNegativeInteger(set.reps),
              rpe: readNumber(set.rpe),
              weight: readNumber(set.weight),
              weightUnit: readString(set.weightUnit) ?? unitOverride,
            } satisfies TrainingSetView];
          })
        : [];

      return [{
        id: exerciseId,
        name,
        note: readString(exercise.note),
        order,
        sets: sets.sort((left, right) => left.order - right.order),
        sourceExerciseId,
      } satisfies TrainingExerciseView];
    })
    .sort((left, right) => left.order - right.order);
}

function parseLegacyStrengthExercises(input: {
  sessionId: string;
  value: unknown;
}): TrainingExerciseView[] {
  if (!Array.isArray(input.value)) {
    return [];
  }

  return input.value.flatMap((value, index) => {
    const exercise = readRecord(value);
    const name = readString(exercise?.exercise) ?? readString(exercise?.name);
    if (!exercise || !name) {
      return [];
    }

    const setCount = Math.min(
      readPositiveInteger(exercise.setCount) ?? 0,
      150,
    );
    const reps = readNonNegativeInteger(exercise.repsPerSet);
    const weight = readNumber(exercise.load);
    const weightUnit = readString(exercise.loadUnit);
    const exerciseId = `${normalizeExerciseName(name)}:${index + 1}`;
    const sets = Array.from({ length: setCount }, (_, setIndex) => ({
      addedWeightKg: null,
      assistanceKg: null,
      bodyweightKg: null,
      completed: true,
      distanceMeters: null,
      durationSeconds: null,
      id: `${input.sessionId}:${exerciseId}:${setIndex + 1}`,
      note: null,
      order: setIndex + 1,
      reps,
      rpe: null,
      weight,
      weightUnit,
    } satisfies TrainingSetView));

    return [{
      id: exerciseId,
      name,
      note: readString(exercise.loadDescription),
      order: index + 1,
      sets,
      sourceExerciseId: null,
    } satisfies TrainingExerciseView];
  });
}

function hasLoggedTrainingSet(set: Record<string, unknown>): boolean {
  return readString(set.note) !== null
    || readNumber(set.reps) !== null
    || readNumber(set.weight) !== null
    || readNumber(set.durationSeconds) !== null
    || readNumber(set.distanceMeters) !== null
    || readNumber(set.rpe) !== null
    || readNumber(set.bodyweightKg) !== null
    || readNumber(set.assistanceKg) !== null
    || readNumber(set.addedWeightKg) !== null;
}

function isAggregateEligibleSession(session: TrainingSessionView): boolean {
  return session.state === "completed" || session.completedSetCount > 0;
}

function buildTrainingSummary(
  sessions: readonly TrainingSessionView[],
): TrainingSummary {
  const completedSets = sessions.flatMap((session) =>
    session.exercises.flatMap((exercise) =>
      exercise.sets.filter((set) => set.completed)
    )
  );
  const exerciseIds = new Set(
    sessions.flatMap((session) =>
      session.exercises
        .filter((exercise) => exercise.sets.some((set) => set.completed))
        .map(progressExerciseKey)
    ),
  );

  return {
    exerciseCount: exerciseIds.size,
    setCount: completedSets.length,
    trainingDayCount: new Set(sessions.map((session) => session.date)).size,
    workoutCount: sessions.length,
  };
}

function buildExerciseProgress(
  sessions: readonly TrainingSessionView[],
): TrainingExerciseProgress[] {
  interface MutableProgress {
    bestSet: TrainingSetView | null;
    id: string;
    lastPerformedAt: string;
    lastPerformedDate: string;
    lastSet: TrainingSetView | null;
    name: string;
    sessionIds: Set<string>;
    setCount: number;
  }

  const byExercise = new Map<string, MutableProgress>();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const completedSets = exercise.sets.filter((set) => set.completed);
      if (completedSets.length === 0) {
        continue;
      }

      const id = progressExerciseKey(exercise);
      const current = byExercise.get(id) ?? {
        bestSet: null,
        id,
        lastPerformedAt: session.startedAt,
        lastPerformedDate: session.date,
        lastSet: null,
        name: exercise.name,
        sessionIds: new Set<string>(),
        setCount: 0,
      };
      const latestSet = completedSets.at(-1) ?? null;
      const representativeSet = completedSets
        .filter(hasComparableBestMeasurement)
        .reduce<TrainingSetView | null>(
          (best, set) =>
            best === null || compareTrainingSets(set, best) > 0 ? set : best,
          null,
        );

      current.sessionIds.add(session.id);
      current.setCount += completedSets.length;
      if (session.startedAt >= current.lastPerformedAt) {
        current.lastPerformedAt = session.startedAt;
        current.lastPerformedDate = session.date;
        current.lastSet = latestSet;
        current.name = exercise.name;
      }
      if (
        representativeSet
        && (
          current.bestSet === null
          || compareTrainingSets(representativeSet, current.bestSet) > 0
        )
      ) {
        current.bestSet = representativeSet;
      }
      byExercise.set(id, current);
    }
  }

  return [...byExercise.values()]
    .sort((left, right) =>
      right.lastPerformedAt.localeCompare(left.lastPerformedAt)
      || right.sessionIds.size - left.sessionIds.size
      || left.name.localeCompare(right.name)
    )
    .slice(0, EXERCISE_PROGRESS_LIMIT)
    .map((entry) => ({
      bestSet: entry.bestSet,
      id: entry.id,
      lastPerformedDate: entry.lastPerformedDate,
      lastSet: entry.lastSet,
      name: entry.name,
      sessionCount: entry.sessionIds.size,
      setCount: entry.setCount,
    }));
}

function buildTrainingWeeks(
  sessions: readonly TrainingSessionView[],
  currentDateValue: string,
): TrainingWeek[] {
  const currentDate = parseIsoDate(currentDateValue);
  if (!currentDate) {
    return [];
  }

  const currentWeekStart = startOfUtcWeek(currentDate);
  return Array.from({ length: WEEK_COUNT }, (_, index) => {
    const weekOffset = index - (WEEK_COUNT - 1);
    const start = addUtcDays(currentWeekStart, weekOffset * 7);
    const end = addUtcDays(start, 7);
    const count = sessions.filter((session) => {
      const date = parseIsoDate(session.date);
      return date !== null && date >= start && date < end;
    }).length;

    return {
      count,
      label: new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(start),
      startDate: start.toISOString().slice(0, 10),
    } satisfies TrainingWeek;
  });
}

function compareTrainingSets(
  left: TrainingSetView,
  right: TrainingSetView,
): number {
  const assistanceDifference = compareAssistance(left, right);
  if (assistanceDifference !== 0) {
    return assistanceDifference;
  }

  const leftLoad = normalizedLoadKg(left);
  const rightLoad = normalizedLoadKg(right);
  if (leftLoad !== rightLoad) {
    return leftLoad - rightLoad;
  }

  return (left.reps ?? 0) - (right.reps ?? 0);
}

function compareAssistance(
  left: TrainingSetView,
  right: TrainingSetView,
): number {
  if (left.assistanceKg === null && right.assistanceKg === null) {
    return 0;
  }
  if (left.assistanceKg === null) {
    return 1;
  }
  if (right.assistanceKg === null) {
    return -1;
  }
  return right.assistanceKg - left.assistanceKg;
}

function normalizedLoadKg(set: TrainingSetView): number {
  if (set.weight !== null) {
    return isPoundUnit(set.weightUnit)
      ? set.weight * 0.45359237
      : set.weight;
  }
  if (set.addedWeightKg !== null) {
    return set.addedWeightKg;
  }
  return 0;
}

function hasComparableBestMeasurement(set: TrainingSetView): boolean {
  if (set.durationSeconds !== null || set.distanceMeters !== null) {
    return false;
  }

  if (
    set.weight !== null
    && !isPoundUnit(set.weightUnit)
    && !isKilogramUnit(set.weightUnit)
  ) {
    return false;
  }

  return set.weight !== null
    || set.addedWeightKg !== null
    || set.assistanceKg !== null
    || set.reps !== null;
}

function isPoundUnit(value: string | null): boolean {
  return value !== null
    && ["lb", "lbs", "pound", "pounds"].includes(value.toLowerCase());
}

function isKilogramUnit(value: string | null): boolean {
  return value !== null
    && ["kg", "kgs", "kilogram", "kilograms"].includes(value.toLowerCase());
}

function progressExerciseKey(exercise: TrainingExerciseView): string {
  return exercise.sourceExerciseId ?? normalizeExerciseName(exercise.name);
}

function normalizeExerciseName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, "-");
}

function compareSessionsLatestFirst(
  left: TrainingSessionView,
  right: TrainingSessionView,
): number {
  return right.startedAt.localeCompare(left.startedAt)
    || right.id.localeCompare(left.id);
}

function isIsoDateWithinLookback(
  value: string,
  currentDateValue: string,
  days: number,
): boolean {
  const date = parseIsoDate(value);
  const currentDate = parseIsoDate(currentDateValue);
  if (!date || !currentDate) {
    return false;
  }

  const cutoff = addUtcDays(currentDate, -(days - 1));
  return date >= cutoff && date <= currentDate;
}

function resolveTrainingCurrentDate(
  now: Date,
  timeZone?: string,
): string {
  if (Number.isNaN(now.getTime())) {
    return "";
  }
  const fallbackDate = now.toISOString().slice(0, 10);

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : fallbackDate;
  } catch {
    return fallbackDate;
  }
}

function deriveDurationMinutes(
  startedAt: string,
  endedAt: string | null,
): number | null {
  if (!endedAt) {
    return null;
  }

  const started = parseDateTime(startedAt);
  const ended = parseDateTime(endedAt);
  if (!started || !ended || ended < started) {
    return null;
  }

  return Math.max(
    1,
    Math.round((ended.getTime() - started.getTime()) / 60_000),
  );
}

function defaultTrainingTitle(activityType: string | null): string {
  if (
    activityType === "strength-training"
    || activityType === "strength_training"
    || activityType === "strength"
  ) {
    return "Strength training";
  }
  return "Workout";
}

function startOfUtcWeek(value: Date): Date {
  const result = new Date(value);
  result.setUTCHours(0, 0, 0, 0);
  const daysSinceMonday = (result.getUTCDay() + 6) % 7;
  result.setUTCDate(result.getUTCDate() - daysSinceMonday);
  return result;
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateTime(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number"
      && Number.isInteger(value)
      && value > 0
    ? value
    : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number"
      && Number.isInteger(value)
      && value >= 0
    ? value
    : null;
}
