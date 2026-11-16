import type { GameRepsData, GameRouteData } from "../contract";
import type { Day } from "./contract";

export const EXERCISES = {
  pushups: { label: "Pushups", icon: "pushups", ftPerRep: 1 },
  pullups: { label: "Pull-ups", icon: "pullups", ftPerRep: 2 },
  squats: { label: "Squats", icon: "squats", ftPerRep: 1 },
  planks: { label: "Planks", icon: "planks", ftPerRep: 1 },
  abs: { label: "Abs", icon: "abs", ftPerRep: 1 },
} as const;

export interface DayAmount { measureId: string; date: Day; amount: number }
export interface Reader<T> {
  entryKind: string;
  unit: "reps" | "meters";
  measureId: (data: T) => string;
  amount: (data: T) => number;
}
export const READERS = [
  { entryKind: "reps", unit: "reps", measureId: (data: GameRepsData) => `${data.exercise}.reps`, amount: (data: GameRepsData) => data.count } satisfies Reader<GameRepsData>,
  { entryKind: "route", unit: "meters", measureId: (data: GameRouteData) => `${data.activity}.meters`, amount: (data: GameRouteData) => data.distanceM } satisfies Reader<GameRouteData>,
] as const;

export const HEALTH = {
  restingHeartRate: { step: 1, direction: -1, norms: true },
  steps: { step: 1000, direction: 1, sum: { ladder: "route", stepsPerMile: 2000 }, norms: true },
  sleep: { step: 15 * 60, direction: 1, sum: { ladder: "time" } },
  vo2Max: { step: 1, direction: 1, norms: true },
} as const;

export type AwardValue = string | number | boolean | null | AwardValue[] | { [key: string]: AwardValue };
export interface Candidate {
  key: string;
  kind: string;
  measureId: string | null;
  subjectMemberId: string | null;
  on: Day;
  data: { [key: string]: AwardValue };
}
/** BE1 supplies the concrete context and achievement list. */
export type Achievement<Context> = (context: Context) => Candidate[];
