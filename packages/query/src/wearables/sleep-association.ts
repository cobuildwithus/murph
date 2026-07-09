import type { WearableMetricCandidate, WearableSleepWindowCandidate } from "./types.ts";
import { resolveWearablePublicSourceProvider } from "./origin.ts";
import { resolveMetricTolerance } from "./provider-policy.ts";

export function isAppleHealthKitSleepCandidate(
  candidate: Pick<WearableMetricCandidate | WearableSleepWindowCandidate, "dataOrigin" | "externalRef" | "provider">,
): boolean {
  return resolveSleepCandidateProvider(candidate) === "apple-health-kit";
}

export function sleepWindowsRepresentSameWindow(
  left: WearableSleepWindowCandidate,
  right: WearableSleepWindowCandidate,
): boolean {
  const toleranceMinutes = resolveMetricTolerance("sessionMinutes");
  return timestampsWithinMinutes(left.startAt, right.startAt, toleranceMinutes) &&
    timestampsWithinMinutes(left.endAt, right.endAt, toleranceMinutes) &&
    Math.abs(left.durationMinutes - right.durationMinutes) <= toleranceMinutes;
}

export function sleepMetricAssociatedWithWindow(
  candidate: WearableMetricCandidate,
  window: WearableSleepWindowCandidate,
): boolean {
  if (resolveSleepCandidateProvider(candidate) !== resolveSleepCandidateProvider(window)) {
    return false;
  }

  return sleepMetricMatchesWindow(candidate, window) || sleepMetricOccursInsideWindow(candidate, window);
}

export function sleepMetricMatchesWindow(
  candidate: WearableMetricCandidate,
  selectedWindow: WearableSleepWindowCandidate,
): boolean {
  const candidateRef = candidate.externalRef;
  const windowRef = selectedWindow.externalRef;
  const candidateResourceId = normalizeResourceToken(candidateRef?.resourceId);
  const windowResourceId = normalizeResourceToken(windowRef?.resourceId);

  if (!candidateResourceId || !windowResourceId || candidateResourceId !== windowResourceId) {
    return false;
  }

  if (candidate.provider !== selectedWindow.provider) {
    return false;
  }

  const candidateSystem = normalizeResourceToken(candidateRef?.system);
  const windowSystem = normalizeResourceToken(windowRef?.system);
  if (candidateSystem && windowSystem && candidateSystem !== windowSystem) {
    return false;
  }

  return sleepResourceTypesCompatible(candidateRef?.resourceType, windowRef?.resourceType);
}

export function sleepMetricMatchesNonSelectedWindow(
  candidate: WearableMetricCandidate,
  selectedWindow: WearableSleepWindowCandidate,
  sleepWindows: readonly WearableSleepWindowCandidate[],
): boolean {
  return sleepWindows.some((window) =>
    window.candidateId !== selectedWindow.candidateId && sleepMetricAssociatedWithWindow(candidate, window)
  );
}

export function normalizeResourceToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveSleepCandidateProvider(
  candidate: Pick<WearableMetricCandidate | WearableSleepWindowCandidate, "dataOrigin" | "externalRef" | "provider">,
): string {
  return resolveWearablePublicSourceProvider({
    dataOrigin: candidate.dataOrigin,
    externalRef: candidate.externalRef,
    provider: candidate.provider,
  }, {
    suppressJunctionSourceInstanceFallback: true,
  });
}

function sleepMetricOccursInsideWindow(
  candidate: WearableMetricCandidate,
  window: WearableSleepWindowCandidate,
): boolean {
  const occurredAtMs = Date.parse(candidate.occurredAt ?? "");
  const startAtMs = Date.parse(window.startAt ?? "");
  const endAtMs = Date.parse(window.endAt ?? "");
  if (!Number.isFinite(occurredAtMs) || !Number.isFinite(startAtMs) || !Number.isFinite(endAtMs)) {
    return false;
  }

  const toleranceMs = resolveMetricTolerance("sessionMinutes") * 60000;
  return occurredAtMs >= startAtMs - toleranceMs && occurredAtMs <= endAtMs + toleranceMs;
}

function sleepResourceTypesCompatible(
  candidateResourceType: string | null | undefined,
  windowResourceType: string | null | undefined,
): boolean {
  const candidateType = normalizeResourceToken(candidateResourceType);
  const windowType = normalizeResourceToken(windowResourceType);

  if (!candidateType || !windowType) {
    return true;
  }

  return candidateType === windowType || (candidateType.includes("sleep") && windowType.includes("sleep"));
}

function timestampsWithinMinutes(
  left: string | null | undefined,
  right: string | null | undefined,
  toleranceMinutes: number,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return left === right;
  }

  return Math.abs(leftMs - rightMs) / 60000 <= toleranceMinutes;
}
