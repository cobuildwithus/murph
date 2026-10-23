import "server-only";
import type { Game, HostedLinqDelivery, Prisma, PrismaClient } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { buildGameKickoffInstructions, buildGameChangeCancelledInstructions, buildGameInviteCancelledInstructions } from "@murphai/hosted-execution/runtime-control";
import { getPrisma } from "../prisma";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxItemByDedupeKey } from "../hosted-mailbox/store";
import { assertHostedAssistantNotificationRouteAuthority, bindHostedAssistantNotificationDestination, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { findExistingGameChat, requireExactChat } from "./chat-membership";
import { prepareGameChatBootstrap, reconcileFrozenGameChatBootstrapReceipt } from "./chat-bootstrap";
import { gameChatLifecycleEventId, markGameChatGenerationQueuedTx, type GameChatLifecycleKind } from "./chat-lifecycle-receipt";
import { isGameEnabledFor } from "./access";
import { parsePendingGameChange } from "./changes";
import { deliverGameChangeProposal } from "./chat-delivery";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";

// One discovery (20 × 3s plus one 3s recheck) and one frozen recovery
// (10s create + 3s roster check) cap provider wait at 76s per 180s cron.
// Database/crypto work remains outside those provider calls and short locks.
const LIFECYCLE_BATCH = 1;

/** The existing minute sweep recovers accepted intent even if the app never returns. */
export async function drainGameChatLifecycle(input: { prisma?: PrismaClient; now?: Date; signal?: AbortSignal } = {}): Promise<{ attempted: number; queued: number; deferred: number }> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const pending = await prisma.hostedLinqDelivery.findMany({
    where: { source: "game_lifecycle", OR: [
      { status: "awaiting_generation", OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
      { status: "generation_queued", retryAfterAt: { lte: now } },
    ] },
    orderBy: [{ attemptedAt: "asc" }, { id: "asc" }], take: LIFECYCLE_BATCH,
    select: { id: true, sourceRef: true, template: true, attemptedAt: true, idempotencyKey: true, status: true },
  });
  let queued = 0;
  let attempted = 0;
  for (const receipt of pending) {
    if (input.signal?.aborted) break;
    if (!["game_started", "game_proposal", "game_change_cancelled", "game_cancelled"].includes(receipt.template ?? "") || !receipt.sourceRef) continue;
    const claimed = await prisma.hostedLinqDelivery.updateMany({
      where: { id: receipt.id, source: "game_lifecycle", status: receipt.status, attemptedAt: receipt.attemptedAt,
        OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
      data: { attemptedAt: now, retryAfterAt: new Date(now.getTime() + 60_000) },
    });
    if (claimed.count !== 1) continue;
    attempted += 1;
    try {
      if (await processGameChatIntent(receipt, now, prisma)) queued += 1;
    } catch {
      // The reserved receipt and retry time remain durable. Provider/model work
      // never rolls back the accepted challenge and never logs shared words.
    }
  }
  const frozen = await prisma.hostedLinqDelivery.findMany({
    where: { source: "game_lifecycle", payloadSchema: "game_chat_bootstrap_v1", bootstrapRouteAttachedAt: null,
      skippedAt: null, OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
    orderBy: [{ attemptedAt: "asc" }, { id: "asc" }], take: LIFECYCLE_BATCH,
    select: { id: true, attemptedAt: true },
  });
  for (const receipt of frozen) {
    if (input.signal?.aborted) break;
    const claimed = await prisma.hostedLinqDelivery.updateMany({
      where: { id: receipt.id, source: "game_lifecycle", payloadSchema: "game_chat_bootstrap_v1",
        bootstrapRouteAttachedAt: null, skippedAt: null, attemptedAt: receipt.attemptedAt,
        OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
      data: { attemptedAt: now, retryAfterAt: new Date(now.getTime() + 60_000) },
    });
    if (claimed.count !== 1) continue;
    attempted += 1;
    try {
      if (await reconcileFrozenGameChatBootstrapReceipt(receipt.id)) queued += 1;
    } catch {
      // Frozen text and provider identity stay authoritative on the next sweep.
    }
  }
  return { attempted, queued, deferred: attempted - queued };
}

type GameChatIntent = Pick<HostedLinqDelivery, "id" | "sourceRef" | "template" | "status" | "idempotencyKey">;

async function processGameChatIntent(receipt: GameChatIntent, now: Date, prisma: PrismaClient): Promise<boolean> {
  if (receipt.template === "game_change_cancelled") {
    const parts = /^([^:]+):([^:]+)$/.exec(receipt.sourceRef ?? "");
    if (!parts) return false;
    const [, gameId, proposalId] = parts;
    const eventId = gameChatLifecycleEventId(gameId, "change_cancelled", proposalId);
    return receipt.status === "generation_queued"
      ? recoverGameNotificationWake(receipt.id, gameId, eventId, now)
      : deliverGameChatLifecycle(gameId, "change_cancelled", proposalId);
  }
  const gameId = receipt.sourceRef;
  if (!gameId) return false;
  if (receipt.template !== "game_proposal") {
    const kind = receipt.template === "game_cancelled" ? "cancelled" : "started";
    return receipt.status === "generation_queued"
      ? recoverGameNotificationWake(receipt.id, gameId, gameChatLifecycleEventId(gameId, kind), now)
      : deliverGameChatLifecycle(gameId, kind);
  }
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { pendingChange: true, status: true } });
  const pending = parsePendingGameChange(game?.pendingChange);
  const eventId = pending ? `game-change:${gameId}:${pending.id}` : null;
  const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  if (!game || !["live", "negotiating"].includes(game.status) || !pending || pending.origin === "chat" || key !== receipt.idempotencyKey) {
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receipt.id, status: receipt.status }, data: { status: "skipped", skippedAt: now, skipReason: "game_proposal_superseded" } });
    return false;
  }
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, gameId, eventId!, now)
    : deliverGameChangeProposal(gameId, pending.id);
}

/** Publishing and the first signal can fail separately; retry the pointer only. */
async function recoverGameNotificationWake(receiptId: string, gameId: string, eventId: string, now: Date): Promise<boolean> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { chatContainerMemberId: true, status: true } });
  const kind = eventId.startsWith("game-cancelled:") ? "cancelled" : eventId.startsWith("game-started:") ? "started" : "change_cancelled";
  if (!game || !lifecycleStatuses(kind).includes(game.status)) {
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receiptId, status: "generation_queued" }, data: { status: "skipped", skippedAt: now, skipReason: "game_lifecycle_superseded", retryAfterAt: null } });
    return false;
  }
  if (!game.chatContainerMemberId) return false;
  const mailbox = await readHostedMailboxItemByDedupeKey({ dedupeKey: eventId, userId: game.chatContainerMemberId, prisma });
  if (!mailbox) return false;
  if (mailbox.consumedAt !== null) {
    // Consumption hands retry ownership to the existing runtime/outbox. Keep
    // provider truth intact and stop this pre-generation wake sweep.
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receiptId, status: "generation_queued" }, data: { retryAfterAt: null } });
  } else {
    await signalHostedMailboxAppendRuntime({ expectedUserId: game.chatContainerMemberId, mailboxItemId: mailbox.id });
  }
  return true;
}

function lifecycleStatuses(kind: GameChatLifecycleKind): string[] {
  return kind === "cancelled" ? ["void"] : kind === "started" ? ["live"] : ["live", "negotiating"];
}

export async function deliverGameChatLifecycle(gameId: string, kind: GameChatLifecycleKind, proposalId?: string): Promise<boolean> {
  const prisma = getPrisma();
  const eventId = gameChatLifecycleEventId(gameId, kind, proposalId);
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { players: { select: { memberId: true }, take: 3 } } });
  const statuses = lifecycleStatuses(kind);
  if (!game || !statuses.includes(game.status) || game.players.length !== 2) {
    await prisma.hostedLinqDelivery.updateMany({ where: { source: "game_lifecycle", sourceRef: kind === "change_cancelled" ? `${gameId}:${proposalId}` : gameId, template: `game_${kind}`, status: "awaiting_generation" }, data: { status: "skipped", skippedAt: new Date(), skipReason: "game_lifecycle_superseded" } });
    return false;
  }
  if (!game.players.every((player) => isGameEnabledFor(player.memberId))) return false;
  const players = game.players.map((player) => player.memberId);
  // Cancellation needs no private words or shared projection (void games are
  // absent there), and must never discover or create a new chat.
  if (kind === "cancelled" && !game.chatContainerMemberId) return false;
  const instructions = await lifecycleInstructions(game, kind, players);
  if (!instructions) return false;
  const identities = await Promise.all(players.map((memberId) => readHostedMemberIdentity({ memberId, prisma })));
  const phones = identities.flatMap((identity) => identity?.phoneNumberVerifiedAt && identity.phoneNumber ? [identity.phoneNumber] : []);
  if (phones.length !== 2 || new Set(phones).size !== 2) throw new Error("Game chat requires verified players.");
  let containerMemberId = game.chatContainerMemberId;
  if (!containerMemberId) {
    containerMemberId = await findExistingGameChat(players, phones);
    if (containerMemberId) {
      const bound = await prisma.game.updateMany({ where: { id: gameId, status: { in: statuses }, chatContainerMemberId: null }, data: { chatContainerMemberId: containerMemberId } });
      if (bound.count !== 1) return false;
    }
  }
  const destination = containerMemberId ? await resolveHostedAssistantNotificationDestination({ memberId: containerMemberId, prisma }) : null;
  if (!destination) return kind === "cancelled" ? false : (await prepareGameChatBootstrap(gameId, eventId, instructions)) !== null;
  if (destination.conversationShape !== "thread-container" || destination.route.channel !== "linq") throw new Error("Game chat route is unavailable.");
  await requireExactChat(containerMemberId!, phones);
  return enqueueGameLifecycle({ containerMemberId: containerMemberId!, gameId, kind, eventId, instructions, destination });
}

/** Read shared context only for notices that actually describe game terms. */
async function lifecycleInstructions(game: Pick<Game, "id" | "chatContainerMemberId">, kind: GameChatLifecycleKind, players: readonly string[]): Promise<string | null> {
  if (kind === "cancelled") return buildGameInviteCancelledInstructions();
  const { readGameChatState } = await import("./service");
  const state = await readGameChatState(game.chatContainerMemberId ?? "", players);
  const shared = state.games.find((candidate) => candidate.id === game.id);
  if (!shared || !lifecycleStatuses(kind).includes(shared.status)) return null;
  return kind === "started" ? buildGameKickoffInstructions({ kind, game: shared }) : buildGameChangeCancelledInstructions();
}

async function enqueueGameLifecycle(input: {
  containerMemberId: string; gameId: string; kind: GameChatLifecycleKind; eventId: string; instructions: string;
  destination: NonNullable<Awaited<ReturnType<typeof resolveHostedAssistantNotificationDestination>>>;
}): Promise<boolean> {
  const prisma = getPrisma();
  const existing = await readHostedMailboxItemByDedupeKey({ dedupeKey: input.eventId, userId: input.containerMemberId, prisma });
  if (existing) {
    await markGameChatGenerationQueuedTx(input.eventId, prisma);
    if (existing.consumedAt === null) await signalHostedMailboxAppendRuntime({ expectedUserId: input.containerMemberId, mailboxItemId: existing.id });
    return true;
  }
  const bound = bindHostedAssistantNotificationDestination({ destination: input.destination, memberId: input.containerMemberId });
  const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma, envelope: buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.eventId, memberId: input.containerMemberId, occurredAt: new Date().toISOString(),
    notification: { ...bound, instructions: input.instructions, responsePolicy: { kind: "require_send" }, deliveryDedupeToken: input.eventId, deliveryIdempotencyKey: input.eventId, deliveryDispatchMode: "queue-only" },
  }) });
  const appended = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (bound.externalThreadRouteAuthority) await assertHostedAssistantNotificationRouteAuthority({ authority: bound.externalThreadRouteAuthority, prisma: tx });
    const current = await tx.game.findFirst({ where: { id: input.gameId, status: { in: lifecycleStatuses(input.kind) }, chatContainerMemberId: input.containerMemberId }, select: { id: true } });
    if (!current) return null;
    const result = await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
    await markGameChatGenerationQueuedTx(input.eventId, tx);
    return result;
  });
  if (!appended) return false;
  await signalHostedMailboxAppendRuntime({ expectedUserId: input.containerMemberId, mailboxItemId: appended.mailboxItemId });
  return true;
}
