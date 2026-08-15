import type { ReactNode } from "react";
import { Check, Minus, X } from "lucide-react";

import type {
  ExperimentSchedule,
  ScheduleCell,
  ScheduleCellKind,
} from "@/src/types/experiments";
import { cn } from "@/src/lib/utils";

interface ExperimentScheduleProps {
  schedule: ExperimentSchedule;
}

const CELL_VARIANT: Record<ScheduleCellKind, string> = {
  baseline: "border border-secondary/30 bg-secondary/30 text-foreground/60",
  completed: "border border-ring/40 bg-ring/15 text-foreground",
  assumed: "border border-chart-4/45 bg-chart-4/15 text-foreground",
  partial: "border border-secondary/60 bg-secondary/20 text-foreground",
  missed: "border border-muted-foreground/35 bg-muted/25 text-muted-foreground",
  failed: "border border-secondary/60 bg-secondary/15 text-foreground",
  unknown: "border border-border/60 bg-muted/20 text-muted-foreground",
  scheduled: "border border-ring/50 bg-transparent text-ring",
};

const LEGEND_ENTRIES: { kind: ScheduleCellKind; label: string }[] = [
  { kind: "baseline", label: "Baseline" },
  { kind: "completed", label: "Completed" },
  { kind: "assumed", label: "Assumed done" },
  { kind: "partial", label: "Partial" },
  { kind: "missed", label: "Not logged" },
  { kind: "failed", label: "Not met" },
  { kind: "unknown", label: "Unknown" },
  { kind: "scheduled", label: "Scheduled" },
];

export function ExperimentScheduleSidebar({ schedule }: ExperimentScheduleProps) {
  const stats = tallyTargetStats(schedule);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Adherence
      </span>
      <div className="flex flex-col gap-2">
        {schedule.weeks.map((week) => (
          <div key={week.label} className="flex flex-col gap-1">
            {week.dateRange && (
              <WeekDateRange dateRange={week.dateRange} />
            )}
            <div className="grid grid-cols-7 gap-1">
              {week.cells.map((cell, idx) => (
                <CompactCellView key={idx} cell={cell} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {stats.due > 0 ? (
        <div className="flex items-baseline justify-between border-t border-border/50 pt-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {stats.completed} of {stats.due} due
          </span>
          <span className="font-serif text-sm font-semibold tabular-nums text-foreground">
            {stats.adherencePercent}%
          </span>
        </div>
      ) : stats.hasToday ? (
        <div className="border-t border-border/50 pt-3">
          <span className="text-xs text-muted-foreground">
            First session today
          </span>
        </div>
      ) : null}
    </div>
  );
}

function tallyTargetStats(schedule: ExperimentSchedule) {
  const cells = schedule.weeks.flatMap((week) => week.cells);
  const completed = cells.filter((c) => c.kind === "completed").length;
  const assumed = cells.filter((c) => c.kind === "assumed").length;
  const partial = cells.filter((c) => c.kind === "partial").length;
  const missed = cells.filter((c) => c.kind === "missed").length;
  const failed = cells.filter((c) => c.kind === "failed").length;
  const unknown = cells.filter((c) => c.kind === "unknown").length;
  const hasToday = cells.some((c) => c.isToday);
  const due = completed + assumed + partial + missed + failed + unknown;
  const adherencePercent = due > 0 ? Math.round(((completed + assumed) / due) * 100) : 0;
  return { completed: completed + assumed, due, adherencePercent, hasToday };
}

function WeekDateRange({ dateRange }: { dateRange: string }) {
  const parts = dateRange.split(/\s*[–—-]\s*/);
  if (parts.length === 2) {
    return (
      <div className="flex justify-between text-[9px] text-muted-foreground/70">
        <span>{parts[0]}</span>
        <span>{parts[1]}</span>
      </div>
    );
  }
  return <span className="text-[9px] text-right text-muted-foreground/70">{dateRange}</span>;
}

function CompactCellView({ cell }: { cell: ScheduleCell }) {
  return (
    <div
      className={cn(
        "relative flex h-9 flex-col items-center justify-center rounded",
        CELL_VARIANT[cell.kind],
      )}
      title={cell.date ? `${cell.dayLabel} · ${cell.date}` : cell.dayLabel}
    >
      {cell.isToday && (
        <span
          aria-label="Today"
          className="absolute right-0.5 top-0.5 size-1 rounded-full bg-primary"
        />
      )}
      <span className="font-mono text-[8px] uppercase tracking-wide text-muted-foreground">
        {cell.dayLabel}
      </span>
      {renderCompactCellBody(cell)}
    </div>
  );
}

function renderCompactCellBody(cell: ScheduleCell): ReactNode {
  if (cell.occurrences && cell.occurrences.expected > 1) {
    const logged =
      cell.occurrences.completed +
      cell.occurrences.assumed +
      cell.occurrences.partial;
    return <span className="font-mono text-[9px]">{logged}/{cell.occurrences.expected}</span>;
  }

  switch (cell.kind) {
    case "completed":
    case "assumed":
      return <Check className="size-2.5" strokeWidth={3} />;
    case "partial":
      return <Minus aria-label="Partial" className="size-2.5" strokeWidth={3} />;
    case "missed":
      return <X aria-label="Not logged" className="size-2.5" strokeWidth={2} />;
    case "failed":
      return <X aria-label="Not met" className="size-2.5" strokeWidth={2} />;
    case "unknown":
      return <span className="font-mono text-[10px]">?</span>;
    default:
      return null;
  }
}

export function ExperimentSchedule({ schedule }: ExperimentScheduleProps) {
  return (
    <section className="flex flex-col gap-5 md:rounded-xl md:border md:border-secondary/25 md:bg-card/90 md:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-chart-5">
            Plan
          </span>
          <span className="font-serif text-xl font-semibold text-foreground">
            {schedule.cadence}
          </span>
          {schedule.dose && (
            <span className="text-sm text-muted-foreground">
              {schedule.dose}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
          {LEGEND_ENTRIES.map((entry) => (
            <span key={entry.kind} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block size-2.5 rounded-[3px]",
                  CELL_VARIANT[entry.kind],
                )}
              />
              {entry.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border/40">
        {schedule.weeks.map((week) => (
          <div
            key={week.label}
            className="grid items-center gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[140px_1fr]"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">{week.label}</span>
              <span className="text-[11px] text-muted-foreground">{week.dateRange}</span>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {week.cells.map((cell, idx) => (
                <ScheduleCellView key={idx} cell={cell} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="flex items-start gap-2.5 border-t border-border/50 pt-4 text-sm/6 text-muted-foreground">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-serif text-[13px] text-primary"
        >
          ?
        </span>
        <span>
          Want to change the schedule? Ask Murph — your cadence, baseline,
          and logged adherence data are already loaded.
        </span>
      </p>
    </section>
  );
}

function ScheduleCellView({ cell }: { cell: ScheduleCell }) {
  return (
    <div
      className={cn(
        "relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-md text-center",
        CELL_VARIANT[cell.kind],
      )}
      title={cell.date ? `${cell.dayLabel} · ${cell.date}` : cell.dayLabel}
    >
      {cell.isToday && (
        <span
          aria-label="Today"
          className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary"
        />
      )}
      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {cell.dayLabel}
      </span>
      {renderCellBody(cell)}
    </div>
  );
}

function renderCellBody(cell: ScheduleCell): ReactNode {
  switch (cell.kind) {
    case "completed":
    case "assumed":
      return (
        <span className="text-[11px] font-semibold">
          {cell.detail ?? <Check className="size-3.5" strokeWidth={2.5} />}
        </span>
      );
    case "partial":
      return (
        <span className="text-[11px] font-semibold">
          {cell.detail ?? <Minus aria-label="Partial" className="size-3.5" strokeWidth={2.5} />}
        </span>
      );
    case "missed":
      return cell.occurrences && cell.occurrences.expected > 1 && cell.detail ? (
        <span className="text-[11px] font-semibold">{cell.detail}</span>
      ) : <X aria-label="Not logged" className="size-3.5" strokeWidth={2} />;
    case "failed":
      return cell.occurrences && cell.occurrences.expected > 1 && cell.detail ? (
        <span className="text-[11px] font-semibold">{cell.detail}</span>
      ) : <X aria-label="Not met" className="size-3.5" strokeWidth={2} />;
    case "unknown":
      return cell.occurrences && cell.occurrences.expected > 1 && cell.detail ? (
        <span className="text-[11px] font-semibold">{cell.detail}</span>
      ) : <span className="font-mono text-xs">?</span>;
    case "scheduled":
      return cell.detail ? (
        <span className="text-[11px] font-medium">{cell.detail}</span>
      ) : null;
    case "baseline":
      return cell.detail ? <span className="text-[10px]">{cell.detail}</span> : null;
    default:
      return null;
  }
}
