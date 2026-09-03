"use client";

import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  CircleHelp,
  Ellipsis,
  Minus,
  Moon,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PersonalPatternCell,
  PersonalPatternClassification,
  PersonalPatternOutcome,
  PersonalPatternReport,
  PersonalPatternStage,
} from "@murphai/query/browser-overview";

import { DashboardPageStatus } from "@/src/components/dashboard/dashboard-page-status";
import { Button } from "@/src/components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { usePointerPopoverAnchor } from "@/src/components/ui/use-pointer-popover-anchor";
import { cn } from "@/src/lib/utils";
import { resolvePatternFactorIcon } from "./pattern-factor-icon";

const INITIAL_VISIBLE_FACTOR_COUNT = 15;

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

interface PatternPopoverState {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
}

export interface PatternSort {
  columnId: string;
  direction: "ascending" | "descending";
}

const PatternPopoverContext = createContext<PatternPopoverState | null>(null);

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
  const matrixId = useId();
  const [showAllFactors, setShowAllFactors] = useState(false);
  const [sort, setSort] = useState<PatternSort | null>(null);
  const visibleReport = report ? selectVisiblePatternReport(report) : null;
  const sortedReport = visibleReport
    ? sortPersonalPatternReport(visibleReport, sort)
    : null;
  const hasMoreFactors =
    (sortedReport?.factors.length ?? 0) > INITIAL_VISIBLE_FACTOR_COUNT;
  const displayedReport = buildDisplayedPatternReport(
    sortedReport,
    showAllFactors,
  );

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-8">
      <h1
        id={headingId}
        className="font-serif text-3xl font-semibold tracking-tight text-foreground"
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
        <div className="-mx-2 overflow-hidden rounded-2xl border border-border bg-card sm:mx-0">
          {displayedReport &&
          displayedReport.factors.length > 0 &&
          displayedReport.outcomes.length > 0 ? (
            <>
              <div id={matrixId}>
                <PatternMatrix
                  onSort={(columnId) =>
                    setSort((current) => ({
                      columnId,
                      direction:
                        current?.columnId === columnId &&
                        current.direction === "descending"
                          ? "ascending"
                          : "descending",
                    }))
                  }
                  report={displayedReport}
                  sort={sort}
                />
              </div>
              {hasMoreFactors ? (
                <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4 sm:px-8">
                  <p className="text-xs text-muted-foreground">
                    Showing {displayedReport.factors.length} of{" "}
                    {visibleReport?.factors.length} factors
                  </p>
                  <Button
                    aria-controls={matrixId}
                    aria-expanded={showAllFactors}
                    className="rounded-full"
                    onClick={() => setShowAllFactors((current) => !current)}
                    size="sm"
                    variant="outline"
                  >
                    {showAllFactors ? "Show less" : "Show more"}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <PatternsEmptyState
              hasFactors={Boolean(report?.factors.length)}
              hasHealthData={Boolean(report?.outcomes.length)}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

function PatternsEmptyState({
  hasFactors,
  hasHealthData,
}: {
  hasFactors: boolean;
  hasHealthData: boolean;
}) {
  const needsContext = hasHealthData && !hasFactors;
  const isLearning = hasHealthData && hasFactors;

  return (
    <div className="sm:grid sm:grid-cols-[1.12fr_0.88fr]">
      <div className="p-7 sm:p-10">
        <Sparkles className="size-8 text-primary" aria-hidden="true" />
        <h2 className="mt-5 max-w-md font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {isLearning
            ? "Your first patterns are taking shape"
            : needsContext
            ? "Give your health data some context"
            : "Find what changes your sleep and recovery"}
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
          {isLearning
            ? "Murph has useful data and is waiting for enough comparable days. Keep wearing your device and sharing what happened."
            : needsContext
            ? "Your device records the result. Tell Murph about training, travel, caffeine, meals, and other things that may explain it."
            : "Connect a device. Murph will compare sleep and recovery with the things that happen in your life."}
        </p>
        <Button
          className="mt-6 rounded-full"
          nativeButton={false}
          render={<Link href={hasHealthData ? "/journal" : "/connect"} />}
        >
          {hasHealthData ? "Open Journal" : "Connect a device"}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
      <div className="border-t border-border bg-muted/20 p-7 sm:border-l sm:border-t-0 sm:p-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Patterns can reveal
        </p>
        <ul className="mt-5 space-y-5 text-sm text-foreground">
          <li className="flex items-center gap-3">
            <Moon className="size-5 text-primary" aria-hidden="true" />
            What supports better sleep
          </li>
          <li className="flex items-center gap-3">
            <Activity className="size-5 text-primary" aria-hidden="true" />
            Which activities change recovery
          </li>
          <li className="flex items-center gap-3">
            <Sparkles className="size-5 text-primary" aria-hidden="true" />
            Which personal habits are worth testing
          </li>
        </ul>
      </div>
    </div>
  );
}

function buildDisplayedPatternReport(
  report: PersonalPatternReport | null,
  showAllFactors: boolean,
): PersonalPatternReport | null {
  if (!report) return null;
  return {
    ...report,
    factors: showAllFactors
      ? report.factors
      : report.factors.slice(0, INITIAL_VISIBLE_FACTOR_COUNT),
  };
}

export function sortPersonalPatternReport(
  report: PersonalPatternReport,
  sort: PatternSort | null,
): PersonalPatternReport {
  if (!sort) return report;
  const column = buildOutcomeColumns(report.outcomes).find(
    (candidate) => candidate.id === sort.columnId,
  );
  if (!column) return report;
  const originalIndex = new Map(
    report.factors.map((factor, index) => [factor.id, index]),
  );
  const direction = sort.direction === "ascending" ? 1 : -1;

  return {
    ...report,
    factors: [...report.factors].sort((left, right) => {
      const leftValue = patternColumnSortValue(report, left.id, column);
      const rightValue = patternColumnSortValue(report, right.id, column);
      if (leftValue === null && rightValue !== null) return 1;
      if (leftValue !== null && rightValue === null) return -1;
      if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
        return (leftValue - rightValue) * direction;
      }
      return (
        right.observedDays - left.observedDays ||
        (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0)
      );
    }),
  };
}

function patternColumnSortValue(
  report: PersonalPatternReport,
  factorId: string,
  column: PatternOutcomeColumn,
): number | null {
  const values = column.outcomes
    .flatMap((outcome) => {
      const cell = findPatternCell(report, factorId, outcome.id);
      return cell &&
        cell.stage !== "insufficient" &&
        cell.deltaPercent !== null
        ? [cell.deltaPercent]
        : [];
    });
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
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

function PatternMatrix({
  onSort,
  report,
  sort,
}: {
  onSort: (columnId: string) => void;
  report: PersonalPatternReport;
  sort: PatternSort | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const popoverState = useMemo(() => ({ activeId, setActiveId }), [activeId]);

  return (
    <PatternPopoverContext.Provider value={popoverState}>
      <TooltipProvider>
        <div className="border-t border-border">
          <MobilePatternMatrix onSort={onSort} report={report} sort={sort} />
          <DesktopPatternMatrix onSort={onSort} report={report} sort={sort} />

          <div className="border-t border-border px-6 py-4 text-xs text-muted-foreground sm:px-8">
            Results show associations, not proof of cause.
          </div>
        </div>
      </TooltipProvider>
    </PatternPopoverContext.Provider>
  );
}

function MobilePatternMatrix({
  onSort,
  report,
  sort,
}: {
  onSort: (columnId: string) => void;
  report: PersonalPatternReport;
  sort: PatternSort | null;
}) {
  const outcomeColumns = buildOutcomeColumns(report.outcomes);
  const columns = `repeat(${outcomeColumns.length}, 7rem)`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showRightFade, setShowRightFade] = useState(false);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => {
      const remaining =
        scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
      setShowRightFade(remaining > 2);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    if (scroller.firstElementChild) {
      observer?.observe(scroller.firstElementChild);
    }
    return () => {
      scroller.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [outcomeColumns.length]);

  return (
    <div
      className="relative grid grid-cols-[5.25rem_minmax(0,1fr)] sm:hidden"
      data-patterns-layout="mobile"
    >
      <div className="relative z-20 bg-[#fffcf6] dark:bg-card">
        <div
          className="h-[3.75rem] border-r border-border bg-muted/20"
          aria-hidden="true"
        />
        {report.factors.map((factor) => (
          <div
            className="flex h-[5.25rem] min-w-0 flex-col items-center justify-center border-r border-t border-border px-1 py-1.5 text-center"
            data-pattern-factor-row={factor.id}
            key={factor.id}
          >
            <Image
              src={resolvePatternFactorIcon(factor)}
              alt=""
              width={32}
              height={32}
              className="size-7 shrink-0 object-contain"
            />
            <p className="mt-0.5 max-w-full break-words text-[11px] font-medium leading-tight text-foreground">
              {factor.label}
            </p>
            <ObservedDaysMeter
              className="mt-1"
              days={factor.observedDays}
            />
          </div>
        ))}
      </div>

      <div
        aria-label="Pattern results. Swipe horizontally to compare health measures."
        className="min-w-0 overflow-x-auto overscroll-x-contain"
        ref={scrollRef}
        tabIndex={0}
      >
        <div
          className="w-max min-w-full"
          data-pattern-outcome-group={1}
          style={{ minWidth: `${outcomeColumns.length * 7}rem` }}
        >
          <div
            className="grid h-[3.75rem] items-stretch bg-muted/20"
            style={{ gridTemplateColumns: columns }}
          >
            {outcomeColumns.map((outcome) => (
              <div
                key={outcome.id}
                className="flex min-w-0 items-end justify-center px-2 py-3 text-center"
                data-pattern-outcome-column={outcome.id}
              >
                <PatternOutcomeHeader
                  compact
                  onSort={onSort}
                  outcome={outcome}
                  sortDirection={
                    sort?.columnId === outcome.id ? sort.direction : null
                  }
                />
              </div>
            ))}
          </div>

          {report.factors.map((factor) => (
            <div
              key={factor.id}
              className="grid h-[5.25rem] items-stretch border-t border-border"
              style={{ gridTemplateColumns: columns }}
            >
              {outcomeColumns.map((outcome) => {
                return (
                  <div
                    key={outcome.id}
                    className="flex min-w-0 items-center justify-center px-1 py-2"
                  >
                    <PatternOutcomeColumnCell
                      compact
                      factorLabel={factor.label}
                      factorObservedDays={factor.observedDays}
                      outcomes={outcome.outcomes}
                      report={report}
                      factorId={factor.id}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {showRightFade ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-30 w-16 bg-gradient-to-r from-transparent to-[#fffcf6] dark:to-card"
        />
      ) : null}
    </div>
  );
}

function DesktopPatternMatrix({
  onSort,
  report,
  sort,
}: {
  onSort: (columnId: string) => void;
  report: PersonalPatternReport;
  sort: PatternSort | null;
}) {
  const outcomeColumns = buildOutcomeColumns(report.outcomes);
  const columns = `13.5rem repeat(${outcomeColumns.length}, minmax(7.5rem, 1fr))`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showRightFade, setShowRightFade] = useState(false);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => {
      const remaining =
        scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
      setShowRightFade(remaining > 2);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    if (scroller.firstElementChild) {
      observer?.observe(scroller.firstElementChild);
    }
    return () => {
      scroller.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [outcomeColumns.length]);

  return (
    <div className="relative hidden sm:block" data-patterns-layout="desktop">
      <div
        aria-label="Pattern results. Scroll horizontally to see more health measures."
        className="overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]"
        ref={scrollRef}
        tabIndex={0}
      >
        <div
          className="w-full"
          style={{ minWidth: `${13.5 + outcomeColumns.length * 8.5}rem` }}
        >
          <div
            className="grid items-end bg-muted/20"
            style={{ gridTemplateColumns: columns }}
          >
            <div
              className="sticky left-0 z-20 border-r border-border bg-[#fffcf6] dark:bg-card"
              aria-hidden="true"
            />
            {outcomeColumns.map((outcome) => (
              <div
                key={outcome.id}
                className="px-3 py-4 text-center"
                data-pattern-outcome-column={outcome.id}
              >
                <PatternOutcomeHeader
                  onSort={onSort}
                  outcome={outcome}
                  sortDirection={
                    sort?.columnId === outcome.id ? sort.direction : null
                  }
                />
              </div>
            ))}
          </div>

          {report.factors.map((factor) => (
            <div
              key={factor.id}
              className="grid min-h-[4.75rem] items-center border-t border-border"
              style={{ gridTemplateColumns: columns }}
            >
              <div className="sticky left-0 z-10 flex items-center gap-2.5 border-r border-border bg-[#fffcf6] px-4 py-3 dark:bg-card">
                <Image
                  src={resolvePatternFactorIcon(factor)}
                  alt=""
                  width={40}
                  height={40}
                  className="size-9 shrink-0 object-contain"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">
                    {factor.label}
                  </p>
                  <ObservedDaysMeter days={factor.observedDays} />
                </div>
              </div>

              {outcomeColumns.map((outcome) => {
                return (
                  <div
                    key={outcome.id}
                    className="flex justify-center px-3 py-3"
                  >
                    <PatternOutcomeColumnCell
                      factorLabel={factor.label}
                      factorObservedDays={factor.observedDays}
                      outcomes={outcome.outcomes}
                      report={report}
                      factorId={factor.id}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {showRightFade ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-30 w-32 bg-gradient-to-r from-transparent to-[#fffcf6] dark:to-card"
        />
      ) : null}
    </div>
  );
}

interface PatternOutcomeColumn {
  description: string;
  id: string;
  label: string;
  outcomes: PersonalPatternOutcome[];
}

interface PatternEffectEntry {
  cell: PersonalPatternCell;
  outcome: PersonalPatternOutcome;
}

function PatternOutcomeHeader({
  compact = false,
  onSort,
  outcome,
  sortDirection,
}: {
  compact?: boolean;
  onSort: (columnId: string) => void;
  outcome: PatternOutcomeColumn;
  sortDirection: PatternSort["direction"] | null;
}) {
  const pointerAnchor = usePointerPopoverAnchor();
  const popover = useExclusivePatternPopover();

  const SortIcon =
    sortDirection === "ascending"
      ? ArrowUp
      : sortDirection === "descending"
        ? ArrowDown
        : ArrowUpDown;

  return (
    <div className="flex items-center justify-center gap-1">
      <button
        aria-label={`Sort by ${outcome.label}${
          sortDirection ? `, ${sortDirection}` : ""
        }`}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          compact ? "text-[10px] leading-[1.15]" : "text-xs leading-tight",
        )}
        onClick={() => onSort(outcome.id)}
        type="button"
      >
        <span>{outcome.label}</span>
        <SortIcon
          aria-hidden="true"
          className={compact ? "size-2.5" : "size-3"}
        />
      </button>
      <Popover open={popover.open} onOpenChange={popover.onOpenChange}>
        <PopoverTrigger
          closeDelay={200}
          delay={150}
          openOnHover
          render={
            <button
              aria-label={`About ${outcome.label}`}
              className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onKeyDown={pointerAnchor.onKeyDown}
              onPointerMove={pointerAnchor.onPointerMove}
              type="button"
            >
              <CircleHelp aria-hidden="true" className="size-3" />
            </button>
          }
        />
        <PopoverContent
          align="center"
          anchor={pointerAnchor.anchor}
          className="w-[min(19rem,calc(100vw-2rem))]"
          positionMethod="fixed"
          side="right"
          sideOffset={10}
        >
          <PopoverHeader className="gap-1">
            <PopoverTitle className="font-serif text-base font-semibold">
              {outcome.label}
            </PopoverTitle>
            <PopoverDescription className="text-xs leading-5 text-muted-foreground">
              {outcome.description}
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PatternOutcomeColumnCell({
  compact = false,
  factorId,
  factorLabel,
  factorObservedDays,
  outcomes,
  report,
}: {
  compact?: boolean;
  factorId: string;
  factorLabel: string;
  factorObservedDays: number;
  outcomes: PersonalPatternOutcome[];
  report: PersonalPatternReport;
}) {
  const entries = outcomes.map((outcome) => ({
    cell: findPatternCell(report, factorId, outcome.id),
    outcome,
  }));
  const effects = entries.filter(isPatternEffectEntry);

  if (effects.length === 0) {
    const checked = entries.find(
      ({ cell }) => cell !== undefined && cell.stage === "no_clear_pattern",
    );
    const outcome = checked?.outcome ?? outcomes[0];

    return (
      <PatternBubble
        cell={checked?.cell}
        compact={compact}
        factorLabel={factorLabel}
        factorObservedDays={factorObservedDays}
        outcomeId={outcome?.id ?? "unknown"}
        outcomeLagDays={outcome?.lagDays}
        outcomeLabel={outcome?.label ?? "this result"}
        outcomeUnit={outcome?.unit ?? "score"}
      />
    );
  }

  if (effects.length === 1) {
    const [{ cell, outcome }] = effects;
    return (
      <PatternBubble
        cell={cell}
        compact={compact}
        factorLabel={factorLabel}
        factorObservedDays={factorObservedDays}
        outcomeId={outcome.id}
        outcomeLagDays={outcome.lagDays}
        outcomeLabel={outcome.label}
        outcomeUnit={outcome.unit}
      />
    );
  }

  return (
    <PatternCompositeBubble
      compact={compact}
      entries={effects}
      factorLabel={factorLabel}
    />
  );
}

function isPatternEffectEntry(entry: {
  cell: PersonalPatternCell | undefined;
  outcome: PersonalPatternOutcome;
}): entry is PatternEffectEntry {
  return (
    entry.cell !== undefined &&
    entry.cell.stage !== "insufficient" &&
    entry.cell.stage !== "no_clear_pattern" &&
    entry.cell.direction !== "flat"
  );
}

function PatternCompositeBubble({
  compact = false,
  entries,
  factorLabel,
}: {
  compact?: boolean;
  entries: PatternEffectEntry[];
  factorLabel: string;
}) {
  const pointerAnchor = usePointerPopoverAnchor();
  const popover = useExclusivePatternPopover();
  const deltaPercent =
    entries.reduce((sum, entry) => sum + (entry.cell.deltaPercent ?? 0), 0) /
    entries.length;
  const classification = entries
    .map(
      (entry): PersonalPatternClassification =>
        entry.cell.classification ?? "observation",
    )
    .reduce<PersonalPatternClassification>(
      (current, candidate) =>
        classificationRank(candidate) < classificationRank(current)
          ? candidate
          : current,
      "pattern",
    );
  const tone: PatternEffectTone = deltaPercent >= 0 ? "positive" : "negative";
  const DirectionIcon = deltaPercent >= 0 ? ArrowUp : ArrowDown;
  const factor = factorLabel.toLocaleLowerCase();
  const label = formatPercent(Math.abs(deltaPercent));
  const period = formatCombinedEvidencePeriod(entries);

  return (
    <Popover open={popover.open} onOpenChange={popover.onOpenChange}>
      <PopoverTrigger
        closeDelay={200}
        delay={150}
        openOnHover
        render={
          <button
            type="button"
            aria-label={`You slept ${
              deltaPercent >= 0 ? "better" : "worse"
            } after ${factor}. ${label} average change across sleep score and sleep efficiency.`}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-sans font-semibold text-foreground transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              compact ? "text-[10px]" : "text-sm",
            )}
            data-pattern-state="effect"
            onKeyDown={pointerAnchor.onKeyDown}
            onPointerMove={pointerAnchor.onPointerMove}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-full",
                tone === "positive" &&
                  classification === "pattern" &&
                  "bg-primary text-primary-foreground",
                tone === "positive" &&
                  classification !== "pattern" &&
                  "bg-primary/15 text-primary",
                tone === "negative" &&
                  classification === "pattern" &&
                  "bg-red-600 text-white dark:bg-red-500",
                tone === "negative" &&
                  classification !== "pattern" &&
                  "bg-red-600/10 text-red-700 dark:bg-red-500/15 dark:text-red-300",
                compact ? "size-4" : "size-[18px]",
              )}
            >
              <DirectionIcon aria-hidden="true" className="size-3" />
            </span>
            <span>{label}</span>
          </button>
        }
      />
      <PopoverContent
        align="center"
        anchor={pointerAnchor.anchor}
        className="w-[min(24rem,calc(100vw-2rem))]"
        positionMethod="fixed"
        side="right"
        sideOffset={10}
      >
        <PopoverHeader className="gap-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
            Sleep quality
          </p>
          <PopoverTitle className="font-serif text-lg font-semibold leading-6">
            You slept {deltaPercent >= 0 ? "better" : "worse"} after {factor}.
          </PopoverTitle>
          <PopoverDescription className="sr-only">
            Sleep score and sleep efficiency comparisons.
          </PopoverDescription>
        </PopoverHeader>
        <Separator />
        <div className="space-y-4">
          {entries.map(({ cell, outcome }) => (
            <section aria-label={outcome.label} key={outcome.id}>
              <p className="mb-2 text-xs font-medium text-foreground">
                {outcome.label}
              </p>
              {cell.exposedMean !== null && cell.comparisonMean !== null ? (
                <PatternComparisonBars
                  comparisonLabel="Other days"
                  comparisonMean={cell.comparisonMean}
                  exposedLabel={`After ${factor}`}
                  exposedMean={cell.exposedMean}
                  tone={getPatternEffectTone(outcome.id, cell.deltaPercent)}
                  unit={outcome.unit}
                />
              ) : null}
            </section>
          ))}
        </div>
        <Separator />
        <p className="text-xs leading-5 text-muted-foreground">
          Data from {period}.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function PatternBubble({
  cell,
  compact = false,
  factorLabel,
  factorObservedDays,
  outcomeId,
  outcomeLagDays,
  outcomeLabel,
  outcomeUnit,
}: {
  cell?: PersonalPatternCell;
  compact?: boolean;
  factorLabel: string;
  factorObservedDays: number;
  outcomeId: string;
  outcomeLagDays?: 0 | 1;
  outcomeLabel: string;
  outcomeUnit: string;
}) {
  const pointerAnchor = usePointerPopoverAnchor();
  const popover = useExclusivePatternPopover();

  if (!cell || cell.stage === "insufficient") {
    return (
      <Popover open={popover.open} onOpenChange={popover.onOpenChange}>
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
                "inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                compact ? "size-5" : "size-6",
              )}
              data-pattern-state="insufficient"
              onKeyDown={pointerAnchor.onKeyDown}
              onPointerMove={pointerAnchor.onPointerMove}
            >
              <Ellipsis aria-hidden="true" className="size-3" />
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
              No comparable days
            </PopoverTitle>
            <PopoverDescription className="text-xs leading-5 text-muted-foreground">
              Murph found {formatDayCount(factorObservedDays)} with{" "}
              {factorLabel.toLocaleLowerCase()}, but not enough matching days
              also had {formatSentenceTerm(outcomeLabel)} data for a fair
              comparison.
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    );
  }

  const isFlat = cell.stage === "no_clear_pattern" || cell.direction === "flat";
  const tone = isFlat
    ? "neutral"
    : getPatternEffectTone(outcomeId, cell.deltaPercent);
  const indicatorSize = compact ? 16 : 18;
  const label =
    cell.deltaPercent === null || isFlat
      ? "No clear pattern"
      : formatPercent(Math.abs(cell.deltaPercent));
  const DirectionIcon =
    cell.deltaPercent !== null && cell.deltaPercent > 0 ? ArrowUp : ArrowDown;
  const accessibleLabel = `${describePlainResult({
    cell,
    factorLabel,
    outcomeId,
    outcomeLabel,
    outcomeLagDays,
  })} ${describeComparison(
    cell,
    factorLabel,
    outcomeUnit,
  )} ${formatEvidenceLabel(cell)}, ${formatEvidencePeriod(cell)}.`;

  return (
    <Popover open={popover.open} onOpenChange={popover.onOpenChange}>
      <PopoverTrigger
        closeDelay={200}
        delay={150}
        openOnHover
        render={
          <button
            type="button"
            aria-label={accessibleLabel}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-sans font-semibold text-foreground transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              compact ? "text-[10px]" : "text-sm",
            )}
            data-pattern-state={isFlat ? "no-clear-pattern" : "effect"}
            onKeyDown={pointerAnchor.onKeyDown}
            onPointerMove={pointerAnchor.onPointerMove}
          >
            <PatternEffectIndicator
              classification={cell.classification ?? null}
              DirectionIcon={DirectionIcon}
              isFlat={isFlat}
              size={indicatorSize}
              tone={tone}
            />
            {isFlat ? null : <span>{label}</span>}
          </button>
        }
      />
      <PatternPopoverContent
        anchor={pointerAnchor.anchor}
        cell={cell}
        factorLabel={factorLabel}
        isFlat={isFlat}
        outcomeId={outcomeId}
        outcomeLagDays={outcomeLagDays}
        outcomeLabel={outcomeLabel}
        outcomeUnit={outcomeUnit}
      />
    </Popover>
  );
}

function PatternEffectIndicator({
  classification,
  DirectionIcon,
  isFlat,
  size,
  tone,
}: {
  classification: PersonalPatternClassification | null;
  DirectionIcon: typeof ArrowUp;
  isFlat: boolean;
  size: number;
  tone: PatternEffectTone;
}) {
  const isPattern = classification === "pattern";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        isFlat && "border border-border bg-card text-muted-foreground",
        !isFlat && tone === "positive" && isPattern &&
          "bg-primary text-primary-foreground",
        !isFlat && tone === "positive" && !isPattern &&
          "bg-primary/15 text-primary",
        !isFlat && tone === "negative" && isPattern &&
          "bg-red-700/80 text-white dark:bg-red-500/80",
        !isFlat && tone === "negative" && !isPattern &&
          "bg-red-700/10 text-red-700 dark:bg-red-500/15 dark:text-red-300",
        !isFlat && tone === "neutral" && "bg-muted text-muted-foreground",
      )}
      style={{ height: size, width: size }}
    >
      {isFlat ? (
        <Minus aria-hidden="true" className="size-3" />
      ) : (
        <DirectionIcon aria-hidden="true" className="size-3" />
      )}
    </span>
  );
}

function useExclusivePatternPopover(): {
  onOpenChange: (open: boolean) => void;
  open: boolean;
} {
  const id = useId();
  const state = useContext(PatternPopoverContext);

  if (!state) {
    return { onOpenChange: () => undefined, open: false };
  }

  return {
    onOpenChange: (open) => {
      if (open) {
        state.setActiveId(id);
      } else if (state.activeId === id) {
        state.setActiveId(null);
      }
    },
    open: state.activeId === id,
  };
}

function PatternPopoverContent({
  anchor,
  cell,
  factorLabel,
  isFlat,
  outcomeId,
  outcomeLagDays,
  outcomeLabel,
  outcomeUnit,
}: {
  anchor: () => { getBoundingClientRect: () => DOMRect } | null;
  cell: PersonalPatternCell;
  factorLabel: string;
  isFlat: boolean;
  outcomeId: string;
  outcomeLagDays?: 0 | 1;
  outcomeLabel: string;
  outcomeUnit: string;
}) {
  const factor = factorLabel.toLocaleLowerCase();
  const tone = isFlat
    ? "neutral"
    : getPatternEffectTone(outcomeId, cell.deltaPercent);
  const exposedLabel =
    outcomeLagDays === 0 ? `With ${factor}` : `After ${factor}`;
  const comparisonLabel =
    cell.comparisonBasis === "confirmed_absence"
      ? `Without ${factor}`
      : "Other days";

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
          {outcomeLabel}
        </p>
        <PopoverTitle className="font-serif text-lg font-semibold leading-6">
          {isFlat
            ? "No clear pattern"
            : describePlainResult({
                cell,
                factorLabel,
                outcomeId,
                outcomeLabel,
                outcomeLagDays,
              })}
        </PopoverTitle>
        <PopoverDescription
          className={cn(
            "text-xs leading-5 text-muted-foreground",
            !isFlat && "sr-only",
          )}
        >
          {isFlat
            ? `No consistent change in ${formatSentenceTerm(
                outcomeLabel,
              )} after ${factor}.`
            : "Comparison details for this personal pattern"}
        </PopoverDescription>
      </PopoverHeader>

      {cell.exposedMean !== null && cell.comparisonMean !== null ? (
        <>
          <Separator />
          <PatternComparisonBars
            comparisonLabel={comparisonLabel}
            comparisonMean={cell.comparisonMean}
            exposedLabel={exposedLabel}
            exposedMean={cell.exposedMean}
            tone={tone}
            unit={outcomeUnit}
          />
        </>
      ) : null}

      <Separator />
      <p className="text-xs leading-5 text-muted-foreground">
        Data from {formatEvidencePeriod(cell)}.
      </p>
    </PopoverContent>
  );
}

function PatternComparisonBars({
  comparisonLabel,
  comparisonMean,
  exposedLabel,
  exposedMean,
  tone,
  unit,
}: {
  comparisonLabel: string;
  comparisonMean: number;
  exposedLabel: string;
  exposedMean: number;
  tone: PatternEffectTone;
  unit: string;
}) {
  const largestMean = Math.max(
    Math.abs(exposedMean),
    Math.abs(comparisonMean),
    1,
  );
  const exposedWidth = Math.max(8, (Math.abs(exposedMean) / largestMean) * 100);
  const comparisonWidth = Math.max(
    8,
    (Math.abs(comparisonMean) / largestMean) * 100,
  );

  return (
    <dl className="space-y-3">
      <ComparisonBar
        className={cn(
          tone === "positive" && "bg-primary",
          tone === "negative" && "bg-red-700/75 dark:bg-red-500/75",
          tone === "neutral" && "bg-muted-foreground/60",
        )}
        label={exposedLabel}
        value={formatMean(exposedMean, unit)}
        width={exposedWidth}
      />
      <ComparisonBar
        className="bg-muted-foreground/25"
        label={comparisonLabel}
        value={formatMean(comparisonMean, unit)}
        width={comparisonWidth}
      />
    </dl>
  );
}

function ComparisonBar({
  className,
  label,
  value,
  width,
}: {
  className: string;
  label: string;
  value: string;
  width: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-4">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="font-serif text-sm font-semibold text-foreground">
          {value}
        </dd>
      </div>
      <div
        aria-hidden="true"
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", className)}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function buildOutcomeColumns(
  outcomes: PersonalPatternReport["outcomes"],
): PatternOutcomeColumn[] {
  const sleepQualityOutcomes = outcomes.filter(
    (outcome) =>
      outcome.id === "sleep-score" || outcome.id === "sleep-efficiency",
  );
  const firstSleepQualityIndex = outcomes.findIndex(
    (outcome) =>
      outcome.id === "sleep-score" || outcome.id === "sleep-efficiency",
  );

  return outcomes.flatMap((outcome, index) => {
    if (outcome.id !== "sleep-score" && outcome.id !== "sleep-efficiency") {
      return [
        {
          description: getOutcomeDescription(outcome.id),
          id: outcome.id,
          label:
            outcome.id === "total-sleep" ? "Sleep duration" : outcome.label,
          outcomes: [outcome],
        },
      ];
    }
    if (index !== firstSleepQualityIndex) {
      return [];
    }
    return [
      {
        description:
          "How restful and continuous your sleep was, based on score or efficiency.",
        id: "sleep-quality",
        label: "Sleep quality",
        outcomes: sleepQualityOutcomes,
      },
    ];
  });
}

export function getOutcomeDescription(outcomeId: string): string {
  switch (outcomeId) {
    case "total-sleep":
      return "How long you slept. More time can support recovery when it matches your needs.";
    case "deep-sleep":
      return "The restorative sleep stage most linked with physical recovery.";
    case "rem-sleep":
      return "The sleep stage linked with memory, learning, and emotional processing.";
    case "readiness-score":
      return "Your device's estimate of how prepared your body is for strain.";
    case "hrv":
      return "A recovery signal based on variation between heartbeats. Your own trend matters most.";
    case "resting-heart-rate":
      return "Your heart rate at rest. Changes can reflect recovery, stress, or illness.";
    case "respiratory-rate":
      return "How many breaths you took each minute while resting or sleeping.";
    case "spo2":
      return "Blood oxygen saturation. It estimates how much oxygen your red blood cells carry, usually while you sleep.";
    default:
      return "A personal health result compared across recorded days.";
  }
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

function formatPercent(value: number): string {
  return `${Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function classificationRank(
  classification: PersonalPatternClassification,
): number {
  switch (classification) {
    case "observation":
      return 0;
    case "early_signal":
      return 1;
    case "pattern":
      return 2;
  }
}

function formatCombinedEvidencePeriod(entries: PatternEffectEntry[]): string {
  const starts = entries
    .map((entry) => entry.cell.firstExposedDate)
    .filter((date): date is string => date !== null)
    .sort();
  const ends = entries
    .map((entry) => entry.cell.lastExposedDate)
    .filter((date): date is string => date !== null)
    .sort();
  const first = starts[0];
  const last = ends.at(-1);
  if (!first || !last) return "the available period";
  if (first === last) return formatEvidenceDate(first, true);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${formatEvidenceDate(first, !sameYear)} to ${formatEvidenceDate(
    last,
    true,
  )}`;
}

function ObservedDaysMeter({
  className,
  days,
}: {
  className?: string;
  days: number;
}) {
  const level = getObservedDaysLevel(days);
  const coverageLabel = getObservedDaysLabel(level);
  const label = `${coverageLabel}: based on ${formatCaseCount(days)}`;

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className={cn(
          "flex w-fit items-center rounded-sm py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className,
        )}
        data-observed-days={days}
      >
        <span aria-hidden="true" className="flex items-center gap-0.5">
          {Array.from({ length: 5 }, (_, index) => (
            <span
              className={cn(
                "h-[5px] w-2 rounded-[2px]",
                index < level ? "bg-primary" : "bg-border",
              )}
              key={index}
            />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-52 flex-col items-start gap-0.5">
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">{coverageLabel}</p>
          <p className="text-xs opacity-80">
            Based on {formatCaseCount(days)}.
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function getObservedDaysLabel(level: number): string {
  switch (level) {
    case 1:
      return "Limited data";
    case 2:
      return "Early coverage";
    case 3:
      return "Growing coverage";
    case 4:
      return "Good coverage";
    default:
      return "Strong coverage";
  }
}

function getObservedDaysLevel(days: number): number {
  if (days <= 2) return 1;
  if (days <= 5) return 2;
  if (days <= 10) return 3;
  if (days <= 20) return 4;
  return 5;
}

export function selectVisiblePatternReport(
  report: PersonalPatternReport,
): PersonalPatternReport {
  const outcomes = report.outcomes.filter((outcome) =>
    report.factors.some((factor) => {
      const cell = findPatternCell(report, factor.id, outcome.id);
      return (
        cell !== undefined &&
        cell.stage !== "insufficient" &&
        cell.stage !== "no_clear_pattern"
      );
    }),
  );
  const factors = report.factors.filter((factor) =>
    outcomes.some((outcome) => {
      const cell = findPatternCell(report, factor.id, outcome.id);
      return cell !== undefined && cell.stage !== "insufficient";
    }),
  );

  return { ...report, factors, outcomes };
}

function describePlainResult({
  cell,
  factorLabel,
  outcomeId,
  outcomeLabel,
  outcomeLagDays,
}: {
  cell: PersonalPatternCell;
  factorLabel: string;
  outcomeId: string;
  outcomeLabel: string;
  outcomeLagDays?: 0 | 1;
}): string {
  if (cell.deltaPercent === null || cell.direction === "flat") {
    return `No clear pattern was found between ${factorLabel.toLocaleLowerCase()} and ${formatSentenceTerm(
      outcomeLabel,
    )}.`;
  }

  const context =
    outcomeLagDays === 0
      ? `on days with ${factorLabel.toLocaleLowerCase()}`
      : `after ${factorLabel.toLocaleLowerCase()}`;
  const increased = cell.deltaPercent > 0;

  switch (outcomeId) {
    case "total-sleep":
      return `You slept ${increased ? "longer" : "less"} ${context}.`;
    case "sleep-score":
    case "sleep-efficiency":
      return `You slept ${increased ? "better" : "worse"} ${context}.`;
    case "deep-sleep":
      return `You got ${increased ? "more" : "less"} deep sleep ${context}.`;
    case "rem-sleep":
      return `You got ${increased ? "more" : "less"} REM sleep ${context}.`;
    case "readiness-score":
      return `Your readiness was ${increased ? "higher" : "lower"} ${context}.`;
    case "hrv":
      return `Your HRV was ${increased ? "higher" : "lower"} ${context}.`;
    case "resting-heart-rate":
      return `Your resting heart rate was ${
        increased ? "higher" : "lower"
      } ${context}.`;
    default:
      return `Your ${formatSentenceTerm(outcomeLabel)} was ${
        increased ? "higher" : "lower"
      } ${context}.`;
  }
}

type PatternEffectTone = "negative" | "neutral" | "positive";

function getPatternEffectTone(
  outcomeId: string,
  deltaPercent: number | null,
): PatternEffectTone {
  if (deltaPercent === null || deltaPercent === 0) return "neutral";

  if (outcomeId === "resting-heart-rate") {
    return deltaPercent < 0 ? "positive" : "negative";
  }

  if (
    outcomeId === "total-sleep" ||
    outcomeId === "sleep-score" ||
    outcomeId === "sleep-efficiency" ||
    outcomeId === "deep-sleep" ||
    outcomeId === "readiness-score" ||
    outcomeId === "hrv"
  ) {
    return deltaPercent > 0 ? "positive" : "negative";
  }

  return "neutral";
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
        )} similar comparison days averaged ${formatMean(
          cell.comparisonMean,
          unit,
        )}`;
  return `${exposed}. ${comparison}.`;
}

function formatEvidenceLabel(cell: PersonalPatternCell): string {
  const classification = formatClassificationLabel(cell);
  return cell.grade ? `${classification}, grade ${cell.grade}` : classification;
}

function formatClassificationLabel(cell: PersonalPatternCell): string {
  return cell.classification
    ? CLASSIFICATION_LABELS[cell.classification]
    : STAGE_LABELS[cell.stage];
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

function formatCaseCount(cases: number): string {
  return `${cases} recorded ${cases === 1 ? "case" : "cases"}`;
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
