import type { GameRepsData, GameRouteData } from "../contract";
import type { Day } from "./contract";
import type { RungDefinition } from "./bank";
import type { MeasureSeries } from "./series";
import { ladderRungs, roundTotals } from "./achievements";
import { routeLegs } from "./route-progress";
import type { RouteLeg } from "./state";

export const EXERCISES = {
  pushups: { label: "Pushups", icon: "pushups", ftPerRep: 1 },
  pullups: { label: "Pull-ups", icon: "pullups", ftPerRep: 2 },
  squats: { label: "Squats", icon: "squats", ftPerRep: 1 },
  planks: { label: "Planks", icon: "planks", ftPerRep: 1 },
  abs: { label: "Abs", icon: "abs", ftPerRep: 1 },
  lunges: { label: "Lunges", icon: "dumbbell", ftPerRep: 1 },
  situps: { label: "Sit-ups", icon: "dumbbell", ftPerRep: 1 },
  crunches: { label: "Crunches", icon: "dumbbell", ftPerRep: 1 },
  burpees: { label: "Burpees", icon: "dumbbell", ftPerRep: 1 },
  walk: { label: "Walk", icon: "steps", ftPerRep: 1 },
  run: { label: "Run", icon: "run", ftPerRep: 1 },
  meditation: { label: "Meditation", icon: "dumbbell", ftPerRep: 1 },
  stretching: { label: "Stretching", icon: "dumbbell", ftPerRep: 1 },
  yoga: { label: "Yoga", icon: "dumbbell", ftPerRep: 1 },
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
  restingHeartRate: { direction: -1, norms: true },
  steps: { direction: 1, sum: { ladder: "route", stepsPerMile: 2000 }, norms: true },
  sleep: { direction: 1, sum: { ladder: "time" } },
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
export type Achievement<Context> = (context: Context) => Candidate[];

export interface AchievementContext {
  measures: readonly {
    id: string; pending: boolean; unit: MeasureSeries["unit"]; noun: string;
    points: readonly [Day, number][];
    rounds: readonly number[];
    rungs: readonly RungDefinition[];
    legs: readonly RouteLeg[];
  }[];
}

// BE2 adds health/friend evaluators at their read boundaries.
export const ACHIEVEMENTS: readonly Achievement<AchievementContext>[] = [roundTotals, ladderRungs,
  context => context.measures.filter(measure => !measure.pending).flatMap(measure => routeLegs({
    measureId: measure.id, legs: measure.legs, points: measure.points,
  }))];
