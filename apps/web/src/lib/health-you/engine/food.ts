import {
  between,
  dated,
  day,
  distance,
  eligible,
  isObject,
  model,
  native,
  number,
  rowDay,
  type MemberEvidence,
  type Observation,
  type Rows,
  type Sex,
} from "./model";
import { clamp, factor, replay, visibleRevisions, type StreamDates } from "./daily";
const config = model.daily;
function pattern(r: Observation, profile: Observation) {
  const answers = r.answers;
  if (
    r.complete !== true ||
    !isObject(answers) ||
    !between(number(answers.eating_days), 1, 7) ||
    ("week_end" in r && !between(distance(rowDay(r), day(r.week_end)), 1, 7))
  )
    return null;
  const parts: number[] = [];
  for (const [k, target] of Object.entries(config.food_targets)) {
    const v = number(answers[k]);
    if (!between(v, 0, 140)) return null;
    const ratio = Math.min(1, v / target);
    parts.push(["red_meat", "processed_meat", "sweet_drinks_juice"].includes(k) ? 1 - ratio : ratio);
  }
  parts.splice(4, 2, (parts[4] + parts[5]) / 2);
  const fish = number(answers.fish);
  if (between(fish, 0, 28) && !(profile.vegan || profile.vegetarian || profile.fish_free))
    parts.push(Math.min(1, fish / 2));
  const drinks = number(answers.alcohol),
    peak = number(answers.most_in_one_sitting);
  return {
    value: (100 * parts.reduce((a, b) => a + b, 0)) / parts.length,
    quality: (config.food_quality * parts.length) / 7,
    drinks:
      between(drinks, 0, 150) && (!("most_in_one_sitting" in answers) || between(peak, 0, drinks))
        ? drinks
        : null,
  };
}
function inconsistentMealEnergy(r: Observation) {
  const kcal = number(r.calories),
    protein = number(r.protein_g),
    carbs = number(r.carbs_g),
    fat = number(r.fat_g);
  return;
  between(kcal, 1, 8000) &&
    between(protein, 0, 1000) &&
    between(carbs, 0, 1000) &&
    between(fat, 0, 1000) &&
    Math.abs(4 * (protein + carbs) + 9 * fat - kcal) > Math.max(120, 0.45 * kcal);
}
function confirmedMealDays(ci: Observation[]) {
  const complete = new Map<string, Set<boolean>>();
  for (const r of ci)
    if (typeof r.diet_day_complete === "boolean")
      complete.set(rowDay(r), (complete.get(rowDay(r)) ?? new Set()).add(r.diet_day_complete));
  return complete;
}
function mealDays(data: MemberEvidence, at: string, ci: Observation[]) {
  const complete = confirmedMealDays(ci);
  const meals = new Map<string, Map<unknown, number>>(),
    invalid = new Set<string>();
  for (const r of visibleRevisions(data.meals ?? [], at, (r) => r.id, true)) {
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
export function foodFactors(
  data: MemberEvidence,
  at: string,
  age: number,
  sex: Sex,
  ci: Observation[],
  core: Rows,
  mult: number,
) {
  const result: Rows = {};
  const weeks = dated(data, "food_weeks", at, 42)
    .flatMap((r) => {
      const row = pattern(r, data.profile);
      return row ? [{ date: rowDay(r), ...row }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const week = weeks[0];
  const disordered =
    data.profile.eating_disorder ||
    (Array.isArray(data.profile.conditions) && data.profile.conditions.includes("eating_disorder"));
  if (
    week &&
    weeks.every(
      (w) =>
        w.date !== week.date ||
        (w.value === week.value && w.quality === week.quality && w.drinks === week.drinks),
    )
  ) {
    if (!disordered)
      result.food_pattern = factor(
        "food_pattern",
        week.value,
        "partial pattern /100",
        100,
        mult * week.quality * Math.log(config.food_hr_span) * (week.value / 100 - 0.5),
        week.quality,
        "C, seven-day pattern proxy",
      );
    if (week.drinks !== null && !core.alcohol) {
      const rec = native("alcohol", week.drinks * 2, age, sex, 0.3);
      if (rec) result.alcohol = { ...rec, reference: "reported seven-day alcohol proxy" };
    }
  }
  if (!disordered && !ci.some((r) => "habitual_fibre_g_day" in r && distance(at, rowDay(r)) <= 90)) {
    const rec = replay("meal_fibre", mealDays(data, at, ci), at, (v) =>
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
  return result;
}
