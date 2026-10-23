import { isStrictIsoDate, normalizeIanaTimeZone } from "@murphai/contracts";

import {
  GAME_ENTRY_KINDS,
  GAME_CHECK_IN_KINDS,
  GAME_STAKE_KINDS,
  GAME_WEEKDAYS,
  type GameCommand,
  type GameChange,
  type GameInviteeLabel,
  type GameSchedule,
  type GameStake,
  type GameTask,
  type GameTermsInput,
} from "./contract";
import { isGameMediaKey } from "./media";
import { isRecord } from "../primitives";
import { GAME_MIN_LENGTH_DAYS, GAME_MAX_LENGTH_DAYS, reject, validNewStakes } from "./rules";

/**
 * The one validator for game commands, shared by the app's routes and
 * Murph's tools: any value in, a typed command with trimmed words, a
 * normalized time zone and no extra fields out. Game rules (seats, schedules
 * against the game's length, who may post when) stay in rules.ts.
 */
export function parseGameCommand(value: unknown): GameCommand {
  const input = record(value, "command");
  switch (input.type) {
    case "proposeChange":
      return {
        type: "proposeChange", gameId: clientId(input.gameId, "gameId"),
        proposalId: clientId(input.proposalId, "proposalId"),
        expectedTermsVersion: integer(input.expectedTermsVersion, "expectedTermsVersion", 1),
        change: parseGameChange(input.change),
      };
    case "respondChange":
      return {
        type: "respondChange", gameId: clientId(input.gameId, "gameId"),
        proposalId: clientId(input.proposalId, "proposalId"),
        decision: oneOf(input.decision, "decision", ["approve", "decline", "cancel"] as const),
      };
    case "setProfile":
      return profile(input);
    case "createGame":
      return {
        gameId: clientId(input.gameId, "gameId"),
        inviteeFirstName: words(input.inviteeFirstName, "inviteeFirstName"),
        terms: terms(record(input.terms, "terms")),
        type: "createGame",
        ...optional(input.inviteeLabel, (label) => ({ inviteeLabel: inviteeLabel(record(label, "inviteeLabel")) })),
        ...optional(input.previousGameId, (id) => ({ previousGameId: clientId(id, "previousGameId") })),
      };
    case "negotiate":
      return {
        type: "negotiate", token: opaque(input.token, "token"),
        termsVersion: integer(input.termsVersion, "termsVersion", 1),
        timeZone: timeZone(input.timeZone), proposalId: clientId(input.proposalId, "proposalId"),
        change: parseGameChange(input.change),
      };
    case "join":
      return {
        termsVersion: integer(input.termsVersion, "termsVersion", 1),
        timeZone: timeZone(input.timeZone),
        token: opaque(input.token, "token"),
        type: "join",
      };
    case "post":
      return post(input);
    case "withdraw":
      return { entryId: clientId(input.entryId, "entryId"), gameId: clientId(input.gameId, "gameId"), type: "withdraw" };
    case "redeem":
      return { ticketId: opaque(input.ticketId, "ticketId"), type: "redeem" };
    default:
      return reject("INVALID_REQUEST", "Unknown command.");
  }
}

const WORDS_MAX = 200;
const POST_TEXT_MAX = 2000;
const MEDIA_KEYS_MAX = 4;
const CAPTURE_AGE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_MAX = 8;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/u;
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
const ZWJ = "\u200D";
const PHOTO_EXTENSIONS = [".jpg", ".heic"];
const TRANSCRIPT_MAX = 500;

/**
 * A photo post carries 1-4 photo uploads (and optional words). An excuse is
 * only words: the transcript the phone made on-device, 1-500 characters; no
 * audio is ever uploaded.
 */
function post(input: Record<string, unknown>): GameCommand {
  const kind = oneOf(input.kind, "kind", GAME_ENTRY_KINDS);
  const mediaKeys = list(input.mediaKeys ?? [], "mediaKeys", MEDIA_KEYS_MAX).map(mediaKey);
  const text = kind === "excuse"
    ? transcript(input.text)
    : input.text === undefined ? "" : string(input.text, "text", POST_TEXT_MAX).trim();
  if (kind === "heart_rate" && (mediaKeys.length !== 1 || !mediaKeys[0]?.endsWith(".jpg"))) {
    reject("INVALID_REQUEST", "A heart-rate check-in needs one graph image.");
  }
  if (kind === "excuse" && mediaKeys.length > 0) reject("INVALID_REQUEST", "An excuse is words only.");
  if (mediaKeys.some((key) => !PHOTO_EXTENSIONS.some((extension) => key.endsWith(extension)))) {
    reject("INVALID_REQUEST", "A photo post takes photos.");
  }
  return {
    entryId: clientId(input.entryId, "entryId"),
    gameId: clientId(input.gameId, "gameId"),
    kind,
    mediaKeys,
    type: "post",
    ...(text ? { text } : {}),
    ...optional(input.captureAgeMs, (value) => ({ captureAgeMs: integer(value, "captureAgeMs", 0, CAPTURE_AGE_MAX_MS) })),
  };
}

function profile(input: Record<string, unknown>): Extract<GameCommand, { type: "setProfile" }> {
  if (input.firstName === undefined && input.timeZone === undefined && input.photoKey === undefined) {
    reject("INVALID_REQUEST", "Choose a profile field to update.");
  }
  return {
    type: "setProfile",
    ...optional(input.firstName, (value) => ({ firstName: words(value, "firstName") })),
    ...optional(input.timeZone, (value) => ({ timeZone: timeZone(value) })),
    ...optional(input.photoKey, (value) => ({ photoKey: nullable(value, mediaKey) })),
  };
}

function inviteeLabel(input: Record<string, unknown>): GameInviteeLabel {
  return {
    ...optional(input.photoKey, (value) => ({ photoKey: nullable(value, mediaKey) })),
    ...optional(input.relationship, (value) => ({ relationship: nullable(value, (text) => words(text, "relationship")) })),
  };
}

function terms(input: Record<string, unknown>): GameTermsInput {
  return {
    checkInKind: input.checkInKind === undefined ? "photo" : oneOf(input.checkInKind, "terms.checkInKind", GAME_CHECK_IN_KINDS),
    schedule: schedule(record(input.schedule, "terms.schedule")),
    stakes: newStakes(input.stakes),
    tasks: list(input.tasks, "terms.tasks", LIST_MAX).map((value): GameTask => {
      const task = record(value, "terms.tasks[]");
      return { seat: integer(task.seat, "terms.tasks[].seat", 0), text: words(task.text, "terms.tasks[].text") };
    }),
    ...optional(input.lengthDays, (value) => ({ lengthDays: integer(value, "terms.lengthDays", GAME_MIN_LENGTH_DAYS, GAME_MAX_LENGTH_DAYS) })),
    ...optional(input.startsOn, (value) => ({ startsOn: calendarDate(value, "terms.startsOn") })),
  };
}

function newStakes(value: unknown): GameStake[] {
  const { stakes } = parseChangedStakes(value);
  validNewStakes(stakes);
  return stakes;
}

function calendarDate(value: unknown, field: string): string {
  const date = string(value, field, 10);
  if (!isStrictIsoDate(date)) reject("INVALID_REQUEST", `${field} must be a date like 2026-10-19.`);
  return date;
}

function schedule(input: Record<string, unknown>): GameSchedule {
  if (input.days !== undefined && input.count === undefined) {
    return { days: list(input.days, "terms.schedule.days", GAME_WEEKDAYS.length).map((day) => oneOf(day, "terms.schedule.days[]", GAME_WEEKDAYS)) };
  }
  if (input.count !== undefined && input.days === undefined) {
    return { count: integer(input.count, "terms.schedule.count", 1) };
  }
  return reject("INVALID_REQUEST", "terms.schedule needs exactly one of days or count.");
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | Record<string, never> {
  return value === undefined ? {} : parse(value);
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) reject("INVALID_REQUEST", `${field} must be an object.`);
  return value;
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) reject("INVALID_REQUEST", `${field} must be a list.`);
  if (value.length > max) reject("INVALID_REQUEST", `${field} has more than ${max} items.`);
  return value;
}

function string(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") reject("INVALID_REQUEST", `${field} must be a string.`);
  if (value.length > max) reject("INVALID_REQUEST", `${field} is too long.`);
  return value;
}

/** People's words: trimmed, 1 to 200 characters. */
/**
 * People's words: invisible format and control characters dropped (a
 * zero-width space can't make a name), trimmed, 1 to 200 characters. The
 * zero-width joiner stays inside emoji sequences.
 */
function words(value: unknown, field: string): string {
  const cleaned = string(value, field, WORDS_MAX * 2).replace(INVISIBLE, (char) => (char === ZWJ ? char : "")).trim();
  if (!cleaned.replaceAll(ZWJ, "").trim() || cleaned.length > WORDS_MAX) {
    reject("INVALID_REQUEST", `${field} must be 1 to ${WORDS_MAX} characters.`);
  }
  return cleaned;
}

function transcript(value: unknown): string {
  const text = string(value ?? "", "text", TRANSCRIPT_MAX * 2).replace(INVISIBLE, (char) => (char === ZWJ ? char : "")).trim();
  if (!text.replaceAll(ZWJ, "").trim() || text.length > TRANSCRIPT_MAX) {
    reject("INVALID_REQUEST", `An excuse needs its words: 1 to ${TRANSCRIPT_MAX} characters.`);
  }
  return text;
}

/** Ids the client mints (UUIDs): retries reuse them. */
function clientId(value: unknown, field: string): string {
  const id = string(value, field, 64);
  if (!CLIENT_ID.test(id)) reject("INVALID_REQUEST", `${field} must be 8-64 letters, digits, - or _.`);
  return id;
}

/** Ids and tokens the server minted. */
function opaque(value: unknown, field: string): string {
  const text = string(value, field, 128);
  if (!text) reject("INVALID_REQUEST", `${field} is required.`);
  return text;
}

function mediaKey(value: unknown): string {
  const key = string(value, "mediaKey", 256);
  if (!isGameMediaKey(key)) reject("MEDIA_MISSING", "Upload the media before posting it.");
  return key;
}

function timeZone(value: unknown): string {
  return normalizeIanaTimeZone(string(value, "timeZone", 64))
    ?? reject("INVALID_REQUEST", "timeZone must be an IANA name like America/New_York.");
}

function integer(value: unknown, field: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    reject("INVALID_REQUEST", `${field} must be a whole number from ${min}.`);
  }
  return value;
}

function oneOf<T extends string | number>(value: unknown, field: string, options: readonly T[]): T {
  return options.find((option) => option === value)
    ?? reject("INVALID_REQUEST", `${field} must be one of ${options.join(", ")}.`);
}

export function parseGameChange(value: unknown, allowSealedWords = false): GameChange {
  const input = record(value, "change");
  if (input.kind === "start_now") return { kind: "start_now" };
  if (input.kind !== "edit") return reject("INVALID_REQUEST", "Choose a game change.");
  if (input.schedule === undefined && input.lengthDays === undefined && input.startsOn === undefined && input.tasks === undefined && input.stakes === undefined && !allowSealedWords) {
    return reject("INVALID_REQUEST", "Choose a task, stake, schedule, duration or start date to change.");
  }
  if (input.stakesApplyToWholeGame !== undefined && input.stakesApplyToWholeGame !== true) reject("INVALID_REQUEST", "Confirm that new stakes apply to the whole game.");
  return {
    kind: "edit",
    ...optional(input.tasks, parseChangedTasks),
    ...optional(input.stakes, parseChangedStakes),
    ...(input.stakesApplyToWholeGame === true ? { stakesApplyToWholeGame: true as const } : {}),
    ...optional(input.schedule, (value) => ({ schedule: schedule(record(value, "schedule")) })),
    ...optional(input.lengthDays, (value) => ({ lengthDays: integer(value, "lengthDays", 1, GAME_MAX_LENGTH_DAYS) })),
    ...optional(input.startsOn, (value) => ({ startsOn: nullable(value, (date) => calendarDate(date, "startsOn")) })),
  };
}

function parseChangedTasks(value: unknown): { tasks: GameTask[] } {
  const tasks = list(value, "tasks", 2).map((item) => {
    const task = record(item, "task");
    return { seat: integer(task.seat, "task.seat", 0, 1), text: words(task.text, "task.text") };
  }).sort((a, b) => a.seat - b.seat);
  if (tasks.length !== 2 || tasks.some((task, seat) => task.seat !== seat)) reject("INVALID_REQUEST", "Include one task for each player.");
  return { tasks };
}
function parseChangedStakes(value: unknown): { stakes: GameStake[] } {
  const stakes = list(value, "stakes", 3).map((item) => {
    const stake = record(item, "stake");
    return { kind: oneOf(stake.kind, "stake.kind", GAME_STAKE_KINDS), item: words(stake.item, "stake.item") };
  });
  if (!stakes.length) reject("INVALID_REQUEST", "Choose at least one stake.");
  return { stakes };
}
