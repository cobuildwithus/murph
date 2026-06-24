import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";

import { Badge } from "@/src/components/ui/badge";
import {
  formatIsoDate,
  formatNumber,
} from "@/src/lib/browser-vault/display";
import type {
  ExperimentLibraryCard,
  ExperimentRunCardSummary,
} from "@/src/lib/experiments/library-cards";
import { cn } from "@/src/lib/utils";
import type { ExperimentSignal, TrendData } from "@/src/types/experiments";

const SPARKLINE_WIDTH = 220;
const SPARKLINE_HEIGHT = 72;
const SPARKLINE_PADDING = 4;

interface HomeExperimentCardProps {
  card: ExperimentLibraryCard;
}

export function HomeExperimentCard({ card }: HomeExperimentCardProps) {
  const dateLabel = (card.runStatus === "active" || card.runStatus === "paused") && card.startedOn
    ? `Started ${formatIsoDate(card.startedOn)}`
    : card.runSummary?.dateRange
      ?? (card.startedOn ? `Started ${formatIsoDate(card.startedOn)}` : null);
  const content = (
    <article
      className={cn(
        "group flex h-full min-h-[250px] flex-col rounded-xl border border-border/70 bg-card/70 p-5 transition-colors",
        card.href && "hover:border-primary/35 hover:bg-card",
      )}
      data-home-experiment-card
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {card.category}
          </span>
          <h3 className="mt-1 text-balance font-serif text-xl font-semibold leading-tight text-foreground">
            {card.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {card.privateBadgeLabel ? (
            <span
              className="inline-flex size-7 items-center justify-center rounded-full border border-border/70 text-muted-foreground"
              title={card.privateBadgeLabel}
            >
              <LockKeyhole aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{card.privateBadgeLabel}</span>
            </span>
          ) : null}
          {card.statusLabel ? (
            <Badge
              variant={card.statusVariant ?? "outline"}
              className="font-normal"
            >
              {card.statusLabel}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-5 border-t border-border/60 pt-5">
        <ExperimentRunVisual card={card} />
      </div>

      <div className="mt-auto flex items-center justify-between gap-4 pt-5 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate tabular-nums">
          {dateLabel ?? "Stored in your private vault"}
        </span>
        {card.href ? (
          <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground/70 transition-colors group-hover:text-foreground">
            View
            <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        ) : null}
      </div>
    </article>
  );

  if (!card.href) {
    return content;
  }

  return (
    <Link
      href={card.href}
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {content}
    </Link>
  );
}

function ExperimentRunVisual({ card }: HomeExperimentCardProps) {
  const summary = card.runSummary;

  if (summary?.primarySignal || summary?.primaryTrend) {
    return (
      <ExperimentResultVisual
        runStatus={card.runStatus}
        summary={summary}
      />
    );
  }

  if (typeof summary?.completionPercent === "number") {
    return (
      <ExperimentProgressVisual
        completionPercent={summary.completionPercent}
        day={summary.day}
        statusLabel={card.statusLabel}
      />
    );
  }

  return (
    <div className="flex min-h-24 flex-col justify-center">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Experiment status
      </span>
      <p className="mt-2 font-serif text-3xl font-semibold leading-none text-foreground">
        {card.statusLabel ?? "Private run"}
      </p>
    </div>
  );
}

function ExperimentResultVisual({
  runStatus,
  summary,
}: {
  runStatus: ExperimentLibraryCard["runStatus"];
  summary: ExperimentRunCardSummary;
}) {
  const signal = summary.primarySignal;
  const trend = summary.primaryTrend;
  const label = signal?.label ?? trend?.label ?? "Primary signal";
  const value = signal?.value ?? (trend ? formatNumber(trend.currentValue) : "—");
  const unit = signal?.unit ?? trend?.unit;
  const delta = signal?.delta || trend?.delta;
  const showProgress = (runStatus === "active" || runStatus === "paused")
    && typeof summary.completionPercent === "number";

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <span className="font-serif text-4xl font-semibold leading-none tabular-nums text-foreground">
              {value}
            </span>
            {unit ? (
              <span className="text-sm text-muted-foreground">{unit}</span>
            ) : null}
            {delta ? (
              <span className={resolveDeltaClassName(signal)}>
                {resolveDeltaArrow(signal)} {delta}
              </span>
            ) : null}
          </div>
        </div>
        {trend ? <ExperimentSparkline trend={trend} /> : null}
      </div>

      {trend ? (
        <div className="mt-3 flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
          <span className="truncate tabular-nums">
            Baseline {formatTrendValue(trend.baselineAvg, trend.unit)}
          </span>
          <span className="shrink-0 tabular-nums">
            Current {formatTrendValue(trend.currentValue, trend.unit)}
          </span>
        </div>
      ) : signal?.baseline ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Baseline {signal.baseline}
        </p>
      ) : null}

      {showProgress ? (
        <ExperimentProgressBar value={summary.completionPercent ?? 0} />
      ) : null}
    </div>
  );
}

function ExperimentProgressVisual({
  completionPercent,
  day,
  statusLabel,
}: {
  completionPercent: number;
  day?: number;
  statusLabel?: string;
}) {
  const value = clampProgress(completionPercent);

  return (
    <div className="flex min-h-24 flex-col justify-center">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Experiment progress
      </span>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <span className="font-serif text-4xl font-semibold leading-none tabular-nums text-foreground">
          {value}%
        </span>
        <span className="text-sm text-muted-foreground">
          {typeof day === "number" ? `Day ${day}` : statusLabel ?? "In progress"}
        </span>
      </div>
      <ExperimentProgressBar value={value} />
    </div>
  );
}

function ExperimentProgressBar({ value }: { value: number }) {
  const normalized = clampProgress(value);

  return (
    <div
      role="progressbar"
      aria-label="Experiment progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized}
      className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary/35"
    >
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${normalized}%` }}
      />
    </div>
  );
}

function ExperimentSparkline({ trend }: { trend: TrendData }) {
  const chart = buildSparklineChart(trend);

  if (!chart) {
    return null;
  }

  return (
    <svg
      aria-hidden="true"
      className="h-[72px] w-full min-w-0 sm:max-w-[220px]"
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
    >
      {chart.baselinePoints.length > 1 ? (
        <polyline
          className="text-secondary"
          fill="none"
          points={toPolyline(chart.baselinePoints)}
          stroke="currentColor"
          strokeDasharray="4 3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {chart.activePoints.length > 1 ? (
        <polyline
          className="text-primary"
          fill="none"
          points={toPolyline(chart.activePoints)}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <circle
        className={chart.currentIsActive ? "text-primary" : "text-secondary"}
        cx={chart.currentPoint.x}
        cy={chart.currentPoint.y}
        fill="currentColor"
        r="3"
      />
    </svg>
  );
}

interface SparklinePoint {
  x: number;
  y: number;
}

interface SparklineChart {
  activePoints: SparklinePoint[];
  baselinePoints: SparklinePoint[];
  currentIsActive: boolean;
  currentPoint: SparklinePoint;
}

function buildSparklineChart(trend: TrendData): SparklineChart | null {
  const baseline = normalizeTrendPoints(trend.baseline);
  const active = normalizeTrendPoints(trend.active);
  const lastBaseline = baseline[baseline.length - 1];
  const activeWithBridge = active.length > 0 && lastBaseline
    ? [lastBaseline, ...active.filter((point) => point.day > lastBaseline.day)]
    : active;
  const allPoints = [...baseline, ...activeWithBridge];

  if (allPoints.length === 0) {
    return null;
  }

  const days = allPoints.map((point) => point.day);
  const values = allPoints.map((point) => point.value);
  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const dayRange = maxDay - minDay;
  const valueRange = maxValue - minValue;
  const valuePadding = valueRange === 0
    ? Math.max(Math.abs(maxValue) * 0.02, 1)
    : valueRange * 0.12;
  const chartMin = minValue - valuePadding;
  const chartRange = maxValue + valuePadding - chartMin || 1;
  const scalePoint = (point: { day: number; value: number }): SparklinePoint => ({
    x: dayRange === 0
      ? SPARKLINE_WIDTH / 2
      : SPARKLINE_PADDING
        + ((point.day - minDay) / dayRange) * (SPARKLINE_WIDTH - SPARKLINE_PADDING * 2),
    y: SPARKLINE_HEIGHT - SPARKLINE_PADDING
      - ((point.value - chartMin) / chartRange) * (SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2),
  });
  const currentSource = active[active.length - 1] ?? lastBaseline ?? allPoints[allPoints.length - 1];

  if (!currentSource) {
    return null;
  }

  return {
    activePoints: activeWithBridge.map(scalePoint),
    baselinePoints: baseline.map(scalePoint),
    currentIsActive: active.length > 0,
    currentPoint: scalePoint(currentSource),
  };
}

function normalizeTrendPoints(
  points: readonly { day: number; value: number }[],
): { day: number; value: number }[] {
  return points
    .filter((point) => Number.isFinite(point.day) && Number.isFinite(point.value))
    .slice()
    .sort((a, b) => a.day - b.day);
}

function toPolyline(points: readonly SparklinePoint[]): string {
  return points
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
}

function formatTrendValue(value: number, unit: string): string {
  const formatted = formatNumber(value, {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  });

  return unit ? `${formatted} ${unit}` : formatted;
}

function resolveDeltaArrow(signal: ExperimentSignal | undefined): string {
  if (signal?.direction === "up") return "↑";
  if (signal?.direction === "down") return "↓";
  return "→";
}

function resolveDeltaClassName(signal: ExperimentSignal | undefined): string {
  const sentiment = signal?.sentiment
    ?? (signal?.direction === "up"
      ? "positive"
      : signal?.direction === "down"
        ? "negative"
        : "neutral");

  if (sentiment === "positive") {
    return "ml-1 text-sm font-semibold tabular-nums text-primary";
  }

  if (sentiment === "negative") {
    return "ml-1 text-sm font-semibold tabular-nums text-amber-600";
  }

  return "ml-1 text-sm font-semibold tabular-nums text-muted-foreground";
}

function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
