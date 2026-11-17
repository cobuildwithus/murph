import "server-only";

import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import { getPrisma } from "../../prisma";
import { addDays } from "../time";
import { openProgressMany, progressLookup, sealProgressMany } from "./crypto";
import type { Candidate } from "./registry";
import type { BeforeProgressMutation } from "./state";

export interface StoredAward extends Candidate {
  id: string;
  createdAt: Date;
  seenAt: Date | null;
}

/** Append only. Re-reading or a corrected/shrinking total never changes an award. */
export async function settleAwards(memberId: string, candidates: readonly Candidate[], beforeMutationTx: BeforeProgressMutation): Promise<void> {
  if (candidates.length === 0) return;
  const db = getPrisma();
  const keyed = candidates.map(candidate => ({ candidate, lookup: progressLookup(memberId, "award", [candidate.key]) }));
  const existing = new Set((await db.gameProgressAward.findMany({
    where: { memberId, lookup: { in: keyed.map(row => row.lookup) } }, select: { lookup: true },
  })).map(row => row.lookup));
  const fresh = keyed.filter(row => !existing.has(row.lookup));
  if (fresh.length === 0) return;
  const profile = await db.gameProfile.findUniqueOrThrow({ where: { memberId }, select: { timeZone: true } });
  const now = new Date();
  const cutoff = addDays(formatTimeZoneDateTimeParts(now, profile.timeZone).dayKey, -7);
  const sealed = await sealProgressMany(memberId, fresh.map(({ candidate, lookup }) => ({
    table: "game_progress_award", rowId: lookup, field: "data", value: candidate,
  })));
  await db.$transaction(async tx => {
    await beforeMutationTx(tx);
    await tx.gameProgressAward.createMany({ skipDuplicates: true, data: fresh.map(({ candidate, lookup }, index) => ({
      memberId, lookup, subjectMemberId: candidate.subjectMemberId,
      earnedOn: new Date(`${candidate.on}T00:00:00.000Z`), createdAt: now,
      dataEncrypted: sealed[index], seenAt: candidate.on < cutoff ? now : null,
    })) });
  });
}

/** Newest first; after authority filtering, only the first visible award is gold. */
export async function readAwards(memberId: string): Promise<StoredAward[]> {
  const rows = await getPrisma().gameProgressAward.findMany({ where: { memberId },
    orderBy: [{ earnedOn: "desc" }, { createdAt: "desc" }, { lookup: "desc" }],
    select: { lookup: true, dataEncrypted: true, earnedOn: true, createdAt: true, seenAt: true },
  });
  const data = await openProgressMany<Candidate>(rows.map(row => ({ memberId, table: "game_progress_award", rowId: row.lookup, field: "data", value: row.dataEncrypted })));
  // Streak rows wait for scripts/migrations/remove-progress-streak-awards; until
  // it has run they are not awards. Delete this filter after it has.
  return rows.flatMap((row, index) => data[index].kind === "streak" ? []
    : [{ ...data[index], id: row.lookup, on: row.earnedOn.toISOString().slice(0, 10), createdAt: row.createdAt, seenAt: row.seenAt }]);
}

/** The view resolves requested moment ids to their stored award ids. */
export async function markAwardsSeen(memberId: string, awardIds: readonly string[], beforeMutationTx: BeforeProgressMutation): Promise<void> {
  await getPrisma().$transaction(async tx => {
    await beforeMutationTx(tx);
    await tx.gameProgressAward.updateMany({ where: { memberId, lookup: { in: [...awardIds] }, seenAt: null }, data: { seenAt: new Date() } });
  });
}
