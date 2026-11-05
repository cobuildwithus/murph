import "server-only";
import { groupGameRecapPlayers } from "./recap-cohort";

import { isPairRoster, isGameMemberSet } from "./roster";
import type { Game, HostedLinqDelivery, Prisma, PrismaClient } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { parseGameRecapEventId, buildGameTalkInstructions, buildGameKickoffInstructions, buildGameRematchInstructions, buildGameChangeCancelledInstructions, buildGameChangeExpiredInstructions, buildGameChangeResolvedInstructions, buildGameInviteCancelledInstructions, buildGameMissedDayInstructions, buildGameRecapInstructions } from "@murphai/hosted-execution/runtime-control";
import { gameResolutionNoticeKind, parseGameResolutionNotice, readGameChangeResolution } from "./change-resolution";
import { openGameTexts } from "./crypto";
import { readCurrentGameTalk } from "./talk";
import { getPrisma } from "../prisma";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxItemByDedupeKey } from "../hosted-mailbox/store";
import { assertHostedAssistantNotificationRouteAuthority, bindHostedAssistantNotificationDestination, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { readGroupGameChatAuthority, type GameChatAudience, bindPairGameChat, findExistingGameChat, requireExactChat } from "./chat-membership";
import { prepareGameChatBootstrap, reconcileFrozenGameChatBootstrapReceipt } from "./chat-bootstrap";
import { gameChatLifecycleEventId, gameMissedDayEventId, markGameChatGenerationQueuedTx, type GameChatLifecycleKind } from "./chat-lifecycle-receipt";
import { isGameOn } from "./access";
import { parsePendingGameChange } from "./changes";
import { deliverGameChangeProposal } from "./chat-delivery";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { currentTerms, parseStoredTerms, gameChallengeKey, isGameInviteExpired } from "./rules";
import type { HostedGameGroupMissedCheckInPolicy } from "@murphai/hosted-execution/runtime-control";
import { isGroupMissedDayBatchCurrentTx, prepareGroupMissedDay, readGroupMissedDayDeliveryAuthority } from "./group-missed-day";
import { gameGroupLoreFingerprint, gamePairLoreFingerprint } from "./audience";
import { readGameRematchDeliveryRevision } from "./chat-delivery-authority";

// One discovery (20 × 3s plus one 3s recheck) and one frozen recovery
// (10s create + 3s roster check) cap provider wait at 76s per 180s cron.
// Database/crypto work remains outside those provider calls and short locks.
const LIFECYCLE_BATCH = 1;

/**
 * Selected in the query, before the batch limit: a receipt this build cannot
 * process (for example one written by a newer build before a rollback) must
 * never become the oldest due row that every sweep picks and skips.
 */
const LIFECYCLE_TEMPLATES = ["game_started", "game_rematch", "game_proposal", "game_talk", "game_change_cancelled", "game_change_expired", "game_change_resolved", "game_cancelled", "game_recap", "game_missed", "game_group_missed", "game_challenge"];

/** The existing minute sweep recovers accepted intent even if the app never returns. */
export async function drainGameChatLifecycle(input: { prisma?: PrismaClient; now?: Date; signal?: AbortSignal } = {}): Promise<{ attempted: number; queued: number; deferred: number }> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const { reserveDueGameMissedDayCheckIns } = await import("./service");
  await reserveDueGameMissedDayCheckIns(now);
  const pending = await prisma.hostedLinqDelivery.findMany({
    where: { source: "game_lifecycle", template: { in: LIFECYCLE_TEMPLATES }, sourceRef: { not: null }, OR: [
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
    if (!LIFECYCLE_TEMPLATES.includes(receipt.template ?? "") || !receipt.sourceRef) continue;
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
  if (receipt.template === "game_group_missed") return processGroupMissedDayIntent(receipt, now);
  if (receipt.template === "game_talk") return deliverGameTalk(receipt.sourceRef!, undefined, now, receipt);
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

async function processPairMissedDayIntent(receipt: GameChatIntent, now: Date): Promise<boolean> {
  const parts = /^([^:]+):([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(receipt.sourceRef ?? "");
  if (!parts) return false;
  const [, gameId, memberId, firstMissedDate] = parts;
  const eventId = gameMissedDayEventId(gameId, memberId, firstMissedDate);
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, gameId, eventId, now, "missed")
    : deliverGameMissedDayLifecycle(gameId, memberId, firstMissedDate, now);
}

async function processGroupMissedDayIntent(receipt: GameChatIntent, now: Date): Promise<boolean> {
  const parts = /^([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(receipt.sourceRef ?? "");
  if (!parts) return false;
  const eventId = `game-missed:${parts[1]}:group:${parts[2]}`;
  if (receipt.idempotencyKey !== createHostedLinqDeliveryIdempotencyLookupKey(eventId)) return false;
  return receipt.status === "generation_queued"
    ? recoverGameNotificationWake(receipt.id, parts[1], eventId, now, "missed")
    : deliverGroupMissedDayLifecycle(parts[1], parts[2], now);
}

async function processGameChallengeIntent(receipt: GameChatIntent, now: Date, prisma: PrismaClient): Promise<boolean> {
  const parts = /^([^:]+):([^:]+)$/u.exec(receipt.sourceRef ?? "");
  const eventId = parts ? gameChallengeKey(parts[1], parts[2]) : null;
  const { readGameChallengeCase, readGameChallengeInstructions } = await import("./service");
  const current = parts && eventId && receipt.idempotencyKey === createHostedLinqDeliveryIdempotencyLookupKey(eventId)
    ? await readGameChallengeCase(prisma, parts[1], parts[2], now) : null;
  const players = current?.state.players.filter(player => !player.leftAt).map(player => player.memberId) ?? [];
  if (!current || current.status !== "open" || !current.row.chatContainerMemberId || !isPairRoster(players) || !players.includes(current.challenge.actor)) {
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
  if (/^game-missed:[^:]+:group:/u.test(eventId)) {
    const authority = await readGroupMissedDayDeliveryAuthority(eventId, gameId);
    const current = authority && await prisma.$transaction(tx => isGroupMissedDayBatchCurrentTx(authority.policy, authority.audience, tx, now));
    if (!current) return supersedeMissedDay(eventId, now);
    return recoverGameNotificationPointer(receiptId, gameId, eventId);
  }
  const notice = parseGameResolutionNotice(eventId);
  const resolution = notice ? await readGameChangeResolution(prisma, notice.gameId, notice.proposalId) : null;
  const game = notice ? resolution?.game : await prisma.game.findUnique({ where: { id: gameId }, include: { invitees: true, players: { take: 11 } } });
  const pendingInviteNotice = ["rematch", "proposal", "talk"].includes(kind);
  if (!game || !await isGroupRematchRevisionCurrent(game, eventId) || notice && (!resolution || gameResolutionNoticeKind(resolution.outcome) !== notice.kind)
    || !notice && !lifecycleStatuses(kind).includes(game.status) || (pendingInviteNotice && isGameInviteExpired(game, now))) {
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receiptId, status: "generation_queued" }, data: { status: "skipped", skippedAt: now, skipReason: "game_lifecycle_superseded", retryAfterAt: null } });
    return false;
  }
  if (!game.chatContainerMemberId) return false;
  if (game.maxPlayers === 10 && !await readGroupGameChatAuthority(game, game.chatContainerMemberId)) return false;
  return recoverGameNotificationPointer(receiptId, game.chatContainerMemberId, eventId);
}

async function recoverGameNotificationPointer(receiptId: string, roomId: string, eventId: string): Promise<boolean> {
  const prisma = getPrisma();
  const mailbox = await readHostedMailboxItemByDedupeKey({ dedupeKey: eventId, userId: roomId, prisma });
  if (!mailbox) return false;
  if (mailbox.consumedAt !== null) {
    // Consumption hands retry ownership to the existing runtime/outbox. Keep
    // provider truth intact and stop this pre-generation wake sweep.
    await prisma.hostedLinqDelivery.updateMany({ where: { id: receiptId, status: "generation_queued" }, data: { retryAfterAt: null } });
  } else {
    await signalHostedMailboxAppendRuntime({ expectedUserId: roomId, mailboxItemId: mailbox.id });
  }
  return true;
}

function lifecycleStatuses(kind: GameChatLifecycleKind | "proposal", maxPlayers = 2): string[] {
  if (maxPlayers === 10 && ["change_cancelled", "change_expired", "change_resolved"].includes(kind)) return ["live", "settled", "void"];
  if (kind === "talk") return ["negotiating"];
  if (kind === "challenge") return ["live"];
  return kind === "rematch" ? ["invited"] : kind === "recap" ? ["settled"] : kind === "missed" ? ["live"] : kind === "change_expired" ? ["live", "negotiating", "settled", "void"] : kind === "cancelled" ? ["void"] : kind === "started" ? ["live"] : ["live", "negotiating"];
}

type GameChatLifecycleRecord = Game & { players: Array<{ memberId: string | null; seat: number; leftAt: Date | null }>; invitees: Array<{ memberId: string | null; recipientLookupKey: string | null }> };

function lifecyclePlayerMemberIds(game: GameChatLifecycleRecord | null, kind: GameChatLifecycleKind): string[] {
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
  const players = game.players.flatMap(player => player.memberId ? [player.memberId] : []);
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
    if (existing.consumedAt === null) await signalHostedMailboxAppendRuntime({ expectedUserId: roomId, mailboxItemId: existing.id });
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
    const audience = await readGroupGameChatAuthority(game, game.chatContainerMemberId);
    if (!audience) return false;
    const destination = await resolveHostedAssistantNotificationDestination({ memberId: game.chatContainerMemberId, prisma });
    if (!destination || destination.conversationShape !== "thread-container" || destination.route.channel !== "linq") return false;
    return enqueueGameLifecycle({ audience, game, containerMemberId: game.chatContainerMemberId, gameId, kind, eventId, instructions, destination, players, termsVersion: input.termsVersion });
  }
  const identities = await Promise.all(players.map((memberId) => readHostedMemberIdentity({ memberId, prisma })));
  const phones = identities.flatMap((identity) => identity?.phoneNumberVerifiedAt && identity.phoneNumber ? [identity.phoneNumber] : []);
  if (!isPairRoster(phones) || new Set(phones).size !== phones.length) throw new Error("Game chat requires verified players.");
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
  if (input.groupMissedPolicy) return !!input.audience && await isGroupMissedDayBatchCurrentTx(input.groupMissedPolicy, input.audience, tx, input.now ?? new Date());
  const current = await tx.game.findFirst({ where: { id: input.gameId, status: { in: lifecycleStatuses(input.kind, input.game.maxPlayers) }, chatContainerMemberId: input.containerMemberId },
    include: { invitees: { select: { memberId: true, recipientLookupKey: true } }, players: { take: 11 } } });
  if (!current || (input.kind === "rematch" && isGameInviteExpired(current, new Date()))) return false;
  if (input.kind === "rematch" && current.maxPlayers === 10 && currentTerms(parseStoredTerms(current.terms)).n !== input.termsVersion) return false;
  if (input.kind === "talk" && !await readCurrentGameTalk(tx, input.gameId, input.eventId.split(":")[2], new Date())) return false;
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
  audience?: GameChatAudience;
  termsVersion?: number | undefined;
  containerMemberId: string; gameId: string; kind: GameChatLifecycleKind; eventId: string; instructions: string;
  players: readonly string[];
  groupMissedPolicy?: HostedGameGroupMissedCheckInPolicy;
  now?: Date;
  destination: NonNullable<Awaited<ReturnType<typeof resolveHostedAssistantNotificationDestination>>>;
}): Promise<boolean> {
  const prisma = getPrisma();
  const existing = await readHostedMailboxItemByDedupeKey({ dedupeKey: input.eventId, userId: input.containerMemberId, prisma });
  if (existing) {
    if (input.game.maxPlayers === 10 && input.kind === "rematch") {
      const revision = await readGameRematchDeliveryRevision(input.eventId, input.containerMemberId);
      const current = await prisma.game.findUnique({ where: { id: input.gameId }, select: { terms: true } });
      if (!current || revision !== currentTerms(parseStoredTerms(current.terms)).n) return false;
    }
    await markGameChatGenerationQueuedTx(input.eventId, prisma, input.containerMemberId);
    if (existing.consumedAt === null) await signalHostedMailboxAppendRuntime({ expectedUserId: input.containerMemberId, mailboxItemId: existing.id });
    return true;
  }
  const bound = bindHostedAssistantNotificationDestination({ destination: input.destination, memberId: input.containerMemberId });
  const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma, envelope: buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.eventId, memberId: input.containerMemberId, occurredAt: new Date().toISOString(),
    notification: { ...bound, instructions: input.instructions, responsePolicy: input.groupMissedPolicy ?? (input.kind === "recap"
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
  const appended = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (input.kind === "rematch" && input.game.maxPlayers === 10) await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.gameId} FOR UPDATE`;
    if (bound.externalThreadRouteAuthority) await assertHostedAssistantNotificationRouteAuthority({ authority: bound.externalThreadRouteAuthority, prisma: tx });
    if (!await isGameLifecycleAppendCurrentTx(input, tx)) return null;
    const result = await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
    await markGameChatGenerationQueuedTx(input.eventId, tx, input.containerMemberId);
    return result;
  });
  if (!appended) return false;
  await signalHostedMailboxAppendRuntime({ expectedUserId: input.containerMemberId, mailboxItemId: appended.mailboxItemId });
  return true;
}
