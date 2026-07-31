"use client";

import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import type {
  HostedGrowthDailyPoint,
  HostedGrowthMessagePoint,
  HostedGrowthSnapshotPoint,
} from "@/src/lib/hosted-ops/growth-metrics";

const totalMessagesChartConfig = {
  totalMessages: {
    color: "#7A8C6E",
    label: "Total messages sent",
  },
} satisfies ChartConfig;

const dailyMessagesChartConfig = {
  messagesPerDay: {
    color: "#7A8C6E",
    label: "Messages sent per day",
  },
} satisfies ChartConfig;

const acquisitionChartConfig = {
  newMembers: {
    color: "#7A8C6E",
    label: "New members",
  },
  trialStarts: {
    color: "#D4C4A8",
    label: "Trial starts",
  },
} satisfies ChartConfig;

const revenueChartConfig = {
  mrrUsd: {
    color: "#7A8C6E",
    label: "MRR",
  },
  payingCustomers: {
    color: "#D4C4A8",
    label: "Paying customers",
  },
} satisfies ChartConfig;

interface GrowthChartsProps {
  dailySeries: HostedGrowthDailyPoint[];
  messageSeries: HostedGrowthMessagePoint[];
  snapshotSeries: HostedGrowthSnapshotPoint[];
}

export function GrowthCharts(input: GrowthChartsProps) {
  const revenueSeries = input.snapshotSeries.map((point) => ({
    date: point.date,
    mrrUsd: point.mrrUsdCents / 100,
    payingCustomers: point.payingCustomers,
  }));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Total messages sent
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Cumulative hosted messages sent through each completed UTC day.
          </p>
        </div>
        <ChartContainer
          className="mt-4 h-64 w-full"
          config={totalMessagesChartConfig}
        >
          <LineChart
            accessibilityLayer
            data={input.messageSeries}
            margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
          >
            <CartesianGrid
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              strokeOpacity={0.55}
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={24}
              tickFormatter={formatShortDate}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              domain={["auto", "auto"]}
              tickFormatter={formatCompactNumber}
              tickLine={false}
              width={44}
            />
            <ChartTooltip
              content={(
                <ChartTooltipContent
                  className="min-w-52"
                  labelFormatter={formatTooltipDate}
                />
              )}
              cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
            />
            <Line
              connectNulls={false}
              dataKey="totalMessages"
              dot={false}
              name="Total messages sent"
              stroke="var(--color-totalMessages)"
              strokeWidth={2}
              type="monotone"
            />
          </LineChart>
        </ChartContainer>
      </div>

      <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Messages sent per day
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Daily inbound messages plus tracked Linq replies, by UTC date.
          </p>
        </div>
        <ChartContainer
          className="mt-4 h-64 w-full"
          config={dailyMessagesChartConfig}
        >
          <BarChart
            accessibilityLayer
            data={input.messageSeries}
            margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
          >
            <CartesianGrid
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              strokeOpacity={0.55}
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={24}
              tickFormatter={formatShortDate}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <ChartTooltip
              content={(
                <ChartTooltipContent
                  className="min-w-52"
                  labelFormatter={formatTooltipDate}
                />
              )}
              cursor={{ fill: "var(--color-muted)", fillOpacity: 0.35 }}
            />
            <Bar
              dataKey="messagesPerDay"
              fill="var(--color-messagesPerDay)"
              name="Messages sent per day"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </div>

      <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Acquisition
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Daily hosted members and Pulse trial starts by UTC date.
          </p>
        </div>
        <ChartContainer
          className="mt-4 h-64 w-full"
          config={acquisitionChartConfig}
        >
          <AreaChart
            accessibilityLayer
            data={input.dailySeries}
            margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
          >
            <CartesianGrid
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              strokeOpacity={0.55}
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={24}
              tickFormatter={formatShortDate}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <ChartTooltip
              content={<ChartTooltipContent labelFormatter={formatTooltipDate} />}
              cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
            />
            <Area
              dataKey="newMembers"
              fill="var(--color-newMembers)"
              fillOpacity={0.14}
              name="New members"
              stroke="var(--color-newMembers)"
              strokeWidth={2}
              type="monotone"
            />
            <Area
              dataKey="trialStarts"
              fill="var(--color-trialStarts)"
              fillOpacity={0.16}
              name="Trial starts"
              stroke="var(--color-trialStarts)"
              strokeWidth={2}
              type="monotone"
            />
          </AreaChart>
        </ChartContainer>
      </div>

      <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Revenue snapshots
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Daily captured MRR and paying customer count.
          </p>
        </div>
        <ChartContainer
          className="mt-4 h-64 w-full"
          config={revenueChartConfig}
        >
          <LineChart
            accessibilityLayer
            data={revenueSeries}
            margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
          >
            <CartesianGrid
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              strokeOpacity={0.55}
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={24}
              tickFormatter={formatShortDate}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <ChartTooltip
              content={<ChartTooltipContent labelFormatter={formatTooltipDate} />}
              cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
            />
            <Line
              dataKey="mrrUsd"
              dot={false}
              name="MRR"
              stroke="var(--color-mrrUsd)"
              strokeWidth={2}
              type="monotone"
            />
            <Line
              dataKey="payingCustomers"
              dot={false}
              name="Paying customers"
              stroke="var(--color-payingCustomers)"
              strokeWidth={2}
              type="monotone"
            />
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

function formatTooltipDate(value: ReactNode): string {
  return typeof value === "string" ? formatShortDate(value) : "";
}
