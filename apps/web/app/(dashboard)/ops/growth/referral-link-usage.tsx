"use client";

import { useId, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/src/components/ui/chart";
import type {
  HostedGrowthReferralLinkUsage,
} from "@/src/lib/hosted-ops/growth-metrics";

const referralLinkChartConfig = {
  activatedClaims: {
    color: "#7A8C6E",
    label: "Activated claims",
  },
  claims: {
    color: "#D4C4A8",
    label: "Join Murph claims",
  },
} satisfies ChartConfig;

export function ReferralLinkUsage(input: {
  titleId?: string;
  usage: HostedGrowthReferralLinkUsage;
}) {
  const generatedTitleId = useId().replace(/:/gu, "");
  const titleId = input.titleId ?? `${generatedTitleId}-referral-link-usage`;
  const chartTitleId = `${titleId}-chart`;

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div>
        <h2
          className="font-serif text-xl font-semibold tracking-tight text-foreground"
          id={titleId}
        >
          Referral link usage
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Last 30 UTC dates through capture. A use is counted when a recipient
          selects Join Murph and an attributed invite is created. Page views,
          copied links, and shares are not tracked here. Counts reflect retained
          records, so account deletion can remove a claim or its referral
          attribution from this view.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <ReferralStat
            className="border-r"
            detail="Attributed invites"
            label="Join Murph claims"
            value={formatInteger(input.usage.claims)}
          />
          <ReferralStat
            className="sm:border-r"
            detail="Same claim cohort"
            label="Activated claims"
            value={formatInteger(input.usage.activatedClaims)}
          />
          <ReferralStat
            className="border-r"
            detail={input.usage.activationRatePercent === null
              ? "No claims in window"
              : "Activated ÷ claims"}
            label="Claim activation"
            value={formatPercent(input.usage.activationRatePercent)}
          />
          <ReferralStat
            detail="With at least 1 claim"
            label="Active referrers"
            value={formatInteger(input.usage.activeReferrers)}
          />
        </div>

        <div className="min-w-0 p-5">
          <div className="flex flex-col gap-1">
            <h3
              className="font-serif text-lg font-semibold tracking-tight text-foreground"
              id={chartTitleId}
            >
              Daily claim cohorts
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Claims and the claims that later reached canonical member
              activation, grouped by the invite&apos;s UTC claim date.
            </p>
          </div>
          <ChartContainer
            className="mt-4 h-64 w-full rounded-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
            config={referralLinkChartConfig}
          >
            <BarChart
              accessibilityLayer
              aria-labelledby={chartTitleId}
              barGap={2}
              data={input.usage.dailySeries}
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
                content={(
                  <ChartTooltipContent
                    className="min-w-48"
                    labelFormatter={formatTooltipDate}
                  />
                )}
                cursor={{ fill: "var(--color-muted)", fillOpacity: 0.35 }}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="claims"
                fill="var(--color-claims)"
                isAnimationActive={false}
                maxBarSize={24}
                name="Join Murph claims"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="activatedClaims"
                fill="var(--color-activatedClaims)"
                isAnimationActive={false}
                maxBarSize={24}
                name="Activated claims"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    </section>
  );
}

function ReferralStat(input: {
  className?: string;
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className={`min-w-0 border-b border-border/70 p-4 ${input.className ?? ""}`}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-2 break-words font-serif text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {input.value}
      </div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">
        {input.detail}
      </div>
    </div>
  );
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "N/A";
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTooltipDate(value: ReactNode): string {
  return typeof value === "string" ? formatShortDate(value) : "";
}
