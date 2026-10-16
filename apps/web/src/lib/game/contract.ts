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

export const GAME_STAKE_KINDS = ["winner_gets", "per_miss"] as const;
export type GameStakeKind = (typeof GAME_STAKE_KINDS)[number];

export interface GameStake {
  kind: GameStakeKind;
  /** In the player's own words: "Breakfast in bed". */
  item: string;
  /**
   * Stable id the server assigns. Send it back on a rematch (with
   * `previousGameId`) to keep the same stake; omit it for a new one.
   */
  key?: string;
}

export interface GameTask {
  /** 0 = the player who started the game, 1 = the invitee. */
  seat: number;
  /** In the player's own words: "100 pushups". */
  text: string;
}

/** One version of what everyone agreed to, applying from `fromDay`. */
export interface GameTermsVersion {
  n: number;
  fromDay: number;
  tasks: GameTask[];
  schedule: GameSchedule;
  stakes: GameStake[];
}

/** What a new game starts with (version 1, from day 0). */
export interface GameTermsInput {
  tasks: GameTask[];
  schedule: GameSchedule;
  stakes: GameStake[];
  lengthDays?: number;
}

export const GAME_ENTRY_KINDS = ["photo", "video", "voice", "text", "workout", "number", "excuse"] as const;
export type GameEntryKind = (typeof GAME_ENTRY_KINDS)[number];

/** The words a challenger attaches to whoever they invite; only they ever see them. */
export interface GameInviteeLabel {
  /** An uploaded media key, e.g. their contact photo. */
  photoKey?: string | null;
  relationship?: string | null;
}

// Request bodies. Every write also sends an `Idempotency-Key` header
// (8-64 letters, digits, - or _), minted per user action and reused on retry.

/** PUT /me/profile */
export interface SetProfileBody {
  firstName: string;
  timeZone: string;
  /** Your own photo (an uploaded media key); null clears it. */
  photoKey?: string | null;
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
export interface AcceptInviteBody {
  /** The terms version the invitee saw. */
  termsVersion: number;
  timeZone: string;
}

/** POST /games/:id/entries */
export interface PostEntryBody {
  entryId: string;
  kind: GameEntryKind;
  mediaKeys: string[];
  text?: string;
  data?: Record<string, unknown>;
  /** Milliseconds since capture, from a monotonic clock on the phone. */
  captureAgeMs?: number;
}

/** PUT /people/:memberId/label. Omitted fields stay; null clears. */
export interface SetLabelBody {
  name?: string | null;
  photoKey?: string | null;
  relationship?: string | null;
}

// POST /invites/:token/decline, POST /games/:id/cancel,
// DELETE /games/:id/entries/:entryId and POST /tickets/:id/redeem have no body.

export type GameCommand =
  | ({ type: "setProfile" } & SetProfileBody)
  | ({ type: "createGame" } & CreateGameBody)
  | ({ type: "join"; token: string } & AcceptInviteBody)
  /** Declined by the invitee (who holds the link) or cancelled by the challenger, before anyone joins. */
  | { type: "void"; reason: "declined"; token: string }
  | { type: "void"; reason: "cancelled"; gameId: string }
  | ({ type: "post"; gameId: string } & PostEntryBody)
  /** Take back your own post for your current day (a retake follows, if one's left). */
  | { type: "withdraw"; gameId: string; entryId: string }
  | { type: "redeem"; ticketId: string }
  | ({ type: "setLabel"; memberId: string } & SetLabelBody);

export type GameStatus = "invited" | "live" | "settled" | "void";

export interface GamePlayerView {
  memberId: string | null;
  seat: number;
  /** The viewer's private label name if set, else the player's own first name. */
  firstName: string;
  avatarUrl: string | null;
  isMe: boolean;
  /** This player's current 0-based day, or null before Day 1 / after the end. */
  dayIndex: number | null;
  score: number;
}

export type GameDayOtherStatus = "posted" | "locked" | "missed" | "none" | "off";

export interface GameEntryView {
  entryId: string;
  kind: GameEntryKind;
  mediaUrls: string[];
  text: string | null;
  /** The structured part of a workout or number entry, as posted. */
  data?: Record<string, unknown> | null;
}

export interface GameDayView {
  index: number;
  /** The viewer's local date for this day (YYYY-MM-DD). */
  localDate: string;
  /** True when the schedule doesn't count this day for the viewer. */
  off: boolean;
  mine: GameEntryView | null;
  /** Per other player, in seat order. */
  others: { seat: number; status: GameDayOtherStatus; entry: GameEntryView | null }[];
}

export interface GameTicketView {
  id: string;
  what: string;
  status: "open" | "redeemed";
  owedByMemberId: string;
  owedToMemberId: string;
  /** True when the viewer holds it (is owed). */
  youHold: boolean;
  createdAt: string;
  redeemedAt: string | null;
}

export interface GameView {
  id: string;
  status: GameStatus;
  /** 1 for the first game between these people, then 2, 3… */
  round: number;
  termsVersion: number;
  terms: GameTermsVersion;
  lengthDays: number;
  startedAt: string | null;
  players: GamePlayerView[];
  days: GameDayView[];
  retakeAvailable: boolean;
  /** Present while invited, for the challenger: the token to build the link from. */
  inviteToken: string | null;
  inviteExpiresAt: string | null;
  result: { scores: { seat: number; score: number }[]; outcome: "won" | "lost" | "tie" | "perfect" } | null;
  tickets: GameTicketView[];
}

export interface GameHomeView {
  me: { memberId: string; firstName: string | null; avatarUrl: string | null; timeZone: string | null };
  games: GameView[];
  wallet: { held: GameTicketView[]; owed: GameTicketView[]; redeemed: GameTicketView[] };
}

/** What an invite link shows. Only an open invite carries its details. */
export type GameInvitePreview =
  | {
      status: "open";
      inviterFirstName: string;
      inviteeFirstName: string;
      terms: GameTermsVersion;
      expiresAt: string;
    }
  | { status: "used" | "expired" };

export type GameErrorCode =
  | "UNAUTHENTICATED"
  | "GAME_DISABLED"
  | "INVALID_REQUEST"
  | "GAME_NOT_FOUND"
  | "INVITE_NOT_FOUND"
  | "INVITE_USED"
  | "INVITE_EXPIRED"
  | "TERMS_CHANGED"
  | "ALREADY_IN_A_GAME"
  | "NOT_A_PLAYER"
  | "GAME_NOT_LIVE"
  | "DAY_CLOSED"
  | "RETAKE_USED"
  | "MEDIA_MISSING"
  | "TICKET_NOT_HELD"
  | "PROFILE_REQUIRED";

export interface GameError {
  code: GameErrorCode;
  message: string;
  retryable?: boolean;
}
