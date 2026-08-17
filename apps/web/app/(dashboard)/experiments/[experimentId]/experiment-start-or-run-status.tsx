"use client";

import { useMemo, type ReactNode } from "react";

import { Skeleton } from "@/src/components/ui/skeleton";
import {
  useBrowserVault,
} from "@/src/lib/browser-vault/context";
import {
  buildBrowserVaultExperimentResultLookups,
} from "@/src/lib/browser-vault/experiment-run";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";
import { cn } from "@/src/lib/utils";

interface ExperimentStartOrRunStatusProps {
  activeRunProtocol: ExperimentResultsPublicProjection;
  protocolDays: number;
  startAction: ReactNode;
}

export function ExperimentStartOrRunStatus({
  activeRunProtocol,
  protocolDays,
  startAction,
}: ExperimentStartOrRunStatusProps) {
  const browserVault = useBrowserVault();
  const privateRunCard = useMemo(() => {
    if (!browserVault.client) return null;
    for (const lookup of buildBrowserVaultExperimentResultLookups(activeRunProtocol)) {
      const card = browserVault.client.experimentRunCards.find(lookup);
      if (card) return card;
    }
    return null;
  }, [activeRunProtocol, browserVault.client]);
  const isRunning =
    privateRunCard?.status === "active" || privateRunCard?.status === "paused";

  if (browserVault.status === "loading") {
    // Neutral placeholder: the slot resolves into either the start button or
    // the quiet status chip, so the loading state must pre-announce neither.
    return (
      <ExperimentHeaderActionFrame protocolDays={protocolDays}>
        <Skeleton className="h-11 w-44 rounded-2xl" />
      </ExperimentHeaderActionFrame>
    );
  }

  if (!isRunning) {
    return startAction;
  }

  // The run's results already render on the experiment page itself, so the
  // header shows a quiet status chip instead of a CTA pointing at the same page.
  const isPaused = privateRunCard!.status === "paused";

  return (
    <ExperimentHeaderActionFrame protocolDays={protocolDays}>
      <div
        role="status"
        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-6 md:px-12"
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            isPaused ? "bg-muted-foreground" : "bg-primary",
          )}
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.11em] text-foreground/60">
          {isPaused ? "Experiment paused" : "Experiment in progress"}
        </span>
      </div>
    </ExperimentHeaderActionFrame>
  );
}

function ExperimentHeaderActionFrame({
  children,
  protocolDays,
}: {
  children: ReactNode;
  protocolDays: number;
}) {
  return (
    <div className="flex flex-col items-stretch gap-2 md:shrink-0 md:items-center">
      {children}
      <span className="text-center font-mono text-[10px]/3.5 uppercase tracking-[0.12em] text-muted-foreground/75">
        {protocolDays}-day protocol
      </span>
    </div>
  );
}
