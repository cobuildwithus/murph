import "server-only";

import type { Game, GameInvitee, GamePlayer, Prisma } from "@prisma/client";
import { isRecord } from "../primitives";
import { isPairRoster } from "./roster";
import { addressedGameInvite, readGameVerifiedContacts, verifiedGameContactKeys } from "./audience";
import { currentTerms, isGameDue, type RuleState } from "./rules";
import { readGroupGameNoticeAuthority, type GameChatAudience } from "./chat-membership";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";

export type GameNoticeAudience = GameChatAudience & { talkAuthor?: { memberId: string; contacts: Awaited<ReturnType<typeof readGameVerifiedContacts>> } };

/** Private contact preparation stays outside the game/route transaction. */
export async function prepareGameTalkAudience(db: Prisma.TransactionClient, gameId: string, proposalId: string, audience: GameChatAudience): Promise<GameNoticeAudience> {
  const event = await db.gameEvent.findUnique({ where: { commandKey: `game-change:${gameId}:${proposalId}` }, select: { actor: true, type: true } });
  return event?.type === "talk_requested" ? { ...audience, talkAuthor: { memberId: event.actor, contacts: await readGameVerifiedContacts(event.actor) } } : audience;
}

type TalkPayload = { v: 1; proposalId: string; noteEncrypted: string }
  | { v: 2; proposalId: string; invitationSeat: number; termsVersion: number; noteEncrypted: string | null };
type TalkEvent = { type: string; actor: string; commandKey: string | null; payload: unknown };
type TalkGame = Game & { invitees: GameInvitee[]; players: GamePlayer[] };

/** Acceptance metadata survives content redaction, so deletion cannot refund the seat quota. */
export function parseGameTalkPayload(value: unknown): TalkPayload | null {
  if (!isRecord(value) || typeof value.proposalId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/u.test(value.proposalId)) return null;
  if (value.v === 1 && typeof value.noteEncrypted === "string" && value.noteEncrypted) return { v: 1, proposalId: value.proposalId, noteEncrypted: value.noteEncrypted };
  if (value.v !== 2 || !Number.isInteger(value.invitationSeat) || Number(value.invitationSeat) < 0 || Number(value.invitationSeat) > 9
    || !Number.isInteger(value.termsVersion) || Number(value.termsVersion) < 1
    || !(value.noteEncrypted === null || typeof value.noteEncrypted === "string" && value.noteEncrypted)) return null;
  return { v: 2, proposalId: value.proposalId, invitationSeat: Number(value.invitationSeat), termsVersion: Number(value.termsVersion), noteEncrypted: value.noteEncrypted };
}

export function currentGameTalkRequest(game: {
  id: string; maxPlayers: number; status: string; inviteExpiresAt: Date | null;
  players: readonly { memberId: string | null; leftAt: Date | null }[];
  events: readonly TalkEvent[];
}, now: Date, proposalId?: string) {
  const event = game.events.find(event => event.type === "talk_requested"
    && (proposalId === undefined || event.commandKey === `game-change:${game.id}:${proposalId}`));
  const payload = parseGameTalkPayload(event?.payload);
  if (!event || !payload || !payload.noteEncrypted || event.commandKey !== `game-change:${game.id}:${payload.proposalId}`) return null;
  if (game.maxPlayers === 10) {
    if (payload.v !== 2 || !["invited", "live"].includes(game.status) || game.players.some(player => player.memberId === event.actor)) return null;
  } else if (payload.v !== 1 || game.status !== "negotiating" || game.inviteExpiresAt && game.inviteExpiresAt <= now
    || !isPairRoster(game.players) || game.players.some(player => !player.memberId || player.leftAt)
    || !game.players.some(player => player.memberId === event.actor)) return null;
  return { actor: event.actor, ...payload, noteEncrypted: payload.noteEncrypted };
}

/** Talk never uses join's bearer-seat fallback or mutates invitation ownership. */
export async function readGroupTalkInvitation(db: Prisma.TransactionClient, game: TalkGame, state: RuleState,
  actor: string, keys: readonly string[], now: Date) {
  if (game.maxPlayers !== 10 || !game.chatContainerMemberId || !["invited", "live"].includes(game.status)
    || isGameDue(state, now) || game.players.some(player => player.memberId === actor)) return null;
  const invitation = addressedGameInvite(game.invitees, actor, keys);
  if (!invitation || game.players.some(player => player.seat === invitation.seat)) return null;
  const profile = await db.gameProfile.findFirst({ where: { memberId: actor, member: { suspendedAt: null } }, select: { memberId: true } });
  return profile ? invitation : null;
}

/** Check the exact event and current authority before opening the author's envelope. */
export async function readCurrentGameTalk(db: Prisma.TransactionClient, gameId: string, proposalId: string | undefined, now: Date, prepared?: GameNoticeAudience) {
  const game = await db.game.findUnique({ where: { id: gameId },
    include: { invitees: true, players: { orderBy: { seat: "asc" }, take: 11 },
      events: { where: proposalId ? { commandKey: `game-change:${gameId}:${proposalId}` } : { type: "talk_requested" },
        take: proposalId ? 1 : 2, select: { type: true, actor: true, commandKey: true, payload: true } } },
  });
  // Only legacy pairs may recover a game-only receipt; their sole request is unambiguous.
  if (!game || !proposalId && (game.maxPlayers === 10 || game.events.length !== 1)) return null;
  const request = currentGameTalkRequest(game, now, proposalId);
  if (!request) return null;
  if (game.maxPlayers === 10) {
    if (request.v !== 2 || !game.chatContainerMemberId) return null;
    const audience = await readGroupGameNoticeAuthority(game, game.chatContainerMemberId, prepared, db);
    if (!audience || !audience.memberIds.includes(request.actor)) return null;
    const contacts = await talkAuthorContacts(request.actor, prepared);
    const keys = await verifiedGameContactKeys(db, request.actor, contacts);
    if (!(await verifiedGameContactKeys(db, request.actor, audience.contacts)).length) return null;
    const { toRuleState } = await import("./service");
    const entries = await db.gameEntry.findMany({ where: { gameId, dayIndex: game.lengthDays - 1 } });
    const state = toRuleState(game, entries);
    const clock = new Date(now.getTime() + Number(game.devClockOffsetMs ?? 0));
    const invitation = await readGroupTalkInvitation(db, game, state, request.actor, keys, clock);
    if (!invitation || invitation.seat !== request.invitationSeat || currentTerms(state.game.terms).n !== request.termsVersion) return null;
  }
  return { game, ...request };
}

function talkAuthorContacts(actor: string, prepared?: GameNoticeAudience) {
  if (!prepared) return readGameVerifiedContacts(actor);
  return prepared.talkAuthor?.memberId === actor ? prepared.talkAuthor.contacts : [];
}

/** Resolve receipt identity once. A known template with a different key is never accepted. */
export async function readGameTalkReceiptIdentity(db: Prisma.TransactionClient, receipt: { sourceRef: string | null; idempotencyKey: string | null }) {
  const match = /^([^:]+)(?::([A-Za-z0-9_-]{8,64}))?$/u.exec(receipt.sourceRef ?? "");
  if (!match) return null;
  const gameId = match[1];
  let proposalId = match[2];
  if (!proposalId) {
    const legacy = await db.gameEvent.findMany({ where: { gameId, type: "talk_requested", game: { maxPlayers: 2 } },
      select: { payload: true, commandKey: true }, take: 2 });
    const payload = legacy.length === 1 ? parseGameTalkPayload(legacy[0].payload) : null;
    if (!payload || payload.v !== 1 || legacy[0].commandKey !== `game-change:${gameId}:${payload.proposalId}`) return null;
    proposalId = payload.proposalId;
  }
  const eventId = `game-talk:${gameId}:${proposalId}`;
  return receipt.idempotencyKey === createHostedLinqDeliveryIdempotencyLookupKey(eventId) ? { gameId, proposalId, eventId } : null;
}
