import { requireShape } from "./shape.js";
import { RecapVideoRefusal, type RecapVideoInput, type RecapVideoPage } from "./types.js";

export const RECAP_VIDEO_FPS = 30;
/** The breath between the last sung word and the last screen. */
const AFTER_LAST_WORD_MS = 350;
/** The picture outlasts the music by a second. */
const AFTER_MUSIC_MS = 1000;
/** The last screen staggers for three seconds; it holds at least five. */
const POSTER_MIN_MS = 5000;
/** The first frame at or after a time, and that frame's own time. */
const frameAt = (ms: number): number => Math.ceil(ms * RECAP_VIDEO_FPS / 1000 - 1e-6);
const frameMs = (frame: number): number => frame * 1000 / RECAP_VIDEO_FPS;

export type RecapVideoEntryKind = "cover" | "scene" | "print" | "text" | "superlative" | "song" | "poster";

export interface RecapVideoEntry {
  kind: RecapVideoEntryKind;
  page: RecapVideoPage;
  fromMs: number;
  toMs: number;
}

export interface RecapVideoTimeline {
  entries: RecapVideoEntry[];
  durationMs: number;
  frameCount: number;
}

const STORY_KINDS = new Set(["cover", "scene", "print", "text", "superlative"]);

/** When each lyric word starts, in milliseconds into the song, one list per line. */
export function lyricWordStarts(song: NonNullable<RecapVideoPage["song"]>, songMs: number): number[][] {
  if (song.lines) return song.lines.map(line => line.words.map(word => word.startMs));
  // An untimed song lights whole lines, each on its even share of the song.
  const share = songMs / Math.max(song.lyrics.length, 1);
  return song.lyrics.map((line, index) => line.split(/\s+/u).filter(Boolean).map(() => share * index));
}

function lastSungMs(song: NonNullable<RecapVideoPage["song"]>, songMs: number): number {
  const ends = song.lines?.flatMap(line => line.words.map(word => word.endMs)) ?? [];
  return ends.reduce((last, end) => Math.max(last, end), ends.length > 0 ? 0 : songMs);
}

/** Where the song's own clock reads zero in the score: its lyrics and scrubber count from here. */
export const songOriginMs = (input: RecapVideoInput): number => input.score.durationMs - input.score.songMs;

/** When each story page and then the song page starts, read from the pages' cues as the app reads them. */
function cueStarts(input: RecapVideoInput, story: RecapVideoPage[], songPage: RecapVideoPage): number[] {
  const { durationMs, songMs } = input.score;
  const starts = [...story, songPage].map(page => page.cueMs ?? Number.NaN);
  const ordered = starts.every((start, index) => Number.isFinite(start) && (index === 0 ? start === 0 : start > (starts[index - 1] ?? 0)));
  const sized = Number.isFinite(durationMs) && Number.isFinite(songMs) && songMs > 0 && durationMs >= songMs;
  // The song page opens inside the song: no earlier than the song's own clock starts, and before the music ends.
  if (!ordered || !sized || (starts.at(-1) ?? 0) < durationMs - songMs || (starts.at(-1) ?? 0) >= durationMs) {
    throw new RecapVideoRefusal("invalid_soundtrack", "The show has no score whose cues fit its pages.");
  }
  return starts;
}

/**
 * Story pages on the score's cues, the song from its cue to its last sung
 * word, then the last screen through the end of the music.
 */
export function buildRecapVideoTimeline(input: RecapVideoInput): RecapVideoTimeline {
  const { pages } = input.show;
  requireShape(input);
  for (const page of pages) {
    if (!STORY_KINDS.has(page.kind) && page.kind !== "song" && page.kind !== "result") {
      throw new RecapVideoRefusal("unsupported_page", `No drawing for a ${page.kind} page.`);
    }
  }
  const story = pages.filter(page => STORY_KINDS.has(page.kind));
  const songPage = pages.find(page => page.kind === "song");
  if (story.length === 0 || story[0]?.kind !== "cover") {
    throw new RecapVideoRefusal("unsupported_page", "A recap video opens on its cover.");
  }
  if (!songPage?.song) throw new RecapVideoRefusal("missing_song", "A recap video needs its song.");
  const starts = cueStarts(input, story, songPage), songFrom = starts.at(-1) ?? 0;

  // The last screen starts on a frame and the video ends on one, so its hold is never a frame short.
  const lastWord = songOriginMs(input) + Math.min(lastSungMs(songPage.song, input.score.songMs), input.score.songMs);
  const posterFrame = frameAt(Math.max(lastWord, songFrom) + AFTER_LAST_WORD_MS);
  const frameCount = Math.max(Math.floor((input.score.durationMs + AFTER_MUSIC_MS) * RECAP_VIDEO_FPS / 1000), posterFrame + frameAt(POSTER_MIN_MS));
  const posterFrom = frameMs(posterFrame), durationMs = frameMs(frameCount);
  const marks: Omit<RecapVideoEntry, "toMs">[] = [
    ...story.map((page, index) => ({ kind: page.kind as RecapVideoEntryKind, page, fromMs: starts[index] ?? 0 })),
    { kind: "song", page: songPage, fromMs: songFrom },
    { kind: "poster", page: pages.find(page => page.kind === "result") ?? { id: "result", kind: "result", background: "night", blocks: [] }, fromMs: posterFrom },
  ];
  const entries = marks.map((mark, index) => ({ ...mark, toMs: marks[index + 1]?.fromMs ?? durationMs }));
  return { entries, durationMs, frameCount };
}

export function entryIndexAt(timeline: RecapVideoTimeline, ms: number): number {
  let index = 0;
  for (let at = 0; at < timeline.entries.length; at++) {
    if (ms >= (timeline.entries[at]?.fromMs ?? Infinity)) index = at;
  }
  return index;
}
