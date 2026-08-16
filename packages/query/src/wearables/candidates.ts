import {
  activityTextMatchesKind,
  deviceDataOriginSchema,
  normalizeActivityKindToken,
  type DeviceDataOrigin,
} from "@murphai/contracts";
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
import {
  buildCandidateExactKey,
  dedupeExactMetricCandidates,
  dedupeSleepWindowCandidates,
} from "./dedupe.ts";
import {
  inferJunctionWearableDataOriginFromExternalRef,
  normalizeWearableOriginSourceSlug,
  resolveWearablePublicSourceProvider,
  wearableDataOriginKey,
} from "./origin.ts";
import { formatProviderName } from "./provider-policy.ts";
import {
  normalizeResourceToken,
  resolveSleepCandidateProvider,
  sleepMetricAssociatedWithWindow,
  sleepMetricMatchesWindow,
} from "./sleep-association.ts";
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
import {
  ACTIVITY_SESSION_WORKOUT_METRIC_SPECS,
  type WearableActivitySessionAggregate,
  type WearableActivitySessionMetricContributors,
  type WearableActivitySessionMetricValues,
  type WearableActivitySessionWorkoutMetricKey,
  type WearableCandidateSourceFamily,
  type WearableDataset,
  type WearableExternalRef,
  type WearableFilters,
  type WearableHeartRateZoneAggregate,
  type WearableMetricCandidate,
  type WearableMetricKey,
  type WearableMetricSuppressionEvidence,
  type WearableMetricSelection,
  type WearableProvenanceDiagnostic,
  type WearableSleepWindowCandidate,
} from "./types.ts";

import { compareMetricCandidateByDateDesc, compareSleepWindowByDateDesc } from "./selection.ts";

const APPLE_HEALTH_KIT_PROVIDER = "apple-health-kit";
const JUNCTION_SLEEP_STAGE_SUMMARY_NORMALIZER_VERSION = "junction-sleep-stage-summary.v1";
const JUNCTION_SLEEP_STAGE_CYCLE_FALLBACK_NORMALIZER_VERSION = "junction-sleep-stage-cycle-fallback.v1";
const ACTIVITY_SESSION_DUPLICATE_MIN_OVERLAP_RATIO = 0.8;
// Elapsed windows can include pauses, so only gross duration mismatches lose preference.
const ACTIVITY_SESSION_DURATION_CONSISTENCY_ABSOLUTE_TOLERANCE_MS = 2 * 60 * 1_000;
const ACTIVITY_SESSION_DURATION_CONSISTENCY_RELATIVE_TOLERANCE = 0.2;
const GENERIC_ACTIVITY_SESSION_TYPES = new Set([
  "activity",
  "exercise",
  "other",
  "training",
  "unknown",
  "workout",
]);
const INVALID_ZERO_SLEEP_METRIC_SUPPRESSION_KEYS = new Map<WearableMetricKey, string>([
  ["totalSleepMinutes", "total-sleep-minutes"],
  ["sleepEfficiency", "sleep-efficiency"],
  ["deepMinutes", "deep-sleep-minutes"],
  ["lightMinutes", "sleep-light-minutes"],
  ["remMinutes", "rem-sleep-minutes"],
]);
const INVALID_ZERO_SLEEP_METRICS = new Set<string>(INVALID_ZERO_SLEEP_METRIC_SUPPRESSION_KEYS.keys());
const SPARSE_BODY_OBSERVATION_METRICS = new Set<WearableMetricKey>([
  "bmi",
  "bodyFatPercentage",
  "leanBodyMassKg",
  "waistCircumference",
  "weightKg",
]);

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
    // Manual observations remain their own canonical metric evidence. Letting
    // the wearable resolver absorb them can suppress the raw manual point when
    // a device summary exists for the same day.
    if (provider === "manual") {
      continue;
    }
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
  const sanitizedMetricCandidates = sanitizeWearableMetricCandidates(rawMetricCandidates, dedupedSleepWindows);
  const metricCandidates = [
    ...dedupeExactMetricCandidates(sanitizedMetricCandidates.candidates).candidates,
    ...dedupeExactMetricCandidates(sleepStageAggregates).candidates,
  ].sort(compareMetricCandidateByDateDesc);

  return {
    activitySessionCandidates: activitySessions,
    activitySessionAggregates: buildActivitySessionAggregates(activitySessions),
    activitySessionDayRollups: buildActivitySessionDayRollups(activitySessions),
    metricSuppressionEvidence: sanitizedMetricCandidates.suppressionEvidence,
    metricCandidates,
    provenanceDiagnostics: [...provenanceDiagnostics.values()].sort(compareWearableProvenanceDiagnostics),
    rawMetricCandidates,
    sleepWindows: filteredSleepWindows,
  };
}

function sanitizeWearableMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
  sleepWindows: readonly WearableSleepWindowCandidate[],
): {
  candidates: WearableMetricCandidate[];
  suppressionEvidence: WearableMetricSuppressionEvidence[];
} {
  const invalidCandidates = collectInvalidAppleZeroSleepMetricCandidates(candidates, sleepWindows);
  const invalidRecordIds = new Set(invalidCandidates.flatMap((candidate) => candidate.recordIds));

  return {
    candidates: candidates.filter((candidate) => !candidate.recordIds.some((recordId) => invalidRecordIds.has(recordId))),
    suppressionEvidence: buildMetricSuppressionEvidence(invalidCandidates),
  };
}

function collectInvalidAppleZeroSleepMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
  sleepWindows: readonly WearableSleepWindowCandidate[],
): WearableMetricCandidate[] {
  const invalidCandidates: WearableMetricCandidate[] = [];

  for (const window of sleepWindows) {
    if (resolveSleepCandidateProvider(window) !== APPLE_HEALTH_KIT_PROVIDER) {
      continue;
    }

    const windowCandidates = candidates.filter((candidate) => sleepMetricAssociatedWithWindow(candidate, window));
    const awakeMinutes = firstPositiveMetricValue(windowCandidates, "awakeMinutes");
    const invalidZeroTotalCandidates = windowCandidates.filter((candidate) =>
      candidate.metric === "totalSleepMinutes" &&
      candidate.value === 0 &&
      isInvalidZeroSleepSummaryOwnedCandidate(candidate, window)
    );
    if (
      invalidZeroTotalCandidates.length === 0 ||
      awakeMinutes === null ||
      window.durationMinutes <= awakeMinutes + 1
    ) {
      continue;
    }

    invalidCandidates.push(
      ...windowCandidates.filter((candidate) =>
        INVALID_ZERO_SLEEP_METRICS.has(candidate.metric) &&
        candidate.value === 0 &&
        (
          isInvalidZeroSleepSummaryOwnedCandidate(candidate, window) ||
          isLegacyInvalidZeroSleepSummaryCompanion(candidate, invalidZeroTotalCandidates)
        )
      ),
    );
  }

  const invalidRecordIds = new Set<string>();
  return invalidCandidates.filter((candidate) => {
    const unseenRecordIds = candidate.recordIds.filter((recordId) => !invalidRecordIds.has(recordId));
    for (const recordId of unseenRecordIds) {
      invalidRecordIds.add(recordId);
    }
    return unseenRecordIds.length > 0;
  });
}

function buildMetricSuppressionEvidence(
  invalidCandidates: readonly WearableMetricCandidate[],
): WearableMetricSuppressionEvidence[] {
  const evidence = new Map<string, { date: string; metricKey: string; recordIds: string[] }>();

  for (const candidate of invalidCandidates) {
    const metricKey = INVALID_ZERO_SLEEP_METRIC_SUPPRESSION_KEYS.get(candidate.metric as WearableMetricKey);
    if (!metricKey) {
      continue;
    }

    const key = `${candidate.date}\0${metricKey}`;
    const existing = evidence.get(key) ?? {
      date: candidate.date,
      metricKey,
      recordIds: [],
    };
    existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
    evidence.set(key, existing);
  }

  return [...evidence.values()];
}

function isInvalidZeroSleepSummaryOwnedCandidate(
  candidate: WearableMetricCandidate,
  window: WearableSleepWindowCandidate,
): boolean {
  const normalizerVersion = normalizeResourceToken(candidate.dataOrigin?.normalizerVersion);
  if (normalizerVersion === JUNCTION_SLEEP_STAGE_CYCLE_FALLBACK_NORMALIZER_VERSION) {
    return false;
  }

  return sleepMetricMatchesWindow(candidate, window) ||
    normalizerVersion === JUNCTION_SLEEP_STAGE_SUMMARY_NORMALIZER_VERSION;
}

function isLegacyInvalidZeroSleepSummaryCompanion(
  candidate: WearableMetricCandidate,
  invalidZeroTotalCandidates: readonly WearableMetricCandidate[],
): boolean {
  if (normalizeResourceToken(candidate.dataOrigin?.normalizerVersion)) {
    return false;
  }

  return invalidZeroTotalCandidates.some((totalCandidate) =>
    candidate.provider === totalCandidate.provider &&
    wearableDataOriginKey(candidate.dataOrigin) === wearableDataOriginKey(totalCandidate.dataOrigin) &&
    candidate.recordedAt === totalCandidate.recordedAt
  );
}

function firstPositiveMetricValue(
  candidates: readonly WearableMetricCandidate[],
  metric: WearableMetricKey,
): number | null {
  return candidates.find((candidate) => candidate.metric === metric && candidate.value > 0)?.value ?? null;
}

export function buildActivitySessionAggregates(
  candidates: readonly WearableMetricCandidate[],
): WearableActivitySessionAggregate[] {
  return aggregateActivitySessionCandidates(
    dedupeExactActivitySessionCandidates(
      [...candidates].sort(compareActivitySessionCandidate),
    ),
    (candidate) => `${candidate.date}:${candidate.provider}:${wearableDataOriginKey(candidate.dataOrigin)}`,
    "activity-session-aggregate",
  );
}

export function buildActivitySessionDayRollups(
  candidates: readonly WearableMetricCandidate[],
): WearableActivitySessionAggregate[] {
  const candidatesByDate = new Map<string, WearableMetricCandidate[]>();
  for (const candidate of candidates) {
    const dateCandidates = candidatesByDate.get(candidate.date) ?? [];
    dateCandidates.push(candidate);
    candidatesByDate.set(candidate.date, dateCandidates);
  }

  return [...candidatesByDate.entries()]
    .flatMap(([date, dateCandidates]) => {
      const dedupedCandidates = dedupeActivitySessionCandidates(dateCandidates);
      return aggregateActivitySessionCandidates(
        dedupedCandidates,
        () => date,
        "activity-session-day-rollup",
      ).map((rollup) =>
        projectActivitySessionDayRollupSource(rollup, dedupedCandidates)
      );
    })
    .sort(compareAggregateByDateDesc);
}

function aggregateActivitySessionCandidates(
  candidates: readonly WearableMetricCandidate[],
  groupKey: (candidate: WearableMetricCandidate) => string,
  aggregateKind: "activity-session-aggregate" | "activity-session-day-rollup",
): WearableActivitySessionAggregate[] {
  const grouped = new Map<string, WearableActivitySessionAggregate>();

  for (const candidate of [...candidates].sort(compareActivitySessionCandidate)) {
    const key = groupKey(candidate);
    const activityType = candidate.activityType ?? null;
    const heartRateZones = candidate.heartRateZones ?? [];
    const candidateProvider = resolveActivitySessionCandidatePublicProvider(candidate);
    const candidateWorkoutMetrics = activitySessionCandidateWorkoutMetricEvidence(candidate);
    const existing = grouped.get(key);
    if (existing) {
      existing.paths = uniqueStrings([...existing.paths, ...candidate.paths]);
      existing.recordIds = uniqueStrings([...existing.recordIds, ...candidate.recordIds]);
      existing.heartRateZones = aggregateKind === "activity-session-day-rollup"
        ? mergeHeartRateZoneAggregates([
            ...existing.heartRateZones,
            ...heartRateZones,
          ], true)
        : mergeHeartRateZoneAggregates([
            ...existing.heartRateZones,
            ...heartRateZones,
          ]);
      existing.sessionMinutes += candidate.value;
      existing.sessionCount += 1;
      existing.sessionContributors = uniqueStrings([
        ...existing.sessionContributors,
        candidateProvider,
      ]).sort();
      existing.workoutMetricKeys = uniqueStrings([
        ...existing.workoutMetricKeys,
        ...(candidate.workoutMetricKeys ?? []),
      ]).sort();
      const mergedWorkoutMetrics = mergeDistinctActivitySessionWorkoutMetricEvidence({
        contributors: existing.workoutMetricContributors,
        values: existing.workoutMetricValues,
      }, candidateWorkoutMetrics);
      existing.workoutMetricContributors = mergedWorkoutMetrics.contributors;
      existing.workoutMetricValues = mergedWorkoutMetrics.values;
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
        ...(aggregateKind === "activity-session-aggregate"
          ? [wearableDataOriginKey(candidate.dataOrigin)]
          : []),
        candidate.date,
        aggregateKind,
      ]),
      dataOrigin: candidate.dataOrigin ?? null,
      date: candidate.date,
      heartRateZones: aggregateKind === "activity-session-day-rollup"
        ? mergeHeartRateZoneAggregates(heartRateZones, true)
        : mergeHeartRateZoneAggregates(heartRateZones),
      paths: [...candidate.paths],
      provider: candidate.provider,
      recordedAt: candidate.recordedAt,
      recordIds: [...candidate.recordIds],
      sessionContributors: [candidateProvider],
      sessionCount: 1,
      sessionMinutes: candidate.value,
      sourceKind: aggregateKind,
      workoutMetricContributors: candidateWorkoutMetrics.contributors,
      workoutMetricKeys: uniqueStrings(candidate.workoutMetricKeys ?? []).sort(),
      workoutMetricValues: candidateWorkoutMetrics.values,
    });
  }

  return [...grouped.values()]
    .map((aggregate) => ({
      ...aggregate,
      candidateId: buildCandidateId([
        aggregate.provider,
        aggregate.date,
        aggregateKind,
        ...[...aggregate.recordIds].sort(),
      ]),
    }))
    .sort(compareAggregateByDateDesc);
}

function dedupeActivitySessionCandidates(
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate[] {
  const deduped: WearableMetricCandidate[] = [];
  const orderedCandidates = [...candidates].sort(compareActivitySessionCandidate);
  // Collapse immutable identities before greedy overlap can merge one into an
  // identity-less representation and strand another copy of the same resource.
  const stableIdentityCandidates =
    dedupeStableIdentityActivitySessionCandidates(orderedCandidates)
      .sort(compareActivitySessionCandidate);

  for (
    const candidate of dedupeExactActivitySessionCandidates(stableIdentityCandidates)
      .sort(compareActivitySessionCandidate)
  ) {
    const duplicateIndex = deduped.findIndex((existing) =>
      activitySessionCandidatesRepresentSameWorkout(existing, candidate)
    );
    if (duplicateIndex < 0) {
      deduped.push(cloneActivitySessionCandidate(candidate));
      continue;
    }

    deduped[duplicateIndex] = mergeMirroredActivitySessionCandidates(
      deduped[duplicateIndex]!,
      candidate,
    );
  }

  return deduped;
}

function dedupeStableIdentityActivitySessionCandidates(
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate[] {
  const deduped: WearableMetricCandidate[] = [];
  const candidateIndexByStableIdentity = new Map<string, number>();

  for (const candidate of candidates) {
    const stableIdentity = buildActivitySessionStableResourceIdentity(candidate);
    if (!stableIdentity) {
      deduped.push(cloneActivitySessionCandidate(candidate));
      continue;
    }

    const duplicateIndex = candidateIndexByStableIdentity.get(stableIdentity);
    if (duplicateIndex === undefined) {
      candidateIndexByStableIdentity.set(
        stableIdentity,
        deduped.push(cloneActivitySessionCandidate(candidate)) - 1,
      );
      continue;
    }

    deduped[duplicateIndex] = mergeMirroredActivitySessionCandidates(
      deduped[duplicateIndex]!,
      candidate,
    );
  }

  return deduped;
}

function dedupeExactActivitySessionCandidates(
  candidates: readonly WearableMetricCandidate[],
): WearableMetricCandidate[] {
  const deduped: WearableMetricCandidate[] = [];
  const candidateIndexesByExactKey = new Map<string, number[]>();

  for (const candidate of candidates) {
    const exactKey = activitySessionCandidateReconciliationExactKey(candidate);
    const candidateIndexes = candidateIndexesByExactKey.get(exactKey) ?? [];
    const duplicateIndex = candidateIndexes.find((index) => {
      const existing = deduped[index];
      return existing !== undefined
        && (
          activitySessionCandidatesShareStableIdentity(existing, candidate)
          || activitySessionTypesCompatible(existing.activityType, candidate.activityType)
        );
    });
    if (duplicateIndex === undefined) {
      const nextIndex = deduped.push(cloneActivitySessionCandidate(candidate)) - 1;
      candidateIndexes.push(nextIndex);
      candidateIndexesByExactKey.set(exactKey, candidateIndexes);
      continue;
    }

    deduped[duplicateIndex] = mergeMirroredActivitySessionCandidates(
      deduped[duplicateIndex]!,
      candidate,
    );
  }

  return deduped;
}

function activitySessionCandidatesRepresentSameWorkout(
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): boolean {
  if (left.date !== right.date) {
    return false;
  }

  if (activitySessionCandidatesShareStableIdentity(left, right)) {
    return true;
  }

  if (!activitySessionTypesCompatible(left.activityType, right.activityType)) {
    return false;
  }

  const leftWindow = activitySessionCandidateWindow(left);
  const rightWindow = activitySessionCandidateWindow(right);
  if (!leftWindow || !rightWindow) {
    return false;
  }

  const overlapMs =
    Math.min(leftWindow.endMs, rightWindow.endMs)
    - Math.max(leftWindow.startMs, rightWindow.startMs);
  return overlapMs > 0
    && overlapMs / Math.max(leftWindow.durationMs, rightWindow.durationMs)
      >= ACTIVITY_SESSION_DUPLICATE_MIN_OVERLAP_RATIO;
}

function activitySessionCandidatesShareStableIdentity(
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): boolean {
  const leftResourceIdentity = buildActivitySessionStableResourceIdentity(left);
  const rightResourceIdentity = buildActivitySessionStableResourceIdentity(right);
  return leftResourceIdentity !== null && leftResourceIdentity === rightResourceIdentity;
}

export function buildActivitySessionStableResourceIdentity(
  candidate: WearableMetricCandidate,
): string | null {
  const resourceType = normalizeResourceToken(candidate.externalRef?.resourceType);
  const resourceId = normalizeNullableString(candidate.externalRef?.resourceId);
  if (!resourceType || !resourceId) {
    return null;
  }

  return JSON.stringify([
    resolveActivitySessionCandidatePublicProvider(candidate),
    resourceType,
    resourceId,
    normalizeResourceToken(candidate.externalRef?.facet) ?? "",
  ]);
}

function resolveActivitySessionCandidatePublicProvider(
  candidate: WearableMetricCandidate,
): string {
  return resolveWearablePublicSourceProvider({
    dataOrigin: candidate.dataOrigin ?? null,
    externalRef: candidate.externalRef,
    provider: candidate.provider,
  }, {
    suppressJunctionSourceInstanceFallback: true,
  });
}

function activitySessionTypesCompatible(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeActivityKindToken(left);
  const normalizedRight = normalizeActivityKindToken(right);
  if (
    !normalizedLeft
    || !normalizedRight
    || GENERIC_ACTIVITY_SESSION_TYPES.has(normalizedLeft)
    || GENERIC_ACTIVITY_SESSION_TYPES.has(normalizedRight)
  ) {
    return true;
  }

  return activityTextMatchesKind(normalizedLeft, normalizedRight)
    || activityTextMatchesKind(normalizedRight, normalizedLeft);
}

function activitySessionCandidateWindow(
  candidate: WearableMetricCandidate,
): { durationMs: number; endMs: number; startMs: number } | null {
  const timestamps = activitySessionCandidateReconciliationTimestamps(candidate);
  const startMs = parseIsoTimestampMs(timestamps.startedAt);
  const durationMs = candidate.value * 60 * 1_000;
  if (startMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  const explicitEndMs = parseIsoTimestampMs(timestamps.endedAt);
  const endMs = explicitEndMs ?? startMs + durationMs;
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  return {
    durationMs: endMs - startMs,
    endMs,
    startMs,
  };
}

export function activitySessionCandidateReconciliationTimestamps(
  candidate: WearableMetricCandidate,
): { endedAt: string | null; startedAt: string | null } {
  const startedAt = parseIsoTimestampMs(candidate.sessionStartAt) === null
    ? candidate.occurredAt
    : candidate.sessionStartAt;
  const startMs = parseIsoTimestampMs(startedAt);
  if (startMs === null) {
    return {
      endedAt: null,
      startedAt: null,
    };
  }

  const endMs = parseIsoTimestampMs(candidate.sessionEndAt);
  return {
    endedAt: endMs !== null && endMs > startMs
      ? candidate.sessionEndAt ?? null
      : null,
    startedAt: startedAt ?? null,
  };
}

function parseIsoTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeMirroredActivitySessionCandidates(
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): WearableMetricCandidate {
  const preferred = choosePreferredActivitySessionCandidate(left, right);
  const secondary = preferred === left ? right : left;
  const timestamps = mergeActivitySessionCandidateTimestamps(preferred, secondary);
  const workoutMetrics = mergeMirroredActivitySessionWorkoutMetricEvidence(
    preferred,
    secondary,
  );

  return {
    ...cloneActivitySessionCandidate(preferred),
    activityType: selectPreferredActivitySessionType(preferred, secondary),
    heartRateZones: mergeMirroredActivitySessionHeartRateZones(preferred, secondary),
    paths: uniqueStrings([...left.paths, ...right.paths]),
    recordedAt: latestIsoTimestamp([left.recordedAt, right.recordedAt]),
    recordIds: uniqueStrings([...left.recordIds, ...right.recordIds]),
    sessionEndAt: timestamps.endedAt,
    sessionStartAt: timestamps.startedAt,
    workoutMetricKeys: uniqueStrings([
      ...(left.workoutMetricKeys ?? []),
      ...(right.workoutMetricKeys ?? []),
    ]).sort(),
    workoutMetricContributors: workoutMetrics.contributors,
    workoutMetricValues: workoutMetrics.values,
  };
}

function mergeActivitySessionCandidateTimestamps(
  preferred: WearableMetricCandidate,
  secondary: WearableMetricCandidate,
): { endedAt: string | null; startedAt: string | null } {
  const preferredTimestamps = activitySessionCandidateReconciliationTimestamps(preferred);
  if (activitySessionCandidateWindow(preferred)) {
    return preferredTimestamps;
  }

  const secondaryWindow = activitySessionCandidateWindow(secondary);
  if (
    secondaryWindow
    && activitySessionWindowMatchesDeclaredDuration(secondaryWindow, preferred.value)
  ) {
    return activitySessionCandidateReconciliationTimestamps(secondary);
  }

  return preferredTimestamps;
}

function choosePreferredActivitySessionCandidate(
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): WearableMetricCandidate {
  return compareActivitySessionCandidateReconciliationEvidence(left, right) <= 0
    ? left
    : right;
}

function compareActivitySessionCandidateReconciliationEvidence(
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): number {
  return Number(activitySessionCandidateDurationIsConsistent(right))
    - Number(activitySessionCandidateDurationIsConsistent(left))
    || activitySessionCandidateCoverageDurationMs(right)
      - activitySessionCandidateCoverageDurationMs(left)
    || right.value - left.value
    || activitySessionCandidateCompletenessScore(right)
      - activitySessionCandidateCompletenessScore(left)
    || (parseIsoTimestampMs(right.recordedAt) ?? 0)
      - (parseIsoTimestampMs(left.recordedAt) ?? 0)
    || activitySessionCandidatePublicEvidenceSignature(left)
      .localeCompare(activitySessionCandidatePublicEvidenceSignature(right))
    || activitySessionCandidateReconciliationExactKey(left)
      .localeCompare(activitySessionCandidateReconciliationExactKey(right))
    || left.candidateId.localeCompare(right.candidateId);
}

function activitySessionCandidateReconciliationExactKey(
  candidate: WearableMetricCandidate,
): string {
  return candidate.reconciliationExactKey ?? buildCandidateExactKey(candidate);
}

function activitySessionCandidateCoverageDurationMs(candidate: WearableMetricCandidate): number {
  return activitySessionCandidateWindow(candidate)?.durationMs
    ?? candidate.value * 60 * 1_000;
}

export function activitySessionCandidateDurationIsConsistent(
  candidate: WearableMetricCandidate,
): boolean {
  if (candidate.reconciliationDurationConsistent !== undefined) {
    return candidate.reconciliationDurationConsistent;
  }

  const timestamps = activitySessionCandidateReconciliationTimestamps(candidate);
  if (
    candidate.sessionEndAt !== null
    && candidate.sessionEndAt !== undefined
    && timestamps.endedAt === null
  ) {
    return false;
  }

  const window = activitySessionCandidateWindow(candidate);
  return Boolean(
    window
    && activitySessionWindowMatchesDeclaredDuration(window, candidate.value),
  );
}

function activitySessionWindowMatchesDeclaredDuration(
  window: { durationMs: number },
  durationMinutes: number,
): boolean {
  const declaredDurationMs = durationMinutes * 60 * 1_000;
  if (!Number.isFinite(declaredDurationMs) || declaredDurationMs <= 0) {
    return false;
  }

  const differenceMs = Math.abs(window.durationMs - declaredDurationMs);
  const relativeToleranceMs =
    Math.max(window.durationMs, declaredDurationMs)
    * ACTIVITY_SESSION_DURATION_CONSISTENCY_RELATIVE_TOLERANCE;
  return differenceMs <= Math.max(
    ACTIVITY_SESSION_DURATION_CONSISTENCY_ABSOLUTE_TOLERANCE_MS,
    relativeToleranceMs,
  );
}

function activitySessionCandidateCompletenessScore(candidate: WearableMetricCandidate): number {
  const timestamps = activitySessionCandidateReconciliationTimestamps(candidate);
  return (candidate.activityType ? 1 : 0)
    + (timestamps.startedAt === null ? 0 : 1)
    + (timestamps.endedAt === null ? 0 : 1)
    + (candidate.heartRateZones?.length ?? 0)
    + (candidate.workoutMetricKeys?.length ?? 0);
}

function selectPreferredActivitySessionType(
  preferred: WearableMetricCandidate,
  secondary: WearableMetricCandidate,
): string | null {
  const preferredType = normalizeActivityKindToken(preferred.activityType);
  const secondaryType = normalizeActivityKindToken(secondary.activityType);
  if (
    (!preferredType || GENERIC_ACTIVITY_SESSION_TYPES.has(preferredType))
    && secondaryType
    && !GENERIC_ACTIVITY_SESSION_TYPES.has(secondaryType)
  ) {
    return secondary.activityType ?? null;
  }

  return preferred.activityType ?? secondary.activityType ?? null;
}

function activitySessionCandidatePublicEvidenceSignature(
  candidate: WearableMetricCandidate,
): string {
  const timestamps = activitySessionCandidateReconciliationTimestamps(candidate);
  return JSON.stringify([
    resolveActivitySessionCandidatePublicProvider(candidate),
    candidate.activityType ?? null,
    timestamps.startedAt,
    timestamps.endedAt,
    mergeHeartRateZoneAggregates(candidate.heartRateZones ?? []).map((zone) => [
      zone.zone ?? null,
      zone.label ?? null,
      zone.minHeartRate ?? null,
      zone.maxHeartRate ?? null,
      zone.durationMinutes,
    ]),
    ACTIVITY_SESSION_WORKOUT_METRIC_SPECS.map(({ metric }) =>
      candidate.workoutMetricValues?.[metric] ?? null
    ),
  ]);
}

function mergeMirroredActivitySessionHeartRateZones(
  preferred: WearableMetricCandidate,
  secondary: WearableMetricCandidate,
): WearableHeartRateZoneAggregate[] {
  const merged = (preferred.heartRateZones ?? []).map((zone) => ({ ...zone }));

  for (const secondaryZone of secondary.heartRateZones ?? []) {
    const duplicateIndex = merged.findIndex((preferredZone) =>
      activitySessionHeartRateZonesRepresentSameZone(preferredZone, secondaryZone)
    );
    if (duplicateIndex < 0) {
      merged.push({ ...secondaryZone });
      continue;
    }

    const mergedZone = merged[duplicateIndex]!;
    mergedZone.label ??= secondaryZone.label;
    mergedZone.maxHeartRate ??= secondaryZone.maxHeartRate;
    mergedZone.minHeartRate ??= secondaryZone.minHeartRate;
    mergedZone.zone ??= secondaryZone.zone;
  }

  return merged;
}

function activitySessionHeartRateZonesRepresentSameZone(
  left: WearableHeartRateZoneAggregate,
  right: WearableHeartRateZoneAggregate,
): boolean {
  if (left.zone !== undefined && right.zone !== undefined) {
    return left.zone === right.zone;
  }

  const leftLabel = normalizeActivityKindToken(left.label);
  const rightLabel = normalizeActivityKindToken(right.label);
  if (leftLabel && rightLabel) {
    return leftLabel === rightLabel;
  }

  return left.minHeartRate !== undefined
    && right.minHeartRate !== undefined
    && left.maxHeartRate !== undefined
    && right.maxHeartRate !== undefined
    && left.minHeartRate === right.minHeartRate
    && left.maxHeartRate === right.maxHeartRate;
}

interface ActivitySessionWorkoutMetricEvidence {
  contributors: WearableActivitySessionMetricContributors;
  values: WearableActivitySessionMetricValues;
}

interface SelectedActivitySessionWorkoutMetric {
  contributors: string[];
  value: number | undefined;
}

type ActivitySessionWorkoutMetricMergeMode = "maximum" | "prefer-left" | "sum";

function activitySessionCandidateWorkoutMetricEvidence(
  candidate: WearableMetricCandidate,
): ActivitySessionWorkoutMetricEvidence {
  const values = candidate.workoutMetricValues ?? {};
  const provider = resolveActivitySessionCandidatePublicProvider(candidate);
  const evidence: ActivitySessionWorkoutMetricEvidence = {
    contributors: {},
    values: { ...values },
  };

  for (const { metric } of ACTIVITY_SESSION_WORKOUT_METRIC_SPECS) {
    if (values[metric] === undefined) {
      continue;
    }
    const contributors = candidate.workoutMetricContributors?.[metric];
    evidence.contributors[metric] = mergeWorkoutMetricContributors(
      contributors?.length ? contributors : [provider],
    );
  }

  return evidence;
}

function mergeMirroredActivitySessionWorkoutMetricEvidence(
  preferred: WearableMetricCandidate,
  secondary: WearableMetricCandidate,
): ActivitySessionWorkoutMetricEvidence {
  return mergeActivitySessionWorkoutMetricEvidence(
    activitySessionCandidateWorkoutMetricEvidence(preferred),
    activitySessionCandidateWorkoutMetricEvidence(secondary),
    "prefer-left",
  );
}

function mergeDistinctActivitySessionWorkoutMetricEvidence(
  left: ActivitySessionWorkoutMetricEvidence,
  right: ActivitySessionWorkoutMetricEvidence,
): ActivitySessionWorkoutMetricEvidence {
  return mergeActivitySessionWorkoutMetricEvidence(left, right, "sum");
}

function mergeActivitySessionWorkoutMetricEvidence(
  left: ActivitySessionWorkoutMetricEvidence,
  right: ActivitySessionWorkoutMetricEvidence,
  additiveMode: Exclude<ActivitySessionWorkoutMetricMergeMode, "maximum">,
): ActivitySessionWorkoutMetricEvidence {
  const merged: ActivitySessionWorkoutMetricEvidence = {
    contributors: {},
    values: {},
  };
  for (const spec of ACTIVITY_SESSION_WORKOUT_METRIC_SPECS) {
    const { metric } = spec;
    const selected = selectWorkoutMetric(
      metric,
      left,
      right,
      spec.reducer === "maximum" ? "maximum" : additiveMode,
    );
    if (selected.value !== undefined) {
      merged.contributors[metric] = selected.contributors;
      merged.values[metric] = selected.value;
    }
  }
  return merged;
}

function selectWorkoutMetric(
  metric: WearableActivitySessionWorkoutMetricKey,
  left: ActivitySessionWorkoutMetricEvidence,
  right: ActivitySessionWorkoutMetricEvidence,
  mode: ActivitySessionWorkoutMetricMergeMode,
): SelectedActivitySessionWorkoutMetric {
  const leftValue = left.values[metric];
  const rightValue = right.values[metric];
  if (leftValue === undefined) {
    return selectedWorkoutMetric(metric, right);
  }
  if (rightValue === undefined) {
    return selectedWorkoutMetric(metric, left);
  }
  if (mode === "sum") {
    return {
      contributors: mergeWorkoutMetricContributors(
        left.contributors[metric],
        right.contributors[metric],
      ),
      value: leftValue + rightValue,
    };
  }
  if (leftValue !== rightValue) {
    return mode === "maximum" && rightValue > leftValue
      ? selectedWorkoutMetric(metric, right)
      : selectedWorkoutMetric(metric, left);
  }

  return {
    contributors: mergeWorkoutMetricContributors(
      left.contributors[metric],
      right.contributors[metric],
    ),
    value: leftValue,
  };
}

function selectedWorkoutMetric(
  metric: WearableActivitySessionWorkoutMetricKey,
  evidence: ActivitySessionWorkoutMetricEvidence,
): SelectedActivitySessionWorkoutMetric {
  return {
    contributors: mergeWorkoutMetricContributors(evidence.contributors[metric]),
    value: evidence.values[metric],
  };
}

function mergeWorkoutMetricContributors(
  ...contributorLists: Array<readonly string[] | undefined>
): string[] {
  return uniqueStrings(contributorLists.flatMap((contributors) => contributors ?? [])).sort();
}

function cloneActivitySessionCandidate(
  candidate: WearableMetricCandidate,
): WearableMetricCandidate {
  return {
    ...candidate,
    heartRateZones: candidate.heartRateZones?.map((zone) => ({ ...zone })),
    paths: [...candidate.paths],
    recordIds: [...candidate.recordIds],
    workoutMetricContributors: cloneActivitySessionWorkoutMetricContributors(
      candidate.workoutMetricContributors,
    ),
    workoutMetricKeys: candidate.workoutMetricKeys ? [...candidate.workoutMetricKeys] : undefined,
    workoutMetricValues: candidate.workoutMetricValues
      ? { ...candidate.workoutMetricValues }
      : undefined,
  };
}

function cloneActivitySessionWorkoutMetricContributors(
  contributors: WearableActivitySessionMetricContributors | undefined,
): WearableActivitySessionMetricContributors | undefined {
  if (!contributors) {
    return undefined;
  }

  const cloned: WearableActivitySessionMetricContributors = {};
  for (const { metric } of ACTIVITY_SESSION_WORKOUT_METRIC_SPECS) {
    const values = contributors[metric];
    if (values) {
      cloned[metric] = [...values];
    }
  }
  return cloned;
}

function compareActivitySessionCandidate(
  left: WearableMetricCandidate,
  right: WearableMetricCandidate,
): number {
  const leftStart = parseIsoTimestampMs(
    activitySessionCandidateReconciliationTimestamps(left).startedAt,
  ) ?? Number.MAX_SAFE_INTEGER;
  const rightStart = parseIsoTimestampMs(
    activitySessionCandidateReconciliationTimestamps(right).startedAt,
  ) ?? Number.MAX_SAFE_INTEGER;
  return right.date.localeCompare(left.date)
    || leftStart - rightStart
    || compareActivitySessionCandidateReconciliationEvidence(left, right);
}

function projectActivitySessionDayRollupSource(
  rollup: WearableActivitySessionAggregate,
  candidates: readonly WearableMetricCandidate[],
): WearableActivitySessionAggregate {
  const publicProviders = uniqueStrings(candidates.map((candidate) =>
    resolveActivitySessionCandidatePublicProvider(candidate)
  ));
  if (publicProviders.length <= 1) {
    return rollup;
  }

  return {
    ...rollup,
    candidateId: buildCandidateId([
      "multiple",
      rollup.date,
      "activity-session-day-rollup",
      ...[...rollup.recordIds].sort(),
    ]),
    dataOrigin: null,
    provider: "multiple",
  };
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
  const provider = resolveActivitySessionContributorProvider(
    aggregate.sessionContributors,
    aggregate.provider,
  );
  return {
    candidateId: `${aggregate.candidateId}:${metric}`,
    dataOrigin: provider === aggregate.provider ? aggregate.dataOrigin ?? null : null,
    date: aggregate.date,
    externalRef: null,
    metric,
    occurredAt: null,
    paths: [...aggregate.paths],
    provider,
    recordedAt: aggregate.recordedAt,
    recordIds: [...aggregate.recordIds],
    sourceFamily: "derived",
    sourceKind: aggregate.sourceKind,
    title: `${formatProviderName(provider)} activity sessions`,
    unit: metric === "sessionMinutes" ? "minutes" : "count",
    value: metric === "sessionMinutes" ? aggregate.sessionMinutes : aggregate.sessionCount,
  };
}

function resolveActivitySessionContributorProvider(
  contributors: readonly string[] | undefined,
  fallbackProvider: string,
): string {
  const normalizedContributors = uniqueStrings(contributors ?? []).sort();
  if (normalizedContributors.length === 0) {
    return fallbackProvider;
  }
  return normalizedContributors.length === 1
    ? normalizedContributors[0]!
    : "multiple";
}

export function buildActivitySessionWorkoutMetricCandidates(
  aggregate: WearableActivitySessionAggregate,
): WearableMetricCandidate[] {
  return ACTIVITY_SESSION_WORKOUT_METRIC_SPECS.flatMap((spec) => {
    const value = aggregate.workoutMetricValues?.[spec.metric];
    if (value === undefined) {
      return [];
    }

    const provider = resolveActivitySessionContributorProvider(
      aggregate.workoutMetricContributors?.[spec.metric],
      aggregate.provider,
    );
    return [{
      candidateId: `${aggregate.candidateId}:${spec.metric}`,
      dataOrigin: provider === aggregate.provider ? aggregate.dataOrigin ?? null : null,
      date: aggregate.date,
      externalRef: null,
      metric: spec.metric,
      occurredAt: null,
      paths: [...aggregate.paths],
      provider,
      recordedAt: aggregate.recordedAt,
      recordIds: [...aggregate.recordIds],
      sourceFamily: "derived",
      sourceKind: aggregate.sourceKind,
      title: `${formatProviderName(provider)} activity sessions`,
      unit: spec.unit,
      value,
    }];
  });
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
  selection: WearableMetricSelection,
): string[] {
  const selected = resolveSelectedActivitySessionAggregate(aggregates, selection);
  return selected?.activityTypes ?? [];
}

export function resolveSelectedHeartRateZones(
  aggregates: readonly WearableActivitySessionAggregate[],
  selection: WearableMetricSelection,
): WearableHeartRateZoneAggregate[] {
  const selected = resolveSelectedActivitySessionAggregate(aggregates, selection);
  return selected ? selected.heartRateZones.map((zone) => ({ ...zone })) : [];
}

export function resolveSelectedActivitySessionAggregate(
  aggregates: readonly WearableActivitySessionAggregate[],
  selection: WearableMetricSelection,
): WearableActivitySessionAggregate | null {
  if (
    selection.sourceFamily !== "derived"
    || (
      selection.sourceKind !== "activity-session-aggregate"
      && selection.sourceKind !== "activity-session-day-rollup"
    )
    || !selection.provider
    || selection.recordIds.length === 0
  ) {
    return null;
  }

  const selectedRecordIds = sortedStrings(selection.recordIds);
  return aggregates.find((aggregate) =>
    resolveActivitySessionContributorProvider(
      aggregate.sessionContributors,
      aggregate.provider,
    ) === selection.provider
    && equalSortedStrings(sortedStrings(aggregate.recordIds), selectedRecordIds)
  ) ?? null;
}

function sortedStrings(values: readonly string[]): string[] {
  return uniqueStrings(values).sort();
}

function equalSortedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

  const dataOrigin = readWearableDataOrigin(entity.attributes.dataOrigin, externalRef);
  if (
    rawMetric === "hrv"
    && normalizeWearableOriginSourceSlug(dataOrigin?.sourceProviderSlug) === APPLE_HEALTH_KIT_PROVIDER
  ) {
    // Historical Junction imports used generic `hrv` for HealthKit's SDNN
    // quantity. The metric-point projection reclassifies those facts as SDNN;
    // do not also promote them into the RMSSD-only wearable summary field.
    return [];
  }

  const mapped = mapScalarMetric(rawMetric, rawValue, normalizeUnit(entity.attributes.unit));
  if (!mapped) {
    return [];
  }

  // Explicit point observations remain outside day summaries except for the
  // five sparse body measurements. Those facts are naturally day-addressable
  // and must share the same candidate selection owner as curated body rows so
  // mixed provider history is resolved by canonical date and provenance.
  const observationGrain = normalizeLowercaseString(entity.attributes.observationGrain)
    ?.replace(/_/gu, "-");
  const isDaySummaryGrain = !observationGrain || [
    "summary",
    "day",
    "daily-summary",
    "daily-timeseries-aggregate",
  ].includes(observationGrain);
  const isSparseBodySample = observationGrain === "sample"
    && SPARSE_BODY_OBSERVATION_METRICS.has(mapped.metric);

  if (!isDaySummaryGrain && !isSparseBodySample) {
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
  const workout = readPlainRecord(entity.attributes.workout);

  if (durationMinutes === null || !date) {
    return null;
  }

  return {
    ...createMetricCandidateBase(entity, provider, externalRef, date, "event", "activity_session"),
    activityType: resolveActivitySessionActivityType(entity),
    heartRateZones: listWorkoutHeartRateZones(entity.attributes.workout),
    metric: "sessionMinutes",
    sessionEndAt:
      normalizeNullableString(entity.attributes.endAt)
      ?? normalizeNullableString(workout?.endedAt),
    sessionStartAt:
      normalizeNullableString(entity.attributes.startAt)
      ?? normalizeNullableString(workout?.startedAt)
      ?? entity.occurredAt
      ?? null,
    unit: "minutes",
    value: durationMinutes,
    workoutMetricKeys: listWorkoutMetricKeys(entity.attributes.workout),
    workoutMetricValues: readActivitySessionWorkoutMetricValues(entity),
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
  const sleepType = resolveSleepSessionType(entity.attributes.sleepType);

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
    nap: sleepType === "nap",
    occurredAt: entity.occurredAt ?? null,
    paths: [entity.path],
    provider,
    recordedAt: normalizeNullableString(entity.attributes.recordedAt) ?? entity.occurredAt ?? null,
    recordIds: [entity.entityId],
    sourceFamily: "event",
    sourceKind: "sleep_session",
    sleepType,
    startAt: normalizeNullableString(entity.attributes.startAt) ?? entity.occurredAt ?? null,
    timeZone: normalizeNullableString(entity.attributes.timeZone),
    title,
  };
}

function resolveSleepSessionType(value: unknown): "main_sleep" | "nap" | "unknown" {
  return value === "main_sleep" || value === "nap" ? value : "unknown";
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

function readActivitySessionWorkoutMetricValues(
  entity: CanonicalEntity,
): WearableActivitySessionMetricValues {
  const workout = readPlainRecord(entity.attributes.workout);
  const metrics = readPlainRecord(workout?.metrics);
  const activeCalories = firstFiniteNumber(metrics?.activeCalories, entity.attributes.activeCalories);
  const distanceKm = firstFiniteNumber(entity.attributes.distanceKm, metrics?.distanceKm);
  const totalElevationGainMeters = firstFiniteNumber(
    metrics?.totalElevationGainMeters,
    entity.attributes.totalElevationGainMeters,
  );
  const maxHeartRate = firstFiniteNumber(metrics?.maxHeartRate, entity.attributes.maxHeartRate);
  const workoutStrain = firstFiniteNumber(metrics?.workoutStrain, entity.attributes.workoutStrain);

  return {
    ...(activeCalories === undefined ? {} : { activeCalories }),
    ...(distanceKm === undefined ? {} : { distanceKm }),
    ...(maxHeartRate === undefined ? {} : { maxHeartRate }),
    ...(totalElevationGainMeters === undefined ? {} : { totalElevationGainMeters }),
    ...(workoutStrain === undefined ? {} : { workoutStrain }),
  };
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numberValue = readNumber(value);
    if (numberValue !== null) {
      return numberValue;
    }
  }
  return undefined;
}

function readPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
  collapseNumberedZones = false,
): WearableHeartRateZoneAggregate[] {
  const merged = new Map<string, WearableHeartRateZoneAggregate>();

  for (const zone of zones) {
    const key = collapseNumberedZones && zone.zone !== undefined
      ? `zone:${zone.zone}`
      : [
          zone.zone ?? "",
          zone.label ?? "",
          zone.minHeartRate ?? "",
          zone.maxHeartRate ?? "",
        ].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...zone });
      continue;
    }

    existing.durationMinutes += zone.durationMinutes;
    if (collapseNumberedZones && zone.zone !== undefined) {
      for (const field of ["label", "minHeartRate", "maxHeartRate"] as const) {
        if (existing[field] !== zone[field]) {
          delete existing[field];
        }
      }
    }
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
