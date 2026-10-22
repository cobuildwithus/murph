import type { GameChange, GameChangeControls, GamePendingChange } from "./contract";
import { parseGameChange } from "./command";
import { isRecord } from "../primitives";
import { currentTerms, dayIndexAt, decideStartNow, GAME_MAX_LENGTH_DAYS, GAME_MAX_START_DAYS_OUT, isGameDue, playerFor, reject, validSchedule, type StoredStake, type RuleState } from "./rules";
import { addDays, gameLocalDate } from "./time";

/** First day that neither player has begun. The previous days retain their terms. */
export function firstUnstartedGameDay(state: RuleState, now: Date): number {
  return Math.max(0, ...state.players.map((player) => (dayIndexAt(player, now) ?? -1) + 1));
}

export function gameChangeControls(state: RuleState, now: Date, pending: GamePendingChange | null): GameChangeControls {
  const day = firstUnstartedGameDay(state, now);
  const live = ["live", "negotiating"].includes(state.game.status) && state.players.length === 2;
  const editable = live && !pending && !isGameDue(state, now);
  const enabled = editable && day < GAME_MAX_LENGTH_DAYS && day <= state.game.lengthDays;
  return {
    canStartNow: enabled && day === 0,
    canEdit: editable,
    canEditSchedule: enabled && day < state.game.lengthDays && (day === 0 || "days" in currentTerms(state.game.terms).schedule),
    canEditStartDate: enabled && day === 0,
    canEditTasks: enabled && day < state.game.lengthDays,
    canEditStakes: editable,
    editableFromDay: editable ? Math.min(day, state.game.lengthDays) : null,
  };
}

/** Proposal words are sealed before the transaction and atomically applied on agreement. */
export interface StoredGamePendingChange extends GamePendingChange {
  termsWordsEncrypted?: string;
  tasksChanged?: true;
  stakes?: StoredStake[];
}
/** Only structural data and encrypted envelopes are stored here. */
export function parsePendingGameChange(value: unknown): StoredGamePendingChange | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || ![1, 2].includes(Number(value.v)) || typeof value.id !== "string"
    || typeof value.proposedByMemberId !== "string" || !Number.isInteger(value.expectedTermsVersion)
    || !Number.isInteger(value.effectiveFromDay)
    || (value.startsOn !== null && typeof value.startsOn !== "string")) {
    throw new Error("Stored game change is malformed.");
  }
  return {
    id: value.id, proposedByMemberId: value.proposedByMemberId,
    expectedTermsVersion: Number(value.expectedTermsVersion), effectiveFromDay: Number(value.effectiveFromDay),
    change: parseGameChange(value.change, value.v === 2 && typeof value.termsWordsEncrypted === "string"), startsOn: value.startsOn,
    ...(typeof value.termsWordsEncrypted === "string" ? { termsWordsEncrypted: value.termsWordsEncrypted } : {}),
    ...(value.tasksChanged === true ? { tasksChanged: true as const } : {}),
    ...(Array.isArray(value.stakes) ? { stakes: value.stakes.map(parseStoredStake) } : {}),
    ...readPendingDeliveryState(value),
  };
}

/** Conversation state records the source, never a provider delivery receipt. */
function readPendingDeliveryState(value: Record<string, unknown>): Pick<GamePendingChange, "origin" | "deliveryStatus"> {
  if (!["pending", "queued", "sent", "failed", "conversation"].includes(String(value.deliveryStatus))
    || (value.origin !== undefined && value.origin !== "app" && value.origin !== "chat")
    || (value.deliveryStatus === "conversation" && value.origin !== "chat")) {
    throw new Error("Stored game change is malformed.");
  }
  return { ...(value.origin === undefined ? {} : { origin: value.origin }),
    deliveryStatus: value.deliveryStatus as GamePendingChange["deliveryStatus"] };
}

export function isGameChangeExpired(state: RuleState, pending: StoredGamePendingChange, now: Date): boolean {
  return !["live", "negotiating"].includes(state.game.status) ||
    isGameDue(state, now) || currentTerms(state.game.terms).n !== pending.expectedTermsVersion
    || (!isStakesOnlyChange(pending.change, pending) && firstUnstartedGameDay(state, now) > pending.effectiveFromDay)
    || (pending.startsOn !== null && state.players.some((player) => gameLocalDate(now, player.timeZone) > pending.startsOn!));
}

export function decideGameChange(state: RuleState, actor: string, change: GameChange, now: Date, sealedWords?: SealedWordChanges): { change: GameChange; effectiveFromDay: number; startsOn: string | null } {
  if (!playerFor(state, actor)) reject("NOT_A_PLAYER", "This game belongs to its players.");
  const controls = gameChangeControls(state, now, null);
  if (!controls.canEdit) reject("GAME_NOT_LIVE", "This game is no longer open for changes.");
  const firstUnstarted = firstUnstartedGameDay(state, now);
  const stakesOnly = isStakesOnlyChange(change, sealedWords);
  const effectiveFromDay = stakesOnly ? Math.min(firstUnstarted, state.game.lengthDays) : firstUnstarted;
  if (change.kind === "start_now") {
    if (!controls.canStartNow) reject("DAY_CLOSED", "This game has already started.");
    const start = decideStartNow(state.game.status === "negotiating" ? { ...state, game: { ...state.game, status: "live" } } : state, now);
    return { change, effectiveFromDay: 0, startsOn: start.players[0].dayOne };
  }
  assertWholeGameStakeConsent(change, sealedWords, effectiveFromDay);
  const lengthDays = change.lengthDays ?? state.game.lengthDays;
  if ((!stakesOnly && lengthDays <= effectiveFromDay) || lengthDays > GAME_MAX_LENGTH_DAYS) reject("INVALID_REQUEST", "Keep the days already started and at least one future day, up to 28 days.");
  const oldSchedule = currentTerms(state.game.terms).schedule;
  const schedule = validSchedule(change.schedule ?? oldSchedule, lengthDays);
  if (change.schedule && effectiveFromDay > 0 && ("count" in oldSchedule || "count" in schedule)) {
    reject("INVALID_REQUEST", "Once play starts, keep an any-days target unchanged. You can still edit the duration.");
  }
  const startsOn = changedStartDate(state, change, now, controls.canEditStartDate);
  return { change: { ...change, ...(change.schedule ? { schedule } : {}) }, effectiveFromDay, startsOn };
}

function changedStartDate(state: RuleState, change: Extract<GameChange, { kind: "edit" }>, now: Date, canEdit: boolean): string | null {
  if (change.startsOn === undefined) return null;
  if (!canEdit) reject("DAY_CLOSED", "The start date cannot change after play begins.");
  const latestToday = state.players.map((player) => gameLocalDate(now, player.timeZone)).sort().at(-1)!;
  if (change.startsOn !== null && (change.startsOn <= latestToday || change.startsOn > addDays(latestToday, GAME_MAX_START_DAYS_OUT))) {
    reject("INVALID_REQUEST", "Choose a start date from tomorrow to 60 days out, or use Start now.");
  }
  return change.startsOn ?? (state.game.status === "negotiating" ? null : addDays(latestToday, 1));
}

function parseStoredStake(value: unknown): StoredStake {
  if (!isRecord(value) || typeof value.key !== "string" || (value.kind !== "winner_gets" && value.kind !== "per_miss")) throw new Error("Stored game stake change is malformed.");
  return { key: value.key, kind: value.kind };
}

type SealedWordChanges = Pick<StoredGamePendingChange, "tasksChanged" | "stakes">;

/** Whole-game stakes have no future-day obligation; all other edits do. */
function isStakesOnlyChange(change: GameChange, sealedWords?: SealedWordChanges): boolean {
  return change.kind === "edit" && Boolean(change.stakes || sealedWords?.stakes)
    && !change.tasks && !sealedWords?.tasksChanged && change.lengthDays === undefined
    && change.schedule === undefined && change.startsOn === undefined;
}

function assertWholeGameStakeConsent(change: Extract<GameChange, {kind: "edit"}>, sealedWords: SealedWordChanges | undefined, effectiveFromDay: number): void {
  if ((change.stakes || sealedWords?.stakes) && effectiveFromDay > 0 && change.stakesApplyToWholeGame !== true) {
    reject("INVALID_REQUEST", "Changing the stakes affects the whole game, including earlier misses. Confirm this with both players.");
  }
}
