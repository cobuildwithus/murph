import {
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
  type HabitatIndicatorDefinition,
  type HabitatIndicatorPriority,
  type HabitatIndicatorValue,
} from "@murphai/contracts";

import type { HabitatIndicatorNotes, ResolvedCategory } from "./home-model";

export type CategoryGrade = {
  letter: "A" | "B" | "C" | "D" | "E" | null;
  pct: number | null;
  met: number;
  graded: number;
  eligible: number;
  redFlags: number;
  basePct?: number;
  capabilityBonus?: number;
};

export type FactRow = {
  indicatorId: string;
  label: string;
  value: string;
  target: string | null;
  met: boolean | null;
  priority: HabitatIndicatorPriority;
  detail: string | null;
  note: string | null;
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
const MAX_CAPABILITY_BONUS = 15;

function gradeLetter(
  pct: number,
  redFlags: number,
): Exclude<CategoryGrade["letter"], null> {
  if (redFlags > 0) return "E";
  if (pct >= 90) return "A";
  if (pct >= 75) return "B";
  if (pct >= 55) return "C";
  if (pct >= 35) return "D";
  return "E";
}

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
  return {
    letter: gradeLetter(pct, redFlags),
    pct,
    met,
    graded,
    eligible,
    redFlags,
  };
}

function capabilityBonus(
  values: Record<string, Record<string, HabitatIndicatorValue>>,
): number {
  const pointsByGroup = new Map<string, number>();

  for (const aspect of HABITAT_CATALOG.aspects) {
    const aspectValues = values[aspect.id];
    if (!aspectValues) continue;

    for (const indicator of aspect.indicators) {
      const bonus = indicator.capabilityBonus;
      const value = aspectValues[indicator.id];
      if (!bonus || !isKnownValue(value)) continue;

      const points = bonus.pointsByValue[String(value)] ?? 0;
      if (points <= 0) continue;

      const group = bonus.group ?? `${aspect.id}.${indicator.id}`;
      pointsByGroup.set(group, Math.max(pointsByGroup.get(group) ?? 0, points));
    }
  }

  return Math.min(
    MAX_CAPABILITY_BONUS,
    Array.from(pointsByGroup.values()).reduce((sum, points) => sum + points, 0),
  );
}

export function overallGrade(
  notes: readonly CategoryNote[],
  values?: Record<string, Record<string, HabitatIndicatorValue>>,
): CategoryGrade {
  const baseGrade = gradeFromCounts(
    notes.reduce((sum, note) => sum + note.grade.met, 0),
    notes.reduce((sum, note) => sum + note.grade.graded, 0),
    notes.reduce((sum, note) => sum + note.grade.eligible, 0),
    notes.reduce((sum, note) => sum + note.grade.redFlags, 0),
  );

  if (!values || baseGrade.pct === null) return baseGrade;

  const bonus = capabilityBonus(values);
  const pct = Math.min(100, baseGrade.pct + bonus);
  return {
    ...baseGrade,
    letter: gradeLetter(pct, baseGrade.redFlags),
    pct,
    basePct: baseGrade.pct,
    capabilityBonus: bonus,
  };
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

function mergedNote(
  indicatorId: string,
  note: string | undefined,
  knownNotes: ReadonlyMap<string, string>,
): string | null {
  const notes = [note];
  for (const [foldedId, parentId] of Object.entries(FOLDED_INTO)) {
    if (parentId === indicatorId) {
      notes.push(knownNotes.get(foldedId));
    }
  }
  const unique = notes.filter(
    (candidate, index, values): candidate is string =>
      Boolean(candidate) && values.indexOf(candidate) === index,
  );
  return unique.length > 0 ? unique.join(" ") : null;
}

export function deriveCategoryNote(
  category: Pick<ResolvedCategory, "id" | "title" | "aspectIds">,
  values: Record<string, Record<string, HabitatIndicatorValue>>,
  indicatorNotes: HabitatIndicatorNotes = {},
): CategoryNote {
  const indicators: Array<{
    aspectId: string;
    indicator: HabitatIndicatorDefinition;
    value: HabitatIndicatorValue | undefined;
    note: string | undefined;
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
        note: indicatorNotes[aspectId]?.[indicator.id],
        index: indicators.length,
      });
    }
  }

  const knownFoldedValues = new Map<string, string>();
  const knownNotes = new Map<string, string>();
  for (const { indicator, note, value } of indicators) {
    if (FOLDED_INTO[indicator.id] && isKnownValue(value)) {
      knownFoldedValues.set(indicator.id, humanizeValue(value, indicator));
    }
    if (note) {
      knownNotes.set(indicator.id, note);
    }
  }

  const rows: Array<FactRow & { index: number }> = [];
  const optional: Array<QuietFact & { rank: number; index: number }> = [];
  const unknown: Array<QuietFact & { rank: number; index: number }> = [];
  const skipped: Array<QuietFact & { rank: number; index: number }> = [];
  let known = 0;
  let total = 0;

  for (const { aspectId, indicator, note, value, index } of indicators) {
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
      note: mergedNote(indicator.id, note, knownNotes),
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
        note,
      }) => ({
        indicatorId,
        label,
        value,
        target,
        met: rowMet,
        priority,
        detail,
        note,
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
