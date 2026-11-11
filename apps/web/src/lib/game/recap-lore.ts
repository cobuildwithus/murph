import { readGameRecapStory } from "@murphai/contracts/recap-show";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../prisma";
import { openGameTexts } from "./crypto";

type Pair = { containerMemberId: string; playerMemberIds: readonly string[] };
function pairWhere(input: Pair): Prisma.GameWhereInput {
  return { maxPlayers: 2, chatContainerMemberId: input.containerMemberId,
    AND: input.playerMemberIds.map(memberId => ({ players: { some: { memberId, leftAt: null } } })),
    players: { every: { memberId: { in: [...input.playerMemberIds] }, leftAt: null } } };
}
/** Pointer receipts only. Accepted words remain in the canonical encrypted recap. */
export async function readPendingRecapUsages(input: Pair) {
  const pending = await getPrisma().gameEvent.findMany({ where: { type: "recap_lore_pending", game: { ...pairWhere(input), recapEncrypted: { not: null } } },
    orderBy: { id: "asc" }, take: 21, select: { commandKey: true, game: { select: { id: true, wordsOwnerMemberId: true, recapEncrypted: true } } } });
  if (pending.length > 20) throw new Error("Recap lore repair exceeds its bounded batch.");
  const plain = await openGameTexts(pending.map(({ game }) => ({ memberId: game.wordsOwnerMemberId, table: "game" as const, rowId: game.id, field: "recap", value: game.recapEncrypted })));
  return pending.flatMap((item, i) => {
    const story = readGameRecapStory(JSON.parse(plain[i] ?? "null"));
    return story.treatment && item.commandKey?.endsWith(":lore") ? [{ generationId: item.commandKey.slice(0, -5), treatment: story.treatment, chatLine: story.chatLine }] : [];
  });
}
/** Called under the existing pair/game locks before accepting a new show. */
export async function canAcceptRecapUsageTx(tx: Prisma.TransactionClient, input: Pair): Promise<boolean> {
  return await tx.gameEvent.count({ where: { type: "recap_lore_pending", game: { ...pairWhere(input), recapEncrypted: { not: null } } } }) === 0;
}
export async function reserveRecapUsageTx(tx: Prisma.TransactionClient, gameId: string, generationId: string): Promise<void> {
  await tx.gameEvent.createMany({ skipDuplicates: true, data: [{ gameId, actor: "system", type: "recap_lore_pending", commandKey: `${generationId}:lore`, payload: {} }] });
}
