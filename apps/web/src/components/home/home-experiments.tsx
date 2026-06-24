"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { HomeExperimentCard } from "./home-experiment-card";

import type { ExperimentLibraryCard } from "@/src/lib/experiments/library-cards";

export interface HomeExperimentsProps {
  history: ExperimentLibraryCard[];
  inProgress: ExperimentLibraryCard[];
}

export function HomeExperiments({ history, inProgress }: HomeExperimentsProps) {
  if (history.length === 0 && inProgress.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      {inProgress.length > 0 ? (
        <ExperimentSection
          action={<BrowseExperimentsAction />}
          cards={inProgress}
          label="In progress"
        />
      ) : null}
      {history.length > 0 ? (
        <ExperimentSection
          action={inProgress.length === 0 ? <BrowseExperimentsAction /> : undefined}
          cards={history}
          label="Your history"
        />
      ) : null}
    </div>
  );
}

function ExperimentSection({
  action,
  cards,
  label,
}: {
  action?: React.ReactNode;
  cards: ExperimentLibraryCard[];
  label: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {label}
        </h2>
        {action}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {cards.map((card) => (
          <HomeExperimentCard card={card} key={card.id} />
        ))}
      </div>
    </section>
  );
}

function BrowseExperimentsAction() {
  return (
    <Link
      href="/experiments"
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      Browse experiments
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}
