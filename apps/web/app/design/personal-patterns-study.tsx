import type { PersonalPatternReport } from "@murphai/query/browser-overview";

import { PersonalPatternsSection } from "@/src/components/overview/personal-patterns-section";

const POPULATED_REPORT: PersonalPatternReport = {
  asOfDate: "2026-08-06",
  factors: [
    { id: "running", kind: "activity", label: "Running", observedDays: 14 },
    { id: "sauna", kind: "intervention", label: "Sauna", observedDays: 11 },
    { id: "strength", kind: "activity", label: "Strength", observedDays: 9 },
    {
      id: "late-meal",
      kind: "intervention",
      label: "Late meal",
      observedDays: 7,
    },
    {
      id: "custom-tag",
      kind: "intervention",
      label: "Custom tag",
      observedDays: 6,
    },
  ],
  outcomes: [
    { id: "hrv", label: "HRV", unit: "ms" },
    { id: "total-sleep", label: "Total sleep", unit: "min" },
    { id: "resting-heart-rate", label: "Resting heart rate", unit: "bpm" },
    { id: "readiness-score", label: "Readiness score", unit: "score" },
    { id: "deep-sleep", label: "Deep sleep", unit: "min" },
    { id: "respiratory-rate", label: "Respiratory rate", unit: "rpm" },
    { id: "sleep-efficiency", label: "Sleep efficiency", unit: "%" },
  ],
  cells: [
    cell("running", "hrv", "seen_again", "higher", 12.4, 48, 42.7, 9),
    cell(
      "running",
      "total-sleep",
      "no_clear_pattern",
      "flat",
      1.2,
      432,
      427,
      9,
    ),
    cell(
      "running",
      "resting-heart-rate",
      "new_clue",
      "lower",
      -4.1,
      53.5,
      55.8,
      7,
    ),
    cell("running", "readiness-score", "seen_again", "higher", 5.2, 82, 78, 8),
    cell("running", "deep-sleep", "no_clear_pattern", "flat", 0.8, 92, 91, 8),
    cell(
      "running",
      "respiratory-rate",
      "no_clear_pattern",
      "flat",
      -0.4,
      14.8,
      14.9,
      8,
    ),
    cell("running", "sleep-efficiency", "new_clue", "higher", 3.1, 91, 88, 7),
    cell("sauna", "hrv", "worth_testing", "higher", 17.8, 50.2, 42.6, 10),
    cell("sauna", "total-sleep", "seen_again", "higher", 6.5, 458, 430, 8),
    cell(
      "sauna",
      "resting-heart-rate",
      "no_clear_pattern",
      "flat",
      -0.8,
      54.2,
      54.6,
      8,
    ),
    cell("sauna", "readiness-score", "seen_again", "higher", 4.6, 82, 78, 8),
    cell("sauna", "deep-sleep", "new_clue", "higher", 5.1, 96, 91, 7),
    cell(
      "sauna",
      "respiratory-rate",
      "no_clear_pattern",
      "flat",
      0.2,
      14.9,
      14.9,
      8,
    ),
    cell("sauna", "sleep-efficiency", "seen_again", "higher", 3.7, 91, 88, 8),
    cell("strength", "hrv", "new_clue", "lower", -8.3, 41.9, 45.7, 6),
    cell(
      "strength",
      "total-sleep",
      "no_clear_pattern",
      "flat",
      0.4,
      429,
      427,
      6,
    ),
    cell(
      "strength",
      "resting-heart-rate",
      "new_clue",
      "higher",
      3.8,
      56.7,
      54.6,
      6,
    ),
    cell("strength", "readiness-score", "new_clue", "lower", -3.9, 75, 78, 6),
    cell("strength", "deep-sleep", "no_clear_pattern", "flat", 0.5, 91, 91, 6),
    cell(
      "strength",
      "respiratory-rate",
      "new_clue",
      "higher",
      2.8,
      15.3,
      14.9,
      6,
    ),
    cell(
      "strength",
      "sleep-efficiency",
      "no_clear_pattern",
      "flat",
      -0.6,
      87,
      88,
      6,
    ),
    cell("late-meal", "hrv", "no_clear_pattern", "flat", 0.2, 43.9, 43.8, 6),
    cell("late-meal", "total-sleep", "new_clue", "lower", -4.3, 409, 427, 6),
    cell(
      "late-meal",
      "resting-heart-rate",
      "no_clear_pattern",
      "flat",
      0.5,
      54.9,
      54.6,
      6,
    ),
    cell("late-meal", "readiness-score", "new_clue", "lower", -5.4, 74, 78, 6),
    cell("late-meal", "deep-sleep", "new_clue", "lower", -6.2, 85, 91, 6),
    cell(
      "late-meal",
      "respiratory-rate",
      "no_clear_pattern",
      "flat",
      0.4,
      15,
      14.9,
      6,
    ),
    cell(
      "late-meal",
      "sleep-efficiency",
      "seen_again",
      "lower",
      -4.1,
      84,
      88,
      6,
    ),
    cell("custom-tag", "hrv", "no_clear_pattern", "flat", 0.1, 43.9, 43.8, 5),
    cell(
      "custom-tag",
      "total-sleep",
      "no_clear_pattern",
      "flat",
      0.3,
      428,
      427,
      5,
    ),
    cell(
      "custom-tag",
      "resting-heart-rate",
      "no_clear_pattern",
      "flat",
      0.4,
      54.8,
      54.6,
      5,
    ),
    cell(
      "custom-tag",
      "readiness-score",
      "no_clear_pattern",
      "flat",
      0.5,
      78,
      78,
      5,
    ),
    cell(
      "custom-tag",
      "deep-sleep",
      "no_clear_pattern",
      "flat",
      -0.2,
      91,
      91,
      5,
    ),
    cell(
      "custom-tag",
      "respiratory-rate",
      "no_clear_pattern",
      "flat",
      0.1,
      14.9,
      14.9,
      5,
    ),
    cell(
      "custom-tag",
      "sleep-efficiency",
      "no_clear_pattern",
      "flat",
      0.3,
      88,
      88,
      5,
    ),
  ],
  lagDays: 1,
  notes: ["Synthetic design data."],
  repeatableCellCount: 6,
  testedCellCount: 9,
  windowDays: 120,
};

const EMPTY_REPORT: PersonalPatternReport = {
  asOfDate: "2026-08-06",
  cells: [],
  factors: [],
  lagDays: 1,
  notes: [],
  outcomes: [],
  repeatableCellCount: 0,
  testedCellCount: 0,
  windowDays: 120,
};

export function PersonalPatternsStudy() {
  return (
    <div
      className="flex flex-col gap-8"
      data-design-section="personal-patterns"
      id="personal-patterns"
      inert
    >
      <div data-design-state="populated">
        <PersonalPatternsSection report={POPULATED_REPORT} />
      </div>
      <div data-design-state="empty">
        <PersonalPatternsSection report={EMPTY_REPORT} />
      </div>
      <div data-design-state="loading">
        <PersonalPatternsSection report={null} state="loading" />
      </div>
      <div data-design-state="error">
        <PersonalPatternsSection
          error="We couldn't unlock your pattern data right now."
          report={null}
          state="error"
        />
      </div>
      <div data-design-state="unavailable">
        <PersonalPatternsSection report={null} state="unavailable" />
      </div>
    </div>
  );
}

export function PersonalPatternsComponentStudy() {
  return <PersonalPatternsSection report={POPULATED_REPORT} />;
}

function cell(
  factorId: string,
  outcomeId: string,
  stage: "new_clue" | "seen_again" | "worth_testing" | "no_clear_pattern",
  direction: "higher" | "lower" | "flat",
  deltaPercent: number,
  exposedMean: number,
  comparisonMean: number,
  exposedDays: number,
) {
  return {
    comparisonDays: exposedDays,
    comparisonMean,
    delta: exposedMean - comparisonMean,
    deltaPercent,
    direction,
    exposedDays,
    exposedMean,
    factorId,
    firstExposedDate: "2026-04-12",
    lastExposedDate: "2026-08-02",
    outcomeId,
    repeatedDirection: stage !== "no_clear_pattern",
    stage,
  } as const;
}
