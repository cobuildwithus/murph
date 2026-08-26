"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Beaker,
  Bike,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Dumbbell,
  Footprints,
  Moon,
  NotebookPen,
  RefreshCw,
  Stethoscope,
  Sun,
  Trees,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import type {
  JournalEvent,
  JournalView,
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
import { usePointerPopoverAnchor } from "@/src/components/ui/use-pointer-popover-anchor";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { cn } from "@/src/lib/utils";

const WEEK_DAY_COUNT = 7;

export interface JournalInsight {
  detail: string;
  href: string;
  id: string;
  label: "Early signal" | "Observation" | "Pattern";
  title: string;
}

export function JournalViewContent({
  asOfDate,
  insights = [],
  isRefreshing = false,
  isStale = false,
  journal,
  onRefresh,
}: {
  asOfDate?: string;
  insights?: JournalInsight[];
  isRefreshing?: boolean;
  isStale?: boolean;
  journal: JournalView;
  onRefresh?: () => void;
}) {
  const headingId = useId();
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);
  const latestWeekStart = startOfIsoWeek(today);
  const earliestWeekStart = journal.weeks.at(-1)?.startDate ?? latestWeekStart;
  const [selectedWeekStart, setSelectedWeekStart] = useState(latestWeekStart);
  const todayGreeting = useSyncExternalStore(
    subscribeToClock,
    currentGreeting,
    serverGreeting,
  );
  const daysByDate = useMemo(
    () => new Map(journal.days.map((day) => [day.date, day])),
    [journal.days],
  );
  const selectedDates = useMemo(
    () =>
      Array.from({ length: WEEK_DAY_COUNT }, (_, index) =>
        addDays(selectedWeekStart, index),
      ),
    [selectedWeekStart],
  );
  const visibleDates = useMemo(
    () => selectedDates.filter((date) => date <= today),
    [selectedDates, today],
  );
  const isFutureWeek = visibleDates.length === 0;
  const week =
    journal.weeks.find((entry) => entry.startDate === selectedWeekStart) ??
    null;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={isRefreshing}
      className="flex w-full flex-col gap-8 lg:gap-[2.125rem]"
    >
      <JournalPageHeader headingId={headingId}>
        {journal.days.length > 0 ? (
          <div className="flex items-center gap-2">
            {isRefreshing ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        aria-label="Updating latest data"
                        className="inline-flex size-8 items-center justify-center text-muted-foreground"
                        role="status"
                      >
                        <RefreshCw
                          aria-hidden="true"
                          className="size-3.5 animate-spin"
                        />
                      </span>
                    }
                  />
                  <TooltipContent>Updating latest data</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : isStale && onRefresh ? (
              <Button
                className="h-auto gap-1.5 px-0 text-xs"
                onClick={onRefresh}
                variant="link"
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                Refresh latest data
              </Button>
            ) : null}
            <WeekControls
              canGoNext={selectedWeekStart < latestWeekStart}
              canGoPrevious={selectedWeekStart > earliestWeekStart}
              onNext={() => setSelectedWeekStart(addDays(selectedWeekStart, 7))}
              onPrevious={() =>
                setSelectedWeekStart(addDays(selectedWeekStart, -7))
              }
              onToday={() => setSelectedWeekStart(latestWeekStart)}
            />
          </div>
        ) : null}
      </JournalPageHeader>

      {journal.days.length === 0 ? (
        <JournalEmptyState />
      ) : (
        <>
          <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_21.375rem] lg:gap-16">
            <section className="min-w-0" aria-label="Journal timeline">
              <div className="flex flex-col">
                {isFutureWeek ? (
                  <JournalFutureWeekState />
                ) : (
                  visibleDates.map((date) => (
                    <JournalDaySection
                      date={date}
                      events={daysByDate.get(date)?.events ?? []}
                      isToday={date === today}
                      key={date}
                      todayGreeting={todayGreeting}
                    />
                  ))
                )}
              </div>
            </section>

            <aside className="flex flex-col gap-[1.875rem] lg:sticky lg:top-6">
              <MiniCalendar
                onSelectDate={(date) =>
                  setSelectedWeekStart(startOfIsoWeek(date))
                }
                selectedWeekStart={selectedWeekStart}
                today={today}
              />
              <WeekStats week={week} />
              {insights.length > 0 ? (
                <WeeklyInsights insights={insights} />
              ) : null}
              <div className="flex items-start gap-[11px] px-1">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground">
                  <NotebookPen className="size-3" aria-hidden="true" />
                </span>
                <p className="text-xs leading-[19px] text-muted-foreground">
                  To add, correct, or remove an entry, tell Murph in your
                  private chat.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

export function JournalLoadingState() {
  const headingId = useId();
  return (
    <section
      aria-busy="true"
      aria-labelledby={headingId}
      className="flex w-full flex-col gap-8 lg:gap-[2.125rem]"
    >
      <JournalPageHeader headingId={headingId}>
        <span className="sr-only" role="status">
          Preparing your Journal
        </span>
      </JournalPageHeader>

      <section className="flex flex-col gap-4 border-b border-border pb-6 pt-5">
        <Skeleton className="h-4 w-20 motion-reduce:animate-none" />
        <Skeleton className="h-8 w-52 motion-reduce:animate-none" />
        <Skeleton className="h-5 w-full max-w-lg motion-reduce:animate-none" />
      </section>

      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_21.375rem] lg:gap-16">
        <div className="flex flex-col" aria-hidden="true">
          {[0, 1, 2, 3].map((day) => (
            <div
              className="grid gap-4 border-b border-border/70 py-[26px] first:pt-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-7"
              key={day}
            >
              <div className="flex gap-3 sm:flex-col sm:gap-2">
                <Skeleton className="h-4 w-20 motion-reduce:animate-none" />
                <Skeleton className="h-9 w-10 motion-reduce:animate-none" />
              </div>
              <div className="flex flex-col gap-4">
                <JournalEventSkeleton
                  width={day % 2 === 0 ? "wide" : "medium"}
                />
                {day < 2 ? <JournalEventSkeleton width="short" /> : null}
              </div>
            </div>
          ))}
        </div>
        <aside className="flex flex-col gap-8" aria-hidden="true">
          <Skeleton className="h-72 w-full rounded-xl motion-reduce:animate-none" />
          <div className="flex gap-8">
            <Skeleton className="h-14 flex-1 motion-reduce:animate-none" />
            <Skeleton className="h-14 flex-1 motion-reduce:animate-none" />
            <Skeleton className="h-14 flex-1 motion-reduce:animate-none" />
          </div>
        </aside>
      </div>
    </section>
  );
}

export function JournalErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <JournalStatusState
      actionLabel="Try again"
      description="Your private health timeline could not be opened. Your data is still safe."
      onAction={onRetry}
      title="Journal could not load"
      tone="error"
    />
  );
}

export function JournalUnavailableState({ onRetry }: { onRetry: () => void }) {
  return (
    <JournalStatusState
      actionLabel="Refresh Journal"
      description="Murph could not prepare this view from your latest health data."
      onAction={onRetry}
      title="Journal is not ready yet"
      tone="neutral"
    />
  );
}

function JournalPageHeader({
  children,
  headingId,
}: {
  children?: React.ReactNode;
  headingId: string;
}) {
  return (
    <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <h1
        id={headingId}
        className="font-serif text-[2.625rem] font-semibold leading-[2.875rem] tracking-[-0.025em] text-foreground"
      >
        Journal
      </h1>
      {children}
    </header>
  );
}

function JournalEventSkeleton({
  width,
}: {
  width: "medium" | "short" | "wide";
}) {
  const titleWidth =
    width === "short" ? "w-28" : width === "medium" ? "w-36" : "w-44";
  const detailWidth =
    width === "short" ? "w-40" : width === "medium" ? "w-56" : "w-72";
  return (
    <div className="grid grid-cols-[3.375rem_1.875rem_minmax(0,1fr)] items-start gap-x-3.5">
      <Skeleton className="mt-1 h-3 w-9 justify-self-end motion-reduce:animate-none" />
      <Skeleton className="size-[30px] rounded-full motion-reduce:animate-none" />
      <div className="flex flex-col gap-2 pt-0.5">
        <Skeleton
          className={cn("h-4 motion-reduce:animate-none", titleWidth)}
        />
        <Skeleton
          className={cn(
            "h-3 max-w-full motion-reduce:animate-none",
            detailWidth,
          )}
        />
      </div>
    </div>
  );
}

function JournalStatusState({
  actionLabel,
  description,
  onAction,
  title,
  tone,
}: {
  actionLabel: string;
  description: string;
  onAction: () => void;
  title: string;
  tone: "error" | "neutral";
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex w-full flex-col gap-8">
      <JournalPageHeader headingId={headingId} />
      <DashboardPageStatus
        actionLabel={actionLabel}
        description={description}
        onAction={onAction}
        title={title}
        tone={tone}
      />
    </section>
  );
}

function WeeklyInsights({ insights }: { insights: JournalInsight[] }) {
  return (
    <section aria-label="Weekly insights" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        {insights.map((insight) => (
          <Link
            className="group flex flex-col gap-3 rounded-xl bg-sage-soft p-[22px] transition-colors hover:bg-sage-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={insight.href}
            key={insight.id}
          >
            <span className="flex items-center justify-between gap-4">
              <span className="font-mono text-[10px] uppercase leading-[15px] tracking-[0.11em] text-primary">
                {insight.label}
              </span>
              <ArrowRight
                className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
            <span className="font-serif text-[22px] font-semibold leading-7 tracking-[-0.012em] text-foreground">
              {insight.title}
            </span>
            <span className="text-[13px] leading-5 text-foreground/80">
              {insight.detail}
            </span>
            <span className="text-[13px] font-semibold leading-[19px] text-primary">
              See evidence
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function JournalEmptyState() {
  return (
    <section className="max-w-xl rounded-2xl border border-border bg-card p-6 sm:p-8">
      <Moon className="size-8 text-primary" aria-hidden="true" />
      <h2 className="mt-5 font-serif text-2xl font-semibold tracking-tight text-foreground">
        Your timeline starts with one useful detail
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Tell Murph what happened, how you felt, or what context mattered. Sleep
        and activity from connected devices will appear automatically.
      </p>
    </section>
  );
}

function JournalFutureWeekState() {
  return (
    <section className="max-w-xl py-10">
      <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
        Nothing to show yet
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Journal will fill in as this week happens.
      </p>
    </section>
  );
}

function WeekControls({
  canGoNext,
  canGoPrevious,
  onNext,
  onPrevious,
  onToday,
}: {
  canGoNext: boolean;
  canGoPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onToday: () => void;
}) {
  return (
    <nav
      className="flex items-center gap-3"
      aria-label="Journal week navigation"
    >
      <Button
        aria-label="Previous week"
        disabled={!canGoPrevious}
        onClick={onPrevious}
        className="size-[38px] rounded-full"
        size="icon"
        variant="outline"
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button
        className="h-[38px] rounded-full px-[18px]"
        onClick={onToday}
        size="sm"
        variant="outline"
      >
        Today
      </Button>
      <Button
        aria-label="Next week"
        disabled={!canGoNext}
        onClick={onNext}
        className="size-[38px] rounded-full"
        size="icon"
        variant="outline"
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}

function JournalDaySection({
  date,
  events,
  isToday,
  todayGreeting,
}: {
  date: string;
  events: JournalEvent[];
  isToday: boolean;
  todayGreeting: string;
}) {
  const headingId = `journal-day-${date}`;
  const dayContext = describeDayContext(events);
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-4 border-b border-border/70 py-[26px] first:pt-2 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-7"
    >
      <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-0.5 sm:pt-0.5">
        <h2
          id={headingId}
          className={cn(
            "text-sm font-semibold leading-5 text-foreground",
            isToday && "text-primary",
          )}
        >
          {formatDayHeading(date)}
        </h2>
        <span
          className={cn(
            "font-serif text-[2.125rem] font-semibold leading-9 tracking-[-0.02em] text-foreground",
            isToday &&
              "flex size-10 items-center justify-center rounded-full bg-primary text-[1.5rem] text-primary-foreground",
          )}
        >
          {Number(date.slice(8, 10))}
        </span>
        <span className="font-mono text-[10px] uppercase leading-[15px] tracking-[0.1em] text-muted-foreground">
          {isToday
            ? ["Today", dayContext].filter(Boolean).join(" · ")
            : dayContext}
        </span>
      </div>

      <div className="min-w-0 pt-0.5">
        {events.length === 0 ? (
          isToday ? (
            <div className="flex items-center gap-2.5 py-1 text-sm text-muted-foreground">
              <Sun className="size-4 text-primary/70" aria-hidden="true" />
              <p>{todayGreeting}</p>
            </div>
          ) : (
            <p className="py-1 text-sm text-muted-foreground">
              Nothing recorded.
            </p>
          )
        ) : (
          <ol className="flex flex-col gap-[15px]">
            {events.map((event) => (
              <li key={event.id}>
                <JournalEventRow event={event} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function JournalEventRow({ event }: { event: JournalEvent }) {
  const pointerAnchor = usePointerPopoverAnchor();
  const sources = [
    ...new Set(
      event.records
        .map((record) => formatSource(record.source))
        .filter((source): source is string => source !== null),
    ),
  ];
  const summary =
    event.summary && normalizeText(event.summary) !== normalizeText(event.title)
      ? event.summary
      : null;
  const isConcern = event.kind === "symptom";
  const details = event.details.filter(
    (detail) =>
      !summary || !normalizeText(summary).includes(normalizeText(detail)),
  );
  const inlineDetails = event.kind === "sleep" ? [] : details;
  const hasDetails = details.length > 0 || sources.length > 0;
  const content = (
    <span className="block min-w-0">
      <span className="flex min-h-[30px] flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <span
          className={cn(
            "text-[15px] font-semibold leading-[21px] text-foreground",
            isConcern && "text-destructive",
          )}
        >
          {event.title}
        </span>
        {summary ? (
          <span className="text-sm leading-[21px] text-muted-foreground">
            {summary}
          </span>
        ) : null}
      </span>
      {inlineDetails.length > 0 ? (
        <span className="mt-[3px] block text-[13px] leading-[19px] text-muted-foreground">
          {inlineDetails.join(" · ")}
        </span>
      ) : null}
      {sources.length > 0 ? (
        <span className="sr-only">Source: {sources.join(", ")}</span>
      ) : null}
    </span>
  );

  return (
    <article className="group grid grid-cols-[3.375rem_1.875rem_minmax(0,1fr)] items-start gap-x-3.5">
      <time
        className="text-right font-mono text-[10px] uppercase leading-[30px] text-muted-foreground"
        dateTime={event.occurredAt}
      >
        {formatEventTime(event)}
      </time>
      <span
        className={cn(
          "flex size-[30px] items-center justify-center rounded-full bg-primary/10 text-primary",
          isConcern && "bg-destructive/10 text-destructive",
        )}
      >
        {renderEventIcon(event)}
      </span>
      {hasDetails ? (
        <Popover>
          <PopoverTrigger
            closeDelay={200}
            delay={150}
            openOnHover
            render={
              <button
                aria-label={`Show details for ${event.title}`}
                className="-mx-2 -my-1 min-w-0 rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onKeyDown={pointerAnchor.onKeyDown}
                onPointerMove={pointerAnchor.onPointerMove}
                type="button"
              >
                {content}
              </button>
            }
          />
          <JournalEventPopoverContent
            anchor={pointerAnchor.anchor}
            details={details}
            event={event}
            sources={sources}
          />
        </Popover>
      ) : (
        content
      )}
    </article>
  );
}

function JournalEventPopoverContent({
  anchor,
  details,
  event,
  sources,
}: {
  anchor: () => { getBoundingClientRect: () => DOMRect } | null;
  details: string[];
  event: JournalEvent;
  sources: string[];
}) {
  const sleepDetails =
    event.kind === "sleep" ? parseSleepPopoverDetails(event, details) : null;

  return (
    <PopoverContent
      align="center"
      anchor={anchor}
      className="w-[min(24rem,calc(100vw-2rem))]"
      positionMethod="fixed"
      side="right"
      sideOffset={12}
    >
      {sleepDetails ? (
        <SleepPopoverPresentation details={sleepDetails} />
      ) : (
        <GenericJournalPopoverPresentation details={details} event={event} />
      )}
      {sources.length > 0 ? (
        <>
          <Separator />
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Source: {sources.join(", ")}
          </p>
        </>
      ) : null}
    </PopoverContent>
  );
}

interface SleepPopoverMetric {
  description: string;
  label: string;
  value: string;
}

interface SleepPopoverDetails {
  duration: string | null;
  extraDetails: string[];
  metrics: SleepPopoverMetric[];
  score: string | null;
}

function SleepPopoverPresentation({
  details,
}: {
  details: SleepPopoverDetails;
}) {
  const primaryMetrics = [
    details.duration ? { label: "Total sleep", value: details.duration } : null,
    details.score ? { label: "Sleep score", value: details.score } : null,
  ].filter(
    (metric): metric is { label: string; value: string } => metric !== null,
  );

  return (
    <>
      <PopoverHeader className="gap-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Night sleep
        </p>
        <PopoverTitle className="sr-only">Sleep details</PopoverTitle>
      </PopoverHeader>
      {primaryMetrics.length > 0 ? (
        <dl className="grid grid-cols-2 gap-6">
          {primaryMetrics.map((metric) => (
            <div key={metric.label}>
              <dt className="text-xs leading-4 text-muted-foreground">
                {metric.label}
              </dt>
              <dd className="mt-1 font-serif text-[1.75rem] font-semibold leading-8 tracking-[-0.02em] text-foreground">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {details.metrics.length > 0 ? (
        <>
          <Separator />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            {details.metrics.map((metric) => (
              <div key={metric.label}>
                <dt className="text-xs font-medium leading-4 text-foreground">
                  {metric.label}
                </dt>
                <dd className="mt-1 font-serif text-xl font-semibold leading-6 text-foreground">
                  {metric.value}
                </dd>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {metric.description}
                </p>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {details.extraDetails.length > 0 ? (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            {details.extraDetails.map((detail) => (
              <p className="text-[13px] leading-5 text-foreground" key={detail}>
                {capitalizeDetail(detail)}
              </p>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function GenericJournalPopoverPresentation({
  details,
  event,
}: {
  details: string[];
  event: JournalEvent;
}) {
  return (
    <>
      <PopoverHeader className="gap-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          {event.timing === "night" ? "Night sleep" : "Journal entry"}
        </p>
        <PopoverTitle className="font-serif text-xl font-semibold leading-6">
          {event.title}
        </PopoverTitle>
        {event.summary ? (
          <PopoverDescription className="text-sm leading-5">
            {event.summary}
          </PopoverDescription>
        ) : null}
      </PopoverHeader>
      {details.length > 0 ? (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            {details.map((detail) => (
              <p className="text-[13px] leading-5 text-foreground" key={detail}>
                {capitalizeDetail(detail)}
              </p>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function MiniCalendar({
  onSelectDate,
  selectedWeekStart,
  today,
}: {
  onSelectDate: (date: string) => void;
  selectedWeekStart: string;
  today: string;
}) {
  const monthDate = addDays(selectedWeekStart, 3);
  const monthStart = `${monthDate.slice(0, 7)}-01`;
  const calendarStart = addDays(monthStart, -mondayIndex(monthStart));
  const calendarDayCount =
    Math.ceil((mondayIndex(monthStart) + daysInMonth(monthStart)) / 7) * 7;
  const dates = Array.from({ length: calendarDayCount }, (_, index) =>
    addDays(calendarStart, index),
  );
  const selectedWeekEnd = addDays(selectedWeekStart, 6);

  return (
    <section
      className="rounded-xl border border-border bg-card px-[22px] py-5"
      aria-label="Journal calendar"
    >
      <h2 className="font-serif text-[19px] font-semibold leading-6 text-foreground">
        {formatMonth(monthDate)}
      </h2>
      <div className="mt-3.5 grid grid-cols-7 gap-y-[5px] text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((label, index) => (
          <span
            className="font-mono text-[9px] uppercase leading-[14px] text-muted-foreground"
            key={`${label}-${index}`}
          >
            {label}
          </span>
        ))}
        {dates.map((date) => {
          const inMonth = date.slice(0, 7) === monthDate.slice(0, 7);
          const inSelectedWeek =
            date >= selectedWeekStart && date <= selectedWeekEnd;
          return (
            <button
              aria-current={date === today ? "date" : undefined}
              aria-label={formatDayAccessible(date)}
              className={cn(
                "flex h-[30px] w-full items-center justify-center text-[11px] text-foreground transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !inMonth && "text-muted-foreground",
                inSelectedWeek && "bg-primary/10",
                date === selectedWeekStart && "rounded-l-full",
                date === selectedWeekEnd && "rounded-r-full",
              )}
              key={date}
              onClick={() => onSelectDate(date)}
              type="button"
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full",
                  date === today &&
                    "bg-primary font-semibold text-primary-foreground",
                )}
              >
                {Number(date.slice(8, 10))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WeekStats({ week }: { week: JournalView["weeks"][number] | null }) {
  const stats: Array<{ label: string; value: string }> = [];
  if (
    week?.averageSleepMinutes !== null &&
    week?.averageSleepMinutes !== undefined
  ) {
    stats.push({
      label: "Average sleep",
      value: formatDuration(week.averageSleepMinutes),
    });
  }
  if (
    week?.averageSleepScore !== null &&
    week?.averageSleepScore !== undefined
  ) {
    stats.push({
      label: "Sleep score",
      value: String(Math.round(week.averageSleepScore)),
    });
  }
  if (week && week.activityMinutes > 0) {
    stats.push({
      label: "Activity",
      value: formatDuration(week.activityMinutes),
    });
  }

  if (stats.length === 0) return null;

  return (
    <section aria-label="Week at a glance">
      <dl className="grid grid-cols-3 gap-4 px-1">
        {stats.map((stat) => (
          <div className="flex min-w-0 flex-col" key={stat.label}>
            <dt className="order-2 mt-[3px] text-xs leading-[17px] text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="order-1 font-serif text-2xl font-semibold leading-7 tabular-nums text-foreground">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function renderEventIcon(event: JournalEvent) {
  const Icon = resolveEventIcon(event);
  return <Icon className="size-[15px] stroke-2" aria-hidden="true" />;
}

function resolveEventIcon(event: JournalEvent): LucideIcon {
  const value = `${event.kind} ${event.title}`.toLowerCase();
  if (event.kind === "sleep" || event.kind === "nap")
    return event.kind === "nap" ? Sun : Moon;
  if (event.kind === "test") return Beaker;
  if (event.kind === "meal") return Utensils;
  if (event.kind === "symptom") return CircleAlert;
  if (value.includes("tennis") || value.includes("strength")) return Dumbbell;
  if (value.includes("walk") || value.includes("hike")) return Footprints;
  if (value.includes("cycl")) return Bike;
  if (value.includes("yard") || value.includes("house work")) return Trees;
  if (event.kind === "activity") return Activity;
  if (event.kind === "observation") return Stethoscope;
  return NotebookPen;
}

function describeDayContext(events: JournalEvent[]): string {
  const context = events.find((event) => event.kind === "experiment_context");
  if (!context) return "";
  const label = context.summary?.split("·").at(0)?.trim();
  return label || context.title;
}

function formatEventTime(event: JournalEvent): string {
  if (event.timing === "night") return "Night";
  if (event.timing === "all_day") return "All day";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    ...(event.timeZone ? { timeZone: event.timeZone } : {}),
  }).format(new Date(event.occurredAt));
}

function formatDayHeading(date: string): string {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function formatDayAccessible(date: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function daysInMonth(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatMonth(date: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  if (hours === 0) return `${remaining} min`;
  if (remaining === 0) return `${hours} h`;
  return `${hours} h ${remaining}`;
}

function formatSource(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "oura") return "Oura";
  if (normalized === "manual" || normalized === "you") return "You";
  if (normalized === "apple-health") return "Apple Health";
  return value;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/gu, "");
}

function capitalizeDetail(value: string): string {
  return value.length === 0
    ? value
    : `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`;
}

function parseSleepPopoverDetails(
  event: JournalEvent,
  details: readonly string[],
): SleepPopoverDetails {
  const summaryParts = event.summary
    ? event.summary.split(" · ").map((part) => part.trim())
    : [];
  const scorePart = summaryParts.find((part) =>
    /^(?:sleep )?score\s+/iu.test(part),
  );
  const duration =
    summaryParts.find((part) => !/^(?:sleep )?score\s+/iu.test(part)) ?? null;
  const score = scorePart?.replace(/^(?:sleep )?score\s+/iu, "") ?? null;
  const metrics: SleepPopoverMetric[] = [];
  const extraDetails: string[] = [];

  for (const detail of details) {
    const efficiency = detail.match(/^([\d.]+)% efficiency$/iu);
    if (efficiency?.[1]) {
      metrics.push({
        description: "Time asleep while in bed",
        label: "Sleep efficiency",
        value: `${efficiency[1]}%`,
      });
      continue;
    }

    const hrv = detail.match(/^HRV ([\d.]+) ms$/iu);
    if (hrv?.[1]) {
      metrics.push({
        description: "Beat-to-beat variation",
        label: "HRV",
        value: `${hrv[1]} ms`,
      });
      continue;
    }

    const readiness = detail.match(/^readiness ([\d.]+)$/iu);
    if (readiness?.[1]) {
      metrics.push({
        description: "Recovery and strain score",
        label: "Readiness",
        value: readiness[1],
      });
      continue;
    }

    const recovery = detail.match(/^recovery ([\d.]+)$/iu);
    if (recovery?.[1]) {
      metrics.push({
        description: "Recovery and strain score",
        label: "Recovery",
        value: recovery[1],
      });
      continue;
    }

    const restingHeartRate = detail.match(/^resting HR ([\d.]+) bpm$/iu);
    if (restingHeartRate?.[1]) {
      metrics.push({
        description: "Beats per minute at rest",
        label: "Resting heart rate",
        value: `${restingHeartRate[1]} bpm`,
      });
      continue;
    }

    const deepSleep = detail.match(/^deep sleep ([\d.]+) min$/iu);
    if (deepSleep?.[1]) {
      metrics.push({
        description: "Slow-wave sleep",
        label: "Deep sleep",
        value: `${deepSleep[1]} min`,
      });
      continue;
    }

    const remSleep = detail.match(/^REM sleep ([\d.]+) min$/iu);
    if (remSleep?.[1]) {
      metrics.push({
        description: "Dream and memory sleep",
        label: "REM sleep",
        value: `${remSleep[1]} min`,
      });
      continue;
    }

    const respiratoryRate = detail.match(
      /^respiratory rate ([\d.]+) breaths\/min$/iu,
    );
    if (respiratoryRate?.[1]) {
      metrics.push({
        description: "Breaths per minute during sleep",
        label: "Respiratory rate",
        value: respiratoryRate[1],
      });
      continue;
    }

    const spo2 = detail.match(/^SpO₂ ([\d.]+)%$/iu);
    if (spo2?.[1]) {
      metrics.push({
        description: "Average blood oxygen",
        label: "SpO₂",
        value: `${spo2[1]}%`,
      });
      continue;
    }

    extraDetails.push(detail);
  }

  return { duration, extraDetails, metrics, score };
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

function subscribeToClock(onChange: () => void): () => void {
  const interval = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(interval);
}

function currentGreeting(): string {
  return greetingForHour(new Date().getHours());
}

function serverGreeting(): string {
  return "Welcome back.";
}

function startOfIsoWeek(date: string): string {
  return addDays(date, -mondayIndex(date));
}

function mondayIndex(date: string): number {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
