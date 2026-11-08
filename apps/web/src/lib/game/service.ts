import "server-only";
import { clearGameRecapQuotingEntryTx, gameRecapStoryMayQuoteEntry, readLatestGameRecapEventIdTx, settleGameRecapGenerationTx, readGameRecapStoryWitnesses, readPermittedGameRecapEntryIds } from "./recap-witness";
import { compareGroupRematch, rematchSeat } from "./rematch";

import { parseGameRecapEventId, hostedGameRecapSchema, type GameNoticeRoom, type HostedGameChatState, type HostedGameUpdate, type HostedGameRecap } from "@murphai/hosted-execution/runtime-control";
import { groupGameRecapPlayers } from "./recap-cohort";
import { gameChatProgress } from "./chat-progress";
import { buildGameChallengeInstructions } from "./challenge";
import { randomBytes, randomUUID } from "node:crypto";
import { memoryDisplayNameSchema } from "@murphai/contracts";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { submitMemberAction } from "../member-actions/submit";
import { adoptVaultGameProfile } from "./vault-profile";

import { Prisma, type Game, type GameEntry, type GameInvitee, type GamePlayer, type GameProfile, type GameReport } from "@prisma/client";

import { toPrismaJsonObject } from "../device-sync/prisma-store/prisma-json";
import { isUniqueViolation } from "../device-sync/prisma-store/prisma-errors";
import { generateHostedRandomPrefixedId, isRecord, sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { assertHostedDirectAssistantNotificationRouteAuthority, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { readHostedRuntimeAiAccessDecision } from "../hosted-onboarding/member-access";
import { resolveHostedRuntimeAiUsageGate } from "../hosted-orchestration/runtime-usage-decision";
import { readGamePushRoutes } from "./push-delivery";
import { gameReminderReach } from "./reminders";
import { GAME_REMINDER_OFF_CHOICE_EVENT, recordGameReminderPreferencesTx } from "./reminder-preferences";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { areGameDevToolsAllowed, areGameGroupsEnabled, gameOnSql, gameOnWhere, isGameEnabled, isGameEnabledFor, isGameOn, mediaKeyOwner, mediaKeyPrefixFor } from "./access";
import { parseGameAcceptance, parseGameCommand, type GameCommand } from "./command";
import type { GameReminders } from "./contract";
import { addressedGameInvite, lockGameAudience, prepareGameAudience, readGameVerifiedContacts, verifiedGameContactKeys } from "./audience";
import { lookupHostedGroupParticipantMemberIdsByHandles } from "../hosted-groups/participant-member";
import { moderateGameCommand } from "./moderation";
import { parseStoredGameEntryData } from "./entry-data";
import {
  GAME_ENTRY_KINDS,
  type GamePendingChange,
  type AcceptInviteBody,
  type GameChange,
  type GameDayOutcome,
  type GameEntryKind,
  type GameError,
  type GameHistoryView,
  type GameHomeView,
  type GameProfileView,
  type GameInvitePreview,
  type GameStatus,
  type GameView,
  type CreateGameView,
} from "./contract";
import { labelTarget, openGameTexts, sealGameText, openGameMedia, sealGameMedia, type GameSealTarget } from "./crypto";
import { gameMediaDelivery, servesSignedGameMedia, statGameMedia } from "./media";
import {
  currentTerms,
  calendarPlayers,
  termsForDay,
  eligibleFromDay,
  canRedeemGroupTicket,
  gameDayOne,
  dayIndexAt,
  liveEntry,
  attemptsUsed,
  isScheduledDay,
  decideCancelInvite,
  areGroupTermsOpen,
  assertGroupTermsOpen,
  decideLeave,
  remainingPlayers,
  decideDayCompletion,
  decideDevAdvance,
  decideJoin,
  decideNegotiationStart,
  decideNewTerms,
  groupTaskOverrideSeats,
  decidePost,
  decideChallenge,
  gameChallengeKey,
  gameChallengeStatus,
  type RuleChallenge,
  decideSettle,
  decideStartNow,
  decideWithdraw,
  GAME_ERROR_STATUS,
  GAME_INVITE_TTL_MS,
  GAME_MAX_LENGTH_DAYS,
  GameRuleError,
  gameOffDayMessage,
  isGameDue,
  isGameDecided,
  isGameInviteExpired,
  isTicketExpired,
  GAME_MAX_OPEN_PER_PAIR,
  needsPostToday,
  parseStoredResult,
  parseStoredTerms,
  parseTermWords,
  effectiveTermWords,
  playerFor,
  reject,
  settleDueAt,
  type RuleState,
  type Schedule,
  type StoredResult,
  type GameTerms,
  type TermWords,
} from "./rules";
import { addDays, daysBetween, gameLocalDate } from "./time";
import { agreedDayOne, gameChangeCancellationNeedsNotice, decideApprovedGameChange, pendingGameChangeView, decideGameChange, gameChangeControls, gameChangeMajority, normalizeGroupGameChange, gameChangeRefusal, isGameChangeExpired, isGameChangeOutdated, isSameGameChange, parsePendingGameChange, type StoredGamePendingChange } from "./changes";
import { prepareGameChangeWords, readPendingGameChanges, type PreparedGameChangeWords } from "./change-words";
import { deliverGameChangeProposal } from "./chat-delivery";
import { gameChatContextCurrent, prepareGameChat, readGameChatAudience, readGroupGameChatAuthority, type GameChatAudience, hasGameChatBlock, gameChatNames, gamePairWhere, gameChatPlayerIds, readGameChatCandidateIds, sameGamePlayers } from "./chat-membership";
import { reserveGameChatLifecycleTx, reserveGameChatProposalTx, reserveGameChallengeTx, skipGameChatLifecycleTx } from "./chat-lifecycle-receipt";
import { reserveGameMissedDayTx } from "./chat-lifecycle-receipt";
import { gameMissedCheckInRuns, morningAfterLastDay, isMissedCheckInDueNow, visitGameMissedCheckInPages } from "./missed-check-in";
import { deleteEntryReplyTx, readReplyReportedMembers, replyEligibility, replyMetadataSelect, replyReadAccess, replyReceiptMatches, replyView, type ReplyContext, type ReplyMetadata } from "./replies";
import { inspectReplyAudio } from "./reply-audio";
import { claimGameReplyNotification, sendGameReplyNotificationAfterResponse } from "./reply-notification";
import { claimGamePostNotification, sendGamePostNotificationAfterResponse } from "./post-notification";
import {
  buildGameHistoryView,
  buildGameView,
  GAME_HISTORY_PREVIEW_LIMIT,
  gameMediaUrl,
  termsView,
  ticketView,
  visibleEntryIds,
  type BuiltGameHistoryView,
  type GameTicketRow,
  type GameViewInput,
} from "./views";
import { parseGameTalkPayload, readGroupTalkInvitation } from "./talk";
import { GAME_ENDED_CHANGE_REASON, GAME_ROSTER_CHANGE_REASON, resolveGroupGameChangeTx } from "./change-resolution";
import { lockHostedMemberRow, readHostedMemberSuspensionAfterLockTx } from "../hosted-onboarding/shared";
import { departedLabels } from "./account-deletion";
import { gameMemberIds, hasGameIdentity } from "./roster";
import { areGamePlayersBlocked, GAME_BLOCK_LIMIT, isHiddenBy, lockGamePair, readGameBlocks, type GameBlocks } from "./blocks";
import { GAME_REPORT_ALERTS_PER_REPORTER_DAY, sendGameReportAlert } from "./report-alert";

export { mediaKeyPrefixFor } from "./access";

type Tx = Prisma.TransactionClient;
type Db = Tx | ReturnType<typeof getPrisma>;
type GameRow = Game & { players: GamePlayer[]; invitees: GameInvitee[] };
interface LoadedGame {
  row: GameRow;
  entries: GameEntry[];
  state: RuleState;
}
export type GameCommandResult =
  | { ok: true; game: CreateGameView | null; profile?: GameProfileView; reminders?: GameReminders; reaches?: "push" | "text" | "none"; dayOutcome?: GameDayOutcome }
  | { ok: false; error: GameError; status: number };

export const GAME_RECAP_UI_WAIT_MS = 10 * 60 * 1000;

const SYSTEM_ACTOR = "system";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOME_CANDIDATE_LIMIT = 50;
const HOME_SETTLED_SHOWN = 3;
const HISTORY_PEOPLE_LIMIT = 50;
const HISTORY_GAMES_PER_PERSON_LIMIT = 50;
const HISTORY_GROUP_LIMIT = 20;
const HISTORY_GAMES_PER_GROUP_LIMIT = 25;
const HOME_EXPIRED_SHOWN = 3;
const HOME_EXPIRED_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const WALLET_LIMIT = 200;
// Every returned game can settle on read with three legacy per-miss stakes.
const CHAT_TICKET_LIMIT = GAME_MAX_OPEN_PER_PAIR * 3 * GAME_MAX_LENGTH_DAYS;
const ACTIVE_STATUSES = ["invited", "negotiating", "live"];
// Open games a block ends per batch; it repeats until none is left.
const BLOCK_GAME_LIMIT = 50;

export async function readGameReminders(memberId: string, db: Db = getPrisma()): Promise<GameReminders> {
  const [profile, seats] = await Promise.all([
    db.gameProfile.findUnique({ where: { memberId }, select: { reminderMinutes: true, reminderPush: true, reminderText: true } }),
    db.gamePlayer.findMany({ where: { memberId, reminderOff: true, game: { status: "live" } }, select: { gameId: true }, orderBy: { gameId: "asc" } }),
  ]);
  const canText = await canTextGameReminders(memberId, db);
  return { minutes: profile?.reminderMinutes ?? 1140, push: profile?.reminderPush ?? true, text: profile?.reminderText ?? false,
    canText, offGameIds: seats.map(seat => seat.gameId) };
}

/** A game never grants private AI access or creates a new direct route. Linq only: its egress holds the final game and pause checks. */
export async function canTextGameReminders(memberId: string, db: Db = getPrisma()): Promise<boolean> {
  if (process.env.MURPH_GAME_PRIVATE_REMINDERS_ENABLED !== "true") return false;
  const [access, usage, destination] = await Promise.all([
    readHostedRuntimeAiAccessDecision({ memberId, prisma: db }),
    resolveHostedRuntimeAiUsageGate({ userId: memberId, mode: "read_only", prisma: db }),
    resolveHostedAssistantNotificationDestination({ memberId, prisma: db }),
  ]);
  if (!access.allowed || usage.status !== "allowed" || destination?.conversationShape !== "direct-member"
    || destination.route.delivery.kind !== "thread" || !destination.route.threadIsDirect
    || destination.route.channel !== "linq") return false;
  try {
    await assertHostedDirectAssistantNotificationRouteAuthority({ authority: {
      channel: destination.route.channel, containerMemberId: memberId, threadId: destination.route.delivery.target,
    }, prisma: db, requireThreadDelivery: true });
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------- writes

/**
 * The one write path, for the app's routes and Murph's tools alike. The
 * command is validated here, uploads are checked and words sealed before any
 * transaction; then every command runs in one short transaction that locks
 * the game row, reads the database clock, checks the rules, writes state and
 * one history row per accepted change, and commits. Every command is safe to
 * repeat: it's keyed by its own ids (gameId, entryId) or state (an accepted
 * invite, a redeemed ticket), and a repeat writes nothing.
 */
export async function runGameCommand(input: {
  actorMemberId: string;
  multiplayer?: boolean;
  command: unknown;
  chatContainerMemberId?: string;
  chatPlayerMemberIds?: readonly string[];
  chatAudience?: GameChatAudience;
  beforeMutationTx?: (tx: Prisma.TransactionClient) => Promise<void>;
  now?: Date;
  postGuard?: { dayIndex: number; replaceEntryId: string | null };
}): Promise<GameCommandResult> {
  const actor = input.actorMemberId;
  try {
    const command = parseGameCommand(input.command);
    if (!input.multiplayer) await assertLegacyCommand(command);
    moderateGameCommand(command);
    await requireUploadedMedia(actor, command);
    if (command.type === "setProfile") {
      return { game: null, ok: true, profile: await setProfile({ actor, beforeMutationTx: input.beforeMutationTx }, command) };
    }
    if (command.type === "setReminders") {
      return { game: null, ok: true, reminders: await saveGameReminders(input, command) };
    }
    const chatAudience = input.chatAudience ?? (input.multiplayer && input.chatContainerMemberId ? await readGameChatAudience(input.chatContainerMemberId) : undefined);
    // A recap receipt is the viewer's own; it touches no game state, so it skips the game write path.
    const applied = command.type === "watchRecap" ? await watchRecap({ actor, beforeMutationTx: input.beforeMutationTx }, command.gameId)
      : await runCommand({ chatAudience, actor, now: input.now, chatContainerMemberId: input.chatContainerMemberId, chatPlayerMemberIds: input.chatPlayerMemberIds, beforeMutationTx: input.beforeMutationTx, postGuard: input.postGuard }, command);
    const { gameId, dayOutcome, composer } = typeof applied === "object" && applied !== null ? applied : { gameId: applied };
    await deliverAppGameNegotiation(command, gameId, input.chatContainerMemberId);
    await deliverCreatedRematch(command, input.chatContainerMemberId);
    await activatePrivateAfterGameCommand(command, gameId, input.now ?? new Date());
    const game = gameId && !input.chatContainerMemberId ? await readGame(gameId, actor, input.multiplayer) : null;
    return { game: game && composer ? { ...game, composer } : game, ok: true, ...(dayOutcome ? { dayOutcome } : {}) };
  } catch (error) {
    if (error instanceof GameRuleError) {
      return { error: error.error, ok: false, status: GAME_ERROR_STATUS[error.error.code] };
    }
    throw error;
  }
}

async function activatePrivateAfterGameCommand(command: GameCommand, gameId: string | null, now: Date): Promise<void> {
  if (!gameId || !["join", "respondChange", "negotiate", "editTerms", "proposeChange"].includes(command.type)) return;
  try { await (await import("./private-kickoff")).activatePrivateGamePlayers(gameId, now); }
  catch { /* The lifecycle sweep recovers an unmarked activation. */ }
}

async function saveGameReminders(input: Parameters<typeof runGameCommand>[0], command: Extract<GameCommand, { type: "setReminders" }>): Promise<GameReminders> {
  return commandTransaction(input, async tx => {
    const actor = input.actorMemberId;
    if (command.text && !await canTextGameReminders(actor, tx)) reject("INVALID_REQUEST", "Private texts aren't available for this account right now.");
    const saved = await tx.gameProfile.updateMany({ where: { memberId: actor }, data: {
      reminderMinutes: command.minutes, reminderPush: command.push, reminderText: command.text,
    } });
    if (!saved.count) reject("PROFILE_REQUIRED", "Add your first name and time zone first.");
    await recordGameReminderPreferencesTx(tx, actor, command.everyDayGameIds !== undefined);
    // A seat admitted after the recorded choice keeps its own activation defaults.
    const where = { memberId: actor, game: { status: "live", events: { some: { actor, type: GAME_REMINDER_OFF_CHOICE_EVENT } } } };
    await tx.gamePlayer.updateMany({ where: { ...where, gameId: { in: command.offGameIds } }, data: { reminderOff: true } });
    await tx.gamePlayer.updateMany({ where: { ...where, gameId: { notIn: command.offGameIds } }, data: { reminderOff: false } });
    if (command.everyDayGameIds) {
      await tx.gamePlayer.updateMany({ where: { ...where, gameId: { in: command.everyDayGameIds } }, data: { reminderEveryDay: true } });
      await tx.gamePlayer.updateMany({ where: { ...where, gameId: { notIn: command.everyDayGameIds } }, data: { reminderEveryDay: false } });
    }
    return readGameReminders(actor, tx);
  });
}

async function deliverAppGameNegotiation(command: GameCommand, gameId: string | null, chatContainerMemberId?: string): Promise<void> {
  if (!gameId || chatContainerMemberId) return;
  if (command.type === "negotiate" && command.note !== undefined) {
    try {
      const { deliverGameChatLifecycle } = await import("./chat-lifecycle");
      await deliverGameChatLifecycle(gameId, "talk", command.proposalId);
    } catch {
      // The committed receipt stays recoverable by the lifecycle sweep.
    }
  }
  if ((command.type === "proposeChange" || command.type === "editTerms" && command.proposalId !== undefined || command.type === "negotiate" && command.change !== undefined)) {
    const proposalId = command.proposalId!;
    try {
      await deliverGameChangeProposal(gameId, proposalId);
    } catch {
      // The durable proposal survives unavailable routing/provider work. A retry
      // uses the same identity; never overwrite a later proposal or queued send.
      await getPrisma().$executeRaw`UPDATE game SET pending_change = jsonb_set(pending_change, '{deliveryStatus}', '"failed"'::jsonb)
        WHERE id = ${gameId} AND pending_change->>'id' = ${proposalId}
        AND pending_change->>'deliveryStatus' IN ('pending', 'failed')`;
    }
  }
}

async function deliverCreatedRematch(command: GameCommand, chatContainerMemberId?: string): Promise<void> {
  if (command.type !== "createGame" || chatContainerMemberId || (!command.previousGameId && command.maxPlayers !== 10)) return;
  try {
    const { deliverGameChatLifecycle } = await import("./chat-lifecycle");
    await deliverGameChatLifecycle(command.gameId, "rematch");
  } catch {
    // The committed receipt survives; the lifecycle sweep owns retry.
  }
}

/** Immutable size policy is checked before preparing any legacy mutation. */
async function assertLegacyCommand(command: GameCommand): Promise<void> {
  if (command.type === "createGame" && command.maxPlayers === 10) reject("GAME_NOT_FOUND", "That game isn't available.");
  const prisma = getPrisma();
  const where = "token" in command && command.token ? { inviteTokenHash: sha256Hex(command.token) }
    : command.type === "redeem" ? { tickets: { some: { id: command.ticketId } } }
    : "gameId" in command && command.gameId ? { id: command.gameId } : null;
  const ids: Prisma.GameWhereInput[] = command.type === "createGame" && command.previousGameId ? [{ id: command.previousGameId }] : [];
  if (where) ids.push(where);
  if (ids.length && await prisma.game.findFirst({ where: { maxPlayers: 10, OR: ids }, select: { id: true } })) {
    reject("token" in command ? "INVITE_NOT_FOUND" : "GAME_NOT_FOUND", "token" in command ? "That invite isn't available." : "That game isn't available.");
  }
}

/** Translate chat arguments into the same app commands; actor/room are trusted context. */
export async function runGameChatUpdate(input: Omit<Parameters<typeof runGameCommand>[0], "command"> & { update: HostedGameUpdate }): Promise<GameCommandResult> {
  if (input.multiplayer && input.chatContainerMemberId && !input.chatAudience) input = { ...input, chatAudience: await readGameChatAudience(input.chatContainerMemberId) };
  const { update, ...context } = input;
  try {
    if (update.operation === "set_reminder") return await setGameChatReminder(input, update);
    let command: unknown;
    if (update.operation === "create") command = await gameChatCreateCommand(input, update);
    else if (update.operation === "edit_terms") {
      command = await gameChatEditCommand(input, update);
    } else if (update.operation === "propose" || (update.operation === "approve" && !update.proposalId)) {
      const translated = await gameChatTermsCommand(input, update);
      if ("result" in translated) return translated.result;
      command = translated.command;
    } else if (update.operation === "cancel_game") {
      command = { type: "cancelInvite", gameId: update.gameId };
    } else if ("date" in update) {
      command = { type: "setDayCompletion", gameId: update.gameId, date: update.date, incomplete: update.operation === "mark_incomplete" };
    } else {
      command = { type: "respondChange", gameId: update.gameId, proposalId: update.proposalId!, decision: update.operation };
    }
    await requireGameChatTerms(input, command);
    return await runGameCommand({ ...context, command });
  } catch (error) {
    if (error instanceof GameRuleError) return { ok: false, error: error.error, status: GAME_ERROR_STATUS[error.error.code] };
    throw error;
  }
}

async function setGameChatReminder(input: Parameters<typeof runGameChatUpdate>[0], update: Extract<HostedGameUpdate, { operation: "set_reminder" }>): Promise<GameCommandResult> {
  await requireSelectedGameChatReminder(input, update);
  const current = await readGameReminders(input.actorMemberId);
  const seats = await getPrisma().gamePlayer.findMany({ where: { memberId: input.actorMemberId, leftAt: null, game: { status: "live" } },
    select: { gameId: true, reminderEveryDay: true }, take: 1001 });
  if (seats.length > 1000) reject("INVALID_REQUEST", "Too many open games to save reminders.");
  const off = new Set(current.offGameIds);
  if (update.gameId && update.on !== undefined) update.on ? off.delete(update.gameId) : off.add(update.gameId);
  const { update: _update, ...context } = input;
  const result = await runGameCommand({ ...context, command: { type: "setReminders", minutes: update.minutes ?? current.minutes,
    push: current.push, text: current.text && current.canText, offGameIds: [...off],
    everyDayGameIds: seats.filter(seat => seat.reminderEveryDay).map(seat => seat.gameId) } });
  if (!result.ok) return result;
  const [route] = await readGamePushRoutes(getPrisma(), [input.actorMemberId], true);
  const selectedOn = update.gameId ? !result.reminders?.offGameIds.includes(update.gameId) : seats.some(seat => !result.reminders?.offGameIds.includes(seat.gameId));
  const reaches = result.reminders ? gameReminderReach(result.reminders, selectedOn, Boolean(route)) : "none";
  return { ...result, reaches };
}

async function requireSelectedGameChatReminder(input: Parameters<typeof runGameChatUpdate>[0], update: Extract<HostedGameUpdate, { operation: "set_reminder" }>): Promise<void> {
  if (process.env.MURPH_GAME_PRIVATE_REMINDERS_ENABLED !== "true") reject("INVALID_REQUEST", "Game chat reminders aren't available yet.");
  if (update.on !== undefined && !update.gameId) reject("INVALID_REQUEST", "Choose which game to turn on or off.");
  if (!update.gameId) return;
  const row = await getPrisma().game.findUnique({ where: { id: update.gameId }, include: { players: true, invitees: true } });
  if (!row || row.status !== "live" || !row.players.some(seat => seat.memberId === input.actorMemberId && !seat.leftAt)
    || !await gameChatContextCurrent(row, input)) reject("NOT_A_PLAYER", "Choose one of your live games in this chat.");
}

async function gameChatEditCommand(input: Parameters<typeof runGameChatUpdate>[0], update: Extract<HostedGameUpdate, { operation: "edit_terms" }>): Promise<unknown> {
  const row = await getPrisma().game.findUnique({ where: { id: update.gameId }, include: { players: true, invitees: true } });
  if (!row || row.maxPlayers !== 10 || !await gameChatContextCurrent(row, input)) reject("NOT_A_PLAYER", "Use this game’s group chat.");
  const seats = new Map(row.players.filter(player => !player.leftAt).filter(hasGameIdentity).map(player => [player.memberId, player.seat]));
  if (update.terms.tasks.length !== seats.size || new Set(update.terms.tasks.map(task => task.memberId)).size !== seats.size
    || update.terms.tasks.some(task => !seats.has(task.memberId))) reject("INVALID_REQUEST", "Include every seated player’s task.");
  const tasks = update.terms.tasks.map(task => ({ seat: seats.get(task.memberId)!, text: task.text }));
  return { type: "editTerms", gameId: update.gameId, expectedTermsVersion: update.expectedTermsVersion,
    ...(update.proposalId === undefined ? {} : { proposalId: update.proposalId }),
    terms: { ...update.terms, lengthDays: update.terms.lengthDays ?? row.lengthDays, checkInKind: "any", tasks } };
}

async function requireGameChatTerms(input: Parameters<typeof runGameChatUpdate>[0], command: unknown) {
  if (!input.multiplayer) return;
  const parsed = parseGameCommand(command);
  const group = input.update.operation === "create"
    ? parsed.type === "createGame" && parsed.maxPlayers === 10
    : (await getPrisma().game.findUnique({ where: { id: input.update.gameId }, select: { maxPlayers: true } }))?.maxPlayers === 10;
  if (group) await requireCurrentGameChatTerms(input.actorMemberId, parsed);
}

async function requireCurrentGameChatTerms(actor: string, command: { type?: unknown }) {
  const { requireCurrentTermsFor } = await import("./http/auth");
  const { isHostedOnboardingError } = await import("../hosted-onboarding/errors");
  try { await requireCurrentTermsFor(actor, command); }
  catch (error) {
    if (isHostedOnboardingError(error) && error.code === "TERMS_REQUIRED") reject("TERMS_REQUIRED", "Accept Murph’s current Terms in the app, then try again.");
    throw error;
  }
}

/** Translate member-keyed chat tasks once; canonical creation still owns validation. */
async function gameChatCreateCommand(input: Parameters<typeof runGameChatUpdate>[0], update: Extract<HostedGameUpdate, { operation: "create" }>): Promise<unknown> {
  const players = input.chatPlayerMemberIds ?? [];
  if (!sameGamePlayers(players, update.terms.tasks.map(task => task.memberId)) || !players.includes(input.actorMemberId)) {
    reject("NOT_A_PLAYER", "Include one task for each person in this chat.");
  }
  const other = players.find(id => id !== input.actorMemberId)!;
  const profiles = await readGameChatProfiles(players);
  const missing = profiles.find(profile => !profile.firstName || !profile.timeZone);
  if (missing) reject("PROFILE_REQUIRED", `${missing.memberId} needs a first name and time zone in the Murph app.`);
  const group = players.length > 2 || Boolean(update.previousGameId && (await getPrisma().game.findUnique({ where: { id: update.previousGameId }, select: { maxPlayers: true } }))?.maxPlayers === 10);
  if (group) {
    const defaultTask = update.terms.defaultTask ?? update.terms.tasks.find(task => task.memberId === input.actorMemberId)!.text;
    const others = players.filter(id => id !== input.actorMemberId);
    const contacts = await Promise.all(others.map(readGameVerifiedContacts));
    if (contacts.some(items => !items[0])) reject("PROFILE_REQUIRED", "Verify each player’s invitation address in the app.");
    return { type: "createGame", gameId: update.gameId, maxPlayers: 10, groupWord: update.groupWord ?? "group",
      invitees: others.map((memberId, index) => ({ seat: index + 1, recipient: { kind: contacts[index][0].kind, value: contacts[index][0].value }, firstName: profiles.find(profile => profile.memberId === memberId)!.firstName })),
      terms: { ...update.terms, defaultTask, checkInKind: "any", tasks: update.terms.tasks.filter(task => task.text !== defaultTask).map(task => ({ seat: task.memberId === input.actorMemberId ? 0 : others.indexOf(task.memberId) + 1, text: task.text })) },
      ...(update.previousGameId ? { previousGameId: update.previousGameId } : {}) };
  } else return { type: "createGame", gameId: update.gameId, inviteeFirstName: profiles.find(profile => profile.memberId === other)!.firstName!,
    terms: { ...update.terms, checkInKind: "any", tasks: update.terms.tasks.map(task => ({ seat: task.memberId === input.actorMemberId ? 0 : 1, text: task.text })) },
    ...(update.previousGameId ? { previousGameId: update.previousGameId } : {}) };

}

/** The app uses join for a yes, negotiate for an unseated invitee's counter. */
async function gameChatTermsCommand(input: Parameters<typeof runGameChatUpdate>[0], update: Extract<HostedGameUpdate, { operation: "approve" | "propose" }>): Promise<{ command: unknown } | { result: GameCommandResult }> {
  const row = await getPrisma().game.findUnique({ where: { id: update.gameId }, include: { invitees: true, players: true } });
  if (!row || !await gameChatContextCurrent(row, input) || !isGameOn(row)) reject("NOT_A_PLAYER", "This game belongs to its players.");
  if (row.maxPlayers === 10 && update.operation === "propose" && update.change.kind !== "start_now") reject("INVALID_REQUEST", "Ask for group changes with edit_terms and a new proposalId.");
  if (update.operation === "propose" && (row.status !== "invited" || row.maxPlayers === 10)) {
    return { command: { type: "proposeChange", gameId: update.gameId, proposalId: update.proposalId, expectedTermsVersion: update.expectedTermsVersion, change: update.change } };
  }
  const addressed = row.maxPlayers === 10 ? await addressedGameInvitation(row, input.actorMemberId) : row.invitees.find(invitee => invitee.memberId === input.actorMemberId);
  if ((row.status === "invited" || row.maxPlayers === 10) && !addressed) reject("NOT_A_PLAYER", "Only the other player can agree or suggest changes to this rematch.");
  const profile = await getPrisma().gameProfile.findUnique({ where: { memberId: input.actorMemberId }, select: { timeZone: true } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name and time zone in the app's Game profile.");
  if (row.maxPlayers === 10) return { result: await acceptGroupChatInvitation(input, row,
    { termsVersion: update.expectedTermsVersion, timeZone: profile.timeZone }) };
  const [token] = await openGameTexts([{ ...gameTarget(row, "invite_token"), value: row.inviteTokenEncrypted }]);
  if (!token) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
  const invite = { token, termsVersion: update.expectedTermsVersion!, timeZone: profile.timeZone };
  return { command: update.operation === "propose"
    ? { type: "negotiate", ...invite, proposalId: update.proposalId, change: update.change }
    : { type: "join", ...invite } };
}

/** Chat authority admits by id; public commands still require the bearer token. */
async function acceptGroupChatInvitation(
  input: Parameters<typeof runGameChatUpdate>[0],
  row: Pick<Game, "id" | "createdBy">,
  body: unknown,
): Promise<GameCommandResult> {
  if (!input.multiplayer) reject("INVITE_NOT_FOUND", "That invite isn't available.");
  const acceptance = parseGameAcceptance(body);
  await requireCurrentGameChatTerms(input.actorMemberId, { type: "join" });
  await joinGame({ actor: input.actorMemberId, beforeMutationTx: input.beforeMutationTx,
    chatContainerMemberId: input.chatContainerMemberId, chatPlayerMemberIds: input.chatPlayerMemberIds,
    chatAudience: input.chatAudience, now: input.now }, { id: row.id, createdBy: row.createdBy, maxPlayers: 10 }, acceptance);
  return { game: null, ok: true };
}

/** Names are the players' own Game profiles, not private relationship labels. */
export async function readGameChatProfiles(playerMemberIds: readonly string[]): Promise<Array<{ memberId: string; firstName: string | null; timeZone: string | null }>> {
  const profiles = await getPrisma().gameProfile.findMany({ where: { memberId: { in: [...playerMemberIds] } },
    select: { memberId: true, firstNameEncrypted: true, timeZone: true }, take: 10 });
  const names = await openGameTexts(profiles.map(profile => ({ table: "game_profile" as const, field: "first_name", rowId: profile.memberId, memberId: profile.memberId, value: profile.firstNameEncrypted })));
  const labels = gameChatNames(profiles.map((profile, index) => ({ memberId: profile.memberId, firstName: names[index] ?? null })));
  return playerMemberIds.map(memberId => {
    const index = profiles.findIndex(profile => profile.memberId === memberId);
    return { memberId, firstName: names[index] ? labels.get(memberId) ?? null : null, timeZone: profiles[index]?.timeZone ?? null };
  });
}

interface CommandContext {
  postGuard?: { dayIndex: number; replaceEntryId: string | null };
  actor: string;
  chatContainerMemberId?: string;
  chatPlayerMemberIds?: readonly string[];
  chatAudience?: GameChatAudience;
  beforeMutationTx?: (tx: Prisma.TransactionClient) => Promise<void>;
  now?: Date;
}

/** Applies one command; returns the game to show back, if any. */
async function runCommand(context: CommandContext, command: Exclude<GameCommand, { type: "setProfile" | "setReminders" | "watchRecap" }>): Promise<string | null | { gameId: string; dayOutcome?: GameDayOutcome; composer?: { murphPhoneNumber: string } }> {
  switch (command.type) {
    case "replyToPost": return replyToPost(context, command);
    case "deleteReply": return deleteReply(context, command);
    case "challenge": return challenge(context, command);
    case "leave": return leave(context, command.gameId);
    case "editTerms": return editTerms(context, command);
    case "setDayCompletion":
      return setDayCompletion(context, command);
    case "cancelInvite":
      return cancelInvite(context, command.gameId);
    case "proposeChange":
      return proposeChange(context, command);
    case "respondChange":
      return respondChange(context, command);
    case "createGame":
      return createGame(context, command);
    case "join":
      return join(context, command);
    case "negotiate":
      return negotiate(context, command);
    case "post":
      return post(context, command);
    case "withdraw":
      return withdraw(context, command);
    case "redeem":
      return redeem(context, command);
    case "report":
      return report(context, command);
    case "block":
      return block(context, command);
    case "setPlayerPhoto":
      return setPlayerPhoto(context, command);
    case "unblock":
      return unblock(context, command.memberId);
  }
}

/** Every media key a command names must be the actor's own finished upload. */
async function requireUploadedMedia(actor: string, command: GameCommand): Promise<void> {
  const labelPhoto = command.type === "setProfile" || command.type === "setPlayerPhoto" ? command.photoKey
    : command.type === "createGame" ? command.inviteeLabel?.photoKey : null;
  const keys = command.type === "post" ? command.mediaKeys : [labelPhoto, ...(command.type === "createGame" ? command.invitees?.map(target => target.label?.photoKey) ?? [] : [])].filter((key): key is string => Boolean(key));
  if (keys.length === 0) return;
  const prefix = mediaKeyPrefixFor(actor);
  if (!keys.every((key) => key.startsWith(prefix))) reject("MEDIA_MISSING", "Upload the media before posting it.");
  const stored = await Promise.all(keys.map((key) => statGameMedia(key)));
  if (stored.includes(null)) reject("MEDIA_MISSING", "Upload the media before posting it.");
}

interface LockedStep {
  tx: Tx;
  loaded: LoadedGame;
  /** The game's now, which decides days (moved by dev time travel). */
  now: Date;
  /** The database clock, for the times rows record. */
  clock: Date;
}

type GameEventType = "reply_accepted" | "talk_requested" | "recap_watched" | "challenged" | "left" | "terms_edited" | "day_marked_incomplete" | "day_restored" | "cancelled" | "blocked" | "removed" | "negotiation_joined" | "created" | "joined" | "started" | "posted" | "withdrew" | "settled" | "redeemed" | "expired" | "time_shifted" | "change_proposed" | "change_voted" | "change_applied" | "change_declined" | "change_cancelled" | "change_expired";
/** History holds metadata and sealed words, never plaintext. */
interface GameEventDraft {
  createdAt?: Date;
  commandKey?: string;
  type: GameEventType;
  payload: Prisma.InputJsonObject;
}

async function writeEvents(tx: Tx, gameId: string, actor: string, events: readonly GameEventDraft[], chatOrigin = false): Promise<void> {
  if (events.length === 0) return;
  await tx.gameEvent.createMany({
    data: events.map((event) => ({ actor, gameId, createdAt: event.createdAt, commandKey: event.commandKey, payload: { v: 1, ...event.payload }, type: event.type })),
  });
  if (events.some((event) => event.type === "started")) {
    await reserveGameChatLifecycleTx({ gameId, kind: "started", now: new Date(), tx });
  }
  for (const event of events) {
    if (event.type === "talk_requested" && typeof event.payload.proposalId === "string") {
      await reserveGameChatLifecycleTx({ gameId, kind: "talk", proposalId: event.payload.proposalId, groupTalk: event.payload.v === 2, now: new Date(), tx });
    }
    if (!chatOrigin && event.type === "change_proposed" && typeof event.payload.proposalId === "string") {
      await reserveGameChatProposalTx({ gameId, proposalId: event.payload.proposalId, now: new Date(), tx });
    }
  }
}

/** Every member write opens here, so its authority check runs first, ahead of game and pair locks. */
function commandTransaction<T>(context: Pick<CommandContext, "beforeMutationTx">, work: (tx: Tx) => Promise<T>): Promise<T> {
  return getPrisma().$transaction(async (tx) => {
    // Match account deletion's owner-before-game lock order. The callback's
    // runtime/owner locks remain held through the following game mutation.
    await context.beforeMutationTx?.(tx);
    return work(tx);
  });
}

/** Locks the game, runs one step, and records what it changed. A step that changes nothing returns no events. */
async function runLocked(
  gameId: string,
  context: CommandContext,
  step: (locked: LockedStep) => Promise<GameEventDraft[]>,
): Promise<void> {
  await commandTransaction(context, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    if (locked.length === 0) reject("GAME_NOT_FOUND", "Game not found.");
    const [loaded] = await loadGames(tx, [gameId]);
    // Nobody acts on a game that is off, whatever they hold.
    if (context.actor !== SYSTEM_ACTOR && !isGameOn(loaded.row)) reject("GAME_NOT_FOUND", "Game not found.");
    if (context.chatContainerMemberId && !await gameChatContextCurrent(loaded.row, context, tx)) {
      reject("NOT_A_PLAYER", "This game belongs to the players in this chat.");
    }
    const clock = context.now ?? await databaseNow(tx);
    await writeEvents(tx, gameId, context.actor, await step({ clock, loaded, now: gameNow(clock, loaded.row), tx }), Boolean(context.chatContainerMemberId));
  });
}

async function databaseNow(db: Db): Promise<Date> {
  const [row] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return row.now;
}

/**
 * A game's "now": the database clock, moved by the game's dev time-travel
 * offset when there is one. Production never sets it, so there it is the clock.
 */
function gameNow(clock: Date, row: Pick<Game, "devClockOffsetMs">): Date {
  return row.devClockOffsetMs === null ? clock : new Date(clock.getTime() + Number(row.devClockOffsetMs));
}

async function seal(target: GameSealTarget, value: string): Promise<string> {
  const sealed = await sealGameText(target, value);
  if (!sealed) throw new Error("Game encryption returned nothing.");
  return sealed;
}

function gameTarget(game: Pick<Game, "id" | "wordsOwnerMemberId">, field: string): GameSealTarget {
  return { field, memberId: game.wordsOwnerMemberId, rowId: game.id, table: "game" };
}

async function setProfile(context: CommandContext, command: Extract<GameCommand, { type: "setProfile" }>): Promise<GameProfileView> {
  const { actor } = context;
  const target: GameSealTarget = { field: "first_name", memberId: actor, rowId: actor, table: "game_profile" };
  const firstNameEncrypted = command.firstName === undefined ? undefined : await seal(target, command.firstName);
  const data = {
    ...(firstNameEncrypted === undefined ? {} : { firstNameEncrypted }),
    ...(command.timeZone === undefined ? {} : { timeZone: command.timeZone }),
    ...(command.photoKey === undefined ? {} : { photoKey: command.photoKey }),
  };
  const prisma = getPrisma();
  const previous = command.firstName === undefined ? null
    : await prisma.gameProfile.findUnique({ where: { memberId: actor }, select: { firstNameEncrypted: true } });
  // Partial updates never read then rewrite unrelated fields. RETURNING also
  // makes the response describe this write, not a later concurrent update.
  const profile = await commandTransaction(context, async tx => {
    return firstNameEncrypted !== undefined && command.timeZone !== undefined
      ? tx.gameProfile.upsert({
        create: { ...data, firstNameEncrypted, memberId: actor, timeZone: command.timeZone },
        update: data,
        where: { memberId: actor },
      })
      : (await tx.gameProfile.updateManyAndReturn({ data, where: { memberId: actor } }))[0];
  });
  if (!profile) return reject("PROFILE_REQUIRED", "Add your first name and time zone first.");
  const [firstName] = await openGameTexts([{ ...target, value: profile.firstNameEncrypted }]);
  const memoryName = memoryDisplayNameSchema.safeParse(command.firstName);
  if (memoryName.success) {
    try {
      const [previousName] = previous ? await openGameTexts([{ ...target, value: previous.firstNameEncrypted }]) : [];
      if (previousName !== command.firstName) {
        await submitMemberAction({
          assertCurrentAuthorityTx: async tx => {
            await context.beforeMutationTx?.(tx);
            await assertBrowserVaultMemberAuthority({ memberId: actor, prisma: tx });
          },
          memberId: actor, prisma,
          request: {
            actionId: randomUUID(), requestedAt: new Date().toISOString(), schemaVersion: 1,
            action: { kind: "display-name.set", version: 1, displayName: memoryName.data },
          },
        });
      }
    } catch {
      // Game profiles also serve free invitees. Vault refusal never undoes a save.
    }
  }
  return {
    avatarUrl: profile.photoKey ? gameMediaUrl(profile.photoKey) : null,
    firstName: firstName ?? "",
    memberId: actor,
    timeZone: profile.timeZone,
  };
}

interface PendingLabel {
  nameEncrypted: string | null;
  relationshipEncrypted: string | null;
  photoKey: string | null;
}

function parsePendingLabel(value: Prisma.JsonValue | null): PendingLabel {
  const label = isRecord(value) ? value : {};
  const text = (field: unknown) => (typeof field === "string" ? field : null);
  return {
    nameEncrypted: text(label.nameEncrypted),
    photoKey: text(label.photoKey),
    relationshipEncrypted: text(label.relationshipEncrypted),
  };
}

async function createGame(context: CommandContext, command: Extract<GameCommand, { type: "createGame" }>): Promise<string | { gameId: string; composer?: { murphPhoneNumber: string } }> {
  if (command.maxPlayers === 10) return createGroupGame(context, command);
  if (command.invitees || command.groupWord || command.terms.defaultTask) reject("INVALID_REQUEST", "Group terms require maxPlayers 10.");
  const { actor } = context;
  const { gameId } = command;
  const chatPlayers = context.chatPlayerMemberIds ?? [];
  const chatOther = chatCreationOther(context);
  const prisma = getPrisma();
  const profile = await prisma.gameProfile.findUnique({ select: { timeZone: true }, where: { memberId: actor } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");
  if (await isGameCreationReplay(prisma, actor, gameId, chatOther ? chatPlayers : undefined)) return gameId;
  const rematch = await readGameCreationRematch(context, command, chatOther);
  if (chatOther) await maintainPair(actor, chatOther);
  const data = await prepareGameCreateData(context, command, rematch, chatOther, profile.timeZone);
  try {
    await commandTransaction(context, async (tx) => {
      const now = context.now ?? await databaseNow(tx);
      if (data.invitees.create.memberId) {
        await lockGamePair(tx, actor, data.invitees.create.memberId);
        if (await isGameCreationReplay(tx, actor, gameId, chatOther ? chatPlayers : undefined)) return;
      }
      // Recheck a block or a rematch since the first read, under the pair lock.
      await revalidatePairCreationTx({ actor, opponentMemberId: data.invitees.create.memberId, now, previousGameId: command.previousGameId, tx });
      const players = await gameCreationPlayers(tx, actor, profile.timeZone, now, chatOther);
      await tx.game.create({ data: { ...data, inviteExpiresAt: new Date(now.getTime() + GAME_INVITE_TTL_MS), players: { create: players } } });
      const previous = command.previousGameId ? { previousGameId: command.previousGameId } : {};
      await writeEvents(tx, gameId, actor, [{ payload: { round: data.round, ...previous }, type: "created" }]);
      if (data.chatContainerMemberId && !chatOther) await reserveGameChatLifecycleTx({ gameId, kind: "rematch", now, tx });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    if (!await isGameCreationReplay(prisma, actor, gameId, chatOther ? chatPlayers : undefined)) reject("INVALID_REQUEST", "That game id is taken.");
  }
  return gameId;
}

/** Prepare encrypted words and immutable row data before taking database locks. */
async function prepareGameCreateData(context: CommandContext, command: Extract<GameCommand, { type: "createGame" }>, rematch: Awaited<ReturnType<typeof readGameCreationRematch>>, chatOther: string | undefined, timeZone: string) {
  const { actor } = context;
  const { gameId, inviteeLabel } = command;
  const newTerms = decideNewTerms(command.terms, {
    newKey: () => generateHostedRandomPrefixedId("gsk"),
    today: gameLocalDate(context.now ?? new Date(), timeZone),
  });
  const token = randomBytes(24).toString("base64url");
  const where = { wordsOwnerMemberId: actor, id: gameId };
  const [termsWordsEncrypted, inviteTokenEncrypted, nameEncrypted, relationshipEncrypted] = await Promise.all([
    seal(gameTarget(where, "terms_words"), JSON.stringify(newTerms.words)),
    seal(gameTarget(where, "invite_token"), token),
    chatOther ? null : seal(labelTarget(actor, "name"), command.inviteeFirstName!),
    inviteeLabel?.relationship ? seal(labelTarget(actor, "relationship"), inviteeLabel.relationship) : null,
  ]);
  const opponentMemberId = chatOther ?? rematch?.opponentMemberId ?? null;
  return {
    createdBy: actor, wordsOwnerMemberId: actor, id: gameId,
    chatContainerMemberId: context.chatContainerMemberId ?? (opponentMemberId ? rematch?.chatContainerMemberId ?? null : null),
    inviteTokenEncrypted, inviteTokenHash: sha256Hex(token),
    invitees: { create: { seat: 1, memberId: opponentMemberId, pendingLabel: chatOther ? Prisma.DbNull : { nameEncrypted, photoKey: inviteeLabel?.photoKey ?? null, relationshipEncrypted } } },
    lengthDays: newTerms.lengthDays, startsOn: newTerms.startsOn ? toDbDate(newTerms.startsOn) : null,
    previousGameId: command.previousGameId ?? null, round: rematch?.round ?? 1,
    status: chatOther ? "negotiating" as const : "invited" as const,
    terms: toPrismaJsonObject(newTerms.terms), termsWordsEncrypted,
  };
}

function chatCreationOther(context: CommandContext): string | undefined {
  if (!context.chatContainerMemberId) return undefined;
  const players = context.chatPlayerMemberIds ?? [];
  const other = players.find(id => id !== context.actor);
  if (!sameGamePlayers(players, [context.actor, other ?? ""])) reject("NOT_A_PLAYER", "Use a chat with just the two players and Murph.");
  return other;
}

/** Group preparation shares the command, term, encryption and storage owners. */
async function createGroupGame(context: CommandContext, command: Extract<GameCommand, { type: "createGame" }>): Promise<{ gameId: string; composer?: { murphPhoneNumber: string } }> {
  if (!areGameGroupsEnabled()) reject("GAME_DISABLED", "Group games aren't available yet.");
  const prisma = getPrisma();
  const { actor } = context;
  const profile = await prisma.gameProfile.findUnique({ where: { memberId: actor }, select: { timeZone: true } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");

  if (await isGameCreationReplay(prisma, actor, command.gameId)) {
    const existing = await prisma.game.findUniqueOrThrow({ where: { id: command.gameId }, select: { chatContainerMemberId: true } });
    if (existing.chatContainerMemberId) return { gameId: command.gameId };
    const handoff = await prepareGameChat({ actor, members: [], audienceKeys: [] });
    return { gameId: command.gameId, composer: handoff.composer };
  }
  const prepared = command.previousGameId
    ? await prepareGroupRematch(actor, command.previousGameId)
    : await prepareNewGroup(context, command, profile.timeZone);
  const chat = await prepareGameChat({ actor, members: [actor, ...prepared.invitees.map(invitee => invitee.memberId)],
    handles: prepared.handles, room: context.chatContainerMemberId ?? prepared.room ?? undefined, audienceKeys: prepared.keys.candidates });

  if (!isGameOn({ players: [{ memberId: actor }], invitees: prepared.invitees })) reject("GAME_DISABLED", "Starting a game is invite only for now.");
  const open = await prisma.game.findMany({ where: { audienceKey: { in: prepared.keys.candidates }, status: "live" }, select: { id: true }, take: GAME_MAX_OPEN_PER_PAIR });
  await loadCurrent(open.map(game => game.id), true, actor);
  const token = randomBytes(24).toString("base64url");
  const target = { id: command.gameId, wordsOwnerMemberId: actor };
  const termsWordsEncrypted = await seal(gameTarget(target, "terms_words"), JSON.stringify(prepared.words));
  const inviteTokenEncrypted = await seal(gameTarget(target, "invite_token"), token);
  try {
    await commandTransaction(context, async tx => {
      await lockGameAudience(tx, prepared.keys.candidates);
      if (await isGameCreationReplay(tx, actor, command.gameId)) return;
      await prepared.revalidate(tx);
      await chat.revalidate?.(tx);
      const existing = await tx.game.findFirst({ where: { audienceKey: { in: prepared.keys.candidates } }, select: { audienceKey: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const audienceKey = existing?.audienceKey ?? prepared.keys.current;
      const count = await tx.game.count({ where: { audienceKey: { in: prepared.keys.candidates }, status: { in: ACTIVE_STATUSES } } });
      if (count >= GAME_MAX_OPEN_PER_PAIR) reject("TOO_MANY_GAMES", "This audience already has ten open games.");
      const now = context.now ?? await databaseNow(tx);
      await tx.game.create({ data: {
        id: command.gameId, createdBy: actor, wordsOwnerMemberId: actor, maxPlayers: 10, audienceKey, chatContainerMemberId: chat.room,
        inviteTokenHash: sha256Hex(token), inviteTokenEncrypted, inviteExpiresAt: null,
        status: "invited", terms: toPrismaJsonObject(prepared.terms), termsWordsEncrypted,
        lengthDays: prepared.lengthDays, startsOn: prepared.startsOn ? toDbDate(prepared.startsOn) : null,
        round: prepared.round, previousGameId: command.previousGameId ?? null,
        players: { create: { seat: 0, memberId: actor, timeZone: profile.timeZone, joinedAt: now } },
        invitees: { create: prepared.invitees },
      } });
      await writeEvents(tx, command.gameId, actor, [{ type: "created", payload: { round: prepared.round } }]);
      if (chat.room && !context.chatContainerMemberId) await reserveGameChatLifecycleTx({ gameId: command.gameId, kind: "rematch", now, tx });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    if (!await isGameCreationReplay(prisma, actor, command.gameId)) reject("INVALID_REQUEST", "That game id is taken.");
  }
  // A concurrent replay may have committed a different prepared destination.
  const committed = await prisma.game.findUniqueOrThrow({ where: { id: command.gameId }, select: { chatContainerMemberId: true } });
  if (committed.chatContainerMemberId) return { gameId: command.gameId };
  const handoff = chat.composer ?? (await prepareGameChat({ actor, members: [], audienceKeys: [] })).composer;
  return { gameId: command.gameId, composer: handoff };
}

async function prepareNewGroup(context: CommandContext, command: Extract<GameCommand, { type: "createGame" }>, timeZone: string) {
  if (!command.groupWord) reject("INVALID_REQUEST", "Choose a group word.");
  const audience = await prepareGameAudience(context.actor, command.invitees ?? []);
  const terms = decideNewTerms(command.terms, { maxPlayers: 10, inviteeSeats: audience.invitees.map(invitee => invitee.seat),
    newKey: () => generateHostedRandomPrefixedId("gsk"), today: gameLocalDate(context.now ?? new Date(), timeZone) });
  const invitees: Array<Prisma.GameInviteeUncheckedCreateWithoutGameInput & { memberId: string | null }> = [];
  // At most nine; drain each seal before opening a transaction.
  for (const invitee of audience.invitees) {
    const pendingLabel = invitee.firstName || invitee.label ? {
      nameEncrypted: invitee.firstName ? await seal(labelTarget(context.actor, "name"), invitee.firstName) : null,
      relationshipEncrypted: invitee.label?.relationship ? await seal(labelTarget(context.actor, "relationship"), invitee.label.relationship) : null,
      photoKey: invitee.label?.photoKey ?? null,
    } : Prisma.DbNull;
    invitees.push({ seat: invitee.seat, recipientLookupKey: invitee.recipientLookupKey, pendingLabel,
      memberId: invitee.memberId });
  }
  return { ...terms, words: { ...terms.words, groupWord: command.groupWord }, keys: audience.keys, invitees, round: 1, handles: [audience.starter, ...audience.contacts].map(contact => contact.value), room: null,
    revalidate: async (tx: Tx) => {
      if (!(await verifiedGameContactKeys(tx, context.actor, [audience.starter])).length) reject("PROFILE_REQUIRED", "Verify your invitation address again.");
      const members = await lookupHostedGroupParticipantMemberIdsByHandles({ handles: audience.contacts.map(contact => contact.value), prisma: tx });
      if (audience.contacts.some((contact, index) => (members.get(contact.value) ?? null) !== audience.invitees[index].memberId)) reject("INVALID_REQUEST", "The invitation audience changed. Try again.");
    } };
}

/** Copy identity and words; only original addressed participants can start Same again. */
async function prepareGroupRematch(actor: string, previousGameId: string) {
  const prisma = getPrisma();
  const previous = await prisma.game.findUnique({ where: { id: previousGameId }, include: { invitees: { orderBy: { seat: "asc" } }, players: { orderBy: { seat: "asc" } } } });
  if (!previous || previous.maxPlayers !== 10 || previous.status !== "settled" || !previous.audienceKey
    || !previous.players.some(player => player.memberId === actor)
    || (previous.createdBy !== actor && !previous.invitees.some(invitee => invitee.memberId === actor))) reject("NOT_A_PLAYER", "Same again is for players in the original addressed audience.");
  const [plain] = await openGameTexts([{ ...gameTarget(previous, "terms_words"), value: previous.termsWordsEncrypted }]);
  const words = parseTermWords(plain ?? "");
  const oldSeat = previous.createdBy === actor ? 0 : previous.invitees.find(invitee => invitee.memberId === actor)!.seat;
  const remap = (seat: number) => rematchSeat(seat, oldSeat);
  const version = currentTerms(parseStoredTerms(previous.terms));
  const currentWords = effectiveTermWords(words, version.n);
  const invitees = [{ seat: 0, memberId: previous.createdBy, recipientLookupKey: null }, ...previous.invitees]
    .filter(invitee => invitee.memberId !== actor && (invitee.memberId !== null || invitee.recipientLookupKey !== null))
    .map(invitee => ({ seat: remap(invitee.seat), memberId: invitee.memberId,
      recipientLookupKey: invitee.recipientLookupKey, pendingLabel: Prisma.DbNull }));
  const snapshot = JSON.stringify(previous);
  return { keys: { current: previous.audienceKey, candidates: [previous.audienceKey] }, invitees, round: previous.round + 1, handles: undefined, room: previous.chatContainerMemberId,
    terms: { v: 1 as const, versions: [{ ...version, n: 1, fromDay: 0 }] },
    words: { ...words, versions: [{ ...currentWords, n: 1, tasks: currentWords.tasks.map(task => ({ ...task, seat: remap(task.seat) })).sort((a, b) => a.seat - b.seat) }] },
    lengthDays: previous.lengthDays, startsOn: null,
    revalidate: async (tx: Tx) => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${previousGameId} FOR UPDATE`;
      const current = await tx.game.findUnique({ where: { id: previousGameId }, include: { invitees: { orderBy: { seat: "asc" } }, players: { orderBy: { seat: "asc" } } } });
      if (JSON.stringify(current) !== snapshot) reject("INVALID_REQUEST", "This game changed. Try again.");
      const later = await tx.game.findFirst({ where: { previousGameId, status: { in: [...ACTIVE_STATUSES, "settled"] } }, select: { status: true } });
      if (later) reject(later.status === "settled" ? "REMATCH_OUTDATED" : "ALREADY_IN_A_GAME", "This game already has a rematch.");
    } };
}

/** Shared by the early replay, pair-locked replay and unique-key race. */
async function isGameCreationReplay(tx: Pick<Tx, "game">, actor: string, gameId: string, players?: readonly string[]): Promise<boolean> {
  const row = await tx.game.findUnique({ where: { id: gameId }, select: { createdBy: true, players: { select: { memberId: true } } } });
  if (!row) return false;
  if (row.createdBy !== actor || (players && !sameGamePlayers(row.players.map(player => player.memberId), players))) reject("INVALID_REQUEST", "That game id is taken.");
  return true;
}

async function readGameCreationRematch(context: CommandContext, command: Extract<GameCommand, { type: "createGame" }>, chatOther?: string) {
  const rematch = command.previousGameId ? await readRematch(context.actor, command.previousGameId) : null;
  // A listed creator starts fresh games; an unlisted player may rematch an on-game.
  if (!isGameOn({ players: [{ memberId: context.actor }], invitees: [{ memberId: rematch?.opponentMemberId ?? null }] })) reject("GAME_DISABLED", "Starting a game is invite only for now.");
  if (chatOther && rematch && rematch.opponentMemberId !== chatOther) reject("NOT_A_PLAYER", "Rematch a settled game with the other person in this chat.");
  if (rematch && command.previousGameId) await assertLatestInChain(context.actor, rematch.opponentMemberId, command.previousGameId, context.now ?? new Date());
  return rematch;
}

async function gameCreationPlayers(tx: Tx, actor: string, timeZone: string, joinedAt: Date, other?: string) {
  const players = [{ memberId: actor, seat: 0, timeZone, joinedAt }];
  if (!other) return players;
  const profile = await tx.gameProfile.findUnique({ where: { memberId: other }, select: { timeZone: true } });
  if (!profile) reject("PROFILE_REQUIRED", `${other} needs a first name and time zone in the Murph app.`);
  return [...players, { memberId: other, seat: 1, timeZone: profile.timeZone, joinedAt }];
}

/** Caller holds the pair lock. */
async function revalidatePairCreationTx(input: {
  actor: string;
  opponentMemberId: string | null;
  now: Date;
  previousGameId?: string;
  tx: Tx;
}): Promise<void> {
  if (!input.opponentMemberId) return;
  await rejectBlockedPair(input.tx, input.actor, input.opponentMemberId, "You can't rematch this game.");
  if (input.previousGameId) await assertLatestInChain(input.actor, input.opponentMemberId, input.previousGameId, input.now, input.tx);
  await assertPairCapacity(input.tx, input.actor, input.opponentMemberId, input.now);
}

/**
 * A rematch must follow a finished game the challenger played. After a settled
 * game with exactly one other player, it continues the round count and is
 * addressed to that player, the only one who can accept it, on their Home.
 */
async function readRematch(
  actor: string,
  previousGameId: string,
): Promise<{ round: number; opponentMemberId: string; chatContainerMemberId: string | null }> {
  const previous = await getPrisma().game.findUnique({
    include: { invitees: true, players: { select: { memberId: true } } },
    where: { id: previousGameId },
  });
  const finished = previous?.status === "settled";
  if (!previous || previous.maxPlayers !== 2 || !finished || !previous.players.some((player) => player.memberId === actor)) {
    reject("INVALID_REQUEST", "A rematch needs a settled game you played.");
  }
  const others = previous.players.filter((player) => player.memberId !== actor);
  if (others.length !== 1 || !others[0].memberId) reject("INVALID_REQUEST", "The other player is no longer available for a rematch.");
  await rejectBlockedPair(getPrisma(), actor, others[0].memberId, "You can't rematch this game.");
  await maintainPair(actor, others[0].memberId);
  return { opponentMemberId: others[0].memberId, chatContainerMemberId: previous.chatContainerMemberId, round: previous.round + 1 };
}

/** Rematch ancestry, not unrelated games between the same people, owns the round. */
async function assertLatestInChain(actor: string, otherId: string, previousGameId: string, now: Date, tx?: Tx): Promise<void> {
  const prisma = tx ?? getPrisma();
  const later = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE descendants AS (
      SELECT id, status FROM game WHERE previous_game_id = ${previousGameId}
      UNION ALL
      SELECT child.id, child.status FROM game child JOIN descendants parent ON child.previous_game_id = parent.id
    ) SELECT id FROM descendants WHERE status = 'settled' LIMIT 1`);
  if (later.length) reject("REMATCH_OUTDATED", "A later game in this rematch chain has already finished.");
  const pending = await prisma.game.findFirst({
    select: { createdBy: true, status: true },
    where: { previousGameId, ...openPairWhere(actor, otherId, now) },
    orderBy: { id: "asc" },
  });
  // Asking is never agreeing: their open offer waits for its own yes, even on the same terms.
  if (pending?.createdBy === otherId && pending.status !== "live") reject("ALREADY_IN_A_GAME", "They already asked for a rematch. Read it first: pull down on Home to see it.");
  if (pending) reject("ALREADY_IN_A_GAME", "This game already has an open rematch.");
}

/** An unaddressed link cannot occupy a pair's slot until someone joins it. */
function openPairWhere(first: string, second: string, now: Date): Prisma.GameWhereInput {
  const unexpired = { OR: [{ inviteExpiresAt: null }, { inviteExpiresAt: { gt: now } }] };
  return { OR: [
    { ...gamePairWhere([first, second]), OR: [{ status: "live" }, { status: "negotiating", ...unexpired }] },
    { status: "invited", AND: [unexpired, { OR: [{ createdBy: first, invitees: { some: { memberId: second } } }, { createdBy: second, invitees: { some: { memberId: first } } }] }] },
  ] };
}

/** Caller holds lockGamePair before the game lock; no persisted counter can drift. */
async function assertPairCapacity(tx: Tx, first: string, second: string, now: Date, excludeId?: string): Promise<void> {
  const games = await tx.game.findMany({
    where: { ...openPairWhere(first, second, now), ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true }, take: GAME_MAX_OPEN_PER_PAIR,
  });
  if (games.length >= GAME_MAX_OPEN_PER_PAIR) reject("TOO_MANY_GAMES", `You two already have ${GAME_MAX_OPEN_PER_PAIR} open games. Finish one or cancel an unstarted invite before starting another.`);
}

async function maintainPair(first: string, second: string): Promise<void> {
  const games = await getPrisma().game.findMany({
    where: { ...gamePairWhere([first, second]), status: { in: ["live", "negotiating"] } },
    select: { id: true }, take: GAME_MAX_OPEN_PER_PAIR,
  });
  await loadCurrent(games.map((game) => game.id), true, first);
}

async function join(context: CommandContext, command: Extract<GameCommand, { type: "join" }>): Promise<string> {
  const target = await getPrisma().game.findUnique({
    select: { createdBy: true, id: true, maxPlayers: true },
    where: { inviteTokenHash: sha256Hex(command.token) },
  });
  if (!target) reject("INVITE_NOT_FOUND", "Invite not found.");
  if (target.maxPlayers === 10 && !areGameGroupsEnabled()) reject("GAME_DISABLED", "Group games aren't available yet.");
  if (target.maxPlayers === 2 && !target.createdBy) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
  return joinGame(context, target, command);
}

async function joinGame(context: CommandContext, target: { id: string; createdBy: string | null; maxPlayers?: number }, body: AcceptInviteBody): Promise<string> {
  const { actor } = context;
  const prisma = getPrisma();
  const profile = await prisma.gameProfile.findUnique({ select: { memberId: true }, where: { memberId: actor } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");
  if (target.maxPlayers !== 10) await maintainPair(target.createdBy!, actor);
  await accept(context, body, target.id, target.createdBy);
  try { await (await import("./private-kickoff")).activatePrivateGamePlayers(target.id, context.now ?? new Date()); }
  catch { /* The committed join remains; lifecycle recovery can retry. */ }
  return target.id;
}

/** A join or negotiation takes the pair's lock before the game's, as a block does. */
function withPairLock(context: CommandContext, other: string): CommandContext {
  return { ...context, beforeMutationTx: async (tx) => {
    await context.beforeMutationTx?.(tx);
    await lockGamePair(tx, context.actor, other);
  } };
}

async function withGamePairLock(context: CommandContext, gameId: string): Promise<CommandContext> {
  const other = await getPrisma().gamePlayer.findFirst({ where: { gameId, game: { maxPlayers: 2 }, memberId: { not: context.actor } }, select: { memberId: true } });
  return other?.memberId ? withPairLock(context, other.memberId) : context;
}

/** Blocked either way: to the one who was blocked, the invite just closed. */
async function rejectBlockedJoin(tx: Tx, creator: string, actor: string): Promise<void> {
  await rejectBlockedPair(tx, actor, creator, "This invite isn't open anymore.");
}

async function accept(context: CommandContext, command: AcceptInviteBody, gameId: string, creator: string | null): Promise<void> {
  const { actor } = context;
  const row = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId }, select: { maxPlayers: true } });
  const contacts = row.maxPlayers === 10 ? await readGameVerifiedContacts(actor) : [];
  let expired = false;
  await runLocked(gameId, row.maxPlayers === 2 ? withPairLock(context, creator!) : context, async locked => {
    const { loaded, now, tx } = locked;
    const { row } = loaded;
    if (row.maxPlayers === 10 && !areGameGroupsEnabled()) reject("GAME_DISABLED", "Group games aren't available yet.");
    if (row.maxPlayers === 2) await rejectBlockedJoin(tx, creator!, actor);
    if (await settleLoaded(locked, actor)) { expired = true; return []; }
    const keys = row.maxPlayers === 10 ? await verifiedGameContactKeys(tx, actor, contacts) : [];
    const invitation = addressedGameInvite(row.invitees, actor, keys);
    const decision = decideJoin(row.status === "live" ? loaded.state : await withCurrentTimeZones(tx, loaded.state), {
      acceptNegotiation: row.pendingChange === null, memberId: actor, now, termsVersion: command.termsVersion,
      timeZone: command.timeZone, invitationSeat: invitation?.seat,
    });
    if (decision.kind === "already-joined") return [];
    if (row.maxPlayers === 10 && context.chatContainerMemberId && !invitation) reject("NOT_A_PLAYER", "Only an addressed invitee can agree.");
    if (row.maxPlayers === 2) await assertPairCapacity(tx, creator!, actor, now, gameId);
    const claimed = playerFor(loaded.state, actor);
    if (!claimed) await tx.gamePlayer.create({ data: { gameId: row.id, memberId: actor, seat: decision.seat, timeZone: command.timeZone, joinedAt: now } });
    await writeSchedule(tx, row.id, decision);
    const activates = decision.activates ?? true;
    if (activates) await tx.game.update({ data: { startedAt: decision.startedAt, status: "live" }, where: { id: row.id } });
    await acceptInvitation(tx, row, actor, decision.seat);
    return [
      ...(!claimed ? [{ payload: { seat: decision.seat }, type: "joined" as const }] : []),
      ...(activates ? [{ payload: { startNow: false }, type: "started" as const }] : []),
    ];
  });
  if (expired) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
}

/** Everyone's time zone freezes at go-live, from their profile as of now. */
async function withCurrentTimeZones(tx: Tx, state: RuleState): Promise<RuleState> {
  const zones = await tx.gameProfile.findMany({
    select: { memberId: true, timeZone: true },
    where: { memberId: { in: state.players.map((player) => player.memberId) } },
  });
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      timeZone: zones.find((zone) => zone.memberId === player.memberId)?.timeZone ?? player.timeZone,
    })),
  };
}

/** Writes each player's frozen time zone and Day 1. */
async function writeSchedule(tx: Tx, gameId: string, schedule: Schedule): Promise<void> {
  for (const player of schedule.players) {
    await tx.gamePlayer.update({
      data: { dayOne: toDbDate(player.dayOne), timeZone: player.timeZone },
      where: { gameId_memberId: { gameId, memberId: player.memberId } },
    });
  }
}

/**
 * The challenger's invite label becomes their label for the joiner. What they
 * typed most recently wins: its non-null fields replace the existing label's.
 */
async function acceptInvitation(tx: Tx, row: GameRow, joinerId: string, seat: number): Promise<void> {
  const invitation = row.invitees.find(invitee => invitee.seat === seat);
  if (!invitation) return;
  const label = parsePendingLabel(invitation.pendingLabel);
  await tx.gameInvitee.update({ where: { gameId_seat: { gameId: row.id, seat } }, data: { memberId: joinerId, pendingLabel: Prisma.DbNull } });
  if (!row.createdBy || (!label.nameEncrypted && !label.relationshipEncrypted && !label.photoKey)) return;
  await tx.$executeRaw`
    INSERT INTO game_contact_label
      (owner_member_id, subject_member_id, name_encrypted, relationship_encrypted, photo_key, updated_at)
    VALUES (${row.createdBy}, ${joinerId}, ${label.nameEncrypted}, ${label.relationshipEncrypted}, ${label.photoKey}, now())
    ON CONFLICT (owner_member_id, subject_member_id) DO UPDATE SET
      name_encrypted = COALESCE(EXCLUDED.name_encrypted, game_contact_label.name_encrypted),
      relationship_encrypted = COALESCE(EXCLUDED.relationship_encrypted, game_contact_label.relationship_encrypted),
      photo_key = COALESCE(EXCLUDED.photo_key, game_contact_label.photo_key),
      updated_at = EXCLUDED.updated_at`;
}

async function cancelInvite(context: CommandContext, gameId: string): Promise<string> {
  await runLocked(gameId, context, async ({ tx, loaded, clock, now }) => {
    if (decideCancelInvite(loaded.state, context.actor, now) === "already-void") return [];
    await endGame(tx, gameId, { status: "void" });
    // Always reserve: the pending notice is also what keeps a game-funded room
    // able to deliver the one cancellation message after the game is void.
    if (loaded.row.chatContainerMemberId) {
      await reserveGameChatLifecycleTx({ gameId, kind: "cancelled", now: clock, tx });
    }
    return [{ type: "cancelled", payload: {} }];
  });
  return gameId;
}

/**
 * The viewer's own recap receipt, never shown to anyone else. One per seat, so
 * a retry or another phone adds nothing; the seat (not the member id) keeps the
 * key free of who it was once account deletion rewrites the actor.
 */
async function watchRecap(context: CommandContext, gameId: string): Promise<string> {
  const { actor } = context;
  await commandTransaction(context, async tx => {
    // Account deletion scrubs event actors under this lock: a receipt lands
    // before it (and is scrubbed) or finds the seat already gone.
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    const player = await tx.gamePlayer.findUnique({ where: { gameId_memberId: { gameId, memberId: actor } },
      select: { seat: true, game: { select: { status: true } } } });
    if (!player) reject("GAME_NOT_FOUND", "Game not found.");
    if (player.game.status !== "settled") reject("GAME_NOT_LIVE", "This game's recap isn't ready.");
    await tx.gameEvent.createMany({ skipDuplicates: true, data: [{ gameId, actor, type: "recap_watched",
      commandKey: `recap-watched:${gameId}:${player.seat}`, payload: { v: 1 } }] });
  });
  return gameId;
}

async function leave(context: CommandContext, gameId: string): Promise<null> {
  let ended = false;
  await runLocked(gameId, context, async locked => {
    const { loaded, tx, now } = locked;
    if (await settleLoaded(locked, context.actor)) { ended = true; return []; }
    const decision = decideLeave(loaded.state, context.actor);
    if (decision === "already-left") return [];
    // A departure changes the electorate, even when it also ends the game.
    await resolveGroupGameChangeTx({ tx, game: loaded.row, actor: context.actor, now: locked.clock,
      outcome: "change_expired", reason: GAME_ROSTER_CHANGE_REASON, answeredInBoundChat: answeredInBoundChat(context, loaded) });
    await tx.gamePlayer.update({ where: { gameId_memberId: { gameId, memberId: context.actor } }, data: { leftAt: now } });
    if (decision === "void") await endGame(tx, gameId, { status: "void", result: Prisma.DbNull });
    return [{ type: "left", payload: { seat: playerFor(loaded.state, context.actor)!.seat } }];
  });
  if (ended) reject("GAME_NOT_LIVE", "This game has ended.");
  return null;
}

async function editTerms(context: CommandContext, command: Extract<GameCommand, { type: "editTerms" }>): Promise<string> {
  const [before] = await loadGames(getPrisma(), [command.gameId]);
  if (!before) reject("GAME_NOT_FOUND", "Game not found.");
  if (before.row.maxPlayers === 10 && before.row.status !== "invited") return proposeGroupChange(context, command, before);
  assertGroupTermsOpen(before.state, context.actor, gameNow(context.now ?? new Date(), before.row), command.expectedTermsVersion);
  const now = gameNow(context.now ?? new Date(), before.row);
  const today = remainingPlayers(before.state).map(player => gameLocalDate(now, player.timeZone)).sort().at(-1)!;
  const [plain] = await openGameTexts([{ ...gameTarget(before.row, "terms_words"), value: before.row.termsWordsEncrypted }]);
  const words = parseTermWords(plain ?? "");
  const taskSeats = groupTaskOverrideSeats(before.state.game, words.versions.at(-1)?.tasks ?? []);
  const inputTerms = context.chatContainerMemberId ? { ...command.terms,
    tasks: [...words.versions.at(-1)!.tasks.filter(task => !remainingPlayers(before.state).some(player => player.seat === task.seat)),
      ...command.terms.tasks.filter(task => task.text !== command.terms.defaultTask)] } : command.terms;
  const prepared = decideNewTerms(inputTerms, { maxPlayers: 10, inviteeSeats: taskSeats,
    today, allowToday: true, currentStartsOn: before.state.game.startsOn, newKey: () => generateHostedRandomPrefixedId("gsk") });
  const n = command.expectedTermsVersion + 1;
  words.versions.push({ ...prepared.words.versions[0], n });
  const encrypted = await seal(gameTarget(before.row, "terms_words"), JSON.stringify(words));
  await runLocked(command.gameId, context, async ({ tx, loaded, now }) => {
    if (loaded.row.status !== "invited") reject("TERMS_CHANGED", "Someone joined. Refresh the game to request a change.");
    assertGroupTermsOpen(loaded.state, context.actor, now, command.expectedTermsVersion);
    if (loaded.row.termsWordsEncrypted !== before.row.termsWordsEncrypted || loaded.row.wordsOwnerMemberId !== before.row.wordsOwnerMemberId) reject("TERMS_CHANGED", "The terms changed. Take another look.");
    const terms = { ...loaded.state.game.terms, versions: [...loaded.state.game.terms.versions, { ...prepared.terms.versions[0], n }] };
    await tx.game.update({ where: { id: command.gameId }, data: { terms: toPrismaJsonObject(terms), termsWordsEncrypted: encrypted,
      lengthDays: prepared.lengthDays, startsOn: prepared.startsOn ? toDbDate(prepared.startsOn) : null } });
    return [{ type: "terms_edited", payload: { termsVersion: n } }];
  });
  return command.gameId;
}

/** Validate and seal full group terms outside the transaction; votes reuse the approval writer. */
async function prepareGroupChange(before: LoadedGame, command: Extract<GameCommand, { type: "editTerms" }>, now: Date) {
  if (currentTerms(before.state.game.terms).n !== command.expectedTermsVersion) reject("TERMS_CHANGED", "The game changed. Take another look.");
  const [plain] = await openGameTexts([{ ...gameTarget(before.row, "terms_words"), value: before.row.termsWordsEncrypted }]);
  const words = parseTermWords(plain ?? "");
  const players = remainingPlayers(before.state);
  const seats = new Set(players.map(player => player.seat));
  if (command.terms.tasks.some(task => !seats.has(task.seat))) reject("INVALID_REQUEST", "Only edit the remaining players’ tasks.");
  const merged = { ...command.terms, tasks: [
    ...words.versions.at(-1)!.tasks.filter(task => !seats.has(task.seat)),
    ...command.terms.tasks.filter(task => task.text !== command.terms.defaultTask),
  ] };
  const prepared = decideNewTerms(keepShownStart(before.state, merged), { maxPlayers: 10,
    inviteeSeats: [...words.versions.at(-1)!.tasks.map(task => task.seat), ...players.map(player => player.seat)],
    today: players.map(player => gameLocalDate(now, player.timeZone)).sort().at(-1)!, allowToday: true,
    currentStartsOn: before.state.game.startsOn, newKey: () => generateHostedRandomPrefixedId("gsk") });
  const change = normalizeGroupGameChange(before.state, words, prepared);
  return { change, ...await prepareGameChangeWords(before.row, change, command.expectedTermsVersion, words),
    baseWordsEncrypted: before.row.termsWordsEncrypted, rosterBasis: groupChangeRosterBasis(before.state) };
}

/**
 * read_game shows the effective Day 1, which can differ from the stored picked
 * date once activation aligns it to the schedule. Echoing it, or leaving the
 * date out, keeps the start unchanged.
 */
function keepShownStart(state: RuleState, terms: GameTerms): GameTerms {
  if (terms.startsOn !== undefined && terms.startsOn !== (gameDayOne(calendarPlayers(state)) ?? state.game.startsOn)) return terms;
  const kept = { ...terms };
  delete kept.startsOn;
  return state.game.startsOn ? { ...kept, startsOn: state.game.startsOn } : kept;
}

function groupChangeRosterBasis(state: RuleState): string {
  return JSON.stringify(remainingPlayers(state).map(({ memberId, seat }) => [memberId, seat]).sort((a, b) => Number(a[1]) - Number(b[1])));
}

async function proposeGroupChange(context: CommandContext, command: Extract<GameCommand, { type: "editTerms" | "proposeChange" }>, before: LoadedGame): Promise<string> {
  if (!remainingPlayers(before.state).some(player => player.memberId === context.actor)) reject("NOT_A_PLAYER", "This game belongs to its players.");
  if (context.chatContainerMemberId && !context.beforeMutationTx) reject("NOT_A_PLAYER", "Use this game’s group chat.");
  if (!command.proposalId) reject("INVALID_REQUEST", "Changes need the group's yes now. Ask again with a new proposalId.");
  const key = `game-change:${command.gameId}:${command.proposalId}`;
  const prior = await getPrisma().gameEvent.findUnique({ where: { commandKey: key }, select: { actor: true } });
  // Provider evidence and sealed words are prepared before the game lock.
  const audience = context.chatContainerMemberId ? context.chatAudience
    : before.row.chatContainerMemberId ? await readGroupGameChatAuthority(before.row, before.row.chatContainerMemberId) : null;
  const prepared = prior ? null : command.type === "editTerms"
    ? await prepareGroupChange(before, command, gameNow(context.now ?? new Date(), before.row))
    : { change: command.change, ...await prepareGameChangeWords(before.row, command.change, command.expectedTermsVersion), rosterBasis: groupChangeRosterBasis(before.state) };
  await runLocked(command.gameId, context, locked => createChangeProposalTx(locked, context, {
    gameId: command.gameId, proposalId: command.proposalId!, expectedTermsVersion: command.expectedTermsVersion,
    change: prepared?.change ?? { kind: "start_now" },
  }, prepared, { before, audience }));
  return command.gameId;
}

/** One locked proposal primitive; group policy adds electorate and room authority. */
async function createChangeProposalTx(locked: LockedStep, context: CommandContext,
  command: Pick<Extract<GameCommand, { type: "proposeChange" }>, "gameId" | "proposalId" | "expectedTermsVersion" | "change">,
  prepared: (PreparedGameChangeWords & { rosterBasis?: string }) | null,
  groupContext?: { before: LoadedGame; audience: GameChatAudience | null | undefined }): Promise<GameEventDraft[]> {
  const { tx, loaded, now } = locked;
  const group = loaded.row.maxPlayers === 10;
  if (!(group ? remainingPlayers(loaded.state) : loaded.state.players).some(player => player.memberId === context.actor)) reject("NOT_A_PLAYER", "This game belongs to its players.");
  const key = `game-change:${command.gameId}:${command.proposalId}`;
  const prior = await tx.gameEvent.findUnique({ where: { commandKey: key }, select: { actor: true } });
  if (prior) {
    if (group && prior.actor !== context.actor) reject("INVALID_REQUEST", "That proposal id is taken.");
    return [];
  }
  if (group) await assertGroupProposalPreparedTx(locked, prepared, groupContext);
  const pending = parsePendingGameChange(loaded.row.pendingChange);
  if (pending && !isGameChangeExpired(loaded.state, pending, now)) reject("CHANGE_PENDING", "There is already a change waiting for agreement in chat.");
  if (!prepared || currentTerms(loaded.state.game.terms).n !== command.expectedTermsVersion) reject("TERMS_CHANGED", "The game changed. Take another look.");
  if (!group) {
    const agreement = await agreeToDeclinedChange(locked, context, { type: "proposeChange", ...command }, key);
    if (agreement) return agreement;
  }
  const decision = decideGameChange(loaded.state, context.actor, command.change, now);
  assertPreparedWords(loaded.row, prepared);
  if (group && pending) await expireGroupChangeTx(locked, context, pending);
  const delivery = context.chatContainerMemberId ? { origin: "chat", deliveryStatus: "conversation" } : { origin: "app", deliveryStatus: "pending" };
  const proposal = { id: command.proposalId, proposedByMemberId: context.actor, expectedTermsVersion: command.expectedTermsVersion,
    ...delivery,
    ...decision, ...storedChangeWords(prepared, decision.change), ...(group ? { votes: { [context.actor]: "yes" } } : {}) };
  await tx.game.update({ where: { id: command.gameId }, data: { pendingChange: toPrismaJsonObject({ v: prepared.termsWordsEncrypted ? 2 : 1, ...proposal }) } });
  return [...(!group && pending ? [{ type: "change_expired" as const, payload: { proposalId: pending.id } }] : []),
    { type: "change_proposed", commandKey: key, payload: { proposalId: proposal.id, expectedTermsVersion: proposal.expectedTermsVersion, effectiveFromDay: proposal.effectiveFromDay } }];
}

async function assertGroupProposalPreparedTx(locked: LockedStep,
  prepared: (PreparedGameChangeWords & { rosterBasis?: string }) | null,
  groupContext: { before: LoadedGame; audience: GameChatAudience | null | undefined } | undefined): Promise<void> {
  const { loaded, tx } = locked;
  if (!groupContext?.audience || !loaded.row.chatContainerMemberId
    || !await readGroupGameChatAuthority(loaded.row, loaded.row.chatContainerMemberId, groupContext.audience, tx)) reject("NOT_A_PLAYER", "Open this game’s bound group chat before requesting a change.");
  if (!prepared || loaded.row.wordsOwnerMemberId !== groupContext.before.row.wordsOwnerMemberId
    || prepared.rosterBasis !== groupChangeRosterBasis(loaded.state)) reject("TERMS_CHANGED", "The game changed. Take another look.");
}

/** Freshness is classified before any first group vote, including a no. */
async function expireGroupChangeTx(locked: LockedStep, context: CommandContext, proposal: StoredGamePendingChange): Promise<string> {
  const reason = isGameChangeOutdated(locked.loaded.state, proposal, locked.now)
    ? GAME_ENDED_CHANGE_REASON : gameChangeRefusal(locked.loaded.state, proposal, locked.now) ?? "That request is no longer available.";
  await resolveGroupGameChangeTx({ tx: locked.tx, game: locked.loaded.row, actor: context.actor, now: locked.clock,
    proposal, outcome: "change_expired", reason, answeredInBoundChat: answeredInBoundChat(context, locked.loaded) });
  return reason;
}

/** Murph's reply in the bound chat already explains this outcome; a lifecycle notice there would repeat it. */
function answeredInBoundChat(context: CommandContext, loaded: LoadedGame): boolean {
  return context.chatContainerMemberId !== undefined && context.chatContainerMemberId === loaded.row.chatContainerMemberId;
}

function needsChatLifecycleNotice(context: CommandContext, loaded: LoadedGame): boolean {
  return Boolean(loaded.row.chatContainerMemberId) && !answeredInBoundChat(context, loaded);
}

/** Settlement and cancellation release this game's open slot. */
async function endGame(tx: Tx, gameId: string, data: Prisma.GameUpdateInput): Promise<void> {
  const game = await tx.game.findUniqueOrThrow({ where: { id: gameId } });
  await resolveGroupGameChangeTx({ tx, game, actor: SYSTEM_ACTOR, now: new Date(), outcome: "change_expired", reason: GAME_ENDED_CHANGE_REASON });
  await tx.game.update({ data: { ...data, pendingChange: Prisma.DbNull }, where: { id: gameId } });
}

async function post(context: CommandContext, command: Extract<GameCommand, { type: "post" }>): Promise<string> {
  const { actor } = context;
  const { entryId, gameId, kind, mediaKeys } = command;
  const target = { memberId: actor, rowId: entryId, table: "game_entry" as const };
  const [textEncrypted, payloadEncrypted] = await Promise.all([
    command.text ? seal({ ...target, field: "text" }, command.text) : null,
    command.data ? seal({ ...target, field: "payload" }, JSON.stringify(command.data)) : null,
  ]);
  const captureAgeMs = command.captureAgeMs ?? null;
  let notification: Awaited<ReturnType<typeof claimGamePostNotification>> = [];
  await runLocked(gameId, context, async ({ clock, loaded, now, tx }) => {
    // A repeat of a post that already landed (a retry, or the same tap twice) changes nothing.
    const existing = await tx.gameEntry.findUnique({ select: { memberId: true }, where: { id: entryId } });
    if (existing) {
      if (existing.memberId !== actor) reject("INVALID_REQUEST", "That entry id is taken.");
      return [];
    }
    const decision = decidePost(loaded.state, {
      captureAgeMs,
      kind,
      hasData: command.data !== undefined,
      mediaKeyPrefix: mediaKeyPrefixFor(actor),
      mediaKeys,
      memberId: actor,
      now,
    });
    if (command.expectEmptySlot && decision.withdrawEntryId) {
      reject("SLOT_TAKEN", "You already have a post for this day, so this one wasn't added.");
    }
    if (context.postGuard && (decision.dayIndex !== context.postGuard.dayIndex || decision.withdrawEntryId !== context.postGuard.replaceEntryId)) {
      reject("INVALID_REQUEST", "The current check-in changed. Read the game before confirming a replacement.");
    }
    if (decision.withdrawEntryId) {
      await deleteEntryReplyTx(tx, decision.withdrawEntryId);
      await tx.gameEntry.update({
        data: { withdrawnAt: clock, withdrawnReason: "retake" },
        where: { id: decision.withdrawEntryId },
      });
    }
    await tx.gameEntry.create({
      data: {
        attempt: decision.attempt,
        captureAgeMs,
        dayIndex: decision.dayIndex,
        gameId,
        id: entryId,
        kind,
        mediaKeys,
        memberId: actor,
        receivedAt: clock,
        textEncrypted,
        payloadEncrypted,
        blurHash: command.blurHash ?? null,
        incomplete: kind !== "excuse" && loaded.state.entries.some((entry) => entry.memberId === actor && entry.dayIndex === decision.dayIndex && entry.incomplete) ? true : null,
      },
    });
    const { attempt, dayIndex, graceUsed } = decision;
    if (kind !== "excuse" && attempt === 1) {
      notification = await claimGamePostNotification(tx, {
        actor, clock, entryId, dayIndex,
        state: { ...loaded.state, entries: [...loaded.state.entries, { id: entryId, memberId: actor, attempt, dayIndex, kind,
          mediaKeys, receivedAt: clock, withdrawnAt: null, blurHash: command.blurHash ?? null }] },
      });
    }
    return [{ payload: { attempt, dayIndex, entryId, graceUsed, kind }, type: "posted" }];
  });
  sendGamePostNotificationAfterResponse(notification);
  return gameId;
}

/** The ordinary entry masks plus the reply-only, cross-game report mask. No content reads. */
async function readReplyContext(db: Db, loaded: LoadedGame, viewer: string): Promise<ReplyContext> {
  const peers = gameMemberIds(loaded.row.players).filter(id => id !== viewer);
  const [blocks, reportedMemberIds, reports] = await Promise.all([
    readGameBlocks(db, viewer, peers), readReplyReportedMembers(db, viewer, peers),
    db.gameReport.findMany({ where: { reporterMemberId: viewer, gameId: loaded.row.id, entryId: { not: null } }, select: { entryId: true } }),
  ]);
  const hiddenMemberIds = new Set([...blocks.blocked, ...blocks.blockedBy]);
  const hiddenEntries = new Set(reports.flatMap(report => report.entryId ?? []));
  return { state: loaded.state, hiddenMemberIds, reportedMemberIds,
    visibleEntryIds: visibleEntryIds(loaded.state, viewer, hiddenEntries, hiddenMemberIds) };
}

async function readableReply(gameId: string, replyId: string, viewer: string) {
  const db = getPrisma();
  const reply = await db.gameReply.findFirst({ where: { id: replyId, entry: { gameId } },
    select: { id: true, entryId: true, authorMemberId: true, kind: true } });
  if (!reply) return null;
  const [loaded] = await loadGames(db, [gameId]);
  if (!loaded || !isGameOn(loaded.row) || !replyReadAccess(viewer, reply, await readReplyContext(db, loaded, viewer))) return null;
  return reply;
}

export async function canReadGameReply(gameId: string, replyId: string, viewer: string): Promise<boolean> {
  return (await readableReply(gameId, replyId, viewer)) !== null;
}

export async function readGameReplyAudio(gameId: string, replyId: string, viewer: string): Promise<Uint8Array | null> {
  const reply = await readableReply(gameId, replyId, viewer);
  if (!reply || reply.kind !== "voice") return null;
  const content = await getPrisma().gameReply.findUnique({ where: { id: reply.id }, select: { audioEncrypted: true } });
  return content?.audioEncrypted ? openGameMedia({ envelope: content.audioEncrypted, key: `game_reply:${reply.id}`, ownerMemberId: reply.authorMemberId }) : null;
}

async function replyToPost(context: CommandContext, command: Extract<GameCommand, { type: "replyToPost" }>): Promise<string> {
  const { gameId, entryId, replyId, kind } = command;
  const bytes = kind === "voice" ? Buffer.from(command.audio, "base64") : null;
  const durationMs = bytes ? inspectReplyAudio(bytes).durationMs : null;
  const [textEncrypted, audioEncrypted] = await Promise.all([
    kind === "text" ? seal({ table: "game_reply", rowId: replyId, field: "text", memberId: context.actor }, command.text) : null,
    bytes ? sealGameMedia({ bytes, key: `game_reply:${replyId}`, ownerMemberId: context.actor }) : null,
  ]);
  let notification: Awaited<ReturnType<typeof claimGameReplyNotification>> = null;
  try {
    await runLocked(gameId, context, async ({ tx, loaded, now }) => {
      const commandKey = `game-reply:${replyId}`;
      const receipt = await tx.gameEvent.findUnique({ where: { commandKey }, select: { actor: true, gameId: true, payload: true } });
      if (receipt) {
        if (!replyReceiptMatches(receipt, context.actor, gameId, entryId)) reject("REPLY_USED", "That reply id is taken.");
        return [];
      }
      const access = await readReplyContext(tx, loaded, context.actor);
      const occupied = await tx.gameReply.findUnique({ where: { entryId }, select: { id: true } });
      const refusal = replyEligibility(context.actor, entryId, access, now, occupied !== null);
      if (refusal) reject(refusal, refusal === "REPLY_USED" ? "This post already has a reply." : "You can't reply to this post.");
      await tx.gameReply.create({ data: { id: replyId, entryId, authorMemberId: context.actor, kind, textEncrypted, audioEncrypted, durationMs,
        levels: kind === "voice" ? command.levels : [] } });
      notification = await claimGameReplyNotification(tx, { gameId, entryId, replyId, kind,
        memberId: loaded.entries.find(entry => entry.id === entryId)!.memberId });
      return [{ type: "reply_accepted", commandKey, payload: { entryId } }];
    });
  } catch (error) {
    if (isUniqueViolation(error)) reject("REPLY_USED", "That reply id is taken.");
    throw error;
  }
  sendGameReplyNotificationAfterResponse(notification);
  return gameId;
}

/** The same locked hard delete serves the author and Ops. It deliberately emits nothing. */
async function deleteReply(context: CommandContext, command: { gameId: string; replyId: string }): Promise<string> {
  await runLocked(command.gameId, context, async ({ tx }) => {
    const reply = await tx.gameReply.findUnique({ where: { id: command.replyId }, select: { entryId: true, authorMemberId: true, entry: { select: { gameId: true } } } });
    if (!reply) return [];
    if (reply.entry.gameId !== command.gameId || (context.actor !== SYSTEM_ACTOR && reply.authorMemberId !== context.actor)) reject("NOT_A_PLAYER", "You can only delete your own reply.");
    await deleteEntryReplyTx(tx, reply.entryId);
    return [];
  });
  return command.gameId;
}

export async function removeGameReplyForReview(replyId: string): Promise<void> {
  const reply = await getPrisma().gameReply.findUnique({ where: { id: replyId }, select: { entry: { select: { gameId: true } } } });
  if (reply) await deleteReply({ actor: SYSTEM_ACTOR }, { gameId: reply.entry.gameId, replyId });
}

async function challenge(context: CommandContext, command: Extract<GameCommand, { type: "challenge" }>): Promise<string> {
  const candidate = await getPrisma().game.findUnique({ where: { id: command.gameId }, include: { players: true, invitees: true } });
  const audience = candidate?.maxPlayers === 10 && candidate.chatContainerMemberId
    ? await readGroupGameChatAuthority(candidate, candidate.chatContainerMemberId) : null;
  await runLocked(command.gameId, context, async ({ loaded, now, tx }) => {
    const player = playerFor(loaded.state, context.actor);
    if (!player || player.leftAt) reject("NOT_A_PLAYER", "You're not in this game.");
    const blocks = await readGameBlocks(tx, context.actor, gameMemberIds(loaded.row.players));
    if (blocks.blocked.size || blocks.blockedBy.size) reject("PLAYER_UNAVAILABLE", "This player isn't available.");
    const commandKey = gameChallengeKey(command.gameId, command.entryId);
    const existing = await tx.gameEvent.findUnique({ where: { commandKey }, select: { actor: true } });
    if (existing) {
      if (existing.actor !== context.actor) reject("INVALID_REQUEST", "That post already has a case.");
      return [];
    }
    if (loaded.row.maxPlayers === 10 && (!audience || !loaded.row.chatContainerMemberId
      || !await readGroupGameChatAuthority(loaded.row, loaded.row.chatContainerMemberId, audience, tx))) {
      reject("CHAT_UNAVAILABLE", "This game needs its shared chat first.");
    }
    const [history, reports] = await Promise.all([
      readGameChallenges(tx, [command.gameId]),
      tx.gameReport.findMany({ where: { gameId: command.gameId, reporterMemberId: context.actor, entryId: { not: null } }, select: { entryId: true } }),
    ]);
    const hidden = new Set(reports.flatMap(report => report.entryId ? [report.entryId] : []));
    const draft = { type: "challenged" as const, createdAt: now, ...decideChallenge(loaded.state, history.get(command.gameId) ?? [], {
      memberId: context.actor, entryId: command.entryId, now, visibleEntryIds: visibleEntryIds(loaded.state, context.actor, hidden),
    }) };
    await reserveGameChallengeTx({ gameId: command.gameId, entryId: draft.payload.entryId,
      containerMemberId: loaded.row.chatContainerMemberId!, now, tx });
    return [draft];
  });
  return command.gameId;
}

async function setDayCompletion(context: CommandContext, command: Extract<GameCommand, { type: "setDayCompletion" }>): Promise<{ gameId: string; dayOutcome: GameDayOutcome }> {
  let dayOutcome: GameDayOutcome | undefined;
  await runLocked(command.gameId, context, async ({ loaded, now, tx }) => {
    if (!context.chatContainerMemberId || loaded.row.chatContainerMemberId !== context.chatContainerMemberId) reject("NOT_A_PLAYER", "Use the group chat bound to this game.");
    const decision = decideDayCompletion(loaded.state, { memberId: context.actor, date: command.date, incomplete: command.incomplete, now });
    dayOutcome = decision.outcome;
    if (!decision.changed) return [];
    await tx.gameEntry.updateMany({ where: { gameId: command.gameId, memberId: context.actor, dayIndex: decision.dayIndex, attempt: { gt: 0 } }, data: { incomplete: command.incomplete ? true : null } });
    return [{ type: command.incomplete ? "day_marked_incomplete" : "day_restored", payload: { dayIndex: decision.dayIndex } }];
  });
  if (!dayOutcome) throw new Error("Game day correction produced no outcome.");
  return { gameId: command.gameId, dayOutcome };
}

async function withdraw(context: CommandContext, command: Extract<GameCommand, { type: "withdraw" }>): Promise<string> {
  const { entryId, gameId } = command;
  await runLocked(gameId, context, async ({ clock, loaded, now, tx }) => {
    const { withdraw: change } = decideWithdraw(loaded.state, { entryId, memberId: context.actor, now });
    if (!change) return [];
    await deleteEntryReplyTx(tx, change.entryId);
    await tx.gameEntry.update({ data: { withdrawnAt: clock, withdrawnReason: "withdrawn" }, where: { id: change.entryId } });
    return [{ payload: change, type: "withdrew" }];
  });
  return gameId;
}

async function redeem(context: CommandContext, command: Extract<GameCommand, { type: "redeem" }>): Promise<string> {
  const { actor } = context;
  const { ticketId } = command;
  const ticket = await getPrisma().gameTicket.findUnique({ select: { gameId: true }, where: { id: ticketId } });
  if (!ticket) reject("TICKET_NOT_HELD", "That prize isn't yours to mark done.");
  await runLocked(ticket.gameId, context, async ({ clock, now, tx, loaded }) => {
    const current = await tx.gameTicket.findUniqueOrThrow({ where: { id: ticketId } });
    const holder = loaded.row.players.find(player => player.memberId === actor);
    const group = loaded.row.maxPlayers === 10;
    const authorized = group ? canRedeemGroupTicket(current, loaded.row.players, loaded.row.result ? parseStoredResult(loaded.row.result) : null, actor)
      : holder && current.owedToSeats.includes(holder.seat);
    if (!authorized) reject("TICKET_NOT_HELD", "That prize isn't yours to mark done.");
    if (isTicketExpired(current, now)) reject("TICKET_EXPIRED", "This prize expired before it was used.");
    const debtor = loaded.row.players.find(player => current.owedBySeats.includes(player.seat))?.memberId;
    if (!group && current.status === "open" && (!debtor || await areGamePlayersBlocked(tx, actor, debtor))) {
      reject("INVALID_REQUEST", "They left Murph, so this prize can't be marked done.");
    }
    const changed = await tx.gameTicket.updateMany({
      data: { redeemedAt: clock, status: "redeemed" }, where: { id: ticketId, status: "open" },
    });
    return changed.count === 1 ? [{ payload: { ticketId }, type: "redeemed" }] : [];
  });
  return ticket.gameId;
}

/** Changes only the viewer's photo, preserving their private name and relationship. */
async function setPlayerPhoto(context: CommandContext, command: Extract<GameCommand, { type: "setPlayerPhoto" }>): Promise<null> {
  const { actor } = context;
  const { memberId, photoKey } = command;
  if (memberId === actor) reject("INVALID_REQUEST", "Use your profile to change your own photo.");
  await commandTransaction(context, async (tx) => {
    await lockGamePair(tx, actor, memberId);
    if (!await tx.game.findFirst({ select: { id: true }, where: gamesBetween(actor, memberId) })
      || await areGamePlayersBlocked(tx, actor, memberId)) {
      reject("NOT_A_PLAYER", "You can only change a private photo of someone you play with.");
    }
    if (photoKey === null) {
      await tx.$executeRaw`UPDATE game_contact_label SET photo_key = NULL, updated_at = now()
        WHERE owner_member_id = ${actor} AND subject_member_id = ${memberId}`;
      return;
    }
    // Serialize with profile-photo updates, which take the same profile row lock.
    const [profile] = await tx.$queryRaw<{ photoKey: string | null }[]>`
      SELECT photo_key AS "photoKey" FROM game_profile WHERE member_id = ${memberId} FOR NO KEY UPDATE`;
    if (!profile) reject("NOT_A_PLAYER", "This player is no longer available.");
    if (profile.photoKey) reject("INVALID_REQUEST", "They have their own profile photo. You can only remove your private photo.");
    if (!await tx.gameProfile.findUnique({ select: { memberId: true }, where: { memberId: actor } })) {
      reject("PROFILE_REQUIRED", "Add your first name and time zone first.");
    }
    await tx.$executeRaw`INSERT INTO game_contact_label (owner_member_id, subject_member_id, photo_key, updated_at)
      VALUES (${actor}, ${memberId}, ${photoKey}, now())
      ON CONFLICT (owner_member_id, subject_member_id) DO UPDATE SET photo_key = EXCLUDED.photo_key, updated_at = now()`;
  });
  return null;
}

// ------------------------------------------------------------ report, block

/** Every game two people both joined, and an addressed rematch between them. */
function gamesBetween(a: string, b: string): Prisma.GameWhereInput {
  return { OR: [
    { AND: [{ players: { some: { memberId: a } } }, { players: { some: { memberId: b } } }] },
    { createdBy: a, invitees: { some: { memberId: b } } },
    { createdBy: b, invitees: { some: { memberId: a } } },
  ] };
}

/** The game behind an invite link and who sent it, for someone else holding the link. */
async function inviteFor(token: string, actor: string): Promise<{ gameId: string; creator: string; open: boolean }> {
  const row = await getPrisma().game.findUnique({ select: { createdBy: true, id: true, inviteExpiresAt: true, status: true },
    where: { inviteTokenHash: sha256Hex(token) } });
  if (!row) reject("INVITE_NOT_FOUND", "Invite not found.");
  if (!row.createdBy) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
  if (row.createdBy === actor) reject("NOT_A_PLAYER", "That's your own invite.");
  return { creator: row.createdBy, gameId: row.id, open: row.status === "invited" };
}

/** Why the two can't play, said to whoever asked: only the blocker hears it was a block. */
async function rejectBlockedPair(db: Pick<Prisma.TransactionClient, "gameBlock">, actor: string, other: string, message: string): Promise<void> {
  const blocks = await readGameBlocks(db, actor, [other]);
  if (blocks.blocked.has(other)) reject("PLAYER_UNAVAILABLE", "You blocked them. Unblock them in Settings to play.");
  if (blocks.blockedBy.has(other)) reject("PLAYER_UNAVAILABLE", message);
}

/** Resolves and authorizes a block through shared play or an invite link. */
async function block(context: CommandContext, command: { memberId?: string; token?: string }): Promise<null> {
  const { actor } = context;
  const prisma = getPrisma();
  const memberId = command.token === undefined ? command.memberId ?? "" : (await inviteFor(command.token, actor)).creator;
  if (memberId === actor) reject("INVALID_REQUEST", "You can't block yourself.");
  if (command.token === undefined && !await prisma.game.findFirst({ select: { id: true }, where: gamesBetween(actor, memberId) })) {
    reject("NOT_A_PLAYER", "You can only block someone you play with.");
  }
  await blockMember(context, memberId);
  return null;
}

/**
 * Blocks two members under their pair lock, so no join slips in. Open pair
 * games are called off with no winner or tickets, and every pair game leaves
 * its chat with nothing waiting to be sent. A group game keeps its room.
 * Views then show each to the other as a player who left.
 */
async function blockMember(context: CommandContext, memberId: string): Promise<void> {
  const { actor } = context;
  await commandTransaction(context, async (tx) => {
    await lockGamePair(tx, actor, memberId);
    const existing = await tx.gameBlock.findUnique({ select: { createdAt: true },
      where: { blockerMemberId_blockedMemberId: { blockedMemberId: memberId, blockerMemberId: actor } } });
    if (!existing && await tx.gameBlock.count({ where: { blockerMemberId: actor } }) >= GAME_BLOCK_LIMIT) {
      reject("INVALID_REQUEST", "You've blocked too many people.");
    }
    // Every open game ends, a batch at a time until none is left; past games
    // (however many) stay as they are, hidden by the block row, so no history
    // can stop a block.
    const ids: string[] = [];
    for (;;) {
      const batch = (await tx.game.findMany({ orderBy: { id: "asc" }, select: { id: true }, take: BLOCK_GAME_LIMIT,
        where: { maxPlayers: 2, AND: [gamesBetween(actor, memberId), { status: { in: ACTIVE_STATUSES } }] } })).map((game) => game.id);
      if (batch.length === 0) break;
      await tx.$queryRaw`SELECT id FROM game WHERE id = ANY(${batch}::text[]) ORDER BY id FOR UPDATE`;
      for (const game of await tx.game.findMany({ select: { id: true, status: true }, where: { id: { in: batch }, status: { in: ACTIVE_STATUSES } } })) {
        await endGame(tx, game.id, { status: "void" });
        await writeEvents(tx, game.id, actor, [{ payload: {}, type: game.status === "invited" ? "cancelled" : "blocked" }]);
      }
      ids.push(...batch);
    }
    // Pair games leave their chat; group games keep their room.
    const unbound = await tx.game.updateManyAndReturn({ data: { chatContainerMemberId: null }, select: { id: true },
      where: { maxPlayers: 2, AND: [gamesBetween(actor, memberId), { chatContainerMemberId: { not: null } }] } });
    await skipGameChatLifecycleTx(tx, [...new Set([...ids, ...unbound.map((game) => game.id)])], await databaseNow(tx));
    if (!existing) await tx.gameBlock.create({ data: { blockedMemberId: memberId, blockerMemberId: actor } });
  });
}

/** Changes no game: what a block called off stays called off. */
async function unblock(context: CommandContext, memberId: string): Promise<null> {
  await commandTransaction(context, async tx => {
    await tx.gameBlock.deleteMany({ where: { blockedMemberId: memberId, blockerMemberId: context.actor } });
  });
  return null;
}

type ReportCommand = Extract<GameCommand, { type: "report" }>;

interface ReportSubject {
  gameId: string;
  fromInvite: boolean;
  reportedMemberId: string;
  entry: GameEntry | null;
  snapshotText: string | null;
  snapshotMediaKeys: string[];
}

/**
 * What a report is about, read before the game lock: who it's about and a
 * snapshot of what they shared (the post's words and media, their name and
 * photo, or the task and stake words), so the review outlives the post.
 */
async function readReportSubject(actor: string, command: ReportCommand): Promise<ReportSubject> {
  const { gameId, invite, loaded } = await readReportedGame(actor, command);
  const entry = command.entryId === undefined ? null : loaded.entries.find((candidate) => candidate.id === command.entryId) ?? null;
  if (command.entryId !== undefined && (!entry || !visibleEntryIds(loaded.state, actor).has(entry.id))) {
    reject("INVALID_REQUEST", "You can only report a post you can see.");
  }
  if (loaded.row.maxPlayers === 10 && command.about === "player" && !command.reportedMemberId) reject("INVALID_REQUEST", "Choose the player to report.");
  const reported = entry?.memberId ?? (command.about === "terms" ? await latestTermsAuthor(loaded.row) : command.reportedMemberId
    ?? invite?.creator ?? loaded.state.players.find((player) => player.memberId !== actor)?.memberId);
  if (reported && !loaded.state.players.some(player => player.memberId === reported)) reject("NOT_A_PLAYER", "That player isn't in this game.");
  if (!reported || reported === actor) reject("NOT_A_PLAYER", "There's no one to report in this game.");
  return { entry, fromInvite: invite !== null, gameId, reportedMemberId: reported, ...await reportSnapshot(loaded, command.about, entry, reported) };
}

async function latestTermsAuthor(game: Pick<Game, "id" | "createdBy">): Promise<string | null> {
  const db = getPrisma();
  const applied = await db.gameEvent.findFirst({ where: { gameId: game.id, type: "change_applied" }, orderBy: { id: "desc" }, select: { payload: true } });
  const proposalId = isRecord(applied?.payload) ? applied.payload.proposalId : null;
  if (typeof proposalId !== "string") return game.createdBy;
  const proposed = await db.gameEvent.findUnique({ where: { commandKey: `game-change:${game.id}:${proposalId}` }, select: { actor: true } });
  return proposed?.actor ?? game.createdBy;
}

/** The game a report is in: one the actor plays, or the open invite they hold. */
async function readReportedGame(actor: string, command: ReportCommand) {
  const invite = command.token === undefined ? null : await inviteFor(command.token, actor);
  if (invite && !invite.open) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
  const gameId = invite?.gameId ?? command.gameId ?? "";
  const [loaded] = await loadGames(getPrisma(), [gameId]);
  if (!loaded || (!invite && (!playerFor(loaded.state, actor) || playerFor(loaded.state, actor)?.leftAt))) reject("NOT_A_PLAYER", "You're not in this game.");
  return { gameId, invite, loaded };
}

/** The reported words and media as they are now, opened from their owners' keys. */
async function reportSnapshot(loaded: LoadedGame, about: ReportCommand["about"], entry: GameEntry | null, reported: string): Promise<Pick<ReportSubject, "snapshotText" | "snapshotMediaKeys">> {
  if (entry) {
    const [text] = await openGameTexts([{ field: "text", memberId: entry.memberId, rowId: entry.id, table: "game_entry", value: entry.textEncrypted }]);
    return { snapshotMediaKeys: entry.mediaKeys, snapshotText: text || null };
  }
  if (about === "terms") {
    const [words] = await openGameTexts([{ ...gameTarget(loaded.row, "terms_words"), value: loaded.row.termsWordsEncrypted }]);
    const terms = termsView(loaded.state, parseTermWords(words ?? ""));
    const lines = [...terms.tasks.map((task) => `Task: ${task.text}`), ...terms.stakes.map((stake) => `${stake.kind === "dare" ? "Dare" : "Prize"}: ${stake.item}`)];
    return { snapshotMediaKeys: [], snapshotText: lines.join("\n") || null };
  }
  const profile = await getPrisma().gameProfile.findUnique({ select: { firstNameEncrypted: true, photoKey: true }, where: { memberId: reported } });
  const [name] = await openGameTexts(profile ? [{ field: "first_name", memberId: reported, rowId: reported, table: "game_profile", value: profile.firstNameEncrypted }] : []);
  return { snapshotMediaKeys: profile?.photoKey ? [profile.photoKey] : [], snapshotText: name || null };
}

/**
 * A report on the other player's post or reply, their name and photo, or the task and
 * stake they wrote; from inside a game (finished too) or from an invite before
 * accepting it. The row is the record, with a sealed snapshot; the views hide
 * a reported post, and a reported player's photo, from the reporter from then
 * on. Then a person is told. The same id, post or reply recovers the accepted
 * receipt before live visibility checks and retries its frozen alert, even
 * after blocking or deletion. The reported player is never told who.
 */
async function report(context: CommandContext, command: ReportCommand): Promise<string | null> {
  // Recover before requiring live content: reporting hides it, a block closes it, deletion may remove it.
  const row = await readReportReceipt(getPrisma(), context.actor, command)
    ?? await (command.about === "reply" ? acceptReplyReport : acceptContentReport)(context, command);
  // The stored subject, never one from the command. Deletion may have cleared it.
  if (command.block && row.reportedMemberId) await blockMember(context, row.reportedMemberId);
  if (await isReportAlertDue(row)) await sendGameReportAlert(row);
  // From an invite there's no game of theirs to show back.
  return command.token === undefined ? row.gameId : null;
}

async function acceptContentReport(context: CommandContext, command: ReportCommand): Promise<ReportReceipt> {
  const { actor } = context;
  const subject = await readReportSubject(actor, command);
  const target = (field: string): GameSealTarget => ({ field, memberId: actor, rowId: command.reportId, table: "game_report" });
  const [noteEncrypted, snapshotTextEncrypted] = await Promise.all([
    command.note ? seal(target("note"), command.note) : null,
    subject.snapshotText ? seal(target("snapshot"), subject.snapshotText) : null,
  ]);
  let stored: ReportReceipt | null = null;
  await runLocked(subject.gameId, context, async ({ clock, loaded, tx }) => {
    const prior = await readReportReceipt(tx, actor, command);
    if (prior) {
      stored = prior;
      return [];
    }
    // Under the lock: still theirs to see, still someone to report, still not blocked.
    const visible = subject.entry === null || visibleEntryIds(loaded.state, actor).has(subject.entry.id);
    const present = subject.fromInvite ? loaded.row.createdBy === subject.reportedMemberId && loaded.row.status === "invited"
      : Boolean(playerFor(loaded.state, actor)) && !playerFor(loaded.state, actor)?.leftAt && Boolean(playerFor(loaded.state, subject.reportedMemberId));
    if (!visible || !present) reject("INVALID_REQUEST", "This changed. Take another look.");
    if (await areGamePlayersBlocked(tx, actor, subject.reportedMemberId)) reject("NOT_A_PLAYER", "There's no one to report in this game.");
    stored = await tx.gameReport.create({ data: {
      about: command.about, createdAt: clock, entryId: subject.entry?.id ?? null, gameId: subject.gameId, id: command.reportId,
      noteEncrypted, reason: command.reason, reportedMemberId: subject.reportedMemberId, reporterMemberId: actor,
      snapshotMediaKeys: subject.snapshotMediaKeys, snapshotTextEncrypted,
      alertBlocked: command.block === true, alertEntryKind: subject.entry ? toEntryKind(subject.entry.kind) : null,
      alertFromInvite: subject.fromInvite, alertGameId: subject.gameId,
    }, select: reportReceiptSelect });
    return [];
  });
  if (!stored) throw new Error("Game report produced no row.");
  return stored;
}

const reportReceiptSelect = {
  id: true, gameId: true, reporterMemberId: true, reportedMemberId: true, entryId: true, replyId: true,
  about: true, reason: true, createdAt: true,
  alertBlocked: true, alertEntryKind: true, alertFromInvite: true, alertGameId: true,
} as const satisfies Prisma.GameReportSelect;
type ReportReceipt = Prisma.GameReportGetPayload<{ select: typeof reportReceiptSelect }>;

async function readReportReceipt(db: Db, actor: string, command: ReportCommand): Promise<ReportReceipt | null> {
  const sameId = await db.gameReport.findUnique({ where: { id: command.reportId }, select: reportReceiptSelect });
  const prior = sameId ?? (command.entryId ? await db.gameReport.findUnique({
    where: { reporterMemberId_entryId: { reporterMemberId: actor, entryId: command.entryId } }, select: reportReceiptSelect,
  }) : command.replyId ? await db.gameReport.findUnique({
    where: { reporterMemberId_replyId: { reporterMemberId: actor, replyId: command.replyId } }, select: reportReceiptSelect,
  }) : null);
  if (!prior) return null;
  const gameId = command.token === undefined ? command.gameId
    : (await db.game.findUnique({ where: { inviteTokenHash: sha256Hex(command.token) }, select: { id: true } }))?.id;
  if (!reportReceiptMatches(prior, actor, command, gameId)) reject("INVALID_REQUEST", "That report id is taken.");
  return prior;
}

/** Cleared foreign keys or an unresolvable token cannot contradict an accepted receipt. */
function reportReceiptMatches(prior: ReportReceipt, actor: string, command: ReportCommand, gameId: string | undefined): boolean {
  const acceptedGameId = prior.alertGameId ?? prior.gameId;
  return prior.reporterMemberId === actor && prior.about === command.about
    && (acceptedGameId === null || gameId === undefined || acceptedGameId === gameId)
    && (prior.entryId === null || prior.entryId === command.entryId)
    && (prior.replyId === null || prior.replyId === command.replyId)
    && (prior.alertFromInvite === null || prior.alertFromInvite === (command.token !== undefined))
    && (command.about !== "player" || prior.reportedMemberId === null || command.reportedMemberId === undefined
      || prior.reportedMemberId === command.reportedMemberId);
}

async function acceptReplyReport(context: CommandContext, command: ReportCommand): Promise<ReportReceipt> {
  const { actor } = context;
  const db = getPrisma();
  const { gameId, loaded } = await readReportedGame(actor, command);
  const reply = command.replyId ? await db.gameReply.findUnique({ where: { id: command.replyId },
    select: { ...replyMetadataSelect, audioEncrypted: true } }) : null;
  const access = await readReplyContext(db, loaded, actor);
  if (!reply || loaded.entries.find(entry => entry.id === reply.entryId)?.memberId !== actor || !replyReadAccess(actor, reply, access)) {
    reject("INVALID_REQUEST", "You can only report a reply on your post that you can see.");
  }
  const [text] = await openGameTexts([{ table: "game_reply", rowId: reply.id, field: "text", memberId: reply.authorMemberId, value: reply.textEncrypted }]);
  const audio = reply.audioEncrypted ? await openGameMedia({ envelope: reply.audioEncrypted, key: `game_reply:${reply.id}`, ownerMemberId: reply.authorMemberId }) : null;
  const target = { table: "game_report" as const, rowId: command.reportId, memberId: actor };
  const [noteEncrypted, snapshotTextEncrypted, snapshotAudioEncrypted] = await Promise.all([
    command.note ? seal({ ...target, field: "note" }, command.note) : null,
    text ? seal({ ...target, field: "snapshot" }, text) : null,
    audio ? sealGameMedia({ bytes: audio, key: `game_report:${command.reportId}`, ownerMemberId: actor }) : null,
  ]);
  let stored: ReportReceipt | null = null;
  await runLocked(gameId, context, async ({ tx, loaded, clock }) => {
    const prior = await readReportReceipt(tx, actor, command);
    if (prior) { stored = prior; return []; }
    const exists = await tx.gameReply.findUnique({ where: { id: reply.id }, select: { id: true } });
    if (!exists || !replyReadAccess(actor, reply, await readReplyContext(tx, loaded, actor))) reject("INVALID_REQUEST", "This changed. Take another look.");
    stored = await tx.gameReport.create({ data: {
      id: command.reportId, about: "reply", gameId, entryId: null, replyId: reply.id,
      reporterMemberId: actor, reportedMemberId: reply.authorMemberId, reason: command.reason, createdAt: clock,
      noteEncrypted, snapshotTextEncrypted, snapshotAudioEncrypted, snapshotMediaKeys: [],
      alertBlocked: command.block === true, alertEntryKind: null, alertFromInvite: false, alertGameId: gameId,
    }, select: reportReceiptSelect });
    return [];
  });
  if (!stored) throw new Error("Game reply report produced no row.");
  return stored;
}

/** Within the reporter's daily alert budget, counting reports up to this one. */
async function isReportAlertDue(row: Pick<GameReport, "createdAt" | "reporterMemberId">): Promise<boolean> {
  const day = new Date(Date.UTC(row.createdAt.getUTCFullYear(), row.createdAt.getUTCMonth(), row.createdAt.getUTCDate()));
  const ordinal = await getPrisma().gameReport.count({ where: { createdAt: { gte: day, lte: row.createdAt }, reporterMemberId: row.reporterMemberId } });
  return ordinal <= GAME_REPORT_ALERTS_PER_REPORTER_DAY;
}

/**
 * Ops review: take down a reported post. Its row stays as a withdrawn
 * tombstone with its words, summary, blur and media cleared, so it counts for
 * no one and nobody but its poster can read its upload again. Clear any recap
 * that may quote it in the same game-locked transaction; the settled result stays.
 */
export async function removeGamePostForReview(entryId: string): Promise<boolean> {
  const entry = await getPrisma().gameEntry.findUnique({ select: { gameId: true }, where: { id: entryId } });
  if (!entry) return false;
  let removed = false;
  // As the system: ops takes a post down whether or not its game is still on.
  await runLocked(entry.gameId, { actor: SYSTEM_ACTOR }, async ({ clock, tx, loaded }) => {
    await deleteEntryReplyTx(tx, entryId);
    const changed = await tx.gameEntry.updateMany({ where: { id: entryId, OR: [{ withdrawnReason: null }, { withdrawnReason: { not: "removed" } }] },
      data: { blurHash: null, mediaKeys: [], payloadEncrypted: null, textEncrypted: null, withdrawnAt: clock, withdrawnReason: "removed" } });
    removed = changed.count === 1;
    if (removed) {
      await clearGameRecapQuotingEntryTx(tx, entry.gameId, entryId);
      await settleGameRecapGenerationTx(tx, loaded.row, await readLatestGameRecapEventIdTx(tx, entry.gameId));
    }
    return removed ? [{ payload: { entryId }, type: "removed" }] : [];
  });
  return removed;
}

// ------------------------------------------------------------------- settle

/**
 * Ends one game if it's due, deciding with the game's clock under its lock:
 * an unclaimed invite expires; a decided pair or naturally ended live game
 * freezes its result and issues tickets. The sweep rechecks morning under lock.
 */
async function settleGame(gameId: string, actor = SYSTEM_ACTOR, morningClock?: Date): Promise<void> {
  await getPrisma().$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    if (!locked.length) return;
    const [loaded] = await loadGames(tx, [gameId]);
    const clock = morningClock ?? await databaseNow(tx);
    if (morningClock && (loaded.row.maxPlayers !== 2 || gameNow(clock, loaded.row) < morningAfterLastDay(loaded.state))) return;
    await settleLoaded({ loaded, tx, clock, now: gameNow(clock, loaded.row) }, actor);
  });
}

/** Reused by reads, join and leave, after the same game row lock. */
async function settleLoaded({ loaded: { row, state }, tx, clock, now }: LockedStep, actor: string): Promise<boolean> {
  if (!isGameDue(state, now)) return false;
  const gameId = row.id;
  if (state.game.status === "invited" || state.game.status === "negotiating") {
    await endGame(tx, gameId, { status: "void" });
    await writeEvents(tx, gameId, actor, [{ payload: {}, type: "expired" }]);
    return true;
  }
  if (state.game.status !== "live") return false;
  if (row.maxPlayers === 10 && remainingPlayers(state).length < 2) {
    await endGame(tx, gameId, { status: "void" });
    return true;
  }
  const decision = decideSettle(state);
  const tickets = decision.tickets.map(ticket => ({ ...ticket, gameId, id: generateHostedRandomPrefixedId("gtk"),
    ...(row.devClockOffsetMs === null ? {} : { createdAt: now }) }));
  await tx.gameTicket.createMany({ data: tickets });
  await endGame(tx, gameId, { result: toPrismaJsonObject(decision.result), settledAt: clock, status: "settled" });
  if (row.chatContainerMemberId) await reserveGameChatLifecycleTx({ gameId, kind: "recap", now: clock, tx });
  const scores = decision.result.scores.map(({ score, seat }) => ({ score, seat }));
  await writeEvents(tx, gameId, actor, [{ payload: { scores, ticketIds: tickets.map(ticket => ticket.id) }, type: "settled" }]);
  return true;
}

// --------------------------------------------------------------------- dev

function assertDevTools(): void {
  if (!areGameDevToolsAllowed()) throw new Error("Game dev tools are off in production.");
}

async function runDevStep(gameId: string, memberId: string, multiplayer: boolean, step: (locked: LockedStep) => Promise<GameEventDraft[]>): Promise<GameView> {
  assertDevTools();
  if (!multiplayer) await assertLegacyCommand({ type: "leave", gameId });
  await runLocked(gameId, { actor: memberId }, async (locked) => {
    if (!playerFor(locked.loaded.state, memberId)) reject("NOT_A_PLAYER", "You're not in this game.");
    return step(locked);
  });
  return requireView(gameId, memberId, multiplayer);
}

export async function devStartNow(gameId: string, memberId: string, multiplayer = false): Promise<GameView> {
  return runDevStep(gameId, memberId, multiplayer, async ({ loaded, now, tx }) => {
    if (loaded.row.maxPlayers === 10) reject("INVALID_REQUEST", "Use a group change request to start earlier.");
    await writeSchedule(tx, gameId, decideStartNow(loaded.state, now));
    await tx.game.update({ data: { startedAt: now }, where: { id: gameId } });
    return [{ payload: { startNow: true }, type: "started" }];
  });
}

/** Moves only this game's clock; Day 1, posts and the start time keep their real dates. */
async function shiftClock(tx: Tx, row: Game, addMs: number): Promise<GameEventDraft[]> {
  const offset = Number(row.devClockOffsetMs ?? BigInt(0)) + addMs;
  await tx.game.update({ data: { devClockOffsetMs: BigInt(offset) }, where: { id: row.id } });
  return [{ payload: { days: addMs / DAY_MS }, type: "time_shifted" }];
}

export async function devAdvanceDays(gameId: string, memberId: string, days: number, multiplayer = false): Promise<GameView> {
  return runDevStep(gameId, memberId, multiplayer, async ({ loaded, tx }) =>
    shiftClock(tx, loaded.row, decideDevAdvance(loaded.state, days).addMs));
}

/** Moves the game's clock to its settle time, then settles it the ordinary way. */
export async function devSettleNow(gameId: string, memberId: string, multiplayer = false): Promise<GameView> {
  assertDevTools();
  if (!multiplayer) await assertLegacyCommand({ type: "leave", gameId });
  await runLocked(gameId, { actor: memberId }, async ({ loaded, now, tx }) => {
    if (!playerFor(loaded.state, memberId)) reject("GAME_NOT_FOUND", "Game not found.");
    if (loaded.row.status !== "live") reject("GAME_NOT_LIVE", "This game isn't live.");
    const shift = settleDueAt(loaded.state).getTime() - now.getTime();
    return shift > 0 ? shiftClock(tx, loaded.row, shift) : [];
  });
  await settleGame(gameId, memberId);
  return requireView(gameId, memberId, multiplayer);
}

async function requireView(gameId: string, memberId: string, multiplayer = false): Promise<GameView> {
  const view = await readGame(gameId, memberId, multiplayer);
  if (!view) reject("GAME_NOT_FOUND", "Game not found.");
  return view;
}

function storedChangeWords(prepared: PreparedGameChangeWords, change: GameChange) {
  const stored = { ...prepared };
  delete stored.baseWordsEncrypted;
  const structural = { ...change };
  if (structural.kind === "edit") { delete structural.tasks; delete structural.defaultTask; delete structural.stakes; }
  return { ...stored, change: structural };
}
function assertPreparedWords(row: Game, prepared: PreparedGameChangeWords): void {
  if (prepared.baseWordsEncrypted !== undefined && row.termsWordsEncrypted !== prepared.baseWordsEncrypted) reject("TERMS_CHANGED", "The game changed. Take another look.");
}

/** Claiming a seat opens negotiation; it never accepts the original challenge. */
async function negotiate(context: CommandContext, command: Extract<GameCommand, { type: "negotiate" }>): Promise<string> {
  const prisma = getPrisma();
  const owner = await prisma.game.findUnique({ where: { inviteTokenHash: sha256Hex(command.token) } });
  if (!owner) reject("INVITE_NOT_FOUND", "Invite not found.");
  if (owner.maxPlayers === 10) return negotiateGroupNote(context, command, owner);
  if (!owner.createdBy) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
  const creator = owner.createdBy;
  if (creator === context.actor) reject("NOT_A_PLAYER", "Only the invited player can suggest changes here.");
  if (!await prisma.gameProfile.findUnique({ where: { memberId: context.actor }, select: { memberId: true } })) reject("PROFILE_REQUIRED", "Add your first name first.");
  const prepared = command.change === undefined ? null : await prepareGameChangeWords(owner, command.change, command.termsVersion);
  const noteEncrypted = command.note === undefined ? null : await seal({ table: "game", rowId: owner.id,
    field: `talk_note:${command.proposalId}`, memberId: context.actor }, command.note);
  await maintainPair(creator, context.actor);
  await runLocked(owner.id, withPairLock(context, creator), async ({ tx, loaded, now }) => {
      await rejectBlockedJoin(tx, creator, context.actor);
      const key = `game-change:${owner.id}:${command.proposalId}`;
      const prior = await tx.gameEvent.findUnique({ where: { commandKey: key }, select: { actor: true } });
      if (prior?.actor === context.actor && playerFor(loaded.state, context.actor)) return [];
      const joined = decideJoin(await withCurrentTimeZones(tx, loaded.state), { memberId: context.actor, termsVersion: command.termsVersion, timeZone: command.timeZone, now });
      if (joined.kind !== "join") reject("INVITE_USED", "This invite was already used.");
      await assertPairCapacity(tx, creator, context.actor, now, owner.id);
      if (noteEncrypted !== null) {
        await tx.gamePlayer.create({ data: { gameId: owner.id, memberId: context.actor, seat: joined.seat, timeZone: command.timeZone, joinedAt: now } });
        await tx.game.update({ where: { id: owner.id }, data: { status: "negotiating", pendingChange: Prisma.DbNull } });
        await acceptInvitation(tx, loaded.row, context.actor, joined.seat);
        return [
          { type: "negotiation_joined", payload: { seat: joined.seat } },
          { type: "talk_requested", commandKey: key, payload: { proposalId: command.proposalId, noteEncrypted } },
        ];
      }
      if (!prepared || !command.change) throw new Error("Game negotiation requires a note or change.");
      assertPreparedWords(loaded.row, prepared);
      const negotiation: RuleState = { ...loaded.state, game: { ...loaded.state.game, status: "negotiating" },
        players: [...loaded.state.players, { memberId: context.actor, seat: joined.seat, timeZone: command.timeZone, dayOne: null }] };
      const decision = decideGameChange(negotiation, context.actor, command.change, now);
      const pending = { v: prepared.termsWordsEncrypted ? 2 : 1, id: command.proposalId, proposedByMemberId: context.actor,
        expectedTermsVersion: command.termsVersion, origin: context.chatContainerMemberId ? "chat" : "app",
        deliveryStatus: context.chatContainerMemberId ? "conversation" : "pending", ...decision, ...storedChangeWords(prepared, decision.change) };
      await tx.gamePlayer.create({ data: { gameId: owner.id, memberId: context.actor, seat: joined.seat, timeZone: command.timeZone, joinedAt: now } });
      await tx.game.update({ where: { id: owner.id }, data: { status: "negotiating",
        pendingChange: toPrismaJsonObject(pending) } });
      await acceptInvitation(tx, loaded.row, context.actor, joined.seat);
      return [
        { type: "negotiation_joined", payload: { seat: joined.seat } },
        { type: "change_proposed", commandKey: key, payload: { proposalId: command.proposalId, expectedTermsVersion: command.termsVersion, effectiveFromDay: 0 } },
      ];
    });
  return owner.id;
}

/** One consenting invitee's note, with no join, calendar or terms side effects. */
async function negotiateGroupNote(context: CommandContext, command: Extract<GameCommand, { type: "negotiate" }>, owner: Game): Promise<string> {
  if (!areGameGroupsEnabled()) reject("GAME_DISABLED", "Group games aren't available yet.");
  if (command.note === undefined || command.change !== undefined) reject("INVALID_REQUEST", "Send a note to talk it over with the group.");
  const db = getPrisma();
  const key = `game-change:${owner.id}:${command.proposalId}`;
  const prior = await db.gameEvent.findUnique({ where: { commandKey: key }, select: { actor: true, type: true } });
  const [contacts, audience, noteEncrypted] = prior ? [[], undefined, null] as const : await Promise.all([
    readGameVerifiedContacts(context.actor),
    owner.chatContainerMemberId ? readGameChatAudience(owner.chatContainerMemberId) : undefined,
    seal({ table: "game", rowId: owner.id, field: `talk_note:${command.proposalId}`, memberId: context.actor }, command.note),
  ]);
  await runLocked(owner.id, { ...context, beforeMutationTx: async tx => {
    await context.beforeMutationTx?.(tx);
    await lockHostedMemberRow(tx, context.actor);
    if (await readHostedMemberSuspensionAfterLockTx(tx, context.actor) !== "active") reject("PLAYER_UNAVAILABLE", "This player isn't available.");
  } }, async ({ tx, loaded, now }) => {
    const existing = await tx.gameEvent.findUnique({ where: { commandKey: key }, select: { actor: true, type: true, payload: true } });
    if (existing) {
      const payload = parseGameTalkPayload(existing.payload);
      if (existing.actor !== context.actor || existing.type !== "talk_requested" || payload?.v !== 2 || payload.proposalId !== command.proposalId) reject("INVALID_REQUEST", "That request belongs to another action.");
      return [];
    }
    const keys = await verifiedGameContactKeys(tx, context.actor, contacts);
    const invitation = await readGroupTalkInvitation(tx, loaded.row, loaded.state, context.actor, keys, now);
    if (!invitation) reject("INVITE_USED", "Only an addressed invitee who hasn't joined can send a note.");
    if (currentTerms(loaded.state.game.terms).n !== command.termsVersion) reject("TERMS_CHANGED", "The game changed. Take another look.");
    const room = audience && loaded.row.chatContainerMemberId
      ? await readGroupGameChatAuthority(loaded.row, loaded.row.chatContainerMemberId, audience, tx) : null;
    if (!room || !room.memberIds.includes(context.actor) || !(await verifiedGameContactKeys(tx, context.actor, room.contacts)).length) reject("CHAT_UNAVAILABLE", "Join the game's group chat before sending a note.");
    const accepted = await tx.gameEvent.findMany({ where: { gameId: owner.id, type: "talk_requested" }, select: { actor: true, payload: true }, take: 10 });
    if (accepted.length >= 9 || accepted.some(event => {
      const payload = parseGameTalkPayload(event.payload);
      return event.actor === context.actor || payload?.v === 2 && payload.invitationSeat === invitation.seat;
    })) reject("INVITE_USED", "You've already sent a note for this invitation.");
    if (!noteEncrypted) reject("INVALID_REQUEST", "That request is no longer available.");
    return [{ type: "talk_requested", commandKey: key, payload: { v: 2, proposalId: command.proposalId,
      invitationSeat: invitation.seat, termsVersion: command.termsVersion, noteEncrypted } }];
  });
  return owner.id;
}

/** A proposal's identity is retained in the ordinary history after it is resolved. */
async function proposeChange(context: CommandContext, command: Extract<GameCommand, { type: "proposeChange" }>): Promise<string> {
  const owner = await getPrisma().game.findFirst({ where: { id: command.gameId, players: { some: { memberId: context.actor } } } });
  if (!owner) reject("NOT_A_PLAYER", "This game belongs to its players.");
  if (owner.maxPlayers === 10) {
    if (command.change.kind !== "start_now") reject("INVALID_REQUEST", "Use full terms to request a group edit.");
    const [before] = await loadGames(getPrisma(), [command.gameId]);
    return proposeGroupChange(context, command, before);
  }
  const prepared = await prepareGameChangeWords(owner, command.change, command.expectedTermsVersion);
  await runLocked(command.gameId, await withGamePairLock(context, command.gameId), locked => createChangeProposalTx(locked, context, command, prepared));
  return command.gameId;
}

/**
 * The other player's word-free proposal that this actor declined keeps its
 * proposer's agreement until the next change event or until approval would refuse it.
 * Proposing exactly that change in chat is the missing agreement, judged as an approval.
 */
async function agreeToDeclinedChange(locked: LockedStep, context: CommandContext, command: Extract<GameCommand, { type: "proposeChange" }>, key: string): Promise<GameEventDraft[] | null> {
  const { tx, loaded, now } = locked;
  if (!context.chatContainerMemberId || !context.beforeMutationTx) return null;
  const last = await tx.gameEvent.findFirst({ where: { gameId: command.gameId, type: { startsWith: "change_" } },
    orderBy: { id: "desc" }, select: { type: true, actor: true, payload: true } });
  if (last?.type !== "change_declined" || last.actor !== context.actor || !isRecord(last.payload) || !last.payload.declined) return null;
  const offer = parsePendingGameChange(last.payload.declined);
  if (!offer || offer.proposedByMemberId === context.actor || isGameChangeExpired(loaded.state, offer, now) || !isSameGameChange(offer.change, command.change)) return null;
  if (loaded.state.game.status === "negotiating") loaded.state = await withCurrentTimeZones(tx, loaded.state);
  const agreed = { ...offer, id: command.proposalId };
  const approved = decideApprovedGameChange(loaded.state, context.actor, agreed, now);
  return [
    { type: "change_proposed", commandKey: key, payload: { proposalId: agreed.id, expectedTermsVersion: agreed.expectedTermsVersion, effectiveFromDay: approved.effectiveFromDay, agreesWith: offer.id } },
    ...await applyApprovedChange(locked, command.gameId, agreed, `game-change-resolved:${command.gameId}:${agreed.id}`, context.actor, approved),
  ];
}

type ChangeResponse = { events: GameEventDraft[]; refusal?: string };
type RespondChangeCommand = Extract<GameCommand, { type: "respondChange" }>;

async function respondChange(context: CommandContext, command: RespondChangeCommand): Promise<string> {
  let refusal: string | undefined;
  await runLocked(command.gameId, await withGamePairLock(context, command.gameId), async locked => {
    const response = await respondToPendingChange(locked, context, command);
    refusal = response.refusal;
    return response.events;
  });
  if (refusal) reject("CHANGE_EXPIRED", refusal);
  return command.gameId;
}

async function replayGroupVote(tx: Tx, actor: string, command: RespondChangeCommand): Promise<boolean> {
  const prior = await tx.gameEvent.findUnique({ where: { commandKey: groupVoteKey(command, actor) }, select: { payload: true } });
  if (!prior || !isRecord(prior.payload)) return false;
  const vote = command.decision === "approve" ? "yes" : "no";
  if (prior.payload.vote !== vote) reject("INVALID_REQUEST", `You already said ${prior.payload.vote} to this change.`);
  return true;
}

function groupVoteKey(command: RespondChangeCommand, actor: string): string {
  return `game-change-vote:${command.gameId}:${command.proposalId}:${actor}`;
}

async function replayChangeResolution(tx: Tx, resolutionKey: string, context: CommandContext, command: RespondChangeCommand): Promise<boolean> {
  const prior = await tx.gameEvent.findUnique({ where: { commandKey: resolutionKey }, select: { type: true, actor: true } });
  const expectedType = command.decision === "approve" ? "change_applied" : command.decision === "decline" ? "change_declined" : "change_cancelled";
  return prior?.type === expectedType && prior.actor === context.actor;
}

async function respondToPendingChange(locked: LockedStep, context: CommandContext, command: RespondChangeCommand): Promise<ChangeResponse> {
  const { tx, loaded, clock } = locked;
  if (!remainingPlayers(loaded.state).some(player => player.memberId === context.actor)) reject("NOT_A_PLAYER", "This game belongs to its players.");
  const group = loaded.row.maxPlayers === 10;
  assertChangeResponseContext(context, command, group);
  if (group && command.decision !== "cancel" && await replayGroupVote(tx, context.actor, command)) return { events: [] };
  const proposal = parsePendingGameChange(loaded.row.pendingChange);
  const resolutionKey = `game-change-resolved:${command.gameId}:${command.proposalId}`;
  if (!proposal || proposal.id !== command.proposalId) {
    if (await replayChangeResolution(tx, resolutionKey, context, command)) return { events: [] };
    reject("CHANGE_EXPIRED", "That proposal is no longer waiting for agreement.");
  }
  const proposer = proposal.proposedByMemberId === context.actor;
  if (group && proposer && command.decision !== "cancel") reject("INVALID_REQUEST", "You already count as a yes.");
  if ((command.decision === "cancel") !== proposer) reject("NOT_A_PLAYER", proposer ? "The other player needs to agree." : "Only the proposer can cancel this change.");
  if (group) return respondToGroupChange(locked, context, command, proposal, resolutionKey);
  if (command.decision === "approve") return approvePendingChange(locked, context, proposal, resolutionKey);
  if (gameChangeCancellationNeedsNotice(proposal, command.decision, answeredInBoundChat(context, loaded))) {
    await reserveGameChatLifecycleTx({ gameId: command.gameId, kind: "change_cancelled", proposalId: proposal.id, now: clock, tx });
  }
  await tx.game.update({ where: { id: command.gameId }, data: { pendingChange: Prisma.DbNull } });
  return { events: [{ commandKey: resolutionKey, type: command.decision === "cancel" ? "change_cancelled" : "change_declined",
    payload: closedChangePayload(proposal, command.decision) }] };
}

function assertChangeResponseContext(context: CommandContext, command: RespondChangeCommand, group: boolean): void {
  const requiresChat = !group && command.decision !== "cancel" || Boolean(context.chatContainerMemberId);
  if (requiresChat && (!context.chatContainerMemberId || !context.beforeMutationTx)) reject("NOT_A_PLAYER", "Agree to this change in the game's shared chat.");
}

async function respondToGroupChange(locked: LockedStep, context: CommandContext, command: RespondChangeCommand, proposal: StoredGamePendingChange, resolutionKey: string): Promise<ChangeResponse> {
  if (command.decision === "cancel") {
    await resolveGroupGameChangeTx({ tx: locked.tx, game: locked.loaded.row, actor: context.actor, now: locked.clock, proposal,
      outcome: "change_cancelled", reason: "The proposer cancelled that request.", answeredInBoundChat: answeredInBoundChat(context, locked.loaded) });
    return { events: [] };
  }
  if (isGameChangeExpired(locked.loaded.state, proposal, locked.now)) return { events: [], refusal: await expireGroupChangeTx(locked, context, proposal) };
  return voteOnGroupChange(locked, context, command, proposal, resolutionKey);
}

async function voteOnGroupChange(locked: LockedStep, context: CommandContext, command: RespondChangeCommand, proposal: StoredGamePendingChange, resolutionKey: string): Promise<ChangeResponse> {
  const vote = command.decision === "approve" ? "yes" : "no";
  const votes: Record<string, "yes" | "no"> = { ...proposal.votes, [context.actor]: vote };
  const updated: StoredGamePendingChange = { ...proposal, votes };
  const tally = gameChangeMajority(locked.loaded.state, votes);
  const event: GameEventDraft = { type: "change_voted", commandKey: groupVoteKey(command, context.actor), payload: { proposalId: proposal.id, vote } };
  if (tally.approved) {
    const response = await approvePendingChange(locked, context, updated, resolutionKey);
    return { ...response, events: [event, ...response.events] };
  }
  if (tally.declined) await resolveGroupGameChangeTx({ tx: locked.tx, game: locked.loaded.row, actor: context.actor, now: locked.clock,
    proposal: updated, outcome: "change_declined", reason: "That request did not receive a majority.",
    tally: groupChangeTally(locked.loaded.state, updated), answeredInBoundChat: answeredInBoundChat(context, locked.loaded) });
  else await locked.tx.game.update({ where: { id: command.gameId }, data: { pendingChange: toPrismaJsonObject({ v: updated.termsWordsEncrypted ? 2 : 1, ...updated }) } });
  return { events: [event] };
}

function groupChangeTally(state: RuleState, proposal: StoredGamePendingChange) {
  const players = remainingPlayers(state);
  return { total: players.length, yes: players.filter(player => proposal.votes?.[player.memberId] === "yes").length,
    no: players.filter(player => proposal.votes?.[player.memberId] === "no").length };
}

/** Both pair agreement and a deciding group vote rejudge the same proposal under the lock. */
async function approvePendingChange(locked: LockedStep, context: CommandContext, proposal: StoredGamePendingChange, resolutionKey: string): Promise<ChangeResponse> {
  const { tx, loaded, now, clock } = locked;
  const gameId = loaded.row.id;
  let refusal: string | undefined;
  let decision: ReturnType<typeof decideGameChange> | undefined;
  const outdated = isGameChangeOutdated(loaded.state, proposal, now);
  if (outdated) refusal = "That proposal is no longer waiting for agreement.";
  else {
    if (loaded.row.maxPlayers === 2 && loaded.state.game.status === "negotiating") loaded.state = await withCurrentTimeZones(tx, loaded.state);
    try { decision = decideApprovedGameChange(loaded.state, context.actor, proposal, now); }
    catch (error) {
      if (!(error instanceof GameRuleError)) throw error;
      refusal = error.message;
    }
  }
  if (decision) return { events: await applyApprovedChange(locked, gameId, proposal, resolutionKey, context.actor, decision, answeredInBoundChat(context, loaded)) };
  if (loaded.row.maxPlayers === 10) return { events: [], refusal: await expireGroupChangeTx(locked, context, proposal) };
  if (!outdated && needsChatLifecycleNotice(context, loaded)) await reserveGameChatLifecycleTx({ gameId, kind: "change_expired", proposalId: proposal.id, now: clock, tx });
  await tx.game.update({ where: { id: gameId }, data: { pendingChange: Prisma.DbNull } });
  return { refusal, events: [{ commandKey: resolutionKey, type: "change_expired", payload: { proposalId: proposal.id, ...(outdated ? {} : { reason: refusal }) } }] };
}

/** A word-free declined proposal is kept so the decliner can still take it (agreeToDeclinedChange). */
function closedChangePayload(proposal: StoredGamePendingChange, decision: "decline" | "cancel"): Prisma.InputJsonObject {
  return decision === "decline" && !proposal.termsWordsEncrypted
    ? { proposalId: proposal.id, declined: toPrismaJsonObject({ v: 1, ...proposal }) } : { proposalId: proposal.id };
}

async function applyApprovedChange(locked: LockedStep, gameId: string, proposal: StoredGamePendingChange, resolutionKey: string, actor: string, decision: ReturnType<typeof decideGameChange>, answered = false): Promise<GameEventDraft[]> {
  const { tx, loaded, now, clock } = locked;
  const { startsOn, next, terms, lengthDays } = await applyChangeTermsTx(locked, gameId, proposal, decision);
  if (loaded.state.game.seats === 2 && loaded.state.game.status === "negotiating") {
    const other = loaded.state.players.find((player) => player.memberId !== actor);
    if (!other) reject("NOT_A_PLAYER", "This game needs both players.");
    await assertPairCapacity(tx, actor, other.memberId, now, gameId);
    const agreedState: RuleState = { ...loaded.state, game: { ...loaded.state.game, terms, lengthDays: lengthDays ?? loaded.state.game.lengthDays,
      ...(proposal.change.kind === "edit" && proposal.change.startsOn === null ? { startsOn: null } : {}) } };
    const schedule = decideNegotiationStart(agreedState, now, proposal.startsOn);
    await writeSchedule(tx, gameId, schedule);
    await tx.game.update({ where: { id: gameId }, data: { status: "live", startedAt: clock } });
    return [
      { commandKey: resolutionKey, type: "change_applied", payload: { proposalId: proposal.id, termsVersion: next.n, effectiveFromDay: 0 } },
      { type: "started", payload: { startNow: proposal.change.kind === "start_now" } },
    ];
  }
  const dayOne = agreedDayOne(loaded.state, proposal, next.fromDay, next.schedule, startsOn);
  if (dayOne) await tx.gamePlayer.updateMany({ where: { gameId, ...(loaded.row.maxPlayers === 10 ? { leftAt: null } : {}) }, data: { dayOne: toDbDate(dayOne) } });
  if (loaded.row.maxPlayers === 10) {
    await resolveGroupGameChangeTx({ tx, game: loaded.row, actor, now: clock, proposal, outcome: "change_applied",
      reason: "A majority approved that request.", tally: groupChangeTally(loaded.state, proposal), termsVersion: next.n,
      effectiveFromDay: next.fromDay, answeredInBoundChat: answered });
    return [];
  }
  return [{ commandKey: resolutionKey, type: "change_applied", payload: { proposalId: proposal.id, termsVersion: next.n, effectiveFromDay: next.fromDay } }];
}

/** Persist the approved terms version before applying its calendar or terminal outcome. */
async function applyChangeTermsTx({ tx, loaded }: LockedStep, gameId: string, proposal: StoredGamePendingChange, decision: ReturnType<typeof decideGameChange>) {
  // The locked acceptance decision owns the boundary; old days retain their terms.
  const startsOn = proposal.change.kind === "edit" && proposal.change.startsOn === null ? decision.startsOn : proposal.startsOn;
  const previous = currentTerms(loaded.state.game.terms);
  const next = { ...previous, n: previous.n + 1, fromDay: decision.effectiveFromDay,
    ...(proposal.change.kind === "edit" && proposal.change.schedule ? { schedule: proposal.change.schedule } : {}),
    ...(proposal.stakes ? { stakes: proposal.stakes } : {}) };
  const terms = { v: 1 as const, versions: [...loaded.state.game.terms.versions.filter((version) => version.fromDay < next.fromDay), next] };
  const lengthDays = proposal.change.kind === "edit" ? proposal.change.lengthDays : undefined;
  await tx.game.update({ where: { id: gameId }, data: {
    pendingChange: Prisma.DbNull, terms: toPrismaJsonObject(terms),
    ...(proposal.termsWordsEncrypted ? { termsWordsEncrypted: proposal.termsWordsEncrypted } : {}),
    ...(lengthDays === undefined ? {} : { lengthDays }),
    ...(startsOn ? { startsOn: toDbDate(startsOn) } : proposal.change.kind === "edit" && proposal.change.startsOn === null ? { startsOn: null } : {}),
  } });
  return { startsOn, next, terms, lengthDays };
}

export type GameChatState = HostedGameChatState;

/** Shared, word-minimized context for the existing-room rematch notice. */
export async function readGameRematchNotice(gameId: string, playerMemberIds: readonly string[], now = new Date()) {
  const prisma = getPrisma();
  const current = await prisma.game.findUnique({ where: { id: gameId }, select: { previousGameId: true, maxPlayers: true } });
  if (current?.maxPlayers === 10) return readGroupRematchNotice(gameId, current.previousGameId, now);
  return readPairGameRematchNotice(gameId, current?.previousGameId ?? null, playerMemberIds, now);
}

async function readPairGameRematchNotice(gameId: string, previousGameId: string | null, playerMemberIds: readonly string[], now: Date) {
  if (!sameGamePlayers(playerMemberIds, playerMemberIds) || !previousGameId) return null;
  const prisma = getPrisma();
  const loaded = await loadGames(prisma, [gameId, previousGameId]);
  const rematch = loaded[0];
  const previous = loaded[1];
  if (!rematch || !previous || rematch.row.status !== "invited" || isGameInviteExpired(rematch.state.game, now) || previous.row.status !== "settled"
    || !rematch.row.createdBy
    || !sameGamePlayers(gameChatPlayerIds(rematch.row), playerMemberIds)
    || !sameGamePlayers(previous.row.players.map((player) => player.memberId), playerMemberIds)) return null;
  const requesterId = rematch.row.createdBy;
  const inviteeId = playerMemberIds.find(memberId => memberId !== requesterId)!;
  const profiles = await prisma.gameProfile.findMany({
    where: { memberId: { in: [requesterId, inviteeId] } }, select: { memberId: true, firstNameEncrypted: true },
  });
  const sealedNames = new Map(profiles.map((profile) => [profile.memberId, profile.firstNameEncrypted]));
  // A missing profile opens as null, so either absent name withholds the notice.
  const plain = await openGameTexts([
    { ...gameTarget(previous.row, "terms_words"), value: previous.row.termsWordsEncrypted },
    { ...gameTarget(rematch.row, "terms_words"), value: rematch.row.termsWordsEncrypted },
    ...[requesterId, inviteeId].map((memberId) => ({ field: "first_name", table: "game_profile" as const, rowId: memberId, memberId, value: sealedNames.get(memberId) })),
  ]);
  if (!plain[0] || !plain[1] || !plain[2] || !plain[3]) return null;
  const rules = (game: LoadedGame, wordsJson: string, membersBySeat: ReadonlyMap<number, string>) => {
    const terms = termsView(game.state, parseTermWords(wordsJson));
    const tasks = terms.tasks.map((task) => ({ memberId: membersBySeat.get(task.seat), text: task.text }));
    if (tasks.some((task) => !task.memberId)) return null;
    return {
      checkInKind: terms.checkInKind ?? "photo",
      lengthDays: game.row.lengthDays,
      schedule: terms.schedule,
      stakes: terms.stakes.map((stake) => ({ item: stake.item, kind: stake.kind })),
      tasksByMember: Object.fromEntries(tasks.map((task) => [task.memberId!, task.text]).sort(([a], [b]) => a.localeCompare(b))),
    };
  };
  const previousRules = rules(previous, plain[0], new Map(previous.row.players.filter(hasGameIdentity).map((player) => [player.seat, player.memberId])));
  const rematchRules = rules(rematch, plain[1], new Map([[0, requesterId], [1, inviteeId]]));
  if (!previousRules || !rematchRules) return null;
  return {
    players: [{ memberId: requesterId, name: plain[2], requester: true }, { memberId: inviteeId, name: plain[3], requester: false }],
    previous: previousRules,
    rematch: rematchRules,
    startsOn: fromDbDate(rematch.row.startsOn),
  };
}

async function readGroupRematchNotice(gameId: string, previousGameId: string | null, now: Date) {
  const games = await getPrisma().game.findMany({ where: { id: { in: previousGameId ? [gameId, previousGameId] : [gameId] } },
    include: { invitees: true, players: { take: 11 } } });
  const rematch = games.find(game => game.id === gameId);
  const previous = games.find(game => game.id === previousGameId);
  if (!rematch || rematch.status !== "invited" || !rematch.chatContainerMemberId || !rematch.createdBy
    || isGameInviteExpired(rematch, now)
    || previousGameId && (!previous || previous.status !== "settled" || previous.maxPlayers !== 10)) return null;
  const terms = parseStoredTerms(rematch.terms);
  const audience = await readGroupGameChatAuthority(rematch, rematch.chatContainerMemberId);
  if (!audience) return null;
  const shared = (await readGameChatState(rematch.chatContainerMemberId, audience.memberIds, undefined, true, audience)).games.find(game => game.id === gameId);
  const requester = shared?.players.find(player => player.memberId === rematch.createdBy);
  if (!shared || !requester || shared.terms.n !== currentTerms(terms).n) return null;
  const comparison = await prepareGroupRematchComparison(rematch, previous);
  if (comparison === undefined) return null;
  return { maxPlayers: 10 as const, termsVersion: currentTerms(terms).n, requester: requester.firstName,
    startsOn: fromDbDate(rematch.startsOn), comparison,
    terms: { defaultTask: shared.terms.defaultTask, tasks: shared.terms.tasks, stakes: shared.terms.stakes.map(({ kind, item }) => ({ kind, item })),
      schedule: shared.terms.schedule, checkInKind: shared.terms.checkInKind ?? "any", lengthDays: shared.lengthDays } };
}

async function prepareGroupRematchComparison(
  rematch: Prisma.GameGetPayload<{ include: { invitees: true } }>,
  previous: Prisma.GameGetPayload<{ include: { invitees: true } }> | undefined,
) {
  const rows = previous ? [rematch, previous] : [rematch];
  const plain = await openGameTexts(rows.map(row => ({ ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted })));
  const rules = { terms: parseStoredTerms(rematch.terms), words: parseTermWords(plain[0] ?? ""), lengthDays: rematch.lengthDays };
  const starterSeat = previous?.createdBy === rematch.createdBy ? 0
    : previous?.invitees.find(invitee => invitee.memberId === rematch.createdBy)?.seat;
  if (previous && starterSeat === undefined) return undefined;
  return previous ? compareGroupRematch({ terms: parseStoredTerms(previous.terms), words: parseTermWords(plain[1] ?? ""), lengthDays: previous.lengthDays },
    rules, starterSeat!, [0, ...rematch.invitees.map(invitee => invitee.seat)]) : null;
}

/** Which game a room notice means when other open games could confuse it. */
export async function readGameNoticeRoom(gameId: string, playerMemberIds: readonly string[], containerMemberId = ""): Promise<GameNoticeRoom | undefined> {
  const { games } = await readGameChatState(containerMemberId, playerMemberIds);
  const shared = games.find((game) => game.id === gameId);
  // A historical group outcome still names its game after settlement or voiding.
  if (!shared && containerMemberId) {
    const [loaded] = await loadGames(getPrisma(), [gameId]);
    if (loaded?.row.maxPlayers === 10 && await readGroupGameChatAuthority(loaded.row, containerMemberId)) {
      const [plain] = await openGameTexts([{ ...gameTarget(loaded.row, "terms_words"), value: loaded.row.termsWordsEncrypted }]);
      const words = parseTermWords(plain ?? "");
      const terms = termsView(loaded.state, words, true);
      const tasks = terms.defaultTask ? [terms.defaultTask] : [];
      const others = games.filter(game => game.id !== gameId && ["live", "negotiating"].includes(game.status));
      return others.length ? { tasks, otherGames: others.map(game => ({ status: game.status, tasks: game.terms.tasks.map(task => task.text) })), startedAfterAnother: false } : undefined;
    }
  }
  const others = games.filter((game) => game.id !== gameId && (game.status === "live" || game.status === "negotiating"));
  if (!shared || others.length === 0) return undefined;
  // Games that went live together each still introduce themselves; only a later start follows an earlier kickoff.
  const live = others.filter((game) => game.status === "live").map((game) => game.id);
  const starts = live.length > 0 ? await getPrisma().game.findMany({ where: { id: { in: [gameId, ...live] } }, select: { id: true, startedAt: true } }) : [];
  const ownStart = starts.find((row) => row.id === gameId)?.startedAt ?? null;
  return {
    tasks: shared.terms.tasks.map((task) => task.text),
    otherGames: others.map((game) => ({ status: game.status, tasks: game.terms.tasks.map((task) => task.text) })),
    startedAfterAnother: starts.some((row) => row.id !== gameId && row.startedAt !== null && (ownStart === null || row.startedAt < ownStart)),
  };
}

/** Shared-chat projection intentionally never calls the viewer-private app view. */
export async function readGameChatState(containerMemberId: string, playerMemberIds: readonly string[], actorMemberId?: string, multiplayer = true, prepared?: GameChatAudience): Promise<GameChatState> {
  if ((!multiplayer || !containerMemberId) && !sameGamePlayers(playerMemberIds, playerMemberIds)) return { games: [] };
  const prisma = getPrisma();
  // A block ends the pair's game chat: Murph has no game to talk about there.
  if (await hasGameChatBlock(prisma, playerMemberIds)) return { games: [] };
  const candidateIds = await readGameChatCandidateIds(playerMemberIds, multiplayer, containerMemberId);
  const candidates = await prisma.game.findMany({ where: { id: { in: candidateIds } },
    orderBy: { createdAt: "desc" }, include: { invitees: true, players: true } });
  const audience = prepared ?? (candidates.some(row => row.maxPlayers === 10) ? await readGameChatAudience(containerMemberId) : undefined);
  const context = { chatContainerMemberId: containerMemberId, chatPlayerMemberIds: playerMemberIds, chatAudience: audience };
  const allowed = await Promise.all(candidates.map(async row => isGameOn(row) && await gameChatContextCurrent(row, context) ? row.id : null));
  const current = await loadCurrent(allowed.filter((id): id is string => id !== null), true, actorMemberId, actorMemberId ? containerMemberId : undefined);
  const loadedById = new Map(current.games.map((game) => [game.row.id, game]));
  const rows = [];
  for (const { row } of current.games) if (isGameOn(row) && await gameChatContextCurrent(row, context)) rows.push(row);
  const profiles = await prisma.gameProfile.findMany({ where: { memberId: { in: [...new Set(rows.flatMap(row => row.maxPlayers === 10 ? row.players.filter(player => !player.leftAt).filter(hasGameIdentity).map(player => player.memberId) : gameChatPlayerIds(row)))] } },
    select: { memberId: true, firstNameEncrypted: true } });
  const plain = await openGameTexts([
    ...rows.map((row) => ({ ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted })),
    ...profiles.map((profile) => ({ field: "first_name", table: "game_profile" as const, rowId: profile.memberId, memberId: profile.memberId, value: profile.firstNameEncrypted })),
  ]);
  const nameProfiles = profiles.map((profile, index) => ({ memberId: profile.memberId, firstName: plain[rows.length + index] ?? "" }));
  const names = gameChatNames(nameProfiles);
  const [pendingViews, tickets, actorProfile] = await Promise.all([
    readPendingChangeViews(rows),
    prisma.gameTicket.findMany({ where: { gameId: { in: rows.filter((row) => row.status === "settled").map((row) => row.id) } }, take: CHAT_TICKET_LIMIT + 1, orderBy: { id: "asc" } }),
    actorMemberId ? prisma.gameProfile.findUnique({ where: { memberId: actorMemberId }, select: { chatPhotoIntroducedAt: true, chatPhotoOffer: true } }) : null,
  ]);
  const clock = current.clock;
  if (tickets.length > CHAT_TICKET_LIMIT) throw new Error("Game ticket projection exceeds its rule bound.");
  return { ...gameChatPhotoCheckIn(actorProfile, containerMemberId, clock), games: rows.map((row, index) => {
    const state = loadedById.get(row.id)!.state;
    const players = row.players.filter(player => row.maxPlayers !== 10 || !player.leftAt).filter(hasGameIdentity);
    const gameNames = row.maxPlayers === 10 ? gameChatNames(nameProfiles.filter(profile => players.some(player => player.memberId === profile.memberId))) : names;
    const words = parseTermWords(plain[index] ?? "");
    const result = row.result === null ? null : parseStoredResult(row.result);
    const ticketGroups = new Map<string, { owedByMemberId: string; owedToMemberId: string; owedBySeats?: number[]; owedToSeats?: number[]; what: string; status: "open" | "redeemed" | "expired"; count: number }>();
    for (const ticket of tickets.filter((ticket) => ticket.gameId === row.id)) {
      const view = ticketView(toTicketRow(ticket, row.players), words, "", gameNow(clock, row));
      const key = JSON.stringify([view.owedByMemberId, view.owedToMemberId, view.what, view.status]);
      const existing = ticketGroups.get(key);
      if (existing) existing.count += 1;
      else ticketGroups.set(key, { ...(row.maxPlayers === 10 ? { owedBySeats: ticket.owedBySeats, owedToSeats: ticket.owedToSeats } : {}), owedByMemberId: view.owedByMemberId, owedToMemberId: view.owedToMemberId, what: view.what, status: view.status, count: 1 });
    }
    const pendingChange = pendingGameChangeView(state, pendingViews.get(row.id) ?? null, gameNow(clock, row));
    const { checkInKind, ...terms } = termsView(state, words, row.maxPlayers === 10);
    // Chat exposes unjoined invitees only as a count, never their task overrides.
    if (row.maxPlayers === 10) terms.tasks = terms.tasks.filter(task => row.players.some(player => player.seat === task.seat && !player.leftAt));
    return { ...(row.maxPlayers === 10 ? { maxPlayers: 10 as const, pendingInviteeCount: row.invitees.filter(invitee => !row.players.some(player => player.seat === invitee.seat)).length } : {}), id: row.id, status: state.game.status, terms: { ...terms, ...(checkInKind === "any" ? {} : { checkInKind }) },
      progress: gameChatProgress(state, gameNow(clock, row)),
      result: result ? { scores: result.scores.filter(score => row.maxPlayers !== 10 || players.some(player => player.memberId === score.memberId)), tickets: [...ticketGroups.values()] } : null,
      startsOn: gameDayOne(calendarPlayers(state)) ?? fromDbDate(row.startsOn), lengthDays: row.lengthDays,
      players: players.map((player) => ({ memberId: player.memberId, seat: player.seat, firstName: gameNames.get(player.memberId) ?? "", dayOne: fromDbDate(player.dayOne), timeZone: player.timeZone })),
      pendingChange, changeControls: row.maxPlayers === 10 && row.status === "invited"
        ? { canStartNow: false, canEdit: actorMemberId === row.createdBy && areGroupTermsOpen(state, gameNow(clock, row)), canEditSchedule: false, canEditStartDate: false, editableFromDay: null }
        : gameChangeControls(state, gameNow(clock, row), pendingChange, actorMemberId),
    };
  }) };
}

function gameChatPhotoCheckIn(profile: Pick<GameProfile, "chatPhotoIntroducedAt" | "chatPhotoOffer"> | null, containerMemberId: string, clock: Date) {
  if (!profile) return {};
  const offer = isRecord(profile.chatPhotoOffer) ? profile.chatPhotoOffer : null;
  const hasPendingOffer = offer?.containerMemberId === containerMemberId && offer.resolutionMessageRef === null
    && typeof offer.expiresAt === "string" && Date.parse(offer.expiresAt) > clock.getTime();
  return { photoCheckIn: { introductionAvailable: profile.chatPhotoIntroducedAt === null, hasPendingOffer } };
}

/** Room-keyset paging completes each room before any claim, across discovery pages. */
export async function reserveDueGameMissedDayCheckIns(now = new Date()): Promise<number> {
  const prisma = getPrisma();
  const shard = Math.floor(now.getTime() / 60_000) % 60;
  let reserved = 0;
  await visitGameMissedCheckInPages({
    readPage: async (cursor, limit) => (await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT chat_container_member_id AS id FROM game
      WHERE status = 'live' AND chat_container_member_id IS NOT NULL
        AND mod(abs(hashtext(chat_container_member_id)::bigint), 60) = ${shard}
        AND chat_container_member_id > ${cursor}
      ORDER BY id LIMIT ${limit}`).map(row => row.id),
    visit: async rooms => {
      const { reserveGroupGameMissedDay } = await import("./group-missed-day");
      for (const roomId of rooms) {
        const rows = await prisma.game.findMany({ where: { chatContainerMemberId: roomId, status: "live" }, select: { id: true, maxPlayers: true }, take: 21 });
        if (rows.length > 20) continue;
        const candidates = await loadGames(prisma, rows.map(row => row.id));
        for (const game of candidates) {
          if (game.row.maxPlayers === 2 && isGameDue(game.state, gameNow(now, game.row))
            && gameNow(now, game.row) >= morningAfterLastDay(game.state)) {
            await settleGame(game.row.id, SYSTEM_ACTOR, now);
          }
        }
        const remaining = (await loadGames(prisma, rows.map(row => row.id))).filter(game => game.row.status === "live"
          && !(game.row.maxPlayers === 2 && isGameDue(game.state, gameNow(now, game.row))));
        if (remaining.some(game => game.row.maxPlayers === 10)) {
          reserved += await reserveGroupGameMissedDay(roomId, remaining.map(game => game.row.id), now);
          continue;
        }
        for (const game of remaining) {
          for (const run of gameMissedCheckInRuns(game.state, now)) {
            if (!run.dueAt || !isMissedCheckInDueNow({ dueAt: run.dueAt, now })) continue;
            if (await prisma.$transaction(tx => reserveGameMissedDayTx({
              gameId: game.row.id, memberId: run.memberId, playerMemberIds: game.state.players.map(player => player.memberId),
              firstMissedDate: run.firstMissedDate, dueAt: run.dueAt!, now, tx,
            }))) reserved += 1;
          }
        }
      }
    },
  });
  return reserved;
}

/** The bounded structural loader is also used under the final game mutation locks. */
export async function loadGameMissedCheckInGames(db: Db, gameIds: readonly string[]) {
  if (gameIds.length > 20 || new Set(gameIds).size !== gameIds.length) throw new Error("Game missed-day batch exceeds its room bound.");
  if (gameIds.length === 0) return [];
  const entryBound = gameIds.length * 10 * 365 * 2;
  const [rows, entries] = await Promise.all([
    db.game.findMany({ where: { id: { in: [...gameIds] } }, include: { invitees: true, players: true } }),
    db.gameEntry.findMany({ where: { gameId: { in: [...gameIds] }, attempt: { gt: 0 }, withdrawnAt: null },
      orderBy: { receivedAt: "asc" }, take: entryBound + 1,
      select: { id: true, gameId: true, memberId: true, dayIndex: true, attempt: true, kind: true, incomplete: true,
        receivedAt: true, withdrawnAt: true, mediaKeys: true, blurHash: true } }),
  ]);
  if (entries.length > entryBound) throw new Error("Game missed-day entries exceed their rule bound.");
  return rows.map(row => ({ row, state: toRuleState(row, entries.filter(entry => entry.gameId === row.id)) }));
}

/** Canonical evidence for both single-game and multi-game pair notices. */
export async function readGameMissedCheckInBatch(gameIds: string[], firstMissedDate: string, now = new Date()) {
  const games = await loadGameMissedCheckInGames(getPrisma(), gameIds);
  return games.flatMap(game => gameMissedCheckInRuns(game.state, now)
    .filter(run => run.firstMissedDate === firstMissedDate)
    .map(run => ({ gameId: game.row.id, memberId: run.memberId, missedDates: run.missedDates })));
}

/** Only remaining players' task words and public profile names enter the room. */
export async function readGameMissedCheckInWords(games: Awaited<ReturnType<typeof loadGameMissedCheckInGames>>, firstMissedDate: string) {
  const memberIds = [...new Set(games.flatMap(game => remainingPlayers(game.state).map(player => player.memberId)))];
  const profiles = await getPrisma().gameProfile.findMany({ where: { memberId: { in: memberIds } }, select: { memberId: true, firstNameEncrypted: true } });
  const plain = await openGameTexts([
    ...games.map(({ row }) => ({ ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted })),
    ...profiles.map(profile => ({ field: "first_name", table: "game_profile" as const, rowId: profile.memberId, memberId: profile.memberId, value: profile.firstNameEncrypted })),
  ]);
  const names = gameChatNames(profiles.map((profile, index) => ({ memberId: profile.memberId, firstName: plain[games.length + index] ?? "" })));
  const tasks = new Map(games.map((game, index) => {
    const words = parseTermWords(plain[index] ?? "");
    return [game.row.id, new Map(remainingPlayers(game.state).map(player => {
      const version = termsForDay(game.state.game.terms, daysBetween(player.dayOne!, firstMissedDate));
      const versionWords = [...words.versions].reverse().find(words => words.n <= version.n);
      return [player.memberId, versionWords?.tasks.find(task => task.seat === player.seat)?.text ?? versionWords?.defaultTask ?? ""];
    }))];
  }));
  return { names, tasks };
}

export type GameRecapMaterial = {
  game: Record<string, unknown>;
  players: string[];
  entries: Array<{ entryId: string; kind: string; playerName: string; text: string | null; visibleToBoth: boolean }>;
  validation: {
    group?: boolean;
    startedAt: Date;
    settledAt: Date | null;
    playerNamesByMemberId: Array<{ memberId: string; name: string }>;
    result: Array<{ memberId: string; name: string; score: number }>;
  };
};

/** Finished shared projection for the bound recap turn; omit eventId only before publication, when nothing has been exposed. */
export async function readGameRecapMaterial(gameId: string, containerMemberId: string, expectedPlayers: readonly string[], eventId?: string): Promise<GameRecapMaterial | null> {
  const prisma = getPrisma();
  const row = await prisma.game.findFirst({ where: { id: gameId, chatContainerMemberId: containerMemberId, status: "settled", OR: [{ maxPlayers: 10 }, { maxPlayers: 2, players: { none: { leftAt: { not: null } } } }] }, include: { invitees: true, players: { orderBy: { seat: "asc" } }, tickets: true } });
  if (!row || !row.result) return null;
  const recapPlayers = row.maxPlayers === 10 ? groupGameRecapPlayers(row) : row.players;
  if (!recapPlayers || !recapPlayers.every(hasGameIdentity) || row.maxPlayers !== 10 && !sameGamePlayers(recapPlayers.map(player => player.memberId), expectedPlayers)) return null;
  const memberIds = recapPlayers.map(player => player.memberId);
  if (await hasGameChatBlock(prisma, expectedPlayers)) return null;
  if (row.maxPlayers === 10 && !await readGroupGameChatAuthority(row, containerMemberId)) return null;
  const rowEntries = await prisma.gameEntry.findMany({ where: { gameId, ...(row.maxPlayers === 10 ? { memberId: { in: memberIds } } : {}) }, orderBy: { receivedAt: "asc" } });
  const allowed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    return eventId ? settleGameRecapGenerationTx(tx, row, eventId) : readPermittedGameRecapEntryIds(tx, row);
  });
  if (!allowed) return null;
  const shownEntries = rowEntries.filter(entry => allowed.has(entry.id));
  const profiles = await prisma.gameProfile.findMany({ where: { memberId: { in: memberIds } }, select: { memberId: true, firstNameEncrypted: true } });
  const plain = await openGameTexts([
    { ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted },
    ...profiles.map((profile) => ({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile" as const, value: profile.firstNameEncrypted })),
    ...shownEntries.flatMap((entry) => {
      const target = { memberId: entry.memberId, rowId: entry.id, table: "game_entry" as const };
      return [{ ...target, field: "text", value: entry.textEncrypted }, { ...target, field: "payload", value: entry.payloadEncrypted }];
    }),
  ]);
  const words = parseTermWords(plain[0] ?? "");
  const names = gameChatNames(profiles.map((profile, index) => ({ memberId: profile.memberId, firstName: plain[index + 1] ?? "" })));
  const entryOffset = 1 + profiles.length;
  const entries = shownEntries.map((entry, index) => ({
    entryId: entry.id,
    kind: entry.kind === "heart_rate" ? "heartRate" : entry.kind,
    playerName: names.get(entry.memberId) ?? "",
    text: plain[entryOffset + index * 2] ?? null,
    visibleToBoth: true,
  }));
  const terms = termsView(toRuleState(row, rowEntries), words);
  const state = toRuleState(row, rowEntries);
  const result = parseStoredResult(row.result);
  const scores = result.scores.filter(score => row.maxPlayers !== 10 || memberIds.includes(score.memberId));
  const anyDays = row.maxPlayers === 2 && "count" in currentTerms(state.game.terms).schedule;
  const playedDays = anyDays && row.settledAt ? Math.min(row.lengthDays,
    Math.max(...state.players.map(player => (dayIndexAt(player, gameNow(row.settledAt!, row)) ?? -1) + 1))) : row.lengthDays;
  const postsByDay = Array.from({ length: playedDays }, (_, dayIndex) => ({
    dayNumber: dayIndex + 1,
    dates: Object.fromEntries(recapPlayers.map((player) => [names.get(player.memberId) ?? "", player.dayOne ? addDays(fromDbDate(player.dayOne)!, dayIndex) : null])),
    posts: Object.fromEntries(recapPlayers.map((player) => {
      const name = names.get(player.memberId) ?? "";
      const entry = shownEntries.find((candidate) => candidate.memberId === player.memberId && candidate.dayIndex === dayIndex);
      if (!isScheduledDay(state, dayIndex)) return [name, "off"];
      if (!entry) return [name, row.maxPlayers === 10 ? "unavailable" : anyDays ? "off" : "missed"];
      const projected = entries.find((candidate) => candidate.entryId === entry.id)!;
      return [name, { entryId: entry.id, kind: projected.kind, text: projected.text, data: parseStoredGameEntryData(toEntryKind(entry.kind), plain[entryOffset + shownEntries.indexOf(entry) * 2 + 1] ?? null), ...(entry.incomplete ? { incomplete: true } : {}) }];
    })),
  }));
  return {
    players: recapPlayers.map((player) => names.get(player.memberId) ?? ""), entries,
    validation: { group: row.maxPlayers === 10, startedAt: row.startedAt ?? row.createdAt, settledAt: row.settledAt,
      playerNamesByMemberId: recapPlayers.map((player) => ({ memberId: player.memberId, name: names.get(player.memberId) ?? "" })),
      result: scores.filter(score => score.eligible !== false).map((score) => ({ memberId: score.memberId, name: names.get(score.memberId) ?? "", score: score.score })) },
    game: { id: row.id, ...(row.maxPlayers === 10 ? { maxPlayers: 10 } : {}), players: recapPlayers.map((player) => ({ memberId: player.memberId, name: names.get(player.memberId) ?? "", task: terms.tasks.find((task) => task.seat === player.seat)?.text ?? "" })),
      lengthDays: row.lengthDays, schedule: terms.schedule, stakes: terms.stakes, score: scores.map((score) => ({ name: names.get(score.memberId) ?? "", score: score.score })), days: postsByDay },
  };
}

export async function sealGameRecap(input: {
  beforeMutationTx: (tx: Prisma.TransactionClient) => Promise<void>;
  containerMemberId: string;
  eventId: string;
  gameId: string;
  playerMemberIds: readonly string[];
  recap: HostedGameRecap | null;
}): Promise<HostedGameRecap | null> {
  const prisma = getPrisma();
  const row = await prisma.game.findFirst({ where: { id: input.gameId, chatContainerMemberId: input.containerMemberId, status: "settled" } });
  if (!row || row.maxPlayers !== 10 && !sameGamePlayers(input.playerMemberIds, input.playerMemberIds)) return null;
  const audience = row.maxPlayers === 10 ? await readGameChatAudience(input.containerMemberId) : undefined;
  const recapEncrypted = input.recap === null
    ? null
    : await seal(gameTarget(row, "recap"), JSON.stringify(input.recap));
  const scope = parseGameRecapEventId(input.eventId);
  if (scope?.gameId !== input.gameId) return null;
  const sourceRef = scope.regenerationId ? `${input.gameId}:${scope.regenerationId}` : input.gameId;
  const key = createHostedLinqDeliveryIdempotencyLookupKey(input.eventId);
  if (!key) return null;
  const stored = await prisma.$transaction(async (tx) => {
    await input.beforeMutationTx(tx);
    if (row.maxPlayers !== 10) await lockGamePair(tx, input.playerMemberIds[0]!, input.playerMemberIds[1]!);
    const receipts = await tx.hostedLinqDelivery.count({ where: { idempotencyKey: key, source: "game_lifecycle", sourceRef, template: "game_recap", status: "generation_queued", payloadOwnerMemberId: input.containerMemberId } });
    if (receipts !== 1) return null;
    // Account deletion clears the recap under this row lock, so the roster is re-read after it.
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.gameId} FOR UPDATE`;
    const current = await tx.game.findFirst({ where: { id: input.gameId, chatContainerMemberId: input.containerMemberId, status: "settled", OR: [{ maxPlayers: 10 }, { maxPlayers: 2, players: { none: { leftAt: { not: null } } } }] }, include: { invitees: { select: { memberId: true, recipientLookupKey: true } }, players: { take: 11 } } });
    if (!current || current.wordsOwnerMemberId !== row.wordsOwnerMemberId) return null;
    if (current.maxPlayers === 10 ? !groupGameRecapPlayers(current) || !audience || !await readGroupGameChatAuthority(current, input.containerMemberId, audience, tx)
      : !sameGamePlayers(current.players.map((player) => player.memberId), input.playerMemberIds) || await hasGameChatBlock(tx, input.playerMemberIds)) return null;
    if (!await settleGameRecapGenerationTx(tx, current, input.eventId)) return null;
    if (scope.regenerationId) {
      const requested = await tx.gameEvent.findUnique({ where: { commandKey: input.eventId }, select: { gameId: true, type: true } });
      if (requested?.gameId !== input.gameId || requested.type !== "recap_regeneration_requested") return null;
      const acceptedKey = `${input.eventId}:accepted`;
      const accepted = await tx.gameEvent.findUnique({ where: { commandKey: acceptedKey }, select: { id: true } });
      if (accepted) return current.recapEncrypted;
      if (!recapEncrypted) return null;
      // Keep the old story until validation accepts this replacement. The row
      // lock makes replacement and its once-only acceptance one atomic change.
      await tx.game.update({ where: { id: input.gameId }, data: { recapEncrypted } });
      await tx.gameEvent.create({ data: { gameId: input.gameId, actor: "system", type: "recap_regeneration_accepted", commandKey: acceptedKey, payload: {} } });
      return recapEncrypted;
    }
    // A rematch cannot invalidate a finished game's first recap. The pair lock
    // still serializes joins/blocks; this row lock and null-only write preserve
    // the settled game's first seal, even if a newer game committed first.
    if (current.recapEncrypted) return current.recapEncrypted;
    if (!recapEncrypted) return null;
    const changed = await tx.game.updateMany({ where: { id: input.gameId, chatContainerMemberId: input.containerMemberId, status: "settled", recapEncrypted: null }, data: { recapEncrypted } });
    return changed.count === 1 ? recapEncrypted : null;
  });
  if (!stored) return null;
  const [plain] = await openGameTexts([{ ...gameTarget(row, "recap"), value: stored }]);
  return hostedGameRecapSchema.parse(JSON.parse(plain ?? "null"));
}

/** The caller already holds member/runtime authority; locks follow member before game. */
export async function readGamePhotoPostingStateTx(tx: Prisma.TransactionClient, gameId: string, actor: string) {
  await tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
  const [loaded] = await loadGames(tx, [gameId]);
  if (!loaded || loaded.state.game.status !== "live" || isGameDecided(loaded.state)) return null;
  const player = playerFor(loaded.state, actor);
  if (!player || player.leftAt) return null;
  const now = gameNow(await databaseNow(tx), loaded.row);
  const dayIndex = dayIndexAt(player, now);
  if (dayIndex === null || dayIndex < 0 || dayIndex >= loaded.row.lengthDays || !player.dayOne) return null;
  return { now, dayIndex, player, scheduled: isScheduledDay(loaded.state, dayIndex), offDayMessage: gameOffDayMessage(loaded.state, player, dayIndex),
    checkInKind: currentTerms(loaded.state.game.terms).checkInKind ?? "photo",
    currentEntryId: liveEntry(loaded.state.entries, actor, dayIndex)?.id ?? null,
    attemptsRemaining: Math.max(0, 2 - attemptsUsed(loaded.state.entries, actor, dayIndex)) };
}

// -------------------------------------------------------------------- reads

/**
 * One batch for all requested games. Unique entry identity bounds challenges by
 * two players x two attempts x game length. Only the latest accused/day
 * concession id leaves Postgres, regardless of the number of score restores.
 */
async function readGameChallenges(db: Db, gameIds: readonly string[]): Promise<Map<string, RuleChallenge[]>> {
  const result = new Map<string, RuleChallenge[]>();
  if (gameIds.length === 0) return result;
  const rows = await db.$queryRaw<Array<{ id: bigint; gameId: string; actor: string; commandKey: string; payload: Prisma.JsonValue; concessionEventId: bigint | null }>>(Prisma.sql`
    SELECT challenge.id, challenge.game_id AS "gameId", challenge.actor,
      challenge.command_key AS "commandKey", challenge.payload,
      (SELECT concession.id FROM game_event concession
        JOIN game_entry target ON target.id = challenge.payload->>'entryId' AND target.game_id = challenge.game_id
        WHERE concession.game_id = challenge.game_id AND concession.type = 'day_marked_incomplete'
          AND concession.actor = target.member_id AND concession.payload->>'dayIndex' = target.day_index::text
        ORDER BY concession.id DESC LIMIT 1) AS "concessionEventId"
    FROM game_event challenge WHERE challenge.game_id IN (${Prisma.join(gameIds)}) AND challenge.type = 'challenged'
    ORDER BY challenge.id
  `);
  for (const row of rows) {
    const payload = row.payload;
    if (!isRecord(payload) || payload.v !== 1 || typeof payload.entryId !== "string"
      || row.commandKey !== gameChallengeKey(row.gameId, payload.entryId)) {
      throw new Error("Stored game challenge is malformed.");
    }
    const challenges = result.get(row.gameId) ?? [];
    challenges.push({ id: row.id, actor: row.actor, entryId: payload.entryId, concessionEventId: row.concessionEventId });
    result.set(row.gameId, challenges);
  }
  return result;
}

/** Database-only projection shared by drain recovery and final provider claim. */
export async function readGameChallengeCase(db: Db, gameId: string, entryId: string, clock: Date) {
  const [loaded] = await loadGames(db, [gameId]);
  if (!loaded) return null;
  const challenges = await readGameChallenges(db, [gameId]);
  const challenge = challenges.get(gameId)?.find(candidate => candidate.entryId === entryId);
  if (!challenge) return null;
  if (loaded.row.maxPlayers === 10) {
    const target = loaded.state.entries.find(entry => entry.id === entryId);
    const reports = await db.gameReport.findMany({ where: { gameId, reporterMemberId: challenge.actor, entryId: { not: null } }, select: { entryId: true } });
    if (!target || target.kind !== "photo" || target.attempt <= 0 || target.incomplete
      || !visibleEntryIds(loaded.state, challenge.actor, new Set(reports.flatMap(report => report.entryId ? [report.entryId] : []))).has(entryId)) return null;
  }
  return { ...loaded, challenge, status: gameChallengeStatus(loaded.state, challenge, gameNow(clock, loaded.row)) };
}

/** Database-only change state shared by generation and the final dispatch claim. */
export async function readCurrentGameChange(db: Db, gameId: string, proposalId: string, clock: Date) {
  const [loaded] = await loadGames(db, [gameId]);
  const pending = loaded && parsePendingGameChange(loaded.row.pendingChange);
  if (!loaded || !pending || pending.id !== proposalId || isGameInviteExpired(loaded.row, clock)
    || isGameChangeExpired(loaded.state, pending, gameNow(clock, loaded.row))) return null;
  return { ...loaded, pending, now: gameNow(clock, loaded.row) };
}

/** Decrypt only shared task words and profile names, outside the game transaction. */
export async function readGameChallengeInstructions(current: NonNullable<Awaited<ReturnType<typeof readGameChallengeCase>>>): Promise<string | null> {
  const entry = current.state.entries.find(entry => entry.id === current.challenge.entryId);
  const accused = entry && playerFor(current.state, entry.memberId);
  if (!entry || !accused) return null;
  const [profiles, [plain]] = await Promise.all([
    readGameChatProfiles(gameMemberIds(current.row.players.filter(player => current.row.maxPlayers !== 10 || !player.leftAt))),
    openGameTexts([{ ...gameTarget(current.row, "terms_words"), value: current.row.termsWordsEncrypted }]),
  ]);
  const challengerName = profiles.find(profile => profile.memberId === current.challenge.actor)?.firstName;
  const accusedName = profiles.find(profile => profile.memberId === accused.memberId)?.firstName;
  if (!challengerName || !accusedName) return null;
  const version = termsForDay(current.state.game.terms, entry.dayIndex);
  // Structural-only revisions (Start now, duration, schedule, date) add no
  // words; like termsView, inherit the newest words at or before this day's version.
  const words = [...parseTermWords(plain ?? "").versions].reverse().find(words => words.n <= version.n);
  // Per-seat group overrides belong to personal app views, never the room.
  const task = current.row.maxPlayers === 10 ? words?.defaultTask : words?.tasks.find(task => task.seat === accused.seat)?.text;
  if (!task) return null;
  return buildGameChallengeInstructions({ group: current.row.maxPlayers === 10, challengerName, accusedName, task, dayNumber: entry.dayIndex + 1,
    postedAt: entry.receivedAt, timeZone: accused.timeZone });
}

async function loadGames(db: Db, gameIds: readonly string[], multiplayer = true): Promise<LoadedGame[]> {
  if (gameIds.length === 0) return [];
  const [rows, entries] = await Promise.all([
    db.game.findMany({ include: { invitees: true, players: true, events: { where: { type: "posted", payload: { path: ["attempt"], gt: 0 } }, select: { id: true }, take: 1 } }, where: { id: { in: [...gameIds] }, ...(!multiplayer ? { maxPlayers: 2 } : {}) } }),
    db.gameEntry.findMany({ orderBy: { receivedAt: "asc" }, where: { gameId: { in: [...gameIds] } } }),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return gameIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const gameEntries = entries.filter((entry) => entry.gameId === id);
    return [{ entries: gameEntries, row, state: { ...toRuleState(row, gameEntries), hasPostedAttempt: row.events?.length > 0 } }];
  });
}

/** Loads only visible, non-withdrawn, unreported posts that can appear in history previews. */
async function loadHistoryGames(db: Db, gameIds: readonly string[], viewerId: string): Promise<LoadedGame[]> {
  if (gameIds.length === 0) return [];
  const [rows, entries] = await Promise.all([
    db.game.findMany({ include: { invitees: true, players: true }, where: { id: { in: [...gameIds] } } }),
    db.$queryRaw<GameEntry[]>(Prisma.sql`
      WITH ranked_entry AS (
        SELECT entry.*,
          ROW_NUMBER() OVER (
            PARTITION BY entry.game_id
            ORDER BY CASE WHEN entry.kind = 'photo' THEN 0 ELSE 1 END,
              entry.day_index, player.seat, entry.received_at, entry.id
          ) AS preview_rank
        FROM game_entry entry
        JOIN game_player player
          ON player.game_id = entry.game_id AND player.member_id = entry.member_id
        WHERE entry.game_id IN (${Prisma.join(gameIds)})
          AND entry.attempt > 0
          AND entry.withdrawn_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM game_block blocked
            WHERE (blocked.blocker_member_id = ${viewerId} AND blocked.blocked_member_id = entry.member_id)
              OR (blocked.blocker_member_id = entry.member_id AND blocked.blocked_member_id = ${viewerId}))
          AND NOT EXISTS (
            SELECT 1 FROM game_report report
            WHERE report.reporter_member_id = ${viewerId} AND report.entry_id = entry.id
          )
      )
      SELECT id,
        game_id AS "gameId",
        member_id AS "memberId",
        day_index AS "dayIndex",
        attempt,
        kind,
        text_encrypted AS "textEncrypted",
        payload_encrypted AS "payloadEncrypted",
        incomplete,
        blur_hash AS "blurHash",
        media_keys AS "mediaKeys",
        capture_age_ms AS "captureAgeMs",
        received_at AS "receivedAt",
        withdrawn_at AS "withdrawnAt",
        withdrawn_reason AS "withdrawnReason"
      FROM ranked_entry
      WHERE preview_rank <= ${GAME_HISTORY_PREVIEW_LIMIT}
      ORDER BY game_id, preview_rank
    `),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const entriesByGame = new Map<string, GameEntry[]>();
  for (const entry of entries) {
    const gameEntries = entriesByGame.get(entry.gameId) ?? [];
    gameEntries.push(entry);
    entriesByGame.set(entry.gameId, gameEntries);
  }
  return gameIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const gameEntries = entriesByGame.get(id) ?? [];
    return [{ entries: gameEntries, row, state: toRuleState(row, gameEntries) }];
  });
}

export function toRuleState(row: GameRow, entries: readonly Pick<GameEntry, "attempt" | "dayIndex" | "id" | "kind" | "mediaKeys" | "memberId" | "withdrawnAt" | "receivedAt" | "blurHash" | "incomplete">[]): RuleState {
  return {
    entries: entries.map((entry) => ({
      attempt: entry.attempt,
      dayIndex: entry.dayIndex,
      id: entry.id,
      kind: toEntryKind(entry.kind),
      mediaKeys: entry.mediaKeys,
      memberId: entry.memberId,
      withdrawnAt: entry.withdrawnAt,
      receivedAt: entry.receivedAt,
      blurHash: entry.blurHash,
      incomplete: entry.incomplete === true,
    })),
    game: { ...toRuleStateGame(row, parseStoredTerms(row.terms)), admittedSeats: row.players.map(player => player.seat) },
    players: row.players.filter(hasGameIdentity).map((player) => ({
      dayOne: fromDbDate(player.dayOne),
      memberId: player.memberId,
      seat: player.seat,
      timeZone: player.timeZone,
      joinedAt: player.joinedAt, leftAt: player.leftAt,
    })),
  };
}

function toRuleStateGame(row: Game & Pick<GameRow, "invitees">, terms: RuleState["game"]["terms"]): RuleState["game"] {
  return {
    chatContainerMemberId: row.chatContainerMemberId,
    createdBy: row.createdBy,
    id: row.id,
    inviteExpiresAt: row.inviteExpiresAt,
    invitees: row.invitees,
    lengthDays: row.lengthDays,
    seats: row.maxPlayers,
    startsOn: fromDbDate(row.startsOn),
    status: toStatus(row.status),
    terms,
  };
}

function toStatus(value: string): GameStatus {
  if (value === "invited" || value === "negotiating" || value === "live" || value === "settled" || value === "void") return value;
  throw new Error("Stored game status is malformed.");
}

function toEntryKind(value: string): GameEntryKind {
  const kind = GAME_ENTRY_KINDS.find((candidate) => candidate === value);
  if (!kind) throw new Error("Stored game entry kind is malformed.");
  return kind;
}

function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromDbDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * Foreground reads settle due games. Background projections only expire changes,
 * leaving overnight settlement to the morning sweep.
 */
async function loadCurrent(gameIds: readonly string[], multiplayer = true, actor?: string, answeredRoom?: string): Promise<{ games: LoadedGame[]; clock: Date }> {
  const prisma = getPrisma();
  const [loaded, clock] = await Promise.all([loadGames(prisma, gameIds, multiplayer), databaseNow(prisma)]);
  const due = actor ? loaded.filter((game) => isGameDue(game.state, gameNow(clock, game.row))) : [];
  const expired = loaded.filter((game) => {
    const pending = parsePendingGameChange(game.row.pendingChange);
    return pending && isGameChangeExpired(game.state, pending, gameNow(clock, game.row));
  });
  if (due.length === 0 && expired.length === 0) return { clock, games: loaded };
  for (const game of expired) await runLocked(game.row.id, { actor: SYSTEM_ACTOR }, async ({ tx, loaded: current, now, clock }) => {
    const pending = parsePendingGameChange(current.row.pendingChange);
    if (!pending) return [];
    const outdated = isGameChangeOutdated(current.state, pending, now);
    const reason = outdated ? null : gameChangeRefusal(current.state, pending, now);
    if (!outdated && !reason) return [];
    if (current.row.maxPlayers === 10) {
      await resolveGroupGameChangeTx({ tx, game: current.row, actor: SYSTEM_ACTOR, now: clock, proposal: pending,
        outcome: "change_expired", reason: reason ?? GAME_ENDED_CHANGE_REASON, answeredInBoundChat: answeredRoom === current.row.chatContainerMemberId });
      return [];
    }
    await tx.game.update({ where: { id: game.row.id }, data: { pendingChange: Prisma.DbNull } });
    if (!reason) return [{ type: "change_expired", payload: { proposalId: pending.id } }];
    // The same resolution, reason and chat notice an agreement attempt would have recorded.
    if (current.row.chatContainerMemberId) await reserveGameChatLifecycleTx({ gameId: game.row.id, kind: "change_expired", proposalId: pending.id, now: clock, tx });
    return [{ commandKey: `game-change-resolved:${game.row.id}:${pending.id}`, type: "change_expired", payload: { proposalId: pending.id, reason } }];
  });
  for (const game of due) await settleGame(game.row.id);
  return { clock, games: await loadGames(prisma, gameIds, multiplayer) };
}

export async function readGame(gameId: string, memberId: string, multiplayer = false): Promise<GameView | null> {
  const { clock, games: [loaded] } = await loadCurrent([gameId], multiplayer, memberId);
  if (!loaded || !canView(loaded, memberId)) return null;
  const [view] = await buildViews([loaded], memberId, clock, undefined, multiplayer);
  return view;
}

/**
 * Players see their games that are on; a rematch's addressed invitee sees it
 * while it's still an invite (only they can accept it).
 */
function canView(game: LoadedGame, memberId: string): boolean {
  if (!isGameOn(game.row)) return false;
  const player = playerFor(game.state, memberId);
  if (player) return !player.leftAt;
  // Also after its challenger left: the invitee sees it called off.
  return game.row.invitees.some(invitee => invitee.memberId === memberId)
    && (game.row.status === "invited" || game.row.players.some(player => player.leftAt !== null));
}

/**
 * The HTTP door. A listed member may use every route. Anyone else enters only
 * for a game that is on: one they play or are the addressed rematch invitee
 * of, or the open invite they're holding, so a new invitee can set up and
 * accept. Owners of outgoing blocks or reports may also enter to unblock or
 * retry an accepted report after the source is gone. Each command still checks
 * its own game, so this grants no game access.
 */
export async function canEnterGame(memberId: string, inviteToken: string | null): Promise<boolean> {
  if (isGameEnabledFor(memberId)) return true;
  if (!isGameEnabled()) return false;
  const prisma = getPrisma();
  const yours = await prisma.game.findFirst({ select: { id: true }, where: { AND: [
    { OR: [{ players: { some: { memberId } } }, { invitees: { some: { memberId } } }] },
    { status: { in: ["invited", "negotiating", "live", "settled"] } },
    gameOnWhere(),
  ] } });
  if (yours) return true;
  if (await prisma.gameBlock.findFirst({ select: { blockedMemberId: true }, where: { blockerMemberId: memberId } })) return true;
  if (await prisma.gameReport.findFirst({ select: { id: true }, where: { reporterMemberId: memberId } })) return true;
  if (!inviteToken) return false;
  const invite = await prisma.game.findUnique({ include: { invitees: true, players: true }, where: { inviteTokenHash: sha256Hex(inviteToken) } });
  if (!invite || !(invite.status === "invited" || invite.maxPlayers === 10 && invite.status === "live") || !isGameOn(invite)) return false;
  if (invite.maxPlayers === 2 && invite.invitees.some(invitee => invitee.memberId !== null) && !invite.invitees.some(invitee => invitee.memberId === memberId)) return false;
  return invite.inviteExpiresAt === null || invite.inviteExpiresAt.getTime() > gameNow(await databaseNow(prisma), invite).getTime();
}

/**
 * Home shows what's open (invited, live, including a rematch addressed to you), the three most recently settled
 * games, and up to three invites that expired in the last week, so the
 * challenger sees "invite expired" rather than the game vanishing.
 */
function homeGames(games: readonly LoadedGame[], now: Date, blocks: GameBlocks): LoadedGame[] {
  const latest = (status: "settled" | "void", at: (game: LoadedGame) => Date | null, count: number) => games
    .filter((game) => game.row.status === status && at(game) !== null)
    .sort((a, b) => at(b)!.getTime() - at(a)!.getTime())
    .slice(0, count);
  const settled = latest("settled", (game) => game.row.settledAt, HOME_SETTLED_SHOWN);
  // A game called off because a player left counts from when they left; one
  // a block called off, from that last change (nothing changes a void game).
  const endedAt = (game: LoadedGame) => {
    const departed = game.row.players.find(player => player.leftAt !== null)?.leftAt;
    if (departed) return new Date(departed);
    return game.row.players.some((player) => player.memberId !== null && isHiddenBy(blocks, player.memberId)) ? game.row.updatedAt : game.row.inviteExpiresAt;
  };
  const expired = latest("void", endedAt, HOME_EXPIRED_SHOWN)
    .filter((game) => now.getTime() - endedAt(game)!.getTime() <= HOME_EXPIRED_FOR_MS);
  const shown = new Set([...settled, ...expired]);
  return games.filter((game) => game.row.status === "invited" || game.row.status === "negotiating" || game.row.status === "live" || shown.has(game));
}

/**
 * Home's order: the live games waiting on you today first, then your other
 * live games, then invites, then results, then expired invites; newest first
 * within each.
 */
function sortForHome(games: readonly LoadedGame[], memberId: string, clock: Date): LoadedGame[] {
  const rank = (game: LoadedGame) => {
    const { status } = game.row;
    if (status === "live") return needsPostToday(game.state, memberId, gameNow(clock, game.row)) ? 0 : 1;
    return status === "invited" || status === "negotiating" ? 2 : status === "settled" ? 3 : 4;
  };
  const newest = (game: LoadedGame) => (game.row.settledAt ?? game.row.startedAt ?? game.row.createdAt).getTime();
  return [...games].sort((a, b) => rank(a) - rank(b) || newest(b) - newest(a));
}

async function readHomeProfile(memberId: string, auth?: HostedNativeMemberAuth): Promise<(GameProfile & { firstName: string | null }) | null> {
  const prisma = getPrisma();
  const profile = await prisma.gameProfile.findUnique({ where: { memberId } });
  const target: GameSealTarget = { field: "first_name", memberId, rowId: memberId, table: "game_profile" };
  if (profile) {
    const [firstName] = await openGameTexts([{ ...target, value: profile.firstNameEncrypted }]);
    return { ...profile, firstName: firstName ?? null };
  }
  if (!auth || auth.member.id !== memberId) return null;
  try {
    return await adoptVaultGameProfile(auth, { timeoutMs: 1_500 });
  } catch {
    // Optional adoption must not turn an ordinary Home read into a failure.
    return null;
  }
}

export async function readHome(memberId: string, multiplayer = false, auth?: HostedNativeMemberAuth): Promise<GameHomeView> {
  const prisma = getPrisma();
  const [profile, seats, addressed, tickets, usualEntry] = await Promise.all([
    readHomeProfile(memberId, auth),
    // Apply active-game priority before the bounded history window, so new
    // invitations and completed games cannot displace an older live game.
    prisma.$queryRaw<Array<{ gameId: string }>>(Prisma.sql`
      SELECT seat.game_id AS "gameId" FROM game_player seat
      JOIN game ON game.id = seat.game_id
      WHERE seat.member_id = ${memberId} AND seat.left_at IS NULL
        AND game.status IN ('invited', 'negotiating', 'live', 'settled', 'void')
        AND ${multiplayer ? Prisma.sql`TRUE` : Prisma.sql`game.max_players = 2`}
        AND ${gameOnSql("game")}
        AND NOT EXISTS (SELECT 1 FROM game_event event WHERE event.game_id = game.id AND event.type = 'cancelled')
      ORDER BY CASE game.status WHEN 'live' THEN 0 WHEN 'negotiating' THEN 1 WHEN 'invited' THEN 2 ELSE 3 END,
        seat.joined_at DESC, seat.game_id DESC
      LIMIT ${HOME_CANDIDATE_LIMIT}
    `),
    prisma.game.findMany({ select: { id: true }, take: HOME_CANDIDATE_LIMIT, where: { ...(!multiplayer ? { maxPlayers: 2 } : {}), invitees: { some: { memberId } },
      OR: [{ status: "invited" }, { status: "void", players: { some: { leftAt: { not: null } } } }] } }),
    prisma.gameTicket.findMany({
      include: { game: { include: { players: true, invitees: true } } },
      orderBy: { createdAt: "desc" },
      take: WALLET_LIMIT,
      where: { game: { ...(!multiplayer ? { maxPlayers: 2 } : {}), AND: [gameOnWhere(), { players: { some: { memberId, leftAt: null } } }] } },
    }),
    prisma.gameEntry.findFirst({ where: { memberId, attempt: { gt: 0 }, withdrawnAt: null },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }], select: { kind: true } }),
  ]);
  const current = await loadCurrent([...new Set([...seats.map((seat) => seat.gameId), ...addressed.map((game) => game.id)])], true, memberId);
  const visible = current.games.filter((game) => canView(game, memberId));
  const counterpartyOf = (ticket: (typeof tickets)[number]) => ticket.game.players.find(player => player.memberId !== memberId)?.memberId;
  const blocks = await readGameBlocks(prisma, memberId, [
    ...visible.flatMap(participantsOf), ...tickets.flatMap(ticket => gameMemberIds(ticket.game.players)),
  ]);
  // Someone you blocked is gone from your Home: their games and tickets too.
  const shown = visible.filter((game) => game.row.maxPlayers === 10 || !participantsOf(game).some((id) => blocks.blocked.has(id)));
  const games = sortForHome(homeGames(shown, current.clock, blocks), memberId, current.clock);
  const kept = tickets.filter((ticket) => ticket.game.maxPlayers === 10 || !blocks.blocked.has(counterpartyOf(ticket) ?? ""));
  const hydrationGames = new Map(games.map(game => [game.row.id, game]));
  for (const ticket of kept) if (!hydrationGames.has(ticket.gameId)) hydrationGames.set(ticket.gameId,
    { row: ticket.game, entries: [], state: toRuleState(ticket.game, []) });
  const [inputs, blocked] = await Promise.all([
    buildViewInputs([...hydrationGames.values()], memberId, current.clock, blocks, { multiplayer, home: true }), readBlockedPeople(memberId),
  ]);
  const inputsById = new Map(inputs.map(input => [input.state.game.id, input]));
  const views = games.map(game => buildGameView(inputsById.get(game.row.id)!));
  const wallet = kept.map(ticket => {
    const input = inputsById.get(ticket.gameId)!;
    return ticketView(toTicketRow(ticket, ticket.game.players), input.words, memberId, input.now,
      input.state.game.terms, input.hiddenMemberIds, input);
  });
  return {
    blocked,
    games: views,
    canStartGames: isGameEnabledFor(memberId),
    ...(multiplayer ? { canStartGroups: areGameGroupsEnabled() && isGameEnabledFor(memberId) } : {}),
    me: { usualKind: usualEntry ? toEntryKind(usualEntry.kind) : null, avatarUrl: profile?.photoKey ? gameMediaUrl(profile.photoKey) : null, firstName: profile?.firstName ?? null, memberId, timeZone: profile?.timeZone ?? null },
    wallet: {
      // Expired tickets stay where they were, marked expired.
      held: wallet.filter((ticket) => ticket.status !== "redeemed" && ticket.youHold),
      owed: wallet.filter((ticket) => ticket.status !== "redeemed" && !ticket.youHold),
      redeemed: wallet.filter((ticket) => ticket.status === "redeemed"),
    },
  };
}

/**
 * Settled history, bounded to a constant number of audiences, games and
 * preview entries. Every database read is set-based; view hydration decrypts
 * the selected rows in the same batch used by ordinary game views.
 */
export async function readHistory(memberId: string, multiplayer = false): Promise<GameHistoryView> {
  const prisma = getPrisma();
  const candidates = await prisma.$queryRaw<Array<{ gameId: string }>>(Prisma.sql`
    WITH settled_games AS (
      SELECT game.id AS game_id, game.max_players,
        CASE WHEN game.max_players = 10 THEN game.audience_key ELSE opponent.member_id END AS opponent_id,
        game.settled_at AS settled_at,
        ROW_NUMBER() OVER (
          PARTITION BY game.max_players, CASE WHEN game.max_players = 10 THEN game.audience_key ELSE opponent.member_id END
          ORDER BY game.settled_at DESC, game.id DESC
        ) AS game_rank
      FROM game
      JOIN game_player viewer
        ON viewer.game_id = game.id AND viewer.member_id = ${memberId} AND viewer.left_at IS NULL
      LEFT JOIN game_player opponent
        ON game.max_players = 2 AND opponent.game_id = game.id AND opponent.member_id <> ${memberId}
      WHERE game.status = 'settled'
        AND game.settled_at IS NOT NULL
        AND ${gameOnSql("game")}
        AND ${multiplayer ? Prisma.sql`TRUE` : Prisma.sql`game.max_players = 2`}
        AND (game.max_players = 10 OR (opponent.member_id IS NOT NULL
        AND (SELECT count(*) FROM game_player roster WHERE roster.game_id = game.id) = 2
        AND NOT EXISTS (
          SELECT 1 FROM game_block blocked
          WHERE (blocked.blocker_member_id = ${memberId} AND blocked.blocked_member_id = opponent.member_id)
            OR (blocked.blocker_member_id = opponent.member_id AND blocked.blocked_member_id = ${memberId})
        )))
    ), recent_audiences AS (
      SELECT opponent_id, max_players, max(settled_at) AS latest_at,
        ROW_NUMBER() OVER (PARTITION BY max_players ORDER BY max(settled_at) DESC, opponent_id) AS audience_rank
      FROM settled_games
      GROUP BY max_players, opponent_id
    )
    SELECT settled_games.game_id AS "gameId"
    FROM settled_games
    JOIN recent_audiences USING (max_players, opponent_id)
    WHERE recent_audiences.audience_rank <= CASE WHEN max_players = 10 THEN ${HISTORY_GROUP_LIMIT}::int ELSE ${HISTORY_PEOPLE_LIMIT}::int END
      AND settled_games.game_rank <= CASE WHEN max_players = 10 THEN ${HISTORY_GAMES_PER_GROUP_LIMIT}::int ELSE ${HISTORY_GAMES_PER_PERSON_LIMIT}::int END
    ORDER BY recent_audiences.latest_at DESC,
      settled_games.opponent_id,
      settled_games.settled_at DESC,
      settled_games.game_id DESC
  `);
  if (candidates.length === 0) return { people: [], ...(multiplayer ? { groups: [] } : {}) };

  const gameIds = candidates.map((candidate) => candidate.gameId);
  const [games, clock] = await Promise.all([
    loadHistoryGames(prisma, gameIds, memberId),
    databaseNow(prisma),
  ]);
  const built = await buildHistoryViews(games, memberId, clock, multiplayer);
  const people = new Map<string, GameHistoryView["people"][number]>();
  const groups = new Map<string, NonNullable<GameHistoryView["groups"]>[number]>();
  for (const item of built) {
    if ("group" in item) {
      let group = groups.get(item.group.id);
      if (!group) { group = { ...item.group, games: [], record: { lost: 0, tied: 0, won: 0 } }; groups.set(group.id, group); }
      group.games.push(item.game);
      group.record[item.game.result] += 1;
      continue;
    }
    let person = people.get(item.person.memberId);
    if (!person) {
      person = { ...item.person, games: [], record: { lost: 0, tied: 0, won: 0 } };
      people.set(item.person.memberId, person);
    }
    person.games.push(item.game);
    person.record[item.game.result] += 1;
  }
  return { people: [...people.values()], ...(multiplayer ? { groups: [...groups.values()] } : {}) };
}

/** The members in a game: its players and an addressed rematch's invitee. */
function participantsOf(game: LoadedGame): string[] {
  return [...gameMemberIds(game.row.players), ...gameMemberIds(game.row.invitees)];
}

/** Everyone the member blocked, newest first, by the member's own name for them. */
async function readBlockedPeople(memberId: string): Promise<{ memberId: string; firstName: string }[]> {
  const prisma = getPrisma();
  const rows = await prisma.gameBlock.findMany({ orderBy: [{ createdAt: "desc" }, { blockedMemberId: "asc" }],
    select: { blockedMemberId: true }, take: GAME_BLOCK_LIMIT, where: { blockerMemberId: memberId } });
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.blockedMemberId);
  const [profiles, labels] = await Promise.all([
    prisma.gameProfile.findMany({ select: { firstNameEncrypted: true, memberId: true }, where: { memberId: { in: ids } } }),
    prisma.gameContactLabel.findMany({ select: { nameEncrypted: true, subjectMemberId: true }, where: { ownerMemberId: memberId, subjectMemberId: { in: ids } } }),
  ]);
  const plain = await openGameTexts([
    ...labels.map((label) => ({ ...labelTarget(memberId, "name"), value: label.nameEncrypted })),
    ...profiles.map((profile) => ({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile" as const, value: profile.firstNameEncrypted })),
  ]);
  const labelName = new Map(labels.map((label, index) => [label.subjectMemberId, plain[index]]));
  const ownName = new Map(profiles.map((profile, index) => [profile.memberId, plain[labels.length + index]]));
  return ids.map((id) => ({ firstName: labelName.get(id) || ownName.get(id) || "", memberId: id }));
}

/** Anyone with the link sees an open invite's details; a used or expired one shows only its status. */
export async function readInvitePreview(token: string, multiplayer = false, memberId?: string): Promise<GameInvitePreview | null> {
  if (!isGameEnabled() || typeof token !== "string" || !token) return null;
  const row = await getPrisma().game.findUnique({
    include: { invitees: true, creator: true, events: { where: { type: "cancelled" }, select: { actor: true }, take: 1 }, players: true },
    where: { inviteTokenHash: sha256Hex(token) },
  });
  if (!row || (!multiplayer && row.maxPlayers !== 2)) return null;
  if (memberId && row.players.some(player => player.memberId === memberId && player.leftAt)) return null;
  // Its challenger deleted their account: never open again.
  if (!row.creator && row.maxPlayers === 2) return { status: "expired" };
  if (!isGameOn(row)) return null;
  const blocks = memberId ? await readGameBlocks(getPrisma(), memberId, gameMemberIds(row.players)) : null;
  if (row.createdBy && blocks && isHiddenBy(blocks, row.createdBy)) return null;
  const now = gameNow(await databaseNow(getPrisma()), row);
  const closed = await closedInvitePreview(row, now);
  const preview = closed ?? await openInvitePreview(row, multiplayer, memberId, blocks);
  if (row.maxPlayers !== 10) return preview;
  return withGroupTalkPreview(row, preview, memberId, now);
}

/** Receipt status survives invitation closure without restoring preview access. */
async function withGroupTalkPreview(row: GameRow, preview: GameInvitePreview, memberId: string | undefined, now: Date): Promise<GameInvitePreview> {
  const talkDelivery = memberId ? (await readTalkDeliveryViews([row.id], memberId, false)).get(row.id) : undefined;
  const canTalk = preview.status === "open" && memberId && !talkDelivery
    ? await canSendGroupTalk(row, memberId, now) : false;
  return { ...preview, ...(preview.status === "open" ? { supportsTalk: true, canTalk: Boolean(canTalk) } : {}),
    ...(talkDelivery ? { talkDelivery } : {}) };
}

/** Availability is advisory; the member/game-locked writer repeats every admission check. */
async function canSendGroupTalk(row: GameRow, actor: string, now: Date): Promise<boolean> {
  if (!areGameGroupsEnabled() || !row.chatContainerMemberId) return false;
  const db = getPrisma();
  const contacts = await readGameVerifiedContacts(actor);
  const keys = await verifiedGameContactKeys(db, actor, contacts);
  const entries = await db.gameEntry.findMany({ where: { gameId: row.id, dayIndex: row.lengthDays - 1 } });
  const invitation = await readGroupTalkInvitation(db, row, toRuleState(row, entries), actor, keys, now);
  if (!invitation) return false;
  const accepted = await db.gameEvent.findMany({ where: { gameId: row.id, type: "talk_requested" }, select: { actor: true, payload: true }, take: 10 });
  if (accepted.length >= 9 || accepted.some(event => {
    const payload = parseGameTalkPayload(event.payload);
    return event.actor === actor || payload?.v === 2 && payload.invitationSeat === invitation.seat;
  })) return false;
  const audience = await readGroupGameChatAuthority(row, row.chatContainerMemberId).catch(() => null);
  return Boolean(audience?.memberIds.includes(actor) && (await verifiedGameContactKeys(db, actor, audience.contacts)).length);
}

type PreviewGame = GameRow & { creator: { memberId: string; firstNameEncrypted: string } | null; events: { actor: string }[] };

async function closedInvitePreview(row: PreviewGame, now: Date): Promise<GameInvitePreview | null> {
  // Expired means nobody took it: a void game, or an open invite past its
  // expiry. A taken one stays "used" however long ago that was.
  const expired = row.status === "void"
    || (row.status === "invited" && row.inviteExpiresAt !== null && row.inviteExpiresAt.getTime() < now.getTime());
  if (row.status === "void" && row.events.length > 0) {
    if (row.events[0].actor !== row.createdBy) return { status: "expired", reason: "cancelled" };
    if (!row.creator) return { status: "expired", reason: "cancelled" };
    const [inviterFirstName] = await openGameTexts([
      { field: "first_name", memberId: row.creator.memberId, rowId: row.creator.memberId, table: "game_profile", value: row.creator.firstNameEncrypted },
    ]);
    return { status: "expired", reason: "cancelled", inviterFirstName: inviterFirstName ?? "" };
  }
  const groupOpen = await groupInviteOpen(row, now);
  if ((row.status !== "invited" && !groupOpen) || expired) return { status: expired ? "expired" : "used" };
  return null;
}

/** Final-day artifacts decide whether the existing offline grace still applies. */
async function groupInviteOpen(row: GameRow, now: Date): Promise<boolean> {
  if (row.maxPlayers !== 10 || row.status !== "live" || row.players.length >= 10) return false;
  const entries = await getPrisma().gameEntry.findMany({ where: { gameId: row.id, dayIndex: row.lengthDays - 1 } });
  return !isGameDue(toRuleState(row, entries), now);
}

async function openInvitePreview(row: PreviewGame, multiplayer: boolean, memberId: string | undefined, blocks: GameBlocks | null): Promise<GameInvitePreview> {
  // The invitee's name stays out: the challenger typed it as their own private
  // label, and this preview is public to anyone holding the link.
  const [inviterFirstName, words] = await openGameTexts([
      { field: "first_name", memberId: row.createdBy ?? row.wordsOwnerMemberId, rowId: row.createdBy ?? row.wordsOwnerMemberId, table: "game_profile", value: row.creator?.firstNameEncrypted ?? null },
    { ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted },
  ]);
  const game = toRuleStateGame(row, parseStoredTerms(row.terms));
  const termWords = parseTermWords(words ?? "");
  const previewTerms = termsView({ entries: [], game, players: [] }, termWords, multiplayer);
  // Link previews share only the default task; addressed readers get yourTask separately.
  if (row.maxPlayers === 10) previewTerms.tasks = [];
  const additions = multiplayer ? await capableInvitePreview(row, termWords, memberId, blocks) : {};
  return {
    ...additions,
    expiresAt: row.maxPlayers === 10 ? row.inviteExpiresAt?.toISOString() ?? null : (row.inviteExpiresAt ?? row.createdAt).toISOString(),
    inviterFirstName: inviterFirstName ?? "",
    startsOn: game.startsOn,
    status: "open",
    supportsNegotiation: row.maxPlayers === 2,
    ...(row.maxPlayers === 2 ? { supportsTalk: true } : {}),
    lengthDays: row.lengthDays,
    terms: previewTerms,
  };
}

async function capableInvitePreview(row: PreviewGame, words: TermWords, memberId: string | undefined, blocks: GameBlocks | null) {
  const invitation = await addressedGameInvitation(row, memberId);
  const versionWords = words.versions[words.versions.length - 1];
  return {
    maxPlayers: row.maxPlayers === 10 ? 10 as const : 2 as const,
    dayOne: gameDayOne(calendarPlayers(toRuleState(row, []))),
    ...(row.maxPlayers === 10 ? { group: { id: row.audienceKey ?? "", word: words.groupWord ?? "" } } : {}),
    ...(invitation ? { yourTask: versionWords.tasks.find(task => task.seat === invitation.seat)?.text ?? versionWords.defaultTask ?? "" } : {}),
    ...(memberId && blocks ? { alreadyIn: await inviteAlreadyIn(row, memberId, blocks) } : {}),
  };
}

/** An addressee may have registered after the invitation was created. */
async function addressedGameInvitation(row: GameRow, memberId: string | undefined) {
  if (!memberId) return undefined;
  const direct = addressedGameInvite(row.invitees, memberId, []);
  if (direct || !row.invitees.some(invitee => !invitee.memberId && invitee.recipientLookupKey)) return direct;
  const contacts = await readGameVerifiedContacts(memberId);
  const keys = await verifiedGameContactKeys(getPrisma(), memberId, contacts);
  return addressedGameInvite(row.invitees, memberId, keys);
}

/** Token-scoped preview uses profile names only, never another viewer's labels. */
async function inviteAlreadyIn(row: GameRow, viewerId: string, blocks: GameBlocks) {
  const players = row.players.filter(hasGameIdentity).filter(player => !player.leftAt && player.memberId !== row.createdBy && !isHiddenBy(blocks, player.memberId)).sort((a, b) => a.seat - b.seat);
  const profiles = await getPrisma().gameProfile.findMany({ where: { memberId: { in: players.slice(0, 2).map(player => player.memberId) } }, select: { memberId: true, firstNameEncrypted: true, photoKey: true } });
  const ordered = players.slice(0, 2).flatMap(player => profiles.find(profile => profile.memberId === player.memberId) ?? []);
  const names = await openGameTexts(ordered.map(profile => ({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile", value: profile.firstNameEncrypted })));
  const first = ordered[0];
  let avatarUrl: string | null = null;
  if (first?.photoKey && servesSignedGameMedia()) {
    // Recheck the exact invitation, profile, participation and viewer masks before signing.
    const allowed = await getPrisma().game.findFirst({ where: { id: row.id, inviteTokenHash: row.inviteTokenHash,
      status: { in: ["invited", "live"] }, AND: [gameOnWhere()], players: { some: { memberId: first.memberId, leftAt: null,
        profile: { photoKey: first.photoKey, reportsReceived: { none: { reporterMemberId: viewerId, about: "player" } } } } } }, select: { id: true } });
    const currentBlocks = await readGameBlocks(getPrisma(), viewerId, [first.memberId]);
    if (allowed && !isHiddenBy(currentBlocks, first.memberId)) avatarUrl = (await gameMediaDelivery(first.photoKey, "avatar").catch(() => null))?.url ?? null;
  }
  return { count: players.length, firstNames: names.map(name => name ?? ""), avatarUrl };
}

/**
 * The uploader can see their photos. The current canonical profile photo is
 * also visible to shared game participants, including addressed rematches.
 * Other uploads require a visible entry (post-to-unlock, everything after
 * settle); private contact photos never acquire access from their label.
 */
export async function authorizeMediaRead(memberId: string, mediaKey: string, multiplayer = false): Promise<boolean> {
  return (await authorizeMediaReads(memberId, [mediaKey], multiplayer)).has(mediaKey);
}

/** The same live authority check for a bounded delivery batch, in one round trip. */
export async function authorizeMediaReads(memberId: string, mediaKeys: readonly string[], multiplayer = false): Promise<Set<string>> {
  return authorizeReads(memberId, mediaKeys, { unlocked: true, multiplayer });
}

/**
 * Another player's entry picture in a live game this member plays, before
 * this member has posted that day: for a signed delivery the app keeps hidden
 * until its own post is in. Every other rule of `authorizeMediaReads` holds
 * (no block either way, not reported, not withdrawn, the game still on, and
 * now live); only post-to-unlock moves to the app. It doesn't check the
 * day: its one caller signs only the previews views name, on the viewer's today.
 */
export async function authorizeLockedPreviewReads(memberId: string, mediaKeys: readonly string[], multiplayer = false): Promise<Set<string>> {
  return authorizeReads(memberId, mediaKeys, { unlocked: false, multiplayer });
}

async function authorizeReads(memberId: string, mediaKeys: readonly string[], mode: { unlocked: boolean; multiplayer: boolean }): Promise<Set<string>> {
  const allowed = new Set<string>();
  const others: Array<{ key: string; owner: string }> = [];
  for (const key of new Set(mediaKeys)) {
    const owner = mediaKeyOwner(key);
    if (owner === memberId) allowed.add(key);
    else if (owner) others.push({ key, owner });
  }
  if (others.length === 0) return allowed;
  const rows = await getPrisma().$queryRaw<Array<{ key: string }>>(Prisma.sql`
    WITH requested(key, owner) AS (
      VALUES ${Prisma.join(others.map(({ key, owner }) => Prisma.sql`(${key}::text, ${owner}::text)`))}
    )
    SELECT requested.key FROM requested
    WHERE NOT EXISTS (
      SELECT 1 FROM game_block blocked
      WHERE (blocked.blocker_member_id = ${memberId} AND blocked.blocked_member_id = requested.owner)
        OR (blocked.blocker_member_id = requested.owner AND blocked.blocked_member_id = ${memberId})
    ) AND (
      EXISTS (
        SELECT 1 FROM game_profile profile
        WHERE profile.member_id = requested.owner AND profile.photo_key = requested.key
          AND NOT EXISTS (SELECT 1 FROM game_report report
            WHERE report.reporter_member_id = ${memberId} AND report.about = 'player'
              AND report.reported_member_id = requested.owner)
          AND EXISTS (
            SELECT 1 FROM game
            WHERE ${gameOnSql("game")} AND ${mode.multiplayer ? Prisma.sql`TRUE` : Prisma.sql`game.max_players = 2`}
              AND NOT EXISTS (SELECT 1 FROM game_player departed
                WHERE departed.game_id = game.id AND departed.member_id = ${memberId} AND departed.left_at IS NOT NULL)
              AND (EXISTS (SELECT 1 FROM game_player player
                WHERE player.game_id = game.id AND player.member_id = ${memberId} AND player.left_at IS NULL)
                OR (game.status = 'invited' AND EXISTS (SELECT 1 FROM game_invitee invited WHERE invited.game_id = game.id AND invited.member_id = ${memberId})))
              AND (EXISTS (SELECT 1 FROM game_player player
                WHERE player.game_id = game.id AND player.member_id = requested.owner)
                OR (game.status = 'invited' AND EXISTS (SELECT 1 FROM game_invitee invited WHERE invited.game_id = game.id AND invited.member_id = requested.owner)))
          )
      ) OR EXISTS (
        SELECT 1 FROM game_entry entry
        JOIN game ON game.id = entry.game_id
        JOIN game_player viewer ON viewer.game_id = game.id AND viewer.member_id = ${memberId} AND viewer.left_at IS NULL
        WHERE entry.member_id = requested.owner AND entry.media_keys @> ARRAY[requested.key]::text[]
          AND entry.attempt > 0 AND entry.withdrawn_at IS NULL
          AND ${gameOnSql("game")} AND ${mode.multiplayer ? Prisma.sql`TRUE` : Prisma.sql`game.max_players = 2`}
          AND NOT EXISTS (SELECT 1 FROM game_report report
            WHERE report.entry_id = entry.id AND report.reporter_member_id = ${memberId})
          AND (${mode.unlocked ? Prisma.sql`(game.status = 'settled' OR EXISTS (
            SELECT 1 FROM game_entry own WHERE own.game_id = game.id
              AND own.member_id = ${memberId} AND own.day_index = entry.day_index AND own.attempt > 0
          ))` : Prisma.sql`game.status = 'live'`})
      )
    )
  `);
  for (const { key } of rows) allowed.add(key);
  return allowed;
}

// ------------------------------------------------------------ view assembly

/** What this member reported among these: posts, and players whose photo, they won't see again. */
async function readReportedBy(memberId: string, among: { entryIds?: string[]; gameIds?: string[]; players?: string[] }): Promise<{ entries: Set<string>; players: Set<string> }> {
  const rows = await getPrisma().gameReport.findMany({ select: { about: true, entryId: true, reportedMemberId: true }, where: { reporterMemberId: memberId, OR: [
    ...(among.entryIds ? [{ entryId: { in: among.entryIds } }] : []),
    ...(among.gameIds ? [{ entryId: { not: null }, gameId: { in: among.gameIds } }] : []),
    ...(among.players ? [{ about: "player", reportedMemberId: { in: among.players } }] : []),
  ] } });
  return {
    entries: new Set(rows.flatMap((row) => (row.entryId ? [row.entryId] : []))),
    players: new Set(rows.flatMap((row) => (row.about === "player" && row.reportedMemberId ? [row.reportedMemberId] : []))),
  };
}

function toTicketRow(ticket: {
  id: string;
  gameId: string;
  stakeKey: string;
  owedBySeats: number[];
  owedToSeats: number[];
  status: string;
  createdAt: Date;
  redeemedAt: Date | null;
}, players: readonly { seat: number; memberId: string | null }[]): GameTicketRow {
  return {
    createdAt: ticket.createdAt,
    gameId: ticket.gameId,
    id: ticket.id,
    owedBySeats: ticket.owedBySeats,
    owedToSeats: ticket.owedToSeats,
    players,
    redeemedAt: ticket.redeemedAt,
    stakeKey: ticket.stakeKey,
    status: ticket.status === "redeemed" ? "redeemed" : "open",
  };
}

/** Prepare only visible app content for the single decryption batch. */
function prepareEntryViewContent(input: {
  games: readonly LoadedGame[]; viewerId: string; clock: Date; home: boolean; history: boolean;
  hiddenEntryIds: ReadonlySet<string>; hiddenMemberIds: ReadonlySet<string>;
  replies: ReplyMetadata[]; replyReported: ReadonlySet<string>;
}, ask: (target: GameSealTarget, value: string | null) => number) {
  const { games, viewerId, clock, home, history, hiddenEntryIds, hiddenMemberIds, replies, replyReported } = input;
  const repliesByEntry = new Map(replies.map(reply => [reply.entryId, reply]));
  const replyAt = new Map<string, number>();
  const replyEligibleEntryIds = new Set<string>();
  const entryAt = new Map<string, { text: number; payload: number; kind: GameEntryKind }>();
  for (const game of games) {
    const visible = visibleEntryIds(game.state, viewerId, hiddenEntryIds, hiddenMemberIds);
    const access: ReplyContext = { state: game.state, visibleEntryIds: visible, hiddenMemberIds, reportedMemberIds: replyReported };
    for (const entry of game.entries) {
      if (!visible.has(entry.id)) continue;
      if (home && !isHomeEntry(game, viewerId, clock, entry)) continue;
      const reply = repliesByEntry.get(entry.id);
      if (!history && replyEligibility(viewerId, entry.id, access, gameNow(clock, game.row), !!reply) === null) replyEligibleEntryIds.add(entry.id);
      if (reply && replyReadAccess(viewerId, reply, access)) replyAt.set(entry.id,
        ask({ table: "game_reply", rowId: reply.id, field: "text", memberId: reply.authorMemberId }, reply.textEncrypted));
      const target = { memberId: entry.memberId, rowId: entry.id, table: "game_entry" as const };
      entryAt.set(entry.id, {
        text: ask({ ...target, field: "text" }, entry.textEncrypted),
        payload: ask({ ...target, field: "payload" }, entry.payloadEncrypted),
        kind: toEntryKind(entry.kind),
      });
    }
  }
  return { repliesByEntry, replyAt, replyEligibleEntryIds, entryAt };
}

/**
 * Decrypts exactly what each game's viewer may see (one batch), then builds
 * the views at each game's own now. A player blocked either way is shown the
 * way a player who left is: their seat and the viewer's name for them, no
 * photo, posts or days. Posts the viewer reported stay hidden.
 */
async function buildViewInputs(
  games: readonly LoadedGame[],
  viewerId: string,
  clock: Date,
  knownBlocks?: GameBlocks,
  options: { history?: boolean; multiplayer?: boolean; home?: boolean } = {},
): Promise<GameViewInput[]> {
  const { history = false, multiplayer = false, home = false } = options;
  if (games.length === 0) return [];
  const prisma = getPrisma();
  const memberIds = [...new Set([viewerId, ...games.flatMap((game) => gameMemberIds(game.row.players))])];
  // An addressed rematch's invitee isn't a player yet, but the challenger's label for them still applies.
  const labelSubjects = [...memberIds, ...games.flatMap(game => gameMemberIds(game.row.invitees))];
  // Replies exist only in 1v1 games; group-only and history reads add no queries.
  const pairGames = history ? [] : games.filter(game => game.row.maxPlayers === 2);
  const pairEntryIds = pairGames.flatMap(game => game.entries.map(entry => entry.id));
  const pairPeers = pairEntryIds.length ? [...new Set(pairGames.flatMap(game => gameMemberIds(game.row.players)))].filter(id => id !== viewerId) : [];
  const recapCandidates = games.filter(game => !history && game.row.recapEncrypted && game.entries.some(entry => entry.withdrawnReason === "removed"));
  const [profiles, labels, tickets, pendingViews, blocks, reported, challenges, talkViews, replies, replyReported, recapsWatched, storyWitnesses] = await Promise.all([
    prisma.gameProfile.findMany({ where: { memberId: { in: labelSubjects } } }),
    prisma.gameContactLabel.findMany({ where: { ownerMemberId: viewerId, subjectMemberId: { in: labelSubjects } } }),
    history ? [] : prisma.gameTicket.findMany({
      where: { gameId: { in: games.map((game) => game.row.id) } },
    }),
    history ? new Map() : readPendingChangeViews(games.map((game) => game.row)),
    knownBlocks ?? readGameBlocks(prisma, viewerId, labelSubjects),
    readReportedBy(viewerId, { gameIds: games.map((game) => game.row.id), players: labelSubjects }),
    readGameChallenges(prisma, games.filter(game => !history && (game.row.maxPlayers === 2 || multiplayer)).map(game => game.row.id)),
    readTalkDeliveryViews(games.filter(game => game.row.status === "negotiating").map(game => game.row.id), viewerId, history),
    pairEntryIds.length ? prisma.gameReply.findMany({ where: { entryId: { in: pairEntryIds } }, select: replyMetadataSelect }) : [],
    readReplyReportedMembers(prisma, viewerId, pairPeers),
    readRecapsWatched(games.filter(game => game.row.status === "settled").map(game => game.row.id), viewerId, history),
    recapCandidates.length ? readGameRecapStoryWitnesses(prisma, recapCandidates.map(game => game.row.id)) : new Map<string, readonly string[] | null>(),
  ]);
  // The row was read first; a replacement since then would pair its clean witness with older words.
  const currentRecaps = new Map((recapCandidates.length ? await prisma.game.findMany({
    where: { id: { in: recapCandidates.map(game => game.row.id) } }, select: { id: true, recapEncrypted: true },
  }) : []).map(game => [game.id, game.recapEncrypted]));
  const hiddenEntryIds = reported.entries;
  const hiddenMemberIds = new Set([...blocks.blocked, ...blocks.blockedBy]);
  const recapSuppressed = games.map((game) => game.state.players.some((player) => hiddenMemberIds.has(player.memberId))
    || game.entries.some((entry) => hiddenEntryIds.has(entry.id))
    || game.state.players.some((player) => player.memberId !== viewerId && reported.players.has(player.memberId))
    || storyWitnesses.has(game.row.id) && (currentRecaps.get(game.row.id) !== game.row.recapEncrypted
      || game.entries.some(entry => entry.withdrawnReason === "removed"
        && gameRecapStoryMayQuoteEntry(storyWitnesses.get(game.row.id) ?? null, entry.id))));

  // One decrypt batch: words, names, labels, invite bits, visible entries.
  const requests: Array<GameSealTarget & { value: string | null }> = [];
  const ask = (target: GameSealTarget, value: string | null) => {
    requests.push({ ...target, value });
    return requests.length - 1;
  };
  const wordsAt = games.map((game) => ask(gameTarget(game.row, "terms_words"), game.row.termsWordsEncrypted));
  const recapAt = games.map((game, index) => !history && game.row.recapEncrypted && !recapSuppressed[index]
    ? ask(gameTarget(game.row, "recap"), game.row.recapEncrypted)
    : null);
  // Deleted seats expose only the current viewer's own sealed name.
  const departedAt = games.map(game => game.row.players.filter(player => player.memberId === null).map(player => ({
    seat: player.seat,
    joinedOn: player.joinedAt && player.timeZone ? gameLocalDate(player.joinedAt, player.timeZone) : null,
    eligibleFromDay: player.dayOne && player.timeZone ? eligibleFromDay(game.state, { ...player, memberId: "", timeZone: player.timeZone, dayOne: fromDbDate(player.dayOne) }) : null,
    name: ask(labelTarget(viewerId, "name"), departedLabels(player.departedLabel).find(label => label.ownerMemberId === viewerId)?.nameEncrypted ?? null),
  })));
  const profileNameAt = new Map(profiles.map((profile) => [
    profile.memberId,
    ask({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile" },
      history && !multiplayer && profile.memberId === viewerId ? null : profile.firstNameEncrypted),
  ]));
  const labelNameAt = new Map(labels.map((label) => [label.subjectMemberId, ask(labelTarget(viewerId, "name"), label.nameEncrypted)]));
  const labelRelationshipAt = new Map((history ? [] : labels).map((label) => [
    label.subjectMemberId,
    ask(labelTarget(viewerId, "relationship"), label.relationshipEncrypted),
  ]));
  // A game's own link belongs to its people: while invited, the challenger and
  // an addressed invitee; after go-live, both players (the token is spent).
  const tokenAt = games.map((game) => {
    if (history) return null;
    const { row } = game;
    const holds = row.status === "invited"
      ? row.createdBy === viewerId || row.invitees.some(invitee => invitee.memberId === viewerId)
      : game.state.players.some((player) => player.memberId === viewerId);
    return holds ? ask(gameTarget(row, "invite_token"), row.inviteTokenEncrypted) : null;
  });
  const inviteAt = games.map((game) => {
    if (history) return null;
    const { row } = game;
    // An addressed rematch whose challenger left still shows its invitee in their seat.
    if (row.status !== "invited" && !(row.players.some(player => player.leftAt !== null) && row.invitees.some(invitee => invitee.memberId === viewerId))) return null;
    const invitation = row.invitees.find(invitee => !row.players.some(player => player.seat === invitee.seat));
    if (!invitation) return null;
    if (row.createdBy === viewerId) {
      const pending = parsePendingLabel(invitation.pendingLabel);
      return {
        memberId: invitation.memberId,
        name: ask(labelTarget(viewerId, "name"), pending.nameEncrypted),
        photoKey: pending.photoKey,
        relationship: ask(labelTarget(viewerId, "relationship"), pending.relationshipEncrypted),
      };
    }
    // The addressed invitee sees themselves by their own name, never the challenger's private label.
    if (invitation.memberId === viewerId) return { memberId: viewerId, name: null, photoKey: null, relationship: null };
    return null;
  });
  const { repliesByEntry, replyAt, replyEligibleEntryIds, entryAt } = prepareEntryViewContent({
    games, viewerId, clock, home, history, hiddenEntryIds, hiddenMemberIds, replies, replyReported,
  }, ask);
  const plain = await openGameTexts(requests);

  const names = new Map<string, string>();
  for (const profile of profiles) {
    const labelIndex = labelNameAt.get(profile.memberId);
    const labelName = profile.memberId !== viewerId && labelIndex !== undefined ? plain[labelIndex] : null;
    names.set(profile.memberId, labelName ?? plain[profileNameAt.get(profile.memberId)!] ?? "");
  }
  // Only the viewer's own invite photos and relationships: nobody else ever sees them.
  const avatarKeys = new Map(labels.map((label) => [label.subjectMemberId, reported.players.has(label.subjectMemberId) ? null : label.photoKey]));
  const profileAvatarKeys = new Map(profiles.map((profile) => [profile.memberId, reported.players.has(profile.memberId) ? null : profile.photoKey]));
  const relationships = new Map([...labelRelationshipAt].map(([memberId, at]) => [memberId, plain[at]]));
  /** The invite's own typed relationship, else the viewer's existing label for an addressed rematch. */
  const inviteeRelationship = (invite: NonNullable<(typeof inviteAt)[number]>) => {
    const typed = invite.relationship === null ? null : plain[invite.relationship];
    return typed ?? (invite.memberId ? relationships.get(invite.memberId) ?? null : null);
  };
  const entryReplies = new Map([...replyAt].map(([entryId, at]) => [entryId, replyView(repliesByEntry.get(entryId)!, viewerId, plain[at])]));
  const entryWords = new Map([...entryAt].map(([entryId, at]) => [entryId, {
    text: plain[at.text], data: parseStoredGameEntryData(at.kind, plain[at.payload]),
  }]));
  return games.map((game, index) => {
    const invite = inviteAt[index];
    const tokenIndex = tokenAt[index];
    const result: StoredResult | null = game.row.result ? parseStoredResult(game.row.result) : null;
    return {
      multiplayer, home, groupsEnabled: areGameGroupsEnabled(), audienceKey: game.row.audienceKey,
      challenges: challenges.get(game.row.id) ?? [],
      pendingChange: pendingViews.get(game.row.id) ?? null,
      talkDelivery: talkViews.get(game.row.id),
      recapWatched: recapsWatched.has(game.row.id),
      recapPending: game.row.status === "settled" && game.row.recapEncrypted === null && !!game.row.chatContainerMemberId
        && game.row.settledAt !== null && clock.getTime() - game.row.settledAt.getTime() < GAME_RECAP_UI_WAIT_MS,
      avatarKeys,
      profileAvatarKeys,
      entryWords, ...(history ? {} : { entryReplies, replyEligibleEntryIds }),
      inviteExpiresAt: game.row.inviteExpiresAt,
      inviteToken: tokenIndex === null ? null : plain[tokenIndex],
      invitee: invite
        ? {
          memberId: invite.memberId,
          name: (invite.name === null ? names.get(viewerId) : plain[invite.name]) ?? "",
          photoKey: invite.photoKey,
          relationship: inviteeRelationship(invite),
        }
        : null,
      names,
      relationships,
      departed: departedAt[index].map(departed => ({ ...departed, name: plain[departed.name] ?? "" })),
      hiddenEntryIds,
      hiddenMemberIds,
      now: gameNow(clock, game.row),
      result,
      recap: recapAt[index] === null ? null : hostedGameRecapSchema.parse(JSON.parse(plain[recapAt[index]!] ?? "null")),
      round: game.row.round,
      previousGameId: game.row.previousGameId,
      startedAt: game.row.startedAt,
      state: game.state,
      tickets: tickets.filter((ticket) => ticket.gameId === game.row.id).map(ticket => toTicketRow(ticket, game.row.players)),
      viewerId,
      words: parseTermWords(plain[wordsAt[index]] ?? ""),
    };
  });
}

function isHomeEntry(game: LoadedGame, viewerId: string, clock: Date, entry: Pick<GameEntry, "memberId" | "dayIndex">): boolean {
  if (game.row.maxPlayers === 2 || entry.memberId === viewerId) return true;
  const viewer = playerFor(game.state, viewerId);
  return game.row.status === "live" && !!viewer && entry.dayIndex === dayIndexAt(viewer, gameNow(clock, game.row));
}

async function buildViews(games: readonly LoadedGame[], viewerId: string, clock: Date, knownBlocks?: GameBlocks, multiplayer = false): Promise<GameView[]> {
  return (await buildViewInputs(games, viewerId, clock, knownBlocks, { multiplayer })).map(buildGameView);
}

async function buildHistoryViews(games: readonly LoadedGame[], viewerId: string, clock: Date, multiplayer = false): Promise<BuiltGameHistoryView[]> {
  return (await buildViewInputs(games, viewerId, clock, undefined, { history: true, multiplayer }))
    .flatMap((input) => buildGameHistoryView(input) ?? []);
}

/** One indexed receipt batch; delivery truth stays with the existing outbox owner. */
async function readPendingChangeViews(rows: readonly Pick<Game, "id" | "wordsOwnerMemberId" | "pendingChange">[]): Promise<Map<string, GamePendingChange>> {
  const hydrated = await readPendingGameChanges(rows);
  const pending = rows.flatMap((row) => {
    const proposal = hydrated.get(row.id);
    if (!proposal) return [];
    // A neutral chat opener never proves this proposal was delivered.
    const key = `game-change:${row.id}:${proposal.id}`;
    return [{ gameId: row.id, proposal, key: createHostedLinqDeliveryIdempotencyLookupKey(key) }];
  });
  if (!pending.length) return new Map();
  const keys = pending.flatMap((item) => item.key ? [item.key] : []);
  const receipts = await getPrisma().hostedLinqDelivery.findMany({ where: { idempotencyKey: { in: keys } },
    select: { idempotencyKey: true, status: true } });
  const statuses = new Map(receipts.map((receipt) => [receipt.idempotencyKey, receipt.status]));
  return new Map(pending.map(({ gameId, proposal, key }) => {
    if (proposal.origin === "chat") return [gameId, { ...proposal, deliveryStatus: "conversation", deliveryRetryable: false }];
    const status = key ? statuses.get(key) : undefined;
    const terminal = status === "failed" || status === "skipped";
    return [gameId, { ...proposal,
      deliveryStatus: terminal ? "failed" : status === "accepted" || status === "delivered" || status === "sent_no_receipt_expected" ? "sent" : proposal.deliveryStatus,
      deliveryRetryable: !terminal,
    }];
  }));
}

/** The settled games whose recap the viewer finished, on any phone. */
async function readRecapsWatched(gameIds: readonly string[], viewerId: string, history: boolean): Promise<Set<string>> {
  if (history || !gameIds.length) return new Set();
  const events = await getPrisma().gameEvent.findMany({ where: { gameId: { in: [...gameIds] }, actor: viewerId, type: "recap_watched" },
    select: { gameId: true }, take: gameIds.length });
  return new Set(events.map(event => event.gameId));
}

/** The note author's delivery view comes from the talk receipt, never a mutable game field. */
async function readTalkDeliveryViews(gameIds: readonly string[], viewerId: string, history: boolean): Promise<Map<string, NonNullable<GameView["talkDelivery"]>>> {
  if (history || !gameIds.length) return new Map();
  const db = getPrisma();
  const events = await db.gameEvent.findMany({ where: { gameId: { in: [...gameIds] }, actor: viewerId, type: "talk_requested" },
    select: { gameId: true, payload: true }, take: gameIds.length });
  const talks = events.flatMap(event => {
    const payload = parseGameTalkPayload(event.payload);
    const key = payload && createHostedLinqDeliveryIdempotencyLookupKey(`game-talk:${event.gameId}:${payload.proposalId}`);
    return key ? [{ gameId: event.gameId, key }] : [];
  });
  if (!talks.length) return new Map();
  const receipts = await db.hostedLinqDelivery.findMany({ where: { idempotencyKey: { in: talks.map(talk => talk.key) } },
    select: { idempotencyKey: true, status: true } });
  const statuses = new Map(receipts.map(receipt => [receipt.idempotencyKey, receipt.status]));
  return new Map(talks.map(talk => {
    const status = statuses.get(talk.key);
    return [talk.gameId, status === "failed" || status === "skipped" ? "failed"
      : status === "accepted" || status === "delivered" || status === "sent_no_receipt_expected" ? "sent" : "pending"];
  }));
}
