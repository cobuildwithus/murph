import { clinical, habits } from "./observations";
import { published } from "./extensions";
import {
  coef,
  day,
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
  // A projected birth year does not establish a birthday. Keep calendar-year precision.
  const born = number(p.birth_year);
  if (born !== null) return { age: year - born, whole: year - born };
  const n = number(p.age);
  const age = n === null ? NaN : n + distance(date, day(p.age_as_of) || anchor) / YEAR;
  return { age, whole: Math.floor(age + 1e-8) };
}
export function snapshot(data: MemberEvidence, at: string, age: number, sex: Sex) {
  const { result, ci, labs } = clinical(data, at, age, sex);
  const wear = habits(data, at, age, sex);
  if (wear.steps || wear.hip_minutes || wear.activity) delete result.activity;
  Object.assign(result, wear);
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
  const states = (data.checkins ?? []).filter((r) => eligible(r, at));
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
  const gap = factors.reduce((s, [, r]) => s + r.years, 0),
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
    model.completion.reference * Math.sqrt(unknown / total),
  );
  const cutoff = offset(at, -period);
  let days: number | null = null;
  let changes: Record<string, number> = {};
  if (canEvaluate(data, cutoff, at)) {
    changes = comparableMovement(data, at, cutoff, rows, snapshot(data, cutoff, age, sex));
    days = Math.round((period + YEAR * Object.values(changes).reduce((a, b) => a + b, 0)) * 100) / 100;
  }
  return {
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
