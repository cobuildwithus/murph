import "server-only";
import { recordGameRecapWitnessTx } from "./recap-witness";
import { groupGameRecapPlayers } from "./recap-cohort";

import { isPairRoster, isGameMemberSet } from "./roster";
import type { Game, HostedLinqDelivery, Prisma, PrismaClient } from "@prisma/client";
import { resolveFloatingIsoTimestampInTimeZone } from "@murphai/contracts";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { parseGameRecapEventId, buildGameTalkInstructions, buildGameKickoffInstructions, buildGameRematchInstructions, buildGameChangeCancelledInstructions, buildGameChangeExpiredInstructions, buildGameChangeResolvedInstructions, buildGameInviteCancelledInstructions, buildGameMissedDayInstructions, buildGameEveningCheckInInstructions, buildGameRecapInstructions } from "@murphai/hosted-execution/runtime-control";
import { gameResolutionNoticeKind, parseGameResolutionNotice, readGameChangeResolution } from "./change-resolution";
import { openGameTexts } from "./crypto";
import { readCurrentGameTalk, readGameTalkReceiptIdentity, prepareGameTalkAudience, type GameNoticeAudience } from "./talk";
import { assertGameProposalDeliveryCurrentTx } from "./chat-delivery-authority";
import { isRecord } from "../primitives";
import { getPrisma } from "../prisma";
import { isHostedMailboxItemConsumed, appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxItemByDedupeKey } from "../hosted-mailbox/store";
import { assertHostedAssistantNotificationRouteAuthority, bindHostedAssistantNotificationDestination, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { GameChatAudienceError, readGroupGameChatAuthority, readGroupGameNoticeAuthority, bindPairGameChat, findExistingGameChat, requireExactChat } from "./chat-membership";
import { prepareGameChatBootstrap, reconcileFrozenGameChatBootstrapReceipt } from "./chat-bootstrap";
import { gameChatLifecycleEventId, gameMissedDayEventId, markGameChatGenerationQueuedTx, type GameChatLifecycleKind } from "./chat-lifecycle-receipt";
import { isGameOn } from "./access";
import { parsePendingGameChange } from "./changes";
import { deliverGameChangeProposal, readGameProposalDeliveryPlayers } from "./chat-delivery";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { currentTerms, parseStoredTerms, gameChallengeKey, isGameInviteExpired } from "./rules";
import type { HostedGameEveningCheckInPolicy, HostedGameGroupMissedCheckInPolicy } from "@murphai/hosted-execution/runtime-control";
import { isGroupMissedDayBatchCurrentTx, prepareGroupMissedDay, readGroupMissedDayDeliveryAuthority } from "./group-missed-day";
import { gameEveningEventId, isEveningBatchCurrentTx, prepareGameEveningCheckIn, readGameEveningDeliveryAuthority } from "./evening-check-in";
import { isMissedCheckInExpired } from "./missed-check-in";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { deriveHostedOnboardingTimingErrorName, logHostedOnboardingDiagnostic, logHostedOnboardingWarning } from "../hosted-onboarding/logging";
import { gameGroupLoreFingerprint, gamePairLoreFingerprint } from "./audience";
import { readGameRematchDeliveryRevision } from "./chat-delivery-authority";

// This cron also runs Stripe reconciliation, so the drain must end inside its 180s.
// One receipt can wait 63s on the provider (20 discovery reads × 3s plus a 3s recheck),
// and frozen recovery 13s (10s create + 3s roster check). No claim starts 90s after the
// drain starts, sweep included, and workers overlap, so the last one ends near 153s. That
// leaves about 27s for database, crypto and the runtime signal, which has no deadline of
// its own. Four workers hold at most four interactive transactions on the shared pool.
const LIFECYCLE_BATCH = 10;
const LIFECYCLE_WORKERS = 4;
const LIFECYCLE_CLAIM_BUDGET_MS = 90_000;
/**
 * Covers a claim from when it really started until its first status transition, and matches the route's maxDuration.
 * Publication replaces it with a 60s recovery timer and provider acceptance clears it, so another drain can overlap after
 * that; the mailbox item and frozen provider identity contain any repeat work.
 */
const LIFECYCLE_LEASE_MS = 180_000;
const LIFECYCLE_FROZEN_BATCH = 1;

/**
 * Selected in the query, before the batch limit: a receipt this build cannot
 * process (for example one written by a newer build before a rollback) must
 * never become the oldest due row that every sweep picks and skips.
 */
const LIFECYCLE_TEMPLATES = ["game_started", "game_rematch", "game_proposal", "game_talk", "game_change_cancelled", "game_change_expired", "game_change_resolved", "game_cancelled", "game_recap", "game_missed", "game_group_missed", "game_evening", "game_private_evening", "game_private_kickoff", "game_challenge"];
const PRIVATE_GAME_TEMPLATES = new Set<string | null>(["game_private_evening", "game_private_kickoff"]);

/** The existing minute sweep recovers accepted intent even if the app never returns. */
export async function drainGameChatLifecycle(input: { prisma?: PrismaClient; now?: Date; signal?: AbortSignal } = {}): Promise<{ attempted: number; queued: number; deferred: number }> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  // Real elapsed time, sweep included: `now` is the receipt clock and does not advance during a drain.
  const startedAtMs = Date.now();
  const stopClaiming = () => input.signal?.aborted || Date.now() - startedAtMs >= LIFECYCLE_CLAIM_BUDGET_MS;
  // A claim can start well after `now`, so its lease runs from the claim, on the same clock as the due check.
  const leaseUntil = () => new Date(now.getTime() + Date.now() - startedAtMs + LIFECYCLE_LEASE_MS);
  const { reserveDueGameMissedDayCheckIns } = await import("./service");
  const [missed] = await Promise.allSettled([
    reserveDueGameMissedDayCheckIns(now),
    import("./evening-check-in").then(({ reserveDueGameEveningCheckIns }) => reserveDueGameEveningCheckIns(now,
      { signal: input.signal, deadlineMs: startedAtMs + LIFECYCLE_CLAIM_BUDGET_MS })).catch((error: unknown) => logLifecycleItemFailure("game_evening", error)),
    import("./private-notification").then(({ reserveDuePrivateEveningCheckIns }) => reserveDuePrivateEveningCheckIns(now,
      { signal: input.signal, deadlineMs: startedAtMs + LIFECYCLE_CLAIM_BUDGET_MS })).catch((error: unknown) => logLifecycleItemFailure("game_private_evening", error)),
    import("./private-kickoff").then(({ reconcilePrivateGameActivations }) => reconcilePrivateGameActivations(now,
      { signal: input.signal, deadlineMs: startedAtMs + LIFECYCLE_CLAIM_BUDGET_MS })).catch((error: unknown) => logLifecycleItemFailure("game_private_kickoff", error)),
    import("./reminder-notification").then(({ sendDueGameReminders }) => sendDueGameReminders(now,
      { signal: input.signal, deadlineMs: startedAtMs + LIFECYCLE_CLAIM_BUDGET_MS })).catch(() => {}),
  ]);
  if (missed.status === "rejected") throw missed.reason;
  const pending = await readOldestReceiptPerChat(prisma, now);
  let queued = 0;
  let attempted = 0;
  let next = 0;
  const work = async () => {
    while (next < pending.length && !stopClaiming()) {
      const receipt = pending[next++]!;
      if (!LIFECYCLE_TEMPLATES.includes(receipt.template ?? "") || !receipt.sourceRef) continue;
      const claimed = await prisma.hostedLinqDelivery.updateMany({
        where: { id: receipt.id, source: "game_lifecycle", status: receipt.status, attemptedAt: receipt.attemptedAt,
          OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
        data: { attemptedAt: now, retryAfterAt: leaseUntil() },
      });
      if (claimed.count !== 1) continue;
      attempted += 1;
      try {
        if (await processGameChatIntent(receipt, now, prisma)) queued += 1;
      } catch (error) {
        // The reserved receipt and retry time remain durable. Provider/model work
        // never rolls back the accepted challenge and never logs shared words.
        logLifecycleItemFailure(receipt.template, error);
      }
    }
  };
  // A failed claim still surfaces, but only once no sibling is left running behind a settled drain.
  const workers = await Promise.allSettled(Array.from({ length: Math.min(LIFECYCLE_WORKERS, pending.length) }, work));
  for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
  const frozen = await prisma.hostedLinqDelivery.findMany({
    where: { source: "game_lifecycle", payloadSchema: "game_chat_bootstrap_v1", bootstrapRouteAttachedAt: null,
      skippedAt: null, OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
    orderBy: [{ attemptedAt: "asc" }, { id: "asc" }], take: LIFECYCLE_FROZEN_BATCH,
    select: { id: true, attemptedAt: true },
  });
  for (const receipt of frozen) {
    if (stopClaiming()) break;
    const claimed = await prisma.hostedLinqDelivery.updateMany({
      where: { id: receipt.id, source: "game_lifecycle", payloadSchema: "game_chat_bootstrap_v1",
        bootstrapRouteAttachedAt: null, skippedAt: null, attemptedAt: receipt.attemptedAt,
        OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
      data: { attemptedAt: now, retryAfterAt: leaseUntil() },
    });
    if (claimed.count !== 1) continue;
    attempted += 1;
    try {
      if (await reconcileFrozenGameChatBootstrapReceipt(receipt.id)) queued += 1;
    } catch (error) {
      // Frozen text and provider identity stay authoritative on the next sweep.
      logLifecycleItemFailure("game_chat_bootstrap", error);
    }
  }
  return { attempted, queued, deferred: attempted - queued };
}

type GameChatIntent = Pick<HostedLinqDelivery, "id" | "sourceRef" | "template" | "status" | "idempotencyKey" | "createdAt" | "attemptedAt" | "payloadOwnerMemberId">;

/** One line per failed item. The class or fixed code says what broke; messages can carry identifiers, so they stay out. */
function logLifecycleItemFailure(template: string | null, error: unknown): void {
  logHostedOnboardingDiagnostic("game.chat-lifecycle-item", { kind: "item_failed", template: template ?? "unknown",
    reason: error instanceof GameChatAudienceError ? error.reason : isHostedOnboardingError(error) ? error.code : deriveHostedOnboardingTimingErrorName(error) });
}

/**
 * Workers run in parallel, so a later notice must not overtake an earlier one in the same chat: the oldest due receipt of
 * each chat, then the limit, so a chat with a long backlog takes one slot and hides no other chat. Its own queue still
 * moves one receipt a pass. `payloadOwnerMemberId` is unset on most receipts until they publish, so the chat comes from the
 * game binding. Group missed-day and evening receipts carry the room owner; older group receipts can fall back to their
 * room reference. Receipts with no known chat are NULL here and collapse into
 * one shared slot. The query reads every due row, so its cost grows with the backlog, with no provider or crypto work in
 * it. Only the outer limit may cut rows: a limit before the dedupe would let one chat's backlog hide every other chat.
 */
export async function readOldestReceiptPerChat(prisma: PrismaClient, now: Date): Promise<(GameChatIntent & { attemptedAt: Date })[]> {
  const oldest = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH oldest AS (
      SELECT DISTINCT ON (chat) id, attempted_at FROM (
        SELECT due.id, due.attempted_at,
          CASE WHEN due.template IN ('game_group_missed', 'game_evening') THEN COALESCE(due.payload_owner_member_id, split_part(due.source_ref, ':', 1))
            WHEN due.template IN ('game_private_evening', 'game_private_kickoff') THEN due.payload_owner_member_id
            ELSE game.chat_container_member_id END AS chat
        FROM hosted_linq_delivery due LEFT JOIN game ON game.id = split_part(due.source_ref, ':', 1)
        WHERE due.source = 'game_lifecycle' AND due.template = ANY(${LIFECYCLE_TEMPLATES}::text[]) AND due.source_ref IS NOT NULL
          AND ((due.status = 'awaiting_generation' AND (due.retry_after_at IS NULL OR due.retry_after_at <= ${now}::timestamp))
            OR (due.status = 'generation_queued' AND due.retry_after_at <= ${now}::timestamp))
      ) resolved ORDER BY chat, attempted_at, id
    )
    SELECT id FROM oldest ORDER BY attempted_at, id LIMIT ${LIFECYCLE_BATCH}`;
  return prisma.hostedLinqDelivery.findMany({ where: { id: { in: oldest.map(row => row.id) } }, orderBy: [{ attemptedAt: "asc" }, { id: "asc" }],
    select: { id: true, sourceRef: true, template: true, attemptedAt: true, idempotencyKey: true, status: true, createdAt: true, payloadOwnerMemberId: true } });
}

async function processGameChatIntent(receipt: GameChatIntent, now: Date, prisma: PrismaClient): Promise<boolean> {
  if (PRIVATE_GAME_TEMPLATES.has(receipt.template)) return processPrivateGameIntent(receipt, now);
  if (receipt.template === "game_evening") return processEveningCheckInIntent(receipt, now);
  if (receipt.template === "game_group_missed") return processGroupMissedDayIntent(receipt, now);
  if (receipt.template === "game_talk") return processGameTalkIntent(receipt, now, prisma);
  if (receipt.template === "game_challenge") return processGameChallengeIntent(receipt, now, prisma);
  if (receipt.template === "game_missed") return processPairMissedDayIntent(receipt, now);
  if (["game_change_cancelled", "game_change_expired", "game_change_resolved"].includes(receipt.template ?? "")) {
    const kind = receipt.template === "game_change_resolved" ? "change_resolved" : receipt.template === "game_change_expired" ? "change_expired" : "change_cancelled";
    const parts = /^([^:]+):([^:]+)$/.exec(receipt.sourceRef ?? "");
    if (!parts) return false;
    const [, gameId, proposalId] = parts;
    const eventId = gameChatLifecycleEventId(gameId, kind, proposalId);
    return receipt.status === "generation_queued"
      ? recoverGameNotificationWake(receipt.id, gameId, eventId, now, kind)
      : deliverGameChatLifecycle(gameId, kind, proposalId, now);
  }
  if (receipt.template === "game_recap") return processGameRecapIntent(receipt, now);
  const gameId = receipt.sourceRef;
  if (!gameId) return false;
  if (receipt.template === "game_proposal") return processGameProposalIntent(receipt, gameId, now, prisma);
  const kind = receipt.template === "game_cancelled" ? "cancelled" : receipt.template === "game_rematch" ? "rematch" : "started";
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, gameId, gameChatLifecycleEventId(gameId, kind), now, kind)
    : deliverGameChatLifecycle(gameId, kind, undefined, now);
}

function processPrivateGameIntent(receipt: GameChatIntent, now: Date): Promise<boolean> {
  return receipt.template === "game_private_evening" ? processPrivateEveningIntent(receipt, now) : processPrivateKickoffIntent(receipt, now);
}

async function processPrivateKickoffIntent(receipt: GameChatIntent, now: Date): Promise<boolean> {
  const parts = /^([^:]+):([^:]+)$/u.exec(receipt.sourceRef ?? "");
  if (!parts || receipt.payloadOwnerMemberId !== parts[2]) return false;
  const [, gameId, memberId] = parts;
  const { privateKickoffEventId, publishPrivateKickoff, readPrivateKickoffDeliveryAuthority, isPrivateKickoffCurrentTx } = await import("./private-kickoff");
  const eventId = privateKickoffEventId(gameId, memberId);
  if (receipt.idempotencyKey !== createHostedLinqDeliveryIdempotencyLookupKey(eventId)) return false;
  if (receipt.status === "generation_queued") {
    const policy = await readPrivateKickoffDeliveryAuthority(eventId, memberId);
    if (!policy || !await getPrisma().$transaction(tx => isPrivateKickoffCurrentTx(policy, tx, now))) return false;
    return recoverGameNotificationPointer(receipt.id, memberId, eventId);
  }
  const published = await publishPrivateKickoff(gameId, memberId, now);
  const startedAt = await getPrisma().game.findUnique({ where: { id: gameId }, select: { startedAt: true } });
  if (!published && (!startedAt?.startedAt || now.getTime() >= startedAt.startedAt.getTime() + 24 * 60 * 60_000)) {
    await getPrisma().hostedLinqDelivery.updateMany({ where: { id: receipt.id, status: "awaiting_generation" },
      data: { status: "skipped", skippedAt: now, skipReason: "game_private_kickoff_expired", retryAfterAt: null } });
  }
  return published;
}

async function processPrivateEveningIntent(receipt: GameChatIntent, now: Date): Promise<boolean> {
  const parts = /^([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(receipt.sourceRef ?? "");
  if (!parts) return false;
  const [, memberId, date] = parts;
  const { privateEveningEventId, publishPrivateEveningCheckIn, readPrivateEveningDeliveryAuthority, isPrivateEveningCurrentTx } = await import("./private-notification");
  const eventId = privateEveningEventId(memberId, date);
  if (receipt.idempotencyKey !== createHostedLinqDeliveryIdempotencyLookupKey(eventId)) return false;
  if (receipt.status === "generation_queued") {
    const policy = await readPrivateEveningDeliveryAuthority(eventId, memberId);
    if (!policy || !await getPrisma().$transaction(tx => isPrivateEveningCurrentTx(policy, tx, now))) return false;
    return recoverGameNotificationPointer(receipt.id, memberId, eventId);
  }
  const published = await publishPrivateEveningCheckIn(memberId, date, now);
  if (!published && now.getTime() >= receipt.createdAt.getTime() + 30 * 60_000) {
    await getPrisma().hostedLinqDelivery.updateMany({ where: { id: receipt.id, status: "awaiting_generation" },
      data: { status: "skipped", skippedAt: now, skipReason: "game_private_evening_expired", retryAfterAt: null } });
  }
  return published;
}

async function processEveningCheckInIntent(receipt: GameChatIntent, now: Date): Promise<boolean> {
  const parts = /^([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(receipt.sourceRef ?? "");
  if (!parts) return false;
  const [, roomId, date] = parts;
  const eventId = gameEveningEventId(roomId, date);
  if (receipt.idempotencyKey !== createHostedLinqDeliveryIdempotencyLookupKey(eventId)) return false;
  const expiresAt = new Date(receipt.createdAt.getTime() + 30 * 60_000);
  if (now >= expiresAt) {
    const published = receipt.status === "generation_queued";
    if (!published && await readHostedMailboxItemByDedupeKey({ dedupeKey: eventId, userId: roomId })) return false;
    await getPrisma().hostedLinqDelivery.updateMany({ where: { id: receipt.id, status: receipt.status },
      data: published ? { retryAfterAt: null } : { status: "skipped", skippedAt: now, skipReason: "game_evening_expired", retryAfterAt: null } });
    return false;
  }
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, roomId, eventId, now, "missed")
    : deliverGameEveningLifecycle(roomId, date, now);
}

async function processPairMissedDayIntent(receipt: GameChatIntent, now: Date): Promise<boolean> {
  const parts = /^([^:]+):([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(receipt.sourceRef ?? "");
  if (!parts) return false;
  const [, gameId, memberId, firstMissedDate] = parts;
  const eventId = gameMissedDayEventId(gameId, memberId, firstMissedDate);
  if (await endExpiredMissedDay(receipt, eventId, now)) return false;
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, gameId, eventId, now, "missed")
    : deliverGameMissedDayLifecycle(gameId, memberId, firstMissedDate, now);
}

/**
 * Retry while fresh. Past the deadline a check-in ends whatever held it up, with no provider read. An existing mailbox
 * item is frozen evidence, so nothing here drops a published check-in: it leaves the sweep and egress refuses it.
 */
async function endExpiredMissedDay(receipt: GameChatIntent, eventId: string, now: Date): Promise<boolean> {
  if (!isMissedCheckInExpired({ reservedAt: receipt.createdAt, now })) return false;
  const prisma = getPrisma();
  const published = receipt.status === "generation_queued";
  const room = receipt.payloadOwnerMemberId;
  if (!published && room && await readHostedMailboxItemByDedupeKey({ dedupeKey: eventId, userId: room, prisma })) return false;
  const ended = await prisma.hostedLinqDelivery.updateMany({ where: { id: receipt.id, status: receipt.status },
    data: published ? { retryAfterAt: null } : { status: "skipped", skippedAt: now, skipReason: "game_missed_check_in_expired", retryAfterAt: null } });
  if (ended.count === 1) logHostedOnboardingWarning("game.missed-day.expired", { reason: "past_deadline" });
  return true;
}

async function processGroupMissedDayIntent(receipt: GameChatIntent, now: Date): Promise<boolean> {
  const parts = /^([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(receipt.sourceRef ?? "");
  if (!parts) return false;
  const eventId = `game-missed:${parts[1]}:group:${parts[2]}`;
  if (receipt.idempotencyKey !== createHostedLinqDeliveryIdempotencyLookupKey(eventId)) return false;
  if (await endExpiredMissedDay(receipt, eventId, now)) return false;
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, parts[1], eventId, now, "missed")
    : deliverGroupMissedDayLifecycle(parts[1], parts[2], now);
}

async function processGameTalkIntent(receipt: GameChatIntent, now: Date, prisma: PrismaClient): Promise<boolean> {
  const identity = await readGameTalkReceiptIdentity(prisma, receipt);
  if (!identity) return skipGameNotice(receipt.idempotencyKey, prisma, now, receipt.id);
  return deliverGameTalk(identity.gameId, identity.proposalId, now, receipt);
}

async function processGameChallengeIntent(receipt: GameChatIntent, now: Date, prisma: PrismaClient): Promise<boolean> {
  const parts = /^([^:]+):([^:]+)$/u.exec(receipt.sourceRef ?? "");
  const eventId = parts ? gameChallengeKey(parts[1], parts[2]) : null;
  const { readGameChallengeCase, readGameChallengeInstructions } = await import("./service");
  const current = parts && eventId && receipt.idempotencyKey === createHostedLinqDeliveryIdempotencyLookupKey(eventId)
    ? await readGameChallengeCase(prisma, parts[1], parts[2], now) : null;
  const players = current?.state.players.filter(player => !player.leftAt).map(player => player.memberId) ?? [];
  if (!current || current.status !== "open" || !current.row.chatContainerMemberId || (current.row.maxPlayers !== 10 && !isPairRoster(players)) || !players.includes(current.challenge.actor)) {
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receipt.id, status: receipt.status },
      data: { status: "skipped", skippedAt: now, skipReason: "game_lifecycle_superseded", retryAfterAt: null } });
    return false;
  }
  if (!isGameOn(current.row)) return false;
  if (receipt.status === "generation_queued") return recoverGameNotificationWake(receipt.id, current.row.id, eventId!, now, "challenge");
  const instructions = await readGameChallengeInstructions(current);
  if (!instructions) return false;
  return deliverCurrentGameChatLifecycle({ boundOnly: true, eventId: eventId!, game: current.row, gameId: current.row.id,
    instructions, kind: "challenge", players, prisma, statuses: lifecycleStatuses("challenge") });
}

async function processGameRecapIntent(receipt: GameChatIntent, now: Date): Promise<boolean> {
  const eventId = `game-recap:${receipt.sourceRef}`;
  const scope = parseGameRecapEventId(eventId);
  if (!scope) return false;
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, scope.gameId, eventId, now, "recap")
    : deliverGameChatLifecycle(scope.gameId, "recap", undefined, now, scope.regenerationId);
}

async function processGameProposalIntent(receipt: GameChatIntent, gameId: string, now: Date, prisma: PrismaClient): Promise<boolean> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { inviteExpiresAt: true, maxPlayers: true, pendingChange: true, status: true } });
  const pending = parsePendingGameChange(game?.pendingChange);
  const { readCurrentGameChange } = await import("./service");
  const current = game?.maxPlayers !== 10 || (pending && await readCurrentGameChange(prisma, gameId, pending.id, now));
  const eventId = pending ? `game-change:${gameId}:${pending.id}` : null;
  const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  if (!game || !["live", "negotiating"].includes(game.status) || isGameInviteExpired(game, now)
    || !current || !pending || pending.origin === "chat" || key !== receipt.idempotencyKey) {
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receipt.id, status: receipt.status }, data: { status: "skipped", skippedAt: now, skipReason: "game_proposal_superseded", retryAfterAt: null } });
    return false;
  }
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, gameId, eventId!, now, "proposal")
    : deliverGameChangeProposal(gameId, pending.id, now);
}

async function isGroupRematchRevisionCurrent(game: Pick<Game, "maxPlayers" | "terms" | "chatContainerMemberId">, eventId: string): Promise<boolean> {
  if (game.maxPlayers !== 10 || !eventId.startsWith("game-rematch:")) return true;
  if (!game.chatContainerMemberId) return false;
  return await readGameRematchDeliveryRevision(eventId, game.chatContainerMemberId) === currentTerms(parseStoredTerms(game.terms)).n;
}

/** Publishing and the first signal can fail separately; retry the pointer only. */
async function recoverGameNotificationWake(receiptId: string, gameId: string, eventId: string, now: Date, kind: GameChatLifecycleKind | "proposal"): Promise<boolean> {
  const prisma = getPrisma();
  if (isRoomCheckInEvent(eventId)) return recoverRoomCheckInWake(receiptId, gameId, eventId, now);
  const notice = parseGameResolutionNotice(eventId);
  const resolution = notice ? await readGameChangeResolution(prisma, notice.gameId, notice.proposalId) : null;
  const game = notice ? resolution?.game : await prisma.game.findUnique({ where: { id: gameId }, include: { invitees: true, players: { take: 11 } } });
  const pendingInviteNotice = ["rematch", "proposal", "talk"].includes(kind);
  if (!game || !await isGroupRematchRevisionCurrent(game, eventId) || notice && (!resolution || gameResolutionNoticeKind(resolution.outcome) !== notice.kind)
    || !notice && !lifecycleStatuses(kind, game.maxPlayers).includes(game.status) || (pendingInviteNotice && isGameInviteExpired(game, now))) {
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receiptId, status: "generation_queued" }, data: { status: "skipped", skippedAt: now, skipReason: "game_lifecycle_superseded", retryAfterAt: null } });
    return false;
  }
  if (!game.chatContainerMemberId) return false;
  if (game.maxPlayers === 10 && !await revalidateGroupNotificationWake(game, eventId, now)) return false;
  const room = game.chatContainerMemberId;
  return recoverGameNotificationPointer(receiptId, room, eventId, game.maxPlayers === 10 ? undefined
    : async () => requireExactChat(room, await readPairGamePhones(lifecyclePlayerMemberIds(game, kind), prisma)));
}

function isRoomCheckInEvent(eventId: string): boolean {
  return eventId.startsWith("game-evening:") || /^game-missed:[^:]+:group:/u.test(eventId);
}

async function recoverRoomCheckInWake(receiptId: string, roomId: string, eventId: string, now: Date): Promise<boolean> {
  const prisma = getPrisma();
  if (eventId.startsWith("game-evening:")) {
    const authority = await readGameEveningDeliveryAuthority(eventId, roomId);
    const current = authority && await prisma.$transaction(tx => isEveningBatchCurrentTx(authority.policy, authority.memberIds, authority.audience, tx, now));
    if (!current) return supersedeMissedDay(eventId, now);
    return recoverGameNotificationPointer(receiptId, roomId, eventId);
  }
  const authority = await readGroupMissedDayDeliveryAuthority(eventId, roomId);
  const current = authority && await prisma.$transaction(tx => isGroupMissedDayBatchCurrentTx(authority.policy, authority.audience, tx, now));
  if (!current) return supersedeMissedDay(eventId, now);
  return recoverGameNotificationPointer(receiptId, roomId, eventId);
}

async function recoverGameNotificationPointer(receiptId: string, roomId: string, eventId: string, verifyRoster?: () => Promise<unknown>): Promise<boolean> {
  const prisma = getPrisma();
  const mailbox = await readHostedMailboxItemByDedupeKey({ dedupeKey: eventId, userId: roomId, prisma });
  if (!mailbox) return false;
  if (await isHostedMailboxItemConsumed({ item: mailbox, prisma })) {
    // Consumption hands retry ownership to the existing runtime/outbox. Keep
    // provider truth intact and stop this pre-generation wake sweep.
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receiptId, status: "generation_queued" }, data: { retryAfterAt: null } });
  } else {
    // A bootstrap wake precedes its route, so its fresh container has no provider roster to read yet.
    if (verifyRoster && await prisma.hostedThreadRoute.findFirst({ where: { containerMemberId: roomId }, select: { containerMemberId: true } })) await verifyRoster();
    await signalHostedMailboxAppendRuntime({ expectedUserId: roomId, mailboxItemId: mailbox.id });
  }
  return true;
}

async function revalidateGroupNotificationWake(game: GameChatLifecycleRecord, eventId: string, now: Date): Promise<boolean> {
  if (!eventId.startsWith("game-talk:") && !eventId.startsWith("game-challenge:")) {
    return Boolean(await readGroupGameChatAuthority(game, game.chatContainerMemberId!));
  }
  const prisma = getPrisma();
  try {
    const authority = await readGameProposalDeliveryPlayers(eventId, game.chatContainerMemberId!);
    await prisma.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, deliveryIdempotencyKey: eventId,
      containerMemberId: game.chatContainerMemberId!, now,
      ...(Array.isArray(authority) ? { playerMemberIds: authority } : { audience: authority as GameNoticeAudience | undefined }) }));
  } catch (error) {
    if (!isStaleNotice(error)) throw error;
    return skipGameNotice(createHostedLinqDeliveryIdempotencyLookupKey(eventId)!, prisma, now);
  }
  return true;
}

function lifecycleStatuses(kind: GameChatLifecycleKind | "proposal", maxPlayers = 2): string[] {
  if (maxPlayers === 10 && ["change_cancelled", "change_expired", "change_resolved"].includes(kind)) return ["live", "settled", "void"];
  if (kind === "talk") return ["negotiating", "invited", "live"];
  if (kind === "challenge") return ["live"];
  return kind === "rematch" ? ["invited"] : kind === "recap" ? ["settled"] : kind === "missed" ? ["live"] : kind === "change_expired" ? ["live", "negotiating", "settled", "void"] : kind === "cancelled" ? ["void"] : kind === "started" ? ["live"] : ["live", "negotiating"];
}

type GameChatLifecycleRecord = Game & { players: Array<{ memberId: string | null; seat: number; leftAt: Date | null }>; invitees: Array<{ memberId: string | null; recipientLookupKey: string | null }> };

function lifecyclePlayerMemberIds(game: GameChatLifecycleRecord | null, kind: GameChatLifecycleKind | "proposal"): string[] {
  if (game?.maxPlayers === 10) return game.players.flatMap(player => player.memberId && !player.leftAt ? [player.memberId] : []);
  if (kind !== "rematch") return game?.players.flatMap(player => player.memberId ? [player.memberId] : []) ?? [];
  if (!game?.createdBy || !game.invitees[0]?.memberId || game.players.length !== 1 || game.players[0]?.memberId !== game.createdBy) return [];
  return [game.createdBy, game.invitees[0]?.memberId];
}

function isCurrentGroupGameChatLifecycle(game: Pick<GameChatLifecycleRecord, "players" | "settledAt">, kind: GameChatLifecycleKind): boolean {
  if (kind === "missed") return false;
  if (kind === "started") return !game.players.some(player => player.leftAt);
  return kind !== "recap" || groupGameRecapPlayers(game) !== null;
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
    && (game.maxPlayers === 10 ? players.length > 0 : isGameMemberSet(players)) && (game.maxPlayers !== 10 || isCurrentGroupGameChatLifecycle(game, kind)));
}

export async function deliverGameChatLifecycle(gameId: string, kind: GameChatLifecycleKind, proposalId?: string, now = new Date(), regenerationId?: string): Promise<boolean> {
  if (kind === "talk") return deliverGameTalk(gameId, proposalId, now);
  if (kind === "challenge") throw new Error("Challenge delivery requires its reserved lifecycle receipt.");
  const prisma = getPrisma();
  const eventId = gameChatLifecycleEventId(gameId, kind, proposalId, regenerationId);
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { invitees: true, players: { select: { memberId: true, leftAt: true, seat: true }, take: 11 } } });
  const statuses = lifecycleStatuses(kind, game?.maxPlayers);
  const boundOnly = game?.maxPlayers === 10 || ["rematch", "cancelled", "change_expired", "recap"].includes(kind);
  const players = lifecyclePlayerMemberIds(game, kind);
  if (!isCurrentGameChatLifecycle(game, kind, statuses, players, now)) {
    await prisma.hostedLinqDelivery.updateMany({ where: { source: "game_lifecycle", idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId), template: `game_${kind}`, status: "awaiting_generation" }, data: { status: "skipped", skippedAt: now, skipReason: "game_lifecycle_superseded", retryAfterAt: null } });
    return false;
  }
  if (!isGameOn(game)) return false;
  const notice = parseGameResolutionNotice(eventId);
  if (notice) {
    const resolution = await readGameChangeResolution(prisma, gameId, notice.proposalId);
    if (!resolution || gameResolutionNoticeKind(resolution.outcome) !== kind) return false;
  }
  // Cancellation needs no private words or shared projection (void games are
  // absent there), and must never discover or create a new chat.
  if (boundOnly && !game.chatContainerMemberId) return false;
  const instructions = await lifecycleInstructions(game, kind, players, proposalId);
  if (!instructions) return false;
  const prepared = typeof instructions === "string" ? { instructions } : instructions;
  return deliverCurrentGameChatLifecycle({ boundOnly, eventId, game, gameId, ...prepared, kind, players, prisma, statuses });
}

async function deliverGameTalk(gameId: string, proposalId: string | undefined, now: Date, receipt?: GameChatIntent): Promise<boolean> {
  const prisma = getPrisma();
  const current = await readCurrentGameTalk(prisma, gameId, proposalId, now);
  const eventId = current ? gameChatLifecycleEventId(gameId, "talk", current.proposalId) : null;
  if (!current || !eventId || receipt && receipt.idempotencyKey !== createHostedLinqDeliveryIdempotencyLookupKey(eventId)) {
    await prisma.hostedLinqDelivery.updateMany({ where: { source: "game_lifecycle", template: "game_talk",
      ...(receipt ? { id: receipt.id } : { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(gameChatLifecycleEventId(gameId, "talk", proposalId)) }),
      status: { in: ["awaiting_generation", "generation_queued"] } },
      data: { status: "skipped", skippedAt: now, skipReason: "game_lifecycle_superseded", retryAfterAt: null } });
    return false;
  }
  const { game, actor, noteEncrypted } = current;
  if (!isGameOn(game)) return false;
  if (receipt?.status === "generation_queued") return recoverGameNotificationWake(receipt.id, gameId, eventId, now, "talk");
  const players = game.players.flatMap(player => player.memberId && (game.maxPlayers !== 10 || !player.leftAt) ? [player.memberId] : []);
  if (game.maxPlayers === 10) {
    const { readGameChatProfiles } = await import("./service");
    const profiles = await readGameChatProfiles([...players, actor]);
    const requesterName = profiles.find(profile => profile.memberId === actor)?.firstName;
    if (!requesterName) return false;
    const [note] = await openGameTexts([{ table: "game", rowId: gameId, field: `talk_note:${current.proposalId}`, memberId: actor, value: noteEncrypted }]);
    if (!note) return false;
    return deliverCurrentGameChatLifecycle({ boundOnly: true, eventId, game, gameId,
      instructions: buildGameTalkInstructions({ group: true, requesterName, note }), kind: "talk", players, prisma, statuses: lifecycleStatuses("talk") });
  }
  const { readGameChatState, readGameNoticeRoom } = await import("./service");
  const state = await readGameChatState(game.chatContainerMemberId ?? "", players);
  const shared = state.games.find(candidate => candidate.id === gameId && candidate.status === "negotiating");
  if (!shared) return false;
  const [note] = await openGameTexts([{ table: "game", rowId: gameId, field: `talk_note:${current.proposalId}`,
    memberId: actor, value: noteEncrypted }]);
  if (!note) return false;
  const instructions = buildGameTalkInstructions({ note,
    requesterName: shared.players.find(player => player.memberId === actor)!.firstName,
    recipientName: shared.players.find(player => player.memberId !== actor)!.firstName,
    terms: shared.terms, lengthDays: shared.lengthDays, startsOn: shared.startsOn,
    room: await readGameNoticeRoom(gameId, players) });
  return deliverCurrentGameChatLifecycle({ boundOnly: false, eventId, game, gameId, instructions,
    kind: "talk", players, prisma, statuses: lifecycleStatuses("talk") });
}

async function deliverGameMissedDayLifecycle(gameId: string, memberId: string, firstMissedDate: string, now: Date): Promise<boolean> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { invitees: true, players: { select: { memberId: true, leftAt: true, seat: true }, take: 11 } } });
  const players = game?.players.flatMap(player => player.memberId ? [player.memberId] : []) ?? [];
  const statuses = lifecycleStatuses("missed");
  if (!game || game.maxPlayers === 10 || !game.chatContainerMemberId || !statuses.includes(game.status) || !isPairRoster(players) || !players.includes(memberId)) return false;
  const { readGameChatState, readGameMissedCheckInBatch } = await import("./service");
  const state = await readGameChatState(game.chatContainerMemberId, players);
  const shared = state.games.find((candidate) => candidate.id === gameId);
  if (!shared) return false;
  const player = shared.players.find((candidate) => candidate.memberId === memberId);
  if (!player) return false;
  const active = state.games.filter((candidate) => candidate.status === "live");
  const misses = await readGameMissedCheckInBatch(active.map(candidate => candidate.id), firstMissedDate, now);
  const run = misses.find(miss => miss.gameId === gameId && miss.memberId === memberId);
  if (!run) return supersedeMissedDay(gameMissedDayEventId(gameId, memberId, firstMissedDate), now);
  const { readGameChatTranscript } = await import("./chat-tool");
  const transcript = await readGameChatTranscript({
    containerMemberId: game.chatContainerMemberId,
    playerNamesByMemberId: shared.players.map((candidate) => ({ memberId: candidate.memberId, name: candidate.firstName })),
    since: new Date(`${firstMissedDate}T00:00:00.000Z`),
  });
  const missedGames = misses.flatMap((miss) => {
    const candidate = active.find((game) => game.id === miss.gameId);
    const person = candidate?.players.find((player) => player.memberId === miss.memberId);
    return candidate && person ? [{ gameId: candidate.id, playerName: person.firstName,
      task: candidate.terms.tasks.find((task) => task.seat === person.seat)?.text ?? "", missedDates: miss.missedDates }] : [];
  });
  const instructions = buildGameMissedDayInstructions({ playerName: player.firstName, firstMissedDate, missedDates: run.missedDates, transcript,
    ...(active.length > 1 ? { missedGames } : {}) });
  return deliverCurrentGameChatLifecycle({ boundOnly: true, eventId: gameMissedDayEventId(gameId, memberId, firstMissedDate), game, gameId, instructions, kind: "missed", players, prisma, statuses });
}

async function supersedeMissedDay(eventId: string, now: Date): Promise<false> {
  await getPrisma().hostedLinqDelivery.updateMany({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId),
    status: { in: ["awaiting_generation", "generation_queued"] } },
    data: { status: "skipped", skippedAt: now, skipReason: "game_lifecycle_superseded", retryAfterAt: null } });
  return false;
}

async function deliverGroupMissedDayLifecycle(roomId: string, firstMissedDate: string, now: Date): Promise<boolean> {
  const eventId = `game-missed:${roomId}:group:${firstMissedDate}`;
  // Publication may have committed before its signal failed. Never replace frozen evidence.
  const existing = await readHostedMailboxItemByDedupeKey({ userId: roomId, dedupeKey: eventId });
  if (existing) {
    if (!await isHostedMailboxItemConsumed({ item: existing }) && await readGroupMissedDayDeliveryAuthority(eventId, roomId)) {
      await signalHostedMailboxAppendRuntime({ expectedUserId: roomId, mailboxItemId: existing.id });
    }
    return true;
  }
  const prepared = await prepareGroupMissedDay(roomId, firstMissedDate, now);
  if (!prepared) return supersedeMissedDay(eventId, now);
  const { readGameMissedCheckInWords } = await import("./service");
  const { readGameChatTranscript } = await import("./chat-tool");
  const { names, tasks } = await readGameMissedCheckInWords(prepared.games, firstMissedDate);
  const transcript = await readGameChatTranscript({ containerMemberId: roomId,
    playerNamesByMemberId: [...names].map(([memberId, name]) => ({ memberId, name })),
    since: new Date(`${firstMissedDate}T00:00:00.000Z`), throughConversationLaneSeq: prepared.policy.conversationLaneSeq });
  const idsByName = new Map([...names].map(([id, name]) => [name, id]));
  const instructions = buildGameMissedDayInstructions({ group: true, firstMissedDate,
    transcript: transcript.map(message => ({ ...message, memberId: idsByName.get(message.playerName)! })),
    players: [...names].flatMap(([memberId, playerName]) => {
      const misses = prepared.policy.batch.flatMap(game => game.misses.filter(miss => miss.memberId === memberId)
        .map(miss => ({ gameId: game.gameId, task: tasks.get(game.gameId)?.get(memberId) ?? "", missedDates: miss.missedDates })));
      return misses.length ? [{ memberId, playerName, misses }] : [];
    }),
  });
  const destination = await resolveHostedAssistantNotificationDestination({ memberId: roomId });
  if (!destination || destination.conversationShape !== "thread-container" || destination.route.channel !== "linq") return false;
  const queued = await enqueueGameLifecycle({ game: prepared.games.find(game => game.row.maxPlayers === 10)!.row,
    gameId: roomId, containerMemberId: roomId, kind: "missed", eventId, instructions, destination,
    players: prepared.audience.memberIds, audience: prepared.audience, groupMissedPolicy: prepared.policy, now });
  return queued || supersedeMissedDay(eventId, now);
}

async function deliverGameEveningLifecycle(roomId: string, date: string, now: Date): Promise<boolean> {
  const eventId = gameEveningEventId(roomId, date);
  const existing = await readHostedMailboxItemByDedupeKey({ userId: roomId, dedupeKey: eventId });
  if (existing) {
    if (!await isHostedMailboxItemConsumed({ item: existing }) && await readGameEveningDeliveryAuthority(eventId, roomId)) {
      await signalHostedMailboxAppendRuntime({ expectedUserId: roomId, mailboxItemId: existing.id });
    }
    return true;
  }
  const prepared = await prepareGameEveningCheckIn(roomId, date, now);
  if (!prepared) return supersedeMissedDay(eventId, now);
  const { readGameMissedCheckInWords } = await import("./service");
  const { readGameChatTranscript } = await import("./chat-tool");
  const { names, tasks } = await readGameMissedCheckInWords(prepared.games, date);
  const midnight = prepared.zones.map(zone => resolveFloatingIsoTimestampInTimeZone(`${date}T00:00:00`, zone))
    .flatMap(value => value ? [new Date(value.timestamp).getTime()] : []);
  if (!midnight.length) return false;
  const transcript = await readGameChatTranscript({ containerMemberId: roomId,
    playerNamesByMemberId: [...names].map(([memberId, name]) => ({ memberId, name })),
    since: new Date(Math.min(...midnight)), throughConversationLaneSeq: prepared.policy.conversationLaneSeq });
  const idsByName = new Map([...names].map(([id, name]) => [name, id]));
  const players = [...names].flatMap(([memberId, playerName]) => {
    const ownTasks = prepared.policy.batch.flatMap(game => game.memberIds.includes(memberId)
      ? [{ gameId: game.gameId, task: tasks.get(game.gameId)?.get(memberId) ?? "" }] : []);
    return ownTasks.length ? [{ memberId, playerName, tasks: ownTasks }] : [];
  });
  const instructions = buildGameEveningCheckInInstructions({ date,
    transcript: transcript.map(message => ({ ...message, memberId: idsByName.get(message.playerName)! })), players });
  const destination = await resolveHostedAssistantNotificationDestination({ memberId: roomId });
  if (!destination || destination.conversationShape !== "thread-container" || destination.route.channel !== "linq") return false;
  const queued = await enqueueGameLifecycle({ game: prepared.games[0]!.row, gameId: roomId, containerMemberId: roomId,
    kind: "missed", eventId, instructions, destination, players: prepared.memberIds, audience: prepared.audience,
    eveningPolicy: prepared.policy, now });
  return queued || supersedeMissedDay(eventId, now);
}

/** The game names the pair. Stored participant rows can be the stale evidence a roster read must repair. */
async function readPairGamePhones(players: readonly string[], prisma: PrismaClient): Promise<string[]> {
  const identities = await Promise.all(players.map((memberId) => readHostedMemberIdentity({ memberId, prisma })));
  const phones = identities.flatMap((identity) => identity?.phoneNumberVerifiedAt && identity.phoneNumber ? [identity.phoneNumber] : []);
  if (!isPairRoster(phones) || new Set(phones).size !== phones.length) throw new Error("Game chat requires verified players.");
  return phones;
}

async function deliverCurrentGameChatLifecycle(input: {
  boundOnly: boolean;
  eventId: string;
  game: GameChatLifecycleRecord;
  gameId: string;
  instructions: string;
  termsVersion?: number;
  kind: GameChatLifecycleKind;
  players: readonly string[];
  prisma: PrismaClient;
  statuses: string[];
}): Promise<boolean> {
  const { boundOnly, eventId, game, gameId, instructions, kind, players, prisma } = input;
  if (game.maxPlayers === 10) {
    if (!game.chatContainerMemberId || !game.audienceKey) return false;
    const roomAudience = await readGroupGameNoticeAuthority(game, game.chatContainerMemberId);
    if (!roomAudience) return kind === "talk" || kind === "challenge"
      ? skipGameNotice(createHostedLinqDeliveryIdempotencyLookupKey(eventId), prisma, new Date()) : false;
    const talk = /^game-talk:([^:]+):([^:]+)$/u.exec(eventId);
    const audience = talk ? await prepareGameTalkAudience(prisma, talk[1], talk[2], roomAudience) : roomAudience;
    const destination = await resolveHostedAssistantNotificationDestination({ memberId: game.chatContainerMemberId, prisma });
    if (!destination || destination.conversationShape !== "thread-container" || destination.route.channel !== "linq") return false;
    return enqueueGameLifecycle({ audience, game, containerMemberId: game.chatContainerMemberId, gameId, kind, eventId, instructions, destination, players, termsVersion: input.termsVersion });
  }
  const phones = await readPairGamePhones(players, prisma);
  let containerMemberId = game.chatContainerMemberId;
  if (!containerMemberId) {
    containerMemberId = await bindPairGameChat(gameId, players, await findExistingGameChat(players, phones));
  }
  const destination = containerMemberId ? await resolveHostedAssistantNotificationDestination({ memberId: containerMemberId, prisma }) : null;
  if (!destination) return boundOnly ? false : (await prepareGameChatBootstrap(gameId, eventId, instructions)) !== null;
  if (destination.conversationShape !== "thread-container" || destination.route.channel !== "linq") throw new Error("Game chat route is unavailable.");
  await requireExactChat(containerMemberId!, phones);
  return enqueueGameLifecycle({ game, containerMemberId: containerMemberId!, gameId, kind, eventId, instructions, destination, players });
}

/** Read shared context only for notices that actually describe game terms. */
async function lifecycleInstructions(game: Pick<Game, "id" | "chatContainerMemberId" | "maxPlayers">, kind: GameChatLifecycleKind, players: readonly string[], proposalId?: string): Promise<string | { instructions: string; termsVersion: number } | null> {
  if (kind === "cancelled") return buildGameInviteCancelledInstructions(game.maxPlayers === 10);
  const { readGameNoticeRoom } = await import("./service");
  const noticeRoom = () => game.maxPlayers === 10
    ? readGameNoticeRoom(game.id, players, game.chatContainerMemberId ?? "") : readGameNoticeRoom(game.id, players);
  if (kind === "recap") {
    if (!game.chatContainerMemberId) return null;
    const { readGameRecapMaterial } = await import("./service");
    const { readGameRecapChatMessages } = await import("./chat-tool");
    // Instructions carry no entries; publication fixes the witness.
    const material = await readGameRecapMaterial(game.id, game.chatContainerMemberId, players);
    return material
      ? buildGameRecapInstructions(await readGameRecapChatMessages({ containerMemberId: game.chatContainerMemberId, material }), await noticeRoom(), game.maxPlayers === 10)
      : null;
  }
  if (kind === "rematch") {
    const { readGameRematchNotice } = await import("./service");
    const notice = await readGameRematchNotice(game.id, players);
    return notice ? ("maxPlayers" in notice ? { instructions: buildGameRematchInstructions(notice), termsVersion: notice.termsVersion } : buildGameRematchInstructions(notice)) : null;
  }
  if (["change_cancelled", "change_expired", "change_resolved"].includes(kind)) {
    return resolutionInstructions(game, kind, proposalId, await noticeRoom());
  }
  const { readGameChatState } = await import("./service");
  const state = await readGameChatState(game.chatContainerMemberId ?? "", players);
  const shared = state.games.find((candidate) => candidate.id === game.id);
  if (!shared || !lifecycleStatuses(kind).includes(shared.status)) return null;
  const room = await noticeRoom();
  return kind === "started" ? buildGameKickoffInstructions({ kind, game: shared, room }) : buildGameChangeCancelledInstructions(room);
}

async function resolutionInstructions(game: Pick<Game, "id" | "maxPlayers">, kind: GameChatLifecycleKind, proposalId: string | undefined, room: Awaited<ReturnType<typeof import("./service").readGameNoticeRoom>>): Promise<string | null> {
  const resolution = proposalId ? await readGameChangeResolution(getPrisma(), game.id, proposalId) : null;
  if (!resolution || gameResolutionNoticeKind(resolution.outcome) !== kind) return null;
  const group = game.maxPlayers === 10;
  if (kind === "change_cancelled") return buildGameChangeCancelledInstructions(room, group);
  if (kind === "change_expired") return resolution.reason ? buildGameChangeExpiredInstructions(resolution.reason, room, group) : null;
  return buildGameChangeResolvedInstructions({ applied: resolution.outcome === "change_applied", reason: resolution.reason,
    tally: resolution.tally, changeKind: resolution.changeKind, startsOn: resolution.startsOn }, room);
}

/** Rechecks, inside the append transaction, that the notice still describes the current game and room. */
async function isGameLifecycleAppendCurrentTx(input: Parameters<typeof enqueueGameLifecycle>[0], tx: Prisma.TransactionClient): Promise<boolean> {
  if (input.eveningPolicy) return isEveningBatchCurrentTx(input.eveningPolicy, input.players, input.audience, tx, input.now ?? new Date());
  if (input.groupMissedPolicy) return !!input.audience && await isGroupMissedDayBatchCurrentTx(input.groupMissedPolicy, input.audience, tx, input.now ?? new Date());
  const current = await tx.game.findFirst({ where: { id: input.gameId, status: { in: lifecycleStatuses(input.kind, input.game.maxPlayers) }, chatContainerMemberId: input.containerMemberId },
    include: { invitees: { select: { memberId: true, recipientLookupKey: true } }, players: { take: 11 } } });
  if (!current || (input.kind === "rematch" && isGameInviteExpired(current, new Date()))) return false;
  if (input.kind === "rematch" && current.maxPlayers === 10 && currentTerms(parseStoredTerms(current.terms)).n !== input.termsVersion) return false;
  if (current.maxPlayers === 10 && !isCurrentGroupGameChatLifecycle(current, input.kind)) return false;
  const notice = parseGameResolutionNotice(input.eventId);
  if (notice) {
    const resolution = await readGameChangeResolution(tx, input.gameId, notice.proposalId);
    if (!resolution || gameResolutionNoticeKind(resolution.outcome) !== input.kind) return false;
  }
  return !input.audience || Boolean(await readGroupGameChatAuthority(current, input.containerMemberId, input.audience, tx));
}

async function enqueueGameLifecycle(input: {
  game: Pick<Game, "maxPlayers" | "audienceKey">;
  audience?: GameNoticeAudience;
  termsVersion?: number | undefined;
  containerMemberId: string; gameId: string; kind: GameChatLifecycleKind; eventId: string; instructions: string;
  players: readonly string[];
  groupMissedPolicy?: HostedGameGroupMissedCheckInPolicy;
  eveningPolicy?: HostedGameEveningCheckInPolicy;
  now?: Date;
  destination: NonNullable<Awaited<ReturnType<typeof resolveHostedAssistantNotificationDestination>>>;
}): Promise<boolean> {
  const prisma = getPrisma();
  const existing = await readHostedMailboxItemByDedupeKey({ dedupeKey: input.eventId, userId: input.containerMemberId, prisma });
  if (existing && !["talk", "challenge"].includes(input.kind)) {
    if (input.game.maxPlayers === 10 && input.kind === "rematch") {
      const revision = await readGameRematchDeliveryRevision(input.eventId, input.containerMemberId);
      const current = await prisma.game.findUnique({ where: { id: input.gameId }, select: { terms: true } });
      if (!current || revision !== currentTerms(parseStoredTerms(current.terms)).n) return false;
    }
    await markGameChatGenerationQueuedTx(input.eventId, prisma, input.containerMemberId);
    if (!await isHostedMailboxItemConsumed({ item: existing, prisma })) await signalHostedMailboxAppendRuntime({ expectedUserId: input.containerMemberId, mailboxItemId: existing.id });
    return true;
  }
  const bound = bindHostedAssistantNotificationDestination({ destination: input.destination, memberId: input.containerMemberId });
  const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma, envelope: buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.eventId, memberId: input.containerMemberId, occurredAt: new Date().toISOString(),
    notification: { ...bound, instructions: input.instructions, responsePolicy: input.eveningPolicy ?? input.groupMissedPolicy ?? (input.kind === "recap"
      ? { kind: "require_game_recap", gameId: input.gameId, eventId: input.eventId,
          ...(input.game.maxPlayers === 10
            ? { pairFingerprint: gameGroupLoreFingerprint(input.game.audienceKey!), loreAccess: "read" }
            : { pairFingerprint: gamePairLoreFingerprint(input.players) }) }
      : input.kind === "missed"
      ? (() => {
          const match = /^game-missed:[^:]+:([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(input.eventId);
          if (!match) throw new TypeError("Invalid missed-game event authority.");
          return { kind: "game_missed_check_in" as const, gameId: input.gameId, eventId: input.eventId,
            memberId: match[1], firstMissedDate: match[2], pairFingerprint: gamePairLoreFingerprint(input.players) };
        })()
      : input.kind === "rematch" && input.game.maxPlayers === 10
      ? { kind: "require_game_rematch", gameId: input.gameId, eventId: input.eventId, termsVersion: input.termsVersion! }
      : { kind: "require_send" }), deliveryDedupeToken: input.eventId, deliveryIdempotencyKey: input.eventId, deliveryDispatchMode: "queue-only" },
  }) });
  let appended;
  try {
    appended = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (input.kind === "recap" || input.kind === "rematch" && input.game.maxPlayers === 10) await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.gameId} FOR UPDATE`;
      if (bound.externalThreadRouteAuthority) await assertHostedAssistantNotificationRouteAuthority({ authority: bound.externalThreadRouteAuthority, prisma: tx });
      if (input.kind === "talk" || input.kind === "challenge") {
        await assertGameProposalDeliveryCurrentTx({ tx, deliveryIdempotencyKey: input.eventId,
          containerMemberId: input.containerMemberId, playerMemberIds: input.players, audience: input.audience });
        const result = existing ? { mailboxItemId: existing.id } : await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
        await markGameChatGenerationQueuedTx(input.eventId, tx, input.containerMemberId);
        return result;
      }
      if (!await isGameLifecycleAppendCurrentTx(input, tx)) return null;
      if (input.kind === "recap" && !await recordGameRecapWitnessTx(tx, input.gameId, input.eventId)) return null;
      const result = await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
      await markGameChatGenerationQueuedTx(input.eventId, tx, input.containerMemberId);
      return result;
    });
  } catch (error) {
    if (!isStaleNotice(error)) throw error;
    return skipGameNotice(createHostedLinqDeliveryIdempotencyLookupKey(input.eventId)!, prisma, new Date());
  }
  if (!appended) return false;
  if (existing && await isHostedMailboxItemConsumed({ item: existing, prisma })) return true;
  await signalHostedMailboxAppendRuntime({ expectedUserId: input.containerMemberId, mailboxItemId: appended.mailboxItemId });
  return true;
}

function isStaleNotice(error: unknown): boolean {
  return isRecord(error) && error.code === "GAME_CHANGE_SUPERSEDED";
}

async function skipGameNotice(idempotencyKey: string | null, prisma: PrismaClient, now: Date, receiptId?: string): Promise<false> {
  if (!receiptId && !idempotencyKey) return false;
  await prisma.hostedLinqDelivery.updateMany({ where: { ...(receiptId ? { id: receiptId } : { idempotencyKey }), source: "game_lifecycle", status: { in: ["awaiting_generation", "generation_queued"] } },
    data: { status: "skipped", skippedAt: now, skipReason: "game_lifecycle_superseded", retryAfterAt: null } });
  return false;
}
