import {
  between,
  day,
  distance,
  eligible,
  isObject,
  lookup,
  model,
  number,
  records,
  released,
  rowDay,
  unique,
  type MemberEvidence,
  type Observation,
} from "./model";

const config = model.feeds;
const families = [
  "extensions",
  "daily",
  "labs",
  "body",
  "bp",
  "sleep_sessions",
  "vo2",
  "fitness_tests",
  "checkins",
  "feed_context",
  "pressure_components",
  "workouts",
  "meals",
  "habits",
] as const;

function demographics(member: Observation) {
  const profile = { ...(isObject(member.profile) ? member.profile : {}) };
  for (const key of ["age", "age_as_of", "birth_year", "birth_date", "biological_sex", "sex"])
    if (!(key in profile) && key in member) profile[key] = member[key];
  profile.sex ??= profile.biological_sex;
  const year = number(profile.birth_year);
  if (profile.age == null && !profile.birth_date && between(year, 1900, 2100) && Number.isInteger(year)) {
    profile.birth_date = year + "-07-01";
    profile.approximate_birth_date = true;
  }
  return profile;
}

/** Combine dated collections only. Current demographics and join date own the replay anchor. */
export function adapt(member: Observation, history: Observation = {}): MemberEvidence {
  const profile = demographics(member);
  const result: MemberEvidence = { profile, joined: day(member.joined) || undefined };
  for (const k of families) result[k] = [...records(history[k]), ...records(member[k])];
  const context = (r: Observation, key: string) => result.feed_context!.push({ ...r, context_key: key });
  projectMetrics(member, history, result, context);
  result.labs = result.labs!.map((r) => {
    const key = r.marker || r.key;
    if (typeof key !== "string") return r;
    const marker = lookup(config.labs, key) ?? key.replaceAll("-", "_");
    if (!config.known_markers.includes(marker)) context(r, "unmapped_lab");
    return { ...r, marker, panel_id: r.panel_id ?? r.draw_id?.toString() };
  });
  const sessions = [...records(history.combine), ...records(member.combine)];
  const weeks = [...records(history.food_weeks), ...records(member.food_weeks)];
  result.checkins = result.checkins!.map((row) => {
    const r = { ...row };
    if (typeof r.topic === "string") r[r.topic] ??= r.answer;
    if (isObject(r.combine)) sessions.push({ ...r, ...r.combine });
    if (isObject(r.food_week)) weeks.push({ ...r, ...r.food_week });
    for (const [alias, key] of Object.entries(config.checkin_aliases)) if (alias in r) r[key] ??= r[alias];
    const drinks = number(r.alcohol_drinks_week);
    if (between(drinks, 0, config.max_drinks_week))
      r.alcohol_g_day ??= (drinks * config.ethanol_g_per_drink) / 7;
    if (typeof r.health === "string") r.health = lookup(config.health, r.health.toLowerCase());
    if (Array.isArray(r.conditions) && r.conditions.some((k) => config.serious_conditions.includes(k)))
      r.serious_disease ??= true;
    if ("whoop_standard_zones" in r) context(r, "whoop_standard_zones");
    if (isObject(r.bp)) result.bp!.push({ ...r, ...r.bp });
    return r;
  });
  for (const s of sessions)
    for (const task of records(s.results))
      result.fitness_tests!.push({ ...s, ...task, verified: "self", protocol: s.protocol });
  for (const r of result.fitness_tests!)
    if (typeof r.test === "string") context(r, config.combine.includes(r.test) ? r.test : "combine_task");
  result.food_weeks = weeks;
  result.sleep_sessions = result.sleep_sessions!.map((r) => ({
    ...r,
    source: r.source ?? r.provider,
    series_method: r.series_method ?? (typeof r.method === "string" ? r.method.toLowerCase() : undefined),
  }));
  projectFood(weeks, result, context);
  for (const r of result.workouts!) context(r, "workout_minutes");
  result.workouts = result.workouts!.map((r) => ({
    ...r,
    date: r.date ?? day(r.start),
    minutes: r.minutes ?? r.duration_min,
  }));
  return result;
}

export function pressurePairs(data: MemberEvidence, at: string) {
  const groups = new Map<string, Observation[]>();
  for (const r of data.pressure_components ?? []) {
    if (!between(distance(at, rowDay(r)), 0, model.policy.protocol.bp_days) || !released(r, at)) continue;
    const key = JSON.stringify([rowDay(r), r.measured_at, r.source, r.setting, r.validated]);
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((rows) => {
    function component(key: string) {
      const candidates = rows
        .filter((r) => r.component === key)
        .sort(
          (a, b) =>
            (number(b.revision) ?? 0) - (number(a.revision) ?? 0) ||
            String(b.reported_at ?? "").localeCompare(String(a.reported_at ?? "")),
        );
      const top = candidates[0];
      return (
        top &&
        unique(
          candidates
            .filter(
              (r) =>
                (number(r.revision) ?? 0) === (number(top.revision) ?? 0) &&
                (r.reported_at ?? "") === (top.reported_at ?? ""),
            )
            .map((r) => (eligible(r, at) && !r.partial ? number(r.value) : null)),
        )
      );
    }
    const systolic = component("systolic-blood-pressure"),
      diastolic = component("diastolic-blood-pressure");
    const r = rows[0];
    return systolic != null && diastolic != null
      ? [
          {
            date: rowDay(r),
            measured_at: r.measured_at,
            source: r.source,
            setting: r.setting,
            validated: r.validated,
            systolic,
            diastolic,
          },
        ]
      : [];
  });
}

type Context = (r: Observation, key: string) => void;
function watchEstimate(key: string, source: string, method: string) {
  return (
    key === "estimated-vo2-max" &&
    ["apple", "garmin"].includes(source) &&
    !["manual", "member_entered", "self", "user_entered"].includes(method)
  );
}
function wearableMetric(key: string, source: string, method: string) {
  return (
    ["total-sleep-minutes", "steps", "resting-heart-rate", "hrv-rmssd"].includes(key) &&
    source &&
    !config.excluded_providers.includes(source) &&
    !config.excluded_methods.includes(method)
  );
}
function project(result: MemberEvidence, context: Context, r: Observation, key: string, value: unknown) {
  const unit = String(r.unit ?? "")
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replaceAll(" ", "");
  const units = lookup(config.units, key);
  if (unit && units && !units.includes(unit)) {
    context(r, "unit_mismatch");
    return;
  }
  const src = String(r.provider || r.source || "").toLowerCase();
  const source = lookup(config.provider_aliases, src) ?? src;
  const method = String(r.method || "unspecified")
    .toLowerCase()
    .replaceAll("-", "_");
  const body = lookup(config.body, key);
  if (body) {
    result.body!.push({ ...r, [body]: value });
    return;
  }
  if (["systolic-blood-pressure", "diastolic-blood-pressure"].includes(key)) {
    const time = r.measured_at || r.datetime;
    if (time && source)
      result.pressure_components!.push({
        ...r,
        date: r.date || day(time),
        measured_at: time,
        source,
        component: key,
        value,
      });
    context(r, "blood_pressure_protocol");
    return;
  }
  if (!lookup(config.daily, key)) return;
  if (watchEstimate(key, source, method)) {
    result.vo2!.push({ ...r, source, method: "device_estimate", value });
    return;
  }
  if (wearableMetric(key, source, method)) {
    const row = { ...r, source, series_method: method };
    if (key === "total-sleep-minutes")
      result.sleep_sessions!.push({ ...row, asleep_min: value, type: "main" });
    else result.daily!.push({ ...row, [lookup(config.daily, key)!]: value, projected: true });
  } else context(r, key);
}

function projectMetrics(member: Observation, history: Observation, result: MemberEvidence, context: Context) {
  for (const group of ["metrics", "daily_metrics", "daily", "body", "blood_pressure"]) {
    for (const row of [...records(history[group]), ...records(member[group])]) {
      const key = row.key || row.metric;
      if (typeof key === "string") project(result, context, row, key, row.value);
      else if (group !== "daily" || "provider" in row)
        for (const k of config.projectable) if (k in row) project(result, context, row, k, row[k]);
      if (group === "blood_pressure") result.bp!.push(row);
    }
  }
}
function projectFood(weeks: Observation[], result: MemberEvidence, context: Context) {
  for (const r of weeks) {
    const a = r.answers;
    if (!isObject(a) || ("week_end" in r && !between(distance(rowDay(r), day(r.week_end)), 1, 7))) continue;
    for (const key of config.food_questions) if (key in a) context(r, "food_week." + key);
    const valid = (key: string) => between(number(a[key]), 0, model.policy.protocol.food_portion_max);
    if (
      r.complete !== true ||
      !Number.isInteger(a.eating_days) ||
      !between(number(a.eating_days), 1, 7) ||
      !config.food_questions.slice(0, 8).every(valid)
    )
      continue;
    for (const [key, grams] of Object.entries(config.portion_grams))
      if (valid(key))
        result.checkins!.push({ ...r, food_proxy: key, food_value: (grams * Number(a[key])) / 7 });
  }
}
