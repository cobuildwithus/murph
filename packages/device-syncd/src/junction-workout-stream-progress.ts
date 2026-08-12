import type { DeviceSyncError } from "./errors.ts";

export class JunctionWorkoutStreamProgressError extends Error {
  readonly failure: DeviceSyncError;
  readonly dailyWindowStart: string;
  readonly workoutStreamCursor: string | null;

  constructor(
    failure: DeviceSyncError,
    dailyWindowStart: string,
    workoutStreamCursor: string | null,
  ) {
    super(failure.message, { cause: failure });
    this.name = "JunctionWorkoutStreamProgressError";
    this.failure = failure;
    this.dailyWindowStart = dailyWindowStart;
    this.workoutStreamCursor = workoutStreamCursor;
  }
}
