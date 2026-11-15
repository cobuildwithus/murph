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
  song?: { title: string; lyrics: string[]; lines?: { words: RecapVideoSongWord[] }[] };
}

export interface RecapVideoPlayer {
  name: string;
  /** A profile photo. Without one, the player's initial is drawn. */
  avatarPath?: string;
}

/** Who won, in the third person: both players receive the same file. */
export type RecapVideoOutcome =
  | { kind: "won"; winnerId: string; loserId: string }
  | { kind: "even" };

export type RecapVideoStake =
  | { kind: "prize"; title: string; iconPath?: string }
  | { kind: "punishment"; title: string }
  | { kind: "bothWin"; title: string; iconPath?: string }
  | { kind: "none" };

/**
 * The music and where the pages turn on it. A score runs under the whole
 * video; a lone song starts when its page does and the story plays silent.
 */
export interface RecapVideoSoundtrack {
  path: string;
  /** The audio file's own length. */
  durationMs: number;
  /** When the file starts in the video. A score starts at zero. */
  startsAtMs: number;
  /** When the song page starts in the video. */
  songStartMs: number;
  /** The sung song's length, for its scrubber. */
  songMs: number;
  /** When each story page starts. Without cues every page gets five seconds. */
  cuesMs?: number[];
}

export interface RecapVideoInput {
  show: { treatment: string; pages: RecapVideoPage[] };
  /** By member id, in the order the cover names them. */
  players: Record<string, RecapVideoPlayer>;
  scores: Record<string, number>;
  outcome: RecapVideoOutcome;
  stake: RecapVideoStake;
  /** Generated pictures by page id. */
  scenes: Record<string, string>;
  /** Real photos by entry id. */
  photos: Record<string, string>;
  soundtrack: RecapVideoSoundtrack;
}

export type RecapVideoRefusalCode =
  | "unsupported_page"
  | "unsupported_block"
  | "unsupported_stake"
  | "unsupported_outcome"
  | "unsupported_text"
  | "does_not_fit"
  | "missing_picture"
  | "missing_song"
  | "invalid_soundtrack"
  | "too_large"
  | "encoder_failed";

/** A recap this renderer will not draw. The recap goes out without a video. */
export class RecapVideoRefusal extends Error {
  readonly code: RecapVideoRefusalCode;

  constructor(code: RecapVideoRefusalCode, message: string) {
    super(message);
    this.name = "RecapVideoRefusal";
    this.code = code;
  }
}
