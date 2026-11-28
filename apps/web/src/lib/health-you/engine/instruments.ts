import {
  between,
  day,
  distance,
  interp,
  lookup,
  model,
  number,
  YEAR,
  sumYears,
  unique,
  type MemberEvidence,
  type Observation,
  type Rows,
  type Scalar,
  type Sex,
} from "./model";
import { clamp, factor } from "./daily";

const cov = model.coverage,
  evidence = model.evidence;
type Source = { row: Observation; value: unknown };
type Group = { date: string; revision: number; release: string; sources: Source[] };
function instrumentRelease(row: Observation, at: string, coverage: boolean, date: string) {
  const releases = [row.reported_at, row.received_at].filter((v) => v != null);
  if (releases.some((v) => !day(v) || day(v) !== v || day(v) > at)) return null;
  const revision = row.revision ?? 0;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return null;
  const release = coverage ? (releases.map(day).sort().at(-1) ?? date) : "";
  return { revision, release };
}

function observations(data: MemberEvidence, at: string) {
  const groups = new Map<string, Group>();
  for (const family of ["extensions", "checkins"] as const)
    for (const row of data[family] ?? []) {
      const rawKey = family === "extensions" ? row.key : row.topic;
      if (typeof rawKey !== "string") continue;
      const coverage = lookup(cov.factors, rawKey);
      const spec = coverage ?? lookup(evidence.factors, rawKey);
      if (
        !spec ||
        !day(row.date) ||
        day(row.date) !== row.date ||
        !between(distance(at, row.date), 0, spec.days)
      )
        continue;
      const order = instrumentRelease(row, at, Boolean(coverage), row.date);
      if (!order) continue;
      const { revision, release } = order;
      const prev = groups.get(rawKey);
      const cmp = prev
        ? row.date.localeCompare(prev.date) || revision - prev.revision || release.localeCompare(prev.release)
        : 1;
      const source = { row, value: family === "extensions" ? row.value : row.answer };
      if (cmp > 0) groups.set(rawKey, { date: row.date, revision, release, sources: [source] });
      else if (!cmp) prev!.sources.push(source);
    }
  return groups;
}
function matches(row: Observation, spec: { unit: string; protocol: string }) {
  return (
    row.unit === spec.unit &&
    row.protocol === spec.protocol &&
    !row.comparator &&
    !row.retracted &&
    !row.invalid &&
    !row.partial &&
    ["final", "amended", "corrected"].includes(String(row.status ?? "final"))
  );
}
function instrumentEligible(key: string, profile: Observation, conditions: unknown[], row: Observation) {
  if ((key === "k6" && row.items_completed !== 6) || (key === "delayed" && row.items_completed !== 3))
    return false;
  if (
    key === "chair" &&
    (profile.wheelchair || profile.adapted_mobility || conditions.includes("wheelchair_user"))
  )
    return false;
  if (
    key === "cac" &&
    (row.source !== "clinical_report" ||
      row.asymptomatic !== true ||
      row.known_cvd !== false ||
      conditions.some((k) =>
        ["mi", "heart_attack", "stroke", "chf", "heart_failure", "ascvd", "coronary_artery_disease"].includes(
          String(k),
        ),
      ))
  )
    return false;
  return true;
}

function coveredValue(key: string, group: Group, profile: Observation) {
  const spec = lookup(cov.factors, key)!;
  const conditions = Array.isArray(profile.conditions) ? profile.conditions : [];
  return unique(
    group.sources.map(({ row, value }) => {
      const v = typeof value === "boolean" && spec.unit === "yes=1" ? Number(value) : value;
      if (
        typeof v !== "number" ||
        !between(v, spec.bounds[0], spec.bounds[1]) ||
        (spec.integer && !Number.isInteger(v)) ||
        !matches(row, spec)
      )
        return null;
      if (!instrumentEligible(key, profile, conditions, row)) return null;
      return v;
    }),
  );
}
function coverageContrast(key: string, v: number, age: number, sex: Sex) {
  const spec = lookup(cov.factors, key)!;
  if ("ratios" in spec) {
    const i = v === 0 ? 0 : Math.max(1, spec.cutpoints.filter((x) => x <= v).length - 1);
    return Math.log(spec.ratios[i]);
  }
  const center = 25 + 10 * Math.floor((Math.floor(age) - 20) / 10);
  const refs = spec.refs[sex];
  if (!refs.some((r) => r[0] === center)) return null;
  const near = refs.filter((r) => Math.abs(r[0] - center) <= 10);
  return (
    (spec.beta *
      ((spec.transform === "log1p" ? Math.log1p(v) : v) -
        interp(
          age,
          near.map((r) => r[0]),
          near.map((r) => r[1]),
        ))) /
    spec.sd
  );
}
type Terms = Record<string, { value: Scalar; log: number; family: string }>;
function constrain(terms: Terms, keys: string[], available: number) {
  const used = sumYears(keys.map((k) => Math.abs(terms[k].log)));
  if (used > available) for (const k of keys) terms[k].log *= available / used;
}
function constrainFamilies(
  terms: Terms,
  families: Record<string, { cap: number; reserve: string[]; fraction?: number }>,
  base: Rows,
  scale: number,
) {
  for (const [family, budget] of Object.entries(families)) {
    const used =
      (sumYears(budget.reserve.map((k) => Math.abs(base[k]?.years ?? 0))) / scale) * (budget.fraction ?? 1);
    constrain(
      terms,
      Object.keys(terms).filter((k) => terms[k].family === family),
      Math.max(0, budget.cap - used),
    );
  }
}
function coverage(
  data: MemberEvidence,
  groups: Map<string, Group>,
  rows: Rows,
  age: number,
  sex: Sex,
  scale: number,
  reasons: Record<string, string>,
) {
  const rating = groups.get("oral_rating"),
    teeth = groups.get("edentulous");
  if (
    rating &&
    teeth &&
    coveredValue("oral_rating", rating, data.profile) !== null &&
    coveredValue("edentulous", teeth, data.profile) === 1
  ) {
    for (const k of [
      ...(rating.date <= teeth.date ? ["oral_rating"] : []),
      ...(teeth.date <= rating.date ? ["edentulous"] : []),
    ]) {
      groups.delete(k);
      reasons[k] = "Conflicting dentition reports; use one consistent current assessment.";
    }
  }
  const terms: Terms = {};
  for (const k of cov.priority) {
    const g = groups.get(k);
    if (!g) continue;
    const spec = lookup(cov.factors, k)!,
      v = coveredValue(k, g, data.profile);
    if (v === null || age < spec.min_age || age >= spec.max_age + 1) {
      reasons[k] = "Measurement, population or protocol outside supported comparison.";
      continue;
    }
    if (
      rows[k] ||
      lookup(cov.suppress, k)?.some((b) => rows[b]) ||
      (k === "edentulous" && terms.oral_rating)
    ) {
      reasons[k] = "A more specific measurement already owns this comparison.";
      continue;
    }
    const log = coverageContrast(k, v, age, sex);
    if (log === null) {
      reasons[k] = "Development survey lacks a matching age and sex reference.";
      continue;
    }
    terms[k] = {
      value: v,
      log: clamp(log * spec.weight, -cov.individual_log_cap, cov.individual_log_cap),
      family: spec.family,
    };
  }
  constrainFamilies(terms, cov.families, rows, scale);
  constrain(terms, Object.keys(terms), cov.joint_log_cap);
  for (const [k, t] of Object.entries(terms)) {
    const s = lookup(cov.factors, k)!;
    rows[k] = factor(k, t.value, s.unit, null, t.log * scale, s.weight, s.grade, s.source);
  }
}
interface Study {
  family: string;
  protocol: string;
  unit: string;
  source: string;
  requires: Record<string, boolean>;
  ratio: Record<string, number> | number[][];
  bounds?: number[];
  whole?: boolean;
  half_open?: boolean;
}
function studyRatio({ row, value }: Source, s: Study) {
  if (
    !matches(row, s) ||
    row.source !== s.source ||
    Object.entries(s.requires).some(([k, v]) => row[k] !== v)
  )
    return null;
  if (!Array.isArray(s.ratio)) return typeof value === "string" ? (lookup(s.ratio, value) ?? null) : null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (s.whole && !Number.isInteger(value)) ||
    (s.bounds && !between(value, s.bounds[0], s.bounds[1]))
  )
    return null;
  return s.ratio.find(([lo, hi]) => lo <= value && (s.half_open ? value < hi : value <= hi))?.[2] ?? null;
}
function resolveExclusiveStudies(terms: Terms, groups: Map<string, Group>, reasons: Record<string, string>) {
  for (const group of evidence.exclusive_groups) {
    const keys = group.filter((k) => terms[k]);
    if (keys.length < 2) continue;
    let winner: string | undefined = keys.find((k) => terms[k].log !== 0) ?? keys[0];
    if (terms[keys[0]].family === "tobacco") {
      const latest = keys
        .map((k) => groups.get(k)!.date)
        .sort()
        .at(-1);
      const current = keys.filter((k) => groups.get(k)!.date === latest);
      winner =
        current.length > 1 && current.some((k) => terms[k].value !== "never_tobacco")
          ? undefined
          : current[0];
    }
    for (const k of keys)
      if (k !== winner) {
        delete terms[k];
        reasons[k] = "Overlapping or contradictory measurements share one comparison.";
      }
  }
}

function studyExclusion(
  k: string,
  s: (typeof evidence.factors)[keyof typeof evidence.factors],
  data: MemberEvidence,
  rows: Rows,
  age: number,
) {
  let reason = "";
  if (rows[k] || s.suppress.some((b) => rows[b])) reason = "An existing factor owns the comparison.";
  else if (age < s.ages[0] || age >= s.ages[1] + 1) reason = "Outside the research age window.";
  else if (s.family === "tobacco" && rows.smoking && ![0, "never"].includes(rows.smoking.value))
    reason = "The cigarette history conflicts with an exclusive product history.";
  else if (
    ["cycle_commute", "usual_pace"].includes(k) &&
    (data.profile.wheelchair ||
      data.profile.adapted_mobility ||
      (Array.isArray(data.profile.conditions) && data.profile.conditions.includes("wheelchair_user")))
  )
    reason = "The study lacks a matching adapted-mobility comparison.";
  return reason;
}

export function studyFactors(
  data: MemberEvidence,
  at: string,
  rows: Rows,
  age: number,
  sex: Sex,
  reasons: Record<string, string>,
) {
  const groups = observations(data, at);
  if (!groups.size) return;
  const p = data.profile,
    birth = day(p.birth_date),
    anchor = day(p.age_as_of) || at;
  const candidate = birth
    ? distance(at, birth) / YEAR
    : typeof p.age === "number"
      ? p.age + distance(at, anchor) / YEAR
      : age;
  const coverageAge = Math.abs(candidate - age) <= 0.051 ? candidate : age;
  coverage(
    data,
    groups,
    rows,
    coverageAge,
    sex,
    cov.years_per_log_unit * cov.strength * interp(coverageAge, cov.age_knots, cov.age_values),
    reasons,
  );
  const scale =
    interp(age, evidence.age_knots, evidence.age_values) * evidence.strength * evidence.years_per_log_unit;
  const terms: Terms = {};
  for (const [k, g] of groups) {
    const s = lookup(evidence.factors, k);
    if (!s) continue;
    const reason = studyExclusion(k, s, data, rows, age);
    const ratio = unique(g.sources.map((r) => studyRatio(r, s))),
      v = unique(g.sources.map((r) => r.value));
    if (reason) {
      reasons[k] = reason;
      continue;
    }
    if (ratio === null || (typeof v !== "string" && typeof v !== "number")) {
      reasons[k] = "Supply a consistent, released measurement matching the study protocol.";
      continue;
    }
    terms[k] = {
      value: v,
      log: clamp(Math.log(ratio) * s.weight, -evidence.individual_log_cap, evidence.individual_log_cap),
      family: s.family,
    };
  }
  resolveExclusiveStudies(terms, groups, reasons);
  constrainFamilies(terms, evidence.families, rows, scale);
  const used = sumYears(evidence.coverage_keys.map((k) => Math.abs(rows[k]?.years ?? 0))) / scale;
  constrain(terms, Object.keys(terms), Math.max(0, evidence.joint_log_cap - used));
  for (const [k, t] of Object.entries(terms)) {
    const s = lookup(evidence.factors, k)!;
    rows[k] = {
      ...factor(
        k,
        t.value,
        s.unit,
        null,
        scale * t.log,
        s.weight,
        s.grade,
        "https://pubmed.ncbi.nlm.nih.gov/" + s.pmid + "/",
      ),
      reference: s.reference,
    };
  }
}
