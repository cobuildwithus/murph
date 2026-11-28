import {
  between,
  day,
  distance,
  eligible,
  model,
  number,
  rowDay,
  unique,
  type MemberEvidence,
  type Observation,
  type Rows,
} from "./model";
import {
  clamp,
  factor,
  median,
  onset,
  releasedGroups,
  replay,
  visibleRevisions,
  type StreamDates,
} from "./daily";

const config = model.daily;

function inconsistentMealEnergy(r: Observation): boolean {
  const kcal = number(r.calories),
    protein = number(r.protein_g),
    carbs = number(r.carbs_g),
    fat = number(r.fat_g);
  return (
    between(kcal, 1, 8000) &&
    between(protein, 0, 1000) &&
    between(carbs, 0, 1000) &&
    between(fat, 0, 1000) &&
    Math.abs(4 * (protein + carbs) + 9 * fat - kcal) > Math.max(120, 0.45 * kcal)
  );
}
function confirmedMealDays(ci: Observation[]) {
  const complete = new Map<string, Set<boolean>>();
  for (const r of ci)
    if (typeof r.diet_day_complete === "boolean")
      complete.set(rowDay(r), (complete.get(rowDay(r)) ?? new Set()).add(r.diet_day_complete));
  return complete;
}
function mealDays(groups: Observation[][], at: string, ci: Observation[]) {
  const complete = confirmedMealDays(ci);
  const meals = new Map<string, Map<unknown, number>>(),
    invalid = new Set<string>();
  for (const r of groups.flat()) {
    const date = rowDay(r),
      confirmed = complete.get(date);
    if (r.eaten === false || !confirmed?.has(true) || confirmed.has(false)) continue;
    const v = number(r.fiber_g ?? r.fibre_g),
      ids = meals.get(date) ?? new Map();
    if (
      !eligible(r, at) ||
      r.partial ||
      r.confirmed === false ||
      !["number", "string"].includes(typeof r.id) ||
      !between(v, 0, 100) ||
      (ids.has(r.id) && ids.get(r.id) !== v) ||
      inconsistentMealEnergy(r)
    ) {
      invalid.add(date);
      continue;
    }
    meals.set(date, ids.set(r.id, v));
  }
  const dates: StreamDates = new Map();
  for (const [date, ids] of meals) {
    const total = [...ids.values()].reduce((a, b) => a + b, 0);
    if (!invalid.has(date) && total <= 100)
      dates.set(date, new Map([["confirmed food log", new Set([total])]]));
  }
  return dates;
}
type MealDay = { count: number; calories: number; fibre: number; valid: boolean };
type Dose = { at: number; key: "caffeine_timing" | "alcohol_timing" };

function loggedMeals(groups: Observation[][], at: string) {
  const days = new Map<string, MealDay>();
  const doses: Dose[] = [];
  for (const rows of groups) {
    const { id } = rows[0];
    if (!(typeof id === "string" ? id.length > 0 : Number.isInteger(id))) continue;
    if (
      rows.some(
        (r) => !eligible(r, at) || r.partial || r.off_body || r.eaten === false || r.confirmed === false,
      )
    )
      continue;
    const date = rowDay(rows[0]);
    const dayTotal = days.get(date) ?? { count: 0, calories: 0, fibre: 0, valid: true };
    const calories = unique(rows.map((r) => number(r.calories)));
    const fibre = unique(rows.map((r) => number("fiber_g" in r ? r.fiber_g : r.fibre_g)));
    if (
      between(calories, 50, 4000) &&
      between(fibre, 0, 100) &&
      (1000 * fibre) / calories <= 80 &&
      !rows.some(inconsistentMealEnergy)
    ) {
      dayTotal.count++;
      dayTotal.calories += calories;
      dayTotal.fibre += fibre;
    } else dayTotal.valid = false;
    days.set(date, dayTotal);
    for (const [field, key, max] of [
      ["caffeine_mg", "caffeine_timing", 1200],
      ["alcohol_g", "alcohol_timing", 200],
    ] as const) {
      const dose = unique(rows.map((r) => number(r[field])));
      if (!between(dose, 0, max) || !dose) continue;
      const stamp = unique(
        rows.map(({ timestamp }) =>
          typeof timestamp === "string" &&
          day(timestamp) === date &&
          /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp)
            ? Date.parse(timestamp)
            : null,
        ),
      );
      if (stamp !== null && Number.isFinite(stamp)) doses.push({ at: stamp, key });
    }
  }
  return { days, doses };
}

function densityFactor(days: Map<string, MealDay>, at: string, mult: number) {
  const cfg = config.logged_meals;
  const dates: StreamDates = new Map();
  let meals = 0,
    recentDates = 0;
  for (const [date, total] of days) {
    if (!total.valid || total.calories < cfg.min_kcal) continue;
    dates.set(date, new Map([["logged nutrients", new Set([(1000 * total.fibre) / total.calories])]]));
    if (distance(at, date) < config.window) {
      recentDates++;
      meals += Math.min(3, total.count);
    }
  }
  const row = replay("meal_density", dates, at, (value) =>
    factor(
      "meal_density",
      value,
      "g/1,000 logged kcal",
      null,
      (mult * cfg.quality * Math.log(cfg.fibre_hr) * (clamp(value, cfg.low, cfg.high) - cfg.center)) /
        cfg.step,
      cfg.quality,
      "C, selective meal log",
      config.sources.meal_fibre,
    ),
  );
  if (!row) return null;
  const reliability = meals / (3 * recentDates);
  return {
    ...row,
    reference: "Energy-weighted within logged dates",
    years: row.years * reliability,
    quality: row.quality * reliability,
    confidence: row.confidence * reliability,
  };
}

function timingFactors(data: MemberEvidence, at: string, doses: Dose[]): Rows {
  const out: Rows = {};
  if (!doses.length) return out;
  const nights = new Map<string, Set<number>>();
  for (const row of visibleRevisions(data.sleep_sessions ?? [], at, (r) => [r.source, r.type])) {
    const date = rowDay(row);
    if (distance(at, date) >= 14 || (row.type != null && row.type !== "main") || onset(row) === null)
      continue;
    const starts = nights.get(date) ?? new Set<number>();
    nights.set(date, starts.add(Date.parse(String(row.start_at))));
  }
  const starts = [...nights.values()]
    .filter((s) => s.size === 1)
    .map((s) => [...s][0])
    .sort((a, b) => a - b);
  for (const key of ["caffeine_timing", "alcohol_timing"] as const) {
    const closest = new Map<number, number>();
    for (const dose of doses) {
      if (dose.key !== key) continue;
      const start = starts.find((t) => t >= dose.at);
      if (start === undefined) continue;
      const hours = (start - dose.at) / 3_600_000;
      if (hours <= 18) closest.set(start, Math.min(hours, closest.get(start) ?? Infinity));
    }
    if (closest.size < 3) continue;
    out[key] = factor(
      key,
      median([...closest.values()]),
      "hours before main sleep",
      null,
      0,
      0,
      "C, sleep timing context",
    );
  }
  return out;
}

export function mealFactors(
  data: MemberEvidence,
  at: string,
  ci: Observation[],
  habitualFibre: boolean,
  mult: number,
) {
  const result: Rows = {};
  if (!data.meals?.length) return result;
  const groups = releasedGroups(data.meals, at, (r) => String(r.id));
  if (!habitualFibre && ci.some((r) => r.diet_day_complete === true)) {
    const rec = replay("meal_fibre", mealDays(groups, at, ci), at, (v) =>
      factor(
        "meal_fibre",
        v,
        "g/day",
        30,
        (mult * config.meal_quality * Math.log(0.89) * (clamp(v, 10, 35) - 20)) / 10,
        config.meal_quality,
      ),
    );
    if (rec) result.meal_fibre = rec;
  }
  const { days, doses } = loggedMeals(groups, at);
  if (!habitualFibre && !result.meal_fibre) {
    const density = densityFactor(days, at, mult);
    if (density) result.meal_density = density;
  }
  return Object.assign(result, timingFactors(data, at, doses));
}
