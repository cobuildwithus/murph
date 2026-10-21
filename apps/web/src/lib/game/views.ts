/**
 * Viewer-scoped views of a game. Pure: the service loads and decrypts, these
 * functions decide what this viewer may see. Post-to-unlock lives here: an
 * entry from another player reaches a view only once the viewer has posted
 * for that day (or the game has settled). Excuses stay with their owner.
 */

import type {
  GameDayOtherStatus,
  GameDayView,
  GameEntryView,
  GamePlayerView,
  GameTermsVersion,
  GameTicketView,
  GameView,
} from "./contract";
import {
  currentTerms,
  dayIndexAt,
  hasUnlockedDay,
  isScheduledDay,
  isTicketExpired,
  liveEntry,
  outcomeFor,
  attemptsUsed,
  GAME_POSTS_PER_DAY,
  playerFor,
  scorePlayer,
  ticketUseBy,
  type RuleEntry,
  type RulePlayer,
  type RuleState,
  type StoredResult,
  type TermWords,
} from "./rules";
import { addDays } from "./time";

export function gameMediaUrl(key: string): string {
  return `/api/game/v1/media/${encodeURIComponent(key)}`;
}

export interface GameTicketRow {
  id: string;
  gameId: string;
  stakeKey: string;
  owedBy: string;
  owedTo: string;
  status: "open" | "redeemed";
  createdAt: Date;
  redeemedAt: Date | null;
}

export interface GameViewInput {
  state: RuleState;
  viewerId: string;
  now: Date;
  round: number;
  startedAt: Date | null;
  words: TermWords;
  /** Per member: the viewer's private label name, else their own first name. */
  names: ReadonlyMap<string, string>;
  /** Per member: the photo the viewer attached when they invited them, if any. */
  avatarKeys: ReadonlyMap<string, string | null>;
  /** Canonical photos, separate from viewer-private overrides for shared exports. */
  profileAvatarKeys?: ReadonlyMap<string, string | null>;
  /** Per member: the relationship the viewer typed for them, if any. */
  relationships: ReadonlyMap<string, string | null>;
  /**
   * The invitee while nobody has joined: the challenger's own words for them,
   * or, for an addressed rematch's invitee, their own name.
   */
  invitee: { memberId: string | null; name: string; photoKey: string | null; relationship: string | null } | null;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
  /** Decrypted words for the entries `visibleEntryIds` allowed. */
  entryWords: ReadonlyMap<string, { text: string | null }>;
  result: StoredResult | null;
  tickets: readonly GameTicketRow[];
}

function unlocked(state: RuleState, viewerId: string, dayIndex: number): boolean {
  return state.game.status === "settled" || hasUnlockedDay(state.entries, viewerId, dayIndex);
}

/** Every entry this viewer may see. Callers decrypt only these. */
export function visibleEntryIds(state: RuleState, viewerId: string): Set<string> {
  const visible = new Set<string>();
  if (!playerFor(state, viewerId)) return visible;
  for (const entry of state.entries) {
    if (entry.memberId === viewerId) {
      if (entry.withdrawnAt === null) visible.add(entry.id);
    } else if (
      entry.attempt > 0
      && entry.withdrawnAt === null
      && unlocked(state, viewerId, entry.dayIndex)
    ) {
      visible.add(entry.id);
    }
  }
  return visible;
}

export function stakeItem(words: TermWords, key: string): string {
  for (let i = words.versions.length - 1; i >= 0; i -= 1) {
    const stake = words.versions[i].stakes.find((candidate) => candidate.key === key);
    if (stake) return stake.item;
  }
  return "";
}

export function termsView(state: RuleState, words: TermWords): GameTermsVersion {
  const version = currentTerms(state.game.terms);
  const versionWords = [...words.versions].reverse().find((candidate) => candidate.n <= version.n) ?? words.versions[0];
  return {
    fromDay: version.fromDay,
    n: version.n,
    schedule: version.schedule,
    stakes: version.stakes.map((stake) => ({ item: stakeItem(words, stake.key), key: stake.key, kind: stake.kind })),
    tasks: versionWords.tasks.map((task) => ({ seat: task.seat, text: task.text })),
  };
}

/** `now` is the ticket's game clock: it decides whether an open ticket has expired. */
export function ticketView(row: GameTicketRow, words: TermWords | null, viewerId: string, now: Date): GameTicketView {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    owedByMemberId: row.owedBy,
    owedToMemberId: row.owedTo,
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    status: isTicketExpired(row, now) ? "expired" : row.status,
    useBy: ticketUseBy(row.createdAt).toISOString(),
    what: words ? stakeItem(words, row.stakeKey) : "",
    youHold: row.owedTo === viewerId,
  };
}

function entryView(entry: RuleEntry, input: GameViewInput): GameEntryView {
  const words = input.entryWords.get(entry.id);
  return {
    entryId: entry.id,
    kind: entry.kind,
    mediaUrls: entry.mediaKeys.map(gameMediaUrl),
    text: words?.text ?? null,
  };
}

export function buildGameView(input: GameViewInput): GameView {
  const { state, viewerId } = input;
  const { game } = state;
  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  const playerViews = players.map((player) => playerView(input, player));
  if (input.invitee && players.length < game.seats) playerViews.push(inviteeView(input, input.invitee, players.length, viewerId));
  return {
    days: dayViews(input, players),
    id: game.id,
    inviteExpiresAt: game.status === "invited" ? input.inviteExpiresAt?.toISOString() ?? null : null,
    // The service hands over the token only to the people it belongs to.
    inviteToken: input.inviteToken,
    lengthDays: game.lengthDays,
    players: playerViews,
    result: input.result
      ? {
          outcome: outcomeFor(input.result, viewerId),
          scores: input.result.scores.map(({ score, seat }) => ({ score, seat })),
        }
      : null,
    retakeAvailable: retakeAvailable(state, viewerId, input.now),
    round: input.round,
    startedAt: input.startedAt?.toISOString() ?? null,
    status: game.status,
    startsOn: game.startsOn,
    terms: termsView(state, input.words),
    tickets: input.tickets
      .filter((ticket) => ticket.owedBy === viewerId || ticket.owedTo === viewerId)
      .map((ticket) => ticketView(ticket, input.words, viewerId, input.now)),
  };
}

function playerView(input: GameViewInput, player: RulePlayer): GamePlayerView {
  const { game } = input.state;
  const today = game.status === "live" ? dayIndexAt(player, input.now) : null;
  const started = today !== null && today >= 0;
  const resultScore = input.result?.scores.find((score) => score.memberId === player.memberId)?.score;
  const profileKey = input.profileAvatarKeys?.get(player.memberId) ?? null;
  const avatarKey = input.avatarKeys.get(player.memberId) ?? profileKey;
  const isMe = player.memberId === input.viewerId;
  return {
    avatarUrl: avatarKey ? gameMediaUrl(avatarKey) : null,
    profileAvatarUrl: profileKey ? gameMediaUrl(profileKey) : null,
    dayIndex: started && today < game.lengthDays ? today : null,
    firstName: input.names.get(player.memberId) ?? "",
    isMe,
    memberId: player.memberId,
    relationship: isMe ? null : input.relationships.get(player.memberId) ?? null,
    score: resultScore ?? (started ? scorePlayer(input.state, player, today).score : 0),
    seat: player.seat,
  };
}

/** The challenger's own name for whoever they invited, until that person joins. */
function inviteeView(input: GameViewInput, invitee: NonNullable<GameViewInput["invitee"]>, seat: number, viewerId: string): GamePlayerView {
  const profileKey = invitee.memberId ? input.profileAvatarKeys?.get(invitee.memberId) ?? null : null;
  const avatarKey = invitee.photoKey ?? (invitee.memberId ? input.avatarKeys.get(invitee.memberId) : null) ?? profileKey;
  return {
    avatarUrl: avatarKey ? gameMediaUrl(avatarKey) : null,
    profileAvatarUrl: profileKey ? gameMediaUrl(profileKey) : null,
    dayIndex: null,
    firstName: invitee.name,
    isMe: invitee.memberId === viewerId,
    memberId: invitee.memberId,
    relationship: invitee.memberId === viewerId ? null : invitee.relationship,
    score: 0,
    seat,
  };
}

function dayViews(input: GameViewInput, players: readonly RulePlayer[]): GameDayView[] {
  const { state, viewerId } = input;
  const viewer = playerFor(state, viewerId);
  if (!viewer?.dayOne) return [];
  const visible = visibleEntryIds(state, viewerId);
  const others = players.filter((player) => player.memberId !== viewerId);
  return Array.from({ length: state.game.lengthDays }, (_, index) => {
    const mine = liveEntry(state.entries, viewerId, index) ?? ownExcuse(state, viewerId, index);
    return {
      index,
      localDate: addDays(viewer.dayOne!, index),
      mine: mine && visible.has(mine.id) ? entryView(mine, input) : null,
      off: !isScheduledDay(state, index),
      others: others.map((other) => otherDayView(input, visible, other, index)),
    };
  });
}

function ownExcuse(state: RuleState, viewerId: string, index: number): RuleEntry | null {
  return state.entries.find((entry) =>
    entry.memberId === viewerId && entry.dayIndex === index && entry.attempt === 0 && entry.withdrawnAt === null) ?? null;
}

/** Another player's day as this viewer may see it: locked until the viewer posts that day. */
function otherDayView(input: GameViewInput, visible: ReadonlySet<string>, other: RulePlayer, index: number): GameDayView["others"][number] {
  const posted = liveEntry(input.state.entries, other.memberId, index);
  if (posted) {
    const open = visible.has(posted.id);
    return { entry: open ? entryView(posted, input) : null, seat: other.seat, status: open ? "posted" : "locked" };
  }
  return { entry: null, seat: other.seat, status: unpostedStatus(input, other, index) };
}

function unpostedStatus(input: GameViewInput, other: RulePlayer, index: number): GameDayOtherStatus {
  const { game } = input.state;
  if (!isScheduledDay(input.state, index)) return "off";
  // A blank day isn't a miss in a pick-any-days game; only the shortfall is.
  if ("count" in currentTerms(game.terms).schedule) return "none";
  const otherToday = dayIndexAt(other, input.now);
  const over = game.status === "settled" || game.status === "void" || (otherToday !== null && otherToday > index);
  return over ? "missed" : "none";
}

/** A retake is open once today's post is up and the day's two posts aren't used. */
function retakeAvailable(state: RuleState, viewerId: string, now: Date): boolean {
  const viewer = playerFor(state, viewerId);
  const today = viewer && state.game.status === "live" ? dayIndexAt(viewer, now) : null;
  if (today === null || today < 0 || today >= state.game.lengthDays) return false;
  return liveEntry(state.entries, viewerId, today) !== null
    && attemptsUsed(state.entries, viewerId, today) < GAME_POSTS_PER_DAY;
}
