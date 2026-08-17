import {
  type OverviewExperiment,
} from "@murphai/query/browser-overview";
import type {
  BrowserVaultCoreCapableQueryClient,
  BrowserVaultExperimentRunCard,
  BrowserVaultMetricsCapableQueryClient,
} from "@murphai/query/browser-replica-client";

import { formatIsoDate, formatStatusLabel } from "@/src/lib/browser-vault/display";
import { normalizeExperimentRunStatus } from "@/src/lib/browser-vault/experiment-status";
import {
  buildBrowserVaultExperimentResultLookups,
  resolveBrowserVaultExperimentRun,
  resolveBrowserVaultExperimentRunById,
} from "@/src/lib/browser-vault/experiment-run";
import { resolveExperimentRunCardDailyCadence } from "@/src/lib/experiments/run-card-daily-cadence";
import {
  buildExperimentRunCardSummary,
  projectBrowserVaultExperimentRunCardSummary,
  type ExperimentRunCardSummary,
} from "@/src/lib/experiments/run-card-summary";
import type { ExperimentProtocol, ExperimentRunProjection } from "@/src/types/experiments";

export type ExperimentCardStatusVariant = "default" | "secondary" | "outline" | "destructive";

export type ExperimentRunStatus = ExperimentRunProjection["status"];

export interface ExperimentLibraryCard {
  id: string;
  title: string;
  category: string;
  image: string;
  href: string | null;
  privateBadgeLabel?: string;
  matchPercent?: number;
  durationDays?: number;
  metadata?: string;
  statusLabel?: string;
  statusVariant?: ExperimentCardStatusVariant;
  description: string;
  hasPrivateData: boolean;
  runStatus?: ExperimentRunStatus;
  runSummary?: ExperimentRunCardSummary;
  searchText: string;
  startedOn?: string | null;
  trackedExperimentId?: string;
}

/**
 * Splits the member's own run cards into in-progress and history buckets.
 * History is sorted most recently started first so display caps keep the
 * runs that are most likely to matter.
 */
export function splitHomeExperimentCards(cards: ExperimentLibraryCard[]): {
  history: ExperimentLibraryCard[];
  inProgress: ExperimentLibraryCard[];
} {
  const inProgress: ExperimentLibraryCard[] = [];
  const history: ExperimentLibraryCard[] = [];

  for (const card of cards) {
    if (!card.hasPrivateData) {
      continue;
    }

    if (card.runStatus === "active" || card.runStatus === "paused") {
      inProgress.push(card);
    } else {
      history.push(card);
    }
  }

  history.sort((left, right) =>
    startedOnSortKey(right.startedOn).localeCompare(startedOnSortKey(left.startedOn))
  );

  return { history, inProgress };
}

function startedOnSortKey(startedOn: string | null | undefined): string {
  // Tracked runs can carry non-date placeholders such as "Undated"; only a
  // leading ISO date may win the most-recent-first ordering.
  return startedOn && /^\d{4}-\d{2}-\d{2}/u.test(startedOn) ? startedOn : "";
}

export function buildExperimentLibraryCards({
  client,
  protocols,
  trackedExperiments,
}: {
  client: BrowserVaultMetricsCapableQueryClient | null;
  protocols: ExperimentProtocol[];
  trackedExperiments: OverviewExperiment[];
}): ExperimentLibraryCard[] {
  const protocolCards = protocols.map((protocol) => {
    const privateRun = resolveBrowserVaultExperimentRun({ client, protocol });
    return protocolToCard(client, protocol, privateRun);
  });
  const matchedTrackedExperimentIds = new Set(
    protocolCards.flatMap((card) => card.trackedExperimentId ? [card.trackedExperimentId] : []),
  );
  const trackedOnlyCards = trackedExperiments
    .filter((entry) => !matchedTrackedExperimentIds.has(entry.id))
    .map((entry) => trackedExperimentToCard(
      client,
      entry,
      resolveBrowserVaultExperimentRunById({ client, experimentId: entry.id }),
    ));

  return [...protocolCards, ...trackedOnlyCards].sort(compareExperimentCards);
}

/**
 * Home uses the compact producer-built summaries in core. Experiment detail
 * and the experiment library continue to resolve against the metrics shard.
 */
export function buildHomeExperimentLibraryCards({
  client,
  protocols,
  trackedExperiments,
}: {
  client: BrowserVaultCoreCapableQueryClient | null;
  protocols: ExperimentProtocol[];
  trackedExperiments: OverviewExperiment[];
}): ExperimentLibraryCard[] {
  const protocolCards = protocols.map((protocol) => {
    const privateRun = findProjectedRunForProtocol(client, protocol);
    return protocolToHomeCard(protocol, privateRun);
  });
  const matchedTrackedExperimentIds = new Set(
    protocolCards.flatMap((card) => card.trackedExperimentId ? [card.trackedExperimentId] : []),
  );
  const trackedOnlyCards = trackedExperiments
    .filter((entry) => !matchedTrackedExperimentIds.has(entry.id))
    .map((entry) => trackedExperimentToHomeCard(
      entry,
      client?.experimentRunCards.get(entry.id) ?? null,
    ));

  return [...protocolCards, ...trackedOnlyCards].sort(compareExperimentCards);
}

function findProjectedRunForProtocol(
  client: BrowserVaultCoreCapableQueryClient | null,
  protocol: ExperimentProtocol,
): BrowserVaultExperimentRunCard | null {
  if (!client) return null;
  for (const lookup of buildBrowserVaultExperimentResultLookups(protocol)) {
    const run = client.experimentRunCards.find(lookup);
    if (run) return run;
  }
  return null;
}

function protocolToHomeCard(
  protocol: ExperimentProtocol,
  privateRun: BrowserVaultExperimentRunCard | null,
): ExperimentLibraryCard {
  const startedOn = privateRun?.startedOn;
  const protocolDays = formatProtocolDays(protocol);
  const metadata = [
    startedOn ? `Started ${formatIsoDate(startedOn)}` : null,
    `${protocolDays} days`,
    protocol.researchSummaryLabel,
  ].filter((part): part is string => part !== null).join(" · ");

  return {
    id: protocol.id,
    title: protocol.title,
    category: protocol.category,
    image: protocol.image,
    href: `/experiments/${protocol.id}`,
    matchPercent: protocol.matchPercent,
    durationDays: protocolDays,
    metadata,
    privateBadgeLabel: privateRun ? "Private data" : undefined,
    statusLabel: privateRun?.statusLabel,
    statusVariant: privateRun ? statusVariantForRunStatus(privateRun.status) : undefined,
    description: privateRun?.summaryDetail ?? privateRun?.summary ?? protocol.description,
    hasPrivateData: privateRun !== null,
    runStatus: privateRun?.status,
    runSummary: privateRun
      ? projectBrowserVaultExperimentRunCardSummary(privateRun.runSummary)
      : undefined,
    startedOn,
    trackedExperimentId: privateRun?.id,
    searchText: [
      protocol.title,
      protocol.category,
      protocol.description,
      protocol.commons?.key,
      protocol.commons?.slug,
      ...(protocol.commons?.aliases ?? []),
      privateRun?.title,
      privateRun?.summary,
      ...(privateRun?.tags ?? []),
    ].filter((value): value is string => typeof value === "string").join(" "),
  };
}

function trackedExperimentToHomeCard(
  entry: OverviewExperiment,
  privateRun: BrowserVaultExperimentRunCard | null,
): ExperimentLibraryCard {
  const runStatus = privateRun?.status ?? runStatusForTrackedExperiment(entry);
  const startedOn = privateRun?.startedOn ?? entry.startedOn;
  const title = privateRun?.title || entry.title || entry.slug || entry.id;
  const metadata = [
    startedOn ? `Started ${formatIsoDate(startedOn)}` : null,
    "Private run only",
  ].filter((part): part is string => part !== null).join(" · ");

  return {
    id: entry.id,
    title,
    category: "Private",
    image: selectTrackedExperimentImage(entry),
    href: `/experiments/runs/${encodeURIComponent(entry.id)}`,
    privateBadgeLabel: "Private only",
    metadata,
    statusLabel: privateRun?.statusLabel ?? formatStatusLabel(entry.status),
    statusVariant: statusVariantForRunStatus(runStatus),
    description: entry.summary
      ?? privateRun?.summaryDetail
      ?? privateRun?.summary
      ?? "This experiment has private data saved on this device, but it doesn't match a public protocol page right now.",
    hasPrivateData: true,
    runStatus,
    runSummary: privateRun
      ? projectBrowserVaultExperimentRunCardSummary(privateRun.runSummary)
      : undefined,
    startedOn,
    trackedExperimentId: entry.id,
    searchText: [
      entry.id,
      entry.slug,
      entry.title,
      entry.summary,
      privateRun?.title,
      privateRun?.summary,
      ...(privateRun?.tags ?? []),
      ...entry.tags,
    ].filter((value): value is string => typeof value === "string").join(" "),
  };
}

function protocolToCard(
  client: BrowserVaultMetricsCapableQueryClient | null,
  protocol: ExperimentProtocol,
  privateRun: ExperimentRunProjection | null,
): ExperimentLibraryCard {
  const statusLabel = privateRun?.statusLabel;
  const startedOn = privateRun?.startedOn;
  const protocolDays = formatProtocolDays(protocol);
  const metadata = [
    startedOn ? `Started ${formatIsoDate(startedOn)}` : null,
    `${protocolDays} days`,
    protocol.researchSummaryLabel,
  ].filter((part): part is string => part !== null).join(" · ");
  const description = privateRun?.summaryDetail ?? privateRun?.summary ?? protocol.description;

  return {
    id: protocol.id,
    title: protocol.title,
    category: protocol.category,
    image: protocol.image,
    href: `/experiments/${protocol.id}`,
    matchPercent: protocol.matchPercent,
    durationDays: protocolDays,
    metadata,
    privateBadgeLabel: privateRun ? "Private data" : undefined,
    statusLabel,
    statusVariant: privateRun ? statusVariantForRunStatus(privateRun.status) : undefined,
    description,
    hasPrivateData: privateRun !== null,
    runStatus: privateRun?.status,
    runSummary: buildPrivateRunCardSummary(client, privateRun),
    startedOn,
    trackedExperimentId: privateRun?.id,
    searchText: [
      protocol.title,
      protocol.category,
      protocol.description,
      protocol.commons?.key,
      protocol.commons?.slug,
      ...(protocol.commons?.aliases ?? []),
      privateRun?.title,
      privateRun?.summary,
      ...(privateRun?.tags ?? []),
    ].filter((value): value is string => typeof value === "string").join(" "),
  };
}

function formatProtocolDays(protocol: ExperimentProtocol): number {
  return Math.max(1, protocol.durationDays - protocol.baselineDays);
}

function trackedExperimentToCard(
  client: BrowserVaultMetricsCapableQueryClient | null,
  entry: OverviewExperiment,
  privateRun: ExperimentRunProjection | null,
): ExperimentLibraryCard {
  const statusLabel = privateRun?.statusLabel ?? formatStatusLabel(entry.status);
  const title = privateRun?.title || entry.title || entry.slug || entry.id;
  const category = "Private";
  const startedOn = privateRun?.startedOn ?? entry.startedOn;
  const metadata = [
    startedOn ? `Started ${formatIsoDate(startedOn)}` : null,
    "Private run only",
  ].filter((part): part is string => part !== null).join(" · ");
  const runStatus = privateRun?.status ?? runStatusForTrackedExperiment(entry);

  return {
    id: entry.id,
    title,
    category,
    image: selectTrackedExperimentImage(entry),
    href: `/experiments/runs/${encodeURIComponent(entry.id)}`,
    privateBadgeLabel: "Private only",
    metadata,
    statusLabel,
    statusVariant: statusVariantForRunStatus(runStatus),
    description: entry.summary
      ?? privateRun?.summaryDetail
      ?? privateRun?.summary
      ?? "This experiment has private data saved on this device, but it doesn't match a public protocol page right now.",
    hasPrivateData: true,
    runStatus,
    runSummary: buildPrivateRunCardSummary(client, privateRun),
    startedOn,
    trackedExperimentId: entry.id,
    searchText: [
      entry.id,
      entry.slug,
      entry.title,
      entry.summary,
      privateRun?.title,
      privateRun?.summary,
      ...(privateRun?.tags ?? []),
      ...entry.tags,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  };
}

function buildPrivateRunCardSummary(
  client: BrowserVaultMetricsCapableQueryClient | null,
  privateRun: ExperimentRunProjection | null,
): ExperimentRunCardSummary | undefined {
  if (!privateRun) {
    return undefined;
  }

  const summary = buildExperimentRunCardSummary(privateRun);
  if (privateRun.status !== "active" && privateRun.status !== "paused") {
    return summary;
  }

  const dailyCadence = resolveExperimentRunCardDailyCadence({
    cadence: privateRun.schedule?.cadence,
    client,
    experimentId: privateRun.id,
  });

  return dailyCadence
    ? { ...summary, dailyCadence }
    : summary;
}

function compareExperimentCards(left: ExperimentLibraryCard, right: ExperimentLibraryCard): number {
  if (left.hasPrivateData !== right.hasPrivateData) {
    return left.hasPrivateData ? -1 : 1;
  }

  return left.title.localeCompare(right.title);
}

function statusVariantForRunStatus(status: ExperimentRunStatus): ExperimentCardStatusVariant {
  if (status === "active") {
    return "default";
  }

  if (status === "paused") {
    return "secondary";
  }

  if (status === "stopped") {
    return "destructive";
  }

  return "outline";
}

function runStatusForTrackedExperiment(entry: OverviewExperiment): ExperimentRunStatus {
  return normalizeExperimentRunStatus({
    fallback: "finished",
    status: entry.status,
  });
}

function selectTrackedExperimentImage(entry: OverviewExperiment): string {
  const lookup = [entry.id, entry.slug, entry.title, entry.summary, ...entry.tags]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (lookup.includes("red") || lookup.includes("sleep") || lookup.includes("circadian")) {
    return "/design-assets/hero-02.png";
  }

  if (lookup.includes("4x4") || lookup.includes("cardio") || lookup.includes("exercise")) {
    return "/design-assets/hero-03.png";
  }

  return "/design-assets/hero-sauna.png";
}
