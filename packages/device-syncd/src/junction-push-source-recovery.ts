/**
 * Automatic recovery for a push-primary source whose carrier has gone silent.
 *
 * Detection alone does not restore a member's data. There is no pull for a
 * push-primary source, and a data refresh cannot make the provider push again,
 * so the only lever that does not require the member to re-authorize is asking
 * the aggregator to re-run that provider's historical pull. This module owns
 * when that lever fires.
 *
 * The ladder is deliberately bounded and episode-scoped. `silentSinceAt`
 * identifies the stall episode, so a source that recovers and later stalls
 * again starts a fresh ladder without any reset step, and a still-silent source
 * cannot be retriggered faster than the ladder allows.
 */

import type { PushPrimarySourceStaleness } from "./source-staleness.ts";

export const JUNCTION_PUSH_SOURCE_RECOVERY_JOB_KIND = "push_source_recovery";

export const JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS = Object.freeze({
  attempts: "junctionPushSourceRecoveryAttempts",
  lastFailureCode: "junctionPushSourceRecoveryLastFailureCode",
  lastAttemptAt: "junctionPushSourceRecoveryLastAttemptAt",
  silentSinceAt: "junctionPushSourceRecoverySilentSinceAt",
  sourceProviderSlug: "junctionPushSourceRecoverySourceProviderSlug",
  status: "junctionPushSourceRecoveryStatus",
} as const);

export type JunctionPushSourceRecoveryStatus =
  /** A trigger was accepted; waiting to see whether data resumes. */
  | "triggered"
  /**
   * The aggregator does not expose the trigger to this team *yet*. This is not
   * terminal: the endpoint is enabled by vendor support, so an episode that was
   * gated today can become recoverable tomorrow without anything changing here.
   */
  | "unavailable"
  /** The bounded ladder ran out without data resuming. */
  | "exhausted";

/**
 * Hours after the stall is first detected at which each attempt fires. The
 * aggregator's historical pull is asynchronous and the provider may take a
 * while to answer it, so attempts are spaced far enough apart to let one
 * actually land before the next.
 */
const RECOVERY_ATTEMPT_DELAY_HOURS = Object.freeze([0, 6, 24, 48]);

/**
 * How long to wait before re-probing an episode whose trigger endpoint was
 * gated. Enablement is a vendor-side change we cannot observe, so the only way
 * a gated stall ever recovers is by asking again later. One probe per day per
 * source is a cheap 403 and keeps a not-yet-enabled deployment from silently
 * abandoning every stalled member it saw first.
 */
const RECOVERY_UNAVAILABLE_RECHECK_HOURS = 24;

const HOUR_MS = 60 * 60_000;

export interface JunctionPushSourceRecoveryState {
  attempts: number;
  lastAttemptAt: string | null;
  silentSinceAt: string | null;
  sourceProviderSlug: string | null;
  status: JunctionPushSourceRecoveryStatus | null;
}

export interface JunctionPushSourceRecoveryJobPayload {
  silentSinceAt: string;
  sourceProviderSlug: string;
}

function readMetadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMetadataCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readStatus(value: unknown): JunctionPushSourceRecoveryStatus | null {
  return value === "triggered" || value === "unavailable" || value === "exhausted"
    ? value
    : null;
}

export function readJunctionPushSourceRecoveryState(
  metadata: Record<string, unknown>,
): JunctionPushSourceRecoveryState {
  return {
    attempts: readMetadataCount(metadata[JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.attempts]),
    lastAttemptAt: readMetadataString(
      metadata[JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.lastAttemptAt],
    ),
    silentSinceAt: readMetadataString(
      metadata[JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.silentSinceAt],
    ),
    sourceProviderSlug: readMetadataString(
      metadata[JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.sourceProviderSlug],
    ),
    status: readStatus(metadata[JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.status]),
  };
}

export function buildJunctionPushSourceRecoveryMetadataPatch(input: {
  attempts: number;
  now: string;
  silentSinceAt: string;
  sourceProviderSlug: string;
  status: JunctionPushSourceRecoveryStatus;
}): Record<string, unknown> {
  return {
    [JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.attempts]: input.attempts,
    [JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.lastAttemptAt]: input.now,
    [JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.silentSinceAt]: input.silentSinceAt,
    [JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.sourceProviderSlug]: input.sourceProviderSlug,
    [JUNCTION_PUSH_SOURCE_RECOVERY_METADATA_KEYS.status]: input.status,
  };
}

/**
 * Chooses the single stalled source, if any, whose recovery attempt is due now.
 *
 * Returns null when nothing is due: no stalled push-primary source, the ladder
 * for this episode is finished, the trigger is not available to this team, or
 * the next attempt's delay has not elapsed. One source at a time keeps a
 * multi-source connection from firing a burst of provider work in one pass.
 */
export function selectDueJunctionPushSourceRecovery(input: {
  metadata: Record<string, unknown>;
  now: string;
  stale: readonly PushPrimarySourceStaleness[];
}): JunctionPushSourceRecoveryJobPayload | null {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) {
    return null;
  }

  // Deterministic order so a multi-source connection recovers predictably.
  const candidates = [...input.stale].sort((left, right) =>
    left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
  );
  const state = readJunctionPushSourceRecoveryState(input.metadata);

  for (const candidate of candidates) {
    const isRecordedEpisode = state.silentSinceAt === candidate.silentSinceAt
      && state.sourceProviderSlug === candidate.sourceProviderSlug;

    // A different episode (or a different source) starts its own ladder, which
    // is also how a source that recovered and stalled again gets retried.
    if (!isRecordedEpisode) {
      return {
        silentSinceAt: candidate.silentSinceAt,
        sourceProviderSlug: candidate.sourceProviderSlug,
      };
    }

    if (state.status === "exhausted") {
      continue;
    }

    // A gated endpoint is a "not enabled yet" answer, not a permanent one. If
    // this were treated as terminal, every connection already stalled when an
    // endpoint-less build deploys would be abandoned for that entire stall even
    // after support enables it.
    if (state.status === "unavailable") {
      const lastAttemptMs = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : Number.NaN;

      if (
        !Number.isFinite(lastAttemptMs)
        || nowMs >= lastAttemptMs + RECOVERY_UNAVAILABLE_RECHECK_HOURS * HOUR_MS
      ) {
        return {
          silentSinceAt: candidate.silentSinceAt,
          sourceProviderSlug: candidate.sourceProviderSlug,
        };
      }

      continue;
    }

    const nextDelayHours = RECOVERY_ATTEMPT_DELAY_HOURS[state.attempts];
    if (nextDelayHours === undefined) {
      continue;
    }

    const lastAttemptMs = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : Number.NaN;
    if (!Number.isFinite(lastAttemptMs)) {
      return {
        silentSinceAt: candidate.silentSinceAt,
        sourceProviderSlug: candidate.sourceProviderSlug,
      };
    }

    const previousDelayHours = RECOVERY_ATTEMPT_DELAY_HOURS[state.attempts - 1] ?? 0;
    const dueAtMs = lastAttemptMs + (nextDelayHours - previousDelayHours) * HOUR_MS;
    if (nowMs >= dueAtMs) {
      return {
        silentSinceAt: candidate.silentSinceAt,
        sourceProviderSlug: candidate.sourceProviderSlug,
      };
    }
  }

  return null;
}

/** Resolves the status to record after an attempt returns. */
export function resolveJunctionPushSourceRecoveryStatus(input: {
  attempts: number;
  endpointUnavailable: boolean;
}): JunctionPushSourceRecoveryStatus {
  if (input.endpointUnavailable) {
    return "unavailable";
  }

  return input.attempts >= RECOVERY_ATTEMPT_DELAY_HOURS.length ? "exhausted" : "triggered";
}

/**
 * A gated response never reached the provider's recovery mechanism, so it must
 * not consume one of the bounded attempts. Otherwise a deployment that predates
 * enablement would silently spend every episode's whole ladder on 403s.
 */
export function resolveJunctionPushSourceRecoveryAttempts(input: {
  endpointUnavailable: boolean;
  priorAttempts: number;
}): number {
  return input.endpointUnavailable ? input.priorAttempts : input.priorAttempts + 1;
}
