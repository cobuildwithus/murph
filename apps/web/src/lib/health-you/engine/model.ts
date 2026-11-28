import aggregate from "./model.json";

export type Sex = "1" | "2";
export type Scalar = number | string;
export type Observation = Readonly<Record<string, unknown>>;
export interface MemberEvidence {
  profile: Observation;
  joined?: string;
  habits?: Observation[];
  food_weeks?: Observation[];
  workouts?: Observation[];
  feed_context?: Observation[];
  pressure_components?: Observation[];
  extensions?: Observation[];
  daily?: Observation[];
  sleep_sessions?: Observation[];
  checkins?: Observation[];
  labs?: Observation[];
  body?: Observation[];
  bp?: Observation[];
  vo2?: Observation[];
  meals?: Observation[];
  fitness_tests?: Observation[];
}
export type Family = Exclude<keyof MemberEvidence, "profile" | "joined">;
export type Rows = Record<string, Contribution>;
export interface Contribution {
  value: Scalar;
  unit: string;
  years: number;
  quality: number;
  percentile: number | null;
  target: Scalar | null;
  grade: string;
  reference: string;
  source: string;
  target_source: string;
  current_years?: number;
  projected_years?: number;
  landmark_years?: number | null;
  wear_confidence?: number;
  wear_age_days?: number;
  moderate_min_day?: number;
  vigorous_min_day?: number;
  level?: number;
  confidence?: number;
  series?: string;
  quit?: string;
}
export const model = aggregate;
export const MODEL_VERSION = aggregate.version;
export const YEAR = 365.2425;
export const coef: Record<string, number> = model.coef;
export const fields: Record<string, typeof model.fields.sleep> = model.fields;
export const refs: Record<string, { sd: number; ref: Record<Sex, ({ mu: number; q: number[] } | null)[]> }> =
  model.ref;
export interface Published {
  source: string;
  grade: string;
  unit: string;
  shrinkage: number;
  log_floor?: number;
  minimum?: number;
  valid_range?: number[];
  resolution?: number;
  age_range?: number[];
  requires?: Record<string, unknown>;
  method_key?: string;
  method_weights?: Record<string, number>;
  curve: {
    kind: string;
    rows?: { value: Scalar; ratio: number }[];
    reference?: Scalar;
    bounds?: number[];
    ratio?: number;
    increment?: number;
    current?: number;
  };
}
export const catalog: Record<string, Published> = model.catalog;
export function number(v: unknown): number | null {
  if (typeof v !== "number" && !(typeof v === "string" && v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function between(n: number | null, lo: number, hi: number): n is number {
  return n !== null && n >= lo && n <= hi;
}
export function day(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.slice(0, 10);
  const ms = Date.parse(s);
  return /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(ms) && new Date(ms).toISOString().startsWith(s)
    ? s
    : "";
}
export function distance(to: string, from: string) {
  return (Date.parse(to) - Date.parse(from)) / 86400000;
}
export function offset(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}
export function rowDay(r: Observation) {
  return day(r.date ?? r.timestamp ?? r.end ?? r.datetime ?? r.end_at ?? r.collected_at);
}
export function released(r: Observation, at: string) {
  return ["reported_at", "received_at"].every((k) => r[k] == null || (day(r[k]) && day(r[k]) <= at));
}
export function eligible(r: Observation, at: string) {
  return (
    rowDay(r) &&
    rowDay(r) <= at &&
    released(r, at) &&
    !["sick", "acute_illness", "invalid", "retracted"].some((k) => r[k] === true)
  );
}
export function effectiveAnswer(r: Observation, at: string) {
  return typeof r.superseded_on !== "string" || at < r.superseded_on;
}
export function dated(data: MemberEvidence, k: Family, at: string, days: number) {
  return (data[k] ?? []).filter((r) => eligible(r, at) && distance(at, rowDay(r)) <= days);
}
export function unique<T>(values: T[]) {
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
}
export function pick(rows: Observation[], field: string) {
  const matching = rows.filter((r) => r[field] != null);
  const last = matching.reduce((d, r) => (rowDay(r) > d ? rowDay(r) : d), "");
  return unique(matching.filter((r) => rowDay(r) === last).map((r) => r[field]));
}
export function interp(x: number, knots: number[], values: number[]) {
  const i = knots.findIndex((k) => k >= x);
  if (i < 0) return values[values.length - 1];
  if (!i) return values[0];
  return values[i - 1] + ((values[i] - values[i - 1]) * (x - knots[i - 1])) / (knots[i] - knots[i - 1]);
}
export function curveAt<T>(age: number, rows: (T | null)[], values: (r: T) => number[]) {
  const pairs = rows.flatMap((r, i) => (r == null ? [] : [{ age: model.knots[i], v: values(r) }]));
  if (!pairs.length || age < pairs[0].age - 5 || age > pairs[pairs.length - 1].age + 5.999) return null;
  return pairs[0].v.map((_, i) =>
    interp(
      age,
      pairs.map((p) => p.age),
      pairs.map((p) => p.v[i]),
    ),
  );
}
export function shrink(age: number) {
  return interp(age, model.policy.age_shrink_knots, model.policy.age_shrink_values);
}
export function scale(age: number) {
  return model.strength * shrink(age);
}
export function roundEven(x: number) {
  const lo = Math.floor(x);
  return x - lo === 0.5 ? lo + Math.abs(lo % 2) : Math.round(x);
}
export function percentile(value: number, qs: number[]) {
  const knots = [...new Set(qs)];
  return roundEven(
    interp(
      value,
      knots,
      knots.map((q) => {
        const ps = model.prob.filter((_, i) => qs[i] === q);
        return ps.reduce((s, p) => s + p * 100, 0) / ps.length;
      }),
    ),
  );
}
export function logTable(f: Published, x: unknown): number | null {
  const { kind, rows = [] } = f.curve;
  if (kind === "category") {
    const row = rows.find((r) => r.value === x);
    return row ? Math.log(row.ratio) : null;
  }
  if (typeof x !== "number" || !rows.length) return null;
  if (kind === "zero_bins" && x === 0) return Math.log(rows[0].ratio);
  const next = rows.findIndex((r) => Number(r.value) > x);
  const i = next < 0 ? rows.length - 1 : Math.max(0, next - 1);
  const left = rows[i],
    right = rows[i + 1];
  if (!right || x <= Number(left.value) || ["bins", "zero_bins"].includes(kind)) return Math.log(left.ratio);
  return (
    Math.log(left.ratio) +
    ((x - Number(left.value)) / (Number(right.value) - Number(left.value))) *
      Math.log(right.ratio / left.ratio)
  );
}
export function contrast(f: Published, x: unknown) {
  const c = f.curve;
  if (
    c.kind !== "category" &&
    (typeof x !== "number" ||
      !Number.isFinite(x) ||
      x < (f.minimum ?? -Infinity) ||
      (f.valid_range && !between(x, f.valid_range[0], f.valid_range[1])) ||
      (f.resolution && x % f.resolution !== 0))
  )
    return null;
  if (c.kind === "slope" && c.bounds) {
    return (
      ((Math.min(c.bounds[1], Math.max(c.bounds[0], Number(x))) - Number(c.reference)) / c.increment!) *
      Math.log(c.ratio!)
    );
  }
  const actual = logTable(f, x),
    ref = logTable(f, c.reference);
  return actual === null || ref === null ? null : actual - ref;
}
function transform(key: string, x: number) {
  if (key === "alcohol" || key === "fibre") {
    const f = catalog[key],
      log = contrast(f, x);
    return between(x, 0, 300) && log !== null ? f.shrinkage * Math.max(f.log_floor ?? -Infinity, log) : null;
  }
  const f = fields[key];
  if (!f || !between(x, f.min, f.max)) return null;
  const v = Math.max(f.low, Math.min(f.high, x));
  switch (f.transform) {
    case "down":
      return -v;
    case "log":
      return Math.log(v);
    case "downlog1p":
      return -Math.log1p(v);
    default:
      return f.transform.startsWith("abs") ? Math.abs(v - Number(f.transform.slice(3))) : v;
  }
}
type DoseKey = keyof typeof model.dose_curves;
export function dose(key: DoseKey, value: number) {
  const c = model.dose_curves[key];
  const rows = c.rows;
  if (c.kind === "zero_bins" && value === 0) return Math.log(rows[0].ratio);
  const i = Math.max(0, rows.filter((row) => Number(row.value) <= value).length - 1);
  const left = rows[i],
    right = rows[i + 1];
  if (!right || value <= Number(left.value) || c.kind === "bins" || c.kind === "zero_bins")
    return Math.log(left.ratio);
  return (
    Math.log(left.ratio) +
    ((value - Number(left.value)) / (Number(right.value) - Number(left.value))) *
      Math.log(right.ratio / left.ratio)
  );
}
function nativeLog(key: string, value: number) {
  if (key === "bmi")
    return (
      (value < 20 ? 0.3 : 0.85) *
      interp(
        value,
        [16.75, 19.25, 21.25, 23.75, 26.25, 28.75, 32.5, 37.5, 42.5],
        model.dose_curves.bmi.rows.map((r) => Math.log(r.ratio)),
      )
    );
  if (key === "sbp") return (0.85 * -Math.log(0.87) * (Math.min(180, Math.max(110, value)) - 120)) / 10;
  if (key === "waist") return (0.4 * Math.log(1.07) * (Math.min(140, Math.max(65, value)) - 85)) / 5;
  if (key === "a1c") return 0.38 * dose("hba1c", value);
  if (key === "crp") return 0.18 * dose("hs_crp", value);
  return null;
}
function nativeRank(key: string, x: number, age: number, sex: Sex, qs: number[]) {
  const ys = qs.map((q) => transform(key, q)!);
  const threshold = Math.min(...ys) + 0.2 * (Math.max(...ys) - Math.min(...ys));
  let target = qs
    .filter((_, i) => ys[i] <= threshold)
    .sort((a, b) => Math.abs(a - qs[2]) - Math.abs(b - qs[2]))[0];
  let rank: number | null = percentile(x, qs);
  const ordinal: Record<string, typeof model.ordinal.health> = model.ordinal;
  const categories = ordinal[key]?.[sex][Math.min(5, Math.max(0, Math.floor((age - 20) / 10)))];
  if (categories?.length) {
    target = Math.min(...categories.map(([level]) => level));
    rank = categories.some(([level]) => level === x)
      ? roundEven(
          100 * categories.reduce((s, [level, p]) => s + p * (level < x ? 1 : level === x ? 0.5 : 0), 0),
        )
      : null;
  }
  return { target, rank };
}

function transferYears(key: string, x: number, qs: number[], age: number, quality: number) {
  const log = nativeLog(key, x);
  if (log === null) return null;
  const center =
    key === "bmi"
      ? qs.reduce((sum, v, i) => sum + [0.175, 0.2, 0.25, 0.2, 0.175][i] * nativeLog(key, v)!, 0)
      : nativeLog(key, qs[2])!;
  return (log - center) * model.policy.years_per_published_log_unit * shrink(age) * model.strength * quality;
}

export function native(
  key: string,
  x: number,
  age: number,
  sex: Sex,
  quality = 1,
  legacy = false,
): Contribution | null {
  const d = refs[key],
    z = transform(key, x);
  if (!d || z === null) return null;
  const row = curveAt(age, d.ref[sex], (r) => [r.mu, ...r.q]);
  if (!row) return null;
  let [mu, ...qs] = row;
  if (!legacy) {
    if (key === "non_hdl") qs = curveAt(age, model.clinical_ranks.non_hdl[sex], (r) => r) ?? qs;
    if (fields[key]?.group === "blood") mu = transform(key, qs[2])!;
  }
  const transferred = legacy ? null : transferYears(key, x, qs, age, quality);
  const { target, rank } = nativeRank(key, x, age, sex, qs);
  return {
    value: x,
    unit: fields[key]?.unit ?? "g/day",
    years: transferred ?? (z - mu) * (coef[key] / d.sd) * shrink(age) * model.strength * quality,
    quality,
    target: coef[key] ? target : null,
    percentile: rank,
    grade: ["alcohol", "fibre"].includes(key) ? catalog[key].grade : "survey",
    reference: quality < 1 ? "survey proxy" : "survey",
    source:
      transferred !== null
        ? "Published dose centered at survey median"
        : ["alcohol", "fibre"].includes(key)
          ? "literature with NHANES centering"
          : "joint NHANES fit",
    target_source: "Development NHANES age/sex comparison",
  };
}
export function device(key: string, x: number, age: number, sex: Sex, legacy = false): Contribution | null {
  const d = model.hip[key === "steps" ? "steps" : "minutes"];
  const row = curveAt(age, d.refs[sex], (r) => [r.center, ...r.quantiles]);
  if (!row) return null;
  const [center, ...qs] = row,
    b = Math.min(0, d.beta) / d.sd,
    cap = legacy ? model.policy.hip_absolute_log_cap : 0.75;
  const steps = key === "steps",
    settings = model.daily;
  const quality = legacy
    ? steps
      ? settings.step_quality
      : model.policy.watch_hip_reliability
    : steps
      ? 0.76
      : 0.58;
  const originalDose = steps
    ? Math.log(
        Math.max(settings.step_floor, Math.min(x, settings.step_plateau[Number(age >= settings.step_age)])),
      )
    : Math.log1p(x);
  const log = legacy
    ? quality * b * (originalDose - center)
    : steps
      ? quality *
        (dose(
          "steps",
          Math.min(x, settings.step_plateau[Number(age >= settings.step_age)]) * settings.watch_count_ratio,
        ) -
          model.step_center)
      : quality * (dose("mvpa_device", x) - dose("mvpa_device", qs[2]));
  return {
    value: x,
    unit: key === "steps" ? "steps/day" : "moderate-equivalent min/day",
    years:
      model.policy.years_per_published_log_unit *
      Math.max(-cap, Math.min(cap, log)) *
      shrink(age) *
      model.strength,
    quality,
    percentile: percentile(x, qs),
    target: b ? qs[4] : null,
    grade: "survey bridge",
    reference: "hip monitor proxy",
    source: legacy ? "adjusted hip accelerometer fit" : "Published device dose, hip age/sex reference",
    target_source: "Age/sex upper observed decile, research hip monitor",
  };
}

export function lookup<T>(table: Record<string, T>, key: unknown): T | undefined {
  return typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;
}
export function records(value: unknown): Observation[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Compensated summation preserves small contributions in the weekly reconciliation.
export function sumYears(values: number[]) {
  let sum = 0,
    correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
    sum = next;
  }
  return sum + correction;
}
