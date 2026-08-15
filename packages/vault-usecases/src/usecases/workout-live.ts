import {
  type WorkoutLiveApplyMemberActionV1,
  type WorkoutExercise,
  type WorkoutMemberActionExpectedSetResultV1,
  type WorkoutMemberActionExpectedSetStateV1,
  type WorkoutMemberActionSetResultV1,
  type WorkoutSession,
  type WorkoutSessionDetailV1,
  type WorkoutSet,
  memberActionIdV1Schema,
  workoutLiveApplyMemberActionV1Schema,
  workoutSessionSchema,
  workoutTemplateSchema,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  deriveWorkoutActionBinding,
  deriveWorkoutSetRemovalBinding,
  hasAmbiguousWorkoutActionExerciseCoordinates,
} from '@murphai/operator-config/workout-action-binding'

import { showWorkoutFormat } from './workout-format.js'
import { addStructuredWorkoutRecord, editWorkoutRecord } from './workout.js'
import {
  LIVE_WORKOUT_SOURCE_APP,
  type ApplyLiveWorkoutMemberActionInput,
  type ApplyLiveWorkoutMemberActionResult,
  type AddLiveWorkoutExerciseInput,
  type ClearLiveWorkoutSetInput,
  type FinishLiveWorkoutInput,
  type LiveWorkoutLookupInput,
  type LogLiveWorkoutSetInput,
  type StartLiveWorkoutInput,
  buildLiveWorkoutCardEditor,
  buildLiveWorkoutSessionFromTemplate,
  elapsedDurationMinutes,
  hasLoggedWorkoutSet,
} from './workout-live-model.js'
import {
  assertTargetableLiveWorkout,
  compactSetPatch,
  findActiveLiveWorkouts,
  findLiveWorkoutsForMemberAction,
  normalizeLiveWorkoutActivityType,
  normalizeOptionalText,
  normalizeWorkoutTimestamp,
  optionalString,
  parseShownWorkout,
  requireLiveWorkoutSetOrder,
  requireNonEmptyText,
  requireString,
  resolveExerciseIndex,
  resolveLiveWorkout,
  updateLiveWorkoutExercises,
  updateLiveWorkoutExercisesAfterValidatedSetRemoval,
  withLiveWorkoutMutationLock,
} from './workout-live-state.js'

export * from './workout-live-model.js'

export async function readLiveWorkoutCardEditor(input: {
  presentation: WorkoutSessionDetailV1
  vault: string
  workoutId: string
}) {
  const shown = await resolveLiveWorkout({
    vault: input.vault,
    workoutId: input.workoutId,
  }, { requireActive: true })
  const workout = parseShownWorkout(shown)
  assertTargetableLiveWorkout(workout, `Workout ${shown.entity.id}`)
  return buildLiveWorkoutCardEditor({
    presentation: input.presentation,
    workout,
    workoutId: shown.entity.id,
  })
}

const MAX_LIVE_WORKOUT_EXERCISES = 100
const MAX_LIVE_WORKOUT_SETS_PER_EXERCISE = 150

export async function applyLiveWorkoutMemberAction(
  input: ApplyLiveWorkoutMemberActionInput,
): Promise<ApplyLiveWorkoutMemberActionResult> {
  if (
    !workoutLiveApplyMemberActionV1Schema.safeParse(input.action).success
    || !memberActionIdV1Schema.safeParse(input.actionId).success
  ) {
    return { reason: 'workout_changed', status: 'rejected' }
  }
  return withLiveWorkoutMutationLock(input.vault, () =>
    applyLiveWorkoutMemberActionWithLockHeld(input),
  )
}

async function applyLiveWorkoutMemberActionWithLockHeld(
  input: ApplyLiveWorkoutMemberActionInput,
): Promise<ApplyLiveWorkoutMemberActionResult> {
  const candidates = await findLiveWorkoutsForMemberAction(
    input.vault,
    input.actionId,
  )
  if (candidates.exactReplays.length > 0) {
    if (candidates.exactReplays.length !== 1) {
      return { reason: 'workout_changed', status: 'rejected' }
    }
    return { status: 'unchanged' }
  }

  const active = candidates.active
  if (active.length === 0) {
    return { reason: 'no_active_workout', status: 'rejected' }
  }
  if (active.length > 1) {
    return { reason: 'multiple_active_workouts', status: 'rejected' }
  }

  const shown = active[0]!
  let workout: WorkoutSession
  try {
    workout = parseShownWorkout(shown)
    assertTargetableLiveWorkout(workout, `Workout ${shown.entity.id}`)
  } catch {
    return { reason: 'workout_changed', status: 'rejected' }
  }
  if (hasAmbiguousWorkoutActionExerciseCoordinates(workout)) {
    return { reason: 'workout_changed', status: 'rejected' }
  }
  if (
    input.action.expectedWorkout.actionBinding
      !== deriveWorkoutActionBinding(shown.entity.id, workout)
  ) {
    return { reason: 'workout_changed', status: 'rejected' }
  }
  const acceptedAtMs = Date.parse(input.acceptedAt)
  if (
    !Number.isFinite(acceptedAtMs)
    || typeof workout.startedAt !== 'string'
    || Date.parse(workout.startedAt) > acceptedAtMs
  ) {
    return { reason: 'workout_changed', status: 'rejected' }
  }

  const exercises = structuredClone(workout.exercises)
    .sort((left, right) => left.order - right.order)
  if (
    input.action.mutations.some((mutation) => mutation.kind === 'set.remove')
    && input.action.expectedWorkout.setRemovalBinding
      !== deriveWorkoutSetRemovalBinding(shown.entity.id, exercises)
  ) {
    return { reason: 'workout_changed', status: 'rejected' }
  }
  if (!memberActionExpectedWorkoutMatches(exercises, input.action)) {
    return { reason: 'workout_changed', status: 'rejected' }
  }

  const appendMutations = input.action.mutations.filter(
    (mutation) => mutation.kind === 'exercise.append',
  )
  const removeMutations = input.action.mutations.filter(
    (mutation): mutation is SetRemoveMutation => mutation.kind === 'set.remove',
  ).sort((left, right) =>
    left.exercisePosition === right.exercisePosition
      ? right.setPosition - left.setPosition
      : left.exercisePosition - right.exercisePosition,
  )
  const existingSetMutations = input.action.mutations.filter(
    (mutation): mutation is SetPutMutation => mutation.kind === 'set.put',
  )
  const newSetMutations = input.action.mutations.filter(
    (mutation): mutation is SetAppendMutation => mutation.kind === 'set.append',
  ).sort((left, right) =>
    left.exercisePosition === right.exercisePosition
      ? left.setPosition - right.setPosition
      : left.exercisePosition - right.exercisePosition,
  )

  for (const mutation of removeMutations) {
    const exercise = exercises[mutation.exercisePosition - 1]
    if (
      !exercise
      || exercise.name !== mutation.exerciseName
      || !memberActionExpectedSetsMatch(exercise.sets, mutation.expectedSets)
    ) {
      return { reason: 'workout_changed', status: 'rejected' }
    }
  }

  for (const mutation of appendMutations) {
    const existing = exercises[mutation.exercisePosition - 1]
    if (existing) {
      return { reason: 'workout_changed', status: 'rejected' }
    }
    if (mutation.exercisePosition !== exercises.length + 1) {
      return { reason: 'workout_changed', status: 'rejected' }
    }

    const order = exercises.reduce(
      (maximum, exercise) => Math.max(maximum, exercise.order),
      0,
    ) + 1
    exercises.push({
      name: mutation.name,
      order,
      ...(mutation.mode ? { mode: mutation.mode } : {}),
      ...(mutation.unitOverride
        ? { unitOverride: mutation.unitOverride }
        : {}),
      sets: Array.from({ length: mutation.setCount }, (_, index) => ({
        order: index + 1,
      })),
    })
  }

  if (!applyMemberActionSetPuts(exercises, existingSetMutations)) {
    return { reason: 'workout_changed', status: 'rejected' }
  }

  for (const mutation of removeMutations) {
    const exercise = exercises[mutation.exercisePosition - 1]
    if (!exercise || exercise.name !== mutation.exerciseName) {
      return { reason: 'workout_changed', status: 'rejected' }
    }

    exercise.sets.sort((left, right) => left.order - right.order)
    const existing = exercise.sets[mutation.setPosition - 1]
    if (
      !existing
      || exercise.sets.length <= 1
    ) {
      return { reason: 'workout_changed', status: 'rejected' }
    }
    exercise.sets.splice(mutation.setPosition - 1, 1)
    exercise.sets.forEach((set, index) => {
      set.order = index + 1
    })
  }

  if (!applyMemberActionSetAppends(exercises, newSetMutations)) {
    return { reason: 'workout_changed', status: 'rejected' }
  }

  const parsed = workoutSessionSchema.safeParse({
    ...workout,
    exercises,
  })
  if (!parsed.success) {
    return { reason: 'workout_changed', status: 'rejected' }
  }
  const changed = JSON.stringify(parsed.data.exercises)
    !== JSON.stringify(workout.exercises)

  const persistExercises = removeMutations.length > 0
    ? updateLiveWorkoutExercisesAfterValidatedSetRemoval
    : updateLiveWorkoutExercises
  await persistExercises(shown, workout, parsed.data.exercises, input.actionId)
  return { status: changed ? 'applied' : 'unchanged' }
}

function applyMemberActionSetPuts(
  exercises: WorkoutExercise[],
  mutations: SetPutMutation[],
): boolean {
  for (const mutation of mutations) {
    const exercise = exercises[mutation.exercisePosition - 1]
    if (!exercise || exercise.name !== mutation.exerciseName) {
      return false
    }

    exercise.sets.sort((left, right) => left.order - right.order)
    const existing = exercise.sets[mutation.setPosition - 1]
    if (!existing) return false

    if (memberActionWorkoutSetMatches({
      expected: mutation.result,
      ownedKind: mutation.result?.kind ?? null,
      set: existing,
    })) {
      continue
    }
    if (!memberActionWorkoutSetMatches({
      expected: mutation.expectedResult,
      ownedKind: mutation.result.kind,
      set: existing,
    })) {
      return false
    }

    exercise.sets[mutation.setPosition - 1] = applyMemberActionWorkoutSetResult(
      existing,
      mutation.result,
    )
  }
  return true
}

function applyMemberActionSetAppends(
  exercises: WorkoutExercise[],
  mutations: SetAppendMutation[],
): boolean {
  for (const mutation of mutations) {
    const exercise = exercises[mutation.exercisePosition - 1]
    if (!exercise || exercise.name !== mutation.exerciseName) {
      return false
    }

    exercise.sets.sort((left, right) => left.order - right.order)
    if (mutation.setPosition !== exercise.sets.length + 1) {
      return false
    }
    exercise.sets.push(buildMemberActionWorkoutSet({
      order: mutation.setPosition,
      result: mutation.result,
    }))
  }
  return true
}

function memberActionExpectedSetsMatch(
  sets: WorkoutSet[],
  expected: WorkoutMemberActionExpectedSetStateV1[],
): boolean {
  const ordered = sets.slice().sort((left, right) => left.order - right.order)
  return ordered.length === expected.length
    && ordered.every((set, index) => {
      const expectedState = expected[index]
      return expectedState !== undefined
        && expectedState.logged === hasLoggedWorkoutSet(set)
        && memberActionWorkoutSetMatches({
          expected: expectedState.result,
          ownedKind: expectedState.result?.kind ?? null,
          set,
        })
    })
}

function memberActionExpectedWorkoutMatches(
  exercises: WorkoutExercise[],
  action: WorkoutLiveApplyMemberActionV1,
): boolean {
  const expected = action.expectedWorkout.exercises
  if (exercises.length !== expected.length) {
    return false
  }

  return expected.every((expectedExercise, exerciseIndex) => {
    const exercise = exercises[exerciseIndex]
    if (
      !exercise
      || exercise.name !== expectedExercise.name
      || exercise.sets.length !== expectedExercise.sets.length
    ) {
      return false
    }
    const sets = exercise.sets.slice().sort((left, right) => left.order - right.order)
    return expectedExercise.sets.every(
      (expectedSet, setIndex) =>
        expectedSet.logged === hasLoggedWorkoutSet(sets[setIndex]!),
    )
  })
}

function buildMemberActionWorkoutSet(input: {
  order: number
  result: MemberActionSetResult
  type?: WorkoutSet['type']
}): WorkoutSet {
  return {
    order: input.order,
    ...(input.type ? { type: input.type } : {}),
    ...(input.result?.kind === 'note' ? { note: input.result.note } : {}),
    ...(input.result?.kind === 'reps' ? { reps: input.result.reps } : {}),
    ...(input.result?.kind === 'weight_reps'
      ? {
          reps: input.result.reps,
          weight: input.result.weight,
          weightUnit: input.result.weightUnit,
        }
      : {}),
  }
}

type MemberActionSetResult = WorkoutMemberActionSetResultV1 | null
type MemberActionSetResultKind = NonNullable<MemberActionSetResult>['kind']
type SetPutMutation = Extract<
  WorkoutLiveApplyMemberActionV1['mutations'][number],
  { kind: 'set.put' }
>
type SetAppendMutation = Extract<
  WorkoutLiveApplyMemberActionV1['mutations'][number],
  { kind: 'set.append' }
>
type SetRemoveMutation = Extract<
  WorkoutLiveApplyMemberActionV1['mutations'][number],
  { kind: 'set.remove' }
>

function applyMemberActionWorkoutSetResult(
  set: WorkoutSet,
  result: NonNullable<MemberActionSetResult>,
): WorkoutSet {
  return {
    ...set,
    ...(result.kind === 'note' ? { note: result.note } : {}),
    ...(result.kind === 'reps' ? { reps: result.reps } : {}),
    ...(result.kind === 'weight_reps'
      ? {
          reps: result.reps,
          weight: result.weight,
          weightUnit: result.weightUnit,
        }
      : {}),
  }
}

function memberActionWorkoutSetMatches(input: {
  expected: WorkoutMemberActionExpectedSetResultV1 | null
  ownedKind: MemberActionSetResultKind | null
  set: WorkoutSet
}): boolean {
  if (input.ownedKind === null) {
    return JSON.stringify(buildMemberActionWorkoutSet({
      order: input.set.order,
      result: null,
      type: input.set.type,
    })) === JSON.stringify(input.set)
  }
  if (input.expected === null) {
    return !hasLoggedWorkoutSet(input.set)
  }
  if (input.expected.kind !== input.ownedKind) {
    return false
  }

  const actual = projectMemberActionWorkoutSetResult(
    input.set,
    input.ownedKind,
  )
  return JSON.stringify(actual) === JSON.stringify(input.expected)
}

function projectMemberActionWorkoutSetResult(
  set: WorkoutSet,
  kind: MemberActionSetResultKind,
): WorkoutMemberActionExpectedSetResultV1 {
  if (kind === 'note') {
    return { kind, note: set.note ?? null }
  }
  if (kind === 'reps') {
    return { kind, reps: set.reps ?? null }
  }
  return {
    kind,
    reps: set.reps ?? null,
    weight: set.weight ?? null,
    weightUnit: set.weightUnit ?? null,
  }
}

export async function startLiveWorkout(input: StartLiveWorkoutInput) {
  return withLiveWorkoutMutationLock(input.vault, () =>
    startLiveWorkoutWithLockHeld(input),
  )
}

async function startLiveWorkoutWithLockHeld(input: StartLiveWorkoutInput) {
  const routineLookup =
    input.routine === undefined
      ? undefined
      : requireNonEmptyText(
          input.routine,
          'Workout routine lookup is required.',
        )
  const active = await findActiveLiveWorkouts(input.vault)
  if (active.length > 0) {
    throw new VaultCliError(
      'command_failed',
      `Workout ${active[0]?.entity.id ?? ''} is already active. Finish or delete it before starting another live workout.`,
      { activeWorkoutIds: active.map((entry) => entry.entity.id) },
    )
  }

  const startedAt = normalizeWorkoutTimestamp(
    input.startedAt ?? new Date().toISOString(),
    'startedAt',
  )
  const name = normalizeOptionalText(input.name)
  const note = normalizeOptionalText(input.note)
  const activityTypeOverride = normalizeOptionalText(input.activityType)
  const durationMinutes = elapsedDurationMinutes(
    startedAt,
    new Date().toISOString(),
  )
  if (routineLookup !== undefined) {
    const routine = await showWorkoutFormat(input.vault, routineLookup)
    const routineTitle = requireString(
      routine.entity.title,
      'Workout routine title is missing.',
    )
    const workout = buildLiveWorkoutSessionFromTemplate({
      template: workoutTemplateSchema.parse(routine.entity.data.template),
      routineId: requireString(
        routine.entity.data.workoutFormatId,
        'Workout routine id is missing.',
      ),
      routineName: routineTitle,
      startedAt,
      sessionNote: note,
    })
    assertTargetableLiveWorkout(
      workout,
      `Workout routine "${routineTitle}"`,
    )

    return addStructuredWorkoutRecord({
      vault: input.vault,
      draft: {
        occurredAt: startedAt,
        source: 'manual',
        title: name ?? routineTitle,
        note: note ?? routineTitle,
        activityType: activityTypeOverride
          ? normalizeLiveWorkoutActivityType(activityTypeOverride)
          : optionalString(routine.entity.data.activityType) ??
            'strength-training',
        durationMinutes,
        workout,
      },
    })
  }

  const title = name ?? 'Workout'
  const workout = workoutSessionSchema.parse({
    sourceApp: LIVE_WORKOUT_SOURCE_APP,
    startedAt,
    ...(note ? { sessionNote: note } : {}),
    exercises: [],
  })
  return addStructuredWorkoutRecord({
    vault: input.vault,
    draft: {
      occurredAt: startedAt,
      source: 'manual',
      title,
      note: note ?? title,
      activityType: activityTypeOverride
        ? normalizeLiveWorkoutActivityType(activityTypeOverride)
        : 'strength-training',
      durationMinutes,
      workout,
    },
  })
}

export async function showActiveLiveWorkout(input: LiveWorkoutLookupInput) {
  return resolveLiveWorkout(input, { requireActive: true })
}

export async function addLiveWorkoutExercise(
  input: AddLiveWorkoutExerciseInput,
) {
  return withLiveWorkoutMutationLock(input.vault, () =>
    addLiveWorkoutExerciseWithLockHeld(input),
  )
}

async function addLiveWorkoutExerciseWithLockHeld(
  input: AddLiveWorkoutExerciseInput,
) {
  const shown = await resolveLiveWorkout(input, { requireActive: true })
  const workout = parseShownWorkout(shown)
  assertTargetableLiveWorkout(workout, `Workout ${shown.entity.id}`)
  const exercises = structuredClone(workout.exercises)
  const order = input.order
  const setCount = input.setCount ?? 1

  if (!Number.isInteger(order) || order < 1) {
    throw new VaultCliError('invalid_option', 'Exercise order must be a positive integer.')
  }
  if (!Number.isInteger(setCount) || setCount < 1 || setCount > 150) {
    throw new VaultCliError(
      'invalid_option',
      'Exercise set count must be between 1 and 150.',
    )
  }

  const name = requireNonEmptyText(input.name, 'Exercise name is required.')
  const sourceExerciseId = normalizeOptionalText(input.sourceExerciseId)
  const groupId = normalizeOptionalText(input.groupId)
  const note = normalizeOptionalText(input.note)
  const proposed: WorkoutExercise = {
    name,
    ...(sourceExerciseId ? { sourceExerciseId } : {}),
    order,
    ...(groupId ? { groupId } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.unitOverride ? { unitOverride: input.unitOverride } : {}),
    ...(note ? { note } : {}),
    sets: Array.from({ length: setCount }, (_, index) => ({ order: index + 1 })),
  }
  const parsedProposed = workoutSessionSchema.parse({
    exercises: [proposed],
  }).exercises[0]!
  const existing = exercises.find((exercise) => exercise.order === order)
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(parsedProposed)) {
      return shown
    }
    throw new VaultCliError(
      'invalid_option',
      `Exercise order ${order} is already used by ${existing.name}.`,
    )
  }
  if (exercises.length >= MAX_LIVE_WORKOUT_EXERCISES) {
    throw new VaultCliError(
      'invalid_operation',
      `Live workouts support at most ${MAX_LIVE_WORKOUT_EXERCISES} exercises.`,
    )
  }

  exercises.push(parsedProposed)
  exercises.sort((left, right) => left.order - right.order)
  return updateLiveWorkoutExercises(shown, workout, exercises)
}

export async function logLiveWorkoutSet(input: LogLiveWorkoutSetInput) {
  return withLiveWorkoutMutationLock(input.vault, () =>
    logLiveWorkoutSetWithLockHeld(input),
  )
}

async function logLiveWorkoutSetWithLockHeld(input: LogLiveWorkoutSetInput) {
  const setOrder = requireLiveWorkoutSetOrder(input.setOrder)
  const shown = await resolveLiveWorkout(input, { requireActive: true })
  const workout = parseShownWorkout(shown)
  assertTargetableLiveWorkout(workout, `Workout ${shown.entity.id}`)
  const exercises = structuredClone(workout.exercises)
  const exerciseIndex = resolveExerciseIndex(exercises, input)
  const exercise = exercises[exerciseIndex]!
  const patch = compactSetPatch(input)
  if (Object.keys(patch).length === 0) {
    throw new VaultCliError('invalid_option', 'Log at least one set value or note.')
  }

  const setIndex = exercise.sets.findIndex((set) => set.order === setOrder)
  const currentSet = setIndex >= 0 ? exercise.sets[setIndex] : undefined
  if (currentSet === undefined && input.requireExistingSet) {
    throw new VaultCliError(
      'not_found',
      `No set ${setOrder} exists for ${exercise.name}.`,
    )
  }
  if (
    currentSet === undefined &&
    exercise.sets.length >= MAX_LIVE_WORKOUT_SETS_PER_EXERCISE
  ) {
    throw new VaultCliError(
      'invalid_operation',
      `Each exercise supports at most ${MAX_LIVE_WORKOUT_SETS_PER_EXERCISE} sets.`,
    )
  }
  const parsedSet = workoutSessionSchema.parse({
    exercises: [
      {
        name: exercise.name,
        order: 1,
        sets: [{ ...(currentSet ?? {}), ...patch, order: setOrder }],
      },
    ],
  }).exercises[0]!.sets[0]!
  if (!hasLoggedWorkoutSet(parsedSet)) {
    throw new VaultCliError('invalid_option', 'Log at least one set value or note.')
  }
  if (currentSet && JSON.stringify(currentSet) === JSON.stringify(parsedSet)) {
    return shown
  }

  if (setIndex >= 0) {
    exercise.sets[setIndex] = parsedSet
  } else {
    exercise.sets.push(parsedSet)
    exercise.sets.sort((left, right) => left.order - right.order)
  }
  exercises[exerciseIndex] = exercise
  return updateLiveWorkoutExercises(shown, workout, exercises)
}

export async function clearLiveWorkoutSet(input: ClearLiveWorkoutSetInput) {
  return withLiveWorkoutMutationLock(input.vault, () =>
    clearLiveWorkoutSetWithLockHeld(input),
  )
}

async function clearLiveWorkoutSetWithLockHeld(
  input: ClearLiveWorkoutSetInput,
) {
  const setOrder = requireLiveWorkoutSetOrder(input.setOrder)
  const shown = await resolveLiveWorkout(input, { requireActive: true })
  const workout = parseShownWorkout(shown)
  assertTargetableLiveWorkout(workout, `Workout ${shown.entity.id}`)
  const exercises = structuredClone(workout.exercises)
  const exerciseIndex = resolveExerciseIndex(exercises, input)
  const exercise = exercises[exerciseIndex]!
  const setIndex = exercise.sets.findIndex((set) => set.order === setOrder)
  if (setIndex < 0) {
    throw new VaultCliError(
      'not_found',
      `No set ${setOrder} exists for ${exercise.name}.`,
    )
  }

  const currentSet = exercise.sets[setIndex]!
  const clearedSet: WorkoutSet = {
    order: currentSet.order,
    ...(currentSet.type ? { type: currentSet.type } : {}),
  }
  if (JSON.stringify(currentSet) === JSON.stringify(clearedSet)) {
    return shown
  }
  exercise.sets[setIndex] = clearedSet
  exercises[exerciseIndex] = exercise
  return updateLiveWorkoutExercises(shown, workout, exercises)
}

export async function finishLiveWorkout(input: FinishLiveWorkoutInput) {
  return withLiveWorkoutMutationLock(input.vault, () =>
    finishLiveWorkoutWithLockHeld(input),
  )
}

async function finishLiveWorkoutWithLockHeld(input: FinishLiveWorkoutInput) {
  const shown = await resolveLiveWorkout(input, {
    requireActive: input.workoutId === undefined,
    allowCompleted: input.workoutId !== undefined,
  })
  const workout = parseShownWorkout(shown)
  if (workout.endedAt) {
    return shown
  }
  if (!workout.startedAt) {
    throw new VaultCliError(
      'contract_invalid',
      'Live workout is missing its startedAt timestamp.',
    )
  }

  const endedAt = normalizeWorkoutTimestamp(
    input.endedAt ?? new Date().toISOString(),
    'endedAt',
  )
  if (Date.parse(endedAt) <= Date.parse(workout.startedAt)) {
    throw new VaultCliError(
      'invalid_timestamp',
      'Workout endedAt must be later than startedAt.',
    )
  }
  const durationMinutes = elapsedDurationMinutes(workout.startedAt, endedAt)

  return editWorkoutRecord({
    vault: input.vault,
    lookup: shown.entity.id,
    set: [
      `workout.endedAt=${JSON.stringify(endedAt)}`,
      `durationMinutes=${durationMinutes}`,
    ],
  })
}
