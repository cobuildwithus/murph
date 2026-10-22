import "server-only";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../prisma";
import { isGameEnabledFor } from "./access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { getHostedLinqChatSummary, type HostedLinqChatSummary } from "../hosted-onboarding/linq-client";
import { readHostedLinqIncomingLineState } from "../hosted-onboarding/linq-line-store";
import { readHostedThreadContainerLinqRouteAuthorities } from "../hosted-routing/assistant-notification-destination";

export function sameGamePlayers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === 2 && expected.length === 2 && new Set(actual).size === 2
    && new Set(expected).size === 2 && actual.every((memberId) => expected.includes(memberId));
}

/** Local roster narrows discovery; the provider roster independently proves sharing. */
export async function readGameChatPlayerIds(containerMemberId: string, prisma: Pick<Prisma.TransactionClient, "hostedThreadContainer"> = getPrisma()): Promise<string[]> {
  const container = await prisma.hostedThreadContainer.findUnique({
    where: { memberId: containerMemberId },
    select: { participants: { where: { removedAt: null }, select: { participantMemberId: true }, take: 3 } },
  });
  const players = container?.participants.map((participant) => participant.participantMemberId) ?? [];
  return players.length === 2 && new Set(players).size === 2 && players.every((memberId) => isGameEnabledFor(memberId)) ? players : [];
}

export function gamePairWhere(playerMemberIds: readonly string[]): Prisma.GameWhereInput {
  if (playerMemberIds.length !== 2 || new Set(playerMemberIds).size !== 2) return { id: { in: [] } };
  return {
    AND: playerMemberIds.map((memberId) => ({ players: { some: { memberId } } })),
    players: { none: { memberId: { notIn: [...playerMemberIds] } } },
  };
}

/** Bounded canonical games for the pair, independent of their announcement room. */
export async function readGameChatCandidateIds(playerMemberIds: readonly string[]): Promise<string[]> {
  if (!sameGamePlayers(playerMemberIds, playerMemberIds) || !playerMemberIds.every((memberId) => isGameEnabledFor(memberId))) return [];
  const rows = await getPrisma().game.findMany({
    where: { ...gamePairWhere(playerMemberIds), status: { in: ["negotiating", "live", "settled"] } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 5, select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** Game reads and writes require this room's current exact pair, never a chat binding. */
export async function requireExactGameChat(containerMemberId: string): Promise<readonly string[]> {
  const playerMemberIds = await readGameChatPlayerIds(containerMemberId);
  if (playerMemberIds.length !== 2) throw new Error("Game chat requires exactly two available players.");
  const identities = await Promise.all(playerMemberIds.map((memberId) => readHostedMemberIdentity({ memberId, prisma: getPrisma() })));
  const phones = identities.flatMap((identity) => identity?.phoneNumberVerifiedAt && identity.phoneNumber ? [identity.phoneNumber] : []);
  if (phones.length !== 2 || new Set(phones).size !== 2) throw new Error("Game chat requires verified players.");
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
  if (chat.isGroup !== true || chat.handlesComplete !== true || phones.length !== 2 || new Set(phones).size !== 2) return false;
  const active = chat.handles.filter((handle) => handle.status === null || handle.status.toLowerCase() === "active");
  const people = active.filter((handle) => !handle.isMe).map((handle) => normalizePhoneNumber(handle.handle));
  return active.filter((handle) => handle.isMe).length === 1
    && people.length === 2 && new Set(people).size === 2
    && phones.every((phone) => people.includes(phone));
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
      if (candidate.participants.length !== 2 || !playerMemberIds.every((memberId) => candidate.participants.some((participant) => participant.participantMemberId === memberId))) continue;
      if (await exactChat(candidate.memberId, phones)) return candidate.memberId;
    }
  return null;
}
