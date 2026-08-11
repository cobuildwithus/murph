import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import type {
  HostedGrowthDashboard,
  HostedGrowthRecentTrialStart,
  HostedGrowthTrialStartSource,
} from "@/src/lib/hosted-ops/growth-metrics";
import { cn } from "@/src/lib/utils";

interface TrialStartAttributionProps {
  attribution: HostedGrowthDashboard["trialStartAttribution"];
  titleId?: string;
}

const SOURCE_SUMMARIES = [
  {
    className: "",
    label: "Direct iMessage",
    source: "linq_instant_start",
  },
  {
    className: "border-l border-border/60",
    label: "Website",
    source: "web_onboarding",
  },
  {
    className: "border-t border-border/60 md:border-l md:border-t-0",
    label: "Companion",
    source: "companion_onboarding",
  },
  {
    className: "border-l border-t border-border/60 md:border-t-0",
    label: "Migrated",
    source: "legacy_trial_migration",
  },
  {
    className: "border-t border-border/60 md:border-l md:border-t-0",
    label: "Unknown",
    source: "unknown",
  },
] as const;

const SOURCE_PRESENTATION = {
  companion_onboarding: {
    description: "Authenticated native onboarding",
    label: "Companion app",
  },
  linq_instant_start: {
    description: "Inbound iMessage",
    label: "Direct iMessage",
  },
  legacy_trial_migration: {
    description: "Historical free usage retained during migration",
    label: "Migrated",
  },
  unknown: {
    description: "Source was not captured",
    label: "Unknown",
  },
  web_onboarding: {
    description: "Authenticated web onboarding",
    label: "Website",
  },
} satisfies Record<
  HostedGrowthTrialStartSource,
  { description: string; label: string }
>;

export function TrialStartAttribution(input: TrialStartAttributionProps) {
  const titleId = input.titleId ?? "trial-start-attribution-title";

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div>
        <h2
          className="font-serif text-xl font-semibold tracking-tight text-foreground"
          id={titleId}
        >
          Starter activation paths
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          Source is captured when starter usage activates. Direct iMessage means
          an inbound iMessage activated starter access. Historical activations
          without persisted provenance remain Unknown.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
        <div className="grid grid-cols-2 md:grid-cols-5">
          {SOURCE_SUMMARIES.map((summary) => (
            <div
              className={cn("px-4 py-4 sm:px-5", summary.className)}
              key={summary.source}
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                {summary.label}
              </div>
              <div className="mt-1 font-serif text-2xl font-semibold tabular-nums text-foreground">
                {formatInteger(input.attribution.counts[summary.source])}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Last 30 UTC days
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border/70">
          <Table>
            {input.attribution.recent.length === 0 ? (
              <TableCaption>
                No starter activations since{" "}
                {formatDate(input.attribution.windowStartDate)}.
              </TableCaption>
            ) : null}
            <TableHeader className="hidden md:table-header-group">
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Contact hint</TableHead>
                <TableHead>Member record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group">
              {input.attribution.recent.map((row, index) => (
                <TrialStartAttributionRow
                  key={`${row.trialStartedAt}-${index}`}
                  row={row}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}

function TrialStartAttributionRow(input: {
  row: HostedGrowthRecentTrialStart;
}) {
  const presentation = SOURCE_PRESENTATION[input.row.pulseTrialStartSource];

  return (
    <TableRow className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:table-row">
      <TableCell className="block whitespace-normal px-4 py-3 md:table-cell md:p-2 md:whitespace-nowrap">
        <MobileFieldLabel>Started</MobileFieldLabel>
        {formatDateTime(input.row.trialStartedAt)}
      </TableCell>
      <TableCell className="block whitespace-normal px-4 py-3 md:table-cell md:p-2">
        <MobileFieldLabel>Path</MobileFieldLabel>
        <div className="flex min-w-40 flex-col gap-0.5">
          <span className="font-medium text-foreground">
            {presentation.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {presentation.description}
          </span>
        </div>
      </TableCell>
      <TableCell className="block whitespace-normal px-4 py-3 md:table-cell md:p-2 md:whitespace-nowrap">
        <MobileFieldLabel>Contact hint</MobileFieldLabel>
        {input.row.phoneHint ? `Phone ${input.row.phoneHint}` : "No phone hint"}
      </TableCell>
      <TableCell className="block whitespace-normal px-4 py-3 md:table-cell md:p-2 md:whitespace-nowrap">
        <MobileFieldLabel>Member record</MobileFieldLabel>
        {formatMemberRecordAge(
          input.row.memberCreatedAt,
          input.row.trialStartedAt,
        )}
      </TableCell>
    </TableRow>
  );
}

function MobileFieldLabel(input: { children: string }) {
  return (
    <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground md:hidden">
      {input.children}
    </span>
  );
}

function formatMemberRecordAge(
  memberCreatedAt: string,
  trialStartedAt: string,
): string {
  const created = new Date(memberCreatedAt);
  const trial = new Date(trialStartedAt);
  const createdDay = Date.UTC(
    created.getUTCFullYear(),
    created.getUTCMonth(),
    created.getUTCDate(),
  );
  const trialDay = Date.UTC(
    trial.getUTCFullYear(),
    trial.getUTCMonth(),
    trial.getUTCDate(),
  );
  const daysEarlier = Math.floor((trialDay - createdDay) / 86_400_000);

  if (daysEarlier === 0) {
    return "Created same UTC day";
  }
  if (daysEarlier > 0) {
    return `Created ${formatDate(memberCreatedAt)} · ${formatInteger(daysEarlier)} ${daysEarlier === 1 ? "day" : "days"} earlier`;
  }
  return `Created ${formatDate(memberCreatedAt)}`;
}

function formatDateTime(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function formatDate(value: string): string {
  const normalized = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(normalized));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
