"use client";

import { ArrowRightIcon, LineChartIcon, LockKeyholeIcon } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import {
  selectBrowserVaultBiomarkerPanel,
  type BrowserVaultBiomarkerPanelStatus,
  type BrowserVaultBiomarkerTrend,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser";

import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import {
  useBrowserVault,
  type BrowserVaultStatus,
} from "@/src/lib/browser-vault/context";
import {
  formatMetricValue,
  formatTrendDeltaSummary,
} from "@/src/lib/browser-vault/trend-comparison";
import type { BiomarkerOverviewProjection } from "@/src/lib/health-commons/biomarker-projections";
import { isBrowserVaultMetricBinding } from "@/src/lib/health-commons/biomarker-bindings";

interface TrendPoint {
  date: string;
  value: number;
}

interface TrendLatestValue {
  confidence: string;
  date: string;
  sourceLabel: string;
  value: number;
}

type PrivateTrendState =
  | { status: "loading" }
  | { body: string; detail?: string; panelStatus: BrowserVaultBiomarkerPanelStatus; status: "empty"; title: string }
  | { message: string; status: "error" }
  | {
      comparison: BrowserVaultBiomarkerTrend | null;
      latest: TrendLatestValue;
      series: TrendPoint[];
      stale: boolean;
      status: "ready";
    };

export function BiomarkerPrivateTrendCard({
  biomarker,
}: {
  biomarker: BiomarkerOverviewProjection;
}) {
  const { client, error, refresh, status } = useBrowserVault();
  const trend = useMemo(
    () => resolvePrivateTrend({ biomarker, browserVaultStatus: status, client, error }),
    [biomarker, client, error, status],
  );

  if (trend.status === "loading") {
    return (
      <div className="animate-pulse rounded-xl border border-dashed border-border/60 px-6 py-16">
        <div className="flex flex-col items-center gap-3">
          <div className="size-5 rounded-full bg-muted" />
          <div className="h-7 w-56 rounded bg-muted" />
          <div className="h-10 w-64 rounded bg-muted" />
          <div className="mt-2 h-5 w-32 rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (trend.status === "empty") {
    const action = emptyStateAction(trend.panelStatus);

    return (
      <div className="rounded-xl border border-dashed border-border/60">
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <LockKeyholeIcon className="size-5 text-muted-foreground/60" aria-hidden />
          <p className="font-serif text-lg font-semibold text-foreground">
            {trend.title}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {trend.body}
          </p>
          {trend.detail ? (
            <p className="text-xs text-muted-foreground/80">
              {trend.detail}
            </p>
          ) : null}
          {action ? (
            <Link
              href={action.href}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {action.label}
              <ArrowRightIcon className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  if (trend.status === "error") {
    return (
      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Your private {biomarker.shortName}</CardTitle>
          <CardDescription>{trend.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            Retry private trend
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-border/60">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Private to you
            </p>
            <CardTitle>Your {biomarker.shortName} trend</CardTitle>
            <CardDescription>
              {trend.stale
                ? "Your latest private value is older than the usual wearable sync window."
                : "Murph compares this to your own recent baseline, not to other people."}
            </CardDescription>
          </div>
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LineChartIcon className="size-5" aria-hidden />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <div className="flex items-end gap-2">
            <span className="font-serif text-5xl font-semibold tracking-tight text-foreground">
              {formatMetricValue(trend.latest.value, biomarker.valuePrecision)}
            </span>
            <span className="pb-2 text-sm font-medium text-muted-foreground">
              {biomarker.unit}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Latest {formatChipLabel(trend.latest.sourceLabel)} ·{" "}
            {formatDateLabel(trend.latest.date)} ·{" "}
            {formatChipLabel(trend.latest.confidence)} confidence
          </p>
        </div>
        <TrendSparkline series={trend.series} />
        {trend.comparison ? (
          <TrendDeltaRow
            comparison={trend.comparison}
            precision={biomarker.valuePrecision}
            unit={biomarker.unit}
          />
        ) : (
          <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            Not enough baseline data yet for a clean window comparison.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrendDeltaRow({
  comparison,
  precision,
  unit,
}: {
  comparison: BrowserVaultBiomarkerTrend;
  precision: number;
  unit: string;
}) {
  const deltaSummary = formatTrendDeltaSummary({ comparison, precision, unit });

  return (
    <div className="grid gap-3 rounded-xl border border-border/60 bg-background/80 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{comparison.label}</span>
        <span className="font-medium text-foreground">{deltaSummary}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <span>Recent: {formatMetricValue(comparison.currentValue, precision)} {unit}</span>
        <span>Prior: {formatMetricValue(comparison.baselineValue, precision)} {unit}</span>
      </div>
    </div>
  );
}

function TrendSparkline({ series }: { series: TrendPoint[] }) {
  const points = useMemo(() => toSparklinePoints(series), [series]);

  if (points.length < 2) {
    return <div className="h-24 rounded-xl bg-muted/40" aria-hidden />;
  }

  const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <svg
      role="img"
      aria-label="Private biomarker trend sparkline"
      viewBox="0 0 100 42"
      className="h-24 w-full overflow-visible rounded-xl border border-border/60 bg-muted/20 p-3 text-primary"
      preserveAspectRatio="none"
    >
      <polyline
        points={pointString}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function resolvePrivateTrend(input: {
  biomarker: BiomarkerOverviewProjection;
  browserVaultStatus: BrowserVaultStatus;
  client: BrowserVaultQueryClient | null;
  error: string | null;
}): PrivateTrendState {
  if (input.browserVaultStatus === "loading") {
    return { status: "loading" };
  }

  if (input.browserVaultStatus === "error") {
    return {
      message: input.error ?? "Your private biomarker trend could not be decrypted.",
      status: "error",
    };
  }

  const panel = selectBrowserVaultBiomarkerPanel({
    biomarkerKey: input.biomarker.key,
    bindings: input.biomarker.privateMetricBindings
      .filter(isBrowserVaultMetricBinding)
      .map((binding) => ({
        domain: binding.domain,
        metric: binding.metric,
        preferred: binding.preferred,
        unit: binding.unit,
      })),
    client: input.client,
    label: input.biomarker.shortName,
    trendDefaults: input.biomarker.trendDefaults,
    unit: input.biomarker.unit,
    valuePrecision: input.biomarker.valuePrecision,
  });

  if (panel.status === "insufficient_data") {
    const sampleCount = panel.primary?.sampleCount ?? 0;
    return {
      body: "Murph found private values, but not enough for a clean trend yet.",
      detail: `Found ${sampleCount} point${sampleCount === 1 ? "" : "s"}; Murph waits for at least ${input.biomarker.trendDefaults.minimumPoints} before summarizing a trend.`,
      panelStatus: panel.status,
      status: "empty",
      title: panel.emptyState?.title ?? "Not enough private data yet",
    };
  }

  if (panel.status !== "ready" && panel.status !== "stale") {
    return {
      body: panel.emptyState?.body ?? "Your private biomarker trend is not available yet.",
      panelStatus: panel.status,
      status: "empty",
      title: panel.emptyState?.title ?? "Biomarker unavailable",
    };
  }

  const latest = panel.primary?.latest;

  if (!latest) {
    return {
      body: panel.emptyState?.body ?? `No ${input.biomarker.shortName} values were found in browser-vault.`,
      panelStatus: "no_data",
      status: "empty",
      title: panel.emptyState?.title ?? "No private values yet",
    };
  }

  return {
    comparison: panel.primary?.trend ?? null,
    latest: {
      confidence: latest.confidence,
      date: latest.date,
      sourceLabel: panel.sources.length === 1 ? panel.sources[0]?.displayName ?? latest.sourceLabel : latest.sourceLabel,
      value: latest.value,
    },
    series: panel.primary?.series.map((point) => ({ date: point.date, value: point.value })) ?? [],
    stale: panel.status === "stale",
    status: "ready",
  };
}

function emptyStateAction(status: BrowserVaultBiomarkerPanelStatus): { href: string; label: string } | null {
  const normalizedStatus = String(status);

  if (normalizedStatus === "permission_missing") {
    return { href: "/settings", label: "Review connection" };
  }

  if (normalizedStatus === "syncing" || normalizedStatus === "stale") {
    return { href: "/settings", label: "View sync status" };
  }

  if (new Set(["no_connection", "no_data", "no_private_vault"]).has(normalizedStatus)) {
    return { href: "/connect", label: "Connect a device" };
  }

  return null;
}

function toSparklinePoints(series: readonly TrendPoint[]): Array<{ x: number; y: number }> {
  const recent = series.slice(-30);
  const values = recent.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const denominator = Math.max(1, recent.length - 1);

  return recent.map((point, index) => ({
    x: (index / denominator) * 100,
    y: 36 - ((point.value - min) / range) * 30 + 3,
  }));
}

function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(
    new Date(`${date}T00:00:00.000Z`),
  );
}

function formatChipLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
