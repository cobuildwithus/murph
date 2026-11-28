import {
  day,
  sumYears,
  distance,
  eligible,
  lookup,
  model,
  number,
  released,
  rowDay,
  type Contribution,
  type Observation,
  type Scalar,
} from "./model";

const config = model.daily;
export const WEARABLE_FRESH_DAYS = 14;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export function updateLevel(level: number | null, target: number, tau = config.tau, rate = config.rate) {
  return level === null ? target : level + clamp((target - level) * -Math.expm1(-1 / tau), -rate, rate);
}
export function factor(
  key: string,
  value: Scalar,
  unit: string,
  target: number | null,
  years: number,
  quality: number,
  grade = "B, measurement bridge",
  source = lookup(config.sources, key) ?? "NHANES residual fit",
): Contribution {
  return {
    value,
    unit,
    target,
    years,
    quality,
    grade,
    source,
    percentile: null,
    reference: "protocol-specific comparison",
    target_source: "Model comparison within supported range",
  };
}

export function releasedGroups(records: Observation[], at: string, identity: (r: Observation) => unknown) {
  const groups = new Map<string, Observation[]>();
  for (const row of records) {
    const date = rowDay(row);
    if (!date || date > at || !released(row, at)) continue;
    const id = JSON.stringify([date, identity(row)]);
    const group = groups.get(id);
    const previous = group?.[0];
    const rank = previous
      ? (number(row.revision) ?? 0) - (number(previous.revision) ?? 0) ||
        String(row.reported_at ?? "").localeCompare(String(previous.reported_at ?? ""))
      : 1;
    if (rank > 0) groups.set(id, [row]);
    else if (!rank) group!.push(row);
  }
  return [...groups.values()];
}

export function visibleRevisions(records: Observation[], at: string, identity: (r: Observation) => unknown) {
  return releasedGroups(records, at, identity).flatMap((rows) =>
    rows.every((r) => eligible(r, at) && !r.partial && !r.off_body) ? rows : [],
  );
}

export function onset(row: Observation) {
  function local(value: unknown, override: unknown) {
    if (typeof value !== "string") return null;
    const zone = /(Z|([+-])(\d\d):(\d\d))$/.exec(value);
    if (!zone || (zone[1] === "Z" && override == null)) return null;
    const minutes =
      override === undefined ? (zone[2] === "-" ? -1 : 1) * (+zone[3] * 60 + +zone[4]) : number(override);
    const utc = Date.parse(value);
    if (!Number.isFinite(utc) || minutes === null || !Number.isInteger(minutes) || Math.abs(minutes) > 840)
      return null;
    return { utc, local: new Date(utc + minutes * 60_000) };
  }
  const start = local(row.start_at, row.start_offset_min),
    end = local(row.end_at, row.end_offset_min);
  if (!start || !end || day(end.local.toISOString()) !== rowDay(row)) return null;
  const duration = (end.utc - start.utc) / 3_600_000;
  return duration >= 3 && duration <= 16
    ? start.local.getUTCHours() + start.local.getUTCMinutes() / 60 + start.local.getUTCSeconds() / 3600
    : null;
}

export type StreamDates = Map<string, Map<string, Set<number>>>;
type Samples = { date: string; value: number }[];
export function median(values: number[]) {
  values.sort((a, b) => a - b);
  return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
}
function summary(window: Samples, timing: boolean) {
  const values = window.map((r) => r.value);
  if (!timing) return median(values);
  if (
    window.length < config.weekend_min_nights ||
    !window.some((r) => [0, 6].includes(new Date(r.date).getUTCDay()))
  )
    return null;
  const angles = values.map((v) => (v * Math.PI) / 12);
  const center = (Math.atan2(sumYears(angles.map(Math.sin)), sumYears(angles.map(Math.cos))) * 12) / Math.PI;
  const times = values.map((v) => {
    const wrapped = (v - center + 12) % 24;
    return (wrapped < 0 ? wrapped + 24 : wrapped) - 12;
  });
  const mean = sumYears(times) / times.length;
  return Math.sqrt(sumYears(times.map((t) => (t - mean) ** 2)) / (times.length - 1));
}
export function chooseSource(sources: Map<string, Set<number>>, preferred: unknown, previous: string) {
  const good = [...sources.keys()].filter((k) => sources.get(k)!.size === 1).sort();
  return good.find((k) => k.split("|")[0] === preferred) ?? (good.includes(previous) ? previous : good[0]);
}
function weeklySignal(
  history: Samples,
  date: string,
  timing: boolean,
  tolerance: number,
  make: (v: number) => Contribution | null,
) {
  const recent = history.filter((r) => distance(date, r.date) < 7);
  const prior = history.slice(0, history.length - recent.length);
  let signal = 0;
  if (!timing && recent.length >= 3 && prior.length >= 7) {
    const trimmedMean = (samples: Samples) => {
      const values = samples
        .map((r) => r.value)
        .sort((a, b) => a - b)
        .slice(1, -1);
      return sumYears(values) / values.length;
    };
    const before = trimmedMean(prior),
      after = trimmedMean(recent);
    const first = make(before),
      second = make(after);
    if (first && second)
      signal = (second.years - first.years) * Math.min(1, Math.abs(after - before) / tolerance);
  }
  return signal;
}

function replayResult(
  rec: Contribution | null,
  level: number | null,
  weeklyLevel: number | undefined,
  window: Samples,
  last: string,
  at: string,
  freshness: number,
  wearable: boolean,
  timing: boolean,
  series: string,
) {
  const lag = distance(at, last);
  if (!rec || level === null || lag > freshness) return null;
  if (wearable) {
    const confidence = Math.min(1, window.length / config.full_dates) * Math.max(0, 1 - lag / freshness);
    return {
      ...rec,
      years: level,
      quality: rec.quality * confidence,
      level: weeklyLevel,
      confidence: 1,
      wear_age_days: lag,
      wear_confidence: confidence,
      series,
    };
  }
  const current = window.filter((r) => distance(at, r.date) < config.window);
  if (current.length < config.minimum || summary(current, timing) === null) return null;
  const confidence =
    Math.min(1, current.length / config.full_dates) * (1 - Math.max(0, lag - 1) / config.fresh);
  return {
    ...rec,
    level,
    confidence,
    years: level * confidence,
    quality: rec.quality * confidence,
    series,
  };
}

function levelWithinBand(
  level: number,
  years: number,
  value: number,
  tolerance: number,
  make: (v: number) => Contribution | null,
) {
  const band = [years];
  for (const endpoint of [value - tolerance, value + tolerance]) {
    const nearby = make(endpoint);
    if (nearby) band.push(nearby.years);
  }
  const nearest = clamp(level, Math.min(...band), Math.max(...band));
  return updateLevel(level, nearest, config.wear_tau, config.wear_rate);
}

export function replay(
  key: string,
  dates: StreamDates,
  at: string,
  make: (v: number, source: string) => Contribution | null,
  preferred?: unknown,
  wearable = false,
) {
  let last = "",
    source = "",
    start = "",
    level: number | null = null,
    rec: Contribution | null = null;
  let window: Samples = [];
  let established = false;
  let history: Samples = [];
  let weeklyLevel: number | undefined;
  const freshness = wearable ? WEARABLE_FRESH_DAYS : config.fresh;
  const tolerance =
    (wearable ? lookup({ hip_minutes: 5, activity: 35, hrv: 5 }, key) : undefined) ??
    lookup(config.deadband, key);
  const timing = key === "onset_sd";
  for (const date of [...dates.keys()].sort()) {
    const sources = dates.get(date)!;
    const next = chooseSource(sources, preferred, source);
    if (!next) continue;
    if (next !== source || distance(date, last) > freshness) {
      level = rec = null;
      established = false;
      start = date;
      window = [];
      history = [];
      weeklyLevel = undefined;
    }
    source = next;
    last = date;
    window = window.filter((r) => distance(date, r.date) < config.window);
    window.push({ date, value: [...sources.get(source)!][0] });
    if (wearable) {
      history = history.filter((r) => distance(date, r.date) < 35);
      history.push(window[window.length - 1]);
    }
    if (window.length < config.minimum) continue;
    const value = summary(window, timing);
    if (value === null) continue;
    rec = make(value, source);
    if (!rec) continue;
    if (tolerance === undefined) {
      level = updateLevel(level, rec.years);
    } else if (!established || level === null) {
      level = weeklyLevel = rec.years;
      start = date;
      established = window.length >= config.full_dates;
    } else if (wearable) {
      const signal = weeklySignal(history, date, timing, tolerance, (v) => make(v, source));
      const rate = Math.abs(signal) > 0.65 ? 0.00032 : 0.000055;
      weeklyLevel =
        (weeklyLevel ?? level) +
        (clamp((rec.years - level) / 2200, -0.000008, 0.000008) + clamp(signal / 240, -rate, rate));
      level = updateLevel(level, rec.years, 42, 0.016);
    } else {
      level = levelWithinBand(level, rec.years, value, tolerance, (v) => make(v, source));
    }
  }
  return replayResult(
    rec,
    level,
    weeklyLevel,
    window,
    last,
    at,
    freshness,
    wearable,
    timing,
    JSON.stringify([key, source, start]),
  );
}
