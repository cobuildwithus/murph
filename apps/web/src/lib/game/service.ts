import "server-only";

import { randomBytes } from "node:crypto";

import type { Game, GameEntry, GamePlayer, Prisma } from "@prisma/client";

import { isUniqueViolation } from "../device-sync/prisma-store/prisma-errors";
import { generateHostedRandomPrefixedId, isRecord, sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { areGameDevToolsAllowed, isGameEnabled, mediaKeyOwner, mediaKeyPrefixFor } from "./access";
import {
  GAME_SCHEMA_VERSION,
  type GameCommand,
  type GameCommandRequest,
  type GameEntryKind,
  type GameError,
  type GameHomeView,
  type GameInvitePreview,
  type GameStatus,
  type GameView,
} from "./contract";
import { labelTarget, openGameTexts, sealGameText, type GameSealTarget } from "./crypto";
import {
  decideDeleteToday,
  decideDevAdvance,
  decideJoin,
  decideNewTerms,
  decidePost,
  decideSettle,
  decideStartNow,
  decideVoid,
  GAME_ERROR_STATUS,
  GAME_INVITE_TTL_MS,
  GAME_SEATS_1V1,
  GameRuleError,
  optionalWords,
  parseStoredResult,
  parseStoredTerms,
  parseTermWords,
  playerFor,
  requireClientId,
  requireFirstName,
  requireTimeZone,
  type RuleState,
  type StoredResult,
  type TermWords,
} from "./rules";
import {
  buildGameView,
  gameMediaUrl,
  roundNumber,
  termsView,
  ticketView,
  visibleEntryIds,
  type GameTicketRow,
} from "./views";

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

const ENTRY_KINDS: readonly GameEntryKind[] = ["photo", "video", "voice", "text", "workout", "number", "excuse"];
const MAX_MEDIA_KEYS = 4;
const MAX_TEXT = 2000;
const MAX_DATA_BYTES = 16_000;
const MAX_CAPTURE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const HOME_GAME_LIMIT = 20;
const WALLET_LIMIT = 200;
const SETTLE_BATCH = 50;
const SYSTEM_ACTOR = "system";

function reject(code: GameError["code"], message: string): never {
  throw new GameRuleError(code, message);
}

function isEntryKind(value: unknown): value is GameEntryKind {
  return ENTRY_KINDS.some((kind) => kind === value);
}

// ------------------------------------------------------------------- writes

/**
 * The one write path. Every command runs in one short transaction that locks
 * the game row, reads the database clock, checks the rules, writes state and
 * one `game_event`, and commits. Words are sealed before it starts. A retried
 * `requestId` returns the current view without applying anything twice.
 */
export async function runGameCommand(input: {
  actorMemberId: string;
  request: GameCommandRequest;
  now?: Date;
}): Promise<GameCommandResult> {
  const { actorMemberId: actor, request } = input;
  try {
    if (request.schemaVersion !== GAME_SCHEMA_VERSION) reject("INVALID_REQUEST", "Update the app to keep playing.");
    const requestId = requireClientId(request.requestId, "Request id");
    const context = { actor, now: input.now, requestId };
    const gameId = await runCommand(context, request.command);
    return { game: gameId ? await readGame(gameId, actor) : null, ok: true };
  } catch (error) {
    if (error instanceof GameRuleError) {
      return { error: error.error, ok: false, status: GAME_ERROR_STATUS[error.error.code] };
    }
    if (request.command?.type === "join" && isUniqueViolation(error)) {
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
  switch (command?.type) {
    case "setProfile":
      await setProfile(context.actor, command);
      return null;
    case "setLabel":
      return setLabel(context, command);
    case "createGame":
      return createGame(context, command);
    case "join":
      return join(context, command);
    case "void":
      return voidGame(context, command);
    case "post":
      return post(context, command);
    case "deleteToday":
      return deleteToday(context, command);
    case "redeem":
      return redeem(context, command);
    default:
      return reject("INVALID_REQUEST", "Unknown command.");
  }
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
      // Murph seam: once the circle has a Murph chat (game_circle.hosted_group_id),
      // append the moment to HostedMailbox here, in this transaction, with
      // dedupeKey = the event id. The MVP has no chat, so nothing is sent.
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

function gameTarget(game: { id: string; createdBy: string }, field: string): GameSealTarget {
  return { field, memberId: game.createdBy, rowId: game.id, table: "game" };
}

function optionalOwnMediaKey(value: unknown, actor: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !value.startsWith(mediaKeyPrefixFor(actor))) {
    reject("INVALID_REQUEST", "Photos must be uploaded by you.");
  }
  return value;
}

async function setProfile(actor: string, command: Extract<GameCommand, { type: "setProfile" }>): Promise<void> {
  const firstName = requireFirstName(command.firstName);
  const timeZone = requireTimeZone(command.timeZone);
  const photoKey = optionalOwnMediaKey(command.photoKey, actor);
  const firstNameEncrypted = await seal(
    { field: "first_name", memberId: actor, rowId: actor, table: "game_profile" },
    firstName,
  );
  const avatar = photoKey === undefined ? {} : { avatarKey: photoKey };
  await getPrisma().gameProfile.upsert({
    create: { firstNameEncrypted, memberId: actor, timeZone, ...avatar },
    update: { firstNameEncrypted, timeZone, ...avatar },
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

async function setLabel(context: CommandContext, command: Extract<GameCommand, { type: "setLabel" }>): Promise<string | null> {
  const { actor } = context;
  const name = optionalWords(command.name, "Name");
  const relationship = optionalWords(command.relationship, "Relationship");
  const photoKey = optionalOwnMediaKey(command.photoKey, actor);
  const sealOptional = async (field: "name" | "relationship", value: string | null | undefined) =>
    value === undefined ? undefined : value === null ? null : seal(labelTarget(actor, field), value);
  const [nameEncrypted, relationshipEncrypted] = await Promise.all([
    sealOptional("name", name),
    sealOptional("relationship", relationship),
  ]);
  const changes = {
    ...(nameEncrypted === undefined ? {} : { nameEncrypted }),
    ...(relationshipEncrypted === undefined ? {} : { relationshipEncrypted }),
    ...(photoKey === undefined ? {} : { photoKey }),
  };
  const subject: unknown = command.subject;
  if (isRecord(subject) && typeof subject.inviteToken === "string") {
    const game = await getPrisma().game.findUnique({
      select: { createdBy: true, id: true },
      where: { inviteTokenHash: sha256Hex(subject.inviteToken) },
    });
    if (!game || game.createdBy !== actor) reject("INVITE_NOT_FOUND", "Invite not found.");
    await runLocked({ ...context, gameId: game.id }, async ({ loaded, tx }) => {
      if (loaded.row.status !== "invited") reject("INVITE_USED", "They already joined. Label them directly.");
      const merged = { ...parsePendingLabel(loaded.row.pendingLabel), ...changes };
      await tx.game.update({ data: { pendingLabel: { ...merged } }, where: { id: game.id } });
      return null;
    });
    return game.id;
  }
  if (!isRecord(subject) || typeof subject.memberId !== "string" || subject.memberId === actor) {
    reject("INVALID_REQUEST", "Label someone you play with.");
  }
  const subjectId = subject.memberId;
  const shared = await getPrisma().gamePlayer.findFirst({
    select: { gameId: true },
    where: { game: { players: { some: { memberId: actor } } }, memberId: subjectId },
  });
  if (!shared) reject("INVALID_REQUEST", "Label someone you play with.");
  await getPrisma().gameContactLabel.upsert({
    create: { ownerMemberId: actor, subjectMemberId: subjectId, ...changes },
    update: changes,
    where: { ownerMemberId_subjectMemberId: { ownerMemberId: actor, subjectMemberId: subjectId } },
  });
  return null;
}

async function createGame(context: CommandContext, command: Extract<GameCommand, { type: "createGame" }>): Promise<string> {
  const { actor, requestId } = context;
  const prisma = getPrisma();
  const gameId = requireClientId(command.gameId, "Game id");
  const inviteeFirstName = requireFirstName(command.inviteeFirstName);
  const profile = await prisma.gameProfile.findUnique({ select: { timeZone: true }, where: { memberId: actor } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");
  const existing = await prisma.game.findUnique({ select: { createdBy: true }, where: { id: gameId } });
  if (existing) {
    if (existing.createdBy !== actor) reject("INVALID_REQUEST", "That game id is taken.");
    return gameId;
  }
  let previous: { id: string; circleId: string | null; terms: Prisma.JsonValue } | null = null;
  if (command.previousGameId !== undefined) {
    const candidate = await prisma.game.findUnique({
      include: { players: { select: { memberId: true } } },
      where: { id: String(command.previousGameId) },
    });
    if (
      !candidate
      || !candidate.players.some((player) => player.memberId === actor)
      || (candidate.status !== "settled" && candidate.status !== "void")
    ) {
      reject("INVALID_REQUEST", "A rematch needs a finished game you played.");
    }
    previous = candidate;
  }
  const previousStakeKeys = new Set(
    previous ? parseStoredTerms(previous.terms).versions.flatMap((version) => version.stakes.map((stake) => stake.key)) : [],
  );
  const newTerms = decideNewTerms(command.terms, {
    newKey: () => generateHostedRandomPrefixedId("gsk"),
    previousStakeKeys,
  });
  const token = randomBytes(24).toString("base64url");
  const where = { createdBy: actor, id: gameId };
  const [termsWordsEncrypted, inviteTokenEncrypted, nameEncrypted] = await Promise.all([
    seal(gameTarget(where, "terms_words"), JSON.stringify(newTerms.words)),
    seal(gameTarget(where, "invite_token"), token),
    seal(labelTarget(actor, "name"), inviteeFirstName),
  ]);
  try {
    await prisma.$transaction(async (tx) => {
      const now = context.now ?? await databaseNow(tx);
      const expiresAt = new Date(now.getTime() + GAME_INVITE_TTL_MS);
      await tx.game.create({
        data: {
          circleId: previous?.circleId ?? null,
          createdBy: actor,
          id: gameId,
          inviteExpiresAt: expiresAt,
          inviteTokenEncrypted,
          inviteTokenHash: sha256Hex(token),
          lengthDays: newTerms.lengthDays,
          nextDueAt: expiresAt,
          pendingLabel: { nameEncrypted, photoKey: null, relationshipEncrypted: null },
          players: { create: { agreedTermsVersion: 1, memberId: actor, seat: 0, timeZone: profile.timeZone } },
          previousGameId: previous?.id ?? null,
          status: "invited",
          terms: toJson(newTerms.terms),
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

async function join(context: CommandContext, command: Extract<GameCommand, { type: "join" }>): Promise<string> {
  const { actor } = context;
  const prisma = getPrisma();
  const timeZone = requireTimeZone(command.timeZone);
  if (typeof command.token !== "string" || !command.token) reject("INVITE_NOT_FOUND", "Invite not found.");
  if (typeof command.termsVersion !== "number") reject("INVALID_REQUEST", "Send the terms version you agreed to.");
  const target = await prisma.game.findUnique({ select: { id: true }, where: { inviteTokenHash: sha256Hex(command.token) } });
  if (!target) reject("INVITE_NOT_FOUND", "Invite not found.");
  const profile = await prisma.gameProfile.findUnique({ select: { memberId: true }, where: { memberId: actor } });
  if (!profile) reject("PROFILE_REQUIRED", "Add your first name first.");
  await runLocked({ ...context, gameId: target.id }, async ({ loaded, now, tx }) => {
    const { row, state } = loaded;
    const decision = decideJoin(state, { memberId: actor, now, termsVersion: command.termsVersion, timeZone });
    if (decision.kind === "already-joined") return null;
    const memberIds = [...decision.dayOnes.keys()];
    // The unique active_member_id index is the real guard; this gives the friendly error.
    const busy = await tx.gamePlayer.findFirst({ select: { gameId: true }, where: { activeMemberId: { in: memberIds } } });
    if (busy) reject("ALREADY_IN_A_GAME", "One of you is already in a game.");
    const circleId = row.circleId ?? await findOrCreatePairCircle(tx, row.createdBy, actor);
    await tx.gamePlayer.create({
      data: {
        agreedTermsVersion: command.termsVersion,
        gameId: row.id,
        memberId: actor,
        seat: decision.seat,
        timeZone,
      },
    });
    for (const [memberId, dayOne] of decision.dayOnes) {
      await tx.gamePlayer.update({
        data: { activeMemberId: memberId, dayOne: toDbDate(dayOne) },
        where: { gameId_memberId: { gameId: row.id, memberId } },
      });
    }
    await tx.game.update({
      data: { circleId, nextDueAt: decision.nextDueAt, startedAt: decision.startedAt, status: "live" },
      where: { id: row.id },
    });
    await copyPendingLabel(tx, row, actor);
    return { payload: { seat: decision.seat }, type: "joined" };
  });
  return target.id;
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

async function findOrCreatePairCircle(tx: Tx, a: string, b: string): Promise<string> {
  const [existing] = await tx.$queryRaw<{ circle_id: string }[]>`
    SELECT g.circle_id FROM game g
    JOIN game_player pa ON pa.game_id = g.id AND pa.member_id = ${a}
    JOIN game_player pb ON pb.game_id = g.id AND pb.member_id = ${b}
    WHERE g.circle_id IS NOT NULL
    ORDER BY g.created_at DESC
    LIMIT 1`;
  if (existing) return existing.circle_id;
  const circle = await tx.gameCircle.create({ data: { id: generateHostedRandomPrefixedId("gcl") } });
  return circle.id;
}

async function voidGame(context: CommandContext, command: Extract<GameCommand, { type: "void" }>): Promise<string> {
  const gameId = requireClientId(command.gameId, "Game id");
  if (command.reason !== "declined" && command.reason !== "cancelled") reject("INVALID_REQUEST", "Say declined or cancelled.");
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
  const gameId = requireClientId(command.gameId, "Game id");
  const entryId = requireClientId(command.entryId, "Entry id");
  if (!isEntryKind(command.kind)) reject("INVALID_REQUEST", "Unknown entry kind.");
  const kind = command.kind;
  const mediaKeys = command.mediaKeys ?? [];
  if (!Array.isArray(mediaKeys) || mediaKeys.length > MAX_MEDIA_KEYS || mediaKeys.some((key) => typeof key !== "string")) {
    reject("INVALID_REQUEST", `Up to ${MAX_MEDIA_KEYS} media keys.`);
  }
  const text = typeof command.text === "string" ? command.text.trim() : "";
  if (text.length > MAX_TEXT) reject("INVALID_REQUEST", "That's too long.");
  if (command.data !== undefined && !isRecord(command.data)) reject("INVALID_REQUEST", "Data must be an object.");
  const data = command.data === undefined ? null : JSON.stringify(command.data);
  if (data && data.length > MAX_DATA_BYTES) reject("INVALID_REQUEST", "That's too much data.");
  const captureAgeMs = command.captureAgeMs ?? null;
  if (
    captureAgeMs !== null
    && (typeof captureAgeMs !== "number" || !Number.isInteger(captureAgeMs) || captureAgeMs < 0 || captureAgeMs > MAX_CAPTURE_AGE_MS)
  ) {
    reject("INVALID_REQUEST", "Capture age must be milliseconds.");
  }
  const existing = await getPrisma().gameEntry.findUnique({ select: { memberId: true }, where: { id: entryId } });
  if (existing) {
    if (existing.memberId !== actor) reject("INVALID_REQUEST", "That entry id is taken.");
    return gameId;
  }
  const target = (field: string): GameSealTarget => ({ field, memberId: actor, rowId: entryId, table: "game_entry" });
  const [textEncrypted, dataEncrypted] = await Promise.all([
    text ? seal(target("text"), text) : null,
    data ? seal(target("data"), data) : null,
  ]);
  await runLocked({ ...context, gameId }, async ({ loaded, now, tx }) => {
    const decision = decidePost(loaded.state, {
      captureAgeMs,
      hasText: text.length > 0,
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

async function deleteToday(context: CommandContext, command: Extract<GameCommand, { type: "deleteToday" }>): Promise<string> {
  const gameId = requireClientId(command.gameId, "Game id");
  await runLocked({ ...context, gameId }, async ({ loaded, now, tx }) => {
    const { withdrawEntryId } = decideDeleteToday(loaded.state, { memberId: context.actor, now });
    if (!withdrawEntryId) return null;
    await tx.gameEntry.update({ data: { withdrawnAt: now, withdrawnReason: "deleted" }, where: { id: withdrawEntryId } });
    return { payload: { entryId: withdrawEntryId }, type: "withdrew" };
  });
  return gameId;
}

async function redeem(context: CommandContext, command: Extract<GameCommand, { type: "redeem" }>): Promise<string> {
  const { actor } = context;
  const ticketId = typeof command.ticketId === "string" ? command.ticketId : "";
  const ticket = ticketId
    ? await getPrisma().gameTicket.findUnique({ select: { gameId: true, owedTo: true }, where: { id: ticketId } })
    : null;
  if (!ticket?.gameId || ticket.owedTo !== actor) reject("TICKET_NOT_HELD", "That ticket isn't yours to cash in.");
  const gameId = ticket.gameId;
  await runLocked({ ...context, gameId }, async ({ now, tx }) => {
    const changed = await tx.gameTicket.updateMany({
      data: { redeemedAt: now, status: "redeemed" },
      where: { id: ticketId, owedTo: actor, status: "open" },
    });
    if (changed.count === 1) return { payload: { ticketId }, type: "redeemed" };
    const current = await tx.gameTicket.findUnique({ select: { status: true }, where: { id: ticketId } });
    if (current?.status === "redeemed") return null;
    return reject("TICKET_NOT_HELD", "That ticket can't be cashed in.");
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
    const circleId = row.circleId;
    if (!circleId) throw new Error("A live game must belong to a circle.");
    const decision = decideSettle(state);
    await tx.gameTicket.createMany({
      data: decision.tickets.map((ticket) => ({
        circleId,
        gameId,
        id: generateHostedRandomPrefixedId("gtk"),
        owedBy: ticket.owedBy,
        owedTo: ticket.owedTo,
        stakeKey: ticket.stakeKey,
      })),
    });
    await endGame(tx, gameId, { result: toJson(decision.result), settledAt: now, status: "settled" });
    await tx.gameEvent.create({
      data: { actorId: SYSTEM_ACTOR, gameId, payload: { tickets: decision.tickets.length, v: 1 }, type: "settled" },
    });
    return true;
  });
}

/** The settle timer: every game whose `next_due_at` has passed. */
export async function settleDueGames(now?: Date): Promise<{ settled: number }> {
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

async function writeDayOnes(tx: Tx, gameId: string, decision: { dayOnes: Map<string, string>; nextDueAt: Date }) {
  for (const [memberId, dayOne] of decision.dayOnes) {
    await tx.gamePlayer.update({ data: { dayOne: toDbDate(dayOne) }, where: { gameId_memberId: { gameId, memberId } } });
  }
  await tx.game.update({ data: { nextDueAt: decision.nextDueAt }, where: { id: gameId } });
}

export async function devStartNow(gameId: string, memberId: string): Promise<GameView> {
  return runDevStep(gameId, memberId, async ({ loaded, now, tx }) => {
    await writeDayOnes(tx, gameId, decideStartNow(loaded.state, now));
    await tx.game.update({ data: { startedAt: now }, where: { id: gameId } });
    return { type: "started_now" };
  });
}

export async function devAdvanceDays(gameId: string, memberId: string, days: number): Promise<GameView> {
  return runDevStep(gameId, memberId, async ({ loaded, tx }) => {
    await writeDayOnes(tx, gameId, decideDevAdvance(loaded.state, days));
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

function toStatus(value: string): GameStatus {
  if (value === "invited" || value === "live" || value === "settled" || value === "void") return value;
  throw new Error("Stored game status is malformed.");
}

function toEntryKind(value: string): GameEntryKind {
  if (!isEntryKind(value)) throw new Error("Stored game entry kind is malformed.");
  return value;
}

function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function toJson(value: object): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value));
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

export async function readGame(gameId: string, memberId: string): Promise<GameView | null> {
  const [loaded] = await loadCurrent([gameId]);
  if (!loaded || !playerFor(loaded.state, memberId)) return null;
  const [view] = await buildViews([loaded], memberId);
  return view;
}

export async function readHome(memberId: string): Promise<GameHomeView> {
  const prisma = getPrisma();
  const [profile, seats, tickets] = await Promise.all([
    prisma.gameProfile.findUnique({ where: { memberId } }),
    prisma.gamePlayer.findMany({
      orderBy: { joinedAt: "desc" },
      select: { gameId: true },
      take: HOME_GAME_LIMIT,
      where: { memberId },
    }),
    prisma.gameTicket.findMany({
      orderBy: { createdAt: "desc" },
      take: WALLET_LIMIT,
      where: { OR: [{ owedTo: memberId }, { owedBy: memberId }] },
    }),
  ]);
  const games = await loadCurrent(seats.map((seat) => seat.gameId));
  const views = await buildViews(games, memberId);
  const known = new Set(games.map((game) => game.row.id));
  const otherGameIds = [...new Set(tickets.flatMap((ticket) => (ticket.gameId && !known.has(ticket.gameId) ? [ticket.gameId] : [])))];
  const words = await readTermWords([
    ...games.map((game) => game.row),
    ...(otherGameIds.length
      ? await prisma.game.findMany({ select: { createdBy: true, id: true, termsWordsEncrypted: true }, where: { id: { in: otherGameIds } } })
      : []),
  ]);
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

export async function readInvitePreview(token: string): Promise<GameInvitePreview | null> {
  if (!isGameEnabled() || typeof token !== "string" || !token) return null;
  const row = await getPrisma().game.findUnique({
    include: { creator: true },
    where: { inviteTokenHash: sha256Hex(token) },
  });
  if (!row) return null;
  const label = parsePendingLabel(row.pendingLabel);
  const [inviterFirstName, inviteeFirstName, words] = await openGameTexts([
    { field: "first_name", memberId: row.createdBy, rowId: row.createdBy, table: "game_profile", value: row.creator.firstNameEncrypted },
    { ...labelTarget(row.createdBy, "name"), value: label.nameEncrypted },
    { ...gameTarget(row, "terms_words"), value: row.termsWordsEncrypted },
  ]);
  const terms = parseStoredTerms(row.terms);
  const expired = row.inviteExpiresAt !== null && row.inviteExpiresAt.getTime() < Date.now();
  const status = row.status === "invited" ? (expired ? "expired" : "open") : row.status === "void" ? "expired" : "used";
  return {
    expiresAt: (row.inviteExpiresAt ?? row.createdAt).toISOString(),
    gameId: row.id,
    inviteeFirstName: inviteeFirstName ?? "",
    inviterFirstName: inviterFirstName ?? "",
    status,
    terms: termsView({ entries: [], game: toRuleStateGame(row, terms), players: [] }, parseTermWords(words ?? "")),
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
  const status = ticket.status === "redeemed" || ticket.status === "void" ? ticket.status : "open";
  return { ...ticket, status };
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
  const gameIds = games.map((game) => game.row.id);
  const circleIds = [...new Set(games.flatMap((game) => (game.row.circleId ? [game.row.circleId] : [])))];
  const [profiles, labels, tickets, settledInCircles] = await Promise.all([
    prisma.gameProfile.findMany({ where: { memberId: { in: memberIds } } }),
    prisma.gameContactLabel.findMany({ where: { ownerMemberId: viewerId, subjectMemberId: { in: memberIds } } }),
    prisma.gameTicket.findMany({ where: { gameId: { in: gameIds }, OR: [{ owedTo: viewerId }, { owedBy: viewerId }] } }),
    circleIds.length
      ? prisma.game.findMany({ select: { circleId: true, createdAt: true }, where: { circleId: { in: circleIds }, status: "settled" } })
      : Promise.resolve([]),
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
    const round = roundNumber(
      game.row.createdAt,
      settledInCircles.filter((other) => game.row.circleId !== null && other.circleId === game.row.circleId),
    );
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
      round,
      startedAt: game.row.startedAt,
      state: game.state,
      tickets: tickets.filter((ticket) => ticket.gameId === game.row.id).map(toTicketRow),
      viewerId,
      words: parseTermWords(plain[wordsAt[index]] ?? ""),
    });
  });
}
