"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowRightIcon } from "lucide-react";

import {
  BrowserVaultProvider,
  useBrowserVault,
} from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";

interface ExperimentStartOrRunStatusProps {
  activeRunProtocol: ExperimentResultsPublicProjection;
  protocolDays: number;
  protocolTitle: string;
  startAction: ReactNode;
}

export function ExperimentStartOrRunStatus({
  activeRunProtocol,
  protocolDays,
  protocolTitle,
  startAction,
}: ExperimentStartOrRunStatusProps) {
  return (
    <BrowserVaultProvider>
      <ExperimentStartOrRunStatusInner
        activeRunProtocol={activeRunProtocol}
        protocolDays={protocolDays}
        protocolTitle={protocolTitle}
        startAction={startAction}
      />
    </BrowserVaultProvider>
  );
}

function ExperimentStartOrRunStatusInner({
  activeRunProtocol,
  protocolDays,
  protocolTitle,
  startAction,
}: ExperimentStartOrRunStatusProps) {
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

  // The run's results already render on the experiment page itself, so the
  // header shows a quiet status chip instead of a CTA pointing at the same page.
  const statusLabel =
    privateRun.status === "paused" ? "Experiment paused" : "Experiment in progress";

  return (
    <ExperimentHeaderActionFrame protocolDays={protocolDays}>
      <div
        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-6 md:px-12"
        aria-label={`${statusLabel}: ${protocolTitle}`}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className="font-mono text-xs uppercase tracking-[0.11em] text-foreground/60">
          {statusLabel}
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
