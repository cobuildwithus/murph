import {
  GAME_SCHEMA_VERSION,
  type GameCommand,
  type GameCommandRequest,
  type GameEntryKind,
  type GameSchedule,
  type GameStake,
  type GameStakeKind,
  type GameTask,
  type GameTermsInput,
  type Weekday,
} from "../contract";
import { isRecord } from "../../primitives";
import { invalidGameRequest } from "./errors";

// Shape only: the request becomes a typed command with no extra fields. Limits
// and game rules (names, time zones, who may post, which day) are the
// service's, so the app and Murph get the same answers.
const ENTRY_KINDS: readonly GameEntryKind[] = ["photo", "video", "voice", "text", "workout", "number", "excuse"];
const STAKE_KINDS: readonly GameStakeKind[] = ["winner_gets", "per_miss"];
const VOID_REASONS = ["declined", "cancelled"] as const;
const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export function parseGameCommandRequest(body: Record<string, unknown>, idempotencyKey: string | null): GameCommandRequest {
  if (body.schemaVersion !== GAME_SCHEMA_VERSION) {
    throw invalidGameRequest(`schemaVersion must be ${GAME_SCHEMA_VERSION}.`);
  }
  const requestId = text(body.requestId, "requestId");
  if (idempotencyKey !== null && idempotencyKey !== requestId) {
    throw invalidGameRequest("Idempotency-Key must match requestId.");
  }
  return { schemaVersion: GAME_SCHEMA_VERSION, requestId, command: parseCommand(record(body.command, "command")) };
}

function parseCommand(input: Record<string, unknown>): GameCommand {
  switch (input.type) {
    case "setProfile":
      return { type: "setProfile", firstName: text(input.firstName, "firstName"), timeZone: text(input.timeZone, "timeZone") };
    case "createGame":
      return {
        type: "createGame",
        gameId: text(input.gameId, "gameId"),
        terms: terms(record(input.terms, "terms")),
        inviteeFirstName: text(input.inviteeFirstName, "inviteeFirstName"),
        ...optional(input.previousGameId, (value) => ({ previousGameId: text(value, "previousGameId") })),
      };
    case "join":
      return {
        type: "join",
        token: text(input.token, "token"),
        termsVersion: integer(input.termsVersion, "termsVersion"),
        timeZone: text(input.timeZone, "timeZone"),
      };
    case "void":
      return { type: "void", gameId: text(input.gameId, "gameId"), reason: oneOf(input.reason, "reason", VOID_REASONS) };
    case "post":
      return {
        type: "post",
        gameId: text(input.gameId, "gameId"),
        entryId: text(input.entryId, "entryId"),
        kind: oneOf(input.kind, "kind", ENTRY_KINDS),
        mediaKeys: list(input.mediaKeys, "mediaKeys").map((key) => text(key, "mediaKeys[]")),
        ...optional(input.text, (value) => ({ text: text(value, "text") })),
        ...optional(input.data, (value) => ({ data: record(value, "data") })),
        ...optional(input.captureAgeMs, (value) => ({ captureAgeMs: integer(value, "captureAgeMs") })),
      };
    case "deleteToday":
      return { type: "deleteToday", gameId: text(input.gameId, "gameId") };
    case "redeem":
      return { type: "redeem", ticketId: text(input.ticketId, "ticketId") };
    case "setLabel":
      return {
        type: "setLabel",
        subject: labelSubject(record(input.subject, "subject")),
        ...optional(input.name, (value) => ({ name: nullableText(value, "name") })),
        ...optional(input.photoKey, (value) => ({ photoKey: nullableText(value, "photoKey") })),
        ...optional(input.relationship, (value) => ({ relationship: nullableText(value, "relationship") })),
      };
    default:
      throw invalidGameRequest("command.type is not a known command.");
  }
}

function terms(input: Record<string, unknown>): GameTermsInput {
  return {
    tasks: list(input.tasks, "terms.tasks").map((value): GameTask => {
      const task = record(value, "terms.tasks[]");
      return { seat: integer(task.seat, "terms.tasks[].seat"), text: text(task.text, "terms.tasks[].text") };
    }),
    schedule: schedule(record(input.schedule, "terms.schedule")),
    stakes: list(input.stakes, "terms.stakes").map((value): GameStake => {
      const stake = record(value, "terms.stakes[]");
      return {
        kind: oneOf(stake.kind, "terms.stakes[].kind", STAKE_KINDS),
        item: text(stake.item, "terms.stakes[].item"),
        ...optional(stake.key, (key) => ({ key: text(key, "terms.stakes[].key") })),
      };
    }),
    ...optional(input.lengthDays, (value) => ({ lengthDays: integer(value, "terms.lengthDays") })),
  };
}

function schedule(input: Record<string, unknown>): GameSchedule {
  if (input.days !== undefined && input.count === undefined) {
    return { days: list(input.days, "terms.schedule.days").map((day) => oneOf(day, "terms.schedule.days[]", WEEKDAYS)) };
  }
  if (input.count !== undefined && input.days === undefined) {
    return { count: integer(input.count, "terms.schedule.count") };
  }
  throw invalidGameRequest("terms.schedule must have exactly one of days or count.");
}

function labelSubject(input: Record<string, unknown>): { memberId: string } | { inviteToken: string } {
  if (input.memberId !== undefined && input.inviteToken === undefined) return { memberId: text(input.memberId, "subject.memberId") };
  if (input.inviteToken !== undefined && input.memberId === undefined) return { inviteToken: text(input.inviteToken, "subject.inviteToken") };
  throw invalidGameRequest("subject must have exactly one of memberId or inviteToken.");
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | Record<string, never> {
  return value === undefined ? {} : parse(value);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidGameRequest(`${field} must be an object.`);
  return value;
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw invalidGameRequest(`${field} must be a list.`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw invalidGameRequest(`${field} must be a string.`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalidGameRequest(`${field} must be a whole number.`);
  return value;
}

function oneOf<T extends string | number>(value: unknown, field: string, options: readonly T[]): T {
  const match = options.find((option) => option === value);
  if (match === undefined) throw invalidGameRequest(`${field} must be one of ${options.join(", ")}.`);
  return match;
}
