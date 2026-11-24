/** The recap show's pages, as the app's payload carries them. */
export type RecapVideoBackground = "night" | "paper" | "sage" | "sienna" | "slate";

export interface RecapVideoBlock {
  kind: string;
  text?: string;
  quote?: { who: string; text: string; date?: string };
  statValue?: string;
  entryIds?: string[];
}

export interface RecapVideoSongWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface RecapVideoPage {
  id: string;
  kind: string;
  background: RecapVideoBackground;
  blocks: RecapVideoBlock[];
  /** Where the generated picture sits among `blocks`. */
  imageIndex?: number;
  fallback?: { kind: "photo" | "text"; entryIds: string[] };
  card?: { memberId: string; title: string; line: string };
  /** When this page's music starts in the score. Every page but the result has one. */
  cueMs?: number;
  song?: { title: string; lyrics: string[]; lines?: { words: RecapVideoSongWord[] }[] };
}

export interface RecapVideoPlayer {
  name: string;
  /** A profile photo. Without one, the player's initial is drawn. */
  avatarPath?: string;
}

/** Who won. `everyDay`: an even game in which neither player missed a day. */
export type RecapVideoOutcome =
  | { kind: "won"; winnerId: string; loserId: string }
  | { kind: "even"; everyDay: boolean };

/**
 * What the game was played for, as its last screen shows it: the loser owes
 * the winner a prize or does a punishment; an even game where both did every
 * day can earn both a prize; any other even game owes nothing. A prize's
 * ticket carries the app's drawing for it, chosen from its title.
 */
export type RecapVideoStake =
  | { kind: "prize"; title: string }
  | { kind: "punishment"; title: string }
  | { kind: "bothWin"; title: string }
  | { kind: "none" };

/**
 * The show's score: one piece of music, the band under every story page and
 * then the song. Pages turn on their `cueMs`. The song page's cue is the
 * planned start of the singing, so a singer who comes in late lengthens the
 * song's own opening, not the page before it; a score stored before songs
 * started by then has its first sung word as the cue.
 * A recap with only a song, from before shows had scores, gets no video.
 */
export interface RecapVideoScore {
  path: string;
  /** The whole piece's length. */
  durationMs: number;
  /** The song's own length. Its lyrics and its scrubber count from `durationMs - songMs`, at or before the song page's cue. */
  songMs: number;
}

export interface RecapVideoInput {
  show: { treatment: string; pages: RecapVideoPage[] };
  /** The game's two players, by member id. */
  players: Record<string, RecapVideoPlayer>;
  scores: Record<string, number>;
  outcome: RecapVideoOutcome;
  stake: RecapVideoStake;
  /** Generated pictures by page id. */
  scenes: Record<string, string>;
  /** Real photos by entry id. Null: the post is in the game but its photo is gone, and its place is a "missed" print. */
  photos: Record<string, string | null>;
  /** Entries whose player gave the day back: their prints carry the app's "Didn't finish" tag. */
  unfinished?: string[];
  score: RecapVideoScore;
}

export type RecapVideoRefusalCode =
  | "unsupported_page"
  | "unsupported_block"
  | "unsupported_stake"
  | "unsupported_outcome"
  | "unsupported_text"
  | "missing_picture"
  | "unsupported_picture"
  | "missing_song"
  | "invalid_soundtrack"
  | "too_large"
  | "encoder_failed";

/**
 * A recap this renderer will not draw. The recap goes out without a video.
 * Words that are too long for their place are never one: they are cut short
 * with an ellipsis, as the app cuts them.
 */
export class RecapVideoRefusal extends Error {
  readonly code: RecapVideoRefusalCode;

  constructor(code: RecapVideoRefusalCode, message: string) {
    super(message);
    this.name = "RecapVideoRefusal";
    this.code = code;
  }
}
