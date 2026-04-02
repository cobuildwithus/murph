import type {
  ActivityStrengthExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
  WorkoutTemplateSet,
} from '@murphai/contracts'

interface StrengthExerciseSummary {
  setCount: number
  repsPerSet: number
  load?: number
  loadUnit?: 'lb' | 'kg'
  loadDescription?: string
}

function formatActivityLabel(activityType: string): string {
  const knownLabels: Record<string, string> = {
    running: 'Run',
    walking: 'Walk',
    hiking: 'Hike',
    cycling: 'Ride',
    swimming: 'Swim',
    rowing: 'Row',
    yoga: 'Yoga',
    pilates: 'Pilates',
    'strength-training': 'Strength Training',
  }

  if (knownLabels[activityType]) {
    return knownLabels[activityType]
  }

  return activityType
    .split('-')
    .filter((token) => token.length > 0)
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(' ')
}

function summarizeWorkoutSet(
  sets: readonly WorkoutSet[],
): StrengthExerciseSummary | null {
  const repValues = sets
    .map((set) => set.reps)
    .filter((value): value is number => typeof value === 'number' && value > 0)

  if (repValues.length === 0) {
    return null
  }

  const loadSet = sets.find(
    (set) => typeof set.weight === 'number' && typeof set.weightUnit === 'string',
  )

  if (loadSet && typeof loadSet.weight === 'number' && loadSet.weightUnit) {
    return {
      setCount: sets.length,
      repsPerSet: repValues[0] ?? 0,
      load: loadSet.weight,
      loadUnit: loadSet.weightUnit,
    }
  }

  return {
    setCount: sets.length,
    repsPerSet: repValues[0] ?? 0,
  }
}

function summarizeTemplateSet(
  sets: readonly WorkoutTemplateSet[],
): StrengthExerciseSummary | null {
  const repValues = sets
    .map((set) => set.targetReps)
    .filter((value): value is number => typeof value === 'number' && value > 0)

  if (repValues.length === 0) {
    return null
  }

  const loadSet = sets.find(
    (set) => typeof set.targetWeight === 'number' && typeof set.targetWeightUnit === 'string',
  )

  if (loadSet && typeof loadSet.targetWeight === 'number' && loadSet.targetWeightUnit) {
    return {
      setCount: sets.length,
      repsPerSet: repValues[0] ?? 0,
      load: loadSet.targetWeight,
      loadUnit: loadSet.targetWeightUnit,
    }
  }

  return {
    setCount: sets.length,
    repsPerSet: repValues[0] ?? 0,
  }
}

export function deriveDurationMinutesFromTimestamps(
  startedAt?: string,
  endedAt?: string,
): number | null {
  if (!startedAt || !endedAt) {
    return null
  }

  const startMs = new Date(startedAt).getTime()
  const endMs = new Date(endedAt).getTime()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null
  }

  return Math.max(1, Math.round((endMs - startMs) / 60000))
}

export function buildWorkoutTitle(
  activityType: string,
  durationMinutes: number,
  routineName?: string,
): string {
  if (typeof routineName === 'string' && routineName.trim().length > 0) {
    return routineName.trim()
  }

  const label = formatActivityLabel(activityType)
  return `${durationMinutes}-minute ${label.toLowerCase()}`
}

export function summarizeWorkoutSessionExercises(
  workout: WorkoutSession | undefined,
): ActivityStrengthExercise[] | undefined {
  if (!workout) {
    return undefined
  }

  const summary = workout.exercises
    .slice()
    .sort((left, right) => left.order - right.order)
    .flatMap((exercise) => {
      const setSummary = summarizeWorkoutSet(
        exercise.sets.slice().sort((left, right) => left.order - right.order),
      )

      if (!setSummary) {
        return []
      }

      return [{
        exercise: exercise.name,
        ...setSummary,
        ...(setSummary.load !== undefined && exercise.note
          ? { loadDescription: exercise.note }
          : {}),
      } satisfies ActivityStrengthExercise]
    })

  return summary.length > 0 ? summary : undefined
}

export function summarizeWorkoutTemplateExercises(
  template: WorkoutTemplate | undefined,
): ActivityStrengthExercise[] | undefined {
  if (!template) {
    return undefined
  }

  const summary = template.exercises
    .slice()
    .sort((left, right) => left.order - right.order)
    .flatMap((exercise) => {
      const setSummary = summarizeTemplateSet(
        exercise.plannedSets.slice().sort((left, right) => left.order - right.order),
      )

      if (!setSummary) {
        return []
      }

      return [{
        exercise: exercise.name,
        ...setSummary,
        ...(setSummary.load !== undefined && exercise.note
          ? { loadDescription: exercise.note }
          : {}),
      } satisfies ActivityStrengthExercise]
    })

  return summary.length > 0 ? summary : undefined
}

export function buildWorkoutSessionFromTemplate(
  template: WorkoutTemplate,
  input: {
    sourceApp?: string
    sourceWorkoutId?: string
    startedAt?: string
    endedAt?: string
    routineId?: string
    routineName?: string
    sessionNote?: string
  } = {},
): WorkoutSession {
  return {
    sourceApp: input.sourceApp,
    sourceWorkoutId: input.sourceWorkoutId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    routineId: input.routineId,
    routineName: input.routineName,
    sessionNote: input.sessionNote ?? template.routineNote,
    exercises: template.exercises
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((exercise) => ({
        name: exercise.name,
        order: exercise.order,
        groupId: exercise.groupId,
        mode: exercise.mode,
        unitOverride: exercise.unitOverride,
        note: exercise.note,
        sets: exercise.plannedSets
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((set) => ({
            order: set.order,
            type: set.type,
            reps: set.targetReps,
            weight: set.targetWeight,
            weightUnit: set.targetWeightUnit,
            durationSeconds: set.targetDurationSeconds,
            distanceMeters: set.targetDistanceMeters,
            rpe: set.targetRpe,
          })),
      })),
  }
}
