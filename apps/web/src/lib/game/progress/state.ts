import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "../../prisma";
import { hostedOnboardingError } from "../../hosted-onboarding/errors";
import type { Day } from "./contract";
import type { FoundEntry } from "./bank";
import { openProgress, progressLookup, sealProgress } from "./crypto";

export type BeforeProgressMutation = (tx: Prisma.TransactionClient) => Promise<void>;
export interface RouteLeg {
  name?: string;
  from: string;
  to: string;
  distanceM: number;
  polyline: string;
  /** place: the town's public Mapbox place (id, "Del Mar, California, United States"); null when there is none, absent on legs from before posters. */
  towns: { name: string; atM: number; place?: { id: string; label: string } | null }[];
  straightLine: boolean;
  startTotal: number;
  /** The member's day it started; absent on legs from before start days and on first legs (they start on their first counted day). */
  startedOn?: Day;
}
export interface MeasureState {
  goal?: { rungId: string } | { route: { from: string; to: string } } | { found: FoundEntry };
  found?: FoundEntry;
  legs?: RouteLeg[];
  perDay?: number;
  baseline?: { value: number; from: Day; to: Day; source?: string };
  healthSettlement?: { savedAt: string; checkedAt: string; timeZone: string; profileTimeZone: string };
  /** Running only: the vault's run meters per day, from the replica saved at savedAt. */
  vaultRuns?: { savedAt: string; days: [Day, number][] };
}

/** One state writer. Fields replace whole fields; an eligible baseline freezes once. */
export async function patchMeasureState(
  memberId: string,
  measureId: string,
  patch: Partial<MeasureState> | ((previous: Readonly<MeasureState>) => Partial<MeasureState>),
  beforeMutationTx: BeforeProgressMutation,
): Promise<MeasureState> {
  const db = getPrisma();
  const lookup = progressLookup(memberId, "measure", [measureId]);
  const target = { memberId, table: "game_progress_measure", rowId: lookup, field: "state" } as const;
  const row = await db.gameProgressMeasure.findUnique({ where: { memberId_lookup: { memberId, lookup } }, select: { stateEncrypted: true } });
  const previous = row ? await openProgress<MeasureState>(target, row.stateEncrypted) : {};
  const changes = typeof patch === "function" ? patch(previous) : patch;
  // A versioned writer can keep the observed state without rewriting its ciphertext.
  if (changes === previous) {
    await beforeMutationTx(db);
    return previous;
  }
  const state = { ...previous, ...changes, ...(previous.baseline ? { baseline: previous.baseline } : {}) };
  const stateEncrypted = await sealProgress(target, state);
  await db.$transaction(async tx => {
    await beforeMutationTx(tx);
    const result = row
      ? await tx.gameProgressMeasure.updateMany({ where: { memberId, lookup, stateEncrypted: row.stateEncrypted }, data: { stateEncrypted } })
      : await tx.gameProgressMeasure.createMany({ data: [{ memberId, lookup, stateEncrypted }], skipDuplicates: true });
    if (result.count !== 1) throw hostedOnboardingError({ code: "GAME_PROGRESS_STATE_CONFLICT", httpStatus: 503,
      message: "Progress changed while saving. Try again.", retryable: true });
  });
  return state;
}
