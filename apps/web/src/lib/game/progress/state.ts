import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "../../prisma";
import { hostedOnboardingError } from "../../hosted-onboarding/errors";
import type { Day } from "./contract";
import type { FoundEntry } from "./bank";
import { openProgress, progressLookup, sealProgress } from "./crypto";

export type BeforeProgressMutation = (tx: Prisma.TransactionClient) => Promise<void>;
export interface RouteLeg {
  from: string;
  to: string;
  distanceM: number;
  polyline: string;
  towns: { name: string; atM: number }[];
  straightLine: boolean;
  startTotal: number;
}
export interface MeasureState {
  goal?: { rungId: string } | { route: { from: string; to: string } } | { found: FoundEntry };
  found?: FoundEntry;
  legs?: RouteLeg[];
  perDay?: number;
  baseline?: { value: number; from: Day; to: Day };
}

/** One state writer. Patch fields replace whole fields; unrelated lanes survive. */
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
  const state = { ...previous, ...(typeof patch === "function" ? patch(previous) : patch) };
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
