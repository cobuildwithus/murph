"use client";

import Image from "next/image";
import { useId } from "react";

import type {
  PersonalPatternCell,
  PersonalPatternClassification,
  PersonalPatternReport,
  PersonalPatternStage,
} from "@murphai/query/browser-overview";

import { DashboardPageStatus } from "@/src/components/dashboard/dashboard-page-status";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/src/components/ui/popover";
import { Separator } from "@/src/components/ui/separator";
import { Skeleton } from "@/src/components/ui/skeleton";
import { usePointerPopoverAnchor } from "@/src/components/ui/use-pointer-popover-anchor";
import { cn } from "@/src/lib/utils";
import { resolvePatternFactorIcon } from "./pattern-factor-icon";

const STAGE_LABELS: Record<PersonalPatternStage, string> = {
  insufficient: "Not enough matches",
  no_clear_pattern: "No clear pattern",
  new_clue: "New clue",
  seen_again: "Seen again",
  worth_testing: "Worth testing",
};

const CLASSIFICATION_LABELS: Record<PersonalPatternClassification, string> = {
  observation: "Observation",
  early_signal: "Early signal",
  pattern: "Pattern",
};

export function PersonalPatternsSection({
  onRetry,
  report,
  state = "ready",
}: {
  onRetry?: () => void;
  report: PersonalPatternReport | null;
  state?: "error" | "loading" | "ready" | "unavailable";
}) {
  const headingId = useId();
  const visibleReport = report;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-8">
      <h1
        id={headingId}
        className="font-serif text-[2.625rem] font-semibold leading-[2.875rem] tracking-[-0.025em] text-foreground"
      >
        Patterns
      </h1>

      {state === "loading" ? <PatternsLoadingState /> : null}

      {state === "error" ? (
        <DashboardPageStatus
          actionLabel={onRetry ? "Try again" : undefined}
          description="Your private pattern data could not be opened. Your data is still safe."
          onAction={onRetry}
          title="Patterns could not load"
          tone="error"
        />
      ) : null}

      {state === "unavailable" ? (
        <DashboardPageStatus
          actionLabel={onRetry ? "Refresh Patterns" : undefined}
          description="Murph could not prepare this view from your latest health data."
          onAction={onRetry}
          title="Patterns are not ready yet"
        />
      ) : null}

      {state === "ready" ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {visibleReport &&
          visibleReport.factors.length > 0 &&
          visibleReport.outcomes.length > 0 ? (
            <PatternMatrix report={visibleReport} />
          ) : (
            <div className="px-6 py-8 sm:px-8">
              <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
                {report && report.factors.length > 0
                  ? "No personal pattern stands out yet. Murph will keep checking as new data arrives."
                  : "No comparison is ready yet. Murph needs an action or context, health data, and a nearby comparison day."}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function PatternsLoadingState() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="overflow-hidden rounded-2xl border border-border bg-card"
      role="status"
    >
      <span className="sr-only">Preparing your patterns</span>
      <div className="grid grid-cols-[minmax(10rem,1.2fr)_repeat(2,minmax(8rem,1fr))] border-b border-border px-6 py-5 sm:px-8">
        <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-20 justify-self-center motion-reduce:animate-none" />
        <Skeleton className="h-4 w-16 justify-self-center motion-reduce:animate-none" />
      </div>
      {[0, 1, 2].map((row) => (
        <div
          className="grid grid-cols-[minmax(10rem,1.2fr)_repeat(2,minmax(8rem,1fr))] items-center border-b border-border/70 px-6 py-5 last:border-b-0 sm:px-8"
          key={row}
        >
          <Skeleton className="h-5 w-32 motion-reduce:animate-none" />
          <Skeleton className="size-8 justify-self-center rounded-full motion-reduce:animate-none" />
          <Skeleton className="size-7 justify-self-center rounded-full motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function PatternMatrix({ report }: { report: PersonalPatternReport }) {
  return (
    <>
      <div className="border-t border-border">
        <MobilePatternMatrix report={report} />
        <DesktopPatternMatrix report={report} />

        <div className="border-t border-border px-6 py-4 text-xs text-muted-foreground sm:px-8">
          Circle color and size show evidence strength. Select a result for
          details.
        </div>
      </div>
    </>
  );
}

function MobilePatternMatrix({ report }: { report: PersonalPatternReport }) {
  const outcomeGroups = chunkOutcomes(report.outcomes, 3);

  return (
    <div className="sm:hidden" data-patterns-layout="mobile">
      {outcomeGroups.map((outcomes, groupIndex) => {
        const columns = `minmax(5.25rem, 1.05fr) repeat(${outcomes.length}, minmax(0, 1fr))`;

        return (
          <div
            key={outcomes.map((outcome) => outcome.id).join(":")}
            className={cn(groupIndex > 0 && "border-t-4 border-border")}
            data-pattern-outcome-group={groupIndex + 1}
          >
            <div
              className="grid items-stretch bg-muted/20"
              style={{ gridTemplateColumns: columns }}
            >
              <div className="flex items-end border-r border-border px-2.5 py-3">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                  Action
                </span>
              </div>
              {outcomes.map((outcome) => (
                <div
                  key={outcome.id}
                  className="flex min-w-0 items-end justify-center px-1 py-3 text-center"
                >
                  <span className="text-[10px] font-medium leading-[1.15] text-foreground">
                    {outcome.label}
                  </span>
                </div>
              ))}
            </div>

            {report.factors.map((factor) => (
              <div
                key={factor.id}
                className="grid min-h-[5.25rem] items-stretch border-t border-border"
                style={{ gridTemplateColumns: columns }}
              >
                <div className="flex min-w-0 flex-col items-center justify-center border-r border-border px-1.5 py-2 text-center">
                  <Image
                    src={resolvePatternFactorIcon(factor)}
                    alt=""
                    width={40}
                    height={40}
                    className="size-9 shrink-0 object-contain"
                  />
                  <p className="mt-1 max-w-full break-words text-[11px] font-medium leading-tight text-foreground">
                    {factor.label}
                  </p>
                  <p className="mt-0.5 text-[9px] leading-tight text-muted-foreground">
                    {formatObservedDays(factor.observedDays)}
                  </p>
                </div>

                {outcomes.map((outcome) => {
                  const cell = findPatternCell(report, factor.id, outcome.id);
                  return (
                    <div
                      key={outcome.id}
                      className="flex min-w-0 items-center justify-center px-0.5 py-2"
                    >
                      {cell ? (
                        <PatternBubble
                          cell={cell}
                          compact
                          factorLabel={factor.label}
                          factorObservedDays={factor.observedDays}
                          outcomeLagDays={outcome.lagDays}
                          outcomeLabel={outcome.label}
                          outcomeUnit={outcome.unit}
                        />
                      ) : (
                        <span className="text-[9px] text-muted-foreground">
                          —
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DesktopPatternMatrix({ report }: { report: PersonalPatternReport }) {
  const columns = `17rem repeat(${report.outcomes.length}, minmax(8.5rem, 1fr))`;

  return (
    <div
      className="hidden overflow-x-auto sm:block"
      data-patterns-layout="desktop"
    >
      <div className="min-w-max">
        <div
          className="grid items-end bg-muted/20"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="sticky left-0 z-20 border-r border-border bg-[#fffcf6] px-6 py-4 dark:bg-card">
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
            className="grid min-h-[5.5rem] items-center border-t border-border"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="sticky left-0 z-10 flex items-center gap-3 border-r border-border bg-[#fffcf6] px-6 py-3 dark:bg-card">
              <Image
                src={resolvePatternFactorIcon(factor)}
                alt=""
                width={40}
                height={40}
                className="size-10 shrink-0 object-contain"
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {factor.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Seen on {factor.observedDays} days
                </p>
              </div>
            </div>

            {report.outcomes.map((outcome) => {
              const cell = findPatternCell(report, factor.id, outcome.id);
              return (
                <div key={outcome.id} className="flex justify-center px-3 py-3">
                  {cell ? (
                    <PatternBubble
                      cell={cell}
                      factorLabel={factor.label}
                      factorObservedDays={factor.observedDays}
                      outcomeLagDays={outcome.lagDays}
                      outcomeLabel={outcome.label}
                      outcomeUnit={outcome.unit}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Not enough
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function PatternBubble({
  cell,
  compact = false,
  factorLabel,
  factorObservedDays,
  outcomeLagDays,
  outcomeLabel,
  outcomeUnit,
}: {
  cell: PersonalPatternCell;
  compact?: boolean;
  factorLabel: string;
  factorObservedDays: number;
  outcomeLagDays?: 0 | 1;
  outcomeLabel: string;
  outcomeUnit: string;
}) {
  const pointerAnchor = usePointerPopoverAnchor();

  if (cell.stage === "insufficient") {
    return (
      <Popover>
        <PopoverTrigger
          closeDelay={200}
          delay={150}
          openOnHover
          render={
            <button
              type="button"
              aria-label={`Not enough comparable data to check how ${factorLabel.toLocaleLowerCase()} relates to ${formatSentenceTerm(
                outcomeLabel,
              )}.`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                compact ? "text-[9px]" : "text-xs",
              )}
              onKeyDown={pointerAnchor.onKeyDown}
              onPointerMove={pointerAnchor.onPointerMove}
            >
              <span
                aria-hidden="true"
                className="size-4 rounded-full border border-border bg-card"
              />
              <span>{compact ? "More data" : "Not enough data"}</span>
            </button>
          }
        />
        <PopoverContent
          align="center"
          anchor={pointerAnchor.anchor}
          className="w-[min(21rem,calc(100vw-2rem))]"
          positionMethod="fixed"
          side="right"
          sideOffset={10}
        >
          <PopoverHeader className="gap-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
              Still learning
            </p>
            <PopoverTitle className="font-serif text-lg font-semibold leading-6">
              Not enough comparable days yet
            </PopoverTitle>
            <PopoverDescription className="text-xs leading-5 text-muted-foreground">
              Murph saw {formatDayCount(factorObservedDays)} with{" "}
              {factorLabel.toLocaleLowerCase()}, but could not pair them with
              similar days that also had {formatSentenceTerm(outcomeLabel)}{" "}
              data.
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    );
  }

  const isFlat = cell.stage === "no_clear_pattern" || cell.direction === "flat";
  const indicatorSize = compact
    ? cell.stage === "worth_testing"
      ? 22
      : cell.stage === "seen_again"
      ? 20
      : 18
    : cell.stage === "worth_testing"
    ? 28
    : cell.stage === "seen_again"
    ? 25
    : 22;
  const label =
    cell.deltaPercent === null || isFlat
      ? "No clear pattern"
      : formatPercent(Math.abs(cell.deltaPercent));
  const directionArrow =
    cell.deltaPercent !== null && cell.deltaPercent > 0 ? "↑" : "↓";
  const accessibleLabel = `${describeResult({
    cell,
    factorLabel,
    outcomeLabel,
    outcomeLagDays,
  })} ${describeComparison(
    cell,
    factorLabel,
    outcomeUnit,
  )} ${formatEvidenceLabel(cell)}, ${formatEvidencePeriod(cell)}.`;

  return (
    <Popover>
      <PopoverTrigger
        closeDelay={200}
        delay={150}
        openOnHover
        render={
          <button
            type="button"
            aria-label={accessibleLabel}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-mono font-semibold tabular-nums text-foreground transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              compact ? "text-[9px]" : "text-xs",
            )}
            onKeyDown={pointerAnchor.onKeyDown}
            onPointerMove={pointerAnchor.onPointerMove}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-full",
                isFlat && "border border-border bg-card text-muted-foreground",
                !isFlat &&
                  cell.classification === "pattern" &&
                  "bg-primary text-primary-foreground",
                !isFlat &&
                  cell.classification !== "pattern" &&
                  "bg-primary/15 text-primary",
              )}
              style={{ height: indicatorSize, width: indicatorSize }}
            >
              {isFlat ? null : directionArrow}
            </span>
            <span>
              {isFlat ? (compact ? "No pattern" : "No clear pattern") : label}
            </span>
          </button>
        }
      />
      <PatternPopoverContent
        anchor={pointerAnchor.anchor}
        cell={cell}
        factorLabel={factorLabel}
        isFlat={isFlat}
        outcomeLagDays={outcomeLagDays}
        outcomeLabel={outcomeLabel}
        outcomeUnit={outcomeUnit}
      />
    </Popover>
  );
}

function PatternPopoverContent({
  anchor,
  cell,
  factorLabel,
  isFlat,
  outcomeLagDays,
  outcomeLabel,
  outcomeUnit,
}: {
  anchor: () => { getBoundingClientRect: () => DOMRect } | null;
  cell: PersonalPatternCell;
  factorLabel: string;
  isFlat: boolean;
  outcomeLagDays?: 0 | 1;
  outcomeLabel: string;
  outcomeUnit: string;
}) {
  const factor = factorLabel.toLocaleLowerCase();
  const comparisonLabel =
    cell.comparisonBasis === "confirmed_absence"
      ? `Without ${factor}`
      : "Nearby days";

  return (
    <PopoverContent
      align="center"
      anchor={anchor}
      className="w-[min(23rem,calc(100vw-2rem))]"
      positionMethod="fixed"
      side="right"
      sideOffset={10}
    >
      <PopoverHeader className="gap-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          {isFlat ? "Checked" : formatEvidenceLabel(cell)}
        </p>
        <PopoverTitle className="font-serif text-lg font-semibold leading-6">
          {describeResult({
            cell,
            factorLabel,
            outcomeLabel,
            outcomeLagDays,
          })}
        </PopoverTitle>
        <PopoverDescription className="sr-only">
          Comparison details for this personal pattern
        </PopoverDescription>
      </PopoverHeader>

      {cell.exposedMean !== null && cell.comparisonMean !== null ? (
        <>
          <Separator />
          <dl className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                With {factor}
              </dt>
              <dd className="mt-1 font-serif text-xl font-semibold tabular-nums text-foreground">
                {formatMean(cell.exposedMean, outcomeUnit)}
              </dd>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDayCount(cell.exposedDays)}
              </p>
            </div>
            <div className="min-w-0 border-l border-border pl-4">
              <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                {comparisonLabel}
              </dt>
              <dd className="mt-1 font-serif text-xl font-semibold tabular-nums text-foreground">
                {formatMean(cell.comparisonMean, outcomeUnit)}
              </dd>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDayCount(cell.comparisonDays)}
              </p>
            </div>
          </dl>
        </>
      ) : null}

      <Separator />
      <p className="text-xs leading-5 text-muted-foreground">
        Data from {formatEvidencePeriod(cell)}. This is an association, not
        proof of cause.
      </p>
    </PopoverContent>
  );
}

function chunkOutcomes(
  outcomes: PersonalPatternReport["outcomes"],
  size: number,
): PersonalPatternReport["outcomes"][] {
  const groups: PersonalPatternReport["outcomes"][] = [];
  for (let index = 0; index < outcomes.length; index += size) {
    groups.push(outcomes.slice(index, index + size));
  }
  return groups;
}

function findPatternCell(
  report: PersonalPatternReport,
  factorId: string,
  outcomeId: string,
): PersonalPatternCell | undefined {
  return report.cells.find(
    (entry) => entry.factorId === factorId && entry.outcomeId === outcomeId,
  );
}

function formatObservedDays(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function formatPercent(value: number): string {
  return `${Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function describeResult({
  cell,
  factorLabel,
  outcomeLabel,
  outcomeLagDays,
}: {
  cell: PersonalPatternCell;
  factorLabel: string;
  outcomeLabel: string;
  outcomeLagDays?: 0 | 1;
}): string {
  if (cell.deltaPercent === null || cell.direction === "flat") {
    const outcome =
      outcomeLagDays === 0
        ? `same-day ${formatSentenceTerm(outcomeLabel)}`
        : `next-day ${formatSentenceTerm(outcomeLabel)}`;
    return `No clear pattern was found between ${factorLabel.toLocaleLowerCase()} and ${outcome}.`;
  }

  const timing =
    outcomeLagDays === 0
      ? `${formatSentenceTerm(outcomeLabel)} was`
      : `Next-day ${formatSentenceTerm(outcomeLabel)} was`;
  const context =
    outcomeLagDays === 0
      ? `on days with ${factorLabel.toLocaleLowerCase()}`
      : `after ${factorLabel.toLocaleLowerCase()}`;
  return `${timing} ${formatPercent(Math.abs(cell.deltaPercent))} ${
    cell.deltaPercent > 0 ? "higher" : "lower"
  } ${context}.`;
}

function describeComparison(
  cell: PersonalPatternCell,
  factorLabel: string,
  unit: string,
): string {
  if (cell.exposedMean === null || cell.comparisonMean === null) return "";
  const factor = factorLabel.toLocaleLowerCase();
  const exposed = `${formatDayCount(
    cell.exposedDays,
  )} with ${factor} averaged ${formatMean(cell.exposedMean, unit)}`;
  const comparison =
    cell.comparisonBasis === "confirmed_absence"
      ? `${formatDayCount(
          cell.comparisonDays,
        )} without ${factor} averaged ${formatMean(cell.comparisonMean, unit)}`
      : `${formatDayCount(
          cell.comparisonDays,
        )} nearby comparison days averaged ${formatMean(
          cell.comparisonMean,
          unit,
        )}`;
  return `${exposed}. ${comparison}.`;
}

function formatEvidenceLabel(cell: PersonalPatternCell): string {
  const classification = cell.classification
    ? CLASSIFICATION_LABELS[cell.classification]
    : STAGE_LABELS[cell.stage];
  return cell.grade ? `${classification}, grade ${cell.grade}` : classification;
}

function formatEvidencePeriod(cell: PersonalPatternCell): string {
  if (!cell.firstExposedDate || !cell.lastExposedDate)
    return "the available period";
  const first = formatEvidenceDate(cell.firstExposedDate, true);
  if (cell.firstExposedDate === cell.lastExposedDate) return first;
  const sameYear =
    cell.firstExposedDate.slice(0, 4) === cell.lastExposedDate.slice(0, 4);
  return `${formatEvidenceDate(
    cell.firstExposedDate,
    !sameYear,
  )} to ${formatEvidenceDate(cell.lastExposedDate, true)}`;
}

function formatDayCount(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function formatMean(value: number, unit: string): string {
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
  if (!unit || unit === "score") return formatted;
  return unit === "%" ? `${formatted}%` : `${formatted} ${unit}`;
}

function formatSentenceTerm(label: string): string {
  if (/^[A-Z0-9]{2,}(?:\s|$)/u.test(label)) return label;
  return `${label.charAt(0).toLocaleLowerCase()}${label.slice(1)}`;
}

function formatEvidenceDate(value: string, includeYear: boolean): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
