import type { Bundle, Factor, Person, ThisWeekRow, YouView } from "./contract";
import { recentSleepNights } from "./engine/observations";
import { MODEL_VERSION, score } from "./engine";
import { fields, model, number, offset, rowDay, YEAR, type Contribution } from "./engine/model";
import type { MarkerInput, YouInputs } from "./evidence";

const keys: Record<string, [string, string]> = {
  sleep: ["sleepTime", "Sleep duration"],
  pulse: ["restingHeartRate", "Resting heart rate"],
  steps: ["steps", "Daily steps"],
  activity: ["activeMinutes", "Active minutes"],
  hip_minutes: ["activeMinutes", "Active minutes"],
  vo2_peak: ["cardioFitness", "Cardio fitness"],
  vo2: ["cardioFitness", "Cardio fitness"],
  sbp: ["bloodPressure", "Blood pressure"],
  floor_rise: ["sitRise", "Sit and rise"],
  lifting: ["lifts", "Strength training"],
  sleep_regularity: ["bedtime", "Sleep regularity"],
  non_hdl: ["cholesterol", "Non-HDL cholesterol"],
  ldl_c: ["cholesterol", "LDL cholesterol"],
  lpa: ["lpa", "Lipoprotein(a)"],
  a1c: ["bloodSugar", "HbA1c"],
  crp: ["inflammation", "hs-CRP"],
  rdw: ["rdw", "Red cell distribution width"],
  wbc: ["wbc", "White blood cell count"],
  acr: ["acr", "Urine albumin-to-creatinine ratio"],
  phq9: ["phq9", "Mood questionnaire"],
  bmi: ["bmi", "Body mass index"],
  fev1: ["fev1", "Lung function"],
  health: ["health", "Self-rated health"],
  disease: ["disease", "Health history"],
  fibre: ["fibre", "Dietary fibre"],
};
const food = new Set([...model.overlap.absolute_log_caps.food.factors, "alcohol"]);
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
const activities = new Set(["steps", "hip_minutes", "activity", "lifting", "vilpa", "sedentary"]);
const fmt = (v: number, decimals = 1) => v.toLocaleString("en-US", { maximumFractionDigits: decimals });
function signed(v: number) {
  return (v < 0 ? "−" : "+") + Math.abs(v).toFixed(1);
}
function factorFor(k: string, r: Contribution, tenths: number, input: YouInputs, age: number): Factor {
  const marker = input.markers.find((m) => m.modelKey === k);
  const [key, label] = keys[k] ?? [
    k,
    marker?.label ?? (k.charAt(0).toUpperCase() + k.slice(1)).replaceAll("_", " "),
  ];
  const group = factorGroup(k);
  const { value, unit } = displayValue(k, r);
  const rank = factorRank(r, input, age);
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
function offerings(rows: Record<string, Contribution>) {
  const options: YouView["notCounted"] = [];
  for (const [key, label, action, present] of [
    ["strength", "Strength test", "combine", rows.grip || rows.floor_rise || rows.balance],
    ["food", "Food week", "foodWeek", [...food].some((k) => k !== "alcohol" && rows[k])],
    ["bloodPressure", "Blood pressure", "addBloodPressure", rows.sbp],
    ["sleepTime", "Sleep duration", "connectWearable", rows.sleep],
  ] as const)
    if (!present) options.push({ key, label, icon: key, action, primary: options.length === 0 });
  return options;
}
export function ownTargets(input: YouInputs): ThisWeekRow[] {
  const monday = weekStart(input.asOf),
    inWeek = (date: string) => date >= monday && date <= input.asOf;
  const rows: ThisWeekRow[] = [];
  function add(factor: string, title: string, icon: "lifts" | "active" | "bedtime", value: number, goal: number) {
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
      "Nights in your bedtime window",
      "bedtime",
      input.bedtime.filter((r) => inWeek(r.date) && r.inTarget).length,
      7,
    );
  return rows;
}
function weekStart(date: string) {
  return offset(date, -((new Date(date).getUTCDay() + 6) % 7));
}
function bloodViews(input: YouInputs, factors: Factor[], notCounted: YouView["notCounted"]) {
  const markers: Bundle["markers"] = {},
    groups = new Map<string, MarkerInput[]>();
  for (const row of input.markers)
    if (row.date <= input.asOf && row.date >= input.historyFrom) {
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
      whatItIs: last.label + " is reported in " + last.unit + " on your lab panel.",
    };
  }
  const bloodFactors = factors.filter((f) => f.group === "blood" && f.key !== "bloodPressure");
  return {
    markers,
    blood: {
      latest,
      years: sumYears(bloodFactors),
      factors: bloodFactors,
      notCounted: notCounted.filter((n) => n.action === "bloodWork"),
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
    notCounted: notCounted.filter((n) => (area === "sleep" ? n.key === "sleepTime" : n.action === "combine")),
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
export function buildViews(input: YouInputs): Bundle {
  const { asOf, evidence } = input;
  const you = emptyYou({ memberId: "", firstName: "" }, asOf);
  const current = score(evidence, asOf);
  const rows = current?.rows ?? {},
    factors = current
      ? Object.entries(current.parts)
          .map(([k, v]) => factorFor(k, rows[k], v, input, current.real))
          .sort((a, b) => Math.abs(b.years) - Math.abs(a.years) || a.key.localeCompare(b.key))
      : [];
  const ready = !!current && !current.outside && factors.length > 0;
  you.state = !current || current.outside ? "paused" : ready ? "ready" : "building";
  if (you.state === "paused")
    you.paused = { text: "An age estimate is outside the model’s supported range for this profile." };
  if (you.state === "building") {
    you.building = {
      have: recentSleepNights(evidence, asOf),
      need: model.policy.minimum_observed_days,
      text: "7 recent nights of measured sleep, or a qualifying measurement",
    };
  }
  you.factors = factors;
  you.notCounted = offerings(rows);
  you.thisWeek = ownTargets(input);
  if (!rows.smoking && you.state !== "paused")
    you.questions = [
      {
        key: "smoking",
        text: "Which best describes your cigarette use?",
        options: [
          { value: "never", label: "Never smoked regularly" },
          { value: "former", label: "Former smoker" },
          { value: "current", label: "Currently smoke" },
          { value: "unknown", label: "Skip" },
        ],
      },
    ];
  let age: Bundle["age"] = null,
    week: Bundle["week"] = null;
  if (ready && current) {
    const { value, real, gap, low, high } = current;
    you.age = { value, real, gap, low, high };
    age = ageHistory(input, current, you.age);
    week = weekView(input, current, you);
  }
  return {
    you,
    age,
    week,
    ...bloodViews(input, factors, you.notCounted),
    sleep: section(input, "sleep", factors, you.notCounted),
    fitness: section(input, "fitness", factors, you.notCounted),
  };
}

function factorGroup(k: string): Factor["group"] {
  return fields[k]?.group === "blood" || ["lpa", "ldl_c", "sbp"].includes(k)
    ? "blood"
    : ["sleep", "sleep_regularity", "l5_midpoint"].includes(k)
      ? "sleep"
      : fitness.has(k)
        ? "fitness"
        : activities.has(k)
          ? "activity"
          : ["bmi", "waist"].includes(k)
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

function factorRank(r: Contribution, input: YouInputs, age: number) {
  const percentile = r.percentile;
  if (percentile === null) return null;
  // R2 ranks the raw observation. A high exposure may carry a higher risk.
  const sex = String(input.evidence.profile.sex).toLowerCase();
  const last = percentile % 10;
  const suffix =
    percentile % 100 >= 11 && percentile % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][last] ?? "th");
  return {
    percentile,
    label: percentile + suffix + " percentile",
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
  for (let i = 0; i <= 52; i++) {
    const date = offset(asOf, -7 * i);
    if (date < input.historyFrom) break;
    const past = i === 0 ? current : score(evidence, date);
    if (!past || past.outside || !Object.keys(past.parts).length) continue;
    history.unshift({ date, age: past.value, real: past.real });
    if (i < 12 && past.days !== null && offset(date, -7) >= input.historyFrom)
      weeks.unshift({
        weekStart: offset(date, -6),
        daysAged: past.days,
        basis: Object.keys(past.changes).length ? "observed" : "referenceOnly",
      });
  }
  const events: NonNullable<Bundle["age"]>["events"] = [];
  for (const [records, kind, label] of [
    [evidence.labs, "bloodWork", "Blood work"],
    [evidence.bp, "bloodPressure", "Blood pressure"],
    [evidence.fitness_tests, "combine", "Fitness test"],
    [
      evidence.checkins?.filter((r) => r.habitual_fibre_g_day != null || r.diet_day_complete),
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

function weekView(input: YouInputs, current: NonNullable<ReturnType<typeof score>>, you: YouView): Bundle["week"] {
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
          label: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(date)),
          aged: daily.days,
        });
    }
    const delta = Object.entries(current.changes).flatMap(([k, v]) => {
      const f = factorFor(k, rows[k], 0, input, current.real);
      return v ? [{ key: f.key, label: f.label, icon: f.icon, days: Math.round(v * YEAR * 100) / 100 }] : [];
    });
    const saved = Math.round((7 - current.days) * 100) / 100;
    const observedDays = new Set(
      [...(evidence.daily ?? []), ...(evidence.sleep_sessions ?? []), ...(evidence.checkins ?? [])]
        .map(rowDay)
        .filter((d) => d >= offset(asOf, -6) && d <= asOf),
    );
    you.week = {
      daysAged: current.days,
      saved,
      partial: observedDays.size < 7,
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
