import {
  formatTimeZoneDateTimeParts,
  normalizeIanaTimeZone,
  normalizeStrictIsoTimestamp,
} from "@murphai/contracts";

export interface HostedRuntimeManagedGroupActivityWindow {
  occurrenceAt: string;
  timeZone: string;
  windowStartAt: string;
}

/**
 * Resolves the exact seven-local-calendar-day activity window shared by Web's
 * eligibility read and the runtime's composition-evidence read. The end is the
 * immutable scheduled occurrence; the start keeps the same local wall clock
 * seven calendar dates earlier, so DST may produce a 167/168/169-hour window.
 *
 * Keep this helper outside `runtime-control.ts`: Temporal workflows import that
 * entrypoint, whose production bundle intentionally excludes the contracts
 * package and other non-workflow dependencies.
 */
export function resolveHostedRuntimeManagedGroupActivityWindow(input: {
  occurrenceAt: string | Date;
  timeZone: string;
}): HostedRuntimeManagedGroupActivityWindow {
  const timeZone = normalizeIanaTimeZone(input.timeZone);
  if (!timeZone) {
    throw new RangeError("Managed group activity requires a valid IANA time zone.");
  }
  const occurrenceAt = normalizeStrictIsoTimestamp(input.occurrenceAt);
  if (!occurrenceAt) {
    throw new RangeError("Managed group activity requires a valid occurrence time.");
  }

  const occurrence = new Date(occurrenceAt);
  const occurrenceParts = formatTimeZoneDateTimeParts(occurrence, timeZone);
  const shiftedDate = new Date(Date.UTC(
    occurrenceParts.year,
    occurrenceParts.month - 1,
    occurrenceParts.day - 7,
  ));
  const localWallClockMs = Date.UTC(
    shiftedDate.getUTCFullYear(),
    shiftedDate.getUTCMonth(),
    shiftedDate.getUTCDate(),
    occurrenceParts.hour,
    occurrenceParts.minute,
    occurrenceParts.second,
    occurrence.getUTCMilliseconds(),
  );
  const candidates = new Set<number>();

  for (const deltaMs of [-2 * 86_400_000, 0, 2 * 86_400_000]) {
    const sampleAt = localWallClockMs + deltaMs;
    const sampleParts = formatTimeZoneDateTimeParts(sampleAt, timeZone);
    const sampleAsUtc = Date.UTC(
      sampleParts.year,
      sampleParts.month - 1,
      sampleParts.day,
      sampleParts.hour,
      sampleParts.minute,
      sampleParts.second,
      new Date(sampleAt).getUTCMilliseconds(),
    );
    candidates.add(localWallClockMs - (sampleAsUtc - sampleAt));
  }

  const matchingCandidates = [...candidates]
    .filter((candidate) => {
      const projected = formatTimeZoneDateTimeParts(candidate, timeZone);
      return (
        projected.year === shiftedDate.getUTCFullYear()
        && projected.month === shiftedDate.getUTCMonth() + 1
        && projected.day === shiftedDate.getUTCDate()
        && projected.hour === occurrenceParts.hour
        && projected.minute === occurrenceParts.minute
        && projected.second === occurrenceParts.second
        && new Date(candidate).getUTCMilliseconds()
          === occurrence.getUTCMilliseconds()
      );
    })
    .sort((left, right) => left - right);
  const windowStartAtMs = matchingCandidates[0];
  if (windowStartAtMs === undefined) {
    throw new RangeError(
      "Managed group activity window could not resolve the prior local wall clock.",
    );
  }

  return {
    occurrenceAt,
    timeZone,
    windowStartAt: new Date(windowStartAtMs).toISOString(),
  };
}
