/**
 * Viewer-scoped views of a game. Pure: the service loads and decrypts, these
 * functions decide what this viewer may see. Post-to-unlock lives here: an
 * entry from another player reaches a view only once the viewer has posted
 * for that day (or the game has settled). Excuses stay with their owner. A
 * post the viewer reported stays posted but is never shown to them again.
 */

import type {
  GameDayOtherStatus,
  GameDayView,
  GameEntryView,
  GameEntryData,
  GamePlayerView,
  GameTermsVersion,
  GameTicketView,
  GameView,
  GamePendingChange,
} from "./contract";
import {
  currentTerms,
  dayIndexAt,
  hasFinishedGame,
  hasUnlockedDay,
  isScheduledDay,
  isTicketExpired,
  liveEntry,
  outcomeFor,
  attemptsUsed,
  GAME_POSTS_PER_DAY,
  playerFor,
  scorePlayer,
  playerStreak,
  settleDueAt,
  ticketUseBy,
  type RuleEntry,
  type RulePlayer,
  type RuleState,
  type StoredTerms,
  type StoredResult,
  type TermWords,
} from "./rules";
import { addDays } from "./time";
import { pendingGameChangeView, gameChangeControls } from "./changes";

export function gameMediaUrl(key: string): string {
  return `/api/game/v1/media/${encodeURIComponent(key)}`;
}

export interface GameTicketRow {
  id: string;
  gameId: string;
  stakeKey: string;
  /** Null once that member deleted their account. */
  owedBy: string | null;
  owedTo: string | null;
  status: "open" | "redeemed";
  createdAt: Date;
  redeemedAt: Date | null;
}

export interface GameViewInput {
  pendingChange?: GamePendingChange | null;
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
  /** A player who deleted their account: their seat and the name the viewer knew them by. */
  departed?: { seat: number; name: string } | null;
  /**
   * The invitee while nobody has joined: the challenger's own words for them,
   * or, for an addressed rematch's invitee, their own name.
   */
  invitee: { memberId: string | null; name: string; photoKey: string | null; relationship: string | null } | null;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
  /** Decrypted text and summary data only for entries `visibleEntryIds` allowed. */
  entryWords: ReadonlyMap<string, { text: string | null; data?: GameEntryData | null }>;
  /** Posts the viewer reported. */
  hiddenEntryIds?: ReadonlySet<string>;
  result: StoredResult | null;
  tickets: readonly GameTicketRow[];
}

function unlocked(state: RuleState, viewerId: string, dayIndex: number): boolean {
  return state.game.status === "settled" || hasUnlockedDay(state.entries, viewerId, dayIndex);
}

const NO_ENTRIES: ReadonlySet<string> = new Set();

/** Every entry this viewer may see, less the ones they reported. Callers decrypt only these. */
export function visibleEntryIds(state: RuleState, viewerId: string, hidden: ReadonlySet<string> = NO_ENTRIES): Set<string> {
  const visible = new Set<string>();
  if (!playerFor(state, viewerId)) return visible;
  for (const entry of state.entries) {
    if (entry.memberId === viewerId) {
      if (entry.withdrawnAt === null) visible.add(entry.id);
    } else if (
      entry.attempt > 0
      && entry.withdrawnAt === null
      && !hidden.has(entry.id)
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
    checkInKind: version.checkInKind ?? "photo",
    fromDay: version.fromDay,
    n: version.n,
    schedule: version.schedule,
    stakes: version.stakes.map((stake) => ({ item: stakeItem(words, stake.key), key: stake.key, kind: stake.kind })),
    tasks: versionWords.tasks.map((task) => ({ seat: task.seat, text: task.text })),
  };
}

/** `now` is the ticket's game clock: it decides whether an open ticket has expired. */
export function ticketView(row: GameTicketRow, words: TermWords | null, viewerId: string, now: Date, terms?: StoredTerms): GameTicketView {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    kind: terms?.versions.flatMap((version) => version.stakes).find((stake) => stake.key === row.stakeKey)?.kind,
    ...(row.owedBy === null || row.owedTo === null ? { left: true as const } : {}),
    owedByMemberId: row.owedBy ?? "",
    owedToMemberId: row.owedTo ?? "",
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
    ...(entry.incomplete ? { incomplete: true as const } : {}),
    entryId: entry.id,
    kind: entry.kind,
    mediaUrls: entry.mediaKeys.map(gameMediaUrl),
    text: words?.text ?? null,
    data: words?.data ?? null,
  };
}

export function buildGameView(input: GameViewInput): GameView {
  const { state, viewerId } = input;
  const { game } = state;
  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  const playerViews = players.map((player) => playerView(input, player));
  if (input.departed) playerViews.push(departedView(input, input.departed));
  if (input.invitee && playerViews.length < game.seats) playerViews.push(inviteeView(input, input.invitee, firstOpenSeat(playerViews), viewerId));
  playerViews.sort((a, b) => a.seat - b.seat);
  return {
    changeControls: gameChangeControls(state, input.now, input.pendingChange ?? null),
    pendingChange: pendingGameChangeView(state, input.pendingChange ?? null, input.now),
    days: game.status === "negotiating" ? [] : dayViews(input, players),
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
    settlesAt: settlesAt(state, viewerId, input.now),
    startedAt: input.startedAt?.toISOString() ?? null,
    status: game.status,
    startsOn: game.startsOn,
    terms: termsView(state, input.words),
    tickets: input.tickets
      .filter((ticket) => ticket.owedBy === viewerId || ticket.owedTo === viewerId)
      .map((ticket) => ticketView(ticket, input.words, viewerId, input.now, state.game.terms)),
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
    streak: playerStreak(input.state, player, input.now),
  };
}

function firstOpenSeat(views: readonly GamePlayerView[]): number {
  let seat = 0;
  while (views.some((view) => view.seat === seat)) seat += 1;
  return seat;
}

/** A player who deleted their account: only their seat, final score and the viewer's name for them remain. */
function departedView(input: GameViewInput, departed: NonNullable<GameViewInput["departed"]>): GamePlayerView {
  return {
    avatarUrl: null,
    dayIndex: null,
    firstName: departed.name,
    isMe: false,
    left: true,
    memberId: null,
    profileAvatarUrl: null,
    relationship: null,
    score: input.result?.scores.find((score) => score.seat === departed.seat)?.score ?? 0,
    seat: departed.seat,
    streak: 0,
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
    streak: 0,
    seat,
  };
}

function dayViews(input: GameViewInput, players: readonly RulePlayer[]): GameDayView[] {
  const { state, viewerId } = input;
  const viewer = playerFor(state, viewerId);
  if (!viewer?.dayOne) return [];
  const visible = visibleEntryIds(state, viewerId, input.hiddenEntryIds);
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
  // Reported: still their post for the day, with nothing of it to show.
  if (posted && input.hiddenEntryIds?.has(posted.id)) return { entry: null, hidden: true, seat: other.seat, status: "posted" };
  if (posted) {
    const open = visible.has(posted.id);
    return { entry: open ? entryView(posted, input) : null, seat: other.seat, status: open ? "posted" : "locked",
      ...(!open ? { postedAt: posted.receivedAt.toISOString(), blurHash: posted.blurHash } : {}) };
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

/** Results soon: the viewer's last day is over while the game waits to settle. */
function settlesAt(state: RuleState, viewerId: string, now: Date): string | null {
  const viewer = playerFor(state, viewerId);
  return viewer && state.game.status === "live" && hasFinishedGame(state, viewer, now) ? settleDueAt(state).toISOString() : null;
}

/** A retake is open once today's post is up and the day's two posts aren't used. */
function retakeAvailable(state: RuleState, viewerId: string, now: Date): boolean {
  const viewer = playerFor(state, viewerId);
  const today = viewer && state.game.status === "live" ? dayIndexAt(viewer, now) : null;
  if (today === null || today < 0 || today >= state.game.lengthDays) return false;
  return liveEntry(state.entries, viewerId, today) !== null
    && attemptsUsed(state.entries, viewerId, today) < GAME_POSTS_PER_DAY;
}
