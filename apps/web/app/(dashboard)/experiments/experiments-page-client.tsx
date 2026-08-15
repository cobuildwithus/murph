"use client";

import { useMemo, useState } from "react";
import { selectBrowserVaultTrackedExperiments } from "@murphai/query/browser-overview";

import { CategoryFilter } from "@/src/components/experiments/category-filter";
import { ExperimentBrowseCard } from "@/src/components/experiments/experiment-browse-card";
import { ExperimentHeroCard } from "@/src/components/experiments/experiment-hero-card";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { PageHeader } from "@/src/components/ui/page-header";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import {
  buildHomeExperimentLibraryCards,
  type ExperimentLibraryCard,
} from "@/src/lib/experiments/library-cards";
import type { ExperimentProtocol } from "@/src/types/experiments";

const FEATURED_EXPERIMENT_IDS = ["finnish-sauna", "norwegian-4x4"] as const;
const FEATURED_EXPERIMENT_EXCLUDED_IDS = new Set<string>([
  "bryan-johnson-blueprint",
]);

interface ExperimentsPageClientProps {
  protocols: ExperimentProtocol[];
}

export function ExperimentsPageClient({ protocols }: ExperimentsPageClientProps) {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const { client, error, refresh, status } = useBrowserVault();
  const trackedExperiments = useMemo(
    () => client ? selectBrowserVaultTrackedExperiments(client) : [],
    [client],
  );
  const libraryCards = useMemo(
    () => buildHomeExperimentLibraryCards({
      protocols,
      trackedExperiments,
      client,
    }),
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
          <AlertTitle>Your experiments couldn&apos;t be refreshed</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {error ?? "We couldn't unlock your private experiment list right now."}
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

function isAuthRequiredBrowserVaultError(error: string | null): boolean {
  const normalized = error?.toLowerCase() ?? "";

  return normalized.includes("sign in") ||
    normalized.includes("auth_required") ||
    normalized.includes("unauthorized") ||
    normalized.includes("session expired");
}
