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
  return resolveSleepCandidateProvider(candidate) === resolveSleepCandidateProvider(window)
    && sleepMetricBelongsToWindow(candidate, window);
}

/** The association itself, for a caller that already holds a candidate and a
 * window of one public provider and must not resolve both again per pair. A
 * caller that tests many candidates against many windows also passes the
 * window's time test and the candidate's parsed time, so no timestamp is
 * parsed per pair. */
export function sleepMetricBelongsToWindow(
  candidate: WearableMetricCandidate,
  window: WearableSleepWindowCandidate,
  insideWindow?: (occurredAtMs: number) => boolean,
  occurredAtMs?: number,
): boolean {
  return sleepMetricMatchesWindow(candidate, window)
    || (insideWindow ?? sleepWindowTimeTest(window))(occurredAtMs ?? Date.parse(candidate.occurredAt ?? ""));
}

/** The time half of the association: whether a metric that occurred at the
 * given epoch milliseconds falls inside the window, within the session
 * tolerance. An unparseable time on either side never matches. */
export function sleepWindowTimeTest(
  window: WearableSleepWindowCandidate,
): (occurredAtMs: number) => boolean {
  const toleranceMs = resolveMetricTolerance("sessionMinutes") * 60000;
  const earliestMs = Date.parse(window.startAt ?? "") - toleranceMs;
  const latestMs = Date.parse(window.endAt ?? "") + toleranceMs;
  return (occurredAtMs) => occurredAtMs >= earliestMs && occurredAtMs <= latestMs;
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
