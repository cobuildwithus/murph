"use client";

import { useMemo } from "react";
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
  displayValue?: string;
  id: string;
  value: number;
}

export interface LabBiomarkerChartRange {
  high: number | null;
  low: number | null;
}

export type LabBiomarkerReferenceRangeTone = "context" | "lab";

const chartConfig = {
  value: {
    color: "var(--chart-1)",
    label: "Result",
  },
} satisfies ChartConfig;

const LAB_RANGE_LINE_STYLE = {
  stroke: "var(--color-value)",
  strokeDasharray: "4 4",
  strokeOpacity: 0.5,
} as const;

const CONTEXT_RANGE_LINE_STYLE = {
  stroke: "var(--muted-foreground)",
  strokeDasharray: "4 4",
  strokeOpacity: 0.45,
} as const;

const IN_RANGE_AREA_STYLE = {
  fill: "var(--primary)",
  fillOpacity: 0.1,
  ifOverflow: "hidden",
  stroke: "none",
} as const;

const OUT_OF_RANGE_AREA_STYLE = {
  fill: "var(--destructive)",
  fillOpacity: 0.07,
  ifOverflow: "hidden",
  stroke: "none",
} as const;

// Recharts needs a positive seed before ResizeObserver reports the container.
// Keep the real chart height, but use a non-constraining width so the initial
// render cannot widen a narrow page before the responsive measurement lands.
const RESPONSIVE_INITIAL_DIMENSION = { height: 320, width: 1 };

export function LabBiomarkerHistoryChart({
  ariaDescribedBy,
  displayName,
  points,
  referenceRange = null,
  referenceRangeLabel = null,
  referenceRangeSourceLabel = null,
  referenceRangeTitle = "Latest lab range",
  referenceRangeTone = "lab",
  unit,
}: {
  ariaDescribedBy?: string;
  displayName: string;
  points: readonly LabBiomarkerChartPoint[];
  referenceRange?: LabBiomarkerChartRange | null;
  referenceRangeLabel?: string | null;
  referenceRangeSourceLabel?: string | null;
  referenceRangeTitle?: string;
  referenceRangeTone?: LabBiomarkerReferenceRangeTone;
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
          displayValue: point.displayValue,
          id: point.id,
          time,
          value: point.value,
        }];
      }),
    [points],
  );
  const xDomain = useMemo(() => resolveTimeDomain(data.map((point) => point.time)), [data]);
  const range = normalizeRange(referenceRange);
  const rangeLabel = range ? referenceRangeLabel?.trim() || null : null;
  const rangeSourceLabel = rangeLabel ? referenceRangeSourceLabel?.trim() || null : null;
  const rangeIsBand = range !== null && range.low !== null && range.high !== null;
  const isLabRange = referenceRangeTone === "lab";
  const inRangeArea = isLabRange ? resolveInRangeArea(range) : null;
  const rangeLineStyle = isLabRange
    ? LAB_RANGE_LINE_STYLE
    : CONTEXT_RANGE_LINE_STYLE;
  const rangeLegendClassName = resolveRangeLegendClassName(
    rangeIsBand,
    referenceRangeTone,
  );
  const yDomain = resolveYDomain(range);

  return (
    <div className="min-w-0">
      {rangeLabel ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span aria-hidden="true" className={rangeLegendClassName} />
          <span>{referenceRangeTitle}</span>
          <span className="font-mono tabular-nums text-foreground">{rangeLabel}</span>
          {rangeSourceLabel ? (
            <span className="min-w-0">
              <span aria-hidden="true" className="mr-2 text-border">/</span>
              {rangeSourceLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      <ChartContainer
        aria-describedby={ariaDescribedBy}
        aria-label={`${displayName} results over time${rangeLabel ? `; ${referenceRangeTitle.toLowerCase()} ${rangeLabel}${rangeSourceLabel ? ` from ${rangeSourceLabel}` : ""}` : ""}`}
        className="h-72 w-full sm:h-80"
        config={chartConfig}
        initialDimension={RESPONSIVE_INITIAL_DIMENSION}
        role="img"
      >
        <LineChart
          accessibilityLayer={false}
          data={data}
          margin={{ bottom: 0, left: 0, right: 12, top: 12 }}
        >
          {isLabRange && range && range.low !== null ? (
            <ReferenceArea
              {...OUT_OF_RANGE_AREA_STYLE}
              y1={range.low}
            />
          ) : null}
          {isLabRange && range && range.high !== null ? (
            <ReferenceArea
              {...OUT_OF_RANGE_AREA_STYLE}
              y2={range.high}
            />
          ) : null}
          {inRangeArea ? (
            <ReferenceArea
              {...IN_RANGE_AREA_STYLE}
              {...inRangeArea}
            />
          ) : null}
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
            domain={yDomain}
            padding={range ? { bottom: 16, top: 16 } : undefined}
            tickFormatter={(value) => formatLabNumber(Number(value))}
            tickLine={false}
            tickMargin={6}
            width="auto"
          />
          {range && range.low !== null ? (
            <ReferenceLine
              {...rangeLineStyle}
              ifOverflow="hidden"
              y={range.low}
            />
          ) : null}
          {range && range.high !== null ? (
            <ReferenceLine
              {...rangeLineStyle}
              ifOverflow="hidden"
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
                formatter={(value, _name, item) => {
                  const point = item?.payload as { displayValue?: string } | undefined;
                  const displayValue = point?.displayValue ?? formatLabNumber(Number(value));

                  return (
                    <div className="flex min-w-32 items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">Result</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {displayValue}{labUnitSuffix(unit)}
                      </span>
                    </div>
                  );
                }}
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
    </div>
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
  if (low !== null && high !== null && low >= high) {
    return null;
  }

  return { high, low };
}

function resolveInRangeArea(
  range: LabBiomarkerChartRange | null,
): { y1?: number; y2?: number } | null {
  if (!range) {
    return null;
  }
  if (range.low !== null && range.high !== null) {
    return { y1: range.low, y2: range.high };
  }
  if (range.low !== null) {
    return { y2: range.low };
  }
  return range.high !== null ? { y1: range.high } : null;
}

function resolveRangeLegendClassName(
  rangeIsBand: boolean,
  tone: LabBiomarkerReferenceRangeTone,
): string {
  if (tone === "lab") {
    return rangeIsBand
      ? "h-2 w-5 shrink-0 rounded-[2px] border-y border-dashed border-primary/50 bg-primary/10"
      : "h-0 w-5 shrink-0 border-t border-dashed border-primary/50";
  }

  return rangeIsBand
    ? "h-2 w-5 shrink-0 border-y border-dashed border-muted-foreground/40"
    : "h-0 w-5 shrink-0 border-t border-dashed border-muted-foreground/40";
}

function resolveYDomain(
  range: LabBiomarkerChartRange | null,
): ["auto", "auto"] | [
  (dataMinimum: number) => number,
  (dataMaximum: number) => number,
] {
  if (!range) {
    return ["auto", "auto"];
  }

  const minimumBound = range.low ?? range.high;
  const maximumBound = range.high ?? range.low;

  return [
    (dataMinimum) => minimumBound === null
      ? dataMinimum
      : Math.min(dataMinimum, minimumBound),
    (dataMaximum) => maximumBound === null
      ? dataMaximum
      : Math.max(dataMaximum, maximumBound),
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
