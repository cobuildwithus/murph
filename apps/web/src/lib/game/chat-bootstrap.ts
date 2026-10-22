import "server-only";

import { Prisma } from "@prisma/client";
import * as z from "@murphai/contracts/zod-runtime";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import type { HostedGameChatBootstrapRequest, HostedGameChatBootstrapResponse } from "@murphai/hosted-execution/runtime-control";
import { runWithHostedDomainRootProviderCallsDisabled, runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { openHostedUserSecureBoxString, sealHostedUserSecureBoxString } from "../hosted-crypto/secure-box";
import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { appendHostedMailboxEnvelopeTx, appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxItemByDedupeKey, readHostedMailboxWakeByDedupeKey } from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { createHostedLinqChat, getHostedLinqChatSummary, validateHostedLinqChatFirstMessage } from "../hosted-onboarding/linq-client";
import { buildHostedLinqDeliveryId, claimHostedLinqDeliveryProviderDispatchTx, markHostedLinqDeliveryAcceptedTx } from "../hosted-onboarding/linq-delivery-store";
import { claimHostedLinqProactiveConversationCapacityTx, listHostedLinqHealthyProactiveLines } from "../hosted-onboarding/linq-line-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { createHostedLinqParticipantContactLookupKey } from "../hosted-onboarding/linq-participant-contact";
import { attachHostedThreadContainerBootstrapRouteTx, createHostedGameThreadContainerTx, prepareHostedThreadContainerBootstrap, prepareHostedThreadContainerDeliveryRoute } from "../hosted-routing/thread-container-service";
import { getPrisma } from "../prisma";
import { isExactGameChat } from "./chat-membership";
import { parsePendingGameChange } from "./changes";
import { isGameEnabledFor } from "./access";
import { markGameChatGenerationQueuedTx } from "./chat-lifecycle-receipt";

const PAYLOAD_SCHEMA = "game_chat_bootstrap_v1";
const frozenBootstrapSchema = z.object({
  gameId: z.string().min(1), eventId: z.string().min(1), from: z.string().min(1), to: z.array(z.string().min(1)).length(2),
  message: z.string().min(1).max(16_000), accountLookupKey: z.string().min(1),
  chatId: z.string().min(1).optional(), messageId: z.string().nullable().optional(), acceptedAt: z.string().datetime().optional(),
}).strict();
type FrozenBootstrap = z.infer<typeof frozenBootstrapSchema>;
type FrozenReceipt = { id: string; payload: FrozenBootstrap; skipped?: boolean };
type BootstrapReceipt = FrozenReceipt | { id: string; skipped: true };
type ControlInput = { memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; request: HostedGameChatBootstrapRequest };

/** Shared workspace and accepted work commit together, before any model/provider call. */
export async function prepareGameChatBootstrap(gameId: string, eventId: string, instructions: string): Promise<string | null> {
  return runWithHostedDomainRootUnwrapCache(async () => {
    const prisma = getPrisma();
    const game = await readBootstrapGame(gameId);
    if (!game || !bootstrapEventCurrent(game, eventId)) return null;
    if (game.chatContainerMemberId) return queueExistingBootstrap(gameId, eventId, instructions, game.chatContainerMemberId);
    const phones = await readPlayerPhones(game.players.map((player) => player.memberId));
    const prepared = await prepareHostedThreadContainerBootstrap({ prisma });
    const now = new Date();
    const result = await prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await lockGame(tx, gameId);
      const current = await tx.game.findUnique({ where: { id: gameId }, include: { players: { select: { memberId: true, seat: true }, orderBy: { seat: "asc" }, take: 3 } } });
      if (!current || !bootstrapEventCurrent(current, eventId) || !samePlayers(current.players, game.players)) return null;
      if (current.chatContainerMemberId) return null;
      const created = await createHostedGameThreadContainerTx({ gameId, ownerMemberId: game.players[0]!.memberId, occurredAt: now, prepared, prisma: tx });
      await tx.hostedThreadContainerParticipant.createMany({ data: game.players.map((player, index) => {
        const handleLookupKey = createHostedLinqParticipantContactLookupKey({ kind: "phone", value: phones[index]! });
        if (!handleLookupKey) throw new TypeError("Game player identity is unavailable.");
        return { containerMemberId: created.containerMemberId, participantMemberId: player.memberId, handleLookupKey, firstSeenAt: now, lastSeenAt: now };
      }) });
      await tx.game.update({ where: { id: gameId }, data: { chatContainerMemberId: created.containerMemberId } });
      const appended = await appendHostedMailboxEnvelopeTx({ tx, envelope: buildBootstrapWake(gameId, eventId, instructions, created.containerMemberId, now) });
      await markGameChatGenerationQueuedTx(eventId, tx, created.containerMemberId);
      return { containerMemberId: created.containerMemberId, mailboxIds: [created.activationMailboxItemId, appended.item.id] };
    }));
    if (!result) return null;
    for (const mailboxItemId of result.mailboxIds) await signalHostedMailboxAppendRuntime({ expectedUserId: result.containerMemberId, mailboxItemId });
    return result.containerMemberId;
  });
}

function buildBootstrapWake(gameId: string, eventId: string, instructions: string, memberId: string, occurredAt: Date) {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId, memberId, occurredAt: occurredAt.toISOString(),
    notification: {
      gameChatBootstrap: { gameId, eventId }, instructions, responsePolicy: { kind: "require_send" },
      deliveryDedupeToken: eventId, deliveryIdempotencyKey: eventId, deliveryDispatchMode: "immediate",
      route: { channel: "linq", actorId: null, identityId: memberId, threadId: null, threadIsDirect: false, delivery: { kind: "bootstrap", target: memberId } },
    },
  });
}
function readOtherFrozenBootstrap(memberId: string, eventId: string, prisma: Prisma.TransactionClient = getPrisma()) {
  const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  return prisma.hostedLinqDelivery.findFirst({
    where: { payloadOwnerMemberId: memberId, payloadSchema: PAYLOAD_SCHEMA, bootstrapRouteAttachedAt: null, skippedAt: null, NOT: { idempotencyKey: key } },
    select: { id: true },
  });
}
function readOtherPendingBootstrap(game: { id: string; status: string; pendingChange: unknown }, memberId: string, eventId: string, prisma: Prisma.TransactionClient) {
  const proposal = parsePendingGameChange(game.pendingChange);
  const keys = [...(game.status === "live" ? [`game-started:${game.id}`] : []), ...(proposal ? [`game-change:${game.id}:${proposal.id}`] : [])].filter((key) => key !== eventId);
  return prisma.hostedMailboxItem.findFirst({ where: { userId: memberId, kind: "assistant.notification.requested", consumedAt: null, dedupeKey: { in: keys } }, select: { id: true } });
}
async function queueExistingBootstrap(gameId: string, eventId: string, instructions: string, containerMemberId: string): Promise<string | null> {
  const prisma = getPrisma();
  if (await readOtherFrozenBootstrap(containerMemberId, eventId)) return null;
  const existing = await readHostedMailboxItemByDedupeKey({ dedupeKey: eventId, userId: containerMemberId, prisma });
  if (existing) {
    if (existing.consumedAt === null) await signalHostedMailboxAppendRuntime({ expectedUserId: containerMemberId, mailboxItemId: existing.id });
    return containerMemberId;
  }
  const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma, envelope: buildBootstrapWake(gameId, eventId, instructions, containerMemberId, new Date()) });
  const appended = await prisma.$transaction(async (tx) => {
    await lockGame(tx, gameId);
    const game = await tx.game.findUnique({ where: { id: gameId }, include: { players: { select: { memberId: true }, take: 3 } } });
    if (!game || game.chatContainerMemberId !== containerMemberId || !bootstrapEventCurrent(game, eventId) || await readOtherFrozenBootstrap(containerMemberId, eventId, tx) || await readOtherPendingBootstrap(game, containerMemberId, eventId, tx)) return null;
    const route = await tx.hostedThreadRoute.findFirst({ where: { containerMemberId }, select: { containerMemberId: true } });
    if (route) return null;
    const result = await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
    await markGameChatGenerationQueuedTx(eventId, tx, containerMemberId);
    return result;
  });
  if (!appended) return null;
  await signalHostedMailboxAppendRuntime({ expectedUserId: containerMemberId, mailboxItemId: appended.mailboxItemId });
  return containerMemberId;
}

/** Signed host callback; not a model tool and never accepts recipients or a sender. */
export async function handleGameChatBootstrapControl(input: ControlInput): Promise<HostedGameChatBootstrapResponse> {
  return runWithHostedDomainRootUnwrapCache(async () => {
    const prisma = getPrisma();
    const wake = await readHostedMailboxWakeByDedupeKey({ dedupeKey: input.request.eventId, userId: input.memberId, prisma });
    if (!matchesBootstrapWake(wake, input)) return unavailable();
    await prisma.$transaction((tx) => authorizeRuntimeTx(input, tx));
    const game = await readBootstrapGame(input.request.gameId);
    if (!game || game.chatContainerMemberId !== input.memberId || game.players.length !== 2) return unavailable();
    const phones = await readPlayerPhones(game.players.map((player) => player.memberId));
    const receipt = await readFrozenBootstrap(input.request.eventId, input.memberId);
    if (receipt?.skipped) return unavailable();
    if (receipt && (receipt.payload.gameId !== input.request.gameId || receipt.payload.eventId !== input.request.eventId || !samePhones(phones, receipt.payload.to))) return unavailable();
    if (!receipt && !bootstrapEventCurrent(game, input.request.eventId)) return unavailable();
    if (!receipt && await readOtherFrozenBootstrap(input.memberId, input.request.eventId)) throw new Error("The initial game chat message is still being confirmed.");
    if (!receipt && input.request.operation === "recover") return { action: "game_chat_bootstrap", result: { status: "needs_message" } };
    const frozen = receipt ?? await freezeBootstrapMessage(input, phones);
    if (!frozen) return unavailable();
    return finishBootstrap(input, frozen);
  });
}

function matchesBootstrapWake(wake: Awaited<ReturnType<typeof readHostedMailboxWakeByDedupeKey>>, input: ControlInput): boolean {
  return wake?.kind === "assistant.notification.requested"
    && wake.notification.gameChatBootstrap?.gameId === input.request.gameId
    && wake.notification.gameChatBootstrap.eventId === input.request.eventId
    && wake.notification.route.delivery.kind === "bootstrap"
    && wake.notification.route.delivery.target === input.memberId;
}
function unavailable(): HostedGameChatBootstrapResponse { return { action: "game_chat_bootstrap", result: { status: "unavailable" } }; }
function lockGame(tx: Prisma.TransactionClient, gameId: string) { return tx.$queryRaw(Prisma.sql`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`); }
async function authorizeRuntimeTx(input: ControlInput, tx: Prisma.TransactionClient) {
  await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
  await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
}
function readBootstrapGame(gameId: string) { return getPrisma().game.findUnique({ where: { id: gameId }, include: { players: { select: { memberId: true, seat: true }, orderBy: { seat: "asc" }, take: 3 } } }); }
function samePlayers(a: readonly { memberId: string }[], b: readonly { memberId: string }[]) { return a.length === 2 && b.length === 2 && a.every((player) => b.some((other) => other.memberId === player.memberId)); }
function samePhones(a: readonly string[], b: readonly string[]) { return a.length === 2 && b.length === 2 && new Set(b).size === 2 && a.every((phone) => b.includes(phone)); }
function bootstrapEventCurrent(game: { id: string; status: string; pendingChange: unknown; players: readonly { memberId: string }[] }, eventId: string): boolean {
  if (game.players.length !== 2 || !game.players.every((player) => isGameEnabledFor(player.memberId))) return false;
  if (eventId === `game-started:${game.id}`) return game.status === "live";
  const proposal = parsePendingGameChange(game.pendingChange);
  return (game.status === "live" || game.status === "negotiating") && proposal !== null && eventId === `game-change:${game.id}:${proposal.id}`;
}
async function readPlayerPhones(memberIds: readonly string[]): Promise<string[]> {
  const prisma = getPrisma();
  const allowed = await prisma.hostedMember.count({ where: { id: { in: [...memberIds] }, suspendedAt: null } });
  if (allowed !== 2) throw new Error("Game chat players are unavailable.");
  const identities = await Promise.all(memberIds.map((memberId) => readHostedMemberIdentity({ memberId, prisma })));
  const phones = identities.flatMap((identity) => identity?.phoneNumberVerifiedAt && identity.phoneNumber ? [identity.phoneNumber] : []);
  if (phones.length !== 2 || new Set(phones).size !== 2) throw new Error("Game chat requires both players' verified phone numbers.");
  return phones;
}
function payloadAuthority(memberId: string, deliveryId: string) { return { lane: "hosted-member-private-field" as const, scope: "game-chat-receipt", userId: memberId, aad: { table: "hosted_linq_delivery", rowId: deliveryId, field: "payload_ciphertext", purpose: "game-chat-receipt" } }; }
function parseFrozenBootstrap(value: string | null): FrozenBootstrap {
  return frozenBootstrapSchema.parse(value ? JSON.parse(value) : null);
}
async function readFrozenBootstrap(eventId: string, memberId: string): Promise<BootstrapReceipt | null> {
  const prisma = getPrisma();
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  if (!idempotencyKey) throw new TypeError("Game chat delivery identity is unavailable.");
  const receipt = await prisma.hostedLinqDelivery.findUnique({ where: { idempotencyKey }, select: { id: true, payloadSchema: true, payloadCiphertext: true, payloadOwnerMemberId: true, source: true, status: true, skippedAt: true, template: true, acceptedAt: true, lastReceiptAt: true, messageLookupKey: true, phoneNumberLookupKey: true } });
  // A cancelled reservation has no provider effect to reconcile. Returning a
  // terminal result lets the ordered system mailbox consume its stale wake.
  if (receipt && isSkippedBootstrapReservation(receipt, memberId)) return { id: receipt.id, skipped: true };
  if (!receipt || receipt.source === "game_lifecycle" && ["awaiting_generation", "generation_queued"].includes(receipt.status) && receipt.payloadCiphertext === null) return null;
  if (receipt.payloadSchema !== PAYLOAD_SCHEMA || !receipt.payloadCiphertext || receipt.payloadOwnerMemberId !== memberId) throw new Error("Previous game chat creation requires reconciliation.");
  const text = await openHostedUserSecureBoxString({ ...payloadAuthority(memberId, receipt.id), prisma, value: receipt.payloadCiphertext });
  return { id: receipt.id, payload: parseFrozenBootstrap(text), skipped: receipt.skippedAt != null };
}

function isSkippedBootstrapReservation(row: {
  source: string; template: string | null; status: string; skippedAt: Date | null;
  payloadOwnerMemberId: string | null; payloadSchema: string | null; payloadCiphertext: string | null;
  acceptedAt: Date | null; lastReceiptAt: Date | null; messageLookupKey: string | null; phoneNumberLookupKey: string | null;
}, memberId: string): boolean {
  return row.source === "game_lifecycle" && row.payloadOwnerMemberId === memberId
    && ["game_started", "game_proposal"].includes(row.template ?? "")
    && row.status === "skipped" && row.skippedAt !== null
    && [row.payloadSchema, row.payloadCiphertext, row.acceptedAt, row.lastReceiptAt, row.messageLookupKey, row.phoneNumberLookupKey].every((value) => value === null);
}

async function freezeBootstrapMessage(input: ControlInput, phones: string[]): Promise<FrozenReceipt | null> {
  if (input.request.operation !== "send" || !input.request.text?.trim()) throw new TypeError("Game chat bootstrap requires its generated message.");
  validateHostedLinqChatFirstMessage(input.request.text);
  const prisma = getPrisma();
  const key = input.request.eventId;
  const lookupKey = createHostedLinqDeliveryIdempotencyLookupKey(key);
  if (!lookupKey) throw new TypeError("Game chat delivery identity is unavailable.");
  const id = buildHostedLinqDeliveryId(lookupKey);
  const now = new Date();
  const dayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const lines = await listHostedLinqHealthyProactiveLines({ prisma });
  for (const line of lines) {
    const payload: FrozenBootstrap = { gameId: input.request.gameId, eventId: input.request.eventId, from: line.phoneNumber, to: phones, message: input.request.text, accountLookupKey: line.phoneNumberLookupKey };
    const ciphertext = await sealHostedUserSecureBoxString({ ...payloadAuthority(input.memberId, id), prisma, value: JSON.stringify(payload) });
    if (!ciphertext) throw new Error("Game chat message encryption failed.");
    const result = await prisma.$transaction(async (tx) => {
      await authorizeRuntimeTx(input, tx);
      await lockGame(tx, input.request.gameId);
      const game = await tx.game.findUnique({ where: { id: input.request.gameId }, include: { players: { select: { memberId: true }, take: 3 } } });
      if (!game || game.chatContainerMemberId !== input.memberId || !bootstrapEventCurrent(game, input.request.eventId)) return "stale";
      if (await readOtherFrozenBootstrap(input.memberId, input.request.eventId, tx)) throw new Error("The initial game chat message is still being confirmed.");
      const route = await tx.hostedThreadRoute.findFirst({ where: { containerMemberId: input.memberId }, select: { containerMemberId: true } });
      if (route) return "stale";
      const existing = await tx.hostedLinqDelivery.findUnique({ where: { id }, select: { id: true, source: true, status: true, payloadCiphertext: true } });
      if (existing && !(existing.source === "game_lifecycle" && ["awaiting_generation", "generation_queued"].includes(existing.status) && existing.payloadCiphertext === null)) return "existing";
      const capacity = await claimHostedLinqProactiveConversationCapacityTx({ prisma: tx, dayUtc, limit: Math.min(line.maxNewConversationsPerDay ?? 10, 50), phoneNumberLookupKey: line.phoneNumberLookupKey, requiredHealthStatus: "healthy" });
      if (!capacity) return "full";
      const claimed = await claimHostedLinqDeliveryProviderDispatchTx({ prisma: tx, idempotencyKey: key, source: "game_lifecycle", sourceRef: input.request.gameId, template: "game_chat_bootstrap", targetKind: "thread", phoneNumber: line.phoneNumber, status: "provider_dispatch_started" });
      if (!claimed.claimed || claimed.id !== id) throw new Error("Game chat bootstrap claim changed.");
      await tx.hostedLinqDelivery.update({ where: { id }, data: { payloadCiphertext: ciphertext, payloadOwnerMemberId: input.memberId, payloadSchema: PAYLOAD_SCHEMA } });
      return "claimed";
    });
    if (result === "stale") return null;
    if (result === "existing") {
      const existing = await readFrozenBootstrap(input.request.eventId, input.memberId);
      return existing?.skipped ? null : existing;
    }
    if (result === "claimed") return { id, payload };
  }
  throw new Error("No healthy game chat line has capacity.");
}

async function finishBootstrap(input: ControlInput, receipt: FrozenReceipt, trustedRecovery = false): Promise<HostedGameChatBootstrapResponse> {
  const prisma = getPrisma();
  if (receipt.skipped) return unavailable();
  const key = input.request.eventId;
  let payload = receipt.payload;
  if (!payload.chatId) {
    const lines = await listHostedLinqHealthyProactiveLines({ prisma });
    if (!lines.some((line) => line.phoneNumber === payload.from && line.phoneNumberLookupKey === payload.accountLookupKey)) throw new Error("Game chat sending line is unavailable.");
    const active = await prisma.$transaction(async (tx) => {
      await authorizeBootstrapEffectTx(input, tx, trustedRecovery);
      await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
      const current = await tx.game.findUnique({ where: { id: input.request.gameId }, include: { players: { select: { memberId: true }, take: 3 } } });
      if (!current || current.players.length !== 2 || !current.players.every((player) => isGameEnabledFor(player.memberId))) throw new Error("Game chat delivery is unavailable.");
      return current.status === "live" || current.status === "negotiating";
    });
    if (!active) { await skipBootstrapRecovery(receipt.id); return unavailable(); }
    const sent = await createHostedLinqChat({ from: payload.from, to: payload.to, message: payload.message, idempotencyKey: key });
    if (!sent.chatId) throw new Error("Game chat creation has no confirmed provider receipt.");
    payload = { ...payload, chatId: sent.chatId, messageId: sent.messageId ?? null, acceptedAt: new Date().toISOString() };
    const ciphertext = await sealHostedUserSecureBoxString({ ...payloadAuthority(input.memberId, receipt.id), prisma, value: JSON.stringify(payload) });
    if (!ciphertext) throw new Error("Game chat receipt encryption failed.");
    await prisma.$transaction(async (tx) => {
      await authorizeBootstrapEffectTx(input, tx, trustedRecovery);
      await tx.hostedLinqDelivery.update({ where: { id: receipt.id }, data: { payloadCiphertext: ciphertext } });
      await markHostedLinqDeliveryAcceptedTx({ prisma: tx, idempotencyKey: key, linqChatId: payload.chatId, messageId: payload.messageId });
    });
  }
  const chatId = payload.chatId;
  if (!chatId || !payload.acceptedAt) throw new Error("Game chat receipt has no accepted chat identity.");
  const chat = await getHostedLinqChatSummary({ chatId, timeoutMs: 3_000 });
  if (!isExactGameChat(chat, payload.to)) throw new Error("Created game chat participants could not be verified.");
  const prepared = await prepareHostedThreadContainerDeliveryRoute({ prisma, containerMemberId: input.memberId, channel: "linq", threadId: chatId, accountLookupKey: payload.accountLookupKey, observedDeliveryRouteEncrypted: null });
  await prisma.$transaction(async (tx) => {
    await authorizeBootstrapEffectTx(input, tx, trustedRecovery);
    await attachHostedThreadContainerBootstrapRouteTx({ gameId: input.request.gameId, prepared, prisma: tx });
    await tx.hostedLinqDelivery.update({ where: { id: receipt.id }, data: { bootstrapRouteAttachedAt: new Date(), retryAfterAt: null } });
    const proposalPrefix = `game-change:${input.request.gameId}:`;
    if (input.request.eventId.startsWith(proposalPrefix)) {
      const proposalId = input.request.eventId.slice(proposalPrefix.length);
      // Delivery metadata must not replace the sealed canonical proposal envelope.
      await tx.$executeRaw`UPDATE game
        SET pending_change = jsonb_set(pending_change, '{deliveryStatus}', '"sent"'::jsonb)
        WHERE id = ${input.request.gameId} AND chat_container_member_id = ${input.memberId}
          AND pending_change->>'id' = ${proposalId}`;
    }
  });
  return { action: "game_chat_bootstrap", result: { status: "sent", message: payload.message, deliveryId: receipt.id, chatId, accountLookupKey: payload.accountLookupKey, providerMessageId: payload.messageId ?? null, acceptedAt: payload.acceptedAt! } };
}

async function authorizeBootstrapEffectTx(input: ControlInput, tx: Prisma.TransactionClient, trustedRecovery: boolean): Promise<void> {
  if (!trustedRecovery) await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
  await lockGame(tx, input.request.gameId);
  const game = await tx.game.findFirst({ where: { id: input.request.gameId, chatContainerMemberId: input.memberId }, select: { id: true } });
  if (!game) throw new Error("The initial game chat no longer owns its workspace.");
}

/** Minute recovery can only replay a durable immutable effect; it cannot generate or target a new one. */
export async function reconcileFrozenGameChatBootstrap(gameId: string, eventId: string, containerMemberId: string): Promise<boolean> {
  return runWithHostedDomainRootUnwrapCache(async () => {
    const receipt = await readFrozenBootstrap(eventId, containerMemberId);
    if (!receipt || receipt.skipped || receipt.payload.gameId !== gameId || receipt.payload.eventId !== eventId) return false;
    const game = await readBootstrapGame(gameId);
    if (!game || game.chatContainerMemberId !== containerMemberId || game.players.length !== 2) return skipBootstrapRecovery(receipt.id);
    const phones = await readPlayerPhones(game.players.map((player) => player.memberId));
    if (!samePhones(phones, receipt.payload.to)) return skipBootstrapRecovery(receipt.id);
    // A known accepted receipt can attach after agreement changes. Never replay
    // an ambiguous provider effect after the game closes; retain it for inspection.
    if (!receipt.payload.chatId && game.status !== "live" && game.status !== "negotiating") return skipBootstrapRecovery(receipt.id);
    await finishBootstrap({ memberId: containerMemberId, runtimeIdentity: null, request: { action: "game_chat_bootstrap", gameId, eventId, operation: "recover" } }, receipt, true);
    return true;
  });
}

async function skipBootstrapRecovery(receiptId: string): Promise<false> {
  await getPrisma().hostedLinqDelivery.updateMany({ where: { id: receiptId, bootstrapRouteAttachedAt: null, skippedAt: null }, data: { skippedAt: new Date(), skipReason: "game_bootstrap_authority_changed", retryAfterAt: null } });
  return false;
}

/** Bounded cron batches carry only receipt identity; game details remain encrypted. */
export async function reconcileFrozenGameChatBootstrapReceipt(receiptId: string): Promise<boolean> {
  return runWithHostedDomainRootUnwrapCache(async () => {
    const prisma = getPrisma();
    const row = await prisma.hostedLinqDelivery.findUnique({ where: { id: receiptId }, select: { payloadSchema: true, payloadCiphertext: true, payloadOwnerMemberId: true, bootstrapRouteAttachedAt: true, skippedAt: true } });
    if (!row || row.payloadSchema !== PAYLOAD_SCHEMA || !row.payloadCiphertext || !row.payloadOwnerMemberId) return false;
    if (row.bootstrapRouteAttachedAt) return true;
    if (row.skippedAt) return false;
    const payload = parseFrozenBootstrap(await openHostedUserSecureBoxString({ ...payloadAuthority(row.payloadOwnerMemberId, receiptId), prisma, value: row.payloadCiphertext }));
    return reconcileFrozenGameChatBootstrap(payload.gameId, payload.eventId, row.payloadOwnerMemberId);
  });
}
