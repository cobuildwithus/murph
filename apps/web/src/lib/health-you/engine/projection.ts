import {
  between,
  curveAt,
  dose,
  interp,
  lookup,
  model,
  number,
  refs,
  shrink,
  sumYears,
  type Contribution,
  type Rows,
  type Sex,
} from "./model";
import { capFamily, filtration } from "./clinical-markers";
import { clamp } from "./daily";

const fit = model.landmark,
  policy = model.projection;
export const projectionWeight = (age: number) => interp(age, policy.blend_age, policy.blend_weight);

function standardized(key: string, row: Contribution) {
  const spec = lookup(fit.specs, key);
  if (!spec || (key === "pulse" && (row.series || row.unit !== "bpm"))) return null;
  const [lo, hi, center, sd, kind] = spec;
  const v = number(row.value);
  if (!between(v, Number(lo), Number(hi))) return null;
  const z = (v - Number(center)) / Number(sd);
  return clamp(kind === "above" ? Math.max(0, z) : kind === "below" ? Math.max(0, -z) : z, -3, 3);
}
function fitted(key: string, row: Contribution, sex: Sex) {
  const z = standardized(key, row);
  return z === null
    ? null
    : (row.quality * (z - lookup(fit.refs, key)![sex]) * lookup(fit.beta, key)!) / fit.slope;
}

export function blend(rows: Rows, age: number, sex: Sex) {
  const w = projectionWeight(age);
  for (const [key, row] of Object.entries(rows)) {
    row.current_years = row.years;
    if (!w) continue;
    const landmark = fitted(key, row, sex);
    const transport = policy.transport.includes(key) ? 1 : (lookup(policy.limited_transport, key) ?? 0);
    const projected = transport ? (row.years * transport) / shrink(age) : (landmark ?? 0);
    row.landmark_years = landmark;
    row.projected_years = projected;
    row.years = (1 - w) * row.years + w * projected;
    if (row.level !== undefined) row.level *= 1 - w + (w * transport) / shrink(age);
    if (["albumin", "a1c", "rdw"].includes(key)) {
      const median = curveAt(age, refs[key].ref[sex], (r) => [r.q[2]])![0];
      const center = fitted(key, { ...row, value: median }, sex) ?? 0;
      row.projected_years -= center;
      row.years -= w * center;
    }
  }
}

export function projectionSummary(rows: Rows, age: number, sex: Sex) {
  const weight = projectionWeight(age);
  if (!weight) return null;
  const factors = Object.values(rows);
  const fitGap = sumYears(factors.map((r) => r.landmark_years ?? 0));
  const rate = Math.exp(fit.intercept + fit.male * Number(sex === "1") + fit.slope * fitGap);
  const matched = fit.keys.flatMap((k, i) =>
    rows[k]?.landmark_years != null ? [{ k, i, z: standardized(k, rows[k])!, q: rows[k].quality }] : [],
  );
  const start = 3 + Number(sex) * fit.keys.length;
  const ages: number[] = [],
    risks: number[] = [];
  for (const rep of model.bootstrap) {
    const [intercept, male, slope] = rep;
    const contrast = sumYears(matched.map(({ i, z, q }) => q * (z - rep[start + i]) * rep[3 + i]));
    ages.push(45 + contrast / slope);
    const base = Math.exp(intercept + male * Number(sex === "1") + contrast);
    risks.push(-Math.expm1((-base * Math.expm1(5 * slope)) / slope));
  }
  function bounds(values: number[]) {
    values.sort((a, b) => a - b);
    return [0.025, 0.975].map((p) => {
      const i = (values.length - 1) * p,
        lo = Math.floor(i);
      return values[lo] + (values[Math.ceil(i)] - values[lo]) * (i - lo);
    });
  }
  return {
    weight,
    midlife_age_fit_ci95: bounds(ages),
    five_year_risk_fit_ci95: bounds(risks),
    current_age: age + sumYears(factors.map((r) => r.current_years!)),
    projected_age: age + sumYears(factors.map((r) => r.projected_years!)),
    midlife_equivalent_age: 45 + fitGap,
    condition: "survived_to_45",
    historical_panel_risk: Object.fromEntries(
      policy.horizons.map((h) => [h, -Math.expm1((-rate * Math.expm1(fit.slope * h)) / fit.slope)]),
    ),
    matched_factors: matched.map((m) => m.k).sort(),
  };
}

function clinicalLog(key: string, v: number) {
  if (key === "egfr") return 0.65 * dose(key, v);
  if (key === "fasting_glucose") return 0.38 * dose(key, v);
  if (key === "apob") return (v / 23.8) * Math.log(1.11) * 0.45;
  if (key === "ldl" || key === "non_hdl")
    return (v / 38.67) * Math.log(1 / 0.9) * (key === "ldl" ? 0.85 : 0.5);
  return null;
}

function capClinicalFamilies(rows: Rows, mult: number) {
  for (const [group, owner, cap] of [
    ["iron", "hemoglobin", 0.12],
    ["vitamins", "homocysteine", 0.1],
  ] as const)
    capFamily(
      rows,
      Object.entries(model.candidates)
        .filter(([, r]) => r.group === group)
        .map(([k]) => k),
      Math.max(0, cap * mult - Math.abs(rows[owner]?.years ?? 0)),
    );
  capFamily(rows, ["acr", "egfr", "creatinine"], 0.85 * mult);
  capFamily(rows, ["ldl", "non_hdl", "apob", "lpa", "lpa_molar", "triglycerides"], 0.45 * mult);
  capFamily(rows, ["a1c", "fasting_glucose", "homa_ir", "diabetes"], 0.65 * mult);
  if (rows.bmi?.years > 0)
    rows.bmi.years -=
      0.25 *
      Math.min(
        rows.bmi.years,
        Math.max(0, ...["sbp", "a1c", "fasting_glucose"].map((k) => rows[k]?.years ?? 0)),
      );
}

export function centerClinical(rows: Rows, age: number, sex: Sex, mult: number) {
  if (rows.bmi) for (const k of ["waist", "whtr"]) if (rows[k]) rows[k].years = 0;
  for (const [k, row] of Object.entries(rows)) {
    if (k === "whtr" || k === "weight_loss") continue;
    const ref = lookup(model.clinical_ranks, k)?.[sex];
    if (!ref) continue;
    const pairs = ref.flatMap((r, i) => (r ? [{ a: model.knots[i], v: r[2] }] : []));
    if (!pairs.length) continue;
    let center = interp(
      age,
      pairs.map((r) => r.a),
      pairs.map((r) => r.v),
    );
    const v = Number(row.value);
    let log = clinicalLog(k, v);
    if (log === null) {
      const cfg = lookup(model.candidates, k),
        coef = lookup(model.clinical_fit.coefficients, k);
      if (!cfg || coef === undefined) continue;
      const exposure = (x: number) =>
        between(x, cfg.min, cfg.max) ? clamp((cfg.sign * (x - cfg.target)) / cfg.step, 0, 3) : 0;
      log = (exposure(v) - exposure(center)) * coef;
      row.source = "Age/sex median, joint clinical fit";
    } else {
      if (k === "egfr" && rows.creatinine) {
        rows.creatinine.years = 0;
        if (filtration(age, sex, Number(rows.creatinine.value)) === v)
          center = filtration(age, sex, curveAt(age, refs.creatinine.ref[sex], (r) => [r.q[2]])![0])!;
      }
      log -= clinicalLog(k, center)!;
      if (k === "fasting_glucose" && rows.a1c) log *= 0.25;
      row.source = "Age/sex median, published dose";
      row.grade = ["ldl", "non_hdl"].includes(k)
        ? "B, trial-based lipid comparison"
        : "B, cohort association";
    }
    row.years = mult * clamp(log, -0.72, 0.72);
  }
  capClinicalFamilies(rows, mult);
}
