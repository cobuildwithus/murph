"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { JOURNAL_ICON_ASSETS, readJournalIcon } from "@murphai/contracts/journal-presentation";
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
  MessageCircle,
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
import {
  type MurphContactOption,
  withMurphContactOptionBody,
} from "@/src/lib/murph-contact-routing";

import { DashboardPageStatus } from "@/src/components/dashboard/dashboard-page-status";
import { Button } from "@/src/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/src/components/ui/drawer";
import {
  Popover,
  PopoverContent,
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

const JOURNAL_WINDOW_DAYS = 7;

export interface JournalInsight {
  date: string;
  detail: string;
  href: string;
  id: string;
  label: "Early signal" | "Observation" | "Pattern";
  title: string;
}

export function JournalViewContent({
  asOfDate,
  contactOptions = [],
  insights = [],
  isRefreshing = false,
  journal,
}: {
  asOfDate?: string;
  contactOptions?: readonly MurphContactOption[];
  insights?: JournalInsight[];
  isRefreshing?: boolean;
  journal: JournalView;
}) {
  const headingId = useId();
  const localToday = useSyncExternalStore(
    subscribeToClock,
    currentLocalDate,
    serverCurrentDate,
  );
  const today = asOfDate ?? localToday;
  const latestWindowEnd = today;
  const earliestDate = journal.days.at(-1)?.date ?? latestWindowEnd;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedWindowEnd = minDate(selectedDate ?? today, today);
  const selectDate = (date: string) => setSelectedDate(date >= today ? null : date);
  const todayGreeting = useSyncExternalStore(
    subscribeToClock,
    currentGreeting,
    serverGreeting,
  );
  const daysByDate = useMemo(
    () => new Map(journal.days.map((day) => [day.date, day])),
    [journal.days],
  );
  const sleepBaselines = useMemo(
    () => buildSleepMetricBaselines(journal.days),
    [journal.days],
  );
  const selectedWindowStart = addDays(
    selectedWindowEnd,
    -(JOURNAL_WINDOW_DAYS - 1),
  );
  const selectedDates = useMemo(
    () =>
      Array.from({ length: JOURNAL_WINDOW_DAYS }, (_, index) =>
        addDays(selectedWindowStart, index),
      ),
    [selectedWindowStart],
  );
  const visibleDates = useMemo(
    () => [...selectedDates].reverse(),
    [selectedDates],
  );
  const visibleInsights = insights.filter(
    (insight) =>
      insight.date >= selectedWindowStart && insight.date <= selectedWindowEnd,
  );

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={isRefreshing}
      className="flex w-full flex-col gap-8 lg:gap-[2.125rem]"
    >
      <JournalPageHeader headingId={headingId}>
        <div className="flex flex-wrap items-center justify-end gap-2">
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
                        className="size-3.5 animate-spin motion-reduce:animate-none"
                      />
                    </span>
                  }
                />
                <TooltipContent>Updating latest data</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {journal.days.length > 0 ? (
            <WeekControls
              canGoNext={selectedWindowEnd < latestWindowEnd}
              canGoPrevious={selectedWindowStart > earliestDate}
              earliestDate={earliestDate}
              onNext={() =>
                selectDate(addDays(selectedWindowEnd, JOURNAL_WINDOW_DAYS))
              }
              onPrevious={() =>
                selectDate(addDays(selectedWindowEnd, -JOURNAL_WINDOW_DAYS))
              }
              onSelectDate={selectDate}
              onToday={() => setSelectedDate(null)}
              selectedWindowEnd={selectedWindowEnd}
              selectedWindowStart={selectedWindowStart}
              today={today}
            />
          ) : null}
        </div>
      </JournalPageHeader>

      {journal.days.length === 0 ? (
        <JournalEmptyState contactOptions={contactOptions} />
      ) : (
        <>
          <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_21.375rem] lg:gap-16">
            <section className="min-w-0" aria-label="Journal timeline">
              <WindowStats
                className="border-y border-border/70 py-4 lg:hidden"
                dates={selectedDates}
                daysByDate={daysByDate}
                mode="mobile"
                today={today}
              />
              <div className="mt-4 flex flex-col lg:mt-0">
                {visibleDates.map((date) => (
                  <JournalDaySection
                    date={date}
                    events={daysByDate.get(date)?.events ?? []}
                    isToday={date === today}
                    key={date}
                    sleepBaselines={sleepBaselines}
                    todayGreeting={todayGreeting}
                  />
                ))}
              </div>
            </section>

            <aside className="flex flex-col gap-[1.875rem] lg:sticky lg:top-6">
              <div className="hidden lg:block">
                <MiniCalendar
                  earliestDate={earliestDate}
                  key={selectedWindowEnd.slice(0, 7)}
                  onSelectDate={selectDate}
                  selectedWindowEnd={selectedWindowEnd}
                  today={today}
                />
              </div>
              <WindowStats
                className="hidden lg:block"
                dates={selectedDates}
                daysByDate={daysByDate}
                mode="desktop"
                today={today}
              />
              {visibleInsights.length > 0 ? (
                <WeeklyInsights insights={visibleInsights} />
              ) : null}
              <JournalEntryActions contactOptions={contactOptions} />
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
    <header className="flex items-center justify-between gap-2 sm:gap-4 sm:items-end">
      <h1
        id={headingId}
        className="shrink-0 font-serif text-3xl font-semibold tracking-tight text-foreground"
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
      <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground lg:hidden">
        From these 7 days
      </h2>
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

function JournalEmptyState({
  contactOptions,
}: {
  contactOptions: readonly MurphContactOption[];
}) {
  const journalHelpOptions = contactOptions.map((option) =>
    withMurphContactOptionBody(
      option,
      "Tell me more about what I can log in Journal.",
    ),
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card sm:grid sm:grid-cols-[1.15fr_0.85fr]">
      <div className="p-7 sm:p-10">
        <Moon className="size-8 text-primary" aria-hidden="true" />
        <h2 className="mt-5 max-w-md font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Build your health timeline
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
          Journal brings together sleep, activity, and the details you share
          with Murph.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            className="rounded-full"
            nativeButton={false}
            render={<Link href="/connect" />}
          >
            Connect a device
            <ArrowRight aria-hidden="true" />
          </Button>
          {journalHelpOptions.length > 0 ? (
            <Popover>
              <PopoverTrigger
                render={
                  <Button className="rounded-full" variant="outline">
                    Talk to Murph
                  </Button>
                }
              />
              <PopoverContent className="w-[min(19rem,calc(100vw-2rem))] p-2">
                <div className="flex flex-col gap-1">
                  {journalHelpOptions.map((option) => (
                    <a
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={option.href}
                      key={option.kind}
                      rel={option.rel}
                      target={option.target}
                    >
                      <MessageCircle
                        aria-hidden="true"
                        className="size-4 text-primary"
                      />
                      Continue in {option.label}
                    </a>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>
      <div className="border-t border-border bg-muted/20 p-7 sm:border-l sm:border-t-0 sm:p-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Your Journal can include
        </p>
        <ul className="mt-5 space-y-5 text-sm text-foreground">
          <li className="flex items-center gap-3">
            <Moon className="size-5 text-primary" aria-hidden="true" />
            Sleep and recovery
          </li>
          <li className="flex items-center gap-3">
            <Activity className="size-5 text-primary" aria-hidden="true" />
            Workouts and daily activity
          </li>
          <li className="flex items-center gap-3">
            <NotebookPen className="size-5 text-primary" aria-hidden="true" />
            Context from your conversations
          </li>
        </ul>
      </div>
    </section>
  );
}

function WeekControls({
  canGoNext,
  canGoPrevious,
  earliestDate,
  onNext,
  onPrevious,
  onSelectDate,
  onToday,
  selectedWindowEnd,
  selectedWindowStart,
  today,
}: {
  canGoNext: boolean;
  canGoPrevious: boolean;
  earliestDate: string;
  onNext: () => void;
  onPrevious: () => void;
  onSelectDate: (date: string) => void;
  onToday: () => void;
  selectedWindowEnd: string;
  selectedWindowStart: string;
  today: string;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const windowLabel = formatJournalWindowLabel(
    selectedWindowStart,
    selectedWindowEnd,
    today,
  );

  return (
    <nav
      className="flex items-center gap-1 lg:gap-3"
      aria-label="Journal seven-day navigation"
    >
      <Button
        aria-label="Previous 7 days"
        disabled={!canGoPrevious}
        onClick={onPrevious}
        className="size-10 rounded-full"
        size="icon"
        variant="outline"
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Drawer open={calendarOpen} onOpenChange={setCalendarOpen}>
        <DrawerTrigger asChild>
          <Button
            aria-label={`Choose a Journal date. Showing ${windowLabel}`}
            className="h-10 max-w-24 whitespace-normal rounded-full px-2.5 text-xs leading-tight lg:hidden"
            size="sm"
            variant="outline"
          >
            {windowLabel}
          </Button>
        </DrawerTrigger>
        <DrawerContent className="overflow-y-auto overscroll-contain data-[vaul-drawer-direction=bottom]:max-h-[85dvh] data-[vaul-drawer-direction=bottom]:rounded-t-2xl">
          <DrawerTitle className="sr-only">Choose a Journal date</DrawerTitle>
          <div className="flex flex-col gap-4 px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-3">
            <MiniCalendar
              earliestDate={earliestDate}
              key={`${selectedWindowEnd.slice(0, 7)}-${calendarOpen}`}
              onSelectDate={(date) => {
                onSelectDate(date);
                setCalendarOpen(false);
              }}
              selectedWindowEnd={selectedWindowEnd}
              surface="drawer"
              today={today}
            />
            {selectedWindowEnd !== today ? (
              <Button
                className="w-full rounded-full"
                onClick={() => {
                  onToday();
                  setCalendarOpen(false);
                }}
                variant="outline"
              >
                Return to today
              </Button>
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>
      <Button
        className="hidden h-10 rounded-full px-[18px] lg:inline-flex"
        onClick={onToday}
        size="sm"
        variant="outline"
      >
        Today
      </Button>
      <Button
        aria-label="Next 7 days"
        disabled={!canGoNext}
        onClick={onNext}
        className="size-10 rounded-full"
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
  sleepBaselines,
  todayGreeting,
}: {
  date: string;
  events: JournalEvent[];
  isToday: boolean;
  sleepBaselines: SleepMetricBaselines;
  todayGreeting: string;
}) {
  const headingId = `journal-day-${date}`;
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-4 border-b border-border/70 py-[26px] first:pt-2 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-7"
    >
      <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-0.5 sm:pt-0.5">
        <h2
          id={headingId}
          className={cn(
            "text-[11px] font-semibold leading-4 text-foreground sm:text-sm sm:leading-5",
            isToday && "text-primary",
          )}
        >
          {formatDayHeading(date)}
        </h2>
        <span
          className={cn(
            "font-serif text-2xl font-semibold leading-7 tracking-[-0.02em] text-foreground sm:text-[2.125rem] sm:leading-9",
            isToday &&
              "flex size-[34px] items-center justify-center rounded-full bg-primary text-lg text-primary-foreground sm:size-10 sm:text-2xl",
          )}
        >
          {Number(date.slice(8, 10))}
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
                <JournalEventRow
                  event={event}
                  sleepBaselines={sleepBaselines}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function JournalEventRow({
  event,
  sleepBaselines,
}: {
  event: JournalEvent;
  sleepBaselines: SleepMetricBaselines;
}) {
  const pointerAnchor = usePointerPopoverAnchor();
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const sources = [
    ...new Set(
      event.records
        .map((record) => formatSource(record.source))
        .filter((source): source is string => source !== null),
    ),
  ];
  const visibleSources = normalizeEventSources(sources);
  const summary =
    event.summary && normalizeText(event.summary) !== normalizeText(event.title)
      ? event.summary
      : null;
  const sleepScore = event.kind === "sleep" ? event.metrics.sleepScore : null;
  const isConcern =
    event.kind === "symptom" || (sleepScore !== null && sleepScore < 70);
  const details = event.details.filter(
    (detail) =>
      !summary || !normalizeText(summary).includes(normalizeText(detail)),
  );
  const inlineDetails: string[] = [];
  const hasDetails = event.kind === "sleep" || details.length > 0;
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
      {visibleSources.length > 0 ? (
        <span className="sr-only">From {visibleSources.join(", ")}</span>
      ) : null}
    </span>
  );

  return (
    <article className="group grid grid-cols-[3.375rem_1.875rem_minmax(0,1fr)] items-start gap-x-3.5">
      <time
        className={cn(
          "text-right font-mono text-[10px] uppercase leading-[30px] text-muted-foreground",
          event.timing === "all_day" && "text-muted-foreground",
        )}
        dateTime={event.timing === "timed" ? event.occurredAt : event.date}
        aria-label={event.timing === "unknown" ? "Time not specified" : undefined}
      >
        {formatEventTime(event)}
      </time>
      <span
        className={cn(
          "flex size-[30px] items-center justify-center rounded-full bg-primary/10 text-primary",
          event.timing === "all_day" &&
            !isConcern &&
            "bg-muted text-foreground/70",
          isConcern && "bg-destructive/10 text-destructive",
        )}
      >
        {renderEventIcon(event)}
      </span>
      {hasDetails ? (
        <>
          <div className="md:hidden">
            <Drawer
              open={mobileDetailsOpen}
              onOpenChange={setMobileDetailsOpen}
            >
              <DrawerTrigger asChild>
                <button
                  aria-expanded={mobileDetailsOpen}
                  aria-haspopup="dialog"
                  aria-label={`Show details for ${event.title}`}
                  className="-mx-2 -my-1 w-fit max-w-full min-w-0 justify-self-start rounded-lg px-2 py-1 text-left transition-colors active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-journal-detail-trigger="mobile"
                  onClick={() => setMobileDetailsOpen(true)}
                  type="button"
                >
                  <JournalEventDetailTrigger content={content} />
                </button>
              </DrawerTrigger>
              <DrawerContent className="overflow-y-auto overscroll-contain data-[vaul-drawer-direction=bottom]:max-h-[85dvh] data-[vaul-drawer-direction=bottom]:rounded-t-2xl">
                <DrawerTitle className="sr-only">
                  {event.title} details
                </DrawerTitle>
                <div className="flex shrink-0 flex-col gap-3 px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-3">
                  <JournalEventDetailContent
                    details={details}
                    event={event}
                    sleepBaselines={sleepBaselines}
                    sources={visibleSources}
                  />
                </div>
              </DrawerContent>
            </Drawer>
          </div>
          <div className="hidden md:block">
            <Popover>
              <PopoverTrigger
                closeDelay={200}
                delay={150}
                openOnHover
                render={
                  <button
                    aria-label={`Show details for ${event.title}`}
                    className="-mx-2 -my-1 w-fit max-w-full min-w-0 justify-self-start rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-journal-detail-trigger="desktop"
                    onKeyDown={pointerAnchor.onKeyDown}
                    onPointerMove={pointerAnchor.onPointerMove}
                    type="button"
                  >
                    <JournalEventDetailTrigger content={content} />
                  </button>
                }
              />
              <JournalEventPopoverContent
                anchor={pointerAnchor.anchor}
                details={details}
                event={event}
                sleepBaselines={sleepBaselines}
                sources={visibleSources}
              />
            </Popover>
          </div>
        </>
      ) : (
        content
      )}
    </article>
  );
}

function JournalEventDetailTrigger({ content }: { content: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      {content}
      <ChevronRight
        aria-hidden="true"
        className="mt-[7px] size-3.5 shrink-0 text-muted-foreground/45 transition-colors group-hover:text-muted-foreground"
      />
    </span>
  );
}

function JournalEventDetailContent({
  details,
  event,
  sleepBaselines,
  sources,
}: {
  details: string[];
  event: JournalEvent;
  sleepBaselines: SleepMetricBaselines;
  sources: string[];
}) {
  const sleepDetails =
    event.kind === "sleep" ? parseSleepPopoverDetails(event, details) : null;
  const detailHref = journalEventDetailHref(event);

  return (
    <>
      {sleepDetails ? (
        <SleepPopoverPresentation
          details={sleepDetails}
          sleepBaselines={sleepBaselines}
        />
      ) : (
        <GenericJournalPopoverPresentation details={details} event={event} />
      )}
      {detailHref ? (
        <Button
          className="w-fit rounded-full"
          nativeButton={false}
          render={<Link href={detailHref.href} />}
          size="sm"
          variant="outline"
        >
          {detailHref.label}
          <ArrowRight aria-hidden="true" />
        </Button>
      ) : null}
      {sources.length > 0 ? (
        <>
          <Separator />
          <p className="text-xs text-muted-foreground">{sources[0]}</p>
        </>
      ) : null}
    </>
  );
}

function JournalEventPopoverContent({
  anchor,
  details,
  event,
  sleepBaselines,
  sources,
}: {
  anchor: () => { getBoundingClientRect: () => DOMRect } | null;
  details: string[];
  event: JournalEvent;
  sleepBaselines: SleepMetricBaselines;
  sources: string[];
}) {
  return (
    <PopoverContent
      align="center"
      anchor={anchor}
      className="w-[min(30rem,calc(100vw-2rem))]"
      positionMethod="fixed"
      side="right"
      sideOffset={12}
    >
      <JournalEventDetailContent
        details={details}
        event={event}
        sleepBaselines={sleepBaselines}
        sources={sources}
      />
    </PopoverContent>
  );
}

function journalEventDetailHref(
  event: JournalEvent,
): { href: string; label: string } | null {
  if (event.kind === "experiment_context") {
    return { href: "/experiments", label: "View experiment" };
  }
  if (event.kind === "test") {
    return { href: "/biomarkers", label: "View results" };
  }
  if (
    event.kind === "note" &&
    event.title.toLowerCase().includes("bedroom temperature")
  ) {
    return { href: "/environment", label: "View environment" };
  }
  if (event.kind === "note" && event.title.toLowerCase().includes("joined")) {
    return { href: "/groups", label: "View group" };
  }
  return null;
}

interface SleepPopoverMetric {
  description: string;
  label: string;
  numericValue: number;
  value: string;
}

interface SleepPopoverDetails {
  duration: string | null;
  durationMinutes: number | null;
  extraDetails: string[];
  metrics: SleepPopoverMetric[];
  score: string | null;
  scoreValue: number | null;
}

type SleepMetricBaselines = Map<string, number[]>;

type SleepMetricDirection = "higher" | "lower" | "neutral";

interface SleepMetricContext {
  tone: "favorable" | "neutral" | "unfavorable";
}

function SleepPopoverPresentation({
  details,
  sleepBaselines,
}: {
  details: SleepPopoverDetails;
  sleepBaselines: SleepMetricBaselines;
}) {
  const primaryMetrics = [
    details.duration && details.durationMinutes !== null
      ? {
          label: "Total sleep",
          numericValue: details.durationMinutes,
          value: details.duration,
        }
      : null,
    details.score && details.scoreValue !== null
      ? {
          label: "Sleep score",
          numericValue: details.scoreValue,
          value: details.score,
        }
      : null,
  ].filter(
    (
      metric,
    ): metric is { label: string; numericValue: number; value: string } =>
      metric !== null,
  );

  return (
    <TooltipProvider>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Night sleep
        </p>
      </div>
      {primaryMetrics.length > 0 ? (
        <dl className="grid grid-cols-2 gap-6">
          {primaryMetrics.map((metric) => (
            <SleepMetricValue
              description={
                metric.label === "Total sleep"
                  ? "How long you slept during the main sleep period."
                  : "Your device's overall rating of that night's sleep."
              }
              key={metric.label}
              label={metric.label}
              numericValue={metric.numericValue}
              sleepBaselines={sleepBaselines}
              value={metric.value}
              variant="primary"
            />
          ))}
        </dl>
      ) : null}
      {details.metrics.length > 0 ? (
        <>
          <Separator />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            {details.metrics.map((metric) => (
              <SleepMetricValue
                description={metric.description}
                key={metric.label}
                label={metric.label}
                numericValue={metric.numericValue}
                sleepBaselines={sleepBaselines}
                value={metric.value}
              />
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
    </TooltipProvider>
  );
}

function SleepMetricValue({
  description,
  label,
  numericValue,
  sleepBaselines,
  value,
  variant = "detail",
}: {
  description: string;
  label: string;
  numericValue: number;
  sleepBaselines: SleepMetricBaselines;
  value: string;
  variant?: "detail" | "primary";
}) {
  const context = getSleepMetricContext(label, numericValue, sleepBaselines);

  return (
    <div>
      <SleepMetricLabel description={description} label={label} />
      <dd
        className={cn(
          "mt-1 inline-flex font-serif font-semibold tracking-[-0.02em] text-foreground",
          variant === "primary" ? "text-xl leading-6" : "text-base leading-5",
          sleepMetricToneClass(context),
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
              >
                {value}
              </button>
            }
          />
          <TooltipContent className="max-w-56 leading-4">
            {description}
          </TooltipContent>
        </Tooltip>
      </dd>
    </div>
  );
}

function sleepMetricToneClass(context: SleepMetricContext | null): string {
  if (!context || context.tone === "neutral") return "text-foreground";
  if (context.tone === "favorable") return "text-primary";
  return "text-red-700 dark:text-red-300";
}

function SleepMetricLabel({
  description,
  label,
}: {
  description: string;
  label: string;
}) {
  return (
    <dt className="text-xs leading-4 text-muted-foreground">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
            >
              {label}
            </button>
          }
        />
        <TooltipContent className="max-w-56 leading-4">
          {description}
        </TooltipContent>
      </Tooltip>
    </dt>
  );
}

function GenericJournalPopoverPresentation({
  details,
  event,
}: {
  details: string[];
  event: JournalEvent;
}) {
  const structuredDetails = details
    .map(parseJournalDetail)
    .filter(
      (detail): detail is { label: string; value: string } => detail !== null,
    );
  const textDetails = details.filter(
    (detail) => parseJournalDetail(detail) === null,
  );

  return (
    <>
      <div className="flex flex-col gap-1">
        {event.timing === "night" ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
            Night sleep
          </p>
        ) : null}
        <h2 className="font-serif text-xl font-semibold leading-6">
          {event.title}
        </h2>
      </div>
      {structuredDetails.length > 0 ? (
        <>
          <Separator />
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {structuredDetails.map((detail, index) => (
              <div
                className={cn(
                  structuredDetails.length % 2 === 1 &&
                    index === structuredDetails.length - 1 &&
                    "sm:col-span-2",
                )}
                key={`${detail.label}:${detail.value}`}
              >
                <dt className="text-xs leading-4 text-muted-foreground">
                  {detail.label}
                </dt>
                {detail.label === "Exercises" ? (
                  <dd className="mt-2">
                    <ul className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm font-medium leading-5 text-foreground sm:grid-cols-2">
                      {detail.value.split(",").map((exercise) => (
                        <li key={exercise.trim()}>{exercise.trim()}</li>
                      ))}
                    </ul>
                  </dd>
                ) : (
                  <dd className="mt-1 text-sm font-medium leading-5 text-foreground">
                    {detail.value}
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {textDetails.length > 0 ? (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            {textDetails.map((detail) => (
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
  earliestDate,
  onSelectDate,
  selectedWindowEnd,
  surface = "card",
  today,
}: {
  earliestDate: string;
  onSelectDate: (date: string) => void;
  selectedWindowEnd: string;
  surface?: "card" | "drawer";
  today: string;
}) {
  const selectedMonth = `${selectedWindowEnd.slice(0, 7)}-01`;
  const [monthDate, setMonthDate] = useState(selectedMonth);

  const monthStart = `${monthDate.slice(0, 7)}-01`;
  const calendarStart = addDays(monthStart, -mondayIndex(monthStart));
  const calendarDayCount =
    Math.ceil((mondayIndex(monthStart) + daysInMonth(monthStart)) / 7) * 7;
  const dates = Array.from({ length: calendarDayCount }, (_, index) =>
    addDays(calendarStart, index),
  );
  const selectedWindowStart = addDays(
    selectedWindowEnd,
    -(JOURNAL_WINDOW_DAYS - 1),
  );
  const canShowPreviousMonth = monthDate.slice(0, 7) > earliestDate.slice(0, 7);
  const canShowNextMonth = monthDate.slice(0, 7) < today.slice(0, 7);

  return (
    <section
      className={cn(
        surface === "card" &&
          "rounded-xl border border-border bg-card px-[22px] py-5",
      )}
      aria-label="Journal calendar"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-[19px] font-semibold leading-6 text-foreground">
          {formatMonth(monthDate)}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Previous month"
            className={cn(
              "rounded-full",
              surface === "drawer" ? "size-11" : "size-10",
            )}
            disabled={!canShowPreviousMonth}
            onClick={() => setMonthDate((current) => shiftMonth(current, -1))}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            aria-label="Next month"
            className={cn(
              "rounded-full",
              surface === "drawer" ? "size-11" : "size-10",
            )}
            disabled={!canShowNextMonth}
            onClick={() => setMonthDate((current) => shiftMonth(current, 1))}
            size="icon"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
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
          const inSelectedWindow =
            date >= selectedWindowStart && date <= selectedWindowEnd;
          const isBeforeHistory = date < earliestDate;
          const isFutureDate = date > today;
          const isUnavailable = isBeforeHistory || isFutureDate;
          return (
            <button
              aria-current={date === today ? "date" : undefined}
              aria-label={formatDayAccessible(date)}
              aria-pressed={date === selectedWindowEnd}
              className={cn(
                "flex min-h-10 w-full items-center justify-center text-[11px] text-foreground transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !inMonth && "text-muted-foreground",
                inSelectedWindow && "bg-primary/10",
                date === selectedWindowStart && "rounded-l-full",
                date === selectedWindowEnd && "rounded-r-full",
                isUnavailable &&
                  "cursor-default opacity-35 hover:bg-transparent",
              )}
              disabled={isUnavailable}
              key={date}
              onClick={() => onSelectDate(date)}
              type="button"
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full",
                  date === selectedWindowEnd
                    ? "bg-primary font-semibold text-primary-foreground"
                    : date === today && "font-semibold ring-1 ring-primary",
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

interface WeekStat {
  label: string;
  popoverTitle: string;
  points: Array<{ date: string; value: number }>;
  valueFormatter: (value: number) => string;
  value: string;
}

function WindowStats({
  className,
  dates,
  daysByDate,
  mode,
  today,
}: {
  className?: string;
  dates: string[];
  daysByDate: Map<string, JournalView["days"][number]>;
  mode: "desktop" | "mobile";
  today: string;
}) {
  const stats: WeekStat[] = [];
  const sleepMinutes = buildWeekMetricPoints(
    dates,
    daysByDate,
    "sleep-duration",
  );
  const sleepScores = buildWeekMetricPoints(dates, daysByDate, "sleep-score");
  const activityMinutes = buildWeekMetricPoints(dates, daysByDate, "activity");
  if (sleepMinutes.length > 0) {
    stats.push({
      label: "Sleep time",
      popoverTitle: "Avg sleep time",
      points: sleepMinutes,
      valueFormatter: (value) => formatDuration(Math.round(value)),
      value: formatDuration(averageMetric(sleepMinutes)),
    });
  }
  if (sleepScores.length > 0) {
    stats.push({
      label: "Sleep score",
      popoverTitle: "Avg sleep score",
      points: sleepScores,
      valueFormatter: (value) => String(Math.round(value)),
      value: String(averageMetric(sleepScores)),
    });
  }
  if (activityMinutes.length > 0) {
    stats.push({
      label: "Activity",
      popoverTitle: "Total activity time",
      points: activityMinutes,
      valueFormatter: (value) => formatDuration(Math.round(value)),
      value: formatDuration(
        activityMinutes.reduce((total, point) => total + point.value, 0),
      ),
    });
  }

  if (stats.length === 0) return null;

  return (
    <section aria-label="Seven days at a glance" className={className}>
      <p className="mb-3 px-1 font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
        {dates.at(-1) === today
          ? "Last 7 days"
          : formatJournalWindowLabel(dates[0], dates[dates.length - 1], today)}
      </p>
      <div className="grid grid-cols-3 gap-4 px-1">
        {stats.map((stat) => (
          <WeekStatDetails key={stat.label} mode={mode} stat={stat} />
        ))}
      </div>
    </section>
  );
}

function JournalEntryActions({
  contactOptions,
}: {
  contactOptions: readonly MurphContactOption[];
}) {
  const helper = (
    <span className="flex items-center gap-[11px] px-1 text-left">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground">
        <NotebookPen className="size-3" aria-hidden="true" />
      </span>
      <span className="text-xs leading-[19px] text-muted-foreground">
        Update your journal in private chat with Murph.
      </span>
    </span>
  );

  if (contactOptions.length === 0) return <div>{helper}</div>;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className="rounded-md transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            type="button"
          >
            {helper}
          </button>
        }
      />
      <PopoverContent
        align="end"
        className="w-[min(19rem,calc(100vw-2rem))] p-2"
        side="top"
        sideOffset={8}
      >
        <div className="flex flex-col gap-1">
          {contactOptions.map((option) => {
            const Icon =
              option.kind === "telegram" ? MessageCircle : NotebookPen;
            return (
              <a
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={option.href}
                key={option.kind}
                rel={option.rel}
                target={option.target}
              >
                <Icon className="size-4 text-primary" aria-hidden="true" />
                Message in {option.label}
              </a>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function WeekStatDetails({
  mode,
  stat,
}: {
  mode: "desktop" | "mobile";
  stat: WeekStat;
}) {
  if (mode === "mobile") {
    return (
      <Drawer>
        <DrawerTrigger asChild>
          <WeekStatButton stat={stat} />
        </DrawerTrigger>
        <DrawerContent className="overflow-y-auto overscroll-contain data-[vaul-drawer-direction=bottom]:max-h-[85dvh] data-[vaul-drawer-direction=bottom]:rounded-t-2xl">
          <DrawerTitle className="px-5 pt-3 font-serif text-xl font-semibold">
            {stat.popoverTitle}
          </DrawerTitle>
          <div className="px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4">
            <WeekMetricLineChart
              label={stat.label}
              points={stat.points}
              valueFormatter={stat.valueFormatter}
            />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return <WeekStatPopover stat={stat} />;
}

function WeekStatButton({
  className,
  stat,
  ...props
}: { stat: WeekStat } & React.ComponentProps<"button">) {
  return (
    <button
      {...props}
      aria-label={`Show ${stat.popoverTitle.toLowerCase()} details`}
      className={cn(
        "flex min-w-0 flex-col rounded-md text-left transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      type="button"
    >
      <span className="order-2 mt-[3px] text-xs leading-[17px] text-muted-foreground">
        {stat.label}
      </span>
      <span className="order-1 font-serif text-xl font-semibold leading-6 tabular-nums text-foreground sm:text-2xl sm:leading-7">
        {stat.value}
      </span>
    </button>
  );
}

function WeekStatPopover({ stat }: { stat: WeekStat }) {
  const pointerAnchor = usePointerPopoverAnchor();

  return (
    <Popover>
      <PopoverTrigger
        closeDelay={200}
        delay={120}
        openOnHover
        render={
          <button
            aria-label={`Show ${stat.popoverTitle.toLowerCase()} details`}
            className="flex min-w-0 flex-col rounded-md text-left transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onKeyDown={pointerAnchor.onKeyDown}
            onPointerMove={pointerAnchor.onPointerMove}
            type="button"
          >
            <span className="order-2 mt-[3px] text-xs leading-[17px] text-muted-foreground">
              {stat.label}
            </span>
            <span className="order-1 font-serif text-2xl font-semibold leading-7 tabular-nums text-foreground">
              {stat.value}
            </span>
          </button>
        }
      />
      <PopoverContent
        align="center"
        anchor={pointerAnchor.anchor}
        className="w-[min(19rem,calc(100vw-2rem))]"
        positionMethod="fixed"
        side="left"
        sideOffset={10}
      >
        <PopoverHeader className="gap-1">
          <PopoverTitle className="font-serif text-base font-semibold">
            {stat.popoverTitle}
          </PopoverTitle>
        </PopoverHeader>
        <WeekMetricLineChart
          label={stat.label}
          points={stat.points}
          valueFormatter={stat.valueFormatter}
        />
      </PopoverContent>
    </Popover>
  );
}

function WeekMetricLineChart({
  label,
  points,
  valueFormatter,
}: {
  label: string;
  points: WeekStat["points"];
  valueFormatter: WeekStat["valueFormatter"];
}) {
  if (points.length < 2) {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        More days are needed to draw a weekly trend.
      </p>
    );
  }

  const width = 260;
  const height = 64;
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, 1);
  const coordinates = points.map((point, index) => ({
    ...point,
    x: (index / Math.max(points.length - 1, 1)) * width,
    y: height - ((point.value - minimum) / range) * (height - 12) - 6,
  }));
  const polyline = coordinates
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  return (
    <div className="pt-2">
      <svg
        aria-label={`${label} trend for this week`}
        className="h-16 w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          className="stroke-border"
          strokeDasharray="3 3"
          x1="0"
          x2={width}
          y1={height / 2}
          y2={height / 2}
        />
        <polyline
          className="fill-none stroke-primary"
          points={polyline}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        {coordinates.map((point) => (
          <circle
            className="fill-primary"
            cx={point.x}
            cy={point.y}
            key={point.date}
            r="2.25"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{formatShortDay(points[0]?.date ?? "")}</span>
        <span>{formatShortDay(points.at(-1)?.date ?? "")}</span>
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>Low {valueFormatter(minimum)}</span>
        <span>High {valueFormatter(maximum)}</span>
      </div>
    </div>
  );
}

function buildWeekMetricPoints(
  dates: string[],
  daysByDate: Map<string, JournalView["days"][number]>,
  metric: "activity" | "sleep-duration" | "sleep-score",
): WeekStat["points"] {
  return dates.flatMap((date) => {
    const events = daysByDate.get(date)?.events ?? [];
    const value = readJournalDayMetric(events, metric);
    return value === null ? [] : [{ date, value }];
  });
}

function averageMetric(points: readonly { value: number }[]): number {
  return Math.round(
    points.reduce((total, point) => total + point.value, 0) / points.length,
  );
}

function readJournalDayMetric(
  events: JournalEvent[],
  metric: "activity" | "sleep-duration" | "sleep-score",
): number | null {
  if (metric === "activity") {
    const durations = events
      .filter((event) => event.kind === "activity")
      .map((event) => event.metrics.activityMinutes)
      .filter((value) => value > 0);
    return durations.length > 0
      ? durations.reduce((sum, value) => sum + value, 0)
      : null;
  }

  const sleep = events.find((event) => event.kind === "sleep");
  if (!sleep) return null;
  return metric === "sleep-score"
    ? sleep.metrics.sleepScore
    : sleep.metrics.sleepMinutes;
}

function formatShortDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

function renderEventIcon(event: JournalEvent) {
  const lead = event.records.find((record) => record.label === event.title);
  const selected = event.kind === "note" && lead
    ? readJournalIcon(lead.tags)
    : null;
  if (selected && selected !== "note") {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className="size-5"
        height={20}
        src={JOURNAL_ICON_ASSETS[selected]}
        unoptimized
        width={20}
      />
    );
  }
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

function formatEventTime(event: JournalEvent): string {
  if (event.timing === "night") return "Night";
  if (event.timing === "all_day") return "All day";
  if (event.timing === "morning") return "Morning";
  if (event.timing === "afternoon") return "Afternoon";
  if (event.timing === "evening") return "Evening";
  if (event.timing === "unknown") return "";
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

function shiftMonth(date: string, offset: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Date(Date.UTC(year, month - 1 + offset, 1))
    .toISOString()
    .slice(0, 10);
}

function formatMonth(date: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function formatJournalWindowLabel(
  startDate: string,
  endDate: string,
  today: string,
): string {
  if (endDate === today) return "Today";

  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  const day = new Intl.DateTimeFormat("en", {
    day: "numeric",
    timeZone: "UTC",
  });
  const month = new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
  });

  return sameMonth
    ? `${month.format(end)} ${day.format(start)}–${day.format(end)}`
    : `${month.format(start)} ${day.format(start)}–${month.format(
        end,
      )} ${day.format(end)}`;
}

function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  if (hours === 0) return `${remaining} min`;
  if (remaining === 0) return `${hours} h`;
  return `${hours} h ${remaining}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatSource(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "oura") return "Oura";
  if (normalized === "manual" || normalized === "you") return "You";
  if (normalized === "apple-health") return "Apple Health";
  if (normalized === "whoop") return "Whoop";
  if (normalized === "garmin") return "Garmin";
  if (normalized === "murph") return "Murph";
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeEventSources(sources: readonly string[]): string[] {
  const specificSources = sources.filter(
    (source) => source.toLowerCase() !== "device",
  );
  return [...new Set(specificSources.length > 0 ? specificSources : sources)];
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

function parseJournalDetail(
  value: string,
): { label: string; value: string } | null {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  return {
    label: value.slice(0, separator).trim(),
    value: value.slice(separator + 1).trim(),
  };
}

function parseSleepPopoverDetails(
  event: JournalEvent,
  details: readonly string[],
): SleepPopoverDetails {
  const values = event.metrics;
  const metrics = [
    sleepPopoverMetric(
      values.sleepEfficiencyPercent,
      "Sleep efficiency",
      "The share of time in bed that you spent asleep.",
      (value) => `${formatNumber(value)}%`,
    ),
    sleepPopoverMetric(
      values.hrvMs,
      "HRV",
      "Variation between heartbeats. Your own trend matters most.",
      (value) => `${formatNumber(value)} ms`,
    ),
    sleepPopoverMetric(
      values.readinessScore,
      "Readiness",
      "How prepared your body appears for today's strain.",
      formatNumber,
    ),
    sleepPopoverMetric(
      values.recoveryScore,
      "Recovery",
      "How recovered your body appears after recent strain.",
      formatNumber,
    ),
    sleepPopoverMetric(
      values.restingHeartRateBpm,
      "Resting heart rate",
      "Your heart rate while your body was resting.",
      (value) => `${formatNumber(value)} bpm`,
    ),
    sleepPopoverMetric(
      values.deepSleepMinutes,
      "Deep sleep",
      "The sleep stage most linked with physical recovery.",
      (value) => `${formatNumber(value)} min`,
    ),
    sleepPopoverMetric(
      values.remSleepMinutes,
      "REM sleep",
      "The sleep stage linked with memory and learning.",
      (value) => `${formatNumber(value)} min`,
    ),
    sleepPopoverMetric(
      values.respiratoryRate,
      "Respiratory rate",
      "How many breaths you took each minute during sleep.",
      formatNumber,
    ),
    sleepPopoverMetric(
      values.spo2Percent,
      "SpO₂",
      "Your estimated average blood oxygen during sleep.",
      (value) => `${formatNumber(value)}%`,
    ),
  ].filter((metric): metric is SleepPopoverMetric => metric !== null);

  return {
    duration:
      values.sleepMinutes === null
        ? null
        : formatDuration(Math.round(values.sleepMinutes)),
    durationMinutes: values.sleepMinutes,
    extraDetails: [...details],
    metrics,
    score: values.sleepScore === null ? null : formatNumber(values.sleepScore),
    scoreValue: values.sleepScore,
  };
}

function sleepPopoverMetric(
  numericValue: number | null,
  label: string,
  description: string,
  format: (value: number) => string,
): SleepPopoverMetric | null {
  return numericValue === null
    ? null
    : { description, label, numericValue, value: format(numericValue) };
}

function buildSleepMetricBaselines(
  days: JournalView["days"],
): SleepMetricBaselines {
  const baselines: SleepMetricBaselines = new Map();
  for (const day of days) {
    for (const event of day.events) {
      if (event.kind !== "sleep") continue;
      const metrics = [
        { label: "Total sleep", value: event.metrics.sleepMinutes },
        { label: "Sleep score", value: event.metrics.sleepScore },
        {
          label: "Sleep efficiency",
          value: event.metrics.sleepEfficiencyPercent,
        },
        { label: "HRV", value: event.metrics.hrvMs },
        { label: "Readiness", value: event.metrics.readinessScore },
        { label: "Recovery", value: event.metrics.recoveryScore },
        {
          label: "Resting heart rate",
          value: event.metrics.restingHeartRateBpm,
        },
        { label: "Deep sleep", value: event.metrics.deepSleepMinutes },
        { label: "REM sleep", value: event.metrics.remSleepMinutes },
        { label: "Respiratory rate", value: event.metrics.respiratoryRate },
        { label: "SpO₂", value: event.metrics.spo2Percent },
      ].filter(
        (metric): metric is { label: string; value: number } =>
          metric.value !== null,
      );
      for (const metric of metrics) {
        const values = baselines.get(metric.label) ?? [];
        values.push(metric.value);
        baselines.set(metric.label, values);
      }
    }
  }
  return baselines;
}

function getSleepMetricContext(
  label: string,
  current: number,
  baselines: SleepMetricBaselines,
): SleepMetricContext | null {
  const values = baselines.get(label) ?? [];
  if (values.length < 7) return null;
  const baseline =
    values.reduce((sum, value) => sum + value, 0) / values.length;
  if (baseline === 0) return null;
  const difference = (current - baseline) / Math.abs(baseline);
  if (Math.abs(difference) < 0.05) {
    return { tone: "neutral" };
  }

  const direction = sleepMetricDirection(label);
  if (direction === "neutral") {
    return { tone: "neutral" };
  }
  const favorable = direction === "higher" ? difference > 0 : difference < 0;
  return { tone: favorable ? "favorable" : "unfavorable" };
}

function sleepMetricDirection(label: string): SleepMetricDirection {
  if (label === "Resting heart rate") return "lower";
  if (label === "Total sleep" || label === "Respiratory rate") return "neutral";
  return "higher";
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

function currentLocalDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function serverCurrentDate(): string {
  return new Date().toISOString().slice(0, 10);
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

function minDate(left: string, right: string): string {
  return left < right ? left : right;
}
