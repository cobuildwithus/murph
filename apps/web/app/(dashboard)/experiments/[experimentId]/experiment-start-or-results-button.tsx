"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import {
  BrowserVaultProvider,
  useBrowserVault,
} from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";

interface ExperimentStartOrResultsButtonProps {
  activeRunProtocol: ExperimentResultsPublicProjection;
  protocolDays: number;
  protocolTitle: string;
  resultsHref: string;
  startAction: ReactNode;
}

export function ExperimentStartOrResultsButton({
  activeRunProtocol,
  protocolDays,
  protocolTitle,
  resultsHref,
  startAction,
}: ExperimentStartOrResultsButtonProps) {
  return (
    <BrowserVaultProvider>
      <ExperimentStartOrResultsButtonInner
        activeRunProtocol={activeRunProtocol}
        protocolDays={protocolDays}
        protocolTitle={protocolTitle}
        resultsHref={resultsHref}
        startAction={startAction}
      />
    </BrowserVaultProvider>
  );
}

function ExperimentStartOrResultsButtonInner({
  activeRunProtocol,
  protocolDays,
  protocolTitle,
  resultsHref,
  startAction,
}: ExperimentStartOrResultsButtonProps) {
  const browserVault = useBrowserVault();
  const privateRun = useMemo(
    () =>
      resolveBrowserVaultExperimentRun({
        client: browserVault.client,
        protocol: activeRunProtocol,
      }),
    [activeRunProtocol, browserVault.client],
  );
  const isRunning =
    privateRun?.status === "active" || privateRun?.status === "paused";

  if (browserVault.status === "loading") {
    return (
      <ExperimentHeaderActionFrame protocolDays={protocolDays}>
        <button
          type="button"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-transparent bg-primary px-6 py-4 text-base font-semibold whitespace-nowrap text-primary-foreground opacity-70 outline-none select-none md:px-12"
          disabled
          aria-busy="true"
          aria-label={`Checking run status for ${protocolTitle}`}
        >
          <span>Checking Run</span>
          <ArrowRightIcon data-icon="inline-end" className="size-4 shrink-0" />
        </button>
      </ExperimentHeaderActionFrame>
    );
  }

  if (!isRunning) {
    return startAction;
  }

  return (
    <ExperimentHeaderActionFrame protocolDays={protocolDays}>
      <Link
        href={resultsHref}
        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-transparent bg-primary px-6 py-4 text-base font-semibold whitespace-nowrap text-primary-foreground outline-none transition-colors hover:bg-chart-1 focus-visible:ring-[3px] focus-visible:ring-ring/50 md:px-12"
        aria-label={`View results for ${protocolTitle}`}
      >
        <span>View Results</span>
        <ArrowRightIcon data-icon="inline-end" className="size-4 shrink-0" />
      </Link>
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
