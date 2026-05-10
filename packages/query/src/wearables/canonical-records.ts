import type {
  CanonicalWearableRecord,
  CanonicalWearableSource,
} from "@murphai/importers/device-providers/canonical-wearable-records";
import { extractIsoDatePrefix } from "@murphai/contracts";

import { buildActivitySessionAggregates, matchesDateFilters } from "./candidates.ts";
import { dedupeExactMetricCandidates, dedupeSleepWindowCandidates } from "./dedupe.ts";
import { resolveWearablePublicSourceProvider, wearableDataOriginKey } from "./origin.ts";
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
  const sleepResourceDates = collectCanonicalSleepResourceDates(records);

  for (const record of records) {
    const provider = record.source.provider.toLowerCase();
    const externalRef = normalizeExternalRef(record.source.externalRef);
    const publicProvider = resolveWearablePublicSourceProvider({
      dataOrigin: record.source.origin ?? null,
      externalRef,
      provider,
    });

    if (providerSet && !providerSet.has(publicProvider)) {
      continue;
    }

    if (record.kind === "tombstone") {
      continue;
    }

    const resourceKey = tombstoneKey(
      record.source,
      record.source.providerResourceType,
      record.source.providerResourceId,
    );
    if (tombstones.has(resourceKey)) {
      continue;
    }

    const date = deriveCanonicalWearableDate(record, sleepResourceDates);
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

function collectCanonicalSleepResourceDates(records: readonly CanonicalWearableRecord[]): Map<string, string> {
  const dates = new Map<string, string>();

  for (const record of records) {
    if (record.kind !== "session" || record.sessionKind !== "sleep_session") {
      continue;
    }

    const resourceKey = canonicalResourceKey(record.source);
    if (!resourceKey || dates.has(resourceKey)) {
      continue;
    }

    const date = deriveCanonicalSleepSessionDate(record);
    if (date) {
      dates.set(resourceKey, date);
    }
  }

  return dates;
}

function deriveCanonicalWearableDate(
  record: CanonicalWearableRecord,
  sleepResourceDates: ReadonlyMap<string, string>,
): string | null {
  const dayKey = normalizeNullableString(record.dayKey);
  if (dayKey) {
    return dayKey;
  }

  if (record.kind === "session" && record.sessionKind === "sleep_session") {
    return deriveCanonicalSleepSessionDate(record);
  }

  const resourceKey = canonicalResourceKey(record.source);
  const sleepResourceDate = resourceKey ? sleepResourceDates.get(resourceKey) : undefined;
  if (sleepResourceDate) {
    return sleepResourceDate;
  }

  return firstIsoDatePrefix(record.occurredAt, record.recordedAt, record.observedAt);
}

function deriveCanonicalSleepSessionDate(
  record: Extract<CanonicalWearableRecord, { kind: "session" }>,
): string | null {
  return firstIsoDatePrefix(record.endAt, record.recordedAt, record.occurredAt, record.startAt, record.observedAt);
}

function firstIsoDatePrefix(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const date = extractIsoDatePrefix(candidate);
    if (date) {
      return date;
    }
  }

  return null;
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
    ? [tombstoneKey(record.source, record.providerResourceType, record.providerResourceId)]
    : []));
}

function canonicalResourceKey(source: CanonicalWearableSource): string | null {
  const resourceType = normalizeNullableString(source.providerResourceType);
  const resourceId = normalizeNullableString(source.providerResourceId);

  return resourceType && resourceId ? tombstoneKey(source, resourceType, resourceId) : null;
}

function tombstoneKey(
  source: CanonicalWearableSource,
  resourceType: string | null | undefined,
  resourceId: string | null | undefined,
): string {
  return JSON.stringify([
    source.provider.toLowerCase(),
    source.dataSourceId,
    source.connectionId ?? "",
    source.providerAccountIdHash ?? "",
    wearableDataOriginKey(source.origin),
    resourceType ?? "",
    resourceId ?? "",
  ]);
}
