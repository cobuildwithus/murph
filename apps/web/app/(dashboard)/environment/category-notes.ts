import {
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
  type HabitatIndicatorDefinition,
  type HabitatIndicatorPriority,
  type HabitatIndicatorValue,
} from "@murphai/contracts";

import type { ResolvedCategory } from "./home-model";

export type CategoryGrade = {
  letter: "A" | "B" | "C" | "D" | "E" | null;
  pct: number | null;
  met: number;
  graded: number;
  eligible: number;
  redFlags: number;
};

export type FactRow = {
  indicatorId: string;
  label: string;
  value: string;
  target: string | null;
  met: boolean | null;
  priority: HabitatIndicatorPriority;
  detail: string | null;
};

export type QuietFact = {
  indicatorId: string;
  label: string;
};

export type CategoryNote = {
  id: string;
  title: string;
  known: number;
  total: number;
  grade: CategoryGrade;
  rows: FactRow[];
  optionalFacts: QuietFact[];
  unknownFacts: QuietFact[];
  skippedFacts: QuietFact[];
};

type Evaluator = {
  met: (value: HabitatIndicatorValue) => boolean;
  goal?: string;
  showGoal?: boolean;
};

const PRIORITY_RANK: Record<HabitatIndicatorPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const TARGET_EVALUATORS: Readonly<Record<string, Evaluator>> = {
  night_temp_c: {
    met: (value) => typeof value === "number" && value >= 18 && value <= 22,
  },
  co2_typical_ppm: {
    met: (value) => typeof value === "number" && value < 1_000,
  },
  darkness: { met: (value) => value === "blackout" },
  night_noise: { met: (value) => value === "quiet" },
  mattress_satisfaction: {
    met: (value) => value === "good" || value === "acceptable",
    goal: "comfortable and supportive",
  },
  bedding_overheating: {
    met: (value) => value === "never",
    goal: "never",
  },
  phone_by_bed: {
    met: (value) => value === false,
    goal: "out of the bedroom",
  },
  tv_in_bedroom: {
    met: (value) => value === false,
    goal: "no TV",
  },
  damp_or_mold: {
    met: (value) => value === "none",
    goal: "no damp or mold",
  },
  smoke_sources: {
    met: (value) => value === "none",
    goal: "no indoor smoke",
  },
  evening_light: { met: (value) => value === "warm_dim" },
  morning_light_access: { met: (value) => value !== "none" },
  daytime_light: {
    met: (value) => value !== "dim",
    goal: "bright daytime light",
  },
  screen_at_eye_level: { met: (value) => value === true },
  breaks: {
    met: (value) => value === "systematic",
    goal: "systematic breaks",
  },
  wrist_complaints: {
    met: (value) => value === false,
    goal: "no wrist complaints",
  },
};

const RED_FLAG_DETECTORS: Readonly<
  Record<string, (value: HabitatIndicatorValue) => boolean>
> = {
  damp_or_mold: (value) => value === "visible_mold",
  radon_tested: (value) => value === "tested_high",
  smoke_sources: (value) => value === "smoking",
};

const aspectById = new Map(
  HABITAT_CATALOG.aspects.map((aspect) => [aspect.id, aspect]),
);

const indicatorById = new Map(
  HABITAT_CATALOG.aspects.flatMap((aspect) =>
    aspect.indicators.map((indicator) => [indicator.id, indicator] as const),
  ),
);

const FOLDED_INTO: Readonly<Record<string, string>> = {
  co2_meter: "co2_typical_ppm",
  sauna_type: "sauna_access",
  red_light_model: "red_light",
  mattress_age_years: "mattress_satisfaction",
};

function isKnownValue(
  value: HabitatIndicatorValue | undefined,
): value is string | number | boolean {
  return (
    value !== undefined && value !== null && value !== HABITAT_DECLINED_VALUE
  );
}

export function evaluateIndicatorTarget(
  indicatorId: string,
  value: HabitatIndicatorValue | undefined,
): boolean | null {
  const indicator = indicatorById.get(indicatorId);
  const evaluator = TARGET_EVALUATORS[indicatorId];
  if (indicator?.informational || !evaluator || !isKnownValue(value)) {
    return null;
  }
  return evaluator.met(value);
}

function displayLabel(
  aspectId: string,
  indicator: HabitatIndicatorDefinition,
): string {
  return aspectId === "home-location" && indicator.id === "location"
    ? "City"
    : indicator.label;
}

function humanizeValue(
  value: HabitatIndicatorValue,
  indicator: HabitatIndicatorDefinition,
): string {
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (typeof value === "number") {
    const valueType = indicator.valueType;
    if (valueType.kind !== "number" || !valueType.unit) {
      return String(value);
    }
    const separator = valueType.unit.startsWith("°") ? "" : " ";
    return `${value}${separator}${valueType.unit}`;
  }
  return typeof value === "string" ? value.replaceAll("_", " ") : "";
}

const MIN_GRADE_COVERAGE = 0.5;

function gradeFromCounts(
  met: number,
  graded: number,
  eligible: number,
  redFlags: number,
): CategoryGrade {
  if (
    graded === 0 ||
    eligible === 0 ||
    graded / eligible < MIN_GRADE_COVERAGE
  ) {
    return { letter: null, pct: null, met, graded, eligible, redFlags };
  }

  const pct = Math.round((100 * met) / graded);
  if (redFlags > 0) {
    return { letter: "E", pct, met, graded, eligible, redFlags };
  }
  if (pct >= 90) return { letter: "A", pct, met, graded, eligible, redFlags };
  if (pct >= 75) return { letter: "B", pct, met, graded, eligible, redFlags };
  if (pct >= 55) return { letter: "C", pct, met, graded, eligible, redFlags };
  if (pct >= 35) return { letter: "D", pct, met, graded, eligible, redFlags };
  return { letter: "E", pct, met, graded, eligible, redFlags };
}

export function overallGrade(notes: readonly CategoryNote[]): CategoryGrade {
  return gradeFromCounts(
    notes.reduce((sum, note) => sum + note.grade.met, 0),
    notes.reduce((sum, note) => sum + note.grade.graded, 0),
    notes.reduce((sum, note) => sum + note.grade.eligible, 0),
    notes.reduce((sum, note) => sum + note.grade.redFlags, 0),
  );
}

function mergedValue(
  indicatorId: string,
  value: string,
  knownFoldedValues: ReadonlyMap<string, string>,
): string {
  if (indicatorId === "sauna_access") {
    const saunaType = knownFoldedValues.get("sauna_type");
    return saunaType ? `${value} · ${saunaType}` : value;
  }
  return value;
}

function mergedDetail(
  indicatorId: string,
  knownFoldedValues: ReadonlyMap<string, string>,
): string | null {
  if (indicatorId === "co2_typical_ppm") {
    const meter = knownFoldedValues.get("co2_meter");
    if (!meter) return null;
    return meter === "aranet"
      ? "Measured with Aranet"
      : `Measured with ${meter}`;
  }
  if (indicatorId === "red_light") {
    const model = knownFoldedValues.get("red_light_model");
    return model ? `Model: ${model}` : null;
  }
  if (indicatorId === "mattress_satisfaction") {
    const age = knownFoldedValues.get("mattress_age_years");
    return age ? `Mattress age: ${age}` : null;
  }
  return null;
}

export function deriveCategoryNote(
  category: Pick<ResolvedCategory, "id" | "title" | "aspectIds">,
  values: Record<string, Record<string, HabitatIndicatorValue>>,
): CategoryNote {
  const indicators: Array<{
    aspectId: string;
    indicator: HabitatIndicatorDefinition;
    value: HabitatIndicatorValue | undefined;
    index: number;
  }> = [];

  for (const aspectId of category.aspectIds) {
    const aspect = aspectById.get(aspectId);
    if (!aspect) continue;
    const aspectValues = values[aspectId] ?? {};
    for (const indicator of aspect.indicators) {
      indicators.push({
        aspectId,
        indicator,
        value: aspectValues[indicator.id],
        index: indicators.length,
      });
    }
  }

  const knownFoldedValues = new Map<string, string>();
  for (const { indicator, value } of indicators) {
    if (FOLDED_INTO[indicator.id] && isKnownValue(value)) {
      knownFoldedValues.set(indicator.id, humanizeValue(value, indicator));
    }
  }

  const rows: Array<FactRow & { index: number }> = [];
  const optional: Array<QuietFact & { rank: number; index: number }> = [];
  const unknown: Array<QuietFact & { rank: number; index: number }> = [];
  const skipped: Array<QuietFact & { rank: number; index: number }> = [];
  let known = 0;
  let total = 0;

  for (const { aspectId, indicator, value, index } of indicators) {
    const label = displayLabel(aspectId, indicator);
    const rank = PRIORITY_RANK[indicator.priority];
    const core = indicator.informational !== true;
    if (core && value !== HABITAT_DECLINED_VALUE) {
      total += 1;
    }

    if (value === undefined || value === null) {
      if (core) {
        unknown.push({ indicatorId: indicator.id, label, rank, index });
      } else if (!FOLDED_INTO[indicator.id]) {
        optional.push({ indicatorId: indicator.id, label, rank, index });
      }
      continue;
    }
    if (value === HABITAT_DECLINED_VALUE) {
      skipped.push({ indicatorId: indicator.id, label, rank, index });
      continue;
    }

    if (core) {
      known += 1;
    }
    const foldedParentId = FOLDED_INTO[indicator.id];
    if (
      foldedParentId &&
      indicators.some(
        (candidate) =>
          candidate.indicator.id === foldedParentId &&
          isKnownValue(candidate.value),
      )
    ) {
      continue;
    }

    const evaluator = TARGET_EVALUATORS[indicator.id];
    const met = evaluateIndicatorTarget(indicator.id, value);
    const humanizedValue = humanizeValue(value, indicator);
    const target =
      met === null || evaluator?.showGoal === false
        ? null
        : indicator.target ?? evaluator?.goal ?? null;
    rows.push({
      indicatorId: indicator.id,
      label,
      value: mergedValue(indicator.id, humanizedValue, knownFoldedValues),
      target:
        target?.toLowerCase() === humanizedValue.toLowerCase() ? null : target,
      met,
      priority: indicator.priority,
      detail: mergedDetail(indicator.id, knownFoldedValues),
      index,
    });
  }

  rows.sort((a, b) => {
    const aUnmet = a.met === false ? 0 : 1;
    const bUnmet = b.met === false ? 0 : 1;
    return (
      aUnmet - bUnmet ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.index - b.index
    );
  });

  const met = rows.filter((row) => row.met === true).length;
  const graded = rows.filter((row) => row.met !== null).length;
  const redFlags = indicators.filter(({ indicator, value }) => {
    const detectsRedFlag = RED_FLAG_DETECTORS[indicator.id];
    return isKnownValue(value) && detectsRedFlag?.(value) === true;
  }).length;
  const eligible = indicators.filter(
    ({ indicator, value }) =>
      indicator.informational !== true &&
      value !== HABITAT_DECLINED_VALUE &&
      TARGET_EVALUATORS[indicator.id] !== undefined,
  ).length;

  return {
    id: category.id,
    title: category.title,
    known,
    total,
    grade: gradeFromCounts(met, graded, eligible, redFlags),
    rows: rows.map(
      ({
        indicatorId,
        label,
        value,
        target,
        met: rowMet,
        priority,
        detail,
      }) => ({
        indicatorId,
        label,
        value,
        target,
        met: rowMet,
        priority,
        detail,
      }),
    ),
    optionalFacts: optional
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(({ indicatorId, label }) => ({ indicatorId, label })),
    unknownFacts: unknown
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(({ indicatorId, label }) => ({ indicatorId, label })),
    skippedFacts: skipped
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(({ indicatorId, label }) => ({ indicatorId, label })),
  };
}
