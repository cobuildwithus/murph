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
import {
  addStructuredWorkoutRecord,
  editWorkoutRecord,
} from './workout.js'
import {
  LIVE_WORKOUT_SOURCE_APP,
  type ApplyLiveWorkoutMemberActionInput,
  type ApplyLiveWorkoutMemberActionResult,
  type AddLiveWorkoutExerciseInput,
  type ClearLiveWorkoutSetInput,
  type FinishLiveWorkoutInput,
  type LogLiveWorkoutSetInput,
  type StartLiveWorkoutExerciseInput,
  type SetLiveWorkoutExerciseRepsInput,
  type StartLiveWorkoutInput,
  buildLiveWorkoutCardEditor,
  buildLiveWorkoutSessionFromTemplate,
  elapsedDurationMinutes,
  hasCompletedFiniteLiveWorkoutPlan,
  hasLoggedWorkoutSet,
  isOpenLiveWorkout,
} from './workout-live-model.js'
import {
  assertTargetableLiveWorkout,
  compactSetPatch,
  findLiveWorkoutActionTargets,
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
  withLiveWorkoutMutationLock,
  type WorkoutShowResult,
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
  }, { requireOpen: true })
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

  const targets = await findLiveWorkoutActionTargets(
    input.vault,
    input.actionId,
    input.action.expectedWorkout.actionBinding,
  )
  if (targets.exactReplays.length > 0) {
    return targets.exactReplays.length === 1
      ? { status: 'unchanged' }
      : { reason: 'workout_changed', status: 'rejected' }
  }
  if (targets.bindingMatches.length !== 1) {
    return { reason: 'workout_changed', status: 'rejected' }
  }

  const workoutId = targets.bindingMatches[0]!.entity.id
  return withLiveWorkoutMutationLock(input.vault, workoutId, () =>
    applyLiveWorkoutMemberActionWithLockHeld(input, workoutId),
  )
}

async function applyLiveWorkoutMemberActionWithLockHeld(
  input: ApplyLiveWorkoutMemberActionInput,
  workoutId: string,
): Promise<ApplyLiveWorkoutMemberActionResult> {
  let shown: WorkoutShowResult
  let workout: WorkoutSession
  let acceptedAt: string
  try {
    shown = await resolveLiveWorkout({
      vault: input.vault,
      workoutId,
    })
    workout = parseShownWorkout(shown)
    if (workout.lastMemberActionId === input.actionId) {
      return { status: 'unchanged' }
    }
    if (!isOpenLiveWorkout(workout)) {
      return { reason: 'workout_changed', status: 'rejected' }
    }
    assertTargetableLiveWorkout(workout, `Workout ${shown.entity.id}`)
    acceptedAt = normalizeWorkoutTimestamp(input.acceptedAt, 'acceptedAt')
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
  if (
    typeof workout.startedAt !== 'string'
    || Date.parse(workout.startedAt) > Date.parse(acceptedAt)
  ) {
    return { reason: 'workout_changed', status: 'rejected' }
  }

  const beforeExercises = structuredClone(workout.exercises)
    .sort((left, right) => left.order - right.order)
  const exercises = structuredClone(beforeExercises)
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
      setPlanIsFinite: true,
      sets: Array.from({ length: mutation.setCount }, (_, index) => ({
        order: index + 1,
      })),
    })
  }

  const completedPendingSet = memberActionCompletesPendingSet(
    exercises,
    input.action,
  )
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
    if (!existing || exercise.sets.length <= 1) {
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
  const endedAt = resolveObservedWorkoutEndBoundary({
    afterExercises: parsed.data.exercises,
    appendedExtraSet: newSetMutations.some((mutation) => mutation.result !== null),
    beforeExercises,
    completedPendingSet,
    observedAt: acceptedAt,
    workout,
  })
  const changed = JSON.stringify(parsed.data.exercises)
      !== JSON.stringify(workout.exercises)
    || endedAt !== undefined

  await updateLiveWorkoutExercises(shown, workout, parsed.data.exercises, {
    ...(endedAt === undefined ? {} : { endedAt }),
    lastMemberActionId: input.actionId,
    observedAt: acceptedAt,
  })
  return { status: changed ? 'applied' : 'unchanged' }
}

function memberActionCompletesPendingSet(
  exercises: WorkoutExercise[],
  action: WorkoutLiveApplyMemberActionV1,
): boolean {
  return action.mutations.some((mutation) => {
    if (mutation.kind === 'set.append') {
      return mutation.result !== null
    }
    if (mutation.kind !== 'set.put') {
      return false
    }
    const exercise = exercises[mutation.exercisePosition - 1]
    const set = exercise?.sets
      .slice()
      .sort((left, right) => left.order - right.order)[mutation.setPosition - 1]
    return set !== undefined && !hasLoggedWorkoutSet(set)
  })
}

function resolveObservedWorkoutEndBoundary(input: {
  afterExercises: WorkoutExercise[]
  appendedExtraSet: boolean
  beforeExercises: WorkoutExercise[]
  completedPendingSet: boolean
  observedAt: string
  workout: WorkoutSession
}): string | undefined {
  if (input.workout.endedAt !== undefined) {
    return input.appendedExtraSet ? input.observedAt : undefined
  }
  if (!input.completedPendingSet) {
    return undefined
  }

  const beforeComplete = hasCompletedFiniteLiveWorkoutPlan({
    ...input.workout,
    exercises: input.beforeExercises,
  })
  const afterComplete = hasCompletedFiniteLiveWorkoutPlan({
    ...input.workout,
    exercises: input.afterExercises,
  })
  return !beforeComplete && afterComplete ? input.observedAt : undefined
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

function buildInitialLiveWorkoutExercises(
  exercises: readonly StartLiveWorkoutExerciseInput[],
): WorkoutExercise[] {
  if (exercises.length > MAX_LIVE_WORKOUT_EXERCISES) {
    throw new VaultCliError(
      'invalid_option',
      `Live workouts support at most ${MAX_LIVE_WORKOUT_EXERCISES} exercises.`,
    )
  }

  return exercises.map((exercise, index) => {
    const setCount = exercise.setCount ?? 1
    if (
      !Number.isInteger(setCount)
      || setCount < 1
      || setCount > MAX_LIVE_WORKOUT_SETS_PER_EXERCISE
    ) {
      throw new VaultCliError(
        'invalid_option',
        `Exercise set count must be between 1 and ${MAX_LIVE_WORKOUT_SETS_PER_EXERCISE}.`,
      )
    }
    if (
      exercise.reps !== undefined
      && (
        !Number.isInteger(exercise.reps)
        || exercise.reps < 1
        || exercise.reps > 999
      )
    ) {
      throw new VaultCliError(
        'invalid_option',
        'Exercise repetitions per set must be an integer between 1 and 999.',
      )
    }

    const sourceExerciseId = normalizeOptionalText(exercise.sourceExerciseId)
    const groupId = normalizeOptionalText(exercise.groupId)
    const note = normalizeOptionalText(exercise.note)
    return {
      name: requireNonEmptyText(exercise.name, 'Exercise name is required.'),
      order: index + 1,
      ...(sourceExerciseId ? { sourceExerciseId } : {}),
      ...(groupId ? { groupId } : {}),
      ...(exercise.mode ? { mode: exercise.mode } : {}),
      ...(exercise.unitOverride ? { unitOverride: exercise.unitOverride } : {}),
      ...(note ? { note } : {}),
      ...(exercise.reps === undefined
        ? {}
        : { memberRepsPerSet: exercise.reps }),
      setPlanIsFinite: exercise.setCount !== undefined,
      sets: Array.from({ length: setCount }, (_, setIndex) => ({
        order: setIndex + 1,
      })),
    }
  })
}

export async function startLiveWorkout(input: StartLiveWorkoutInput) {
  const routineLookup =
    input.routine === undefined
      ? undefined
      : requireNonEmptyText(
          input.routine,
          'Workout routine lookup is required.',
        )
  const observedAt = new Date().toISOString()
  const startedAt = normalizeWorkoutTimestamp(
    input.startedAt ?? observedAt,
    'startedAt',
  )
  const name = normalizeOptionalText(input.name)
  const note = normalizeOptionalText(input.note)
  const activityTypeOverride = normalizeOptionalText(input.activityType)
  const initialExercises = input.exercises ?? []
  const durationMinutes = elapsedDurationMinutes(startedAt, observedAt)
  if (routineLookup !== undefined && initialExercises.length > 0) {
    throw new VaultCliError(
      'invalid_option',
      '--exercise cannot be combined with --routine.',
    )
  }
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
    exercises: buildInitialLiveWorkoutExercises(initialExercises),
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

export async function addLiveWorkoutExercise(
  input: AddLiveWorkoutExerciseInput,
) {
  const observedAt = new Date().toISOString()
  return withLiveWorkoutMutationLock(input.vault, input.workoutId, () =>
    addLiveWorkoutExerciseWithLockHeld(input, observedAt),
  )
}

async function addLiveWorkoutExerciseWithLockHeld(
  input: AddLiveWorkoutExerciseInput,
  observedAt: string,
) {
  const shown = await resolveLiveWorkout(input, { requireOpen: true })
  const workout = parseShownWorkout(shown)
  assertTargetableLiveWorkout(workout, `Workout ${shown.entity.id}`)
  const exercises = structuredClone(workout.exercises)
  const order = input.order
  const setCount = input.setCount ?? 1

  if (!Number.isInteger(order) || order < 1) {
    throw new VaultCliError('invalid_option', 'Exercise order must be a positive integer.')
  }
  if (!Number.isInteger(setCount) || setCount < 1 || setCount > MAX_LIVE_WORKOUT_SETS_PER_EXERCISE) {
    throw new VaultCliError(
      'invalid_option',
      `Exercise set count must be between 1 and ${MAX_LIVE_WORKOUT_SETS_PER_EXERCISE}.`,
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
    setPlanIsFinite: input.setCount !== undefined,
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
  return updateLiveWorkoutExercises(shown, workout, exercises, { observedAt })
}

export async function setLiveWorkoutExerciseReps(
  input: SetLiveWorkoutExerciseRepsInput,
) {
  const observedAt = new Date().toISOString()
  return withLiveWorkoutMutationLock(input.vault, input.workoutId, () =>
    setLiveWorkoutExerciseRepsWithLockHeld(input, observedAt),
  )
}

async function setLiveWorkoutExerciseRepsWithLockHeld(
  input: SetLiveWorkoutExerciseRepsInput,
  observedAt: string,
) {
  const clear = input.clear === true
  const reps = input.reps
  const hasReps = reps !== undefined
  if (clear === hasReps) {
    throw new VaultCliError(
      'invalid_option',
      'Pass exactly one of --reps or --clear.',
    )
  }
  if (
    reps !== undefined
    && (!Number.isInteger(reps) || reps < 1 || reps > 999)
  ) {
    throw new VaultCliError(
      'invalid_option',
      'Exercise repetitions per set must be an integer between 1 and 999.',
    )
  }

  const shown = await resolveLiveWorkout(input)
  const workout = parseShownWorkout(shown)
  assertTargetableLiveWorkout(workout, `Workout ${shown.entity.id}`)
  const exercises = structuredClone(workout.exercises)
  const exerciseIndex = resolveExerciseIndex(exercises, input)
  const exercise = exercises[exerciseIndex]!
  if (
    (clear && exercise.memberRepsPerSet === undefined)
    || (!clear && exercise.memberRepsPerSet === reps)
  ) {
    return shown
  }

  if (clear) {
    return editWorkoutRecord({
      vault: shown.vault,
      lookup: shown.entity.id,
      clear: [`workout.exercises.${exerciseIndex}.memberRepsPerSet`],
    })
  }
  if (reps !== undefined) {
    exercise.memberRepsPerSet = reps
  }
  exercises[exerciseIndex] = exercise
  return updateLiveWorkoutExercises(shown, workout, exercises, { observedAt })
}

export async function logLiveWorkoutSet(input: LogLiveWorkoutSetInput) {
  const observedAt = new Date().toISOString()
  return withLiveWorkoutMutationLock(input.vault, input.workoutId, () =>
    logLiveWorkoutSetWithLockHeld(input, observedAt),
  )
}

async function logLiveWorkoutSetWithLockHeld(
  input: LogLiveWorkoutSetInput,
  observedAt: string,
) {
  const setOrder = requireLiveWorkoutSetOrder(input.setOrder)
  const shown = await resolveLiveWorkout(input)
  const workout = parseShownWorkout(shown)
  assertTargetableLiveWorkout(workout, `Workout ${shown.entity.id}`)
  const beforeExercises = structuredClone(workout.exercises)
  const exercises = structuredClone(beforeExercises)
  const exerciseIndex = resolveExerciseIndex(exercises, input)
  const exercise = exercises[exerciseIndex]!
  const setIndex = exercise.sets.findIndex((set) => set.order === setOrder)
  const currentSet = setIndex >= 0 ? exercise.sets[setIndex] : undefined
  const patch = compactSetPatch(input)
  if (
    input.reps === undefined
    && exercise.memberRepsPerSet !== undefined
    && (currentSet === undefined || !hasLoggedWorkoutSet(currentSet))
  ) {
    patch.reps = exercise.memberRepsPerSet
  }
  if (Object.keys(patch).length === 0) {
    if (
      currentSet !== undefined
      && hasLoggedWorkoutSet(currentSet)
      && exercise.memberRepsPerSet !== undefined
    ) {
      return shown
    }
    throw new VaultCliError(
      'invalid_option',
      'Log at least one set value or establish --reps for every set of this exercise first.',
    )
  }

  if (currentSet === undefined && input.requireExistingSet) {
    throw new VaultCliError(
      'not_found',
      `No set ${setOrder} exists for ${exercise.name}.`,
    )
  }
  if (
    currentSet === undefined
    && exercise.sets.length >= MAX_LIVE_WORKOUT_SETS_PER_EXERCISE
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

  const appendedExtraSet = currentSet === undefined
    && setOrder > exercise.sets.reduce(
      (maximum, set) => Math.max(maximum, set.order),
      0,
    )
  const completedPendingSet = currentSet === undefined
    || !hasLoggedWorkoutSet(currentSet)
  if (setIndex >= 0) {
    exercise.sets[setIndex] = parsedSet
  } else {
    exercise.sets.push(parsedSet)
    exercise.sets.sort((left, right) => left.order - right.order)
  }
  exercises[exerciseIndex] = exercise
  const endedAt = resolveObservedWorkoutEndBoundary({
    afterExercises: exercises,
    appendedExtraSet,
    beforeExercises,
    completedPendingSet,
    observedAt,
    workout,
  })
  return updateLiveWorkoutExercises(shown, workout, exercises, {
    ...(endedAt === undefined ? {} : { endedAt }),
    observedAt,
  })
}

export async function clearLiveWorkoutSet(input: ClearLiveWorkoutSetInput) {
  const observedAt = new Date().toISOString()
  return withLiveWorkoutMutationLock(input.vault, input.workoutId, () =>
    clearLiveWorkoutSetWithLockHeld(input, observedAt),
  )
}

async function clearLiveWorkoutSetWithLockHeld(
  input: ClearLiveWorkoutSetInput,
  observedAt: string,
) {
  const setOrder = requireLiveWorkoutSetOrder(input.setOrder)
  const shown = await resolveLiveWorkout(input)
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
  return updateLiveWorkoutExercises(shown, workout, exercises, { observedAt })
}

export async function finishLiveWorkout(input: FinishLiveWorkoutInput) {
  return withLiveWorkoutMutationLock(input.vault, input.workoutId, () =>
    finishLiveWorkoutWithLockHeld(input),
  )
}

async function finishLiveWorkoutWithLockHeld(input: FinishLiveWorkoutInput) {
  const shown = await resolveLiveWorkout(input)
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
