import type { ReactNode } from "react";
import { Check, CircleSlash, Minus, X } from "lucide-react";

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
  partial: "border border-secondary/60 bg-secondary/20 text-foreground",
  missed: "border border-destructive/50 bg-destructive/15 text-destructive",
  skipped: "border border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  scheduled: "border border-ring/50 bg-transparent text-ring",
  rest: "border border-border/40 bg-transparent text-muted-foreground/60",
  upcoming: "border border-border/30 bg-transparent text-muted-foreground/60",
};

const LEGEND_ENTRIES: { kind: ScheduleCellKind; label: string }[] = [
  { kind: "baseline", label: "Baseline" },
  { kind: "completed", label: "Completed" },
  { kind: "partial", label: "Partial" },
  { kind: "missed", label: "Missed" },
  { kind: "skipped", label: "Skipped" },
  { kind: "scheduled", label: "Scheduled" },
  { kind: "rest", label: "Rest" },
];

export function ExperimentSchedule({ schedule }: ExperimentScheduleProps) {
  return (
    <section className="flex flex-col gap-5 md:rounded-xl md:border md:border-secondary/25 md:bg-card/90 md:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-chart-5">
            Schedule
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
          and logged sessions are already loaded.
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
      return <X aria-label="Missed" className="size-3.5" strokeWidth={2} />;
    case "skipped":
      return <CircleSlash aria-label="Skipped" className="size-3.5" strokeWidth={2} />;
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
