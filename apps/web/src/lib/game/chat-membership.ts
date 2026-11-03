import "server-only";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../prisma";
import { lockGamePair } from "./blocks";
import { isPairRoster, sameGameMembers } from "./roster";
import { GAME_MAX_OPEN_PER_PAIR } from "./rules";
import { isGameOn } from "./access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { getHostedLinqChatSummary, type HostedLinqChatSummary } from "../hosted-onboarding/linq-client";
import { readHostedLinqIncomingLineState } from "../hosted-onboarding/linq-line-store";
import { readHostedThreadContainerLinqRouteAuthorities } from "../hosted-routing/assistant-notification-destination";

/** Released chat admission and binding remain pair-only. */
export function sameGamePlayers(actual: readonly string[], expected: readonly string[]): boolean {
  return isPairRoster(actual) && sameGameMembers(actual, expected);
}

/** Local roster narrows discovery; the provider roster independently proves sharing. */
export async function readGameChatPlayerIds(containerMemberId: string, prisma: Pick<Prisma.TransactionClient, "hostedThreadContainer"> = getPrisma()): Promise<string[]> {
  const container = await prisma.hostedThreadContainer.findUnique({
    where: { memberId: containerMemberId },
    select: { participants: { where: { removedAt: null }, select: { participantMemberId: true }, take: 3 } },
  });
  const players = container?.participants.map((participant) => participant.participantMemberId) ?? [];
  return sameGamePlayers(players, players) && isGamePairOn(players) ? players : [];
}

/** Every game of a pair has exactly these people, so the pair decides whether its games are on. */
function isGamePairOn(playerMemberIds: readonly string[]): boolean {
  return isGameOn({ players: playerMemberIds.map((memberId) => ({ memberId })) });
}

export function gamePairWhere(playerMemberIds: readonly string[]): Prisma.GameWhereInput {
  if (!sameGamePlayers(playerMemberIds, playerMemberIds)) return { id: { in: [] } };
  return {
    AND: playerMemberIds.map((memberId) => ({ players: { some: { memberId } } })),
    players: { none: { memberId: { notIn: [...playerMemberIds] } } },
  };
}

/** An addressed rematch has one seated creator and one known, unseated invitee. */
export function addressedGameRematchWhere(players: readonly string[], now = new Date()): Prisma.GameWhereInput {
  if (!sameGamePlayers(players, players)) return { id: { in: [] } };
  return { status: "invited", previousGameId: { not: null },
    AND: [{ OR: [{ inviteExpiresAt: null }, { inviteExpiresAt: { gt: now } }] }],
    OR: players.map((createdBy) => ({ createdBy, inviteeMemberId: players.find((id) => id !== createdBy),
      players: { some: { memberId: createdBy, seat: 0 }, every: { memberId: createdBy } } })),
  };
}

/** Shared-chat authority includes the known addressee, never an unclaimed bearer link. */
export function gameChatPlayerIds(game: { status: string; previousGameId: string | null; createdBy: string | null; inviteeMemberId: string | null; players: readonly { memberId: string }[] }): string[] {
  const seated = game.players.map(player => player.memberId);
  return game.status === "invited" && game.previousGameId && game.inviteeMemberId && seated.length === 1 && seated[0] === game.createdBy
    ? [...seated, game.inviteeMemberId] : seated;
}

/** Bounded canonical games for the pair, independent of their announcement room. */
export async function readGameChatCandidateIds(playerMemberIds: readonly string[]): Promise<string[]> {
  if (!sameGamePlayers(playerMemberIds, playerMemberIds) || !isGamePairOn(playerMemberIds)) return [];
  const prisma = getPrisma();
  const [active, settled] = await Promise.all([
    prisma.game.findMany({ where: { OR: [{ ...gamePairWhere(playerMemberIds), status: { in: ["negotiating", "live"] } }, addressedGameRematchWhere(playerMemberIds)] },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: GAME_MAX_OPEN_PER_PAIR, select: { id: true } }),
    prisma.game.findMany({ where: { ...gamePairWhere(playerMemberIds), status: "settled" },
      orderBy: [{ settledAt: "desc" }, { id: "asc" }], take: 5, select: { id: true } }),
  ]);
  return [...active, ...settled.slice(0, GAME_MAX_OPEN_PER_PAIR - active.length)].map((row) => row.id);
}

/** Pair lock must precede every game lock that can establish a primary room. */
export async function readPairGameChatTx(tx: Prisma.TransactionClient, players: readonly string[]): Promise<string | null> {
  if (!sameGamePlayers(players, players)) throw new Error("Game chat requires two players.");
  await lockGamePair(tx, players[0]!, players[1]!);
  const bound = await tx.game.findFirst({
    where: { ...gamePairWhere(players), status: { in: ["negotiating", "live", "settled"] }, chatContainerMemberId: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { chatContainerMemberId: true },
  });
  return bound?.chatContainerMemberId ?? null;
}

/** Recheck discovery under the pair lock so simultaneous kickoffs share a room. */
export async function bindPairGameChat(gameId: string, players: readonly string[], candidate: string | null): Promise<string | null> {
  return getPrisma().$transaction(async (tx) => {
    const room = await readPairGameChatTx(tx, players) ?? candidate;
    if (!room) return null;
    const changed = await tx.game.updateMany({ where: { id: gameId, ...gamePairWhere(players), status: { in: ["live", "negotiating"] }, chatContainerMemberId: null }, data: { chatContainerMemberId: room } });
    if (changed.count === 1) return room;
    const game = await tx.game.findUnique({ where: { id: gameId }, select: { chatContainerMemberId: true } });
    return game?.chatContainerMemberId ?? null;
  });
}

/** Game reads and writes require this room's current exact pair, never a chat binding. */
export async function requireExactGameChat(containerMemberId: string): Promise<readonly string[]> {
  const playerMemberIds = await readGameChatPlayerIds(containerMemberId);
  if (!isPairRoster(playerMemberIds)) throw new Error("Game chat requires exactly two available players.");
  const identities = await Promise.all(playerMemberIds.map((memberId) => readHostedMemberIdentity({ memberId, prisma: getPrisma() })));
  const phones = identities.flatMap((identity) => identity?.phoneNumberVerifiedAt && identity.phoneNumber ? [identity.phoneNumber] : []);
  if (!sameGamePlayers(phones, phones)) throw new Error("Game chat requires verified players.");
  await requireExactChat(containerMemberId, phones);
  return playerMemberIds;
}

export async function requireExactChat(containerMemberId: string, phones: readonly string[]) {
  const matched = await exactChat(containerMemberId, phones);
  if (!matched) throw new Error("The game's chat participants have changed.");
  return matched;
}

/** Current complete provider membership, not the best-effort database roster, proves the audience. */
export function isExactGameChat(chat: HostedLinqChatSummary, phones: readonly string[]): boolean {
  if (chat.isGroup !== true || chat.handlesComplete !== true || !sameGamePlayers(phones, phones)) return false;
  const active = chat.handles.filter((handle) => handle.status === null || handle.status.toLowerCase() === "active");
  const people = active.filter((handle) => !handle.isMe).map((handle) => normalizePhoneNumber(handle.handle));
  return active.filter((handle) => handle.isMe).length === 1
    && people.every((phone): phone is string => phone !== null) && sameGameMembers(people, phones);
}

export async function exactChat(containerMemberId: string, phones: readonly string[]) {
  const prisma = getPrisma();
  const routes = await readHostedThreadContainerLinqRouteAuthorities({ containerMemberIds: [containerMemberId], prisma });
  const route = routes.authorities.get(containerMemberId);
  if (!route) return null;
  const chat = await getHostedLinqChatSummary({ chatId: route.threadId, timeoutMs: 3_000 });
  if (!isExactGameChat(chat, phones)) return null;
  const self = chat.handles.find((handle) => handle.isMe && (handle.status === null || handle.status.toLowerCase() === "active"));
  const line = await readHostedLinqIncomingLineState({ phoneNumberLookupKeys: createHostedPhoneLookupKeyReadCandidates(self?.handle), prisma });
  if (line.kind !== "assignable" && line.kind !== "at_risk") throw new Error("Game chat sending line is unavailable.");
  return { chat, route };
}


/** Reuse the most active exact room, then a named room, then the newest room. */
export async function findExistingGameChat(playerMemberIds: readonly string[], phones: readonly string[]): Promise<string | null> {
  if (!sameGamePlayers(playerMemberIds, playerMemberIds)) throw new Error("Game chat requires two players.");
  const prisma = getPrisma();
  const CANDIDATE_LIMIT = 20;
    const candidates = await prisma.hostedThreadContainer.findMany({
      relationLoadStrategy: "join",
      where: { AND: playerMemberIds.map((memberId) => ({ participants: { some: { participantMemberId: memberId, removedAt: null } } })), participants: { none: { removedAt: null, participantMemberId: { notIn: [...playerMemberIds] } } } },
      select: {
        memberId: true, createdAt: true,
        member: { select: {
          hostedGroupRuntime: { select: { displayName: true } },
          hostedMailboxItems: { where: { kind: "conversation.message" }, orderBy: { createdAt: "desc" }, select: { createdAt: true }, take: 1 },
        } },
        participants: { where: { removedAt: null }, select: { participantMemberId: true }, take: 3 },
      },
      orderBy: [{ createdAt: "desc" }, { memberId: "asc" }], take: CANDIDATE_LIMIT + 1,
    });
    if (candidates.length > CANDIDATE_LIMIT) throw new Error("Game chat discovery needs a narrower existing conversation.");
    // Message receipts are conversation activity; roster refreshes and system
    // notifications are not. Read one indexed receipt per bounded candidate.
    candidates.sort((a, b) => {
      const activity = (candidate: typeof a) => candidate.member.hostedMailboxItems[0]?.createdAt.getTime() ?? 0;
      const named = (candidate: typeof a) => Number(Boolean(candidate.member.hostedGroupRuntime?.displayName?.trim()));
      return activity(b) - activity(a) || named(b) - named(a)
        || b.createdAt.getTime() - a.createdAt.getTime() || a.memberId.localeCompare(b.memberId);
    });
    for (const candidate of candidates) {
      if (!sameGamePlayers(candidate.participants.map((participant) => participant.participantMemberId), playerMemberIds)) continue;
      if (await exactChat(candidate.memberId, phones)) return candidate.memberId;
    }
  return null;
}
