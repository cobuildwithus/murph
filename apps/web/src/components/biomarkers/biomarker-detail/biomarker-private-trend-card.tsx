"use client";

import { ArrowRightIcon, LockKeyholeIcon } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Line, LineChart, XAxis, YAxis } from "recharts";

import {
  selectBrowserVaultBiomarkerPanel,
  type BrowserVaultBiomarkerPanelStatus,
  type BrowserVaultBiomarkerTrend,
  type BrowserVaultMetricSeriesCapableQueryClient,
} from "@murphai/query/browser-biomarkers";

import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/src/components/ui/chart";
import { MetricCard } from "@/src/components/ui/metric-card";
import {
  isBrowserVaultMetricsCapable,
  useBrowserVault,
  useBrowserVaultMetricKeyDemand,
  type BrowserVaultStatus,
} from "@/src/lib/browser-vault/context";
import { formatMetricValue } from "@/src/lib/browser-vault/trend-comparison";
import type { BiomarkerOverviewProjection } from "@/src/lib/health-commons/biomarker-projections";

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

interface TrendContextValue {
  date: string;
  label: string;
  sourceLabel: string;
  stale: boolean;
  unit: string;
  value: number;
  valuePrecision: number;
}

export type BiomarkerPrivateTrendState =
  | { status: "loading" }
  | {
      action?: { href: string; label: string } | null;
      body: string;
      detail?: string;
      panelStatus: BrowserVaultBiomarkerPanelStatus;
      status: "empty";
      title: string;
    }
  | { message: string; status: "error" }
  | {
      comparison: BrowserVaultBiomarkerTrend | null;
      context: TrendContextValue[];
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
  const metricBucketsLoaded = useBrowserVaultMetricKeyDemand(
    biomarker.privateMetricBindings.map((binding) => binding.metricKey),
  );
  const { client, deviceSyncImportPending, error, refresh, status } = useBrowserVault();
  const metricsClient = isBrowserVaultMetricsCapable(client) ? client : null;
  const trend = useMemo(
    () => resolvePrivateTrend({
      biomarker,
      browserVaultStatus: metricBucketsLoaded ? status : "loading",
      client: metricBucketsLoaded ? metricsClient : null,
      deviceSyncImportPending,
      error,
    }),
    [biomarker, deviceSyncImportPending, error, metricBucketsLoaded, metricsClient, status],
  );

  return (
    <BiomarkerPrivateTrendCardView
      biomarker={biomarker}
      onRetry={refresh}
      trend={trend}
    />
  );
}

export function BiomarkerPrivateTrendCardView({
  biomarker,
  onRetry,
  trend,
}: {
  biomarker: Pick<BiomarkerOverviewProjection, "shortName" | "unit" | "valuePrecision">;
  onRetry: () => Promise<void>;
  trend: BiomarkerPrivateTrendState;
}) {
  const { avg7, avg30, pctChange, pctDirection } = useMemo(
    () => trend.status === "ready"
      ? computeAverages(trend.series)
      : { avg7: null, avg30: null, pctChange: null, pctDirection: "neutral" as const },
    [trend],
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
    const action = trend.action === undefined
      ? emptyStateAction(trend.panelStatus)
      : trend.action;

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
          <Button size="sm" variant="outline" onClick={() => void onRetry()}>
            Retry private trend
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
        <TrendLineChart series={trend.series} unit={biomarker.unit} precision={biomarker.valuePrecision} />
        <div className="flex flex-col gap-4">
          <MetricCard
            label="Latest"
            value={formatMetricValue(trend.latest.value, biomarker.valuePrecision)}
            unit={biomarker.unit}
            delta={avg7 !== null && avg7 !== 0 ? `${Math.abs(((trend.latest.value - avg7) / avg7) * 100).toFixed(1)}%` : ""}
            deltaTone="neutral"
            direction={avg7 !== null && avg7 !== 0 ? (Math.abs(((trend.latest.value - avg7) / avg7) * 100) < 1 ? "neutral" : trend.latest.value > avg7 ? "up" : "down") : "neutral"}
            baseline={`${formatChipLabel(trend.latest.sourceLabel)} · ${formatDateLabel(trend.latest.date)}`}
          />
          <MetricCard
            label="7-day average"
            value={avg7 !== null ? formatMetricValue(avg7, biomarker.valuePrecision) : "---"}
            unit={biomarker.unit}
            delta={pctChange !== null ? `${Math.abs(pctChange).toFixed(1)}%` : ""}
            deltaTone="neutral"
            direction={pctDirection}
            baseline={avg30 !== null ? `30d avg: ${formatMetricValue(avg30, biomarker.valuePrecision)}${abbreviateUnit(biomarker.unit)}` : undefined}
          />
        </div>
      </div>
      {trend.context.length > 0 ? <ContextMetricStrip metrics={trend.context} /> : null}
    </div>
  );
}

const trendChartConfig = {
  value: {
    label: "Value",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

function TrendLineChart({ series, unit, precision }: { precision: number; series: TrendPoint[]; unit: string }) {
  const chartData = useMemo(
    () =>
      series.slice(-90).map((point) => ({
        date: point.date,
        label: formatDateLabel(point.date),
        value: point.value,
      })),
    [series],
  );

  if (chartData.length < 2) {
    return <div className="h-64 rounded-lg bg-muted/30" aria-hidden />;
  }

  return (
    <ChartContainer config={trendChartConfig} className="h-64 w-full">
      <LineChart
        accessibilityLayer
        data={chartData}
        margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
      >
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="equidistantPreserveStart"
          minTickGap={40}
          className="text-[10px]"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={40}
          domain={["auto", "auto"]}
          className="text-[10px]"
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelKey="label"
              labelFormatter={(_label, payload) => {
                const item = payload[0]?.payload as { label?: string } | undefined;
                return item?.label ?? "";
              }}
              formatter={(value) => `${Number(value).toFixed(precision)} ${unit}`}
            />
          }
        />
        <Line
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

function resolvePrivateTrend(input: {
  biomarker: BiomarkerOverviewProjection;
  browserVaultStatus: BrowserVaultStatus;
  client: BrowserVaultMetricSeriesCapableQueryClient | null;
  deviceSyncImportPending: boolean;
  error: string | null;
}): BiomarkerPrivateTrendState {
  if (input.browserVaultStatus === "loading") {
    return { status: "loading" };
  }

  if (input.browserVaultStatus === "error") {
    return {
      message: input.error ?? "We couldn't unlock your private trend right now. Try again.",
      status: "error",
    };
  }

  const panel = selectBrowserVaultBiomarkerPanel({
    biomarkerKey: input.biomarker.key,
    client: input.client,
    label: input.biomarker.shortName,
    privateMetricBindings: input.biomarker.privateMetricBindings,
    trendDefaults: input.biomarker.trendDefaults,
    unit: input.biomarker.unit,
    valuePrecision: input.biomarker.valuePrecision,
  });
  const canFillFromDeviceImport =
    input.deviceSyncImportPending && input.biomarker.privateMetricBindings.length > 0;

  if (panel.status === "insufficient_data") {
    const sampleCount = panel.primary?.sampleCount ?? 0;
    if (canFillFromDeviceImport) {
      return pendingDeviceImportState(
        panel.status,
        `Found ${sampleCount} point${sampleCount === 1 ? "" : "s"} so far.`,
      );
    }

    return {
      body: "Murph found private values, but not enough for a clean trend yet.",
      detail: `Found ${sampleCount} point${sampleCount === 1 ? "" : "s"}; Murph waits for at least ${input.biomarker.trendDefaults.minimumPoints} before summarizing a trend.`,
      panelStatus: panel.status,
      status: "empty",
      title: panel.emptyState?.title ?? "Not enough private data yet",
    };
  }

  if (panel.status !== "ready" && panel.status !== "stale") {
    if (canFillFromDeviceImport && panel.status === "no_data") {
      return pendingDeviceImportState(panel.status);
    }

    return {
      body: panel.emptyState?.body ?? "Your private biomarker trend is not available yet.",
      panelStatus: panel.status,
      status: "empty",
      title: panel.emptyState?.title ?? "Biomarker unavailable",
    };
  }

  const latest = panel.primary?.latest;

  if (!latest) {
    if (canFillFromDeviceImport) {
      return pendingDeviceImportState("no_data");
    }

    return {
      body: panel.emptyState?.body ?? `No ${input.biomarker.shortName} values saved on this device yet.`,
      panelStatus: "no_data",
      status: "empty",
      title: panel.emptyState?.title ?? "No private values yet",
    };
  }

  return {
    comparison: panel.primary?.trend ?? null,
    context: panel.context.flatMap((contextPanel) => {
      const contextLatest = contextPanel.latest;
      if (!contextLatest) return [];

      return [{
        date: contextLatest.date,
        label: contextPanel.label,
        sourceLabel: contextLatest.sourceLabel,
        stale: contextPanel.selection?.status === "stale",
        unit: contextPanel.unit,
        value: contextLatest.value,
        valuePrecision: contextPanel.valuePrecision,
      }];
    }),
    latest: {
      confidence: latest.confidence,
      date: latest.date,
      sourceLabel: latest.sourceLabel,
      value: latest.value,
    },
    series: panel.primary?.series.map((point) => ({ date: point.date, value: point.value })) ?? [],
    stale: panel.status === "stale",
    status: "ready",
  };
}

function pendingDeviceImportState(
  panelStatus: BrowserVaultBiomarkerPanelStatus,
  detail?: string,
): Extract<BiomarkerPrivateTrendState, { status: "empty" }> {
  return {
    action: null,
    body: "Wearable data is still importing. This trend may fill in shortly.",
    ...(detail ? { detail } : {}),
    panelStatus,
    status: "empty",
    title: "Still importing private data",
  };
}

function ContextMetricStrip({ metrics }: { metrics: TrendContextValue[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {metrics.map((metric) => (
        <div
          key={`${metric.label}:${metric.sourceLabel}:${metric.date}`}
          className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3"
        >
          <dt className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-foreground/50">
            <span className="min-w-0 truncate">{metric.label}</span>
            {metric.stale ? (
              <span className="shrink-0 text-[9px] text-muted-foreground">
                Out of date
              </span>
            ) : null}
          </dt>
          <dd className="mt-1 flex items-baseline gap-1.5">
            <span className="font-serif text-2xl font-semibold tabular-nums text-foreground">
              {formatMetricValue(metric.value, metric.valuePrecision)}
            </span>
            <span className="text-sm text-foreground/50">
              {displayUnitLabel(metric.unit)}
            </span>
          </dd>
          <div
            className="mt-1 min-w-0 truncate text-xs tabular-nums text-foreground/45"
            title={`${formatChipLabel(metric.sourceLabel)} · ${formatDateLabel(metric.date)}`}
          >
            {formatChipLabel(metric.sourceLabel)} · {formatDateLabel(metric.date)}
          </div>
        </div>
      ))}
    </dl>
  );
}

function emptyStateAction(status: BrowserVaultBiomarkerPanelStatus): { href: string; label: string } | null {
  if (status === "stale") {
    return { href: "/settings", label: "Check your connections" };
  }

  if (status === "no_data" || status === "no_private_vault") {
    return { href: "/connect", label: "Connect a device" };
  }

  return null;
}

function computeAverages(series: TrendPoint[]): {
  avg7: number | null;
  avg30: number | null;
  pctChange: number | null;
  pctDirection: "down" | "neutral" | "up";
} {
  if (series.length === 0) {
    return { avg7: null, avg30: null, pctChange: null, pctDirection: "neutral" };
  }

  const last7 = series.slice(-7);
  const last30 = series.slice(-30);
  const avg7 = last7.reduce((s, p) => s + p.value, 0) / last7.length;
  const avg30 = last30.reduce((s, p) => s + p.value, 0) / last30.length;

  if (avg30 === 0) {
    return { avg7, avg30, pctChange: null, pctDirection: "neutral" };
  }

  const pctChange = ((avg7 - avg30) / avg30) * 100;
  const pctDirection: "down" | "neutral" | "up" =
    Math.abs(pctChange) < 1 ? "neutral" : pctChange > 0 ? "up" : "down";

  return { avg7, avg30, pctChange, pctDirection };
}


const unitAbbreviations: Record<string, string> = {
  minutes: "m",
  hours: "h",
  seconds: "s",
  milliseconds: "ms",
  bpm: "bpm",
  "%": "%",
};

function abbreviateUnit(unit: string): string {
  return unitAbbreviations[unit.toLowerCase()] ?? ` ${unit}`;
}

function displayUnitLabel(unit: string): string {
  return unit.toLowerCase() === "percent" ? "%" : unit;
}

function formatChipLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(
    new Date(`${date}T00:00:00.000Z`),
  );
}
