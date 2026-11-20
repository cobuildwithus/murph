import { isRecord } from "../primitives";
import type { Prisma, Game, GameEntry, GameInvitee, GamePlayer } from "@prisma/client";
import { GAME_ENTRY_KINDS, type GameEntryKind, type GameStatus } from "./contract";
import { hasGameIdentity } from "./roster";
import { parseStoredTerms, type RuleState } from "./rules";

export type GameRow = Game & { players: GamePlayer[]; invitees: GameInvitee[] };

/** Database facts become rule inputs without importing commands or delivery. */
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

export function toRuleStateGame(row: Game & Pick<GameRow, "invitees">, terms: RuleState["game"]["terms"]): RuleState["game"] {
  return {
    chatContainerMemberId: row.chatContainerMemberId,
    createdBy: row.createdBy,
    id: row.id,
    inviteExpiresAt: row.inviteExpiresAt,
    invitees: row.invitees,
    lengthDays: row.lengthDays,
    seats: row.maxPlayers,
    settledAt: row.settledAt,
    startsOn: fromDbDate(row.startsOn),
    status: toStatus(row.status),
    terms,
  };
}

function toStatus(value: string): GameStatus {
  if (value === "invited" || value === "negotiating" || value === "live" || value === "settled" || value === "void") return value;
  throw new Error("Stored game status is malformed.");
}

export function toEntryKind(value: string): GameEntryKind {
  const kind = GAME_ENTRY_KINDS.find((candidate) => candidate === value);
  if (!kind) throw new Error("Stored game entry kind is malformed.");
  return kind;
}

export function fromDbDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}


/** Each viewer keeps only their own encrypted name for a deleted person. */
export type DepartedLabel = { ownerMemberId: string; nameEncrypted: string | null };
export function departedLabels(value: Prisma.JsonValue | null): DepartedLabel[] {
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > 9) throw new Error("Stored departure labels are malformed.");
  return value.map(label => {
    if (!isRecord(label) || typeof label.ownerMemberId !== "string"
      || (label.nameEncrypted !== null && typeof label.nameEncrypted !== "string")) throw new Error("Stored departure label is malformed.");
    return { ownerMemberId: label.ownerMemberId, nameEncrypted: label.nameEncrypted };
  });
}
