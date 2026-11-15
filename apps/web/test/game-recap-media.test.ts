import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { inspectRecapMedia } from "@/src/lib/game/recap-media";
import { inspectMp3Frames } from "@murphai/operator-config/generated-audio";
import { recapAssetSchema } from "@murphai/contracts/recap-show";

const scoreBytes = async (durationMs: number) => {
  const bytes = await readFile(new URL('../../../fixtures/generated-audio/recap-synthetic-20s.mp3', import.meta.url));
  const stream = inspectMp3Frames(bytes);
  const frames = stream.frames.slice(1).map((frame, i) => bytes.subarray(frame.byteOffset, stream.frames[i + 2]?.byteOffset ?? stream.endOffset));
  return Buffer.concat(Array.from({ length: Math.round(durationMs / stream.frames[1]!.timeMs) }, (_, i) => frames[i % frames.length]!));
};

it.each([1, 4, 9])('validates a score with %s pages using decoded duration and real frame boundaries', async pages => {
  const audio = await scoreBytes(pages * 5000 + 20_000), first = pages * 5000;
  const songStartMs = [...inspectMp3Frames(audio).frames].reverse().find(f => f.timeMs <= first - 200)!.timeMs;
  const wordsTimestamps = [{ word: 'Hello', startMs: first, endMs: first + 300 }];
  const key = `recap/${'a'.repeat(32)}/song.mp3`;
  const result = await inspectRecapMedia(audio, key, undefined, { songStartMs, wordsTimestamps });
  expect(result).toMatchObject({ mediaType: 'audio/mpeg', songStartMs, bytes: audio.length });
  expect(Math.abs(result.durationMs! - (pages * 5000 + 20_000))).toBeLessThan(500);
  // A singer five seconds late: the song starts by the planned start, seconds before its first word.
  const planned = [...inspectMp3Frames(audio).frames].reverse().find(f => f.timeMs <= first)!.timeMs;
  expect(await inspectRecapMedia(audio, key, undefined, { songStartMs: planned,
    wordsTimestamps: [{ word: 'Hello', startMs: first + 5000, endMs: first + 5300 }] })).toMatchObject({ mediaType: 'audio/mpeg', songStartMs: planned });
  await expect(inspectRecapMedia(audio, key, undefined, { songStartMs: songStartMs + 1, wordsTimestamps })).rejects.toThrow();
  const afterFirstWord = inspectMp3Frames(audio).frames.find(frame => frame.timeMs > first)!.timeMs;
  await expect(inspectRecapMedia(audio, key, undefined, { songStartMs: afterFirstWord, wordsTimestamps })).rejects.toThrow();
  await expect(inspectRecapMedia(audio, key, undefined, { songStartMs,
    wordsTimestamps: [{ word: 'Hello', startMs: result.durationMs!, endMs: result.durationMs! + 300 }] })).rejects.toThrow();
  await expect(inspectRecapMedia(audio, key, undefined, { songStartMs, wordsTimestamps: [{ word: 'direction', startMs: 0, endMs: 0 }] })).rejects.toThrow();
  await expect(inspectRecapMedia(audio, key, 20_000)).rejects.toThrow('duration');
});

it('keeps a legacy receipt free of score fields and rejects score metadata on other shapes', async () => {
  const audio = await scoreBytes(20_000), key = `recap/${'a'.repeat(32)}/song.mp3`;
  const result = await inspectRecapMedia(audio, key, 20_000);
  expect(result).not.toHaveProperty('songStartMs');
  const asset = { slot: 'song', kind: 'song', recipeId: 'synthetic', storageKey: key, references: [], hash: result.hash,
    mediaType: result.mediaType, byteLength: result.bytes, durationMs: result.durationMs };
  expect(recapAssetSchema.parse(asset)).toEqual(asset);
  for (const duration of [20_000, 23_000, 70_000]) {
    await expect(inspectRecapMedia(await scoreBytes(duration), key, undefined,
      { songStartMs: 0, wordsTimestamps: [{ word: 'Hello', startMs: 5000, endMs: 5300 }] })).rejects.toThrow();
  }
  await expect(inspectRecapMedia(new Uint8Array(2 * 1024 * 1024 + 1), key, 20_000)).rejects.toThrow('size');
});

it("rejects header-only MP3s and caller-supplied duration that disagrees with decoded samples", async () => {
  const key = `recap/${"a".repeat(32)}/song.mp3`;
  await expect(inspectRecapMedia(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), key, 20_000)).rejects.toThrow();
  const short = await readFile(new URL("../../../fixtures/generated-audio/speech.mp3", import.meta.url));
  await expect(inspectRecapMedia(short, key, 20_000)).rejects.toThrow("duration");
});

it("explicitly rejects an empty caller asset", async () => {
  const key = `recap/${"a".repeat(32)}/song.mp3`;
  await expect(inspectRecapMedia(new Uint8Array(), key, 20_000)).rejects.toBeInstanceOf(RequestInputError);
});
