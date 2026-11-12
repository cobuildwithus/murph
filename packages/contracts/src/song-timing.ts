import * as z from "./zod-runtime.ts";

export const songWordTimestampsSchema = z.array(z.object({
  word: z.string().trim().min(1).max(200),
  startMs: z.number().min(0).max(300_000),
  endMs: z.number().min(0).max(300_000),
}).strict().refine(word => word.endMs >= word.startMs, "Word end must follow its start.")).min(1).max(2000);
export type SongWordTimestamp = z.infer<typeof songWordTimestampsSchema>[number];
export const songLinesSchema = z.array(z.object({ words: z.array(z.object({
  text: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(),
}).strict()) }).strict());
export type SongLine = z.infer<typeof songLinesSchema>[number];

const wordsOf = (line: string) => line.trim().split(/\s+/u).filter(Boolean);
const normalize = (word: string) => word.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Align in order without allowing a sung extra or repeated word to steal later anchors. */
export function alignSongLyrics(lyrics: readonly string[], timestamps: readonly SongWordTimestamp[], durationMs: number): SongLine[] | undefined {
  const lines = lyrics.map(wordsOf);
  const words = lines.flat();
  if (!words.length || words.length > 5000 || !timestamps.length || timestamps.length > 2000 || !Number.isFinite(durationMs) || durationMs <= 0) return undefined;
  const lyricKeys = words.map(normalize), sungKeys = timestamps.map(word => normalize(word.word));
  // The input schemas bound this table to at most 10 million 16-bit cells.
  const lengths = Array.from({ length: words.length + 1 }, () => new Uint16Array(timestamps.length + 1));
  for (let i = words.length - 1; i >= 0; i--) for (let j = timestamps.length - 1; j >= 0; j--) {
    lengths[i]![j] = lyricKeys[i] && lyricKeys[i] === sungKeys[j]
      ? 1 + lengths[i + 1]![j + 1]!
      : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  }
  if (!lengths[0]![0]) return undefined;
  const duration = Math.round(durationMs);
  const clamp = (ms: number) => Math.max(0, Math.min(duration, Math.round(ms)));
  const anchors: { index: number; startMs: number; endMs: number }[] = [];
  let i = 0, j = 0, previousEnd = 0;
  while (i < words.length && j < timestamps.length) {
    if (lyricKeys[i] && lyricKeys[i] === sungKeys[j]) {
      const startMs = Math.max(previousEnd, clamp(timestamps[j]!.startMs));
      const endMs = Math.max(startMs, clamp(timestamps[j]!.endMs));
      anchors.push({ index: i, startMs, endMs });
      previousEnd = endMs;
      i++; j++;
    } else if (lengths[i]![j + 1]! >= lengths[i + 1]![j]!) j++;
    else i++;
  }
  const timed: SongLine["words"] = [];
  let previousIndex = -1;
  previousEnd = 0;
  for (const anchor of [...anchors, { index: words.length, startMs: duration, endMs: duration }]) {
    const missing = anchor.index - previousIndex - 1;
    const gap = anchor.startMs - previousEnd;
    for (let k = 0; k < missing; k++) timed.push({
      text: words[previousIndex + k + 1]!,
      startMs: Math.round(previousEnd + gap * k / missing),
      endMs: Math.round(previousEnd + gap * (k + 1) / missing),
    });
    if (anchor.index < words.length) timed.push({ text: words[anchor.index]!, startMs: anchor.startMs, endMs: anchor.endMs });
    previousIndex = anchor.index;
    previousEnd = anchor.endMs;
  }
  let offset = 0;
  return lines.map(line => {
    const words = timed.slice(offset, offset + line.length);
    offset += line.length;
    return { words };
  });
}
