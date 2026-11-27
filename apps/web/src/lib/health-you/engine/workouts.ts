import {
  catalog,
  distance,
  eligible,
  lookup,
  model,
  number,
  offset,
  rowDay,
  type Contribution,
  type MemberEvidence,
} from "./model";

export function workoutFactor(
  data: MemberEvidence,
  at: string,
  multiplier: number,
): [string, Contribution] | null {
  const p = model.policy;
  const streams = new Map<string, Map<string, number>>();
  for (const row of data.workouts ?? []) {
    const kind = lookup(p.workout_types, String(row.type).toLowerCase()),
      minutes = number(row.minutes);
    if (
      !kind ||
      !minutes ||
      minutes < 0 ||
      minutes > p.workout_max_minutes ||
      row.pain_or_stop ||
      !eligible(row, at)
    )
      continue;
    const days = streams.get(kind) ?? new Map<string, number>();
    days.set(rowDay(row), Math.max(days.get(rowDay(row)) ?? 0, minutes));
    streams.set(kind, days);
  }
  for (const kind of ["running", "lifting"]) {
    const days = streams.get(kind);
    if (!days) continue;
    const row = smoothWorkouts(kind, days, at, multiplier);
    if (row) return [kind, row];
  }
  return null;
}

function smoothWorkouts(
  kind: string,
  days: Map<string, number>,
  at: string,
  multiplier: number,
): Contribution | null {
  const p = model.policy;
  const dates = [...days.keys()].sort();
  if (distance(at, dates.at(-1)!) > p.workout_fresh_days) return null;
  const running = kind === "running";
  const target = running ? p.running_reference_minutes : p.lifting_reference_days;
  const weight = running ? p.running_quality : catalog.lifting.shrinkage * p.lifting_log_quality;
  const ratio = running ? p.running_hr : catalog.lifting.curve.rows!.find((r) => r.value === "1–2/week")!.ratio;
  let state: number | null = null,
    start = "",
    value = 0;
  // A gap longer than the rolling window resets the smoother completely.
  let first = offset(dates[0], p.workout_days - 1);
  for (let i = 1; i < dates.length; i++) if (distance(dates[i], dates[i - 1]) >= p.workout_days) first = dates[i];
  let left = 0,
    right = 0,
    minutes = 0;
  for (let d = first; d <= at; d = offset(d, 1)) {
    while (right < dates.length && dates[right] <= d) minutes += days.get(dates[right++])!;
    while (left < right && distance(d, dates[left]) >= p.workout_days) minutes -= days.get(dates[left++])!;
    if (right - left < p.workout_minimum_dates || distance(dates[right - 1], dates[left]) < p.workout_min_span) {
      state = null;
      continue;
    }
    value = ((running ? minutes : right - left) * 7) / p.workout_days;
    const years = multiplier * weight * Math.log(ratio) * Math.min(1, value / target);
    if (state === null) {
      state = years;
      start = d;
    } else {
      const limit = p.max_wearable_change_years_per_stream_day;
      state += Math.max(-limit, Math.min(limit, (years - state) * -Math.expm1(-1 / p.wearable_tau_days.workouts)));
    }
  }
  if (state !== null)
    return {
      years: state,
      value,
      target,
      unit: running ? "recorded running min/week" : "recorded strength days/week",
      percentile: null,
      target_source: "Conservative plateau within published exposure range",
      grade: "B, session-log proxy",
      source: running ? p.running_source : model.catalog.lifting.source,
      reference: "published cohort",
      quality: weight,
      series: JSON.stringify([kind, start]),
    };
  return null;
}
