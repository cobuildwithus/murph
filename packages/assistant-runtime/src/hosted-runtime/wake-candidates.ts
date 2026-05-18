export const HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON = "device-sync.reconcile";
export const HOSTED_ASSISTANT_WAKE_REASON = "assistant";

export interface HostedRuntimeWakeCandidate {
  at: string | null;
  reason: string | null;
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
