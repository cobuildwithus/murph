import { factor, clamp } from "./daily";
import {
  between,
  day,
  distance,
  eligible,
  lookup,
  interp,
  type Rows,
  model,
  number,
  released,
  rowDay,
  unique,
  type MemberEvidence,
  type Observation,
  type Sex,
} from "./model";

function stationOrder(row: Observation, prior: Observation, forRecovery: boolean) {
  const release = (r: Observation) => [day(r.received_at), day(r.reported_at)].sort().at(-1) || rowDay(r);
  return (
    rowDay(row).localeCompare(rowDay(prior)) ||
    (number(row.revision) ?? 0) - (number(prior.revision) ?? 0) ||
    (forRecovery ? release(row).localeCompare(release(prior)) : 0)
  );
}

function latestStations(data: MemberEvidence, at: string, forRecovery = false) {
  const stations = new Map<string, Observation[]>();
  for (const row of data.fitness_tests ?? []) {
    const k = row.test;
    if (
      typeof k !== "string" ||
      !Object.hasOwn(model.combine.stations, k) ||
      row.protocol !== "murph-combine-v1" ||
      !released(row, at) ||
      !between(distance(at, rowDay(row)), 0, model.policy.protocol.combine_days)
    )
      continue;
    if (
      forRecovery &&
      (k !== "step_recovery" || !Number.isInteger(row.revision ?? 0) || Number(row.revision ?? 0) < 0)
    )
      continue;
    const group = stations.get(k);
    const cmp = group ? stationOrder(row, group[0], forRecovery) : 1;
    if (cmp > 0) stations.set(k, [row]);
    else if (!cmp) group!.push(row);
  }
  return stations;
}
export function stepCapacity(data: MemberEvidence, at: string, age: number, sex: Sex) {
  if (age < 19 || age >= 65) return null;
  const rows = latestStations(data, at, true).get("step_recovery") ?? [],
    cfg = model.projection.step_vo2;
  return unique(
    rows.map((r) => {
      if (
        !eligible(r, at) ||
        r.pain_or_stop ||
        r.partial ||
        !["video", "coach"].includes(String(r.verified)) ||
        !["final", "amended", "corrected"].includes(String(r.status ?? "final")) ||
        r.setup !== "ymca_3min_30.5cm_96bpm" ||
        r.recovery_protocol !== "immediate_seated_radial_60s" ||
        r.unit !== "bpm"
      )
        return null;
      const pulse = number(r.value),
        height = number(r.height_cm),
        mass = number(r.weight_kg);
      if (!between(pulse, 40, 210) || !between(height, 120, 220) || !between(mass, 35, 200)) return null;
      const value =
        cfg.intercept +
        cfg.male * Number(sex === "1") +
        cfg.age * age +
        cfg.height * height +
        cfg.mass * mass +
        cfg.recovery * pulse;
      return between(value, 8, 100) ? value : null;
    }),
  );
}
export function combineContext(data: MemberEvidence, at: string, age: number, sex: Sex) {
  const cfg = model.combine,
    results: Record<string, Observation> = {};
  for (const [k, rows] of latestStations(data, at)) {
    const [unit, lo, hi] = lookup(cfg.stations, k)!;
    const v = unique(rows.map((r) => number(r.value)));
    if (
      !between(v, Number(lo), Number(hi)) ||
      !rows.every((r) => eligible(r, at) && !r.pain_or_stop && r.unit === unit)
    )
      continue;
    let comparison: Observation | null = null;
    if (
      k === "pushups_max" &&
      age >= 20 &&
      age < 70 &&
      rows.every((r) => r.variant === cfg.pushups_max.variants[sex])
    ) {
      const threshold = cfg.pushups_max.upper_category[sex][Math.floor((age - 20) / 10)];
      comparison = { reference: "Canadian standardized test upper category", threshold, met: v >= threshold };
    }
    if (
      k === "chair_stands" &&
      between(age, 18, 35) &&
      rows.every(
        (r) =>
          r.duration_s === 30 && r.arms_crossed === true && r.chair_height_cm === cfg.chair_stands.chair_cm,
      )
    )
      comparison = {
        reference: "Healthy young adult study, sexes pooled",
        mean: cfg.chair_stands.mean,
        sd: cfg.chair_stands.sd,
      };
    if (k === "standing_broad_jump" && age >= 18 && age < 65)
      comparison = {
        reference: "Adult-Fit first visit, separate comparison groups",
        age_band_mean_cm: cfg.standing_broad_jump.age_mean[age < 35 ? 0 : age < 50 ? 1 : 2],
        sex_mean_cm: cfg.standing_broad_jump.sex_mean[sex],
      };
    results[k] = { value: v, unit, as_of: rowDay(rows[0]), comparison };
  }
  return results;
}

function tapeReadings(data: MemberEvidence, at: string, key: string) {
  const candidates = (data.fitness_tests ?? []).filter(
    (r) =>
      r.test === key &&
      r.protocol === "murph-combine-v1" &&
      released(r, at) &&
      between(distance(at, rowDay(r)), 0, 30) &&
      Number.isInteger(r.revision ?? 0) &&
      Number(r.revision ?? 0) >= 0,
  );
  const last = candidates.map(rowDay).sort().at(-1),
    dated = candidates.filter((r) => rowDay(r) === last);
  const revision = Math.max(...dated.map((r) => Number(r.revision ?? 0))),
    current = dated.filter((r) => Number(r.revision ?? 0) === revision);
  if (
    !current.length ||
    current.some(
      (r) =>
        !eligible(r, at) ||
        r.unit !== "cm" ||
        r.partial ||
        r.pain_or_stop ||
        !["final", "corrected", "amended"].includes(String(r.status ?? "final")),
    )
  )
    return [];
  return current;
}

function eligibleTape(p: Observation, rows: Rows, age: number) {
  const restrictions = Array.isArray(p.conditions) ? p.conditions : [];
  if (
    !rows.bmi ||
    ["edema", "eating_disorder", "wheelchair", "adapted_mobility", "unreliable_stature"].some(
      (key) => p[key],
    ) ||
    restrictions.some((k) => ["edema", "eating_disorder", "wheelchair_user"].includes(k)) ||
    rows.weight_loss ||
    rows.lean_change
  )
    return null;
  const key = rows.waist ? "thigh_cm" : "waist_hip_ratio";
  const thigh = key === "thigh_cm";
  if (
    thigh
      ? age < 35 ||
        age >= 66 ||
        p.pem ||
        p.exercise_restriction ||
        p.free_of_cvd_and_cancer === false ||
        rows.disease?.value === 1 ||
        [
          "grip",
          "knee",
          "gait",
          "gait_speed",
          "floor_rise",
          "pushups_max",
          "balance",
          "waist_hip_ratio",
        ].some((k) => rows[k]) ||
        restrictions.some((k) =>
          [
            "pem",
            "exercise_restriction",
            "heart_failure",
            "heart_attack",
            "mi",
            "chf",
            "stroke",
            "cancer",
            "ascvd",
            "coronary_heart_disease",
            "coronary_artery_disease",
            "cardiovascular_disease",
          ].includes(k),
        )
      : age < 25 || age >= 71 || rows.whtr
  )
    return null;
  return key;
}

export function tapeFactors(
  data: MemberEvidence,
  at: string,
  age: number,
  sex: Sex,
  rows: Rows,
  mult: number,
): Rows {
  const key = eligibleTape(data.profile, rows, age);
  if (!key) return {};
  const thigh = key === "thigh_cm";
  const current = tapeReadings(data, at, key);
  if (!current.length) return {};
  if (thigh) {
    const value = unique(current.map((r) => number(r.value)));
    if (
      !between(value, 25, 100) ||
      current.some((r) => r.free_of_cvd_and_cancer !== true || r.tape_method !== "right_below_gluteal_fold")
    )
      return {};
    const spec = model.combine.thigh_cm,
      site = spec.reference[sex],
      q = spec.retained_log_fraction;
    return {
      [key]: factor(
        key,
        value,
        "cm",
        null,
        mult * q * interp(value, site.cm, site.hr.map(Math.log)),
        q,
        "C, home tape at observed body size",
        "https://doi.org/10.1136/bmj.b3292",
      ),
    };
  }
  const waist = unique(current.map((r) => number(r.waist_cm))),
    hip = unique(current.map((r) => number(r.hip_cm)));
  if (
    !between(waist, 45, 180) ||
    !between(hip, 55, 190) ||
    !between(waist / hip, 0.5, 1.4) ||
    current.some((r) => r.tape_method !== "standing_midwaist_maxhip")
  )
    return {};
  const spec = model.combine.waist_hip_ratio,
    [origin, rate] = spec.reference_and_rr[sex],
    q = spec.retained_log_fraction;
  return {
    [key]: factor(
      key,
      waist / hip,
      "waist / hip",
      null,
      mult * q * Math.log(rate) * clamp((waist / hip - origin) / 0.1, 0, 1),
      q,
      "C, home tape comparison at a given BMI",
      "https://doi.org/10.1056/NEJMoa0801891",
    ),
  };
}
