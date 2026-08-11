import type { HostedGrowthSponsorshipMetrics } from "@/src/lib/hosted-ops/growth-sponsorship-metrics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";

interface GrowthSponsorshipsProps {
  metrics: HostedGrowthSponsorshipMetrics;
  titleId?: string;
}

export function GrowthSponsorships({
  metrics,
  titleId = "growth-sponsorship-title",
}: GrowthSponsorshipsProps) {
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div>
        <h2
          className="font-serif text-xl font-semibold tracking-tight text-foreground"
          id={titleId}
        >
          Group sponsorships
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          Monthly sponsorships are capped usage authorizations, not subscriptions,
          so their caps and charges stay outside plan MRR. Gross charges are
          fulfilled live-mode payments still represented in the retained
          sponsorship ledger in the current UTC month and do not net refunds or
          disputes; usage is exact sponsor-funded credit consumed in the same
          window.
        </p>
      </div>

      {metrics.available ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SponsorshipMetric
              helper={`${formatInteger(metrics.paidPurchasesThisMonth)} retained fulfilled ${pluralize(
                metrics.paidPurchasesThisMonth,
                "payment",
              )} · refunds not netted`}
              label="Gross sponsor charges MTD"
              value={formatCashCurrency(metrics.paidThisMonthUsdCents)}
            />
            <SponsorshipMetric
              helper="Actual funded usage consumed"
              label="Sponsored usage MTD"
              value={formatUsageCurrency(metrics.usageConsumedThisMonthUsdMicros)}
            />
            <SponsorshipMetric
              helper="Current unspent fulfilled sponsorship credit"
              label="Remaining sponsored usage"
              value={formatUsageCurrency(metrics.remainingUsageUsdMicros)}
            />
            <SponsorshipMetric
              helper={`${formatInteger(metrics.activeMonthlySponsorships)} active capped ${pluralize(
                metrics.activeMonthlySponsorships,
                "authorization",
              )} · maximum, not MRR`}
              label="Total active monthly cap"
              value={formatMonthlyCap(metrics.activeMonthlyCapUsdCents)}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Gross charges MTD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Monthly sponsorship charges</TableCell>
                  <TableCell className="text-right">
                    {formatInteger(metrics.monthlyPaidPurchasesThisMonth)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCashCurrency(metrics.monthlyPaidThisMonthUsdCents)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>One-time contributions</TableCell>
                  <TableCell className="text-right">
                    {formatInteger(metrics.oneTimePaidPurchasesThisMonth)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCashCurrency(metrics.oneTimePaidThisMonthUsdCents)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">
                    Gross sponsorship charges
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatInteger(metrics.paidPurchasesThisMonth)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCashCurrency(metrics.paidThisMonthUsdCents)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-border/70 bg-card/90 px-5 py-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Sponsorship metrics unavailable
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Plan MRR and the rest of the growth dashboard are still available.
            Reload after the sponsorship ledger read recovers.
          </p>
        </div>
      )}
    </section>
  );
}

function SponsorshipMetric(input: {
  helper: string;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 px-4 py-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-2 min-w-0 break-words font-serif text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {input.value}
      </div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">
        {input.helper}
      </div>
    </div>
  );
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCashCurrency(valueUsdCents: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(valueUsdCents / 100);
}

function formatMonthlyCap(valueUsdCents: number): string {
  return `${new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(valueUsdCents / 100)}/mo`;
}

function formatUsageCurrency(valueUsdMicros: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
    style: "currency",
  }).format(valueUsdMicros / 1_000_000);
}

function pluralize(value: number, singular: string): string {
  return value === 1 ? singular : `${singular}s`;
}

export type { GrowthSponsorshipsProps };
