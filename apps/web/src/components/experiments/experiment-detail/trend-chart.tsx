"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
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
} satisfies ChartConfig;

export function TrendChart({ data, className }: TrendChartProps) {
  const chartId = data.label.replace(/\s+/g, "-").toLowerCase();
  const allPoints = [...data.baseline, ...data.active];
  const baselineEnd = data.baseline[data.baseline.length - 1]?.day ?? 0;

  const chartData = allPoints.map((p) => ({
    day: p.day,
    baseline: p.day <= baselineEnd ? p.value : undefined,
    active: p.day >= baselineEnd ? p.value : undefined,
  }));

  // Dedupe by day (baseline end overlaps with active start)
  const deduped = chartData.reduce(
    (acc, item) => {
      const existing = acc.find((a) => a.day === item.day);
      if (existing) {
        if (item.baseline !== undefined) existing.baseline = item.baseline;
        if (item.active !== undefined) existing.active = item.active;
      } else {
        acc.push({ ...item });
      }
      return acc;
    },
    [] as typeof chartData
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-secondary/25 bg-card/90 p-5",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {data.label}
        </span>
        <div className="flex items-center gap-3">
          {data.delta && (
            <span className="text-xs font-semibold text-primary">
              {data.delta}
            </span>
          )}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-3 border-t border-dashed border-secondary" />
              Baseline
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-3 bg-ring" />
              Active
            </span>
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
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v) => `Day ${v}`}
              />
            }
          />
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
