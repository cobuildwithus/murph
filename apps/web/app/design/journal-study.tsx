"use client";

import type {
  JournalEvent,
  JournalRecord,
  JournalView,
} from "@murphai/query/browser-overview";

import {
  JournalErrorState,
  JournalLoadingState,
  JournalUnavailableState,
  JournalViewContent,
} from "@/src/components/journal/journal-view";

const STUDY_WEEK_START = "2026-06-08";

const JOURNAL_STUDY_DATA: JournalView = {
  days: [
    day("2026-06-13", [
      journalEvent("sleep-sat", "sleep", "Sleep", "2026-06-13T07:20:00.000Z", {
        details: ["91% efficiency", "HRV 58 ms", "readiness 82"],
        source: "Oura",
        summary: "7 h 42 · sleep score 86",
        timing: "night",
      }),
      journalEvent("sauna", "note", "Sauna", "2026-06-13T17:45:00.000Z", {
        source: "You",
        summary: "18 min · 86°C",
      }),
    ]),
    day("2026-06-12", [
      journalEvent("sleep-fri", "sleep", "Sleep", "2026-06-12T07:40:00.000Z", {
        details: ["87% efficiency", "HRV 51 ms", "readiness 74"],
        source: "Oura",
        summary: "6 h 58 · sleep score 76",
        timing: "night",
      }),
      journalEvent("walk", "activity", "Walking", "2026-06-12T16:15:00.000Z", {
        source: "Apple Health",
        summary: "1 h 05 across 2 sessions",
      }),
    ]),
    day("2026-06-11", [
      journalEvent("sleep-thu", "sleep", "Sleep", "2026-06-11T07:15:00.000Z", {
        details: ["90% efficiency", "HRV 61 ms", "readiness 87"],
        source: "Oura",
        summary: "8 h 06 · sleep score 89",
        timing: "night",
      }),
      journalEvent("tennis", "activity", "Tennis", "2026-06-11T18:00:00.000Z", {
        details: ["Played well. Left elbow felt a little sore."],
        source: "Oura",
        summary: "59 min",
      }),
    ]),
    day("2026-06-10", [
      journalEvent("sleep-wed", "sleep", "Sleep", "2026-06-10T07:30:00.000Z", {
        details: ["84% efficiency", "HRV 48 ms", "readiness 69"],
        source: "Oura",
        summary: "6 h 31 · sleep score 71",
        timing: "night",
      }),
      journalEvent("nap", "nap", "Nap", "2026-06-10T14:20:00.000Z", {
        source: "Oura",
        summary: "24 min",
      }),
      journalEvent(
        "headache",
        "symptom",
        "Headache",
        "2026-06-10T19:10:00.000Z",
        {
          source: "You",
          summary: "Mild, started after dinner",
        },
      ),
    ]),
    day("2026-06-09", [
      journalEvent("sleep-tue", "sleep", "Sleep", "2026-06-09T07:10:00.000Z", {
        details: ["88% efficiency", "HRV 55 ms", "readiness 78"],
        source: "Oura",
        summary: "7 h 18 · sleep score 81",
        timing: "night",
      }),
      journalEvent(
        "yard",
        "activity",
        "Yard work",
        "2026-06-09T11:00:00.000Z",
        {
          source: "Oura",
          summary: "2 h 20 across 3 sessions",
        },
      ),
    ]),
    day("2026-06-08", [
      journalEvent(
        "trip",
        "experiment_context",
        "Work trip",
        "2026-06-08T12:00:00.000Z",
        {
          details: ["Away from home · Hotel stay"],
          source: "You",
          summary: "Berlin · day 1 of 3",
          timing: "all_day",
        },
      ),
      journalEvent("sleep-mon", "sleep", "Sleep", "2026-06-08T07:50:00.000Z", {
        details: ["82% efficiency", "HRV 46 ms", "readiness 65"],
        source: "Oura",
        summary: "6 h 44 · sleep score 70",
        timing: "night",
      }),
    ]),
  ],
  eventCount: 13,
  recordCount: 29,
  weeks: [
    {
      activityMinutes: 264,
      averageSleepMinutes: 437,
      averageSleepScore: 79,
      endDate: "2026-06-14",
      sleepNights: 6,
      startDate: STUDY_WEEK_START,
    },
  ],
  windowDays: 120,
};

export function JournalStudy() {
  return (
    <section data-design-study="journal" id="journal-study">
      <section inert>
        <JournalViewContent
          asOfDate="2026-06-13"
          insights={[
            {
              detail:
                "Late caffeine and shorter sleep moved together in your data.",
              href: "/patterns",
              id: "caffeine-sleep",
              label: "Pattern",
              title: "Late caffeine",
            },
          ]}
          journal={JOURNAL_STUDY_DATA}
        />
      </section>
      <section aria-label="Journal loading state" inert>
        <JournalLoadingState />
      </section>
      <section aria-label="Journal empty state" inert>
        <JournalViewContent
          asOfDate="2026-06-13"
          journal={{
            days: [],
            eventCount: 0,
            recordCount: 0,
            weeks: [],
            windowDays: 120,
          }}
        />
      </section>
      <section aria-label="Journal unavailable state" inert>
        <JournalUnavailableState onRetry={() => undefined} />
      </section>
      <section aria-label="Journal error state" inert>
        <JournalErrorState onRetry={() => undefined} />
      </section>
    </section>
  );
}

function day(date: string, events: JournalEvent[]) {
  return { date, events };
}

function journalEvent(
  id: string,
  kind: string,
  title: string,
  occurredAt: string,
  options: {
    details?: string[];
    source: string;
    summary: string;
    timing?: JournalEvent["timing"];
  },
): JournalEvent {
  return {
    date: occurredAt.slice(0, 10),
    details: options.details ?? [],
    id,
    kind,
    occurredAt,
    records: [
      journalRecord(
        id,
        kind,
        title,
        occurredAt,
        options.source,
        options.summary,
      ),
    ],
    summary: options.summary,
    timing: options.timing ?? "timed",
    timeZone: "Europe/Berlin",
    title,
  };
}

function journalRecord(
  id: string,
  kind: string,
  label: string,
  occurredAt: string,
  source: string,
  summary: string,
): JournalRecord {
  return {
    id: `${id}-record`,
    kind,
    label,
    occurredAt,
    source,
    summary,
    tags: [],
    timeZone: "Europe/Berlin",
  };
}
