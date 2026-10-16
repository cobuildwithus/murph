import "server-only";

import { randomBytes } from "node:crypto";

import type { Game, GameEntry, GamePlayer, Prisma } from "@prisma/client";

import { toPrismaJsonObject } from "../device-sync/prisma-store/prisma-json";
import { isUniqueViolation } from "../device-sync/prisma-store/prisma-errors";
import { generateHostedRandomPrefixedId, isRecord, sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { areGameDevToolsAllowed, isGameEnabled, mediaKeyOwner, mediaKeyPrefixFor } from "./access";
import { parseGameCommand } from "./command";
import {
  GAME_ENTRY_KINDS,
  type GameCommand,
  type GameEntryKind,
  type GameError,
  type GameHomeView,
  type GameInvitePreview,
  type GameStatus,
  type GameView,
} from "./contract";
import { labelTarget, openGameTexts, sealGameText, type GameSealTarget } from "./crypto";
import { isGameMediaStorageAvailable, statGameMedia } from "./media";
import {
  decideDevAdvance,
  decideJoin,
  decideNewTerms,
  decidePost,
  decideSettle,
  decideStartNow,
  decideWithdraw,
  GAME_ERROR_STATUS,
  GAME_INVITE_TTL_MS,
  GAME_SEATS_1V1,
  GameRuleError,
  isGameDue,
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
import { gameLocalDate } from "./time";
import { buildGameView, termsView, ticketView, visibleEntryIds, type GameTicketRow } from "./views";

export { isGameEnabledFor, mediaKeyPrefixFor } from "./access";

type Tx = Prisma.TransactionClient;
type Db = Tx | ReturnType<typeof getPrisma>;
type GameRow = Game & { players: GamePlayer[] };
interface LoadedGame {
  row: GameRow;
  entries: GameEntry[];
  state: RuleState;
}
export type GameCommandResult =
  | { ok: true; game: GameView | null }
  | { ok: false; error: GameError; status: number };

const SYSTEM_ACTOR = "system";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOME_CANDIDATE_LIMIT = 50;
const HOME_SETTLED_SHOWN = 3;
const HOME_EXPIRED_SHOWN = 3;
const HOME_EXPIRED_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const WALLET_LIMIT = 200;

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
  now?: Date;
}): Promise<GameCommandResult> {
  const actor = input.actorMemberId;
  try {
    const command = parseGameCommand(input.command);
    await requireUploadedMedia(actor, command);
    const gameId = await runCommand({ actor, now: input.now }, command);
    return { game: gameId ? await readGame(gameId, actor) : null, ok: true };
  } catch (error) {
    if (error instanceof GameRuleError) {
      return { error: error.error, ok: false, status: GAME_ERROR_STATUS[error.error.code] };
    }
    throw error;
  }
}

interface CommandContext {
  actor: string;
  now?: Date;
}

/** Applies one command; returns the game to show back, if any. */
async function runCommand(context: CommandContext, command: GameCommand): Promise<string | null> {
  switch (command.type) {
    case "setProfile":
      await setProfile(context.actor, command);
      return null;
    case "createGame":
      return createGame(context, command);
    case "join":
      return join(context, command);
    case "post":
      return post(context, command);
    case "withdraw":
      return withdraw(context, command);
    case "redeem":
      return redeem(context, command);
  }
}

/** Every media key a command names must be the actor's own finished upload. */
async function requireUploadedMedia(actor: string, command: GameCommand): Promise<void> {
  const labelPhoto = command.type === "createGame" ? command.inviteeLabel?.photoKey : null;
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

type GameEventType = "created" | "joined" | "started" | "posted" | "withdrew" | "settled" | "redeemed" | "expired" | "time_shifted";
/** What changed, for the history: ids and numbers only, never words. */
interface GameEventDraft {
  type: GameEventType;
  payload: Prisma.InputJsonObject;
}

async function writeEvents(tx: Tx, gameId: string, actor: string, events: readonly GameEventDraft[]): Promise<void> {
  if (events.length === 0) return;
  await tx.gameEvent.createMany({
    data: events.map((event) => ({ actor, gameId, payload: { v: 1, ...event.payload }, type: event.type })),
  });
  // Murph seam: once a game is hosted in a Murph group chat, append these
  // moments to HostedMailbox here, in this transaction. The MVP has no chat.
}

/** Locks the game, runs one step, and records what it changed. A step that changes nothing returns no events. */
async function runLocked(
  gameId: string,
  context: CommandContext,
  step: (locked: LockedStep) => Promise<GameEventDraft[]>,
): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    if (locked.length === 0) reject("GAME_NOT_FOUND", "Game not found.");
    const [loaded] = await loadGames(tx, [gameId]);
    const clock = context.now ?? await databaseNow(tx);
    await writeEvents(tx, gameId, context.actor, await step({ clock, loaded, now: gameNow(clock, loaded.row), tx }));
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

function gameTarget(game: { id: string; createdBy: string }, field: string): GameSealTarget {
  return { field, memberId: game.createdBy, rowId: game.id, table: "game" };
}

async function setProfile(actor: string, command: Extract<GameCommand, { type: "setProfile" }>): Promise<void> {
  const firstNameEncrypted = await seal(
    { field: "first_name", memberId: actor, rowId: actor, table: "game_profile" },
    command.firstName,
  );
  await getPrisma().gameProfile.upsert({
    create: { firstNameEncrypted, memberId: actor, timeZone: command.timeZone },
    update: { firstNameEncrypted, timeZone: command.timeZone },
    where: { memberId: actor },
  });
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
  const rematch = command.previousGameId ? await readRematch(actor, command.previousGameId) : null;
  const newTerms = decideNewTerms(command.terms, {
    newKey: () => generateHostedRandomPrefixedId("gsk"),
    today: gameLocalDate(context.now ?? new Date(), profile.timeZone),
  });
  const token = randomBytes(24).toString("base64url");
  const where = { createdBy: actor, id: gameId };
  const [termsWordsEncrypted, inviteTokenEncrypted, nameEncrypted, relationshipEncrypted] = await Promise.all([
    seal(gameTarget(where, "terms_words"), JSON.stringify(newTerms.words)),
    seal(gameTarget(where, "invite_token"), token),
    seal(labelTarget(actor, "name"), command.inviteeFirstName),
    inviteeLabel?.relationship ? seal(labelTarget(actor, "relationship"), inviteeLabel.relationship) : null,
  ]);
  try {
    await prisma.$transaction(async (tx) => {
      const now = context.now ?? await databaseNow(tx);
      await tx.game.create({
        data: {
          createdBy: actor,
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
          inviteeMemberId: rematch?.inviteeMemberId ?? null,
          round: rematch?.round ?? 1,
          status: "invited",
          terms: toPrismaJsonObject(newTerms.terms),
          termsWordsEncrypted,
        },
      });
      const previous = command.previousGameId ? { previousGameId: command.previousGameId } : {};
      await writeEvents(tx, gameId, actor, [{ payload: { round: rematch?.round ?? 1, ...previous }, type: "created" }]);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.game.findUnique({ select: { createdBy: true }, where: { id: gameId } });
    if (raced?.createdBy !== actor) reject("INVALID_REQUEST", "That game id is taken.");
  }
  return gameId;
}

/**
 * A rematch must follow a finished game the challenger played. After a settled
 * game with exactly one other player, it continues the round count (the joiner
 * is checked at go-live) and is addressed to that player, who sees it on Home.
 */
async function readRematch(actor: string, previousGameId: string): Promise<{ round: number; inviteeMemberId: string | null }> {
  const previous = await getPrisma().game.findUnique({
    include: { players: { select: { memberId: true } } },
    where: { id: previousGameId },
  });
  const finished = previous?.status === "settled" || previous?.status === "void";
  if (!previous || !finished || !previous.players.some((player) => player.memberId === actor)) {
    reject("INVALID_REQUEST", "A rematch needs a finished game you played.");
  }
  if (previous.status !== "settled") return { inviteeMemberId: null, round: 1 };
  const others = previous.players.filter((player) => player.memberId !== actor);
  return { inviteeMemberId: others.length === 1 ? others[0].memberId : null, round: previous.round + 1 };
}

async function join(context: CommandContext, command: Extract<GameCommand, { type: "join" }>): Promise<string> {
  const { actor } = context;
  const prisma = getPrisma();
  const target = await prisma.game.findUnique({
    select: { createdBy: true, id: true },
    where: { inviteTokenHash: sha256Hex(command.token) },
  });
  if (!target) reject("INVITE_NOT_FOUND", "Invite not found.");
  const profile = await prisma.gameProfile.findUnique({ select: { memberId: true }, where: { memberId: actor } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");
  // A finished game between these same people that nobody opened must not block this one.
  const sameRoster = await prisma.game.findMany({
    select: { id: true },
    where: { liveRosterKey: liveRosterKey([target.createdBy, actor]) },
  });
  await loadCurrent(sameRoster.map((game) => game.id));
  try {
    await accept(context, command, target.id);
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
  const profile = await getPrisma().gameProfile.findUnique({ select: { firstNameEncrypted: true }, where: { memberId: otherId } });
  const [name] = await openGameTexts(profile
    ? [{ field: "first_name", memberId: otherId, rowId: otherId, table: "game_profile", value: profile.firstNameEncrypted }]
    : []);
  return name ? `You and ${name} already have a game going.` : "You two already have a game going.";
}

async function accept(context: CommandContext, command: Extract<GameCommand, { type: "join" }>, gameId: string): Promise<void> {
  const { actor } = context;
  await runLocked(gameId, context, async ({ loaded, now, tx }) => {
    const { row } = loaded;
    const decision = decideJoin(await withCurrentTimeZones(tx, loaded.state), {
      memberId: actor,
      now,
      termsVersion: command.termsVersion,
      timeZone: command.timeZone,
    });
    if (decision.kind === "already-joined") return [];
    // The unique live_roster_key is the real guard; this gives the friendly error.
    const roster = liveRosterKey(decision.players.map((player) => player.memberId));
    if (await tx.game.findFirst({ select: { id: true }, where: { liveRosterKey: roster } })) {
      reject("ALREADY_IN_A_GAME", "These players already have a game going.");
    }
    await tx.gamePlayer.create({ data: { gameId: row.id, memberId: actor, seat: decision.seat, timeZone: command.timeZone } });
    await writeSchedule(tx, row.id, decision);
    await tx.game.update({
      data: { liveRosterKey: roster, round: await roundAtGoLive(tx, row, actor), startedAt: decision.startedAt, status: "live" },
      where: { id: row.id },
    });
    await copyPendingLabel(tx, row, actor);
    return [
      { payload: { seat: decision.seat }, type: "joined" },
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

/** A rematch keeps counting only when the same people play it. */
async function roundAtGoLive(tx: Tx, row: GameRow, joinerId: string): Promise<number> {
  if (!row.previousGameId || row.round === 1) return row.round;
  const playedBefore = await tx.gamePlayer.findUnique({
    select: { gameId: true },
    where: { gameId_memberId: { gameId: row.previousGameId, memberId: joinerId } },
  });
  return playedBefore ? row.round : 1;
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

/** Settled or void: the roster is free to start another game together. */
async function endGame(tx: Tx, gameId: string, data: Prisma.GameUpdateInput): Promise<void> {
  await tx.game.update({ data: { ...data, liveRosterKey: null }, where: { id: gameId } });
}

async function post(context: CommandContext, command: Extract<GameCommand, { type: "post" }>): Promise<string> {
  const { actor } = context;
  const { entryId, gameId, kind, mediaKeys } = command;
  const textEncrypted = command.text
    ? await seal({ field: "text", memberId: actor, rowId: entryId, table: "game_entry" }, command.text)
    : null;
  const captureAgeMs = command.captureAgeMs ?? null;
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
      mediaKeyPrefix: mediaKeyPrefixFor(actor),
      mediaKeys,
      memberId: actor,
      now,
    });
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
      },
    });
    const { attempt, dayIndex, graceUsed } = decision;
    return [{ payload: { attempt, dayIndex, entryId, graceUsed, kind }, type: "posted" }];
  });
  return gameId;
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
  if (!ticket || ticket.owedTo !== actor) reject("TICKET_NOT_HELD", "That ticket isn't yours to cash in.");
  await runLocked(ticket.gameId, context, async ({ clock, now, tx }) => {
    const current = await tx.gameTicket.findUniqueOrThrow({ select: { createdAt: true, status: true }, where: { id: ticketId } });
    if (isTicketExpired(current, now)) reject("TICKET_EXPIRED", "This ticket expired before it was used.");
    // Already redeemed matches no row: a repeat, not an error.
    const changed = await tx.gameTicket.updateMany({
      data: { redeemedAt: clock, status: "redeemed" },
      where: { id: ticketId, owedTo: actor, status: "open" },
    });
    return changed.count === 1 ? [{ payload: { ticketId }, type: "redeemed" }] : [];
  });
  return ticket.gameId;
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
    if (state.game.status === "invited") {
      await endGame(tx, gameId, { status: "void" });
      await writeEvents(tx, gameId, actor, [{ payload: {}, type: "expired" }]);
      return;
    }
    if (state.game.status !== "live") return;
    const decision = decideSettle(state);
    const tickets = decision.tickets.map((ticket) => ({ ...ticket, gameId, id: generateHostedRandomPrefixedId("gtk") }));
    await tx.gameTicket.createMany({ data: tickets });
    await endGame(tx, gameId, { result: toPrismaJsonObject(decision.result), settledAt: clock, status: "settled" });
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
    const shift = settleDueAt(loaded.state.players, loaded.state.game.lengthDays).getTime() - now.getTime();
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
    lengthDays: row.lengthDays,
    seats: GAME_SEATS_1V1,
    startsOn: fromDbDate(row.startsOn),
    status: toStatus(row.status),
    terms,
  };
}

function toStatus(value: string): GameStatus {
  if (value === "invited" || value === "live" || value === "settled" || value === "void") return value;
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
  if (due.length === 0) return { clock, games: loaded };
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
 * Players see their games; a rematch's addressed invitee sees it only while
 * it's still an invite (someone else may take the link).
 */
function canView(game: LoadedGame, memberId: string): boolean {
  if (playerFor(game.state, memberId)) return true;
  return game.row.status === "invited" && game.row.inviteeMemberId === memberId;
}

/**
 * Home shows what's open (invited, live, including a rematch addressed to you), the three most recently settled
 * games, and up to three invites that expired in the last week, so the
 * challenger sees "invite expired" rather than the game vanishing.
 */
function homeGames(games: readonly LoadedGame[], now: Date): LoadedGame[] {
  const latest = (status: "settled" | "void", at: (game: LoadedGame) => Date | null, count: number) => games
    .filter((game) => game.row.status === status && at(game) !== null)
    .sort((a, b) => at(b)!.getTime() - at(a)!.getTime())
    .slice(0, count);
  const settled = latest("settled", (game) => game.row.settledAt, HOME_SETTLED_SHOWN);
  const expired = latest("void", (game) => game.row.inviteExpiresAt, HOME_EXPIRED_SHOWN)
    .filter((game) => now.getTime() - game.row.inviteExpiresAt!.getTime() <= HOME_EXPIRED_FOR_MS);
  const shown = new Set([...settled, ...expired]);
  return games.filter((game) => game.row.status === "invited" || game.row.status === "live" || shown.has(game));
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
    return status === "invited" ? 2 : status === "settled" ? 3 : 4;
  };
  const newest = (game: LoadedGame) => (game.row.settledAt ?? game.row.startedAt ?? game.row.createdAt).getTime();
  return [...games].sort((a, b) => rank(a) - rank(b) || newest(b) - newest(a));
}

export async function readHome(memberId: string): Promise<GameHomeView> {
  const prisma = getPrisma();
  const [profile, seats, addressed, tickets] = await Promise.all([
    prisma.gameProfile.findUnique({ where: { memberId } }),
    prisma.gamePlayer.findMany({
      orderBy: { joinedAt: "desc" },
      select: { gameId: true },
      take: HOME_CANDIDATE_LIMIT,
      where: { game: { status: { in: ["invited", "live", "settled", "void"] } }, memberId },
    }),
    prisma.game.findMany({ select: { id: true }, take: HOME_CANDIDATE_LIMIT, where: { inviteeMemberId: memberId, status: "invited" } }),
    prisma.gameTicket.findMany({
      include: { game: { select: { createdBy: true, devClockOffsetMs: true, id: true, termsWordsEncrypted: true } } },
      orderBy: { createdAt: "desc" },
      take: WALLET_LIMIT,
      where: { OR: [{ owedTo: memberId }, { owedBy: memberId }] },
    }),
  ]);
  const current = await loadCurrent([...new Set([...seats.map((seat) => seat.gameId), ...addressed.map((game) => game.id)])]);
  const visible = current.games.filter((game) => canView(game, memberId));
  const games = sortForHome(homeGames(visible, current.clock), memberId, current.clock);
  const views = await buildViews(games, memberId, current.clock);
  const words = await readTermWords([...new Map(tickets.map((ticket) => [ticket.gameId, ticket.game])).values()]);
  const [firstName] = await openGameTexts(profile
    ? [{ field: "first_name", memberId, rowId: memberId, table: "game_profile", value: profile.firstNameEncrypted }]
    : []);
  const wallet = tickets.map((ticket) =>
    ticketView(toTicketRow(ticket), words.get(ticket.gameId) ?? null, memberId, gameNow(current.clock, ticket.game)));
  return {
    games: views,
    me: { firstName: firstName ?? null, memberId, timeZone: profile?.timeZone ?? null },
    wallet: {
      // Expired tickets stay where they were, marked expired.
      held: wallet.filter((ticket) => ticket.status !== "redeemed" && ticket.youHold),
      owed: wallet.filter((ticket) => ticket.status !== "redeemed" && !ticket.youHold),
      redeemed: wallet.filter((ticket) => ticket.status === "redeemed"),
    },
  };
}

/** Anyone with the link sees an open invite's details; a used or expired one shows only its status. */
export async function readInvitePreview(token: string): Promise<GameInvitePreview | null> {
  if (!isGameEnabled() || typeof token !== "string" || !token) return null;
  const row = await getPrisma().game.findUnique({
    include: { creator: true },
    where: { inviteTokenHash: sha256Hex(token) },
  });
  if (!row) return null;
  const now = gameNow(await databaseNow(getPrisma()), row);
  const expired = row.inviteExpiresAt !== null && row.inviteExpiresAt.getTime() < now.getTime();
  if (row.status !== "invited" || expired) return { status: row.status === "void" || expired ? "expired" : "used" };
  const label = parsePendingLabel(row.pendingLabel);
  const [inviterFirstName, inviteeFirstName, words] = await openGameTexts([
    { field: "first_name", memberId: row.createdBy, rowId: row.createdBy, table: "game_profile", value: row.creator.firstNameEncrypted },
    { ...labelTarget(row.createdBy, "name"), value: label.nameEncrypted },
    { ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted },
  ]);
  const game = toRuleStateGame(row, parseStoredTerms(row.terms));
  return {
    expiresAt: (row.inviteExpiresAt ?? row.createdAt).toISOString(),
    inviteeFirstName: inviteeFirstName ?? "",
    inviterFirstName: inviterFirstName ?? "",
    startsOn: game.startsOn,
    status: "open",
    terms: termsView({ entries: [], game, players: [] }, parseTermWords(words ?? "")),
  };
}

/**
 * Who may see a stored photo: its uploader (entry and invite label photos),
 * and otherwise exactly the players whose game view shows the entry it
 * belongs to (post-to-unlock, everything after settle).
 */
export async function authorizeMediaRead(memberId: string, mediaKey: string): Promise<boolean> {
  const ownerId = mediaKeyOwner(mediaKey);
  if (!ownerId) return false;
  if (ownerId === memberId) return true;
  // Keys come from the bytes, so one file can belong to several entries; check the latest few.
  const entries = await getPrisma().gameEntry.findMany({
    orderBy: { receivedAt: "desc" },
    select: { gameId: true, id: true },
    take: 5,
    where: { mediaKeys: { has: mediaKey }, memberId: ownerId },
  });
  const games = await loadGames(getPrisma(), [...new Set(entries.map((entry) => entry.gameId))]);
  return entries.some((entry) => {
    const game = games.find((candidate) => candidate.row.id === entry.gameId);
    return game !== undefined && visibleEntryIds(game.state, memberId).has(entry.id);
  });
}

// ------------------------------------------------------------ view assembly

function toTicketRow(ticket: {
  id: string;
  gameId: string;
  stakeKey: string;
  owedBy: string;
  owedTo: string;
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
  games: ReadonlyArray<{ id: string; createdBy: string; termsWordsEncrypted: string }>,
): Promise<Map<string, TermWords>> {
  const texts = await openGameTexts(games.map((game) => ({ ...gameTarget(game, "terms_words"), value: game.termsWordsEncrypted })));
  return new Map(games.map((game, index) => [game.id, parseTermWords(texts[index] ?? "")]));
}

/** Decrypts exactly what each game's viewer may see (one batch), then builds the views at each game's own now. */
async function buildViews(games: readonly LoadedGame[], viewerId: string, clock: Date): Promise<GameView[]> {
  if (games.length === 0) return [];
  const prisma = getPrisma();
  const memberIds = [...new Set([viewerId, ...games.flatMap((game) => game.row.players.map((player) => player.memberId))])];
  const [profiles, labels, tickets] = await Promise.all([
    prisma.gameProfile.findMany({ where: { memberId: { in: memberIds } } }),
    prisma.gameContactLabel.findMany({ where: { ownerMemberId: viewerId, subjectMemberId: { in: memberIds } } }),
    prisma.gameTicket.findMany({
      where: { gameId: { in: games.map((game) => game.row.id) }, OR: [{ owedTo: viewerId }, { owedBy: viewerId }] },
    }),
  ]);

  // One decrypt batch: words, names, labels, invite bits, visible entries.
  const requests: Array<GameSealTarget & { value: string | null }> = [];
  const ask = (target: GameSealTarget, value: string | null) => {
    requests.push({ ...target, value });
    return requests.length - 1;
  };
  const wordsAt = games.map((game) => ask(gameTarget(game.row, "terms_words"), game.row.termsWordsEncrypted));
  const profileNameAt = new Map(profiles.map((profile) => [
    profile.memberId,
    ask({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile" }, profile.firstNameEncrypted),
  ]));
  const labelNameAt = new Map(labels.map((label) => [label.subjectMemberId, ask(labelTarget(viewerId, "name"), label.nameEncrypted)]));
  const inviteAt = games.map((game) => {
    const { row } = game;
    if (row.status !== "invited") return null;
    const token = () => ask(gameTarget(row, "invite_token"), row.inviteTokenEncrypted);
    if (row.createdBy === viewerId) {
      const pending = parsePendingLabel(row.pendingLabel);
      return { memberId: row.inviteeMemberId, name: ask(labelTarget(viewerId, "name"), pending.nameEncrypted), photoKey: pending.photoKey, token: token() };
    }
    // The addressed invitee sees themselves by their own name, never the challenger's private label.
    if (row.inviteeMemberId === viewerId) return { memberId: viewerId, name: null, photoKey: null, token: token() };
    return null;
  });
  const textAt = new Map<string, number>();
  for (const game of games) {
    const visible = visibleEntryIds(game.state, viewerId);
    for (const entry of game.entries) {
      if (!visible.has(entry.id)) continue;
      textAt.set(entry.id, ask({ field: "text", memberId: entry.memberId, rowId: entry.id, table: "game_entry" }, entry.textEncrypted));
    }
  }
  const plain = await openGameTexts(requests);

  const names = new Map<string, string>();
  for (const profile of profiles) {
    const labelIndex = labelNameAt.get(profile.memberId);
    const labelName = profile.memberId !== viewerId && labelIndex !== undefined ? plain[labelIndex] : null;
    names.set(profile.memberId, labelName ?? plain[profileNameAt.get(profile.memberId)!] ?? "");
  }
  // Only the viewer's own invite photos: nobody else ever sees them.
  const avatarKeys = new Map(labels.map((label) => [label.subjectMemberId, label.photoKey]));
  const entryWords = new Map([...textAt].map(([entryId, at]) => [entryId, { text: plain[at] }]));
  return games.map((game, index) => {
    const invite = inviteAt[index];
    const result: StoredResult | null = game.row.result ? parseStoredResult(game.row.result) : null;
    return buildGameView({
      avatarKeys,
      entryWords,
      inviteExpiresAt: game.row.inviteExpiresAt,
      inviteToken: invite ? plain[invite.token] : null,
      invitee: invite
        ? { memberId: invite.memberId, name: (invite.name === null ? names.get(viewerId) : plain[invite.name]) ?? "", photoKey: invite.photoKey }
        : null,
      names,
      now: gameNow(clock, game.row),
      result,
      round: game.row.round,
      startedAt: game.row.startedAt,
      state: game.state,
      tickets: tickets.filter((ticket) => ticket.gameId === game.row.id).map(toTicketRow),
      viewerId,
      words: parseTermWords(plain[wordsAt[index]] ?? ""),
    });
  });
}
