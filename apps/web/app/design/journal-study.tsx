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
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

const STUDY_CONTACT_OPTION: MurphContactOption = {
  href: "sms:+15555550100?body=Tell%20me%20about%20Journal.",
  kind: "text",
  label: "Text Murph",
};

const JOURNAL_STUDY_DATA: JournalView = {
  days: [
    day("2026-06-13", [
      journalEvent("sleep-sat", "sleep", "Sleep", "2026-06-13T07:20:00.000Z", {
        metrics: {
          deepSleepMinutes: 78,
          hrvMs: 58,
          recoveryScore: 82,
          remSleepMinutes: 104,
          respiratoryRate: 14,
          restingHeartRateBpm: 57,
          sleepEfficiencyPercent: 91,
          sleepMinutes: 462,
          sleepScore: 86,
          spo2Percent: 96,
        },
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
        metrics: {
          hrvMs: 51,
          readinessScore: 74,
          sleepEfficiencyPercent: 87,
          sleepMinutes: 418,
          sleepScore: 76,
        },
        source: "Oura",
        summary: "6 h 58 · sleep score 76",
        timing: "night",
      }),
      journalEvent("walk", "activity", "Walking", "2026-06-12T16:15:00.000Z", {
        metrics: { activityMinutes: 65 },
        source: "Apple Health",
        summary: "1 h 05 across 2 sessions",
      }),
    ]),
    day("2026-06-11", [
      journalEvent("sleep-thu", "sleep", "Sleep", "2026-06-11T07:15:00.000Z", {
        metrics: {
          hrvMs: 61,
          readinessScore: 87,
          sleepEfficiencyPercent: 90,
          sleepMinutes: 486,
          sleepScore: 89,
        },
        source: "Oura",
        summary: "8 h 06 · sleep score 89",
        timing: "night",
      }),
      journalEvent("tennis", "activity", "Tennis", "2026-06-11T18:00:00.000Z", {
        details: ["Played well. Left elbow felt a little sore."],
        metrics: { activityMinutes: 59 },
        source: "Oura",
        summary: "59 min",
      }),
    ]),
    day("2026-06-10", [
      journalEvent("sleep-wed", "sleep", "Sleep", "2026-06-10T07:30:00.000Z", {
        metrics: {
          hrvMs: 48,
          readinessScore: 69,
          sleepEfficiencyPercent: 84,
          sleepMinutes: 391,
          sleepScore: 71,
        },
        source: "Oura",
        summary: "6 h 31 · sleep score 71",
        timing: "night",
      }),
      journalEvent("nap", "nap", "Nap", "2026-06-10T14:20:00.000Z", {
        source: "Oura",
        summary: "24 min",
      }),
      journalEvent(
        "experiment",
        "experiment_context",
        "Magnesium for Sleep",
        "2026-06-10T10:00:00.000Z",
        {
          details: [
            "Status: Active",
            "Progress: Day 6 of 14",
            "Result: Sleep duration is above the baseline so far.",
          ],
          source: "Murph",
          summary: "Running experiment · day 6",
        },
      ),
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
        metrics: {
          hrvMs: 55,
          readinessScore: 78,
          sleepEfficiencyPercent: 88,
          sleepMinutes: 438,
          sleepScore: 81,
        },
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
          metrics: { activityMinutes: 140 },
          source: "Oura",
          summary: "2 h 20 across 3 sessions",
        },
      ),
      journalEvent(
        "strength",
        "activity",
        "Strength training",
        "2026-06-09T17:30:00.000Z",
        {
          details: [
            "Average heart rate: 126 bpm",
            "Maximum heart rate: 164 bpm",
            "Strain: 11.8",
            "Active energy: 318 kcal",
            "Exercises: Goblet squat, Romanian deadlift, Split squat, Calf raise",
          ],
          metrics: { activityMinutes: 52 },
          source: "Whoop",
          summary: "52 min",
        },
      ),
    ]),
    day("2026-06-08", [
      journalEvent("trip", "note", "Work trip", "2026-06-08T12:00:00.000Z", {
        details: [
          "Destination: Berlin",
          "Duration: Three days",
          "Hotel stay with two work meetings and one travel day.",
        ],
        source: "You",
        summary: "Berlin",
        timing: "all_day",
      }),
      journalEvent("sleep-mon", "sleep", "Sleep", "2026-06-08T07:50:00.000Z", {
        metrics: {
          hrvMs: 46,
          readinessScore: 65,
          sleepEfficiencyPercent: 82,
          sleepMinutes: 404,
          sleepScore: 70,
        },
        source: "Oura",
        summary: "6 h 44 · sleep score 70",
        timing: "night",
      }),
    ]),
    day("2026-06-07", [
      journalEvent("sleep-sun", "sleep", "Sleep", "2026-06-07T07:25:00.000Z", {
        metrics: {
          hrvMs: 52,
          readinessScore: 73,
          sleepEfficiencyPercent: 86,
          sleepMinutes: 423,
          sleepScore: 77,
        },
        source: "Oura",
        summary: "7 h 03 · sleep score 77",
        timing: "night",
      }),
    ]),
  ],
  eventCount: 16,
  recordCount: 32,
  weeks: [
    {
      activityMinutes: 264,
      averageSleepMinutes: 437,
      averageSleepScore: 79,
      endDate: "2026-06-14",
      sleepNights: 6,
      startDate: "2026-06-08",
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
              date: "2026-06-12",
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
          contactOptions={[STUDY_CONTACT_OPTION]}
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
    metrics?: Partial<JournalEvent["metrics"]>;
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
    metrics: {
      activityMinutes: 0,
      deepSleepMinutes: null,
      hrvMs: null,
      readinessScore: null,
      recoveryScore: null,
      remSleepMinutes: null,
      respiratoryRate: null,
      restingHeartRateBpm: null,
      sleepEfficiencyPercent: null,
      sleepMinutes: null,
      sleepScore: null,
      spo2Percent: null,
      ...options.metrics,
    },
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
