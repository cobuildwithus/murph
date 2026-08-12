import type { DeviceSyncError } from "./errors.ts";

export class JunctionWorkoutStreamProgressError extends Error {
  readonly failure: DeviceSyncError;
  readonly workoutStreamCursor: string;

  constructor(failure: DeviceSyncError, workoutStreamCursor: string) {
    super(failure.message, { cause: failure });
    this.name = "JunctionWorkoutStreamProgressError";
    this.failure = failure;
    this.workoutStreamCursor = workoutStreamCursor;
  }
}
