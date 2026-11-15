import { RecapVideoRefusal, type RecapVideoInput, type RecapVideoPage } from "./types.js";

export const RECAP_VIDEO_FPS = 30;
/** A story page's length when the music brings no cues. */
export const STORY_PAGE_MS = 5000;
/** The breath between the last sung word and the last screen. */
const AFTER_LAST_WORD_MS = 350;
/** The picture outlasts the music by a second. */
const AFTER_MUSIC_MS = 1000;
/** The last screen staggers for three seconds; it holds at least five. */
const POSTER_MIN_MS = 5000;

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
  if (song.lines && song.lines.length === song.lyrics.length && song.lines.every(line => line.words.length > 0)) {
    return song.lines.map(line => line.words.map(word => word.startMs));
  }
  // An untimed song lights whole lines, each on its even share of the song.
  const share = songMs / Math.max(song.lyrics.length, 1);
  return song.lyrics.map((line, index) => line.split(/\s+/u).filter(Boolean).map(() => share * index));
}

function lastSungMs(song: NonNullable<RecapVideoPage["song"]>, songMs: number): number {
  const ends = song.lines?.flatMap(line => line.words.map(word => word.endMs)) ?? [];
  return ends.length > 0 ? Math.max(...ends) : songMs;
}

/**
 * Story pages on the music's cues, the song until its last word, then the
 * last screen through the end of the music.
 */
export function buildRecapVideoTimeline(input: RecapVideoInput): RecapVideoTimeline {
  const { pages } = input.show;
  const { soundtrack } = input;
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

  const cues = soundtrack.cuesMs ?? story.map((_, index) => index * STORY_PAGE_MS);
  const starts = [...cues.slice(0, story.length), soundtrack.songStartMs];
  const ordered = starts.every((start, index) => Number.isFinite(start) && start >= 0 && (index === 0 ? start === 0 : start > (starts[index - 1] ?? 0)));
  const musicEnd = soundtrack.startsAtMs + soundtrack.durationMs;
  if (cues.length < story.length || !ordered || soundtrack.songMs <= 0 || soundtrack.startsAtMs < 0
    || soundtrack.startsAtMs > soundtrack.songStartMs || musicEnd < soundtrack.songStartMs + soundtrack.songMs - 500) {
    throw new RecapVideoRefusal("invalid_soundtrack", "The music's cues do not fit the recap's pages.");
  }

  const posterFrom = soundtrack.songStartMs + Math.min(lastSungMs(songPage.song, soundtrack.songMs), soundtrack.songMs) + AFTER_LAST_WORD_MS;
  const durationMs = Math.max(musicEnd + AFTER_MUSIC_MS, posterFrom + POSTER_MIN_MS);
  const marks: Omit<RecapVideoEntry, "toMs">[] = [
    ...story.map((page, index) => ({ kind: page.kind as RecapVideoEntryKind, page, fromMs: starts[index] ?? 0 })),
    { kind: "song", page: songPage, fromMs: soundtrack.songStartMs },
    { kind: "poster", page: pages.find(page => page.kind === "result") ?? { id: "result", kind: "result", background: "night", blocks: [] }, fromMs: posterFrom },
  ];
  const entries = marks.map((mark, index) => ({ ...mark, toMs: marks[index + 1]?.fromMs ?? durationMs }));
  return { entries, durationMs, frameCount: Math.floor(durationMs / 1000 * RECAP_VIDEO_FPS) };
}

export function entryIndexAt(timeline: RecapVideoTimeline, ms: number): number {
  let index = 0;
  for (let at = 0; at < timeline.entries.length; at++) {
    if (ms >= (timeline.entries[at]?.fromMs ?? Infinity)) index = at;
  }
  return index;
}
