"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ExperimentBrowseCard } from "@/src/components/experiments/experiment-browse-card";
import type { ExperimentLibraryCard } from "@/src/lib/experiments/library-cards";

const HISTORY_CARD_LIMIT = 6;

export interface HomeExperimentsProps {
  inProgress: ExperimentLibraryCard[];
  history: ExperimentLibraryCard[];
}

export function HomeExperiments({ inProgress, history }: HomeExperimentsProps) {
  if (inProgress.length === 0 && history.length === 0) {
    return null;
  }

  const browseAction = (
    <Link
      href="/experiments"
      className="group relative inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']"
    >
      Browse experiments
      <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );

  return (
    <div className="flex flex-col gap-8">
      {inProgress.length > 0 ? (
        <HomeExperimentsSection
          label="In progress"
          cards={inProgress}
          action={browseAction}
        />
      ) : null}
      {history.length > 0 ? (
        <HomeExperimentsSection
          label="Your history"
          cards={history.slice(0, HISTORY_CARD_LIMIT)}
          action={inProgress.length === 0 ? browseAction : undefined}
        />
      ) : null}
    </div>
  );
}

function HomeExperimentsSection({
  label,
  cards,
  action,
}: {
  label: string;
  cards: ExperimentLibraryCard[];
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {action ?? null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <ExperimentBrowseCard
            key={card.id}
            {...card}
            imageSizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
          />
        ))}
      </div>
    </section>
  );
}
