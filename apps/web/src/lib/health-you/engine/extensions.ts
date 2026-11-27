import {
  between,
  catalog,
  contrast,
  curveAt,
  dated,
  distance,
  model,
  number,
  percentile,
  pick,
  rowDay,
  scale,
  type MemberEvidence,
  type Observation,
  type Rows,
  type Scalar,
  type Sex,
} from "./model";
import { restrictions } from "./observations";

function peakOxygen(data: MemberEvidence, at: string, inputs: Record<string, unknown>) {
  const vo = dated(data, "vo2", at, 180).filter((r) => between(number(r.value), 8, 100));
  const cpet = vo.filter((r) => r.method === "lab_cpet");
  const watch = vo.filter(
    (r) =>
      r.method === "device_estimate" &&
      ["apple", "garmin"].includes(String(r.source)) &&
      distance(at, rowDay(r)) <= 42,
  );
  const vendors = [...new Set(watch.map((r) => String(r.source)))]
    .sort()
    .filter((s) => new Set(watch.filter((r) => r.source === s).map(rowDay)).size >= 2);
  const vendor = vendors.includes(String(data.profile.preferred_source))
    ? data.profile.preferred_source
    : vendors[0];
  const peak = number(pick(cpet.length ? cpet : watch.filter((r) => r.source === vendor), "value"));
  if (peak !== null) {
    inputs.vo2_peak = peak / 3.5;
    inputs.vo2_method = cpet.length ? "cpet" : "watch";
  }
}
function performance(data: MemberEvidence, at: string, age: number, sex: Sex, inputs: Record<string, unknown>) {
  peakOxygen(data, at, inputs);
  const tests = dated(data, "fitness_tests", at, 49).filter(
    (r) => ["video", "coach"].includes(String(r.verified)) && r.protocol === "murph-combine-v1" && !r.pain_or_stop,
  );
  const hands = new Map<string, { date: string; left: number[]; right: number[] }>();
  for (const r of tests) {
    const v = number(r.value);
    if (
      ["grip", "grip_strength", "grip_max"].includes(String(r.test)) &&
      r.equipment === "dynamometer" &&
      r.unit === "kg" &&
      (r.side === "left" || r.side === "right") &&
      between(v, 1, 100)
    ) {
      const date = rowDay(r),
        id = JSON.stringify([date, r.session_id ?? ""]);
      const hand = hands.get(id) ?? { date, left: [], right: [] };
      hand[r.side].push(v);
      hands.set(id, hand);
    }
  }
  for (const [test, key, u] of [
    ["sit_and_rise", "floor_rise", "points"],
    ["floor_rise", "floor_rise", "points"],
    ["one_leg_balance", "balance", "s"],
  ]) {
    const v = number(
      pick(
        tests.filter((r) => r.test === test && r.unit === u),
        "value",
      ),
    );
    if (between(v, 0, 10) && (key === "floor_rise" || v === 10)) inputs[key] = key === "balance" ? "pass" : v;
  }
  const grip = number(
    pick(
      [...hands.values()]
        .filter((h) => h.left.length && h.right.length)
        .map((h) => ({ date: h.date, value: (Math.max(...h.left) + Math.max(...h.right)) / 2 })),
      "value",
    ),
  );
  const qs = curveAt(age, model.grip_ref[sex], (r) => r);
  if (grip !== null && qs) {
    inputs.grip = grip - qs[2];
    return { grip, qs };
  }
  return null;
}

function publishedCurves(age: number, inputs: Record<string, unknown>, excluded: Set<string>, multiplier: number) {
  const result: Rows = {};
  for (const k of model.optional) {
    const f = catalog[k],
      v = inputs[k];
    if (
      !f ||
      excluded.has(k) ||
      (typeof v !== "number" && typeof v !== "string") ||
      (f.age_range && !between(age, f.age_range[0], f.age_range[1])) ||
      Object.entries(f.requires ?? {}).some(([key, value]) => inputs[key] !== value)
    )
      continue;
    const weight = f.method_key ? f.method_weights?.[String(inputs[f.method_key])] : 1;
    const log = contrast(f, v);
    if (weight == null || log === null) continue;
    let target: Scalar;
    if (f.curve.bounds) target = f.curve.bounds.slice().sort((a, b) => contrast(f, a)! - contrast(f, b)!)[0];
    else target = f.curve.rows!.reduce((a, b) => (a.ratio <= b.ratio ? a : b)).value;
    result[k] = {
      value: v,
      unit: f.unit,
      years: multiplier * f.shrinkage * weight * Math.max(f.log_floor ?? -Infinity, log),
      quality: f.shrinkage,
      percentile: null,
      target,
      grade: f.grade,
    };
  }
  return result;
}
export function published(
  data: MemberEvidence,
  at: string,
  age: number,
  sex: Sex,
  core: Rows,
  ci: Observation[],
  labs: Record<string, number | null>,
) {
  const inputs: Record<string, unknown> = { sex: sex === "1" ? "male" : "female" };
  const checked = ci.filter((r) => r.method_verified === true && distance(at, rowDay(r)) <= 90);
  for (const k of model.optional) inputs[k] = pick(checked, k);
  for (const k of ["nonexerciser", "traditional_sauna", "stable_ldl"]) inputs[k] = pick(ci, k);
  const { absolute_log_caps: caps, priority_groups: groups, suppresses } = model.overlap;
  const limited = restrictions(data.profile).restricted;
  const grip = limited ? null : performance(data, at, age, sex, inputs);
  if (limited) for (const k of caps.conditioning.factors) delete inputs[k];
  if (core.vo2) delete inputs.vo2_peak;
  if (between(labs.ldl, 0, 700)) inputs.ldl_c = labs.ldl;
  if (between(labs.lpa, 0, 700)) inputs.lpa = labs.lpa;
  const excluded = new Set<string>();
  for (const [owned, keys] of [
    [core.sleep, groups.sleep],
    [core.steps || core.activity || core.hip_minutes, groups.volume],
    [core.non_hdl, groups.atherogenic_lipids],
    [core.gait || core.knee, groups.function],
    [core.fibre, ["fibre", ...suppresses.fibre, "diet_pattern"]],
  ] as const)
    if (owned) keys.forEach((k) => excluded.add(k));
  const result: Rows = {};
  const multiplier = model.policy.years_per_published_log_unit * scale(age);
  const extensions = publishedCurves(age, inputs, excluded, multiplier);
  Object.assign(result, extensions);
  limitOverlap(result, core, multiplier);
  if (result.grip && grip)
    Object.assign(result.grip, {
      value: grip.grip,
      unit: "kg, mean hand maximum",
      percentile: percentile(grip.grip, grip.qs),
      target: grip.qs.at(-1),
    });
  return result;
}

function limitOverlap(result: Rows, core: Rows, multiplier: number) {
  const { absolute_log_caps: caps, priority_groups: groups, suppresses } = model.overlap;
  for (const family of Object.values(groups))
    for (const k of family.filter((k) => result[k]).slice(1)) delete result[k];
  for (const [owner, keys] of Object.entries(suppresses)) if (result[owner]) keys.forEach((k) => delete result[k]);
  const retained = {
    conditioning: ["activity", "pulse", "hip_minutes", "steps", "knee", "gait", "vo2"],
    food: ["fibre"],
    lipids: ["non_hdl"],
  };
  for (const family of ["conditioning", "food", "lipids"] as const) {
    const cap = caps[family],
      remaining = Math.max(
        0,
        cap.max_abs_log * multiplier - retained[family].reduce((s, k) => s + Math.abs(core[k]?.years ?? 0), 0),
      );
    const used = cap.factors.reduce((s, k) => s + Math.abs(result[k]?.years ?? 0), 0);
    if (used > remaining) for (const k of cap.factors) if (result[k]) result[k].years *= remaining / used;
  }
}
