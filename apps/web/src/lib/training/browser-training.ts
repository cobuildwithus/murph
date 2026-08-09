import type {
  BrowserVaultEntity,
  BrowserVaultQueryClient,
} from "@murphai/query/browser-replica-client";

const RECENT_SESSION_LIMIT = 12;
const EXERCISE_PROGRESS_LIMIT = 8;
const SUMMARY_LOOKBACK_DAYS = 30;
const PROGRESS_LOOKBACK_DAYS = 183;
const WEEK_COUNT = 8;

export interface TrainingSetView {
  addedWeightKg: number | null;
  assistanceKg: number | null;
  bodyweightKg: number | null;
  completed: boolean;
  completedAt: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  id: string;
  note: string | null;
  order: number;
  reps: number | null;
  rpe: number | null;
  type: string | null;
  weight: number | null;
  weightUnit: string | null;
}

export interface TrainingExerciseView {
  id: string;
  mode: string | null;
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
  durationMinutes: number | null;
  endedAt: string | null;
  exerciseCount: number;
  exercises: TrainingExerciseView[];
  id: string;
  note: string | null;
  routineId: string | null;
  setCount: number;
  source: string | null;
  startedAt: string;
  state: "completed" | "in_progress";
  title: string;
}

export interface TrainingExerciseProgress {
  bestSet: TrainingSetView | null;
  id: string;
  lastPerformedAt: string;
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

export function selectBrowserVaultTraining(
  client: BrowserVaultQueryClient,
): BrowserTrainingView {
  const generatedAt = client.replica.generatedAt;
  const sessions = client.entities
    .list({ families: ["event"], kinds: ["activity_session"] })
    .flatMap(parseTrainingSession)
    .filter(isStrengthTrainingSession)
    .sort(compareSessionsLatestFirst);
  const activeSession = sessions.find((session) => session.state === "in_progress") ?? null;
  const completedSessions = sessions.filter((session) => session.state === "completed");
  const recentSessions = completedSessions.slice(0, RECENT_SESSION_LIMIT);
  const summarySessions = sessions.filter((session) =>
    isWithinLookback(session.startedAt, generatedAt, SUMMARY_LOOKBACK_DAYS)
  );
  const progressSessions = sessions.filter((session) =>
    isWithinLookback(session.startedAt, generatedAt, PROGRESS_LOOKBACK_DAYS)
  );

  return {
    activeSession,
    exerciseProgress: buildExerciseProgress(progressSessions),
    generatedAt,
    recentSessions,
    summary: buildTrainingSummary(summarySessions),
    weeks: buildTrainingWeeks(sessions, generatedAt),
  };
}

function parseTrainingSession(entity: BrowserVaultEntity): TrainingSessionView[] {
  const attributes = entity.attributes;
  const workout = readRecord(attributes.workout);
  const explicitState = readSessionState(
    workout?.state
      ?? workout?.status
      ?? attributes.state
      ?? attributes.status
      ?? attributes.sessionStatus,
  );
  const inferredLiveState = readString(workout?.sourceApp) === "murph-live"
    && readString(workout?.startedAt) !== null
    && readString(workout?.endedAt) === null
      ? "in_progress"
      : null;
  const state = explicitState ?? inferredLiveState ?? "completed";
  const exercises = parseWorkoutExercises({
    active: state === "in_progress",
    sessionId: entity.id,
    value: workout?.exercises,
  });
  const legacyExercises = exercises.length > 0
    ? exercises
    : parseLegacyStrengthExercises({
        sessionId: entity.id,
        value: attributes.strengthExercises,
      });
  const startedAt = readString(workout?.startedAt)
    ?? readString(attributes.startedAt)
    ?? entity.occurredAt
    ?? (entity.date ? `${entity.date}T12:00:00.000Z` : null);

  if (!startedAt) {
    return [];
  }

  const endedAt = readString(workout?.endedAt)
    ?? readString(attributes.endedAt)
    ?? readString(attributes.completedAt);
  const durationMinutes = readNumber(attributes.durationMinutes)
    ?? deriveDurationMinutes(startedAt, endedAt);
  const title = readString(attributes.title)
    ?? readString(workout?.routineName)
    ?? entity.title
    ?? defaultTrainingTitle(
      readString(attributes.activityType) ?? readString(attributes.activityKind),
    );
  const note = readString(workout?.sessionNote) ?? readString(attributes.note);
  const activityType = readString(attributes.activityKind)
    ?? readString(attributes.activityType)
    ?? (legacyExercises.length > 0 ? "strength-training" : "activity");
  const sets = legacyExercises.flatMap((exercise) => exercise.sets);

  return [{
    activityType,
    completedSetCount: sets.filter((set) => set.completed).length,
    date: entity.date ?? startedAt.slice(0, 10),
    durationMinutes,
    endedAt,
    exerciseCount: legacyExercises.length,
    exercises: legacyExercises,
    id: entity.id,
    note,
    routineId: readString(workout?.routineId) ?? readString(attributes.routineId),
    setCount: sets.length,
    source: readString(attributes.source),
    startedAt,
    state,
    title,
  }];
}

function parseWorkoutExercises(input: {
  active: boolean;
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
      const exerciseId = sourceExerciseId ?? `${normalizeExerciseName(name)}:${order}`;
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
              completed: readSetCompleted(set, input.active),
              completedAt: readString(set.completedAt),
              distanceMeters: readNumber(set.distanceMeters),
              durationSeconds: readNumber(set.durationSeconds),
              id: `${input.sessionId}:${exerciseId}:${setOrder}:${setIndex}`,
              note: readString(set.note),
              order: setOrder,
              reps: readNonNegativeInteger(set.reps),
              rpe: readNumber(set.rpe),
              type: readString(set.type),
              weight: readNumber(set.weight),
              weightUnit: readString(set.weightUnit) ?? unitOverride,
            } satisfies TrainingSetView];
          })
        : [];

      return [{
        id: exerciseId,
        mode: readString(exercise.mode),
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

    const setCount = Math.min(readPositiveInteger(exercise.setCount) ?? 0, 150);
    const reps = readNonNegativeInteger(exercise.repsPerSet);
    const weight = readNumber(exercise.load);
    const weightUnit = readString(exercise.loadUnit);
    const exerciseId = `${normalizeExerciseName(name)}:${index + 1}`;
    const sets = Array.from({ length: setCount }, (_, setIndex) => ({
      addedWeightKg: null,
      assistanceKg: null,
      bodyweightKg: null,
      completed: true,
      completedAt: null,
      distanceMeters: null,
      durationSeconds: null,
      id: `${input.sessionId}:${exerciseId}:${setIndex + 1}`,
      note: null,
      order: setIndex + 1,
      reps,
      rpe: null,
      type: null,
      weight,
      weightUnit,
    } satisfies TrainingSetView));

    return [{
      id: exerciseId,
      mode: weight !== null ? "weight_reps" : null,
      name,
      note: readString(exercise.loadDescription),
      order: index + 1,
      sets,
      sourceExerciseId: null,
    } satisfies TrainingExerciseView];
  });
}

function readSetCompleted(
  set: Record<string, unknown>,
  activeSession: boolean,
): boolean {
  const status = readString(set.status);
  if (status === "skipped" || status === "planned" || set.completed === false) {
    return false;
  }
  if (
    set.completed === true
    || readString(set.completedAt)
    || status === "completed"
    || status === "done"
  ) {
    return true;
  }

  return activeSession ? hasLoggedTrainingSet(set) : true;
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

function readSessionState(value: unknown): TrainingSessionView["state"] | null {
  const state = readString(value)?.toLowerCase();
  if (!state) {
    return null;
  }
  if (["active", "in_progress", "in-progress", "started"].includes(state)) {
    return "in_progress";
  }
  if (["completed", "complete", "done", "finished"].includes(state)) {
    return "completed";
  }
  return null;
}

function isStrengthTrainingSession(session: TrainingSessionView): boolean {
  return session.exercises.length > 0
    || session.activityType === "strength-training"
    || session.activityType === "strength_training"
    || session.activityType === "strength";
}

function buildTrainingSummary(sessions: readonly TrainingSessionView[]): TrainingSummary {
  const completedSets = sessions.flatMap((session) =>
    session.exercises.flatMap((exercise) => exercise.sets.filter((set) => set.completed))
  );
  const exerciseIds = new Set(
    sessions.flatMap((session) => session.exercises.map(progressExerciseKey)),
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
        lastSet: null,
        name: exercise.name,
        sessionIds: new Set<string>(),
        setCount: 0,
      };
      const latestSet = completedSets.at(-1) ?? null;
      const representativeSet = completedSets.reduce<TrainingSetView | null>(
        (best, set) => best === null || compareTrainingSets(set, best) > 0 ? set : best,
        null,
      );

      current.sessionIds.add(session.id);
      current.setCount += completedSets.length;
      if (session.startedAt >= current.lastPerformedAt) {
        current.lastPerformedAt = session.startedAt;
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
      lastPerformedAt: entry.lastPerformedAt,
      lastSet: entry.lastSet,
      name: entry.name,
      sessionCount: entry.sessionIds.size,
      setCount: entry.setCount,
    }));
}

function buildTrainingWeeks(
  sessions: readonly TrainingSessionView[],
  generatedAt: string,
): TrainingWeek[] {
  const now = parseDate(generatedAt);
  if (!now) {
    return [];
  }

  const currentWeekStart = startOfUtcWeek(now);
  return Array.from({ length: WEEK_COUNT }, (_, index) => {
    const weekOffset = index - (WEEK_COUNT - 1);
    const start = addUtcDays(currentWeekStart, weekOffset * 7);
    const end = addUtcDays(start, 7);
    const count = sessions.filter((session) => {
      const date = parseDate(session.startedAt);
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
  const leftLoad = normalizedLoadKg(left);
  const rightLoad = normalizedLoadKg(right);
  if (leftLoad !== rightLoad) {
    return leftLoad - rightLoad;
  }

  return (left.reps ?? 0) - (right.reps ?? 0)
    || (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0)
    || (left.distanceMeters ?? 0) - (right.distanceMeters ?? 0);
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

function isPoundUnit(value: string | null): boolean {
  return value !== null
    && ["lb", "lbs", "pound", "pounds"].includes(value.toLowerCase());
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
  return right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id);
}

function isWithinLookback(
  value: string,
  generatedAt: string,
  days: number,
): boolean {
  const date = parseDate(value);
  const now = parseDate(generatedAt);
  if (!date || !now) {
    return false;
  }

  const cutoff = addUtcDays(now, -(days - 1));
  cutoff.setUTCHours(0, 0, 0, 0);
  return date >= cutoff && date <= now;
}

function deriveDurationMinutes(
  startedAt: string,
  endedAt: string | null,
): number | null {
  if (!endedAt) {
    return null;
  }

  const started = parseDate(startedAt);
  const ended = parseDate(endedAt);
  if (!started || !ended || ended < started) {
    return null;
  }

  return Math.max(1, Math.round((ended.getTime() - started.getTime()) / 60_000));
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

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
