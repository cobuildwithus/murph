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
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/src/components/ui/chart";
import type { HostedGrowthDashboard } from "@/src/lib/hosted-ops/growth-metrics";

const chartConfig = {
  conversions: {
    color: "#7A8C6E",
    label: "Group to private",
  },
} satisfies ChartConfig;

export function GroupPrivateConversions(input: {
  conversions: HostedGrowthDashboard["groupPrivateConversions"];
  titleId?: string;
}) {
  const generatedTitleId = useId().replace(/:/gu, "");
  const titleId = input.titleId ?? `${generatedTitleId}-group-private-conversions`;
  const chartTitleId = `${titleId}-chart`;
  const hasRecentConversions = input.conversions.dailySeries.some(
    (point) => point.conversions > 0,
  );

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div>
        <h2
          className="font-serif text-xl font-semibold tracking-tight text-foreground"
          id={titleId}
        >
          Group to private
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          Counts a member once when Murph has a live group-roster observation
          or retained group message from the prior 14 days that came before
          their first private activation. This is sequence-based exposure
          attribution, not proof of engagement or causation. The marker remains
          after the source evidence retires, but sequences outside that rolling
          window are not counted.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90 md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="border-b border-border/70 p-5 md:border-b-0 md:border-r">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Tracked conversions
          </div>
          <div className="mt-2 font-serif text-4xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {formatInteger(input.conversions.total)}
          </div>
          <div className="mt-2 text-xs leading-5 text-muted-foreground">
            Tracked total among retained members
          </div>
        </div>

        {hasRecentConversions ? (
          <div className="min-w-0 p-5">
            <h3
              className="font-serif text-lg font-semibold tracking-tight text-foreground"
              id={chartTitleId}
            >
              Tracking date
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Daily conversions recorded over the last 30 UTC dates.
            </p>
            <ChartContainer
              className="mt-4 h-52 w-full rounded-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
              config={chartConfig}
            >
              <BarChart
                accessibilityLayer
                aria-labelledby={chartTitleId}
                data={input.conversions.dailySeries}
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
                  width={28}
                />
                <ChartTooltip
                  content={(
                    <ChartTooltipContent labelFormatter={formatTooltipDate} />
                  )}
                  cursor={{ fill: "var(--color-muted)", fillOpacity: 0.35 }}
                />
                <Bar
                  dataKey="conversions"
                  fill="var(--color-conversions)"
                  isAnimationActive={false}
                  maxBarSize={24}
                  name="Group to private"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </div>
        ) : (
          <div className="flex min-h-40 items-center p-5">
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              No tracked group-to-private conversions fall in the last 30 UTC
              dates yet.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
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
