import type { PersonalPatternReport } from "@murphai/query/browser-overview";

import { PersonalPatternsSection } from "@/src/components/overview/personal-patterns-section";

const POPULATED_REPORT: PersonalPatternReport = {
  asOfDate: "2026-08-06",
  factors: [
    { id: "running", kind: "activity", label: "Running", observedDays: 14 },
    { id: "sauna", kind: "intervention", label: "Sauna", observedDays: 11 },
    { id: "strength", kind: "activity", label: "Strength", observedDays: 9 },
  ],
  outcomes: [
    { id: "hrv", label: "HRV", unit: "ms" },
    { id: "total-sleep", label: "Total sleep", unit: "min" },
    { id: "resting-heart-rate", label: "Resting heart rate", unit: "bpm" },
  ],
  cells: [
    cell("running", "hrv", "seen_again", "higher", 12.4, 48, 42.7, 9),
    cell("running", "total-sleep", "no_clear_pattern", "flat", 1.2, 432, 427, 9),
    cell("running", "resting-heart-rate", "new_clue", "lower", -4.1, 53.5, 55.8, 7),
    cell("sauna", "hrv", "worth_testing", "higher", 17.8, 50.2, 42.6, 10),
    cell("sauna", "total-sleep", "seen_again", "higher", 6.5, 458, 430, 8),
    cell("sauna", "resting-heart-rate", "no_clear_pattern", "flat", -0.8, 54.2, 54.6, 8),
    cell("strength", "hrv", "new_clue", "lower", -8.3, 41.9, 45.7, 6),
    cell("strength", "total-sleep", "no_clear_pattern", "flat", 0.4, 429, 427, 6),
    cell("strength", "resting-heart-rate", "new_clue", "higher", 3.8, 56.7, 54.6, 6),
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
      <PersonalPatternsSection report={POPULATED_REPORT} />
      <PersonalPatternsSection report={EMPTY_REPORT} />
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
