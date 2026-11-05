import "server-only";

import { isPairRoster, hasGameIdentity, gameMemberIds } from "./roster";

import type { Game, GamePlayer } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxItemByDedupeKey } from "../hosted-mailbox/store";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { assertHostedAssistantNotificationRouteAuthority, bindHostedAssistantNotificationDestination, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { getPrisma } from "../prisma";
import { readPendingGameChange } from "./change-words";
import { isGameOn } from "./access";
import type { GamePendingChange } from "./contract";
import { buildGameProposalInstructions } from "@murphai/hosted-execution/runtime-control";
export { buildGameProposalInstructions } from "@murphai/hosted-execution/runtime-control";
import { openGameTexts } from "./crypto";
import { isGameInviteExpired } from "./rules";
import { pendingGameChangeView } from "./changes";
import { assertGameProposalDeliveryCurrentTx } from "./chat-delivery-authority";

import { bindPairGameChat, findExistingGameChat, readGroupGameChatAuthority, type GameChatAudience, requireExactChat, requireExactGameChat } from "./chat-membership";
export { isExactGameChat, requireExactGameChat } from "./chat-membership";
import { prepareGameChatBootstrap } from "./chat-bootstrap";
import { markGameChatGenerationQueuedTx } from "./chat-lifecycle-receipt";

/** Called after the game transaction. All provider and crypto work stays outside game locks. */
export async function deliverGameChangeProposal(gameId: string, proposalId: string, now = new Date()): Promise<boolean> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { invitees: true, players: { orderBy: { seat: "asc" }, take: 11 } } });
  if (game?.maxPlayers === 10) return deliverGroupChangeProposal(gameId, proposalId, now);
  const proposal = game ? await readPendingGameChange(game) : null;
  if (!game || !["live", "negotiating"].includes(game.status) || isGameInviteExpired(game, now)
    || !proposal || proposal.id !== proposalId || !isPairRoster(game.players)) return false;
  if (!isGameOn(game)) return false;
  if (proposal.deliveryStatus === "sent") return true;
  if (proposal.origin === "chat") return false;
  const { phones, message } = await prepareGameChatPlayers(game, proposal);
  const players = gameMemberIds(game.players);
  const containerMemberId = game.chatContainerMemberId
    ?? await bindPairGameChat(gameId, players, await findExistingGameChat(players, phones));
  const destination = containerMemberId ? await resolveHostedAssistantNotificationDestination({ memberId: containerMemberId, prisma }) : null;
  if (!containerMemberId || !destination) return (await prepareGameChatBootstrap(gameId, `game-change:${gameId}:${proposal.id}`, message)) !== null;
  await requireExactChat(containerMemberId, phones);
  return enqueueProposal(gameId, proposal, containerMemberId, message);
}

async function deliverGroupChangeProposal(gameId: string, proposalId: string, now: Date): Promise<boolean> {
  const prisma = getPrisma();
  const { readCurrentGameChange, readGameChatProfiles, readGameNoticeRoom } = await import("./service");
  const current = await readCurrentGameChange(prisma, gameId, proposalId, now);
  if (!current || !isGameOn(current.row)) return false;
  const game = current.row;
  const proposal = await readPendingGameChange(game);
  if (!proposal || proposal.origin === "chat") return false;
  if (proposal.deliveryStatus === "sent") return true;
  if (!game.chatContainerMemberId) return false;
  const audience = await readGroupGameChatAuthority(game, game.chatContainerMemberId);
  if (!audience) return false;
  const players = current.state.players.filter(player => !player.leftAt);
  const [profiles, room] = await Promise.all([
    readGameChatProfiles(players.map(player => player.memberId)),
    readGameNoticeRoom(gameId, players.map(player => player.memberId), game.chatContainerMemberId),
  ]);
  const shared = pendingGameChangeView(current.state, proposal, current.now)!;
  const message = buildGameProposalInstructions(shared, {
    proposerName: profiles.find(profile => profile.memberId === proposal.proposedByMemberId)?.firstName ?? "A player",
    recipientName: "the remaining players", lengthDays: game.lengthDays, group: true, room,
  });
  return enqueueProposal(gameId, shared, game.chatContainerMemberId, message, audience);
}

async function prepareGameChatPlayers(game: Game & { players: GamePlayer[] }, proposal: GamePendingChange): Promise<{ phones: string[]; message: string }> {
  const prisma = getPrisma();
  const players = game.players.filter(hasGameIdentity);
  const allowedPlayers = await prisma.hostedMember.count({ where: { id: { in: players.map((player) => player.memberId) }, suspendedAt: null } });
  if (allowedPlayers !== 2) throw new Error("Game chat players are unavailable.");
  const identities = await Promise.all(players.map((player) => readHostedMemberIdentity({ memberId: player.memberId, prisma })));
  const phones = identities.flatMap((identity) => identity?.phoneNumberVerifiedAt && identity.phoneNumber ? [identity.phoneNumber] : []);
  if (!isPairRoster(phones) || new Set(phones).size !== phones.length) throw new Error("Game chat requires both players' verified phone numbers.");
  const profiles = await prisma.gameProfile.findMany({ where: { memberId: { in: players.map((player) => player.memberId) } }, select: { memberId: true, firstNameEncrypted: true }, take: 2 });
  const names = await openGameTexts(profiles.map((profile) => ({ table: "game_profile" as const, field: "first_name", rowId: profile.memberId, memberId: profile.memberId, value: profile.firstNameEncrypted })));
  const nameFor = (memberId: string) => names[profiles.findIndex((profile) => profile.memberId === memberId)] ?? "Your opponent";
  const other = players.find((player) => player.memberId !== proposal.proposedByMemberId)!;
  const { readGameNoticeRoom } = await import("./service");
  const room = await readGameNoticeRoom(game.id, players.map((player) => player.memberId));
  const message = buildGameProposalInstructions(proposal, { proposerName: nameFor(proposal.proposedByMemberId), recipientName: nameFor(other.memberId), lengthDays: game.lengthDays, room });
  return { phones, message };
}

/** Revalidate the audience outside the existing provider dispatch transaction. */
export async function readGameProposalDeliveryPlayers(key: string | null, containerMemberId: string, target?: string | null): Promise<readonly string[] | GameChatAudience | undefined> {
  const match = /^(game-talk|game-change|game-started|game-rematch|game-change-cancelled|game-change-expired|game-change-resolved|game-cancelled|game-recap|game-missed|game-challenge):([^:]+)/.exec(key ?? "");
  if (!match) return undefined;
  const game = await getPrisma().game.findUnique({ where: { id: match[2] }, include: { invitees: { select: { memberId: true, recipientLookupKey: true } }, players: { take: 11 } } });
  if (game?.maxPlayers !== 10) return requireExactGameChat(containerMemberId);
  const audience = await readGroupGameChatAuthority(game, containerMemberId);
  if (!audience || game.chatContainerMemberId !== containerMemberId || target != null && audience.threadId !== target) throw new Error("Game delivery audience changed.");
  return audience;
}


async function enqueueProposal(gameId: string, proposal: GamePendingChange, containerMemberId: string, message: string, audience?: GameChatAudience): Promise<boolean> {
  const prisma = getPrisma();
  const key = `game-change:${gameId}:${proposal.id}`;
  const existing = await readHostedMailboxItemByDedupeKey({ dedupeKey: key, userId: containerMemberId, prisma });
  if (existing) {
    await markGameChatGenerationQueuedTx(key, prisma);
    if (existing.consumedAt === null) await signalHostedMailboxAppendRuntime({ expectedUserId: containerMemberId, mailboxItemId: existing.id });
    return true;
  }
  const destination = await resolveHostedAssistantNotificationDestination({ memberId: containerMemberId, prisma });
  if (!destination || destination.conversationShape !== "thread-container" || destination.route.channel !== "linq") throw new Error("Game chat delivery route is unavailable.");
  const bound = bindHostedAssistantNotificationDestination({ destination, memberId: containerMemberId });
  const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma, envelope: buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: key, memberId: containerMemberId, occurredAt: new Date().toISOString(),
    notification: { ...bound, instructions: message, responsePolicy: { kind: "require_send" }, deliveryDedupeToken: key, deliveryIdempotencyKey: key, deliveryDispatchMode: "queue-only" },
  }) });
  const appended = await prisma.$transaction(async (tx) => {
    if (bound.externalThreadRouteAuthority) await assertHostedAssistantNotificationRouteAuthority({ authority: bound.externalThreadRouteAuthority, prisma: tx });
    if (audience) await assertGameProposalDeliveryCurrentTx({ deliveryIdempotencyKey: key, containerMemberId, audience, tx });
    // Only update delivery metadata. A hydrated proposal can contain task and
    // stake words; rewriting it would replace their sealed canonical storage.
    const changed = await tx.$executeRaw`UPDATE game
      SET pending_change = jsonb_set(pending_change, '{deliveryStatus}', '"queued"'::jsonb)
      WHERE id = ${gameId} AND (status = 'live' OR (status = 'negotiating'
          AND (invite_expires_at IS NULL OR invite_expires_at > CURRENT_TIMESTAMP)))
        AND chat_container_member_id = ${containerMemberId}
        AND pending_change->>'id' = ${proposal.id}`;
    if (changed !== 1) return null;
    const result = await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
    await markGameChatGenerationQueuedTx(key, tx);
    return result;
  });
  if (appended) await signalHostedMailboxAppendRuntime({ expectedUserId: containerMemberId, mailboxItemId: appended.mailboxItemId });
  return appended !== null;
}
