import { createHash } from 'node:crypto'

export function deriveWorkoutActionBinding(workoutEntityId: string): string {
  return createHash('sha256')
    .update(`workout-action:v1:${workoutEntityId}`)
    .digest('hex')
}
