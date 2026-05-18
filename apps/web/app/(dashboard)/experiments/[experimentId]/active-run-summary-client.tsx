"use client";

import { useMemo } from "react";

import {
  ResultsSummary,
  ResultsSummarySkeleton,
} from "@/src/components/experiments/experiment-detail/results-summary";
import { ShareResultsCard } from "@/src/components/experiments/experiment-detail/share-results-card";
import {
  BrowserVaultProvider,
  useBrowserVault,
} from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import {
  EXPERIMENT_CARD_MAX_SIGNALS,
  type ExperimentCardChart,
  type ExperimentCardData,
} from "@/src/lib/experiments/share-card";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";
import type { ExperimentRunProjection } from "@/src/types/experiments";

export function ActiveRunSummaryClient({
  protocol,
}: {
  protocol: ExperimentResultsPublicProjection;
}) {
  return (
    <BrowserVaultProvider>
      <ActiveRunSummaryInner protocol={protocol} />
    </BrowserVaultProvider>
  );
}

function ActiveRunSummaryInner({
  protocol,
}: {
  protocol: ExperimentResultsPublicProjection;
}) {
  const browserVault = useBrowserVault();
  const privateRun = useMemo(
    () =>
      resolveBrowserVaultExperimentRun({
        client: browserVault.client,
        protocol,
      }),
    [browserVault.client, protocol],
  );

  const cardData = useMemo<ExperimentCardData | null>(
    () => (privateRun ? buildCardData(protocol, privateRun) : null),
    [protocol, privateRun],
  );

  if (browserVault.status === "loading") {
    return <ResultsSummarySkeleton />;
  }

  if (!privateRun) return null;

  const isActive =
    privateRun.status === "active" || privateRun.status === "paused";
  if (!isActive) return null;

  const hasData =
    privateRun.signals.length > 0 || privateRun.trends.length > 0;
  if (!hasData) return null;

  return (
    <section id="results" className="scroll-mt-24">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-foreground/50">
            <span className="size-1.5 rounded-full bg-primary" />
            Your experiment
          </span>
          {cardData && cardData.signals.length > 0 ? (
            <ShareResultsCard cardData={cardData} />
          ) : null}
        </div>
        <ResultsSummary
          signals={privateRun.signals}
          trends={privateRun.trends}
          schedule={privateRun.schedule}
        />
      </div>
    </section>
  );
}

function buildCardData(
  protocol: ExperimentResultsPublicProjection,
  run: ExperimentRunProjection,
): ExperimentCardData {
  return {
    title: buildCardTitle(protocol),
    signals: run.signals.slice(0, EXPERIMENT_CARD_MAX_SIGNALS).map((signal) => ({
      label: signal.label,
      value: signal.value,
      unit: signal.unit,
      delta: signal.delta,
      direction: signal.direction,
      sentiment: signal.sentiment,
      baseline: signal.baseline,
    })),
    chart: buildCardChart(run),
  };
}

// The primary tracked marker is the first trend — the same biomarker the first
// outcome tile reports. Its baseline + active series is drawn as the card chart.
function buildCardChart(run: ExperimentRunProjection): ExperimentCardChart | undefined {
  const trend = run.trends[0];
  if (!trend) {
    return undefined;
  }

  const baseline = sampleEvenly(sortByDayValues(trend.baseline), 12);
  const active = sampleEvenly(sortByDayValues(trend.active), 24);
  const values = [...baseline, ...active];
  if (values.length < 2) {
    return undefined;
  }

  return {
    label: trend.label,
    unit: trend.unit || undefined,
    baselineCount: baseline.length,
    values,
    baselineAvg: Number.isFinite(trend.baselineAvg) ? trend.baselineAvg : undefined,
  };
}

function sortByDayValues(points: { day: number; value: number }[]): number[] {
  return [...points].sort((a, b) => a.day - b.day).map((point) => point.value);
}

// Keeps the encoded series short by picking evenly-spaced points (endpoints included).
function sampleEvenly(values: number[], max: number): number[] {
  if (values.length <= max) {
    return values;
  }

  const result: number[] = [];
  for (let index = 0; index < max; index += 1) {
    result.push(values[Math.round((index * (values.length - 1)) / (max - 1))]);
  }
  return result;
}

// The run's own name in the browser vault can be arbitrary (e.g. "7-day sauna
// RHR experiment"). Prefer the canonical protocol name plus its duration.
function buildCardTitle(protocol: ExperimentResultsPublicProjection): string {
  const duration = protocol.durationDays;
  if (Number.isFinite(duration) && duration > 0) {
    return `${duration}-day ${protocol.title}`;
  }
  return protocol.title;
}
