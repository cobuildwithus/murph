import { clinical, habits, restrictions } from "./observations";
import { workoutFactor } from "./workouts";
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
export function snapshot(data: MemberEvidence, at: string, age: number, sex: Sex) {
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
  const { result, ci, labs } = clinical(data, at, age, sex);
  const wear = habits(data, at, age, sex);
  if (wear.steps || wear.hip_minutes || wear.activity) delete result.activity;
  Object.assign(result, wear);
  if (
    !["steps", "hip_minutes", "activity", "vo2", "knee", "gait"].some((k) => result[k]) &&
    !restrictions(data.profile).restricted
  ) {
    const unit = model.policy.years_per_published_log_unit * shrink(age) * model.strength;
    const workout = workoutFactor(data, at, unit);
    if (workout) {
      const [key, rec] = workout;
      const remaining = Math.max(
        0,
        model.overlap.absolute_log_caps.conditioning.max_abs_log * unit - Math.abs(result.pulse?.years ?? 0),
      );
      result[key] = { ...rec, years: Math.max(-remaining, rec.years) };
    }
  }
  return Object.assign(result, published(data, at, age, sex, result, ci, labs));
}
export function comparableMovement(data: MemberEvidence, at: string, cutoff: string, current: Rows, before: Rows) {
  const changes: Record<string, number> = {};
  for (const [k, r] of Object.entries(current)) {
    const old = before[k];
    if (!old) continue;
    if (
      (r.series && r.series === old.series) ||
      (k === "smoking" && r.quit && (r.quit === old.quit || old.value === 1))
    )
      changes[k] = r.years - old.years;
  }
  for (const [group, keys] of [
    ["daily", ["pulse", "steps", "hip_minutes", "activity"]],
    ["sleep_sessions", ["sleep"]],
    ["workouts", ["running", "lifting"]],
    ["checkins", ["smoking", "alcohol", "fibre"]],
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
function canEvaluate(data: MemberEvidence, at: string, anchor: string) {
  const { whole } = ageAt(data, at, anchor),
    p = data.profile;
  const states = (data.checkins ?? []).filter((r) => eligible(r, at) && effectiveAnswer(r, at));
  const pregnancy = pick(states, "pregnant"),
    recovery = pick(states, "postpartum");
  const delivery = day(p.delivery_date);
  const postpartum = (d: string) => delivery && distance(d, delivery) >= 0 && distance(d, delivery) <= 180;
  return (
    whole >= 20 &&
    whole <= 80 &&
    (!data.joined || data.joined <= at) &&
    !p.pregnant &&
    !p.postpartum &&
    pregnancy !== true &&
    recovery !== true &&
    !postpartum(at)
  );
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
  if (!sex || !canEvaluate(data, at, at)) return null;
  const rows = snapshot(data, at, age, sex),
    factors = Object.entries(rows);
  const gap = sumYears(factors.map(([, r]) => r.years)),
    value = age + gap;
  const tenth = (n: number) => Math.floor(n * 10 + 0.5 + 1e-10);
  const parts: Record<string, number> = Object.fromEntries(
    factors.filter(([k, r]) => r.years || (coef[k] ?? 1)).map(([k, r]) => [k, Math.floor(r.years * 10)]),
  );
  const extra = tenth(value) - tenth(age) - Object.values(parts).reduce((s, n) => s + n, 0);
  const remainder = (k: string) => rows[k].years * 10 - parts[k];
  for (const k of Object.keys(parts)
    .sort((a, b) => remainder(b) - remainder(a) || (a < b ? -1 : 1))
    .slice(0, extra))
    parts[k]++;
  let unknown = 0,
    total = 0;
  for (const [k, c] of Object.entries(coef)) {
    total += c * c;
    unknown += c * c * (1 - (rows[k]?.quality ?? 0));
  }
  const half = Math.hypot(
    model.policy.completion_floor_years,
    interp(age, model.completion.age, model.completion.half_width) * Math.sqrt(unknown / total),
  );
  const cutoff = offset(at, -period);
  let days: number | null = null;
  let residual: number | null = null;
  let changes: Record<string, number> = {};
  if (canEvaluate(data, cutoff, at)) {
    changes = comparableMovement(data, at, cutoff, rows, snapshot(data, cutoff, age, sex));
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
    ...(factors.some(([k]) => model.optional.includes(k)) ? ["published_extension_unvalidated_as_combined"] : []),
  ];
  return {
    flags,
    residual,
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
    };
  const factors = finishFactors(result.rows, result.parts, result.age, result.sex);
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
      result.days == null ? "unavailable" : Object.keys(result.changes).length ? "observed" : "reference_only",
    evidence_change_years: result.residual,
    flags: result.flags,
    not_counted_yet: missingEvidence(data, at, result.rows),
    research_risk: absoluteRisk(result.unrounded, result.sex, Number(at.slice(0, 4)), result.rows),
  };
}
