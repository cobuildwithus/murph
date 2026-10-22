import type { GameChange, GameChangeControls, GamePendingChange } from "./contract";
import { parseGameChange } from "./command";
import { isRecord } from "../primitives";
import { currentTerms, dayIndexAt, decideStartNow, GAME_MAX_LENGTH_DAYS, GAME_MAX_START_DAYS_OUT, playerFor, reject, validSchedule, type RuleState } from "./rules";
import { addDays, gameLocalDate } from "./time";

/** First day that neither player has begun. The previous days retain their terms. */
export function firstUnstartedGameDay(state: RuleState, now: Date): number {
  return Math.max(0, ...state.players.map((player) => (dayIndexAt(player, now) ?? -1) + 1));
}

export function gameChangeControls(state: RuleState, now: Date, pending: GamePendingChange | null): GameChangeControls {
  const day = firstUnstartedGameDay(state, now);
  const live = state.game.status === "live" && state.players.length === 2;
  const enabled = live && !pending && day < GAME_MAX_LENGTH_DAYS && day <= state.game.lengthDays;
  return {
    canStartNow: enabled && day === 0,
    canEdit: enabled,
    canEditSchedule: enabled && day < state.game.lengthDays && (day === 0 || "days" in currentTerms(state.game.terms).schedule),
    canEditStartDate: enabled && day === 0,
    editableFromDay: enabled ? day : null,
  };
}

/** Only structural data is stored here: no names, tasks, chat addresses or private labels. */
export function parsePendingGameChange(value: unknown): GamePendingChange | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || value.v !== 1 || typeof value.id !== "string"
    || typeof value.proposedByMemberId !== "string" || !Number.isInteger(value.expectedTermsVersion)
    || !Number.isInteger(value.effectiveFromDay)
    || !["pending", "queued", "sent", "failed", "conversation"].includes(String(value.deliveryStatus))
    || (value.origin !== undefined && value.origin !== "app" && value.origin !== "chat")
    || (value.deliveryStatus === "conversation" && value.origin !== "chat")
    || (value.startsOn !== null && typeof value.startsOn !== "string")) {
    throw new Error("Stored game change is malformed.");
  }
  return {
    id: value.id, proposedByMemberId: value.proposedByMemberId,
    expectedTermsVersion: Number(value.expectedTermsVersion), effectiveFromDay: Number(value.effectiveFromDay),
    change: parseGameChange(value.change), startsOn: value.startsOn,
    ...(value.origin === undefined ? {} : { origin: value.origin }),
    deliveryStatus: value.deliveryStatus as GamePendingChange["deliveryStatus"],
  };
}

export function isGameChangeExpired(state: RuleState, pending: GamePendingChange, now: Date): boolean {
  return state.game.status !== "live" || currentTerms(state.game.terms).n !== pending.expectedTermsVersion
    || firstUnstartedGameDay(state, now) > pending.effectiveFromDay
    || (pending.startsOn !== null && state.players.some((player) => gameLocalDate(now, player.timeZone) > pending.startsOn!));
}

export function decideGameChange(state: RuleState, actor: string, change: GameChange, now: Date): { change: GameChange; effectiveFromDay: number; startsOn: string | null } {
  if (!playerFor(state, actor)) reject("NOT_A_PLAYER", "This game belongs to its players.");
  const controls = gameChangeControls(state, now, null);
  if (!controls.canEdit) reject("GAME_NOT_LIVE", "This game has no unstarted days to change.");
  const effectiveFromDay = firstUnstartedGameDay(state, now);
  if (change.kind === "start_now") {
    if (!controls.canStartNow) reject("DAY_CLOSED", "This game has already started.");
    const start = decideStartNow(state, now);
    return { change, effectiveFromDay: 0, startsOn: start.players[0].dayOne };
  }
  const lengthDays = change.lengthDays ?? state.game.lengthDays;
  if (lengthDays <= effectiveFromDay || lengthDays > GAME_MAX_LENGTH_DAYS) reject("INVALID_REQUEST", "Keep the days already started and at least one future day, up to 28 days.");
  const oldSchedule = currentTerms(state.game.terms).schedule;
  const schedule = validSchedule(change.schedule ?? oldSchedule, lengthDays);
  if (change.schedule && effectiveFromDay > 0 && ("count" in oldSchedule || "count" in schedule)) {
    reject("INVALID_REQUEST", "Once play starts, keep an any-days target unchanged. You can still edit the duration.");
  }
  let startsOn: string | null = null;
  if (change.startsOn !== undefined) {
    if (!controls.canEditStartDate) reject("DAY_CLOSED", "The start date cannot change after play begins.");
    const latestToday = state.players.map((player) => gameLocalDate(now, player.timeZone)).sort().at(-1)!;
    if (change.startsOn <= latestToday || change.startsOn > addDays(latestToday, GAME_MAX_START_DAYS_OUT)) {
      reject("INVALID_REQUEST", "Choose a start date from tomorrow to 60 days out, or use Start now.");
    }
    startsOn = change.startsOn;
  }
  return { change: { ...change, ...(change.schedule ? { schedule } : {}) }, effectiveFromDay, startsOn };
}
