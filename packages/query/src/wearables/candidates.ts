import { deviceDataOriginSchema, type DeviceDataOrigin } from "@murphai/contracts";
import {
  canonicalizeWearableProviderSlug,
  normalizeWearableMetricValue,
} from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";
import { isDeletionSentinelObservation } from "../observation-sentinels.ts";
import type { VaultReadModel } from "../read-model.ts";
import {
  deriveWearableDate,
  deriveWearableObservationEffectiveDate,
  readWearableExternalRef,
} from "./observation.ts";
import { dedupeExactMetricCandidates, dedupeSleepWindowCandidates } from "./dedupe.ts";
import {
  inferJunctionWearableDataOriginFromExternalRef,
  resolveWearablePublicSourceProvider,
  wearableDataOriginKey,
} from "./origin.ts";
import { formatProviderName } from "./provider-policy.ts";
import {
  buildCandidateId,
  collectSortedDatesDesc,
  latestIsoTimestamp,
  normalizeLowercaseString,
  normalizeNullableString,
  normalizeUnit,
  readNumber,
  uniqueStrings,
} from "./shared.ts";
import type {
  WearableActivitySessionAggregate,
  WearableCandidateSourceFamily,
  WearableDataset,
  WearableExternalRef,
  WearableFilters,
  WearableHeartRateZoneAggregate,
  WearableMetricCandidate,
  WearableMetricKey,
  WearableProvenanceDiagnostic,
  WearableSleepWindowCandidate,
} from "./types.ts";

import { compareMetricCandidateByDateDesc, compareSleepWindowByDateDesc } from "./selection.ts";

export function collectWearableDataset(
  vault: VaultReadModel,
  filters: WearableFilters,
): WearableDataset {
  const rawMetricCandidates: WearableMetricCandidate[] = [];
  const activitySessions: WearableMetricCandidate[] = [];
  const provenanceDiagnostics = new Map<string, WearableProvenanceDiagnostic>();
  const sleepStageCandidates: WearableMetricCandidate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];
  const providerSet = filters.providers
    ? new Set(
        filters.providers
          .map((provider) => provider.trim().toLowerCase())
          .filter(Boolean)
          .map((provider) => canonicalizeWearableProviderSlug(provider)),
      )
    : null;

  for (const entity of [...vault.events, ...vault.samples.filter((sample) => sample.kind !== "metric_sample")]) {
    const externalRef = readWearableExternalRef(entity.attributes.externalRef);
    const provider = normalizeLowercaseString(externalRef?.system);
    const dataOrigin = readWearableDataOrigin(entity.attributes.dataOrigin, externalRef);
    const publicProvider = resolveWearablePublicSourceProvider({ dataOrigin, externalRef, provider }, {
      suppressJunctionSourceInstanceFallback: true,
    });
    const missingProvenanceFields = listMissingWearableProvenanceFields(externalRef);

    if (provider && missingProvenanceFields.length > 0) {
      registerWearableProvenanceDiagnostic(provenanceDiagnostics, {
        entity,
        externalRef,
        kind: "included",
        missingFields: missingProvenanceFields,
        provider: publicProvider,
      });
    }

    if (!provider) {
      if (externalRef && missingProvenanceFields.length > 0) {
        registerWearableProvenanceDiagnostic(provenanceDiagnostics, {
          entity,
          externalRef,
          kind: "excluded",
          missingFields: missingProvenanceFields,
          provider: null,
        });
      }
      continue;
    }

    if (providerSet && !providerSet.has(publicProvider)) {
      continue;
    }

    if (entity.family === "sample") {
      if (entity.stream === "sleep_stage") {
        const candidate = buildSleepStageCandidate(entity, provider, externalRef);

        if (candidate) {
          sleepStageCandidates.push(candidate);
        }

        continue;
      }

      const candidates = buildSampleMetricCandidates(entity, provider, externalRef);
      for (const candidate of candidates) {
        if (matchesDateFilters(candidate.date, filters)) {
          rawMetricCandidates.push(candidate);
        }
      }

      continue;
    }

    if (entity.family !== "event") {
      continue;
    }

    if (entity.kind === "measurement" || entity.kind === "body_measurement") {
      const candidates = buildMeasurementMetricCandidates(entity, provider, externalRef);
      for (const candidate of candidates) {
        if (matchesDateFilters(candidate.date, filters)) {
          rawMetricCandidates.push(candidate);
        }
      }
      continue;
    }

    if (entity.kind === "observation") {
      const candidates = buildObservationMetricCandidates(entity, provider, externalRef);
      for (const candidate of candidates) {
        if (matchesDateFilters(candidate.date, filters)) {
          rawMetricCandidates.push(candidate);
        }
      }
      continue;
    }

    if (entity.kind === "activity_session") {
      const candidate = buildActivitySessionCandidate(entity, provider, externalRef);
      if (candidate && matchesDateFilters(candidate.date, filters)) {
        activitySessions.push(candidate);
      }
      continue;
    }

    if (entity.kind === "sleep_session") {
      const candidate = buildSleepWindowCandidate(entity, provider, externalRef);
      if (candidate) {
        sleepWindows.push(candidate);
      }
    }
  }

  const dedupedSleepWindows = dedupeSleepWindowCandidates(sleepWindows).sort(compareSleepWindowByDateDesc);
  const filteredSleepWindows = dedupedSleepWindows.filter((candidate) => matchesDateFilters(candidate.date, filters));
  const sleepStageAggregates = buildSleepStageAggregateCandidates(sleepStageCandidates, dedupedSleepWindows)
    .filter((candidate) => matchesDateFilters(candidate.date, filters));
  const metricCandidates = [
    ...dedupeExactMetricCandidates(rawMetricCandidates).candidates,
    ...dedupeExactMetricCandidates(sleepStageAggregates).candidates,
  ].sort(compareMetricCandidateByDateDesc);

  return {
    activitySessionAggregates: buildActivitySessionAggregates(activitySessions),
    metricCandidates,
    provenanceDiagnostics: [...provenanceDiagnostics.values()].sort(compareWearableProvenanceDiagnostics),
    rawMetricCandidates,
    sleepWindows: filteredSleepWindows,
  };
}

export function buildActivitySessionAggregates(
  candidates: readonly WearableMetricCandidate[],
): WearableActivitySessionAggregate[] {
  const grouped = new Map<string, WearableActivitySessionAggregate>();

  for (const candidate of dedupeExactMetricCandidates(candidates).candidates) {
    const key = `${candidate.date}:${candidate.provider}:${wearableDataOriginKey(candidate.dataOrigin)}`;
    const activityType = candidate.activityType ?? null;
    const heartRateZones = candidate.heartRateZones ?? [];
    const existing = grouped.get(key);
    if (existing) {
      existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
      existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
      existing.heartRateZones = mergeHeartRateZoneAggregates([
        ...existing.heartRateZones,
        ...heartRateZones,
      ]);
      existing.sessionMinutes += candidate.value;
      existing.sessionCount += 1;
      existing.workoutMetricKeys = uniqueStrings([
        ...existing.workoutMetricKeys,
        ...(candidate.workoutMetricKeys ?? []),
      ]).sort();
      if (activityType && !existing.activityTypes.includes(activityType)) {
        existing.activityTypes.push(activityType);
        existing.activityTypes.sort();
      }
      existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
      continue;
    }

    grouped.set(key, {
      activityTypes: activityType ? [activityType] : [],
      candidateId: buildCandidateId([
        candidate.provider,
        wearableDataOriginKey(candidate.dataOrigin),
        candidate.date,
        "activity-session-aggregate",
      ]),
      dataOrigin: candidate.dataOrigin ?? null,
      date: candidate.date,
      heartRateZones: mergeHeartRateZoneAggregates(heartRateZones),
      paths: [...candidate.paths],
      provider: candidate.provider,
      recordedAt: candidate.recordedAt,
      recordIds: [...candidate.recordIds],
      sessionCount: 1,
      sessionMinutes: candidate.value,
      workoutMetricKeys: uniqueStrings(candidate.workoutMetricKeys ?? []).sort(),
    });
  }

  return [...grouped.values()].sort(compareAggregateByDateDesc);
}

export function buildSleepStageAggregateCandidates(
  candidates: readonly WearableMetricCandidate[],
  sleepWindows: readonly WearableSleepWindowCandidate[] = [],
): WearableMetricCandidate[] {
  const grouped = new Map<string, WearableMetricCandidate>();

  for (const candidate of dedupeExactMetricCandidates(candidates).candidates) {
    const window = findSleepStageAggregateWindow(candidate, sleepWindows);
    const aggregateDate = window?.date ?? candidate.date;
    const externalRef = window?.externalRef ?? null;
    const key = [
      aggregateDate,
      candidate.provider,
      wearableDataOriginKey(candidate.dataOrigin),
      candidate.metric,
      window?.candidateId ?? "unwindowed",
    ].join(":");
    const existing = grouped.get(key);

    if (existing) {
      existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
      existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
      existing.value += candidate.value;
      existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
      continue;
    }

    grouped.set(key, {
      ...candidate,
      candidateId: buildCandidateId([
        candidate.provider,
        wearableDataOriginKey(candidate.dataOrigin),
        aggregateDate,
        window?.candidateId ?? "unwindowed",
        candidate.metric,
        "sleep-stage-aggregate",
      ]),
      date: aggregateDate,
      externalRef,
      sourceFamily: "derived",
      sourceKind: "sleep-stage-aggregate",
      title: `${formatProviderName(candidate.provider)} sleep stages`,
      value: candidate.value,
    });
  }

  return [...grouped.values()].sort(compareMetricCandidateByDateDesc);
}

function findSleepStageAggregateWindow(
  candidate: WearableMetricCandidate,
  sleepWindows: readonly WearableSleepWindowCandidate[],
): WearableSleepWindowCandidate | null {
  const matchingWindows = sleepWindows
    .filter((window) => sleepStageCandidateMatchesWindow(candidate, window))
    .sort(compareSleepStageAggregateWindow);

  return matchingWindows[0] ?? null;
}

function sleepStageCandidateMatchesWindow(
  candidate: WearableMetricCandidate,
  window: WearableSleepWindowCandidate,
): boolean {
  if (candidate.provider !== window.provider) {
    return false;
  }

  const candidateOrigin = wearableDataOriginKey(candidate.dataOrigin);
  const windowOrigin = wearableDataOriginKey(window.dataOrigin);
  if (candidateOrigin && windowOrigin && candidateOrigin !== windowOrigin) {
    return false;
  }

  if (externalRefsShareResource(candidate.externalRef, window.externalRef)) {
    return true;
  }

  return sleepStageCandidateOverlapsWindow(candidate, window);
}

function externalRefsShareResource(
  left: WearableExternalRef | null,
  right: WearableExternalRef | null,
): boolean {
  const leftResourceId = normalizeLowercaseString(left?.resourceId);
  const rightResourceId = normalizeLowercaseString(right?.resourceId);
  if (!leftResourceId || !rightResourceId || leftResourceId !== rightResourceId) {
    return false;
  }

  const leftSystem = normalizeLowercaseString(left?.system);
  const rightSystem = normalizeLowercaseString(right?.system);
  if (leftSystem && rightSystem && leftSystem !== rightSystem) {
    return false;
  }

  const leftResourceType = normalizeLowercaseString(left?.resourceType);
  const rightResourceType = normalizeLowercaseString(right?.resourceType);
  return !leftResourceType
    || !rightResourceType
    || leftResourceType === rightResourceType
    || (leftResourceType.includes("sleep") && rightResourceType.includes("sleep"));
}

function sleepStageCandidateOverlapsWindow(
  candidate: WearableMetricCandidate,
  window: WearableSleepWindowCandidate,
): boolean {
  const stageStart = parseIsoTime(candidate.occurredAt);
  const windowStart = parseIsoTime(window.startAt);
  const windowEnd = parseIsoTime(window.endAt);
  if (stageStart === null || windowStart === null || windowEnd === null) {
    return false;
  }

  const stageDurationMs = candidate.value > 0 ? candidate.value * 60_000 : 0;
  const stageEnd = stageStart + stageDurationMs;
  return stageStart < windowEnd && stageEnd > windowStart;
}

function compareSleepStageAggregateWindow(
  left: WearableSleepWindowCandidate,
  right: WearableSleepWindowCandidate,
): number {
  return left.durationMinutes - right.durationMinutes
    || (left.nap === right.nap ? 0 : left.nap ? -1 : 1)
    || left.candidateId.localeCompare(right.candidateId);
}

function parseIsoTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function selectMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
  metric: WearableMetricKey,
): WearableMetricCandidate[] {
  return candidates.filter((candidate) => candidate.metric === metric);
}

export function createMetricCandidateBase(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
  date: string,
  sourceFamily: WearableCandidateSourceFamily,
  sourceKind: string,
): Omit<WearableMetricCandidate, "metric" | "unit" | "value"> {
  return {
    candidateId: buildCandidateId([
      provider,
      wearableDataOriginKey(readWearableDataOrigin(entity.attributes.dataOrigin, externalRef)),
      date,
      sourceFamily,
      sourceKind,
      externalRef?.resourceType ?? "",
      externalRef?.resourceId ?? entity.entityId,
      externalRef?.facet ?? "",
      normalizeNullableString(entity.occurredAt) ?? normalizeNullableString(entity.attributes.recordedAt) ?? "",
    ]),
    dataOrigin: readWearableDataOrigin(entity.attributes.dataOrigin, externalRef),
    date,
    externalRef,
    occurredAt: entity.occurredAt ?? null,
    paths: [entity.path],
    provider,
    recordedAt: normalizeNullableString(entity.attributes.recordedAt) ?? entity.occurredAt ?? null,
    recordIds: [entity.entityId],
    sourceFamily,
    sourceKind,
    title: entity.title ?? normalizeNullableString(entity.attributes.title),
  };
}

export function buildActivitySessionMetricCandidate(
  aggregate: WearableActivitySessionAggregate,
  metric: "sessionMinutes" | "sessionCount",
): WearableMetricCandidate {
  return {
    candidateId: `${aggregate.candidateId}:${metric}`,
    dataOrigin: aggregate.dataOrigin ?? null,
    date: aggregate.date,
    externalRef: null,
    metric,
    occurredAt: null,
    paths: [...aggregate.paths],
    provider: aggregate.provider,
    recordedAt: aggregate.recordedAt,
    recordIds: [...aggregate.recordIds],
    sourceFamily: "derived",
    sourceKind: "activity-session-aggregate",
    title: `${formatProviderName(aggregate.provider)} activity sessions`,
    unit: metric === "sessionMinutes" ? "minutes" : "count",
    value: metric === "sessionMinutes" ? aggregate.sessionMinutes : aggregate.sessionCount,
  };
}

export function buildSleepWindowMetricCandidate(
  window: WearableSleepWindowCandidate,
): WearableMetricCandidate {
  return {
    candidateId: `${window.candidateId}:sessionMinutes`,
    dataOrigin: window.dataOrigin ?? null,
    date: window.date,
    externalRef: null,
    metric: "sessionMinutes",
    occurredAt: window.occurredAt,
    paths: [...window.paths],
    provider: window.provider,
    recordedAt: window.recordedAt,
    recordIds: [...window.recordIds],
    sourceFamily: "derived",
    sourceKind: "sleep-window",
    title: window.title,
    unit: "minutes",
    value: window.durationMinutes,
  };
}

export function resolveSelectedActivityTypes(
  aggregates: readonly WearableActivitySessionAggregate[],
  selectedProvider: string | null,
): string[] {
  if (!selectedProvider) {
    return [];
  }

  const selected = aggregates.find((aggregate) => aggregate.provider === selectedProvider);
  return selected?.activityTypes ?? [];
}

export function resolveSelectedHeartRateZones(
  aggregates: readonly WearableActivitySessionAggregate[],
  selectedProvider: string | null,
): WearableHeartRateZoneAggregate[] {
  if (!selectedProvider) {
    return [];
  }

  const selected = aggregates.find((aggregate) => aggregate.provider === selectedProvider);
  return selected ? selected.heartRateZones.map((zone) => ({ ...zone })) : [];
}

export function groupMetricCandidatesByDate(
  candidates: readonly WearableMetricCandidate[],
): Map<string, WearableMetricCandidate[]> {
  const grouped = new Map<string, WearableMetricCandidate[]>();

  for (const candidate of candidates) {
    const existing = grouped.get(candidate.date);
    if (existing) {
      existing.push(candidate);
      continue;
    }

    grouped.set(candidate.date, [candidate]);
  }

  return grouped;
}

export function groupActivitySessionAggregatesByDate(
  aggregates: readonly WearableActivitySessionAggregate[],
): Map<string, WearableActivitySessionAggregate[]> {
  const grouped = new Map<string, WearableActivitySessionAggregate[]>();

  for (const aggregate of aggregates) {
    const existing = grouped.get(aggregate.date);
    if (existing) {
      existing.push(aggregate);
      continue;
    }

    grouped.set(aggregate.date, [aggregate]);
  }

  return grouped;
}

export function groupSleepWindowsByDate(
  windows: readonly WearableSleepWindowCandidate[],
): Map<string, WearableSleepWindowCandidate[]> {
  const grouped = new Map<string, WearableSleepWindowCandidate[]>();

  for (const window of windows) {
    const existing = grouped.get(window.date);
    if (existing) {
      existing.push(window);
      continue;
    }

    grouped.set(window.date, [window]);
  }

  return grouped;
}

export function matchesDateFilters(
  date: string,
  filters: WearableFilters,
): boolean {
  if (filters.date && date !== filters.date) {
    return false;
  }

  if (filters.from && date < filters.from) {
    return false;
  }

  if (filters.to && date > filters.to) {
    return false;
  }

  return true;
}

function buildSampleMetricCandidates(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate[] {
  const value = readNumber(entity.attributes.value);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: true,
  });

  if (value === null || !date) {
    return [];
  }

  const base = createMetricCandidateBase(entity, provider, externalRef, date, "sample", entity.stream ?? "sample");

  switch (entity.stream) {
    case "steps":
      return [{ ...base, metric: "steps", unit: "count", value }];
    case "hrv":
      return [{ ...base, metric: "hrv", unit: normalizeUnit(entity.attributes.unit) ?? "ms", value }];
    case "spo2":
      return [{ ...base, metric: "spo2", unit: normalizeUnit(entity.attributes.unit) ?? "%", value }];
    case "respiratory_rate":
      return [{
        ...base,
        metric: "respiratoryRate",
        unit: normalizeUnit(entity.attributes.unit) ?? "breaths_per_minute",
        value,
      }];
    case "temperature":
      return [{ ...base, metric: "temperature", unit: normalizeUnit(entity.attributes.unit) ?? "celsius", value }];
    case "heart_rate":
      return [{ ...base, metric: "averageHeartRate", unit: normalizeUnit(entity.attributes.unit) ?? "bpm", value }];
    case "estimated_vo2_max":
    case "estimated_vo2max":
    case "vo2_max":
    case "vo2max":
    case "cardio_fitness":
      return [{ ...base, metric: "estimatedVo2Max", unit: normalizeUnit(entity.attributes.unit) ?? "ml/kg/min", value }];
    default:
      return [];
  }
}

function buildObservationMetricCandidates(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate[] {
  if (isDeletionSentinelObservation(entity)) {
    return [];
  }

  const rawMetric = normalizeLowercaseString(entity.attributes.metric);
  const rawValue = readNumber(entity.attributes.value);
  const date = deriveWearableObservationEffectiveDate(entity, externalRef);

  if (!rawMetric || rawValue === null || !date) {
    return [];
  }

  const mapped = mapScalarMetric(rawMetric, rawValue, normalizeUnit(entity.attributes.unit));
  if (!mapped) {
    return [];
  }

  const base = createMetricCandidateBase(entity, provider, externalRef, date, "event", `observation:${rawMetric}`);

  return [{
    ...base,
    metric: mapped.metric,
    unit: mapped.unit,
    value: mapped.value,
  }];
}

function buildMeasurementMetricCandidates(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate[] {
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: true,
  });

  if (!date) {
    return [];
  }

  const entries = Array.isArray(entity.attributes.measurements)
    ? entity.attributes.measurements
    : [];
  const base = createMetricCandidateBase(entity, provider, externalRef, date, "event", entity.kind);

  return entries.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as Record<string, unknown>;
    const rawMetric =
      normalizeLowercaseString(candidate.metric)
      ?? normalizeLowercaseString(candidate.type)?.replace(/_/gu, "-")
      ?? null;
    const rawValue = readNumber(candidate.value);
    const rawUnit = normalizeUnit(candidate.unit);

    if (!rawMetric || rawValue === null) {
      return [];
    }

    const mapped = mapScalarMetric(rawMetric, rawValue, rawUnit);
    if (!mapped) {
      return [];
    }

    return [{
      ...base,
      candidateId: `${base.candidateId}:measurement:${index + 1}`,
      metric: mapped.metric,
      unit: mapped.unit,
      value: mapped.value,
    }];
  });
}

function buildActivitySessionCandidate(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate | null {
  const durationMinutes = readNumber(entity.attributes.durationMinutes);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: false,
  });

  if (durationMinutes === null || !date) {
    return null;
  }

  return {
    ...createMetricCandidateBase(entity, provider, externalRef, date, "event", "activity_session"),
    activityType: resolveActivitySessionActivityType(entity),
    heartRateZones: listWorkoutHeartRateZones(entity.attributes.workout),
    metric: "sessionMinutes",
    unit: "minutes",
    value: durationMinutes,
    workoutMetricKeys: listWorkoutMetricKeys(entity.attributes.workout),
  };
}

function resolveActivitySessionActivityType(entity: CanonicalEntity): string | null {
  return normalizeNullableString(entity.attributes.activityType)
    ?? resolveWorkoutActivityType(entity.attributes.workout);
}

function resolveWorkoutActivityType(workout: unknown): string | null {
  if (!workout || typeof workout !== "object" || Array.isArray(workout)) {
    return null;
  }

  const workoutRecord = workout as Record<string, unknown>;
  return normalizeNullableString(workoutRecord.sport)
    ?? normalizeNullableString(workoutRecord.sportName);
}

function buildSleepWindowCandidate(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableSleepWindowCandidate | null {
  const durationMinutes = readNumber(entity.attributes.durationMinutes);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: true,
  });
  if (durationMinutes === null || !date) {
    return null;
  }

  const title = normalizeNullableString(entity.title) ?? normalizeNullableString(entity.attributes.title);

  return {
    candidateId: buildCandidateId([
      provider,
      wearableDataOriginKey(readWearableDataOrigin(entity.attributes.dataOrigin, externalRef)),
      date,
      "sleep-window",
      externalRef?.resourceType ?? "",
      externalRef?.resourceId ?? entity.entityId,
      normalizeNullableString(entity.attributes.startAt) ?? entity.occurredAt ?? "",
    ]),
    dataOrigin: readWearableDataOrigin(entity.attributes.dataOrigin, externalRef),
    date,
    durationMinutes,
    endAt: normalizeNullableString(entity.attributes.endAt),
    externalRef,
    nap: (title ?? "").toLowerCase().includes("nap"),
    occurredAt: entity.occurredAt ?? null,
    paths: [entity.path],
    provider,
    recordedAt: normalizeNullableString(entity.attributes.recordedAt) ?? entity.occurredAt ?? null,
    recordIds: [entity.entityId],
    sourceFamily: "event",
    sourceKind: "sleep_session",
    startAt: normalizeNullableString(entity.attributes.startAt) ?? entity.occurredAt ?? null,
    title,
  };
}

function buildSleepStageCandidate(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate | null {
  const stage = normalizeLowercaseString(entity.attributes.stage);
  const durationMinutes = readNumber(entity.attributes.durationMinutes);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: true,
  });

  if (!stage || durationMinutes === null || !date) {
    return null;
  }

  const mappedMetric = mapSleepStageToMetric(stage);
  if (!mappedMetric) {
    return null;
  }

  return {
    ...createMetricCandidateBase(entity, provider, externalRef, date, "sample", `sleep_stage:${stage}`),
    metric: mappedMetric,
    unit: "minutes",
    value: durationMinutes,
  };
}

function mapScalarMetric(
  metric: string,
  value: number,
  unit: string | null,
): { metric: WearableMetricKey; unit: string | null; value: number } | null {
  const normalizedMetric = normalizeWearableMetricValue(metric, value, unit);
  return normalizedMetric
    ? {
        metric: normalizedMetric.key,
        unit: normalizedMetric.unit,
        value: normalizedMetric.value,
      }
    : null;
}

const WORKOUT_METRIC_KEYS = [
  "activeCalories",
  "altitudeChangeMeters",
  "averageHeartRate",
  "averageSpeedMps",
  "averagePowerWatts",
  "elevationHighMeters",
  "elevationLowMeters",
  "hrv",
  "kilojoules",
  "maxHeartRate",
  "maxPowerWatts",
  "maxSpeedMps",
  "normalizedPowerWatts",
  "percentRecorded",
  "totalCalories",
  "totalElevationGainMeters",
  "weightedAveragePowerWatts",
  "workoutStrain",
] as const;

function listWorkoutMetricKeys(workout: unknown): string[] {
  if (!workout || typeof workout !== "object" || Array.isArray(workout)) {
    return [];
  }

  const metrics = (workout as Record<string, unknown>).metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return [];
  }

  const metricRecord = metrics as Record<string, unknown>;
  return WORKOUT_METRIC_KEYS.filter((metric) => readNumber(metricRecord[metric]) !== null);
}

function listWorkoutHeartRateZones(workout: unknown): WearableHeartRateZoneAggregate[] {
  if (!workout || typeof workout !== "object" || Array.isArray(workout)) {
    return [];
  }

  const zones = (workout as Record<string, unknown>).heartRateZones;
  if (!Array.isArray(zones)) {
    return [];
  }

  return mergeHeartRateZoneAggregates(
    zones.flatMap((entry) => {
      const zone = normalizeWorkoutHeartRateZone(entry);
      return zone ? [zone] : [];
    }),
  );
}

function normalizeWorkoutHeartRateZone(value: unknown): WearableHeartRateZoneAggregate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const durationMinutes = readNumber(record.durationMinutes);
  if (durationMinutes === null || durationMinutes < 0) {
    return null;
  }

  const zone = readNumber(record.zone);
  const minHeartRate = readNumber(record.minHeartRate);
  const maxHeartRate = readNumber(record.maxHeartRate);
  const label = normalizeNullableString(record.label);
  if (
    zone === null
    && minHeartRate === null
    && maxHeartRate === null
    && label === null
  ) {
    return null;
  }

  return {
    ...(label === null ? {} : { label }),
    ...(maxHeartRate === null ? {} : { maxHeartRate }),
    ...(minHeartRate === null ? {} : { minHeartRate }),
    ...(zone === null ? {} : { zone }),
    durationMinutes,
  };
}

function mergeHeartRateZoneAggregates(
  zones: readonly WearableHeartRateZoneAggregate[],
): WearableHeartRateZoneAggregate[] {
  const merged = new Map<string, WearableHeartRateZoneAggregate>();

  for (const zone of zones) {
    const key = [
      zone.zone ?? "",
      zone.label ?? "",
      zone.minHeartRate ?? "",
      zone.maxHeartRate ?? "",
    ].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.durationMinutes += zone.durationMinutes;
      continue;
    }
    merged.set(key, { ...zone });
  }

  return [...merged.values()].sort(compareHeartRateZoneAggregate);
}

function compareHeartRateZoneAggregate(
  left: WearableHeartRateZoneAggregate,
  right: WearableHeartRateZoneAggregate,
): number {
  return (left.zone ?? Number.MAX_SAFE_INTEGER) - (right.zone ?? Number.MAX_SAFE_INTEGER)
    || (left.minHeartRate ?? Number.MAX_SAFE_INTEGER) - (right.minHeartRate ?? Number.MAX_SAFE_INTEGER)
    || (left.maxHeartRate ?? Number.MAX_SAFE_INTEGER) - (right.maxHeartRate ?? Number.MAX_SAFE_INTEGER)
    || (left.label ?? "").localeCompare(right.label ?? "");
}

function mapSleepStageToMetric(stage: string): WearableMetricKey | null {
  switch (stage.toLowerCase()) {
    case "awake":
      return "awakeMinutes";
    case "light":
      return "lightMinutes";
    case "deep":
      return "deepMinutes";
    case "rem":
      return "remMinutes";
    default:
      return null;
  }
}

function readWearableDataOrigin(
  value: unknown,
  externalRef: WearableExternalRef | null,
): DeviceDataOrigin | null {
  const normalized = normalizeDeviceDataOrigin(value);
  return normalized ?? inferJunctionWearableDataOriginFromExternalRef(externalRef);
}

function normalizeDeviceDataOrigin(value: unknown): DeviceDataOrigin | null {
  const parsed = deviceDataOriginSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function listMissingWearableProvenanceFields(
  externalRef: WearableExternalRef | null,
): string[] {
  if (!externalRef) {
    return [];
  }

  return [
    ...(externalRef.system ? [] : ["system"]),
    ...(externalRef.resourceType ? [] : ["resourceType"]),
    ...(externalRef.resourceId ? [] : ["resourceId"]),
  ];
}

function registerWearableProvenanceDiagnostic(
  diagnostics: Map<string, WearableProvenanceDiagnostic>,
  input: {
    entity: CanonicalEntity;
    externalRef: WearableExternalRef | null;
    kind: WearableProvenanceDiagnostic["kind"];
    missingFields: string[];
    provider: string | null;
  },
): void {
  const key = [
    input.kind,
    input.provider ?? "unknown",
    [...input.missingFields].sort().join(","),
  ].join("|");
  const date = deriveWearableDate(input.entity, input.externalRef, {
    preferSleepEndAt: input.entity.kind === "sleep_session" || input.entity.stream === "sleep_stage",
  });
  const recordedAt = normalizeNullableString(input.entity.attributes.recordedAt) ?? input.entity.occurredAt ?? null;
  const existing = diagnostics.get(key);

  if (existing) {
    existing.count += 1;
    if (date) {
      existing.dates = collectSortedDatesDesc([...existing.dates, date]);
    }
    existing.latestRecordedAt = latestIsoTimestamp([existing.latestRecordedAt, recordedAt]);
    return;
  }

  diagnostics.set(key, {
    count: 1,
    dates: date ? [date] : [],
    kind: input.kind,
    latestRecordedAt: recordedAt,
    missingFields: [...input.missingFields].sort(),
    provider: input.provider,
  });
}

function compareWearableProvenanceDiagnostics(
  left: WearableProvenanceDiagnostic,
  right: WearableProvenanceDiagnostic,
): number {
  if ((left.dates[0] ?? "") !== (right.dates[0] ?? "")) {
    return (right.dates[0] ?? "").localeCompare(left.dates[0] ?? "");
  }

  if ((left.provider ?? "") !== (right.provider ?? "")) {
    return (left.provider ?? "").localeCompare(right.provider ?? "");
  }

  return left.missingFields.join(",").localeCompare(right.missingFields.join(","));
}

function compareAggregateByDateDesc(
  left: WearableActivitySessionAggregate,
  right: WearableActivitySessionAggregate,
): number {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return left.provider.localeCompare(right.provider);
}
