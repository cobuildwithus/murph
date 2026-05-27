import { extractIsoDatePrefix } from "@murphai/contracts";

import type { VaultReadModel } from "../read-model.ts";
import {
  buildWearableSummaryBundle,
  buildWearableSummaryBundleFromDataset,
  type ProjectedWearableActivitySummary,
  type ProjectedWearableBodyStateSummary,
  type ProjectedWearableRecoverySummary,
  type ProjectedWearableSleepSummary,
  type ProjectedWearableSourceHealthSummary,
  type ProjectedWearableSummaryBundle,
  type WearableMetricSummaryFilters,
  type WearableSummaryBundle,
  type WearableSummaryFilters,
} from "../wearables.ts";
import type {
  WearableActivitySessionAggregate,
  WearableCandidateSourceFamily,
  WearableDataset,
  WearableMetricCandidate,
  WearableResolvedMetric,
  WearableSleepWindowCandidate,
  WearableSourceHealthSummary,
} from "../wearables/types.ts";
import {
  assertQueryProjectionTables,
  expectEnumString,
  expectNullableString,
  expectNumber,
  expectString,
  openQueryProjectionDatabase,
  parseJsonValue,
  type DatabaseSync,
  type QueryProjectionLocation,
  type SqliteRow,
} from "./schema.ts";
import {
  normalizeWearableProviders,
  wearableProviderRowKey,
  wearableProviderRowKeys,
} from "./provider-scope.ts";

const WEARABLE_SUMMARY_PROJECTION_LIMIT = 365;

const QUERY_WEARABLE_SUMMARY_KINDS = [
  "activity",
  "body_state",
  "recovery",
  "sleep",
  "source_health",
] as const;

type QueryWearableSummaryKind = typeof QUERY_WEARABLE_SUMMARY_KINDS[number];

interface QueryWearableSummaryRow {
  id: string;
  providerScopeJson: string;
  providerScopeKey: string;
  sortRank: number;
  summaryDate: string | null;
  summaryJson: string;
  summaryKind: QueryWearableSummaryKind;
}

export function buildWearableSummaryProjection(vault: VaultReadModel): QueryWearableSummaryRow[] {
  const allBundle = buildWearableSummaryBundle(vault);
  const providers = normalizeWearableProviders(allBundle.sourceHealth.map((entry) => entry.provider));

  return providers.flatMap((provider) =>
    materializeWearableSummaryRows(provider, buildWearableSummaryBundle(vault, { providers: [provider] }))
  );
}

export function insertWearableSummaryRows(
  database: DatabaseSync,
  wearableSummaries: readonly QueryWearableSummaryRow[],
): void {
  const insertWearableSummary = database.prepare(`
    INSERT INTO query_wearable_summaries (
      id,
      provider_scope_key,
      provider_scope_json,
      summary_kind,
      summary_date,
      sort_rank,
      summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  wearableSummaries.forEach((row) => {
    insertWearableSummary.run(
      row.id,
      row.providerScopeKey,
      row.providerScopeJson,
      row.summaryKind,
      row.summaryDate,
      row.sortRank,
      row.summaryJson,
    );
  });
}

export function readStoredPublicWearableSummaryBundle(
  location: QueryProjectionLocation,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): ProjectedWearableSummaryBundle {
  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    assertQueryProjectionTables(database, location);

    const readRows = (providerRowKeys: readonly string[] | null) => {
      const parameters = providerRowKeys ? [...providerRowKeys] : [];
      const whereSql = providerRowKeys
        ? `WHERE provider_scope_key IN (${providerRowKeys.map(() => "?").join(", ")})`
        : "";

      return database.prepare(`
        SELECT
          id,
          provider_scope_key AS providerScopeKey,
          provider_scope_json AS providerScopeJson,
          summary_kind AS summaryKind,
          summary_date AS summaryDate,
          sort_rank AS sortRank,
          summary_json AS summaryJson
        FROM query_wearable_summaries
        ${whereSql}
        ORDER BY summary_kind ASC, summary_date DESC, sort_rank ASC
      `).all(...parameters).map(decodeQueryWearableSummaryRow);
    };
    const providers = normalizeWearableProviders(filters.providers);
    const rows = readRows(providers.length > 0 ? wearableProviderRowKeys(providers) : null);

    return providers.length === 1
      ? publicWearableSummaryBundleFromRows(rows, filters)
      : composePublicWearableSummaryBundleFromProviderRows(rows, filters);
  } finally {
    database.close();
  }
}

function materializeWearableSummaryRows(
  provider: string,
  bundle: WearableSummaryBundle,
): QueryWearableSummaryRow[] {
  const rows: QueryWearableSummaryRow[] = [];
  const providerScopeKey = wearableProviderRowKey(provider);
  const providerScopeJson = JSON.stringify([provider]);
  const push = <TSummary extends { date: string }>(
    summaryKind: Exclude<QueryWearableSummaryKind, "source_health">,
    summaries: readonly TSummary[],
  ) => {
    summaries.slice(0, WEARABLE_SUMMARY_PROJECTION_LIMIT).forEach((summary, index) => {
      rows.push({
        id: `${providerScopeKey}:${summaryKind}:${summary.date}:${index}`,
        providerScopeJson,
        providerScopeKey,
        sortRank: index,
        summaryDate: summary.date,
        summaryJson: stringifyPublicWearableProjectionSummary(summary),
        summaryKind,
      });
    });
  };

  push("activity", bundle.activityDays);
  push("body_state", bundle.bodyStateDays);
  push("recovery", bundle.recoveryDays);
  push("sleep", bundle.sleepNights);

  bundle.sourceHealth.forEach((summary, index) => {
    rows.push({
      id: `${providerScopeKey}:source_health:${summary.provider}:${index}`,
      providerScopeJson,
      providerScopeKey,
      sortRank: index,
      summaryDate: summary.lastDate ?? summary.firstDate,
      summaryJson: stringifyPublicWearableProjectionSummary(summary),
      summaryKind: "source_health",
    });
  });

  return rows;
}

function publicWearableSummaryBundleFromRows(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): ProjectedWearableSummaryBundle {
  const bundle: ProjectedWearableSummaryBundle = {
    activityDays: [],
    bodyStateDays: [],
    recoveryDays: [],
    sleepNights: [],
    sourceHealth: [],
  };

  for (const row of rows) {
    switch (row.summaryKind) {
      case "source_health": {
        const summary = parseJsonValue<ProjectedWearableSourceHealthSummary | null>(row.summaryJson, null);
        if (summary && wearableSourceHealthMatchesDateFilters(summary, filters)) {
          bundle.sourceHealth.push(summary);
        }
        break;
      }
      default: {
        if (!wearableSummaryRowMatchesDateFilters(row.summaryDate, filters)) {
          break;
        }

        switch (row.summaryKind) {
          case "activity": {
            const summary = parseJsonValue<ProjectedWearableActivitySummary | null>(row.summaryJson, null);
            if (summary) bundle.activityDays.push(summary);
            break;
          }
          case "body_state": {
            const summary = parseJsonValue<ProjectedWearableBodyStateSummary | null>(row.summaryJson, null);
            if (summary) bundle.bodyStateDays.push(summary);
            break;
          }
          case "recovery": {
            const summary = parseJsonValue<ProjectedWearableRecoverySummary | null>(row.summaryJson, null);
            if (summary) bundle.recoveryDays.push(summary);
            break;
          }
          case "sleep": {
            const summary = parseJsonValue<ProjectedWearableSleepSummary | null>(row.summaryJson, null);
            if (summary) bundle.sleepNights.push(summary);
            break;
          }
        }
      }
    }
  }

  return bundle;
}

function composePublicWearableSummaryBundleFromProviderRows(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): ProjectedWearableSummaryBundle {
  const providerBundle = publicWearableSummaryBundleFromRows(rows, filters);
  const dataset = wearableDatasetFromProjectedBundle(providerBundle);
  const composed = buildWearableSummaryBundleFromDataset(dataset);

  return projectPublicWearableSummaryBundle({
    ...composed,
    sourceHealth: providerBundle.sourceHealth,
  });
}

function wearableDatasetFromProjectedBundle(bundle: ProjectedWearableSummaryBundle): WearableDataset {
  const metricCandidates: WearableMetricCandidate[] = [];
  const activitySessionAggregates: WearableActivitySessionAggregate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];

  for (const summary of bundle.activityDays) {
    metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
      summary.date,
      "activity",
      activityResolvedMetrics(summary),
    ));
    const aggregate = projectedActivitySessionAggregate(summary);
    if (aggregate) {
      activitySessionAggregates.push(aggregate);
    }
  }

  for (const summary of bundle.sleepNights) {
    metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
      summary.date,
      "sleep",
      sleepResolvedMetrics(summary),
    ));
    const window = projectedSleepWindow(summary);
    if (window) {
      sleepWindows.push(window);
    }
  }

  for (const summary of bundle.recoveryDays) {
    metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
      summary.date,
      "recovery",
      recoveryResolvedMetrics(summary),
    ));
  }

  for (const summary of bundle.bodyStateDays) {
    metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
      summary.date,
      "body_state",
      bodyStateResolvedMetrics(summary),
    ));
  }

  return {
    activitySessionAggregates,
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: metricCandidates,
    sleepWindows,
  };
}

function projectPublicWearableSummaryBundle(bundle: WearableSummaryBundle): ProjectedWearableSummaryBundle {
  return {
    activityDays: projectPublicWearableSummaries<ProjectedWearableActivitySummary>(bundle.activityDays),
    bodyStateDays: projectPublicWearableSummaries<ProjectedWearableBodyStateSummary>(bundle.bodyStateDays),
    recoveryDays: projectPublicWearableSummaries<ProjectedWearableRecoverySummary>(bundle.recoveryDays),
    sleepNights: projectPublicWearableSummaries<ProjectedWearableSleepSummary>(bundle.sleepNights),
    sourceHealth: projectPublicWearableSummaries<ProjectedWearableSourceHealthSummary>(bundle.sourceHealth),
  };
}

function projectPublicWearableSummaries<TSummary>(summaries: readonly unknown[]): TSummary[] {
  const projected: TSummary[] = [];

  for (const summary of summaries) {
    const parsed = parseJsonValue<TSummary | null>(stringifyPublicWearableProjectionSummary(summary), null);
    if (parsed !== null) {
      projected.push(parsed);
    }
  }

  return projected;
}

function projectedMetricCandidatesFromResolvedMetrics(
  date: string,
  summaryKind: Exclude<QueryWearableSummaryKind, "source_health">,
  metrics: readonly WearableResolvedMetric[],
): WearableMetricCandidate[] {
  return metrics
    .map((metric) => projectedMetricCandidateFromResolvedMetric(date, summaryKind, metric))
    .filter((candidate): candidate is WearableMetricCandidate => candidate !== null);
}

function projectedMetricCandidateFromResolvedMetric(
  date: string,
  summaryKind: Exclude<QueryWearableSummaryKind, "source_health">,
  resolved: WearableResolvedMetric,
): WearableMetricCandidate | null {
  const selection = resolved.selection;
  if (
    selection.resolution !== "direct" ||
    selection.value === null ||
    !Number.isFinite(selection.value) ||
    !selection.provider
  ) {
    return null;
  }

  const provider = normalizeWearableProviders([selection.provider])[0];
  if (!provider) {
    return null;
  }

  return {
    candidateId: `projected:${summaryKind}:${provider}:${date}:${resolved.metric}`,
    dataOrigin: null,
    date,
    externalRef: null,
    metric: resolved.metric,
    occurredAt: selection.occurredAt,
    paths: [],
    provider,
    recordedAt: selection.recordedAt,
    recordIds: [],
    sourceFamily: projectedSourceFamily(selection.sourceFamily),
    sourceKind: selection.sourceKind ?? `projected-${summaryKind}`,
    title: selection.title,
    unit: selection.unit,
    value: selection.value,
  };
}

function projectedActivitySessionAggregate(
  summary: ProjectedWearableActivitySummary,
): WearableActivitySessionAggregate | null {
  const sessionMinutes = summary.sessionMinutes.selection.value;
  const sessionCount = summary.sessionCount.selection.value;
  const provider = normalizeWearableProviders([
    summary.sessionMinutes.selection.provider ?? summary.sessionCount.selection.provider ?? "",
  ])[0];

  if (
    !provider ||
    sessionMinutes === null ||
    sessionCount === null ||
    !Number.isFinite(sessionMinutes) ||
    !Number.isFinite(sessionCount)
  ) {
    return null;
  }

  return {
    activityTypes: [...summary.activityTypes],
    candidateId: `projected:activity-session:${provider}:${summary.date}`,
    dataOrigin: null,
    date: summary.date,
    paths: [],
    provider,
    recordedAt: latestNullableIso([
      summary.sessionMinutes.selection.recordedAt,
      summary.sessionCount.selection.recordedAt,
    ]),
    recordIds: [],
    sessionCount,
    sessionMinutes,
  };
}

function projectedSleepWindow(summary: ProjectedWearableSleepSummary): WearableSleepWindowCandidate | null {
  const provider = normalizeWearableProviders([
    summary.sleepWindowProvider
      ?? summary.provider
      ?? summary.sessionMinutes.selection.provider
      ?? summary.timeInBedMinutes.selection.provider
      ?? summary.totalSleepMinutes.selection.provider
      ?? "",
  ])[0];
  const durationMinutes =
    summary.sessionMinutes.selection.value
    ?? summary.timeInBedMinutes.selection.value
    ?? summary.totalSleepMinutes.selection.value;

  if (!provider || durationMinutes === null || !Number.isFinite(durationMinutes)) {
    return null;
  }

  return {
    candidateId: `projected:sleep-window:${provider}:${summary.date}`,
    dataOrigin: null,
    date: summary.date,
    durationMinutes,
    endAt: summary.sleepEndAt,
    nap: false,
    occurredAt: summary.sessionMinutes.selection.occurredAt,
    paths: [],
    provider,
    recordedAt: latestNullableIso([
      summary.sessionMinutes.selection.recordedAt,
      summary.timeInBedMinutes.selection.recordedAt,
      summary.totalSleepMinutes.selection.recordedAt,
    ]),
    recordIds: [],
    sourceFamily: "derived",
    sourceKind: "projected-sleep-window",
    startAt: summary.sleepStartAt,
    title: `${provider} sleep summary`,
  };
}

function activityResolvedMetrics(summary: ProjectedWearableActivitySummary): WearableResolvedMetric[] {
  return [
    summary.activityScore,
    summary.activeCalories,
    summary.altitudeChangeMeters,
    summary.dayStrain,
    summary.distanceKm,
    summary.estimatedVo2Max,
    summary.maxHeartRate,
    summary.percentRecorded,
    summary.sessionCount,
    summary.sessionMinutes,
    summary.steps,
    summary.totalCalories,
    summary.totalElevationGainMeters,
    summary.workoutStrain,
  ];
}

function sleepResolvedMetrics(summary: ProjectedWearableSleepSummary): WearableResolvedMetric[] {
  return [
    summary.averageHeartRate,
    summary.awakeMinutes,
    summary.deepMinutes,
    summary.hrv,
    summary.lightMinutes,
    summary.lowestHeartRate,
    summary.remMinutes,
    summary.respiratoryRate,
    summary.sessionMinutes,
    summary.sleepConsistency,
    summary.sleepEfficiency,
    summary.sleepPerformance,
    summary.sleepScore,
    summary.spo2,
    summary.timeInBedMinutes,
    summary.totalSleepMinutes,
  ];
}

function recoveryResolvedMetrics(summary: ProjectedWearableRecoverySummary): WearableResolvedMetric[] {
  return [
    summary.bodyBattery,
    summary.hrv,
    summary.readinessScore,
    summary.recoveryScore,
    summary.respiratoryRate,
    summary.restingHeartRate,
    summary.spo2,
    summary.stressLevel,
    summary.temperature,
    summary.temperatureDeviation,
  ];
}

function bodyStateResolvedMetrics(summary: ProjectedWearableBodyStateSummary): WearableResolvedMetric[] {
  return [
    summary.bmi,
    summary.bodyFatPercentage,
    summary.temperature,
    summary.weightKg,
  ];
}

function projectedSourceFamily(sourceFamily: WearableCandidateSourceFamily | null): WearableCandidateSourceFamily {
  return sourceFamily ?? "derived";
}

function latestNullableIso(values: readonly (string | null)[]): string | null {
  return values
    .filter((value): value is string => value !== null && value.length > 0)
    .sort()
    .at(-1) ?? null;
}

function wearableSummaryRowMatchesDateFilters(
  summaryDate: string | null,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): boolean {
  const date = summaryDate ? extractIsoDatePrefix(summaryDate) ?? summaryDate : null;

  if (filters.date) {
    return date === (extractIsoDatePrefix(filters.date) ?? filters.date);
  }

  if (filters.from && date && date < (extractIsoDatePrefix(filters.from) ?? filters.from)) {
    return false;
  }

  if (filters.to && date && date > (extractIsoDatePrefix(filters.to) ?? filters.to)) {
    return false;
  }

  return true;
}

function wearableSourceHealthMatchesDateFilters(
  summary: WearableSourceHealthSummary,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): boolean {
  const firstDate = summary.firstDate;
  const lastDate = summary.lastDate;

  if (filters.date) {
    const date = extractIsoDatePrefix(filters.date) ?? filters.date;
    return firstDate === null || lastDate === null || (firstDate <= date && lastDate >= date);
  }

  if (filters.from) {
    const from = extractIsoDatePrefix(filters.from) ?? filters.from;
    if (lastDate !== null && lastDate < from) {
      return false;
    }
  }

  if (filters.to) {
    const to = extractIsoDatePrefix(filters.to) ?? filters.to;
    if (firstDate !== null && firstDate > to) {
      return false;
    }
  }

  return true;
}

const WEARABLE_SUMMARY_PROVENANCE_KEYS = new Set([
  "candidateId",
  "dataOrigin",
  "externalRef",
]);

function stringifyPublicWearableProjectionSummary(summary: unknown): string {
  return JSON.stringify(summary, (key, value) => {
    if (key === "candidates") {
      return [];
    }

    if (WEARABLE_SUMMARY_PROVENANCE_KEYS.has(key)) {
      return undefined;
    }

    if (key === "paths" || key === "recordIds") {
      return [];
    }

    return value;
  });
}

function decodeQueryWearableSummaryRow(row: SqliteRow): QueryWearableSummaryRow {
  return {
    id: expectString(row.id, "query_wearable_summaries.id"),
    providerScopeJson: expectString(
      row.providerScopeJson,
      "query_wearable_summaries.provider_scope_json",
    ),
    providerScopeKey: expectString(
      row.providerScopeKey,
      "query_wearable_summaries.provider_scope_key",
    ),
    sortRank: expectNumber(row.sortRank, "query_wearable_summaries.sort_rank"),
    summaryDate: expectNullableString(row.summaryDate, "query_wearable_summaries.summary_date"),
    summaryJson: expectString(row.summaryJson, "query_wearable_summaries.summary_json"),
    summaryKind: expectEnumString(
      row.summaryKind,
      "query_wearable_summaries.summary_kind",
      QUERY_WEARABLE_SUMMARY_KINDS,
    ),
  };
}
