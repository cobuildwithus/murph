import "server-only";

import type { Game, GamePlayer, Prisma } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxItemByDedupeKey } from "../hosted-mailbox/store";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { assertHostedAssistantNotificationRouteAuthority, bindHostedAssistantNotificationDestination, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { getPrisma } from "../prisma";
import { readPendingGameChange } from "./change-words";
import { isGameEnabledFor } from "./access";
import type { GamePendingChange } from "./contract";
import { buildGameProposalInstructions } from "@murphai/hosted-execution/runtime-control";
export { buildGameProposalInstructions } from "@murphai/hosted-execution/runtime-control";
import { openGameTexts } from "./crypto";

import { findExistingGameChat, requireExactChat, requireExactGameChat } from "./chat-membership";
export { isExactGameChat, requireExactGameChat } from "./chat-membership";
import { prepareGameChatBootstrap } from "./chat-bootstrap";
import { markGameChatGenerationQueuedTx } from "./chat-lifecycle-receipt";

/** Called after the game transaction. All provider and crypto work stays outside game locks. */
export async function deliverGameChangeProposal(gameId: string, proposalId: string): Promise<boolean> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { players: { orderBy: { seat: "asc" }, take: 3 } } });
  const proposal = game ? await readPendingGameChange(game) : null;
  if (!game || !["live", "negotiating"].includes(game.status) || !proposal || proposal.id !== proposalId || game.players.length !== 2) return false;
  if (!game.players.every((player) => isGameEnabledFor(player.memberId))) return false;
  if (proposal.deliveryStatus === "sent") return true;
  if (proposal.origin === "chat") return false;
  const { phones, message } = await prepareGameChatPlayers(game, proposal);
  // A bound chat can never silently drift to an audience with additional people.
  let containerMemberId = game.chatContainerMemberId;
  if (containerMemberId) {
    const destination = await resolveHostedAssistantNotificationDestination({ memberId: containerMemberId, prisma });
    if (!destination) {
      return (await prepareGameChatBootstrap(gameId, `game-change:${gameId}:${proposal.id}`, message)) !== null;
    }
    await requireExactChat(containerMemberId, phones);
  } else {
    containerMemberId = await findExistingGameChat(game.players.map((player) => player.memberId), phones);
    if (containerMemberId) {
      const bound = await prisma.game.updateMany({ where: pendingWhere(gameId, proposalId, null), data: { chatContainerMemberId: containerMemberId } });
      if (bound.count !== 1) return false;
    } else {
      return (await prepareGameChatBootstrap(gameId, `game-change:${gameId}:${proposal.id}`, message)) !== null;
    }
  }
  return enqueueProposal(gameId, proposal, containerMemberId, message);
}

async function prepareGameChatPlayers(game: Game & { players: GamePlayer[] }, proposal: GamePendingChange): Promise<{ phones: string[]; message: string }> {
  const prisma = getPrisma();
  const players = game.players;
  const allowedPlayers = await prisma.hostedMember.count({ where: { id: { in: players.map((player) => player.memberId) }, suspendedAt: null } });
  if (allowedPlayers !== 2) throw new Error("Game chat players are unavailable.");
  const identities = await Promise.all(players.map((player) => readHostedMemberIdentity({ memberId: player.memberId, prisma })));
  const phones = identities.flatMap((identity) => identity?.phoneNumberVerifiedAt && identity.phoneNumber ? [identity.phoneNumber] : []);
  if (phones.length !== 2 || new Set(phones).size !== 2) throw new Error("Game chat requires both players' verified phone numbers.");
  const profiles = await prisma.gameProfile.findMany({ where: { memberId: { in: players.map((player) => player.memberId) } }, select: { memberId: true, firstNameEncrypted: true }, take: 2 });
  const names = await openGameTexts(profiles.map((profile) => ({ table: "game_profile" as const, field: "first_name", rowId: profile.memberId, memberId: profile.memberId, value: profile.firstNameEncrypted })));
  const nameFor = (memberId: string) => names[profiles.findIndex((profile) => profile.memberId === memberId)] ?? "Your opponent";
  const other = players.find((player) => player.memberId !== proposal.proposedByMemberId)!;
  const message = buildGameProposalInstructions(proposal, { proposerName: nameFor(proposal.proposedByMemberId), recipientName: nameFor(other.memberId), lengthDays: game.lengthDays });
  return { phones, message };
}

function pendingWhere(gameId: string, proposalId: string, containerMemberId?: string | null): Prisma.GameWhereInput {
  return { id: gameId, status: { in: ["live", "negotiating"] }, ...(containerMemberId === undefined ? {} : { chatContainerMemberId: containerMemberId }), pendingChange: { path: ["id"], equals: proposalId } };
}


/** Revalidate the audience outside the existing provider dispatch transaction. */
export async function readGameProposalDeliveryPlayers(key: string | null, containerMemberId: string): Promise<readonly string[] | undefined> {
  return /^(game-change|game-started|game-change-cancelled):/.test(key ?? "") ? requireExactGameChat(containerMemberId) : undefined;
}


async function enqueueProposal(gameId: string, proposal: GamePendingChange, containerMemberId: string, message: string): Promise<boolean> {
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
    // Only update delivery metadata. A hydrated proposal can contain task and
    // stake words; rewriting it would replace their sealed canonical storage.
    const changed = await tx.$executeRaw`UPDATE game
      SET pending_change = jsonb_set(pending_change, '{deliveryStatus}', '"queued"'::jsonb)
      WHERE id = ${gameId} AND status IN ('live', 'negotiating')
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
