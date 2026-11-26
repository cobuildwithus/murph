import "server-only";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { obligationDays } from "../game/board-streak";
import { ladderRungs, roundTotals } from "../game/progress/achievements";
import type { StoredAward } from "../game/progress/awards";
import { rungEntry, type RungDefinition } from "../game/progress/bank";
import { achievementContext, measureLadder } from "../game/progress/goals";
import { ProgressReadTiming } from "../game/progress/read-timing";
import { EXERCISES, type Candidate } from "../game/progress/registry";
import { gameSeries, readGameSeriesFacts, type MeasureSeries, type ProgressGame } from "../game/progress/series";
import type { MeasureState } from "../game/progress/state";
import { mergeVaultRuns, RUN_MEASURE_ID } from "../game/progress/vault-runs";
import { addDays, weekdayOf } from "../game/time";
import { createHostedOpaqueIdentifier } from "../hosted-onboarding/contact-privacy";
import type { Game } from "./engine";

type VaultRuns = { days: readonly { date: string; km: number }[] };
type GameFacts = { facts: readonly ProgressGame[]; awards: readonly StoredAward[]; states: ReadonlyMap<string, MeasureState> };
const limits = { games: 256, entries: 4096, awards: 2048, measures: 2048 };

function longestStreak(obligations: ReturnType<typeof obligationDays>, today: string) {
  if (!obligations) return null;
  let best: Game["bestStreak"] = null;
  let days = 0;
  let start = "";
  let end = "";
  for (const day of obligations) {
    if (day.date > today) break;
    if (!day.done && day.ended) {
      if (days && best?.end === end) best.missedOn = day.date;
      days = 0;
    } else if (day.done) {
      if (!days) start = day.date;
      days++;
      end = day.date;
      if (!best || days >= best.days) best = { days, start, end, missedOn: null };
    }
  }
  if (!best) return null;
  const monday = addDays(best.start, -weekdayOf(best.start));
  const sunday = addDays(best.end, 6 - weekdayOf(best.end));
  best.calendar = obligations
    .filter(day => day.date >= monday && day.date <= sunday && day.date <= today && (day.done || day.ended))
    .map(({ date, done }) => ({ date, state: done ? "posted" : "missed" }));
  return best;
}

function gameLandmarks(measure: MeasureSeries, total: number, state: MeasureState, awards: readonly StoredAward[], crossings: readonly Candidate[]) {
  if (measure.unit !== "reps") return { landmarksPassed: [], next: null };
  const passed = new Map<string, number>();
  for (const award of [...awards, ...crossings]) {
    if (award.measureId !== measure.id || award.kind !== "landmark") continue;
    // Both the stored award and the live evaluator use the Progress rung contract.
    const rung = award.data.rung as RungDefinition;
    const entry = rungEntry(rung);
    if (rung.at <= total) passed.set(entry.id, entry.at);
  }
  const next = measureLadder(measure, state, awards, "metric")?.next;
  return {
    landmarksPassed: [...passed].map(([id, height]) => ({ id, height })).sort((a, b) => a.height - b.height || a.id.localeCompare(b.id)),
    next: next ? { id: next.id, height: next.at * measure.ftPerRep, toGo: Math.ceil(next.at - total) } : null,
  };
}

function mergeRunDays(measures: MeasureSeries[], today: string, running: MeasureState | undefined, runs: VaultRuns | null) {
  if (!measures.some(measure => measure.id === RUN_MEASURE_ID && measure.amounts.length > 0)) return;
  const vaultDays = runs?.days.map(({ date, km }) => [date, Math.round(km * 1000)] as const) ?? running?.vaultRuns?.days ?? [];
  const from = running?.runsFrom ?? "";
  mergeVaultRuns(measures, vaultDays.filter(([date, meters]) => date <= today && date >= from && Number.isSafeInteger(meters) && meters > 0));
}

/** Builds cards from the same earned days, typed quantities, goal choices and frozen awards as Progress. */
export function gameWinInputs(memberId: string, today: string, { facts, states, awards }: GameFacts, runs: VaultRuns | null) {
  const measures = gameSeries(facts, memberId, states).filter(measure => !measure.pending && Object.hasOwn(EXERCISES, measure.name));
  for (const measure of measures) measure.amounts = measure.amounts.filter(day => day.date <= today);
  mergeRunDays(measures, today, states.get(RUN_MEASURE_ID), runs);

  const gameStreak = longestStreak(obligationDays(facts, memberId), today);
  const context = achievementContext(measures, states);
  const rounds = roundTotals(context);
  const crossings = ladderRungs(context);
  const gamesByExercise = new Map<string, { game: Game; latest: string; unit: string }>();
  // The card id belongs to the exercise. Use the most recently observed unit if the member switched units.
  for (const [index, measure] of measures.entries()) {
    const last = context.measures[index].points.at(-1);
    if (!last || last[1] <= 0) continue;
    const [latest, total] = last;
    const prior = gamesByExercise.get(measure.name);
    if (prior && (prior.latest > latest || (prior.latest === latest && prior.unit <= measure.unit))) continue;
    // Progress keeps route distance in meters. The engine's distance copy reads in miles, like its other distance cards.
    const meters = measure.unit === "meters";
    gamesByExercise.set(measure.name, { latest, unit: measure.unit, game: {
      exercise: measure.name, unit: meters ? "miles" : measure.unit, total: meters ? total / 1609.344 : total,
      ...gameLandmarks(measure, total, states.get(measure.id) ?? {}, awards, crossings),
      bestStreak: null,
    } });
  }

  const games = [...gamesByExercise.values()].map(({ game, latest }) => ({ ...game, latestDay: latest }))
    .sort((a, b) => a.exercise.localeCompare(b.exercise));
  // Only the opaque member-bound digest leaves the reader. Entry corrections, earned dates and saved choices affect it.
  const sourceRevision = createHostedOpaqueIdentifier("health-wins-games", JSON.stringify([memberId, games, gameStreak,
    context.measures.map(({ id, points, rungs }) => ({ id, points, rungs })).sort((a, b) => a.id.localeCompare(b.id)),
    rounds.map(({ key, on }) => [key, on]).sort(), awards.map(({ id, on }) => [id, on]).sort(),
  ]))!;
  return { games, gameStreak, sourceRevision, complete: true };
}

export async function readHealthWinGameInputs(auth: HostedNativeMemberAuth, today: string, runs: VaultRuns | null, clock = new Date(), signal?: AbortSignal) {
  const memberId = auth.member.id;
  const snapshot = await readGameSeriesFacts(memberId, clock, new ProgressReadTiming(), [RUN_MEASURE_ID], limits, signal);
  return gameWinInputs(memberId, today, snapshot, runs);
}
