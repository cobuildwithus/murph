"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
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
  Telescope,
  Trees,
  type LucideIcon,
} from "lucide-react";
import type { JournalEvent, JournalView } from "@murphai/query/browser-overview";

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
    () => Array.from({ length: WEEK_DAY_COUNT }, (_, index) => addDays(selectedWeekStart, index)),
    [selectedWeekStart],
  );
  const week = journal.weeks.find((entry) => entry.startDate === selectedWeekStart) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Your Journal
        </p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Journal
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          What happened, how it felt, and what your health data recorded.
        </p>
      </header>

      {journal.days.length === 0 ? (
        <JournalEmptyState />
      ) : (
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] xl:gap-14">
          <section className="min-w-0" aria-labelledby="journal-week-heading">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Your week
                </p>
                <h2
                  id="journal-week-heading"
                  className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
                >
                  {formatWeekRange(selectedWeekStart)}
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  {summarizeWeek(week)}
                </p>
              </div>
              <WeekControls
                canGoNext={selectedWeekStart < latestWeekStart}
                canGoPrevious={selectedWeekStart > earliestWeekStart}
                onNext={() => setSelectedWeekStart(addDays(selectedWeekStart, 7))}
                onPrevious={() => setSelectedWeekStart(addDays(selectedWeekStart, -7))}
                onToday={() => setSelectedWeekStart(latestWeekStart)}
              />
            </div>

            <div className="flex flex-col gap-3">
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

          <aside className="flex flex-col gap-7 lg:sticky lg:top-6">
            <MiniCalendar
              onSelectDate={(date) => setSelectedWeekStart(startOfIsoWeek(date))}
              selectedWeekStart={selectedWeekStart}
              today={today}
            />
            <WeekStats week={week} />
            {insights.length > 0 ? <WeeklyInsights insights={insights} /> : null}
            <p className="text-xs leading-5 text-muted-foreground">
              To add, correct, or remove an entry, tell Murph in your private chat.
            </p>
          </aside>
        </div>
      )}
    </main>
  );
}

function WeeklyInsights({ insights }: { insights: JournalInsight[] }) {
  return (
    <section aria-labelledby="journal-weekly-insights" className="flex flex-col gap-3">
      <h2
        id="journal-weekly-insights"
        className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
      >
        Weekly insights
      </h2>
      <div className="flex flex-col gap-1">
        {insights.map((insight) => (
          <Link
            className="group flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={insight.href}
            key={insight.id}
          >
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Telescope className="size-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold text-foreground">{insight.title}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-primary">
                  {insight.label}
                </span>
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {insight.detail}
              </span>
            </span>
            <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
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
        Tell Murph what happened, how you felt, or what context may matter. Connected devices will appear here too.
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
    <div className="flex items-center gap-1.5" aria-label="Journal week navigation">
      <Button
        aria-label="Previous week"
        disabled={!canGoPrevious}
        onClick={onPrevious}
        size="icon-sm"
        variant="outline"
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button onClick={onToday} size="sm" variant="outline">
        Today
      </Button>
      <Button
        aria-label="Next week"
        disabled={!canGoNext}
        onClick={onNext}
        size="icon-sm"
        variant="outline"
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
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
  return (
    <section aria-labelledby={headingId}>
      <div className={cn(
        "flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-2.5",
        isToday && "bg-primary/12",
      )}>
        <h3 id={headingId} className={cn(
          "text-sm font-semibold text-foreground",
          isToday && "text-primary",
        )}>
          {formatDayHeading(date)}{isToday ? " · Today" : ""}
        </h3>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          {formatShortDate(date)}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nothing recorded.</p>
      ) : (
        <ol className="flex flex-col py-1">
          {events.map((event) => (
            <li key={event.id}>
              <JournalEventRow event={event} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function JournalEventRow({ event }: { event: JournalEvent }) {
  const Icon = resolveEventIcon(event);
  const sources = [...new Set(event.records
    .map((record) => formatSource(record.source))
    .filter((source): source is string => source !== null))];
  const summary = event.summary && normalizeText(event.summary) !== normalizeText(event.title)
    ? event.summary
    : null;
  const isConcern = event.kind === "symptom";

  return (
    <article
      className="group grid grid-cols-[3.5rem_1.75rem_minmax(0,1fr)] gap-x-3 px-4 py-3 sm:grid-cols-[4.5rem_1.75rem_minmax(0,1fr)]"
      title={sources.length > 0 ? `Source: ${sources.join(", ")}` : undefined}
    >
      <time
        className="pt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground"
        dateTime={event.occurredAt}
      >
        {formatEventTime(event)}
      </time>
      <span className={cn(
        "flex size-7 items-center justify-center rounded-full bg-primary/8 text-primary",
        isConcern && "bg-destructive/10 text-destructive",
      )}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h4 className={cn(
            "text-sm font-semibold leading-5 text-foreground",
            isConcern && "text-destructive",
          )}>
            {event.title}
          </h4>
          {summary ? <p className="text-sm leading-5 text-muted-foreground">{summary}</p> : null}
        </div>
        {event.details.length > 0 ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {event.details.join(" · ")}
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
  const dates = Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
  const selectedWeekEnd = addDays(selectedWeekStart, 6);

  return (
    <section className="rounded-2xl border border-border bg-card p-4" aria-label="Journal calendar">
      <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
        {formatMonth(monthDate)}
      </h2>
      <div className="mt-4 grid grid-cols-7 gap-y-1 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((label, index) => (
          <span
            className="font-mono text-[9px] uppercase text-muted-foreground"
            key={`${label}-${index}`}
          >
            {label}
          </span>
        ))}
        {dates.map((date) => {
          const inMonth = date.slice(0, 7) === monthDate.slice(0, 7);
          const inSelectedWeek = date >= selectedWeekStart && date <= selectedWeekEnd;
          return (
            <button
              aria-label={formatDayAccessible(date)}
              className={cn(
                "mx-auto flex size-8 items-center justify-center rounded-full text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !inMonth && "text-muted-foreground/45",
                inSelectedWeek && "bg-primary/10",
                date === today && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
              )}
              key={date}
              onClick={() => onSelectDate(date)}
              type="button"
            >
              {Number(date.slice(8, 10))}
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
      value: week?.averageSleepMinutes === null || week?.averageSleepMinutes === undefined
        ? "No data"
        : formatDuration(week.averageSleepMinutes),
    },
    {
      label: "Sleep score",
      value: week?.averageSleepScore === null || week?.averageSleepScore === undefined
        ? "No data"
        : String(Math.round(week.averageSleepScore)),
    },
    {
      label: "Activity",
      value: week ? formatDuration(week.activityMinutes) : "No data",
    },
  ];

  return (
    <section aria-labelledby="journal-week-stats" className="flex flex-col gap-4">
      <h2
        id="journal-week-stats"
        className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
      >
        Week at a glance
      </h2>
      <dl className="grid grid-cols-3 gap-3 lg:grid-cols-1">
        {stats.map((stat) => (
          <div className="min-w-0" key={stat.label}>
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 font-serif text-xl font-semibold tabular-nums text-foreground">
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
  if (event.kind === "sleep" || event.kind === "nap") return event.kind === "nap" ? Sun : Moon;
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
    parts.push(`Sleep averaged ${formatDuration(week.averageSleepMinutes)} across ${week.sleepNights} ${week.sleepNights === 1 ? "night" : "nights"}`);
  }
  if (week.activityMinutes > 0) {
    parts.push(`${formatDuration(week.activityMinutes)} of activity was recorded`);
  }
  return parts.length > 0 ? `${parts.join(", and ")}.` : "A few notes were recorded this week.";
}

function formatDayHeading(date: string): string {
  return new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00.000Z`));
}

function formatDayAccessible(date: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00.000Z`));
}

function formatShortDate(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" })
    .format(value);
  return `${value.getUTCDate()} ${month}`;
}

function formatWeekRange(startDate: string): string {
  const endDate = addDays(startDate, 6);
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const endMonth = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
    .format(end);
  const endYear = end.getUTCFullYear();
  if (sameMonth) return `${startDay}–${endDay} ${endMonth} ${endYear}`;
  const startMonth = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
    .format(start);
  const startYear = start.getUTCFullYear();
  const startLabel = startYear === endYear
    ? `${startDay} ${startMonth}`
    : `${startDay} ${startMonth} ${startYear}`;
  return `${startLabel}–${endDay} ${endMonth} ${endYear}`;
}

function formatMonth(date: string): string {
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC", year: "numeric" })
    .format(new Date(`${date}T12:00:00.000Z`));
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
  return value.trim().toLowerCase().replace(/[.!]+$/gu, "");
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
