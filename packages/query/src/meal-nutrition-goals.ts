import { goalMetricTargetSchema } from "@murphai/contracts";
import type { CanonicalEntity } from "./canonical-entities.ts";

const DEFINITIONS = {
  calories: ["dietary-calories", "kcal", "daily-calories"],
  proteinGrams: ["protein-grams", "g", "daily-protein"],
  carbsGrams: ["carbs-grams", "g", "daily-carbohydrates"],
  fatGrams: ["fat-grams", "g", "daily-fat"],
  fiberGrams: ["fiber-grams", "g", "daily-fiber"],
} as const;
type Metric = keyof typeof DEFINITIONS;
type Target = ReturnType<typeof goalMetricTargetSchema.parse>;
type Candidate = { goalId: string; target: Target; window: Window };
type Window = { startAt?: string; targetAt?: string };
export type NutritionTargetStatus = "resolved" | "missing" | "conflict" | "incompatible";
export interface NutritionTargetResolution {
  status: NutritionTargetStatus;
  target: number | null;
  provenance: Array<{
    goalId: string;
    targetId: string;
    metricKey: string;
    unit: string;
    window: Window;
    startAt?: string;
    targetAt?: string;
  }>;
}
export interface MealNutritionGoalContext {
  localDate: string;
  status: "ready" | "missing" | "conflict" | "incompatible" | "capacity";
  activeGoalCount: number;
  compatibility: "canonical" | "historical-selected" | "historical-rolling-mean";
  targets: Record<Metric, NutritionTargetResolution>;
}

const METRICS = Object.keys(DEFINITIONS) as Metric[];
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function containsDate(window: Window, date: string): boolean {
  return (!window.startAt || window.startAt <= date) && (!window.targetAt || date <= window.targetAt);
}
function readWindow(value: unknown): Window | null {
  const source = object(value);
  if (source.startAt !== undefined && (typeof source.startAt !== "string" || !DATE.test(source.startAt))) return null;
  if (source.targetAt !== undefined && (typeof source.targetAt !== "string" || !DATE.test(source.targetAt))) return null;
  const startAt = typeof source.startAt === "string" ? source.startAt : undefined;
  const targetAt = typeof source.targetAt === "string" ? source.targetAt : undefined;
  if (startAt && targetAt && startAt > targetAt) return null;
  return { ...(startAt ? { startAt } : {}), ...(targetAt ? { targetAt } : {}) };
}
function point(target: Target): boolean {
  return target.comparator === "between" && target.value === target.highValue;
}
function selected(target: Target): boolean {
  return target.evaluation.kind === "selected-value";
}
function rollingMean(target: Target): boolean {
  return target.evaluation.kind === "rolling-window" && target.evaluation.statistic === "mean"
    && target.selectionPolicyOverride?.kind === "daily-aggregate"
    && target.selectionPolicyOverride.statistic === "mean";
}
function resolution(candidates: Candidate[], compatible: (candidate: Candidate) => boolean): NutritionTargetResolution {
  const status = candidates.length === 0 ? "missing" : candidates.length > 1 ? "conflict"
    : compatible(candidates[0]!) ? "resolved" : "incompatible";
  return {
    status,
    target: status === "resolved" ? candidates[0]!.target.value : null,
    provenance: candidates.map(({ goalId, target, window }) => ({
      goalId, targetId: target.targetId, metricKey: target.metricKey, unit: target.unit, window,
      ...(target.startAt ? { startAt: target.startAt } : {}),
      ...(target.targetAt ? { targetAt: target.targetAt } : {}),
    })),
  };
}

type RawCandidate = { goalId: string; raw: Record<string, unknown>; window: unknown };

function parseApplicableTargets(rawCandidates: RawCandidate[], localDate: string): Candidate[] | null {
  const candidates: Candidate[] = [];
  for (const { goalId, raw, window: rawWindow } of rawCandidates) {
    const window = readWindow(rawWindow);
    if (!window || !window.startAt) return null;
    if (!containsDate(window, localDate)) continue;
    const targetWindow = readWindow(raw);
    if (!targetWindow) return null;
    if (!containsDate(targetWindow, localDate)) continue;
    const parsed = goalMetricTargetSchema.safeParse(raw);
    if (!parsed.success) return null;
    candidates.push({ goalId, target: parsed.data, window });
  }
  return candidates;
}

function collectApplicableTargets(active: readonly CanonicalEntity[], localDate: string): Candidate[] | null {
  const canonical: RawCandidate[] = [];
  const historical: RawCandidate[] = [];
  for (const entity of active) {
    const source = entity.frontmatter ?? entity.attributes;
    if (source.metricTargets === undefined) continue;
    if (!Array.isArray(source.metricTargets)) return null;
    const relevant = source.metricTargets.map(object).filter((raw) =>
      METRICS.some((metric) => raw.metricKey === DEFINITIONS[metric][0])
      || (raw.metricKey === "calories" && raw.targetId === "daily-calories"));
    if (relevant.length === 0) continue;
    for (const raw of relevant) {
      (raw.metricKey === "calories" ? historical : canonical).push({ goalId: entity.entityId, raw, window: source.window });
    }
  }
  const candidates = parseApplicableTargets(canonical, localDate);
  if (!candidates) return null;
  // Ambiguous legacy calories never override or invalidate applicable dietary authority.
  if (candidates.some(({ target }) => target.metricKey === "dietary-calories")) return candidates;
  const legacy = parseApplicableTargets(historical, localDate);
  return legacy ? [...candidates, ...legacy] : null;
}

type CompatibleBundle = {
  applicable: Candidate[];
  evaluation: (target: Target) => boolean;
  compatibility: MealNutritionGoalContext["compatibility"];
};
function selectCompatibleBundle(candidates: Candidate[]): CompatibleBundle | "conflict" | "incompatible" {
  const canonicalCalories = candidates.filter(({ target }) => target.metricKey === "dietary-calories");
  let compatibility: MealNutritionGoalContext["compatibility"] = "canonical";
  let applicable = candidates;
  let evaluation = selected;
  if (canonicalCalories.length === 0) {
    const legacyCalories = candidates.filter(({ target }) => target.metricKey === "calories" && target.targetId === "daily-calories");
    if (legacyCalories.length > 0) {
      // A historical calorie point never licenses mixing another goal into its bundle.
      if (legacyCalories.length !== 1) return "conflict";
      const owner = legacyCalories[0]!.goalId;
      const legacy = METRICS.map((metric) => candidates.filter(({ goalId, target }) =>
        goalId === owner && target.metricKey === (metric === "calories" ? "calories" : DEFINITIONS[metric][0])));
      if (legacy.some((matches) => matches.length !== 1)) return "incompatible";
      const bundle = legacy.map((matches) => matches[0]!);
      if (bundle.some(({ target }, index) => target.targetId !== DEFINITIONS[METRICS[index]!][2])) return "incompatible";
      if (candidates.some(({ goalId, target }) => goalId !== owner && METRICS.slice(1).some((metric) => target.metricKey === DEFINITIONS[metric][0]))) return "conflict";
      if (bundle.every(({ target }) => selected(target))) compatibility = "historical-selected";
      else if (bundle.every(({ target }) => rollingMean(target))) {
        compatibility = "historical-rolling-mean";
        evaluation = rollingMean;
      } else return "incompatible";
      applicable = bundle;
    }
  }
  return { applicable, evaluation, compatibility };
}

/** Derive card points from canonical active goals; never convert, repair, or invent authority. */
export function resolveMealNutritionGoals(entities: readonly CanonicalEntity[], localDate: string): MealNutritionGoalContext {
  if (!DATE.test(localDate)) throw new Error("Nutrition goal resolution requires one local date.");
  const active = entities.filter((entity) => entity.family === "goal" && entity.status === "active");
  const empty = (): NutritionTargetResolution => ({ status: "missing", target: null, provenance: [] });
  const result: MealNutritionGoalContext = {
    localDate, status: "missing", activeGoalCount: active.length, compatibility: "canonical",
    targets: { calories: empty(), proteinGrams: empty(), carbsGrams: empty(), fatGrams: empty(), fiberGrams: empty() },
  };
  // Preserve the existing bounded authority gate without exposing a truncated prefix.
  if (active.length >= 200) return { ...result, status: "capacity" };
  const candidates = collectApplicableTargets(active, localDate);
  if (!candidates) return { ...result, status: "incompatible" };
  const bundle = selectCompatibleBundle(candidates);
  if (typeof bundle === "string") return { ...result, status: bundle };
  const { applicable, evaluation, compatibility } = bundle;
  result.compatibility = compatibility;
  for (const metric of METRICS) {
    const [metricKey, unit] = DEFINITIONS[metric];
    const key = metric === "calories" && result.compatibility !== "canonical" ? "calories" : metricKey;
    result.targets[metric] = resolution(applicable.filter(({ target }) => target.metricKey === key), ({ target }) =>
      target.unit === unit && point(target) && evaluation(target) && target.value >= (metric === "calories" ? 1200 : 0));
  }
  const statuses = METRICS.map((metric) => result.targets[metric].status);
  result.status = statuses.includes("conflict") ? "conflict" : statuses.includes("incompatible") ? "incompatible"
    : statuses.includes("missing") ? "missing" : "ready";
  return result;
}
