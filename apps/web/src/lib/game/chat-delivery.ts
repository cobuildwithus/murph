import "server-only";

import { openHostedUserSecureBoxString, sealHostedUserSecureBoxString } from "../hosted-crypto/secure-box";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import type { Game, GamePlayer, Prisma } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { toPrismaJsonObject } from "../device-sync/prisma-store/prisma-json";
import { reconcileHostedThreadContainerParticipants } from "../hosted-groups/thread-container-participants";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxItemByDedupeKey } from "../hosted-mailbox/store";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { createHostedLinqChat, getHostedLinqChatSummary, type HostedLinqChatSummary } from "../hosted-onboarding/linq-client";
import { buildHostedLinqDeliveryId, claimHostedLinqDeliveryProviderDispatchTx, markHostedLinqDeliveryAcceptedTx } from "../hosted-onboarding/linq-delivery-store";
import { claimHostedLinqProactiveConversationCapacityTx, listHostedLinqHealthyProactiveLines, readHostedLinqIncomingLineState } from "../hosted-onboarding/linq-line-store";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { assertHostedAssistantNotificationRouteAuthority, bindHostedAssistantNotificationDestination, readHostedThreadContainerLinqRouteAuthorities, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { ensureHostedThreadContainerRouteTx, prepareHostedThreadContainerCreation } from "../hosted-routing/thread-container-service";
import { getPrisma } from "../prisma";
import { parsePendingGameChange } from "./changes";
import type { GamePendingChange } from "./contract";
import { openGameTexts } from "./crypto";
import { addDays, weekdayOf } from "./time";
import { currentTerms, parseStoredTerms } from "./rules";

const CANDIDATE_LIMIT = 20;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Current complete provider membership, not the best-effort database roster, proves the audience. */
export function isExactGameChat(chat: HostedLinqChatSummary, phones: readonly string[]): boolean {
  if (chat.isGroup !== true || chat.handlesComplete !== true || phones.length !== 2 || new Set(phones).size !== 2) return false;
  const active = chat.handles.filter((handle) => handle.status === null || handle.status.toLowerCase() === "active");
  const people = active.filter((handle) => !handle.isMe).map((handle) => normalizePhoneNumber(handle.handle));
  return active.filter((handle) => handle.isMe).length === 1
    && people.length === 2 && new Set(people).size === 2
    && phones.every((phone) => people.includes(phone));
}

export function gameChangeProposalMessage(proposal: GamePendingChange, context: { proposerName: string; recipientName: string; effectiveOn: string | null; timeZones: string[]; deadline?: { day: string; kind: "first_check_in" | "game" } | null }): string {
  const change = proposal.change;
  const edits: string[] = [];
  if (proposal.startsOn) edits.push(`start on ${proposal.startsOn}`);
  if (change.kind === "edit") {
    if (change.schedule) edits.push("days" in change.schedule
      ? `check in on ${change.schedule.days.map((day) => DAYS[day]).join(", ")}`
      : `${change.schedule.count} check-ins across the game`);
    if (change.lengthDays !== undefined) edits.push(`${change.lengthDays} calendar days total`);
  }
  const effective = proposal.effectiveFromDay > 0 ? `Starting ${context.effectiveOn ?? `day ${proposal.effectiveFromDay + 1}`}, keeping previous check-ins. ` : "";
  const deadline = context.deadline ? `${context.deadline.kind === "game" ? "The game would finish" : "First check-ins would be due"} ${context.deadline.day} at 3 AM in each player's local time (${[...new Set(context.timeZones)].join("; ")}). ` : "";
  return `${context.proposerName} proposed: ${edits.join("; ")}. ${effective}${deadline}${context.recipientName}, does that work for you?`;
}

/** Called after the game transaction. All provider and crypto work stays outside game locks. */
export async function deliverGameChangeProposal(gameId: string, proposalId: string): Promise<void> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { players: { orderBy: { seat: "asc" }, take: 3 } } });
  const proposal = parsePendingGameChange(game?.pendingChange);
  if (!game || game.status !== "live" || !proposal || proposal.id !== proposalId || game.players.length !== 2) return;
  if (proposal.deliveryStatus === "sent") return;
  const { phones, message } = await prepareGameChatPlayers(game, proposal);
  // A bound chat can never silently drift to an audience with additional people.
  let containerMemberId = game.chatContainerMemberId;
  if (containerMemberId) {
    await requireExactChat(containerMemberId, phones);
  } else {
    const candidates = await prisma.hostedThreadContainer.findMany({
      where: { AND: game.players.map((player) => ({ participants: { some: { participantMemberId: player.memberId, removedAt: null } } })), participants: { none: { removedAt: null, participantMemberId: { notIn: game.players.map((player) => player.memberId) } } } },
      select: { memberId: true, participants: { where: { removedAt: null }, select: { participantMemberId: true }, take: 3 } },
      orderBy: [{ createdAt: "desc" }, { memberId: "asc" }], take: CANDIDATE_LIMIT + 1,
    });
    if (candidates.length > CANDIDATE_LIMIT) throw new Error("Game chat discovery needs a narrower existing conversation.");
    for (const candidate of candidates) {
      if (candidate.participants.length !== 2 || !game.players.every((player) => candidate.participants.some((participant) => participant.participantMemberId === player.memberId))) continue;
      if (await exactChat(candidate.memberId, phones)) { containerMemberId = candidate.memberId; break; }
    }
    if (containerMemberId) {
      const bound = await prisma.game.updateMany({ where: pendingWhere(gameId, proposalId, null), data: { chatContainerMemberId: containerMemberId } });
      if (bound.count !== 1) return;
    } else {
      await createGameChat(gameId, proposal, phones, game.players.map((player) => player.memberId), message);
      return;
    }
  }
  await enqueueProposal(gameId, proposal, containerMemberId, message);
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
  const dayOne = players[0]!.dayOne?.toISOString().slice(0, 10);
  const message = gameChangeProposalMessage(proposal, { proposerName: nameFor(proposal.proposedByMemberId), recipientName: nameFor(other.memberId), effectiveOn: proposal.startsOn ?? (dayOne ? addDays(dayOne, proposal.effectiveFromDay) : null), timeZones: players.map((player) => player.timeZone), deadline: firstProposedDeadline(game, proposal) });
  return { phones, message };
}

function firstProposedDeadline(game: Game, proposal: GamePendingChange): { day: string; kind: "first_check_in" | "game" } | null {
  if (!proposal.startsOn) return null;
  const change = proposal.change;
  const schedule = (change.kind === "edit" ? change.schedule : undefined) ?? currentTerms(parseStoredTerms(game.terms)).schedule;
  const length = (change.kind === "edit" ? change.lengthDays : undefined) ?? game.lengthDays;
  if ("count" in schedule) return { day: addDays(proposal.startsOn, length), kind: "game" };
  for (let day = 0; day < length; day++) {
    if (schedule.days.includes(weekdayOf(addDays(proposal.startsOn, day)))) return { day: addDays(proposal.startsOn, day + 1), kind: "first_check_in" };
  }
  return null;
}

function pendingWhere(gameId: string, proposalId: string, containerMemberId?: string | null): Prisma.GameWhereInput {
  return { id: gameId, status: "live", ...(containerMemberId === undefined ? {} : { chatContainerMemberId: containerMemberId }), pendingChange: { path: ["id"], equals: proposalId } };
}

async function exactChat(containerMemberId: string, phones: readonly string[]) {
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

/** Revalidate the audience outside the existing provider dispatch transaction. */
export async function readGameProposalDeliveryPlayers(key: string | null, containerMemberId: string): Promise<readonly string[] | undefined> {
  return key?.startsWith("game-change:") ? requireExactGameChat(containerMemberId) : undefined;
}

/** Group tools verify the current audience before reading shared game terms. */
export async function requireExactGameChat(containerMemberId: string): Promise<readonly string[]> {
  const prisma = getPrisma();
  const game = await prisma.game.findFirst({ where: { chatContainerMemberId: containerMemberId, status: "live" }, include: { players: { take: 3 } }, orderBy: { createdAt: "desc" } });
  if (!game || game.players.length !== 2) throw new Error("Game chat has no active two-player game.");
  const identities = await Promise.all(game.players.map((player) => readHostedMemberIdentity({ memberId: player.memberId, prisma })));
  const phones = identities.flatMap((identity) => identity?.phoneNumberVerifiedAt && identity.phoneNumber ? [identity.phoneNumber] : []);
  if (phones.length !== 2) throw new Error("Game chat requires verified players.");
  await requireExactChat(containerMemberId, phones);
  return game.players.map((player) => player.memberId);
}

async function requireExactChat(containerMemberId: string, phones: readonly string[]) {
  const matched = await exactChat(containerMemberId, phones);
  if (!matched) throw new Error("The game's chat participants have changed.");
  return matched;
}

async function enqueueProposal(gameId: string, proposal: GamePendingChange, containerMemberId: string, message: string): Promise<void> {
  const prisma = getPrisma();
  const key = `game-change:${gameId}:${proposal.id}`;
  const existing = await readHostedMailboxItemByDedupeKey({ dedupeKey: key, userId: containerMemberId, prisma });
  if (existing) {
    if (existing.consumedAt === null) await signalHostedMailboxAppendRuntime({ expectedUserId: containerMemberId, mailboxItemId: existing.id });
    return;
  }
  const destination = await resolveHostedAssistantNotificationDestination({ memberId: containerMemberId, prisma });
  if (!destination || destination.conversationShape !== "thread-container" || destination.route.channel !== "linq") throw new Error("Game chat delivery route is unavailable.");
  const bound = bindHostedAssistantNotificationDestination({ destination, memberId: containerMemberId });
  const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma, envelope: buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: key, memberId: containerMemberId, occurredAt: new Date().toISOString(),
    notification: { ...bound, instructions: "Deliver the proposed challenge change to the shared chat.", responsePolicy: { kind: "require_send_exact_text", text: message }, deliveryDedupeToken: key, deliveryIdempotencyKey: key, deliveryDispatchMode: "queue-only" },
  }) });
  const appended = await prisma.$transaction(async (tx) => {
    if (bound.externalThreadRouteAuthority) await assertHostedAssistantNotificationRouteAuthority({ authority: bound.externalThreadRouteAuthority, prisma: tx });
    const changed = await tx.game.updateMany({ where: pendingWhere(gameId, proposal.id, containerMemberId), data: { pendingChange: toPrismaJsonObject({ ...proposal, v: 1, deliveryStatus: "queued" }) } });
    if (changed.count !== 1) return null;
    return appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
  });
  if (appended) await signalHostedMailboxAppendRuntime({ expectedUserId: containerMemberId, mailboxItemId: appended.mailboxItemId });
}

type GameChatRequest = { from: string; to: string[]; message: string; accountLookupKey: string };
const CHAT_PAYLOAD_SCHEMA = "game_chat_v1";
const GAME_CHAT_OPENER = "This is your challenge chat with Murph. I’ll help you agree on changes together.";
type GameChatReceipt = { chatId: string; accountLookupKey: string };
function parseGameChatPayload(value: string | null): GameChatRequest | GameChatReceipt {
  const parsed: unknown = value ? JSON.parse(value) : null;
  if (!parsed || typeof parsed !== "object" || !("accountLookupKey" in parsed) || typeof parsed.accountLookupKey !== "string") throw new Error("Game chat receipt is invalid.");
  if ("chatId" in parsed && typeof parsed.chatId === "string") return { chatId: parsed.chatId, accountLookupKey: parsed.accountLookupKey };
  if (!("from" in parsed) || typeof parsed.from !== "string" || !("to" in parsed) || !Array.isArray(parsed.to) || !parsed.to.every((phone): phone is string => typeof phone === "string") || !("message" in parsed) || typeof parsed.message !== "string") throw new Error("Game chat request is invalid.");
  return { from: parsed.from, to: parsed.to, message: parsed.message, accountLookupKey: parsed.accountLookupKey };
}

function chatPayloadAuthority(memberId: string, deliveryId: string) {
  return { lane: "hosted-member-private-field" as const, scope: "game-chat-receipt", userId: memberId, aad: { table: "hosted_linq_delivery", rowId: deliveryId, field: "payload_ciphertext", purpose: "game-chat-receipt" } };
}

async function createGameChat(gameId: string, proposal: GamePendingChange, phones: string[], memberIds: string[], message: string): Promise<void> {
  const prisma = getPrisma();
  const key = `game-chat:${gameId}`;
  const now = new Date();
  const dayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const idempotencyLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(key);
  if (!idempotencyLookupKey) throw new Error("Game delivery identity is unavailable.");
  const deliveryId = buildHostedLinqDeliveryId(idempotencyLookupKey);
  const receipt = await prisma.hostedLinqDelivery.findUnique({ where: { idempotencyKey: idempotencyLookupKey }, select: { id: true, payloadCiphertext: true, payloadOwnerMemberId: true, payloadSchema: true } });
  let frozen: GameChatRequest | null = null;
  let payloadOwner = proposal.proposedByMemberId;
  if (receipt?.payloadCiphertext && receipt.payloadOwnerMemberId && receipt.payloadSchema === CHAT_PAYLOAD_SCHEMA) {
    payloadOwner = receipt.payloadOwnerMemberId;
    const value = await openHostedUserSecureBoxString({ ...chatPayloadAuthority(payloadOwner, receipt.id), prisma, value: receipt.payloadCiphertext });
    const parsed = parseGameChatPayload(value);
    if ("chatId" in parsed) {
      await bindCreatedChat(gameId, proposal, phones, memberIds, parsed.chatId, parsed.accountLookupKey, message);
      return;
    }
    if (parsed.to.length !== 2 || !phones.every((phone) => parsed.to.includes(phone))) throw new Error("The previous game chat creation needs reconciliation.");
    frozen = { from: parsed.from, to: parsed.to, message: parsed.message, accountLookupKey: parsed.accountLookupKey };
  } else if (receipt) {
    throw new Error("Game chat creation is awaiting a confirmed provider receipt.");
  }
  const lines = await listHostedLinqHealthyProactiveLines({ prisma });
  if (frozen) {
    if (!lines.some((line) => line.phoneNumber === frozen!.from && line.phoneNumberLookupKey === frozen!.accountLookupKey)) throw new Error("Game chat sending line is unavailable.");
  } else {
    for (const candidate of lines) {
      const request: GameChatRequest = { from: candidate.phoneNumber, to: phones, message: GAME_CHAT_OPENER, accountLookupKey: candidate.phoneNumberLookupKey };
      const ciphertext = await sealHostedUserSecureBoxString({ ...chatPayloadAuthority(payloadOwner, deliveryId), prisma, value: JSON.stringify(request) });
      if (!ciphertext) throw new Error("Game chat request encryption failed.");
      const noCapacity = new Error("Game chat line capacity is unavailable.");
      try {
        const admitted = await prisma.$transaction(async (tx) => {
          const current = await tx.game.updateMany({ where: pendingWhere(gameId, proposal.id, null), data: { updatedAt: now } });
          if (current.count !== 1) return false;
          const capacity = await claimHostedLinqProactiveConversationCapacityTx({ prisma: tx, dayUtc, limit: Math.min(candidate.maxNewConversationsPerDay ?? 10, 50), phoneNumberLookupKey: candidate.phoneNumberLookupKey, requiredHealthStatus: "healthy" });
          if (!capacity) throw noCapacity;
          const claimed = await claimHostedLinqDeliveryProviderDispatchTx({ prisma: tx, idempotencyKey: key, source: "game_chat", sourceRef: gameId, template: "game_chat_opener", targetKind: "thread", phoneNumber: candidate.phoneNumber, status: "provider_dispatch_started" });
          if (!claimed.claimed || claimed.id !== deliveryId) throw new Error("Game chat creation is already being prepared; retry the same proposal.");
          await tx.hostedLinqDelivery.update({ where: { id: deliveryId }, data: { payloadCiphertext: ciphertext, payloadOwnerMemberId: payloadOwner, payloadSchema: CHAT_PAYLOAD_SCHEMA } });
          return true;
        });
        if (!admitted) return;
        frozen = request;
        break;
      } catch (error) { if (error !== noCapacity) throw error; }
    }
  }
  if (!frozen) throw new Error("No healthy game chat line has capacity.");
  // Linq returns the original response for this nested message key, including
  // POST /v3/chats. Replay only the frozen request; never generate a new key.
  // https://docs.linqapp.com/channel/imessage/guides/messaging/sending-messages/
  const sent = await createHostedLinqChat({ from: frozen.from, to: frozen.to, idempotencyKey: key, message: frozen.message });
  if (!sent.chatId) throw new Error("Game chat creation has no confirmed chat identity.");
  const ciphertext = await sealHostedUserSecureBoxString({ ...chatPayloadAuthority(payloadOwner, deliveryId), prisma, value: JSON.stringify({ chatId: sent.chatId, accountLookupKey: frozen.accountLookupKey }) });
  await prisma.hostedLinqDelivery.update({ where: { id: deliveryId }, data: { payloadCiphertext: ciphertext, payloadOwnerMemberId: payloadOwner, payloadSchema: CHAT_PAYLOAD_SCHEMA } });
  await markHostedLinqDeliveryAcceptedTx({ prisma, idempotencyKey: key, linqChatId: sent.chatId, messageId: sent.messageId });
  await bindCreatedChat(gameId, proposal, phones, memberIds, sent.chatId, frozen.accountLookupKey, message);
}

async function bindCreatedChat(gameId: string, proposal: GamePendingChange, phones: string[], memberIds: string[], chatId: string, accountLookupKey: string, message: string): Promise<void> {
  const prisma = getPrisma();
  const now = new Date();
  const chat = await getHostedLinqChatSummary({ chatId, timeoutMs: 3_000 });
  if (!isExactGameChat(chat, phones)) throw new Error("Created game chat participants could not be verified.");
  const preparedCreation = await prepareHostedThreadContainerCreation({ prisma, channel: "linq", accountLookupKey, threadId: chatId });
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.game.updateMany({ where: pendingWhere(gameId, proposal.id, null), data: { updatedAt: new Date() } });
    if (current.count !== 1) return null;
    const ensured = await ensureHostedThreadContainerRouteTx({ prisma: tx, channel: "linq", accountLookupKey, threadId: chatId, ownerMemberId: proposal.proposedByMemberId, gameProposal: { gameId, proposalId: proposal.id }, preparedCreation, occurredAt: now, initialGroupDisplayName: "Challenge" });
    await tx.game.update({ where: { id: gameId }, data: { chatContainerMemberId: ensured.containerMemberId, pendingChange: toPrismaJsonObject({ ...proposal, v: 1, deliveryStatus: "pending" }) } });
    return ensured;
  });
  if (!result) return;
  await reconcileHostedThreadContainerParticipants({ prisma, chatId, containerMemberId: result.containerMemberId, handles: chat.handles, resolvedParticipants: memberIds.map((participantMemberId, index) => ({ participantMemberId, handle: phones[index]! })) });
  await enqueueProposal(gameId, proposal, result.containerMemberId, message);
  if (result.activationMailboxItemId) await signalHostedMailboxAppendRuntime({ expectedUserId: result.containerMemberId, mailboxItemId: result.activationMailboxItemId });
}
