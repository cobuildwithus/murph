import "server-only";

import { Prisma } from "@prisma/client";
import { GAME_MISSED_ROOM_MAX_GAMES, gameGroupMissedCheckInPolicySchema, type HostedGameGroupMissedCheckInPolicy } from "@murphai/hosted-execution/runtime-control";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { logHostedOnboardingWarning } from "../hosted-onboarding/logging";
import { getPrisma } from "../prisma";
import { readHostedMailboxWakeByDedupeKey } from "../hosted-mailbox/store";
import { isGameEnabled } from "./access";
import { gameGroupLoreFingerprint } from "./audience";
import { GameChatAudienceError, readGameChatAuthority, readGameChatAudience, type GameChatAudience } from "./chat-membership";
import { gameGroupMissedDayEventId, reserveGameMissedDayTx } from "./chat-lifecycle-receipt";
import { gameMissedCheckInHorizons, gameMissedCheckInRuns, isMissedCheckInDueNow } from "./missed-check-in";
import { currentTerms, remainingPlayers } from "./rules";
import { loadGameMissedCheckInGames } from "./service";

type Games = Awaited<ReturnType<typeof loadGameMissedCheckInGames>>;

/** Complete room candidates, independently of the ten-card chat projection. */
export async function readGroupMissedDayRoom(roomId: string, gameIds?: readonly string[], worthProving: (candidates: Games) => boolean = () => true) {
  const prisma = getPrisma();
  const ids = gameIds ?? (await prisma.game.findMany({ where: { chatContainerMemberId: roomId, status: "live" },
    select: { id: true }, take: GAME_MISSED_ROOM_MAX_GAMES + 1 })).map(row => row.id);
  if (ids.length > GAME_MISSED_ROOM_MAX_GAMES) return null;
  const candidates = await loadGameMissedCheckInGames(prisma, ids);
  if (!worthProving(candidates)) return null;
  const audience = await readGameChatAudience(roomId);
  const games: Games = [];
  for (const game of candidates.filter(game => game.row.maxPlayers === 10)) {
    if (game.row.status !== "live" || game.row.chatContainerMemberId !== roomId || !isGameEnabled()) continue;
    const allowed = await readGameChatAuthority(game.row, roomId, audience);
    if (!allowed) continue;
    games.push(game);
  }
  if (!audience || games.length === 0) return null;
  // Mixed rooms may include each eligible pair's facts, never its notebook.
  for (const game of candidates.filter(game => game.row.maxPlayers === 2)) {
    if (game.row.status === "live" && game.row.chatContainerMemberId === roomId && isGameEnabled()
      && await readGameChatAuthority(game.row, roomId, audience)) games.push(game);
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

const AMBIGUOUS_IDENTITY_CODES = ["HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS", "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS"];

/** A room proven unsendable gets no check-in and waits for its next shard. Outages, defects and unreadable responses still stop the sweep. */
function skipUnprovableRoom(error: unknown): null {
  const reason = error instanceof GameChatAudienceError ? error.reason
    : isHostedOnboardingError(error) && AMBIGUOUS_IDENTITY_CODES.includes(error.code) ? "identity_ambiguous" : null;
  if (!reason) throw error;
  logHostedOnboardingWarning("game.missed-day.room-skipped", { reason });
  return null;
}

/**
 * Gates the provider read and never decides a claim. A room's horizon is the latest of its games', so a room that would
 * claim always has a candidate due by its own horizon. Checked per game because a game the audience check excludes must
 * not move the room's horizon, and over every candidate's miss dates because the game setting it may have no miss itself.
 */
function hasDueCandidate(candidates: Games, now: Date): boolean {
  const dates = new Set(candidates.flatMap(game => gameMissedCheckInRuns(game.state, now).map(run => run.firstMissedDate)));
  return candidates.some(game => [...gameMissedCheckInHorizons([game.state], dates).values()].some(dueAt => isMissedCheckInDueNow({ dueAt, now })));
}

export async function reserveGroupGameMissedDay(roomId: string, gameIds: readonly string[], now: Date): Promise<number> {
  const room = await readGroupMissedDayRoom(roomId, gameIds, candidates => hasDueCandidate(candidates, now)).catch(skipUnprovableRoom);
  if (!room) return 0;
  let reserved = 0;
  const dates = new Set(room.games.flatMap(game => gameMissedCheckInRuns(game.state, now).map(run => run.firstMissedDate)));
  for (const [firstMissedDate, dueAt] of gameMissedCheckInHorizons(room.games.map(game => game.state), dates)) {
    if (!isMissedCheckInDueNow({ dueAt, now })) continue;
    const batch = freezeBatch(room.games, firstMissedDate, now);
    if (!batch.some(game => game.misses.length)) continue;
    const policy = gameGroupMissedCheckInPolicySchema.parse({ kind: "game_group_missed_check_in", roomId, firstMissedDate,
      eventId: gameGroupMissedDayEventId(roomId, firstMissedDate), batch, pairFingerprint: room.pairFingerprint, conversationLaneSeq: "0" });
    const added = await getPrisma().$transaction(tx => reserveGameMissedDayTx({ roomId, firstMissedDate, dueAt, now, tx,
      beforeClaim: tx => isGroupMissedDayBatchCurrentTx(policy, room.audience, tx, now),
    }));
    if (added) reserved += 1;
  }
  return reserved;
}

export async function prepareGroupMissedDay(roomId: string, firstMissedDate: string, now: Date) {
  const room = await readGroupMissedDayRoom(roomId);
  if (!room) return null;
  const batch = freezeBatch(room.games, firstMissedDate, now);
  if (!batch.some(game => game.misses.length)) return null;
  const policy = gameGroupMissedCheckInPolicySchema.parse({ kind: "game_group_missed_check_in", roomId, firstMissedDate,
    eventId: gameGroupMissedDayEventId(roomId, firstMissedDate), batch, pairFingerprint: room.pairFingerprint, conversationLaneSeq: "0" });
  return { ...room, policy };
}

/**
 * Locks remain held by the caller through publication or the provider dispatch claim.
 * Game facts decide currentness. Chat never does: what people said is the model's evidence, not a gate.
 */
export async function isGroupMissedDayBatchCurrentTx(policy: HostedGameGroupMissedCheckInPolicy, audience: GameChatAudience,
  tx: Prisma.TransactionClient, now: Date): Promise<boolean> {
  const ids = policy.batch.map(game => game.gameId).sort();
  await tx.$queryRaw`SELECT id FROM game WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const games = await loadGameMissedCheckInGames(tx, ids);
  if (games.length !== ids.length) return false;
  let groupCount = 0;
  for (const { row } of games) {
    if (row.status !== "live" || row.chatContainerMemberId !== policy.roomId || !isGameEnabled()) return false;
    if (row.maxPlayers === 10) {
      if (!row.audienceKey || gameGroupLoreFingerprint(row.audienceKey) !== policy.pairFingerprint) return false;
      groupCount += 1;
    }
    if (!await readGameChatAuthority(row, policy.roomId, audience, tx)) return false;
  }
  return groupCount > 0 && JSON.stringify(freezeBatch(games, policy.firstMissedDate, now))
    === JSON.stringify([...policy.batch].sort((a, b) => a.gameId.localeCompare(b.gameId)).map(game => ({ ...game,
      remainingMemberIds: [...game.remainingMemberIds].sort(), misses: [...game.misses].sort((a, b) => a.memberId.localeCompare(b.memberId)) })));
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
  const audience = await readGameChatAuthority(group.row, roomId);
  if (!audience || target != null && audience.threadId !== target) return null;
  return { audience, policy: parsed };
}
