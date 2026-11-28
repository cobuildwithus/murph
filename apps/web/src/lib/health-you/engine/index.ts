import { projectionSummary, projectionWeight, blend, centerClinical } from "./projection";
import { combineContext } from "./combine";
import { workoutZones } from "./workout-zones";
import { studyFactors } from "./instruments";
import { clinical, habits, labValues } from "./observations";
import { foodFactors } from "./food";
import { capFamily, clinicalMarkers } from "./clinical-markers";
import { workoutFactors, verifiedHabits } from "./workouts";
import { finishFactors, missingEvidence, absoluteRisk } from "./report";
import { adapt } from "./feeds";
import { published } from "./extensions";
import {
  coef,
  sumYears,
  dated,
  interp,
  shrink,
  roundEven,
  type Observation,
  day,
  effectiveAnswer,
  eligible,
  pick,
  distance,
  model,
  lookup,
  number,
  offset,
  rowDay,
  YEAR,
  type MemberEvidence,
  type Rows,
  type Sex,
} from "./model";
export { MODEL_VERSION } from "./model";
export type { MemberEvidence } from "./model";

export function ageAt(data: MemberEvidence, date: string, anchor: string) {
  const p = data.profile,
    year = Number(date.slice(0, 4)),
    birth = day(p.birth_date);
  if (birth)
    return {
      age: distance(date, birth) / YEAR,
      whole: year - Number(birth.slice(0, 4)) - Number(date.slice(5) < birth.slice(5)),
    };
  const n = number(p.age);
  const age = n === null ? NaN : n + distance(date, day(p.age_as_of) || anchor) / YEAR;
  return { age, whole: Math.floor(age + 1e-8) };
}
export function snapshot(
  data: MemberEvidence,
  at: string,
  age: number,
  sex: Sex,
  legacy = false,
  reasons: Record<string, string> = {},
) {
  const conditions = dated(data, "checkins", at, model.policy.protocol.checkin_days).filter((r) =>
    Array.isArray(r.conditions),
  );
  if (conditions.length) {
    const latest = conditions.map(rowDay).sort().at(-1);
    const baseline = Array.isArray(data.profile.conditions) ? data.profile.conditions : [];
    data = {
      ...data,
      profile: {
        ...data.profile,
        conditions: [
          ...baseline,
          ...conditions
            .filter((r) => rowDay(r) === latest)
            .flatMap((r) => (Array.isArray(r.conditions) ? r.conditions : [])),
        ],
      },
    };
  }
  const { result, ci, labs } = clinical(data, at, age, sex, legacy);
  if (["night", "rotating"].includes(String(pick(ci, "work_schedule"))))
    data = { ...data, profile: { ...data.profile, shift_worker: true } };
  const wear = habits(data, at, age, sex, legacy);
  if (wear.steps || wear.hip_minutes || wear.activity) delete result.activity;
  Object.assign(result, wear);
  const mult = model.policy.years_per_published_log_unit * shrink(age) * model.strength;
  const workouts = workoutFactors(data, at, age, sex, result, mult);
  const zones = !legacy && workoutZones(data, at, result, mult);
  if (zones) {
    delete workouts.aerobic;
    workouts.zone_intensity = zones;
  }
  Object.assign(result, workouts, foodFactors(data, at, age, sex, ci, { ...result, ...workouts }, mult));
  const caps = model.overlap.absolute_log_caps;
  Object.assign(
    result,
    published(
      data,
      at,
      age,
      sex,
      result,
      result.food_pattern ? ci.filter((r) => !("food_proxy" in r)) : ci,
      labs,
      legacy,
    ),
  );
  if (caps.food.factors.some((k) => k !== "fibre" && result[k])) delete result.food_pattern;
  const streaks = verifiedHabits(data, at, age, sex, result, mult, legacy);
  Object.assign(result, streaks);
  if (result.sleep_regularity) delete result.onset_sd;
  capFamily(
    result,
    [...caps.food.factors, "food_pattern", "meal_fibre", "meal_density"],
    model.daily.food_cap * mult,
  );
  capFamily(result, ["sleep", "onset_sd", "sleep_regularity", "l5_midpoint"], model.daily.sleep_cap * mult);
  if ([wear, workouts, streaks].some((r) => Object.keys(r).length))
    capFamily(
      result,
      [
        ...caps.conditioning.factors,
        "pulse",
        "hip_minutes",
        "activity",
        "aerobic",
        "zone_intensity",
        "knee",
        "gait",
        "vo2",
      ],
      mult * (legacy ? caps.conditioning.max_abs_log : 0.9),
    );
  clinicalMarkers(result, data, at, age, sex, mult, labs.non_hdl, legacy);
  if (!legacy) {
    centerClinical(result, age, sex, mult);
    studyFactors(data, at, result, age, sex, reasons);
    blend(result, age, sex);
  }
  return result;
}
export function comparableMovement(
  data: MemberEvidence,
  at: string,
  cutoff: string,
  current: Rows,
  before: Rows,
) {
  const changes: Record<string, number> = {};
  for (const [k, r] of Object.entries(current)) {
    const old = before[k];
    if (!old) continue;
    if (
      (r.series && r.series === old.series) ||
      (k === "smoking" && r.quit && (r.quit === old.quit || old.value === 1))
    )
      changes[k] =
        r.level !== undefined && old.level !== undefined
          ? (r.level - old.level) * Math.min(r.confidence!, old.confidence!)
          : r.years - old.years;
  }
  for (const [group, keys] of [
    ["daily", ["pulse", "steps", "hip_minutes", "activity", "hrv"]],
    ["sleep_sessions", ["sleep", "onset_sd"]],
    ["workouts", ["aerobic", "zone_intensity", "lifting", "sauna"]],
    ["meals", ["meal_fibre", "meal_density"]],
    ["habits", ["steps", "lifting", "sauna", "alcohol"]],
    ["checkins", ["smoking", "alcohol", "fibre", "meal_fibre", "meal_density"]],
  ] as const) {
    if (
      data[group]?.some((r) =>
        [day(r.reported_at), day(r.received_at)].some((d) => d > cutoff && d <= at && d > rowDay(r)),
      )
    )
      keys.forEach((k) => delete changes[k]);
  }
  return changes;
}
export function pauseReason(data: MemberEvidence, at: string, anchor: string) {
  const { whole } = ageAt(data, at, anchor),
    p = data.profile;
  const states = (data.checkins ?? []).filter((r) => eligible(r, at) && effectiveAnswer(r, at));
  const pregnancy = pick(states, "pregnant"),
    recovery = pick(states, "postpartum");
  const delivery = day(p.delivery_date);
  const postpartum = (d: string) => delivery && distance(d, delivery) >= 0 && distance(d, delivery) <= 180;
  if (p.pregnant || pregnancy === true) return "pregnant";
  if (p.postpartum || recovery === true || postpartum(at)) return "postpartum";
  if (!["m", "male", "f", "female"].includes(String(p.sex).toLowerCase())) return "sex";
  if (!Number.isFinite(whole)) return "birthDate";
  if (whole < 20 || whole > 80) return "age";
  if (data.joined && data.joined > at) return "beforeJoining";
  return null;
}
export function score(data: MemberEvidence, at: string, period = 7) {
  if (!day(at)) throw new Error("Invalid evaluation date");
  const { age } = ageAt(data, at, at),
    p = data.profile;
  const sex: Sex | null = ["m", "male"].includes(String(p.sex).toLowerCase())
    ? "1"
    : ["f", "female"].includes(String(p.sex).toLowerCase())
      ? "2"
      : null;
  if (!sex || pauseReason(data, at, at)) return null;
  const reasons: Record<string, string> = {};
  const rows = snapshot(data, at, age, sex, false, reasons),
    factors = Object.entries(rows);
  const gap = sumYears(factors.map(([, r]) => r.years)),
    value = age + gap;
  const tenth = (n: number) => Math.floor(n * 10 + 0.5 + 1e-10);
  const parts: Record<string, number> = Object.fromEntries(
    factors
      .filter(
        ([k, r]) =>
          r.years || (r.quality && (coef[k] ?? 1) && (lookup(model.clinical_fit.coefficients, k) ?? 1)),
      )
      .map(([k, r]) => [k, Math.floor(r.years * 10)]),
  );
  const extra = tenth(value) - tenth(age) - Object.values(parts).reduce((s, n) => s + n, 0);
  const remainder = (k: string) => rows[k].years * 10 - parts[k];
  for (const k of Object.keys(parts)
    .sort((a, b) => remainder(b) - remainder(a) || (a < b ? -1 : 1))
    .slice(0, extra))
    parts[k]++;
  const panel = model.completion;
  const weights = Object.entries(panel.weights);
  const observed =
    sumYears(weights.map(([k, weight]) => weight * (rows[k]?.quality ?? 0))) /
    sumYears(weights.map(([, weight]) => weight));
  const half =
    Math.abs(gap - sumYears(factors.map(([, r]) => r.current_years!))) +
    2 * Math.max(0, ...factors.map(([, r]) => 1 - (r.wear_confidence ?? 1))) +
    interp(
      observed,
      panel.fractions,
      panel.widths.map((width) => interp(age, panel.age, width)),
    );
  const cutoff = offset(at, -period);
  let days: number | null = null;
  let residual: number | null = null;
  let changes: Record<string, number> = {};
  let reassessment: number | null = null;
  if (!pauseReason(data, cutoff, at)) {
    const fixed = snapshot(data, cutoff, age, sex);
    changes = comparableMovement(data, at, cutoff, rows, fixed);
    reassessment =
      roundEven(
        sumYears(
          Object.entries(changes)
            .filter(
              ([k]) =>
                rows[k].wear_confidence !== undefined &&
                rows[k].level !== undefined &&
                fixed[k]?.level !== undefined,
            )
            .map(([k, move]) => rows[k].years - fixed[k].years - move),
        ) * 1e8,
      ) / 1e8;
    const move = sumYears(
      Object.keys(changes)
        .sort()
        .map((k) => changes[k]),
    );
    days = roundEven((period + YEAR * move) * 100) / 100;
    const before = snapshot(data, cutoff, ageAt(data, cutoff, at).age, sex);
    residual = roundEven((gap - sumYears(Object.values(before).map((r) => r.years)) - move) * 1e8) / 1e8;
  }
  const flags = [
    ...(p.approximate_birth_date ? ["birth_year_midpoint_assumed"] : []),
    ...(value < 20 || value > 79 ? ["age_equivalent_outside_training_range"] : []),
    ...(ageAt(data, at, at).whole === 80 ? ["chronological_age_extrapolation"] : []),
    ...(factors.some(
      ([k]) => Object.hasOwn(model.coverage.factors, k) || Object.hasOwn(model.evidence.factors, k),
    )
      ? ["extension_age_effects_uncalibrated"]
      : []),
    ...(projectionWeight(age) ? ["historical_projection_research_only"] : []),
    ...(factors.some(
      ([k]) =>
        model.optional.includes(k) ||
        [
          "onset_sd",
          "meal_fibre",
          "meal_density",
          "food_pattern",
          "aerobic",
          "apob",
          "steps",
          "sleep",
          "pulse",
        ].includes(k),
    )
      ? ["published_extension_unvalidated_as_combined"]
      : []),
  ];
  return {
    flags,
    residual,
    reasons,
    reassessment,
    unrounded: value,
    sex,
    age,
    real: tenth(age) / 10,
    value: tenth(value) / 10,
    gap: (tenth(value) - tenth(age)) / 10,
    low: Math.floor((value - half) * 10) / 10,
    high: Math.ceil((value + half) * 10) / 10,
    outside: value < 20 || value > 79,
    parts,
    rows,
    days,
    changes,
  };
}

/** Full research parity entry point. The private view selects consumer fields independently. */
export function fromRaw(member: Observation, at: string, history?: Observation) {
  const data = adapt(member, history),
    result = score(data, at);
  if (!result)
    return {
      version: model.version,
      as_of: at,
      state: "unavailable",
      chronological_age: null,
      biological_age: null,
      interval: null,
      contributions_tenths: {},
      coverage: [],
      ranks: {},
      rank_details: {},
      factors: {},
      days_aged: null,
      weekly_state: "unavailable",
      evidence_change_years: null,
      flags: [],
      not_counted_yet: [],
      research_risk: null,
      projection: null,
      combine_context: {},
      wearable_reassessment_years: null,
    };
  const factors = finishFactors(result.rows, result.parts, result.age, result.sex);
  const riskRows = snapshot(data, at, result.age, result.sex, true);
  const ranks = Object.fromEntries(Object.entries(factors).map(([k, r]) => [k, r.percentile]));
  return {
    version: model.version,
    as_of: at,
    state: Object.keys(result.parts).length ? "measured" : "reference_only",
    chronological_age: result.real,
    biological_age: result.value,
    interval: [result.low, result.high],
    contributions_tenths: result.parts,
    coverage: Object.keys(factors).sort(),
    ranks,
    rank_details: Object.fromEntries(
      Object.entries(factors)
        .filter(([, r]) => r.percentile !== null)
        .map(([k, r]) => [k, { percentile: r.percentile, reference: r.reference }]),
    ),
    factors,
    days_aged: result.days,
    weekly_state:
      result.days == null
        ? "unavailable"
        : Object.keys(result.changes).length
          ? "observed"
          : "reference_only",
    evidence_change_years: result.residual,
    flags: result.flags,
    wearable_reassessment_years: result.reassessment,
    projection: projectionSummary(result.rows, result.age, result.sex),
    combine_context: combineContext(data, at, result.age, result.sex),
    not_counted_yet: missingEvidence(data, at, result.rows, result.reasons),
    research_risk: {
      scope: "current_r5_measurements",
      ...absoluteRisk(
        result.age + sumYears(Object.values(riskRows).map((r) => r.years)),
        result.sex,
        Number(at.slice(0, 4)),
        riskRows,
        result.age,
        labValues(data, at).non_hdl,
      ),
    },
  };
}
