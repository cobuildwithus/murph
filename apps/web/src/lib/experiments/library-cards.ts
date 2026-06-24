import type {
  BrowserVaultQueryClient,
  OverviewExperiment,
} from "@murphai/query/browser-overview";

import { formatIsoDate, formatStatusLabel } from "@/src/lib/browser-vault/display";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import { CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION } from "@/src/lib/experiments/experiment-detail";
import type {
  ExperimentProtocol,
  ExperimentRunProjection,
  ExperimentSignal,
  TrendData,
} from "@/src/types/experiments";

export type ExperimentCardStatusVariant = "default" | "secondary" | "destructive" | "outline";

export interface ExperimentRunCardSummary {
  completionPercent?: number;
  dateRange?: string;
  day?: number;
  primarySignal?: ExperimentSignal;
  primaryTrend?: TrendData;
}

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
  runStatus?: ExperimentRunProjection["status"];
  runSummary?: ExperimentRunCardSummary;
  searchText: string;
  startedOn?: string | null;
  trackedExperimentId?: string;
}

interface BuildExperimentLibraryCardsInput {
  client: BrowserVaultQueryClient | null;
  protocols: readonly ExperimentProtocol[];
  trackedExperiments: readonly OverviewExperiment[];
}

export function buildExperimentLibraryCards({
  client,
  protocols,
  trackedExperiments,
}: BuildExperimentLibraryCardsInput): ExperimentLibraryCard[] {
  const matchedTrackedIds = new Set<string>();
  const protocolCards = protocols.map((protocol) => {
    const match = trackedExperiments.find((entry) => matchesProtocol(entry, protocol));

    if (match) {
      matchedTrackedIds.add(match.id);
    }

    return protocolToCard(protocol, client, match);
  });
  const selectedImage = protocols[0]?.image ?? "/design-assets/hero-mountain.png";
  const trackedOnlyCards = trackedExperiments
    .filter((entry) => !matchedTrackedIds.has(entry.id))
    .map((entry) => trackedExperimentToCard(entry, selectedImage));

  return [...protocolCards, ...trackedOnlyCards].sort((left, right) => {
    if (left.hasPrivateData !== right.hasPrivateData) {
      return left.hasPrivateData ? -1 : 1;
    }

    return left.title.localeCompare(right.title);
  });
}

function protocolToCard(
  protocol: ExperimentProtocol,
  client: BrowserVaultQueryClient | null,
  trackedExperiment: OverviewExperiment | undefined,
): ExperimentLibraryCard {
  const privateRun = protocol.protocolContractVersion === CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION
    ? resolveBrowserVaultExperimentRun({
        client,
        protocol,
      })
    : null;
  const runStatus = privateRun?.status ?? runStatusForTrackedExperiment(trackedExperiment);
  const privateDescription = privateRun?.summaryDetail ?? privateRun?.summary;
  const statusLabel = privateRun?.statusLabel
    ?? (trackedExperiment?.status ? formatStatusLabel(trackedExperiment.status) : undefined);
  const startedOn = privateRun?.startedOn ?? trackedExperiment?.startedOn ?? null;
  const activeDays = Math.max(1, protocol.durationDays - protocol.baselineDays);
  const metadata = [
    startedOn ? `Started ${formatIsoDate(startedOn)}` : null,
    formatProtocolDays(activeDays),
    protocol.researchSummaryLabel,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return {
    category: protocol.category,
    description: privateDescription ?? protocol.description,
    durationDays: activeDays,
    hasPrivateData: Boolean(privateRun || trackedExperiment),
    href: `/experiments/${protocol.id}`,
    id: protocol.id,
    image: protocol.image,
    matchPercent: protocol.matchPercent,
    metadata,
    privateBadgeLabel: privateRun || trackedExperiment ? "Private data" : undefined,
    runStatus,
    runSummary: privateRun ? buildExperimentRunCardSummary(privateRun) : undefined,
    searchText: [
      protocol.title,
      protocol.category,
      privateDescription ?? protocol.description,
      statusLabel,
      trackedExperiment?.summary,
      ...(privateRun?.tags ?? []),
      ...(trackedExperiment?.tags ?? []),
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase(),
    startedOn,
    statusLabel,
    statusVariant: statusVariantForRun(runStatus),
    title: protocol.title,
    trackedExperimentId: trackedExperiment?.id,
  };
}

function trackedExperimentToCard(
  entry: OverviewExperiment,
  image: string,
): ExperimentLibraryCard {
  const startedOn = entry.startedOn;
  const metadata = [
    startedOn ? `Started ${formatIsoDate(startedOn)}` : null,
    entry.status ? formatStatusLabel(entry.status) : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const statusLabel = entry.status ? formatStatusLabel(entry.status) : "Private run";
  const runStatus = runStatusForTrackedExperiment(entry);

  return {
    category: "Private run",
    description: entry.summary ?? "Private experiment details from your local vault.",
    hasPrivateData: true,
    href: null,
    id: entry.id,
    image,
    metadata,
    privateBadgeLabel: "Private only",
    runStatus,
    searchText: [entry.title, entry.status, entry.summary, ...entry.tags]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase(),
    startedOn,
    statusLabel,
    statusVariant: statusVariantForRun(runStatus),
    title: entry.title,
    trackedExperimentId: entry.id,
  };
}

function buildExperimentRunCardSummary(
  privateRun: ExperimentRunProjection,
): ExperimentRunCardSummary {
  const primaryTrend = privateRun.trends.find(
    (trend) => trend.baseline.length > 0 || trend.active.length > 0,
  );
  const primarySignal = (primaryTrend
    ? privateRun.signals.find((signal) => signal.label === primaryTrend.label)
    : undefined) ?? privateRun.signals[0];

  return {
    completionPercent: privateRun.completionPercent,
    dateRange: privateRun.dateRange,
    day: privateRun.day,
    primarySignal,
    primaryTrend,
  };
}

function matchesProtocol(entry: OverviewExperiment, protocol: ExperimentProtocol): boolean {
  const protocolIds = new Set([
    protocol.id,
    protocol.commons?.key,
    protocol.commons?.routeId,
    protocol.commons?.slug,
    ...(protocol.commons?.aliases ?? []),
  ].filter((value): value is string => Boolean(value)));
  const trackedIds = [
    entry.slug,
    entry.commonsProtocolRef,
    entry.protocolRef,
    entry.effectiveProtocolSnapshot?.protocolId,
  ].filter((value): value is string => Boolean(value));

  return trackedIds.some((value) => protocolIds.has(value));
}

function formatProtocolDays(durationDays: number): string {
  return `${durationDays} day${durationDays === 1 ? "" : "s"}`;
}

function runStatusForTrackedExperiment(
  entry: OverviewExperiment | undefined,
): ExperimentRunProjection["status"] | undefined {
  if (!entry) return undefined;

  const status = entry.status?.trim().toLowerCase();
  if (status === "active" || status === "running" || status === "in_progress" || status === "planned") {
    return "active";
  }
  if (status === "paused") return "paused";
  if (status === "stopped" || status === "cancelled" || status === "closed") return "stopped";
  return "finished";
}

function statusVariantForRun(
  status: ExperimentRunProjection["status"] | undefined,
): ExperimentCardStatusVariant | undefined {
  if (!status) return undefined;
  if (status === "active") return "default";
  if (status === "paused") return "secondary";
  if (status === "stopped") return "destructive";
  return "outline";
}

const HOME_HISTORY_CARD_LIMIT = 6;

export interface HomeExperimentCards {
  history: ExperimentLibraryCard[];
  inProgress: ExperimentLibraryCard[];
}

export function splitHomeExperimentCards(
  cards: readonly ExperimentLibraryCard[],
): HomeExperimentCards {
  const privateCards = cards.filter((card) => card.hasPrivateData && card.runStatus);
  const inProgress = privateCards.filter(
    (card) => card.runStatus === "active" || card.runStatus === "paused",
  );
  const history = privateCards
    .filter((card) => card.runStatus !== "active" && card.runStatus !== "paused")
    .sort((left, right) => compareStartedOnDescending(left.startedOn, right.startedOn))
    .slice(0, HOME_HISTORY_CARD_LIMIT);

  return { history, inProgress };
}

function compareStartedOnDescending(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftTime = parseStartedOn(left);
  const rightTime = parseStartedOn(right);
  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return rightTime - leftTime;
}

function parseStartedOn(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
