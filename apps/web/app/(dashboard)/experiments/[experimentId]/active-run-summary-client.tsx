"use client";

import { useMemo } from "react";

import {
  ResultsSummary,
  ResultsSummarySkeleton,
} from "@/src/components/experiments/experiment-detail/results-summary";
import { ShareResultsCard } from "@/src/components/experiments/experiment-detail/share-results-card";
import {
  isBrowserVaultMetricsCapable,
  useBrowserVault,
  useBrowserVaultExperimentMetricBucketDemand,
} from "@/src/lib/browser-vault/context";
import {
  buildBrowserVaultExperimentResultLookups,
  resolveBrowserVaultExperimentRun,
} from "@/src/lib/browser-vault/experiment-run";
import {
  EXPERIMENT_CARD_MAX_SIGNALS,
  type ExperimentCardChart,
  type ExperimentCardData,
} from "@/src/lib/experiments/share-card";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";
import type { ExperimentRunProjection } from "@/src/types/experiments";

/** Minimal shape of a protocol fact — `{ label, value }` from the protocol tab. */
type ProtocolFact = { label: string; value: string };

interface ActiveRunSummaryProps {
  protocol: ExperimentResultsPublicProjection;
  protocolFacts: readonly ProtocolFact[];
}

export function ActiveRunSummaryClient({ protocol, protocolFacts }: ActiveRunSummaryProps) {
  const lookups = useMemo(
    () => buildBrowserVaultExperimentResultLookups(protocol),
    [protocol],
  );
  const metricBucketsLoaded = useBrowserVaultExperimentMetricBucketDemand({ lookups });
  const browserVault = useBrowserVault();
  const metricsClient = metricBucketsLoaded
    && isBrowserVaultMetricsCapable(browserVault.client)
    ? browserVault.client
    : null;
  const privateRun = useMemo(
    () =>
      resolveBrowserVaultExperimentRun({
        client: metricsClient,
        protocol,
      }),
    [metricsClient, protocol],
  );

  const cardData = useMemo<ExperimentCardData | null>(
    () =>
      privateRun ? buildCardData(protocol, privateRun, protocolFacts) : null,
    [protocol, privateRun, protocolFacts],
  );

  if (browserVault.status === "loading" || !metricBucketsLoaded) {
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
  protocolFacts: readonly ProtocolFact[],
): ExperimentCardData {
  return {
    title: buildCardTitle(protocol.title, run),
    protocol: buildCardProtocol(protocolFacts),
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

// A one-line "how to run it yourself" recipe from the protocol facts. Skips
// duration facts (already implied by the title) and long prose values that
// won't fit a single line.
function buildCardProtocol(
  facts: readonly ProtocolFact[],
): string | undefined {
  const skipLabels = new Set(["baseline", "intervention"]);
  const parts: string[] = [];

  for (const fact of facts) {
    if (skipLabels.has(fact.label.trim().toLowerCase())) {
      continue;
    }
    const value = fact.value.trim();
    if (!value || value.length > 36) {
      continue;
    }
    parts.push(value);
    if (parts.length === 3) {
      break;
    }
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
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
// RHR experiment"). Keep the canonical protocol name, but use only the saved
// run's duration so a later catalog revision cannot relabel shared results.
function buildCardTitle(
  protocolTitle: string,
  run: ExperimentRunProjection,
): string {
  const duration = run.timingKnown ? run.durationDays : undefined;
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    return `${duration}-day ${protocolTitle}`;
  }
  return protocolTitle;
}
