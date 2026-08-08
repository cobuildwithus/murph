"use client";

import { useId, type ReactNode } from "react";
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
  HostedGrowthMonthlyRevenuePoint,
  HostedGrowthSnapshotPoint,
} from "@/src/lib/hosted-ops/growth-metrics";

const activityChartConfig = {
  activeUsersPerDay: {
    color: "#9A815C",
    label: "Messaged that day",
  },
  activeUsersTrailing7Days: {
    color: "#7A8C6E",
    label: "Messaged in trailing 7 days",
  },
} satisfies ChartConfig;

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
    label: "Member records created",
  },
  trialStarts: {
    color: "#D4C4A8",
    label: "Starter activations",
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

const monthlyRevenueChartConfig = {
  totalRevenueUsd: {
    color: "#7A8C6E",
    label: "Monthly revenue",
  },
} satisfies ChartConfig;

const interactiveChartClassName =
  "mt-4 h-64 w-full rounded-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";

interface GrowthChartsProps {
  dailySeries: HostedGrowthDailyPoint[];
  messageSeries: HostedGrowthMessagePoint[];
  monthlyRevenueSeries: HostedGrowthMonthlyRevenuePoint[];
  snapshotSeries: HostedGrowthSnapshotPoint[];
}

export function GrowthCharts(input: GrowthChartsProps) {
  const titleIdPrefix = useId().replace(/:/gu, "");
  const activityTitleId = `${titleIdPrefix}-active-users`;
  const totalMessagesTitleId = `${titleIdPrefix}-total-messages`;
  const dailyMessagesTitleId = `${titleIdPrefix}-daily-messages`;
  const acquisitionTitleId = `${titleIdPrefix}-acquisition`;
  const revenueTitleId = `${titleIdPrefix}-revenue`;
  const monthlyRevenueTitleId = `${titleIdPrefix}-monthly-revenue`;
  const revenueSeries = input.snapshotSeries.map((point) => ({
    date: point.date,
    mrrUsd: point.mrrUsdCents / 100,
    payingCustomers: point.payingCustomers,
  }));
  // A month with a withheld total renders no bar, and a bar-less month would
  // also produce no tooltip payload. The zero-height anchor series keeps the
  // breakdown tooltip reachable for those months without drawing anything.
  const monthlyRevenueSeries = input.monthlyRevenueSeries.map((point) => ({
    ...point,
    tooltipAnchor: 0,
    totalRevenueUsd: point.totalUsdCents === null
      ? null
      : point.totalUsdCents / 100,
  }));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 p-5 xl:col-span-2">
        <div className="flex flex-col gap-1">
          <h3
            className="font-serif text-lg font-semibold tracking-tight text-foreground"
            id={activityTitleId}
          >
            People who messaged Murph
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Each UTC window counts retained distinct senders whose messages
            Murph received across personal and group chats. Personal and
            owned-group rows are removed with account deletion; activity retained
            in another member&apos;s shared group follows normal content retention.
            Solid sage tracks the trailing seven-day window; dashed sand shows
            each completed UTC day. Unknown history is left blank.
          </p>
        </div>
        <ChartContainer
          className={interactiveChartClassName}
          config={activityChartConfig}
        >
          <LineChart
            accessibilityLayer
            aria-labelledby={activityTitleId}
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
                  className="min-w-56"
                  labelFormatter={formatTooltipDate}
                />
              )}
              cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
            />
            <Line
              connectNulls={false}
              dataKey="activeUsersTrailing7Days"
              dot={false}
              isAnimationActive={false}
              name="Messaged in trailing 7 days"
              stroke="var(--color-activeUsersTrailing7Days)"
              strokeWidth={2}
              type="monotone"
            />
            <Line
              connectNulls={false}
              dataKey="activeUsersPerDay"
              dot={false}
              isAnimationActive={false}
              name="Messaged that day"
              stroke="var(--color-activeUsersPerDay)"
              strokeDasharray="6 4"
              strokeWidth={2}
              type="monotone"
            />
          </LineChart>
        </ChartContainer>
      </div>

      <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 p-5">
        <div className="flex flex-col gap-1">
          <h3
            className="font-serif text-lg font-semibold tracking-tight text-foreground"
            id={totalMessagesTitleId}
          >
            Total messages sent
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Cumulative hosted messages through each completed UTC day.
            Unavailable history is left blank.
          </p>
        </div>
        <ChartContainer
          className={interactiveChartClassName}
          config={totalMessagesChartConfig}
        >
          <LineChart
            accessibilityLayer
            aria-labelledby={totalMessagesTitleId}
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
          <h3
            className="font-serif text-lg font-semibold tracking-tight text-foreground"
            id={dailyMessagesTitleId}
          >
            Messages sent per day
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Daily inbound messages plus tracked Linq replies, by UTC date.
            Unavailable days are left blank.
          </p>
        </div>
        <ChartContainer
          className={interactiveChartClassName}
          config={dailyMessagesChartConfig}
        >
          <BarChart
            accessibilityLayer
            aria-labelledby={dailyMessagesTitleId}
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
          <h3
            className="font-serif text-lg font-semibold tracking-tight text-foreground"
            id={acquisitionTitleId}
          >
            Intake and activation
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Daily member records created and starter usage activated by UTC date.
          </p>
        </div>
        <ChartContainer
          className={interactiveChartClassName}
          config={acquisitionChartConfig}
        >
          <AreaChart
            accessibilityLayer
            aria-labelledby={acquisitionTitleId}
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
              name="Member records created"
              stroke="var(--color-newMembers)"
              strokeWidth={2}
              type="monotone"
            />
            <Area
              dataKey="trialStarts"
              fill="var(--color-trialStarts)"
              fillOpacity={0.16}
              name="Starter activations"
              stroke="var(--color-trialStarts)"
              strokeWidth={2}
              type="monotone"
            />
          </AreaChart>
        </ChartContainer>
      </div>

      <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 p-5">
        <div className="flex flex-col gap-1">
          <h3
            className="font-serif text-lg font-semibold tracking-tight text-foreground"
            id={revenueTitleId}
          >
            Revenue snapshots
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Daily captured MRR and paying customer count.
          </p>
        </div>
        <ChartContainer
          className={interactiveChartClassName}
          config={revenueChartConfig}
        >
          <LineChart
            accessibilityLayer
            aria-labelledby={revenueTitleId}
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

      <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 p-5">
        <div className="flex flex-col gap-1">
          <h3
            className="font-serif text-lg font-semibold tracking-tight text-foreground"
            id={monthlyRevenueTitleId}
          >
            Monthly revenue
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            An estimate, not invoices: the month&apos;s latest recorded
            subscription rate plus top-up and group sponsorship cash paid that
            UTC month. Refunds are not subtracted, and account deletion can
            remove past purchase cash or leave an old group gift counted as a
            regular top-up. The newest bar is month to date, a month with no
            snapshot withholds its total, and months from before the
            subscription split show subscriptions as one combined line. Hover,
            tap, or focus a bar for the breakdown.
          </p>
        </div>
        <ChartContainer
          className={interactiveChartClassName}
          config={monthlyRevenueChartConfig}
        >
          <BarChart
            accessibilityLayer
            aria-labelledby={monthlyRevenueTitleId}
            data={monthlyRevenueSeries}
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
              dataKey="month"
              tickFormatter={formatMonthTick}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickFormatter={formatUsdAxisTick}
              tickLine={false}
              width={44}
            />
            <ChartTooltip
              content={<MonthlyRevenueTooltip />}
              cursor={{ fill: "var(--color-muted)", fillOpacity: 0.35 }}
            />
            <Bar
              dataKey="tooltipAnchor"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
              maxBarSize={64}
              stackId="revenue"
            />
            <Bar
              dataKey="totalRevenueUsd"
              fill="var(--color-totalRevenueUsd)"
              maxBarSize={64}
              name="Monthly revenue"
              radius={[3, 3, 0, 0]}
              stackId="revenue"
            />
          </BarChart>
        </ChartContainer>
      </div>
    </div>
  );
}

function MonthlyRevenueTooltip(props: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const point = props.payload?.[0]?.payload;
  if (props.active !== true || !isMonthlyRevenuePoint(point)) {
    return null;
  }

  const subscriptionRows = point.individualSubscriptionsUsdCents === null
    && point.familySubscriptionsUsdCents === null
    && point.subscriptionsUnsplitUsdCents === null
    ? [{ label: "Subscriptions", value: "No snapshot" }]
    : [
      ...(point.individualSubscriptionsUsdCents === null ? [] : [{
        label: "Personal subscriptions",
        value: formatUsdFromCents(point.individualSubscriptionsUsdCents),
      }]),
      ...(point.familySubscriptionsUsdCents === null ? [] : [{
        label: "Family subscriptions",
        value: formatUsdFromCents(point.familySubscriptionsUsdCents),
      }]),
      ...(point.subscriptionsUnsplitUsdCents === null ? [] : [{
        label: "Subscriptions (personal + family)",
        value: formatUsdFromCents(point.subscriptionsUnsplitUsdCents),
      }]),
    ];
  const rows = [
    ...subscriptionRows,
    {
      label: "Group sponsorship",
      value: formatUsdFromCents(point.groupSponsorshipUsdCents),
    },
    {
      label: "Usage top-ups",
      value: formatUsdFromCents(point.usageTopUpsUsdCents),
    },
  ];

  return (
    <div className="grid min-w-52 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">
        {formatMonthLabel(point.month)}
        {point.monthToDate ? " · month to date" : ""}
      </div>
      <div className="grid gap-1">
        {rows.map((row) => (
          <div className="flex w-full justify-between gap-4" key={row.label}>
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <div className="flex w-full justify-between gap-4 border-t border-border/50 pt-1 font-medium">
        <span>Total</span>
        <span className="font-mono tabular-nums">
          {point.totalUsdCents === null
            ? "Unavailable"
            : formatUsdFromCents(point.totalUsdCents)}
        </span>
      </div>
    </div>
  );
}

function isMonthlyRevenuePoint(
  value: unknown,
): value is HostedGrowthMonthlyRevenuePoint {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate: Partial<Record<keyof HostedGrowthMonthlyRevenuePoint, unknown>> =
    value;
  return typeof candidate.month === "string"
    && typeof candidate.monthToDate === "boolean"
    && isNullableNumber(candidate.totalUsdCents)
    && typeof candidate.groupSponsorshipUsdCents === "number"
    && typeof candidate.usageTopUpsUsdCents === "number"
    && isNullableNumber(candidate.individualSubscriptionsUsdCents)
    && isNullableNumber(candidate.familySubscriptionsUsdCents)
    && isNullableNumber(candidate.subscriptionsUnsplitUsdCents);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
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

function formatMonthTick(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function formatMonthLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function formatUsdAxisTick(value: number): string {
  return `$${formatCompactNumber(value)}`;
}

function formatUsdFromCents(valueUsdCents: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: valueUsdCents % 100 === 0 ? 0 : 2,
    style: "currency",
  }).format(valueUsdCents / 100);
}

function formatTooltipDate(value: ReactNode): string {
  return typeof value === "string" ? formatShortDate(value) : "";
}
