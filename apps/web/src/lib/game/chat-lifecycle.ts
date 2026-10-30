import "server-only";
import type { Game, HostedLinqDelivery, Prisma, PrismaClient } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { buildGameKickoffInstructions, buildGameRematchInstructions, buildGameChangeCancelledInstructions, buildGameChangeExpiredInstructions, buildGameInviteCancelledInstructions } from "@murphai/hosted-execution/runtime-control";
import { isRecord } from "../primitives";
import { getPrisma } from "../prisma";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxItemByDedupeKey } from "../hosted-mailbox/store";
import { assertHostedAssistantNotificationRouteAuthority, bindHostedAssistantNotificationDestination, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { findExistingGameChat, requireExactChat } from "./chat-membership";
import { prepareGameChatBootstrap, reconcileFrozenGameChatBootstrapReceipt } from "./chat-bootstrap";
import { gameChatLifecycleEventId, markGameChatGenerationQueuedTx, type GameChatLifecycleKind } from "./chat-lifecycle-receipt";
import { isGameOn } from "./access";
import { parsePendingGameChange } from "./changes";
import { deliverGameChangeProposal } from "./chat-delivery";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { isGameInviteExpired } from "./rules";

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
    if (!["game_started", "game_rematch", "game_proposal", "game_change_cancelled", "game_change_expired", "game_cancelled"].includes(receipt.template ?? "") || !receipt.sourceRef) continue;
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
  if (receipt.template === "game_change_cancelled" || receipt.template === "game_change_expired") {
    const kind = receipt.template === "game_change_expired" ? "change_expired" : "change_cancelled";
    const parts = /^([^:]+):([^:]+)$/.exec(receipt.sourceRef ?? "");
    if (!parts) return false;
    const [, gameId, proposalId] = parts;
    const eventId = gameChatLifecycleEventId(gameId, kind, proposalId);
    return receipt.status === "generation_queued"
      ? recoverGameNotificationWake(receipt.id, gameId, eventId, now)
      : deliverGameChatLifecycle(gameId, kind, proposalId, now);
  }
  const gameId = receipt.sourceRef;
  if (!gameId) return false;
  if (receipt.template === "game_proposal") return processGameProposalIntent(receipt, gameId, now, prisma);
  const kind = receipt.template === "game_cancelled" ? "cancelled" : receipt.template === "game_rematch" ? "rematch" : "started";
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, gameId, gameChatLifecycleEventId(gameId, kind), now)
    : deliverGameChatLifecycle(gameId, kind, undefined, now);
}

async function processGameProposalIntent(receipt: GameChatIntent, gameId: string, now: Date, prisma: PrismaClient): Promise<boolean> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { inviteExpiresAt: true, pendingChange: true, status: true } });
  const pending = parsePendingGameChange(game?.pendingChange);
  const eventId = pending ? `game-change:${gameId}:${pending.id}` : null;
  const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  if (!game || !["live", "negotiating"].includes(game.status) || isGameInviteExpired(game, now)
    || !pending || pending.origin === "chat" || key !== receipt.idempotencyKey) {
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receipt.id, status: receipt.status }, data: { status: "skipped", skippedAt: now, skipReason: "game_proposal_superseded", retryAfterAt: null } });
    return false;
  }
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, gameId, eventId!, now)
    : deliverGameChangeProposal(gameId, pending.id, now);
}

/** Publishing and the first signal can fail separately; retry the pointer only. */
async function recoverGameNotificationWake(receiptId: string, gameId: string, eventId: string, now: Date): Promise<boolean> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { chatContainerMemberId: true, inviteExpiresAt: true, status: true } });
  const kind = eventId.startsWith("game-cancelled:") ? "cancelled" : eventId.startsWith("game-started:") ? "started" : eventId.startsWith("game-rematch:") ? "rematch" : eventId.startsWith("game-change-expired:") ? "change_expired" : "change_cancelled";
  const pendingInviteNotice = eventId.startsWith("game-rematch:") || eventId.startsWith("game-change:");
  if (!game || !lifecycleStatuses(kind).includes(game.status) || (pendingInviteNotice && isGameInviteExpired(game, now))) {
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
  return kind === "rematch" ? ["invited"] : kind === "change_expired" ? ["live", "negotiating", "settled", "void"] : kind === "cancelled" ? ["void"] : kind === "started" ? ["live"] : ["live", "negotiating"];
}

type GameChatLifecycleRecord = Game & { players: Array<{ memberId: string }> };

function lifecyclePlayerMemberIds(game: GameChatLifecycleRecord | null, kind: GameChatLifecycleKind): string[] {
  if (kind !== "rematch") return game?.players.map((player) => player.memberId) ?? [];
  if (!game?.createdBy || !game.inviteeMemberId || game.players.length !== 1 || game.players[0]?.memberId !== game.createdBy) return [];
  return [game.createdBy, game.inviteeMemberId];
}

function isCurrentGameChatLifecycle(
  game: GameChatLifecycleRecord | null,
  kind: GameChatLifecycleKind,
  statuses: readonly string[],
  players: readonly string[],
  now: Date,
): game is GameChatLifecycleRecord {
  return Boolean(game && statuses.includes(game.status)
    && (kind !== "rematch" || !isGameInviteExpired(game, now))
    && players.length === 2 && new Set(players).size === 2);
}

export async function deliverGameChatLifecycle(gameId: string, kind: GameChatLifecycleKind, proposalId?: string, now = new Date()): Promise<boolean> {
  const prisma = getPrisma();
  const eventId = gameChatLifecycleEventId(gameId, kind, proposalId);
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { players: { select: { memberId: true }, take: 3 } } });
  const statuses = lifecycleStatuses(kind);
  const boundOnly = ["rematch", "cancelled", "change_expired"].includes(kind);
  const players = lifecyclePlayerMemberIds(game, kind);
  if (!isCurrentGameChatLifecycle(game, kind, statuses, players, now)) {
    await prisma.hostedLinqDelivery.updateMany({ where: { source: "game_lifecycle", sourceRef: kind.startsWith("change_") ? `${gameId}:${proposalId}` : gameId, template: `game_${kind}`, status: "awaiting_generation" }, data: { status: "skipped", skippedAt: now, skipReason: "game_lifecycle_superseded", retryAfterAt: null } });
    return false;
  }
  if (!isGameOn(game)) return false;
  // Cancellation needs no private words or shared projection (void games are
  // absent there), and must never discover or create a new chat.
  if (boundOnly && !game.chatContainerMemberId) return false;
  const instructions = await lifecycleInstructions(game, kind, players, proposalId);
  if (!instructions) return false;
  return deliverCurrentGameChatLifecycle({ boundOnly, eventId, game, gameId, instructions, kind, players, prisma, statuses });
}

async function deliverCurrentGameChatLifecycle(input: {
  boundOnly: boolean;
  eventId: string;
  game: GameChatLifecycleRecord;
  gameId: string;
  instructions: string;
  kind: GameChatLifecycleKind;
  players: readonly string[];
  prisma: PrismaClient;
  statuses: string[];
}): Promise<boolean> {
  const { boundOnly, eventId, game, gameId, instructions, kind, players, prisma, statuses } = input;
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
  if (!destination) return boundOnly ? false : (await prepareGameChatBootstrap(gameId, eventId, instructions)) !== null;
  if (destination.conversationShape !== "thread-container" || destination.route.channel !== "linq") throw new Error("Game chat route is unavailable.");
  await requireExactChat(containerMemberId!, phones);
  return enqueueGameLifecycle({ containerMemberId: containerMemberId!, gameId, kind, eventId, instructions, destination });
}

/** Read shared context only for notices that actually describe game terms. */
async function lifecycleInstructions(game: Pick<Game, "id" | "chatContainerMemberId">, kind: GameChatLifecycleKind, players: readonly string[], proposalId?: string): Promise<string | null> {
  if (kind === "cancelled") return buildGameInviteCancelledInstructions();
  if (kind === "rematch") {
    const { readGameRematchNotice } = await import("./service");
    const notice = await readGameRematchNotice(game.id, players);
    return notice ? buildGameRematchInstructions(notice) : null;
  }
  if (kind === "change_expired") {
    const event = await getPrisma().gameEvent.findUnique({ where: { commandKey: `game-change-resolved:${game.id}:${proposalId}` }, select: { type: true, payload: true } });
    return event?.type === "change_expired" && isRecord(event.payload) && typeof event.payload.reason === "string"
      ? buildGameChangeExpiredInstructions(event.payload.reason) : null;
  }
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
    const current = await tx.game.findFirst({ where: { id: input.gameId, status: { in: lifecycleStatuses(input.kind) }, chatContainerMemberId: input.containerMemberId },
      select: { id: true, inviteExpiresAt: true, status: true } });
    if (!current || (input.kind === "rematch" && isGameInviteExpired(current, new Date()))) return null;
    const result = await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
    await markGameChatGenerationQueuedTx(input.eventId, tx);
    return result;
  });
  if (!appended) return false;
  await signalHostedMailboxAppendRuntime({ expectedUserId: input.containerMemberId, mailboxItemId: appended.mailboxItemId });
  return true;
}
