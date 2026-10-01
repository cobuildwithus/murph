import type { DeviceSyncError } from "./errors.ts";

export class JunctionTimeseriesProgressError extends Error {
  readonly failure: DeviceSyncError;
  readonly historicalProviderRecordsSeen: boolean;
  readonly historicalRecordsSeen: boolean;
  readonly workoutStreamEmptySeen: boolean;
  readonly windowStart: string;
  readonly workoutStreamCursor: string | null;

  constructor(
    failure: DeviceSyncError,
    windowStart: string,
    workoutStreamCursor: string | null,
    historicalEvidence: {
      historicalProviderRecordsSeen: boolean;
      historicalRecordsSeen: boolean;
      workoutStreamEmptySeen?: boolean;
    } = {
      historicalProviderRecordsSeen: false,
      historicalRecordsSeen: false,
    },
  ) {
    super(failure.message, { cause: failure });
    this.name = "JunctionTimeseriesProgressError";
    this.failure = failure;
    this.historicalProviderRecordsSeen =
      historicalEvidence.historicalProviderRecordsSeen;
    this.historicalRecordsSeen = historicalEvidence.historicalRecordsSeen;
    this.workoutStreamEmptySeen =
      historicalEvidence.workoutStreamEmptySeen === true;
    this.windowStart = windowStart;
    this.workoutStreamCursor = workoutStreamCursor;
  }
}
