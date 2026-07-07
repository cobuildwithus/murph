import type { Metadata } from "next";

import { GrowthCharts } from "./growth-charts";
import {
  captureHostedGrowthDailySnapshot,
  readHostedGrowthDashboard,
  type HostedGrowthStatusCounts,
} from "@/src/lib/hosted-ops/growth-metrics";
import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import {
  HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS,
  HOSTED_PULSE_TRIAL_DAYS,
} from "@/src/lib/hosted-onboarding/billing-plans";
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
  const dashboard = await readHostedGrowthDashboard(now);

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
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Hosted member growth, Pulse trial starts, conversion, and daily
              revenue snapshots from source database rows.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SummaryChip label="Captured" value={formatDateTime(dashboard.capturedAt)} />
            <SummaryChip label="Trial maturity" value={`${HOSTED_PULSE_TRIAL_DAYS} days`} />
            <SummaryChip label="Family seat" value={`${formatCurrency(
              HOSTED_FAMILY_SEAT_RECURRING_AMOUNT_USD_CENTS,
            )} monthly`} />
          </div>
        </div>
      </header>

      <section aria-labelledby="growth-summary-title" className="flex flex-col gap-4">
        <SectionHeading
          description="Headline values use live rows. MRR week over week uses the closest snapshot from six to eight days ago."
          id="growth-summary-title"
          title="Current growth"
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Metric
            emphasis
            helper={formatChange(dashboard.mrrWowPercent)}
            label="MRR"
            value={formatCurrency(dashboard.current.mrrUsdCents)}
          />
          <Metric
            helper={formatChange(dashboard.payingCustomersWowPercent)}
            label="Paying customers"
            value={formatInteger(dashboard.current.payingCustomers)}
          />
          <Metric
            helper={`${formatInteger(dashboard.current.totalMembers)} total members`}
            label="Covered members"
            value={formatInteger(dashboard.current.coveredMembers)}
          />
          <Metric
            helper={`${formatInteger(dashboard.current.trialsEndingSoon)} ending within 3 days`}
            label="On trial now"
            value={formatInteger(dashboard.current.trialingMembers)}
          />
          <Metric
            helper={`${formatInteger(dashboard.conversion.converted)} of ${formatInteger(
              dashboard.conversion.matureStarted,
            )} mature`}
            label="Trial conversion"
            value={formatPercent(dashboard.conversion.percent)}
          />
        </div>
      </section>

      <section aria-labelledby="growth-acquisition-title" className="flex flex-col gap-4">
        <SectionHeading
          description="New hosted member rows include invited and pending contacts."
          id="growth-acquisition-title"
          title="Acquisition"
        />
        <div className="grid gap-3 md:grid-cols-3">
          <Metric
            label="New members today"
            value={formatInteger(dashboard.newMembers.today)}
          />
          <Metric
            helper={formatChange(dashboard.newMembers.wowPercent)}
            label="New members last 7 days"
            value={formatInteger(dashboard.newMembers.trailing7Days)}
          />
          <Metric
            helper={formatChange(dashboard.trialStarts.wowPercent)}
            label="Trial starts last 7 days"
            value={formatInteger(dashboard.trialStarts.trailing7Days)}
          />
        </div>
      </section>

      <GrowthCharts
        dailySeries={dashboard.dailySeries}
        snapshotSeries={dashboard.snapshotSeries}
      />

      <section aria-labelledby="growth-revenue-title" className="flex flex-col gap-4">
        <SectionHeading
          description="Individual plan amounts come from billing plan definitions. Family revenue uses billed paid seats."
          id="growth-revenue-title"
          title="Revenue mix"
        />
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">MRR</TableHead>
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
                <TableCell>Family seats</TableCell>
                <TableCell className="text-right">
                  {formatInteger(dashboard.current.payingFamilySeats)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(dashboard.current.familyMrrUsdCents)}
                </TableCell>
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

      <section aria-labelledby="growth-weekly-title" className="flex flex-col gap-4">
        <SectionHeading
          description="Rolling seven day UTC windows, newest first."
          id="growth-weekly-title"
          title="Weekly growth"
        />
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Window</TableHead>
                <TableHead className="text-right">New members</TableHead>
                <TableHead className="text-right">Member change</TableHead>
                <TableHead className="text-right">Trial starts</TableHead>
                <TableHead className="text-right">Trial change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.weeklyRows.map((row) => (
                <TableRow key={`${row.startDate}-${row.endDate}`}>
                  <TableCell>{formatDateRange(row.startDate, row.endDate)}</TableCell>
                  <TableCell className="text-right">
                    {formatInteger(row.newMembers)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatChange(row.newMembersWowPercent)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatInteger(row.trialStarts)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatChange(row.trialStartsWowPercent)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="growth-cohort-title" className="flex flex-col gap-4">
        <SectionHeading
          description="Pulse trial cohorts by start week. Immature rows are not treated as failed conversions."
          id="growth-cohort-title"
          title="Trial cohorts"
        />
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trial start week</TableHead>
                <TableHead className="text-right">Started</TableHead>
                <TableHead className="text-right">Converted</TableHead>
                <TableHead className="text-right">Still trialing</TableHead>
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
  emphasis?: boolean;
  helper?: string | null;
  label: string;
  tone?: "default" | "warning";
  value: string;
}) {
  const tone = input.tone ?? "default";
  const valueClassName = tone === "warning"
    ? "text-chart-4"
    : input.emphasis
      ? "text-primary"
      : "text-foreground";

  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 px-4 py-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {input.label}
      </div>
      <div className={`mt-2 min-w-0 break-words font-serif text-3xl font-semibold leading-none tracking-tight tabular-nums ${valueClassName}`}>
        {input.value}
      </div>
      {input.helper ? (
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {input.helper}
        </div>
      ) : null}
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

function formatChange(value: number | null): string {
  if (value === null) {
    return "No week baseline";
  }

  const rounded = Math.round(value);
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}${formatInteger(rounded)}% week over week`;
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
