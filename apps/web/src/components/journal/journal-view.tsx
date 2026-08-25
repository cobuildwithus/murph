"use client";

import { useMemo, useState } from "react";
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
  Stethoscope,
  Sun,
  Trees,
  type LucideIcon,
} from "lucide-react";
import type {
  JournalEvent,
  JournalView,
} from "@murphai/query/browser-overview";

import { Button } from "@/src/components/ui/button";
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
  journal,
}: {
  asOfDate?: string;
  insights?: JournalInsight[];
  journal: JournalView;
}) {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);
  const latestWeekStart = startOfIsoWeek(today);
  const earliestWeekStart = journal.weeks.at(-1)?.startDate ?? latestWeekStart;
  const [selectedWeekStart, setSelectedWeekStart] = useState(latestWeekStart);
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
  const week =
    journal.weeks.find((entry) => entry.startDate === selectedWeekStart) ??
    null;

  return (
    <section
      aria-labelledby="journal-page-heading"
      className="mx-auto flex w-full max-w-[90rem] flex-col gap-8 px-4 py-8 sm:px-6 lg:gap-[2.125rem] lg:px-[4.5rem] lg:py-16 lg:pb-[4.5rem]"
    >
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex max-w-[43.75rem] flex-col gap-2">
          <p className="font-mono text-[11px] uppercase leading-4 tracking-[0.12em] text-muted-foreground">
            Your Journal
          </p>
          <h1
            id="journal-page-heading"
            className="font-serif text-[2.625rem] font-semibold leading-[2.875rem] tracking-[-0.025em] text-foreground"
          >
            Journal
          </h1>
          <p className="text-[15px] leading-[23px] text-muted-foreground">
            A clear record of what happened, how you felt, and what your health
            data recorded.
          </p>
        </div>
        {journal.days.length > 0 ? (
          <WeekControls
            canGoNext={selectedWeekStart < latestWeekStart}
            canGoPrevious={selectedWeekStart > earliestWeekStart}
            onNext={() => setSelectedWeekStart(addDays(selectedWeekStart, 7))}
            onPrevious={() =>
              setSelectedWeekStart(addDays(selectedWeekStart, -7))
            }
            onToday={() => setSelectedWeekStart(latestWeekStart)}
          />
        ) : null}
      </header>

      {journal.days.length === 0 ? (
        <JournalEmptyState />
      ) : (
        <>
          <section
            aria-labelledby="journal-week-heading"
            className="flex flex-col gap-6 border-b border-border pb-6 pt-5 lg:flex-row lg:items-end lg:justify-between"
          >
            <div className="flex max-w-[45rem] flex-col gap-[7px]">
              <p className="text-[13px] font-semibold leading-[18px] text-primary">
                This week
              </p>
              <h2
                id="journal-week-heading"
                className="font-serif text-[1.75rem] font-semibold leading-[2.0625rem] tracking-[-0.018em] text-foreground"
              >
                {formatWeekRange(selectedWeekStart)}
              </h2>
              <p className="text-[15px] leading-[23px] text-muted-foreground">
                {summarizeWeek(week)}
              </p>
            </div>
            <WeekStats week={week} />
          </section>

          <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_21.375rem] lg:gap-16">
            <section className="min-w-0" aria-label="Journal timeline">
              <div className="flex flex-col">
                {selectedDates.map((date) => (
                  <JournalDaySection
                    date={date}
                    events={daysByDate.get(date)?.events ?? []}
                    isToday={date === today}
                    key={date}
                  />
                ))}
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
        Tell Murph what happened, how you felt, or what context may matter.
        Connected devices will appear here too.
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
}: {
  date: string;
  events: JournalEvent[];
  isToday: boolean;
}) {
  const headingId = `journal-day-${date}`;
  const dayContext = describeDayContext(events);
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-4 border-b border-border/70 py-[26px] first:pt-2 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-7"
    >
      <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-0.5 sm:pt-0.5">
        <h3
          id={headingId}
          className={cn(
            "text-sm font-semibold leading-5 text-foreground",
            isToday && "text-primary",
          )}
        >
          {formatDayHeading(date)}
        </h3>
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
          <p className="py-1 text-sm text-muted-foreground">
            Nothing recorded.
          </p>
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
  const Icon = resolveEventIcon(event);
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

  return (
    <article
      className="group grid grid-cols-[3.375rem_1.875rem_minmax(0,1fr)] items-start gap-x-3.5"
      title={sources.length > 0 ? `Source: ${sources.join(", ")}` : undefined}
    >
      <time
        className="pt-0.5 text-right font-mono text-[10px] uppercase leading-[18px] text-muted-foreground"
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
        <Icon className="size-[15px] stroke-2" aria-hidden="true" />
      </span>
      <div className="min-w-0 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h4
            className={cn(
              "text-[15px] font-semibold leading-[21px] text-foreground",
              isConcern && "text-destructive",
            )}
          >
            {event.title}
          </h4>
          {summary ? (
            <p className="text-sm leading-[21px] text-muted-foreground">
              {summary}
            </p>
          ) : null}
        </div>
        {details.length > 0 ? (
          <p className="mt-[3px] text-[13px] leading-[19px] text-muted-foreground">
            {details.join(" · ")}
          </p>
        ) : null}
        {sources.length > 0 ? (
          <span className="sr-only">Source: {sources.join(", ")}</span>
        ) : null}
      </div>
    </article>
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
  const stats = [
    {
      label: "Average sleep",
      value:
        week?.averageSleepMinutes === null ||
        week?.averageSleepMinutes === undefined
          ? "No data"
          : formatDuration(week.averageSleepMinutes),
    },
    {
      label: "Sleep score",
      value:
        week?.averageSleepScore === null ||
        week?.averageSleepScore === undefined
          ? "No data"
          : String(Math.round(week.averageSleepScore)),
    },
    {
      label: "Activity",
      value: week ? formatDuration(week.activityMinutes) : "No data",
    },
  ];

  return (
    <section aria-label="Week at a glance">
      <dl className="flex flex-wrap items-end gap-x-8 gap-y-4 lg:gap-x-10">
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

function resolveEventIcon(event: JournalEvent): LucideIcon {
  const value = `${event.kind} ${event.title}`.toLowerCase();
  if (event.kind === "sleep" || event.kind === "nap")
    return event.kind === "nap" ? Sun : Moon;
  if (event.kind === "test") return Beaker;
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

function summarizeWeek(week: JournalView["weeks"][number] | null): string {
  if (!week) return "Nothing has been recorded for this week yet.";
  const parts: string[] = [];
  if (week.averageSleepMinutes !== null) {
    parts.push(
      `Sleep averaged ${formatDuration(week.averageSleepMinutes)} across ${
        week.sleepNights
      } ${week.sleepNights === 1 ? "night" : "nights"}`,
    );
  }
  if (week.activityMinutes > 0) {
    parts.push(
      `${formatDuration(week.activityMinutes)} of activity was recorded`,
    );
  }
  return parts.length > 0
    ? `${parts.join(", and ")}.`
    : "A few notes were recorded this week.";
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

function formatWeekRange(startDate: string): string {
  const endDate = addDays(startDate, 6);
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const endMonth = new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
  }).format(end);
  const endYear = end.getUTCFullYear();
  if (sameMonth) return `${startDay}–${endDay} ${endMonth} ${endYear}`;
  const startMonth = new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
  }).format(start);
  const startYear = start.getUTCFullYear();
  const startLabel =
    startYear === endYear
      ? `${startDay} ${startMonth}`
      : `${startDay} ${startMonth} ${startYear}`;
  return `${startLabel}–${endDay} ${endMonth} ${endYear}`;
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
