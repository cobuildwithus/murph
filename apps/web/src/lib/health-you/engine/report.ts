import {
  coef,
  between,
  fields,
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
  type Contribution,
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
          if (
            role === "context only" &&
            r[k] != null &&
            !["title", "ingredients", "notes", "devices"].includes(k)
          )
            tracked.add(group + "." + k);
    }
  }
  return tracked;
}
function countedEvidence(rows: Rows) {
  const counted = new Set(Object.keys(rows));
  if (rows.zone_intensity || rows.aerobic || rows.lifting || rows.sauna) {
    counted.add("workouts");
    counted.add("workout_minutes");
  }
  if (rows.alcohol_peak) counted.add("food_week.most_in_one_sitting");
  if (rows.meal_fibre || rows.meal_density) {
    counted.add("meals");
    counted.add("fibre");
  }
  if (rows.lpa_molar) counted.add("lpa");
  if (rows.apob) ["ldl_c", "ldl", "non_hdl"].forEach((k) => counted.add(k));
  if (rows.ldl) counted.add("ldl_c");
  if (rows.hrv) counted.add("hrv-rmssd");
  return counted;
}
export function missingEvidence(
  data: MemberEvidence,
  at: string,
  rows: Rows,
  reasons: Record<string, string> = {},
) {
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
    missing.push({
      key,
      unlock: "Available for tracking. A validated independent mortality bridge is needed.",
    });
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
  for (const key of Object.keys(reasons).sort()) if (!rows[key]) missing.push({ key, unlock: reasons[key] });
  const counted = countedEvidence(rows);
  const remaining = missing.filter(
    ({ key }) =>
      !counted.has(key) &&
      !counted.has(key.replace(/^labs\./, "")) &&
      !(
        rows.food_pattern &&
        key.startsWith("food_week.") &&
        Object.hasOwn(model.daily.food_targets, key.slice(10))
      ),
  );
  for (const [key, unlock] of Object.entries(model.unlock)) if (!rows[key]) remaining.push({ key, unlock });
  for (const row of dated(data, "habits", at, model.daily.habit_days)) {
    if (!["meditation", "lights_out", "cold_plunge", "pushups"].includes(String(row.type))) continue;
    const key = "habits." + row.type;
    if (!remaining.some((r) => r.key === key))
      remaining.push({
        key,
        unlock: "Verified habit; an independent matched exposure and mortality estimate are needed.",
      });
  }
  return remaining;
}

function rankFactor(k: string, r: Omit<Rows[string], "grade">, age: number, sex: Sex) {
  const extra = lookup(model.extra_ranks, k)?.[sex],
    v = number(r.value);
  const clinical = lookup(model.clinical_ranks, k)?.[sex];
  const grid = clinical?.flatMap((q, i) => (q ? [{ age: model.knots[i], q }] : []));
  if (grid?.length && v !== null && between(age, grid[0].age - 5, grid.at(-1)!.age + 5)) {
    const qs = model.prob.map((_, i) =>
      interp(
        age,
        grid.map((r) => r.age),
        grid.map((r) => r.q[i]),
      ),
    );
    r.percentile = percentile(v, qs);
    r.reference = "Weighted development NHANES age/sex distribution";
  }
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
function targetStatus(key: string, row: Pick<Contribution, "source" | "target" | "years">) {
  if (Object.hasOwn(model.evidence.factors, key) || Object.hasOwn(model.coverage.factors, key))
    return "study comparison";
  if (["lifting", "activity", "aerobic"].includes(key)) return "adult guideline";
  if (key === "meal_density") return "no individual intake target";
  if (["lean_change", "hrv", "alcohol_peak", "alcohol_timing", "caffeine_timing"].includes(key))
    return "descriptive trend only";
  if (
    row.source === "Development NHANES examination cohorts" &&
    lookup(model.clinical_fit.coefficients, key) === 0
  )
    return "descriptive only; fitted residual is zero";
  if (coef[key] === 0 && !row.years) return "descriptive median; no independent fitted effect";
  return row.target !== null ? "reference comparison" : "no independent fitted effect";
}
export function finishFactors(rows: Rows, parts: Record<string, number>, age: number, sex: Sex) {
  return Object.fromEntries(
    Object.entries(rows).map(([k, row]) => {
      const { grade, series: _series, level: _level, confidence: _confidence, quit, ...r } = row;
      rankFactor(k, r, age, sex);
      if (["activity", "aerobic"].includes(k))
        Object.assign(r, {
          target: 150,
          target_source: "Adult guideline, 150–300 moderate-equivalent minutes per week",
        });
      if (k === "lifting")
        Object.assign(r, {
          target: typeof r.value === "string" ? "2/week" : 2,
          target_source: "Adult guideline, strength training on two days each week",
        });
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
          target_status: targetStatus(k, r),
          rank_status,
          contribution_tenths: parts[k] ?? 0,
        },
      ] as const;
    }),
  );
}

export function absoluteRisk(
  age: number,
  sex: Sex,
  year: number,
  rows: Rows,
  chronological: number,
  nonHdl: number | null,
) {
  const { reference: t, calibration: c, policy } = model;
  const sum = (keys: string[]) => keys.reduce((v, k) => v + coef[k] ** 2, 0);
  const pairedLipid = (rows.apob || rows.ldl) && between(nonHdl, fields.non_hdl.min, fields.non_hdl.max);
  const coverage =
    sum(c.blood_keys.filter((k) => rows[k] || (k === "non_hdl" && pairedLipid))) / sum(c.blood_keys);
  const [base, younger, older] = model.clinical_fit.panel;
  const panel =
    base +
    younger * Math.min(1, Math.max(0, (55 - chronological) / 35)) +
    older * Math.min(1, Math.max(0, (chronological - 55) / 25));
  const young = Math.min(1, Math.max(0, (45 - chronological) / 10));
  const background = model.background;
  const fraction = background.accident_fraction[sex] * young;
  const shift =
    c.intercept +
    (sex === "1" ? c.male_offset : 0) +
    panel * coverage +
    background.young_panel * young * coverage +
    background.historical * interp(year, [1979, 1988, 1994, 1999], [0, 1, 1, 0]);
  const years = policy.risk_horizon;
  const hazard =
    (1 - fraction) * integratedHazard(age, sex, year, years, shift) +
    (fraction ? fraction * integratedHazard(chronological, sex, year, years, 0) : 0);
  return {
    probability: -Math.expm1(-hazard),
    years,
    reference_year: Math.min(Math.max(year, t.years[0]), t.years.at(-1)!),
  };
}

function integratedHazard(age: number, sex: Sex, year: number, years: number, shift: number) {
  const t = model.reference;
  const grid = t.age_centers,
    rates = sex === "1" ? t.male : t.female;
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
  return years * total;
}
