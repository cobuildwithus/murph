"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/src/components/ui/chart";
import {
  formatLabNumber,
  formatLabUnit,
} from "@/src/lib/biomarkers/lab-result-display";

export interface LabBiomarkerChartPoint {
  date: string;
  id: string;
  value: number;
}

const chartConfig = {
  value: {
    color: "var(--chart-1)",
    label: "Result",
  },
} satisfies ChartConfig;

export function LabBiomarkerHistoryChart({
  displayName,
  points,
  unit,
}: {
  displayName: string;
  points: readonly LabBiomarkerChartPoint[];
  unit: string | null;
}) {
  const data = useMemo(
    () =>
      points.flatMap((point) => {
        const time = Date.parse(`${point.date}T00:00:00.000Z`);
        if (!Number.isFinite(time) || !Number.isFinite(point.value)) {
          return [];
        }

        return [{
          date: point.date,
          id: point.id,
          time,
          value: point.value,
        }];
      }),
    [points],
  );
  const xDomain = useMemo(() => resolveTimeDomain(data.map((point) => point.time)), [data]);

  return (
    <ChartContainer
      aria-label={`${displayName} results over time`}
      className="h-72 w-full sm:h-80"
      config={chartConfig}
      initialDimension={{ height: 320, width: 760 }}
      role="img"
    >
      <LineChart
        accessibilityLayer={false}
        data={data}
        margin={{ bottom: 0, left: 0, right: 12, top: 12 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 5" />
        <XAxis
          axisLine={false}
          dataKey="time"
          domain={xDomain}
          minTickGap={48}
          scale="time"
          tickFormatter={(value) => formatAxisDate(Number(value))}
          tickLine={false}
          tickMargin={10}
          type="number"
        />
        <YAxis
          axisLine={false}
          domain={["auto", "auto"]}
          tickFormatter={(value) => formatLabNumber(Number(value))}
          tickLine={false}
          tickMargin={8}
          width={72}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeDasharray: "3 5" }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_label, payload) => {
                const item = payload[0]?.payload as { date?: string } | undefined;
                return item?.date ? formatFullDate(item.date) : "";
              }}
              formatter={(value) => (
                <div className="flex min-w-32 items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">Result</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatLabNumber(Number(value))}{unit ? ` ${formatLabUnit(unit)}` : ""}
                  </span>
                </div>
              )}
            />
          }
        />
        <Line
          activeDot={{ fill: "var(--color-value)", r: 5, strokeWidth: 0 }}
          dataKey="value"
          dot={{ fill: "var(--background)", r: 4, stroke: "var(--color-value)", strokeWidth: 2 }}
          isAnimationActive={false}
          stroke="var(--color-value)"
          strokeWidth={2.5}
          type="linear"
        />
      </LineChart>
    </ChartContainer>
  );
}

function resolveTimeDomain(times: readonly number[]): [number, number] | ["dataMin", "dataMax"] {
  if (times.length === 0) {
    return ["dataMin", "dataMax"];
  }

  const first = Math.min(...times);
  const last = Math.max(...times);
  if (first !== last) {
    return ["dataMin", "dataMax"];
  }

  const oneMonth = 1000 * 60 * 60 * 24 * 30;
  return [first - oneMonth, first + oneMonth];
}

function formatAxisDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatFullDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}
