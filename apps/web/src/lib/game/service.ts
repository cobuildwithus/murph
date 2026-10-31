import "server-only";

import { hostedGameRecapSchema, type HostedGameChatState, type HostedGameRecap } from "@murphai/hosted-execution/runtime-control";
import { gameChatProgress } from "./chat-progress";
import { randomBytes } from "node:crypto";

import { Prisma, type Game, type GameEntry, type GamePlayer, type GameReport } from "@prisma/client";

import { toPrismaJsonObject } from "../device-sync/prisma-store/prisma-json";
import { isUniqueViolation } from "../device-sync/prisma-store/prisma-errors";
import { generateHostedRandomPrefixedId, isRecord, sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { areGameDevToolsAllowed, gameOnSql, gameOnWhere, isGameEnabled, isGameEnabledFor, isGameOn, mediaKeyOwner, mediaKeyPrefixFor } from "./access";
import { parseGameCommand } from "./command";
import { moderateGameCommand } from "./moderation";
import { parseStoredGameEntryData } from "./entry-data";
import {
  GAME_ENTRY_KINDS,
  type GamePendingChange,
  type AcceptInviteBody,
  type GameChange,
  type GameCommand,
  type GameDayOutcome,
  type GameEntryKind,
  type GameError,
  type GameHistoryView,
  type GameHomeView,
  type GameProfileView,
  type GameInvitePreview,
  type GameStatus,
  type GameView,
} from "./contract";
import { labelTarget, openGameTexts, sealGameText, type GameSealTarget } from "./crypto";
import { isGameMediaStorageAvailable, statGameMedia } from "./media";
import {
  currentTerms,
  dayIndexAt,
  liveEntry,
  attemptsUsed,
  isScheduledDay,
  decideCancelInvite,
  decideDayCompletion,
  decideDevAdvance,
  decideJoin,
  decideNegotiationStart,
  decideNewTerms,
  decidePost,
  decideSettle,
  decideStartNow,
  decideWithdraw,
  GAME_ERROR_STATUS,
  GAME_INVITE_TTL_MS,
  GAME_MAX_LENGTH_DAYS,
  GAME_SEATS_1V1,
  GameRuleError,
  isGameDue,
  isGameInviteExpired,
  isTicketExpired,
  liveRosterKey,
  needsPostToday,
  parseStoredResult,
  parseStoredTerms,
  parseTermWords,
  playerFor,
  reject,
  settleDueAt,
  type RuleState,
  type Schedule,
  type StoredResult,
  type TermWords,
} from "./rules";
import { addDays, dayStartInstant, GAME_GRACE_MS, gameLocalDate } from "./time";
import { agreedDayOne, gameChangeCancellationNeedsNotice, decideApprovedGameChange, pendingGameChangeView, decideGameChange, gameChangeControls, gameChangeRefusal, isGameChangeExpired, isGameChangeOutdated, isSameGameChange, parsePendingGameChange, type StoredGamePendingChange } from "./changes";
import { prepareGameChangeWords, readPendingGameChanges, type PreparedGameChangeWords } from "./change-words";
import { deliverGameChangeProposal } from "./chat-delivery";
import { readGameChatCandidateIds, sameGamePlayers } from "./chat-membership";
import { reserveGameChatLifecycleTx, reserveGameChatProposalTx, skipGameChatLifecycleTx } from "./chat-lifecycle-receipt";
import { reserveGameMissedDayTx } from "./chat-lifecycle-receipt";
import { canScheduleMissedDayCheckIn, firstDatesOfMissRuns, isMissedCheckInDueNow, missedCheckInDueAt, visitGameMissedCheckInPages, type MissedCheckInDay } from "./missed-check-in";
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
import { gameWordsMemberId, parseGameDepartedPlayer } from "./account-deletion";
import { areGamePlayersBlocked, GAME_BLOCK_LIMIT, isHiddenBy, lockGamePair, readGameBlocks, type GameBlocks } from "./blocks";
import { GAME_REPORT_ALERTS_PER_REPORTER_DAY, sendGameReportAlert } from "./report-alert";

export { mediaKeyPrefixFor } from "./access";

type Tx = Prisma.TransactionClient;
type Db = Tx | ReturnType<typeof getPrisma>;
type GameRow = Game & { players: GamePlayer[] };
interface LoadedGame {
  row: GameRow;
  entries: GameEntry[];
  state: RuleState;
}
export type GameCommandResult =
  | { ok: true; game: GameView | null; profile?: GameProfileView; dayOutcome?: GameDayOutcome }
  | { ok: false; error: GameError; status: number };

const SYSTEM_ACTOR = "system";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOME_CANDIDATE_LIMIT = 50;
const HOME_SETTLED_SHOWN = 3;
const HISTORY_PEOPLE_LIMIT = 50;
const HISTORY_GAMES_PER_PERSON_LIMIT = 50;
const HOME_EXPIRED_SHOWN = 3;
const HOME_EXPIRED_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const WALLET_LIMIT = 200;
// Five games, each with at most three legacy per-miss stakes owed by one loser.
const CHAT_TICKET_LIMIT = 5 * 3 * GAME_MAX_LENGTH_DAYS;
const ACTIVE_STATUSES = ["invited", "negotiating", "live"];
// Open games a block ends per batch; it repeats until none is left.
const BLOCK_GAME_LIMIT = 50;

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
  command: unknown;
  chatContainerMemberId?: string;
  chatPlayerMemberIds?: readonly string[];
  beforeMutationTx?: (tx: Prisma.TransactionClient) => Promise<void>;
  now?: Date;
  postGuard?: { dayIndex: number; replaceEntryId: string | null };
}): Promise<GameCommandResult> {
  const actor = input.actorMemberId;
  try {
    const command = parseGameCommand(input.command);
    moderateGameCommand(command);
    await requireUploadedMedia(actor, command);
    if (command.type === "setProfile") {
      return { game: null, ok: true, profile: await setProfile(actor, command) };
    }
    const applied = await runCommand({ actor, now: input.now, chatContainerMemberId: input.chatContainerMemberId, chatPlayerMemberIds: input.chatPlayerMemberIds, beforeMutationTx: input.beforeMutationTx, postGuard: input.postGuard }, command);
    const gameId = typeof applied === "object" && applied !== null ? applied.gameId : applied;
    const dayOutcome = typeof applied === "object" && applied !== null ? applied.dayOutcome : undefined;
    if ((command.type === "proposeChange" || command.type === "negotiate") && !input.chatContainerMemberId && gameId) {
      const proposalId = command.proposalId;
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
    if (command.type === "createGame" && command.previousGameId && gameId === command.gameId) {
      try {
        const { deliverGameChatLifecycle } = await import("./chat-lifecycle");
        await deliverGameChatLifecycle(command.gameId, "rematch");
      } catch {
        // Creation committed with one durable receipt. The lifecycle sweep owns
        // retry; a missing bound room intentionally leaves no receipt at all.
      }
    }
    return { game: gameId && !input.chatContainerMemberId ? await readGame(gameId, actor) : null, ok: true, ...(dayOutcome ? { dayOutcome } : {}) };
  } catch (error) {
    if (error instanceof GameRuleError) {
      return { error: error.error, ok: false, status: GAME_ERROR_STATUS[error.error.code] };
    }
    throw error;
  }
}

interface CommandContext {
  postGuard?: { dayIndex: number; replaceEntryId: string | null };
  actor: string;
  chatContainerMemberId?: string;
  chatPlayerMemberIds?: readonly string[];
  beforeMutationTx?: (tx: Prisma.TransactionClient) => Promise<void>;
  now?: Date;
}

/** Applies one command; returns the game to show back, if any. */
async function runCommand(context: CommandContext, command: Exclude<GameCommand, { type: "setProfile" }>): Promise<string | null | { gameId: string; dayOutcome: GameDayOutcome }> {
  switch (command.type) {
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
    case "unblock":
      return unblock(context, command.memberId);
  }
}

/** Every media key a command names must be the actor's own finished upload. */
async function requireUploadedMedia(actor: string, command: GameCommand): Promise<void> {
  const labelPhoto = command.type === "setProfile" ? command.photoKey
    : command.type === "createGame" ? command.inviteeLabel?.photoKey : null;
  const keys = command.type === "post" ? command.mediaKeys : labelPhoto ? [labelPhoto] : [];
  if (keys.length === 0) return;
  const prefix = mediaKeyPrefixFor(actor);
  const owned = isGameMediaStorageAvailable() && keys.every((key) => key.startsWith(prefix));
  const stored = owned ? await Promise.all(keys.map((key) => statGameMedia(key))) : [null];
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

type GameEventType = "day_marked_incomplete" | "day_restored" | "cancelled" | "blocked" | "removed" | "negotiation_joined" | "created" | "joined" | "started" | "posted" | "withdrew" | "settled" | "redeemed" | "expired" | "time_shifted" | "change_proposed" | "change_applied" | "change_declined" | "change_cancelled" | "change_expired";
/** What changed, for the history: ids and numbers only, never words. */
interface GameEventDraft {
  commandKey?: string;
  type: GameEventType;
  payload: Prisma.InputJsonObject;
}

async function writeEvents(tx: Tx, gameId: string, actor: string, events: readonly GameEventDraft[], chatOrigin = false): Promise<void> {
  if (events.length === 0) return;
  await tx.gameEvent.createMany({
    data: events.map((event) => ({ actor, gameId, commandKey: event.commandKey, payload: { v: 1, ...event.payload }, type: event.type })),
  });
  if (events.some((event) => event.type === "started")) {
    await reserveGameChatLifecycleTx({ gameId, kind: "started", now: new Date(), tx });
  }
  for (const event of events) {
    if (!chatOrigin && event.type === "change_proposed" && typeof event.payload.proposalId === "string") {
      await reserveGameChatProposalTx({ gameId, proposalId: event.payload.proposalId, now: new Date(), tx });
    }
  }
}

/** Locks the game, runs one step, and records what it changed. A step that changes nothing returns no events. */
async function runLocked(
  gameId: string,
  context: CommandContext,
  step: (locked: LockedStep) => Promise<GameEventDraft[]>,
): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    // Match account deletion's owner-before-game lock order. The callback's
    // runtime/owner locks remain held through the following game mutation.
    await context.beforeMutationTx?.(tx);
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    if (locked.length === 0) reject("GAME_NOT_FOUND", "Game not found.");
    const [loaded] = await loadGames(tx, [gameId]);
    // Nobody acts on a game that is off, whatever they hold.
    if (context.actor !== SYSTEM_ACTOR && !isGameOn(loaded.row)) reject("GAME_NOT_FOUND", "Game not found.");
    if (context.chatContainerMemberId && !sameGamePlayers(loaded.row.players.map((player) => player.memberId), context.chatPlayerMemberIds ?? [])) {
      reject("NOT_A_PLAYER", "This game belongs to the two players in this chat.");
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

function gameTarget(game: Pick<Game, "id" | "createdBy" | "departedPlayer">, field: string): GameSealTarget {
  return { field, memberId: gameWordsMemberId(game), rowId: game.id, table: "game" };
}

async function setProfile(actor: string, command: Extract<GameCommand, { type: "setProfile" }>): Promise<GameProfileView> {
  const target: GameSealTarget = { field: "first_name", memberId: actor, rowId: actor, table: "game_profile" };
  const firstNameEncrypted = command.firstName === undefined ? undefined : await seal(target, command.firstName);
  const data = {
    ...(firstNameEncrypted === undefined ? {} : { firstNameEncrypted }),
    ...(command.timeZone === undefined ? {} : { timeZone: command.timeZone }),
    ...(command.photoKey === undefined ? {} : { photoKey: command.photoKey }),
  };
  const prisma = getPrisma();
  // Partial updates never read then rewrite unrelated fields. RETURNING also
  // makes the response describe this write, not a later concurrent update.
  const profile = firstNameEncrypted !== undefined && command.timeZone !== undefined
    ? await prisma.gameProfile.upsert({
      create: { ...data, firstNameEncrypted, memberId: actor, timeZone: command.timeZone },
      update: data,
      where: { memberId: actor },
    })
    : (await prisma.gameProfile.updateManyAndReturn({ data, where: { memberId: actor } }))[0];
  if (!profile) return reject("PROFILE_REQUIRED", "Add your first name and time zone first.");
  const [firstName] = await openGameTexts([{ ...target, value: profile.firstNameEncrypted }]);
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

async function createGame(context: CommandContext, command: Extract<GameCommand, { type: "createGame" }>): Promise<string> {
  const { actor } = context;
  const { gameId, inviteeLabel } = command;
  const prisma = getPrisma();
  const profile = await prisma.gameProfile.findUnique({ select: { timeZone: true }, where: { memberId: actor } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");
  const existing = await prisma.game.findUnique({ select: { createdBy: true }, where: { id: gameId } });
  if (existing) {
    if (existing.createdBy !== actor) reject("INVALID_REQUEST", "That game id is taken.");
    return gameId;
  }
  const rematch = command.previousGameId ? await readRematch(actor, command.previousGameId, context.now ?? new Date()) : null;
  // Only a listed member starts a fresh game; anyone may rematch the one other player of a game that is on.
  if (!isGameOn({ players: [{ memberId: actor }], inviteeMemberId: rematch?.inviteeMemberId })) {
    reject("GAME_DISABLED", "Starting a game is invite only for now.");
  }
  if (rematch?.answer?.createdBy) {
    const termsVersion = currentTerms(parseStoredTerms(rematch.answer.terms)).n;
    return joinGame(context, { id: rematch.answer.id, createdBy: rematch.answer.createdBy }, { termsVersion, timeZone: profile.timeZone });
  }
  const newTerms = decideNewTerms(command.terms, {
    newKey: () => generateHostedRandomPrefixedId("gsk"),
    today: gameLocalDate(context.now ?? new Date(), profile.timeZone),
  });
  const token = randomBytes(24).toString("base64url");
  const where = { createdBy: actor, departedPlayer: null, id: gameId };
  const [termsWordsEncrypted, inviteTokenEncrypted, nameEncrypted, relationshipEncrypted] = await Promise.all([
    seal(gameTarget(where, "terms_words"), JSON.stringify(newTerms.words)),
    seal(gameTarget(where, "invite_token"), token),
    seal(labelTarget(actor, "name"), command.inviteeFirstName),
    inviteeLabel?.relationship ? seal(labelTarget(actor, "relationship"), inviteeLabel.relationship) : null,
  ]);
  try {
    const answer = await prisma.$transaction(async (tx) => {
      const now = context.now ?? await databaseNow(tx);
      // A block since the rematch was read, under the lock a block takes.
      const inviteeMemberId = rematch?.inviteeMemberId ?? null;
      const pending = await revalidateRematchCreationTx({ actor, inviteeMemberId, now, previousGameId: command.previousGameId, tx });
      if (pending) return pending;
      const chatContainerMemberId = inviteeMemberId ? rematch?.chatContainerMemberId ?? null : null;
      await tx.game.create({
        data: {
          createdBy: actor,
          chatContainerMemberId,
          id: gameId,
          inviteExpiresAt: new Date(now.getTime() + GAME_INVITE_TTL_MS),
          inviteTokenEncrypted,
          inviteTokenHash: sha256Hex(token),
          lengthDays: newTerms.lengthDays,
          startsOn: newTerms.startsOn ? toDbDate(newTerms.startsOn) : null,
          pendingLabel: { nameEncrypted, photoKey: inviteeLabel?.photoKey ?? null, relationshipEncrypted },
          // The time zone here is a placeholder; it freezes when the game goes live.
          players: { create: { memberId: actor, seat: 0, timeZone: profile.timeZone } },
          previousGameId: command.previousGameId ?? null,
          inviteeMemberId,
          round: rematch?.round ?? 1,
          status: "invited",
          terms: toPrismaJsonObject(newTerms.terms),
          termsWordsEncrypted,
        },
      });
      const previous = command.previousGameId ? { previousGameId: command.previousGameId } : {};
      await writeEvents(tx, gameId, actor, [{ payload: { round: rematch?.round ?? 1, ...previous }, type: "created" }]);
      if (chatContainerMemberId) await reserveGameChatLifecycleTx({ gameId, kind: "rematch", now, tx });
      return null;
    });
    // Joining rechecks the selected invitation under the same pair lock.
    // Keep its loading/crypto preparation outside the creation transaction.
    if (answer?.createdBy) {
      return joinGame(context, { id: answer.id, createdBy: answer.createdBy }, {
        termsVersion: currentTerms(parseStoredTerms(answer.terms)).n, timeZone: profile.timeZone,
      });
    }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.game.findUnique({ select: { createdBy: true }, where: { id: gameId } });
    if (raced?.createdBy !== actor) reject("INVALID_REQUEST", "That game id is taken.");
  }
  return gameId;
}

async function revalidateRematchCreationTx(input: {
  actor: string;
  inviteeMemberId: string | null;
  now: Date;
  previousGameId?: string;
  tx: Tx;
}): Promise<RematchAnswer | null> {
  if (!input.inviteeMemberId || !input.previousGameId) return null;
  await lockGamePair(input.tx, input.actor, input.inviteeMemberId);
  await rejectBlockedPair(input.tx, input.actor, input.inviteeMemberId, "You can't rematch this game.");
  return assertLatestBetween(input.actor, input.inviteeMemberId, input.previousGameId, input.now, input.tx);
}

/**
 * A rematch must follow a finished game the challenger played. After a settled
 * game with exactly one other player, it continues the round count and is
 * addressed to that player, the only one who can accept it, on their Home.
 * When that player already sent their own rematch of it, `answer` is theirs.
 */
async function readRematch(
  actor: string,
  previousGameId: string,
  now: Date,
): Promise<{ round: number; inviteeMemberId: string | null; chatContainerMemberId: string | null; answer?: RematchAnswer }> {
  const previous = await getPrisma().game.findUnique({
    include: { players: { select: { memberId: true } } },
    where: { id: previousGameId },
  });
  const finished = previous?.status === "settled" || previous?.status === "void";
  if (!previous || !finished || !previous.players.some((player) => player.memberId === actor)) {
    reject("INVALID_REQUEST", "A rematch needs a finished game you played.");
  }
  if (previous.status !== "settled") return { inviteeMemberId: null, chatContainerMemberId: null, round: 1 };
  const others = previous.players.filter((player) => player.memberId !== actor);
  if (others.length !== 1) return { inviteeMemberId: null, chatContainerMemberId: null, round: previous.round + 1 };
  await rejectBlockedPair(getPrisma(), actor, others[0].memberId, "You can't rematch this game.");
  const answer = await assertLatestBetween(actor, others[0].memberId, previous.id, now);
  return { inviteeMemberId: others[0].memberId, chatContainerMemberId: previous.chatContainerMemberId, round: previous.round + 1, ...(answer ? { answer } : {}) };
}

type RematchAnswer = Pick<Game, "id" | "createdBy" | "terms">;

/**
 * An addressed rematch only follows the pair's newest game: refuse it while
 * they have a game going or an open invite between them (it could never be
 * accepted), or when a later game between them has already settled.
 */
async function assertLatestBetween(actor: string, otherId: string, previousGameId: string, now: Date, tx?: Tx): Promise<RematchAnswer | null> {
  const prisma = tx ?? getPrisma();
  const bothPlayed = { AND: [{ players: { some: { memberId: actor } } }, { players: { some: { memberId: otherId } } }] };
  const pending = await prisma.game.findFirst({
    select: { createdBy: true, id: true, inviteeMemberId: true, previousGameId: true, terms: true },
    where: {
      OR: [
        { liveRosterKey: liveRosterKey([actor, otherId]) },
        {
          inviteExpiresAt: { gt: now },
          OR: [{ createdBy: actor, inviteeMemberId: otherId }, { createdBy: otherId, inviteeMemberId: actor }],
          status: "invited",
        },
      ],
    },
  });
  // Both asked for a rematch of the same game: the second ask accepts the first (a retry finds it live).
  if (pending?.createdBy === otherId && pending.inviteeMemberId === actor && pending.previousGameId === previousGameId) return pending;
  if (pending) reject("ALREADY_IN_A_GAME", tx ? "These players already have a game going." : await alreadyPlayingMessage(otherId));
  const latest = await prisma.game.findFirst({
    orderBy: [{ settledAt: "desc" }, { id: "desc" }],
    select: { id: true },
    where: { ...bothPlayed, status: "settled" },
  });
  if (latest && latest.id !== previousGameId) {
    const name = tx ? null : await firstNameOf(otherId);
    reject("REMATCH_OUTDATED", name ? `There's a newer game with ${name}.` : "There's a newer game between you two.");
  }
  return null;
}

async function join(context: CommandContext, command: Extract<GameCommand, { type: "join" }>): Promise<string> {
  const target = await getPrisma().game.findUnique({
    select: { createdBy: true, id: true },
    where: { inviteTokenHash: sha256Hex(command.token) },
  });
  if (!target) reject("INVITE_NOT_FOUND", "Invite not found.");
  if (!target.createdBy) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
  return joinGame(context, { ...target, createdBy: target.createdBy }, command);
}

async function joinGame(context: CommandContext, target: { id: string; createdBy: string }, body: AcceptInviteBody): Promise<string> {
  const { actor } = context;
  const prisma = getPrisma();
  const profile = await prisma.gameProfile.findUnique({ select: { memberId: true }, where: { memberId: actor } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");
  // A finished game between these same people that nobody opened must not block this one.
  const sameRoster = await prisma.game.findMany({
    select: { id: true },
    where: { liveRosterKey: liveRosterKey([target.createdBy, actor]) },
  });
  await loadCurrent(sameRoster.map((game) => game.id));
  try {
    await accept(context, body, target.id, target.createdBy);
  } catch (error) {
    // Either the friendly check below or, when two of their games go live at once, the unique key.
    const together = isUniqueViolation(error) || (error instanceof GameRuleError && error.error.code === "ALREADY_IN_A_GAME");
    if (!together) throw error;
    reject("ALREADY_IN_A_GAME", await alreadyPlayingMessage(target.createdBy));
  }
  return target.id;
}

/** From the caller's side, naming the other player by their own first name. */
async function alreadyPlayingMessage(otherId: string): Promise<string> {
  const name = await firstNameOf(otherId);
  return name ? `You and ${name} already have a game going.` : "You two already have a game going.";
}

/** A player's own first name, or null without a profile. */
async function firstNameOf(memberId: string): Promise<string | null> {
  const profile = await getPrisma().gameProfile.findUnique({ select: { firstNameEncrypted: true }, where: { memberId } });
  const [name] = await openGameTexts(profile
    ? [{ field: "first_name", memberId, rowId: memberId, table: "game_profile", value: profile.firstNameEncrypted }]
    : []);
  return name ?? null;
}

/** A join or negotiation takes the pair's lock before the game's, as a block does. */
function withPairLock(context: CommandContext, other: string): CommandContext {
  return { ...context, beforeMutationTx: async (tx) => {
    await context.beforeMutationTx?.(tx);
    await lockGamePair(tx, context.actor, other);
  } };
}

/** Blocked either way: to the one who was blocked, the invite just closed. */
async function rejectBlockedJoin(tx: Tx, creator: string, actor: string): Promise<void> {
  await rejectBlockedPair(tx, actor, creator, "This invite isn't open anymore.");
}

async function accept(context: CommandContext, command: AcceptInviteBody, gameId: string, creator: string): Promise<void> {
  const { actor } = context;
  await runLocked(gameId, withPairLock(context, creator), async ({ loaded, now, tx }) => {
    await rejectBlockedJoin(tx, creator, actor);
    const { row } = loaded;
    const decision = decideJoin(await withCurrentTimeZones(tx, loaded.state), {
      acceptNegotiation: row.pendingChange === null,
      memberId: actor,
      now,
      termsVersion: command.termsVersion,
      timeZone: command.timeZone,
    });
    if (decision.kind === "already-joined") return [];
    // The unique live_roster_key is the real guard; this gives the friendly error.
    const roster = liveRosterKey(decision.players.map((player) => player.memberId));
    if (await tx.game.findFirst({ select: { id: true }, where: { liveRosterKey: roster, id: { not: gameId } } })) {
      reject("ALREADY_IN_A_GAME", "These players already have a game going.");
    }
    const claimed = playerFor(loaded.state, actor);
    if (!claimed) await tx.gamePlayer.create({ data: { gameId: row.id, memberId: actor, seat: decision.seat, timeZone: command.timeZone } });
    await writeSchedule(tx, row.id, decision);
    await tx.game.update({
      data: { liveRosterKey: roster, startedAt: decision.startedAt, status: "live" },
      where: { id: row.id },
    });
    await copyPendingLabel(tx, row, actor);
    return [
      ...(!claimed ? [{ payload: { seat: decision.seat }, type: "joined" as const }] : []),
      { payload: { startNow: false }, type: "started" },
    ];
  });
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
async function copyPendingLabel(tx: Tx, row: GameRow, joinerId: string): Promise<void> {
  const label = parsePendingLabel(row.pendingLabel);
  if (!label.nameEncrypted && !label.relationshipEncrypted && !label.photoKey) return;
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
  await runLocked(gameId, context, async ({ tx, loaded, clock }) => {
    if (decideCancelInvite(loaded.state, context.actor) === "already-void") return [];
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

/** Murph's reply in the bound chat already explains this outcome; a lifecycle notice there would repeat it. */
function answeredInBoundChat(context: CommandContext, loaded: LoadedGame): boolean {
  return context.chatContainerMemberId !== undefined && context.chatContainerMemberId === loaded.row.chatContainerMemberId;
}

function needsChatLifecycleNotice(context: CommandContext, loaded: LoadedGame): boolean {
  return Boolean(loaded.row.chatContainerMemberId) && !answeredInBoundChat(context, loaded);
}

/** Settled or void: the roster is free to start another game together. */
async function endGame(tx: Tx, gameId: string, data: Prisma.GameUpdateInput): Promise<void> {
  await tx.game.update({ data: { ...data, pendingChange: Prisma.DbNull, liveRosterKey: null }, where: { id: gameId } });
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
  let notification: Awaited<ReturnType<typeof claimGamePostNotification>> = null;
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
    if (context.postGuard && (decision.dayIndex !== context.postGuard.dayIndex || decision.withdrawEntryId !== context.postGuard.replaceEntryId)) {
      reject("INVALID_REQUEST", "The current check-in changed. Read the game before confirming a replacement.");
    }
    if (decision.withdrawEntryId) {
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
        gameId, actor, players: loaded.row.players, clock, entries: loaded.state.entries, dayIndex,
      });
    }
    return [{ payload: { attempt, dayIndex, entryId, graceUsed, kind }, type: "posted" }];
  });
  sendGamePostNotificationAfterResponse(notification);
  return gameId;
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
    await tx.gameEntry.update({ data: { withdrawnAt: clock, withdrawnReason: "withdrawn" }, where: { id: change.entryId } });
    return [{ payload: change, type: "withdrew" }];
  });
  return gameId;
}

async function redeem(context: CommandContext, command: Extract<GameCommand, { type: "redeem" }>): Promise<string> {
  const { actor } = context;
  const { ticketId } = command;
  const ticket = await getPrisma().gameTicket.findUnique({ select: { gameId: true, owedTo: true }, where: { id: ticketId } });
  if (!ticket || ticket.owedTo !== actor) reject("TICKET_NOT_HELD", "That prize isn't yours to mark done.");
  await runLocked(ticket.gameId, context, async ({ clock, now, tx }) => {
    const current = await tx.gameTicket.findUniqueOrThrow({ select: { createdAt: true, owedBy: true, status: true }, where: { id: ticketId } });
    if (isTicketExpired(current, now)) reject("TICKET_EXPIRED", "This prize expired before it was used.");
    // Blocked either way reads the same as having left.
    if (current.status === "open" && (current.owedBy === null || await areGamePlayersBlocked(tx, actor, current.owedBy))) {
      reject("INVALID_REQUEST", "They left Murph, so this prize can't be marked done.");
    }
    // Already redeemed matches no row: a repeat, not an error.
    const changed = await tx.gameTicket.updateMany({
      data: { redeemedAt: clock, status: "redeemed" },
      where: { id: ticketId, owedTo: actor, status: "open" },
    });
    return changed.count === 1 ? [{ payload: { ticketId }, type: "redeemed" }] : [];
  });
  return ticket.gameId;
}

// ------------------------------------------------------------ report, block

/** Every game two people both joined, and an addressed rematch between them. */
function gamesBetween(a: string, b: string): Prisma.GameWhereInput {
  return { OR: [
    { AND: [{ players: { some: { memberId: a } } }, { players: { some: { memberId: b } } }] },
    { createdBy: a, inviteeMemberId: b },
    { createdBy: b, inviteeMemberId: a },
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

/**
 * Blocks someone the actor plays or played with, or whoever sent the invite
 * they hold. Under the pair's lock, so no join slips in: every game the two
 * have open or going is called off (void: no winner, no tickets), an invite
 * nobody shook on ends as if cancelled, and their games leave the shared chat
 * with nothing still waiting to be sent there, so Murph stops texting it about
 * them (posts can't happen, so no pushes either). The views then show each to
 * the other as a player who left.
 */
async function block(context: CommandContext, command: { memberId?: string; token?: string }): Promise<null> {
  const { actor } = context;
  const prisma = getPrisma();
  const memberId = command.token === undefined ? command.memberId ?? "" : (await inviteFor(command.token, actor)).creator;
  if (memberId === actor) reject("INVALID_REQUEST", "You can't block yourself.");
  if (command.token === undefined && !await prisma.game.findFirst({ select: { id: true }, where: gamesBetween(actor, memberId) })) {
    reject("NOT_A_PLAYER", "You can only block someone you play with.");
  }
  await prisma.$transaction(async (tx) => {
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
        where: { AND: [gamesBetween(actor, memberId), { status: { in: ACTIVE_STATUSES } }] } })).map((game) => game.id);
      if (batch.length === 0) break;
      await tx.$queryRaw`SELECT id FROM game WHERE id = ANY(${batch}::text[]) ORDER BY id FOR UPDATE`;
      for (const game of await tx.game.findMany({ select: { id: true, status: true }, where: { id: { in: batch }, status: { in: ACTIVE_STATUSES } } })) {
        await endGame(tx, game.id, { status: "void" });
        await writeEvents(tx, game.id, actor, [{ payload: {}, type: game.status === "invited" ? "cancelled" : "blocked" }]);
      }
      ids.push(...batch);
    }
    // Every game of theirs still bound to a chat lets go of it, in one statement.
    const unbound = await tx.game.updateManyAndReturn({ data: { chatContainerMemberId: null }, select: { id: true },
      where: { AND: [gamesBetween(actor, memberId), { chatContainerMemberId: { not: null } }] } });
    await skipGameChatLifecycleTx(tx, [...new Set([...ids, ...unbound.map((game) => game.id)])], await databaseNow(tx));
    if (!existing) await tx.gameBlock.create({ data: { blockedMemberId: memberId, blockerMemberId: actor } });
  });
  return null;
}

/** Changes no game: what a block called off stays called off. */
async function unblock(context: CommandContext, memberId: string): Promise<null> {
  await getPrisma().gameBlock.deleteMany({ where: { blockedMemberId: memberId, blockerMemberId: context.actor } });
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
  const reported = entry?.memberId ?? invite?.creator ?? loaded.state.players.find((player) => player.memberId !== actor)?.memberId;
  if (!reported || reported === actor) reject("NOT_A_PLAYER", "There's no one to report in this game.");
  return { entry, fromInvite: invite !== null, gameId, reportedMemberId: reported, ...await reportSnapshot(loaded, command.about, entry, reported) };
}

/** The game a report is in: one the actor plays, or the open invite they hold. */
async function readReportedGame(actor: string, command: ReportCommand) {
  const invite = command.token === undefined ? null : await inviteFor(command.token, actor);
  if (invite && !invite.open) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
  const gameId = invite?.gameId ?? command.gameId ?? "";
  const [loaded] = await loadGames(getPrisma(), [gameId]);
  if (!loaded || (!invite && !playerFor(loaded.state, actor))) reject("NOT_A_PLAYER", "You're not in this game.");
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
 * A report on the other player's post, their name and photo, or the task and
 * stake they wrote; from inside a game (finished too) or from an invite before
 * accepting it. The row is the record, with a sealed snapshot; the views hide
 * a reported post, and a reported player's photo, from the reporter from then
 * on. Then a person is told. The same id, or the same post again, is the same
 * report and retries its alert. The reported player is never told who.
 */
async function report(context: CommandContext, command: ReportCommand): Promise<string | null> {
  const { actor } = context;
  const subject = await readReportSubject(actor, command);
  const target = (field: string): GameSealTarget => ({ field, memberId: actor, rowId: command.reportId, table: "game_report" });
  const [noteEncrypted, snapshotTextEncrypted] = await Promise.all([
    command.note ? seal(target("note"), command.note) : null,
    subject.snapshotText ? seal(target("snapshot"), subject.snapshotText) : null,
  ]);
  let stored: GameReport | null = null;
  await runLocked(subject.gameId, context, async ({ clock, loaded, tx }) => {
    const sameId = await tx.gameReport.findUnique({ where: { id: command.reportId } });
    if (sameId && sameId.reporterMemberId !== actor) reject("INVALID_REQUEST", "That report id is taken.");
    const prior = sameId ?? (subject.entry ? await tx.gameReport.findUnique({
      where: { reporterMemberId_entryId: { entryId: subject.entry.id, reporterMemberId: actor } } }) : null);
    if (prior) {
      stored = prior;
      return [];
    }
    // Under the lock: still theirs to see, still someone to report, still not blocked.
    const visible = subject.entry === null || visibleEntryIds(loaded.state, actor).has(subject.entry.id);
    const present = subject.fromInvite ? loaded.row.createdBy === subject.reportedMemberId && loaded.row.status === "invited"
      : playerFor(loaded.state, actor) !== undefined && playerFor(loaded.state, subject.reportedMemberId) !== undefined;
    if (!visible || !present) reject("INVALID_REQUEST", "This changed. Take another look.");
    if (await areGamePlayersBlocked(tx, actor, subject.reportedMemberId)) reject("NOT_A_PLAYER", "There's no one to report in this game.");
    stored = await tx.gameReport.create({ data: {
      about: command.about, createdAt: clock, entryId: subject.entry?.id ?? null, gameId: subject.gameId, id: command.reportId,
      noteEncrypted, reason: command.reason, reportedMemberId: subject.reportedMemberId, reporterMemberId: actor,
      snapshotMediaKeys: subject.snapshotMediaKeys, snapshotTextEncrypted,
    } });
    return [];
  });
  const row = stored as GameReport | null;
  if (!row) throw new Error("Game report produced no row.");
  if (command.block) await block(context, subject.fromInvite ? { token: command.token } : { memberId: subject.reportedMemberId });
  if (await isReportAlertDue(row)) {
    await sendGameReportAlert({
      about: command.about, blocked: command.block === true, createdAt: row.createdAt, entryKind: subject.entry ? toEntryKind(subject.entry.kind) : null,
      fromInvite: subject.fromInvite, gameId: subject.gameId, reason: command.reason, reportId: row.id,
    });
  }
  // From an invite there's no game of theirs to show back.
  return subject.fromInvite ? null : subject.gameId;
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
 * no one and nobody but its poster can read its upload again.
 */
export async function removeGamePostForReview(entryId: string): Promise<boolean> {
  const entry = await getPrisma().gameEntry.findUnique({ select: { gameId: true }, where: { id: entryId } });
  if (!entry) return false;
  let removed = false;
  // As the system: ops takes a post down whether or not its game is still on.
  await runLocked(entry.gameId, { actor: SYSTEM_ACTOR }, async ({ clock, tx }) => {
    const changed = await tx.gameEntry.updateMany({ where: { id: entryId, OR: [{ withdrawnReason: null }, { withdrawnReason: { not: "removed" } }] },
      data: { blurHash: null, mediaKeys: [], payloadEncrypted: null, textEncrypted: null, withdrawnAt: clock, withdrawnReason: "removed" } });
    removed = changed.count === 1;
    return removed ? [{ payload: { entryId }, type: "removed" }] : [];
  });
  return removed;
}

// ------------------------------------------------------------------- settle

/**
 * Ends one game if it's due, deciding with the game's clock under its lock:
 * an unclaimed invite past its expiry becomes void; a live game past its last
 * day freezes its result and issues tickets.
 */
async function settleGame(gameId: string, actor = SYSTEM_ACTOR): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    if (locked.length === 0) return;
    const [{ row, state }] = await loadGames(tx, [gameId]);
    const clock = await databaseNow(tx);
    if (!isGameDue(state, gameNow(clock, row))) return;
    if (state.game.status === "invited" || state.game.status === "negotiating") {
      await endGame(tx, gameId, { status: "void" });
      await writeEvents(tx, gameId, actor, [{ payload: {}, type: "expired" }]);
      return;
    }
    if (state.game.status !== "live") return;
    const decision = decideSettle(state);
    const tickets = decision.tickets.map((ticket) => ({ ...ticket, gameId, id: generateHostedRandomPrefixedId("gtk"),
      ...(row.devClockOffsetMs === null ? {} : { createdAt: gameNow(clock, row) }) }));
    await tx.gameTicket.createMany({ data: tickets });
    await endGame(tx, gameId, { result: toPrismaJsonObject(decision.result), settledAt: clock, status: "settled" });
    if (state.game.status === "live" && row.chatContainerMemberId) {
      await reserveGameChatLifecycleTx({ gameId, kind: "recap", now: clock, tx });
    }
    const scores = decision.result.scores.map(({ score, seat }) => ({ score, seat }));
    await writeEvents(tx, gameId, actor, [{ payload: { scores, ticketIds: tickets.map((ticket) => ticket.id) }, type: "settled" }]);
  });
}

// --------------------------------------------------------------------- dev

function assertDevTools(): void {
  if (!areGameDevToolsAllowed()) throw new Error("Game dev tools are off in production.");
}

async function runDevStep(gameId: string, memberId: string, step: (locked: LockedStep) => Promise<GameEventDraft[]>): Promise<GameView> {
  assertDevTools();
  await runLocked(gameId, { actor: memberId }, async (locked) => {
    if (!playerFor(locked.loaded.state, memberId)) reject("NOT_A_PLAYER", "You're not in this game.");
    return step(locked);
  });
  return requireView(gameId, memberId);
}

export async function devStartNow(gameId: string, memberId: string): Promise<GameView> {
  return runDevStep(gameId, memberId, async ({ loaded, now, tx }) => {
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

export async function devAdvanceDays(gameId: string, memberId: string, days: number): Promise<GameView> {
  return runDevStep(gameId, memberId, async ({ loaded, tx }) =>
    shiftClock(tx, loaded.row, decideDevAdvance(loaded.state, days).addMs));
}

/** Moves the game's clock to its settle time, then settles it the ordinary way. */
export async function devSettleNow(gameId: string, memberId: string): Promise<GameView> {
  assertDevTools();
  await runLocked(gameId, { actor: memberId }, async ({ loaded, now, tx }) => {
    if (!playerFor(loaded.state, memberId)) reject("GAME_NOT_FOUND", "Game not found.");
    if (loaded.row.status !== "live") reject("GAME_NOT_LIVE", "This game isn't live.");
    const shift = settleDueAt(loaded.state).getTime() - now.getTime();
    return shift > 0 ? shiftClock(tx, loaded.row, shift) : [];
  });
  await settleGame(gameId, memberId);
  return requireView(gameId, memberId);
}

async function requireView(gameId: string, memberId: string): Promise<GameView> {
  const view = await readGame(gameId, memberId);
  if (!view) reject("GAME_NOT_FOUND", "Game not found.");
  return view;
}

function storedChangeWords(prepared: PreparedGameChangeWords, change: GameChange) {
  const stored = { ...prepared };
  delete stored.baseWordsEncrypted;
  const structural = { ...change };
  if (structural.kind === "edit") { delete structural.tasks; delete structural.stakes; }
  return { ...stored, change: structural };
}
function assertPreparedWords(row: Game, prepared: PreparedGameChangeWords): void {
  if (prepared.baseWordsEncrypted !== undefined && row.termsWordsEncrypted !== prepared.baseWordsEncrypted) reject("TERMS_CHANGED", "The game changed. Take another look.");
}

/** Claiming a seat proposes terms; it never accepts the original challenge. */
async function negotiate(context: CommandContext, command: Extract<GameCommand, { type: "negotiate" }>): Promise<string> {
  const prisma = getPrisma();
  const owner = await prisma.game.findUnique({ where: { inviteTokenHash: sha256Hex(command.token) } });
  if (!owner) reject("INVITE_NOT_FOUND", "Invite not found.");
  if (!owner.createdBy) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
  const creator = owner.createdBy;
  if (creator === context.actor) reject("NOT_A_PLAYER", "Only the invited player can suggest changes here.");
  if (!await prisma.gameProfile.findUnique({ where: { memberId: context.actor }, select: { memberId: true } })) reject("PROFILE_REQUIRED", "Add your first name first.");
  const prepared = await prepareGameChangeWords(owner, command.change, command.termsVersion);
  const roster = liveRosterKey([creator, context.actor]);
  const existing = await prisma.game.findMany({ where: { liveRosterKey: roster }, select: { id: true } });
  await loadCurrent(existing.map((game) => game.id));
  try {
    await runLocked(owner.id, withPairLock(context, creator), async ({ tx, loaded, now }) => {
      await rejectBlockedJoin(tx, creator, context.actor);
      const key = `game-change:${owner.id}:${command.proposalId}`;
      const prior = await tx.gameEvent.findUnique({ where: { commandKey: key }, select: { actor: true } });
      if (prior?.actor === context.actor && playerFor(loaded.state, context.actor)) return [];
      const joined = decideJoin(await withCurrentTimeZones(tx, loaded.state), { memberId: context.actor, termsVersion: command.termsVersion, timeZone: command.timeZone, now });
      if (joined.kind !== "join") reject("INVITE_USED", "This invite was already used.");
      if (await tx.game.findFirst({ where: { liveRosterKey: roster }, select: { id: true } })) reject("ALREADY_IN_A_GAME", "These players already have a game going.");
      assertPreparedWords(loaded.row, prepared);
      const negotiation: RuleState = { ...loaded.state, game: { ...loaded.state.game, status: "negotiating" },
        players: [...loaded.state.players, { memberId: context.actor, seat: joined.seat, timeZone: command.timeZone, dayOne: null }] };
      const decision = decideGameChange(negotiation, context.actor, command.change, now);
      const pending = { v: prepared.termsWordsEncrypted ? 2 : 1, id: command.proposalId, proposedByMemberId: context.actor,
        expectedTermsVersion: command.termsVersion, origin: "app", deliveryStatus: "pending", ...decision, ...storedChangeWords(prepared, decision.change) };
      await tx.gamePlayer.create({ data: { gameId: owner.id, memberId: context.actor, seat: joined.seat, timeZone: command.timeZone } });
      await tx.game.update({ where: { id: owner.id }, data: { status: "negotiating", liveRosterKey: roster,
        inviteeMemberId: context.actor, pendingChange: toPrismaJsonObject(pending) } });
      await copyPendingLabel(tx, loaded.row, context.actor);
      return [
        { type: "negotiation_joined", payload: { seat: joined.seat } },
        { type: "change_proposed", commandKey: key, payload: { proposalId: command.proposalId, expectedTermsVersion: command.termsVersion, effectiveFromDay: 0 } },
      ];
    });
  } catch (error) {
    if (isUniqueViolation(error)) reject("ALREADY_IN_A_GAME", await alreadyPlayingMessage(creator));
    throw error;
  }
  return owner.id;
}

/** A proposal's identity is retained in the ordinary history after it is resolved. */
async function proposeChange(context: CommandContext, command: Extract<GameCommand, { type: "proposeChange" }>): Promise<string> {
  const owner = await getPrisma().game.findFirst({ where: { id: command.gameId, players: { some: { memberId: context.actor } } } });
  if (!owner) reject("NOT_A_PLAYER", "This game belongs to its players.");
  const prepared = await prepareGameChangeWords(owner, command.change, command.expectedTermsVersion);
  await runLocked(command.gameId, context, async ({ tx, loaded, now, clock }) => {
    if (!playerFor(loaded.state, context.actor)) reject("NOT_A_PLAYER", "This game belongs to its players.");
    const key = `game-change:${command.gameId}:${command.proposalId}`;
    const prior = await tx.gameEvent.findUnique({ where: { commandKey: key }, select: { actor: true } });
    // Either player can retry delivery. The original proposer and exact change
    // remain immutable; replay never counts as the other player's agreement.
    if (prior) return [];
    const pending = parsePendingGameChange(loaded.row.pendingChange);
    if (pending && !isGameChangeExpired(loaded.state, pending, now)) reject("CHANGE_PENDING", "There is already a change waiting for agreement in chat.");
    if (currentTerms(loaded.state.game.terms).n !== command.expectedTermsVersion) reject("TERMS_CHANGED", "The game changed. Take another look.");
    const agreement = await agreeToDeclinedChange({ tx, loaded, now, clock }, context, command, key);
    if (agreement) return agreement;
    const decision = decideGameChange(loaded.state, context.actor, command.change, now);
    assertPreparedWords(loaded.row, prepared);
    const proposal = {
      id: command.proposalId, proposedByMemberId: context.actor,
      expectedTermsVersion: command.expectedTermsVersion,
      origin: context.chatContainerMemberId ? "chat" : "app",
      deliveryStatus: context.chatContainerMemberId ? "conversation" as const : "pending" as const, ...decision, ...storedChangeWords(prepared, decision.change),
    };
    await tx.game.update({ where: { id: command.gameId }, data: { pendingChange: toPrismaJsonObject({ v: prepared.termsWordsEncrypted ? 2 : 1, ...proposal }) } });
    return [
      ...(pending ? [{ type: "change_expired" as const, payload: { proposalId: pending.id } }] : []),
      { type: "change_proposed", commandKey: key, payload: { proposalId: proposal.id, expectedTermsVersion: proposal.expectedTermsVersion, effectiveFromDay: proposal.effectiveFromDay } },
    ];
  });
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

async function respondChange(context: CommandContext, command: Extract<GameCommand, { type: "respondChange" }>): Promise<string> {
  if (command.decision !== "cancel" && (!context.chatContainerMemberId || !context.beforeMutationTx)) reject("NOT_A_PLAYER", "Agree to this change in the game's shared chat.");
  let refusal: string | null = null;
  await runLocked(command.gameId, context, async ({ tx, loaded, now, clock }) => {
    if (!playerFor(loaded.state, context.actor)) reject("NOT_A_PLAYER", "This game belongs to its players.");
    const proposal = parsePendingGameChange(loaded.row.pendingChange);
    const resolutionKey = `game-change-resolved:${command.gameId}:${command.proposalId}`;
    if (!proposal || proposal.id !== command.proposalId) {
      const prior = await tx.gameEvent.findUnique({ where: { commandKey: resolutionKey }, select: { type: true, actor: true } });
      const expectedType = command.decision === "approve" ? "change_applied" : command.decision === "decline" ? "change_declined" : "change_cancelled";
      if (prior?.type === expectedType && prior.actor === context.actor) return [];
      reject("CHANGE_EXPIRED", "That proposal is no longer waiting for agreement.");
    }
    const proposer = proposal.proposedByMemberId === context.actor;
    if ((command.decision === "cancel") !== proposer) reject("NOT_A_PLAYER", proposer ? "The other player needs to agree." : "Only the proposer can cancel this change.");
    const clear = () => tx.game.update({ where: { id: command.gameId }, data: { pendingChange: Prisma.DbNull } });
    if (command.decision !== "approve") {
      if (gameChangeCancellationNeedsNotice(proposal, command.decision, answeredInBoundChat(context, loaded))) {
        await reserveGameChatLifecycleTx({ gameId: command.gameId, kind: "change_cancelled", proposalId: proposal.id, now: clock, tx });
      }
      await clear();
      return [{ commandKey: resolutionKey, type: command.decision === "cancel" ? "change_cancelled" : "change_declined", payload: closedChangePayload(proposal, command.decision) }];
    }
    if (isGameChangeOutdated(loaded.state, proposal, now)) {
      await clear(); refusal = "That proposal is no longer waiting for agreement.";
      return [{ commandKey: resolutionKey, type: "change_expired", payload: { proposalId: proposal.id } }];
    }
    if (loaded.state.game.status === "negotiating") loaded.state = await withCurrentTimeZones(tx, loaded.state);
    let decision: ReturnType<typeof decideGameChange>;
    try {
      decision = decideApprovedGameChange(loaded.state, context.actor, proposal, now);
    } catch (error) {
      if (!(error instanceof GameRuleError)) throw error;
      refusal = error.message;
      await clear();
      if (needsChatLifecycleNotice(context, loaded)) await reserveGameChatLifecycleTx({ gameId: command.gameId, kind: "change_expired", proposalId: proposal.id, now: clock, tx });
      return [{ commandKey: resolutionKey, type: "change_expired", payload: { proposalId: proposal.id, reason: refusal } }];
    }
    return applyApprovedChange({ tx, loaded, now, clock }, command.gameId, proposal, resolutionKey, context.actor, decision);
  });
  if (refusal) reject("CHANGE_EXPIRED", refusal);
  return command.gameId;
}

/** A word-free declined proposal is kept so the decliner can still take it (agreeToDeclinedChange). */
function closedChangePayload(proposal: StoredGamePendingChange, decision: "decline" | "cancel"): Prisma.InputJsonObject {
  return decision === "decline" && !proposal.termsWordsEncrypted
    ? { proposalId: proposal.id, declined: toPrismaJsonObject({ v: 1, ...proposal }) } : { proposalId: proposal.id };
}

async function applyApprovedChange(locked: LockedStep, gameId: string, proposal: StoredGamePendingChange, resolutionKey: string, actor: string, decision: ReturnType<typeof decideGameChange>): Promise<GameEventDraft[]> {
  const { tx, loaded, now, clock } = locked;
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
  if (loaded.state.game.status === "negotiating") {
    const agreedState: RuleState = { ...loaded.state, game: { ...loaded.state.game, terms, lengthDays: lengthDays ?? loaded.state.game.lengthDays,
      ...(proposal.change.kind === "edit" && proposal.change.startsOn === null ? { startsOn: null } : {}) } };
    const schedule = decideNegotiationStart(agreedState, actor, now, proposal.startsOn);
    await writeSchedule(tx, gameId, schedule);
    await tx.game.update({ where: { id: gameId }, data: { status: "live", startedAt: clock } });
    return [
      { commandKey: resolutionKey, type: "change_applied", payload: { proposalId: proposal.id, termsVersion: next.n, effectiveFromDay: 0 } },
      { type: "started", payload: { startNow: proposal.change.kind === "start_now" } },
    ];
  }
  const dayOne = agreedDayOne(loaded.state, proposal, next.fromDay, next.schedule, startsOn);
  if (dayOne) await tx.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: toDbDate(dayOne) } });
  return [{ commandKey: resolutionKey, type: "change_applied", payload: { proposalId: proposal.id, termsVersion: next.n, effectiveFromDay: next.fromDay } }];
}

export type GameChatState = HostedGameChatState;

/** Shared, word-minimized context for the existing-room rematch notice. */
export async function readGameRematchNotice(gameId: string, playerMemberIds: readonly string[], now = new Date()) {
  if (!sameGamePlayers(playerMemberIds, playerMemberIds)) return null;
  const prisma = getPrisma();
  const current = await prisma.game.findUnique({ where: { id: gameId }, select: { previousGameId: true } });
  if (!current?.previousGameId) return null;
  const loaded = await loadGames(prisma, [gameId, current.previousGameId]);
  const rematch = loaded[0];
  const previous = loaded[1];
  if (!rematch || !previous || rematch.row.status !== "invited" || isGameInviteExpired(rematch.state.game, now) || previous.row.status !== "settled"
    || !rematch.row.createdBy || !rematch.row.inviteeMemberId
    || !sameGamePlayers([rematch.row.createdBy, rematch.row.inviteeMemberId], playerMemberIds)
    || !sameGamePlayers(previous.row.players.map((player) => player.memberId), playerMemberIds)) return null;
  const profile = await prisma.gameProfile.findUnique({
    where: { memberId: rematch.row.createdBy }, select: { firstNameEncrypted: true },
  });
  if (!profile) return null;
  const plain = await openGameTexts([
    { ...gameTarget(previous.row, "terms_words"), value: previous.row.termsWordsEncrypted },
    { ...gameTarget(rematch.row, "terms_words"), value: rematch.row.termsWordsEncrypted },
    { field: "first_name", table: "game_profile", rowId: rematch.row.createdBy, memberId: rematch.row.createdBy, value: profile.firstNameEncrypted },
  ]);
  if (!plain[0] || !plain[1] || !plain[2]) return null;
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
  const previousRules = rules(previous, plain[0], new Map(previous.row.players.map((player) => [player.seat, player.memberId])));
  const rematchRules = rules(rematch, plain[1], new Map([[0, rematch.row.createdBy], [1, rematch.row.inviteeMemberId]]));
  if (!previousRules || !rematchRules) return null;
  return {
    requesterName: plain[2],
    previous: previousRules,
    rematch: rematchRules,
    startsOn: fromDbDate(rematch.row.startsOn),
  };
}

/** Shared-chat projection intentionally never calls the viewer-private app view. */
export async function readGameChatState(containerMemberId: string, playerMemberIds: readonly string[], actorMemberId?: string): Promise<GameChatState> {
  if (playerMemberIds.length !== 2 || new Set(playerMemberIds).size !== 2) return { games: [] };
  const prisma = getPrisma();
  // A block ends the pair's game chat: Murph has no game to talk about there.
  if (await areGamePlayersBlocked(prisma, playerMemberIds[0], playerMemberIds[1])) return { games: [] };
  const candidateIds = await readGameChatCandidateIds(playerMemberIds);
  const candidates = await prisma.game.findMany({ where: { id: { in: candidateIds } },
    orderBy: { createdAt: "desc" }, take: 5, include: { players: true } });
  const current = await loadCurrent(candidates.filter((row) => row.players.length === 2 && isGameOn(row)).map((row) => row.id));
  const loadedById = new Map(current.games.map((game) => [game.row.id, game]));
  const rows = current.games.map((game) => game.row).filter((row) => row.players.length === 2 && isGameOn(row));
  const profiles = await prisma.gameProfile.findMany({ where: { memberId: { in: [...new Set(rows.flatMap((row) => row.players.map((player) => player.memberId)))] } },
    select: { memberId: true, firstNameEncrypted: true } });
  const plain = await openGameTexts([
    ...rows.map((row) => ({ ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted })),
    ...profiles.map((profile) => ({ field: "first_name", table: "game_profile" as const, rowId: profile.memberId, memberId: profile.memberId, value: profile.firstNameEncrypted })),
  ]);
  const names = new Map(profiles.map((profile, index) => [profile.memberId, plain[rows.length + index] ?? ""]));
  const [pendingViews, tickets, actorProfile] = await Promise.all([
    readPendingChangeViews(rows),
    prisma.gameTicket.findMany({ where: { gameId: { in: rows.filter((row) => row.status === "settled").map((row) => row.id) } }, take: CHAT_TICKET_LIMIT + 1, orderBy: { id: "asc" } }),
    actorMemberId ? prisma.gameProfile.findUnique({ where: { memberId: actorMemberId }, select: { chatPhotoIntroducedAt: true, chatPhotoOffer: true } }) : null,
  ]);
  const clock = current.clock;
  if (tickets.length > CHAT_TICKET_LIMIT) throw new Error("Game ticket projection exceeds its rule bound.");
  const offer = isRecord(actorProfile?.chatPhotoOffer) ? actorProfile.chatPhotoOffer : null;
  const hasPendingOffer = offer?.containerMemberId === containerMemberId && offer.resolutionMessageRef === null
    && typeof offer.expiresAt === "string" && Date.parse(offer.expiresAt) > clock.getTime();
  return { ...(actorProfile ? { photoCheckIn: { introductionAvailable: actorProfile.chatPhotoIntroducedAt === null, hasPendingOffer } } : {}), games: rows.map((row, index) => {
    const state = loadedById.get(row.id)!.state;
    const words = parseTermWords(plain[index] ?? "");
    const result = row.result === null ? null : parseStoredResult(row.result);
    const ticketGroups = new Map<string, { owedByMemberId: string; owedToMemberId: string; what: string; status: "open" | "redeemed" | "expired"; count: number }>();
    for (const ticket of tickets.filter((ticket) => ticket.gameId === row.id)) {
      const view = ticketView({ ...ticket, status: ticket.status === "redeemed" ? "redeemed" : "open" }, words, "", gameNow(clock, row));
      const key = JSON.stringify([view.owedByMemberId, view.owedToMemberId, view.what, view.status]);
      const existing = ticketGroups.get(key);
      if (existing) existing.count += 1;
      else ticketGroups.set(key, { owedByMemberId: view.owedByMemberId, owedToMemberId: view.owedToMemberId, what: view.what, status: view.status, count: 1 });
    }
    const pendingChange = pendingGameChangeView(state, pendingViews.get(row.id) ?? null, gameNow(clock, row));
    const { checkInKind, ...terms } = termsView(state, words);
    return { id: row.id, status: state.game.status, terms: { ...terms, ...(checkInKind === "any" ? {} : { checkInKind }) },
      progress: gameChatProgress(state, gameNow(clock, row)),
      result: result ? { scores: result.scores, tickets: [...ticketGroups.values()] } : null,
      startsOn: fromDbDate(row.players[0]?.dayOne ?? row.startsOn), lengthDays: row.lengthDays,
      players: row.players.map((player) => ({ memberId: player.memberId, seat: player.seat, firstName: names.get(player.memberId) ?? "", dayOne: fromDbDate(player.dayOne), timeZone: player.timeZone })),
      pendingChange, changeControls: gameChangeControls(state, gameNow(clock, row), pendingChange),
    };
  }) };
}

/** Bounded hourly-sharded sweep; lifecycle receipts own retries after discovery. */
export async function reserveDueGameMissedDayCheckIns(now = new Date()): Promise<number> {
  const prisma = getPrisma();
  const shard = Math.floor(now.getTime() / 60_000) % 60;
  let reserved = 0;
  await visitGameMissedCheckInPages({
    readPage: async (cursor, limit) => (await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM game
      WHERE status = 'live' AND chat_container_member_id IS NOT NULL
        AND mod(abs(hashtext(id)::bigint), 60) = ${shard}
        AND id > ${cursor}
      ORDER BY id LIMIT ${limit}`).map((row) => row.id),
    visit: async (ids) => {
      const loaded = await loadGames(prisma, [...ids]);
      for (const game of loaded) {
        const schedule = currentTerms(game.state.game.terms).schedule;
        if (!canScheduleMissedDayCheckIn({ boundRoomId: game.row.chatContainerMemberId, gameStatus: game.row.status, schedule })) continue;
        for (const player of game.state.players) {
          if (!player.dayOne) continue;
          const days: MissedCheckInDay[] = Array.from({ length: game.row.lengthDays }, (_, dayIndex) => {
            const date = addDays(player.dayOne!, dayIndex);
            if (!isScheduledDay(game.state, dayIndex)) return { date, status: "off" as const };
            const entry = liveEntry(game.state.entries, player.memberId, dayIndex);
            if (entry) return { date, status: entry.incomplete ? "incomplete" as const : "posted" as const };
            const closed = now.getTime() >= dayStartInstant(addDays(date, 1), player.timeZone).getTime() + GAME_GRACE_MS;
            return { date, status: closed ? "missed" as const : "open" as const };
          });
          for (const run of firstDatesOfMissRuns(days)) {
            const dueAt = missedCheckInDueAt(run.firstMissedDate, player.timeZone);
            if (!dueAt || !isMissedCheckInDueNow({ dueAt, now })) continue;
            await prisma.$transaction((tx) => reserveGameMissedDayTx({ gameId: game.row.id, memberId: player.memberId, firstMissedDate: run.firstMissedDate, dueAt, tx }));
            reserved += 1;
          }
        }
      }
    },
  });
  return reserved;
}

export type GameRecapMaterial = {
  game: Record<string, unknown>;
  players: string[];
  entries: Array<{ entryId: string; kind: string; playerName: string; text: string | null; visibleToBoth: boolean }>;
  validation: {
    startedAt: Date;
    settledAt: Date | null;
    playerNamesByMemberId: Array<{ memberId: string; name: string }>;
    result: Array<{ memberId: string; name: string; score: number }>;
  };
};

/** Finished shared projection for the bound recap turn; private contact labels stay out. */
export async function readGameRecapMaterial(gameId: string, containerMemberId: string, expectedPlayers: readonly string[]): Promise<GameRecapMaterial | null> {
  const prisma = getPrisma();
  const row = await prisma.game.findFirst({ where: { id: gameId, chatContainerMemberId: containerMemberId, status: "settled", departedPlayer: { equals: Prisma.DbNull } }, include: { players: { orderBy: { seat: "asc" } }, tickets: true } });
  if (!row || row.players.length !== 2 || !row.result || !sameGamePlayers(row.players.map((player) => player.memberId), expectedPlayers)) return null;
  const rowEntries = await prisma.gameEntry.findMany({ where: { gameId }, orderBy: { receivedAt: "asc" } });
  const profiles = await prisma.gameProfile.findMany({ where: { memberId: { in: row.players.map((player) => player.memberId) } }, select: { memberId: true, firstNameEncrypted: true } });
  const reports = await prisma.gameReport.findMany({ where: { gameId, entryId: { not: null } }, select: { entryId: true } });
  const hidden = new Set(reports.flatMap((report) => report.entryId ? [report.entryId] : []));
  const shownEntries = rowEntries.filter((entry) => entry.attempt > 0 && entry.withdrawnAt === null && !hidden.has(entry.id));
  const plain = await openGameTexts([
    { ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted },
    ...profiles.map((profile) => ({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile" as const, value: profile.firstNameEncrypted })),
    ...shownEntries.flatMap((entry) => {
      const target = { memberId: entry.memberId, rowId: entry.id, table: "game_entry" as const };
      return [{ ...target, field: "text", value: entry.textEncrypted }, { ...target, field: "payload", value: entry.payloadEncrypted }];
    }),
  ]);
  const words = parseTermWords(plain[0] ?? "");
  const names = new Map(profiles.map((profile, index) => [profile.memberId, plain[index + 1] ?? ""]));
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
  const postsByDay = Array.from({ length: row.lengthDays }, (_, dayIndex) => ({
    dayNumber: dayIndex + 1,
    dates: Object.fromEntries(row.players.map((player) => [names.get(player.memberId) ?? "", player.dayOne ? addDays(fromDbDate(player.dayOne)!, dayIndex) : null])),
    posts: Object.fromEntries(row.players.map((player) => {
      const name = names.get(player.memberId) ?? "";
      const entry = shownEntries.find((candidate) => candidate.memberId === player.memberId && candidate.dayIndex === dayIndex);
      if (!isScheduledDay(state, dayIndex)) return [name, "off"];
      if (!entry) return [name, "missed"];
      const projected = entries.find((candidate) => candidate.entryId === entry.id)!;
      return [name, { entryId: entry.id, kind: projected.kind, text: projected.text, data: parseStoredGameEntryData(toEntryKind(entry.kind), plain[entryOffset + shownEntries.indexOf(entry) * 2 + 1] ?? null), ...(entry.incomplete ? { incomplete: true } : {}) }];
    })),
  }));
  return {
    players: row.players.map((player) => names.get(player.memberId) ?? ""), entries,
    validation: { startedAt: row.startedAt ?? row.createdAt, settledAt: row.settledAt,
      playerNamesByMemberId: row.players.map((player) => ({ memberId: player.memberId, name: names.get(player.memberId) ?? "" })),
      result: result.scores.map((score) => ({ memberId: score.memberId, name: names.get(score.memberId) ?? "", score: score.score })) },
    game: { id: row.id, players: row.players.map((player) => ({ name: names.get(player.memberId) ?? "", task: terms.tasks.find((task) => task.seat === player.seat)?.text ?? "" })),
      lengthDays: row.lengthDays, schedule: terms.schedule, stakes: terms.stakes, score: result.scores.map((score) => ({ name: names.get(score.memberId) ?? "", score: score.score })), days: postsByDay },
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
  if (!sameGamePlayers(input.playerMemberIds, input.playerMemberIds)) return null;
  const prisma = getPrisma();
  const row = await prisma.game.findFirst({ where: { id: input.gameId, chatContainerMemberId: input.containerMemberId, status: "settled" } });
  if (!row) return null;
  const recapEncrypted = input.recap === null
    ? null
    : await seal(gameTarget(row, "recap"), JSON.stringify(input.recap));
  const key = createHostedLinqDeliveryIdempotencyLookupKey(input.eventId);
  if (!key) return null;
  const stored = await prisma.$transaction(async (tx) => {
    await input.beforeMutationTx(tx);
    await lockGamePair(tx, input.playerMemberIds[0]!, input.playerMemberIds[1]!);
    const receipts = await tx.hostedLinqDelivery.count({ where: { idempotencyKey: key, source: "game_lifecycle", sourceRef: input.gameId, template: "game_recap", status: "generation_queued", payloadOwnerMemberId: input.containerMemberId } });
    if (receipts !== 1) return null;
    // Account deletion clears the recap under this row lock, so the roster is re-read after it.
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.gameId} FOR UPDATE`;
    const current = await tx.game.findFirst({ where: { id: input.gameId, chatContainerMemberId: input.containerMemberId, status: "settled", departedPlayer: { equals: Prisma.DbNull } }, select: { id: true, recapEncrypted: true, players: { select: { memberId: true }, take: 3 } } });
    if (!current || !sameGamePlayers(current.players.map((player) => player.memberId), input.playerMemberIds)) return null;
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
  if (!loaded || loaded.state.game.status !== "live") return null;
  const player = playerFor(loaded.state, actor);
  if (!player) return null;
  const now = gameNow(await databaseNow(tx), loaded.row);
  const dayIndex = dayIndexAt(player, now);
  if (dayIndex === null || dayIndex < 0 || dayIndex >= loaded.row.lengthDays || !player.dayOne) return null;
  return { now, dayIndex, player, scheduled: isScheduledDay(loaded.state, dayIndex),
    checkInKind: currentTerms(loaded.state.game.terms).checkInKind ?? "photo",
    currentEntryId: liveEntry(loaded.state.entries, actor, dayIndex)?.id ?? null,
    attemptsRemaining: Math.max(0, 2 - attemptsUsed(loaded.state.entries, actor, dayIndex)) };
}

// -------------------------------------------------------------------- reads

async function loadGames(db: Db, gameIds: readonly string[]): Promise<LoadedGame[]> {
  if (gameIds.length === 0) return [];
  const [rows, entries] = await Promise.all([
    db.game.findMany({ include: { players: true }, where: { id: { in: [...gameIds] } } }),
    db.gameEntry.findMany({ orderBy: { receivedAt: "asc" }, where: { gameId: { in: [...gameIds] } } }),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return gameIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const gameEntries = entries.filter((entry) => entry.gameId === id);
    return [{ entries: gameEntries, row, state: toRuleState(row, gameEntries) }];
  });
}

/** Loads only the media-bearing live entries that can appear in history previews. */
async function loadHistoryGames(db: Db, gameIds: readonly string[], viewerId: string): Promise<LoadedGame[]> {
  if (gameIds.length === 0) return [];
  const [rows, entries] = await Promise.all([
    db.game.findMany({ include: { players: true }, where: { id: { in: [...gameIds] } } }),
    db.$queryRaw<GameEntry[]>(Prisma.sql`
      WITH ranked_entry AS (
        SELECT entry.*,
          ROW_NUMBER() OVER (
            PARTITION BY entry.game_id
            ORDER BY entry.day_index, player.seat, entry.received_at, entry.id
          ) AS preview_rank
        FROM game_entry entry
        JOIN game_player player
          ON player.game_id = entry.game_id AND player.member_id = entry.member_id
        WHERE entry.game_id IN (${Prisma.join(gameIds)})
          AND entry.attempt > 0
          AND entry.withdrawn_at IS NULL
          AND cardinality(entry.media_keys) > 0
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

function toRuleState(row: GameRow, entries: readonly GameEntry[]): RuleState {
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
    game: toRuleStateGame(row, parseStoredTerms(row.terms)),
    players: row.players.map((player) => ({
      dayOne: fromDbDate(player.dayOne),
      memberId: player.memberId,
      seat: player.seat,
      timeZone: player.timeZone,
    })),
  };
}

function toRuleStateGame(row: Game, terms: RuleState["game"]["terms"]): RuleState["game"] {
  return {
    createdBy: row.createdBy,
    id: row.id,
    inviteExpiresAt: row.inviteExpiresAt,
    inviteeMemberId: row.inviteeMemberId,
    lengthDays: row.lengthDays,
    seats: GAME_SEATS_1V1,
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
 * Settles anything past due before showing it: there is no timer, any read
 * ends a finished game. Returns the database clock the reads were judged by.
 */
async function loadCurrent(gameIds: readonly string[]): Promise<{ games: LoadedGame[]; clock: Date }> {
  const prisma = getPrisma();
  const [loaded, clock] = await Promise.all([loadGames(prisma, gameIds), databaseNow(prisma)]);
  const due = loaded.filter((game) => isGameDue(game.state, gameNow(clock, game.row)));
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
    await tx.game.update({ where: { id: game.row.id }, data: { pendingChange: Prisma.DbNull } });
    if (!reason) return [{ type: "change_expired", payload: { proposalId: pending.id } }];
    // The same resolution, reason and chat notice an agreement attempt would have recorded.
    if (current.row.chatContainerMemberId) await reserveGameChatLifecycleTx({ gameId: game.row.id, kind: "change_expired", proposalId: pending.id, now: clock, tx });
    return [{ commandKey: `game-change-resolved:${game.row.id}:${pending.id}`, type: "change_expired", payload: { proposalId: pending.id, reason } }];
  });
  for (const game of due) await settleGame(game.row.id);
  return { clock, games: await loadGames(prisma, gameIds) };
}

export async function readGame(gameId: string, memberId: string): Promise<GameView | null> {
  const { clock, games: [loaded] } = await loadCurrent([gameId]);
  if (!loaded || !canView(loaded, memberId)) return null;
  const [view] = await buildViews([loaded], memberId, clock);
  return view;
}

/**
 * Players see their games that are on; a rematch's addressed invitee sees it
 * while it's still an invite (only they can accept it).
 */
function canView(game: LoadedGame, memberId: string): boolean {
  if (!isGameOn(game.row)) return false;
  if (playerFor(game.state, memberId)) return true;
  // Also after its challenger left: the invitee sees it called off.
  return game.row.inviteeMemberId === memberId && (game.row.status === "invited" || game.row.departedPlayer !== null);
}

/**
 * The HTTP door. A listed member may use every route. Anyone else enters only
 * for a game that is on: one they play or are the addressed rematch invitee
 * of, or the open invite they're holding, so a new invitee can set up and
 * accept. Owners of outgoing blocks may also enter to reach their unblock
 * controls after their last game ends. Each command still checks its own game.
 */
export async function canEnterGame(memberId: string, inviteToken: string | null): Promise<boolean> {
  if (isGameEnabledFor(memberId)) return true;
  if (!isGameEnabled()) return false;
  const prisma = getPrisma();
  const yours = await prisma.game.findFirst({ select: { id: true }, where: { AND: [
    { OR: [{ players: { some: { memberId } } }, { inviteeMemberId: memberId }] },
    { status: { in: ["invited", "negotiating", "live", "settled"] } },
    gameOnWhere(),
  ] } });
  if (yours) return true;
  if (await prisma.gameBlock.findFirst({ select: { blockedMemberId: true }, where: { blockerMemberId: memberId } })) return true;
  if (!inviteToken) return false;
  const invite = await prisma.game.findUnique({ include: { players: true }, where: { inviteTokenHash: sha256Hex(inviteToken) } });
  if (!invite || invite.status !== "invited" || !isGameOn(invite)) return false;
  if (invite.inviteeMemberId !== null && invite.inviteeMemberId !== memberId) return false;
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
    const departed = parseGameDepartedPlayer(game.row.departedPlayer);
    if (departed) return new Date(departed.at);
    return game.row.players.some((player) => isHiddenBy(blocks, player.memberId)) ? game.row.updatedAt : game.row.inviteExpiresAt;
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

export async function readHome(memberId: string): Promise<GameHomeView> {
  const prisma = getPrisma();
  const [profile, seats, addressed, tickets, usualEntry] = await Promise.all([
    prisma.gameProfile.findUnique({ where: { memberId } }),
    // Apply active-game priority before the bounded history window, so new
    // invitations and completed games cannot displace an older live game.
    prisma.$queryRaw<Array<{ gameId: string }>>(Prisma.sql`
      SELECT seat.game_id AS "gameId" FROM game_player seat
      JOIN game ON game.id = seat.game_id
      WHERE seat.member_id = ${memberId}
        AND game.status IN ('invited', 'negotiating', 'live', 'settled', 'void')
        AND ${gameOnSql("game")}
        AND NOT EXISTS (SELECT 1 FROM game_event event WHERE event.game_id = game.id AND event.type = 'cancelled')
      ORDER BY CASE game.status WHEN 'live' THEN 0 WHEN 'negotiating' THEN 1 WHEN 'invited' THEN 2 ELSE 3 END,
        seat.joined_at DESC, seat.game_id DESC
      LIMIT ${HOME_CANDIDATE_LIMIT}
    `),
    prisma.game.findMany({ select: { id: true }, take: HOME_CANDIDATE_LIMIT, where: { inviteeMemberId: memberId,
      OR: [{ status: "invited" }, { status: "void", departedPlayer: { not: Prisma.DbNull } }] } }),
    prisma.gameTicket.findMany({
      include: { game: { select: { createdBy: true, departedPlayer: true, devClockOffsetMs: true, id: true, terms: true, termsWordsEncrypted: true } } },
      orderBy: { createdAt: "desc" },
      take: WALLET_LIMIT,
      where: { OR: [{ owedTo: memberId }, { owedBy: memberId }], game: gameOnWhere() },
    }),
    prisma.gameEntry.findFirst({ where: { memberId, attempt: { gt: 0 }, withdrawnAt: null },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }], select: { kind: true } }),
  ]);
  const current = await loadCurrent([...new Set([...seats.map((seat) => seat.gameId), ...addressed.map((game) => game.id)])]);
  const visible = current.games.filter((game) => canView(game, memberId));
  const counterpartyOf = (ticket: { owedBy: string | null; owedTo: string | null }) => (ticket.owedTo === memberId ? ticket.owedBy : ticket.owedTo);
  const blocks = await readGameBlocks(prisma, memberId, [
    ...visible.flatMap(participantsOf), ...tickets.flatMap((ticket) => counterpartyOf(ticket) ?? []),
  ]);
  // Someone you blocked is gone from your Home: their games and tickets too.
  const shown = visible.filter((game) => !participantsOf(game).some((id) => blocks.blocked.has(id)));
  const games = sortForHome(homeGames(shown, current.clock, blocks), memberId, current.clock);
  const kept = tickets.filter((ticket) => !blocks.blocked.has(counterpartyOf(ticket) ?? ""));
  const [views, blocked] = await Promise.all([buildViews(games, memberId, current.clock, blocks), readBlockedPeople(memberId)]);
  const words = await readTermWords([...new Map(kept.map((ticket) => [ticket.gameId, ticket.game])).values()]);
  const [firstName] = await openGameTexts(profile
    ? [{ field: "first_name", memberId, rowId: memberId, table: "game_profile", value: profile.firstNameEncrypted }]
    : []);
  const wallet = kept.map((ticket) => ticketView(withoutHidden(toTicketRow(ticket), blocks), words.get(ticket.gameId) ?? null,
    memberId, gameNow(current.clock, ticket.game), parseStoredTerms(ticket.game.terms)));
  return {
    blocked,
    games: views,
    canStartGames: isGameEnabledFor(memberId),
    me: { usualKind: usualEntry ? toEntryKind(usualEntry.kind) : null, avatarUrl: profile?.photoKey ? gameMediaUrl(profile.photoKey) : null, firstName: firstName ?? null, memberId, timeZone: profile?.timeZone ?? null },
    wallet: {
      // Expired tickets stay where they were, marked expired.
      held: wallet.filter((ticket) => ticket.status !== "redeemed" && ticket.youHold),
      owed: wallet.filter((ticket) => ticket.status !== "redeemed" && !ticket.youHold),
      redeemed: wallet.filter((ticket) => ticket.status === "redeemed"),
    },
  };
}

/**
 * Settled 1v1 history, bounded to a constant number of people, games and
 * preview entries. Every database read is set-based; view hydration decrypts
 * the selected rows in the same batch used by ordinary game views.
 */
export async function readHistory(memberId: string): Promise<GameHistoryView> {
  const prisma = getPrisma();
  const candidates = await prisma.$queryRaw<Array<{ gameId: string }>>(Prisma.sql`
    WITH settled_pair AS (
      SELECT game.id AS game_id,
        opponent.member_id AS opponent_id,
        game.settled_at AS settled_at,
        ROW_NUMBER() OVER (
          PARTITION BY opponent.member_id
          ORDER BY game.settled_at DESC, game.id DESC
        ) AS game_rank
      FROM game
      JOIN game_player viewer
        ON viewer.game_id = game.id AND viewer.member_id = ${memberId}
      JOIN game_player opponent
        ON opponent.game_id = game.id AND opponent.member_id <> ${memberId}
      WHERE game.status = 'settled'
        AND game.settled_at IS NOT NULL
        AND ${gameOnSql("game")}
        AND (SELECT count(*) FROM game_player roster WHERE roster.game_id = game.id) = 2
        AND NOT EXISTS (
          SELECT 1 FROM game_block blocked
          WHERE (blocked.blocker_member_id = ${memberId} AND blocked.blocked_member_id = opponent.member_id)
            OR (blocked.blocker_member_id = opponent.member_id AND blocked.blocked_member_id = ${memberId})
        )
    ), recent_people AS (
      SELECT opponent_id, max(settled_at) AS latest_at
      FROM settled_pair
      GROUP BY opponent_id
      ORDER BY latest_at DESC, opponent_id
      LIMIT ${HISTORY_PEOPLE_LIMIT}
    )
    SELECT settled_pair.game_id AS "gameId"
    FROM settled_pair
    JOIN recent_people USING (opponent_id)
    WHERE settled_pair.game_rank <= ${HISTORY_GAMES_PER_PERSON_LIMIT}
    ORDER BY recent_people.latest_at DESC,
      settled_pair.opponent_id,
      settled_pair.settled_at DESC,
      settled_pair.game_id DESC
  `);
  if (candidates.length === 0) return { people: [] };

  const gameIds = candidates.map((candidate) => candidate.gameId);
  const [games, clock] = await Promise.all([
    loadHistoryGames(prisma, gameIds, memberId),
    databaseNow(prisma),
  ]);
  const built = await buildHistoryViews(games, memberId, clock);
  const people = new Map<string, GameHistoryView["people"][number]>();
  for (const item of built) {
    let person = people.get(item.person.memberId);
    if (!person) {
      person = { ...item.person, games: [], record: { lost: 0, tied: 0, won: 0 } };
      people.set(item.person.memberId, person);
    }
    person.games.push(item.game);
    person.record[item.game.result] += 1;
  }
  return { people: [...people.values()] };
}

/** The members in a game: its players and an addressed rematch's invitee. */
function participantsOf(game: LoadedGame): string[] {
  return [...game.row.players.map((player) => player.memberId), ...(game.row.inviteeMemberId ? [game.row.inviteeMemberId] : [])];
}

/** A ticket with someone blocked either way shows them as having left. */
function withoutHidden(ticket: GameTicketRow, blocks: GameBlocks): GameTicketRow {
  return { ...ticket, owedBy: isHiddenBy(blocks, ticket.owedBy) ? null : ticket.owedBy, owedTo: isHiddenBy(blocks, ticket.owedTo) ? null : ticket.owedTo };
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
export async function readInvitePreview(token: string): Promise<GameInvitePreview | null> {
  if (!isGameEnabled() || typeof token !== "string" || !token) return null;
  const row = await getPrisma().game.findUnique({
    include: { creator: true, events: { where: { type: "cancelled" }, select: { actor: true }, take: 1 }, players: { select: { memberId: true } } },
    where: { inviteTokenHash: sha256Hex(token) },
  });
  if (!row) return null;
  // Its challenger deleted their account: never open again.
  if (!row.creator) return { status: "expired" };
  if (!isGameOn(row)) return null;
  const now = gameNow(await databaseNow(getPrisma()), row);
  // Expired means nobody took it: a void game, or an open invite past its
  // expiry. A taken one stays "used" however long ago that was.
  const expired = row.status === "void"
    || (row.status === "invited" && row.inviteExpiresAt !== null && row.inviteExpiresAt.getTime() < now.getTime());
  if (row.status === "void" && row.events.length > 0) {
    if (row.events[0].actor !== row.createdBy) return { status: "expired", reason: "cancelled" };
    const [inviterFirstName] = await openGameTexts([
      { field: "first_name", memberId: row.creator.memberId, rowId: row.creator.memberId, table: "game_profile", value: row.creator.firstNameEncrypted },
    ]);
    return { status: "expired", reason: "cancelled", inviterFirstName: inviterFirstName ?? "" };
  }
  if (row.status !== "invited" || expired) return { status: expired ? "expired" : "used" };
  // The invitee's name stays out: the challenger typed it as their own private
  // label, and this preview is public to anyone holding the link.
  const [inviterFirstName, words] = await openGameTexts([
    { field: "first_name", memberId: row.creator.memberId, rowId: row.creator.memberId, table: "game_profile", value: row.creator.firstNameEncrypted },
    { ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted },
  ]);
  const game = toRuleStateGame(row, parseStoredTerms(row.terms));
  return {
    expiresAt: (row.inviteExpiresAt ?? row.createdAt).toISOString(),
    inviterFirstName: inviterFirstName ?? "",
    startsOn: game.startsOn,
    status: "open",
    supportsNegotiation: true,
    lengthDays: row.lengthDays,
    terms: termsView({ entries: [], game, players: [] }, parseTermWords(words ?? "")),
  };
}

/**
 * The uploader can see their photos. The current canonical profile photo is
 * also visible to shared game participants, including addressed rematches.
 * Other uploads require a visible entry (post-to-unlock, everything after
 * settle); private contact photos never acquire access from their label.
 */
export async function authorizeMediaRead(memberId: string, mediaKey: string): Promise<boolean> {
  const ownerId = mediaKeyOwner(mediaKey);
  if (!ownerId) return false;
  if (ownerId === memberId) return true;
  const prisma = getPrisma();
  // Blocked either way: nothing of theirs, as if they'd left.
  if (await areGamePlayersBlocked(prisma, memberId, ownerId)) return false;
  const profile = await prisma.gameProfile.findUnique({ select: { photoKey: true }, where: { memberId: ownerId } });
  // A player you reported keeps their photo from you.
  if (profile?.photoKey === mediaKey && !(await readReportedBy(memberId, { players: [ownerId] })).players.has(ownerId)) {
    const participant = (id: string) => ({ OR: [
      { players: { some: { memberId: id } } },
      { inviteeMemberId: id, status: "invited" },
    ] });
    const sharedGame = await prisma.game.findFirst({
      select: { id: true },
      where: { AND: [participant(memberId), participant(ownerId), gameOnWhere()] },
    });
    if (sharedGame) return true;
  }
  // The other-player branch of visibleEntryIds, applied before LIMIT. A key
  // may appear in any number of games; authorization needs one visible use,
  // no payload decryption or truncated candidate window.
  const entries = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT entry.id FROM game_entry entry
    JOIN game ON game.id = entry.game_id
    JOIN game_player viewer ON viewer.game_id = game.id AND viewer.member_id = ${memberId}
    WHERE entry.member_id = ${ownerId} AND entry.media_keys @> ARRAY[${mediaKey}]::text[]
      AND entry.attempt > 0 AND entry.withdrawn_at IS NULL
      AND ${gameOnSql("game")}
      AND NOT EXISTS (SELECT 1 FROM game_report report
        WHERE report.entry_id = entry.id AND report.reporter_member_id = ${memberId})
      AND (game.status = 'settled' OR EXISTS (
        SELECT 1 FROM game_entry own WHERE own.game_id = game.id
          AND own.member_id = ${memberId} AND own.day_index = entry.day_index AND own.attempt > 0
      ))
    LIMIT 1
  `);
  return entries.length > 0;
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

/** This viewer's game without a player blocked either way: to them, that player left. */
function withoutPlayer(state: RuleState, memberId: string): RuleState {
  return { ...state, entries: state.entries.filter((entry) => entry.memberId !== memberId), players: state.players.filter((player) => player.memberId !== memberId) };
}

function toTicketRow(ticket: {
  id: string;
  gameId: string;
  stakeKey: string;
  owedBy: string | null;
  owedTo: string | null;
  status: string;
  createdAt: Date;
  redeemedAt: Date | null;
}): GameTicketRow {
  return {
    createdAt: ticket.createdAt,
    gameId: ticket.gameId,
    id: ticket.id,
    owedBy: ticket.owedBy,
    owedTo: ticket.owedTo,
    redeemedAt: ticket.redeemedAt,
    stakeKey: ticket.stakeKey,
    status: ticket.status === "redeemed" ? "redeemed" : "open",
  };
}

async function readTermWords(
  games: ReadonlyArray<Pick<Game, "id" | "createdBy" | "departedPlayer" | "termsWordsEncrypted">>,
): Promise<Map<string, TermWords>> {
  const texts = await openGameTexts(games.map((game) => ({ ...gameTarget(game, "terms_words"), value: game.termsWordsEncrypted })));
  return new Map(games.map((game, index) => [game.id, parseTermWords(texts[index] ?? "")]));
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
  history = false,
): Promise<GameViewInput[]> {
  if (games.length === 0) return [];
  const prisma = getPrisma();
  const memberIds = [...new Set([viewerId, ...games.flatMap((game) => game.row.players.map((player) => player.memberId))])];
  // An addressed rematch's invitee isn't a player yet, but the challenger's label for them still applies.
  const labelSubjects = [...memberIds, ...games.flatMap((game) => (game.row.inviteeMemberId ? [game.row.inviteeMemberId] : []))];
  const [profiles, labels, tickets, pendingViews, blocks, reported] = await Promise.all([
    prisma.gameProfile.findMany({ where: { memberId: { in: labelSubjects } } }),
    prisma.gameContactLabel.findMany({ where: { ownerMemberId: viewerId, subjectMemberId: { in: labelSubjects } } }),
    history ? [] : prisma.gameTicket.findMany({
      where: { gameId: { in: games.map((game) => game.row.id) }, OR: [{ owedTo: viewerId }, { owedBy: viewerId }] },
    }),
    history ? new Map() : readPendingChangeViews(games.map((game) => game.row)),
    knownBlocks ?? readGameBlocks(prisma, viewerId, labelSubjects),
    readReportedBy(viewerId, { gameIds: games.map((game) => game.row.id), players: labelSubjects }),
  ]);
  const hiddenEntryIds = reported.entries;
  const hiddenPlayers = games.map((game) => game.state.players.find((player) => player.memberId !== viewerId && isHiddenBy(blocks, player.memberId)) ?? null);
  const recapSuppressed = games.map((game, index) => hiddenPlayers[index] !== null
    || game.entries.some((entry) => hiddenEntryIds.has(entry.id))
    || game.state.players.some((player) => player.memberId !== viewerId && reported.players.has(player.memberId)));
  const states = games.map((game, index) => {
    const hidden = hiddenPlayers[index];
    return hidden ? withoutPlayer(game.state, hidden.memberId) : game.state;
  });

  // One decrypt batch: words, names, labels, invite bits, visible entries.
  const requests: Array<GameSealTarget & { value: string | null }> = [];
  const ask = (target: GameSealTarget, value: string | null) => {
    requests.push({ ...target, value });
    return requests.length - 1;
  };
  const wordsAt = games.map((game) => ask(gameTarget(game.row, "terms_words"), game.row.termsWordsEncrypted));
  const recapAt = games.map((game, index) => game.row.recapEncrypted && !recapSuppressed[index]
    ? ask(gameTarget(game.row, "recap"), game.row.recapEncrypted)
    : null);
  // A player who left: the name the viewer, the only member left, knew them by.
  const departedAt = games.map((game) => {
    const departed = parseGameDepartedPlayer(game.row.departedPlayer);
    return departed ? { seat: departed.seat, name: ask(labelTarget(departed.viewerMemberId, "name"), departed.nameEncrypted) } : null;
  });
  const profileNameAt = new Map(profiles.map((profile) => [
    profile.memberId,
    ask({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile" }, profile.firstNameEncrypted),
  ]));
  const labelNameAt = new Map(labels.map((label) => [label.subjectMemberId, ask(labelTarget(viewerId, "name"), label.nameEncrypted)]));
  const labelRelationshipAt = new Map(labels.map((label) => [
    label.subjectMemberId,
    ask(labelTarget(viewerId, "relationship"), label.relationshipEncrypted),
  ]));
  // A game's own link belongs to its people: while invited, the challenger and
  // an addressed invitee; after go-live, both players (the token is spent).
  const tokenAt = games.map((game) => {
    if (history) return null;
    const { row } = game;
    const holds = row.status === "invited"
      ? row.createdBy === viewerId || row.inviteeMemberId === viewerId
      : game.state.players.some((player) => player.memberId === viewerId);
    return holds ? ask(gameTarget(row, "invite_token"), row.inviteTokenEncrypted) : null;
  });
  const inviteAt = games.map((game) => {
    if (history) return null;
    const { row } = game;
    // An addressed rematch whose challenger left still shows its invitee in their seat.
    if (row.status !== "invited" && !(row.departedPlayer !== null && row.inviteeMemberId === viewerId)) return null;
    if (row.createdBy === viewerId) {
      const pending = parsePendingLabel(row.pendingLabel);
      return {
        memberId: row.inviteeMemberId,
        name: ask(labelTarget(viewerId, "name"), pending.nameEncrypted),
        photoKey: pending.photoKey,
        relationship: ask(labelTarget(viewerId, "relationship"), pending.relationshipEncrypted),
      };
    }
    // The addressed invitee sees themselves by their own name, never the challenger's private label.
    if (row.inviteeMemberId === viewerId) return { memberId: viewerId, name: null, photoKey: null, relationship: null };
    return null;
  });
  const entryAt = new Map<string, { text: number; payload: number; kind: GameEntryKind }>();
  for (const [index, game] of games.entries()) {
    const visible = visibleEntryIds(states[index], viewerId, hiddenEntryIds);
    for (const entry of game.entries) {
      if (!visible.has(entry.id)) continue;
      const target = { memberId: entry.memberId, rowId: entry.id, table: "game_entry" as const };
      entryAt.set(entry.id, {
        text: ask({ ...target, field: "text" }, entry.textEncrypted),
        payload: ask({ ...target, field: "payload" }, entry.payloadEncrypted),
        kind: toEntryKind(entry.kind),
      });
    }
  }
  const plain = await openGameTexts(requests);

  const names = new Map<string, string>();
  for (const profile of profiles) {
    const labelIndex = labelNameAt.get(profile.memberId);
    const labelName = profile.memberId !== viewerId && labelIndex !== undefined ? plain[labelIndex] : null;
    names.set(profile.memberId, labelName ?? plain[profileNameAt.get(profile.memberId)!] ?? "");
  }
  // Only the viewer's own invite photos and relationships: nobody else ever sees them.
  const avatarKeys = new Map(labels.map((label) => [label.subjectMemberId, label.photoKey]));
  const profileAvatarKeys = new Map(profiles.map((profile) => [profile.memberId, reported.players.has(profile.memberId) ? null : profile.photoKey]));
  const relationships = new Map([...labelRelationshipAt].map(([memberId, at]) => [memberId, plain[at]]));
  /** The invite's own typed relationship, else the viewer's existing label for an addressed rematch. */
  const inviteeRelationship = (invite: NonNullable<(typeof inviteAt)[number]>) => {
    const typed = invite.relationship === null ? null : plain[invite.relationship];
    return typed ?? (invite.memberId ? relationships.get(invite.memberId) ?? null : null);
  };
  const entryWords = new Map([...entryAt].map(([entryId, at]) => [entryId, {
    text: plain[at.text], data: parseStoredGameEntryData(at.kind, plain[at.payload]),
  }]));
  return games.map((game, index) => {
    const invite = inviteAt[index];
    const tokenIndex = tokenAt[index];
    const result: StoredResult | null = game.row.result ? parseStoredResult(game.row.result) : null;
    return {
      pendingChange: pendingViews.get(game.row.id) ?? null,
      avatarKeys,
      profileAvatarKeys,
      entryWords,
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
      departed: departedAt[index] ? { seat: departedAt[index].seat, name: plain[departedAt[index].name] ?? "" }
        : hiddenPlayers[index] && { seat: hiddenPlayers[index].seat, name: names.get(hiddenPlayers[index].memberId) ?? "" },
      hiddenEntryIds,
      now: gameNow(clock, game.row),
      result,
      recap: recapAt[index] === null ? null : hostedGameRecapSchema.parse(JSON.parse(plain[recapAt[index]!] ?? "null")),
      round: game.row.round,
      startedAt: game.row.startedAt,
      state: states[index],
      tickets: tickets.filter((ticket) => ticket.gameId === game.row.id).map((ticket) => withoutHidden(toTicketRow(ticket), blocks)),
      viewerId,
      words: parseTermWords(plain[wordsAt[index]] ?? ""),
    };
  });
}

async function buildViews(games: readonly LoadedGame[], viewerId: string, clock: Date, knownBlocks?: GameBlocks): Promise<GameView[]> {
  return (await buildViewInputs(games, viewerId, clock, knownBlocks)).map(buildGameView);
}

async function buildHistoryViews(games: readonly LoadedGame[], viewerId: string, clock: Date): Promise<BuiltGameHistoryView[]> {
  return (await buildViewInputs(games, viewerId, clock, undefined, true))
    .flatMap((input) => buildGameHistoryView(input) ?? []);
}

/** One indexed receipt batch; delivery truth stays with the existing outbox owner. */
async function readPendingChangeViews(rows: readonly Pick<Game, "id" | "createdBy" | "departedPlayer" | "pendingChange">[]): Promise<Map<string, GamePendingChange>> {
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
