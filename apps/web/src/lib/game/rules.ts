/**
 * Every weekly-game rule, as pure functions over a locked game's state. The
 * write path loads state under the game row lock, asks a `decide*` function
 * what to do, then applies it. Nothing here touches the database or a clock.
 */

import {
  GAME_STAKE_KINDS,
  GAME_CHECK_IN_KINDS,
  type GameCheckInKind,
  GAME_WEEKDAYS,
  type GameEntryKind,
  type GameError,
  type GameErrorCode,
  type GameSchedule,
  type GameStakeKind,
  type GameStatus,
  type GameTermsInput,
} from "./contract";
import { isRecord } from "../primitives";
import {
  addDays,
  dayStartInstant,
  daysBetween,
  gameLocalDate,
  GAME_CAPTURE_SLACK_MS,
  GAME_GRACE_MS,
  weekdayOf,
} from "./time";

/** Plain terms: structure only. Words live encrypted in `TermWords`. */
export interface StoredStake {
  key: string;
  kind: GameStakeKind;
}
export interface StoredTermsVersion {
  checkInKind?: GameCheckInKind;
  n: number;
  fromDay: number;
  schedule: GameSchedule;
  stakes: StoredStake[];
}
export interface StoredTerms {
  v: 1;
  versions: StoredTermsVersion[];
}
export interface TermWords {
  v: 1;
  versions: { n: number; tasks: { seat: number; text: string }[]; stakes: { key: string; item: string }[] }[];
}

/** Frozen at settle. Ids and numbers only. */
export interface StoredResult {
  v: 1;
  termsVersion: number;
  scores: { seat: number; memberId: string; score: number; misses: number }[];
}

export interface RulePlayer {
  memberId: string;
  seat: number;
  timeZone: string;
  /** Local date of this player's day 0, set at go-live. */
  dayOne: string | null;
}

export interface RuleEntry {
  id: string;
  memberId: string;
  dayIndex: number;
  /** 1 or 2 for posts (a retake is attempt 2); 0 for an excuse. */
  attempt: number;
  kind: GameEntryKind;
  mediaKeys: string[];
  withdrawnAt: Date | null;
}

export interface RuleGame {
  id: string;
  status: GameStatus;
  createdBy: string;
  lengthDays: number;
  seats: number;
  terms: StoredTerms;
  inviteExpiresAt: Date | null;
  /** The challenger's picked Day 1 (YYYY-MM-DD), if any. */
  startsOn: string | null;
}

export interface RuleState {
  game: RuleGame;
  players: RulePlayer[];
  entries: RuleEntry[];
}

export const GAME_SEATS_1V1 = 2;
export const GAME_DEFAULT_LENGTH_DAYS = 7;
export const GAME_MAX_LENGTH_DAYS = 28;
export const GAME_MAX_START_DAYS_OUT = 60;
export const GAME_TICKET_USE_DAYS = 14;

/** A ticket's redeem-by time: derived, never stored. */
export function ticketUseBy(createdAt: Date): Date {
  return new Date(createdAt.getTime() + GAME_TICKET_USE_DAYS * 24 * 60 * 60 * 1000);
}

/** Open tickets expire just after their use-by time; redeemed ones never do. */
export function isTicketExpired(ticket: { status: string; createdAt: Date }, now: Date): boolean {
  return ticket.status === "open" && now.getTime() > ticketUseBy(ticket.createdAt).getTime();
}
export const GAME_POSTS_PER_DAY = 2;
export const GAME_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STAKES = 3;

export const GAME_ERROR_STATUS: Record<GameErrorCode, number> = {
  ALREADY_IN_A_GAME: 409,
  DAY_CLOSED: 409,
  GAME_DISABLED: 404,
  GAME_NOT_FOUND: 404,
  GAME_NOT_LIVE: 409,
  INVALID_REQUEST: 400,
  INVITE_EXPIRED: 410,
  INVITE_NOT_FOUND: 404,
  INVITE_USED: 409,
  MEDIA_MISSING: 422,
  NOT_A_PLAYER: 403,
  PROFILE_REQUIRED: 409,
  REMATCH_OUTDATED: 409,
  RETAKE_USED: 409,
  TERMS_CHANGED: 409,
  TICKET_EXPIRED: 410,
  TICKET_NOT_HELD: 403,
  UNAUTHENTICATED: 401,
};

export class GameRuleError extends Error {
  readonly error: GameError;

  constructor(code: GameErrorCode, message: string) {
    super(message);
    this.name = "GameRuleError";
    this.error = { code, message };
  }
}

export function reject(code: GameErrorCode, message: string): never {
  throw new GameRuleError(code, message);
}

export function currentTerms(terms: StoredTerms): StoredTermsVersion {
  return terms.versions[terms.versions.length - 1];
}

/** The rules a given day was played under: the latest version from that day. */
export function termsForDay(terms: StoredTerms, dayIndex: number): StoredTermsVersion {
  let version = terms.versions[0];
  for (const candidate of terms.versions) {
    if (candidate.fromDay <= dayIndex) version = candidate;
  }
  return version;
}

export function playerFor(state: RuleState, memberId: string): RulePlayer | null {
  return state.players.find((player) => player.memberId === memberId) ?? null;
}

/** The player's current 0-based day; may be negative (not started) or past the end. */
export function dayIndexAt(player: RulePlayer, now: Date): number | null {
  if (!player.dayOne) return null;
  return daysBetween(player.dayOne, gameLocalDate(now, player.timeZone));
}

/**
 * Whether a day index counts. Every player shares one Day 1 date, so a day
 * index is the same calendar date (and weekday) for everyone, each in their
 * own time zone. Count mode counts every day.
 */
export function isScheduledDay(state: RuleState, dayIndex: number): boolean {
  const schedule = termsForDay(state.game.terms, dayIndex).schedule;
  if ("count" in schedule) return true;
  const dayOne = state.players.find((player) => player.dayOne)?.dayOne;
  if (!dayOne) return false;
  return schedule.days.includes(weekdayOf(addDays(dayOne, dayIndex)));
}

export function liveEntry(entries: readonly RuleEntry[], memberId: string, dayIndex: number): RuleEntry | null {
  return entries.find((entry) =>
    entry.memberId === memberId
    && entry.dayIndex === dayIndex
    && entry.attempt > 0
    && entry.withdrawnAt === null) ?? null;
}

/** Posts made for a day, withdrawn ones included. Excuses don't count. */
export function attemptsUsed(entries: readonly RuleEntry[], memberId: string, dayIndex: number): number {
  return entries.filter((entry) =>
    entry.memberId === memberId && entry.dayIndex === dayIndex && entry.attempt > 0).length;
}

/** Posting unlocks a day for good: a withdrawn photo can't be unseen. */
export function hasUnlockedDay(entries: readonly RuleEntry[], memberId: string, dayIndex: number): boolean {
  return attemptsUsed(entries, memberId, dayIndex) > 0;
}

/**
 * Whether a game is past its end: an invite past its expiry, or a live game
 * once the last player's last day (plus grace) is over. Computed from state,
 * so any read can settle it.
 */
export function isGameDue(state: RuleState, now: Date): boolean {
  const { game } = state;
  if (game.status === "invited") return game.inviteExpiresAt !== null && game.inviteExpiresAt <= now;
  return game.status === "live" && settleDueAt(state.players, game.lengthDays) <= now;
}

/**
 * Who's playing, as one key: the sorted member ids joined by ":". A live game
 * holds its roster's key, so the same people can't have two going at once.
 */
export function liveRosterKey(memberIds: readonly string[]): string {
  return [...memberIds].sort().join(":");
}

/** A live game is waiting on this player today: a scheduled day they haven't posted yet. */
export function needsPostToday(state: RuleState, memberId: string, now: Date): boolean {
  const player = playerFor(state, memberId);
  const today = player && state.game.status === "live" ? dayIndexAt(player, now) : null;
  if (today === null || today < 0 || today >= state.game.lengthDays) return false;
  return isScheduledDay(state, today) && !liveEntry(state.entries, memberId, today);
}

/** When the last player's last day ends, plus grace: the settle time. */
export function settleDueAt(players: readonly RulePlayer[], lengthDays: number): Date {
  let due = 0;
  for (const player of players) {
    if (!player.dayOne) continue;
    const end = dayStartInstant(addDays(player.dayOne, lengthDays), player.timeZone).getTime();
    due = Math.max(due, end + GAME_GRACE_MS);
  }
  return new Date(due);
}

// ------------------------------------------------------------------- terms

export interface NewTerms {
  terms: StoredTerms;
  words: TermWords;
  lengthDays: number;
  startsOn: string | null;
}

/**
 * Turns what the challenger proposed into version 1 (words arrive checked and
 * trimmed). Every stake gets a fresh key; tickets name their stake by it. A
 * picked start date must fall from tomorrow to 60 days out, where `today` is
 * the challenger's own game day.
 */
export function decideNewTerms(input: GameTermsInput, options: { newKey: () => string; today: string }): NewTerms {
  const startsOn = input.startsOn ?? null;
  if (startsOn && (startsOn <= options.today || startsOn > addDays(options.today, GAME_MAX_START_DAYS_OUT))) {
    reject("INVALID_REQUEST", `Pick a start date from tomorrow to ${GAME_MAX_START_DAYS_OUT} days out.`);
  }
  const lengthDays = input.lengthDays ?? GAME_DEFAULT_LENGTH_DAYS;
  if (lengthDays < 1 || lengthDays > GAME_MAX_LENGTH_DAYS) {
    reject("INVALID_REQUEST", `A game runs 1 to ${GAME_MAX_LENGTH_DAYS} days.`);
  }
  const tasks = [...input.tasks].sort((a, b) => a.seat - b.seat);
  if (tasks.length !== GAME_SEATS_1V1 || tasks.some((task, seat) => task.seat !== seat)) {
    reject("INVALID_REQUEST", "Each player needs one task: seats 0 and 1.");
  }
  const schedule = validSchedule(input.schedule, lengthDays);
  if (input.stakes.length < 1 || input.stakes.length > MAX_STAKES) {
    reject("INVALID_REQUEST", `A game has 1 to ${MAX_STAKES} stakes.`);
  }
  const stakes = input.stakes.map((stake) => ({ item: stake.item, key: options.newKey(), kind: stake.kind }));
  return {
    lengthDays,
    startsOn,
    terms: {
      v: 1,
      versions: [{ checkInKind: input.checkInKind ?? "photo", fromDay: 0, n: 1, schedule, stakes: stakes.map(({ key, kind }) => ({ key, kind })) }],
    },
    words: {
      v: 1,
      versions: [{ n: 1, stakes: stakes.map(({ item, key }) => ({ item, key })), tasks }],
    },
  };
}

function validSchedule(schedule: GameSchedule, lengthDays: number): GameSchedule {
  if ("count" in schedule) {
    if (schedule.count < 1 || schedule.count > lengthDays) reject("INVALID_REQUEST", `Count must be 1 to ${lengthDays}.`);
    return { count: schedule.count };
  }
  if (schedule.days.length === 0 || new Set(schedule.days).size !== schedule.days.length) {
    reject("INVALID_REQUEST", "Days must be distinct weekdays 0 (Monday) to 6 (Sunday).");
  }
  return { days: [...schedule.days].sort((a, b) => a - b) };
}

// ------------------------------------------------------------------ commands

/** Each player's frozen time zone and Day 1, as the write path stores them. */
export interface PlayerDays {
  memberId: string;
  timeZone: string;
  dayOne: string;
}

export interface Schedule {
  players: PlayerDays[];
}

/**
 * One Day 1 date for everyone: the latest of each player's earliest allowed
 * date (and `atLeast`, a picked start), so nobody's Day 1 is already behind
 * them and every day index is the same calendar date in each time zone.
 */
function scheduleFor(
  players: readonly RulePlayer[],
  earliestFor: (player: RulePlayer) => string,
  atLeast: string | null = null,
): Schedule {
  const dayOne = players.map(earliestFor).reduce((latest, date) => (date > latest ? date : latest), atLeast ?? "");
  return {
    players: players.map((player) => ({ dayOne, memberId: player.memberId, timeZone: player.timeZone })),
  };
}

export type JoinDecision =
  | { kind: "already-joined" }
  | ({ kind: "join"; seat: number; startedAt: Date } & Schedule);

/**
 * The last seat filling starts the game. `state.players` must carry each
 * current player's time zone as of now: it freezes here, at go-live.
 */
export function decideJoin(
  state: RuleState,
  input: { memberId: string; termsVersion: number; timeZone: string; now: Date },
): JoinDecision {
  const { game } = state;
  if (playerFor(state, input.memberId)) {
    if (game.status === "invited" || game.status === "live") return { kind: "already-joined" };
  }
  const expired = game.inviteExpiresAt !== null && input.now.getTime() > game.inviteExpiresAt.getTime();
  if (game.status === "void" || (game.status === "invited" && expired)) reject("INVITE_EXPIRED", "This invite isn't open anymore.");
  if (game.status !== "invited" || state.players.length >= game.seats) reject("INVITE_USED", "This invite was already used.");
  if (input.termsVersion !== currentTerms(game.terms).n) {
    reject("TERMS_CHANGED", "The terms changed. Take another look.");
  }
  const joiner: RulePlayer = {
    dayOne: null,
    memberId: input.memberId,
    seat: state.players.length,
    timeZone: input.timeZone,
  };
  // Day 1 is the next local day after the last one shakes on it for whoever
  // gets there last, or the picked date if that's later.
  return {
    kind: "join",
    seat: joiner.seat,
    startedAt: input.now,
    ...scheduleFor(
      [...state.players, joiner],
      (player) => addDays(gameLocalDate(input.now, player.timeZone), 1),
      game.startsOn,
    ),
  };
}

export interface PostDecision {
  dayIndex: number;
  /** True when the post counted for the day that just ended (the capture-age grace). */
  graceUsed: boolean;
  attempt: number;
  /** The live post this one replaces (a retake), if any. */
  withdrawEntryId: string | null;
}

export function decidePost(
  state: RuleState,
  input: {
    memberId: string;
    kind: GameEntryKind;
    mediaKeys: readonly string[];
    mediaKeyPrefix: string;
    captureAgeMs: number | null;
    now: Date;
  },
): PostDecision {
  const player = requireLivePlayer(state, input.memberId);
  if (input.kind === "excuse") return { attempt: 0, dayIndex: excuseDay(state, player, input.now), graceUsed: false, withdrawEntryId: null };
  if (input.mediaKeys.length === 0) reject("MEDIA_MISSING", "Add the check-in image first.");
  if (input.mediaKeys.some((key) => !key.startsWith(input.mediaKeyPrefix))) {
    reject("MEDIA_MISSING", "Upload the media before posting it.");
  }
  const dayIndex = postingDay(state, player, input.captureAgeMs, input.now);
  const required = termsForDay(state.game.terms, dayIndex).checkInKind ?? "photo";
  if (input.kind !== required) {
    reject("INVALID_REQUEST", required === "heart_rate" ? "This challenge requires a heart-rate check-in." : "This challenge requires a photo check-in.");
  }
  const graceUsed = dayIndex !== dayIndexAt(player, input.now);
  const used = attemptsUsed(state.entries, player.memberId, dayIndex);
  if (used >= GAME_POSTS_PER_DAY) reject("RETAKE_USED", "You already used today's retake.");
  return {
    attempt: used + 1,
    dayIndex,
    graceUsed,
    withdrawEntryId: liveEntry(state.entries, player.memberId, dayIndex)?.id ?? null,
  };
}

function hasExcuse(entries: readonly RuleEntry[], memberId: string, dayIndex: number): boolean {
  return entries.some((entry) => entry.memberId === memberId && entry.dayIndex === dayIndex && entry.attempt === 0);
}

/**
 * An excuse explains a day already missed: the most recent past scheduled
 * day with no live photo and no excuse yet. Never today, never before Day 1.
 */
function excuseDay(state: RuleState, player: RulePlayer, now: Date): number {
  const today = dayIndexAt(player, now)!;
  for (let day = Math.min(today, state.game.lengthDays) - 1; day >= 0; day -= 1) {
    const missed = isScheduledDay(state, day) && !liveEntry(state.entries, player.memberId, day);
    if (missed && !hasExcuse(state.entries, player.memberId, day)) return day;
  }
  return reject("DAY_CLOSED", "There's no missed day to excuse.");
}

/**
 * Which day a photo counts for. Normally today. In the hour after a player's
 * 3am boundary, a post captured before that boundary (by the phone's
 * monotonic capture age, an honor rule) counts for the day that just ended,
 * if that day was scheduled and still has no post.
 */
function postingDay(state: RuleState, player: RulePlayer, captureAgeMs: number | null, now: Date): number {
  const today = dayIndexAt(player, now)!;
  const { lengthDays } = state.game;
  const yesterday = today - 1;
  if (captureAgeMs !== null && yesterday >= 0 && yesterday < lengthDays) {
    const boundary = dayStartInstant(addDays(player.dayOne!, today), player.timeZone).getTime();
    const capturedAt = now.getTime() - captureAgeMs;
    const open = isScheduledDay(state, yesterday)
      && !liveEntry(state.entries, player.memberId, yesterday)
      && attemptsUsed(state.entries, player.memberId, yesterday) < GAME_POSTS_PER_DAY;
    if (open && now.getTime() - boundary < GAME_GRACE_MS && capturedAt <= boundary + GAME_CAPTURE_SLACK_MS) {
      return yesterday;
    }
  }
  if (today < 0) reject("DAY_CLOSED", "Day 1 hasn't started yet.");
  if (today >= lengthDays) reject("DAY_CLOSED", "This game is over.");
  // A shot the phone kept from an earlier day never counts for today.
  if (captureAgeMs !== null) {
    const dayStart = dayStartInstant(addDays(player.dayOne!, today), player.timeZone).getTime();
    if (now.getTime() - captureAgeMs < dayStart - GAME_CAPTURE_SLACK_MS) {
      reject("DAY_CLOSED", "That check-in is from an earlier day.");
    }
  }
  return today;
}

/**
 * Take back your own live post for your current day. Retrying is fine: an
 * entry already taken back is a no-op. Other days and other people's posts
 * can't be withdrawn.
 */
export function decideWithdraw(
  state: RuleState,
  input: { memberId: string; entryId: string; now: Date },
): { withdraw: { entryId: string; dayIndex: number } | null } {
  const player = requireLivePlayer(state, input.memberId);
  const entry = state.entries.find((candidate) => candidate.id === input.entryId);
  if (!entry || entry.memberId !== player.memberId || entry.attempt === 0) reject("GAME_NOT_FOUND", "That post isn't yours.");
  if (entry.withdrawnAt) return { withdraw: null };
  if (entry.dayIndex !== dayIndexAt(player, input.now)) reject("DAY_CLOSED", "Only today's post can be taken back.");
  return { withdraw: { dayIndex: entry.dayIndex, entryId: entry.id } };
}

/**
 * Start now: Day 1 becomes today, the latest "today" among the players, so
 * nobody starts on a day that's already over for them. Across the date line
 * the player behind starts tomorrow. Only before anyone has started.
 */
export function decideStartNow(state: RuleState, now: Date): Schedule {
  if (state.game.status !== "live") reject("GAME_NOT_LIVE", "Both players have to shake on it first.");
  if (state.players.some((player) => (dayIndexAt(player, now) ?? -1) >= 0)) {
    reject("INVALID_REQUEST", "This game already started.");
  }
  return scheduleFor(state.players, (player) => gameLocalDate(now, player.timeZone));
}

export const GAME_DEV_ADVANCE_MAX_DAYS = GAME_MAX_LENGTH_DAYS;

/**
 * Dev time travel moves this game's clock forward by whole days. History
 * (Day 1, posts, start time) stays as it was, so posts keep their real dates.
 */
export function decideDevAdvance(state: RuleState, days: number): { addMs: number } {
  if (state.game.status !== "live") reject("GAME_NOT_LIVE", "This game isn't live.");
  if (!Number.isInteger(days) || days < 1 || days > GAME_DEV_ADVANCE_MAX_DAYS) {
    reject("INVALID_REQUEST", `Advance 1 to ${GAME_DEV_ADVANCE_MAX_DAYS} days.`);
  }
  return { addMs: days * 24 * 60 * 60 * 1000 };
}

function requireLivePlayer(state: RuleState, memberId: string): RulePlayer {
  const player = playerFor(state, memberId);
  if (!player) reject("NOT_A_PLAYER", "You're not in this game.");
  if (state.game.status !== "live" || !player.dayOne) reject("GAME_NOT_LIVE", "This game isn't live.");
  return player;
}

// -------------------------------------------------------------------- settle

export interface PlayerScore {
  seat: number;
  memberId: string;
  score: number;
  misses: number;
}

/**
 * Score = scheduled days with a live post (capped at N in count mode).
 * Misses = scheduled days without one; in count mode, the shortfall from N.
 * `throughDay` limits scoring to days already over (for live games).
 */
export function scorePlayer(state: RuleState, player: RulePlayer, throughDay = state.game.lengthDays - 1): PlayerScore {
  const { terms } = state.game;
  let credited = 0;
  let scheduledMissed = 0;
  for (let day = 0; day <= Math.min(throughDay, state.game.lengthDays - 1); day += 1) {
    const scheduled = isScheduledDay(state, day);
    const posted = liveEntry(state.entries, player.memberId, day) !== null;
    if (scheduled && posted) credited += 1;
    if (scheduled && !posted) scheduledMissed += 1;
  }
  const schedule = currentTerms(terms).schedule;
  if ("count" in schedule) {
    const score = Math.min(credited, schedule.count);
    return { memberId: player.memberId, misses: Math.max(0, schedule.count - credited), score, seat: player.seat };
  }
  return { memberId: player.memberId, misses: scheduledMissed, score: credited, seat: player.seat };
}

export interface SettleDecision {
  result: StoredResult;
  tickets: { stakeKey: string; owedBy: string; owedTo: string }[];
}

export function decideSettle(state: RuleState): SettleDecision {
  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  const scores = players.map((player) => scorePlayer(state, player));
  const version = currentTerms(state.game.terms);
  const tickets: SettleDecision["tickets"] = [];
  const top = Math.max(...scores.map((score) => score.score));
  const winners = scores.filter((score) => score.score === top);
  // Same test as outcomeFor: when nobody missed a day, the outcome is perfect.
  const perfect = scores.every((score) => score.misses === 0);
  for (const stake of version.stakes) {
    if (stake.kind === "winner_gets") {
      // A tie or a perfect game means nobody owes anything.
      if (perfect || winners.length !== 1) continue;
      for (const loser of scores) {
        if (loser.memberId === winners[0].memberId) continue;
        tickets.push({ owedBy: loser.memberId, owedTo: winners[0].memberId, stakeKey: stake.key });
      }
    } else {
      // Everyone vs everyone: each pair settles the difference in misses.
      for (const debtor of scores) {
        for (const creditor of scores) {
          for (let i = 0; i < debtor.misses - creditor.misses; i += 1) {
            tickets.push({ owedBy: debtor.memberId, owedTo: creditor.memberId, stakeKey: stake.key });
          }
        }
      }
    }
  }
  return { result: { scores, termsVersion: version.n, v: 1 }, tickets };
}

export function outcomeFor(result: StoredResult, memberId: string): "won" | "lost" | "tie" | "perfect" {
  if (result.scores.every((score) => score.misses === 0)) return "perfect";
  const top = Math.max(...result.scores.map((score) => score.score));
  const winners = result.scores.filter((score) => score.score === top);
  if (winners.length > 1) return winners.some((score) => score.memberId === memberId) ? "tie" : "lost";
  return winners[0].memberId === memberId ? "won" : "lost";
}

// ------------------------------------------------------------ stored shapes

function malformed(what: string): never {
  throw new Error(`Stored game ${what} is malformed.`);
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) malformed(what);
  return value;
}

function asList(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) malformed(what);
  return value;
}

function asInt(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) malformed(what);
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string") malformed(what);
  return value;
}

function asSchedule(value: unknown): GameSchedule {
  const schedule = asObject(value, "schedule");
  if ("count" in schedule) return { count: asInt(schedule.count, "schedule") };
  return {
    days: asList(schedule.days, "schedule").map((raw) =>
      GAME_WEEKDAYS.find((day) => day === raw) ?? malformed("schedule")),
  };
}

export function parseStoredTerms(value: unknown): StoredTerms {
  const root = asObject(value, "terms");
  if (root.v !== 1) malformed("terms");
  const versions = asList(root.versions, "terms").map((raw) => {
    const version = asObject(raw, "terms");
    return {
      checkInKind: version.checkInKind === undefined ? "photo" : GAME_CHECK_IN_KINDS.find((kind) => kind === version.checkInKind) ?? malformed("check-in kind"),
      fromDay: asInt(version.fromDay, "terms"),
      n: asInt(version.n, "terms"),
      schedule: asSchedule(version.schedule),
      stakes: asList(version.stakes, "terms").map((rawStake) => {
        const stake = asObject(rawStake, "stake");
        const kind = GAME_STAKE_KINDS.find((candidate) => candidate === stake.kind) ?? malformed("stake");
        return { key: asString(stake.key, "stake"), kind };
      }),
    };
  });
  if (versions.length === 0) malformed("terms");
  return { v: 1, versions };
}

export function parseTermWords(text: string): TermWords {
  const root = asObject(JSON.parse(text), "words");
  if (root.v !== 1) malformed("words");
  return {
    v: 1,
    versions: asList(root.versions, "words").map((raw) => {
      const version = asObject(raw, "words");
      return {
        n: asInt(version.n, "words"),
        stakes: asList(version.stakes, "words").map((rawStake) => {
          const stake = asObject(rawStake, "words");
          return { item: asString(stake.item, "words"), key: asString(stake.key, "words") };
        }),
        tasks: asList(version.tasks, "words").map((rawTask) => {
          const task = asObject(rawTask, "words");
          return { seat: asInt(task.seat, "words"), text: asString(task.text, "words") };
        }),
      };
    }),
  };
}

export function parseStoredResult(value: unknown): StoredResult {
  const root = asObject(value, "result");
  if (root.v !== 1) malformed("result");
  return {
    scores: asList(root.scores, "result").map((raw) => {
      const score = asObject(raw, "result");
      return {
        memberId: asString(score.memberId, "result"),
        misses: asInt(score.misses, "result"),
        score: asInt(score.score, "result"),
        seat: asInt(score.seat, "result"),
      };
    }),
    termsVersion: asInt(root.termsVersion, "result"),
    v: 1,
  };
}
