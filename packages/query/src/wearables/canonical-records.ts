import type { CanonicalWearableRecord } from "@murphai/importers/device-providers/canonical-wearable-records";
import { extractIsoDatePrefix } from "@murphai/contracts";

import { buildActivitySessionAggregates, matchesDateFilters } from "./candidates.ts";
import { dedupeExactMetricCandidates, dedupeSleepWindowCandidates } from "./dedupe.ts";
import { wearableDataOriginKey } from "./origin.ts";
import { compareMetricCandidateByDateDesc, compareSleepWindowByDateDesc } from "./selection.ts";
import { buildCandidateId, latestIsoTimestamp, normalizeNullableString, uniqueStrings } from "./shared.ts";
import type {
  WearableDataset,
  WearableExternalRef,
  WearableFilters,
  WearableMetricCandidate,
  WearableSleepWindowCandidate,
} from "./types.ts";

export function collectCanonicalWearableDataset(
  records: readonly CanonicalWearableRecord[],
  filters: WearableFilters = {},
): WearableDataset {
  const providerSet = filters.providers
    ? new Set(filters.providers.map((provider) => provider.trim().toLowerCase()).filter(Boolean))
    : null;
  const rawMetricCandidates: WearableMetricCandidate[] = [];
  const activitySessions: WearableMetricCandidate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];
  const tombstones = collectCanonicalTombstoneKeys(records);

  for (const record of records) {
    const provider = record.source.provider.toLowerCase();
    if (providerSet && !providerSet.has(provider)) {
      continue;
    }

    if (record.kind === "tombstone") {
      continue;
    }

    const resourceKey = tombstoneKey(
      provider,
      record.source.providerResourceType,
      record.source.providerResourceId,
    );
    if (tombstones.has(resourceKey)) {
      continue;
    }

    const date = record.dayKey ?? extractIsoDatePrefix(record.occurredAt ?? record.recordedAt ?? record.observedAt);
    if (!date || !matchesDateFilters(date, filters)) {
      continue;
    }

    if (record.kind === "observation" || record.kind === "sample") {
      rawMetricCandidates.push(buildCanonicalMetricCandidate(record, provider, date));
      continue;
    }

    if (record.kind === "session" && record.sessionKind === "sleep_session") {
      const candidate = buildCanonicalSleepWindowCandidate(record, provider, date);
      if (candidate) {
        sleepWindows.push(candidate);
      }
      continue;
    }

    if (record.kind === "session" && record.sessionKind === "activity_session") {
      const candidate = buildCanonicalActivitySessionCandidate(record, provider, date);
      if (candidate) {
        activitySessions.push(candidate);
      }
    }
  }

  const metricCandidates = dedupeExactMetricCandidates(rawMetricCandidates).candidates.sort(compareMetricCandidateByDateDesc);

  return {
    activitySessionAggregates: buildActivitySessionAggregates(activitySessions),
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates,
    sleepWindows: dedupeSleepWindowCandidates(sleepWindows).sort(compareSleepWindowByDateDesc),
  };
}

function buildCanonicalMetricCandidate(
  record: Extract<CanonicalWearableRecord, { kind: "observation" | "sample" }>,
  provider: string,
  date: string,
): WearableMetricCandidate {
  return {
    candidateId: buildCandidateId([
      provider,
      wearableDataOriginKey(record.source.origin),
      date,
      "canonical",
      record.kind,
      record.metric,
      record.source.providerResourceType ?? "",
      record.source.providerResourceId ?? record.id,
      record.source.externalRef?.facet ?? "",
      record.occurredAt ?? record.recordedAt ?? record.observedAt,
    ]),
    dataOrigin: record.source.origin ?? null,
    date,
    externalRef: normalizeExternalRef(record.source.externalRef),
    metric: record.metric,
    occurredAt: record.occurredAt ?? null,
    paths: buildCanonicalPaths(record),
    provider,
    recordedAt: record.recordedAt ?? record.occurredAt ?? record.observedAt,
    recordIds: [record.id],
    sourceFamily: "canonical",
    sourceKind: record.kind,
    title: record.kind === "observation" ? (record.title ?? null) : null,
    unit: record.unit,
    value: record.value,
  };
}

function buildCanonicalActivitySessionCandidate(
  record: Extract<CanonicalWearableRecord, { kind: "session" }>,
  provider: string,
  date: string,
): WearableMetricCandidate | null {
  const durationMinutes = record.durationMinutes;
  if (typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes)) {
    return null;
  }

  return {
    candidateId: buildCandidateId([
      provider,
      wearableDataOriginKey(record.source.origin),
      date,
      "canonical",
      "activity-session",
      record.id,
    ]),
    dataOrigin: record.source.origin ?? null,
    date,
    externalRef: normalizeExternalRef(record.source.externalRef),
    metric: "sessionMinutes",
    occurredAt: record.occurredAt ?? record.startAt ?? null,
    paths: buildCanonicalPaths(record),
    provider,
    recordedAt: record.recordedAt ?? record.occurredAt ?? record.observedAt,
    recordIds: [record.id],
    sourceFamily: "canonical",
    sourceKind: record.sessionKind,
    title: record.title ?? null,
    unit: "minutes",
    value: durationMinutes,
  };
}

function buildCanonicalSleepWindowCandidate(
  record: Extract<CanonicalWearableRecord, { kind: "session" }>,
  provider: string,
  date: string,
): WearableSleepWindowCandidate | null {
  const durationMinutes = record.durationMinutes;
  if (typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes)) {
    return null;
  }

  return {
    candidateId: buildCandidateId([
      provider,
      wearableDataOriginKey(record.source.origin),
      date,
      "canonical",
      "sleep-window",
      record.id,
    ]),
    dataOrigin: record.source.origin ?? null,
    date,
    durationMinutes,
    endAt: normalizeNullableString(record.endAt),
    nap: (record.title ?? "").toLowerCase().includes("nap"),
    occurredAt: record.occurredAt ?? null,
    paths: buildCanonicalPaths(record),
    provider,
    recordedAt: record.recordedAt ?? record.occurredAt ?? record.observedAt,
    recordIds: [record.id],
    sourceFamily: "canonical",
    sourceKind: record.sessionKind,
    startAt: normalizeNullableString(record.startAt),
    title: record.title ?? null,
  };
}

function buildCanonicalPaths(record: CanonicalWearableRecord): string[] {
  return uniqueStrings([
    `wearables/canonical/${record.id}.json`,
    ...record.source.rawArtifactRoles.map((role) => `raw/${role}`),
  ]);
}

function normalizeExternalRef(value: CanonicalWearableRecord["source"]["externalRef"]): WearableExternalRef | null {
  if (!value) {
    return null;
  }

  return {
    system: value.system ?? null,
    resourceType: value.resourceType ?? null,
    resourceId: value.resourceId ?? null,
    version: value.version ?? null,
    facet: value.facet ?? null,
  };
}

function collectCanonicalTombstoneKeys(records: readonly CanonicalWearableRecord[]): Set<string> {
  return new Set(records.flatMap((record) => record.kind === "tombstone"
    ? [tombstoneKey(record.source.provider.toLowerCase(), record.providerResourceType, record.providerResourceId)]
    : []));
}

function tombstoneKey(
  provider: string,
  resourceType: string | null | undefined,
  resourceId: string | null | undefined,
): string {
  return [provider, resourceType ?? "", resourceId ?? ""].join(":");
}
