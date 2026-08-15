import type { DeviceSyncError } from "./errors.ts";

export class JunctionTimeseriesProgressError extends Error {
  readonly failure: DeviceSyncError;
  readonly windowStart: string;
  readonly workoutStreamCursor: string | null;

  constructor(
    failure: DeviceSyncError,
    windowStart: string,
    workoutStreamCursor: string | null,
  ) {
    super(failure.message, { cause: failure });
    this.name = "JunctionTimeseriesProgressError";
    this.failure = failure;
    this.windowStart = windowStart;
    this.workoutStreamCursor = workoutStreamCursor;
  }
}
