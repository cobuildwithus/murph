import { GAME_STAKE_KINDS, type GameChange, type GameChangeControls, type GamePendingChange, type GameSchedule } from "./contract";
import { parseGameChange } from "./command";
import { isRecord } from "../primitives";
import { currentTerms, gameDayOne, dayIndexAt, decideStartNow, firstScheduledDate, GameRuleError, GAME_MIN_LENGTH_DAYS, GAME_MAX_LENGTH_DAYS, GAME_MAX_START_DAYS_OUT, isGameDue, remainingPlayers, reject, validSchedule, validNewStakes, type StoredStake, type RuleState, type NewTerms, type TermWords } from "./rules";
import { isPairRoster } from "./roster";
import { acceptanceStartDate, addDays, gameLocalDate, weekdayOf } from "./time";

/** First day that neither player has begun. The previous days retain their terms. */
export function firstUnstartedGameDay(state: RuleState, now: Date): number {
  return Math.max(0, ...state.players.map((player) => (dayIndexAt(player, now) ?? -1) + 1));
}

const START_DATE_LOCKED = "The start date locks once someone checks in.";

function movesStartDate(change: GameChange): boolean {
  return change.kind === "edit" && change.startsOn !== undefined;
}

/** A start-date move rebuilds the whole calendar from Day 1; other changes apply from the first unstarted day. */
function changeFromDay(state: RuleState, change: GameChange, now: Date, canMoveStart: boolean): number {
  return movesStartDate(change) && canMoveStart ? 0 : firstUnstartedGameDay(state, now);
}

export function gameChangeControls(state: RuleState, now: Date, pending: Pick<GamePendingChange, "id"> | null): GameChangeControls {
  const day = firstUnstartedGameDay(state, now);
  // Negotiation is still a two-person agreement policy.
  const live = state.game.seats === 10 ? state.game.status === "live"
    : state.game.seats === 2 && ["live", "negotiating"].includes(state.game.status) && isPairRoster(state.players);
  // Once either player's last day is over, the game is done for changes.
  const editable = live && !pending && !isGameDue(state, now) && day <= state.game.lengthDays;
  const enabled = editable && day < GAME_MAX_LENGTH_DAYS;
  return {
    canStartNow: state.game.seats === 2 && enabled && day === 0 && startNowMovesDayOne(state, now),
    canEdit: editable,
    canEditSchedule: enabled && day < state.game.lengthDays && (day === 0 || "days" in currentTerms(state.game.terms).schedule),
    // Until anyone posts, Day 1 can still move, even after it has begun.
    canEditStartDate: enabled && (day === 0 || state.entries.length === 0),
    // Tasks lock once either player's Day 1 begins; the prize or dare stays
    // open, with the other player's yes, until the game is due.
    canEditTasks: editable && day === 0,
    canEditStakes: editable,
    editableFromDay: editable ? Math.min(day, state.game.lengthDays) : null,
  };
}

/** Proposal words are sealed before the transaction and atomically applied on agreement. */
export interface StoredGamePendingChange extends Omit<GamePendingChange, "votes"> {
  votes?: Record<string, "yes" | "no">;
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
    ...(value.votes === undefined ? {} : { votes: parseChangeVotes(value.votes) }),
    ...readPendingDeliveryState(value),
  };
}

function parseChangeVotes(value: unknown): Record<string, "yes" | "no"> {
  if (!isRecord(value) || Object.keys(value).length > 10) throw new Error("Stored game votes are malformed.");
  return Object.fromEntries(Object.entries(value).map(([memberId, vote]) => {
    if (vote !== "yes" && vote !== "no") throw new Error("Stored game vote is malformed.");
    return [memberId, vote];
  }));
}

/** Only remaining seated players count; a late join adds an undecided voter. */
export function gameChangeMajority(state: RuleState, votes: Record<string, "yes" | "no">) {
  const players = remainingPlayers(state);
  const yes = players.filter(player => votes[player.memberId] === "yes").length;
  const undecided = players.filter(player => votes[player.memberId] === undefined).length;
  return { approved: yes * 2 > players.length, declined: (yes + undecided) * 2 <= players.length,
    yesNeeded: Math.max(0, Math.floor(players.length / 2) + 1 - yes) };
}

/** Full group input becomes the same edit delta used by pair approval. */
export function normalizeGroupGameChange(state: RuleState, words: TermWords, next: NewTerms): GameChange {
  const previous = currentTerms(state.game.terms);
  const oldWords = [...words.versions].reverse().find(version => version.n <= previous.n)!;
  const newTerms = currentTerms(next.terms);
  const newWords = next.words.versions[0];
  const tasksChanged = oldWords.defaultTask !== newWords.defaultTask || remainingPlayers(state).some(player =>
    (oldWords.tasks.find(task => task.seat === player.seat)?.text ?? oldWords.defaultTask)
    !== (newWords.tasks.find(task => task.seat === player.seat)?.text ?? newWords.defaultTask));
  const oldStakes = previous.stakes.map(stake => ({ kind: stake.kind, item: oldWords.stakes.find(word => word.key === stake.key)?.item }));
  const stakes = newTerms.stakes.map(stake => ({ kind: stake.kind, item: newWords.stakes.find(word => word.key === stake.key)!.item }));
  const change: GameChange = { kind: "edit",
    ...(!isSameGameChange({ kind: "edit", schedule: previous.schedule }, { kind: "edit", schedule: newTerms.schedule }) ? { schedule: newTerms.schedule } : {}),
    ...(state.game.lengthDays !== next.lengthDays ? { lengthDays: next.lengthDays } : {}),
    ...(state.game.startsOn !== next.startsOn ? { startsOn: next.startsOn } : {}),
    ...(tasksChanged ? { tasks: newWords.tasks, defaultTask: newWords.defaultTask } : {}),
    ...(JSON.stringify(oldStakes) !== JSON.stringify(stakes) ? { stakes } : {}),
  };
  if (Object.keys(change).length === 1) reject("INVALID_REQUEST", "Nothing changed.");
  return change;
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
  const dayOne = gameDayOne(state.players);
  return state.game.status !== "live" || !dayOne || gameDayOne(decideStartNow(state, now).players)! < dayOne;
}

/** The game ended or its terms moved on since the proposal. */
export function isGameChangeOutdated(state: RuleState, pending: StoredGamePendingChange, now: Date): boolean {
  return !["live", "negotiating"].includes(state.game.status) ||
    isGameDue(state, now) || currentTerms(state.game.terms).n !== pending.expectedTermsVersion;
}

/** Why the other player's agreement would refuse this change now, or null while it can still apply. */
export function gameChangeRefusal(state: RuleState, pending: StoredGamePendingChange, now: Date): string | null {
  const approver = remainingPlayers(state).find((player) => player.memberId !== pending.proposedByMemberId) ?? state.players[0];
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

type GameChangeDecision = { change: GameChange; effectiveFromDay: number; startsOn: string | null };

export function decideGameChange(state: RuleState, actor: string, change: GameChange, now: Date, sealedWords?: SealedWordChanges): GameChangeDecision {
  return decideChange(state, actor, change, now, sealedWords);
}

/** `agreedStart` is an approved proposal's stored date, whose bounds the approval check already owns. */
function decideChange(state: RuleState, actor: string, change: GameChange, now: Date, sealedWords?: SealedWordChanges, agreedStart?: string): GameChangeDecision {
  if (!remainingPlayers(state).some(player => player.memberId === actor)) reject("NOT_A_PLAYER", "This game belongs to its players.");
  const controls = gameChangeControls(state, now, null);
  if (!controls.canEdit) reject("GAME_NOT_LIVE", "This game is no longer open for changes.");
  const effectiveFromDay = changeFromDay(state, change, now, controls.canEditStartDate);
  if (change.kind === "start_now") {
    if (!controls.canStartNow) reject("DAY_CLOSED", effectiveFromDay === 0 ? "The game already starts on its next scheduled day." : "This game has already started.");
    const start = decideStartNow(state.game.status === "negotiating" ? { ...state, game: { ...state.game, status: "live" } } : state, now);
    return { change, effectiveFromDay: 0, startsOn: gameDayOne(start.players) };
  }
  assertEditableWords(state, change, controls, sealedWords);
  // A new prize or dare replaces the whole game's, so it needs no future day.
  if (isStakesOnlyChange(change, sealedWords)) return { change, effectiveFromDay: Math.min(effectiveFromDay, state.game.lengthDays), startsOn: null };
  const lengthDays = change.lengthDays ?? state.game.lengthDays;
  if ((change.lengthDays !== undefined && lengthDays < GAME_MIN_LENGTH_DAYS) || lengthDays <= effectiveFromDay || lengthDays > GAME_MAX_LENGTH_DAYS) reject("INVALID_REQUEST", "Keep the days already started and at least one future day, up to 365 days.");
  const oldSchedule = currentTerms(state.game.terms).schedule;
  const schedule = validSchedule(change.schedule ?? oldSchedule, lengthDays);
  if (change.schedule && effectiveFromDay > 0 && ("count" in oldSchedule || "count" in schedule)) {
    reject("INVALID_REQUEST", "Once play starts, keep an any-days target unchanged. You can still edit the duration.");
  }
  assertScheduledDayLeft(state, effectiveFromDay, lengthDays, schedule);
  const startsOn = changedStartDate(state, change, now, controls.canEditStartDate, agreedStart);
  return { change: { ...change, ...(change.schedule ? { schedule } : {}) }, effectiveFromDay, startsOn: startsOn && firstScheduledDate(startsOn, schedule) };
}

/** Key order, absent fields and weekday order do not matter. */
export function isSameGameChange(left: GameChange, right: GameChange): boolean {
  const canonical = (change: GameChange) => JSON.stringify(change, (_, value: unknown) =>
    isRecord(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : Array.isArray(value) && value.every((item) => typeof item === "number") ? [...value].sort((a, b) => a - b) : value);
  return canonical(left) === canonical(right);
}

/** Only an app request already queued or sent needs a separate cancellation notice, unless Murph's reply in the bound chat already gave it. */
export function gameChangeCancellationNeedsNotice(pending: Pick<GamePendingChange, "origin" | "deliveryStatus">, decision: "approve" | "decline" | "cancel", answeredInBoundChat = false): boolean {
  return !answeredInBoundChat && decision === "cancel" && pending.origin === "app" && ["queued", "sent"].includes(pending.deliveryStatus);
}

/** Rejudge the proposal under the acceptance clock, retaining its requested date. */
export function decideApprovedGameChange(state: RuleState, actor: string, pending: StoredGamePendingChange, now: Date): GameChangeDecision {
  const fixedStart = pending.change.kind === "start_now" || typeof pending.change.startsOn === "string";
  if (fixedStart && pending.startsOn !== null && state.players.some((player) => gameLocalDate(now, player.timeZone) > pending.startsOn!)) {
    reject("CHANGE_EXPIRED", "The proposed start date has passed. Propose a new date.");
  }
  if (pending.change.kind === "edit" && pending.change.lengthDays !== undefined && pending.change.lengthDays <= firstUnstartedGameDay(state, now)) {
    reject("CHANGE_EXPIRED", "The proposed game length ends on a day already started. Propose a longer game.");
  }
  // The check above keeps a picked date that has not passed for either player;
  // the date still never moves once someone has checked in.
  if (movesStartDate(pending.change) && !gameChangeControls(state, now, null).canEditStartDate) reject("DAY_CLOSED", START_DATE_LOCKED);
  const agreedStart = pending.change.kind === "edit" && typeof pending.change.startsOn === "string" ? pending.startsOn ?? pending.change.startsOn : undefined;
  return decideChange(state, actor, pending.change, now, pending, agreedStart);
}

/**
 * Day 1 after an agreed change to a live game, or null when it stays: a fixed
 * start, or a new schedule before play, lands on a scheduled day.
 */
export function agreedDayOne(state: RuleState, pending: StoredGamePendingChange, fromDay: number, schedule: GameSchedule, startsOn: string | null): string | null {
  const dayOne = gameDayOne(state.players);
  const rescheduled = fromDay === 0 && pending.change.kind === "edit" && pending.change.schedule !== undefined;
  const from = startsOn ?? (rescheduled ? dayOne : null);
  const next = from && firstScheduledDate(from, schedule);
  return next && next !== dayOne ? next : null;
}

/** Pending days are a current preview, never a promise fixed at proposal time. */
export function pendingGameChangeView(state: RuleState, pending: GamePendingChange | null, now: Date): GamePendingChange | null {
  if (!pending) return null;
  const view = { ...pending, effectiveFromDay: changeFromDay(state, pending.change, now, true) };
  if (state.game.seats !== 10) return view;
  const players = remainingPlayers(state);
  const votes = pending.votes?.filter(vote => players.some(player => player.memberId === vote.memberId)) ?? [];
  const change = pending.change;
  const seatedChange = change.kind === "edit" && change.tasks ? { ...change,
    tasks: [...players].sort((a, b) => a.seat - b.seat).map(player => ({ seat: player.seat, text: change.tasks!.find(task => task.seat === player.seat)?.text ?? change.defaultTask! })) } : change;
  return { ...view, change: seatedChange, votes, yesNeeded: gameChangeMajority(state, Object.fromEntries(votes.map(({ memberId, vote }) => [memberId, vote]))).yesNeeded };
}

/** Before play, Day 1 moves to a scheduled day; once play starts, the rest of the game must keep one. */
function assertScheduledDayLeft(state: RuleState, fromDay: number, lengthDays: number, schedule: ReturnType<typeof validSchedule>): void {
  const dayOne = gameDayOne(state.players);
  if (fromDay === 0 || !dayOne || "count" in schedule) return;
  for (let day = fromDay; day < lengthDays; day += 1) {
    if (schedule.days.includes(weekdayOf(addDays(dayOne, day)))) return;
  }
  reject("INVALID_REQUEST", "Keep at least one scheduled day in the rest of the game.");
}

function assertEditableWords(state: RuleState, change: Extract<GameChange, { kind: "edit" }>, controls: GameChangeControls, sealedWords?: SealedWordChanges): void {
  const stakes = change.stakes ?? sealedWords?.stakes;
  if ((change.tasks || sealedWords?.tasksChanged) && !controls.canEditTasks) reject("INVALID_REQUEST", "Tasks lock once Day 1 begins.");
  if (stakes && !controls.canEditStakes) reject("INVALID_REQUEST", "This game is no longer open for changes.");
  if (stakes && currentTerms(state.game.terms).stakes.some((stake) => ["prize", "dare"].includes(stake.kind))) validNewStakes(stakes);
}

/** Only the prize or dare changes: no tasks, schedule, length or start. */
function isStakesOnlyChange(change: Extract<GameChange, { kind: "edit" }>, sealedWords?: SealedWordChanges): boolean {
  return Boolean(change.stakes ?? sealedWords?.stakes) && !change.tasks && !sealedWords?.tasksChanged
    && change.schedule === undefined && change.lengthDays === undefined && change.startsOn === undefined;
}

/**
 * A picked Day 1 runs from the latest player's today (so it has not ended for
 * anyone) to 60 days out; a reset uses the same default as going live.
 */
function changedStartDate(state: RuleState, change: Extract<GameChange, { kind: "edit" }>, now: Date, canEdit: boolean, agreedStart?: string): string | null {
  if (change.startsOn === undefined) return null;
  if (!canEdit) reject("DAY_CLOSED", START_DATE_LOCKED);
  if (agreedStart !== undefined) return agreedStart;
  const latestToday = state.players.map((player) => gameLocalDate(now, player.timeZone)).sort().at(-1)!;
  if (change.startsOn !== null && (change.startsOn < latestToday || change.startsOn > addDays(latestToday, GAME_MAX_START_DAYS_OUT))) {
    reject("INVALID_REQUEST", `Choose a start date from today to ${GAME_MAX_START_DAYS_OUT} days out.`);
  }
  return change.startsOn ?? (state.game.status === "negotiating" ? null : state.players.map((player) => acceptanceStartDate(now, player.timeZone)).sort().at(-1)!);
}

function parseStoredStake(value: unknown): StoredStake {
  if (!isRecord(value) || typeof value.key !== "string") throw new Error("Stored game stake change is malformed.");
  const kind = GAME_STAKE_KINDS.find((kind) => kind === value.kind);
  if (!kind) throw new Error("Stored game stake change is malformed.");
  return { key: value.key, kind };
}

type SealedWordChanges = Pick<StoredGamePendingChange, "tasksChanged" | "stakes">;
