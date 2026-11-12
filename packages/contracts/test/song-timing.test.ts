import { expect, it } from "vitest";
import { alignSongLyrics, songWordTimestampsSchema } from "../src/song-timing.ts";

it("keeps lyric words and punctuation while skipping extras and aligning repeated words in order", () => {
  const result = alignSongLyrics(["Leo,  go go!", "Ava stays."], [
    { word: "Oh", startMs: 0, endMs: 100 }, { word: "LEO", startMs: 100.2, endMs: 299.8 },
    { word: "go", startMs: 400, endMs: 600 }, { word: "yeah", startMs: 650, endMs: 700 },
    { word: "go", startMs: 800, endMs: 900 }, { word: "ava", startMs: 1000, endMs: 1300 },
    { word: "stays", startMs: 1400, endMs: 1700 },
  ], 2000);
  expect(result).toEqual([
    { words: [{ text: "Leo,", startMs: 100, endMs: 300 }, { text: "go", startMs: 400, endMs: 600 }, { text: "go!", startMs: 800, endMs: 900 }] },
    { words: [{ text: "Ava", startMs: 1000, endMs: 1300 }, { text: "stays.", startMs: 1400, endMs: 1700 }] },
  ]);
});

it("uses global ordered matches when a greedy match would consume the wrong repeated word", () => {
  const lines = alignSongLyrics(["Leo Ava Leo"], [
    { word: "Ava", startMs: 100, endMs: 200 }, { word: "Leo", startMs: 300, endMs: 400 },
  ], 500);
  expect(lines?.[0]?.words).toEqual([
    { text: "Leo", startMs: 0, endMs: 100 }, { text: "Ava", startMs: 100, endMs: 200 }, { text: "Leo", startMs: 300, endMs: 400 },
  ]);
});

it("interpolates leading, middle and trailing missing words across lyric lines", () => {
  expect(alignSongLyrics(["Now Leo", "and Ava go home"], [
    { word: "Leo", startMs: 200, endMs: 400 }, { word: "Ava", startMs: 800, endMs: 1000 },
  ], 1400)).toEqual([
    { words: [{ text: "Now", startMs: 0, endMs: 200 }, { text: "Leo", startMs: 200, endMs: 400 }] },
    { words: [{ text: "and", startMs: 400, endMs: 800 }, { text: "Ava", startMs: 800, endMs: 1000 },
      { text: "go", startMs: 1000, endMs: 1200 }, { text: "home", startMs: 1200, endMs: 1400 }] },
  ]);
});

it("normalizes Unicode punctuation and clamps overlapping and out-of-order timestamps to the audio", () => {
  const lyrics = ["  LÉO’s\t— café! ", "Ava…"];
  const result = alignSongLyrics(lyrics, [
    { word: "LÉO'S", startMs: 400.4, endMs: 600.8 }, { word: "café", startMs: 450, endMs: 700 },
    { word: "ava", startMs: 500, endMs: 1100 },
  ], 900)!;
  expect(result.map(line => line.words.map(word => word.text).join(" "))).toEqual(["LÉO’s — café!", "Ava…"]);
  const boundaries = result.flatMap(line => line.words.flatMap(word => [word.startMs, word.endMs]));
  expect(boundaries).toEqual([...boundaries].sort((a, b) => a - b));
  expect(boundaries.every(value => Number.isInteger(value) && value >= 0 && value <= 900)).toBe(true);
});

it("omits timings without a usable matching anchor and bounds alignment work", () => {
  expect(alignSongLyrics(["Leo"], [], 1000)).toBeUndefined();
  expect(alignSongLyrics(["Leo"], [{ word: "Ava", startMs: 0, endMs: 200 }], 1000)).toBeUndefined();
  expect(alignSongLyrics(["Leo ".repeat(5001)], [{ word: "Leo", startMs: 0, endMs: 200 }], 1000)).toBeUndefined();
  expect(alignSongLyrics(["Leo"], [{ word: "Leo", startMs: 0, endMs: 200 }], Number.NaN)).toBeUndefined();
  for (const value of [[], [{ word: "Leo", startMs: -1, endMs: 100 }], [{ word: "Leo", startMs: 200, endMs: 100 }],
    [{ word: "Leo", startMs: 0, endMs: Infinity }], Array.from({ length: 2001 }, () => ({ word: "Leo", startMs: 0, endMs: 100 }))]) {
    expect(songWordTimestampsSchema.safeParse(value).success).toBe(false);
  }
});
