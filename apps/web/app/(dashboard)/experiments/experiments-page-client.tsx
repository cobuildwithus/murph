"use client";

import { useMemo, useState } from "react";
import {
  isActiveOverviewExperimentStatus,
  selectBrowserVaultTrackedExperiments,
  type BrowserVaultQueryClient,
  type OverviewExperiment,
} from "@murphai/query/browser";

import { CategoryFilter } from "@/src/components/experiments/category-filter";
import { ExperimentBrowseCard } from "@/src/components/experiments/experiment-browse-card";
import { ExperimentHeroCard } from "@/src/components/experiments/experiment-hero-card";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { PageHeader } from "@/src/components/ui/page-header";
import { BrowserVaultProvider, useBrowserVault } from "@/src/lib/browser-vault/context";
import { formatIsoDate, formatStatusLabel } from "@/src/lib/browser-vault/display";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import type { ExperimentProtocol, ExperimentRunProjection } from "@/src/types/experiments";

type ExperimentCardStatusVariant = "default" | "secondary" | "outline" | "destructive";

const FEATURED_EXPERIMENT_IDS = ["finnish-sauna", "norwegian-4x4"] as const;
const FEATURED_EXPERIMENT_EXCLUDED_IDS = new Set<string>([
  "bryan-johnson-blueprint",
]);

interface ExperimentsPageClientProps {
  protocols: ExperimentProtocol[];
}

interface ExperimentLibraryCard {
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
  searchText: string;
  trackedExperimentId?: string;
}

export function ExperimentsPageClient({ protocols }: ExperimentsPageClientProps) {
  return (
    <BrowserVaultProvider>
      <ExperimentsPageContent protocols={protocols} />
    </BrowserVaultProvider>
  );
}

function ExperimentsPageContent({ protocols }: ExperimentsPageClientProps) {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const { client, error, refresh, status } = useBrowserVault();
  const trackedExperiments = useMemo(
    () => client ? selectBrowserVaultTrackedExperiments(client) : [],
    [client],
  );
  const libraryCards = useMemo(
    () => buildExperimentLibraryCards({ protocols, trackedExperiments, client }),
    [client, protocols, trackedExperiments],
  );
  const categoryOptions = useMemo(
    () => listCategories(libraryCards),
    [libraryCards],
  );
  const filteredCards = useMemo(
    () => libraryCards.filter((card) => matchesExperimentCard(card, { category, search })),
    [category, libraryCards, search],
  );
  const featuredCards = useMemo(
    () => selectFeaturedCards(filteredCards),
    [filteredCards],
  );
  const showFeatured =
    category === "All" && search.trim().length === 0 && featuredCards.length > 0;
  const nonAuthError = status === "error" && !isAuthRequiredBrowserVaultError(error);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <PageHeader
          eyebrow="Library"
          title="Experiments"
          description="Browse the public protocol library."
        />
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:items-center">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search experiments"
            className="w-full sm:w-64"
          />
        </div>
      </div>

      {nonAuthError ? (
        <Alert>
          <AlertTitle>Private overlays could not be refreshed</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {error ?? "Your private experiment list could not be decrypted."}
                {" "}
                The public experiment library is still available below.
              </span>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {showFeatured ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Featured
              </span>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {featuredCards.map((card) => (
              <ExperimentHeroCard key={`featured:${card.id}`} {...card} preload />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Browse all
            </span>
            <p className="text-xs text-muted-foreground">
              {filteredCards.length} of {libraryCards.length} experiments
            </p>
          </div>
          <CategoryFilter
            value={category}
            onChange={setCategory}
            categories={categoryOptions}
          />
        </div>

        {filteredCards.length === 0 ? (
          <Alert>
            <AlertTitle>No experiments matched</AlertTitle>
            <AlertDescription>
              Try a different search or category to get back to the full library.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredCards.map((card) => (
              <ExperimentBrowseCard key={card.id} {...card} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function buildExperimentLibraryCards({
  client,
  protocols,
  trackedExperiments,
}: {
  client: BrowserVaultQueryClient | null;
  protocols: ExperimentProtocol[];
  trackedExperiments: OverviewExperiment[];
}): ExperimentLibraryCard[] {
  const protocolCards = protocols.map((protocol) => {
    const privateRun = resolveBrowserVaultExperimentRun({ client, protocol });
    return protocolToCard(protocol, privateRun);
  });
  const matchedTrackedExperimentIds = new Set(
    protocolCards.flatMap((card) => card.trackedExperimentId ? [card.trackedExperimentId] : []),
  );
  const trackedOnlyCards = trackedExperiments
    .filter((entry) => !matchedTrackedExperimentIds.has(entry.id))
    .map(trackedExperimentToCard);

  return [...protocolCards, ...trackedOnlyCards].sort(compareExperimentCards);
}

function protocolToCard(
  protocol: ExperimentProtocol,
  privateRun: ExperimentRunProjection | null,
): ExperimentLibraryCard {
  const statusLabel = privateRun?.statusLabel;
  const startedOn = privateRun?.startedOn;
  const protocolDays = formatProtocolDays(protocol);
  const metadata = [
    startedOn ? `Started ${formatIsoDate(startedOn)}` : null,
    `${protocolDays} days`,
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
    statusVariant: privateRun ? statusVariantForPrivateRun(privateRun.status) : undefined,
    description,
    hasPrivateData: privateRun !== null,
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

function trackedExperimentToCard(entry: OverviewExperiment): ExperimentLibraryCard {
  const statusLabel = formatStatusLabel(entry.status);
  const title = entry.title || entry.slug || entry.id;
  const category = "Private";
  const startedOn = entry.startedOn;
  const metadata = [
    startedOn ? `Started ${formatIsoDate(startedOn)}` : null,
    "Private run only",
  ].filter((part): part is string => part !== null).join(" · ");

  return {
    id: entry.id,
    title,
    category,
    image: selectTrackedExperimentImage(entry),
    href: null,
    privateBadgeLabel: "Private only",
    metadata,
    statusLabel,
    statusVariant: statusVariantForTrackedExperiment(entry),
    description: entry.summary ?? "This experiment has private data in your browser vault, but it does not currently match a public protocol page.",
    hasPrivateData: true,
    searchText: [entry.id, entry.slug, entry.title, entry.summary, ...entry.tags]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  };
}

function compareExperimentCards(left: ExperimentLibraryCard, right: ExperimentLibraryCard): number {
  if (left.hasPrivateData !== right.hasPrivateData) {
    return left.hasPrivateData ? -1 : 1;
  }

  return left.title.localeCompare(right.title);
}

function selectFeaturedCards(cards: ExperimentLibraryCard[]): ExperimentLibraryCard[] {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const pinnedCards = FEATURED_EXPERIMENT_IDS.flatMap((id) => {
    const card = cardsById.get(id);
    return card ? [card] : [];
  });
  const pinnedIds = new Set(pinnedCards.map((card) => card.id));
  const fallbackCards = cards.filter((card) =>
    !pinnedIds.has(card.id) && !FEATURED_EXPERIMENT_EXCLUDED_IDS.has(card.id)
  );

  return [...pinnedCards, ...fallbackCards].slice(0, 2);
}

function listCategories(cards: ExperimentLibraryCard[]): string[] {
  return [...new Set(cards.map((card) => card.category))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function matchesExperimentCard(
  card: ExperimentLibraryCard,
  filters: { category: string; search: string },
): boolean {
  const matchesCategory = filters.category === "All" || card.category === filters.category;
  const normalizedSearch = filters.search.trim().toLowerCase();

  if (!matchesCategory) {
    return false;
  }

  if (normalizedSearch.length === 0) {
    return true;
  }

  return card.searchText.toLowerCase().includes(normalizedSearch);
}

function statusVariantForPrivateRun(
  status: ExperimentRunProjection["status"],
): ExperimentCardStatusVariant {
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

function statusVariantForTrackedExperiment(entry: OverviewExperiment): ExperimentCardStatusVariant {
  const status = entry.status?.trim().toLowerCase() ?? "";

  if (isActiveOverviewExperimentStatus(status)) {
    return "default";
  }

  if (status === "paused") {
    return "secondary";
  }

  if (["abandoned", "closed", "stopped"].includes(status)) {
    return "destructive";
  }

  return "outline";
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

function isAuthRequiredBrowserVaultError(error: string | null): boolean {
  const normalized = error?.toLowerCase() ?? "";

  return normalized.includes("sign in") ||
    normalized.includes("auth_required") ||
    normalized.includes("unauthorized") ||
    normalized.includes("session expired");
}
