import "server-only";

import { Prisma } from "@prisma/client";
import { GAME_MISSED_ROOM_MAX_GAMES, gameGroupMissedCheckInPolicySchema, type HostedGameGroupMissedCheckInPolicy } from "@murphai/hosted-execution/runtime-control";
import { getPrisma } from "../prisma";
import { acquireHostedMailboxCausalAppendLockTx, readHostedMailboxMaxSeqByLane, readHostedMailboxWakeByDedupeKey } from "../hosted-mailbox/store";
import { isGameOn } from "./access";
import { gameGroupLoreFingerprint } from "./audience";
import { readGroupGameChatAuthority, sameGamePlayers, type GameChatAudience } from "./chat-membership";
import { gameGroupMissedDayEventId, reserveGameMissedDayTx } from "./chat-lifecycle-receipt";
import { gameMissedCheckInHorizons, gameMissedCheckInRuns, isMissedCheckInDueNow } from "./missed-check-in";
import { currentTerms, remainingPlayers } from "./rules";
import { loadGameMissedCheckInGames } from "./service";

type Games = Awaited<ReturnType<typeof loadGameMissedCheckInGames>>;

/** Complete room candidates, independently of the ten-card chat projection. */
export async function readGroupMissedDayRoom(roomId: string, gameIds?: readonly string[]) {
  const prisma = getPrisma();
  const ids = gameIds ?? (await prisma.game.findMany({ where: { chatContainerMemberId: roomId, status: "live" },
    select: { id: true }, take: GAME_MISSED_ROOM_MAX_GAMES + 1 })).map(row => row.id);
  if (ids.length > GAME_MISSED_ROOM_MAX_GAMES) return null;
  const candidates = await loadGameMissedCheckInGames(prisma, ids);
  let audience: GameChatAudience | undefined;
  const games: Games = [];
  for (const game of candidates.filter(game => game.row.maxPlayers === 10)) {
    if (game.row.status !== "live" || game.row.chatContainerMemberId !== roomId || !isGameOn(game.row)) continue;
    const allowed = await readGroupGameChatAuthority(game.row, roomId, audience);
    if (!allowed) continue;
    audience = allowed;
    games.push(game);
  }
  if (!audience || games.length === 0) return null;
  // A mixed two-contact room may include pair facts, never the pair's notebook.
  for (const game of candidates.filter(game => game.row.maxPlayers === 2)) {
    if (game.row.status === "live" && game.row.chatContainerMemberId === roomId && isGameOn(game.row)
      && audience.contacts.length === 2 && sameGamePlayers(game.row.players.map(player => player.memberId), audience.memberIds)
      && game.row.players.every(player => !player.leftAt)) games.push(game);
  }
  const fingerprints = new Set(games.filter(game => game.row.maxPlayers === 10).map(game => gameGroupLoreFingerprint(game.row.audienceKey!)));
  if (fingerprints.size !== 1) return null;
  return { games, audience, pairFingerprint: [...fingerprints][0]! };
}

function freezeBatch(games: Games, firstMissedDate: string, now: Date): HostedGameGroupMissedCheckInPolicy["batch"] {
  return games.map(({ row, state }) => ({ gameId: row.id, termsVersion: currentTerms(state.game.terms).n,
    remainingMemberIds: remainingPlayers(state).map(player => player.memberId).sort(),
    misses: gameMissedCheckInRuns(state, now).filter(run => run.firstMissedDate === firstMissedDate)
      .map(run => ({ memberId: run.memberId, missedDates: run.missedDates })).sort((a, b) => a.memberId.localeCompare(b.memberId)),
  })).sort((a, b) => a.gameId.localeCompare(b.gameId));
}

export async function reserveGroupGameMissedDay(roomId: string, gameIds: readonly string[], now: Date): Promise<number> {
  const room = await readGroupMissedDayRoom(roomId, gameIds);
  if (!room) return 0;
  let reserved = 0;
  const dates = new Set(room.games.flatMap(game => gameMissedCheckInRuns(game.state, now).map(run => run.firstMissedDate)));
  for (const [firstMissedDate, dueAt] of gameMissedCheckInHorizons(room.games.map(game => game.state), dates)) {
    if (!isMissedCheckInDueNow({ dueAt, now })) continue;
    const batch = freezeBatch(room.games, firstMissedDate, now);
    if (!batch.some(game => game.misses.length)) continue;
    const policy = gameGroupMissedCheckInPolicySchema.parse({ kind: "game_group_missed_check_in", roomId, firstMissedDate,
      eventId: gameGroupMissedDayEventId(roomId, firstMissedDate), batch, pairFingerprint: room.pairFingerprint, conversationLaneSeq: "0" });
    const added = await getPrisma().$transaction(tx => reserveGameMissedDayTx({ roomId, firstMissedDate, dueAt, tx,
      pairMemberIds: room.audience.contacts.length === 2 ? room.audience.memberIds : [],
      beforeClaim: tx => isGroupMissedDayBatchCurrentTx(policy, room.audience, tx, now, false),
    }));
    if (added) reserved += 1;
  }
  return reserved;
}

/** Freeze the transcript at the mailbox's conversation boundary, before decryption. */
export async function prepareGroupMissedDay(roomId: string, firstMissedDate: string, now: Date) {
  const room = await readGroupMissedDayRoom(roomId);
  if (!room) return null;
  const batch = freezeBatch(room.games, firstMissedDate, now);
  if (!batch.some(game => game.misses.length)) return null;
  const [watermark] = await readHostedMailboxMaxSeqByLane({ userId: roomId, lanes: ["conversation"] });
  const policy = gameGroupMissedCheckInPolicySchema.parse({ kind: "game_group_missed_check_in", roomId, firstMissedDate,
    eventId: gameGroupMissedDayEventId(roomId, firstMissedDate), batch, pairFingerprint: room.pairFingerprint, conversationLaneSeq: watermark.maxSeq });
  return { ...room, policy };
}

/** Locks remain held by the caller through publication or the provider dispatch claim. */
export async function isGroupMissedDayBatchCurrentTx(policy: HostedGameGroupMissedCheckInPolicy, audience: GameChatAudience,
  tx: Prisma.TransactionClient, now: Date, checkConversation = true): Promise<boolean> {
  const ids = policy.batch.map(game => game.gameId).sort();
  await tx.$queryRaw`SELECT id FROM game WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const games = await loadGameMissedCheckInGames(tx, ids);
  if (games.length !== ids.length) return false;
  let groupCount = 0;
  for (const { row } of games) {
    if (row.status !== "live" || row.chatContainerMemberId !== policy.roomId || !isGameOn(row)) return false;
    if (row.maxPlayers === 10) {
      if (!row.audienceKey || gameGroupLoreFingerprint(row.audienceKey) !== policy.pairFingerprint
        || !await readGroupGameChatAuthority(row, policy.roomId, audience, tx)) return false;
      groupCount += 1;
    } else if (audience.contacts.length !== 2 || !sameGamePlayers(row.players.map(player => player.memberId), audience.memberIds)
      || row.players.some(player => player.leftAt)) return false;
  }
  if (groupCount === 0 || JSON.stringify(freezeBatch(games, policy.firstMissedDate, now))
    !== JSON.stringify([...policy.batch].sort((a, b) => a.gameId.localeCompare(b.gameId)).map(game => ({ ...game,
      remainingMemberIds: [...game.remainingMemberIds].sort(), misses: [...game.misses].sort((a, b) => a.memberId.localeCompare(b.memberId)) })))) return false;
  if (!checkConversation) return true;
  // Inbound appends use this same lock. Notification-lane writes do not change the watermark.
  await acquireHostedMailboxCausalAppendLockTx({ tx, userId: policy.roomId });
  const [watermark] = await readHostedMailboxMaxSeqByLane({ prisma: tx, userId: policy.roomId, lanes: ["conversation"] });
  return watermark.maxSeq === policy.conversationLaneSeq;
}

/** Egress trusts only the exact encrypted mailbox envelope, never caller-supplied batch facts. */
export async function readGroupMissedDayDeliveryAuthority(eventId: string, roomId: string, target?: string | null) {
  const wake = await readHostedMailboxWakeByDedupeKey({ dedupeKey: eventId, userId: roomId });
  if (wake?.kind !== "assistant.notification.requested") return null;
  const policy = wake.notification.responsePolicy;
  if (!policy || policy.kind !== "game_group_missed_check_in" || policy.eventId !== eventId || policy.roomId !== roomId
    || wake.eventId !== eventId || wake.userId !== roomId) return null;
  const parsed = gameGroupMissedCheckInPolicySchema.parse(policy);
  const games = await loadGameMissedCheckInGames(getPrisma(), parsed.batch.map(game => game.gameId));
  const group = games.find(game => game.row.maxPlayers === 10);
  if (!group || group.row.chatContainerMemberId !== roomId) return null;
  const audience = await readGroupGameChatAuthority(group.row, roomId);
  if (!audience || target != null && audience.threadId !== target) return null;
  return { audience, policy: parsed };
}
