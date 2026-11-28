import { habitQuestionsV1 } from "@murphai/contracts";
import { offerings } from "./offerings";
import { youLabel } from "./labels";
import { nextQuestion } from "./questions";
import type { Bundle, Factor, Person, ThisWeekRow, YouView } from "./contract";
import { bpValue, recentSleepNights } from "./engine/observations";
import { finishFactors } from "./engine/report";
import { MODEL_VERSION, pauseReason, score } from "./engine";
import { eligible, fields, lookup, model, number, offset, rowDay, YEAR, type Contribution, type Observation } from "./engine/model";
import type { MarkerInput, YouInputs } from "./evidence";

const keys: Record<string, string> = {
  onset_sd: "bedtime",
  meal_fibre: "mealFibre",
  meal_density: "mealFibreDensity",
  alcohol_peak: "mostDrinks",
  caffeine_timing: "caffeineTiming",
  alcohol_timing: "alcoholTiming",
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
  "coffee_cups",
  "tea_cups",
  "olive_oil",
  ...model.overlap.absolute_log_caps.food.factors,
  "alcohol",
  "meal_fibre",
  "meal_density",
  "alcohol_peak",
  "caffeine_timing",
  "alcohol_timing",
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
  "zone_intensity",
  "cycle_commute",
  "usual_pace",
  "steps",
  "hip_minutes",
  "activity",
  "aerobic",
  "running",
  "lifting",
  "vilpa",
  "sedentary",
]);
// Survey medians describe cohorts. Only publish goals with a member-facing interpretation.
const aims: Record<string, string> = {
  sleep: "Aim for 7h to 9h a night",
  steps: "Aim for 8,000+ steps a day",
  aerobic: "Aim for 150 active minutes a week",
  activity: "Aim for 150 active minutes a week",
  hip_minutes: "Aim for 150 active minutes a week",
  lifting: "Aim for strength training on 2 days a week",
  fasting_glucose: "Aim under 100 mg/dL",
};
const actions: Record<string, string> = {
  ldl: "Try replacing butter with olive oil when cooking.",
  ldl_c: "Try replacing butter with olive oil when cooking.",
  steps: "Add a short walk to a part of your day when you usually sit.",
  sleep: "Set aside enough time for sleep at a regular bedtime.",
  onset_sd: "Try going to bed around the same time each night.",
  meal_fibre: "Add beans, whole grains or fruit to a meal.",
};
const units: Record<string, string> = {
  "K6 points": "points",
  "correct/3": "of 3 words",
  "1–5": "out of 5",
  "1–4": "out of 4",
  "whole cups/day": "cups a day",
  "cups/day": "cups a day",
  "events/hour": "times an hour",
  "yes=1": "",
  category: "",
  "decimal acuity": "",
  Agatston: "points",
  "recorded moderate-equivalent min/day": "active min a day",
  "steps/day": "steps a day",
  "moderate-equivalent min/week": "active min a week",
  "estimated moderate-equivalent min/week": "active min a week",
  "US drinks/sitting": "standard drinks",
  "g/1,000 logged kcal": "g per 1,000 logged calories",
  "hours before main sleep": "hours before sleep",
  "h SD": "min of variation",
  "ms RMSSD": "ms",
  "bpm asleep": "bpm",
  "g/day": "g a day",
  "mean g ethanol/day": "g of alcohol a day",
  "mL/day": "mL a day",
  "days/week": "days a week",
  "verified days/week": "days a week",
  "sessions/week": "sessions a week",
  "partial pattern /100": "out of 100",
  "kg, mean hand maximum": "kg",
  "sitting-rising test points (0–10)": "out of 10",
  "10 s test result": "",
  "ordinal 1–5": "out of 5",
  "SRI points": "points",
  "HEI-2015 cohort quintile": "out of 5",
  "local clock category": "",
  "habitual weightlifting frequency category": "",
  "waking h/day": "hours a day",
  "min/day in vigorous lifestyle bouts lasting ≤2 min": "min a day",
  "% RBC EPA+DHA": "%",
  "kg/m2": "kg/m²",
  "mL/min/1.73m2": "mL/min/1.73 m²",
  "ug/dL": "µg/dL",
  "umol/L": "µmol/L",
  "mL/min/1.73m^2": "mL/min/1.73 m²",
  "10^3/uL": "thousand/µL",
  "10^6/uL": "million/µL",
  "Thousand/uL": "thousand/µL",
  "percent": "%",
};
function displayUnit(unit: string) {
  return lookup(units, unit) ?? unit;
}
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
  const targetText = lookup(aims, k);
  return {
    key,
    label,
    icon: key,
    group,
    value,
    unit,
    years: tenths / 10,
    yearsText: signed(tenths / 10),
    whatItIs: r.what_it_is ?? lookup(model.display, k)?.what_it_is,
    whatLowersIt: lookup(actions, k),
    rank,
    target: targetText ? { text: targetText } : null,
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
    whatLowersIt: lookup(actions, last.modelKey),
    whatItIs: text?.what_it_is ?? last.label + " is reported in " + displayUnit(last.unit) + " on your lab panel.",
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
      unit: displayUnit(last.unit),
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
      unit: displayUnit(last.unit),
      years: f?.years || null,
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
  const weekMinutes = input.activeMinutes?.filter(r => r.date >= offset(input.asOf, -6) && r.date <= input.asOf);
  const observedMinutes = weekMinutes?.length ? {
    key: "activeMinutes", label: "Active minutes", unit: "active min in 7 days",
    value: fmt(weekMinutes.reduce((sum, r) => sum + r.value, 0), 0),
  } : undefined;
  const measurements = area === "fitness" ? [
    ...rows,
    ...(!rows.some(f => f.key === "activeMinutes") && observedMinutes ? [observedMinutes] : []),
  ] : [...rows, ...factors.filter(f => ["hrv", "restingHeartRate"].includes(f.key))];
  const priority = area === "sleep" ? ["sleepTime"] : ["steps", "activeMinutes", "aerobic", "cardioFitness"];
  const hero = priority.map(key => measurements.find(f => f.key === key)).find(Boolean);
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
    tiles: measurements
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
    return { have: 0, need: 1, text: "Add your full date of birth so Murph can check your age." };
  if (!current) return null;
  if (current.outside || current.flags.includes("chronological_age_extrapolation"))
    return { have: 0, need: 1, text: "Your estimate is outside the range Murph can show. Add one new lab report to update it." };
  const keys = Object.keys(current.parts);
  if (keys.length === 1 && (current.rows[keys[0]].quality < 1 || model.optional.includes(keys[0])))
    return { have: 1, need: 2, text: "Add one more type of measurement, such as a lab result." };
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
function sleepProgress(input: YouInputs) {
  const have = recentSleepNights(input.evidence, input.asOf);
  const need = model.daily.minimum;
  const left = need - have;
  const text = have
    ? `Wear your band for ${left} more ${left === 1 ? "night" : "nights"}.`
    : `Add a lab report or wear your band for ${need} nights.`;
  return { have, need, text };
}
function headlineState(input: YouInputs, current: Score | null): Pick<YouView, "state" | "building" | "paused"> {
  const pause = !current && pauseReason(input.evidence, input.asOf, input.asOf);
  if (pause && !(pause === "age" && ambiguousBirthYear(input, input.asOf))) {
    const text = {
      pregnant: "Paused while you're pregnant",
      postpartum: "Paused for now after having a baby",
      age: "Murph works out ages 20 to 80",
      birthDate: "Add your date of birth in About you to see your age",
      sex: "Add your sex in About you to see your age",
      beforeJoining: "Your age history starts when you join Murph",
    }[pause];
    return { state: "paused", paused: { text } };
  }
  const reason = withheld(input, input.asOf, current);
  if (reason) return { state: "building", building: reason };
  if (!current || !Object.keys(current.parts).length)
    return { state: "building", building: sleepProgress(input) };
  return { state: "ready" };
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
  Object.assign(you, headlineState(input, current));
  you.factors = factors;
  you.notCounted = current ? offerings(input, rows, current.age) : [];
  you.thisWeek = ownTargets(input);
  you.questions = nextQuestion(input, rows, false, you.state === "paused");
  let age: Bundle["age"] = null,
    week: Bundle["week"] = null;
  if (you.state === "ready" && current) {
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
  const family = lookup(model.evidence.factors, k)?.family;
  if (family === "motion") return "activity";
  if (family === "food") return "food";
  if (["sleep_initiation","early_waking","nonrestorative_sleep","daytime_sleepiness","habitual_nap"].includes(k)) return "sleep";
  if (k==="pushups_max") return "fitness";
  if (k==="thigh_cm" || k==="waist_hip_ratio") return "body";
  return fields[k]?.group === "blood" || bloodKeys.has(k) || k === "sbp"
    ? "blood"
    : ["sleep", "onset_sd", "sleep_regularity", "l5_midpoint", "ahi"].includes(k)
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

function categoryValue(r: Contribution, value: string) {
  if (r.unit === "yes=1") value = r.value ? "Yes" : "No";
  if (typeof r.value === "string" && r.unit === "category") {
    const choices: Record<string, string> = {
      daily_shared: "Daily, living with others",
      daily_alone: "Daily, living alone",
      never_shared: "Never, living with others",
      never_alone: "Never, living alone",
      never_tobacco: "Never used tobacco",
      current_exclusive_smokeless: "Smokeless tobacco only",
      current_daily_exclusive_cigar: "Cigars only, every day",
      never_or_rare: "Rarely or never",
      above_7_g_day: "More than 7 g a day",
      car_or_public_transport: "Car or public transit",
      cycle_only: "Bicycle",
      brisk_or_fast: "Brisk or fast",
      slow: "Slow",
      average: "Average",
    };
    value = lookup(choices, r.value) ?? value;
  }
  return value;
}

function habitLabel(k: string, value: Contribution["value"]) {
  const question = lookup<{ options: Readonly<Record<string, string | number | null>> }>(habitQuestionsV1, k);
  return question && Object.entries(question.options).find(([, comparison]) => comparison === value)?.[0];
}

function displayValue(k: string, r: Contribution) {
  let value = typeof r.value === "number" ? fmt(r.value) : r.value,
    unit: string | null = displayUnit(r.unit) || null;
  if (k === "vo2" || k === "vo2_peak") {
    value = fmt(Number(r.value) * (k === "vo2_peak" ? 3.5 : 1), 0);
    unit = "VO2 max";
  }
  if (r.unit === "HEI-2015 cohort quintile") value = String(r.value).replace(/^Q/, "");
  if (r.unit === "habitual weightlifting frequency category") value = value.replace("/week", " a week").replace("/month", " a month");
  if (r.unit === "h SD") value = fmt(Number(r.value) * 60, 0);
  if (["moderate-equivalent min/day", "recorded moderate-equivalent min/day"].includes(r.unit)) {
    value = fmt(Number(r.value) * 7, 0);
    unit = "active min a week";
  }
  const sleep = k === "sleep" && typeof r.value === "number" ? Math.round(r.value * 60) : null;
  if (sleep !== null) {
    value = Math.floor(sleep / 60) + "h " + (sleep % 60) + "m";
    unit = null;
  }
  value = categoryValue(r, value);
  const habit = habitLabel(k, r.value);
  if (habit !== undefined) return { value: habit, unit: null };
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
  if (percentile === null || percentile < 60) return null;
  return { percentile, label: `Top ${Math.max(1, 100 - percentile)}%` };
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

function ageEvents(input: YouInputs) {
  const { evidence, asOf } = input;
  const events: NonNullable<Bundle["age"]>["events"] = [];
  const datesOf = (records: Observation[] = []) =>
    [...new Set(records.filter((row) => eligible(row, asOf)).map(rowDay))].sort();
  const pressureDates = datesOf([...(evidence.bp ?? []), ...(evidence.pressure_components ?? [])]);
  const firstSeries = pressureDates.find((date) => bpValue(evidence, date));
  for (const [dates, kind, label] of [
    [datesOf(evidence.labs?.filter((r) => r.status !== "pending")), "bloodWork", "Blood work"],
    [firstSeries ? [firstSeries] : [], "bloodPressure", "Blood pressure"],
    [
      datesOf(
        evidence.fitness_tests?.filter(
          (row) => row.protocol === "murph-combine-v1" && !row.skipped && !row.pain_or_stop,
        ),
      ),
      "combine",
      "Fitness Combine",
    ],
    [datesOf(evidence.food_weeks?.filter((row) => row.complete === true)), "foodWeek", "Food week"],
  ] as const) {
    const seen = new Set<string>();
    for (const date of dates) {
      const monday = weekStart(date);
      if (date < input.historyFrom || seen.has(monday)) continue;
      seen.add(monday);
      events.push({ date, kind, label });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function ageHistory(
  input: YouInputs,
  current: NonNullable<ReturnType<typeof score>>,
  headline: NonNullable<YouView["age"]>,
): NonNullable<Bundle["age"]> {
  const { asOf, evidence } = input;
  const history: NonNullable<Bundle["age"]>["history"] = [],
    weeks: NonNullable<Bundle["age"]>["weeks"] = [];
  const earliest = input.ageHistoryFrom ?? input.historyFrom;
  for (let i = 0; i <= 52; i++) {
    const date = offset(asOf, -7 * i);
    if (date < earliest) break;
    const past = i === 0 ? current : score(evidence, date);
    if (!past || withheld(input, date, past) || !Object.keys(past.parts).length) continue;
    history.unshift({ date, age: past.value, real: past.real });
    if (i < 12 && past.days !== null && offset(date, -7) >= earliest)
      weeks.unshift({
        weekStart: offset(date, -6),
        daysAged: past.days,
        basis: Object.keys(past.changes).length ? "observed" : "referenceOnly",
      });
  }
  return {
    ...headline,
    history,
    weeks,
    historyLabel: "Reconstructed using the current model and available dated measurements.",
    events: ageEvents(input),
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
      const days = v * YEAR;
      if (Math.abs(days) < 0.05) return [];
      const f = factorFor(k, rows[k], 0, input, current.real);
      return [{ key: f.key, label: f.label, icon: f.icon, days: Math.round(days * 100) / 100 }];
    });
    const saved = Math.round((7 - current.days) * 100) / 100;
    const observedDays = new Set(
      [
        ...(evidence.daily ?? []),
        ...(evidence.sleep_sessions ?? []),
        ...(evidence.checkins ?? []),
        ...(evidence.workouts ?? []),
        ...(current.changes.meal_density !== undefined ? evidence.meals ?? [] : []),
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
