"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  type ChartConfig,
} from "@/src/components/ui/chart";
import { generateMockedBiomarkerRows } from "@/src/lib/biomarkers/biomarker-mock-trend";
import {
  resolveBiomarkerAnalysis,
  type BiomarkerAnalysisProfile,
} from "@/src/lib/biomarkers/biomarker-analysis";
import { formatMetricValue } from "@/src/lib/browser-vault/trend-comparison";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";
import { cn } from "@/src/lib/utils";

type Timeframe = "30d" | "90d" | "1y";

const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
};

const TIMEFRAME_PAST_LABELS: Record<Timeframe, string> = {
  "30d": "the past month",
  "90d": "the past 3 months",
  "1y": "the past year",
};

interface TrendPoint {
  date: string;
  value: number;
}

export function BiomarkerTrendDetail({ biomarker }: { biomarker: BiomarkerPageModel }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const { client } = useBrowserVault();
  const profile = resolveBiomarkerAnalysis(biomarker.routeId);

  const days = TIMEFRAME_DAYS[timeframe];

  // TEMPORARY: when no real client is connected, fall back to mocked rows.
  // Drop once browser-vault wearable integration ships. Tracked in TODOS.md.
  const rows = useMemo(() => {
    if (client) return [];
    return generateMockedBiomarkerRows(biomarker, days);
  }, [biomarker, client, days]);

  const series: TrendPoint[] = useMemo(
    () => rows.map((r) => ({ date: r.date, value: r.value })),
    [rows],
  );

  const averageValue = useMemo(() => {
    if (rows.length === 0) return null;
    const mean = rows.reduce((sum, r) => sum + r.value, 0) / rows.length;
    return Number(mean.toFixed(biomarker.valuePrecision));
  }, [rows, biomarker]);

  const overallChange = useMemo(() => {
    if (rows.length < 2) return null;
    const first = rows[0].value;
    const last = rows[rows.length - 1].value;
    const delta = last - first;
    const abs = Math.abs(Number(delta.toFixed(biomarker.valuePrecision)));
    if (abs === 0) {
      return { direction: "flat" as const, abs };
    }
    return { direction: delta < 0 ? ("down" as const) : ("up" as const), abs };
  }, [rows, biomarker]);

  const averageLabel =
    timeframe === "1y" ? "1-year average" : `${TIMEFRAME_DAYS[timeframe]}-day average`;
  const changeSentence = (() => {
    if (overallChange === null) return null;
    const span = TIMEFRAME_PAST_LABELS[timeframe];
    if (overallChange.direction === "flat") {
      return `Steady through ${span}.`;
    }
    const verb = overallChange.direction === "down" ? "Down" : "Up";
    const abs = formatMetricValue(overallChange.abs, biomarker.valuePrecision);
    return `${verb} ${abs} ${biomarker.unit} from where you started ${span}.`;
  })();

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px] md:items-stretch">
      <ChartArea
        biomarker={biomarker}
        series={series}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        typicalMin={profile?.typicalMin}
        typicalMax={profile?.typicalMax}
      />
      <div className="flex flex-col gap-4">
        <ValueTile
          biomarker={biomarker}
          averageLabel={averageLabel}
          averageValue={averageValue}
          changeText={changeSentence}
          changeDirection={overallChange?.direction ?? "flat"}
          goodDirection={profile?.goodDirection}
        />
        <RangeTile biomarker={biomarker} profile={profile} latestValue={averageValue} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tiles (right column, stacked)
// ────────────────────────────────────────────────────────────────────────────

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-2 rounded-xl border border-border/60 bg-card/90 p-5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function ValueTile({
  biomarker,
  averageLabel,
  averageValue,
  changeText,
  changeDirection,
  goodDirection,
}: {
  biomarker: BiomarkerPageModel;
  averageLabel: string;
  averageValue: number | null;
  changeText: string | null;
  changeDirection: "up" | "down" | "flat";
  goodDirection: BiomarkerAnalysisProfile["goodDirection"] | undefined;
}) {
  const isGoodTrend = goodDirection
    ? changeDirection === goodDirection || changeDirection === "flat"
    : true;

  return (
    <Tile label={averageLabel}>
      {averageValue != null ? (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className="font-serif text-3xl font-semibold tabular-nums text-foreground">
              {formatMetricValue(averageValue, biomarker.valuePrecision)}
            </span>
            <span className="text-sm text-muted-foreground">{biomarker.unit}</span>
          </div>
          {changeText ? (
            <span
              className={cn(
                "text-sm/5.5 text-pretty",
                isGoodTrend ? "text-primary" : "text-muted-foreground",
              )}
            >
              {changeText}
            </span>
          ) : (
            <span className="text-sm/5 text-muted-foreground">Not enough data yet.</span>
          )}
        </>
      ) : (
        <span className="text-sm/5 text-muted-foreground">Connect a wearable to see your value.</span>
      )}
    </Tile>
  );
}

function RangeTile({
  biomarker,
  profile,
  latestValue,
}: {
  biomarker: BiomarkerPageModel;
  profile: BiomarkerAnalysisProfile | null;
  latestValue: number | null;
}) {
  if (!profile) {
    return (
      <Tile label="Typical range">
        <span className="text-sm/5 text-muted-foreground">No reference range yet.</span>
      </Tile>
    );
  }
  const inRange = latestValue != null
    ? latestValue >= profile.typicalMin && latestValue <= profile.typicalMax
    : null;
  return (
    <Tile label="Typical range">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-serif text-3xl font-semibold tabular-nums text-foreground">
          {profile.typicalMin}–{profile.typicalMax}
        </span>
        <span className="text-sm text-muted-foreground">{biomarker.unit}</span>
        {inRange != null ? (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
              inRange
                ? "bg-primary/15 text-primary"
                : "bg-destructive/15 text-destructive",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("size-1.5 rounded-full", inRange ? "bg-primary" : "bg-destructive")}
            />
            {inRange ? "In range" : "Out of range"}
          </span>
        ) : null}
      </div>
      <span className="text-sm/5 text-muted-foreground">{profile.typicalRangeLabel}</span>
    </Tile>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Chart card (mirrors Your Results trend-chart.tsx visual language)
// ────────────────────────────────────────────────────────────────────────────

const chartConfig = {
  value: { label: "Value", color: "#7A8C6E" },
  range: { label: "Typical range", color: "#7A8C6E" },
} satisfies ChartConfig;

function ChartArea({
  biomarker,
  series,
  timeframe,
  onTimeframeChange,
  typicalMin,
  typicalMax,
}: {
  biomarker: BiomarkerPageModel;
  series: TrendPoint[];
  timeframe: Timeframe;
  onTimeframeChange: (next: Timeframe) => void;
  typicalMin?: number;
  typicalMax?: number;
}) {
  const chartId = `${biomarker.routeId}-${timeframe}`;
  const data = series.map((p) => ({
    date: p.date,
    value: p.value,
    rangeBand:
      typicalMin != null && typicalMax != null ? [typicalMin, typicalMax] : undefined,
  }));

  const values = series.map((p) => p.value);
  const dataMin = values.length > 0 ? Math.min(...values) : 0;
  const dataMax = values.length > 0 ? Math.max(...values) : 1;
  // Anchor the visible Y-domain on the typical band so the user can see
  // headroom above and below the band, not just where the data lands.
  const bandSpan = typicalMin != null && typicalMax != null ? typicalMax - typicalMin : null;
  const extraPad = bandSpan != null ? bandSpan * 0.5 : ((dataMax - dataMin) || 1) * 0.4;
  const yLow = Math.min(dataMin, typicalMin ?? dataMin) - extraPad;
  const yHigh = Math.max(dataMax, typicalMax ?? dataMax) + extraPad;

  const firstDate = series[0]?.date;
  const lastDate = series[series.length - 1]?.date;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
          Your {biomarker.shortName} trend
        </h2>
        <TimeframeSelector value={timeframe} onChange={onTimeframeChange} />
      </div>

      {data.length < 2 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
          Not enough data yet for this timeframe.
        </div>
      ) : (
        <>
          <ChartContainer config={chartConfig} className="h-[260px] w-full">
            <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`fill-${chartId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7A8C6E" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#7A8C6E" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="var(--color-border)"
                strokeOpacity={0.5}
              />
              <XAxis dataKey="date" hide />
              <YAxis domain={[yLow, yHigh]} hide />
              {typicalMin != null && typicalMax != null ? (
                <Area
                  dataKey="rangeBand"
                  type="monotone"
                  stroke="transparent"
                  fill="#7A8C6E"
                  fillOpacity={0.14}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={false}
                />
              ) : null}
              {typicalMin != null ? (
                <ReferenceLine
                  y={typicalMin}
                  stroke="#7A8C6E"
                  strokeOpacity={0.5}
                  strokeDasharray="4 4"
                  label={{
                    value: `Typical ${typicalMin}`,
                    position: "insideBottomLeft",
                    fill: "#7A8C6E",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    offset: 6,
                  }}
                />
              ) : null}
              {typicalMax != null ? (
                <ReferenceLine
                  y={typicalMax}
                  stroke="#7A8C6E"
                  strokeOpacity={0.5}
                  strokeDasharray="4 4"
                  label={{
                    value: `Typical ${typicalMax}`,
                    position: "insideTopLeft",
                    fill: "#7A8C6E",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    offset: 6,
                  }}
                />
              ) : null}
              <Area
                dataKey="value"
                type="monotone"
                stroke="#7A8C6E"
                strokeWidth={2.5}
                fill={`url(#fill-${chartId})`}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, fill: "#7A8C6E" }}
              />
            </AreaChart>
          </ChartContainer>

          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{firstDate ? formatXTick(firstDate) : ""}</span>
            <span>{lastDate ? formatXTick(lastDate) : ""}</span>
          </div>
        </>
      )}
    </div>
  );
}

function TimeframeSelector({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (next: Timeframe) => void;
}) {
  const options: Timeframe[] = ["30d", "90d", "1y"];
  return (
    <div
      role="radiogroup"
      aria-label="Trend timeframe"
      className="inline-flex shrink-0 rounded-full border border-border/70 bg-background/40 p-0.5"
    >
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-full px-3 py-1 font-mono text-[11px] uppercase transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function formatXTick(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

