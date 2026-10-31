/**
 * The weekly game's wire contract: the request bodies of the /api/game/v1
 * routes, the commands they become (the one internal write path, which Murph's
 * tools will call too), and the views that come back. One file so the server,
 * its tests and the iOS client agree on shapes. The /v1 path versions the API:
 * change it additively, or add /v2.
 */

/** Monday = 0 … Sunday = 6, matching the app. */
export const GAME_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof GAME_WEEKDAYS)[number];

/**
 * Set weekdays, or a count: any N days across the whole game (not per week),
 * so a 14-day game with `{ count: 10 }` needs 10 days in total.
 */
export type GameSchedule = { days: Weekday[] } | { count: number };

export const GAME_STAKE_KINDS = ["winner_gets", "per_miss", "prize", "dare"] as const;
export type GameStakeKind = (typeof GAME_STAKE_KINDS)[number];

export interface GameStake {
  kind: GameStakeKind;
  /** In the player's own words: "Breakfast in bed". */
  item: string;
  /** Assigned by the server (ignored on create); a ticket names its stake by it. */
  key?: string;
}

export interface GameTask {
  /** 0 = the player who started the game, 1 = the invitee. */
  seat: number;
  /** In the player's own words: "100 pushups". */
  text: string;
}

export const GAME_CHECK_IN_KINDS = ["photo", "heart_rate", "any"] as const;
export type GameCheckInKind = (typeof GAME_CHECK_IN_KINDS)[number];

/** One version of what everyone agreed to, applying from `fromDay`. */
export interface GameTermsVersion {
  checkInKind?: GameCheckInKind;
  n: number;
  fromDay: number;
  tasks: GameTask[];
  schedule: GameSchedule;
  stakes: GameStake[];
}

/** What a new game starts with (version 1, from day 0). */
export interface GameTermsInput {
  /** New games use any; retained photo/heart_rate terms keep their requirement. */
  checkInKind?: GameCheckInKind;
  tasks: GameTask[];
  schedule: GameSchedule;
  stakes: GameStake[];
  lengthDays?: number;
  /**
   * The challenger's picked Day 1 (YYYY-MM-DD, a calendar date): from tomorrow
   * to 60 days out in their zone. Acceptance before 20:00 can start today;
   * this date wins when later.
   */
  startsOn?: string;
}

/**
 * A daily artifact, or an excuse for a missed day (on-device transcript only).
 * No audio, raw heart-rate samples, or route coordinates are stored.
 */
export const GAME_ENTRY_KINDS = ["photo", "heart_rate", "words", "route", "reps", "excuse"] as const;
export type GameEntryKind = (typeof GAME_ENTRY_KINDS)[number];

export interface GameHeartRateData {
  durationSec: number;
  avgBpm: number;
  lowBpm: number;
  peakBpm: number;
}
export interface GameRouteData {
  activity: "walk" | "run";
  distanceM: number;
  durationSec: number;
}
export interface GameRepsData {
  exercise: "pushups";
  count: number;
  countLow?: number;
  countHigh?: number;
  reps: { tMs: number; depth: number }[];
  fastestMs?: number;
  slowestMs?: number;
  heartRate?: GameHeartRateData;
}
export type GameEntryData = GameHeartRateData | GameRouteData | GameRepsData;

/** The words a challenger attaches to whoever they invite; only they ever see them. */
export interface GameInviteeLabel {
  /** An uploaded media key, e.g. their contact photo. */
  photoKey?: string | null;
  relationship?: string | null;
}

// Request bodies. Every write is idempotent through its own ids (gameId,
// entryId) or state (accepting twice, redeeming twice), so retries are safe.
//
// POST /media takes a photo's raw bytes (Content-Type image/jpeg or
// image/heic; 4 MiB max) and returns { mediaKey }. The key is derived from the
// bytes, so uploading the same file again returns the same key.

/** PUT /me/profile */
export interface SetProfileBody {
  firstName?: string;
  timeZone?: string;
  /** Omitted keeps the current photo; null removes it. Must be your own upload. */
  photoKey?: string | null;
}

export interface GameProfileView {
  memberId: string;
  firstName: string;
  timeZone: string;
  avatarUrl: string | null;
}

/** POST /games */
export interface CreateGameBody {
  gameId: string;
  terms: GameTermsInput;
  /** The first name the challenger typed for the invitee. */
  inviteeFirstName: string;
  inviteeLabel?: GameInviteeLabel;
  previousGameId?: string;
}

/** POST /invites/:token/accept */
export interface NegotiateInviteBody extends AcceptInviteBody {
  proposalId: string;
  change: GameChange;
}

export interface AcceptInviteBody {
  /** The terms version the invitee saw (`terms.n`). */
  termsVersion: number;
  timeZone: string;
}

/**
 * POST /games/:id/entries. A photo needs 1-4 `mediaKeys` (.jpg/.heic); a
 * heart_rate, route and reps need exactly one rendered JPEG and summary data.
 * Words need one trimmed line (1-140 characters), with no media or data. An
 * excuse needs `text` (1-500 characters) and no media, and applies to your most
 * recent missed scheduled day, never today.
 */
export interface PostEntryBody {
  entryId: string;
  kind: GameEntryKind;
  mediaKeys?: string[];
  text?: string;
  data?: GameEntryData;
  /** Optional device-rendered locked preview, at most 64 characters. */
  blurHash?: string;
  /** Milliseconds since capture, from a monotonic clock on the phone. */
  captureAgeMs?: number;
}

// DELETE /games/:id/entries/:entryId and POST /tickets/:id/redeem have no body.

/** Why a player reports the other player's content. */
export const GAME_REPORT_REASONS = ["sexual", "harassment", "hate", "violence", "self_harm", "money", "other"] as const;
export type GameReportReason = (typeof GAME_REPORT_REASONS)[number];

/** What a report is about: one post, their name and photo, or the task and stake they wrote. */
export const GAME_REPORT_ABOUT = ["post", "player", "terms"] as const;
export type GameReportAbout = (typeof GAME_REPORT_ABOUT)[number];

/**
 * POST /games/:id/reports, and POST /invites/:token/reports before accepting.
 * `entryId` reports one of the other player's posts you can see (`about`
 * defaults to "post"); without it, "player" (the default) or "terms". It works
 * after a game ends. The reported member is never told who reported them.
 * From then on a reported post is hidden from you (it still counts for
 * them), and so is a reported player's photo. `block` blocks them in the same
 * step. Retrying with the same `reportId` is safe.
 */
export interface ReportGameBody {
  reportId: string;
  reason: GameReportReason;
  about?: GameReportAbout;
  entryId?: string;
  /** Optional, at most 500 characters; only the team reads it. */
  note?: string;
  block?: boolean;
}

// PUT /blocks/:memberId blocks someone you play or played with, and PUT
// /invites/:token/block blocks whoever sent that invite. Every game the two
// have open or going is called off (no winner, no tickets), Murph stops
// texting their shared chat about it, and each sees the other as a player who
// left, so the blocked player isn't told. Invites and rematches between them
// fail with PLAYER_UNAVAILABLE. DELETE /blocks/:memberId unblocks; games that
// ended stay ended. No bodies.

/** Proposed in the app; the other player agrees in the game's shared chat. */
export type GameChange =
  | { kind: "start_now" }
  | { kind: "edit"; schedule?: GameSchedule; lengthDays?: number; startsOn?: string | null;
      tasks?: GameTask[]; stakes?: GameStake[]; stakesApplyToWholeGame?: true };

export interface ProposeGameChangeBody {
  proposalId: string;
  expectedTermsVersion: number;
  change: GameChange;
}

export interface GamePendingChange {
  id: string;
  proposedByMemberId: string;
  expectedTermsVersion: number;
  change: GameChange;
  /** Zero-based preview at read time; recomputed under the lock on acceptance. */
  effectiveFromDay: number;
  /** Conversational proposals use the ordinary assistant reply, not a second announcement. */
  origin?: "app" | "chat";
  deliveryStatus: "pending" | "queued" | "sent" | "failed" | "conversation";
  /** False for a terminal receipt: cancel the proposal before proposing again. */
  deliveryRetryable?: boolean;
  /** Fixed start date agreed to, including a start-now proposal. */
  startsOn: string | null;
}

export interface GameChangeControls {
  canStartNow: boolean;
  canEdit: boolean;
  canEditSchedule: boolean;
  canEditStartDate: boolean;
  canEditTasks?: boolean;
  canEditStakes?: boolean;
  editableFromDay: number | null;
}

/** Receipt for a speaker-owned day correction in the bound game chat. */
export type GameDayOutcome = { date: string; status: "marked_incomplete" | "restored" | "already_incomplete" | "already_complete" | "no_artifact" };

export type GameCommand =
  | { type: "setDayCompletion"; gameId: string; date: string; incomplete: boolean }
  /** DELETE /games/:id cancels an unstarted invite. */
  | { type: "cancelInvite"; gameId: string }
  | ({ type: "proposeChange"; gameId: string } & ProposeGameChangeBody)
  | { type: "respondChange"; gameId: string; proposalId: string; decision: "approve" | "decline" | "cancel" }
  | ({ type: "setProfile" } & SetProfileBody)
  | ({ type: "createGame" } & CreateGameBody)
  | ({ type: "join"; token: string } & AcceptInviteBody)
  | ({ type: "negotiate"; token: string } & NegotiateInviteBody)
  | ({ type: "post"; gameId: string; mediaKeys: string[] } & PostEntryBody)
  /** Take back your own post for your current day (a retake follows, if one's left). */
  | { type: "withdraw"; gameId: string; entryId: string }
  | { type: "redeem"; ticketId: string }
  /** By game (a player) or by invite token (before accepting). */
  | ({ type: "report"; gameId?: string; token?: string } & ReportGameBody & { about: GameReportAbout })
  | { type: "block"; memberId?: string; token?: string }
  | { type: "unblock"; memberId: string };

export type GameStatus = "invited" | "negotiating" | "live" | "settled" | "void";

export interface GamePlayerView {
  memberId: string | null;
  seat: number;
  /** The viewer's private label name if set, else the player's own first name. */
  firstName: string;
  /** The viewer's private photo override, else this person's chosen profile photo. */
  avatarUrl: string | null;
  /** Only the person's own chosen photo. Use this for explicitly shared exports. */
  profileAvatarUrl: string | null;
  /**
   * The relationship the viewer typed when they invited this person ("my
   * partner"); only they see it. Null for yourself and anyone you haven't
   * labelled.
   */
  relationship: string | null;
  isMe: boolean;
  /** This player's current 0-based day, or null before Day 1 / after the end. */
  dayIndex: number | null;
  score: number;
  /** Consecutive scheduled days posted; an unposted today does not break it. */
  streak?: number;
  /**
   * This player deleted their account and left the game: `memberId` is null,
   * `firstName` is the name the viewer knew them by, and they have no photo or
   * days. A `void` game with a player who left was called off. A player
   * blocked either way looks exactly the same.
   */
  left?: true;
}

export type GameDayOtherStatus = "posted" | "locked" | "missed" | "none" | "off";

export interface GameEntryView {
  /** Self-reported incomplete day; omitted after restore. Does not hide the artifact. */
  incomplete?: true;
  entryId: string;
  kind: GameEntryKind;
  mediaUrls: string[];
  text: string | null;
  data?: GameEntryData | null;
  /**
   * The first media URL's five-minute signed delivery URL. A post's answer
   * with `?delivery=signed` uses the photo rendition for unlocked pictures.
   * History uses the avatar rendition for each person's latest game previews.
   * Missing means request mediaUrls[0] as usual; mediaUrls remains cache identity.
   */
  delivery?: { url: string; expiresAt: string };
}

export interface GameDayView {
  index: number;
  /** The viewer's local date for this day (YYYY-MM-DD). */
  localDate: string;
  /** True when the schedule doesn't count this day for the viewer. */
  off: boolean;
  mine: GameEntryView | null;
  /** Per other player, in seat order. */
  others: { seat: number; status: GameDayOtherStatus; entry: GameEntryView | null;
    /** `postedAt` only while it's still locked to this viewer; `blurHash` while it's locked and after, for while it loads. */
    postedAt?: string; blurHash?: string | null;
    /** The viewer reported this post: it's posted and counts, but never shown to them. */
    hidden?: true }[];
}

export interface GameTicketView {
  id: string;
  kind?: GameStakeKind;
  what: string;
  /** "expired" once it's past `useBy` unredeemed; expired tickets stay in the wallet. */
  status: "open" | "redeemed" | "expired";
  /** Redeem by this time: 14 days after the ticket was issued. */
  useBy: string;
  owedByMemberId: string;
  owedToMemberId: string;
  /** True when the viewer holds it (is owed). */
  youHold: boolean;
  /**
   * The other member deleted their account (or one of you blocked the other):
   * their member id is "" and the ticket stays as history; it can't be marked done.
   */
  left?: true;
  createdAt: string;
  redeemedAt: string | null;
}

export interface GameView {
  changeControls: GameChangeControls;
  pendingChange: GamePendingChange | null;
  id: string;
  status: GameStatus;
  /** 1 for the first game between these people, then 2, 3… */
  round: number;
  terms: GameTermsVersion;
  /** The picked Day 1, if the challenger chose one. */
  startsOn: string | null;
  lengthDays: number;
  startedAt: string | null;
  players: GamePlayerView[];
  days: GameDayView[];
  retakeAvailable: boolean;
  /**
   * Results soon: set while the game is live but the viewer's own last day is
   * over (their part is done; the other player may still be on theirs). The
   * expected settle time, ISO 8601: when the last player's last day ends, plus
   * an hour only while a late post can still count. Null otherwise. Clients
   * that predate it ignore it.
   */
  settlesAt: string | null;
  /**
   * The game's own invite token, for the people it belongs to: while invited,
   * the challenger (to build the link) and a rematch's addressed invitee (to
   * accept with POST /invites/:token/accept); once it's live or over, both
   * players, so the app can recognize its own link. A used token can't be
   * accepted again. Everyone else gets null.
   */
  /**
   * Also accepts current terms for the claimed seat-1 viewer when status is
   * negotiating and pendingChange is null, within the original invite expiry.
   */
  inviteToken: string | null;
  inviteExpiresAt: string | null;
  result: { scores: { seat: number; score: number }[]; outcome: "won" | "lost" | "tie" | "perfect" } | null;
  recap: { pages: Array<{ background: "night" | "paper" | "sage" | "sienna" | "slate"; blocks: Array<Record<string, unknown>> }>; scoreLine: string; chatLine: string } | null;
  tickets: GameTicketView[];
}

export interface GameHomeView {
  me: { memberId: string; firstName: string | null; timeZone: string | null; avatarUrl: string | null; usualKind?: GameEntryKind | null };
  /** Invite-only: whether this member may start a fresh game. Anyone may rematch. Older apps ignore it. */
  canStartGames: boolean;
  /**
   * Games and tickets with people you blocked are left out. Everyone you
   * blocked, newest first, by your name for them, to unblock in Settings.
   */
  blocked?: GameBlockedPerson[];
  games: GameView[];
  wallet: { held: GameTicketView[]; owed: GameTicketView[]; redeemed: GameTicketView[] };
}

export interface GameHistoryView {
  people: GameHistoryPersonView[];
}

export interface GameHistoryPersonView {
  memberId: string;
  firstName: string;
  avatarUrl?: string;
  record: { won: number; lost: number; tied: number };
  games: GameHistoryGameView[];
}

export interface GameHistoryGameView {
  id: string;
  /** The viewer's local dates, matching the dates in `GameView.days`. */
  startedOn: string;
  endsOn: string;
  lengthDays: number;
  schedule: GameTermsVersion["schedule"];
  score: { mine: number; theirs: number };
  result: "won" | "lost" | "tied";
  perfect: boolean;
  previews: GameHistoryPreviewView[];
}

export interface GameHistoryPreviewView extends GameEntryView {
  mine: boolean;
}

export interface GameBlockedPerson {
  memberId: string;
  firstName: string;
}

/** What an invite link shows. Only an open invite carries terms; cancellation may name the inviter. */
export type GameInvitePreview =
  | {
      status: "open";
      supportsNegotiation?: boolean;
      lengthDays?: number;
      inviterFirstName: string;
      /**
       * Never sent. The name a challenger types for the invitee is their own
       * private label, and this preview is served to anyone holding the link
       * without sign-in. Kept optional so older clients that decode it still
       * parse; they fall back to the member's own first name.
       */
      inviteeFirstName?: never;
      terms: GameTermsVersion;
      /** The picked Day 1, if the challenger chose one. */
      startsOn: string | null;
      expiresAt: string;
    }
  | { status: "used" }
  | { status: "expired"; reason?: "cancelled"; inviterFirstName?: string };

export type GameErrorCode =
  | "UNAUTHENTICATED"
  | "GAME_DISABLED"
  | "INVALID_REQUEST"
  | "GAME_NOT_FOUND"
  | "INVITE_NOT_FOUND"
  | "INVITE_USED"
  | "INVITE_EXPIRED"
  | "TERMS_CHANGED"
  /** These same people already have a live game (or an open rematch) together. */
  | "ALREADY_IN_A_GAME"
  /** A rematch named an older game when the same people have a newer one. */
  | "REMATCH_OUTDATED"
  | "NOT_A_PLAYER"
  | "GAME_NOT_LIVE"
  | "DAY_CLOSED"
  | "RETAKE_USED"
  | "MEDIA_MISSING"
  | "TICKET_NOT_HELD"
  | "TICKET_EXPIRED"
  | "PROFILE_REQUIRED"
  | "CHANGE_PENDING"
  | "CHANGE_EXPIRED"
  | "CHAT_UNAVAILABLE"
  /** One of you blocked the other: no invite or rematch between you. */
  | "PLAYER_UNAVAILABLE"
  /** The write-time content check refused these words. */
  | "CONTENT_NOT_ALLOWED"
  /**
   * Murph's own Terms (the `launch.legal` consent), not a game's: this write
   * waits until the member agrees to their current versions. `details` names
   * the scope and its documents with those versions.
   */
  | "TERMS_REQUIRED";

export interface GameError {
  code: GameErrorCode;
  message: string;
  retryable?: boolean;
}
