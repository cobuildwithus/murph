/**
 * Push-primary sources reach us only when the upstream provider chooses to send.
 * Nothing we can pull proves the carrier is alive: the aggregator serves what it
 * was pushed, so a dead carrier and a genuinely quiet member both look like a
 * successful fetch of zero rows, and the aggregator's own connection record
 * stays `connected` with every resource `available`.
 *
 * Per-source data arrival is therefore the only available signal, and this
 * module owns the policy for reading it. Evaluation is pure and observational:
 * it never changes source status, gates ingestion, or implies recovery.
 *
 * It reports a stale source on every evaluation. Deliberately so: the callers
 * run on different cadences (an explicit device-sync wake and scheduled idle
 * maintenance), so nothing here can know how much time a single evaluation
 * represents, and a synthetic interval assumption would either double-report or
 * skip the first crossing entirely. Suppressing a still-stale source is
 * therefore the alerting layer's job, where the read cadence is known.
 *
 * See `docs/device-provider-compatibility-matrix.md` § Push-primary cells for
 * which providers belong here and why.
 */

import type { DeviceConnectionSourceStatus } from "./types.ts";

export interface PushPrimarySourcePolicy {
  /**
   * Hours of silence after the last delivery before the carrier is treated as
   * stalled. Sized well above the provider's normal quiet stretch (overnight,
   * a day without wearing the device) so ordinary gaps never trip it.
   */
  silentHours: number;
  /**
   * Hours after the source first appears before a source that has never
   * delivered anything is treated as stalled. The aggregator's connect-time
   * backfill can legitimately take minutes to hours, so this is deliberately
   * looser than an "arrived late" check but far tighter than the steady-state
   * threshold: a connect that never streams is a total outage for that member.
   */
  neverDeliveredHours: number;
}

const HOUR_MS = 60 * 60_000;

/**
 * Garmin is the only push-primary source today. It has no REST pull at all, so
 * its aggregator-side data exists purely because Garmin's push service chose to
 * send it, and that service silently stops for individual users.
 */
const PUSH_PRIMARY_SOURCE_POLICIES: ReadonlyMap<string, PushPrimarySourcePolicy> = new Map([
  ["garmin", { silentHours: 36, neverDeliveredHours: 6 }],
]);

export type PushPrimarySourceStalenessReason = "never_delivered" | "stopped_delivering";

/**
 * The narrow shape staleness needs. Kept structural so both the stored source
 * row and the account-level source summary satisfy it without a conversion.
 */
export interface PushPrimarySourceStalenessCandidate {
  sourceProviderSlug: string;
  status: DeviceConnectionSourceStatus;
  firstSeenAt: string;
  lastDataAt: string | null;
}

export interface PushPrimarySourceStaleness {
  sourceProviderSlug: string;
  reason: PushPrimarySourceStalenessReason;
  /** Last delivery, or null when the source has never delivered. */
  lastDataAt: string | null;
  /** Instant the silence began: the last delivery, else when the source appeared. */
  silentSinceAt: string;
  silentHours: number;
  thresholdHours: number;
}

export function readPushPrimarySourcePolicy(
  sourceProviderSlug: string,
): PushPrimarySourcePolicy | null {
  return PUSH_PRIMARY_SOURCE_POLICIES.get(sourceProviderSlug.trim().toLowerCase()) ?? null;
}

export function isPushPrimarySourceProvider(sourceProviderSlug: string): boolean {
  return readPushPrimarySourcePolicy(sourceProviderSlug) !== null;
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundHours(milliseconds: number): number {
  return Math.round((milliseconds / HOUR_MS) * 10) / 10;
}

/**
 * Returns one entry per connected push-primary source that has gone silent past
 * its policy. Sources that are already errored, unavailable, or disconnected are
 * skipped: their state is visible through the ordinary connection surfaces, and
 * reporting them again would only add noise.
 */
export function evaluatePushPrimarySourceStaleness(input: {
  now: string;
  sources: readonly PushPrimarySourceStalenessCandidate[];
}): PushPrimarySourceStaleness[] {
  const now = parseTimestamp(input.now);
  if (now === null) {
    return [];
  }

  const stale: PushPrimarySourceStaleness[] = [];

  for (const source of input.sources) {
    if (source.status !== "connected") {
      continue;
    }

    const policy = readPushPrimarySourcePolicy(source.sourceProviderSlug);
    if (!policy) {
      continue;
    }

    const reason: PushPrimarySourceStalenessReason = source.lastDataAt === null
      ? "never_delivered"
      : "stopped_delivering";
    const silentSinceAt = source.lastDataAt ?? source.firstSeenAt;
    const silentSince = parseTimestamp(silentSinceAt);
    if (silentSince === null) {
      continue;
    }

    const thresholdHours = reason === "never_delivered"
      ? policy.neverDeliveredHours
      : policy.silentHours;
    const silentMs = now - silentSince;
    if (silentMs < thresholdHours * HOUR_MS) {
      continue;
    }

    stale.push({
      sourceProviderSlug: source.sourceProviderSlug,
      reason,
      lastDataAt: source.lastDataAt,
      silentSinceAt,
      silentHours: roundHours(silentMs),
      thresholdHours,
    });
  }

  return stale;
}
