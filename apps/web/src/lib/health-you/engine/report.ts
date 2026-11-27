import {
  coef,
  curveAt,
  dated,
  eligible,
  interp,
  lookup,
  model,
  native,
  number,
  percentile,
  refs,
  type Family,
  type MemberEvidence,
  type Rows,
  type Sex,
} from "./model";

function trackedContext(data: MemberEvidence, at: string) {
  const tracked = new Set<string>();
  for (const [group, fields] of Object.entries(model.bridges.fields)) {
    if (["member", "profile", "sets"].includes(group)) continue;
    for (const r of data[group as Family] ?? []) {
      if (!eligible(r, at)) continue;
      if (group === "labs") {
        if (lookup(model.bridges.markers, r.marker)?.role === "context only") tracked.add("labs." + r.marker);
      } else
        for (const [k, role] of Object.entries(fields))
          if (role === "context only" && r[k] != null && !["title", "ingredients", "notes", "devices"].includes(k))
            tracked.add(group + "." + k);
    }
  }
  return tracked;
}
export function missingEvidence(data: MemberEvidence, at: string, rows: Rows) {
  const missing = [...new Set([...Object.keys(coef), ...model.optional, "steps", "hip_minutes"])]
    .filter((k) => !rows[k] && coef[k] !== 0)
    .sort()
    .map((key) => ({
      key,
      unlock: "A qualifying measurement would supply the " + key.replaceAll("_", " ") + " comparison.",
    }));
  const workout = rows.running || rows.lifting;
  for (const [key, unlock] of Object.entries(model.extra_context))
    if (key !== "workouts" || !workout) missing.push({ key, unlock });
  const tracked = trackedContext(data, at);
  for (const key of [...tracked].sort())
    missing.push({ key, unlock: "Available for tracking. A validated independent mortality bridge is needed." });
  const aliases: Record<string, string> = {
    blood_pressure_protocol: "sbp",
    "estimated-vo2-max": "vo2_peak",
    grip_max: "grip",
    grip_strength: "grip",
    one_leg_balance: "balance",
    sit_and_rise: "floor_rise",
  };
  const contexts = new Set(
    dated(data, "feed_context", at, model.policy.protocol.lab_days).map((r) => String(r.context_key)),
  );
  for (const key of [...contexts].sort()) {
    const factor = lookup(aliases, key) ?? key.replace(/^food_week\./, "");
    if (!rows[factor] && !(key === "workout_minutes" && workout))
      missing.push({
        key,
        unlock:
          lookup(model.feeds.context_reasons, key) ??
          "Tracked separately. A matched measurement protocol and reference would allow an age comparison.",
      });
  }
  return missing;
}

function rankFactor(k: string, r: Omit<Rows[string], "grade">, age: number, sex: Sex) {
  const extra = lookup(model.extra_ranks, k)?.[sex],
    v = number(r.value);
  if (extra?.every(Boolean) && age <= 80 && v !== null) {
    const qs = model.prob.map((_, i) =>
      interp(
        age,
        model.knots,
        extra.map((q) => q[i]),
      ),
    );
    r.percentile = percentile(v, qs);
    r.reference = lookup(model.feeds.rank_sources, k)!;
  }
  const rankKey = k === "gait_speed" ? "gait" : k;
  const ref = refs[rankKey];
  const qs = ref && curveAt(age, ref.ref[sex], (r) => r.q);
  if (k === "gait_speed" && qs && v !== null) {
    r.percentile = percentile(v, qs);
    r.reference = "NHANES measured walk, protocol proxy";
  }
  if (r.target === null && qs) {
    r.target = qs[2];
    r.target_source = "Survey median, descriptive only";
  }
}
export function finishFactors(rows: Rows, parts: Record<string, number>, age: number, sex: Sex) {
  return Object.fromEntries(
    Object.entries(rows).map(([k, row]) => {
      const { grade, series: _series, quit, ...r } = row;
      rankFactor(k, r, age, sex);
      if (k === "balance" && r.value === "pass") r.target = "pass";
      if (["disease", "diabetes", "health", "phq9"].includes(k))
        r.target_source = "Descriptive reference category";
      if (k === "alcohol" && r.target !== null) {
        r.target = 0;
        r.target_source = "Abstainer reference in the published alcohol curve";
      }
      if (k === "smoking" && r.percentile === null && quit) {
        r.percentile = native(k, model.policy.protocol.smoking_codes.former, age, sex)?.percentile ?? null;
        r.reference = "former-smoking category; duration unranked";
      }
      const target_status =
        coef[k] === 0
          ? "descriptive median; no independent fitted effect"
          : r.target !== null
            ? "reference comparison"
            : "no independent fitted effect";
      const rank_status =
        k === "steps" && r.reference.includes("wear unknown")
          ? "lower-bound comparison"
          : r.percentile === null
            ? "no matched age/sex reference"
            : "raw value percentile";
      return [
        k,
        {
          ...r,
          ...lookup(model.display, k)!,
          evidence_grade: grade,
          target_status,
          rank_status,
          contribution_tenths: parts[k] ?? 0,
        },
      ] as const;
    }),
  );
}

export function absoluteRisk(age: number, sex: Sex, year: number, rows: Rows) {
  const { reference: t, calibration: c, policy } = model;
  const sum = (keys: string[]) => keys.reduce((v, k) => v + coef[k] ** 2, 0);
  const coverage = sum(c.blood_keys.filter((k) => rows[k])) / sum(c.blood_keys);
  const shift = c.intercept + (sex === "1" ? c.male_offset : 0) + c.panel_offset * coverage;
  const grid = t.age_centers,
    rates = sex === "1" ? t.male : t.female,
    years = policy.risk_horizon;
  let total = 0;
  for (const [j, node] of t.nodes.entries()) {
    const elapsed = node * years,
      a = age + elapsed;
    const i = Math.min(grid.length - 2, Math.max(0, grid.filter((k) => k <= a).length - 1));
    const rate = (i: number) =>
      interp(
        year + elapsed,
        t.years,
        rates[i].map((x) => Math.log(x)),
      );
    const lo = rate(i),
      hi = rate(i + 1);
    total +=
      (t.weights[j] * Math.exp(shift + lo + ((hi - lo) * (a - grid[i])) / (grid[i + 1] - grid[i]))) /
      t.denominator;
  }
  return {
    probability: -Math.expm1(-years * total),
    years,
    reference_year: Math.min(Math.max(year, t.years[0]), t.years.at(-1)!),
  };
}
