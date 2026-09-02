"use client";

import type {
  PersonalPatternCell,
  PersonalPatternReport,
} from "@murphai/query/browser-overview";

import { PersonalPatternsSection } from "@/src/components/overview/personal-patterns-section";

const POPULATED_REPORT: PersonalPatternReport = {
  asOfDate: "2026-08-06",
  factors: [
    { id: "running", kind: "activity", label: "Running", observedDays: 14 },
    { id: "sauna", kind: "intervention", label: "Sauna", observedDays: 11 },
    {
      id: "housework",
      kind: "activity",
      label: "House work",
      observedDays: 12,
    },
    { id: "mobility", kind: "activity", label: "Mobility", observedDays: 10 },
    {
      id: "high-strain",
      kind: "intervention",
      label: "High strain",
      observedDays: 8,
    },
    {
      id: "bedroom-temperature",
      kind: "intervention",
      label: "Bedroom temperature",
      observedDays: 6,
    },
    {
      id: "high-filtering-amber-red-or-orange-evening-glasses-with-spectral-data-when-available",
      kind: "intervention",
      label: "Blue-light blocking glasses",
      observedDays: 7,
    },
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
    {
      id: "sparse-factor",
      kind: "intervention",
      label: "Sparse factor",
      observedDays: 2,
    },
    { id: "walking", kind: "activity", label: "Walking", observedDays: 18 },
    { id: "cycling", kind: "activity", label: "Cycling", observedDays: 12 },
    { id: "tennis", kind: "activity", label: "Tennis", observedDays: 10 },
    { id: "hiking", kind: "activity", label: "Hiking", observedDays: 8 },
    {
      id: "breathwork",
      kind: "intervention",
      label: "Breathwork",
      observedDays: 9,
    },
    {
      id: "meditation",
      kind: "intervention",
      label: "Meditation",
      observedDays: 8,
    },
    { id: "yoga", kind: "activity", label: "Yoga", observedDays: 7 },
    {
      id: "reading",
      kind: "intervention",
      label: "Reading",
      observedDays: 7,
    },
  ],
  outcomes: [
    { id: "hrv", label: "HRV", unit: "ms" },
    { id: "total-sleep", label: "Total sleep", unit: "min" },
    { id: "resting-heart-rate", label: "Resting heart rate", unit: "bpm" },
    { id: "readiness-score", label: "Readiness score", unit: "score" },
    { id: "deep-sleep", label: "Deep sleep", unit: "min" },
    { id: "respiratory-rate", label: "Respiratory rate", unit: "rpm" },
    { id: "sleep-score", label: "Sleep score", unit: "score" },
    { id: "sleep-efficiency", label: "Sleep efficiency", unit: "%" },
    { id: "spo2", label: "SpO₂", unit: "%" },
    { id: "unsupported", label: "Unsupported outcome", unit: "score" },
  ],
  cells: [
    cell("running", "hrv", "seen_again", "higher", 12.4, 48, 42.7, 9),
    cell("housework", "hrv", "seen_again", "higher", 6.3, 46.5, 43.7, 8),
    cell("mobility", "hrv", "new_clue", "higher", 4.8, 45.7, 43.6, 7),
    cell("high-strain", "hrv", "seen_again", "lower", -7.2, 40.5, 43.6, 7),
    cell(
      "bedroom-temperature",
      "hrv",
      "new_clue",
      "higher",
      4.1,
      45.4,
      43.6,
      6,
    ),
    cell(
      "high-filtering-amber-red-or-orange-evening-glasses-with-spectral-data-when-available",
      "hrv",
      "new_clue",
      "higher",
      3.6,
      45.2,
      43.6,
      7,
    ),
    cell("running", "spo2", "new_clue", "higher", 1, 97, 96, 8),
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
    cell("running", "sleep-score", "seen_again", "higher", 4.8, 82, 78, 8),
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
    cell("custom-tag", "respiratory-rate", "insufficient", "flat", 0, 0, 0, 5),
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
    cell("walking", "hrv", "new_clue", "higher", 4.8, 45.7, 43.6, 9),
    cell("cycling", "hrv", "new_clue", "higher", 4.3, 45.5, 43.6, 8),
    cell("tennis", "hrv", "new_clue", "lower", -4.6, 41.6, 43.6, 8),
    cell("hiking", "hrv", "new_clue", "higher", 5.1, 45.8, 43.6, 7),
    cell("breathwork", "hrv", "new_clue", "higher", 4.1, 45.4, 43.6, 7),
    cell("meditation", "hrv", "new_clue", "higher", 4.4, 45.5, 43.6, 7),
    cell("yoga", "hrv", "new_clue", "higher", 4.7, 45.6, 43.6, 6),
    cell("reading", "hrv", "new_clue", "higher", 4.2, 45.4, 43.6, 6),
    cell("running", "unsupported", "no_clear_pattern", "flat", 0, 0, 0, 9),
    cell("sauna", "unsupported", "no_clear_pattern", "flat", 0, 0, 0, 8),
    cell("strength", "unsupported", "no_clear_pattern", "flat", 0, 0, 0, 6),
    cell("late-meal", "unsupported", "no_clear_pattern", "flat", 0, 0, 0, 6),
    cell("custom-tag", "unsupported", "no_clear_pattern", "flat", 0, 0, 0, 5),
    cell("sparse-factor", "total-sleep", "insufficient", "flat", 0, 0, 0, 2),
    cell(
      "sparse-factor",
      "resting-heart-rate",
      "insufficient",
      "flat",
      0,
      0,
      0,
      2,
    ),
    cell("sparse-factor", "hrv", "insufficient", "flat", 0, 0, 0, 2),
    cell(
      "sparse-factor",
      "readiness-score",
      "insufficient",
      "flat",
      0,
      0,
      0,
      2,
    ),
    cell("sparse-factor", "deep-sleep", "insufficient", "flat", 0, 0, 0, 2),
    cell(
      "sparse-factor",
      "respiratory-rate",
      "insufficient",
      "flat",
      0,
      0,
      0,
      2,
    ),
    cell(
      "sparse-factor",
      "sleep-efficiency",
      "insufficient",
      "flat",
      0,
      0,
      0,
      2,
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
          onRetry={() => undefined}
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
  stage:
    | "insufficient"
    | "new_clue"
    | "seen_again"
    | "worth_testing"
    | "no_clear_pattern",
  direction: "higher" | "lower" | "flat",
  deltaPercent: number,
  exposedMean: number,
  comparisonMean: number,
  exposedDays: number,
): PersonalPatternCell {
  const evidence =
    stage === "worth_testing"
      ? { classification: "pattern" as const, grade: "A" as const }
      : stage === "seen_again"
      ? { classification: "pattern" as const, grade: "B" as const }
      : stage === "new_clue"
      ? { classification: "early_signal" as const, grade: "D" as const }
      : { classification: null, grade: null };
  return {
    ...evidence,
    comparisonBasis: "unobserved_baseline" as const,
    comparisonDates: ["2026-04-05", "2026-05-03"],
    comparisonDays: exposedDays,
    comparisonMean,
    delta: exposedMean - comparisonMean,
    deltaPercent,
    direction,
    exposedDays,
    exposedDates: ["2026-04-12", "2026-08-02"],
    exposedMean,
    factorId,
    firstExposedDate: "2026-04-12",
    lastExposedDate: "2026-08-02",
    outcomeId,
    repeatedDirection: stage !== "no_clear_pattern",
    stage,
  };
}
