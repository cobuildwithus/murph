import "server-only";

import type { Game, Prisma } from "@prisma/client";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { isRecord } from "../primitives";
import { gameChatLifecycleEventId } from "./chat-lifecycle-receipt";
import { groupGameRecapPlayers } from "./recap-cohort";

type RecapGame = Pick<Game, "id" | "maxPlayers" | "settledAt"> & {
  players: readonly { memberId: string | null; leftAt: Date | null }[];
};
const witnessKey = (eventId: string) => `${eventId}:witness`;

/** What a recap may use now. A group shares one story, so any report silences it; a pair loses only the reported posts. */
export async function readPermittedGameRecapEntryIds(db: Prisma.TransactionClient, game: RecapGame): Promise<Set<string> | null> {
  const players = game.maxPlayers === 10 ? groupGameRecapPlayers(game) : null;
  if (game.maxPlayers === 10 && !players) return null;
  const reports = await db.gameReport.findMany({ where: { gameId: game.id, ...(players ? {} : { entryId: { not: null } }) }, select: { entryId: true } });
  if (players && reports.length) return null;
  const entries = await db.gameEntry.findMany({ where: {
    gameId: game.id, attempt: { gt: 0 }, withdrawnAt: null,
    id: { notIn: reports.flatMap(report => report.entryId ? [report.entryId] : []) },
    ...(players ? { memberId: { in: players.map(player => player.memberId) } } : {}),
  }, select: { id: true } });
  return new Set(entries.map(entry => entry.id));
}

/** Publication only, under the game lock and inside the mailbox append. Fixes what this generation may see; the first writer wins. */
export async function recordGameRecapWitnessTx(tx: Prisma.TransactionClient, gameId: string, eventId: string): Promise<boolean> {
  const game = await tx.game.findUniqueOrThrow({ where: { id: gameId }, select: {
    id: true, maxPlayers: true, settledAt: true, players: { select: { memberId: true, leftAt: true }, take: 11 },
  } });
  const entryIds = await readPermittedGameRecapEntryIds(tx, game);
  if (!entryIds) return false;
  await tx.gameEvent.createMany({ skipDuplicates: true, data: {
    gameId, actor: "system", type: "recap_witness", commandKey: witnessKey(eventId), payload: { v: 1, entryIds: [...entryIds] },
  } });
  return true;
}

function witnessEntryIds(payload: Prisma.JsonValue): Set<string> | null {
  if (!isRecord(payload) || payload.v !== 1 || !Array.isArray(payload.entryIds)
    || !payload.entryIds.every((id): id is string => typeof id === "string")) return null;
  return new Set(payload.entryIds);
}

/** The one validity check for material read, seal, replay and dispatch. The caller holds the game row lock. Null means this generation may not proceed. */
export async function readGameRecapEntryIdsTx(tx: Prisma.TransactionClient, game: RecapGame, eventId: string): Promise<Set<string> | null> {
  const witness = await tx.gameEvent.findUnique({ where: { commandKey: witnessKey(eventId) }, select: { payload: true } });
  const permitted = await readPermittedGameRecapEntryIds(tx, game);
  if (!permitted) return null;
  if (witness) {
    const entryIds = witnessEntryIds(witness.payload);
    return entryIds && [...entryIds].every(id => permitted.has(id)) ? entryIds : null;
  }
  // Only when nothing was ever hidden can every entry a legacy generation saw still be permitted.
  const hidden = await tx.gameEntry.findFirst({ where: { gameId: game.id, OR: [{ withdrawnReason: "removed" }, { reports: { some: {} } }] }, select: { id: true } });
  return hidden ? null : permitted;
}

export const GAME_RECAP_RETIRED = "game_recap_retired";

/** Only published, unclaimed work. Claimed provider work keeps its uncertainty; unpublished work exposed nothing and gets a clean witness. */
async function retireGameRecapGenerationTx(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  if (!idempotencyKey) return;
  await tx.hostedLinqDelivery.updateMany({ where: { idempotencyKey, source: "game_lifecycle", template: "game_recap", status: "generation_queued" },
    data: { status: "skipped", skippedAt: new Date(), skipReason: GAME_RECAP_RETIRED, retryAfterAt: null } });
}

/** The check, and retirement when it fails. The caller holds the game row lock. */
export async function settleGameRecapGenerationTx(tx: Prisma.TransactionClient, game: RecapGame, eventId: string): Promise<Set<string> | null> {
  const entries = await readGameRecapEntryIdsTx(tx, game, eventId);
  if (!entries) await retireGameRecapGenerationTx(tx, eventId);
  return entries;
}

/** Exact reason only: a generation skipped for another reason keeps today's behaviour. */
export async function isGameRecapGenerationRetired(db: Prisma.TransactionClient, eventId: string, roomId: string): Promise<boolean> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  return Boolean(idempotencyKey && await db.hostedLinqDelivery.count({ where: {
    idempotencyKey, source: "game_lifecycle", template: "game_recap", status: "skipped", skipReason: GAME_RECAP_RETIRED, payloadOwnerMemberId: roomId,
  } }));
}

export async function readLatestGameRecapEventIdTx(tx: Prisma.TransactionClient, gameId: string): Promise<string> {
  const latest = await tx.gameEvent.findFirst({ where: { gameId, type: "recap_regeneration_requested" },
    orderBy: { id: "desc" }, select: { commandKey: true } });
  return latest?.commandKey ?? gameChatLifecycleEventId(gameId, "recap");
}

/** The generation that wrote each game's stored story, and what it was allowed to use. Null means it has no witness. */
export async function readGameRecapStoryWitnesses(db: Prisma.TransactionClient, gameIds: readonly string[]): Promise<Map<string, readonly string[] | null>> {
  const accepted = await db.gameEvent.findMany({ where: { gameId: { in: [...gameIds] }, type: "recap_regeneration_accepted" },
    orderBy: { id: "desc" }, distinct: ["gameId"], select: { gameId: true, commandKey: true } });
  const generations = new Map(gameIds.map(gameId => [gameId, gameChatLifecycleEventId(gameId, "recap")]));
  for (const event of accepted) if (event.commandKey) generations.set(event.gameId, event.commandKey.slice(0, -":accepted".length));
  const witnesses = await db.gameEvent.findMany({ where: { commandKey: { in: [...generations.values()].map(witnessKey) } }, select: { commandKey: true, payload: true } });
  const byKey = new Map(witnesses.map(witness => {
    const ids = witnessEntryIds(witness.payload);
    return [witness.commandKey, ids ? [...ids] : null];
  }));
  return new Map([...generations].map(([gameId, eventId]) => [gameId, byKey.get(witnessKey(eventId)) ?? null]));
}

export function gameRecapStoryMayQuoteEntry(witness: readonly string[] | null, entryId: string): boolean {
  return witness === null || witness.includes(entryId);
}

/** Takedown, in its own game-locked transaction. */
export async function clearGameRecapQuotingEntryTx(tx: Prisma.TransactionClient, gameId: string, entryId: string): Promise<void> {
  const witnesses = await readGameRecapStoryWitnesses(tx, [gameId]);
  if (gameRecapStoryMayQuoteEntry(witnesses.get(gameId) ?? null, entryId)) await tx.game.update({ where: { id: gameId }, data: { recapEncrypted: null } });
}
