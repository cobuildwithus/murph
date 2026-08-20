import type { VaultReadModel } from "../read-model.ts";
import {
  buildWearableSummaryBundleFromDataset,
  type WearableSummaryBundle,
} from "../wearables.ts";
import {
  activitySessionCandidateDurationIsConsistent,
  activitySessionCandidateReconciliationTimestamps,
  buildActivitySessionDayRollups,
  buildActivitySessionStableResourceIdentity,
  collectWearableDataset,
} from "../wearables/candidates.ts";
import { buildCandidateExactKey } from "../wearables/dedupe.ts";
import {
  normalizeWearableOriginSourceSlug,
  resolveWearablePublicSourceProvider,
} from "../wearables/origin.ts";
import { normalizeLowercaseString } from "../wearables/shared.ts";
import type {
  WearableActivityMetricCandidateEvidence,
  WearableActivityMetricResourceClass,
  WearableActivitySessionEvidence,
  WearableActivitySessionAggregate,
  WearableDataset,
  WearableMetricCandidate,
  WearableSleepWindowCandidate,
} from "../wearables/types.ts";
import {
  ACTIVITY_METRIC_KEYS,
  isActivitySummaryMetricCandidate,
} from "../wearables/types.ts";
import {
  normalizeWearableProviders,
  wearableProviderRowKey,
} from "./provider-scope.ts";
import { stringifyPublicWearableProjectionSummary } from "./wearable-summary-public-json.ts";
import {
  stringifyStoredWearableProjectionSummary,
  type StoredWearableMetricSummaryKind,
} from "./wearable-summary-stored-codec.ts";
import type { QueryWearableSummaryRow } from "./wearable-summary-store.ts";

export function buildWearableSummaryProjection(vault: VaultReadModel): QueryWearableSummaryRow[] {
  const dataset = collectWearableDataset(vault, {});
  return buildWearableSummaryProjectionFromDataset(dataset);
}

export function buildWearableSummaryProjectionFromDataset(dataset: WearableDataset): QueryWearableSummaryRow[] {
  const datasetsByProvider = groupWearableDatasetByPublicProvider(dataset);
  const providers = normalizeWearableProviders([...datasetsByProvider.keys()]);
  const activityCandidates = dataset.metricCandidates.filter(isActivitySummaryMetricCandidate);
  const activityMetricEvidenceKeys = buildActivityMetricEvidenceKeys(
    activityCandidates,
  );
  const activityMetricCandidates = buildStoredActivityMetricCandidates(
    activityCandidates,
    activityMetricEvidenceKeys,
  );

  return providers.flatMap((provider) => {
    const providerDataset = datasetsByProvider.get(provider) ?? emptyWearableDataset();
    return materializeWearableSummaryRows(
      provider,
      buildWearableSummaryBundleFromDataset(providerDataset),
      groupActivityMetricCandidatesByDate(
        activityMetricCandidates.filter(
          (candidate) => candidate.publicProvider === provider,
        ),
      ),
      groupActivitySessionEvidenceByDate(
        buildStoredActivitySessionEvidence(providerDataset.activitySessionCandidates),
      ),
    );
  });
}

interface ActivityMetricEvidenceKeys {
  candidateKeys: ReadonlyMap<string, string>;
  exactKeys: ReadonlyMap<string, string>;
}

function buildActivityMetricEvidenceKeys(
  candidates: readonly WearableMetricCandidate[],
): ActivityMetricEvidenceKeys {
  const candidateIds = [...new Set(
    candidates.map((candidate) => candidate.candidateId),
  )].sort();
  const exactKeys = [...new Set(candidates.map(buildCandidateExactKey))].sort();

  return {
    candidateKeys: new Map(candidateIds.map((candidateId, index) => [
      candidateId,
      `activity-metric-candidate:${String(index).padStart(10, "0")}`,
    ])),
    exactKeys: new Map(exactKeys.map((exactKey, index) => [
      exactKey,
      `activity-metric-exact:${String(index).padStart(10, "0")}`,
    ])),
  };
}

function buildStoredActivityMetricCandidates(
  candidates: readonly WearableMetricCandidate[],
  keys: ActivityMetricEvidenceKeys,
): WearableActivityMetricCandidateEvidence[] {
  return candidates.flatMap((candidate) => {
    const metric = [...ACTIVITY_METRIC_KEYS].find(
      (key) => key === candidate.metric,
    );
    if (!metric) {
      return [];
    }

    const candidateKey = keys.candidateKeys.get(candidate.candidateId);
    const exactKey = keys.exactKeys.get(buildCandidateExactKey(candidate));
    if (!candidateKey || !exactKey) {
      throw new Error("Activity metric evidence key was not initialized.");
    }

    const provider = normalizeLowercaseString(candidate.provider) ?? "unknown";
    const publicProvider = resolveMetricCandidatePublicProvider(candidate);
    const isJunction = provider === "junction";
    return [{
      candidateKey,
      date: candidate.date,
      exactKey,
      hasDayStrainFacet:
        normalizeLowercaseString(candidate.externalRef?.facet) === "day-strain",
      metric,
      occurredAt: candidate.occurredAt,
      origin: {
        aggregatorProvider:
          normalizeWearableOriginSourceSlug(
            candidate.dataOrigin?.aggregatorProvider,
          ) ?? (isJunction ? "junction" : null),
        sourceProviderSlug:
          normalizeWearableOriginSourceSlug(
            candidate.dataOrigin?.sourceProviderSlug,
          ) ?? (isJunction && publicProvider !== "unknown" ? publicProvider : null),
        sourceType: normalizeWearableOriginSourceSlug(
          candidate.dataOrigin?.sourceType,
        ),
      },
      provider,
      publicProvider,
      recordedAt: candidate.recordedAt,
      resourceClass: activityMetricResourceClass(candidate),
      sourceFamily: candidate.sourceFamily,
      sourceKind: candidate.sourceKind,
      unit: candidate.unit,
      value: candidate.value,
    }];
  });
}

function activityMetricResourceClass(
  candidate: WearableMetricCandidate,
): WearableActivityMetricResourceClass {
  const resourceType = normalizeLowercaseString(
    candidate.externalRef?.resourceType,
  );
  if (!resourceType) {
    return "none";
  }
  if (resourceType === "cycle") {
    return "cycle";
  }
  if (
    resourceType.includes("activity")
    || resourceType.includes("cycle")
    || resourceType.includes("summary")
  ) {
    return "activity";
  }
  return "generic";
}

function groupActivityMetricCandidatesByDate(
  evidence: readonly WearableActivityMetricCandidateEvidence[],
): Map<string, readonly WearableActivityMetricCandidateEvidence[]> {
  const byDate =
    new Map<string, WearableActivityMetricCandidateEvidence[]>();
  for (const candidate of evidence) {
    const candidates = byDate.get(candidate.date) ?? [];
    candidates.push(candidate);
    byDate.set(candidate.date, candidates);
  }
  return byDate;
}
function buildStoredActivitySessionEvidence(
  candidates: readonly WearableMetricCandidate[],
): WearableActivitySessionEvidence[] {
  // Store every pre-heuristic candidate. Provider-local overlap reduction is
  // not associative, so reducing here and again during cross-provider compose
  // can produce a different result from the live global reduction.
  const resourceTokens = new Map(
    [...new Set(candidates.flatMap((candidate) => {
      const resourceIdentity = buildActivitySessionStableResourceIdentity(candidate);
      return resourceIdentity ? [resourceIdentity] : [];
    }))].sort().map((resourceIdentity, index) => [
      resourceIdentity,
      `activity-session-resource:${String(index).padStart(10, "0")}`,
    ]),
  );

  return candidates.map((candidate) => {
    if (!candidate.reconciliationExactKey) {
      throw new Error("Activity-session candidate is missing its internal reconciliation key.");
    }
    const timestamps = activitySessionCandidateReconciliationTimestamps(candidate);

    return {
      activityType: candidate.activityType ?? null,
      date: candidate.date,
      durationMinutes: candidate.value,
      durationConsistent: activitySessionCandidateDurationIsConsistent(candidate),
      endedAt: timestamps.endedAt,
      heartRateZones: (candidate.heartRateZones ?? []).map((zone) => ({ ...zone })),
      provider: resolveWearablePublicSourceProvider({
        dataOrigin: candidate.dataOrigin ?? null,
        externalRef: candidate.externalRef,
        provider: candidate.provider,
      }, {
        suppressJunctionSourceInstanceFallback: true,
      }),
      reconciliationExactKey: candidate.reconciliationExactKey,
      reconciliationResourceKey:
        resourceTokens.get(buildActivitySessionStableResourceIdentity(candidate) ?? "")
        ?? null,
      recordedAt: candidate.recordedAt,
      startedAt: timestamps.startedAt,
      workoutMetricKeys: [...(candidate.workoutMetricKeys ?? [])],
      workoutMetricValues: { ...(candidate.workoutMetricValues ?? {}) },
    };
  });
}

function groupActivitySessionEvidenceByDate(
  evidence: readonly WearableActivitySessionEvidence[],
): Map<string, readonly WearableActivitySessionEvidence[]> {
  const byDate = new Map<string, WearableActivitySessionEvidence[]>();
  for (const session of evidence) {
    const sessions = byDate.get(session.date) ?? [];
    sessions.push(session);
    byDate.set(session.date, sessions);
  }
  return byDate;
}

type MutableWearableDataset = {
  activitySessionCandidates: WearableMetricCandidate[];
  activitySessionAggregates: WearableActivitySessionAggregate[];
  activitySessionDayRollups: WearableActivitySessionAggregate[];
  metricSuppressionEvidence: WearableDataset["metricSuppressionEvidence"][number][];
  metricCandidates: WearableMetricCandidate[];
  provenanceDiagnostics: WearableDataset["provenanceDiagnostics"][number][];
  rawMetricCandidates: WearableMetricCandidate[];
  sleepWindows: WearableSleepWindowCandidate[];
  workoutFeatures: WearableDataset["workoutFeatures"][number][];
};

function groupWearableDatasetByPublicProvider(dataset: WearableDataset): Map<string, WearableDataset> {
  const grouped = new Map<string, MutableWearableDataset>();
  const activitySessionReconciliationKeys = buildActivitySessionReconciliationKeys(
    dataset.activitySessionCandidates,
  );
  const ensureProviderDataset = (provider: string): MutableWearableDataset => {
    const normalizedProvider = normalizeWearableProviders([provider])[0] ?? "unknown";
    const existing = grouped.get(normalizedProvider);
    if (existing) {
      return existing;
    }

    const empty = emptyWearableDataset();
    grouped.set(normalizedProvider, empty);
    return empty;
  };

  for (const candidate of dataset.metricCandidates) {
    const provider = resolveMetricCandidatePublicProvider(candidate);
    ensureProviderDataset(provider).metricCandidates.push(projectUnknownWearableMetricCandidateProvider(candidate, provider));
  }
  for (const candidate of dataset.rawMetricCandidates) {
    const provider = resolveMetricCandidatePublicProvider(candidate);
    ensureProviderDataset(provider).rawMetricCandidates.push(projectUnknownWearableMetricCandidateProvider(candidate, provider));
  }
  for (const aggregate of dataset.activitySessionAggregates) {
    const provider = resolveWearableDatasetItemPublicProvider(aggregate);
    ensureProviderDataset(provider).activitySessionAggregates.push(projectUnknownWearableAggregateProvider(aggregate, provider));
  }
  for (const candidate of dataset.activitySessionCandidates) {
    const provider = resolveMetricCandidatePublicProvider(candidate);
    const projectedCandidate = projectUnknownWearableMetricCandidateProvider(candidate, provider);
    const exactKey = candidate.reconciliationExactKey ?? buildCandidateExactKey(candidate);
    const reconciliationExactKey = activitySessionReconciliationKeys.get(exactKey);
    if (!reconciliationExactKey) {
      throw new Error("Activity-session reconciliation key was not initialized.");
    }
    ensureProviderDataset(provider).activitySessionCandidates.push({
      ...projectedCandidate,
      reconciliationExactKey,
    });
  }
  for (const window of dataset.sleepWindows) {
    const provider = resolveWearableDatasetItemPublicProvider(window);
    ensureProviderDataset(provider).sleepWindows.push(projectUnknownWearableSleepWindowProvider(window, provider));
  }
  for (const diagnostic of dataset.provenanceDiagnostics) {
    const provider = resolveProjectionDiagnosticProvider(diagnostic.provider, grouped);
    ensureProviderDataset(provider).provenanceDiagnostics.push({
      ...diagnostic,
      provider: provider === "unknown" ? null : provider,
    });
  }
  for (const candidate of dataset.workoutFeatures) {
    ensureProviderDataset(candidate.feature.provider).workoutFeatures.push(candidate);
  }

  for (const providerDataset of grouped.values()) {
    providerDataset.activitySessionDayRollups = buildActivitySessionDayRollups(
      providerDataset.activitySessionCandidates,
    );
  }

  return grouped;
}

function buildActivitySessionReconciliationKeys(
  candidates: readonly WearableMetricCandidate[],
): Map<string, string> {
  // Preserve exact-key equality and ordering without persisting the raw key,
  // which can contain provider resource or device-instance identifiers.
  const exactKeys = [...new Set(candidates.map((candidate) =>
    candidate.reconciliationExactKey ?? buildCandidateExactKey(candidate)
  ))].sort();

  return new Map(exactKeys.map((exactKey, index) => [
    exactKey,
    `activity-session-exact:${String(index).padStart(10, "0")}`,
  ]));
}

function emptyWearableDataset(): MutableWearableDataset {
  return {
    activitySessionCandidates: [],
    activitySessionAggregates: [],
    activitySessionDayRollups: [],
    metricSuppressionEvidence: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
    workoutFeatures: [],
  };
}

function resolveMetricCandidatePublicProvider(candidate: WearableMetricCandidate): string {
  return resolveProjectionPublicProvider(candidate);
}

function resolveWearableDatasetItemPublicProvider(
  item: WearableActivitySessionAggregate | WearableSleepWindowCandidate,
): string {
  return resolveProjectionPublicProvider(item);
}

function resolveProjectionPublicProvider(
  input: WearableActivitySessionAggregate | WearableMetricCandidate | WearableSleepWindowCandidate,
): string {
  return resolveWearablePublicSourceProvider({
    dataOrigin: input.dataOrigin ?? null,
    externalRef: "externalRef" in input ? input.externalRef : null,
    provider: input.provider,
  }, {
    suppressJunctionSourceInstanceFallback: true,
  });
}

function resolveProjectionDiagnosticProvider(
  provider: string | null,
  grouped: ReadonlyMap<string, WearableDataset>,
): string {
  const normalizedProvider = normalizeWearableProviders(provider ? [provider] : [])[0];
  return normalizedProvider && grouped.has(normalizedProvider) ? normalizedProvider : "unknown";
}

function projectUnknownWearableMetricCandidateProvider(
  candidate: WearableMetricCandidate,
  provider: string,
): WearableMetricCandidate {
  if (provider !== "unknown") {
    return candidate;
  }

  return {
    ...candidate,
    dataOrigin: projectUnknownWearableDataOrigin(candidate.dataOrigin),
    provider,
  };
}

function projectUnknownWearableAggregateProvider(
  aggregate: WearableActivitySessionAggregate,
  provider: string,
): WearableActivitySessionAggregate {
  if (provider !== "unknown") {
    return aggregate;
  }

  return {
    ...aggregate,
    dataOrigin: projectUnknownWearableDataOrigin(aggregate.dataOrigin),
    provider,
  };
}

function projectUnknownWearableSleepWindowProvider(
  window: WearableSleepWindowCandidate,
  provider: string,
): WearableSleepWindowCandidate {
  if (provider !== "unknown") {
    return window;
  }

  return {
    ...window,
    dataOrigin: projectUnknownWearableDataOrigin(window.dataOrigin),
    provider,
  };
}

function projectUnknownWearableDataOrigin(
  origin: WearableMetricCandidate["dataOrigin"],
): WearableMetricCandidate["dataOrigin"] {
  if (!origin) {
    return origin;
  }

  const { sourceInstanceId: _sourceInstanceId, ...publicOrigin } = origin;
  return publicOrigin;
}

function materializeWearableSummaryRows(
  provider: string,
  bundle: WearableSummaryBundle,
  activityMetricCandidatesByDate: ReadonlyMap<
    string,
    readonly WearableActivityMetricCandidateEvidence[]
  >,
  activitySessionEvidenceByDate: ReadonlyMap<
    string,
    readonly WearableActivitySessionEvidence[]
  >,
): QueryWearableSummaryRow[] {
  const rows: QueryWearableSummaryRow[] = [];
  const providerScopeKey = wearableProviderRowKey(provider);
  const providerScopeJson = JSON.stringify([provider]);
  const push = <TSummary extends { date: string }>(
    summaryKind: StoredWearableMetricSummaryKind,
    summaries: readonly TSummary[],
  ) => {
    summaries.forEach((summary, index) => {
      const activityMetricCandidatesForDate = summaryKind === "activity"
        ? activityMetricCandidatesByDate.get(summary.date) ?? []
        : [];
      const activityEvidenceForDate = summaryKind === "activity"
        ? activitySessionEvidenceByDate.get(summary.date) ?? []
        : [];
      rows.push({
        id: `${providerScopeKey}:${summaryKind}:${summary.date}:${index}`,
        providerScopeJson,
        providerScopeKey,
        sortRank: index,
        summaryDate: summary.date,
        summaryJson: stringifyStoredWearableProjectionSummary(
          summaryKind,
          summary,
          summaryKind === "activity"
              ? {
                  activityEvidence: {
                    metricCandidates: activityMetricCandidatesForDate,
                    sessions: activityEvidenceForDate,
                  },
                }
            : {},
        ),
        summaryKind,
      });
    });
  };

  push("activity", bundle.activityDays);
  push("body_state", bundle.bodyStateDays);
  push("recovery", bundle.recoveryDays);
  push("sleep", bundle.sleepNights);

  bundle.sourceHealth
    .filter((summary) => normalizeWearableProviders([summary.provider])[0] === provider)
    .forEach((summary, index) => {
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
