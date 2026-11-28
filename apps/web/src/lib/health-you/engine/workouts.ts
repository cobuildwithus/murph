import {
  between,
  device,
  distance,
  eligible,
  interp,
  lookup,
  model,
  native,
  number,
  offset,
  rowDay,
  sumYears,
  type Contribution,
  type MemberEvidence,
  type Observation,
  type Rows,
  type Sex,
} from "./model";
import { factor, updateLevel, visibleRevisions } from "./daily";
import { restrictions } from "./observations";

const config = model.daily;
const lifting = new Set([
  "strength",
  "strength_training",
  "resistance_training",
  "weight_training",
  "weightlifting",
]);
const saunaSource = "https://doi.org/10.1001/jamainternmed.2014.8187";
function saunaEligible(r: Observation, age: number, sex: Sex) {
  return r.traditional_sauna === true && sex === "1" && between(age, 42, 60);
}
function sessionDose(r: Observation, age: number, sex: Sex, core: Rows): [string, number] | null {
  if (typeof r.type !== "string" || r.pain_or_stop) return null;
  const kind = r.type.trim().toLowerCase().replaceAll("-", "_");
  const minutes = number(r.minutes);
  if (!between(minutes, 1, 480)) return null;
  if (lifting.has(kind)) return ["lifting", 1];
  if (kind === "sauna") return saunaEligible(r, age, sex) ? ["sauna", 1] : null;
  if (core.hip_minutes || core.activity || (core.steps && !config.nonstep.includes(kind))) return null;
  const mod = number(r.moderate_min),
    vig = number(r.vigorous_min);
  if (r.intensity_verified === true && between(mod, 0, minutes) && between(vig, 0, minutes - mod))
    return ["aerobic", mod + 2 * vig];
  const proxy = lookup(config.workout_proxy, kind);
  return proxy === undefined ? null : ["aerobic", minutes * proxy];
}
function sessionFactor(key: string, value: number, mult: number) {
  if (key === "aerobic")
    return factor(
      key,
      value,
      "estimated moderate-equivalent min/week",
      150,
      mult *
        config.workout_quality *
        interp(
          value,
          config.aerobic_minutes,
          config.aerobic_hr.map((x) => Math.log(x)),
        ),
      config.workout_quality,
    );
  if (key === "lifting")
    return factor(
      key,
      value,
      "days/week",
      2,
      mult * config.resistance_quality * Math.log(0.86) * Math.min(1, value / 2),
      config.resistance_quality,
      undefined,
      config.sources.aerobic,
    );
  return factor(
    key,
    value,
    "days/week",
    2,
    mult * 0.08 * interp(value, [1, 2, 4], [0, Math.log(0.76), Math.log(0.6)]),
    0.08,
    undefined,
    saunaSource,
  );
}
function workoutDoses(data: MemberEvidence, at: string, age: number, sex: Sex, core: Rows) {
  const streams = new Map<string, Map<string, number>>();
  for (const row of data.workouts ?? []) {
    if (!eligible(row, at)) continue;
    const dose = sessionDose(row, age, sex, core);
    if (!dose) continue;
    const [key, v] = dose;
    const days = streams.get(key) ?? new Map();
    days.set(rowDay(row), Math.max(v, days.get(rowDay(row)) ?? 0));
    streams.set(key, days);
  }
  return streams;
}
export function workoutFactors(
  data: MemberEvidence,
  at: string,
  age: number,
  sex: Sex,
  core: Rows,
  mult: number,
) {
  const result: Rows = {};
  if (restrictions(data.profile).restricted) return result;
  const streams = workoutDoses(data, at, age, sex, core);
  for (const [key, days] of streams) {
    const dates = [...days.keys()].sort();
    if (distance(at, dates.at(-1)!) > 7) continue;
    let left = 0,
      right = 0,
      start = "",
      level: number | null = null,
      rec: Contribution | null = null;
    let first = offset(dates[0], 27);
    for (let i = 1; i < dates.length; i++) if (distance(dates[i], dates[i - 1]) >= 28) first = dates[i];
    for (let date = first; date <= at; date = offset(date, 1)) {
      while (right < dates.length && dates[right] <= date) right++;
      while (left < right && distance(date, dates[left]) >= 28) left++;
      if (
        right - left < config.workout_min_dates ||
        distance(dates[right - 1], dates[left]) < config.workout_span ||
        distance(date, dates[right - 1]) > 7
      ) {
        level = null;
        continue;
      }
      const sum = sumYears(dates.slice(left, right).map((d) => days.get(d)!));
      rec = sessionFactor(key, sum / config.workout_weeks, mult);
      if (level === null) start = date;
      level = updateLevel(level, rec.years);
    }
    if (rec && level !== null)
      result[key] = { ...rec, years: level, level, confidence: 1, series: JSON.stringify([key, start]) };
  }
  return result;
}
function habitFactor(
  key: string,
  values: number[],
  data: MemberEvidence,
  age: number,
  sex: Sex,
  core: Rows,
  mult: number,
  legacy: boolean,
): [string, Contribution] | null {
  const restricted = restrictions(data.profile).restricted,
    q = config.habit_quality;
  const sum = values.reduce((a, b) => a + b, 0);
  if (
    key === "step_goal" &&
    !restricted &&
    !["steps", "activity", "hip_minutes", "aerobic", "zone_intensity"].some((k) => core[k])
  ) {
    const rec = device("steps", sum / config.habit_days, age, sex, legacy);
    if (rec)
      return [
        "steps",
        {
          ...rec,
          years: Math.min(0, rec.years) * q,
          quality: rec.quality * q,
          reference: "verified monthly lower bound",
        },
      ];
  }
  if (key === "no_alcohol" && !core.alcohol && values.length === config.habit_days && values.every(Boolean)) {
    const rec = native("alcohol", 0, age, sex, q);
    if (rec) return ["alcohol", { ...rec, reference: "verified alcohol-free dates" }];
  }
  const v = sum / 4;
  if (key === "strength_training" && !core.lifting && !restricted)
    return [
      "lifting",
      factor(
        "lifting",
        v,
        "verified days/week",
        2,
        mult * q * Math.log(0.86) * Math.min(1, v / 2),
        q,
        undefined,
        config.sources.aerobic,
      ),
    ];
  if (key === "sauna" && !core.sauna && !restricted && sex === "1" && between(age, 42, 60))
    return [
      "sauna",
      factor(
        key,
        v,
        "verified days/week",
        2,
        mult * q * 0.08 * interp(v, [1, 2, 4], [0, Math.log(0.76), Math.log(0.6)]),
        q * 0.08,
        undefined,
        saunaSource,
      ),
    ];
  return null;
}
function verifiedHabitDays(data: MemberEvidence, at: string) {
  const streams = new Map<string, Map<string, Set<number>>>();
  for (const r of visibleRevisions(data.habits ?? [], at, (r) => r.type)) {
    if (!["wearable", "photo"].includes(String(r.verified_by)) || typeof r.done !== "boolean") continue;
    const key = String(r.type);
    if (
      !["step_goal", "strength_training", "no_alcohol", "sauna"].includes(key) ||
      (key === "sauna" && r.traditional_sauna !== true)
    )
      continue;
    const v = key === "step_goal" ? number(r.goal_steps) : 1;
    if (v === null || (key === "step_goal" && !between(v, 500, 40000))) continue;
    const dates = streams.get(key) ?? new Map<string, Set<number>>();
    const values = dates.get(rowDay(r)) ?? new Set<number>();
    dates.set(rowDay(r), values.add(r.done ? v : 0));
    streams.set(key, dates);
  }
  return streams;
}
export function verifiedHabits(
  data: MemberEvidence,
  at: string,
  age: number,
  sex: Sex,
  core: Rows,
  mult: number,
  legacy = false,
) {
  const result: Rows = {};
  const streams = verifiedHabitDays(data, at);
  for (const [key, stream] of streams) {
    const dates = [...stream.keys()].filter((d) => stream.get(d)!.size === 1).sort();
    if (!dates.length || distance(at, dates.at(-1)!) > 3) continue;
    let last = "",
      start = "",
      level: number | null = null,
      rec: [string, Contribution] | null = null;
    let left = 0;
    for (const [i, date] of dates.entries()) {
      while (distance(date, dates[left]) >= config.habit_days) left++;
      if (distance(date, dates[0]) < config.habit_days - 1 || i - left + 1 < config.habit_min_days) continue;
      rec = habitFactor(
        key,
        dates.slice(left, i + 1).map((d) => [...stream.get(d)!][0]),
        data,
        age,
        sex,
        core,
        mult,
        legacy,
      );
      if (!rec) {
        level = null;
        continue;
      }
      if (level === null || distance(date, last) > 3) {
        level = null;
        start = date;
      }
      level = updateLevel(level, rec[1].years);
      last = date;
    }
    const n = dates.filter((d) => distance(at, d) < config.habit_days).length;
    if (
      !rec ||
      level === null ||
      n < config.habit_min_days ||
      (key === "no_alcohol" && n !== config.habit_days)
    )
      continue;
    const [name, row] = rec,
      confidence = n / config.habit_days;
    result[name] = {
      ...row,
      years: level * confidence,
      level,
      confidence,
      quality: row.quality * confidence,
      series: JSON.stringify(["habit", key, start]),
    };
  }
  return result;
}
