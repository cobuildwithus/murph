import type { YouView } from "./contract";
import { catalog, coef, dated, model, type Rows } from "./engine/model";
import { restrictions } from "./engine/observations";
import type { YouInputs } from "./evidence";

type Tile = YouView["notCounted"][number];

// Compare missing fitted inputs by variance. For check-ins with published curves,
// use the supported range of contributions, in the same unscaled year units.
function publishedRange(key: string, age: number) {
  const { curve, age_range, shrinkage } = catalog[key];
  if (age_range && (age < age_range[0] || age > age_range[1])) return 0;
  const ratios = curve.rows?.map(row => row.ratio) ?? [];
  if (!ratios.length) return 0;
  return Math.log(Math.max(...ratios) / Math.min(...ratios)) * shrinkage;
}

export function offerings(input: YouInputs, rows: Rows, age: number): Tile[] {
  const ranked: { tile: Omit<Tile, "primary">; potential: number }[] = [];
  function add(action: Tile["action"], key: string, label: string, potential: number) {
    if (potential > 0) ranked.push({ tile: { action, key, icon: key, label }, potential });
  }
  const missingVariance = (keys: string[]) => keys.reduce((sum, key) => sum + (rows[key] ? 0 : coef[key] ** 2), 0);
  const years = model.policy.years_per_published_log_unit;
  const missingLpa = rows.lpa ? 0 : publishedRange("lpa", age) * years;
  add("bloodWork", "blood", "Blood work", missingVariance(model.calibration.blood_keys) + missingLpa ** 2);
  add("addBloodPressure", "bloodPressure", "Blood pressure", missingVariance(["sbp"]));
  if (!input.hasWearableData)
    add("connectWearable", "steps", "Connect a wearable", missingVariance(["activity", "pulse", "sleep", "vo2"]));

  const profile = input.evidence.profile;
  if (!restrictions(profile).restricted && !["gait", "knee", ...model.overlap.priority_groups.function].some(key => rows[key])) {
    const range = Math.max(publishedRange("floor_rise", age), publishedRange("balance", age));
    add("combine", "strength", "Strength", (range * years * model.feeds.self_test_quality) ** 2);
  }
  const recentFoodWeek = dated(input.evidence, "checkins", input.asOf, model.policy.protocol.food_days).some(row => row.food_week);
  if (!recentFoodWeek && !profile.eating_disorder && !(Array.isArray(profile.conditions) && profile.conditions.includes("eating_disorder")) && !rows.diet_pattern) {
    const missing = Object.keys(model.feeds.portion_grams).filter(key =>
      !rows[key] && !(rows.fibre && model.overlap.suppresses.fibre.includes(key)));
    const range = missing.reduce((sum, key) => sum + publishedRange(key, age), 0);
    const capped = Math.min(range, model.overlap.absolute_log_caps.food.max_abs_log);
    add("foodWeek", "food", "Food", (capped * years * model.feeds.food_proxy_quality) ** 2);
  }
  return ranked.sort((a, b) => b.potential - a.potential).slice(0, 4)
    .map(({ tile }, index) => ({ ...tile, primary: index === 0 }));
}
