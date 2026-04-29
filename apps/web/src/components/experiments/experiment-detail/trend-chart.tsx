"use client";

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

type SeriesKey = "baseline" | "active" | "expectedRange";

const SERIES: Record<SeriesKey, { label: string; swatch: string }> = {
  baseline: { label: "Baseline", swatch: "border-t border-dashed border-secondary" },
  active: { label: "Active", swatch: "h-px bg-ring" },
  expectedRange: { label: "Expected", swatch: "h-2 rounded-sm bg-ring/20" },
};

interface ChartPoint {
  day: number;
  baseline?: number;
  active?: number;
  expectedRange?: [number, number];
}

export function TrendChart({ data, className }: TrendChartProps) {
  const chartId = data.label.replace(/\s+/g, "-").toLowerCase();
  const lastBaselinePoint = data.baseline[data.baseline.length - 1];
  const baselineEnd = lastBaselinePoint?.day ?? 0;
  const lastBaselineValue = lastBaselinePoint?.value;
  const expectedRange = data.expectedRange ?? [];
  const hasExpectedRange = expectedRange.length > 0;
  const allDays = new Set<number>([
    ...data.baseline.map((p) => p.day),
    ...data.active.map((p) => p.day),
    ...expectedRange.map((p) => p.day),
  ]);
  const baselineByDay = new Map(data.baseline.map((p) => [p.day, p.value]));
  const activeByDay = new Map(data.active.map((p) => [p.day, p.value]));
  const expectedByDay = new Map(
    expectedRange.map((p) => [p.day, [p.low, p.high] as [number, number]]),
  );
  const deduped: ChartPoint[] = [...allDays]
    .sort((a, b) => a - b)
    .map((day) => ({
      day,
      baseline: day <= baselineEnd ? baselineByDay.get(day) : undefined,
      active: day > baselineEnd
        ? activeByDay.get(day)
        : day === baselineEnd
          ? activeByDay.get(day) ?? lastBaselineValue
          : undefined,
      expectedRange: expectedByDay.get(day),
    }));

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
            <LegendSwatch seriesKey="baseline" />
            <LegendSwatch seriesKey="active" />
            {hasExpectedRange && <LegendSwatch seriesKey="expectedRange" />}
          </div>
        </div>
      </div>

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
                  <div className="font-medium text-foreground">Day {day}</div>
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
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, fill: "#7A8C6E" }}
          />
        </AreaChart>
      </ChartContainer>

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
