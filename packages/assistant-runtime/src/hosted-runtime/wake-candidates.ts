export const HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON = "device-sync.reconcile";
export const HOSTED_ASSISTANT_WAKE_REASON = "assistant";

export interface HostedRuntimeWakeCandidate {
  at: string | null;
  reason: string | null;
}

export interface HostedRuntimeWakeProjectionCandidate extends HostedRuntimeWakeCandidate {
  source: "carry" | "fresh";
}

export function createHostedRuntimeWakeCandidate(
  at: string | null | undefined,
  reason: string | null,
): HostedRuntimeWakeCandidate {
  return {
    at: at ?? null,
    reason: at ? reason ?? HOSTED_ASSISTANT_WAKE_REASON : null,
  };
}

export function selectHostedRuntimeWakeCandidate(
  candidates: ReadonlyArray<HostedRuntimeWakeCandidate | null | undefined>,
): HostedRuntimeWakeCandidate {
  return candidates.reduce<HostedRuntimeWakeCandidate>(
    (selected, candidate) => {
      if (!candidate?.at) {
        return selected;
      }
      if (!selected.at || hostedWakeCandidateWins(candidate, selected)) {
        return {
          at: candidate.at,
          reason: candidate.reason,
        };
      }
      return selected;
    },
    { at: null, reason: null },
  );
}

function hostedWakeCandidateWins(
  candidate: HostedRuntimeWakeCandidate,
  selected: HostedRuntimeWakeCandidate,
): boolean {
  if (!candidate.at) {
    return false;
  }
  if (!selected.at) {
    return true;
  }

  const candidateTime = Date.parse(candidate.at);
  const selectedTime = Date.parse(selected.at);
  const candidateValid = Number.isFinite(candidateTime);
  const selectedValid = Number.isFinite(selectedTime);

  if (candidateValid !== selectedValid) {
    return candidateValid;
  }
  if (candidateValid && selectedValid && candidateTime !== selectedTime) {
    return candidateTime < selectedTime;
  }

  return hostedWakeReasonPriority(candidate.reason) > hostedWakeReasonPriority(selected.reason);
}

function hostedWakeReasonPriority(reason: string | null): number {
  return reason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON ? 1 : 0;
}

// Projection provenance rules: an already-due candidate is one logical state
// (DUE) regardless of how old its timestamp is. A due candidate observed by
// the current pass supersedes a carried due token, so a stale carried value
// can never shadow freshly armed work. A carried due token with no fresh due
// replacement is preserved exactly (timestamp and reason) so checkpoint-gate
// identity stays stable across passes. Future candidates keep earliest-wins.
export function resolveHostedRuntimeWakeProjection(
  candidates: ReadonlyArray<HostedRuntimeWakeProjectionCandidate | null | undefined>,
  capturedNow: string,
): HostedRuntimeWakeCandidate {
  const valid = candidates.filter((candidate): candidate is HostedRuntimeWakeProjectionCandidate =>
    Boolean(candidate?.at),
  );
  const nowMs = Date.parse(capturedNow);
  const isDue = (candidate: HostedRuntimeWakeProjectionCandidate): boolean => {
    const atMs = Date.parse(candidate.at!);
    return Number.isFinite(nowMs) && Number.isFinite(atMs) && atMs <= nowMs;
  };
  const earliest = (
    entries: readonly HostedRuntimeWakeProjectionCandidate[],
  ): HostedRuntimeWakeProjectionCandidate | null =>
    entries.reduce<HostedRuntimeWakeProjectionCandidate | null>(
      (selected, candidate) => {
        if (selected === null) {
          return candidate;
        }
        const selectedMs = Date.parse(selected.at!);
        const candidateMs = Date.parse(candidate.at!);
        if (candidateMs < selectedMs) {
          return candidate;
        }
        if (candidateMs === selectedMs && candidate.source === "fresh") {
          return candidate;
        }
        return selected;
      },
      null,
    );

  const due = valid.filter(isDue);
  const freshDue = earliest(due.filter((candidate) => candidate.source === "fresh"));
  if (freshDue) {
    return { at: freshDue.at, reason: freshDue.reason };
  }
  const carriedDue = earliest(due);
  if (carriedDue) {
    return { at: carriedDue.at, reason: carriedDue.reason };
  }
  const future = earliest(valid);
  return future
    ? { at: future.at, reason: future.reason }
    : { at: null, reason: null };
}
