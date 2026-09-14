import { matchPersonalPatternControls } from "./personal-pattern-matching.ts";
import {
  patternAddDays, patternDayGap, personalPatternPriorLoad,
  type PersonalPatternEvidence,
} from "./personal-pattern-evidence.ts";

export interface PatternComparisonInput {
  dates: ReadonlySet<string>;
  absentDates: ReadonlySet<string>;
  sources: ReadonlyMap<string, string | null>;
  episodes: readonly ReadonlySet<string>[];
  values: ReadonlyMap<string, number>;
  outcomeSources: ReadonlyMap<string, string | null>;
  lagDays: 0 | 1;
  fromDate: string;
  asOf: string;
  activity: boolean;
  evidence: PersonalPatternEvidence;
  absoluteFloor: number;
  relativeFloor: number;
  searchSize: number;
}

interface ComparisonDay {
  date: string;
  value: number;
  controls: Array<{ date: string; value: number }>;
}

export interface PatternComparisonEpisode {
  exposedDates: string[];
  comparisonDates: string[];
  exposedValue: number;
  comparisonValue: number;
  days: ComparisonDay[];
}

interface Profile {
  values: Map<string, number | null>;
  scale: number;
  caliper: number;
}

const average = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const quantile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
};
const difference = (pairs: readonly PatternComparisonEpisode[]) =>
  average(pairs.map((pair) => pair.exposedValue - pair.comparisonValue));

/** Only the latest uninterrupted measurement source period is comparable. */
export function latestPersonalPatternPeriod(sources: ReadonlyMap<string, string | null>): Set<string> {
  const dates = [...sources.keys()].sort().reverse();
  const latest = sources.get(dates[0]);
  const period = new Set<string>();
  if (latest === null || latest === undefined) return period;
  for (const date of dates) {
    if (sources.get(date) !== latest) break;
    period.add(date);
  }
  return period;
}

export function comparePersonalPattern(input: PatternComparisonInput): {
  pairs: PatternComparisonEpisode[]; reliable: boolean;
} {
  const outcomePeriod = latestPersonalPatternPeriod(input.outcomeSources);
  const factorPeriod = latestPersonalPatternPeriod(input.sources);
  const source = input.sources.get([...factorPeriod].sort().at(-1) ?? "") ?? null;
  const qualified = input.evidence.qualifiedDates.get(source ?? "") ?? new Set<string>();
  const allDates: string[] = [];
  for (let date = input.fromDate; date <= input.asOf; date = patternAddDays(date, 1)) {
    if (input.activity && input.evidence.excludedActivityDates.has(date)) continue;
    if (input.dates.has(date) && input.absentDates.has(date)) continue;
    allDates.push(date);
  }
  const exposures = allDates.filter((date) => input.dates.has(date) && factorPeriod.has(date));
  // Manual notes retain descriptive unobserved comparisons, with their existing
  // grade cap. Device inference requires established same-source daytime data.
  const eligible = (date: string) => source === "manual" || qualified.has(date);
  const controls = allDates.filter((date) => !input.dates.has(date)
    && (input.absentDates.has(date) || eligible(date)));
  const observed = (date: string) => input.values.has(patternAddDays(date, input.lagDays))
    && outcomePeriod.has(patternAddDays(date, input.lagDays));
  const observedExposures = exposures.filter(observed);
  const observedControls = controls.filter(observed);
  const profiles = comparisonProfiles(input, source, observedExposures, observedControls);
  const cost = (exposed: string, control: string, radius: number): number | null => {
    const distance = patternDayGap(exposed, control);
    if (distance > radius || (!input.absentDates.has(control) && !eligible(exposed))) return null;
    // Known previous-day exposure distinguishes isolated from consecutive sessions.
    const previous = (date: string) => {
      const prior = patternAddDays(date, -1);
      return input.dates.has(prior) ? true : input.absentDates.has(prior) || qualified.has(prior) ? false : null;
    };
    if (previous(exposed) !== null && previous(control) !== null
      && previous(exposed) !== previous(control)) return null;
    let covariateCost = 0;
    for (const profile of profiles) {
      const a = profile.values.get(exposed) ?? null;
      const b = profile.values.get(control) ?? null;
      if ((a === null) !== (b === null)) return null;
      if (a === null || b === null) { covariateCost += 2; continue; }
      if (Math.abs(a - b) > profile.caliper) return null;
      covariateCost += Math.abs(a - b) / profile.scale;
    }
    return Math.round(covariateCost * 1_000_000) + distance * 10
      + (input.absentDates.has(control) ? 0 : 1);
  };
  const match = (ratio: number, radius: number) => aggregateEpisodes(input,
    matchPersonalPatternControls(observedExposures, observedControls,
      (a, b) => cost(a, b, radius), ratio));
  const pairs = match(3, 35);
  const available = (selected: readonly string[], total: readonly string[]) => selected.length / Math.max(1, total.length);
  const exposureAvailability = available(observedExposures, exposures);
  const controlAvailability = available(observedControls, controls);
  const retained = pairs.flatMap((pair) => pair.exposedDates).length / Math.max(1, observedExposures.length);
  const reliable = retained >= 0.6 && exposureAvailability >= 0.7 && controlAvailability >= 0.7
    && Math.abs(exposureAvailability - controlAvailability) <= 0.2
    && passesPatternReliability(input, pairs, profiles)
    && passesAlternateComparisons(pairs, [match(1, 35), match(3, 21)], input);
  return { pairs, reliable };
}

function comparisonProfiles(input: PatternComparisonInput, source: string | null,
  exposed: string[], controls: string[]): Profile[] {
  const dates = [...exposed, ...controls];
  // Prior calendar days are always pre-exposure, including date-only notes.
  const prior = (date: string) => input.values.get(patternAddDays(date, -1)) ?? null;
  const load = (date: string) => personalPatternPriorLoad(input.evidence, source, date);
  return [prior, load].flatMap((read, index) => {
    const values = new Map(dates.map((date) => [date, read(date)]));
    const coverage = (group: string[]) => group.filter((date) => values.get(date) !== null).length / Math.max(1, group.length);
    if (coverage(exposed) < 0.7 || coverage(controls) < 0.7) return [];
    const observed = [...values.values()].filter((value): value is number => value !== null);
    const scale = Math.max(index === 0 ? input.absoluteFloor : 500,
      (quantile(observed, 0.75) - quantile(observed, 0.25)) / 1.349);
    return [{ values, scale, caliper: scale * 0.75 }];
  });
}

function episodeFromDays(days: ComparisonDay[]): PatternComparisonEpisode {
  return {
    days,
    exposedDates: days.map((day) => day.date),
    comparisonDates: days.flatMap((day) => day.controls.map((control) => control.date)),
    exposedValue: average(days.map((day) => day.value)),
    comparisonValue: average(days.map((day) => average(day.controls.map((control) => control.value)))),
  };
}

function aggregateEpisodes(input: PatternComparisonInput, matches: ReadonlyMap<string, string[]>): PatternComparisonEpisode[] {
  return input.episodes.flatMap((episode) => {
    const days = [...episode].sort().flatMap((date) => {
      const controls = matches.get(date);
      if (!controls?.length) return [];
      return [{ date, value: input.values.get(patternAddDays(date, input.lagDays))!,
        controls: controls.map((control) => ({ date: control,
          value: input.values.get(patternAddDays(control, input.lagDays))! })) }];
    });
    return days.length ? [episodeFromDays(days)] : [];
  });
}

function passesPatternReliability(input: PatternComparisonInput, pairs: PatternComparisonEpisode[], profiles: Profile[]): boolean {
  const searchPenalty = Math.ceil(Math.log2(Math.max(1, input.searchSize / 12)));
  if (pairs.length < 6 + searchPenalty + (profiles.length === 0 ? 2 : 0)) return false;
  const dates = pairs.flatMap((pair) => pair.exposedDates).sort();
  if (patternDayGap(dates[0], dates.at(-1)!) < 42
    || patternDayGap(dates.at(-1)!, input.asOf) > 28
    || patternDayGap([...input.values.keys()].sort().at(-1)!, input.asOf) > 7) return false;
  const delta = difference(pairs);
  const floor = Math.max(input.absoluteFloor, Math.abs(average(pairs.map((p) => p.comparisonValue))) * input.relativeFloor);
  const sign = Math.sign(delta);
  const deltas = pairs.map((pair) => pair.exposedValue - pair.comparisonValue);
  if (Math.abs(delta) < floor || quantile(deltas.map((d) => d * sign), 0.5) < floor
    || deltas.filter((value) => value * sign > 0).length < (pairs.length < 8 ? pairs.length : Math.ceil(pairs.length * 0.8))) return false;
  const mid = Math.floor(pairs.length / 2);
  if (difference(pairs.slice(0, mid)) * sign <= 0 || difference(pairs.slice(mid)) * sign <= 0) return false;
  const variance = average(deltas.map((value) => (value - delta) ** 2));
  const weeks = (values: string[]) => new Set(values.map((date) => Math.floor(Date.parse(date) / (7 * 86_400_000)))).size;
  const information = Math.min(pairs.length, weeks(dates), weeks(pairs.flatMap((pair) => pair.comparisonDates)));
  if (information < 6 || Math.abs(delta) * Math.sqrt(information) / Math.max(Math.sqrt(variance), floor / 2) < 3 + searchPenalty * 0.5) return false;
  if (!balancedProfiles(pairs, profiles)) return false;
  const stable = (subset: PatternComparisonEpisode[]) => subset.length > 0 && difference(subset) * sign >= floor / 2;
  if (pairs.some((_, index) => !stable(pairs.filter((__, other) => other !== index)))) return false;
  const allDates = new Set(pairs.flatMap((pair) => [...pair.exposedDates, ...pair.comparisonDates]));
  for (const start of allDates) {
    const inBlock = (date: string) => date >= start && date < patternAddDays(start, 14);
    const weight = average(pairs.map((pair) => pair.exposedDates.filter(inBlock).length / pair.exposedDates.length));
    if (weight > 0.35) return false;
    const subset = pairs.flatMap((pair) => {
      const days = pair.days.filter((day) => !inBlock(day.date)).map((day) => ({
        ...day, controls: day.controls.filter((control) => !inBlock(control.date)),
      })).filter((day) => day.controls.length > 0);
      return days.length ? [episodeFromDays(days)] : [];
    });
    if (!stable(subset)) return false;
  }
  return true;
}

function balancedProfiles(pairs: PatternComparisonEpisode[], profiles: Profile[]): boolean {
  return profiles.every((profile) => {
    const exposure: number[] = [];
    const comparison: number[] = [];
    let missingWeight = 0;
    for (const pair of pairs) {
      let a = 0; let b = 0; let weight = 0;
      for (const day of pair.days) {
        const value = profile.values.get(day.date);
        if (value === null || value === undefined) { missingWeight += 1 / pair.days.length / pairs.length; continue; }
        a += value / pair.days.length;
        b += average(day.controls.map((control) => profile.values.get(control.date)!)) / pair.days.length;
        weight += 1 / pair.days.length;
      }
      if (weight) { exposure.push(a / weight); comparison.push(b / weight); }
    }
    return missingWeight <= 0.2 && exposure.length > 0
      && Math.abs(average(exposure) - average(comparison)) / profile.scale <= 0.25;
  });
}

function passesAlternateComparisons(primary: PatternComparisonEpisode[], alternatives: PatternComparisonEpisode[][],
  input: PatternComparisonInput): boolean {
  const floor = Math.max(input.absoluteFloor, Math.abs(average(primary.map((p) => p.comparisonValue))) * input.relativeFloor);
  let viable = 0;
  for (const alternate of alternatives) {
    const byDate = new Map(alternate.flatMap((pair) => pair.days.map((day) => [day.date, day] as const)));
    const retainedWeight = average(primary.map((pair) => pair.days.filter((day) => byDate.has(day.date)).length / pair.days.length));
    if (retainedWeight < 0.7) continue;
    const subset = primary.flatMap((pair) => {
      const days = pair.days.flatMap((day) => byDate.has(day.date) ? [byDate.get(day.date)!] : []);
      return days.length ? [episodeFromDays(days)] : [];
    });
    viable += 1;
    if (difference(subset) * Math.sign(difference(primary)) < floor / 2) return false;
  }
  return viable > 0;
}
