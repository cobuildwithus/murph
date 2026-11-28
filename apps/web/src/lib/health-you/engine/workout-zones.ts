import {
  between,
  distance,
  dose,
  effectiveAnswer,
  sumYears,
  eligible,
  isObject,
  model,
  number,
  offset,
  pick,
  released,
  rowDay,
  type MemberEvidence,
  type Observation,
  type Rows,
} from "./model";
import { sensorRecord } from "./wear-days";
import { factor, median, updateLevel } from "./daily";
import { restrictions } from "./observations";

function zoneBoundaries(r: Observation, data: MemberEvidence, provider: unknown) {
  let edges = r.zone_lower_hrr;
  if (edges == null && provider === "whoop") {
    const confirmed =
      "whoop_standard_zones" in r
        ? r.whoop_standard_zones
        : pick(
            (data.checkins ?? []).filter(
              (c) =>
                eligible(c, rowDay(r)) &&
                effectiveAnswer(c, rowDay(r)) &&
                typeof c.whoop_standard_zones === "boolean",
            ),
            "whoop_standard_zones",
          );
    if (confirmed === true) edges = model.projection.whoop_default_hrr;
  }
  return edges;
}

function zoneMinutes(r: Observation, binsRaw: unknown[], edges: unknown[]) {
  const bins = binsRaw.map(number),
    lower = edges.map(number),
    duration = number(r.minutes);
  if (!between(duration, 1, 480) || lower[0] !== 0) return null;
  let mod = 0,
    vig = 0,
    total = 0;
  for (let i = 0; i < binsRaw.length; i++) {
    const m = bins[i],
      e = lower[i];
    if (m === null || m < 0 || e === null || e < 0 || e >= 1 || (i > 0 && e <= lower[i - 1]!)) return null;
    total += m;
    if (e >= model.projection.zone_vigorous_hrr) vig += m;
    else if (e >= model.projection.zone_moderate_hrr) mod += m;
  }
  return total > 0 && total <= duration + 0.000001
    ? { mod, vig, steps: !model.daily.nonstep.includes(String(r.type)) }
    : null;
}

function intensity(r: Observation, data: MemberEvidence, at: string) {
  const provider = (isObject(r.devices) ? r.devices.zone_min : null) || r.source || r.provider;
  const count =
    provider === "whoop"
      ? 6
      : provider === "apple" || provider === "apple_watch" || provider === "garmin"
        ? 5
        : 0;
  if (
    !count ||
    !Array.isArray(r.zone_min) ||
    r.zone_min.length !== count ||
    !eligible(r, at) ||
    r.off_body ||
    r.partial ||
    r.pain_or_stop ||
    ["sauna", "strength", "strength_training", "weight_training"].includes(String(r.type))
  )
    return null;
  const edges = zoneBoundaries(r, data, provider);
  if (!Array.isArray(edges) || edges.length !== count) return null;
  const minutes = zoneMinutes(r, r.zone_min, edges);
  return minutes && { ...minutes, method: JSON.stringify([provider, r.type, edges.map(number)]) };
}
function sessionRevisions(data: MemberEvidence, at: string) {
  const sessions = new Map<string, Observation[]>();
  for (const r of data.workouts ?? []) {
    const d = rowDay(r);
    if (!d || d > at || !released(r, at) || !sensorRecord(r)) continue;
    const id = JSON.stringify([d, r.id || r.start || r.type]);
    const group = sessions.get(id),
      order = group ? (number(r.revision) ?? 0) - (number(group[0].revision) ?? 0) : 1;
    if (order > 0) sessions.set(id, [r]);
    else if (!order) group!.push(r);
  }
  return sessions;
}

function dailyZoneDoses(data: MemberEvidence, at: string) {
  const sessions = sessionRevisions(data, at);
  const days = new Map<string, { mod: number; vig: number; steps: boolean; method: string }>();
  for (const group of sessions.values()) {
    const doses = group.map((r) => intensity(r, data, at)),
      d = doses[0];
    if (
      !d ||
      doses.some(
        (x) => !x || x.mod !== d.mod || x.vig !== d.vig || x.steps !== d.steps || x.method !== d.method,
      )
    )
      continue;
    const date = rowDay(group[0]),
      old = days.get(date);
    if (
      !old ||
      d.mod + 2 * d.vig > old.mod + 2 * old.vig ||
      (d.mod + 2 * d.vig === old.mod + 2 * old.vig &&
        (d.vig > old.vig ||
          (d.vig === old.vig &&
            (Number(d.steps) > Number(old.steps) || (d.steps === old.steps && d.method > old.method)))))
    )
      days.set(date, d);
  }
  return days;
}

export function workoutZones(data: MemberEvidence, at: string, core: Rows, mult: number) {
  const limit = restrictions(data.profile);
  if (core.activity || core.hip_minutes || limit.pulse || limit.restricted) return null;
  const days = dailyZoneDoses(data, at);
  const dates = [...days.keys()].sort(),
    latest = dates.at(-1);
  if (!latest || distance(at, latest) > 7) return null;
  const span = model.projection.zone_max_days,
    q = model.projection.zone_quality;
  let start = "",
    state: number | null = null,
    mod = 0,
    vig = 0;
  // A gap longer than the dose window resets the series. Skip empty years between sessions.
  let first = offset(dates[0], span - 1);
  for (let i = 1; i < dates.length; i++) if (distance(dates[i], dates[i - 1]) > span) first = dates[i];
  for (let date = first; date <= at; date = offset(date, 1)) {
    const window = dates.filter((d) => between(distance(date, d), 0, span - 1));
    if (
      window.length < model.daily.workout_min_dates ||
      distance(window.at(-1)!, window[0]) < model.daily.workout_span ||
      distance(date, window.at(-1)!) > 7
    ) {
      state = null;
      continue;
    }
    const sessions = window.map((d) => days.get(d)!);
    mod = sessions.reduce((s, d) => s + d.mod, 0) / span;
    vig = sessions.reduce((s, d) => s + d.vig, 0) / span;
    const overlap = core.steps ? sumYears(sessions.map((s) => (s.steps ? s.mod + s.vig : 0))) / span : 0;
    const log = 0.58 * (dose("mvpa_device", mod + 2 * vig) - dose("mvpa_device", overlap));
    if (state === null) start = date;
    state = updateLevel(state, mult * q * log);
  }
  if (state === null) return null;
  const recent = dates.filter((d) => distance(at, d) < 7).map((d) => days.get(d)!);
  const prior = dates.filter((d) => between(distance(at, d), 14, 55)).map((d) => days.get(d)!);
  const weighted: number[] = [];
  for (const method of new Set(recent.map((r) => r.method))) {
    const minutes = (s: (typeof recent)[number]) => (s.steps && core.steps ? s.vig : s.mod + 2 * s.vig);
    const current = recent.filter((s) => s.method === method).map(minutes),
      before = prior.filter((s) => s.method === method).map(minutes);
    if (current.length >= 2 && before.length >= 4)
      weighted.push(current.length * (median(current) - median(before)));
  }
  return {
    session_pace: weighted.length ? -0.25 * Math.tanh(sumYears(weighted) / recent.length / 20) : 0,
    ...factor(
      "zone_intensity",
      mod + 2 * vig,
      "recorded moderate-equivalent min/day",
      null,
      state,
      q,
      "C, workout HR reserve to hip activity bridge",
      "https://doi.org/10.1136/bmj.l4570",
    ),
    moderate_min_day: mod,
    vigorous_min_day: vig,
    level: state,
    confidence: 1,
    series: JSON.stringify(["zones", Boolean(core.steps), start]),
  };
}
