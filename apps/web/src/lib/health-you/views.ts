import { offerings } from "./offerings";
import { youLabel } from "./labels";
import { nextQuestion } from "./questions";
import type { Bundle, Factor, Person, ThisWeekRow, YouView } from "./contract";
import { recentSleepNights } from "./engine/observations";
import { finishFactors } from "./engine/report";
import { MODEL_VERSION, score } from "./engine";
import { fields, lookup, model, number, offset, rowDay, YEAR, type Contribution } from "./engine/model";
import type { MarkerInput, YouInputs } from "./evidence";

const keys: Record<string, string> = {
  onset_sd: "bedtime",
  meal_fibre: "mealFibre",
  food_pattern: "foodPattern",
  ldl: "cholesterol",
  lpa_molar: "lpa",
  omega_3_index: "omega3Index",
  lean_change: "leanMassChange",
  whtr: "waistToHeight",
  weight_loss: "weightLoss",
  fasting_glucose: "fastingGlucose",
  homa_ir: "insulinResistance",
  sleep: "sleepTime",
  pulse: "restingHeartRate",
  activity: "activeMinutes",
  hip_minutes: "activeMinutes",
  vo2_peak: "cardioFitness",
  vo2: "cardioFitness",
  sbp: "bloodPressure",
  floor_rise: "sitRise",
  lifting: "lifts",
  sleep_regularity: "bedtime",
  non_hdl: "cholesterol",
  ldl_c: "cholesterol",
  a1c: "bloodSugar",
  crp: "inflammation",
};
const bloodKeys = new Set([
  "lpa",
  "ldl_c",
  "ldl",
  "lpa_molar",
  "apob",
  "egfr",
  "fasting_glucose",
  "homa_ir",
  "triglycerides",
  "iron",
  "ferritin",
  "folate",
  "b12",
  "omega_3_index",
]);
const food = new Set([
  ...model.overlap.absolute_log_caps.food.factors,
  "alcohol",
  "meal_fibre",
  "food_pattern",
]);
const fitness = new Set([
  "grip",
  "balance",
  "knee",
  "floor_rise",
  "gait",
  "gait_speed",
  "vo2",
  "vo2_peak",
  "fev1",
]);
const activities = new Set([
  "steps",
  "hip_minutes",
  "activity",
  "aerobic",
  "running",
  "lifting",
  "vilpa",
  "sedentary",
]);
const fmt = (v: number, decimals = 1) => v.toLocaleString("en-US", { maximumFractionDigits: decimals });
function signed(v: number) {
  return (v < 0 ? "−" : "+") + Math.abs(v).toFixed(1);
}
function factorFor(k: string, r: Contribution, tenths: number, input: YouInputs, age: number): Omit<Factor, "featured"> {
  const marker = input.markers.find((m) => m.modelKey === k);
  const key = keys[k] ?? k;
  const label = youLabel(k)!;
  const group = factorGroup(k);
  const { value, unit } = displayValue(k, r);
  const rank = factorRank(k, r, input, age);
  const target =
    r.target == null
      ? null
      : {
          text:
            "Comparison value " +
            (typeof r.target === "number" ? fmt(r.target) : r.target) +
            (unit ? " " + unit : ""),
        };
  return {
    key,
    label,
    icon: key,
    group,
    value,
    unit,
    years: tenths / 10,
    yearsText: signed(tenths / 10),
    whatItIs: lookup(model.display, k)?.what_it_is,
    whatLowersIt: lookup(model.display, k)?.what_helps,
    rank,
    target,
    state: "counted",
    grade: r.grade === "A" || r.grade === "B" || r.grade === "C" ? r.grade : null,
    detail: marker
      ? "marker"
      : k === "sbp"
        ? "bloodPressure"
        : group === "activity"
          ? "fitness"
          : group === "sleep" || group === "fitness" || group === "blood" || group === "food"
            ? group
            : "none",
    markerKey: marker?.key,
  };
}
export function ownTargets(input: YouInputs): ThisWeekRow[] {
  const monday = weekStart(input.asOf),
    inWeek = (date: string) => date >= monday && date <= input.asOf;
  const rows: ThisWeekRow[] = [];
  function add(
    factor: string,
    title: string,
    icon: "lifts" | "active" | "bedtime",
    value: number,
    goal: number,
  ) {
    rows.push({
      kind: "target",
      factor,
      title,
      icon,
      value,
      goal,
      text: fmt(value) + " of " + goal,
      progress: Math.min(1, value / goal),
    });
  }
  if (input.lifts) add("lifts", "Strength sessions", "lifts", input.lifts.filter(inWeek).length, 2);
  if (input.activeMinutes?.some((r) => inWeek(r.date)))
    add(
      "activeMinutes",
      "Active minutes",
      "active",
      input.activeMinutes.filter((r) => inWeek(r.date)).reduce((s, r) => s + r.value, 0),
      150,
    );
  if (input.bedtime?.some((r) => inWeek(r.date)))
    add(
      "bedtime",
      "Within an hour of your usual bedtime",
      "bedtime",
      input.bedtime.filter((r) => inWeek(r.date) && r.inTarget).length,
      7,
    );
  return rows;
}
function weekStart(date: string) {
  return offset(date, -((new Date(date).getUTCDay() + 6) % 7));
}
function markerText(last: MarkerInput) {
  const text = lookup(model.display, last.modelKey);
  return {
    whatLowersIt: text?.what_helps,
    whatItIs: text?.what_it_is ?? last.label + " is reported in " + last.unit + " on your lab panel.",
  };
}
function bloodViews(input: YouInputs, factors: Factor[], notCounted: YouView["notCounted"]) {
  const markers: Bundle["markers"] = {},
    groups = new Map<string, MarkerInput[]>();
  for (const row of input.markers)
    if (row.date <= input.asOf && row.date >= offset(input.asOf, -364)) {
      const group = groups.get(row.key) ?? [];
      group.push(row);
      groups.set(row.key, group);
    }
  const all = new Map<string, Bundle["blood"]["all"]["systems"][number]["markers"]>();
  const unchanged: Bundle["blood"]["unchanged"] = [],
    worthALook: typeof unchanged = [];
  let latest: string | undefined,
    inRange = 0;
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const dates = [...new Set(group.map((r) => r.date))].sort();
    const daily = dates.map((date) => {
      const matches = group.filter((r) => r.date === date),
        first = matches[0];
      return matches.every((r) => r.value === first.value && r.unit === first.unit && r.flag === first.flag)
        ? first
        : null;
    });
    const last = daily.at(-1);
    if (!last) continue;
    latest = !latest || latest < last.date ? last.date : latest;
    const f = factors.find((r) => r.markerKey === key);
    const summary = {
      key,
      label: last.label,
      value: last.value,
      unit: last.unit,
      flag: last.flag === "normal" ? null : last.flag,
    };
    if (last.flag === "normal") inRange++;
    const system = all.get(last.system) ?? [];
    system.push(summary);
    all.set(last.system, system);
    if (summary.flag) worthALook.push(summary);
    if (!f?.years) unchanged.push(summary);
    markers[key] = {
      key,
      label: last.label,
      value: last.value,
      unit: last.unit,
      years: f?.years,
      target: f?.target,
      history: daily.flatMap((r) => (r?.unit === last.unit ? [{ date: r.date, value: r.value }] : [])),
      ...markerText(last),
    };
  }
  const bloodFactors = factors.filter((f) => f.group === "blood" && f.key !== "bloodPressure");
  return {
    markers,
    blood: {
      latest,
      years: sumYears(bloodFactors),
      factors: bloodFactors,
      notCounted: notCounted.filter((n) => n.action === "bloodWork").map(n => ({ ...n, primary: true })),
      unchanged,
      worthALook,
      all: {
        inRange,
        total: Object.keys(markers).length,
        systems: [...all].map(([name, markers]) => ({ name, markers })),
      },
    },
  };
}
function sumYears(factors: Factor[]) {
  return factors.reduce((s, f) => s + Math.round(f.years * 10), 0) / 10;
}
function section(
  input: YouInputs,
  area: "sleep" | "fitness",
  factors: Factor[],
  notCounted: YouView["notCounted"],
): Bundle["sleep"] {
  const rows = factors.filter((f) => f.group === area || (area === "fitness" && f.group === "activity"));
  const hero = rows.find((f) => f.key === (area === "sleep" ? "sleepTime" : "cardioFitness")) ?? rows[0];
  const unit = area === "sleep" ? "h" : "mL/kg/min",
    field = area === "sleep" ? "asleep_min" : "value";
  const points =
    (area === "sleep" ? input.evidence.sleep_sessions : input.evidence.vo2)
      ?.flatMap((r) => {
        const date = rowDay(r),
          v = number(r[field]);
        return date <= input.asOf && date >= input.historyFrom && v !== null
          ? [{ date, value: area === "sleep" ? v / 60 : v }]
          : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date)) ?? [];
  return {
    title: area === "sleep" ? "Sleep" : "Fitness",
    hero: { value: hero?.value ?? "—", unit: hero?.unit, years: sumYears(rows) },
    chart: points.length ? { kind: "trend", points, unit } : null,
    factors: rows,
    notCounted: notCounted.filter(n => n.action === (area === "sleep" ? "connectWearable" : "combine")).map(n => ({ ...n, primary: true })),
    tiles: rows
      .filter((f) => f !== hero)
      .map((f) => ({ label: f.label, value: [f.value, f.unit].filter(Boolean).join(" ") })),
  };
}
export function emptyYou(profile: Person, asOf: string): YouView {
  return {
    version: MODEL_VERSION,
    asOf,
    profile,
    state: "unavailable",
    thisWeek: [],
    factors: [],
    notCounted: [],
    questions: [],
  };
}
type Score = NonNullable<ReturnType<typeof score>>;
function ambiguousBirthYear(input: YouInputs, at: string) {
  const p = input.evidence.profile;
  return p.approximate_birth_date && [20, 80].includes(Number(at.slice(0, 4)) - Number(p.birth_year));
}
function supportedWeek(input: YouInputs, current: Score) {
  return (
    !current.outside &&
    !current.flags.includes("chronological_age_extrapolation") &&
    !ambiguousBirthYear(input, input.asOf)
  );
}
export function withheld(input: YouInputs, at: string, current: Score | null) {
  if (ambiguousBirthYear(input, at))
    return "Your birth year alone cannot confirm whether you are in the supported age range.";
  if (!current) return null;
  if (current.outside || current.flags.includes("chronological_age_extrapolation"))
    return "The comparison falls outside the age range supported by this model.";
  const keys = Object.keys(current.parts);
  if (keys.length === 1 && (current.rows[keys[0]].quality < 1 || model.optional.includes(keys[0])))
    return "Another independent measurement is needed for an age estimate from this panel.";
  return null;
}
function viewFactors(input: YouInputs, current: Score | null) {
  if (!current) return [];
  const measured = finishFactors(current.rows, current.parts, current.age, current.sex);
  return Object.entries(measured)
    .map(([k, r]) => factorFor(k, { ...r, grade: r.evidence_grade }, r.contribution_tenths, input, current.real))
    .sort((a, b) => Math.abs(b.years) - Math.abs(a.years) || a.key.localeCompare(b.key))
    .map((factor, index) => ({ ...factor, featured: index < 5 }));
}
export function buildViews(input: YouInputs): Bundle {
  // Pin an undated reported age to this refresh across every historical snapshot.
  const p = input.evidence.profile;
  if (p.age != null && !p.age_as_of)
    input = { ...input, evidence: { ...input.evidence, profile: { ...p, age_as_of: input.asOf } } };
  const { asOf, evidence } = input;
  const you = emptyYou({ memberId: "", firstName: "" }, asOf);
  const current = score(evidence, asOf);
  const rows = current?.rows ?? {},
    factors = viewFactors(input, current);
  const reason = withheld(input, asOf, current);
  const ready = !!current && !reason && Object.keys(current.parts).length > 0;
  you.state = reason ? "building" : !current ? "paused" : ready ? "ready" : "building";
  if (you.state === "paused")
    you.paused = { text: "An age estimate is outside the model’s supported range for this profile." };
  if (you.state === "building") {
    you.building = reason
      ? { have: 0, need: 1, text: reason }
      : {
          have: recentSleepNights(evidence, asOf),
          need: model.daily.minimum,
          text: "Recent measurements are needed to build your age comparison.",
        };
  }
  you.factors = factors;
  you.notCounted = current ? offerings(input, rows, current.age) : [];
  you.thisWeek = ownTargets(input);
  you.questions = nextQuestion(input, rows, false, you.state === "paused");
  let age: Bundle["age"] = null,
    week: Bundle["week"] = null;
  if (ready && current) {
    const { value, real, gap, low, high } = current;
    you.age = { value, real, gap, low, high };
    age = ageHistory(input, current, you.age);
  }
  if (current && supportedWeek(input, current)) week = weekView(input, current, you);
  return {
    you,
    optionQuestions: you.questions.some((q) => !q.options.length)
      ? nextQuestion(input, rows, true)
      : you.questions,
    age,
    week,
    ...bloodViews(input, factors, you.notCounted),
    sleep: section(input, "sleep", factors, you.notCounted),
    fitness: section(input, "fitness", factors, you.notCounted),
  };
}

function factorGroup(k: string): Factor["group"] {
  return fields[k]?.group === "blood" || bloodKeys.has(k) || k === "sbp"
    ? "blood"
    : ["sleep", "onset_sd", "sleep_regularity", "l5_midpoint"].includes(k)
      ? "sleep"
      : fitness.has(k)
        ? "fitness"
        : activities.has(k)
          ? "activity"
          : ["bmi", "waist", "lean_change", "weight_loss", "whtr"].includes(k)
            ? "body"
            : food.has(k)
              ? "food"
              : "habits";
}

function displayValue(k: string, r: Contribution) {
  let value = typeof r.value === "number" ? fmt(r.value) : r.value,
    unit: string | null = r.unit;
  const sleep = k === "sleep" && typeof r.value === "number" ? Math.round(r.value * 60) : null;
  if (sleep !== null) {
    value = Math.floor(sleep / 60) + "h " + (sleep % 60) + "m";
    unit = null;
  }
  if (k === "smoking") {
    value = Number(r.value) === 0 ? "Never" : Number(r.value) === 1 ? "Current" : "Former";
    unit = null;
  }
  if (k === "disease" || k === "diabetes") {
    value = r.value ? "Yes" : "No";
    unit = null;
  }
  return { value, unit };
}

// Only directional, age/sex-matched norms can support a favorable rank.
export function favorableRank(key: string, raw: number | null) {
  if (raw === null) return null;
  const higher = [
    "steps",
    "hip_minutes",
    "activity",
    "grip",
    "vo2",
    "vo2_peak",
    "gait",
    "gait_speed",
    "knee",
    "fev1",
  ];
  const lower = ["non_hdl", "ldl_c", "lpa", "rdw", "acr"];
  const percentile = higher.includes(key) ? raw : lower.includes(key) ? 100 - raw : null;
  if (percentile === null || percentile < 40) return null;
  return { percentile, label: percentile >= 60 ? `Top ${Math.max(1, 100 - percentile)}%` : "Average" };
}

function factorRank(key: string, r: Contribution, input: YouInputs, age: number) {
  const rank = favorableRank(key, r.percentile);
  if (!rank) return null;
  const sex = String(input.evidence.profile.sex).toLowerCase();
  return {
    ...rank,
    cohort: (sex === "female" || sex === "f" ? "Women" : "Men") + " near age " + Math.floor(age),
  };
}

function ageHistory(
  input: YouInputs,
  current: NonNullable<ReturnType<typeof score>>,
  headline: NonNullable<YouView["age"]>,
): NonNullable<Bundle["age"]> {
  const { asOf, evidence } = input;
  const history: NonNullable<Bundle["age"]>["history"] = [],
    weeks: NonNullable<Bundle["age"]>["weeks"] = [];
  const events: NonNullable<Bundle["age"]>["events"] = [];
  const earliest = input.ageHistoryFrom ?? input.historyFrom;
  for (let i = 0; i <= 52; i++) {
    const date = offset(asOf, -7 * i);
    if (date < earliest) break;
    const past = i === 0 ? current : score(evidence, date);
    if (!past || withheld(input, date, past) || !Object.keys(past.parts).length) continue;
    if (past.residual && offset(date, -7) >= earliest)
      events.push({
        date,
        kind: "evidenceChange",
        label: "Change in measurement evidence",
        evidenceChangeYears: past.residual,
      });
    history.unshift({ date, age: past.value, real: past.real });
    if (i < 12 && past.days !== null && offset(date, -7) >= earliest)
      weeks.unshift({
        weekStart: offset(date, -6),
        daysAged: past.days,
        basis: Object.keys(past.changes).length ? "observed" : "referenceOnly",
      });
  }
  for (const [records, kind, label] of [
    [evidence.labs, "bloodWork", "Blood work"],
    [evidence.bp, "bloodPressure", "Blood pressure"],
    [evidence.fitness_tests, "combine", "Fitness test"],
    [
      evidence.checkins?.filter((r) => r.food_week || r.habitual_fibre_g_day != null || r.diet_day_complete),
      "foodWeek",
      "Food week",
    ],
  ] as const) {
    for (const date of new Set((records ?? []).map(rowDay)))
      if (date >= input.historyFrom && date <= asOf) events.push({ date, kind, label });
  }
  return {
    ...headline,
    history,
    weeks,
    historyLabel: "Reconstructed using the current model and available dated measurements.",
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function weekView(
  input: YouInputs,
  current: NonNullable<ReturnType<typeof score>>,
  you: YouView,
): Bundle["week"] {
  const { asOf, evidence } = input;
  const rows = current.rows;
  if (current.days !== null) {
    const days: NonNullable<Bundle["week"]>["days"] = [];
    for (let i = 6; i >= 0; i--) {
      const date = offset(asOf, -i),
        daily = score(evidence, date, 1);
      if (daily?.days != null && date >= input.historyFrom)
        days.push({
          date,
          label: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
            new Date(date),
          ),
          aged: daily.days,
        });
    }
    const delta = Object.entries(current.changes).flatMap(([k, v]) => {
      const f = factorFor(k, rows[k], 0, input, current.real);
      return v ? [{ key: f.key, label: f.label, icon: f.icon, days: Math.round(v * YEAR * 100) / 100 }] : [];
    });
    const saved = Math.round((7 - current.days) * 100) / 100;
    const observedDays = new Set(
      [
        ...(evidence.daily ?? []),
        ...(evidence.sleep_sessions ?? []),
        ...(evidence.checkins ?? []),
        ...(evidence.workouts ?? []),
      ]
        .map(rowDay)
        .filter((d) => d >= offset(asOf, -6) && d <= asOf),
    );
    you.week = {
      daysAged: current.days,
      saved,
      partial: !Object.keys(current.changes).length || observedDays.size < 7,
      basis: Object.keys(current.changes).length ? "observed" : "referenceOnly",
    };
    return {
      daysAged: current.days,
      saved,
      days,
      helped: delta.filter((x) => x.days < 0),
      cost: delta.filter((x) => x.days > 0),
    };
  }
  return null;
}
