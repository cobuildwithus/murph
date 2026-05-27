import type { VaultReadModel } from "../read-model.ts";
import {
  buildWearableSummaryBundleFromDataset,
  type WearableSummaryBundle,
} from "../wearables.ts";
import { collectWearableDataset } from "../wearables/candidates.ts";
import {
  inferJunctionWearableDataOriginFromExternalRef,
  normalizeWearableOriginSourceSlug,
} from "../wearables/origin.ts";
import type {
  WearableActivitySessionAggregate,
  WearableDataset,
  WearableExternalRef,
  WearableMetricCandidate,
  WearableSleepWindowCandidate,
} from "../wearables/types.ts";
import {
  normalizeWearableProviders,
  wearableProviderRowKey,
} from "./provider-scope.ts";
import { stringifyPublicWearableProjectionSummary } from "./wearable-summary-public-json.ts";
import type {
  QueryWearableSummaryKind,
  QueryWearableSummaryRow,
} from "./wearable-summary-store.ts";

export function buildWearableSummaryProjection(vault: VaultReadModel): QueryWearableSummaryRow[] {
  const dataset = collectWearableDataset(vault, {});
  const allBundle = buildWearableSummaryBundleFromDataset(dataset);
  const datasetsByProvider = groupWearableDatasetByPublicProvider(dataset);
  const providers = normalizeWearableProviders(allBundle.sourceHealth.map((entry) => entry.provider));

  return providers.flatMap((provider) =>
    materializeWearableSummaryRows(
      provider,
      buildWearableSummaryBundleFromDataset(datasetsByProvider.get(provider) ?? emptyWearableDataset()),
    )
  );
}

type MutableWearableDataset = {
  activitySessionAggregates: WearableActivitySessionAggregate[];
  metricCandidates: WearableMetricCandidate[];
  provenanceDiagnostics: WearableDataset["provenanceDiagnostics"][number][];
  rawMetricCandidates: WearableMetricCandidate[];
  sleepWindows: WearableSleepWindowCandidate[];
};

function groupWearableDatasetByPublicProvider(dataset: WearableDataset): Map<string, WearableDataset> {
  const grouped = new Map<string, MutableWearableDataset>();
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
    ensureProviderDataset(provider).metricCandidates.push(projectWearableMetricCandidateProvider(candidate, provider));
  }
  for (const candidate of dataset.rawMetricCandidates) {
    const provider = resolveMetricCandidatePublicProvider(candidate);
    ensureProviderDataset(provider).rawMetricCandidates.push(projectWearableMetricCandidateProvider(candidate, provider));
  }
  for (const aggregate of dataset.activitySessionAggregates) {
    const provider = resolveWearableDatasetItemPublicProvider(aggregate);
    ensureProviderDataset(provider).activitySessionAggregates.push(projectWearableAggregateProvider(aggregate, provider));
  }
  for (const window of dataset.sleepWindows) {
    const provider = resolveWearableDatasetItemPublicProvider(window);
    ensureProviderDataset(provider).sleepWindows.push(projectWearableSleepWindowProvider(window, provider));
  }
  for (const diagnostic of dataset.provenanceDiagnostics) {
    const provider = resolveProjectionDiagnosticProvider(diagnostic.provider, grouped);
    ensureProviderDataset(provider).provenanceDiagnostics.push({
      ...diagnostic,
      provider: provider === "unknown" ? null : provider,
    });
  }

  return grouped;
}

function emptyWearableDataset(): MutableWearableDataset {
  return {
    activitySessionAggregates: [],
    metricCandidates: [],
    provenanceDiagnostics: [],
    rawMetricCandidates: [],
    sleepWindows: [],
  };
}

function resolveMetricCandidatePublicProvider(candidate: WearableMetricCandidate): string {
  return resolveProjectionPublicProvider({
    dataOrigin: candidate.dataOrigin ?? null,
    externalRef: candidate.externalRef,
    provider: candidate.provider,
  });
}

function resolveWearableDatasetItemPublicProvider(
  item: WearableActivitySessionAggregate | WearableSleepWindowCandidate,
): string {
  return resolveProjectionPublicProvider({
    dataOrigin: item.dataOrigin ?? null,
    provider: item.provider,
  });
}

function resolveProjectionPublicProvider(input: {
  dataOrigin?: WearableMetricCandidate["dataOrigin"];
  externalRef?: WearableExternalRef | null;
  provider?: string | null;
}): string {
  const originSourceProvider = normalizeWearableOriginSourceSlug(input.dataOrigin?.sourceProviderSlug);
  if (originSourceProvider && originSourceProvider !== "junction") {
    return originSourceProvider;
  }

  const inferredSourceProvider = normalizeWearableOriginSourceSlug(
    inferJunctionWearableDataOriginFromExternalRef(input.externalRef ?? null)?.sourceProviderSlug,
  );
  if (inferredSourceProvider && inferredSourceProvider !== "junction") {
    return inferredSourceProvider;
  }

  const directProvider = normalizeWearableProviders([input.provider ?? input.externalRef?.system ?? ""])[0];
  if (directProvider && directProvider !== "junction") {
    return directProvider;
  }

  return "unknown";
}

function resolveProjectionDiagnosticProvider(
  provider: string | null,
  grouped: ReadonlyMap<string, WearableDataset>,
): string {
  const normalizedProvider = normalizeWearableProviders(provider ? [provider] : [])[0];
  return normalizedProvider && grouped.has(normalizedProvider) ? normalizedProvider : "unknown";
}

function projectWearableMetricCandidateProvider(
  candidate: WearableMetricCandidate,
  provider: string,
): WearableMetricCandidate {
  return {
    ...candidate,
    dataOrigin: projectWearableDataOrigin(candidate.dataOrigin, provider),
    provider,
  };
}

function projectWearableAggregateProvider(
  aggregate: WearableActivitySessionAggregate,
  provider: string,
): WearableActivitySessionAggregate {
  return {
    ...aggregate,
    dataOrigin: projectWearableDataOrigin(aggregate.dataOrigin, provider),
    provider,
  };
}

function projectWearableSleepWindowProvider(
  window: WearableSleepWindowCandidate,
  provider: string,
): WearableSleepWindowCandidate {
  return {
    ...window,
    dataOrigin: projectWearableDataOrigin(window.dataOrigin, provider),
    provider,
  };
}

function projectWearableDataOrigin<TOrigin extends WearableMetricCandidate["dataOrigin"]>(
  origin: TOrigin,
  provider: string,
): TOrigin {
  if (provider !== "unknown" || !origin) {
    return origin;
  }

  const { sourceInstanceId: _sourceInstanceId, ...publicOrigin } = origin;
  return publicOrigin as TOrigin;
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
    summaries.forEach((summary, index) => {
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
