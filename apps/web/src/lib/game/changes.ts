import { GAME_STAKE_KINDS, type GameChange, type GameChangeControls, type GamePendingChange, type GameSchedule } from "./contract";
import { parseGameChange } from "./command";
import { isRecord } from "../primitives";
import { currentTerms, dayIndexAt, decideStartNow, firstScheduledDate, GameRuleError, GAME_MIN_LENGTH_DAYS, GAME_MAX_LENGTH_DAYS, GAME_MAX_START_DAYS_OUT, isGameDue, playerFor, reject, validSchedule, validNewStakes, type StoredStake, type RuleState } from "./rules";
import { acceptanceStartDate, addDays, gameLocalDate, weekdayOf } from "./time";

/** First day that neither player has begun. The previous days retain their terms. */
export function firstUnstartedGameDay(state: RuleState, now: Date): number {
  return Math.max(0, ...state.players.map((player) => (dayIndexAt(player, now) ?? -1) + 1));
}

export function gameChangeControls(state: RuleState, now: Date, pending: GamePendingChange | null): GameChangeControls {
  const day = firstUnstartedGameDay(state, now);
  const live = ["live", "negotiating"].includes(state.game.status) && state.players.length === 2;
  // Once either player's last day is over, the game is done for changes.
  const editable = live && !pending && !isGameDue(state, now) && day <= state.game.lengthDays;
  const enabled = editable && day < GAME_MAX_LENGTH_DAYS;
  return {
    canStartNow: enabled && day === 0 && startNowMovesDayOne(state, now),
    canEdit: editable,
    canEditSchedule: enabled && day < state.game.lengthDays && (day === 0 || "days" in currentTerms(state.game.terms).schedule),
    canEditStartDate: enabled && day === 0,
    canEditTasks: editable && state.game.status === "negotiating",
    canEditStakes: editable && state.game.status === "negotiating",
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

/** Start now must move Day 1 earlier; Day 1 never lands on an unscheduled day. */
function startNowMovesDayOne(state: RuleState, now: Date): boolean {
  const dayOne = state.players[0]?.dayOne;
  return state.game.status !== "live" || !dayOne || decideStartNow(state, now).players[0].dayOne < dayOne;
}

/** The game ended or its terms moved on since the proposal. */
export function isGameChangeOutdated(state: RuleState, pending: StoredGamePendingChange, now: Date): boolean {
  return !["live", "negotiating"].includes(state.game.status) ||
    isGameDue(state, now) || currentTerms(state.game.terms).n !== pending.expectedTermsVersion;
}

/** Why the other player's agreement would refuse this change now, or null while it can still apply. */
export function gameChangeRefusal(state: RuleState, pending: StoredGamePendingChange, now: Date): string | null {
  const approver = state.players.find((player) => player.memberId !== pending.proposedByMemberId) ?? state.players[0];
  try {
    decideApprovedGameChange(state, approver.memberId, pending, now);
    return null;
  } catch (error) {
    if (error instanceof GameRuleError) return error.message;
    throw error;
  }
}

/** A waiting change expires the moment it can no longer apply, so it never blocks edits. */
export function isGameChangeExpired(state: RuleState, pending: StoredGamePendingChange, now: Date): boolean {
  return isGameChangeOutdated(state, pending, now) || gameChangeRefusal(state, pending, now) !== null;
}

export function decideGameChange(state: RuleState, actor: string, change: GameChange, now: Date, sealedWords?: SealedWordChanges): { change: GameChange; effectiveFromDay: number; startsOn: string | null } {
  if (!playerFor(state, actor)) reject("NOT_A_PLAYER", "This game belongs to its players.");
  const controls = gameChangeControls(state, now, null);
  if (!controls.canEdit) reject("GAME_NOT_LIVE", "This game is no longer open for changes.");
  const effectiveFromDay = firstUnstartedGameDay(state, now);
  if (change.kind === "start_now") {
    if (!controls.canStartNow) reject("DAY_CLOSED", effectiveFromDay === 0 ? "The game already starts on its next scheduled day." : "This game has already started.");
    const start = decideStartNow(state.game.status === "negotiating" ? { ...state, game: { ...state.game, status: "live" } } : state, now);
    return { change, effectiveFromDay: 0, startsOn: start.players[0].dayOne };
  }
  assertEditableWords(state, change, controls, sealedWords);
  const lengthDays = change.lengthDays ?? state.game.lengthDays;
  if ((change.lengthDays !== undefined && lengthDays < GAME_MIN_LENGTH_DAYS) || lengthDays <= effectiveFromDay || lengthDays > GAME_MAX_LENGTH_DAYS) reject("INVALID_REQUEST", "Keep the days already started and at least one future day, up to 365 days.");
  const oldSchedule = currentTerms(state.game.terms).schedule;
  const schedule = validSchedule(change.schedule ?? oldSchedule, lengthDays);
  if (change.schedule && effectiveFromDay > 0 && ("count" in oldSchedule || "count" in schedule)) {
    reject("INVALID_REQUEST", "Once play starts, keep an any-days target unchanged. You can still edit the duration.");
  }
  assertScheduledDayLeft(state, effectiveFromDay, lengthDays, schedule);
  const startsOn = changedStartDate(state, actor, change, now, controls.canEditStartDate);
  return { change: { ...change, ...(change.schedule ? { schedule } : {}) }, effectiveFromDay, startsOn: startsOn && firstScheduledDate(startsOn, schedule) };
}

/** Only an app request already queued or sent needs a separate cancellation notice, unless Murph's reply in the bound chat already gave it. */
export function gameChangeCancellationNeedsNotice(pending: GamePendingChange, decision: "approve" | "decline" | "cancel", answeredInBoundChat = false): boolean {
  return !answeredInBoundChat && decision === "cancel" && pending.origin === "app" && ["queued", "sent"].includes(pending.deliveryStatus);
}

/** Rejudge the proposal under the acceptance clock, retaining its requested date. */
export function decideApprovedGameChange(state: RuleState, actor: string, pending: StoredGamePendingChange, now: Date): ReturnType<typeof decideGameChange> {
  const fixedStart = pending.change.kind === "start_now" || typeof pending.change.startsOn === "string";
  if (fixedStart && pending.startsOn !== null && state.players.some((player) => gameLocalDate(now, player.timeZone) > pending.startsOn!)) {
    reject("CHANGE_EXPIRED", "The proposed start date has passed. Propose a new date.");
  }
  if (pending.change.kind === "edit" && pending.change.lengthDays !== undefined && pending.change.lengthDays <= firstUnstartedGameDay(state, now)) {
    reject("CHANGE_EXPIRED", "The proposed game length ends on a day already started. Propose a longer game.");
  }
  // A date that was tomorrow at proposal time may be today at agreement.
  // Keep that date, but never move Day 1 after either player has begun.
  const change = pending.change.kind === "edit" && typeof pending.change.startsOn === "string"
    ? { ...pending.change, startsOn: undefined } : pending.change;
  if (pending.change.kind === "edit" && pending.change.startsOn !== undefined && !gameChangeControls(state, now, null).canEditStartDate) {
    reject("DAY_CLOSED", "The start date cannot change after play begins.");
  }
  return decideGameChange(state, actor, change, now, pending);
}

/**
 * Day 1 after an agreed change to a live game, or null when it stays: a fixed
 * start, or a new schedule before play, lands on a scheduled day.
 */
export function agreedDayOne(state: RuleState, pending: StoredGamePendingChange, fromDay: number, schedule: GameSchedule, startsOn: string | null): string | null {
  const dayOne = state.players[0]?.dayOne ?? null;
  const rescheduled = fromDay === 0 && pending.change.kind === "edit" && pending.change.schedule !== undefined;
  const from = startsOn ?? (rescheduled ? dayOne : null);
  const next = from && firstScheduledDate(from, schedule);
  return next && next !== dayOne ? next : null;
}

/** Pending days are a current preview, never a promise fixed at proposal time. */
export function pendingGameChangeView(state: RuleState, pending: GamePendingChange | null, now: Date): GamePendingChange | null {
  return pending ? { ...pending, effectiveFromDay: firstUnstartedGameDay(state, now) } : null;
}

/** Before play, Day 1 moves to a scheduled day; once play starts, the rest of the game must keep one. */
function assertScheduledDayLeft(state: RuleState, fromDay: number, lengthDays: number, schedule: ReturnType<typeof validSchedule>): void {
  const dayOne = state.players[0]?.dayOne;
  if (fromDay === 0 || !dayOne || "count" in schedule) return;
  for (let day = fromDay; day < lengthDays; day += 1) {
    if (schedule.days.includes(weekdayOf(addDays(dayOne, day)))) return;
  }
  reject("INVALID_REQUEST", "Keep at least one scheduled day in the rest of the game.");
}

function assertEditableWords(state: RuleState, change: Extract<GameChange, { kind: "edit" }>, controls: GameChangeControls, sealedWords?: SealedWordChanges): void {
  const stakes = change.stakes ?? sealedWords?.stakes;
  if ((change.tasks || sealedWords?.tasksChanged) && !controls.canEditTasks) reject("INVALID_REQUEST", "Tasks lock when the game starts.");
  if (stakes && !controls.canEditStakes) reject("INVALID_REQUEST", "Stakes lock when the game starts.");
  if (stakes && currentTerms(state.game.terms).stakes.some((stake) => ["prize", "dare"].includes(stake.kind))) validNewStakes(stakes);
}

function changedStartDate(state: RuleState, actor: string, change: Extract<GameChange, { kind: "edit" }>, now: Date, canEdit: boolean): string | null {
  if (change.startsOn === undefined) return null;
  if (!canEdit) reject("DAY_CLOSED", "The start date cannot change after play begins.");
  const latestToday = state.players.map((player) => gameLocalDate(now, player.timeZone)).sort().at(-1)!;
  if (change.startsOn !== null && (change.startsOn <= latestToday || change.startsOn > addDays(latestToday, GAME_MAX_START_DAYS_OUT))) {
    reject("INVALID_REQUEST", "Choose a start date from tomorrow to 60 days out, or use Start now.");
  }
  return change.startsOn ?? (state.game.status === "negotiating" ? null : state.players.map((player) => player.memberId === actor ? acceptanceStartDate(now, player.timeZone) : gameLocalDate(now, player.timeZone)).sort().at(-1)!);
}

function parseStoredStake(value: unknown): StoredStake {
  if (!isRecord(value) || typeof value.key !== "string") throw new Error("Stored game stake change is malformed.");
  const kind = GAME_STAKE_KINDS.find((kind) => kind === value.kind);
  if (!kind) throw new Error("Stored game stake change is malformed.");
  return { key: value.key, kind };
}

type SealedWordChanges = Pick<StoredGamePendingChange, "tasksChanged" | "stakes">;
