/**
 * Viewer-scoped views of a game. Pure: the service loads and decrypts, these
 * functions decide what this viewer may see. Post-to-unlock lives here: an
 * entry from another player reaches a view only once the viewer has posted
 * for that day (or the game has settled). Excuses stay with their owner. A
 * post the viewer reported stays posted but is never shown to them again.
 */

import type {
  GameChangeControls,
  GameDayOtherStatus,
  GameDayView,
  GameEntryView,
  GameEntryData,
  GameHistoryGameView,
  GameHistoryPersonView,
  GameHistoryGroupView,
  GameHistoryGroupGameView,
  GameStandingView,
  GamePermissions,
  GamePlayerView,
  GameTermsVersion,
  GameTicketView,
  GameView,
  GamePendingChange,
} from "./contract";
import {
  currentTerms,
  groupTaskOverrideSeats,
  canChallengeGame,
  gameChallengeStatus,
  type RuleChallenge,
  assertGroupTermsOpen,
  canRedeemGroupTicket,
  decideCancelInvite,
  decideJoin,
  GameRuleError,
  isGameDue,
  eligibleFromDay,
  dayIndexAt,
  entriesForDay,
  indexGameEntries,
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
  type GameEntryIndex,
  type RulePlayer,
  type RuleState,
  type StoredTerms,
  type StoredResult,
  type TermWords,
} from "./rules";
import { addDays, gameLocalDate } from "./time";
import { pendingGameChangeView, gameChangeControls } from "./changes";
import { firstOpenSeat, isPairRoster } from "./roster";

const GAME_MEDIA_PATH = "/api/game/v1/media/";
const CLOSED_CHANGE_CONTROLS: GameChangeControls = { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, canEditTasks: false, canEditStakes: false, editableFromDay: null };
export const GAME_HISTORY_PREVIEW_LIMIT = 6;

export function gameMediaUrl(key: string): string {
  return `${GAME_MEDIA_PATH}${encodeURIComponent(key)}`;
}

/** The media key behind a view's link; null for anything else. */
export function gameMediaKeyOf(url: string): string | null {
  if (!url.startsWith(GAME_MEDIA_PATH)) return null;
  try {
    return decodeURIComponent(url.slice(GAME_MEDIA_PATH.length));
  } catch {
    return null;
  }
}

export interface GameTicketRow {
  id: string;
  gameId: string;
  stakeKey: string;
  owedBySeats: readonly number[];
  owedToSeats: readonly number[];
  players: readonly { seat: number; memberId: string | null }[];
  status: "open" | "redeemed";
  createdAt: Date;
  redeemedAt: Date | null;
}

export interface GameViewInput {
  entryReplies?: ReadonlyMap<string, import("./contract").GameReplyView>;
  replyEligibleEntryIds?: ReadonlySet<string>;
  challenges?: readonly RuleChallenge[];
  multiplayer?: boolean;
  home?: boolean;
  groupsEnabled?: boolean;
  audienceKey?: string | null;
  pendingChange?: GamePendingChange | null;
  talkDelivery?: GameView["talkDelivery"];
  recapWatched?: boolean;
  state: RuleState;
  viewerId: string;
  now: Date;
  round: number;
  previousGameId: string | null;
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
  departed?: readonly { seat: number; name: string; joinedOn?: string | null; eligibleFromDay?: number | null }[];
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
  /** Blocks affect projection only; canonical players and entries remain intact. */
  hiddenMemberIds?: ReadonlySet<string>;
  result: StoredResult | null;
  recap: GameView["recap"];
  tickets: readonly GameTicketRow[];
}

const NO_HIDDEN: ReadonlySet<string> = new Set();

/** Every entry this viewer may see, less the ones they reported. Callers decrypt only these. */
export function visibleEntryIds(state: RuleState, viewerId: string, hidden: ReadonlySet<string> = NO_HIDDEN, hiddenMembers: ReadonlySet<string> = NO_HIDDEN, entries = indexGameEntries(state.entries)): Set<string> {
  const visible = new Set<string>();
  const viewer = playerFor(state, viewerId);
  if (!viewer || viewer.leftAt) return visible;
  for (const entry of state.entries) {
    if (entry.memberId === viewerId) {
      if (entry.withdrawnAt === null) visible.add(entry.id);
    } else if (
      entry.attempt > 0
      && entry.withdrawnAt === null
      && !hidden.has(entry.id)
      && !hiddenMembers.has(entry.memberId)
      && (state.game.status === "settled" || hasUnlockedDay(entries, viewerId, entry.dayIndex))
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

/** Released task/stake fields are projected here from versioned canonical terms. */
export function termsView(state: RuleState, words: TermWords, multiplayer = false): GameTermsVersion {
  const version = currentTerms(state.game.terms);
  const versionWords = [...words.versions].reverse().find((candidate) => candidate.n <= version.n) ?? words.versions[0];
  return {
    ...(multiplayer && versionWords.defaultTask !== undefined ? { defaultTask: versionWords.defaultTask } : {}),
    checkInKind: version.checkInKind ?? "photo",
    fromDay: version.fromDay,
    n: version.n,
    schedule: version.schedule,
    stakes: version.stakes.map((stake) => ({ item: stakeItem(words, stake.key), key: stake.key, kind: stake.kind })),
    tasks: state.game.seats === 10 && versionWords.defaultTask !== undefined ? groupTasksView(state, versionWords)
      : versionWords.tasks.map((task) => ({ seat: task.seat, text: task.text })),
  };
}

function groupTasksView(state: RuleState, words: TermWords["versions"][number]) {
  const admitted = state.game.admittedSeats ?? state.players.map(player => player.seat);
  const overrideSeats = groupTaskOverrideSeats(state.game, words.tasks);
  return [
    ...admitted.map(seat => ({ seat, text: words.tasks.find(task => task.seat === seat)?.text ?? words.defaultTask ?? "" })),
    ...words.tasks.filter(task => overrideSeats.includes(task.seat) && !admitted.includes(task.seat))
      .map(task => ({ seat: task.seat, text: task.text })),
  ];
}

/** `now` is the ticket's game clock: it decides whether an open ticket has expired. */
export function ticketView(row: GameTicketRow, words: TermWords | null, viewerId: string, now: Date, terms?: StoredTerms, hiddenMembers: ReadonlySet<string> = NO_HIDDEN, input?: GameViewInput): GameTicketView {
  // Legacy scalar parties, including the pair block/departure presentation.
  const party = (seats: readonly number[]) => {
    const member = seats.length === 1 ? row.players.find(player => player.seat === seats[0])?.memberId : null;
    return member && !hiddenMembers.has(member) ? member : null;
  };
  const owedBy = party(row.owedBySeats);
  const owedTo = party(row.owedToSeats);
  const group = input?.state.game.seats === 10;
  const parties = (seats: readonly number[]) => seats.map(seat => {
    const memberId = row.players.find(player => player.seat === seat)?.memberId ?? null;
    const hidden = memberId !== null && hiddenMembers.has(memberId);
    return { seat, memberId: hidden ? null : memberId,
      firstName: hidden ? "" : memberId ? input?.names.get(memberId) ?? "" : input?.departed?.find(player => player.seat === seat)?.name ?? "",
      avatarUrl: memberId && input && !hidden ? playerAvatars(input, memberId).avatarUrl : null };
  });
  return {
    ...(input?.multiplayer ? { parties: { owedBy: parties(row.owedBySeats), owedTo: parties(row.owedToSeats) },
      canRedeem: canRedeemTicketView(row, input, owedBy, owedTo), ...(group ? { group: groupView(input) } : {}) } : {}),
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    kind: terms?.versions.flatMap((version) => version.stakes).find((stake) => stake.key === row.stakeKey)?.kind,
    ...(!group && (owedBy === null || owedTo === null) ? { left: true as const } : {}),
    owedByMemberId: group ? "" : owedBy ?? "",
    owedToMemberId: group ? "" : owedTo ?? "",
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    status: isTicketExpired(row, now) ? "expired" : row.status,
    useBy: ticketUseBy(row.createdAt).toISOString(),
    what: words ? stakeItem(words, row.stakeKey) : "",
    youHold: group ? row.players.some(player => player.memberId === viewerId && row.owedToSeats.includes(player.seat)) : owedTo === viewerId,
  };
}

function canRedeemTicketView(row: GameTicketRow, input: GameViewInput, owedBy: string | null, owedTo: string | null): boolean {
  if (row.status !== "open" || isTicketExpired(row, input.now)) return false;
  return input.state.game.seats === 10 ? canRedeemGroupTicket(row, row.players, input.result, input.viewerId) : owedTo === input.viewerId && owedBy !== null;
}

function entryView(entry: RuleEntry, input: GameViewInput): GameEntryView {
  const words = input.entryWords.get(entry.id);
  const challenge = input.challenges?.find(challenge => challenge.entryId === entry.id);
  const status = challenge && gameChallengeStatus(input.state, challenge, input.now);
  return {
    ...(input.state.game.seats === 2 ? {
      ...(input.entryReplies?.has(entry.id) ? { reply: input.entryReplies.get(entry.id) } : {}),
      ...(entry.memberId !== input.viewerId && input.replyEligibleEntryIds !== undefined ? { canReply: input.replyEligibleEntryIds?.has(entry.id) ?? false } : {}),
    } : {}),
    ...(challenge && (status === "open" || status === "stood") ? { challenge: { status, deadlineAt: challenge.deadlineAt.toISOString(), byYou: challenge.actor === input.viewerId } } : {}),
    ...(entry.incomplete ? { incomplete: true as const } : {}),
    entryId: entry.id,
    kind: entry.kind,
    mediaUrls: entry.mediaKeys.map(gameMediaUrl),
    text: words?.text ?? null,
    data: words?.data ?? null,
  };
}

export type BuiltGameHistoryView = {
  game: GameHistoryGameView;
  person: Pick<GameHistoryPersonView, "memberId" | "firstName" | "avatarUrl" | "profileAvatarUrl">;
} | { game: GameHistoryGroupGameView; group: Pick<GameHistoryGroupView, "id" | "word" | "task" | "prize"> };

/** The bounded history projection, built from the same viewer-scoped inputs as a recap. */
export function buildGameHistoryView(input: GameViewInput): BuiltGameHistoryView | null {
  if (input.state.game.status !== "settled" || !input.result) return null;
  const viewer = playerFor(input.state, input.viewerId);
  const other = input.state.players.find((player) => player.memberId !== input.viewerId);
  const group = input.state.game.seats === 10;
  // The released history contract groups games by one opponent.
  if (!viewer?.dayOne || viewer.leftAt || !canShowHistoryRoster(input, other)) return null;

  const entries = indexGameEntries(input.state.entries);
  const mine = playerView(input, viewer, entries);
  const theirs = other ? playerView(input, other, entries) : null;
  const outcome = outcomeFor(input.result, input.viewerId);
  const terms = termsView(input.state, input.words, input.multiplayer);
  const stake = terms.stakes[0];
  const historyOutcome = outcome === "won" || outcome === "lost" ? outcome : "tied";
  const taskFor = (seat: number) => terms.tasks.find(task => task.seat === seat)?.text ?? terms.defaultTask ?? "";
  const visible = visibleEntryIds(input.state, input.viewerId, input.hiddenEntryIds, input.hiddenMemberIds, entries);
  const seats = new Map(input.state.players.map((player) => [player.memberId, player.seat]));
  const dayOrder = (a: RuleEntry, b: RuleEntry) => a.dayIndex - b.dayIndex
    || (seats.get(a.memberId) ?? 0) - (seats.get(b.memberId) ?? 0)
    || a.receivedAt.getTime() - b.receivedAt.getTime()
    || a.id.localeCompare(b.id);
  const shown = input.state.entries
    .filter((entry) => visible.has(entry.id))
    .sort(dayOrder);
  const previews = [
    ...shown.filter((entry) => entry.kind === "photo"),
    ...shown.filter((entry) => entry.kind !== "photo"),
  ].slice(0, GAME_HISTORY_PREVIEW_LIMIT)
    .sort(dayOrder)
    .map((entry) => ({ entry: entryView(entry, input), mine: entry.memberId === input.viewerId, seat: seats.get(entry.memberId)! }));

  if (group) return {
    group: { ...groupView(input), task: terms.defaultTask ?? "", prize: stake?.item ?? null },
    game: { id: input.state.game.id, round: input.round, startedOn: viewer.dayOne,
      endsOn: addDays(viewer.dayOne, input.state.game.lengthDays - 1), lengthDays: input.state.game.lengthDays,
      schedule: terms.schedule, players: rosterViews(input, entries), result: historyOutcome,
      ...resultStandings(input.result), previews: previews.map(({ entry, seat }) => ({ ...entry, seat })) },
  };

  return {
    game: {
      endsOn: addDays(viewer.dayOne, input.state.game.lengthDays - 1),
      id: input.state.game.id,
      lengthDays: input.state.game.lengthDays,
      perfect: outcome === "perfect",
      previews: previews.map(({ entry, mine }) => ({ ...entry, mine })),
      result: historyOutcome,
      schedule: terms.schedule,
      tasks: {
        mine: taskFor(viewer.seat),
        theirs: taskFor(other!.seat),
      },
      stake: stake ? { kind: stake.kind === "dare" || stake.kind === "per_miss" ? "dare" : "prize", item: stake.item } : null,
      score: { mine: mine.score, theirs: theirs!.score },
      startedOn: viewer.dayOne,
    },
    person: {
      ...(theirs!.avatarUrl ? { avatarUrl: theirs!.avatarUrl } : {}),
      ...(theirs!.profileAvatarUrl ? { profileAvatarUrl: theirs!.profileAvatarUrl } : {}),
      firstName: theirs!.firstName,
      memberId: other!.memberId,
    },
  };
}

function canShowHistoryRoster(input: GameViewInput, other: RulePlayer | undefined): boolean {
  return input.state.game.seats === 10 ? input.multiplayer === true : !!other && isPairRoster(input.state.players) && !input.hiddenMemberIds?.has(other.memberId);
}

export function buildGameView(input: GameViewInput): GameView {
  const { state, viewerId } = input;
  const { game } = state;
  const entries = indexGameEntries(state.entries);
  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  const playerViews = rosterViews(input, entries);
  return {
    ...(input.multiplayer ? { maxPlayers: game.seats === 10 ? 10 as const : 2 as const, invitedCount: game.invitees?.length ?? 1,
      permissions: permissions(input), ...(game.seats === 10 ? { group: groupView(input) } : {}) } : {}),
    // Group changes are voted on in the group chat; the app has no group change controls.
    changeControls: game.seats === 10 ? CLOSED_CHANGE_CONTROLS : gameChangeControls(state, input.now, input.pendingChange ?? null),
    pendingChange: game.seats === 10 ? null : pendingGameChangeView(state, input.pendingChange ?? null, input.now),
    ...(input.talkDelivery ? { talkDelivery: input.talkDelivery } : {}),
    ...(input.recapWatched ? { recapWatched: true as const } : {}),
    days: game.status === "negotiating" ? [] : dayViews(input, players, entries),
    id: game.id,
    inviteExpiresAt: game.status === "invited" ? input.inviteExpiresAt?.toISOString() ?? null : null,
    inviteToken: input.inviteToken,
    lengthDays: game.lengthDays,
    players: playerViews,
    result: resultView(input.result, viewerId, input.multiplayer),
    recap: input.recap,
    canChallenge: !state.players.some(player => input.hiddenMemberIds?.has(player.memberId))
      && canChallengeGame(state, input.challenges ?? [], viewerId, input.now),
    retakeAvailable: retakeAvailable(state, viewerId, input.now, entries),
    round: input.round,
    previousGameId: input.previousGameId,
    settlesAt: settlesAt(state, viewerId, input.now),
    startedAt: input.startedAt?.toISOString() ?? null,
    status: game.status,
    startsOn: game.startsOn,
    terms: termsView(state, input.words, input.multiplayer),
    tickets: input.tickets
      .filter((ticket) => ticket.players.some(player => player.memberId === viewerId
        && [...ticket.owedBySeats, ...ticket.owedToSeats].includes(player.seat)))
      .map((ticket) => ticketView(ticket, input.words, viewerId, input.now, state.game.terms, input.hiddenMemberIds, input)),
  };
}

function rosterViews(input: GameViewInput, entries: GameEntryIndex): GamePlayerView[] {
  const { state, viewerId } = input;
  const { game } = state;
  const playerViews = state.players.map((player) => game.seats === 2 && input.hiddenMemberIds?.has(player.memberId)
    ? { ...departedView(input, { seat: player.seat, name: input.names.get(player.memberId) ?? "" }),
      ...(input.multiplayer ? { participation: participationView(input, player) } : {}) }
    : playerView(input, player, entries));
  for (const departed of input.departed ?? []) playerViews.push(departedView(input, departed));
  if (!input.multiplayer && game.seats === 2 && input.invitee && playerViews.length < game.seats) playerViews.push(inviteeView(input, input.invitee, firstOpenSeat(playerViews), viewerId));
  playerViews.sort((a, b) => a.seat - b.seat);
  return playerViews;
}

/** Legacy outcome alias; canonical scores remain member- and seat-addressed. */
function resultView(result: StoredResult | null, viewerId: string, multiplayer = false): GameView["result"] {
  return result ? { outcome: outcomeFor(result, viewerId), scores: result.scores.map(({ score, seat }) => ({ score, seat })), ...(multiplayer ? resultStandings(result) : {}) } : null;
}

function resultStandings(result: StoredResult): { winnerSeats: number[]; standings: GameStandingView[] } {
  const eligible = result.scores.filter(score => score.eligible !== false);
  const standings = result.scores.map(({ seat, score, eligible: included }) => ({ seat, score,
    rank: included === false ? null : 1 + eligible.filter(other => other.score > score).length }));
  return { standings, winnerSeats: standings.filter(row => row.rank === 1).map(row => row.seat) };
}

export function groupView(input: Pick<GameViewInput, "audienceKey" | "words">) {
  return { id: input.audienceKey ?? "", word: input.words.groupWord ?? "" };
}

function permits(check: () => unknown): boolean {
  try { check(); return true; } catch (error) { if (error instanceof GameRuleError) return false; throw error; }
}

function permissions(input: GameViewInput): GamePermissions {
  const { state, viewerId, now } = input;
  const player = playerFor(state, viewerId);
  const open = ["invited", "negotiating", "live"].includes(state.game.status) && !isGameDue(state, now);
  return {
    canJoin: canJoinView(input),
    canLeave: state.game.seats === 10 && !!player && !player.leftAt && open,
    canCancel: open && permits(() => decideCancelInvite(state, viewerId, now)),
    canEditTerms: state.game.status === "invited" && permits(() => assertGroupTermsOpen(state, viewerId, now)),
  };
}

function canJoinView(input: GameViewInput): boolean {
  const { state, viewerId, now } = input;
  if (state.game.seats === 10 && !input.groupsEnabled) return false;
  return permits(() => {
    const decision = decideJoin(state, { memberId: viewerId, now, termsVersion: currentTerms(state.game.terms).n,
      timeZone: playerFor(state, viewerId)?.timeZone ?? "UTC", acceptNegotiation: !input.pendingChange });
    if (decision.kind !== "join") throw new GameRuleError("INVITE_USED", "Already joined.");
  });
}

function playerView(input: GameViewInput, player: RulePlayer, entries: GameEntryIndex): GamePlayerView {
  const { game } = input.state;
  const now = player.leftAt ?? input.now;
  const today = game.status === "live" ? dayIndexAt(player, now) : null;
  const started = today !== null && today >= 0;
  const resultScore = input.result?.scores.find((score) => score.memberId === player.memberId)?.score;
  const isMe = player.memberId === input.viewerId;
  return {
    ...(input.multiplayer ? { participation: participationView(input, player) } : {}),
    ...playerAvatars(input, player.memberId),
    ...(player.leftAt ? { left: true as const } : {}),
    dayIndex: !player.leftAt && started && today < game.lengthDays ? today : null,
    firstName: input.names.get(player.memberId) ?? "",
    isMe,
    memberId: player.memberId,
    relationship: isMe ? null : input.relationships.get(player.memberId) ?? null,
    score: resultScore ?? (started ? scorePlayer(input.state, player, today, entries).score : 0),
    seat: player.seat,
    streak: playerStreak(input.state, player, now),
  };
}

function participationView(input: GameViewInput, player: RulePlayer): NonNullable<GamePlayerView["participation"]> {
  return { state: player.leftAt ? "left" : "joined",
    joinedOn: player.joinedAt ? gameLocalDate(player.joinedAt, player.timeZone) : null,
    eligibleFromDay: player.dayOne ? eligibleFromDay(input.state, player) : null,
    canWin: input.result ? input.result.scores.some(score => score.seat === player.seat && score.eligible !== false) : !player.leftAt && input.state.game.status !== "void" };
}

/** Resolve private/canonical photos only after the symmetric member mask. */
function playerAvatars(input: GameViewInput, memberId: string): Pick<GamePlayerView, "avatarUrl" | "profileAvatarUrl"> {
  if (input.hiddenMemberIds?.has(memberId)) return { avatarUrl: null, profileAvatarUrl: null };
  const profileKey = input.profileAvatarKeys?.get(memberId) ?? null;
  const avatarKey = profileKey ?? input.avatarKeys.get(memberId);
  return { avatarUrl: avatarKey ? gameMediaUrl(avatarKey) : null, profileAvatarUrl: profileKey ? gameMediaUrl(profileKey) : null };
}

/** A player who deleted their account: only their seat, final score and the viewer's name for them remain. */
function departedView(input: GameViewInput, departed: NonNullable<GameViewInput["departed"]>[number]): GamePlayerView {
  return {
    ...(input.multiplayer ? { participation: { state: "deleted" as const, joinedOn: departed.joinedOn ?? null,
      eligibleFromDay: departed.eligibleFromDay ?? null, canWin: input.result?.scores.some(score => score.seat === departed.seat && score.eligible !== false) ?? false } } : {}),
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
  const avatarKey = profileKey ?? invitee.photoKey ?? (invitee.memberId ? input.avatarKeys.get(invitee.memberId) : null);
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

function dayViews(input: GameViewInput, players: readonly RulePlayer[], entries: GameEntryIndex): GameDayView[] {
  const { state, viewerId } = input;
  const viewer = playerFor(state, viewerId);
  if (!viewer?.dayOne || viewer.leftAt) return [];
  const visible = visibleEntryIds(state, viewerId, input.hiddenEntryIds, input.hiddenMemberIds, entries);
  const others = players.filter((player) => player.memberId !== viewerId && (state.game.seats === 10 || !input.hiddenMemberIds?.has(player.memberId)));
  const today = dayIndexAt(viewer, input.now);
  return Array.from({ length: state.game.lengthDays }, (_, index) => {
    const showOthers = !input.home || state.game.seats === 2 || state.game.status === "live" && today === index;
    const mine = liveEntry(entries, viewerId, index) ?? entriesForDay(entries, viewerId, index).find((entry) => entry.attempt === 0 && entry.withdrawnAt === null);
    return {
      ...(input.multiplayer ? { progress: { latestPosterSeats: showOthers ? latestPosterSeats(input, players, index, entries) : [] } } : {}),
      index,
      localDate: addDays(viewer.dayOne!, index),
      mine: mine && visible.has(mine.id) ? { ...entryView(mine, input), postedAt: mine.receivedAt.toISOString() } : null,
      off: !isScheduledDay(state, index),
      others: showOthers ? others.map((other) => otherDayView(input, visible, other, index, entries)) : [],
    };
  });
}

function latestPosterSeats(input: GameViewInput, players: readonly RulePlayer[], index: number, entries: GameEntryIndex): number[] {
  return players.filter(player => !player.leftAt && !input.hiddenMemberIds?.has(player.memberId))
    .flatMap(player => { const post = liveEntry(entries, player.memberId, index); return post && !input.hiddenEntryIds?.has(post.id) ? [{ seat: player.seat, at: post.receivedAt.getTime() }] : []; })
    .sort((a, b) => b.at - a.at || a.seat - b.seat).slice(0, 2).map(player => player.seat);
}

/** Another player's day as this viewer may see it: locked until the viewer posts that day. */
function otherDayView(input: GameViewInput, visible: ReadonlySet<string>, other: RulePlayer, index: number, entries: GameEntryIndex): GameDayView["others"][number] {
  const posted = liveEntry(entries, other.memberId, index);
  if (input.hiddenMemberIds?.has(other.memberId)) return {
    entry: null, seat: other.seat, ...(posted ? { hidden: true, status: "posted" as const } : { status: unpostedStatus(input, other, index) }),
  };
  // Reported: still their post for the day, with nothing of it to show.
  if (posted && input.hiddenEntryIds?.has(posted.id)) return { entry: null, hidden: true, seat: other.seat, status: "posted" };
  if (posted) {
    if (!visible.has(posted.id)) {
      const locked = { entry: null, seat: other.seat, status: "locked" as const, postedAt: posted.receivedAt.toISOString(), blurHash: posted.blurHash };
      // Today's picture, named but not served: the app can fetch it ahead with
      // a signed delivery Home adds, so it develops the moment yours is in.
      const viewer = playerFor(input.state, input.viewerId);
      const today = viewer && input.state.game.status === "live" ? dayIndexAt(viewer, input.now) : null;
      const key = posted.mediaKeys[0];
      return today === index && key ? { ...locked, preview: { kind: posted.kind, mediaUrl: gameMediaUrl(key) } } : locked;
    }
    // Its blur stays once it's open, for the app to show while the picture loads.
    return { entry: entryView(posted, input), seat: other.seat, status: "posted", postedAt: posted.receivedAt.toISOString(), ...(posted.blurHash ? { blurHash: posted.blurHash } : {}) };
  }
  return { entry: null, seat: other.seat, status: unpostedStatus(input, other, index) };
}

function unpostedStatus(input: GameViewInput, other: RulePlayer, index: number): GameDayOtherStatus {
  const { game } = input.state;
  if (index < eligibleFromDay(input.state, other) || other.leftAt) return "none";
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
function retakeAvailable(state: RuleState, viewerId: string, now: Date, entries: GameEntryIndex): boolean {
  const viewer = playerFor(state, viewerId);
  const today = viewer && state.game.status === "live" ? dayIndexAt(viewer, now) : null;
  if (today === null || today < 0 || today >= state.game.lengthDays) return false;
  return liveEntry(entries, viewerId, today) !== null
    && attemptsUsed(entries, viewerId, today) < GAME_POSTS_PER_DAY;
}
