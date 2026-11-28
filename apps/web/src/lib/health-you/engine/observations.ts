import { labDraw, latestDraw, type LabDraw as Candidate } from "./lab-draws";
import {
  between,
  interp,
  scale,
  catalog,
  dated,
  day,
  device,
  distance,
  effectiveAnswer,
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

import { chooseSource, clamp, factor, onset, replay, visibleRevisions } from "./daily";
import { pressurePairs } from "./feeds";

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

type Stream = "steps" | "step_proxy" | "sleep" | "pulse" | "hip_minutes" | "activity" | "onset_sd" | "hrv";
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
function unknownWear(r: Observation) {
  return r.projected && r.wear_complete == null && r.worn_min == null;
}
function recordDailyMetrics(
  r: Observation,
  source: string,
  limit: ReturnType<typeof restrictions>,
  add: AddSample,
) {
  if (!limit.pulse) {
    add("pulse", number(r.rhr), 30, 180);
    if (["overnight", "sleeping", "slow_wave_sleep"].includes(String(r.series_method)))
      add("hrv", number(r.rmssd), 3, 300);
  }
  if (!limit.restricted && unknownWear(r))
    add("step_proxy", number(r.steps), model.policy.minimum_step_proxy, 65000);
  if (
    limit.restricted ||
    !(r.wear_complete === true || (r.wear_complete == null && (number(r.worn_min) ?? 0) >= 1296))
  )
    return;
  add("steps", number(r.steps), 0, 65000);
  if (limit.rate) return;
  recordIntensity(r, source, add);
}
function observedStreams(data: MemberEvidence, at: string) {
  const limit = restrictions(data.profile);
  const streams = new Map<Stream, Map<string, Map<string, Set<number>>>>();
  for (const group of ["daily", "sleep_sessions"] as const) {
    for (const r of visibleRevisions(data[group] ?? [], at, (r) => [
      r.source,
      r.series_method,
      r.key || r.metric || "",
      r.type || "",
    ])) {
      const vendor = typeof r.source === "string" ? r.source.trim().toLowerCase() : "";
      const source = r.series_method ? vendor + "|" + r.series_method : vendor,
        date = rowDay(r);
      if (
        !vendor ||
        model.feeds.excluded_providers.includes(vendor) ||
        model.feeds.excluded_methods.includes(String(r.series_method)) ||
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
        if (r.type == null || r.type === "main") {
          add("sleep", (number(r.asleep_min) ?? NaN) / 60, 3, 16);
          if (!data.profile.shift_worker) add("onset_sd", onset(r), 0, 24);
        }
        continue;
      }
      recordDailyMetrics(r, source, limit, add);
    }
  }
  return streams;
}
export function recentSleepNights(data: MemberEvidence, at: string) {
  const dates = observedStreams(data, at).get("sleep");
  if (!dates) return 0;
  let last = "",
    source = "",
    count = 0;
  for (const date of [...dates.keys()].filter((date) => distance(at, date) < model.daily.window).sort()) {
    const next = chooseSource(dates.get(date)!, String(data.profile.preferred_source), source);
    if (!next) continue;
    count = source !== next || distance(date, last) > model.daily.fresh ? 1 : count + 1;
    last = date;
    source = next;
  }
  return last && distance(at, last) <= model.daily.fresh ? count : 0;
}

function wearableFactor(key: Stream, value: number, source: string, age: number, sex: Sex, legacy: boolean) {
  const d = model.daily,
    mult = model.policy.years_per_published_log_unit * scale(age);
  const [vendor, method] = source.split("|");
  if (key === "steps" || key === "step_proxy" || key === "hip_minutes") {
    const steps = key !== "hip_minutes";
    const rec = device(
      steps ? "steps" : key,
      steps && vendor !== "research_hip" ? value / d.watch_count_ratio : value,
      age,
      sex,
      legacy,
    );
    if (!rec) return null;
    if (key === "step_proxy") {
      rec.years = Math.min(0, rec.years);
      rec.reference = "recorded wrist steps, wear unknown";
    }
    if (!["apple", "garmin", "whoop", "fitbit", "oura", "research_hip"].includes(vendor)) {
      rec.years *= d.unknown_watch_quality;
      rec.quality *= d.unknown_watch_quality;
    }
    if (steps) {
      rec.value = value;
      rec.target = d.step_plateau[Number(age >= d.step_age)] * d.watch_count_ratio;
      rec.target_source = "Upper research plateau mapped to wrist counts";
    }
    return rec;
  }
  if (key === "sleep") {
    const logs = d.sleep_hr.map((x) => Math.log(x));
    const risk = interp(value, d.sleep_hours, logs) - interp(d.sleep_center_hours, d.sleep_hours, logs);
    return factor(key, value, "h/night", 7.5, mult * d.sleep_quality * risk, d.sleep_quality);
  }
  if (key === "onset_sd")
    return factor(
      key,
      value,
      "h SD",
      0.75,
      mult * d.timing_quality * Math.log(d.onset_hr_hour) * (Math.min(3, value) - d.onset_ref_hours),
      d.timing_quality,
    );
  if (key === "hrv") return factor(key, value, "ms RMSSD", null, 0, 0, "C, overnight measurement only");
  if (key === "pulse" && ["sleeping", "overnight", "slow_wave_sleep"].includes(method)) {
    const ref = d.overnight_pulse_ref,
      q = d.overnight_pulse_quality;
    return factor(
      key,
      value,
      "bpm asleep",
      ref,
      mult * q * Math.log(d.overnight_pulse_hr10) * clamp((value - ref) / 10, -1, 3),
      q,
    );
  }
  return native(
    key,
    value,
    age,
    sex,
    key === "pulse" && !["seated", "daytime_resting"].includes(method)
      ? d.generic_pulse_quality
      : model.policy.protocol.wear_proxy_quality[key],
  );
}
export function habits(data: MemberEvidence, at: string, age: number, sex: Sex, legacy = false) {
  const result: Rows = {};
  for (const [key, dates] of observedStreams(data, at)) {
    const r = replay(
      key,
      dates,
      at,
      (v, src) => wearableFactor(key, v, src, age, sex, legacy),
      data.profile.preferred_source,
      !legacy,
    );
    if (r) result[key] = r;
  }
  if (result.step_proxy) {
    result.steps ??= result.step_proxy;
    delete result.step_proxy;
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
function last(rows: Candidate[]) {
  return latestDraw(rows)?.value ?? null;
}
function validLabValue(key: string, v: number, profile: Observation) {
  if (key === "crp") return v <= model.policy.protocol.crp_max;
  if (["hdl", "total_cholesterol"].includes(key))
    return v > 0 && v < model.policy.protocol.max_component_lipid;
  if (["ldl", "lpa"].includes(key)) return v <= model.policy.protocol.max_lipid;
  return !(key === "a1c" && profile.unreliable_a1c);
}
function labCandidate(r: Observation, key: string, expected: string, data: MemberEvidence, at: string) {
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
    validLabValue(key, v, data.profile);
  return labDraw(r, valid ? v : null);
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
    const candidate = labCandidate(r, key, expected, data, at);
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
  const source =
    r.setting === "office" || r.setting === "clinic" ? "clinic" : r.setting === "home" ? "home" : r.source;
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
export function bpValue(data: MemberEvidence, at: string, submitted?: Observation) {
  const policy = model.policy.protocol;
  const target = submitted && bpReading(submitted);
  const groups = new Map<string, Map<string, Map<number, number[]>>>();
  for (const r of [...dated(data, "bp", at, policy.bp_days), ...pressurePairs(data, at)]) {
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
          m - minutes[i] <= policy.bp_max_pair_gap
            ? [{ start: minutes[i], end: m, value: (times.get(m)![0] + times.get(minutes[i])![0]) / 2 }]
            : [],
        );
      if (
        !pairs.length ||
        (source === "home" && pairs.at(-1)!.start - pairs[0].start < policy.bp_session_gap)
      )
        continue;
      complete.push({
        date,
        value: pairs.reduce((sum, pair) => sum + pair.value, 0) / pairs.length,
        includesSubmitted:
          target?.source === source &&
          target.date === date &&
          pairs.some((pair) => pair.start === target.minute || pair.end === target.minute),
      });
    }
    if (complete.length >= (source === "clinic" ? policy.clinic_days : policy.home_days)) {
      const last = complete.slice(-policy.bp_last_days);
      options.push({
        date: last.at(-1)!.date,
        source,
        includesSubmitted: last.some((day) => day.includesSubmitted),
        value: last.reduce((sum, day) => sum + day.value, 0) / last.length,
      });
    }
  }
  return options.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source)).at(-1);
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
      add("bmi", pick(bmis, "bmi") ?? pick(current, "bmi"));
    }
  }
}
function smokingFactor(
  ci: Observation[],
  history: Observation[],
  at: string,
  add: AddClinical,
  result: Rows,
) {
  const smoking = pick(
    ci.filter((r) => ["never", "former", "current"].includes(String(r.smoking))),
    "smoking",
  );
  add("smoking", smoking === "never" ? 0 : smoking === "former" ? 0.4 : smoking === "current" ? 1 : null);
  if (smoking === "former") {
    const prior = history
      .filter((r) => r.smoking === "current")
      .map(rowDay)
      .sort()
      .at(-1)!;
    const quit = day(
      pick(
        ci.filter((r) => !prior || rowDay(r) >= prior),
        "quit_date",
      ),
    );
    if (quit && quit <= at && (!prior || quit >= prior)) {
      const f = catalog.smoking,
        log = logTable(f, distance(at, quit) / YEAR);
      if (log !== null) {
        add("smoking", log / Math.log(f.curve.current!));
        if (result.smoking) {
          result.smoking.quit = quit;
          result.smoking.source = "joint smoking fit with published cessation trajectory";
        }
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
export function clinical(data: MemberEvidence, at: string, age: number, sex: Sex, legacy = false) {
  const history = dated(data, "checkins", at, 3650).map((r) =>
    typeof r.topic === "string" ? { ...r, [r.topic]: r.answer } : r,
  );
  const ci = history.filter((r) => effectiveAnswer(r, at));
  const recent = ci.filter((r) => distance(at, rowDay(r)) <= 90);
  const result: Rows = {},
    labs = labValues(data, at),
    limit = restrictions(data.profile);
  function add(k: string, x: unknown, q = 1) {
    const v = number(x),
      rec = v === null ? null : native(k, v, age, sex, q, legacy);
    if (rec) result[k] = rec;
  }
  for (const [k, v] of Object.entries(labs)) add(k, v);
  bodyFactors(data, at, add);
  const bp = bpValue(data, at);
  if (bp) add("sbp", bp.value, bp.source === "home" ? model.policy.protocol.home_quality : 1);
  smokingFactor(ci, history, at, add, result);
  for (const [k, field] of Object.entries({
    disease: "serious_disease",
    diabetes: "diabetes",
    health: "health",
    phq9: "phq9",
    activity: "leisure_moderate_equivalent_min_week",
  })) {
    const v =
      pick(k === "disease" ? ci.filter((r) => typeof r[field] === "boolean") : recent, field) ??
      (k === "diabetes" && typeof pick(ci, field) === "boolean" ? pick(ci, field) : null);
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
  habitualFactors(ci, recent, at, age, sex, add, result);
  return { result, ci, labs };
}
