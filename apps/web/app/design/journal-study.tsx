import type { JournalView } from "@murphai/query/browser-overview";

import { JournalViewContent } from "@/src/components/journal/journal-view";

const JOURNAL_STUDY_DATA: JournalView = {
  days: [{
    date: "2026-08-20",
    events: [
      {
        date: "2026-08-20",
        id: "study-sleep",
        kind: "sleep",
        occurredAt: "2026-08-20T07:00:00.000Z",
        records: [
          {
            id: "study-sleep-session",
            kind: "sleep_session",
            label: "Sleep",
            occurredAt: "2026-08-20T07:00:00.000Z",
            source: "Oura",
            summary: "7 h 8 min",
            tags: [],
            timeZone: "Europe/Warsaw",
          },
          {
            id: "study-sleep-score",
            kind: "metric",
            label: "Sleep score",
            occurredAt: "2026-08-20T07:00:00.000Z",
            source: "Oura",
            summary: "61 score",
            tags: ["sleep-score"],
            timeZone: null,
          },
        ],
        timeZone: "Europe/Warsaw",
        title: "Sleep",
      },
      {
        date: "2026-08-20",
        id: "study-tennis",
        kind: "activity",
        occurredAt: "2026-08-20T18:00:00.000Z",
        records: [
          {
            id: "study-tennis-session",
            kind: "activity_session",
            label: "Tennis",
            occurredAt: "2026-08-20T18:00:00.000Z",
            source: "Apple Health",
            summary: "74 min",
            tags: [],
            timeZone: "Europe/Warsaw",
          },
          {
            id: "study-tennis-note",
            kind: "note",
            label: "Played well",
            occurredAt: "2026-08-20T19:30:00.000Z",
            source: "manual",
            summary: "Played well and felt energetic.",
            tags: ["journal"],
            timeZone: "Europe/Warsaw",
          },
        ],
        timeZone: "Europe/Warsaw",
        title: "Tennis",
      },
    ],
  }],
  eventCount: 2,
  recordCount: 4,
  windowDays: 120,
};

export function JournalStudy() {
  return (
    <section
      className="mx-auto max-w-5xl px-6 py-12 sm:px-10 lg:px-16"
      data-design-study="journal"
      id="journal-study"
      inert
    >
      <JournalViewContent journal={JOURNAL_STUDY_DATA} />
    </section>
  );
}
