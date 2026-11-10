import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
  type HostedRuntimeSystemMailboxFrontierClass,
} from "@murphai/hosted-execution/orchestration-control";
import type { HostedRuntimeRedactedJson } from "@murphai/hosted-execution/runtime-control";

export { HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON };

export const HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON = "device-sync.reconcile";
export const HOSTED_ASSISTANT_WAKE_REASON = "assistant";

export const HOSTED_AUTONOMOUS_SHORT_WAKE_LIMIT = 20;
export const HOSTED_AUTONOMOUS_WAKE_FLOOR_MS = 5 * 60_000;
const HOSTED_AUTONOMOUS_WAKE_WINDOW_MS = 60 * 60_000;
const AUTONOMOUS_WAKE_WINDOW_START_STATUS_KEY = "hostedAutonomousWakeWindowStartedAt";
const AUTONOMOUS_SHORT_WAKE_COUNT_STATUS_KEY = "hostedAutonomousShortWakeCount";

export interface HostedAutonomousWakeWindow {
  startedAtMs: number;
  shortWakeCount: number;
}

export function floorWindowForMemberAwaitedWork(
  window: HostedAutonomousWakeWindow,
  memberAwaitedWorkObserved: boolean,
): HostedAutonomousWakeWindow {
  return memberAwaitedWorkObserved
    ? { ...window, shortWakeCount: 0 }
    : window;
}

export function resolveHostedAutonomousWakeWindow(input: {
  nowMs: number;
  shortWakeCount: unknown;
  startedAt: unknown;
}): HostedAutonomousWakeWindow {
  const startedAtMs = typeof input.startedAt === "string"
    ? Date.parse(input.startedAt)
    : Number.NaN;
  const shortWakeCount = input.shortWakeCount;
  if (!Number.isFinite(startedAtMs)
    || startedAtMs > input.nowMs
    || input.nowMs - startedAtMs >= HOSTED_AUTONOMOUS_WAKE_WINDOW_MS
    || typeof shortWakeCount !== "number"
    || !Number.isSafeInteger(shortWakeCount)
    || shortWakeCount < 0) {
    return { startedAtMs: input.nowMs, shortWakeCount: 0 };
  }
  return { startedAtMs, shortWakeCount };
}

export function readHostedAutonomousWakeWindow(
  status: HostedRuntimeRedactedJson | null,
  nowMs: number,
): HostedAutonomousWakeWindow {
  return resolveHostedAutonomousWakeWindow({
    nowMs,
    shortWakeCount: status?.[AUTONOMOUS_SHORT_WAKE_COUNT_STATUS_KEY],
    startedAt: status?.[AUTONOMOUS_WAKE_WINDOW_START_STATUS_KEY],
  });
}

export function prepareHostedAutonomousWakePublication(input: {
  alreadyRecorded: boolean;
  checkpointWake: {
    nextWakeAt: string | null;
    nextWakeReason: string | null;
    autonomous?: true;
    autonomousWakeFloorApplied?: true;
  };
  defaultWake: {
    at: string | null;
    reason: string | null;
    autonomous: boolean;
    floorApplied: boolean;
  };
  nowMs: number;
  status: HostedRuntimeRedactedJson;
}): {
  counted: boolean;
  floorApplied: boolean;
  shortWakeCount: number;
  status: HostedRuntimeRedactedJson;
} {
  const window = readHostedAutonomousWakeWindow(input.status, input.nowMs);
  const wake = input.checkpointWake.autonomous
    ? input.checkpointWake.nextWakeAt
    : input.defaultWake.autonomous
      ? input.defaultWake.at
      : null;
  const wakeAtMs = Date.parse(wake ?? "");
  const counted = !input.alreadyRecorded
    && Number.isFinite(wakeAtMs)
    && wakeAtMs < input.nowMs + HOSTED_AUTONOMOUS_WAKE_FLOOR_MS;
  return {
    counted,
    floorApplied: input.checkpointWake.autonomousWakeFloorApplied === true
      || input.defaultWake.floorApplied,
    shortWakeCount: window.shortWakeCount,
    status: counted
      ? {
          ...input.status,
          [AUTONOMOUS_WAKE_WINDOW_START_STATUS_KEY]:
            new Date(window.startedAtMs).toISOString(),
          [AUTONOMOUS_SHORT_WAKE_COUNT_STATUS_KEY]:
            window.shortWakeCount + 1,
        }
      : input.status,
  };
}

export function floorHostedAutonomousWake(input: {
  at: string | null;
  nowMs: number;
  window: HostedAutonomousWakeWindow;
}): { at: string | null; applied: boolean; shortWakePublished: boolean } {
  const atMs = Date.parse(input.at ?? "");
  const shortWakePublished = Number.isFinite(atMs)
    && atMs < input.nowMs + HOSTED_AUTONOMOUS_WAKE_FLOOR_MS;
  if (!shortWakePublished
    || input.window.shortWakeCount < HOSTED_AUTONOMOUS_SHORT_WAKE_LIMIT) {
    return { at: input.at, applied: false, shortWakePublished };
  }
  return {
    at: new Date(input.nowMs + HOSTED_AUTONOMOUS_WAKE_FLOOR_MS).toISOString(),
    applied: true,
    shortWakePublished: false,
  };
}

export interface HostedRuntimeWakeCandidate {
  at: string | null;
  reason: string | null;
  autonomous?: true;
  autonomousWakeFloorApplied?: true;
}

export function floorHostedAutonomousWakeCandidate(input: {
  candidate: HostedRuntimeWakeCandidate | null | undefined;
  nowMs: number;
  window: HostedAutonomousWakeWindow;
}): HostedRuntimeWakeCandidate | null {
  if (!input.candidate) return null;
  if (!input.candidate.autonomous) return input.candidate;
  const floored = floorHostedAutonomousWake({
    at: input.candidate.at,
    nowMs: input.nowMs,
    window: input.window,
  });
  return floored.applied
    ? { ...input.candidate, at: floored.at, autonomousWakeFloorApplied: true }
    : input.candidate;
}

export interface HostedSystemMailboxWakeCandidate extends HostedRuntimeWakeCandidate {
  executionClass: HostedRuntimeSystemMailboxFrontierClass | null;
}

export function isHostedSystemMailboxWakeCandidate(
  candidate: HostedRuntimeWakeCandidate | null | undefined,
): candidate is HostedSystemMailboxWakeCandidate {
  if (!candidate || !("executionClass" in candidate)) {
    return false;
  }
  return candidate.executionClass === null
    || candidate.executionClass === "model_free"
    || candidate.executionClass === "default_owned";
}

export function hostedSystemMailboxWakeIsDueForModelFreeOwner(
  candidate: HostedRuntimeWakeCandidate | null | undefined,
  nowMs: number,
): candidate is HostedSystemMailboxWakeCandidate {
  return isHostedSystemMailboxWakeCandidate(candidate)
    && candidate.executionClass === "model_free"
    && hostedRuntimeWakeCandidateIsDue(candidate, nowMs);
}

export function createHostedRuntimeWakeCandidate(
  at: string | null | undefined,
  reason: string | null | undefined,
  autonomous = false,
): HostedRuntimeWakeCandidate {
  return {
    at: at ?? null,
    reason: at ? reason ?? HOSTED_ASSISTANT_WAKE_REASON : null,
    ...(autonomous && at ? { autonomous: true as const } : {}),
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
          ...(candidate.autonomous ? { autonomous: true } : {}),
          ...(candidate.autonomousWakeFloorApplied
            ? { autonomousWakeFloorApplied: true }
            : {}),
        };
      }
      return selected;
    },
    { at: null, reason: null },
  );
}

export function selectHostedRuntimeOwnerWakeCandidate(input: {
  backgroundCandidates: ReadonlyArray<HostedRuntimeWakeCandidate | null | undefined>;
  foregroundCandidates: ReadonlyArray<HostedRuntimeWakeCandidate | null | undefined>;
  nowMs: number;
  systemMailboxWake: HostedSystemMailboxWakeCandidate;
}): HostedRuntimeWakeCandidate {
  const foregroundWake = selectHostedRuntimeWakeCandidate(
    input.foregroundCandidates,
  );
  if (hostedRuntimeWakeCandidateIsDue(foregroundWake, input.nowMs)) {
    return foregroundWake;
  }
  if (hostedSystemMailboxWakeIsDueForModelFreeOwner(
    input.systemMailboxWake,
    input.nowMs,
  )) {
    return {
      at: input.systemMailboxWake.at,
      reason: input.systemMailboxWake.reason,
      ...(input.systemMailboxWake.autonomous
        ? { autonomous: true as const }
        : {}),
      ...(input.systemMailboxWake.autonomousWakeFloorApplied
        ? { autonomousWakeFloorApplied: true as const }
        : {}),
    };
  }
  return selectHostedRuntimeWakeCandidate([
    foregroundWake,
    input.systemMailboxWake,
    ...input.backgroundCandidates,
  ]);
}

export function hostedRuntimeWakeCandidateIsDue(
  candidate: HostedRuntimeWakeCandidate,
  nowMs: number,
): boolean {
  const wakeAtMs = Date.parse(candidate.at ?? "");
  return Number.isFinite(wakeAtMs) && wakeAtMs <= nowMs;
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
  if (reason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON) {
    return 2;
  }
  if (reason === HOSTED_ASSISTANT_WAKE_REASON || reason === null) {
    return 1;
  }
  return 0;
}

export function hostedRuntimeWakeReasonUsesAssistantPhase(
  reason: string | null,
): boolean {
  return reason === null
    || reason === HOSTED_ASSISTANT_WAKE_REASON
    || reason === HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON;
}
