import {
  between,
  distance,
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
import { factor, updateLevel } from "./daily";
import { restrictions } from "./observations";

function zoneBoundaries(r: Observation, data: MemberEvidence, provider: unknown) {
  let edges = r.zone_lower_hrr;
  if (edges == null && provider === "whoop") {
    const confirmed =
      "whoop_standard_zones" in r
        ? r.whoop_standard_zones
        : pick(
            (data.checkins ?? []).filter(
              (c) => eligible(c, rowDay(r)) && typeof c.whoop_standard_zones === "boolean",
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
  const count = provider === "whoop" ? 6 : provider === "apple" || provider === "apple_watch" ? 5 : 0;
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
  return zoneMinutes(r, r.zone_min, edges);
}
function sessionRevisions(data: MemberEvidence, at: string) {
  const sessions = new Map<string, Observation[]>();
  for (const r of data.workouts ?? []) {
    const d = rowDay(r);
    if (!d || d > at || !released(r, at)) continue;
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
  const days = new Map<string, { mod: number; vig: number; steps: boolean }>();
  for (const group of sessions.values()) {
    const doses = group.map((r) => intensity(r, data, at)),
      d = doses[0];
    if (!d || doses.some((x) => !x || x.mod !== d.mod || x.vig !== d.vig || x.steps !== d.steps)) continue;
    const date = rowDay(group[0]),
      old = days.get(date);
    if (
      !old ||
      d.mod + 2 * d.vig > old.mod + 2 * old.vig ||
      (d.mod + 2 * d.vig === old.mod + 2 * old.vig && (d.vig > old.vig || (d.vig === old.vig && d.steps)))
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
    let log = Math.log1p(mod + 2 * vig);
    if (core.steps) log -= Math.log1p(sessions.reduce((s, d) => s + (d.steps ? d.mod + d.vig : 0), 0) / span);
    if (state === null) start = date;
    state = updateLevel(
      state,
      ((mult * q * Math.min(0, model.hip.minutes.beta)) / model.hip.minutes.sd) * log,
    );
  }
  if (state === null) return null;
  return {
    ...factor(
      "zone_intensity",
      mod + 2 * vig,
      "recorded moderate-equivalent min/day",
      null,
      state,
      q,
      "C, workout HR reserve to hip activity bridge",
      "NHANES 2003–06 hip accelerometry",
    ),
    moderate_min_day: mod,
    vigorous_min_day: vig,
    level: state,
    confidence: 1,
    series: JSON.stringify(["zones", Boolean(core.steps), start]),
  };
}
