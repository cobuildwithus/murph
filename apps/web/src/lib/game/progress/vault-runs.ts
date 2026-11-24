import "server-only";
import { assertBrowserVaultMemberAuthority } from "../../browser-vault/authority";
import { isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { getPrisma } from "../../prisma";
import type { Day } from "./contract";
import { describeMeasure, readGameSeries, type MeasureSeries } from "./series";
import { ProgressReadTiming } from "./read-timing";
import { routeAwardKey } from "./route-progress";
import { patchMeasureState, type BeforeProgressMutation, type MeasureState } from "./state";

/** Game run check-ins and vault runs share one Running measure. */
export const RUN_MEASURE_ID = "run.meters";

export async function hasHealthAuthority(memberId: string): Promise<boolean> {
  try {
    await assertBrowserVaultMemberAuthority({ memberId, prisma: getPrisma() });
    return true;
  } catch (error) {
    // A current authority denial removes health facts, without hiding game totals.
    if (isHostedOnboardingError(error) && [401, 403].includes(error.httpStatus)) return false;
    throw error;
  }
}

/**
 * Saves the replica's run days (meters) on the Running state, once per replica
 * version. An older replica without run days leaves the saved days alone.
 */
export async function saveVaultRuns(memberId: string, savedAt: string,
  runs: { days: readonly { date: string; km: number }[] } | null, beforeMutationTx: BeforeProgressMutation) {
  if (!runs) return;
  await patchMeasureState(memberId, RUN_MEASURE_ID, previous => {
    if (previous.vaultRuns ? Date.parse(previous.vaultRuns.savedAt) >= Date.parse(savedAt) : !runs.days.length) return previous;
    return { vaultRuns: { savedAt, days: runs.days.map(day => [day.date, Math.round(day.km * 1000)] as [Day, number]) } };
  }, beforeMutationTx);
}

/** The member's own Progress input: game series, with vault runs in Running while health consent holds. */
export async function readOwnSeries(memberId: string, clock: Date, timing = new ProgressReadTiming()) {
  const snapshot = await readGameSeries(memberId, clock, timing, [RUN_MEASURE_ID]);
  const running = snapshot.measures.find(measure => measure.id === RUN_MEASURE_ID);
  const gameRunning = running && { ...running };
  const state = snapshot.states.get(RUN_MEASURE_ID);
  const days = (state?.vaultRuns?.days ?? []).filter(([day]) => state?.runsFrom === undefined || day >= state.runsFrom);
  const vaultRunsMerged = days.length > 0 && await hasHealthAuthority(memberId) && mergeVaultRuns(snapshot.measures, days);
  return { ...snapshot, vaultRunsMerged, gameRunning };
}

export type OwnSeries = Awaited<ReturnType<typeof readOwnSeries>>;

/**
 * Runs count from the day the member joined, as Steps do, once Running's state
 * says so. That is set once, here, only where it can't move a saved route
 * start: Running with no route yet, or on a first route that hasn't finished.
 * A later route's start was taken from every run, so it keeps counting every
 * run. True when the mark was written and the series should be read again.
 */
export async function countRunsFromJoin(memberId: string, snapshot: OwnSeries, joinedOn: Day, beforeMutationTx: BeforeProgressMutation): Promise<boolean> {
  const judged = snapshot.states.get(RUN_MEASURE_ID);
  const running = snapshot.measures.find(measure => measure.id === RUN_MEASURE_ID);
  if (judged?.runsFrom !== undefined || (!judged && !running)) return false;
  // Imported runs without health access can't be judged: the next read tries again.
  if (judged?.vaultRuns?.days.length && !snapshot.vaultRunsMerged) return false;
  if (!firstRouteOnly(judged ?? {}, (running?.amounts ?? []).reduce((sum, day) => sum + day.amount, 0), snapshot.awards)) return false;
  let marked = false;
  try {
    await patchMeasureState(memberId, RUN_MEASURE_ID, previous => {
      // Judged on these legs: a route picked meanwhile is judged on a later read.
      if (previous.runsFrom !== undefined || JSON.stringify(previous.legs) !== JSON.stringify(judged?.legs)) return previous;
      marked = true;
      return { runsFrom: joinedOn };
    }, beforeMutationTx);
    return marked;
  } catch (error) {
    // Another read changed Running meanwhile: this one goes on unchanged.
    if (isHostedOnboardingError(error) && error.code === "GAME_PROGRESS_STATE_CONFLICT") return false;
    throw error;
  }
}

function firstRouteOnly(state: Readonly<MeasureState>, totalM: number, awards: OwnSeries["awards"]): boolean {
  const legs = state.legs ?? [];
  if (!legs.length) return true;
  const [leg] = legs;
  return legs.length === 1 && leg!.startTotal === 0 && leg!.startedOn === undefined && totalM < leg!.distanceM
    && !awards.some(award => award.key === routeAwardKey(RUN_MEASURE_ID, leg!, 0));
}

/** Each day's Running is the larger of its game check-ins and its vault runs, so one run never counts twice. */
export function mergeVaultRuns(measures: MeasureSeries[], days: readonly (readonly [Day, number])[]): boolean {
  if (!days.length) return false;
  let measure = measures.find(candidate => candidate.id === RUN_MEASURE_ID);
  if (!measure) {
    measure = { ...describeMeasure(RUN_MEASURE_ID, "run", "Run"), pending: false, gameOn: false, needsPerDay: false, amounts: [] };
    measures.push(measure);
  }
  const game = new Map<string, number>();
  for (const day of measure.amounts) game.set(day.date, (game.get(day.date) ?? 0) + day.amount);
  const vault = new Map(days);
  measure.amounts = [...new Set([...game.keys(), ...vault.keys()])].sort()
    .map(date => ({ measureId: RUN_MEASURE_ID, date, amount: Math.max(game.get(date) ?? 0, vault.get(date) ?? 0) }));
  return true;
}
