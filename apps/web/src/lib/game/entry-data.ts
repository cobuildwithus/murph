import type { GameEntryData, GameEntryKind, GameHeartRateData, GameRepsData, GameRouteData } from "./contract";
import { isRecord } from "../primitives";
import { reject } from "./rules";

/** Closed summary shapes exclude samples/coordinates, including nested extras. */
export function parseGameEntryData(kind: GameEntryKind, value: unknown): GameEntryData | undefined {
  // Retained heart-rate games accepted image-only posts; the rule knows the terms.
  if (kind === "heart_rate") return value === undefined ? undefined : heartRate(value);
  if (kind === "route") return route(value);
  if (kind === "reps") return reps(value);
  if (value !== undefined) invalid();
  return undefined;
}

export function parseStoredGameEntryData(kind: GameEntryKind, value: string | null): GameEntryData | null {
  if (value === null) return null;
  try { return parseGameEntryData(kind, JSON.parse(value)) ?? null; }
  catch { throw new Error("Stored game entry data is malformed."); }
}

function heartRate(value: unknown): GameHeartRateData {
  const data = object(value, ["durationSec", "avgBpm", "lowBpm", "peakBpm"]);
  return { durationSec: number(data.durationSec, true), avgBpm: number(data.avgBpm, true),
    lowBpm: number(data.lowBpm, true), peakBpm: number(data.peakBpm, true) };
}

function route(value: unknown): GameRouteData {
  const data = object(value, ["activity", "distanceM", "durationSec"]);
  if (data.activity !== "walk" && data.activity !== "run") invalid();
  return { activity: data.activity, distanceM: number(data.distanceM), durationSec: number(data.durationSec) };
}

function reps(value: unknown): GameRepsData {
  const data = object(value, ["exercise", "count", "countLow", "countHigh", "reps", "fastestMs", "slowestMs", "heartRate"]);
  if (data.exercise !== "pushups" || !Array.isArray(data.reps) || data.reps.length > 300) invalid();
  const optionalInteger = (value: unknown) => value === undefined ? undefined : number(value, true);
  return { exercise: data.exercise, count: number(data.count, true), countLow: optionalInteger(data.countLow),
    countHigh: optionalInteger(data.countHigh), fastestMs: optionalInteger(data.fastestMs), slowestMs: optionalInteger(data.slowestMs),
    heartRate: data.heartRate === undefined ? undefined : heartRate(data.heartRate),
    reps: data.reps.map((value) => {
      const rep = object(value, ["tMs", "depth"]);
      const depth = number(rep.depth);
      if (depth > 1) invalid();
      return { tMs: number(rep.tMs, true), depth };
    }) };
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) invalid();
  return value;
}

function number(value: unknown, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) invalid();
  return value;
}

function invalid(): never {
  return reject("INVALID_REQUEST", "Include valid artifact summary data without samples or coordinates.");
}
