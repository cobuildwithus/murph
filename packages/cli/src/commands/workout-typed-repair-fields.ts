export const workoutTypedRepairFields = [
  'workoutSourceApp',
  'workoutSourceWorkoutId',
  'workoutStartedAt',
  'workoutEndedAt',
  'workoutRoutineId',
  'workoutRoutineName',
  'workoutSessionNote',
  'workoutMedia',
  'workoutExercise',
  'workoutSet',
] as const

export type WorkoutTypedRepairField = (typeof workoutTypedRepairFields)[number]

export function workoutTypedRepairFieldForIssuePath(
  path: readonly PropertyKey[],
): WorkoutTypedRepairField {
  switch (path[0]) {
    case 'sourceApp':
      return 'workoutSourceApp'
    case 'sourceWorkoutId':
      return 'workoutSourceWorkoutId'
    case 'startedAt':
      return 'workoutStartedAt'
    case 'endedAt':
      return 'workoutEndedAt'
    case 'routineId':
      return 'workoutRoutineId'
    case 'routineName':
      return 'workoutRoutineName'
    case 'sessionNote':
      return 'workoutSessionNote'
    case 'media':
      return 'workoutMedia'
    case 'exercises':
      return path.includes('sets') ? 'workoutSet' : 'workoutExercise'
    default:
      return 'workoutExercise'
  }
}
