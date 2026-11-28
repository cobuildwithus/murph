import {
  between,
  day,
  distance,
  eligible,
  lookup,
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
