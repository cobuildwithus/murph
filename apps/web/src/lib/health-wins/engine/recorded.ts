import type { ClientUnits } from "../../companion/client-info";
import { invalidGameRequest } from "../../game/http/errors";
import { formatRungTime } from "../../game/progress/format";
import { prepareRecordedCandidate } from "../card-options";
import { formatNumber } from "./shared";
import type { CardSpec, RecordedActivity, RecordedActivityKind, RecordedActivitySummary } from "./types";

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
export function recordedActivitySummary(activity: RecordedActivity): RecordedActivitySummary {
  const { id, kind, startedAt, elapsedSec, movingSec, timerSec, heartRate } = activity;
  return {
    id, kind, startedAt: new Date(startedAt).toISOString(), elapsedSec, movingSec,
    ...(timerSec === undefined ? {} : { timerSec }),
    ...(heartRate && { heartRate: { avgBpm: heartRate.avgBpm, lowBpm: heartRate.lowBpm, peakBpm: heartRate.peakBpm } }),
  };
}

interface RecordedCardContext {
  day: string;
  hour: number;
  previousKind?: RecordedActivityKind;
  units: ClientUnits;
}

/** Timed measures use the same units on all clients. Only an actual spec difference changes its revision. */
export function buildRecordedCards(activity: RecordedActivity, context: RecordedCardContext) {
  validateRecordedActivity(activity);
  const { day, hour, previousKind } = context;
  const label = activityLabels[activity.kind];
  const bucket = hour < 5 ? "Night" : hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  const name = label.name.charAt(0).toUpperCase() + label.name.slice(1);
  const suggestedTitle = previousKind && previousKind !== activity.kind
    ? `${name} after your ${activityLabels[previousKind].name}`
    : `${bucket} ${label.name}`;
  // Day and part of day only: the card never carries the start time.
  const recorded = `Recorded on ${dayLabel.format(new Date(day))}, ${bucket.toLowerCase()}`;
  // Time spent doing it: pauses don't count, the same clock the phone's timer runs on.
  const title = { number: formatRungTime(activity.movingSec), measure: label.name };
  const base = { title, filter: "Fitness", theme: "fitness", share: { caption_tips: [] } } as const;
  const timer = activity.timerSec === undefined ? {} : { timerMinutes: activity.timerSec / 60 };
  const hr = activity.heartRate;
  const series = hr?.perMinute;
  let low: { minute: number; bpm: number } | undefined;
  let peak: typeof low;
  for (const [index, bpm] of (series ?? []).entries()) {
    if (bpm === null) continue;
    if (!low || bpm < low.bpm) low = { minute: index + 1, bpm };
    if (!peak || bpm > peak.bpm) peak = { minute: index + 1, bpm };
  }
  const card: CardSpec = hr && series && low && peak ? {
    ...base, id: `activity:${activity.id}:activity_heart_rate`, kind: "activity_heart_rate",
    // The subtitle reports the highest single reading; the line shows minute averages, so the note says so.
    subtitle: `heart rate peaked at ${formatNumber(hr.peakBpm)}`,
    source_note: `${recorded}. The line shows each minute's average.`,
    chart: { type: "heart_rate", perMinute: [...series], low, peak, ...timer },
  } : {
    ...base, id: `activity:${activity.id}:activity_time`, kind: "activity_time",
    subtitle: activity.timerSec === undefined ? "timed with Murph" : `on a ${formatRungTime(activity.timerSec)} timer`,
    source_note: recorded, chart: { type: "duration", minutes: activity.movingSec / 60, ...timer },
  };
  return { suggestedTitle, candidates: [prepareRecordedCandidate(card, label.hidden)] };
}
