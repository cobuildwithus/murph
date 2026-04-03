import { extractIsoDatePrefix } from "@murphai/contracts";

import type { CanonicalEntity } from "../canonical-entities.ts";
import type { VaultReadModel } from "../model.ts";
import { dedupeExactMetricCandidates, dedupeSleepWindowCandidates } from "./dedupe.ts";
import { formatProviderName } from "./provider-policy.ts";
import {
  buildCandidateId,
  collectSortedDatesDesc,
  latestIsoTimestamp,
  metersToKilometers,
  normalizeActivityTypeFromTitle,
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
    ? new Set(filters.providers.map((provider) => provider.trim().toLowerCase()).filter(Boolean))
    : null;

  for (const entity of [...vault.events, ...vault.samples]) {
    const externalRef = readExternalRef(entity.attributes.externalRef);
    const provider = normalizeLowercaseString(externalRef?.system);
    const missingProvenanceFields = listMissingWearableProvenanceFields(externalRef);

    if (provider && missingProvenanceFields.length > 0) {
      registerWearableProvenanceDiagnostic(provenanceDiagnostics, {
        entity,
        externalRef,
        kind: "included",
        missingFields: missingProvenanceFields,
        provider,
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

    if (providerSet && !providerSet.has(provider)) {
      continue;
    }

    if (entity.family === "sample") {
      if (entity.stream === "sleep_stage") {
        const candidate = buildSleepStageCandidate(entity, provider, externalRef);

        if (candidate && matchesDateFilters(candidate.date, filters)) {
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
      if (candidate && matchesDateFilters(candidate.date, filters)) {
        sleepWindows.push(candidate);
      }
    }
  }

  const metricCandidates = [
    ...dedupeExactMetricCandidates(rawMetricCandidates).candidates,
    ...dedupeExactMetricCandidates(buildSleepStageAggregateCandidates(sleepStageCandidates)).candidates,
  ].sort(compareMetricCandidateByDateDesc);

  return {
    activitySessionAggregates: buildActivitySessionAggregates(activitySessions),
    metricCandidates,
    provenanceDiagnostics: [...provenanceDiagnostics.values()].sort(compareWearableProvenanceDiagnostics),
    rawMetricCandidates,
    sleepWindows: dedupeSleepWindowCandidates(sleepWindows).sort(compareSleepWindowByDateDesc),
  };
}

export function buildActivitySessionAggregates(
  candidates: readonly WearableMetricCandidate[],
): WearableActivitySessionAggregate[] {
  const grouped = new Map<string, WearableActivitySessionAggregate>();

  for (const candidate of dedupeExactMetricCandidates(candidates).candidates) {
    const key = `${candidate.date}:${candidate.provider}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
      existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
      existing.sessionMinutes += candidate.value;
      existing.sessionCount += 1;
      const activityType = normalizeActivityTypeFromTitle(candidate.title);
      if (activityType && !existing.activityTypes.includes(activityType)) {
        existing.activityTypes.push(activityType);
        existing.activityTypes.sort();
      }
      existing.recordedAt = latestIsoTimestamp([existing.recordedAt, candidate.recordedAt]);
      continue;
    }

    grouped.set(key, {
      activityTypes: normalizeActivityTypeFromTitle(candidate.title)
        ? [normalizeActivityTypeFromTitle(candidate.title)!]
        : [],
      candidateId: buildCandidateId([candidate.provider, candidate.date, "activity-session-aggregate"]),
      date: candidate.date,
      paths: [...candidate.paths],
      provider: candidate.provider,
      recordedAt: candidate.recordedAt,
      recordIds: [...candidate.recordIds],
      sessionCount: 1,
      sessionMinutes: candidate.value,
    });
  }

  return [...grouped.values()].sort(compareAggregateByDateDesc);
}

export function buildSleepStageAggregateCandidates(
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate[] {
  const grouped = new Map<string, WearableMetricCandidate>();

  for (const candidate of dedupeExactMetricCandidates(candidates).candidates) {
    const key = `${candidate.date}:${candidate.provider}:${candidate.metric}`;
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
      candidateId: buildCandidateId([candidate.provider, candidate.date, candidate.metric, "sleep-stage-aggregate"]),
      externalRef: null,
      sourceFamily: "derived",
      sourceKind: "sleep-stage-aggregate",
      title: `${formatProviderName(candidate.provider)} sleep stages`,
      value: candidate.value,
    });
  }

  return [...grouped.values()].sort(compareMetricCandidateByDateDesc);
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
      date,
      sourceFamily,
      sourceKind,
      externalRef?.resourceType ?? "",
      externalRef?.resourceId ?? entity.entityId,
      externalRef?.facet ?? "",
      normalizeNullableString(entity.occurredAt) ?? normalizeNullableString(entity.attributes.recordedAt) ?? "",
    ]),
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
    default:
      return [];
  }
}

function buildObservationMetricCandidates(
  entity: CanonicalEntity,
  provider: string,
  externalRef: WearableExternalRef | null,
): WearableMetricCandidate[] {
  const rawMetric = normalizeLowercaseString(entity.attributes.metric);
  const rawValue = readNumber(entity.attributes.value);
  const date = deriveWearableDate(entity, externalRef, {
    preferSleepEndAt: true,
  });

  if (!rawMetric || rawValue === null || !date) {
    return [];
  }

  const mapped = mapObservationMetric(rawMetric, rawValue, normalizeUnit(entity.attributes.unit));
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
    metric: "sessionMinutes",
    unit: "minutes",
    value: durationMinutes,
  };
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
      date,
      "sleep-window",
      externalRef?.resourceType ?? "",
      externalRef?.resourceId ?? entity.entityId,
      normalizeNullableString(entity.attributes.startAt) ?? entity.occurredAt ?? "",
    ]),
    date,
    durationMinutes,
    endAt: normalizeNullableString(entity.attributes.endAt),
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

function mapObservationMetric(
  metric: string,
  value: number,
  unit: string | null,
): { metric: WearableMetricKey; unit: string | null; value: number } | null {
  switch (metric) {
    case "daily-steps":
      return { metric: "steps", unit: "count", value };
    case "active-calories":
      return { metric: "activeCalories", unit: "kcal", value };
    case "distance":
    case "equivalent-walking-distance":
      return { metric: "distanceKm", unit: "km", value: metersToKilometers(value) };
    case "activity-score":
      return { metric: "activityScore", unit: unit ?? "%", value };
    case "day-strain":
      return { metric: "dayStrain", unit: unit ?? "whoop_strain", value };
    case "sleep-efficiency":
      return { metric: "sleepEfficiency", unit: unit ?? "%", value };
    case "sleep-total-minutes":
      return { metric: "totalSleepMinutes", unit: "minutes", value };
    case "time-in-bed-minutes":
      return { metric: "timeInBedMinutes", unit: "minutes", value };
    case "sleep-awake-minutes":
      return { metric: "awakeMinutes", unit: "minutes", value };
    case "sleep-light-minutes":
      return { metric: "lightMinutes", unit: "minutes", value };
    case "sleep-deep-minutes":
      return { metric: "deepMinutes", unit: "minutes", value };
    case "sleep-rem-minutes":
      return { metric: "remMinutes", unit: "minutes", value };
    case "sleep-score":
      return { metric: "sleepScore", unit: unit ?? "%", value };
    case "sleep-performance":
      return { metric: "sleepPerformance", unit: unit ?? "%", value };
    case "sleep-consistency":
      return { metric: "sleepConsistency", unit: unit ?? "%", value };
    case "recovery-score":
      return { metric: "recoveryScore", unit: unit ?? "%", value };
    case "readiness-score":
      return { metric: "readinessScore", unit: unit ?? "%", value };
    case "resting-heart-rate":
      return { metric: "restingHeartRate", unit: unit ?? "bpm", value };
    case "average-heart-rate":
      return { metric: "averageHeartRate", unit: unit ?? "bpm", value };
    case "lowest-heart-rate":
      return { metric: "lowestHeartRate", unit: unit ?? "bpm", value };
    case "respiratory-rate":
      return { metric: "respiratoryRate", unit: unit ?? "breaths_per_minute", value };
    case "spo2":
      return { metric: "spo2", unit: unit ?? "%", value };
    case "temperature-deviation":
      return { metric: "temperatureDeviation", unit: unit ?? "celsius", value };
    case "body-battery":
      return { metric: "bodyBattery", unit: unit ?? "score", value };
    case "stress-level":
      return { metric: "stressLevel", unit: unit ?? "score", value };
    case "weight":
      return { metric: "weightKg", unit: unit ?? "kg", value };
    case "body-fat-percentage":
      return { metric: "bodyFatPercentage", unit: unit ?? "%", value };
    case "bmi":
      return { metric: "bmi", unit: unit ?? "kg_m2", value };
    default:
      return null;
  }
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

function deriveWearableDate(
  entity: CanonicalEntity,
  externalRef: WearableExternalRef | null,
  options: {
    preferSleepEndAt: boolean;
  },
): string | null {
  const dayKey = normalizeNullableString(entity.attributes.dayKey);
  if (dayKey) {
    return dayKey;
  }

  const resourceType = normalizeLowercaseString(externalRef?.resourceType);
  const startAt = normalizeNullableString(entity.attributes.startAt);
  const endAt = normalizeNullableString(entity.attributes.endAt);
  const recordedAt = normalizeNullableString(entity.attributes.recordedAt) ?? entity.occurredAt ?? null;
  const candidates = options.preferSleepEndAt || resourceType?.includes("sleep")
    ? [endAt, recordedAt, entity.occurredAt, startAt, entity.date]
    : [entity.date, recordedAt, entity.occurredAt, endAt, startAt];

  for (const candidate of candidates) {
    const date = extractIsoDatePrefix(candidate);
    if (date) {
      return date;
    }
  }

  return null;
}

function readExternalRef(value: unknown): WearableExternalRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const system = normalizeLowercaseString(record.system);
  const resourceType = normalizeLowercaseString(record.resourceType);
  const resourceId = normalizeNullableString(record.resourceId);
  const version = normalizeNullableString(record.version);
  const facet = normalizeNullableString(record.facet);

  if (!system && !resourceType && !resourceId && !version && !facet) {
    return null;
  }

  return {
    system,
    resourceType,
    resourceId,
    version,
    facet,
  };
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
