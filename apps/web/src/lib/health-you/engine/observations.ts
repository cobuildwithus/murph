import {
  between,
  catalog,
  dated,
  day,
  device,
  distance,
  eligible,
  fields,
  logTable,
  model,
  native,
  number,
  pick,
  released,
  rowDay,
  unique,
  YEAR,
  type MemberEvidence,
  type Observation,
  type Rows,
  type Sex,
} from "./model";

export function restrictions(p: Observation) {
  const cond = Array.isArray(p.conditions) ? p.conditions : [],
    meds = Array.isArray(p.meds) ? p.meds : [];
  const wheelchair = p.wheelchair || cond.includes("wheelchair_user");
  const restricted =
    wheelchair ||
    p.adapted_mobility ||
    p.exercise_restriction ||
    cond.includes("exercise_restriction") ||
    p.pem ||
    cond.includes("pem");
  const rate = p.rate_limiting_medication || meds.includes("beta_blocker") || meds.includes("rate_limiting");
  return {
    restricted,
    rate,
    wheelchair,
    pulse: rate || p.arrhythmia || cond.includes("arrhythmia"),
    body: p.edema || cond.includes("edema") || p.eating_disorder || cond.includes("eating_disorder"),
  };
}

type Stream = keyof typeof model.policy.wearable_tau_days;
type StreamDates = Map<string, Map<string, Set<number>>>;
type AddSample = (key: Stream, value: number | null, min: number, max: number) => void;
function recordIntensity(r: Observation, source: string, add: AddSample) {
  const mod = number(r.moderate_min),
    vig = number(r.vigorous_min);
  if (r.intensity_kind === "apple_exercise" && source === "apple" && r.effort_confirmed === true) {
    if (between(mod, 0, 960)) add("activity", 7 * mod, 0, 6720);
  } else if (
    ["garmin_im", "fitbit_azm"].includes(String(r.intensity_kind)) &&
    r.equivalent_minutes === true &&
    r.effort_confirmed === true
  ) {
    if (between(mod, 0, 1920)) add("activity", 7 * mod, 0, 13440);
  } else if (between(mod, 0, 960) && between(vig, 0, 960 - mod)) {
    if (["research_hip", "validated_moderate_vigorous"].includes(String(r.intensity_kind)))
      add("hip_minutes", mod + 2 * vig, 0, 1920);
    else if (
      (r.intensity_kind == null || r.intensity_kind === "moderate_vigorous") &&
      r.equivalent_minutes !== true
    )
      add("activity", 7 * (mod + 2 * vig), 0, 13440);
  }
}
function observedStreams(data: MemberEvidence, at: string) {
  const limit = restrictions(data.profile);
  const streams = new Map<Stream, Map<string, Map<string, Set<number>>>>();
  for (const group of ["daily", "sleep_sessions"] as const) {
    for (const r of dated(data, group, at, Infinity)) {
      const source = r.source,
        date = rowDay(r);
      if (
        typeof source !== "string" ||
        !source ||
        ["phone", "schedule"].includes(source) ||
        ["partial", "off_body", "unfinished", "nap", "is_nap"].some((k) => r[k])
      )
        continue;
      function add(key: Stream, value: number | null, lo: number, hi: number) {
        if (!between(value, lo, hi)) return;
        const dates = streams.get(key) ?? new Map<string, Map<string, Set<number>>>();
        const sources = dates.get(date) ?? new Map<string, Set<number>>();
        const values = sources.get(String(source)) ?? new Set<number>();
        values.add(value);
        sources.set(String(source), values);
        dates.set(date, sources);
        streams.set(key, dates);
      }
      if (group === "sleep_sessions") {
        if (r.type == null || r.type === "main") add("sleep", (number(r.asleep_min) ?? NaN) / 60, 3, 16);
        continue;
      }
      if (!limit.pulse) add("pulse", number(r.rhr), 30, 180);
      if (
        limit.restricted ||
        !(r.wear_complete === true || (r.wear_complete == null && (number(r.worn_min) ?? 0) >= 1296))
      )
        continue;
      add("steps", number(r.steps), 0, 65000);
      if (limit.rate) continue;
      recordIntensity(r, source, add);
    }
  }
  return streams;
}
function chooseSource(sources: Map<string, Set<number>>, preferred: string, previous: string) {
  const good = [...sources.keys()].filter((key) => sources.get(key)!.size === 1).sort();
  return good.includes(preferred) ? preferred : good.includes(previous) ? previous : good[0];
}

export function recentSleepNights(data: MemberEvidence, at: string) {
  const dates = observedStreams(data, at).get("sleep");
  if (!dates) return 0;
  let last = "",
    source = "",
    count = 0;
  for (const date of [...dates.keys()]
    .filter((date) => distance(at, date) < model.policy.median_window_days)
    .sort()) {
    const next = chooseSource(dates.get(date)!, String(data.profile.preferred_source), source);
    if (!next) continue;
    count = source !== next || distance(date, last) > 3 ? 1 : count + 1;
    last = date;
    source = next;
  }
  return last && distance(at, last) <= model.policy.fresh_days ? count : 0;
}

function smoothStream(key: Stream, dates: StreamDates, data: MemberEvidence, at: string, age: number, sex: Sex) {
  let source = "",
    last = "",
    start = "",
    state: number | null = null;
  let window: { date: string; value: number }[] = [];
  let rec = null;
  for (const date of [...dates.keys()].sort()) {
    const sources = dates.get(date)!;
    const src = chooseSource(sources, String(data.profile.preferred_source), source);
    if (!src) continue;
    if (src !== source || distance(date, last) > 3) {
      state = null;
      window = [];
      start = date;
    }
    window = window.filter((x) => distance(date, x.date) < model.policy.median_window_days);
    window.push({ date, value: [...sources.get(src)!][0] });
    if (window.length >= model.policy.minimum_observed_days) {
      const values = window.map((x) => x.value).sort((a, b) => a - b);
      const x = (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
      rec =
        key === "steps" || key === "hip_minutes"
          ? device(key, x, age, sex)
          : native(key, x, age, sex, { sleep: 0.45, pulse: 0.5, activity: 0.35 }[key]);
      if (!rec) continue;
      const rate = model.policy.max_wearable_change_years_per_stream_day;
      state =
        state === null
          ? rec.years
          : state +
            Math.max(
              -rate,
              Math.min(rate, (rec.years - state) * -Math.expm1(-1 / model.policy.wearable_tau_days[key])),
            );
    } else state = null;
    last = date;
    source = src;
  }
  if (rec && state !== null && distance(at, last) <= model.policy.fresh_days)
    return { ...rec, years: state, series: JSON.stringify([source, start]) };
  return null;
}
export function habits(data: MemberEvidence, at: string, age: number, sex: Sex) {
  const result: Rows = {};
  for (const [key, dates] of observedStreams(data, at)) {
    const r = smoothStream(key, dates, data, at, age, sex);
    if (r) result[key] = r;
  }
  if (result.hip_minutes || result.steps) delete result.activity;
  if (result.hip_minutes) delete result.steps;
  return result;
}

const labFields: Record<string, string[]> = model.labs;
function unit(x: unknown) {
  return String(x ?? "")
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replaceAll(" ", "");
}
type Candidate = { date: string; collected: string; revision: number; reported: string; value: number | null };
function last(rows: Candidate[]) {
  const cmp = (a: Candidate, b: Candidate) =>
    a.date.localeCompare(b.date) ||
    a.collected.localeCompare(b.collected) ||
    a.revision - b.revision ||
    a.reported.localeCompare(b.reported);
  const latest = rows.sort(cmp).at(-1)!;
  return unique(rows.filter((r) => cmp(r, latest) === 0).map((r) => r.value));
}
function labCandidate(
  r: Observation,
  key: string,
  expected: string,
  data: MemberEvidence,
  at: string,
  date: string,
) {
  const v = number(r.value),
    f = fields[key],
    u = unit(r.unit);
  const validUnit = u === unit(expected) || (key === "wbc" && ["10^3/ul", "k/ul", "10^9/l"].includes(u));
  const valid =
    eligible(r, at) &&
    !r.comparator &&
    ["final", "corrected", "amended"].includes(String(r.status ?? "final")) &&
    validUnit &&
    between(v, f?.min ?? 0, f?.max ?? 799.999) &&
    !(key === "a1c" && data.profile.unreliable_a1c);
  return {
    date,
    collected: String(r.collected_at ?? ""),
    revision: number(r.revision) ?? 0,
    reported: String(r.reported_at ?? ""),
    value: valid ? v : null,
  };
}
function lipidPairs(draws: Map<string, Map<string, Candidate[]>>, labs: Map<string, Candidate[]>) {
  for (const draw of draws.values()) {
    if (draw.has("non_hdl") || !draw.has("hdl") || !draw.has("total_cholesterol")) continue;
    const hdl = last(draw.get("hdl")!),
      tc = last(draw.get("total_cholesterol")!);
    if (hdl === null || tc === null || !between(tc - hdl, fields.non_hdl.min, fields.non_hdl.max)) continue;
    const candidate = { ...draw.get("hdl")![0], collected: "", reported: "", revision: -1, value: tc - hdl };
    labs.set("non_hdl", [...(labs.get("non_hdl") ?? []), candidate]);
  }
}
export function labValues(data: MemberEvidence, at: string) {
  const labs = new Map<string, Candidate[]>(),
    draws = new Map<string, Map<string, Candidate[]>>();
  for (const r of data.labs ?? []) {
    const marker = String(r.marker),
      date = rowDay(r),
      age = distance(at, date);
    if (!date || age < 0 || age > (marker === "lpa" ? 36500 : 365) || !released(r, at)) continue;
    if (!Object.hasOwn(labFields, marker) && !["hdl", "total_cholesterol", "ldl", "lpa"].includes(marker))
      continue;
    const [key, expected] = labFields[marker] ?? [marker, "mg/dL"];
    const candidate = labCandidate(r, key, expected, data, at, date);
    const rows = labs.get(key) ?? [];
    rows.push(candidate);
    labs.set(key, rows);
    const panel = r.panel_id ?? r.collected_at;
    if (panel && ["hdl", "total_cholesterol", "non_hdl"].includes(key)) {
      const id = JSON.stringify([date, panel]),
        draw = draws.get(id) ?? new Map<string, Candidate[]>();
      draw.set(key, [...(draw.get(key) ?? []), candidate]);
      draws.set(id, draw);
    }
  }
  lipidPairs(draws, labs);
  return Object.fromEntries([...labs].map(([k, rows]) => [k, last(rows)])) as Record<string, number | null>;
}
function bpReading(r: Observation) {
  const source = r.setting === "office" ? "clinic" : r.setting === "home" ? "home" : r.source;
  const s = number(r.systolic ?? r.sbp),
    d = number(r.diastolic ?? r.dbp),
    date = rowDay(r);
  const time = String(r.measured_at ?? r.datetime ?? r.time ?? "");
  const hm = /T(\d{2}):(\d{2})/.exec(time);
  if (
    !hm ||
    day(time) !== date ||
    Number(hm[1]) > 23 ||
    Number(hm[2]) > 59 ||
    !between(s, 60, 280) ||
    d === null ||
    d < 35 ||
    d >= s ||
    !(source === "clinic" || (source === "home" && r.validated === true))
  )
    return null;
  return { source, s, date, minute: Number(hm[1]) * 60 + Number(hm[2]) };
}
function bpValue(data: MemberEvidence, at: string) {
  const groups = new Map<string, Map<string, Map<number, number[]>>>();
  for (const r of dated(data, "bp", at, 28)) {
    const reading = bpReading(r);
    if (!reading) continue;
    const { source, s, date, minute } = reading;
    const days = groups.get(source) ?? new Map<string, Map<number, number[]>>();
    const times = days.get(date) ?? new Map<number, number[]>();
    times.set(minute, [...(times.get(minute) ?? []), s]);
    days.set(date, times);
    groups.set(source, days);
  }
  const options = [];
  for (const [source, dates] of groups) {
    const complete = [];
    for (const [date, times] of [...dates].sort()) {
      const minutes = [...times.keys()].filter((t) => unique(times.get(t)!) !== null).sort((a, b) => a - b);
      const pairs = minutes
        .slice(1)
        .flatMap((m, i) =>
          m - minutes[i] <= 5 ? [{ m: minutes[i], v: (times.get(m)![0] + times.get(minutes[i])![0]) / 2 }] : [],
        );
      if (pairs.length && (source === "clinic" || pairs.at(-1)!.m - pairs[0].m >= 360))
        complete.push({ date, v: pairs.reduce((s, p) => s + p.v, 0) / pairs.length });
    }
    if (complete.length >= (source === "clinic" ? 2 : 3)) {
      const last = complete.slice(-7);
      options.push({ date: last.at(-1)!.date, source, value: last.reduce((s, p) => s + p.v, 0) / last.length });
    }
  }
  return options.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source)).at(-1);
}
function foodFibre(data: MemberEvidence, ci: Observation[], at: string) {
  const days = [
    ...new Set(ci.filter((r) => r.diet_day_complete === true && distance(at, rowDay(r)) <= 42).map(rowDay)),
  ].sort();
  const sums = [];
  for (const date of days) {
    const meals = dated(data, "meals", at, 42).filter((r) => rowDay(r) === date && r.eaten !== false);
    const ids = new Map<unknown, number>();
    let complete = !!meals.length;
    for (const r of meals) {
      const v = number(r.fiber_g ?? r.fibre_g);
      if (r.id == null || r.confirmed !== true || !between(v, 0, 100) || (ids.has(r.id) && ids.get(r.id) !== v)) {
        complete = false;
        break;
      }
      ids.set(r.id, v);
    }
    if (complete) sums.push({ date, value: [...ids.values()].reduce((a, b) => a + b, 0) });
  }
  const week = sums.slice(-7);
  return week.length === 7 && distance(week[6].date, week[0].date) === 6
    ? week.reduce((s, r) => s + r.value, 0) / 7
    : null;
}
type AddClinical = (key: string, value: unknown, quality?: number) => void;
function bodyFactors(data: MemberEvidence, at: string, add: AddClinical) {
  const limit = restrictions(data.profile);
  const body = dated(data, "body", at, 730);
  if (!limit.body) {
    const current = body.filter((r) => distance(at, rowDay(r)) <= 180);
    add("waist", pick(current, "waist_cm"));
    if (!limit.wheelchair && !data.profile.unreliable_stature) {
      const bmis = current.flatMap((r) => {
        const heights = body.filter((h) => rowDay(h) <= rowDay(r) && between(number(h.height_cm), 100, 230));
        const h = number(pick(heights, "height_cm") ?? data.profile.height_cm),
          w = number(r.weight_kg);
        const bmi = between(h, 100, 230) && w !== null ? w / (h / 100) ** 2 : null;
        return between(bmi, 12, 95) ? [{ date: rowDay(r), bmi }] : [];
      });
      add("bmi", pick(bmis, "bmi"));
    }
  }
}
function smokingFactor(ci: Observation[], at: string, add: AddClinical, result: Rows) {
  const smoking = pick(
    ci.filter((r) => ["never", "former", "current"].includes(String(r.smoking))),
    "smoking",
  );
  add("smoking", smoking === "never" ? 0 : smoking === "former" ? 0.4 : smoking === "current" ? 1 : null);
  if (smoking === "former") {
    const latest = ci
      .filter((r) => r.smoking === "former")
      .map(rowDay)
      .sort()
      .at(-1)!;
    const quit = day(
      pick(
        ci.filter((r) => rowDay(r) === latest && r.smoking === "former"),
        "quit_date",
      ),
    );
    if (quit && quit <= latest) {
      const f = catalog.smoking,
        log = logTable(f, distance(at, quit) / YEAR);
      if (log !== null) {
        add("smoking", log / Math.log(f.curve.current!));
        result.smoking.quit = quit;
      }
    }
  }
}
function habitualFactors(
  ci: Observation[],
  recent: Observation[],
  at: string,
  age: number,
  sex: Sex,
  add: AddClinical,
  result: Rows,
) {
  for (const k of ["fibre", "alcohol"] as const) {
    const field = k === "fibre" ? "habitual_fibre_g_day" : "alcohol_g_day";
    const current = number(pick(recent, field));
    if (current === null) continue;
    add(k, current);
    const dates = new Map<string, number[]>();
    for (const r of ci) {
      const v = number(r[field]);
      if (v === null || !native(k, v, age, sex)) continue;
      const release = [rowDay(r), day(r.received_at), day(r.reported_at)].sort().at(-1)!;
      dates.set(release, [...(dates.get(release) ?? []), v]);
    }
    let state = 0,
      target = 0,
      last = "",
      start = "";
    const tau = model.policy.habitual_check_tau_days[k];
    for (const d of [...dates.keys()].sort()) {
      const v = unique(dates.get(d)!);
      if (v === null) {
        last = "";
        continue;
      }
      const rec = native(k, v, age, sex)!;
      if (!last || distance(d, last) > 90) {
        state = rec.years;
        start = d;
      } else state = target + (state - target) * Math.exp(-distance(d, last) / tau);
      target = rec.years;
      last = d;
    }
    if (last && result[k])
      Object.assign(result[k], {
        series: start,
        years: target + (state - target) * Math.exp(-distance(at, last) / tau),
      });
  }
}
export function clinical(data: MemberEvidence, at: string, age: number, sex: Sex) {
  const ci = dated(data, "checkins", at, 3650).map((r) =>
    typeof r.topic === "string" ? { ...r, [r.topic]: r.answer } : r,
  );
  const recent = ci.filter((r) => distance(at, rowDay(r)) <= 90);
  const result: Rows = {},
    labs = labValues(data, at),
    limit = restrictions(data.profile);
  function add(k: string, x: unknown, q = 1) {
    const v = number(x),
      rec = v === null ? null : native(k, v, age, sex, q);
    if (rec) result[k] = rec;
  }
  for (const [k, v] of Object.entries(labs)) add(k, v);
  bodyFactors(data, at, add);
  const bp = bpValue(data, at);
  if (bp) add("sbp", bp.value, bp.source === "home" ? 0.75 : 1);
  smokingFactor(ci, at, add, result);
  for (const [k, field] of Object.entries({
    disease: "serious_disease",
    diabetes: "diabetes",
    health: "health",
    phq9: "phq9",
    activity: "leisure_moderate_equivalent_min_week",
  })) {
    const v = pick(k === "disease" ? ci : recent, field);
    add(k, typeof v === "boolean" && ["disease", "diabetes"].includes(k) ? Number(v) : v);
  }
  for (const [k, field] of Object.entries({
    fev1: "clinical_fev1_l",
    gait: "timed_20ft_gait_mps",
    knee: "isokinetic_knee_newtons",
    vo2: "nhanes_submax_vo2_mlkgmin",
  }))
    if (k === "fev1" || !limit.restricted)
      add(
        k,
        pick(
          recent.filter((r) => r.method_verified === true),
          field,
        ),
      );
  add("fibre", foodFibre(data, ci, at));
  habitualFactors(ci, recent, at, age, sex, add, result);
  return { result, ci, labs };
}
