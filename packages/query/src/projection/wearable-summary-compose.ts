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
  WearableActivityDay,
  WearableActivityMetricEvidence,
  WearableActivitySessionEvidence,
  WearableActivitySessionAggregate,
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
  ACTIVITY_BRANCH_SCOPED_METRIC_KEYS,
  ACTIVITY_METRIC_KEYS,
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
  stringifyPublicWearableProjectionSummary,
} from "./wearable-summary-public-json.ts";
import {
  parseStoredWearableActivityMetricEvidence,
  parseStoredWearableActivitySessionEvidence,
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

  const activitySessionEvidenceByProviderDate =
    storedActivitySessionEvidenceByProviderDate(stored.rows, filters);
  const activityMetricEvidenceByProviderDate =
    storedActivityMetricEvidenceByProviderDate(stored.rows, filters);
  validateStoredActivityEvidenceCompleteness(
    stored.rows,
    filters,
    activityMetricEvidenceByProviderDate,
    activitySessionEvidenceByProviderDate,
  );
  return stored.providers.length === 1
    ? publicWearableSummaryBundleFromRows(stored.rows, filters, options)
    : composePublicWearableSummaryBundleFromProviderRows(
        stored.rows,
        filters,
        activityMetricEvidenceByProviderDate,
        activitySessionEvidenceByProviderDate,
        options,
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
            const summary = parseStoredWearableSummary<ProjectedWearableActivitySummary>(row.summaryKind, row.summaryJson);
            if (summary) bundle.activityDays.push(summary);
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

  return bundle;
}

function composePublicWearableSummaryBundleFromProviderRows(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
  activityMetricEvidenceByProviderDate: ReadonlyMap<
    string,
    readonly WearableActivityMetricEvidence[]
  >,
  activitySessionEvidenceByProviderDate: ReadonlyMap<
    string,
    readonly WearableActivitySessionEvidence[]
  >,
  options: {
    retainSourceHealthOutsideDateFilters?: boolean;
  },
): ProjectedWearableSummaryBundle {
  const providerBundle = publicWearableSummaryBundleFromRows(rows, filters, options);
  const activitySummaryScopes = storedActivitySummaryScopes(rows, filters);
  const activityDatesWithCompleteMetricEvidence =
    storedActivityDatesWithCompleteMetricEvidence(
      activitySummaryScopes,
      activityMetricEvidenceByProviderDate,
      activitySessionEvidenceByProviderDate,
    );
  const dataset = wearableDatasetFromProjectedBundle(
    providerBundle,
    activitySummaryScopes,
    activityMetricEvidenceByProviderDate,
    activitySessionEvidenceByProviderDate,
  );
  const composed = mergeStoredMetricConflictEvidence(
    buildWearableSummaryBundleFromDataset(dataset),
    providerBundle,
    activityDatesWithCompleteMetricEvidence,
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
  activityDatesWithCompleteMetricEvidence: ReadonlySet<string>,
): WearableSummaryBundle {
  return {
    ...bundle,
    activityDays: bundle.activityDays.map((summary) =>
      activityDatesWithCompleteMetricEvidence.has(summary.date)
        ? summary
        : mergeStoredSummaryMetricConflicts(summary, stored.activityDays, ACTIVITY_METRIC_KEYS)
    ),
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
  | WearableActivityDay
  | WearableBodyStateDay
  | WearableRecoveryDay
  | WearableSleepNight
  | ProjectedWearableActivitySummary
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
        && storedConflictBranchMatches(metricKey, metric, entry.metric)
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

function storedConflictBranchMatches(
  metricKey: WearableMetricKey,
  current: WearableResolvedMetric,
  stored: WearableResolvedMetric,
): boolean {
  return !ACTIVITY_BRANCH_SCOPED_METRIC_KEYS.has(metricKey)
    || isActivitySessionRollupSelection(current) === isActivitySessionRollupSelection(stored);
}

function isActivitySessionRollupSelection(metric: WearableResolvedMetric): boolean {
  return metric.selection.sourceKind === "activity-session-aggregate"
    || metric.selection.sourceKind === "activity-session-day-rollup";
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
    exactDuplicatesSuppressed: 0,
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
  activitySummaryScopes: readonly StoredActivitySummaryScope[] = [],
  activityMetricEvidenceByProviderDate: ReadonlyMap<string, readonly WearableActivityMetricEvidence[]> = new Map(),
  activitySessionEvidenceByProviderDate: ReadonlyMap<string, readonly WearableActivitySessionEvidence[]> = new Map(),
): WearableDataset {
  const metricCandidates: WearableMetricCandidate[] = [];
  const activitySessionCandidates: WearableMetricCandidate[] = [];
  const legacyActivitySessionAggregates: WearableActivitySessionAggregate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];

  if (
    activitySummaryScopes.length > 0
    && activitySummaryScopes.length !== bundle.activityDays.length
  ) {
    throw invalidStoredActivityMetricEvidenceError();
  }

  for (const [summaryIndex, summary] of bundle.activityDays.entries()) {
    const scope = activitySummaryScopes[summaryIndex];
    if (scope && scope.date !== summary.date) {
      throw invalidStoredActivityMetricEvidenceError();
    }
    const evidenceKey = scope
      ? activitySessionEvidenceKey(scope.provider, scope.date)
      : null;
    const storedSessionEvidence = evidenceKey
      ? activitySessionEvidenceByProviderDate.get(evidenceKey)
      : undefined;
    const storedMetricEvidence = evidenceKey
      ? activityMetricEvidenceByProviderDate.get(evidenceKey)
      : undefined;
    const hasStoredMetricEvidence = storedMetricEvidence !== undefined;
    const hasStoredSessionEvidence =
      storedSessionEvidence !== undefined
      && storedSessionEvidence.length > 0;
    if (hasStoredMetricEvidence) {
      metricCandidates.push(...projectedActivityMetricCandidates(storedMetricEvidence));
    } else {
      metricCandidates.push(...projectedMetricCandidatesFromResolvedMetrics(
        summary.date,
        "activity",
        activityResolvedMetrics(summary).filter((metric) =>
          metric.metric !== "sessionMinutes"
          && metric.metric !== "sessionCount"
          && !(
            hasStoredSessionEvidence
            && metric.selection.sourceKind === "activity-session-day-rollup"
          )
        ),
      ));
    }
    if (hasStoredSessionEvidence) {
      activitySessionCandidates.push(...projectedActivitySessionCandidates(
        storedSessionEvidence,
      ));
    } else {
      const aggregate = projectedActivitySessionAggregate(summary, {
        includeWorkoutMetrics: hasStoredMetricEvidence,
      });
      if (aggregate) {
        legacyActivitySessionAggregates.push(aggregate);
      }
    }
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

  const activitySessionAggregates = [
    ...legacyActivitySessionAggregates,
    ...buildActivitySessionAggregates(activitySessionCandidates),
  ];

  return {
    activitySessionCandidates,
    activitySessionAggregates,
    activitySessionDayRollups: buildActivitySessionDayRollups(activitySessionCandidates),
    metricSuppressionEvidence: [],
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: metricCandidates,
    sleepWindows,
  };
}

interface StoredActivitySummaryScope {
  date: string;
  hasSessionSelection: boolean;
  provider: string;
}

function storedActivitySummaryScopes(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): StoredActivitySummaryScope[] {
  const scopes: StoredActivitySummaryScope[] = [];
  for (const row of rows) {
    if (
      row.summaryKind !== "activity"
      || !wearableSummaryRowMatchesDateFilters(row.summaryDate, filters)
    ) {
      continue;
    }
    const summary = parseStoredWearableSummary<ProjectedWearableActivitySummary>(
      row.summaryKind,
      row.summaryJson,
    );
    if (!summary) {
      continue;
    }
    const provider = storedRowProvider(row);
    if (!provider || !row.summaryDate || summary.date !== row.summaryDate) {
      throw invalidStoredActivityMetricEvidenceError();
    }
    scopes.push({
      date: row.summaryDate,
      hasSessionSelection: storedActivitySummaryHasSessionSelection(summary),
      provider,
    });
  }
  return scopes;
}

function storedActivityMetricEvidenceByProviderDate(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): Map<string, readonly WearableActivityMetricEvidence[]> {
  const evidenceByProviderDate = new Map<string, readonly WearableActivityMetricEvidence[]>();
  const evidenceModeByDate = new Map<string, "current" | "legacy">();

  for (const row of rows) {
    if (
      row.summaryKind !== "activity"
      || !wearableSummaryRowMatchesDateFilters(row.summaryDate, filters)
    ) {
      continue;
    }
    const parsedEvidence = parseStoredWearableActivityMetricEvidence(row.summaryJson);
    if (parsedEvidence.status === "absent") {
      if (row.summaryDate) {
        addStoredActivityMetricEvidenceMode(
          evidenceModeByDate,
          row.summaryDate,
          "legacy",
        );
      }
      continue;
    }
    if (parsedEvidence.status === "invalid") {
      throw invalidStoredActivityMetricEvidenceError();
    }
    const provider = storedRowProvider(row);
    if (
      !provider
      || !row.summaryDate
      || parsedEvidence.evidence.some((candidate) =>
        candidate.date !== row.summaryDate
        || normalizeWearableProviders([candidate.publicProvider])[0] !== provider
        || resolveStoredActivityMetricEvidencePublicProvider(candidate) !== provider
      )
    ) {
      throw invalidStoredActivityMetricEvidenceError();
    }
    const evidenceKey = activitySessionEvidenceKey(provider, row.summaryDate);
    if (evidenceByProviderDate.has(evidenceKey)) {
      throw invalidStoredActivityMetricEvidenceError();
    }
    evidenceByProviderDate.set(evidenceKey, parsedEvidence.evidence);
    addStoredActivityMetricEvidenceMode(
      evidenceModeByDate,
      row.summaryDate,
      "current",
    );
  }

  return evidenceByProviderDate;
}

function addStoredActivityMetricEvidenceMode(
  modeByDate: Map<string, "current" | "legacy">,
  date: string,
  mode: "current" | "legacy",
): void {
  const existingMode = modeByDate.get(date);
  if (existingMode && existingMode !== mode) {
    throw new Error(
      "Stored activity metric ranking evidence mixes current and legacy rows for one date; "
      + "rebuild the query projection.",
    );
  }
  modeByDate.set(date, mode);
}

function validateStoredActivityEvidenceCompleteness(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
  metricEvidenceByProviderDate: ReadonlyMap<
    string,
    readonly WearableActivityMetricEvidence[]
  >,
  sessionEvidenceByProviderDate: ReadonlyMap<
    string,
    readonly WearableActivitySessionEvidence[]
  >,
): void {
  for (const row of rows) {
    if (
      row.summaryKind !== "activity"
      || !wearableSummaryRowMatchesDateFilters(row.summaryDate, filters)
    ) {
      continue;
    }

    const parsedMetricEvidence = parseStoredWearableActivityMetricEvidence(
      row.summaryJson,
    );
    if (parsedMetricEvidence.status === "absent") {
      if (
        parseStoredWearableActivitySessionEvidence(row.summaryJson).status
          === "valid"
      ) {
        throw invalidStoredActivityMetricEvidenceError();
      }
      continue;
    }
    if (parsedMetricEvidence.status === "invalid") {
      throw invalidStoredActivityMetricEvidenceError();
    }
    const parsedSessionEvidence = parseStoredWearableActivitySessionEvidence(
      row.summaryJson,
    );
    if (parsedSessionEvidence.status !== "valid") {
      throw invalidStoredActivitySessionEvidenceError(
        parsedSessionEvidence.status === "invalid"
          ? parsedSessionEvidence.reason
          : "malformed",
      );
    }

    const summary = parseStoredWearableSummary<ProjectedWearableActivitySummary>(
      "activity",
      row.summaryJson,
    );
    const provider = storedRowProvider(row);
    if (!summary || !provider || !row.summaryDate || summary.date !== row.summaryDate) {
      throw invalidStoredActivityMetricEvidenceError();
    }

    const evidenceKey = activitySessionEvidenceKey(provider, row.summaryDate);
    const metricEvidence = metricEvidenceByProviderDate.get(evidenceKey);
    if (!metricEvidence) {
      throw invalidStoredActivityMetricEvidenceError();
    }
    const storedSessionEvidence = sessionEvidenceByProviderDate.get(evidenceKey);
    if (!storedSessionEvidence) {
      throw invalidStoredActivitySessionEvidenceError("malformed");
    }
    const sessionEvidence = storedSessionEvidence.length > 0
      ? storedSessionEvidence
      : undefined;
    const rebuilt = rebuildStoredActivityEvidenceSummary(
      summary,
      metricEvidence,
      sessionEvidence,
    );
    if (!rebuilt) {
      throw invalidStoredActivityMetricEvidenceError();
    }

    if (
      sessionEvidence !== undefined
      && (
        rebuilt.sessionMinutes.selection.value
          !== summary.sessionMinutes.selection.value
        || rebuilt.sessionCount.selection.value
          !== summary.sessionCount.selection.value
        || stringifyPublicWearableProjectionSummary(rebuilt.activityTypes)
          !== stringifyPublicWearableProjectionSummary(summary.activityTypes)
        || stringifyPublicWearableProjectionSummary(rebuilt.heartRateZones)
          !== stringifyPublicWearableProjectionSummary(summary.heartRateZones)
      )
    ) {
      throw invalidStoredActivitySessionEvidenceError("malformed");
    }

    const rebuiltMetrics = new Map(
      activityResolvedMetrics(rebuilt).map((metric) => [metric.metric, metric]),
    );
    for (const storedMetric of activityResolvedMetrics(summary)) {
      const rebuiltMetric = rebuiltMetrics.get(storedMetric.metric);
      if (
        !rebuiltMetric
        || stringifyPublicWearableProjectionSummary(rebuiltMetric)
          !== stringifyPublicWearableProjectionSummary(storedMetric)
      ) {
        throw invalidStoredActivityMetricEvidenceError();
      }
    }

  }
}

function rebuildStoredActivityEvidenceSummary(
  storedSummary: ProjectedWearableActivitySummary,
  metricEvidence: readonly WearableActivityMetricEvidence[],
  sessionEvidence: readonly WearableActivitySessionEvidence[] | undefined,
): WearableActivityDay | null {
  const metricCandidates = projectedActivityMetricCandidates(metricEvidence);
  const activitySessionCandidates = sessionEvidence
    ? projectedActivitySessionCandidates(sessionEvidence)
    : [];
  const projectedAggregate = sessionEvidence
    ? null
    : projectedActivitySessionAggregate(storedSummary, {
        includeWorkoutMetrics: false,
      });
  const activitySessionAggregates = sessionEvidence
    ? buildActivitySessionAggregates(activitySessionCandidates)
    : projectedAggregate
      ? [projectedAggregate]
      : [];
  const activitySessionDayRollups = sessionEvidence
    ? buildActivitySessionDayRollups(activitySessionCandidates)
    : [];
  const rebuilt = buildWearableSummaryBundleFromDataset({
    activitySessionCandidates,
    activitySessionAggregates,
    activitySessionDayRollups,
    metricSuppressionEvidence: [],
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: metricCandidates,
    sleepWindows: [],
  });
  return rebuilt.activityDays.find((summary) => summary.date === storedSummary.date) ?? null;
}

function storedActivityDatesWithCompleteMetricEvidence(
  scopes: readonly StoredActivitySummaryScope[],
  metricEvidenceByProviderDate: ReadonlyMap<
    string,
    readonly WearableActivityMetricEvidence[]
  >,
  sessionEvidenceByProviderDate: ReadonlyMap<
    string,
    readonly WearableActivitySessionEvidence[]
  >,
): Set<string> {
  const scopesByDate = new Map<string, StoredActivitySummaryScope[]>();
  for (const scope of scopes) {
    const dateScopes = scopesByDate.get(scope.date) ?? [];
    dateScopes.push(scope);
    scopesByDate.set(scope.date, dateScopes);
  }

  const completeDates = new Set<string>();
  for (const [date, dateScopes] of scopesByDate) {
    if (
      dateScopes.length > 0
      && dateScopes.every((scope) => {
        const evidenceKey = activitySessionEvidenceKey(scope.provider, scope.date);
        return metricEvidenceByProviderDate.has(evidenceKey)
          && (
            !scope.hasSessionSelection
            || (sessionEvidenceByProviderDate.get(evidenceKey)?.length ?? 0) > 0
          );
      })
    ) {
      completeDates.add(date);
    }
  }
  return completeDates;
}

function storedActivitySessionEvidenceByProviderDate(
  rows: readonly QueryWearableSummaryRow[],
  filters: WearableSummaryFilters | WearableMetricSummaryFilters,
): Map<string, readonly WearableActivitySessionEvidence[]> {
  const evidenceByProviderDate = new Map<string, readonly WearableActivitySessionEvidence[]>();
  const evidenceModeByDate = new Map<string, "current" | "legacy">();

  for (const row of rows) {
    if (
      row.summaryKind !== "activity"
      || !wearableSummaryRowMatchesDateFilters(row.summaryDate, filters)
    ) {
      continue;
    }
    const parsedEvidence = parseStoredWearableActivitySessionEvidence(row.summaryJson);
    if (parsedEvidence.status === "absent") {
      if (row.summaryDate && storedActivityRowHasSessionSelection(row)) {
        addStoredActivitySessionEvidenceMode(
          evidenceModeByDate,
          row.summaryDate,
          "legacy",
        );
      }
      continue;
    }
    if (parsedEvidence.status === "invalid") {
      throw invalidStoredActivitySessionEvidenceError(parsedEvidence.reason);
    }
    const evidence = parsedEvidence.evidence;
    const provider = storedRowProvider(row);
    const summary = parseStoredWearableSummary<ProjectedWearableActivitySummary>(
      "activity",
      row.summaryJson,
    );
    if (
      !provider
      || !row.summaryDate
      || !summary
      || (
        evidence.length > 0
          ? !storedActivitySummaryHasSessionSelection(summary)
          : storedActivitySummaryHasSessionOwnedBranch(summary)
      )
      || evidence.some((session) =>
        session.date !== row.summaryDate
        || normalizeWearableProviders([session.provider])[0] !== provider
      )
    ) {
      throw invalidStoredActivitySessionEvidenceError("malformed");
    }
    const evidenceKey = activitySessionEvidenceKey(provider, row.summaryDate);
    if (evidenceByProviderDate.has(evidenceKey)) {
      throw invalidStoredActivitySessionEvidenceError("malformed");
    }
    evidenceByProviderDate.set(evidenceKey, evidence);
    addStoredActivitySessionEvidenceMode(
      evidenceModeByDate,
      row.summaryDate,
      "current",
    );
  }

  return evidenceByProviderDate;
}

function addStoredActivitySessionEvidenceMode(
  modeByDate: Map<string, "current" | "legacy">,
  date: string,
  mode: "current" | "legacy",
): void {
  const existingMode = modeByDate.get(date);
  if (existingMode && existingMode !== mode) {
    throw new Error(
      "Stored activity-session reconciliation evidence mixes current and legacy rows for one date; "
      + "rebuild the query projection.",
    );
  }
  modeByDate.set(date, mode);
}

function storedActivityRowHasSessionSelection(
  row: QueryWearableSummaryRow,
): boolean {
  const summary = parseStoredWearableSummary<ProjectedWearableActivitySummary>(
    "activity",
    row.summaryJson,
  );
  return summary ? storedActivitySummaryHasSessionSelection(summary) : false;
}

function storedActivitySummaryHasSessionSelection(
  summary: ProjectedWearableActivitySummary,
): boolean {
  const sessionMinutes = summary?.sessionMinutes?.selection?.value;
  const sessionCount = summary?.sessionCount?.selection?.value;
  return (
    typeof sessionMinutes === "number"
    && Number.isFinite(sessionMinutes)
    && sessionMinutes > 0
  ) || (
    typeof sessionCount === "number"
    && Number.isFinite(sessionCount)
    && sessionCount > 0
  );
}

function storedActivitySummaryHasSessionOwnedBranch(
  summary: ProjectedWearableActivitySummary,
): boolean {
  if (
    storedActivitySummaryHasSessionSelection(summary)
    || summary.activityTypes.length > 0
    || summary.heartRateZones.length > 0
  ) {
    return true;
  }

  return activityResolvedMetrics(summary).some((metric) =>
    metric.selection.sourceKind === "activity-session-aggregate"
    || metric.selection.sourceKind === "activity-session-day-rollup"
  );
}

function storedRowProvider(row: QueryWearableSummaryRow): string | undefined {
  const providerScope = parseJsonValue<unknown>(row.providerScopeJson, null);
  const providers = Array.isArray(providerScope)
    ? normalizeWearableProviders(providerScope.filter((value): value is string => typeof value === "string"))
    : [];
  return providers.length === 1 ? providers[0] : undefined;
}

function invalidStoredActivityMetricEvidenceError(): Error {
  return new Error(
    "Stored activity metric ranking evidence is malformed; rebuild the query projection.",
  );
}

function invalidStoredActivitySessionEvidenceError(
  reason: "empty" | "malformed",
): Error {
  return new Error(
    `Stored activity-session reconciliation evidence is ${reason}; rebuild the query projection.`,
  );
}

function activitySessionEvidenceKey(provider: string, date: string): string {
  return `${provider}\u0000${date}`;
}

function projectedActivityMetricCandidates(
  evidence: readonly WearableActivityMetricEvidence[],
): WearableMetricCandidate[] {
  return evidence.map((candidate) => {
    const dataOrigin = storedActivityMetricEvidenceDataOrigin(candidate);
    const externalRef = {
      facet: candidate.hasDayStrainFacet ? "day-strain" : null,
      resourceId: candidate.exactKey,
      resourceType: storedActivityMetricEvidenceResourceType(candidate),
      system: candidate.provider,
      version: null,
    };

    return {
      candidateId: candidate.candidateKey,
      dataOrigin,
      date: candidate.date,
      externalRef,
      metric: candidate.metric,
      occurredAt: candidate.occurredAt,
      paths: [],
      provider: candidate.provider,
      recordedAt: candidate.recordedAt,
      recordIds: [candidate.candidateKey],
      sourceFamily: candidate.sourceFamily,
      sourceKind: candidate.sourceKind,
      title: storedActivityMetricEvidenceTitle(candidate),
      unit: candidate.unit,
      value: candidate.value,
    };
  });
}

function storedActivityMetricEvidenceTitle(
  evidence: WearableActivityMetricEvidence,
): string {
  return `${formatProviderName(evidence.publicProvider)} ${formatMetricLabel(evidence.metric)}`;
}

function storedActivityMetricEvidenceDataOrigin(
  evidence: WearableActivityMetricEvidence,
): WearableMetricCandidate["dataOrigin"] {
  const { aggregatorProvider, sourceProviderSlug, sourceType } = evidence.origin;
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

function storedActivityMetricEvidenceResourceType(
  evidence: WearableActivityMetricEvidence,
): string | null {
  switch (evidence.resourceClass) {
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

function resolveStoredActivityMetricEvidencePublicProvider(
  evidence: WearableActivityMetricEvidence,
): string {
  return resolveWearablePublicSourceProvider({
    dataOrigin: storedActivityMetricEvidenceDataOrigin(evidence),
    externalRef: {
      facet: evidence.hasDayStrainFacet ? "day-strain" : null,
      resourceId: evidence.exactKey,
      resourceType: storedActivityMetricEvidenceResourceType(evidence),
      system: evidence.provider,
      version: null,
    },
    provider: evidence.provider,
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
  const projectedRecordIds = projectedMetricRecordIds({
    date,
    provider,
    resolved,
    selectionRecordIds: selection.recordIds,
    summaryKind,
  });

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
    recordIds: projectedRecordIds,
    sourceFamily: projectedSourceFamily(selection.sourceFamily),
    sourceKind: selection.sourceKind ?? `projected-${summaryKind}`,
    title: selection.title,
    unit: selection.unit,
    value: selection.value,
  };
}

function projectedActivitySessionAggregate(
  summary: ProjectedWearableActivitySummary,
  options: {
    includeWorkoutMetrics: boolean;
  },
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

  const workoutMetricValues = options.includeWorkoutMetrics
    ? projectedActivitySessionWorkoutMetricValues(summary)
    : {};

  return {
    activityTypes: [...summary.activityTypes],
    candidateId: `projected:activity-session:${provider}:${summary.date}`,
    dataOrigin: null,
    date: summary.date,
    heartRateZones: (summary.heartRateZones ?? []).map((zone) => ({ ...zone })),
    paths: [],
    provider,
    recordedAt: latestNullableIso([
      summary.sessionMinutes.selection.recordedAt,
      summary.sessionCount.selection.recordedAt,
    ]),
    recordIds: [projectedActivitySessionRecordId(provider, summary.date)],
    sessionCount,
    sessionMinutes,
    sourceKind: summary.sessionMinutes.selection.sourceKind === "activity-session-day-rollup"
      ? "activity-session-day-rollup"
      : "activity-session-aggregate",
    workoutMetricKeys: Object.keys(workoutMetricValues),
    workoutMetricValues,
  };
}

function projectedActivitySessionWorkoutMetricValues(
  summary: ProjectedWearableActivitySummary,
): NonNullable<WearableActivitySessionAggregate["workoutMetricValues"]> {
  const values: NonNullable<WearableActivitySessionAggregate["workoutMetricValues"]> = {};
  for (const [metric, resolved] of [
    ["activeCalories", summary.activeCalories],
    ["distanceKm", summary.distanceKm],
    ["maxHeartRate", summary.maxHeartRate],
    ["totalElevationGainMeters", summary.totalElevationGainMeters],
    ["workoutStrain", summary.workoutStrain],
  ] as const) {
    if (
      (
        resolved.selection.sourceKind === "activity-session-aggregate"
        || resolved.selection.sourceKind === "activity-session-day-rollup"
      )
      && resolved.selection.value !== null
      && Number.isFinite(resolved.selection.value)
    ) {
      values[metric] = resolved.selection.value;
    }
  }
  return values;
}

function projectedMetricRecordIds(input: {
  date: string;
  provider: string;
  resolved: WearableResolvedMetric;
  selectionRecordIds: readonly string[];
  summaryKind: string;
}): string[] {
  if (input.selectionRecordIds.length > 0) {
    return [...input.selectionRecordIds];
  }
  if (
    input.summaryKind === "activity"
    && input.resolved.selection.sourceFamily === "derived"
    && (
      input.resolved.selection.sourceKind === "activity-session-aggregate"
      || input.resolved.selection.sourceKind === "activity-session-day-rollup"
    )
  ) {
    return [projectedActivitySessionRecordId(input.provider, input.date)];
  }
  return [];
}

function projectedActivitySessionRecordId(provider: string, date: string): string {
  return `projected:activity-session:${provider}:${date}`;
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

function activityResolvedMetrics(
  summary: ProjectedWearableActivitySummary | WearableActivityDay,
): WearableResolvedMetric[] {
  return [
    summary.activityScore,
    summary.activeCalories,
    summary.altitudeChangeMeters,
    summary.dayStrain,
    summary.distanceKm,
    summary.estimatedVo2Max,
    summary.floorsClimbed,
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
    summary.leanBodyMassKg,
    summary.temperature,
    summary.waistCircumference,
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
