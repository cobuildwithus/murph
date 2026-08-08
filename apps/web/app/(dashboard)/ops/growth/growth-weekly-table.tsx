import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import type { HostedGrowthWeeklyRow } from "@/src/lib/hosted-ops/growth-metrics";

interface GrowthWeeklyTableProps {
  rows: HostedGrowthWeeklyRow[];
  titleId?: string;
}

export function GrowthWeeklyTable(input: GrowthWeeklyTableProps) {
  const titleId = input.titleId ?? "growth-weekly-title";

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div>
        <h2
          className="font-serif text-xl font-semibold tracking-tight text-foreground"
          id={titleId}
        >
          Weekly intake and activation
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Rolling seven-day member-record creation and starter-activation volumes,
          newest first. A member record can predate activation, so use Starter
          start paths for acquisition provenance.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Window</TableHead>
              <TableHead className="text-right">Member records</TableHead>
              <TableHead className="text-right">Record change</TableHead>
              <TableHead className="text-right">Starter activations</TableHead>
              <TableHead className="text-right">Activation change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {input.rows.map((row) => (
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
  );
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatChange(value: number | null): string {
  if (value === null) {
    return "No week baseline";
  }

  const rounded = Math.round(value);
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}${formatInteger(rounded)}% week over week`;
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
