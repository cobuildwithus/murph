/**
 * Every weekly-game rule, as pure functions over a locked game's state. The
 * write path loads state under the game row lock, asks a `decide*` function
 * what to do, then applies it. Nothing here touches the database or a clock.
 */

import {
  GAME_STAKE_KINDS,
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
  agreedTermsVersion: number;
  active: boolean;
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
  nextDueAt: Date | null;
}

export interface RuleState {
  game: RuleGame;
  players: RulePlayer[];
  entries: RuleEntry[];
}

export const GAME_SEATS_1V1 = 2;
export const GAME_DEFAULT_LENGTH_DAYS = 7;
export const GAME_MAX_LENGTH_DAYS = 28;
export const GAME_POSTS_PER_DAY = 2;
export const GAME_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STAKES = 3;
const MEDIA_KINDS: ReadonlySet<GameEntryKind> = new Set(["photo", "video", "voice"]);

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
  RETAKE_USED: 409,
  TERMS_CHANGED: 409,
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

export function isScheduledDay(terms: StoredTerms, player: RulePlayer, dayIndex: number): boolean {
  const schedule = termsForDay(terms, dayIndex).schedule;
  if ("count" in schedule) return true;
  if (!player.dayOne) return false;
  return schedule.days.includes(weekdayOf(addDays(player.dayOne, dayIndex)));
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
}

/**
 * Turns what the challenger proposed into version 1 (words arrive checked and
 * trimmed). Stake keys the client sends are kept only when the previous game
 * had them (a rematch); every other stake gets `newKey()`.
 */
export function decideNewTerms(
  input: GameTermsInput,
  options: { previousStakeKeys: ReadonlySet<string>; newKey: () => string },
): NewTerms {
  const lengthDays = input.lengthDays ?? GAME_DEFAULT_LENGTH_DAYS;
  if (lengthDays < 1 || lengthDays > GAME_MAX_LENGTH_DAYS) {
    reject("INVALID_REQUEST", `A game runs 1 to ${GAME_MAX_LENGTH_DAYS} days.`);
  }
  const tasks = [...input.tasks].sort((a, b) => a.seat - b.seat);
  if (tasks.length !== GAME_SEATS_1V1 || tasks.some((task, seat) => task.seat !== seat)) {
    reject("INVALID_REQUEST", "Each player needs one task: seats 0 and 1.");
  }
  const schedule = validSchedule(input.schedule, lengthDays);
  if (input.stakes.length > MAX_STAKES) reject("INVALID_REQUEST", `A game has up to ${MAX_STAKES} stakes.`);
  const usedKeys = new Set<string>();
  const stakes = input.stakes.map((stake) => {
    const key = stake.key && options.previousStakeKeys.has(stake.key) && !usedKeys.has(stake.key)
      ? stake.key
      : options.newKey();
    usedKeys.add(key);
    return { item: stake.item, key, kind: stake.kind };
  });
  return {
    lengthDays,
    terms: {
      v: 1,
      versions: [{ fromDay: 0, n: 1, schedule, stakes: stakes.map(({ key, kind }) => ({ key, kind })) }],
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
  nextDueAt: Date;
}

function scheduleFor(players: readonly RulePlayer[], lengthDays: number, dayOneOf: (player: RulePlayer) => string): Schedule {
  const days = players.map((player) => ({ memberId: player.memberId, timeZone: player.timeZone, dayOne: dayOneOf(player) }));
  return { nextDueAt: settleDueAt(days.map((day, index) => ({ ...players[index], dayOne: day.dayOne })), lengthDays), players: days };
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
  const version = currentTerms(game.terms).n;
  if (input.termsVersion !== version) {
    reject("TERMS_CHANGED", "The terms changed. Take another look.");
  }
  if (state.players.some((player) => player.agreedTermsVersion !== version)) {
    reject("TERMS_CHANGED", "Everyone has to agree to the latest terms first.");
  }
  const joiner: RulePlayer = {
    active: true,
    agreedTermsVersion: version,
    dayOne: null,
    memberId: input.memberId,
    seat: state.players.length,
    timeZone: input.timeZone,
  };
  // Day 1 is each player's next local day after the last one shakes on it.
  return {
    kind: "join",
    seat: joiner.seat,
    startedAt: input.now,
    ...scheduleFor([...state.players, joiner], game.lengthDays, (player) =>
      addDays(gameLocalDate(input.now, player.timeZone), 1)),
  };
}

export interface PostDecision {
  dayIndex: number;
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
    hasText: boolean;
    captureAgeMs: number | null;
    now: Date;
  },
): PostDecision {
  const player = requireLivePlayer(state, input.memberId);
  if (MEDIA_KINDS.has(input.kind) && input.mediaKeys.length === 0) {
    reject("MEDIA_MISSING", "Add the photo, video or voice memo first.");
  }
  if (input.kind === "text" && !input.hasText) reject("INVALID_REQUEST", "Write something first.");
  if (input.mediaKeys.some((key) => !key.startsWith(input.mediaKeyPrefix))) {
    reject("MEDIA_MISSING", "Upload the media before posting it.");
  }
  const dayIndex = postingDay(state, player, input.kind, input.captureAgeMs, input.now);
  if (input.kind === "excuse") {
    if (hasExcuse(state.entries, player.memberId, dayIndex)) reject("RETAKE_USED", "You already sent an excuse for today.");
    return { attempt: 0, dayIndex, withdrawEntryId: null };
  }
  const used = attemptsUsed(state.entries, player.memberId, dayIndex);
  if (used >= GAME_POSTS_PER_DAY) reject("RETAKE_USED", "You already used today's retake.");
  return {
    attempt: used + 1,
    dayIndex,
    withdrawEntryId: liveEntry(state.entries, player.memberId, dayIndex)?.id ?? null,
  };
}

function hasExcuse(entries: readonly RuleEntry[], memberId: string, dayIndex: number): boolean {
  return entries.some((entry) => entry.memberId === memberId && entry.dayIndex === dayIndex && entry.attempt === 0);
}

/**
 * Which day a post counts for. Normally today. In the hour after a player's
 * 3am boundary, a post captured before that boundary (by the phone's
 * monotonic capture age, an honor rule) counts for the day that just ended,
 * if that day was scheduled and still has no post.
 */
function postingDay(
  state: RuleState,
  player: RulePlayer,
  kind: GameEntryKind,
  captureAgeMs: number | null,
  now: Date,
): number {
  const today = dayIndexAt(player, now)!;
  const { lengthDays, terms } = state.game;
  const yesterday = today - 1;
  if (captureAgeMs !== null && yesterday >= 0 && yesterday < lengthDays) {
    const boundary = dayStartInstant(addDays(player.dayOne!, today), player.timeZone).getTime();
    const capturedAt = now.getTime() - captureAgeMs;
    const open = isScheduledDay(terms, player, yesterday)
      && !liveEntry(state.entries, player.memberId, yesterday)
      && (kind === "excuse"
        ? !hasExcuse(state.entries, player.memberId, yesterday)
        : attemptsUsed(state.entries, player.memberId, yesterday) < GAME_POSTS_PER_DAY);
    if (open && now.getTime() - boundary < GAME_GRACE_MS && capturedAt <= boundary + GAME_CAPTURE_SLACK_MS) {
      return yesterday;
    }
  }
  if (today < 0) reject("DAY_CLOSED", "Day 1 hasn't started yet.");
  if (today >= lengthDays) reject("DAY_CLOSED", "This game is over.");
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
): { withdrawEntryId: string | null } {
  const player = requireLivePlayer(state, input.memberId);
  const entry = state.entries.find((candidate) => candidate.id === input.entryId);
  if (!entry || entry.memberId !== player.memberId || entry.attempt === 0) reject("GAME_NOT_FOUND", "That post isn't yours.");
  if (entry.withdrawnAt) return { withdrawEntryId: null };
  if (entry.dayIndex !== dayIndexAt(player, input.now)) reject("DAY_CLOSED", "Only today's post can be taken back.");
  return { withdrawEntryId: entry.id };
}

/** Both only before anyone joins: a live game plays out. */
export function decideVoid(state: RuleState, input: { memberId: string; reason: "declined" | "cancelled" }): void {
  const isPlayer = playerFor(state, input.memberId) !== null;
  if (state.game.status !== "invited") reject("GAME_NOT_LIVE", "Only an open invite can be called off.");
  if (input.reason === "declined" && isPlayer) reject("INVALID_REQUEST", "Only the invitee can decline.");
  if (input.reason === "cancelled" && !isPlayer) reject("NOT_A_PLAYER", "Only the challenger can cancel.");
}

/** Start now: everyone's Day 1 becomes today. Only before anyone has started. */
export function decideStartNow(state: RuleState, now: Date): Schedule {
  if (state.game.status !== "live") reject("GAME_NOT_LIVE", "Both players have to shake on it first.");
  if (state.players.some((player) => (dayIndexAt(player, now) ?? -1) >= 0)) {
    reject("INVALID_REQUEST", "This game already started.");
  }
  return scheduleFor(state.players, state.game.lengthDays, (player) => gameLocalDate(now, player.timeZone));
}

/** Dev time travel: move every player's Day 1 back so "today" moves forward. */
export function decideDevAdvance(state: RuleState, days: number): Schedule {
  if (state.game.status !== "live") reject("GAME_NOT_LIVE", "This game isn't live.");
  if (!Number.isInteger(days) || days < 1 || days > GAME_MAX_LENGTH_DAYS) reject("INVALID_REQUEST", "Advance 1 or more days.");
  return scheduleFor(state.players, state.game.lengthDays, (player) => addDays(player.dayOne!, -days));
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
    const scheduled = isScheduledDay(terms, player, day);
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
  for (const stake of version.stakes) {
    if (stake.kind === "winner_gets") {
      // A tie (including everyone perfect) means nobody owes anything.
      if (winners.length !== 1) continue;
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
