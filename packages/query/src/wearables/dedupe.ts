import type {
  WearableMetricCandidate,
  WearableSleepWindowCandidate,
} from "./types.ts";
import { latestIsoTimestamp, normalizeLowercaseString, uniqueStrings } from "./shared.ts";
import { wearableDataOriginKey } from "./origin.ts";

export function dedupeExactMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
): {
  candidates: WearableMetricCandidate[];
  exactDuplicateCount: number;
} {
  const deduped = new Map<string, WearableMetricCandidate>();
  let exactDuplicateCount = 0;

  for (const candidate of candidates) {
    const key = buildCandidateExactKey(candidate);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, { ...candidate, paths: [...candidate.paths], recordIds: [...candidate.recordIds] });
      continue;
    }

    exactDuplicateCount += 1;
    existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
    existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
    existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
  }

  return {
    candidates: [...deduped.values()],
    exactDuplicateCount,
  };
}

export function dedupeSleepWindowCandidates(
  candidates: readonly WearableSleepWindowCandidate[],
): WearableSleepWindowCandidate[] {
  const deduped = new Map<string, WearableSleepWindowCandidate>();

  for (const candidate of candidates) {
    const originKey = wearableDataOriginKey(candidate.dataOrigin);
    const key = [
      candidate.provider,
      ...(originKey ? [originKey] : []),
      candidate.date,
      candidate.startAt ?? "",
      candidate.endAt ?? "",
      candidate.durationMinutes,
      candidate.nap ? "nap" : "sleep",
    ].join("|");
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, {
        ...candidate,
        paths: [...candidate.paths],
        recordIds: [...candidate.recordIds],
      });
      continue;
    }

    existing.exactDuplicateCount =
      (existing.exactDuplicateCount ?? 0)
      + (candidate.exactDuplicateCount ?? 0)
      + 1;
    existing.evidenceOmittedCount =
      (existing.evidenceOmittedCount ?? 0)
      + (candidate.evidenceOmittedCount ?? 0);
    existing.evidenceOmittedExactDuplicateCount =
      (existing.evidenceOmittedExactDuplicateCount ?? 0)
      + (candidate.evidenceOmittedExactDuplicateCount ?? 0);
    if (
      (existing.sleepType === undefined || existing.sleepType === "unknown")
      && candidate.sleepType !== undefined
      && candidate.sleepType !== "unknown"
    ) {
      existing.sleepType = candidate.sleepType;
      existing.nap = candidate.sleepType === "nap";
    }
    if (!existing.timeZone && candidate.timeZone) {
      existing.timeZone = candidate.timeZone;
    }
    existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
    existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
    existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
  }

  return [...deduped.values()];
}

export function buildCandidateExactKey(candidate: WearableMetricCandidate): string {
  const originKey = wearableDataOriginKey(candidate.dataOrigin);
  const normalizerVersion = normalizeLowercaseString(candidate.dataOrigin?.normalizerVersion) ?? "";

  return [
    candidate.provider,
    ...(originKey ? [originKey] : []),
    ...(normalizerVersion ? [`normalizer:${normalizerVersion}`] : []),
    candidate.date,
    candidate.metric,
    candidate.unit ?? "",
    candidate.value.toFixed(4),
    candidate.sourceFamily,
    candidate.sourceKind,
    candidate.externalRef?.resourceType ?? "",
    candidate.externalRef?.resourceId ?? "",
    candidate.externalRef?.facet ?? "",
    candidate.occurredAt ?? "",
  ].join("|");
}
