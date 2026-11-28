import { clamp, factor } from "./daily";
import {
  fields,
  interp,
  model,
  native,
  percentile,
  refs,
  curveAt,
  sumYears,
  roundEven,
  type Rows,
  type Sex,
} from "./model";
import { blend, projectionWeight, fitted } from "./projection";

const reference = model.standalone;
const companionKeys = new Set([
  ...Object.keys(fields).filter((k) => ["blood", "body", "bp", "history"].includes(fields[k].group)),
  ...Object.keys(model.clinical_ranks),
  ...Object.keys(model.candidates),
  "lpa",
  "lpa_molar",
  "apob",
  "ldl",
  "omega_3_index",
  "weight_loss",
]);
companionKeys.delete("rdw");
export function isolatedRdw(rows: Rows) {
  return !Object.keys(rows).some((k) => companionKeys.has(k));
}
export function completeness(rows: Rows) {
  return rows.bmi && rows.smoking
    ? ["rdw", "albumin", "a1c", "crp", "creatinine", "non_hdl"].filter((k) => rows[k]).length / 6
    : 0;
}
export function comparisonValue(key: "waist" | "bmi" | "sbp", age: number, sex: Sex, value: number) {
  const bands = reference.cycle_median_ranges[key][sex];
  const low = interp(age, reference.ages, bands.low),
    high = interp(age, reference.ages, bands.high);
  const edge = clamp(value, low, high);
  if (value === edge || high <= low) return edge;
  const center = interp(age, reference.ages, reference.centers[key][sex]);
  return center + Math.max(0, 1 - Math.abs(value - edge) / (2 * (high - low))) * (edge - center);
}

function rdwQuantiles(age: number, sex: Sex) {
  const old = reference.rdw_quantiles[sex],
    local = reference.rdw_local_quantiles[sex];
  const share = clamp((Math.min(age - 20, 79 - age) - 8) / 8, 0, 1);
  return old[0].map((_, i) => {
    const baseline = interp(
      age,
      reference.ages,
      old.map((r) => r[i]),
    );
    return (
      baseline +
      share *
        (interp(
          age,
          reference.rdw_ages,
          local.map((r) => r[i]),
        ) -
          baseline)
    );
  });
}

function addPanelReference(rows: Rows, age: number, sex: Sex, year: number) {
  if (rows.bmi && rows.smoking) {
    const frac = completeness(rows);
    const centers = (["2016", "2018"] as const).map((period) => {
      const fit = model.panel.centers[period][sex];
      return (
        (1 - frac) * interp(age, model.panel.ages, fit.sparse) +
        frac * interp(age, model.panel.ages, fit.full)
      );
    });
    const center = interp(year, [2016, 2018], centers);
    rows.panel_reference = {
      ...factor(
        "panel_reference",
        roundEven(center * 10000) / 10000,
        "years",
        null,
        -center,
        1,
        "Survey reference",
        "NHANES 2015–18 examination panels",
      ),
      current_years: -center,
      projected_years: -center,
      landmark_years: null,
    };
  }
}

export function centerPanel(rows: Rows, age: number, sex: Sex, year: number, soloRdw: boolean) {
  const w = projectionWeight(age);
  if (soloRdw && rows.rdw) {
    const row = rows.rdw,
      qs = rdwQuantiles(age, sex);
    const neutral = native("rdw", qs[2], age, sex, row.quality)!;
    row.current_years! -= neutral.years;
    row.years -= (1 - w) * neutral.years;
    Object.assign(row, {
      percentile: percentile(Number(row.value), qs),
      target: qs[2],
      target_source: "Contemporary survey median",
      reference: "2013–14 NHANES RDW by age and sex",
      source: "Fitted RDW dose centered on contemporary exams",
    });
  }
  if (w)
    for (const key of ["albumin", "a1c", "rdw"]) {
      const row = rows[key];
      if (!row) continue;
      const median =
        key === "rdw" && soloRdw
          ? rdwQuantiles(age, sex)[2]
          : curveAt(age, refs[key].ref[sex], (r) => [r.q[2]])![0];
      const neutral = fitted(key, { ...row, value: median }, sex) ?? 0;
      row.projected_years = 0 + (row.projected_years! - neutral);
      row.years -= w * neutral;
    }
  for (const key of ["bmi", "sbp"] as const) {
    const row = rows[key];
    if (
      !row ||
      (key === "bmi"
        ? rows.smoking
        : year < 2015 || Object.keys(rows).some((k) => k !== "sbp" && (companionKeys.has(k) || k === "rdw")))
    )
      continue;
    const center =
      year >= 2015
        ? comparisonValue(key, age, sex, Number(row.value))
        : curveAt(age, refs[key].ref[sex], (r) => [r.q[2]])![0];
    const neutral = native(key, center, age, sex, row.quality)!;
    blend({ [key]: neutral }, age, sex);
    for (const field of ["years", "current_years", "projected_years"] as const)
      if (neutral[field] !== undefined) row[field] = row[field]! - neutral[field]!;
    if (year >= 2015)
      row.centering_reference =
        "Range of 2009–14 survey medians for " + (key === "bmi" ? "BMI" : "systolic pressure");
  }
  addPanelReference(rows, age, sex, year);
  const gap = sumYears(Object.values(rows).map((r) => r.years)),
    limit = model.policy.max_display_gap;
  if (Math.abs(gap) > limit) {
    const adjustment = Math.sign(gap) * limit - gap;
    rows.display_limit = {
      ...factor(
        "display_limit",
        limit,
        "years",
        null,
        adjustment,
        0,
        "Display convention",
        "Research display range",
      ),
      current_years: adjustment,
      projected_years: adjustment,
      landmark_years: null,
      reference: "Maximum displayed difference from chronological age",
    };
  }
}
