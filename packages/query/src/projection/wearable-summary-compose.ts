import { extractIsoDatePrefix } from "@murphai/contracts";

import {
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
import {
  buildActivitySessionAggregates,
  buildActivitySessionDayRollups,
} from "../wearables/candidates.ts";
import { resolveWearablePublicSourceProvider } from "../wearables/origin.ts";
import type {
  WearableActivityMetricCandidateEvidence,
  WearableActivitySessionEvidence,
  WearableBodyStateDay,
  WearableCandidateSourceFamily,
  WearableDataset,
  WearableMetricConfidence,
  WearableMetricCandidate,
  WearableMetricKey,
  WearableRecoveryDay,
  WearableResolvedMetric,
  WearableSleepNight,
  WearableSleepWindowCandidate,
  WearableSummaryConfidence,
  WearableSourceHealthSummary,
} from "../wearables/types.ts";
import {
  BODY_METRIC_KEYS,
  RECOVERY_METRIC_KEYS,
  SLEEP_METRIC_KEYS,
} from "../wearables/types.ts";
import { buildWearableSourceHealth } from "../wearables/source-health.ts";
import { formatMetricLabel, formatProviderName } from "../wearables/provider-policy.ts";
import {
  normalizeWearableProviders,
} from "./provider-scope.ts";
import {
  parseJsonValue,
} from "./schema.ts";
import {
  projectPublicWearableSummaryBundle,
} from "./wearable-summary-public-json.ts";
import {
  parseStoredWearableActivityRow,
  parseStoredWearableSummary,
  type StoredWearableMetricSummaryKind,
} from "./wearable-summary-stored-codec.ts";
import type {
  QueryWearableSummaryRow,
  QueryWearableSummaryRowSet,
} from "./wearable-summary-store.ts";

export function composePublicWearableSummaryBundleFromStoredRows(
  stored: QueryWearableSummaryRowSet,
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
  options: {
    retainSourceHealthOutsideDateFilters?: boolean;
  } = {},
): ProjectedWearableSummaryBundle {
  if (stored.providerFilterWasProvided && stored.providers.length === 0) {
    return emptyProjectedWearableSummaryBundle();
  }

  const { activityEvidenceRows, bundle: providerBundle } =
    publicWearableSummaryBundleFromRows(
      stored.rows,
      filters,
      options,
    );
  return stored.providers.length === 1
    ? providerBundle
    : composePublicWearableSummaryBundleFromProviderRows(
        providerBundle,
        activityEvidenceRows,
      );
}

function emptyProjectedWearableSummaryBundle(): ProjectedWearableSummaryBundle {
  return {
    activityDays: [],
    bodyStateDays: [],
    recoveryDays: [],
    sleepNights: [],
    sourceHealth: [],
  };
}

function publicWearableSummaryBundleFromRows(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
  options: {
    retainSourceHealthOutsideDateFilters?: boolean;
  },
): {
  activityEvidenceRows: StoredActivityEvidenceRow[];
  bundle: ProjectedWearableSummaryBundle;
} {
  const activityEvidenceRows: StoredActivityEvidenceRow[] = [];
  const activityRowKeys = new Set<string>();
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
        if (
          summary
          && (
            options.retainSourceHealthOutsideDateFilters
            || wearableSourceHealthMatchesDateFilters(summary, filters)
          )
        ) {
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
            const parsed =
              parseStoredWearableActivityRow<ProjectedWearableActivitySummary>(
                row.summaryJson,
              );
            const provider = storedRowProvider(row);
            if (
              !parsed
              || !provider
              || !row.summaryDate
              || parsed.summary.date !== row.summaryDate
            ) {
              throw invalidStoredActivityEvidenceError();
            }

            const rowKey = `${provider}\u0000${row.summaryDate}`;
            if (
              activityRowKeys.has(rowKey)
              || parsed.metricCandidates.some((candidate) =>
                candidate.date !== row.summaryDate
                || normalizeWearableProviders([candidate.publicProvider])[0]
                  !== provider
                || resolveStoredActivityMetricCandidatePublicProvider(candidate)
                  !== provider
              )
              || parsed.sessions.some((session) =>
                session.date !== row.summaryDate
                || normalizeWearableProviders([session.provider])[0]
                  !== provider
              )
            ) {
              throw invalidStoredActivityEvidenceError();
            }

            activityRowKeys.add(rowKey);
            bundle.activityDays.push(parsed.summary);
            activityEvidenceRows.push({
              metricCandidates: parsed.metricCandidates,
              sessions: parsed.sessions,
            });
            break;
          }
          case "body_state": {
            const summary = parseStoredWearableSummary<ProjectedWearableBodyStateSummary>(row.summaryKind, row.summaryJson);
            if (summary) bundle.bodyStateDays.push(summary);
            break;
          }
          case "recovery": {
            const summary = parseStoredWearableSummary<ProjectedWearableRecoverySummary>(row.summaryKind, row.summaryJson);
            if (summary) bundle.recoveryDays.push(summary);
            break;
          }
          case "sleep": {
            const summary = parseStoredWearableSummary<ProjectedWearableSleepSummary>(row.summaryKind, row.summaryJson);
            if (summary) bundle.sleepNights.push(summary);
            break;
          }
        }
      }
    }
  }

  return { activityEvidenceRows, bundle };
}

function composePublicWearableSummaryBundleFromProviderRows(
  providerBundle: ProjectedWearableSummaryBundle,
  activityEvidenceRows: readonly StoredActivityEvidenceRow[],
): ProjectedWearableSummaryBundle {
  const dataset = wearableDatasetFromProjectedBundle(
    providerBundle,
    activityEvidenceRows,
  );
  const composed = mergeStoredMetricConflictEvidence(
    buildWearableSummaryBundleFromDataset(dataset),
    providerBundle,
  );
  const recomputedSourceHealth = buildWearableSourceHealth({
    activityDays: composed.activityDays,
    bodyStateDays: composed.bodyStateDays,
    dataset,
    recoveryDays: composed.recoveryDays,
    sleepNights: composed.sleepNights,
  });

  return projectPublicWearableSummaryBundle(mergeStoredSourceHealthContext({
    ...composed,
    sourceHealth: recomputedSourceHealth,
  }, providerBundle.sourceHealth));
}

function mergeStoredMetricConflictEvidence(
  bundle: WearableSummaryBundle,
  stored: ProjectedWearableSummaryBundle,
): WearableSummaryBundle {
  return {
    ...bundle,
    bodyStateDays: bundle.bodyStateDays.map((summary) =>
      mergeStoredSummaryMetricConflicts(summary, stored.bodyStateDays, BODY_METRIC_KEYS)
    ),
    recoveryDays: bundle.recoveryDays.map((summary) =>
      mergeStoredSummaryMetricConflicts(summary, stored.recoveryDays, RECOVERY_METRIC_KEYS)
    ),
    sleepNights: bundle.sleepNights.map((summary) =>
      mergeStoredSummaryMetricConflicts(summary, stored.sleepNights, SLEEP_METRIC_KEYS)
    ),
  };
}

type WearableMetricSummary =
  | WearableBodyStateDay
  | WearableRecoveryDay
  | WearableSleepNight
  | ProjectedWearableBodyStateSummary
  | ProjectedWearableRecoverySummary
  | ProjectedWearableSleepSummary;

function mergeStoredSummaryMetricConflicts<TSummary extends WearableMetricSummary>(
  summary: TSummary,
  storedSummaries: readonly WearableMetricSummary[],
  metricKeys: ReadonlySet<WearableMetricKey>,
): TSummary {
  const storedForDate = storedSummaries.filter((stored) => stored.date === summary.date);
  if (storedForDate.length === 0) {
    return summary;
  }

  let changed = false;
  const next = { ...summary } as TSummary;
  const storedNotes: string[] = [];

  for (const metricKey of metricKeys) {
    const metric = getSummaryMetric(next, metricKey);
    if (!metric) {
      continue;
    }

    const participantProviders = metricParticipantProviders(metric);
    if (participantProviders.size === 0) {
      continue;
    }

    const storedMetrics = storedForDate
      .map((storedSummary) => ({
        metric: getSummaryMetric(storedSummary, metricKey),
        summary: storedSummary,
      }))
      .filter((entry): entry is { metric: WearableResolvedMetric; summary: WearableMetricSummary } =>
        entry.metric !== null
        && storedMetricSelfConflicts(entry.metric, participantProviders).length > 0
      );
    if (storedMetrics.length === 0) {
      continue;
    }

    const sameProviderConflicts = uniqueStringValues(
      storedMetrics.flatMap((entry) => storedMetricSelfConflicts(entry.metric, participantProviders)),
    );
    if (sameProviderConflicts.length === 0) {
      continue;
    }

    setSummaryMetric(next, metricKey, {
      ...metric,
      confidence: mergeStoredMetricConfidence(
        metric.confidence,
        storedMetrics.map((entry) => entry.metric.confidence),
        sameProviderConflicts,
      ),
    });
    storedNotes.push(
      ...storedMetrics.flatMap((entry) =>
        entry.summary.notes.filter((note) => note.includes("after source reconciliation"))
      ),
    );
    changed = true;
  }

  if (!changed) {
    return summary;
  }

  const summaryConfidence = mergeSummaryMetricConfidence(next, metricKeys);
  return {
    ...next,
    notes: uniqueStringValues([
      ...next.notes,
      ...summaryConfidence.notes,
      ...storedNotes,
    ]),
    summaryConfidence,
  };
}

function metricParticipantProviders(metric: WearableResolvedMetric): ReadonlySet<string> {
  return new Set(uniqueStringValues([
    metric.selection.provider ?? "",
    ...metric.candidates.map((candidate) => candidate.provider),
    ...metric.confidence.conflictingProviders,
  ]));
}

function storedMetricSelfConflicts(
  metric: WearableResolvedMetric,
  participantProviders: ReadonlySet<string>,
): string[] {
  const provider = metric.selection.provider;
  if (!provider || !participantProviders.has(provider)) {
    return [];
  }

  return metric.confidence.conflictingProviders.filter((conflictProvider) => conflictProvider === provider);
}

function getSummaryMetric(
  summary: WearableMetricSummary,
  metricKey: WearableMetricKey,
): WearableResolvedMetric | null {
  const value = (summary as Partial<Record<WearableMetricKey, unknown>>)[metricKey];
  return isWearableResolvedMetric(value) ? value : null;
}

function setSummaryMetric(
  summary: WearableMetricSummary,
  metricKey: WearableMetricKey,
  metric: WearableResolvedMetric,
): void {
  (summary as Partial<Record<WearableMetricKey, WearableResolvedMetric>>)[metricKey] = metric;
}

function isWearableResolvedMetric(value: unknown): value is WearableResolvedMetric {
  return typeof value === "object"
    && value !== null
    && "confidence" in value
    && "selection" in value
    && "metric" in value;
}

function mergeStoredMetricConfidence(
  current: WearableMetricConfidence,
  stored: readonly WearableMetricConfidence[],
  sameProviderConflicts: readonly string[],
): WearableMetricConfidence {
  const conflictingProviders = uniqueStringValues([
    ...current.conflictingProviders,
    ...sameProviderConflicts,
  ]).sort();

  return {
    ...current,
    candidateCount: Math.max(current.candidateCount, ...stored.map((confidence) => confidence.candidateCount)),
    conflictingProviders,
    exactDuplicateCount: Math.max(
      current.exactDuplicateCount,
      ...stored.map((confidence) => confidence.exactDuplicateCount),
    ),
    level: mergeStoredMetricConfidenceLevel(current, stored, conflictingProviders.length > 0),
    reasons: uniqueStringValues([
      ...current.reasons,
      ...stored.flatMap((confidence) =>
        confidence.reasons.filter((reason) => reason.includes("after source reconciliation"))
      ),
    ]),
  };
}

function mergeStoredMetricConfidenceLevel(
  current: WearableMetricConfidence,
  stored: readonly WearableMetricConfidence[],
  hasConflicts: boolean,
): WearableMetricConfidence["level"] {
  if (current.level === "low" || stored.some((confidence) => confidence.level === "low")) {
    return "low";
  }

  if (
    hasConflicts
    || current.level === "medium"
    || stored.some((confidence) => confidence.level === "medium")
  ) {
    return "medium";
  }

  return current.level;
}

function mergeSummaryMetricConfidence(
  summary: WearableMetricSummary,
  metricKeys: ReadonlySet<WearableMetricKey>,
): WearableSummaryConfidence {
  const metrics = [...metricKeys]
    .map((metricKey) => [metricKey, getSummaryMetric(summary, metricKey)] as const)
    .filter((entry): entry is readonly [WearableMetricKey, WearableResolvedMetric] => entry[1] !== null);
  const selectedMetrics = metrics.filter(([, metric]) => metric.selection.value !== null);
  const selectedProviders = uniqueStringValues(
    selectedMetrics
      .map(([, metric]) => metric.selection.provider)
      .filter((provider): provider is string => provider !== null && provider.length > 0),
  );
  const conflictingMetrics = metrics
    .filter(([, metric]) => metric.confidence.conflictingProviders.length > 0)
    .map(([metric]) => metric);
  const lowConfidenceMetrics = metrics
    .filter(([, metric]) => metric.confidence.level === "low")
    .map(([metric]) => metric);
  const notes = uniqueStringValues(
    summary.summaryConfidence.notes.filter((note) => !isAutoConflictSummaryNote(note)),
  );

  if (conflictingMetrics.length > 0) {
    notes.push(`Some metrics still conflict across providers: ${conflictingMetrics.map(formatMetricLabel).join(", ")}.`);
  }

  return {
    conflictingMetrics: uniqueStringValues([
      ...summary.summaryConfidence.conflictingMetrics,
      ...conflictingMetrics,
    ]),
    level: lowConfidenceMetrics.length > 0
      ? "low"
      : conflictingMetrics.length > 0
        ? "medium"
        : summary.summaryConfidence.level,
    lowConfidenceMetrics: uniqueStringValues([
      ...summary.summaryConfidence.lowConfidenceMetrics,
      ...lowConfidenceMetrics,
    ]),
    notes: uniqueStringValues(notes),
    selectedProviders,
  };
}

function mergeStoredSourceHealthContext(
  bundle: WearableSummaryBundle,
  storedSourceHealth: readonly ProjectedWearableSourceHealthSummary[],
): WearableSummaryBundle {
  if (storedSourceHealth.length === 0) {
    return bundle;
  }

  const diagnosticsByProvider = new Map<string, string[]>();
  for (const stored of storedSourceHealth) {
    const diagnosticNotes = stored.notes.filter(isStoredSourceHealthDiagnosticNote);
    if (diagnosticNotes.length === 0) {
      continue;
    }

    diagnosticsByProvider.set(
      stored.provider,
      uniqueStringValues([
        ...(diagnosticsByProvider.get(stored.provider) ?? []),
        ...diagnosticNotes,
      ]),
    );
  }

  const sourceHealth = bundle.sourceHealth.map((summary) => {
    const storedSummary = storedSourceHealth.find((stored) => stored.provider === summary.provider);
    const diagnosticNotes = diagnosticsByProvider.get(summary.provider);

    if (!storedSummary && (!diagnosticNotes || diagnosticNotes.length === 0)) {
      return summary;
    }

    return {
      ...summary,
      exactDuplicatesSuppressed:
        storedSummary?.exactDuplicatesSuppressed
        ?? summary.exactDuplicatesSuppressed,
      notes: uniqueStringValues([...summary.notes, ...(diagnosticNotes ?? [])]),
    };
  });
  const composedProviders = new Set(sourceHealth.map((summary) => summary.provider));

  for (const summary of storedSourceHealth) {
    const diagnosticNotes = diagnosticsByProvider.get(summary.provider);
    if (composedProviders.has(summary.provider)) {
      continue;
    }

    if (!diagnosticNotes && !storedSourceHealthHasCoverageInterval(summary)) {
      continue;
    }

    sourceHealth.push(buildStoredSourceHealthCoverageRow(summary, diagnosticNotes ?? []));
    composedProviders.add(summary.provider);
  }

  return {
    ...bundle,
    sourceHealth: sourceHealth.sort(compareSourceHealthSummaries),
  };
}

function isStoredSourceHealthDiagnosticNote(note: string): boolean {
  return (
    note.startsWith("Included ") && note.includes("incomplete provenance")
  ) || (
    note.startsWith("Excluded ") && note.includes("provenance was incomplete")
  );
}

function isAutoConflictSummaryNote(note: string): boolean {
  return note.startsWith("Some metrics still conflict across providers:");
}

function storedSourceHealthHasCoverageInterval(summary: ProjectedWearableSourceHealthSummary): boolean {
  return summary.firstDate !== null || summary.lastDate !== null;
}

function buildStoredSourceHealthCoverageRow(
  summary: ProjectedWearableSourceHealthSummary,
  diagnosticNotes: readonly string[],
): WearableSourceHealthSummary {
  const hasDiagnostics = diagnosticNotes.length > 0;

  return {
    activityDays: 0,
    bodyStateDays: 0,
    candidateMetrics: hasDiagnostics ? summary.candidateMetrics : 0,
    conflictCount: 0,
    exactDuplicatesSuppressed: summary.exactDuplicatesSuppressed,
    firstDate: summary.firstDate,
    lastDate: summary.lastDate,
    lastSleepDate: summary.lastSleepDate ?? null,
    latestRecordedAt: hasDiagnostics ? summary.latestRecordedAt : null,
    metricsContributed: [],
    notes: [...diagnosticNotes],
    provider: summary.provider,
    providerDisplayName: formatProviderName(summary.provider),
    recoveryDays: 0,
    selectedMetrics: 0,
    sleepNights: 0,
    sleepStalenessVsNewestDays: null,
    stalenessVsNewestDays: null,
  };
}

function uniqueStringValues(values: readonly string[]): string[] {
  const uniqueValues = new Set<string>();

  for (const value of values) {
    if (value.length > 0) {
      uniqueValues.add(value);
    }
  }

  return [...uniqueValues];
}

function compareSourceHealthSummaries(
  left: WearableSourceHealthSummary,
  right: WearableSourceHealthSummary,
): number {
  if ((left.lastDate ?? "") !== (right.lastDate ?? "")) {
    return (right.lastDate ?? "").localeCompare(left.lastDate ?? "");
  }

  return left.provider.localeCompare(right.provider);
}

function wearableDatasetFromProjectedBundle(
  bundle: ProjectedWearableSummaryBundle,
  activityEvidenceRows: readonly StoredActivityEvidenceRow[],
): WearableDataset {
  const metricCandidates: WearableMetricCandidate[] = [];
  const activitySessionCandidates: WearableMetricCandidate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];

  for (const evidenceRow of activityEvidenceRows) {
    metricCandidates.push(...projectedActivityMetricCandidates(
      evidenceRow.metricCandidates,
    ));
    activitySessionCandidates.push(...projectedActivitySessionCandidates(
      evidenceRow.sessions,
    ));
  }

  for (const summary of bundle.sleepNights) {
    metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
      summary.date,
      "sleep",
      sleepResolvedMetrics(summary).filter((metric) => metric.metric !== "sessionMinutes"),
    ));
    sleepWindows.push(...projectedSleepWindows(summary));
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

  const activitySessionAggregates =
    buildActivitySessionAggregates(activitySessionCandidates);

  return {
    activitySessionCandidates,
    activitySessionAggregates,
    activitySessionDayRollups: buildActivitySessionDayRollups(activitySessionCandidates),
    metricSuppressionEvidence: [],
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: metricCandidates,
    sleepWindows,
    workoutFeatures: bundle.activityDays.flatMap((summary) =>
      summary.workoutFeatures.map((feature) => ({
        date: summary.date,
        feature,
      }))
    ),
  };
}

interface StoredActivityEvidenceRow {
  metricCandidates: readonly WearableActivityMetricCandidateEvidence[];
  sessions: readonly WearableActivitySessionEvidence[];
}

function storedRowProvider(row: QueryWearableSummaryRow): string | undefined {
  const providerScope = parseJsonValue<unknown>(row.providerScopeJson, null);
  const providers = Array.isArray(providerScope)
    ? normalizeWearableProviders(providerScope.filter((value): value is string => typeof value === "string"))
    : [];
  return providers.length === 1 ? providers[0] : undefined;
}

function invalidStoredActivityEvidenceError(): Error {
  return new Error(
    "Stored activity evidence is malformed; rebuild the query projection.",
  );
}

function projectedActivityMetricCandidates(
  evidence: readonly WearableActivityMetricCandidateEvidence[],
): WearableMetricCandidate[] {
  return evidence.map((candidate) => ({
    candidateId: candidate.candidateKey,
    dataOrigin: storedActivityMetricCandidateDataOrigin(candidate),
    date: candidate.date,
    externalRef: {
      facet: candidate.hasDayStrainFacet ? "day-strain" : null,
      resourceId: candidate.exactKey,
      resourceType: storedActivityMetricCandidateResourceType(candidate),
      system: candidate.provider,
      version: null,
    },
    metric: candidate.metric,
    occurredAt: candidate.occurredAt,
    paths: [],
    provider: candidate.provider,
    recordedAt: candidate.recordedAt,
    recordIds: [candidate.candidateKey],
    sourceFamily: candidate.sourceFamily,
    sourceKind: candidate.sourceKind,
    title: null,
    unit: candidate.unit,
    value: candidate.value,
  }));
}

function storedActivityMetricCandidateDataOrigin(
  candidate: WearableActivityMetricCandidateEvidence,
): WearableMetricCandidate["dataOrigin"] {
  const { aggregatorProvider, sourceProviderSlug, sourceType } = candidate.origin;
  if (!aggregatorProvider && !sourceProviderSlug && !sourceType) {
    return null;
  }

  return {
    version: 1,
    ...(aggregatorProvider ? { aggregatorProvider } : {}),
    ...(sourceProviderSlug ? { sourceProviderSlug } : {}),
    ...(sourceType ? { sourceType } : {}),
  };
}

function storedActivityMetricCandidateResourceType(
  candidate: WearableActivityMetricCandidateEvidence,
): string | null {
  switch (candidate.resourceClass) {
    case "activity":
      return "activity";
    case "cycle":
      return "cycle";
    case "generic":
      return "resource";
    case "none":
      return null;
  }
}

function resolveStoredActivityMetricCandidatePublicProvider(
  candidate: WearableActivityMetricCandidateEvidence,
): string {
  return resolveWearablePublicSourceProvider({
    dataOrigin: storedActivityMetricCandidateDataOrigin(candidate),
    externalRef: {
      facet: candidate.hasDayStrainFacet ? "day-strain" : null,
      resourceId: candidate.exactKey,
      resourceType: storedActivityMetricCandidateResourceType(candidate),
      system: candidate.provider,
      version: null,
    },
    provider: candidate.provider,
  }, {
    suppressJunctionSourceInstanceFallback: true,
  });
}

function projectedActivitySessionCandidates(
  evidence: readonly WearableActivitySessionEvidence[],
): WearableMetricCandidate[] {
  return evidence.flatMap((session, index) => {
    const provider = normalizeWearableProviders([session.provider])[0];
    if (
      !provider
      || !Number.isFinite(session.durationMinutes)
      || session.durationMinutes <= 0
    ) {
      return [];
    }

    const recordId = `projected:activity-session-evidence:${provider}:${session.date}:${index}`;
    return [{
      activityType: session.activityType,
      candidateId: recordId,
      dataOrigin: null,
      date: session.date,
      externalRef: session.reconciliationResourceKey
        ? {
            facet: null,
            resourceId: session.reconciliationResourceKey,
            resourceType: "activity_session",
            system: provider,
            version: null,
          }
        : null,
      heartRateZones: session.heartRateZones.map((zone) => ({ ...zone })),
      metric: "sessionMinutes",
      occurredAt: session.startedAt,
      paths: [],
      provider,
      reconciliationDurationConsistent: session.durationConsistent,
      reconciliationExactKey: session.reconciliationExactKey,
      recordedAt: session.recordedAt,
      recordIds: [recordId],
      sessionEndAt: session.endedAt,
      sessionStartAt: session.startedAt,
      sourceFamily: "event",
      sourceKind: "activity_session",
      title: `${formatProviderName(provider)} activity session`,
      unit: "minutes",
      value: session.durationMinutes,
      workoutMetricKeys: [...session.workoutMetricKeys],
      workoutMetricValues: { ...session.workoutMetricValues },
    }];
  });
}

function projectedMetricCandidatesFromResolvedMetrics(
  date: string,
  summaryKind: StoredWearableMetricSummaryKind,
  metrics: readonly WearableResolvedMetric[],
): WearableMetricCandidate[] {
  return metrics
    .map((metric) => projectedMetricCandidateFromResolvedMetric(date, summaryKind, metric))
    .filter((candidate): candidate is WearableMetricCandidate => candidate !== null);
}

function projectedMetricCandidateFromResolvedMetric(
  date: string,
  summaryKind: StoredWearableMetricSummaryKind,
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
    recordIds: [...selection.recordIds],
    sourceFamily: projectedSourceFamily(selection.sourceFamily),
    sourceKind: selection.sourceKind ?? `projected-${summaryKind}`,
    title: selection.title,
    unit: selection.unit,
    value: selection.value,
  };
}

function projectedSleepWindows(summary: ProjectedWearableSleepSummary): WearableSleepWindowCandidate[] {
  const evidence = summary.sleepWindowEvidence ?? [];
  if (evidence.length > 0) {
    return evidence.map((window, index) => ({
      candidateId: `projected:sleep-window:${window.provider}:${window.date}:${index}:${window.startAt ?? "unknown"}`,
      dataOrigin: null,
      date: window.date,
      durationMinutes: window.durationMinutes,
      endAt: window.endAt,
      evidenceOmittedCount: index === 0 ? summary.sleepWindowEvidenceOmittedCount ?? 0 : 0,
      evidenceOmittedExactDuplicateCount: index === 0
        ? summary.sleepWindowEvidenceOmittedExactDuplicateCount ?? 0
        : 0,
      exactDuplicateCount: window.exactDuplicateCount,
      externalRef: null,
      nap: window.sleepType === "nap",
      occurredAt: window.startAt,
      paths: [],
      provider: window.provider,
      recordedAt: window.recordedAt,
      recordIds: [],
      sourceFamily: "derived",
      sourceKind: "projected-sleep-window-evidence",
      sleepType: window.sleepType,
      startAt: window.startAt,
      timeZone: window.timeZone,
      title: `${window.provider} sleep summary evidence`,
    }));
  }

  const fallback = projectedSelectedSleepWindow(summary);
  return fallback ? [fallback] : [];
}

function projectedSelectedSleepWindow(
  summary: ProjectedWearableSleepSummary,
): WearableSleepWindowCandidate | null {
  const provider = normalizeWearableProviders([
    summary.sleepWindowProvider ?? summary.sessionMinutes.selection.provider ?? "",
  ])[0];
  const durationMinutes = summary.sessionMinutes.selection.value;

  if (
    !provider ||
    summary.sessionMinutes.selection.sourceKind !== "sleep-window" ||
    durationMinutes === null ||
    !Number.isFinite(durationMinutes)
  ) {
    return null;
  }

  return {
    candidateId: `projected:sleep-window:${provider}:${summary.date}`,
    dataOrigin: null,
    date: summary.date,
    durationMinutes,
    endAt: summary.sleepEndAt,
    evidenceOmittedCount: summary.sleepWindowEvidenceOmittedCount ?? 0,
    evidenceOmittedExactDuplicateCount: summary.sleepWindowEvidenceOmittedExactDuplicateCount ?? 0,
    exactDuplicateCount: 0,
    externalRef: null,
    nap: summary.sleepType === "nap",
    occurredAt: summary.sessionMinutes.selection.occurredAt,
    paths: [],
    provider,
    recordedAt: summary.sessionMinutes.selection.recordedAt,
    recordIds: [],
    sourceFamily: "derived",
    sourceKind: "projected-sleep-window",
    sleepType: summary.sleepType,
    startAt: summary.sleepStartAt,
    timeZone: summary.timeZone,
    title: `${provider} sleep summary`,
  };
}

function sleepResolvedMetrics(summary: ProjectedWearableSleepSummary): WearableResolvedMetric[] {
  return [
    summary.averageHeartRate,
    summary.awakeMinutes,
    summary.deepMinutes,
    summary.hrv,
    summary.lightMinutes,
    summary.lowestHeartRate,
    summary.lowestSpo2,
    summary.remMinutes,
    summary.respiratoryRate,
    summary.sessionMinutes,
    summary.sleepConsistency,
    summary.sleepEfficiency,
    summary.sleepLatencyMinutes,
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
    summary.bodyWaterPercentage,
    summary.boneMassPercentage,
    summary.leanBodyMassKg,
    summary.muscleMassPercentage,
    summary.temperature,
    summary.visceralFatIndex,
    summary.waistCircumference,
    summary.weightKg,
  ];
}

function projectedSourceFamily(sourceFamily: WearableCandidateSourceFamily | null): WearableCandidateSourceFamily {
  return sourceFamily ?? "derived";
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
