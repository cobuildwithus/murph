import "server-only";
import { assertBrowserVaultMemberAuthority } from "../../browser-vault/authority";
import { isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { getPrisma } from "../../prisma";
import type { Day } from "./contract";
import { openProgress, progressLookup } from "./crypto";
import type { Candidate } from "./registry";
import { describeMeasure, readGameSeries, type MeasureSeries } from "./series";
import { ProgressReadTiming } from "./read-timing";
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
  const lookup = progressLookup(memberId, "measure", [RUN_MEASURE_ID]);
  const row = await getPrisma().gameProgressMeasure.findUnique({ where: { memberId_lookup: { memberId, lookup } }, select: { stateEncrypted: true } });
  const previous = row ? await openProgress<MeasureState>({ memberId, table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted) : {};
  if (previous.vaultRuns?.savedAt === savedAt || (!runs.days.length && !previous.vaultRuns)) return;
  await patchMeasureState(memberId, RUN_MEASURE_ID, { vaultRuns: { savedAt,
    days: runs.days.map(day => [day.date, Math.round(day.km * 1000)] as [Day, number]) } }, beforeMutationTx);
}

/** The member's own Progress input: game series, with vault runs in Running while health consent holds. */
export async function readOwnSeries(memberId: string, clock: Date, timing = new ProgressReadTiming()) {
  const snapshot = await readGameSeries(memberId, clock, timing, [RUN_MEASURE_ID]);
  const days = snapshot.states.get(RUN_MEASURE_ID)?.vaultRuns?.days ?? [];
  const vaultRunsMerged = days.length > 0 && await hasHealthAuthority(memberId) && mergeVaultRuns(snapshot.measures, days);
  return { ...snapshot, vaultRunsMerged };
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

/** A Running award earned while vault runs counted is a health fact: it follows health consent. */
export function markVaultRunAwards(candidates: Candidate[], merged: boolean): Candidate[] {
  return merged ? candidates.map(candidate => candidate.measureId === RUN_MEASURE_ID
    ? { ...candidate, data: { ...candidate.data, health: true } } : candidate) : candidates;
}
