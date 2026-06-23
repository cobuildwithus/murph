"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import type { TrendData } from "@/src/types/experiments";
import { cn } from "@/src/lib/utils";

interface TrendChartProps {
  data: TrendData;
  className?: string;
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

export function TrendChart({ data, className }: TrendChartProps) {
  const hasHistory = data.history.length > 0;
  const [showHistory, setShowHistory] = useState(false);
  const chartId = data.label.replace(/\s+/g, "-").toLowerCase();
  const lastBaselinePoint = data.baseline[data.baseline.length - 1];
  const baselineEnd = lastBaselinePoint?.day ?? 0;
  const expectedRange = data.expectedRange ?? [];
  const hasExpectedRange = expectedRange.length > 0;
  const deduped = buildTrendChartPoints(data, showHistory);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-secondary/25 bg-card/90 p-5",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 break-words font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {data.label}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {data.delta && (
            <span className="text-xs font-semibold text-primary">
              {data.delta}
            </span>
          )}
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            {hasHistory && (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 transition-opacity",
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
        </div>
      </div>

      <div className="group/chart relative">
        {hasHistory && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className={cn(
              "absolute left-1.5 top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-md border border-secondary/25 bg-[rgba(255,252,246,0.9)] transition-opacity duration-150 ease-out",
              showHistory
                ? "opacity-100"
                : "opacity-0 group-hover/chart:opacity-70 hover:!opacity-100",
            )}
            aria-label={showHistory ? "Hide history" : "Show history"}
          >
            {showHistory
              ? <ChevronRight className="size-3.5 text-chart-5" />
              : <ChevronLeft className="size-3.5 text-chart-5" />
            }
          </button>
        )}
      <ChartContainer config={chartConfig} className="h-32 w-full">
        <AreaChart data={deduped} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`fill-baseline-${chartId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D4C4A8" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#D4C4A8" stopOpacity={0.08} />
            </linearGradient>
            <linearGradient id={`fill-active-${chartId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7A8C6E" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#7A8C6E" stopOpacity={0.05} />
            </linearGradient>
          </defs>
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
                <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
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
            fill={`url(#fill-baseline-${chartId})`}
            connectNulls={false}
            dot={false}
          />
          <Area
            dataKey="active"
            type="monotone"
            stroke="#7A8C6E"
            strokeWidth={2.5}
            fill={`url(#fill-active-${chartId})`}
            connectNulls
            dot={false}
            activeDot={{ r: 4, fill: "#7A8C6E" }}
          />
        </AreaChart>
      </ChartContainer>
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>
          {data.baselineAvg} {data.unit} baseline
        </span>
        <span>
          {data.currentValue} {data.unit} current
        </span>
      </div>
    </div>
  );
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
