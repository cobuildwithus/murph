"use client";

import { LineChartIcon, LockKeyholeIcon } from "lucide-react";
import { useMemo } from "react";

import type { BrowserVaultQueryClient } from "@murphai/query/browser";

import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
  useBrowserVault,
  type BrowserVaultStatus,
} from "@/src/lib/browser-vault/context";
import {
  buildTrendComparison,
  formatMetricValue,
  formatTrendDeltaSummary,
  hasNumericMetricValue,
  type BrowserVaultMetricRowWithValue,
  type TrendComparison,
} from "@/src/lib/browser-vault/trend-comparison";
import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";
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
  | { message: string; status: "empty" }
  | { message: string; status: "error" }
  | { message: string; pointCount: number; status: "insufficient_data" }
  | {
      comparison: TrendComparison | null;
      latest: TrendLatestValue;
      series: TrendPoint[];
      status: "ready";
    };

export function BiomarkerPrivateTrendCard({ biomarker }: { biomarker: BiomarkerPageModel }) {
  const { client, error, refresh, status } = useBrowserVault();
  const trend = useMemo(
    () => resolvePrivateTrend({ biomarker, browserVaultStatus: status, client, error }),
    [biomarker, client, error, status],
  );

  if (trend.status === "loading") {
    return (
      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Your private {biomarker.shortName}</CardTitle>
          <CardDescription>Loading browser-vault data…</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-16 w-40" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (trend.status === "empty" || trend.status === "insufficient_data") {
    return (
      <Card className="border border-border/60">
        <CardHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <LockKeyholeIcon className="size-5" aria-hidden />
          </div>
          <CardTitle>Your private {biomarker.shortName}</CardTitle>
          <CardDescription>{trend.message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Connect wearable data or sync a browser-vault replica to see this module. Nothing
            from this card is public.
          </div>
          {trend.status === "insufficient_data" ? (
            <p className="text-xs text-muted-foreground">
              Found {trend.pointCount} point{trend.pointCount === 1 ? "" : "s"}; Murph waits
              for at least {biomarker.trendDefaults.minimumPoints} before summarizing a trend.
            </p>
          ) : null}
        </CardContent>
      </Card>
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
              Murph compares this to your own recent baseline, not to other people.
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
  comparison: TrendComparison;
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
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
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
  biomarker: BiomarkerPageModel;
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

  // TEMPORARY: when no browser-vault client is connected, fall back to mocked
  // rows so we can iterate on the populated trend visual. Drop once real
  // wearable integration lands. Tracked in TODOS.md.
  if (!input.client) {
    return resolveMockedTrend(input.biomarker);
  }

  const binding = input.biomarker.privateMetricBindings.find(isBrowserVaultMetricBinding);

  if (!binding) {
    return {
      message: "This biomarker does not have a browser-vault metric binding yet.",
      status: "empty",
    };
  }

  const rows = input.client.metrics
    .series({ domain: binding.domain, metric: binding.metric })
    .filter(hasNumericMetricValue)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (rows.length < input.biomarker.trendDefaults.minimumPoints) {
    return {
      message: `Not enough ${input.biomarker.shortName} data yet for a clean trend.`,
      pointCount: rows.length,
      status: "insufficient_data",
    };
  }

  const latestRow = rows.at(-1);

  if (!latestRow) {
    return {
      message: `No ${input.biomarker.shortName} values were found in browser-vault.`,
      status: "empty",
    };
  }

  return {
    comparison: buildTrendComparison(rows as BrowserVaultMetricRowWithValue[], input.biomarker),
    latest: {
      confidence: latestRow.confidence,
      date: latestRow.date,
      sourceLabel: latestRow.sourceKind ?? latestRow.sourceFamily ?? "wearable summary",
      value: latestRow.value,
    },
    series: rows.map((row) => ({ date: row.date, value: row.value })),
    status: "ready",
  };
}

// TEMPORARY: per-biomarker mock baselines and direction so the trend card
// renders a realistic populated state during design iteration. Drop once
// real browser-vault wearable data is connected.
const MOCK_BASELINES: Record<
  string,
  { baseline: number; deltaOverSpan: number; noise: number }
> = {
  "resting-heart-rate": { baseline: 62, deltaOverSpan: -4, noise: 1.2 },
  "hrv-rmssd": { baseline: 42, deltaOverSpan: 6, noise: 2 },
  "estimated-vo2max": { baseline: 45, deltaOverSpan: 1.4, noise: 0.4 },
  "blood-glucose": { baseline: 92, deltaOverSpan: -3, noise: 2 },
  "deep-sleep-minutes": { baseline: 75, deltaOverSpan: 12, noise: 5 },
  "rem-sleep-minutes": { baseline: 95, deltaOverSpan: 8, noise: 6 },
  "blood-oxygen-spo2": { baseline: 96.5, deltaOverSpan: 0.4, noise: 0.3 },
};

function resolveMockedTrend(biomarker: BiomarkerPageModel): PrivateTrendState {
  const profile =
    MOCK_BASELINES[biomarker.routeId] ??
    { baseline: 1, deltaOverSpan: 0, noise: 0.1 };
  const days = 30;
  // Seed pseudorandom so renders are stable per biomarker (no hydration drift)
  const seed = simpleHash(biomarker.routeId);
  const rng = mulberry32(seed);

  const today = new Date();
  const rows: BrowserVaultMetricRowWithValue[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    const progress = (days - 1 - i) / (days - 1);
    const trend = profile.deltaOverSpan * progress;
    const noise = (rng() - 0.5) * profile.noise * 2;
    const raw = profile.baseline + trend + noise;
    const value = Number(raw.toFixed(biomarker.valuePrecision));
    rows.push({
      confidence: "high",
      date: date.toISOString().slice(0, 10),
      domain: "recovery",
      id: `mock-${biomarker.routeId}-${i}`,
      metric: biomarker.routeId,
      recordIds: [],
      sourceFamily: "wearable",
      sourceKind: "demo wearable",
      unit: biomarker.unit,
      value,
    });
  }

  const latestRow = rows.at(-1);
  if (!latestRow) {
    return { message: "Demo data unavailable.", status: "empty" };
  }

  return {
    comparison: buildTrendComparison(rows, biomarker),
    latest: {
      confidence: latestRow.confidence,
      date: latestRow.date,
      sourceLabel: latestRow.sourceKind ?? "demo wearable",
      value: latestRow.value,
    },
    series: rows.map((row) => ({ date: row.date, value: row.value })),
    status: "ready",
  };
}

function simpleHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
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
