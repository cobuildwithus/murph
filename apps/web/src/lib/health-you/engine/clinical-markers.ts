import { labDraw, latestDraw, type LabDraw } from "./lab-draws";
import {
  between,
  dated,
  distance,
  effectiveAnswer,
  eligible,
  lookup,
  model,
  number,
  pick,
  released,
  rowDay,
  unique,
  type MemberEvidence,
  type Observation,
  type Rows,
  type Sex,
} from "./model";
import { clamp, factor } from "./daily";
import { restrictions } from "./observations";

export function capFamily(rows: Rows, keys: string[], budget: number) {
  const present = [...new Set(keys)].filter((k) => rows[k]).sort();
  const total = present.reduce((s, k) => s + Math.abs(rows[k].years), 0);
  if (total <= budget) return;
  for (const key of present) {
    rows[key].years *= budget / total;
    if (rows[key].confidence !== undefined) rows[key].confidence *= budget / total;
  }
}
const units: Record<string, string> = {
  ...Object.fromEntries(Object.entries(model.candidates).map(([k, c]) => [k, c.unit])),
  ldl: "mg/dL",
  apob: "mg/dL",
  non_hdl: "mg/dL",
  glucose: "mg/dL",
  creatinine: "mg/dL",
  insulin: "uIU/mL",
  cystatin_c: "mg/L",
  omega_3_index: "%",
  lpa: "nmol/L",
};
function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[μµ]/g, "u")
    .replaceAll(" ", "")
    .replace(/²|\^2/g, "2");
}
function labNumber(r: Observation, key: string, at: string) {
  let u = normalize(r.unit);
  if (key === "iron" && u === "mcg/dl") u = "ug/dl";
  if (key === "insulin" && ["uu/ml", "miu/l"].includes(u)) u = "uiu/ml";
  if (
    !eligible(r, at) ||
    r.comparator ||
    !["final", "corrected", "amended"].includes(String(r.status ?? "final")) ||
    (key === "omega_3_index" && r.specimen !== "erythrocytes") ||
    normalize(units[key]) !== u ||
    (["glucose", "insulin", "triglycerides", "fasting_glucose"].includes(key) && r.fasting !== true)
  )
    return null;
  const candidate = lookup(model.candidates, key) ?? lookup(model.lipids, key);
  const bounds = candidate
    ? [candidate.min, candidate.max]
    : lookup(
        {
          glucose: [30, 500],
          insulin: [0.1, 250],
          creatinine: [0.2, 20],
          cystatin_c: [0.25, 10],
          omega_3_index: [1, 18],
          lpa: [0, model.lpa_molar.max],
        },
        key,
      );
  const v = number(r.value);
  return bounds && between(v, bounds[0], bounds[1]) ? v : null;
}
export function filtration(age: number, sex: Sex, cr: number, cy?: number) {
  if (!between(cr, 0.2, 20)) return null;
  const female = sex === "2",
    z = cr / (female ? 0.7 : 0.9);
  if (cy !== undefined && between(cy, 0.25, 10)) {
    const c = cy / 0.8;
    return (
      135 *
      Math.min(z, 1) ** (female ? -0.219 : -0.144) *
      Math.max(z, 1) ** -0.544 *
      Math.min(c, 1) ** -0.323 *
      Math.max(c, 1) ** -0.778 *
      0.9961 ** age *
      (female ? 0.963 : 1)
    );
  }
  return (
    142 *
    Math.min(z, 1) ** (female ? -0.241 : -0.302) *
    Math.max(z, 1) ** -1.2 *
    0.9938 ** age *
    (female ? 1.012 : 1)
  );
}
function latestLabValues(data: MemberEvidence, at: string) {
  const groups = new Map<string, LabDraw[]>();
  for (const row of data.labs ?? []) {
    const key = String(row.marker);
    if (
      !Object.hasOwn(units, key) ||
      !between(distance(at, rowDay(row)), 0, key === "lpa" ? 36500 : 365) ||
      !released(row, at)
    )
      continue;
    const group = groups.get(key) ?? [];
    group.push(labDraw(row, labNumber(row, key, at)));
    groups.set(key, group);
  }
  const values: Record<string, number> = {},
    draws: Record<string, string> = {};
  for (const [key, group] of groups) {
    const row = latestDraw(group, true);
    if (!row || row.value === null) continue;
    values[key] = row.value;
    if (row.specimen) draws[key] = JSON.stringify([row.date, row.specimen]);
  }
  return { values, draws };
}
function bodyRatios(data: MemberEvidence, at: string) {
  const values: Record<string, number> = {};
  const body = dated(data, "body", at, 730);
  const conditions = restrictions(data.profile);
  if (!conditions.body && !conditions.wheelchair && !data.profile.unreliable_stature) {
    function measure(k: string, lo: number, hi: number, start: number, end: number) {
      return number(
        pick(
          body.filter((r) => between(distance(at, rowDay(r)), start, end) && between(number(r[k]), lo, hi)),
          k,
        ),
      );
    }
    const waist = measure("waist_cm", 40, 200, 0, 180),
      height = measure("height_cm", 100, 230, 0, 730) ?? number(data.profile.height_cm);
    if (waist && between(height, 100, 230)) values.whtr = waist / height;
    const past = measure("weight_kg", 30, 300, 300, 420),
      now = measure("weight_kg", 30, 300, 0, 30);
    const intent = pick(
      dated(data, "checkins", at, 90).filter(
        (r) =>
          effectiveAnswer(r, at) &&
          ["intentional", "unintentional", "unknown"].includes(String(r.weight_change_intent)),
      ),
      "weight_change_intent",
    );
    if (past && now && intent === "unintentional") values.weight_loss = (100 * (past - now)) / past;
  }
  return values;
}
function collect(data: MemberEvidence, at: string, age: number, sex: Sex, nonHdl: number | null) {
  const { values, draws } = latestLabValues(data, at);
  if (nonHdl != null) values.non_hdl = nonHdl;
  if (values.glucose !== undefined) {
    values.fasting_glucose = values.glucose;
    if (
      !data.profile.uses_insulin &&
      draws.glucose &&
      draws.glucose === draws.insulin &&
      between(values.insulin, 0.1, 250)
    )
      values.homa_ir = (values.glucose * values.insulin) / 405;
  }
  const egfr = filtration(
    age,
    sex,
    values.creatinine,
    draws.creatinine && draws.creatinine === draws.cystatin_c ? values.cystatin_c : undefined,
  );
  if (values.egfr === undefined && egfr !== null) values.egfr = egfr;
  return { ...values, ...bodyRatios(data, at) };
}
function leanChange(data: MemberEvidence, at: string) {
  if (restrictions(data.profile).body) return null;
  const methods = new Map<string, Observation[]>();
  for (const r of dated(data, "body", at, 180)) {
    const source = r.provider || r.source;
    if (
      typeof source !== "string" ||
      !["dxa", "bioimpedance"].includes(String(r.method)) ||
      !between(number(r.lean_mass_kg), 10, 160)
    )
      continue;
    const key = JSON.stringify([source, r.method]);
    const rows = methods.get(key) ?? [];
    rows.push(r);
    methods.set(key, rows);
  }
  const trends = [];
  for (const rows of methods.values()) {
    const end = rows.map(rowDay).sort().at(-1)!;
    if (distance(at, end) > 14) continue;
    const current = number(pick(rows, "lean_mass_kg")),
      prior = number(
        pick(
          rows.filter((r) => between(distance(end, rowDay(r)), 42, 180)),
          "lean_mass_kg",
        ),
      );
    if (current && prior) trends.push({ date: end, change: 100 * (current / prior - 1) });
  }
  return number(pick(trends, "change"));
}
export function clinicalMarkers(
  core: Rows,
  data: MemberEvidence,
  at: string,
  age: number,
  sex: Sex,
  mult: number,
  nonHdl: number | null,
  legacy = false,
) {
  const vals = collect(data, at, age, sex, nonHdl);
  const trend = leanChange(data, at);
  if (trend !== null)
    core.lean_change = factor(
      "lean_change",
      trend,
      "% change",
      null,
      0,
      0,
      "C, descriptive trend",
      "Repeated same-method body measurements",
    );
  const lp = model.lpa_molar;
  if (between(vals.lpa, 0, lp.max) && !core.lpa)
    core.lpa_molar = factor(
      "lpa_molar",
      vals.lpa,
      "nmol/L",
      lp.reference,
      mult *
        lp.quality *
        clamp((vals.lpa - lp.reference) / (lp.high - lp.reference), 0, 1) *
        Math.log(lp.ratio),
      lp.quality,
      "B, published molar comparison",
      "https://pubmed.ncbi.nlm.nih.gov/30608559/",
    );
  if (between(vals.omega_3_index, 1, 18)) {
    const q = age >= 50 ? 0.12 : 0.06,
      v = vals.omega_3_index;
    const used = [
      "food_pattern",
      "meal_fibre",
      "meal_density",
      "fish",
      "fibre",
      "whole_grains",
      "vegetables",
      "fruit",
      "nuts",
      "legumes",
      "red_meat",
      "processed_meat",
      "sugary_drinks",
    ].reduce((s, k) => s + Math.abs(core[k]?.years ?? 0), 0);
    const room = Math.max(0, mult * model.daily.food_cap - used);
    core.omega_3_index = factor(
      "omega_3_index",
      v,
      "% RBC EPA+DHA",
      6.8,
      clamp((mult * q * Math.log(0.66) * (clamp(v, 4.2, 6.8) - 5.5)) / 2.6, -room, room),
      q,
      "C, observational assay bridge",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC6034629/",
    );
  }
  const added: Rows = {};
  for (const [key, c] of Object.entries(model.lipids)) {
    const v = vals[key];
    if (!between(v, c.min, c.max)) continue;
    delete core.ldl_c;
    delete core.non_hdl;
    added[key] = factor(
      key,
      v,
      "mg/dL",
      c.target,
      mult * clamp(((v - c.target) / c.step) * Math.log(c.ratio) * c.quality, -0.2, 0.2),
      c.quality,
      "B, causal exposure bridge",
      key === "apob" ? model.daily.sources.apob : "https://doi.org/10.1016/S0140-6736(10)61350-5",
    );
    break;
  }
  for (const [key, c] of Object.entries(model.candidates)) {
    const v = vals[key];
    if (!between(v, c.min, c.max) || (key === "triglycerides" && added.apob)) continue;
    added[key] = factor(
      key,
      v,
      c.unit,
      c.target,
      mult * clamp((c.sign * (v - c.target)) / c.step, 0, 3) * lookup(model.clinical_fit.coefficients, key)!,
      1,
      "survey residual",
      "Development NHANES examination cohorts",
    );
  }
  const owners: Record<string, string[]> = {
    renal: ["acr", "creatinine"],
    lipid: ["lpa", "lpa_molar"],
    glycemic: ["a1c", "diabetes"],
    body: ["bmi", "waist"],
    iron: ["hemoglobin"],
    vitamins: ["homocysteine"],
  };
  for (const [group, budget] of Object.entries(model.caps)) {
    const keys = Object.keys(added).filter((k) => (lookup(model.candidates, k)?.group ?? "lipid") === group);
    const used =
      group === "body" && !legacy ? 0 : owners[group].reduce((s, k) => s + Math.abs(core[k]?.years ?? 0), 0);
    capFamily(added, keys, Math.max(0, mult * budget - used));
  }
  Object.assign(core, added);
}
