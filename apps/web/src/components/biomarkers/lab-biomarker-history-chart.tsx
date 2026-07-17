"use client";

import { useMemo, type ComponentProps } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
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
  labUnitSuffix,
} from "@/src/lib/biomarkers/lab-result-display";

export interface LabBiomarkerChartPoint {
  date: string;
  id: string;
  value: number;
}

export interface LabBiomarkerChartRange {
  high: number | null;
  low: number | null;
}

const chartConfig = {
  value: {
    color: "var(--chart-1)",
    label: "Result",
  },
} satisfies ChartConfig;

const RANGE_LINE_STYLE = {
  stroke: "var(--color-value)",
  strokeDasharray: "4 4",
  strokeOpacity: 0.5,
} as const;

export function LabBiomarkerHistoryChart({
  displayName,
  points,
  referenceRange = null,
  unit,
}: {
  displayName: string;
  points: readonly LabBiomarkerChartPoint[];
  referenceRange?: LabBiomarkerChartRange | null;
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
  const range = normalizeRange(referenceRange);
  const yDomain = useMemo(
    () => resolveValueDomain(range, data.map((point) => point.value)),
    [data, range],
  );

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
        {range ? null : <CartesianGrid vertical={false} strokeDasharray="3 5" />}
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
          domain={yDomain}
          padding={range ? { bottom: 16, top: 16 } : undefined}
          tickFormatter={(value) => formatLabNumber(Number(value))}
          tickLine={false}
          tickMargin={8}
          width={72}
        />
        {range && range.low !== null && range.high !== null ? (
          <ReferenceArea
            fill="var(--color-value)"
            fillOpacity={0.08}
            ifOverflow="extendDomain"
            stroke="none"
            y1={range.low}
            y2={range.high}
          />
        ) : null}
        {range && range.low !== null ? (
          <ReferenceLine
            {...RANGE_LINE_STYLE}
            ifOverflow="extendDomain"
            y={range.low}
          />
        ) : null}
        {range && range.high !== null ? (
          <ReferenceLine
            {...RANGE_LINE_STYLE}
            ifOverflow="extendDomain"
            y={range.high}
          />
        ) : null}
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
                    {formatLabNumber(Number(value))}{labUnitSuffix(unit)}
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

function normalizeRange(
  range: LabBiomarkerChartRange | null | undefined,
): LabBiomarkerChartRange | null {
  if (!range) {
    return null;
  }

  const low = range.low !== null && Number.isFinite(range.low) ? range.low : null;
  const high = range.high !== null && Number.isFinite(range.high) ? range.high : null;
  if (low === null && high === null) {
    return null;
  }

  return { high, low };
}

function resolveValueDomain(
  range: LabBiomarkerChartRange | null,
  values: readonly number[],
): ComponentProps<typeof YAxis>["domain"] {
  if (!range || values.length === 0) {
    return ["auto", "auto"];
  }

  // Keep every reference bound and data point visible, rounded outward to
  // tick-friendly values; pixel padding on the axis provides the headroom so
  // data and band never touch the plot edges.
  const min = Math.min(...values, range.low ?? Infinity, range.high ?? Infinity);
  const max = Math.max(...values, range.high ?? -Infinity, range.low ?? -Infinity);
  if (min === max) {
    return ["auto", "auto"];
  }

  const step = 10 ** Math.floor(Math.log10(max - min)) / 2;
  return [
    Math.floor(min / step) * step,
    Math.ceil(max / step) * step,
  ];
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
