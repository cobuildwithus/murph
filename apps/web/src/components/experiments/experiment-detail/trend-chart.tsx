"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/src/components/ui/chart";
import type { ExperimentSignal, TrendData } from "@/src/types/experiments";
import { cn } from "@/src/lib/utils";

interface TrendChartProps {
  data: TrendData;
  className?: string;
  signal?: ExperimentSignal;
}

const chartConfig = {
  history: {
    label: "History",
    color: "#D4C4A8",
  },
  baseline: {
    label: "Baseline",
    color: "#D4C4A8",
  },
  active: {
    label: "Active",
    color: "#7A8C6E",
  },
  expectedRange: {
    label: "Expected",
    color: "#7A8C6E",
  },
} satisfies ChartConfig;

type SeriesKey = "history" | "baseline" | "active" | "expectedRange";

const SERIES: Record<SeriesKey, { label: string; swatch: string }> = {
  history: { label: "History", swatch: "border-t border-dotted border-secondary/60" },
  baseline: { label: "Baseline", swatch: "border-t border-dashed border-secondary" },
  active: { label: "Active", swatch: "h-px bg-ring" },
  expectedRange: { label: "Expected", swatch: "h-2 rounded-sm bg-ring/20" },
};

export interface TrendChartPoint {
  day: number;
  history?: number;
  baseline?: number;
  active?: number;
  expectedRange?: [number, number];
}

export function TrendChart({ data, className, signal }: TrendChartProps) {
  const hasHistory = data.history.length > 0;
  const [showHistory, setShowHistory] = useState(false);
  const lastBaselinePoint = data.baseline[data.baseline.length - 1];
  const baselineEnd = lastBaselinePoint?.day ?? 0;
  const expectedRange = data.expectedRange ?? [];
  const hasExpectedRange = expectedRange.length > 0;
  const deduped = buildTrendChartPoints(data, showHistory);
  const metricValue = signal?.value ?? formatChartValue(data.currentValue);
  const metricUnit = signal?.unit ?? data.unit;
  const delta = signal?.delta ?? data.delta;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="min-w-0 break-words font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {data.label}
          </span>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-serif text-3xl font-semibold tabular-nums tracking-tight text-foreground">
              {metricValue}
            </span>
            {metricUnit ? (
              <span className="text-sm text-muted-foreground">{metricUnit}</span>
            ) : null}
            {delta ? (
              <span className={cn("text-sm font-semibold tabular-nums", resolveDeltaClassName(signal))}>
                {signal ? `${DIRECTION_ARROWS[signal.direction]} ${delta}` : delta}
              </span>
            ) : null}
          </div>
        </div>
        {data.windowComparison ? (
          <span className="rounded-full bg-muted/50 px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            Window averages
          </span>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            {hasHistory && (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                aria-pressed={showHistory}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  showHistory ? "opacity-100" : "opacity-50 hover:opacity-75",
                )}
              >
                <span aria-hidden="true" className={cn("inline-block w-3", SERIES.history.swatch)} />
                History
              </button>
            )}
            <LegendSwatch seriesKey="baseline" />
            <LegendSwatch seriesKey="active" />
            {hasExpectedRange && <LegendSwatch seriesKey="expectedRange" />}
          </div>
        )}
      </div>

      {data.windowComparison ? (
        <WindowComparisonChart data={data} />
      ) : (
        <>
          <ChartContainer config={chartConfig} className="h-40 w-full">
            <AreaChart data={deduped} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} />
              <XAxis dataKey="day" hide />
              <YAxis hide domain={["auto", "auto"]} />
              {baselineEnd > 0 && (
                <ReferenceLine
                  x={baselineEnd}
                  stroke="var(--color-foreground)"
                  strokeOpacity={0.25}
                  strokeDasharray="2 3"
                />
              )}
              <ChartTooltip
                cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const day = payload[0]?.payload?.day;
                  const rows = payload
                    .map((entry) => formatTooltipRow(entry, data.unit))
                    .filter((row): row is { key: SeriesKey; label: string; value: string } => row !== null);

                  if (rows.length === 0) return null;

                  return (
                    <div className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs">
                      <div className="font-medium text-foreground">
                        {dayToDate(data.startDate, day)}
                      </div>
                      <div className="mt-1 grid gap-1">
                        {rows.map((row) => (
                          <div key={row.key} className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span
                                aria-hidden="true"
                                className={cn("inline-block w-3", SERIES[row.key].swatch)}
                              />
                              {row.label}
                            </span>
                            <span className="font-mono tabular-nums text-foreground">{row.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }}
              />
              {showHistory && (
                <Area
                  dataKey="history"
                  type="monotone"
                  stroke="#B0A48C"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  strokeOpacity={1}
                  fill="none"
                  connectNulls
                  dot={false}
                  activeDot={false}
                />
              )}
              {hasExpectedRange && (
                <Area
                  dataKey="expectedRange"
                  type="monotone"
                  stroke="#7A8C6E"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                  fill="#7A8C6E"
                  fillOpacity={0.12}
                  connectNulls={false}
                  dot={false}
                  activeDot={false}
                />
              )}
              <Area
                dataKey="baseline"
                type="monotone"
                stroke="#d4c4a8"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="#d4c4a8"
                fillOpacity={0.12}
                connectNulls={false}
                dot={false}
              />
              <Area
                dataKey="active"
                type="monotone"
                stroke="#7A8C6E"
                strokeWidth={2.5}
                fill="none"
                connectNulls
                dot={false}
                activeDot={{ r: 4, fill: "#7A8C6E" }}
              />
            </AreaChart>
          </ChartContainer>

          <div className="flex justify-between gap-4 text-[10px] text-muted-foreground">
            <span>
              {formatChartValue(data.baselineAvg)} {data.unit} baseline average
            </span>
            <span className="text-right">
              {formatChartValue(data.currentValue)} {data.unit}{" "}
              {data.currentValueLabel ?? "latest"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

const DIRECTION_ARROWS: Record<ExperimentSignal["direction"], string> = {
  up: "↑",
  down: "↓",
  neutral: "→",
};

function resolveDeltaClassName(signal: ExperimentSignal | undefined): string {
  if (signal?.sentiment === "positive") return "text-primary";
  if (signal?.sentiment === "negative") return "text-amber-700";
  return "text-muted-foreground";
}

function WindowComparisonChart({ data }: { data: TrendData }) {
  const comparison = data.windowComparison;
  if (!comparison) return null;

  const comparisonScale = Math.max(
    Math.abs(data.baselineAvg),
    Math.abs(data.currentValue),
    1,
  );
  const relativeChange = (data.currentValue - data.baselineAvg) / comparisonScale;
  const baselineY = 51;
  const interventionY = Math.min(84, Math.max(18, baselineY - relativeChange * 240));
  const baselineCoverage = formatCoverage(
    comparison.baselineDaysWithData,
    comparison.baselineTotalDays,
  );
  const interventionCoverage = formatCoverage(
    comparison.interventionDaysWithData,
    comparison.interventionTotalDays,
  );

  return (
    <div className="flex flex-col gap-3">
      <svg
        aria-label={`${data.label}: baseline window average ${formatChartValue(data.baselineAvg)} ${data.unit}; experiment window average ${formatChartValue(data.currentValue)} ${data.unit}.`}
        className="h-28 w-full overflow-visible"
        role="img"
        viewBox="0 0 320 104"
      >
        {[18, 51, 84].map((y) => (
          <line
            key={y}
            x1="24"
            x2="296"
            y1={y}
            y2={y}
            stroke="var(--color-border)"
            strokeDasharray="3 4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d={`M 28 ${baselineY} L 292 ${interventionY}`}
          fill="none"
          stroke="var(--color-primary)"
          strokeLinecap="round"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx="28"
          cy={baselineY}
          fill="var(--color-card)"
          r="5"
          stroke="var(--color-chart-2)"
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx="292"
          cy={interventionY}
          fill="var(--color-primary)"
          r="5"
        />
      </svg>

      <div className="grid grid-cols-2 gap-4 border-t border-border/70 pt-3">
        <WindowLabel
          coverage={baselineCoverage}
          label="Baseline average"
          unit={data.unit}
          value={data.baselineAvg}
        />
        <WindowLabel
          align="right"
          coverage={interventionCoverage}
          label="Experiment average"
          unit={data.unit}
          value={data.currentValue}
        />
      </div>
    </div>
  );
}

function WindowLabel({
  align = "left",
  coverage,
  label,
  unit,
  value,
}: {
  align?: "left" | "right";
  coverage: string;
  label: string;
  unit: string;
  value: number;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", align === "right" && "items-end text-right")}>
      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="text-xs font-medium tabular-nums text-foreground">
        {formatChartValue(value)} {unit}
      </span>
      <span className="text-[10px] text-muted-foreground">{coverage}</span>
    </div>
  );
}

function formatCoverage(daysWithData: number, totalDays: number): string {
  if (totalDays > 0) {
    return `${daysWithData} of ${totalDays} days measured`;
  }
  return `${daysWithData} ${daysWithData === 1 ? "day" : "days"} measured`;
}

function formatChartValue(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

export function buildTrendChartPoints(data: TrendData, showHistory: boolean): TrendChartPoint[] {
  const lastBaselinePoint = data.baseline[data.baseline.length - 1];
  const baselineEnd = lastBaselinePoint?.day ?? 0;
  const lastBaselineValue = lastBaselinePoint?.value;
  const firstBaselinePoint = data.baseline[0];
  const firstBaselineDay = firstBaselinePoint?.day ?? 0;
  const expectedRange = data.expectedRange ?? [];
  const historyPoints = showHistory
    ? [
        ...data.history.filter((point) => point.day < firstBaselineDay),
        ...(firstBaselinePoint ? [{ day: firstBaselinePoint.day, value: firstBaselinePoint.value }] : []),
      ]
    : [];
  const activeWithBridge = lastBaselineValue !== undefined
    ? [{ day: baselineEnd, value: lastBaselineValue }, ...data.active.filter((point) => point.day > baselineEnd)]
    : data.active;
  const allDays = new Set<number>([
    ...historyPoints.map((point) => point.day),
    ...data.baseline.map((point) => point.day),
    ...activeWithBridge.map((point) => point.day),
    ...expectedRange.map((point) => point.day),
  ]);
  const historyByDay = new Map(historyPoints.map((point) => [point.day, point.value]));
  const baselineByDay = new Map(data.baseline.map((point) => [point.day, point.value]));
  const activeByDay = new Map(activeWithBridge.map((point) => [point.day, point.value]));
  const expectedByDay = new Map(
    expectedRange.map((point) => [point.day, [point.low, point.high] as [number, number]]),
  );

  return [...allDays]
    .sort((a, b) => a - b)
    .map((day) => ({
      day,
      history: showHistory && day <= firstBaselineDay ? historyByDay.get(day) : undefined,
      baseline: day <= baselineEnd ? baselineByDay.get(day) : undefined,
      active: day >= baselineEnd ? activeByDay.get(day) : undefined,
      expectedRange: expectedByDay.get(day),
    }));
}

function LegendSwatch({ seriesKey }: { seriesKey: SeriesKey }) {
  const series = SERIES[seriesKey];
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("inline-block w-3", series.swatch)} />
      {series.label}
    </span>
  );
}

interface TooltipRow {
  key: SeriesKey;
  label: string;
  value: string;
}

function formatTooltipRow(
  entry: { dataKey?: string | number | ((obj: unknown) => unknown); value?: unknown },
  unit: string,
): TooltipRow | null {
  const key = String(entry.dataKey ?? "");
  if (!(key in SERIES)) return null;
  const seriesKey = key as SeriesKey;
  const label = SERIES[seriesKey].label;

  if (seriesKey === "expectedRange") {
    if (!Array.isArray(entry.value) || entry.value[0] == null) return null;
    return { key: seriesKey, label, value: `${entry.value[0]}–${entry.value[1]} ${unit}` };
  }

  if (entry.value == null) return null;
  return { key: seriesKey, label, value: `${entry.value} ${unit}` };
}

function dayToDate(startDate: string, day: number): string {
  const date = new Date(startDate);
  date.setDate(date.getDate() + day - 1);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
