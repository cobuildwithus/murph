/** Maps assembled workout fields back to the public typed option that owns them. */
const workoutScalarOptionByField: Record<string, string> = {
  endedAt: 'workoutEndedAt',
  routineId: 'workoutRoutineId',
  routineName: 'workoutRoutineName',
  sessionNote: 'workoutSessionNote',
  sourceApp: 'workoutSourceApp',
  sourceWorkoutId: 'workoutSourceWorkoutId',
  startedAt: 'workoutStartedAt',
}

export function workoutOptionPublicPath(
  path: readonly PropertyKey[],
): readonly [string] | undefined {
  const [field, , nestedField] = path
  if (typeof field === 'string') {
    const scalarOption = workoutScalarOptionByField[field]
    if (scalarOption !== undefined) {
      return [scalarOption]
    }
  }
  if (field === 'media') {
    return ['workoutMedia']
  }
  if (field === 'exercises' && nestedField === 'sets') {
    return ['workoutSet']
  }
  if (field === 'exercises') {
    return ['workoutExercise']
  }
  return undefined
}
