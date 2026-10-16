import "server-only";

import { randomBytes } from "node:crypto";

import type { Game, GameEntry, GamePlayer, Prisma } from "@prisma/client";

import { toPrismaJsonObject } from "../device-sync/prisma-store/prisma-json";
import { isUniqueViolation } from "../device-sync/prisma-store/prisma-errors";
import { generateHostedRandomPrefixedId, isRecord, sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { areGameDevToolsAllowed, isGameEnabled, mediaKeyOwner, mediaKeyPrefixFor } from "./access";
import { parseGameCommand, parseRequestId } from "./command";
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
  decideVoid,
  decideWithdraw,
  GAME_ERROR_STATUS,
  GAME_INVITE_TTL_MS,
  GAME_SEATS_1V1,
  GameRuleError,
  parseStoredResult,
  parseStoredTerms,
  parseTermWords,
  playerFor,
  reject,
  type RuleState,
  type Schedule,
  type StoredResult,
  type TermWords,
} from "./rules";
import { buildGameView, gameMediaUrl, termsView, ticketView, visibleEntryIds, type GameTicketRow } from "./views";

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

const HOME_CANDIDATE_LIMIT = 50;
const HOME_SETTLED_SHOWN = 3;
const WALLET_LIMIT = 200;
const SETTLE_BATCH = 50;
const SYSTEM_ACTOR = "system";

// ------------------------------------------------------------------- writes

/**
 * The one write path, for the app's routes and Murph's tools alike. The
 * command is validated here, uploads are checked and words sealed before any
 * transaction; then every command runs in one short transaction that locks
 * the game row, reads the database clock, checks the rules, writes state and
 * one `game_event`, and commits. A retried `requestId` (a route's optional
 * Idempotency-Key) returns the current view without applying anything twice.
 */
export async function runGameCommand(input: {
  actorMemberId: string;
  command: unknown;
  requestId?: unknown;
  now?: Date;
}): Promise<GameCommandResult> {
  const actor = input.actorMemberId;
  let type: GameCommand["type"] | null = null;
  try {
    const requestId = input.requestId === undefined || input.requestId === null
      ? generateHostedRandomPrefixedId("req")
      : parseRequestId(input.requestId);
    const command = parseGameCommand(input.command);
    type = command.type;
    await requireUploadedMedia(actor, command);
    const gameId = await runCommand({ actor, now: input.now, requestId }, command);
    return { game: gameId ? await readGame(gameId, actor) : null, ok: true };
  } catch (error) {
    if (error instanceof GameRuleError) {
      return { error: error.error, ok: false, status: GAME_ERROR_STATUS[error.error.code] };
    }
    // Two games going live at once for the same person: the unique index decides.
    if (type === "join" && isUniqueViolation(error)) {
      const busy = { code: "ALREADY_IN_A_GAME" as const, message: "One of you is already in a game." };
      return { error: busy, ok: false, status: GAME_ERROR_STATUS.ALREADY_IN_A_GAME };
    }
    throw error;
  }
}

interface CommandContext {
  actor: string;
  requestId: string;
  now?: Date;
}

/** Applies one command; returns the game to show back, if any. */
async function runCommand(context: CommandContext, command: GameCommand): Promise<string | null> {
  switch (command.type) {
    case "setProfile":
      await setProfile(context.actor, command);
      return null;
    case "setLabel":
      await setLabel(context.actor, command);
      return null;
    case "createGame":
      return createGame(context, command);
    case "join":
      return join(context, command);
    case "void":
      return voidGame(context, command);
    case "post":
      return post(context, command);
    case "withdraw":
      return withdraw(context, command);
    case "redeem":
      return redeem(context, command);
  }
}

function mediaKeysOf(command: GameCommand): string[] {
  switch (command.type) {
    case "post":
      return command.mediaKeys;
    case "setProfile":
    case "setLabel":
      return command.photoKey ? [command.photoKey] : [];
    case "createGame":
      return command.inviteeLabel?.photoKey ? [command.inviteeLabel.photoKey] : [];
    default:
      return [];
  }
}

/** Every media key a command names must be the actor's own finished upload. */
async function requireUploadedMedia(actor: string, command: GameCommand): Promise<void> {
  const keys = mediaKeysOf(command);
  if (keys.length === 0) return;
  const prefix = mediaKeyPrefixFor(actor);
  const owned = isGameMediaStorageAvailable() && keys.every((key) => key.startsWith(prefix));
  const stored = owned ? await Promise.all(keys.map((key) => statGameMedia(key))) : [null];
  if (stored.includes(null)) reject("MEDIA_MISSING", "Upload the media before posting it.");
}

interface LockedStep {
  tx: Tx;
  loaded: LoadedGame;
  now: Date;
}
type GameEventDraft = { type: string; payload?: Record<string, string | number> } | null;

async function runLocked(
  context: CommandContext & { gameId: string },
  step: (locked: LockedStep) => Promise<GameEventDraft>,
): Promise<void> {
  const { actor, gameId, requestId } = context;
  try {
    await getPrisma().$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
      if (locked.length === 0) reject("GAME_NOT_FOUND", "Game not found.");
      const now = context.now ?? await databaseNow(tx);
      if (await findEvent(tx, actor, requestId)) return;
      const [loaded] = await loadGames(tx, [gameId]);
      const event = await step({ loaded, now, tx });
      if (!event) return;
      await tx.gameEvent.create({
        data: { actorId: actor, gameId, payload: { v: 1, ...event.payload }, requestId, type: event.type },
      });
      // Murph seam: once a game is hosted in a Murph group chat, append the
      // moment to HostedMailbox here, in this transaction, with dedupeKey =
      // the event id. The MVP has no chat, so nothing is sent.
    });
  } catch (error) {
    // A concurrent retry of the same request committed first.
    if (isUniqueViolation(error) && await findEvent(getPrisma(), actor, requestId)) return;
    throw error;
  }
}

function findEvent(db: Db, actorId: string, requestId: string) {
  return db.gameEvent.findUnique({ select: { id: true }, where: { actorId_requestId: { actorId, requestId } } });
}

async function databaseNow(tx: Tx): Promise<Date> {
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return row.now;
}

async function seal(target: GameSealTarget, value: string): Promise<string> {
  const sealed = await sealGameText(target, value);
  if (!sealed) throw new Error("Game encryption returned nothing.");
  return sealed;
}

/** Undefined stays undefined (leave the field), null clears, words get sealed. */
async function sealOptional(target: GameSealTarget, value: string | null | undefined): Promise<string | null | undefined> {
  return value === undefined || value === null ? value : seal(target, value);
}

function gameTarget(game: { id: string; createdBy: string }, field: string): GameSealTarget {
  return { field, memberId: game.createdBy, rowId: game.id, table: "game" };
}

async function findInvite(token: string) {
  const game = await getPrisma().game.findUnique({
    select: { createdBy: true, id: true },
    where: { inviteTokenHash: sha256Hex(token) },
  });
  return game ?? reject("INVITE_NOT_FOUND", "Invite not found.");
}

async function setProfile(actor: string, command: Extract<GameCommand, { type: "setProfile" }>): Promise<void> {
  const firstNameEncrypted = await seal(
    { field: "first_name", memberId: actor, rowId: actor, table: "game_profile" },
    command.firstName,
  );
  const avatar = command.photoKey === undefined ? {} : { avatarKey: command.photoKey };
  await getPrisma().gameProfile.upsert({
    create: { firstNameEncrypted, memberId: actor, timeZone: command.timeZone, ...avatar },
    update: { firstNameEncrypted, timeZone: command.timeZone, ...avatar },
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

async function setLabel(actor: string, command: Extract<GameCommand, { type: "setLabel" }>): Promise<void> {
  const { memberId } = command;
  const shared = memberId === actor ? null : await getPrisma().gamePlayer.findFirst({
    select: { gameId: true },
    where: { game: { players: { some: { memberId: actor } } }, memberId },
  });
  if (!shared) reject("INVALID_REQUEST", "Label someone you play with.");
  const [nameEncrypted, relationshipEncrypted] = await Promise.all([
    sealOptional(labelTarget(actor, "name"), command.name),
    sealOptional(labelTarget(actor, "relationship"), command.relationship),
  ]);
  const changes = {
    ...(nameEncrypted === undefined ? {} : { nameEncrypted }),
    ...(relationshipEncrypted === undefined ? {} : { relationshipEncrypted }),
    ...(command.photoKey === undefined ? {} : { photoKey: command.photoKey }),
  };
  await getPrisma().gameContactLabel.upsert({
    create: { ownerMemberId: actor, subjectMemberId: memberId, ...changes },
    update: changes,
    where: { ownerMemberId_subjectMemberId: { ownerMemberId: actor, subjectMemberId: memberId } },
  });
}

async function createGame(context: CommandContext, command: Extract<GameCommand, { type: "createGame" }>): Promise<string> {
  const { actor, requestId } = context;
  const { gameId } = command;
  const prisma = getPrisma();
  const profile = await prisma.gameProfile.findUnique({ select: { timeZone: true }, where: { memberId: actor } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");
  const existing = await prisma.game.findUnique({ select: { createdBy: true }, where: { id: gameId } });
  if (existing) {
    if (existing.createdBy !== actor) reject("INVALID_REQUEST", "That game id is taken.");
    return gameId;
  }
  const previous = command.previousGameId ? await readRematchSource(actor, command.previousGameId) : null;
  const newTerms = decideNewTerms(command.terms, {
    newKey: () => generateHostedRandomPrefixedId("gsk"),
    previousStakeKeys: new Set(previous?.stakeKeys ?? []),
  });
  const token = randomBytes(24).toString("base64url");
  const where = { createdBy: actor, id: gameId };
  const [termsWordsEncrypted, inviteTokenEncrypted, nameEncrypted, relationshipEncrypted] = await Promise.all([
    seal(gameTarget(where, "terms_words"), JSON.stringify(newTerms.words)),
    seal(gameTarget(where, "invite_token"), token),
    seal(labelTarget(actor, "name"), command.inviteeFirstName),
    sealOptional(labelTarget(actor, "relationship"), command.inviteeLabel?.relationship),
  ]);
  const pendingLabel = {
    nameEncrypted,
    photoKey: command.inviteeLabel?.photoKey ?? null,
    relationshipEncrypted: relationshipEncrypted ?? null,
  };
  try {
    await prisma.$transaction(async (tx) => {
      const now = context.now ?? await databaseNow(tx);
      const expiresAt = new Date(now.getTime() + GAME_INVITE_TTL_MS);
      await tx.game.create({
        data: {
          createdBy: actor,
          id: gameId,
          inviteExpiresAt: expiresAt,
          inviteTokenEncrypted,
          inviteTokenHash: sha256Hex(token),
          lengthDays: newTerms.lengthDays,
          nextDueAt: expiresAt,
          pendingLabel,
          // The time zone here is a placeholder; it freezes when the game goes live.
          players: { create: { agreedTermsVersion: 1, memberId: actor, seat: 0, timeZone: profile.timeZone } },
          previousGameId: previous?.id ?? null,
          round: previous?.nextRound ?? 1,
          status: "invited",
          terms: toPrismaJsonObject(newTerms.terms),
          termsWordsEncrypted,
        },
      });
      await tx.gameEvent.create({
        data: { actorId: actor, gameId, payload: { lengthDays: newTerms.lengthDays, v: 1 }, requestId, type: "created" },
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.game.findUnique({ select: { createdBy: true }, where: { id: gameId } });
    if (raced?.createdBy !== actor) reject("INVALID_REQUEST", "That game id is taken.");
  }
  return gameId;
}

/**
 * A rematch must follow a finished game the challenger played. It continues
 * the round count after a settled game (the joiner is checked at go-live) and
 * may keep that game's stake keys.
 */
async function readRematchSource(actor: string, previousGameId: string) {
  const previous = await getPrisma().game.findUnique({
    include: { players: { select: { memberId: true } } },
    where: { id: previousGameId },
  });
  const finished = previous?.status === "settled" || previous?.status === "void";
  if (!previous || !finished || !previous.players.some((player) => player.memberId === actor)) {
    reject("INVALID_REQUEST", "A rematch needs a finished game you played.");
  }
  return {
    id: previous.id,
    nextRound: previous.status === "settled" ? previous.round + 1 : 1,
    stakeKeys: parseStoredTerms(previous.terms).versions.flatMap((version) => version.stakes.map((stake) => stake.key)),
  };
}

async function join(context: CommandContext, command: Extract<GameCommand, { type: "join" }>): Promise<string> {
  const { actor } = context;
  const target = await findInvite(command.token);
  const profile = await getPrisma().gameProfile.findUnique({ select: { memberId: true }, where: { memberId: actor } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");
  // A finished game nobody opened must not hold either player.
  await settleOverdueGamesOf([actor, target.createdBy]);
  await runLocked({ ...context, gameId: target.id }, async ({ loaded, now, tx }) => {
    const { row } = loaded;
    const decision = decideJoin(await withCurrentTimeZones(tx, loaded.state), {
      memberId: actor,
      now,
      termsVersion: command.termsVersion,
      timeZone: command.timeZone,
    });
    if (decision.kind === "already-joined") return null;
    // The unique active_member_id index is the real guard; this gives the friendly error.
    const busy = await tx.gamePlayer.findFirst({
      select: { gameId: true },
      where: { activeMemberId: { in: decision.players.map((player) => player.memberId) } },
    });
    if (busy) reject("ALREADY_IN_A_GAME", "One of you is already in a game.");
    await tx.gamePlayer.create({
      data: { agreedTermsVersion: command.termsVersion, gameId: row.id, memberId: actor, seat: decision.seat, timeZone: command.timeZone },
    });
    await writeSchedule(tx, row.id, decision, { activate: true });
    await tx.game.update({
      data: { round: await roundAtGoLive(tx, row, actor), startedAt: decision.startedAt, status: "live" },
      where: { id: row.id },
    });
    await copyPendingLabel(tx, row, actor);
    return { payload: { seat: decision.seat }, type: "joined" };
  });
  return target.id;
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

async function settleOverdueGamesOf(memberIds: string[]): Promise<void> {
  const held = await getPrisma().gamePlayer.findMany({
    select: { gameId: true },
    where: { activeMemberId: { in: memberIds }, game: { nextDueAt: { lte: new Date() } } },
  });
  for (const { gameId } of held) await settleGame(gameId);
}

/** Writes each player's frozen time zone and Day 1, and the settle time. */
async function writeSchedule(tx: Tx, gameId: string, schedule: Schedule, options: { activate?: boolean } = {}): Promise<void> {
  for (const player of schedule.players) {
    await tx.gamePlayer.update({
      data: {
        dayOne: toDbDate(player.dayOne),
        timeZone: player.timeZone,
        ...(options.activate ? { activeMemberId: player.memberId } : {}),
      },
      where: { gameId_memberId: { gameId, memberId: player.memberId } },
    });
  }
  await tx.game.update({ data: { nextDueAt: schedule.nextDueAt }, where: { id: gameId } });
}

/** The challenger's invite label becomes their label for the joiner; existing fields win. */
async function copyPendingLabel(tx: Tx, row: GameRow, joinerId: string): Promise<void> {
  const label = parsePendingLabel(row.pendingLabel);
  if (!label.nameEncrypted && !label.relationshipEncrypted && !label.photoKey) return;
  await tx.$executeRaw`
    INSERT INTO game_contact_label
      (owner_member_id, subject_member_id, name_encrypted, relationship_encrypted, photo_key, updated_at)
    VALUES (${row.createdBy}, ${joinerId}, ${label.nameEncrypted}, ${label.relationshipEncrypted}, ${label.photoKey}, now())
    ON CONFLICT (owner_member_id, subject_member_id) DO UPDATE SET
      name_encrypted = COALESCE(game_contact_label.name_encrypted, EXCLUDED.name_encrypted),
      relationship_encrypted = COALESCE(game_contact_label.relationship_encrypted, EXCLUDED.relationship_encrypted),
      photo_key = COALESCE(game_contact_label.photo_key, EXCLUDED.photo_key),
      updated_at = EXCLUDED.updated_at`;
}

async function voidGame(context: CommandContext, command: Extract<GameCommand, { type: "void" }>): Promise<string> {
  const gameId = command.reason === "declined" ? (await findInvite(command.token)).id : command.gameId;
  await runLocked({ ...context, gameId }, async ({ loaded, tx }) => {
    decideVoid(loaded.state, { memberId: context.actor, reason: command.reason });
    await endGame(tx, gameId, { status: "void", voidReason: command.reason });
    return { type: command.reason };
  });
  return gameId;
}

async function endGame(tx: Tx, gameId: string, data: Prisma.GameUpdateInput): Promise<void> {
  await tx.game.update({ data: { ...data, nextDueAt: null }, where: { id: gameId } });
  await tx.gamePlayer.updateMany({ data: { activeMemberId: null }, where: { gameId } });
}

async function post(context: CommandContext, command: Extract<GameCommand, { type: "post" }>): Promise<string> {
  const { actor } = context;
  const { entryId, gameId, kind, mediaKeys } = command;
  const existing = await getPrisma().gameEntry.findUnique({ select: { memberId: true }, where: { id: entryId } });
  if (existing) {
    if (existing.memberId !== actor) reject("INVALID_REQUEST", "That entry id is taken.");
    return gameId;
  }
  const target = (field: string): GameSealTarget => ({ field, memberId: actor, rowId: entryId, table: "game_entry" });
  const [textEncrypted, dataEncrypted] = await Promise.all([
    command.text ? seal(target("text"), command.text) : null,
    command.data ? seal(target("data"), JSON.stringify(command.data)) : null,
  ]);
  const captureAgeMs = command.captureAgeMs ?? null;
  await runLocked({ ...context, gameId }, async ({ loaded, now, tx }) => {
    const decision = decidePost(loaded.state, {
      captureAgeMs,
      hasText: Boolean(command.text),
      kind,
      mediaKeyPrefix: mediaKeyPrefixFor(actor),
      mediaKeys,
      memberId: actor,
      now,
    });
    if (decision.withdrawEntryId) {
      await tx.gameEntry.update({
        data: { withdrawnAt: now, withdrawnReason: "retake" },
        where: { id: decision.withdrawEntryId },
      });
    }
    await tx.gameEntry.create({
      data: {
        attempt: decision.attempt,
        captureAgeMs,
        dataEncrypted,
        dayIndex: decision.dayIndex,
        gameId,
        id: entryId,
        kind,
        mediaKeys,
        memberId: actor,
        receivedAt: now,
        textEncrypted,
      },
    });
    return { payload: { attempt: decision.attempt, dayIndex: decision.dayIndex, entryId }, type: kind === "excuse" ? "excused" : "posted" };
  });
  return gameId;
}

async function withdraw(context: CommandContext, command: Extract<GameCommand, { type: "withdraw" }>): Promise<string> {
  const { entryId, gameId } = command;
  await runLocked({ ...context, gameId }, async ({ loaded, now, tx }) => {
    const { withdrawEntryId } = decideWithdraw(loaded.state, { entryId, memberId: context.actor, now });
    if (!withdrawEntryId) return null;
    await tx.gameEntry.update({ data: { withdrawnAt: now, withdrawnReason: "withdrawn" }, where: { id: withdrawEntryId } });
    return { payload: { entryId }, type: "withdrew" };
  });
  return gameId;
}

async function redeem(context: CommandContext, command: Extract<GameCommand, { type: "redeem" }>): Promise<string> {
  const { actor } = context;
  const { ticketId } = command;
  const ticket = await getPrisma().gameTicket.findUnique({ select: { gameId: true, owedTo: true }, where: { id: ticketId } });
  if (!ticket?.gameId || ticket.owedTo !== actor) reject("TICKET_NOT_HELD", "That ticket isn't yours to cash in.");
  const gameId = ticket.gameId;
  await runLocked({ ...context, gameId }, async ({ now, tx }) => {
    const changed = await tx.gameTicket.updateMany({
      data: { redeemedAt: now, status: "redeemed" },
      where: { id: ticketId, owedTo: actor, status: "open" },
    });
    // Zero rows means it was already redeemed: a retry, not an error.
    return changed.count === 1 ? { payload: { ticketId }, type: "redeemed" } : null;
  });
  return gameId;
}

// ------------------------------------------------------------------- settle

/**
 * Settles one game if it's due (or `force`): freezes the result on the game
 * row, issues tickets and logs the event in one transaction. An unclaimed
 * invite past its expiry is voided instead. Returns whether anything changed.
 */
async function settleGame(gameId: string, options: { force?: boolean; now?: Date } = {}): Promise<boolean> {
  return getPrisma().$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    if (locked.length === 0) return false;
    const now = options.now ?? await databaseNow(tx);
    const [loaded] = await loadGames(tx, [gameId]);
    const { row, state } = loaded;
    const due = options.force || (row.nextDueAt !== null && row.nextDueAt.getTime() <= now.getTime());
    if (!due || (row.status !== "invited" && row.status !== "live")) return false;
    if (row.status === "invited") {
      await endGame(tx, gameId, { status: "void", voidReason: "expired" });
      await tx.gameEvent.create({ data: { actorId: SYSTEM_ACTOR, gameId, payload: { v: 1 }, type: "expired" } });
      return true;
    }
    const decision = decideSettle(state);
    await tx.gameTicket.createMany({
      data: decision.tickets.map((ticket) => ({
        gameId,
        id: generateHostedRandomPrefixedId("gtk"),
        owedBy: ticket.owedBy,
        owedTo: ticket.owedTo,
        stakeKey: ticket.stakeKey,
      })),
    });
    await endGame(tx, gameId, { result: toPrismaJsonObject(decision.result), settledAt: now, status: "settled" });
    await tx.gameEvent.create({
      data: { actorId: SYSTEM_ACTOR, gameId, payload: { tickets: decision.tickets.length, v: 1 }, type: "settled" },
    });
    return true;
  });
}

/** The settle timer: every game whose `next_due_at` has passed. Off while the game is dark. */
export async function settleDueGames(now?: Date): Promise<{ settled: number }> {
  if (!isGameEnabled()) return { settled: 0 };
  const due = await getPrisma().game.findMany({
    orderBy: { nextDueAt: "asc" },
    select: { id: true },
    take: SETTLE_BATCH,
    where: { nextDueAt: { lte: now ?? new Date() }, status: { in: ["invited", "live"] } },
  });
  let settled = 0;
  for (const { id } of due) {
    if (await settleGame(id, { now })) settled += 1;
  }
  return { settled };
}

// --------------------------------------------------------------------- dev

function assertDevTools(): void {
  if (!areGameDevToolsAllowed()) throw new Error("Game dev tools are off in production.");
}

async function runDevStep(gameId: string, memberId: string, step: (locked: LockedStep) => Promise<GameEventDraft>): Promise<GameView> {
  assertDevTools();
  const requestId = generateHostedRandomPrefixedId("dev");
  await runLocked({ actor: memberId, gameId, requestId }, async (locked) => {
    if (!playerFor(locked.loaded.state, memberId)) reject("NOT_A_PLAYER", "You're not in this game.");
    return step(locked);
  });
  return requireView(gameId, memberId);
}

export async function devStartNow(gameId: string, memberId: string): Promise<GameView> {
  return runDevStep(gameId, memberId, async ({ loaded, now, tx }) => {
    await writeSchedule(tx, gameId, decideStartNow(loaded.state, now));
    await tx.game.update({ data: { startedAt: now }, where: { id: gameId } });
    return { type: "started_now" };
  });
}

export async function devAdvanceDays(gameId: string, memberId: string, days: number): Promise<GameView> {
  return runDevStep(gameId, memberId, async ({ loaded, tx }) => {
    await writeSchedule(tx, gameId, decideDevAdvance(loaded.state, days));
    if (loaded.row.startedAt) {
      const startedAt = new Date(loaded.row.startedAt.getTime() - days * 24 * 60 * 60 * 1000);
      await tx.game.update({ data: { startedAt }, where: { id: gameId } });
    }
    return { payload: { days }, type: "dev_advanced" };
  });
}

export async function devSettleNow(gameId: string, memberId: string): Promise<GameView> {
  assertDevTools();
  const loaded = await loadGames(getPrisma(), [gameId]);
  if (!loaded[0] || !playerFor(loaded[0].state, memberId)) reject("GAME_NOT_FOUND", "Game not found.");
  if (loaded[0].row.status !== "live") reject("GAME_NOT_LIVE", "This game isn't live.");
  await settleGame(gameId, { force: true });
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
      active: player.activeMemberId !== null,
      agreedTermsVersion: player.agreedTermsVersion,
      dayOne: player.dayOne ? player.dayOne.toISOString().slice(0, 10) : null,
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
    nextDueAt: row.nextDueAt,
    seats: GAME_SEATS_1V1,
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

function isDue(row: Game, now: Date): boolean {
  return (row.status === "invited" || row.status === "live") && row.nextDueAt !== null && row.nextDueAt <= now;
}

/** Settles anything past due before showing it, so a missed timer can't strand a game. */
async function loadCurrent(gameIds: readonly string[]): Promise<LoadedGame[]> {
  const prisma = getPrisma();
  const loaded = await loadGames(prisma, gameIds);
  const now = new Date();
  const due = loaded.filter((game) => isDue(game.row, now)).map((game) => game.row.id);
  if (due.length === 0) return loaded;
  for (const id of due) await settleGame(id);
  return loadGames(prisma, gameIds);
}

/** Membership alone, for checks that don't need the whole game (uploads). */
export async function isGamePlayer(gameId: string, memberId: string): Promise<boolean> {
  const player = await getPrisma().gamePlayer.findUnique({
    select: { gameId: true },
    where: { gameId_memberId: { gameId, memberId } },
  });
  return player !== null;
}

export async function readGame(gameId: string, memberId: string): Promise<GameView | null> {
  const [loaded] = await loadCurrent([gameId]);
  if (!loaded || !playerFor(loaded.state, memberId)) return null;
  const [view] = await buildViews([loaded], memberId);
  return view;
}

/** Home shows what's open (invited, live) and the three most recently settled games. */
function homeGames(games: readonly LoadedGame[]): LoadedGame[] {
  const settled = games
    .filter((game) => game.row.status === "settled")
    .sort((a, b) => (b.row.settledAt?.getTime() ?? 0) - (a.row.settledAt?.getTime() ?? 0))
    .slice(0, HOME_SETTLED_SHOWN);
  return games.filter((game) => game.row.status === "invited" || game.row.status === "live" || settled.includes(game));
}

export async function readHome(memberId: string): Promise<GameHomeView> {
  const prisma = getPrisma();
  const [profile, seats, tickets] = await Promise.all([
    prisma.gameProfile.findUnique({ where: { memberId } }),
    prisma.gamePlayer.findMany({
      orderBy: { joinedAt: "desc" },
      select: { gameId: true },
      take: HOME_CANDIDATE_LIMIT,
      where: { game: { status: { in: ["invited", "live", "settled"] } }, memberId },
    }),
    prisma.gameTicket.findMany({
      orderBy: { createdAt: "desc" },
      take: WALLET_LIMIT,
      where: { OR: [{ owedTo: memberId }, { owedBy: memberId }] },
    }),
  ]);
  const games = homeGames(await loadCurrent(seats.map((seat) => seat.gameId)));
  const views = await buildViews(games, memberId);
  const ticketGameIds = [...new Set(tickets.flatMap((ticket) => (ticket.gameId ? [ticket.gameId] : [])))];
  const words = await readTermWords(ticketGameIds.length
    ? await prisma.game.findMany({ select: { createdBy: true, id: true, termsWordsEncrypted: true }, where: { id: { in: ticketGameIds } } })
    : []);
  const [firstName] = await openGameTexts(profile
    ? [{ field: "first_name", memberId, rowId: memberId, table: "game_profile", value: profile.firstNameEncrypted }]
    : []);
  const wallet = tickets.map((ticket) => ticketView(toTicketRow(ticket), ticket.gameId ? words.get(ticket.gameId) ?? null : null, memberId));
  return {
    games: views,
    me: {
      avatarUrl: profile?.avatarKey ? gameMediaUrl(profile.avatarKey) : null,
      firstName: firstName ?? null,
      memberId,
      timeZone: profile?.timeZone ?? null,
    },
    wallet: {
      held: wallet.filter((ticket) => ticket.status === "open" && ticket.youHold),
      owed: wallet.filter((ticket) => ticket.status === "open" && !ticket.youHold),
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
  const expired = row.inviteExpiresAt !== null && row.inviteExpiresAt.getTime() < Date.now();
  if (row.status !== "invited" || expired) return { status: row.status === "void" || expired ? "expired" : "used" };
  const label = parsePendingLabel(row.pendingLabel);
  const [inviterFirstName, inviteeFirstName, words] = await openGameTexts([
    { field: "first_name", memberId: row.createdBy, rowId: row.createdBy, table: "game_profile", value: row.creator.firstNameEncrypted },
    { ...labelTarget(row.createdBy, "name"), value: label.nameEncrypted },
    { ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted },
  ]);
  const terms = parseStoredTerms(row.terms);
  return {
    expiresAt: (row.inviteExpiresAt ?? row.createdAt).toISOString(),
    inviteeFirstName: inviteeFirstName ?? "",
    inviterFirstName: inviterFirstName ?? "",
    status: "open",
    terms: termsView({ entries: [], game: toRuleStateGame(row, terms), players: [] }, parseTermWords(words ?? "")),
  };
}

/**
 * Who may see a stored file: its uploader; a co-player once they've posted
 * for that day (or after settle), never for an excuse; anyone who shares a
 * game with a player, for that player's profile photo.
 */
export async function authorizeMediaRead(memberId: string, mediaKey: string): Promise<boolean> {
  const ownerId = mediaKeyOwner(mediaKey);
  if (!ownerId) return false;
  if (ownerId === memberId) return true;
  const prisma = getPrisma();
  const entries = await prisma.gameEntry.findMany({
    select: { attempt: true, dayIndex: true, gameId: true, withdrawnAt: true },
    take: 5,
    where: { mediaKeys: { has: mediaKey }, memberId: ownerId },
  });
  for (const entry of entries) {
    if (entry.attempt === 0 || entry.withdrawnAt) continue;
    const game = await prisma.game.findUnique({
      select: { players: { select: { memberId: true } }, status: true },
      where: { id: entry.gameId },
    });
    if (!game?.players.some((player) => player.memberId === memberId)) continue;
    if (game.status === "settled") return true;
    const unlocked = await prisma.gameEntry.count({
      where: { attempt: { gt: 0 }, dayIndex: entry.dayIndex, gameId: entry.gameId, memberId },
    });
    if (unlocked > 0) return true;
  }
  const avatar = await prisma.gameProfile.findFirst({ select: { memberId: true }, where: { avatarKey: mediaKey, memberId: ownerId } });
  if (!avatar) return false;
  const shared = await prisma.gamePlayer.findFirst({
    select: { gameId: true },
    where: { game: { players: { some: { memberId: ownerId } } }, memberId },
  });
  return shared !== null;
}

// ------------------------------------------------------------ view assembly

function toTicketRow(ticket: {
  id: string;
  gameId: string | null;
  stakeKey: string;
  owedBy: string;
  owedTo: string;
  status: string;
  createdAt: Date;
  redeemedAt: Date | null;
}): GameTicketRow {
  return { ...ticket, status: ticket.status === "redeemed" ? "redeemed" : "open" };
}

async function readTermWords(
  games: ReadonlyArray<{ id: string; createdBy: string; termsWordsEncrypted: string }>,
): Promise<Map<string, TermWords>> {
  const texts = await openGameTexts(games.map((game) => ({ ...gameTarget(game, "terms_words"), value: game.termsWordsEncrypted })));
  return new Map(games.map((game, index) => [game.id, parseTermWords(texts[index] ?? "")]));
}

/** Decrypts exactly what each game's viewer may see (one batch), then builds the views. */
async function buildViews(games: readonly LoadedGame[], viewerId: string): Promise<GameView[]> {
  if (games.length === 0) return [];
  const prisma = getPrisma();
  const memberIds = [...new Set(games.flatMap((game) => game.row.players.map((player) => player.memberId)))];
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
    if (game.row.status !== "invited" || game.row.createdBy !== viewerId) return null;
    const pending = parsePendingLabel(game.row.pendingLabel);
    return {
      name: ask(labelTarget(viewerId, "name"), pending.nameEncrypted),
      photoKey: pending.photoKey,
      token: ask(gameTarget(game.row, "invite_token"), game.row.inviteTokenEncrypted),
    };
  });
  const entryAt = new Map<string, { text: number; data: number }>();
  games.forEach((game) => {
    const visible = visibleEntryIds(game.state, viewerId);
    for (const entry of game.entries) {
      if (!visible.has(entry.id)) continue;
      const target = (field: string): GameSealTarget => ({ field, memberId: entry.memberId, rowId: entry.id, table: "game_entry" });
      entryAt.set(entry.id, { data: ask(target("data"), entry.dataEncrypted), text: ask(target("text"), entry.textEncrypted) });
    }
  });
  const plain = await openGameTexts(requests);

  const names = new Map<string, string>();
  const avatarKeys = new Map<string, string | null>();
  for (const profile of profiles) {
    const labelIndex = labelNameAt.get(profile.memberId);
    const labelName = profile.memberId !== viewerId && labelIndex !== undefined ? plain[labelIndex] : null;
    names.set(profile.memberId, labelName ?? plain[profileNameAt.get(profile.memberId)!] ?? "");
    const labelPhoto = profile.memberId !== viewerId
      ? labels.find((label) => label.subjectMemberId === profile.memberId)?.photoKey
      : null;
    avatarKeys.set(profile.memberId, labelPhoto ?? profile.avatarKey);
  }
  const entryWords = new Map<string, { text: string | null; data: Record<string, unknown> | null }>();
  for (const [entryId, at] of entryAt) {
    const data = plain[at.data];
    const parsed: unknown = data ? JSON.parse(data) : null;
    entryWords.set(entryId, { data: isRecord(parsed) ? parsed : null, text: plain[at.text] });
  }
  const now = new Date();
  return games.map((game, index) => {
    const invite = inviteAt[index];
    const result: StoredResult | null = game.row.result ? parseStoredResult(game.row.result) : null;
    return buildGameView({
      avatarKeys,
      entryWords,
      inviteExpiresAt: game.row.inviteExpiresAt,
      inviteToken: invite ? plain[invite.token] : null,
      invitee: invite ? { name: plain[invite.name] ?? "", photoKey: invite.photoKey } : null,
      names,
      now,
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
