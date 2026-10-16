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
  liveEntry,
  outcomeFor,
  attemptsUsed,
  GAME_POSTS_PER_DAY,
  playerFor,
  scorePlayer,
  type RuleEntry,
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
  gameId: string | null;
  stakeKey: string;
  owedBy: string;
  owedTo: string;
  status: "open" | "redeemed" | "void";
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
  /** Per member: the viewer's label photo, else their own avatar. */
  avatarKeys: ReadonlyMap<string, string | null>;
  /** The invitee while nobody has joined (the challenger's own words). */
  invitee: { name: string; photoKey: string | null } | null;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
  /** Decrypted words for the entries `visibleEntryIds` allowed. */
  entryWords: ReadonlyMap<string, { text: string | null; data: Record<string, unknown> | null }>;
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

/** 1 for a circle's first game, then 2, 3…: settled games that came before, plus one. */
export function roundNumber(createdAt: Date, settledInCircle: ReadonlyArray<{ createdAt: Date }>): number {
  return 1 + settledInCircle.filter((other) => other.createdAt < createdAt).length;
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

export function ticketView(row: GameTicketRow, words: TermWords | null, viewerId: string): GameTicketView {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    owedByMemberId: row.owedBy,
    owedToMemberId: row.owedTo,
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    status: row.status,
    what: words ? stakeItem(words, row.stakeKey) : "",
    youHold: row.owedTo === viewerId,
  };
}

function entryView(entry: RuleEntry, input: GameViewInput): GameEntryView {
  const words = input.entryWords.get(entry.id);
  return {
    data: words?.data ?? null,
    entryId: entry.id,
    kind: entry.kind,
    mediaUrls: entry.mediaKeys.map(gameMediaUrl),
    text: words?.text ?? null,
  };
}

export function buildGameView(input: GameViewInput): GameView {
  const { state, viewerId, now } = input;
  const { game } = state;
  const visible = visibleEntryIds(state, viewerId);
  const viewer = playerFor(state, viewerId);
  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  const settled = game.status === "settled";

  const playerViews: GamePlayerView[] = players.map((player) => {
    const today = game.status === "live" ? dayIndexAt(player, now) : null;
    const inRange = today !== null && today >= 0 && today < game.lengthDays;
    const resultScore = input.result?.scores.find((score) => score.memberId === player.memberId)?.score;
    const avatarKey = input.avatarKeys.get(player.memberId) ?? null;
    return {
      avatarUrl: avatarKey ? gameMediaUrl(avatarKey) : null,
      dayIndex: inRange ? today : null,
      firstName: input.names.get(player.memberId) ?? "",
      isMe: player.memberId === viewerId,
      memberId: player.memberId,
      score: resultScore ?? (game.status === "live" && today !== null && today >= 0 ? scorePlayer(state, player, today).score : 0),
      seat: player.seat,
    };
  });
  if (input.invitee && players.length < game.seats) {
    playerViews.push({
      avatarUrl: input.invitee.photoKey ? gameMediaUrl(input.invitee.photoKey) : null,
      dayIndex: null,
      firstName: input.invitee.name,
      isMe: false,
      memberId: null,
      score: 0,
      seat: players.length,
    });
  }

  const days: GameDayView[] = [];
  if (viewer?.dayOne) {
    const scheduleIsCount = "count" in currentTerms(game.terms).schedule;
    for (let index = 0; index < game.lengthDays; index += 1) {
      const mine = liveEntry(state.entries, viewerId, index)
        ?? state.entries.find((entry) => entry.memberId === viewerId && entry.dayIndex === index && entry.attempt === 0 && entry.withdrawnAt === null)
        ?? null;
      days.push({
        index,
        localDate: addDays(viewer.dayOne, index),
        mine: mine && visible.has(mine.id) ? entryView(mine, input) : null,
        off: !isScheduledDay(game.terms, viewer, index),
        others: players
          .filter((player) => player.memberId !== viewerId)
          .map((other) => {
            const posted = liveEntry(state.entries, other.memberId, index);
            if (posted) {
              const open = visible.has(posted.id);
              return { entry: open ? entryView(posted, input) : null, seat: other.seat, status: open ? "posted" : "locked" };
            }
            const otherToday = dayIndexAt(other, now);
            const over = settled || game.status === "void" || (otherToday !== null && otherToday > index);
            let status: GameDayOtherStatus = "none";
            if (!isScheduledDay(game.terms, other, index)) status = "off";
            else if (over && !scheduleIsCount) status = "missed";
            return { entry: null, seat: other.seat, status };
          }),
      });
    }
  }

  const viewerToday = viewer && game.status === "live" ? dayIndexAt(viewer, now) : null;
  const retakeAvailable = viewerToday !== null
    && viewerToday >= 0
    && viewerToday < game.lengthDays
    && liveEntry(state.entries, viewerId, viewerToday) !== null
    && attemptsUsed(state.entries, viewerId, viewerToday) < GAME_POSTS_PER_DAY;

  return {
    days,
    id: game.id,
    inviteExpiresAt: game.status === "invited" ? input.inviteExpiresAt?.toISOString() ?? null : null,
    inviteToken: game.status === "invited" ? input.inviteToken : null,
    lengthDays: game.lengthDays,
    players: playerViews,
    result: input.result
      ? {
          outcome: outcomeFor(input.result, viewerId),
          scores: input.result.scores.map(({ score, seat }) => ({ score, seat })),
        }
      : null,
    retakeAvailable,
    round: input.round,
    startedAt: input.startedAt?.toISOString() ?? null,
    status: game.status,
    terms: termsView(state, input.words),
    termsVersion: currentTerms(game.terms).n,
    tickets: input.tickets
      .filter((ticket) => ticket.owedBy === viewerId || ticket.owedTo === viewerId)
      .map((ticket) => ticketView(ticket, input.words, viewerId)),
  };
}
