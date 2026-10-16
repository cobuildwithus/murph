/**
 * The weekly game's wire contract: every command the app (and later Murph)
 * can send, and the views it gets back. One file so the server, its tests and
 * the iOS client agree on shapes. Additive changes only; bump
 * `GAME_SCHEMA_VERSION` for anything else.
 */

export const GAME_SCHEMA_VERSION = 1;

/** Monday = 0 … Sunday = 6, matching the app. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type GameSchedule = { days: Weekday[] } | { count: number };

export type GameStakeKind = "winner_gets" | "per_miss";

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

export type GameEntryKind = "photo" | "video" | "voice" | "text" | "workout" | "number" | "excuse";

export type GameCommand =
  | {
      type: "setProfile";
      firstName: string;
      timeZone: string;
      /** Your own photo (an uploaded media key); null clears it. */
      photoKey?: string | null;
    }
  | {
      type: "createGame";
      gameId: string;
      terms: GameTermsInput;
      /** The first name the challenger typed for the invitee. */
      inviteeFirstName: string;
      previousGameId?: string;
    }
  | { type: "join"; token: string; termsVersion: number; timeZone: string }
  | { type: "void"; gameId: string; reason: "declined" | "cancelled" }
  | {
      type: "post";
      gameId: string;
      entryId: string;
      kind: GameEntryKind;
      mediaKeys: string[];
      text?: string;
      data?: Record<string, unknown>;
      /** Milliseconds since capture, from a monotonic clock on the phone. */
      captureAgeMs?: number;
    }
  | { type: "deleteToday"; gameId: string }
  | { type: "redeem"; ticketId: string }
  | {
      type: "setLabel";
      /** A member id, or an invite token before they've joined. */
      subject: { memberId: string } | { inviteToken: string };
      name?: string | null;
      photoKey?: string | null;
      relationship?: string | null;
    };

export interface GameCommandRequest {
  schemaVersion: number;
  /** Client-generated, unique per user action; retries reuse it. */
  requestId: string;
  command: GameCommand;
}

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
  status: "open" | "redeemed" | "void";
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

export interface GameInvitePreview {
  /** Lets the invitee decline (`void` with reason "declined"). */
  gameId: string;
  inviterFirstName: string;
  inviteeFirstName: string;
  terms: GameTermsVersion;
  expiresAt: string;
  status: "open" | "used" | "expired";
}

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
