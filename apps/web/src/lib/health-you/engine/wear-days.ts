import {
  model,
  between,
  distance,
  eligible,
  number,
  released,
  rowDay,
  type MemberEvidence,
  type Observation,
} from "./model";

export type Wear = { minutes: number; flag: unknown; mask: bigint | null };
export type WearDates = Map<string, Wear | null>;
export type WearBySource = Map<string, WearDates>;

function maskOf(blocks: unknown, minutes: number | null) {
  if (!Array.isArray(blocks) || !blocks.length || blocks.length > 1440) return null;
  let mask = 0n,
    count = 0;
  for (const block of blocks) {
    if (!Array.isArray(block) || block.length !== 2) return null;
    const [start, end] = block;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end)
      return null;
    const part = ((1n << BigInt(end - start)) - 1n) << BigInt(start);
    if (mask & part) return null;
    mask |= part;
    count += end - start;
  }
  return minutes === null || count === minutes ? { mask, count } : null;
}
function window(row: Observation, minutes: number | null) {
  const start = row.wear_start_local_min,
    end = row.wear_end_local_min;
  const continuous = maskOf([[start, end]], minutes);
  if (!("wear_intervals_local_min" in row)) return continuous;
  const measured = maskOf(row.wear_intervals_local_min, minutes);
  return (start != null || end != null) && continuous?.mask !== measured?.mask ? null : measured;
}
export function identity(row: Observation) {
  const parts = [row.source, row.series_method, row.device_id];
  return parts.every((v) => typeof v === "string" && v && !v.includes("|"))
    ? [String(row.source).toLowerCase(), String(row.series_method).toLowerCase(), row.device_id].join("|")
    : null;
}
const excluded = new Set([
  "manual",
  "self",
  "user_entered",
  "member_entered",
  ...model.feeds.excluded_methods,
]);
export function sensorRecord(row: Observation) {
  return ![row.method, row.series_method].some((v) =>
    excluded.has(
      String(v ?? "")
        .trim()
        .toLowerCase()
        .replace(/[ -]/g, "_"),
    ),
  );
}
export function completeWear(row: Observation) {
  const flag = row.wear_complete;
  if (row.worn_min == null) return flag === true;
  return (
    (flag === true || flag == null) &&
    between(number(row.worn_min), flag === true ? 600 : model.policy.protocol.full_wear_minutes, 1440)
  );
}
function intervalDuration(row: Observation): Observation {
  if (!("wear_intervals_local_min" in row) || row.worn_min != null) return row;
  const measured = window(row, null);
  return measured ? { ...row, worn_min: measured.count } : { ...row, wear_complete: false };
}
function measuredWear(row: Observation, at: string): Wear | null {
  const minutes = number(row.worn_min),
    flag = row.wear_complete,
    mask = window(row, minutes)?.mask ?? null;
  return eligible(row, at) &&
  ["final", "amended", "corrected"].includes(String(row.status ?? "final")) &&
  !row.partial &&
  !row.off_body &&
  !row.unfinished &&
  between(minutes, 0, 1440) &&
  (flag == null || typeof flag === "boolean") &&
  (!("wear_intervals_local_min" in row) || mask !== null)
    ? { minutes, flag, mask }
    : null;
}

function conflictingWear(a: Wear | null, b: Wear | null) {
  return a?.minutes !== b?.minutes || a?.mask !== b?.mask || a?.flag !== b?.flag;
}
export function durations(data: MemberEvidence, at: string) {
  const entries = new Map<string, { revision: number; wear: Wear | null }>();
  for (const original of data.wear_days ?? []) {
    const instrument = identity(original),
      date = rowDay(original),
      revision = original.revision ?? 0;
    if (
      !instrument ||
      !date ||
      date > at ||
      typeof revision !== "number" ||
      !Number.isInteger(revision) ||
      revision < 0 ||
      !released(original, at)
    )
      continue;
    const row = intervalDuration(original),
      key = date + "|" + instrument,
      old = entries.get(key);
    if (old && old.revision > revision) continue;
    let wear = measuredWear(row, at);
    if (old?.revision === revision && conflictingWear(old.wear, wear)) wear = null;
    entries.set(key, { revision, wear });
  }
  return entries;
}
function consistentWear(row: Observation, wear: Wear, minutes: number | null) {
  if (row.worn_min != null && minutes !== wear.minutes) return false;
  if (wear.flag != null && row.wear_complete != null && row.wear_complete !== wear.flag) return false;
  const mask = window(row, wear.minutes)?.mask ?? null;
  return mask === null ? !("wear_intervals_local_min" in row) : wear.mask === null || mask === wear.mask;
}
export function stepWear(
  original: Observation,
  separate: ReturnType<typeof durations>,
  legacy: boolean,
): { row: Observation; mask: bigint | null; instrument: string | null } {
  const instrument = legacy ? null : identity(original);
  const row = legacy ? original : intervalDuration(original);
  const entry = instrument ? separate.get(rowDay(row) + "|" + instrument) : undefined;
  const minutes = number(row.worn_min);
  let mask = window(row, minutes)?.mask ?? null;
  const invalid = { row: { ...row, wear_complete: false }, mask: null, instrument };
  if ((instrument || "wear_intervals_local_min" in row) && !sensorRecord(row)) return invalid;
  if (entry) {
    const wear = entry.wear;
    if (!wear || !consistentWear(row, wear, minutes)) return invalid;
    mask = window(row, wear.minutes)?.mask ?? null;
    return {
      row: { ...row, worn_min: wear.minutes, wear_complete: wear.flag ?? row.wear_complete },
      mask: wear.mask ?? mask,
      instrument,
    };
  }
  return !legacy && "wear_intervals_local_min" in row && mask === null ? invalid : { row, mask, instrument };
}

export type Sample = { date: string; value: number };
export function trimmed(values: number[]) {
  const middle = [...values].sort((a, b) => a - b).slice(1, -1);
  return middle.reduce((a, b) => a + b, 0) / middle.length;
}
function median(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  return (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2;
}
const weekday = (date: string) => new Date(date).getUTCDay();
function weeksEnding(history: Sample[], at: string) {
  const weeks = Array.from({ length: 8 }, () => [] as Sample[]);
  for (const r of history) weeks[Math.floor(distance(at, r.date) / 7)].push(r);
  return weeks;
}
function weekdayBaseline(samples: Sample[]) {
  const days = Array.from({ length: 7 }, () => [] as number[]);
  for (const sample of samples) days[weekday(sample.date)].push(sample.value);
  return days.map((values) => ({ count: values.length, prior: values.length >= 2 ? median(values) : null }));
}
function paired(samples: Sample[], baseline: ReturnType<typeof weekdayBaseline>) {
  return samples.flatMap(({ date, value }) => {
    const prior = baseline[weekday(date)].prior;
    return prior === null ? [] : [{ value, prior }];
  });
}
export function weekComparison(history: Sample[], at: string, steps: boolean) {
  const weeks = weeksEnding(history, at);
  const current = weeks[0],
    baseWeeks = weeks.slice(2).filter((w) => w.length >= 3),
    baseline = baseWeeks.flat();
  if (current.length < 3 || baseline.length < 7) return null;
  const days = weekdayBaseline(baseline);
  const pairs = paired(current, days);
  const counts = days.map((d) => d.count).filter((count) => count > 0);
  if (
    steps &&
    baseWeeks.length >= 2 &&
    (pairs.length < current.length ||
      (current.length === 7 && Math.max(...counts) - Math.min(...counts) >= 2))
  ) {
    return pairs.length < 3 ? null : [trimmed(pairs.map((p) => p.value)), trimmed(pairs.map((p) => p.prior))];
  }
  const prior =
    current.length < 7 && pairs.length === current.length
      ? trimmed(pairs.map((p) => p.prior))
      : baseWeeks.reduce((sum, w) => sum + trimmed(w.map((r) => r.value)) * w.length, 0) / baseline.length;
  return [trimmed(current.map((r) => r.value)), prior];
}
export function confirmedGain(history: Sample[], at: string, change: number, tolerance: number) {
  const weeks = weeksEnding(history, at);
  const baseline = weekdayBaseline(
    weeks
      .slice(2)
      .filter((w) => w.length >= 3)
      .flat(),
  );
  const gains = [change];
  for (const w of weeks.slice(0, 2)) {
    const pairs = paired(w, baseline);
    if (pairs.length < 4) return 0;
    gains.push(trimmed(pairs.map((p) => p.value)) - trimmed(pairs.map((p) => p.prior)));
  }
  return -0.24 * Math.tanh(Math.max(0, Math.min(...gains) - tolerance / 2) / tolerance);
}
function minutesSet(bits: bigint) {
  let n = 0;
  while (bits && n <= 60) {
    bits &= bits - 1n;
    n++;
  }
  return n;
}
const sameWindow = (a: bigint, b: bigint) => minutesSet(a & ~b) <= 60 && minutesSet(b & ~a) <= 60;
export function comparableWear(
  history: Sample[],
  at: string,
  minutes: WearDates | undefined,
  comparison: number[] | null,
) {
  if (!minutes?.size || !comparison) return { comparison, rematched: false };
  const known = history.flatMap((r) => {
    const wear = minutes.get(r.date);
    return wear ? [{ ...r, ...wear, day: weekday(r.date), lag: distance(at, r.date) }] : [];
  });
  const prior = known.filter((r) => r.lag >= 14),
    recent = known.filter((r) => r.lag < 7);
  let shifted = false,
    clock = false;
  for (const r of recent) {
    const matched = prior.filter((p) => p.day === r.day);
    const reference = matched.length >= 2 ? matched : prior;
    if (matched.length >= 2) shifted ||= Math.abs(r.minutes - median(matched.map((p) => p.minutes))) > 60;
    else if (prior.length >= 7)
      shifted ||=
        r.minutes < Math.min(...prior.map((p) => p.minutes)) - 60 ||
        r.minutes > Math.max(...prior.map((p) => p.minutes)) + 60;
    else continue;
    const masks = reference.flatMap((p) => (p.mask === null ? [] : [p.mask]));
    if (r.mask !== null && masks.length >= 2 && masks.some((m) => !sameWindow(r.mask!, m))) clock = true;
  }
  if (
    history.some(
      (r) =>
        distance(at, r.date) < 7 &&
        minutes.get(r.date)?.mask == null &&
        prior.filter((p) => p.day === weekday(r.date) && p.mask !== null).length >= 2,
    )
  )
    clock = true;
  if (!clock && !shifted) return { comparison, rematched: false };
  const pairs = recent.flatMap((r) => {
    const matches = prior.filter(
      (p) =>
        p.day === r.day &&
        Math.abs(p.minutes - r.minutes) <= 60 &&
        (!clock || (p.mask !== null && r.mask !== null && sameWindow(p.mask, r.mask))),
    );
    return matches.length >= 2 ? [{ value: r.value, prior: median(matches.map((p) => p.value)) }] : [];
  });
  return {
    comparison:
      pairs.length >= 3 ? [trimmed(pairs.map((p) => p.value)), trimmed(pairs.map((p) => p.prior))] : null,
    rematched: true,
  };
}
