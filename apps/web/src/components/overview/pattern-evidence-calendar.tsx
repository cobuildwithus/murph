"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { PersonalPatternCell } from "@murphai/query/browser-overview";
import { cn } from "@/src/lib/utils";
import { patternEvidenceDays, type PatternEvidenceWindow } from "./pattern-evidence-days";

export function PatternEvidenceCalendar({ report, cell, factorLabel, defaultOpen = false }: {
  defaultOpen?: boolean;
  report: PatternEvidenceWindow;
  cell: PersonalPatternCell;
  factorLabel: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const evidence = patternEvidenceDays(report, cell);
  const factor = factorLabel.toLocaleLowerCase();
  const confirmed = cell.comparisonBasis === "confirmed_absence";
  const comparisonLabel = confirmed ? `Without ${factor}` : "Not recorded";
  const warning = !confirmed ? <p className="text-xs leading-5 text-muted-foreground">No {factor} record doesn&apos;t mean no {factor}.</p> : null;
  if (!evidence) return warning;
  const description = (day: (typeof evidence.days)[number]) => {
    const label = day.exposed && day.comparison ? "Both groups" : day.exposed ? factorLabel : day.comparison ? comparisonLabel : "No comparison date shown";
    return `${new Date(day.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · ${label}`;
  };
  const selectedDay = evidence.days.find((day) => day.date === selected);
  const focusDate = selectedDay?.date ?? evidence.days.find((day) => day.exposed || day.comparison)?.date;
  const mark = (exposed: boolean, comparison: boolean) => cn(
    "block size-3 rounded-[3px]",
    exposed ? "bg-primary" : comparison && confirmed ? "bg-[#d4c4a8]" : "bg-transparent",
    comparison && "border-[1.5px] border-muted-foreground",
    !exposed && !comparison && "size-[3px] rounded-full bg-border",
  );
  return (
    <details open={defaultOpen || undefined} className="group/evidence min-w-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        Days compared
        <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open/evidence:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-4 pt-3">
        <div className="flex min-w-0 gap-2">
          <div aria-hidden="true" className="grid shrink-0 grid-rows-[repeat(8,24px)] items-center text-[10px] text-muted-foreground">
            {["", "M", "", "W", "", "F", "", ""].map((label, index) => <span key={index}>{label}</span>)}
          </div>
          <div className="min-w-0 overflow-x-auto pb-1" role="group" aria-label="Comparison dates" data-vaul-no-drag>
            <div className="grid w-max grid-flow-col grid-rows-[repeat(7,24px)] pt-6 relative">
              {evidence.days.map((day, index) => {
                const month = day.date.slice(0, 7);
                const startsMonth = index % 7 === 0 && (index === 0 || evidence.days[index - 7].date.slice(0, 7) !== month);
                const label = new Date(day.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
                return (
                  <div key={day.date} className="relative size-6">
                    {startsMonth ? <span aria-hidden="true" className="absolute -top-6 left-0 text-[10px] leading-6 text-muted-foreground">{label}</span> : null}
                    {day.inWindow ? <button type="button" aria-label={description(day)} aria-pressed={selected === day.date} tabIndex={day.date === focusDate ? 0 : -1} onFocus={() => setSelected(day.date)} onKeyDown={(event) => {
                      const offset = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
                      if (offset === undefined) return;
                      event.preventDefault();
                      const next = evidence.days[index + offset];
                      if (next?.inWindow) event.currentTarget.closest('[role="group"]')?.querySelector<HTMLButtonElement>(`button[data-date="${next.date}"]`)?.focus();
                    }} data-date={day.date} onClick={() => setSelected(day.date)} className="flex size-6 items-center justify-center rounded-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted">
                      <span aria-hidden="true" className={mark(day.exposed, day.comparison)} />
                    </button> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2"><span aria-hidden="true" className={mark(true, false)} />{factorLabel}</span>
          <span className="inline-flex items-center gap-2"><span aria-hidden="true" className={mark(false, true)} />{comparisonLabel}</span>
        </div>
        <div role="status" className="text-xs text-foreground">{selectedDay ? description(selectedDay) : null}</div>
        {evidence.hasMissingDates ? <p className="text-xs text-muted-foreground">Some dates unavailable</p> : null}
        {warning}
      </div>
    </details>
  );
}
