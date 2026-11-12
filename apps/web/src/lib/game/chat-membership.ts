import "server-only";
import { readHostedLinqGroupMoveServicePhones } from "../hosted-routing/linq-group-line-move-store";
import { reconcileHostedThreadContainerParticipants } from "../hosted-groups/thread-container-participants";
import type { Prisma } from "@prisma/client";
import { lockHostedThreadRouteByThreadIdentityTx, assertHostedThreadRouteEgressAuthority, readHostedThreadRouteByThreadIdentity } from "../hosted-routing/thread-route-store";
import { readHostedPublicOrigin } from "../hosted-web/public-url";
import { logHostedOnboardingWarning } from "../hosted-onboarding/logging";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { lockGamePair } from "./blocks";
import { isGameMemberSet, sameGameMembers } from "./roster";
import { GAME_MAX_OPEN_PER_PAIR } from "./rules";
import { isGameOn } from "./access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { normalizeHostedEmailAddress } from "../hosted-onboarding/contact-privacy";
import { createHostedLinqParticipantContact, createHostedLinqParticipantContactLookupKeyReadCandidates } from "../hosted-onboarding/linq-participant-contact";
import { gameAudienceKeys } from "./audience";
import { lookupHostedGroupParticipantMemberIdsByHandles } from "../hosted-groups/participant-member";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { getHostedLinqChatSummary, type HostedLinqChatSummary } from "../hosted-onboarding/linq-client";
import { readHostedLinqIncomingLineState } from "../hosted-onboarding/linq-line-store";
import { listHostedLinqHealthyProactiveLines } from "../hosted-onboarding/linq-line-store";
import { readHostedMurphContactContextForMember } from "../hosted-onboarding/hosted-contact-context";
import { readHostedThreadContainerLinqRouteAuthorities } from "../hosted-routing/assistant-notification-destination";

/** Exact identity sets, bounded by the game roster limit. */
export function sameGamePlayers(actual: readonly (string | null)[], expected: readonly (string | null)[]): actual is readonly string[] {
  return actual.every((id): id is string => id !== null) && expected.every((id): id is string => id !== null)
    && isGameMemberSet(actual) && sameGameMembers(actual, expected);
}

/** Local roster narrows discovery; the provider roster independently proves sharing. */
export async function readGameChatPlayerIds(containerMemberId: string, prisma: Pick<Prisma.TransactionClient, "hostedThreadContainer"> = getPrisma()): Promise<string[]> {
  const container = await prisma.hostedThreadContainer.findUnique({
    where: { memberId: containerMemberId },
    select: { participants: { where: { removedAt: null }, select: { participantMemberId: true }, take: 11 } },
  });
  const players = container?.participants.map((participant) => participant.participantMemberId) ?? [];
  return sameGamePlayers(players, players) && isGameAudienceOn(players) ? players : [];
}

/** Rollout follows the current room audience. */
function isGameAudienceOn(playerMemberIds: readonly string[]): boolean {
  return isGameOn({ players: playerMemberIds.map((memberId) => ({ memberId })) });
}

export function gamePairWhere(playerMemberIds: readonly string[]): Prisma.GameWhereInput {
  if (!sameGamePlayers(playerMemberIds, playerMemberIds)) return { id: { in: [] } };
  return {
    AND: playerMemberIds.map((memberId) => ({ players: { some: { memberId } } })),
    players: { none: { memberId: { notIn: [...playerMemberIds] } } },
  };
}

/** Addressed chat audiences include every original invitee, including unseated people. */
export function addressedGameRematchWhere(players: readonly string[], now = new Date()): Prisma.GameWhereInput {
  if (!sameGamePlayers(players, players)) return { id: { in: [] } };
  return { status: { in: ["invited", "live"] }, OR: [{ maxPlayers: 10 }, { previousGameId: { not: null }, status: "invited" }],
    AND: [{ OR: [{ inviteExpiresAt: null }, { inviteExpiresAt: { gt: now } }] }, ...players.map(memberId => ({ OR: [{ createdBy: memberId }, { invitees: { some: { memberId } } }] }))],
    createdBy: { in: [...players] },
    invitees: { every: { memberId: { in: [...players] } } },
    players: { every: { memberId: { in: [...players] }, leftAt: null } },
  };
}

/** Legacy pair audience includes its known rematch addressee. Groups use keyed room authority. */
export function gameChatPlayerIds(game: { maxPlayers?: number; status: string; previousGameId: string | null; createdBy: string | null; invitees: readonly { memberId: string | null }[]; players: readonly { memberId: string | null; leftAt?: Date | null }[] }): string[] {
  if (game.players.some(player => player.memberId === null || player.leftAt)) return [];
  const seated = game.players.flatMap(player => player.memberId ? [player.memberId] : []);
  const invitee = game.invitees.find(invitee => invitee.memberId !== null)?.memberId;
  return game.status === "invited" && game.previousGameId && invitee && seated.length === 1 && seated[0] === game.createdBy
    ? [...seated, invitee] : seated;
}

/** Bounded candidates; projection rechecks each game against the room authority. */
export async function readGameChatCandidateIds(playerMemberIds: readonly string[], multiplayer = true, containerMemberId?: string): Promise<string[]> {
  // Group projections require a bound room; roomless notice context stays pair-only.
  multiplayer = containerMemberId ? multiplayer : false;
  if (((!multiplayer || !containerMemberId) && !sameGamePlayers(playerMemberIds, playerMemberIds)) || !isGameAudienceOn(playerMemberIds)) return [];
  const prisma = getPrisma();
  const [active, settled] = await Promise.all([
    prisma.game.findMany({ where: { ...(!multiplayer ? { maxPlayers: 2 } : {}), OR: [
      { ...gamePairWhere(playerMemberIds), status: { in: ["negotiating", "live"] } }, addressedGameRematchWhere(playerMemberIds),
      ...(multiplayer && containerMemberId ? [{ chatContainerMemberId: containerMemberId, OR: [
        { status: { in: ["negotiating", "live"] } },
        { status: "invited", OR: [{ inviteExpiresAt: null }, { inviteExpiresAt: { gt: new Date() } }] },
      ] }] : []),
    ] },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: GAME_MAX_OPEN_PER_PAIR, select: { id: true } }),
    prisma.game.findMany({ where: { ...(!multiplayer ? { maxPlayers: 2 } : {}), ...(multiplayer && containerMemberId ? { OR: [gamePairWhere(playerMemberIds), { chatContainerMemberId: containerMemberId }] } : gamePairWhere(playerMemberIds)), status: "settled" },
      orderBy: [{ settledAt: "desc" }, { id: "asc" }], take: 5, select: { id: true } }),
  ]);
  return [...active, ...settled.slice(0, GAME_MAX_OPEN_PER_PAIR - active.length)].map((row) => row.id);
}

/** Pair lock must precede every game lock that can establish a primary room. */
export async function readPairGameChatTx(tx: Prisma.TransactionClient, players: readonly string[]): Promise<string | null> {
  if (players.length !== 2 || !sameGamePlayers(players, players)) throw new Error("Game chat requires exactly two players.");
  await lockGamePair(tx, players[0]!, players[1]!);
  const bound = await tx.game.findFirst({
    where: { maxPlayers: 2, ...gamePairWhere(players), status: { in: ["negotiating", "live", "settled"] }, chatContainerMemberId: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { chatContainerMemberId: true },
  });
  return bound?.chatContainerMemberId ?? null;
}

/** Recheck discovery under the pair lock so simultaneous kickoffs share a room. */
export async function bindPairGameChat(gameId: string, players: readonly string[], candidate: string | null): Promise<string | null> {
  return getPrisma().$transaction(async (tx) => {
    // Discovery only returns rooms with a provider route. Lock it before pair/game
    // locks; if it is gone now (for example a group leave), do not bind it.
    // Existing pair bindings keep their bootstrap/rematch reuse.
    const candidateCurrent = candidate ? await lockGameChatCandidateTx(tx, candidate) : false;
    const room = await readPairGameChatTx(tx, players) ?? (candidateCurrent ? candidate : null);
    if (!room) return null;
    const changed = await tx.game.updateMany({ where: { id: gameId, ...gamePairWhere(players), status: { in: ["live", "negotiating"] }, chatContainerMemberId: null }, data: { chatContainerMemberId: room } });
    if (changed.count === 1) return room;
    const game = await tx.game.findUnique({ where: { id: gameId }, select: { chatContainerMemberId: true } });
    return game?.chatContainerMemberId ?? null;
  });
}

async function lockGameChatCandidateTx(tx: Prisma.TransactionClient, containerMemberId: string): Promise<boolean> {
  await lockGameChatContainerTx(tx, containerMemberId);
  const rows = await tx.$queryRaw<{ container_member_id: string }[]>`
    SELECT container_member_id FROM hosted_thread_route
    WHERE container_member_id = ${containerMemberId} AND channel = 'linq'
    ORDER BY thread_identity_lookup_key LIMIT 2 FOR UPDATE
  `;
  return rows.length === 1;
}

/** Take the game's foreign-key lock before the route, matching runtime callbacks. */
async function lockGameChatContainerTx(tx: Prisma.TransactionClient, containerMemberId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${containerMemberId} FOR KEY SHARE`;
}

/** Current exact membership proves access; a stored binding alone never does. */
export async function requireExactGameChat(containerMemberId: string, multiplayer = false): Promise<readonly string[]> {
  if (multiplayer) return (await readGameChatAudience(containerMemberId)).memberIds;
  const playerMemberIds = await readGameChatPlayerIds(containerMemberId);
  if (!isGameMemberSet(playerMemberIds)) throw new Error("Game chat requires 2 to 10 available players.");
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
  const people = active.filter((handle) => !handle.isMe).map((handle) => normalizeChatHandle(handle.handle));
  return active.filter((handle) => handle.isMe).length === 1
    && people.every((phone): phone is string => phone !== null) && sameGameMembers(people, phones.map(normalizeChatHandle).filter((handle): handle is string => handle !== null));
}

/** Collapse only this move's verified service numbers to the canonical sending self. */
export function normalizeGameChatMoveAudience(chat: HostedLinqChatSummary, servicePhones: readonly string[], accountLookupKey: string): HostedLinqChatSummary {
  if (servicePhones.length === 0) return chat;
  const sendingPhone = servicePhones.find(phone => createHostedPhoneLookupKeyReadCandidates(phone).includes(accountLookupKey));
  if (!sendingPhone || servicePhones.length !== 2) throw new Error("Game move service identity is unavailable.");
  const handles = chat.handles.filter(handle => {
    const phone = normalizePhoneNumber(handle.handle);
    return !phone || !servicePhones.includes(phone) || phone === sendingPhone;
  }).map(handle => normalizePhoneNumber(handle.handle) === sendingPhone ? { ...handle, isMe: true } : handle);
  return { ...chat, handles, handleCount: handles.length };
}

export async function exactChat(containerMemberId: string, phones: readonly string[]) {
  const prisma = getPrisma();
  const routes = await readHostedThreadContainerLinqRouteAuthorities({ containerMemberIds: [containerMemberId], prisma });
  const route = routes.authorities.get(containerMemberId);
  if (!route) return null;
  const observed = await getHostedLinqChatSummary({ chatId: route.threadId, timeoutMs: 3_000 });
  if (route.channel !== "linq") return null;
  const phonesForMove = await readHostedLinqGroupMoveServicePhones({ containerMemberId, threadId: route.threadId, prisma });
  const chat = normalizeGameChatMoveAudience(observed, phonesForMove, route.accountLookupKey ?? "");
  if (!isExactGameChat(chat, phones)) return null;
  const self = chat.handles.find((handle) => handle.isMe && (handle.status === null || handle.status.toLowerCase() === "active"));
  const line = await readHostedLinqIncomingLineState({ phoneNumberLookupKeys: createHostedPhoneLookupKeyReadCandidates(self?.handle), prisma });
  if (line.kind !== "assignable" && line.kind !== "at_risk") throw new Error("Game chat sending line is unavailable.");
  await reconcileHostedThreadContainerParticipants({ chatId: route.threadId, containerMemberId, observation: chat, prisma });
  return { chat, route };
}


/** Reuse the most active exact room, then a named room, then the newest room. */
export async function findExistingGameChat(playerMemberIds: readonly string[], phones: readonly string[]): Promise<string | null> {
  const partial = playerMemberIds.length < phones.length;
  if (!(partial && playerMemberIds.length > 0 && new Set(playerMemberIds).size === playerMemberIds.length) && !sameGamePlayers(playerMemberIds, playerMemberIds)) throw new Error("Game chat requires 2 to 10 players.");
  const prisma = getPrisma();
  const CANDIDATE_LIMIT = 20;
    const candidates = await prisma.hostedThreadContainer.findMany({
      relationLoadStrategy: "join",
      where: { AND: playerMemberIds.map((memberId) => ({ participants: { some: { participantMemberId: memberId, removedAt: null } } })), ...(partial ? {} : { participants: { none: { removedAt: null, participantMemberId: { notIn: [...playerMemberIds] } } } }) },
      select: {
        memberId: true, createdAt: true,
        member: { select: {
          hostedGroupRuntime: { select: { displayName: true } },
          hostedMailboxItems: { where: { kind: "conversation.message" }, orderBy: { createdAt: "desc" }, select: { createdAt: true }, take: 1 },
        } },
        participants: { where: { removedAt: null }, select: { participantMemberId: true }, take: 11 },
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
      if (!partial && !sameGamePlayers(candidate.participants.map((participant) => participant.participantMemberId), playerMemberIds)) continue;
      if (await exactChat(candidate.memberId, phones)) return candidate.memberId;
    }
  return null;
}

function normalizeChatHandle(value: string): string | null {
  const kind = value.includes("@") ? "email" : "phone";
  const normalized = kind === "email" ? normalizeHostedEmailAddress(value) : normalizePhoneNumber(value);
  return normalized ? `${kind}:${normalized}` : null;
}

/** This room is proven unsendable, so nothing may be sent. The fixed reason is safe to log. */
export class GameChatAudienceError extends Error {
  constructor(readonly reason: "blocked" | "route_unavailable" | "participants_changed" | "line_unavailable" | "identity_ambiguous", message: string) { super(message); }
}

/** Provider roster and rotating keyed handles are preparation, never transaction work. */
export async function readGameChatAudience(containerMemberId: string) {
  const prisma = getPrisma();
  const routes = await readHostedThreadContainerLinqRouteAuthorities({ containerMemberIds: [containerMemberId], prisma });
  const route = routes.authorities.get(containerMemberId);
  // "Unavailable" includes a failed open (database or KMS), which proves nothing about the room.
  if (!route) throw routes.unavailableContainerMemberIds.has(containerMemberId)
    ? new Error("Game chat route is unavailable.") : new GameChatAudienceError("route_unavailable", "Game chat route is unavailable.");
  return { ...await readGameChatHandleAudience(route.threadId, containerMemberId, route.channel === "linq" ? route.accountLookupKey ?? undefined : undefined), route };
}

async function readGameChatHandleAudience(threadId: string, containerMemberId?: string, accountLookupKey?: string) {
  const prisma = getPrisma();
  const observed = await getHostedLinqChatSummary({ chatId: threadId, timeoutMs: 3_000 });
  const phonesForMove = containerMemberId && accountLookupKey
    ? await readHostedLinqGroupMoveServicePhones({ containerMemberId, threadId, prisma }) : [];
  const chat = normalizeGameChatMoveAudience(observed, phonesForMove, accountLookupKey ?? "");
  const active = chat.handles.filter(handle => handle.status === null || handle.status.toLowerCase() === "active");
  const handles = active.filter(handle => !handle.isMe).map(handle => handle.handle);
  // An unreadable payload proves nothing about the room; only a readable mismatch is a room fact.
  if (chat.handlesComplete !== true) throw new Error("The game's chat participants have changed.");
  const normalized = handles.map(normalizeChatHandle);
  if (chat.isGroup !== true || active.filter(handle => handle.isMe).length !== 1
    || normalized.some(handle => handle === null) || new Set(normalized).size !== normalized.length) throw new GameChatAudienceError("participants_changed", "The game's chat participants have changed.");
  const line = await readHostedLinqIncomingLineState({ phoneNumberLookupKeys: createHostedPhoneLookupKeyReadCandidates(active.find(handle => handle.isMe)?.handle), prisma });
  if (line.kind !== "assignable" && line.kind !== "at_risk") throw new GameChatAudienceError("line_unavailable", "Game chat sending line is unavailable.");
  const contacts = handles.map(value => createHostedLinqParticipantContact({ kind: value.includes("@") ? "email" : "phone", value })!);
  const resolved = await lookupHostedGroupParticipantMemberIdsByHandles({ handles: contacts.map(contact => contact.value), prisma });
  const phoneKeys = contacts.filter(contact => contact.kind === "phone").flatMap(createHostedLinqParticipantContactLookupKeyReadCandidates);
  const verified = phoneKeys.length ? await prisma.hostedMemberIdentity.findMany({ where: { phoneLookupKey: { in: phoneKeys }, phoneNumberVerifiedAt: { not: null } }, select: { memberId: true, phoneLookupKey: true } }) : [];
  const resolvedContacts = contacts.map(contact => {
    const memberId = resolved.get(contact.value) ?? null;
    const verifiedMemberId = contact.kind === "phone" && !verified.some(identity => identity.memberId === memberId && createHostedLinqParticipantContactLookupKeyReadCandidates(contact).includes(identity.phoneLookupKey ?? "")) ? null : memberId;
    return { contact, memberId: verifiedMemberId };
  });
  const memberIds = resolvedContacts.flatMap(({ memberId }) => memberId ? [memberId] : []);
  // Two handles resolving to one person are ambiguous audience evidence.
  if (new Set(memberIds).size !== memberIds.length) throw new GameChatAudienceError("identity_ambiguous", "Game chat identity is ambiguous.");
  if (containerMemberId) await reconcileHostedThreadContainerParticipants({ chatId: threadId, containerMemberId, observation: chat, prisma });
  const keys: { current: string | null; candidates: string[] } = contacts.length >= 2 && contacts.length <= 10
    ? gameAudienceKeys(contacts) : { current: null, candidates: [] };
  return { memberIds, contacts, resolvedContacts, keys, threadId };
}

export type GameChatAudience = Awaited<ReturnType<typeof readGameChatHandleAudience>>;
type GameRoomGame = Parameters<typeof gameChatPlayerIds>[0] & {
  maxPlayers: number; audienceKey: string | null; chatContainerMemberId: string | null;
};

/** Bound rooms need every current player; unbound games need their exact audience.
 * Prepare provider evidence outside transactions; revalidate under locks using database reads.
 */
export async function readGameChatAuthority(game: GameRoomGame, containerMemberId: string,
  prepared?: GameChatAudience, prisma: Prisma.TransactionClient = getPrisma(), waitOnBlock = false): Promise<GameChatAudience | null> {
  const audience = prepared ?? await readGameChatAudience(containerMemberId);
  const players = game.maxPlayers === 2 ? gameChatPlayerIds(game) : game.players.filter(player => !player.leftAt).map(player => player.memberId);
  if (game.maxPlayers === 2 && (players.length !== 2 || !sameGamePlayers(players, players))) return null;
  if (game.chatContainerMemberId !== containerMemberId) {
    if (game.maxPlayers === 10 ? game.chatContainerMemberId || !game.audienceKey || !audience.keys.candidates.includes(game.audienceKey)
      : audience.contacts.length !== 2 || !sameGamePlayers(players, audience.memberIds)) return null;
  }
  const route = await readHostedThreadRouteByThreadIdentity({ channel: "linq", threadId: audience.threadId, prisma });
  if (route?.containerMemberId !== containerMemberId) return null;
  if (players.some(memberId => !memberId || !audience.memberIds.includes(memberId))) return null;
  const restricted = [...new Set([...audience.memberIds, ...game.players.flatMap(player => player.memberId ? [player.memberId] : [])])];
  if (await hasGameChatBlock(prisma, restricted)) {
    if (waitOnBlock) throw new GameChatAudienceError("blocked", "Game chat is blocked.");
    return null;
  }
  return await hasGameChatMemberRestriction(prisma, restricted) ? null : audience;
}

/** Accepted notices treat null as stale. A block can lift, so throw to keep the receipt and retry. */
export function readGroupGameNoticeAuthority(game: GameRoomGame, containerMemberId: string,
  prepared?: GameChatAudience, prisma: Prisma.TransactionClient = getPrisma()): Promise<GameChatAudience | null> {
  return readGameChatAuthority(game, containerMemberId, prepared, prisma, true);
}

/** One bounded block read for the whole shared audience, in either direction. */
export async function hasGameChatBlock(prisma: Pick<Prisma.TransactionClient, "gameBlock">, players: readonly string[]): Promise<boolean> {
  return Boolean(await prisma.gameBlock.findFirst({ where: { blockerMemberId: { in: [...players] }, blockedMemberId: { in: [...players] } }, select: { blockerMemberId: true } }));
}

/** Shared projections and generated material respect every participant's consent. */
export async function hasGameChatRestriction(prisma: Pick<Prisma.TransactionClient, "gameBlock" | "hostedMember">, players: readonly string[]): Promise<boolean> {
  if (await hasGameChatBlock(prisma, players)) return true;
  return hasGameChatMemberRestriction(prisma, players);
}

async function hasGameChatMemberRestriction(prisma: Pick<Prisma.TransactionClient, "hostedMember">, players: readonly string[]): Promise<boolean> {
  return Boolean(await prisma.hostedMember.findFirst({ where: { id: { in: [...players] }, OR: [
    { suspendedAt: { not: null } }, { consentGrants: { some: { scope: "launch.health-data", status: "revoked" } } },
  ] }, select: { id: true } }));
}

/** Duplicate profile first names need stable shared labels, never private contact names. */
export function gameChatNames(players: readonly { memberId: string; firstName: string | null }[]): Map<string, string> {
  const ordered = [...players].sort((a, b) => a.memberId.localeCompare(b.memberId));
  return new Map(ordered.map(player => {
    const name = player.firstName || "Player";
    const peers = ordered.filter(other => (other.firstName || "Player").toLowerCase() === name.toLowerCase());
    return [player.memberId, peers.length > 1 ? `${name} (${peers.indexOf(player) + 1})` : name];
  }));
}

/** Explicit response-only handoff. Discovery uses request handles before locks. */
export async function prepareGameChat(input: { actor: string; members: readonly (string | null)[]; handles?: readonly string[]; room?: string; audienceKeys: readonly string[] }): Promise<{ room: string | null; composer?: { murphPhoneNumber: string }; revalidate?: (tx: Prisma.TransactionClient) => Promise<void> }> {
  const members = input.members.filter((id): id is string => id !== null);
  const room = input.room ?? (input.handles && members.length
    ? await findExistingGameChat(members, input.handles) : null);
  if (room) {
    const audience = await readGameChatAudience(room);
    if (!audience.keys.candidates.some(key => input.audienceKeys.includes(key))) throw new Error("The game's chat participants have changed.");
    return preparedGameRoom(room, audience, input.audienceKeys);
  }
  const contact = await readHostedMurphContactContextForMember({ memberId: input.actor, prisma: getPrisma() });
  const murphPhoneNumber = contact.murphPhoneNumber ?? (await listHostedLinqHealthyProactiveLines({ prisma: getPrisma() }))[0]?.phoneNumber;
  if (!murphPhoneNumber) throw new Error("Messages setup is unavailable. Try again shortly.");
  return { room: null, composer: { murphPhoneNumber } };
}

function preparedGameRoom(room: string, audience: Awaited<ReturnType<typeof readGameChatAudience>>, audienceKeys: readonly string[]) {
  return { room, async revalidate(tx: Prisma.TransactionClient) {
    await lockGameChatContainerTx(tx, room);
    await lockHostedThreadRouteByThreadIdentityTx({ authority: audience.route, prisma: tx });
    await assertHostedThreadRouteEgressAuthority({ authority: audience.route, prisma: tx });
    if (!await readGameChatAuthority({ maxPlayers: 10, audienceKey: audienceKeys.find(key => audience.keys.candidates.includes(key)) ?? null,
      chatContainerMemberId: room, status: "invited", previousGameId: null, createdBy: null, players: [], invitees: [] }, room, audience, tx)) throw new Error("Game chat sharing is unavailable.");
  } };
}

/** Use the same configured origin as public invite/recap links, allowing its www/apex alias. */
function gameInviteTokens(text: string): string[] {
  const origin = readHostedPublicOrigin();
  if (!origin) return [];
  const expected = new URL(origin);
  const tokens = [...text.matchAll(/https?:\/\/[^\s<>"']+\/g\/([A-Za-z0-9_-]{16,128})(?=$|[\s?#.,)])/gu)].flatMap(match => {
    const url = new URL(match[0]);
    return url.protocol === expected.protocol && url.port === expected.port
      && url.hostname.replace(/^www\./u, "") === expected.hostname.replace(/^www\./u, "")
      && url.pathname === `/g/${match[1]}` ? [match[1]] : [];
  });
  return [...new Set(tokens)];
}

function inviteFailure(reason: string): null {
  logHostedOnboardingWarning("game.chat.invite-association", { reason });
  return null;
}

/** Optional invite enrichment must never prevent ingestion of the person's message. */
export async function prepareGameChatInvite(text: string, threadId: string) {
  try {
    const tokens = gameInviteTokens(text);
    if (tokens.length !== 1) return null;
    const inviteTokenHash = sha256Hex(tokens[0]);
    const game = await getPrisma().game.findFirst({ where: { maxPlayers: 10, inviteTokenHash, status: { in: ["invited", "live"] } }, select: { id: true, audienceKey: true } });
    if (!game?.audienceKey) return null;
    const audience = await readGameChatHandleAudience(threadId);
    if (!audience.keys.candidates.includes(game.audienceKey)) return inviteFailure("audience_mismatch");
    return { ...audience, gameId: game.id, inviteTokenHash };
  } catch { return inviteFailure("preparation_unavailable"); }
}

/** Ordinary verified inbound admission binds only; canonical join alone claims invitees. */
export async function associateGameChatInviteTx(input: {
  prepared?: Awaited<ReturnType<typeof prepareGameChatInvite>>; isFromMe?: boolean;
  containerMemberId: string; senderMemberId: string; threadId: string; tx: Prisma.TransactionClient;
}): Promise<null> {
  if (!input.prepared || input.isFromMe) return null;
  // A statement failure must not poison the ingestion transaction.
  let saved = false;
  try {
    await input.tx.$executeRaw`SAVEPOINT game_invite_association`;
    saved = true;
    await bindGameInviteRoomTx(input);
  }
  catch {
    if (saved) await input.tx.$executeRaw`ROLLBACK TO SAVEPOINT game_invite_association`;
    return inviteFailure("association_unavailable");
  } finally { if (saved) await input.tx.$executeRaw`RELEASE SAVEPOINT game_invite_association`; }
  return null;
}

async function bindGameInviteRoomTx(input: Parameters<typeof associateGameChatInviteTx>[0]): Promise<void> {
  const { prepared, tx, containerMemberId, senderMemberId } = input;
  if (!prepared) return;
  if (prepared.threadId !== input.threadId || !prepared.memberIds.includes(senderMemberId)) { inviteFailure("sender_unavailable"); return; }
  await lockGameChatContainerTx(tx, containerMemberId);
  await lockHostedThreadRouteByThreadIdentityTx({ authority: { channel: "linq", threadId: input.threadId, containerMemberId }, prisma: tx });
  await tx.$queryRaw`SELECT id FROM game WHERE id = ${prepared.gameId} FOR UPDATE`;
  const current = await tx.game.findUnique({ where: { id: prepared.gameId }, include: { players: true, invitees: { select: { memberId: true, recipientLookupKey: true } } } });
  if (!current || current.inviteTokenHash !== prepared.inviteTokenHash || !["invited", "live"].includes(current.status)
    || current.createdBy !== senderMemberId && !current.players.some(player => player.memberId === senderMemberId && !player.leftAt)) { inviteFailure("invitation_unavailable"); return; }
  if (!current.audienceKey || !prepared.keys.candidates.includes(current.audienceKey)
    || !await readGameChatAuthority(current, containerMemberId, prepared, tx)) { inviteFailure("authority_unavailable"); return; }
  await tx.game.update({ where: { id: current.id }, data: { chatContainerMemberId: containerMemberId } });
}

export async function gameChatContextCurrent(row: GameRoomGame,
  input: { chatContainerMemberId?: string; chatPlayerMemberIds?: readonly string[]; chatAudience?: GameChatAudience }, tx: Prisma.TransactionClient = getPrisma()): Promise<boolean> {
  if (input.chatAudience) return Boolean(input.chatContainerMemberId
    && (row.maxPlayers !== 10 || row.chatContainerMemberId === input.chatContainerMemberId)
    && await readGameChatAuthority(row, input.chatContainerMemberId, input.chatAudience, tx));
  return row.maxPlayers === 2 && sameGamePlayers(gameChatPlayerIds(row), input.chatPlayerMemberIds ?? []);
}
