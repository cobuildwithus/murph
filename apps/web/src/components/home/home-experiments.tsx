"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { HomeExperimentCard } from "./home-experiment-card";

import type { ExperimentLibraryCard } from "@/src/lib/experiments/library-cards";
import { cn } from "@/src/lib/utils";

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
          variant="default"
        />
      ) : null}
      {history.length > 0 ? (
        <HomeExperimentsSection
          label="Your history"
          cards={history.slice(0, HISTORY_CARD_LIMIT)}
          action={inProgress.length === 0 ? browseAction : undefined}
          variant="history"
        />
      ) : null}
    </div>
  );
}

function HomeExperimentsSection({
  label,
  cards,
  action,
  variant,
}: {
  label: string;
  cards: ExperimentLibraryCard[];
  action?: React.ReactNode;
  variant: "default" | "history";
}) {
  const historyLayout = variant === "history";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {action ?? null}
      </div>
      <div className={cn(
        "grid",
        historyLayout
          ? "grid-cols-6 items-start gap-5"
          : "gap-5 sm:grid-cols-2",
      )}>
        {cards.map((card) => {
          const cardVariant = historyLayout && card.runStatus === "finished"
            ? "history"
            : "default";

          if (!historyLayout) {
            return (
              <HomeExperimentCard
                key={card.id}
                card={card}
                variant={cardVariant}
              />
            );
          }

          return (
            <div
              key={card.id}
              className={cn(
                "col-span-6",
                cardVariant === "history"
                  ? "h-fit sm:col-span-3 md:col-span-6 lg:col-span-3 xl:col-span-2"
                  : "self-stretch sm:col-span-3",
              )}
            >
              <HomeExperimentCard card={card} variant={cardVariant} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
