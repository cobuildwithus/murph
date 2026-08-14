import type { DeviceSyncError } from "./errors.ts";

export type JunctionTimeseriesProgressPhase = "dense" | "wide";

export class JunctionTimeseriesProgressError extends Error {
  readonly failure: DeviceSyncError;
  readonly timeseriesPhase: JunctionTimeseriesProgressPhase;
  readonly timeseriesResourceCursor: string | null;
  readonly windowStart: string;
  readonly workoutStreamCursor: string | null;

  constructor(
    failure: DeviceSyncError,
    windowStart: string,
    workoutStreamCursor: string | null,
    options: {
      timeseriesPhase?: JunctionTimeseriesProgressPhase;
      timeseriesResourceCursor?: string | null;
    } = {},
  ) {
    super(failure.message, { cause: failure });
    this.name = "JunctionTimeseriesProgressError";
    this.failure = failure;
    this.timeseriesPhase = options.timeseriesPhase ?? "dense";
    this.timeseriesResourceCursor = options.timeseriesResourceCursor ?? null;
    this.windowStart = windowStart;
    this.workoutStreamCursor = workoutStreamCursor;
  }
}
