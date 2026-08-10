import type { Metadata } from "next";

import { GrowthCharts } from "./growth-charts";
import { GrowthScorecard } from "./growth-scorecard";
import { GrowthSponsorships } from "./growth-sponsorships";
import { GrowthWeeklyTable } from "./growth-weekly-table";
import { ReferralLinkUsage } from "./referral-link-usage";
import { TrialStartAttribution } from "./trial-start-attribution";
import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import {
  captureHostedGrowthDailySnapshot,
  readHostedGrowthDashboard,
  HOSTED_GROWTH_CONVERSION_MATURITY_DAYS,
  type HostedGrowthStatusCounts,
} from "@/src/lib/hosted-ops/growth-metrics";
import {
  readHostedGrowthSponsorshipMetrics,
} from "@/src/lib/hosted-ops/growth-sponsorship-metrics";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Growth - Murph",
};

export default async function HostedOpsGrowthPage() {
  await getHostedDashboardPageAuthSnapshot();
  await requireHostedOpsPageAccess();

  const now = new Date();
  await captureHostedGrowthDailySnapshot(now);
  const [dashboard, sponsorships] = await Promise.all([
    readHostedGrowthDashboard(now),
    readHostedGrowthSponsorshipMetrics(now),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
              Ops notebook
            </span>
            <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
              Growth
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <SummaryChip label="Captured" value={formatDateTime(dashboard.capturedAt)} />
            <SummaryChip
              label="Conversion maturity"
              value={`${HOSTED_GROWTH_CONVERSION_MATURITY_DAYS} days`}
            />
          </div>
        </div>
      </header>

      <GrowthScorecard
        activeUsers={dashboard.activeUsers}
        conversion={dashboard.conversion}
        mrrUsdCents={dashboard.current.mrrUsdCents}
        mrrWowPercent={dashboard.mrrWowPercent}
        newMembers={dashboard.newMembers}
        payingCustomers={dashboard.current.payingCustomers}
        payingCustomersWowPercent={dashboard.payingCustomersWowPercent}
        trialStarts={dashboard.trialStarts}
        usageTopUps={dashboard.usageTopUps}
      />

      <GrowthCharts
        dailySeries={dashboard.dailySeries}
        messageSeries={dashboard.messageSeries}
        monthlyRevenueSeries={dashboard.monthlyRevenueSeries}
        snapshotSeries={dashboard.snapshotSeries}
      />

      <ReferralLinkUsage usage={dashboard.referralLinkUsage} />

      <TrialStartAttribution attribution={dashboard.trialStartAttribution} />

      <section aria-labelledby="growth-revenue-title" className="flex flex-col gap-4">
        <SectionHeading
          description="Recurring plan MRR comes from active paid plan definitions. Sponsorship stays separate because it is usage-backed rather than contracted recurring revenue. The tracked top-up count covers every fulfilled usage-credit purchase, including sponsorship charges, so it overlaps the sponsorship counts below and is not additive. It starts with retained fulfilled history at cutover, adds each new first fulfillment, and may omit purchases deleted before tracking began."
          id="growth-revenue-title"
          title="Revenue mix"
        />
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Plan MRR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Pulse individuals</TableCell>
                <TableCell className="text-right">
                  {formatInteger(dashboard.current.pulsePaidIndividuals)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(dashboard.current.pulseMrrUsdCents)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Edge individuals</TableCell>
                <TableCell className="text-right">
                  {formatInteger(dashboard.current.edgePaidIndividuals)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(dashboard.current.edgeMrrUsdCents)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Max individuals</TableCell>
                <TableCell className="text-right">
                  {formatInteger(dashboard.current.maxPaidIndividuals)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(dashboard.current.maxMrrUsdCents)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Family seats</TableCell>
                <TableCell className="text-right">
                  {formatInteger(dashboard.current.payingFamilySeats)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(dashboard.current.familyMrrUsdCents)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Tracked fulfilled usage top-ups</TableCell>
                <TableCell className="text-right">
                  {formatInteger(dashboard.usageTopUps.trackedFulfilled)}
                </TableCell>
                <TableCell className="text-right">One-time</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Unpriced paid members</TableCell>
                <TableCell className="text-right">
                  {formatInteger(dashboard.current.unpricedPaidMembers)}
                </TableCell>
                <TableCell className="text-right">{formatCurrency(0)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>

      <GrowthSponsorships metrics={sponsorships} />

      <GrowthWeeklyTable rows={dashboard.weeklyRows} />

      <section aria-labelledby="growth-cohort-title" className="flex flex-col gap-4">
        <SectionHeading
          description="Starter-activation cohorts by week. Converted means the member is currently paid, so churned conversions leave old cohorts. Activations inside the maturity window are not treated as failed conversions."
          id="growth-cohort-title"
          title="Starter cohorts"
        />
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Starter week</TableHead>
                <TableHead className="text-right">Started</TableHead>
                <TableHead className="text-right">Converted</TableHead>
                <TableHead className="text-right">Still maturing</TableHead>
                <TableHead className="text-right">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.trialCohorts.map((row) => (
                <TableRow key={`${row.startDate}-${row.endDate}`}>
                  <TableCell>{formatDateRange(row.startDate, row.endDate)}</TableCell>
                  <TableCell className="text-right">{formatInteger(row.started)}</TableCell>
                  <TableCell className="text-right">{formatInteger(row.converted)}</TableCell>
                  <TableCell className="text-right">
                    {formatInteger(row.stillTrialing)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatPercent(row.conversionPercent)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="growth-status-title" className="flex flex-col gap-4">
        <SectionHeading
          description="Billing statuses that may need follow up."
          id="growth-status-title"
          title="Status watch"
        />
        <div className="grid gap-3 md:grid-cols-4">
          {statusRows(dashboard.current.statusCounts).map((row) => (
            <Metric
              key={row.label}
              label={row.label}
              tone={row.value > 0 ? "warning" : "default"}
              value={formatInteger(row.value)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHeading(input: {
  description: string;
  id: string;
  title: string;
}) {
  return (
    <div>
      <h2
        className="font-serif text-xl font-semibold tracking-tight text-foreground"
        id={input.id}
      >
        {input.title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
        {input.description}
      </p>
    </div>
  );
}

function SummaryChip(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-1 font-mono text-[11px] font-medium text-foreground">
        {input.value}
      </div>
    </div>
  );
}

function Metric(input: {
  label: string;
  tone?: "default" | "warning";
  value: string;
}) {
  const tone = input.tone ?? "default";
  const valueClassName = tone === "warning"
    ? "text-chart-4"
    : "text-foreground";

  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 px-4 py-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {input.label}
      </div>
      <div className={`mt-2 min-w-0 break-words font-serif text-3xl font-semibold leading-none tracking-tight tabular-nums ${valueClassName}`}>
        {input.value}
      </div>
    </div>
  );
}

function statusRows(statusCounts: HostedGrowthStatusCounts): {
  label: string;
  value: number;
}[] {
  return [
    { label: "Past due", value: statusCounts.past_due },
    { label: "Canceled", value: statusCounts.canceled },
    { label: "Paused", value: statusCounts.paused },
    { label: "Unpaid", value: statusCounts.unpaid },
  ];
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(valueUsdCents: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(valueUsdCents / 100);
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "No mature cohort";
  }

  return `${formatInteger(Math.round(value))}%`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatDateRange(startDate: string, endDate: string): string {
  return `${formatShortDate(startDate)} to ${formatShortDate(endDate)}`;
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
