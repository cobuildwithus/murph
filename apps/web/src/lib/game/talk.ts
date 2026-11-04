import "server-only";

import type { Prisma } from "@prisma/client";
import { isRecord } from "../primitives";
import { isPairRoster } from "./roster";

export function parseGameTalkPayload(value: unknown): { proposalId: string; noteEncrypted: string } | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.proposalId !== "string"
    || !/^[A-Za-z0-9_-]{8,64}$/u.test(value.proposalId) || typeof value.noteEncrypted !== "string" || !value.noteEncrypted) return null;
  return { proposalId: value.proposalId, noteEncrypted: value.noteEncrypted };
}

export function currentGameTalkRequest(game: {
  id: string; maxPlayers: number; status: string; inviteExpiresAt: Date | null;
  players: readonly { memberId: string | null; leftAt: Date | null }[];
  events: readonly { actor: string; commandKey: string | null; payload: unknown }[];
}, now: Date) {
  const event = game.events[0];
  const payload = parseGameTalkPayload(event?.payload);
  if (game.maxPlayers !== 2 || game.status !== "negotiating" || game.inviteExpiresAt && game.inviteExpiresAt <= now
    || !isPairRoster(game.players) || game.players.some(player => !player.memberId || player.leftAt)
    || !event || !payload || event.commandKey !== `game-change:${game.id}:${payload.proposalId}`
    || !game.players.some(player => player.memberId === event.actor)) return null;
  return { actor: event.actor, ...payload };
}

/** Check current authority before opening an author's private envelope. */
export async function readCurrentGameTalk(db: Pick<Prisma.TransactionClient, "game">, gameId: string, proposalId: string | undefined, now: Date) {
  const game = await db.game.findFirst({
    where: { id: gameId, maxPlayers: 2, status: "negotiating",
      OR: [{ inviteExpiresAt: null }, { inviteExpiresAt: { gt: now } }],
      players: { none: { OR: [{ memberId: null }, { leftAt: { not: null } }] } } },
    include: { invitees: true, players: { orderBy: { seat: "asc" }, take: 3 },
      events: { where: { type: "talk_requested" }, take: 1, select: { actor: true, commandKey: true, payload: true } } },
  });
  const request = game && currentGameTalkRequest(game, now);
  return game && request && (proposalId === undefined || request.proposalId === proposalId) ? { game, ...request } : null;
}
