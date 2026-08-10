"use client";

import Image from "next/image";

import type {
  PersonalPatternCell,
  PersonalPatternFactor,
  PersonalPatternReport,
  PersonalPatternStage,
} from "@murphai/query/browser-overview";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { cn } from "@/src/lib/utils";

const STAGE_LABELS: Record<PersonalPatternStage, string> = {
  insufficient: "Not enough matches",
  no_clear_pattern: "No clear pattern",
  new_clue: "New clue",
  seen_again: "Seen again",
  worth_testing: "Worth testing",
};

const STAGE_RANK: Record<PersonalPatternStage, number> = {
  insufficient: 0,
  no_clear_pattern: 1,
  new_clue: 2,
  seen_again: 3,
  worth_testing: 4,
};

export function PersonalPatternsSection({
  error,
  onRetry,
  report,
  state = "ready",
}: {
  error?: string | null;
  onRetry?: () => void;
  report: PersonalPatternReport | null;
  state?: "error" | "loading" | "ready" | "unavailable";
}) {
  if (state === "loading") {
    return (
      <Card aria-live="polite" role="status">
        <CardHeader>
          <CardTitle>Preparing your patterns</CardTitle>
          <CardDescription>
            Murph is loading the latest comparisons from your private health data.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load your patterns</AlertTitle>
        <AlertDescription>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error ?? "We couldn't unlock your pattern data right now."}</span>
            <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (state === "unavailable") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Patterns are getting ready</CardTitle>
          <CardDescription>
            Murph will check your history after your private data refreshes. This normally happens
            within 24 hours or after your health data changes.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const lead = report ? findLeadCell(report) : null;

  return (
    <section
      aria-labelledby="personal-patterns-title"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="grid gap-7 px-6 py-7 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] lg:items-end">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-primary">
            Personal patterns
          </p>
          <h1
            id="personal-patterns-title"
            className="mt-3 max-w-[22ch] font-serif text-3xl font-semibold leading-tight tracking-[-0.025em] text-foreground"
          >
            What tends to move together
          </h1>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            Murph compares repeated action days with similar days when the action did not happen.
            Outcomes come from the next day. These are clues, not proof of cause.
          </p>
        </div>

        {lead && report ? (
          <LeadPattern report={report} cell={lead} />
        ) : (
          <div className="flex items-center gap-4 border-l border-border pl-5">
            <div className="flex -space-x-2" aria-hidden="true">
              <Image
                src="/design-assets/habitat/wrist.svg"
                alt=""
                width={52}
                height={52}
                className="size-12 rounded-full bg-muted/50 p-1.5 ring-2 ring-card"
              />
              <Image
                src="/design-assets/habitat/bed.svg"
                alt=""
                width={52}
                height={52}
                className="size-12 rounded-full bg-muted/50 p-1.5 ring-2 ring-card"
              />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A pattern appears after at least five matched action and comparison days.
            </p>
          </div>
        )}
      </div>

      {report && report.factors.length > 0 && report.outcomes.length > 0 ? (
        <PatternMatrix report={report} />
      ) : (
        <div className="border-t border-border bg-muted/20 px-6 py-8 sm:px-8">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            No clear comparison is ready yet. Murph needs repeated activity or intervention days,
            next-day sleep or recovery data, and similar comparison days across at least three weeks.
          </p>
        </div>
      )}
    </section>
  );
}

function LeadPattern({
  cell,
  report,
}: {
  cell: PersonalPatternCell;
  report: PersonalPatternReport;
}) {
  const factor = report.factors.find((entry) => entry.id === cell.factorId);
  const outcome = report.outcomes.find((entry) => entry.id === cell.outcomeId);
  if (!factor || !outcome || cell.deltaPercent === null) return null;

  return (
    <div className="flex items-start gap-4 border-l border-border pl-5">
      <Image
        src={factorIcon(factor)}
        alt=""
        width={56}
        height={56}
        className="size-14 shrink-0 object-contain"
      />
      <div>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {STAGE_LABELS[cell.stage]}
        </p>
        <p className="mt-1 text-sm font-medium leading-relaxed text-foreground">
          {factor.label} lined up with next-day {sentenceCaseLabel(outcome.label)} being{" "}
          {formatPercentDifference(cell.deltaPercent)} across {cell.exposedDays} matched days.
        </p>
      </div>
    </div>
  );
}

function PatternMatrix({ report }: { report: PersonalPatternReport }) {
  const columns = `12.5rem repeat(${report.outcomes.length}, minmax(8.5rem, 1fr))`;

  return (
    <TooltipProvider delay={120}>
      <div className="border-t border-border">
        <p className="border-b border-border bg-muted/20 px-6 py-3 text-xs text-muted-foreground sm:hidden">
          Scroll sideways to compare every outcome.
        </p>
        <div className="overflow-x-auto">
          <div className="min-w-max">
            <div
              className="grid items-end bg-muted/20"
              style={{ gridTemplateColumns: columns }}
            >
              <div className="sticky left-0 z-20 border-r border-border bg-[#fffcf6] px-6 py-4 dark:bg-card sm:px-8">
                <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
                  Action
                </span>
              </div>
              {report.outcomes.map((outcome) => (
                <div key={outcome.id} className="px-3 py-4 text-center">
                  <span className="text-xs font-medium leading-tight text-foreground">
                    {outcome.label}
                  </span>
                </div>
              ))}
            </div>

            {report.factors.map((factor) => (
              <div
                key={factor.id}
                className="grid min-h-28 items-center border-t border-border"
                style={{ gridTemplateColumns: columns }}
              >
                <div className="sticky left-0 z-10 flex items-center gap-3 border-r border-border bg-[#fffcf6] px-6 py-4 dark:bg-card sm:px-8">
                  <Image
                    src={factorIcon(factor)}
                    alt=""
                    width={48}
                    height={48}
                    className="size-11 shrink-0 object-contain"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">{factor.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Seen on {factor.observedDays} days
                    </p>
                  </div>
                </div>

                {report.outcomes.map((outcome) => {
                  const cell = report.cells.find((entry) =>
                    entry.factorId === factor.id && entry.outcomeId === outcome.id
                  );
                  return (
                    <div key={outcome.id} className="flex justify-center px-3 py-4">
                      {cell ? (
                        <PatternBubble
                          cell={cell}
                          factorLabel={factor.label}
                          outcomeLabel={outcome.label}
                          outcomeUnit={outcome.unit}
                        />
                      ) : <span className="text-xs text-muted-foreground">Not enough</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border bg-muted/20 px-6 py-4 text-xs text-muted-foreground sm:px-8">
          <span>Circle size shows the size of the difference.</span>
          <LegendDot className="bg-[#c4a882]" label="New clue" />
          <LegendDot className="bg-[#7a8c6e]" label="Seen again" />
          <LegendDot className="bg-[#5a6e32] ring-2 ring-primary/25 ring-offset-1" label="Worth testing" />
          <LegendDot className="border border-border bg-card" label="No clear pattern" />
        </div>
      </div>
    </TooltipProvider>
  );
}

function PatternBubble({
  cell,
  factorLabel,
  outcomeLabel,
  outcomeUnit,
}: {
  cell: PersonalPatternCell;
  factorLabel: string;
  outcomeLabel: string;
  outcomeUnit: string;
}) {
  if (cell.stage === "insufficient") {
    return <span className="text-xs text-muted-foreground">Not enough</span>;
  }

  const isFlat = cell.stage === "no_clear_pattern" || cell.direction === "flat";
  const size = isFlat
    ? 44
    : Math.round(50 + Math.min(Math.abs(cell.deltaPercent ?? 0), 30) * 0.8);
  const label = cell.deltaPercent === null || isFlat
    ? "No clear pattern"
    : `${cell.deltaPercent > 0 ? "+" : ""}${formatPercent(cell.deltaPercent)}`;
  const accessibleLabel = `${factorLabel}, next-day ${outcomeLabel}. ${STAGE_LABELS[cell.stage]}. ${label}. ${cell.exposedDays} matched action days.`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <button
            type="button"
            aria-label={accessibleLabel}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold tabular-nums transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:scale-105",
              isFlat && "border border-border bg-card text-muted-foreground",
              !isFlat && cell.stage === "new_clue" && "bg-[#c4a882] text-foreground",
              !isFlat && cell.stage === "seen_again" && "bg-[#7a8c6e] text-[#211e1a]",
              !isFlat && cell.stage === "worth_testing" && "bg-[#5a6e32] text-[#f4ede1]",
              cell.stage === "worth_testing" && "ring-2 ring-primary/25 ring-offset-2 ring-offset-card",
            )}
            style={{ height: size, width: size }}
          >
            {isFlat ? "~" : label}
          </button>
        )}
      />
      <TooltipContent className="block max-w-72 px-3 py-2">
        <p className="font-medium">{STAGE_LABELS[cell.stage]}</p>
        <p className="mt-1 text-background/80">
          {describeMeans(cell, outcomeUnit)} Based on {cell.exposedDays} matched action and comparison days.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("size-2.5 rounded-full", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

function findLeadCell(report: PersonalPatternReport): PersonalPatternCell | null {
  return report.cells
    .filter((cell) => STAGE_RANK[cell.stage] >= STAGE_RANK.new_clue)
    .sort((left, right) =>
      STAGE_RANK[right.stage] - STAGE_RANK[left.stage]
      || Math.abs(right.deltaPercent ?? 0) - Math.abs(left.deltaPercent ?? 0)
      || right.exposedDays - left.exposedDays
    )[0] ?? null;
}

function factorIcon(factor: PersonalPatternFactor): string {
  const id = factor.id.toLowerCase();
  if (id.includes("sauna")) return "/design-assets/habitat/sauna.svg";
  if (id.includes("cold") || id.includes("plunge")) return "/design-assets/habitat/plunge.svg";
  if (id.includes("coffee") || id.includes("caffeine")) return "/design-assets/habitat/coffee-break.svg";
  if (id.includes("sleep")) return "/design-assets/habitat/bed.svg";
  return "/design-assets/habitat/wrist.svg";
}

function sentenceCaseLabel(label: string): string {
  if (label === label.toUpperCase()) return label;
  return `${label.slice(0, 1).toLowerCase()}${label.slice(1)}`;
}

function formatPercent(value: number): string {
  return `${Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function formatPercentDifference(value: number): string {
  return `${formatPercent(Math.abs(value))} ${value >= 0 ? "higher" : "lower"}`;
}

function describeMeans(cell: PersonalPatternCell, unit: string): string {
  if (cell.exposedMean === null || cell.comparisonMean === null) return "";
  const suffix = unit ? ` ${unit}` : "";
  return `Action days averaged ${cell.exposedMean}${suffix}; matched days averaged ${cell.comparisonMean}${suffix}.`;
}
