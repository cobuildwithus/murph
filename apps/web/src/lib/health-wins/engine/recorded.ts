import type { ClientUnits } from "../../companion/client-info";
import { invalidGameRequest } from "../../game/http/errors";
import { formatRungTime } from "../../game/progress/format";
import { activityNameTitle, activityNameWord } from "../activity-name";
import { prepareRecordedCandidate } from "../card-options";
import { routeCards } from "./route-cards";
import { validateRecordedRoute } from "./recorded-route";
import { formatDuration, formatNumber } from "./shared";
import type { RecordedActivity, RecordedActivityKind } from "./types";

const maxMinutes = 360;

const activityLabels = {
  sauna: { name: "sauna", hidden: "Sauna session" },
  cold_plunge: { name: "cold plunge", hidden: "Cold plunge session" },
  lift: { name: "strength session", hidden: "Strength session" },
  other: { name: "activity", hidden: "Timed activity" },
  run: { name: "run", hidden: "Went for a run" },
  walk: { name: "walk", hidden: "Went for a walk" },
} satisfies Record<RecordedActivityKind, { name: string; hidden: string }>;

const dayLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function validDuration(seconds: number) {
  return Number.isInteger(seconds) && seconds > 0 && seconds <= maxMinutes * 60;
}

export function validateRecordedActivity(activity: RecordedActivity): void {
  if (!validDuration(activity.elapsedSec) || !validDuration(activity.movingSec)
    || activity.movingSec > activity.elapsedSec
    || (activity.timerSec !== undefined && !validDuration(activity.timerSec))) {
    throw invalidGameRequest("Check the recorded activity duration.");
  }
  if (activity.route) validateRecordedRoute(activity.route, activity.kind, activity.movingSec);
  const hr = activity.heartRate;
  if (!hr) return;
  if (![hr.lowBpm, hr.avgBpm, hr.peakBpm].every(bpm => Number.isFinite(bpm) && bpm >= 30 && bpm <= 230)
    || hr.lowBpm > hr.avgBpm || hr.avgBpm > hr.peakBpm) {
    throw invalidGameRequest("Check the heart rate summary.");
  }
  if (hr.perMinute !== undefined) {
    // The phone cuts pauses out of the line, so it has one value per minute of recording.
    const minutes = Math.ceil(activity.movingSec / 60);
    if (hr.perMinute.length > maxMinutes || Math.abs(hr.perMinute.length - minutes) > 1
      || hr.perMinute.some(bpm => bpm !== null && (!Number.isInteger(bpm) || bpm < hr.lowBpm || bpm > hr.peakBpm))) {
      throw invalidGameRequest("Check the minute heart rate readings.");
    }
  }
}

/** The sealed activity row and Settings export share this closed summary shape. */
export function recordedActivitySummary(activity: RecordedActivity) {
  const { id, kind, name, startedAt, elapsedSec, movingSec, timerSec, heartRate, route } = activity;
  return {
    id, kind, ...(name && { name }), startedAt: new Date(startedAt).toISOString(), elapsedSec, movingSec,
    ...(timerSec === undefined ? {} : { timerSec }),
    ...(heartRate && { heartRate: { avgBpm: heartRate.avgBpm, lowBpm: heartRate.lowBpm, peakBpm: heartRate.peakBpm } }),
    ...(route && { route: {
      distanceM: route.distanceM, climbM: route.climbM,
      splitSec: route.splits.map(split => split.seconds),
    } }),
  };
}

interface RecordedCardContext {
  day: string;
  hour: number;
  previous?: Pick<RecordedActivity, "kind" | "name">;
  units: ClientUnits;
}

function displayWord({ kind, name }: Pick<RecordedActivity, "kind" | "name">) {
  return name === undefined ? activityLabels[kind].name : activityNameWord(name);
}

function minuteExtrema(series: readonly (number | null)[]) {
  let low: { minute: number; bpm: number } | undefined;
  let peak: typeof low;
  for (const [index, bpm] of series.entries()) {
    if (bpm === null) continue;
    if (!low || bpm < low.bpm) low = { minute: index + 1, bpm };
    if (!peak || bpm > peak.bpm) peak = { minute: index + 1, bpm };
  }
  return low && peak ? { low, peak } : null;
}

export function buildRecordedCards(activity: RecordedActivity, context: RecordedCardContext) {
  validateRecordedActivity(activity);
  const { day, hour, previous } = context;
  const label = activityLabels[activity.kind];
  const bucket = hour < 5 ? "Night" : hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  const word = displayWord(activity);
  const previousWord = previous && displayWord(previous);
  const suggestedTitle = previousWord && previousWord !== word
    ? `${activityNameTitle(activity.name ?? word)} after your ${previousWord}`
    : `${bucket} ${word}`;
  // Day and part of day only: the card never carries the start time.
  const recorded = `Recorded on ${dayLabel.format(new Date(day))}, ${bucket.toLowerCase()}`;
  const cards = routeCards(activity, recorded, context.units, word);
  // Time spent doing it: pauses don't count, the same clock the phone's timer runs on.
  // Named titles use compact hours. Keep legacy duration text stable for existing card revisions.
  const number = activity.name && activity.movingSec >= 3600
    ? formatDuration(Math.floor(activity.movingSec / 60))
    : formatRungTime(activity.movingSec);
  const title = { number, measure: word };
  const base = { title, filter: "Fitness", theme: "fitness", share: { caption_tips: [] } } as const;
  const timer = activity.timerSec === undefined ? {} : { timerMinutes: activity.timerSec / 60 };
  const hr = activity.heartRate;
  const series = hr?.perMinute;
  const extrema = minuteExtrema(series ?? []);
  if (hr && series && extrema) cards.push({
    ...base, id: `activity:${activity.id}:activity_heart_rate`, kind: "activity_heart_rate",
    // One peak on the card: the subtitle names the line's highest minute, the same number its marker shows.
    subtitle: `heart rate peaked at ${formatNumber(extrema.peak.bpm)}`,
    source_note: `${recorded}. The line shows each minute's average.`,
    chart: { type: "heart_rate", perMinute: [...series], ...extrema, ...timer },
  });
  else if (!cards.length) cards.push({
    ...base, id: `activity:${activity.id}:activity_time`, kind: "activity_time",
    subtitle: activity.timerSec === undefined ? "timed with Murph" : `on a ${formatRungTime(activity.timerSec)} timer`,
    source_note: recorded, chart: { type: "duration", minutes: activity.movingSec / 60, ...timer },
  });
  return { suggestedTitle, candidates: cards.map(card => prepareRecordedCandidate(card, label.hidden)) };
}
