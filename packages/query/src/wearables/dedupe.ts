import type {
  WearableMetricCandidate,
  WearableSleepWindowCandidate,
} from "./types.ts";
import { latestIsoTimestamp, uniqueStrings } from "./shared.ts";

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
    const key = [
      candidate.provider,
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

    existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
    existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
    existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
  }

  return [...deduped.values()];
}

export function buildCandidateExactKey(candidate: WearableMetricCandidate): string {
  return [
    candidate.provider,
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
