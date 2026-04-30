"use client";

import { useMemo, useState } from "react";

import { BiomarkerBrowseCard } from "@/src/components/biomarkers/biomarker-browse-card";
import { CategoryFilter } from "@/src/components/experiments/category-filter";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { PageHeader } from "@/src/components/ui/page-header";

export interface BiomarkerBrowseEntry {
  routeId: string;
  title: string;
  summary: string | null;
  unit: string | null;
  categories: string[];
  aliases: string[];
}

interface BiomarkersPageClientProps {
  biomarkers: BiomarkerBrowseEntry[];
}

export function BiomarkersPageClient({ biomarkers }: BiomarkersPageClientProps) {
  const [category, setCategory] = useState("All");

  const cards = useMemo(
    () =>
      biomarkers.map((entry) => ({
        ...entry,
        primaryCategory: entry.categories[0] ?? null,
      })),
    [biomarkers],
  );

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const card of cards) {
      if (card.primaryCategory) seen.add(formatCategoryLabel(card.primaryCategory));
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [cards]);

  const filtered = useMemo(() => {
    return cards.filter((card) => {
      const cardCategoryLabel = card.primaryCategory
        ? formatCategoryLabel(card.primaryCategory)
        : null;
      return category === "All" || cardCategoryLabel === category;
    });
  }, [cards, category]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Library"
        title="Biomarkers"
        description="Track and understand the signals that move your health, then run experiments to see what changes."
      />

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Browse all
            </span>
            <p className="text-xs text-muted-foreground">
              {filtered.length} of {cards.length} biomarkers
            </p>
          </div>
          <CategoryFilter
            value={category}
            onChange={setCategory}
            categories={categoryOptions}
          />
        </div>

        {filtered.length === 0 ? (
          <Alert>
            <AlertTitle>No biomarkers in this category</AlertTitle>
            <AlertDescription>
              Switch back to All to see the full library.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((card) => (
              <BiomarkerBrowseCard
                key={card.routeId}
                routeId={card.routeId}
                title={card.title}
                category={card.primaryCategory}
                unit={card.unit}
                summary={card.summary}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatCategoryLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}
