import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";

import type { RecapVideoInput, RecapVideoPage, RecapVideoSongWord } from "../src/index.js";

/**
 * A synthetic two-player show in the shape the recap's writer produces: a
 * cover with a title and a scene (no label, no prize), story pages with a
 * setup, one picture and a payoff, one Most likely to card, a song with word
 * timings, and the result. Names, words and pictures are invented here.
 */
const LYRICS = [
  "Leo rolled the mat out on day one,",
  "Ava asked who's on it, said it can't be done,",
  "Wednesday Ava missed and wouldn't take the gift,",
  "Thursday both at midnight, neither one would shift,",
  "Seven days for Leo, six on Ava's side,",
  "Breakfast goes to Leo, served with pride.",
];
/** When each line starts and ends in the song, as a provider's word timings would place it. */
const LINE_SPANS: [number, number][] = [[20, 2060], [2560, 4440], [5000, 7060], [7480, 9560], [10000, 12120], [12500, 14980]];

function timedLines(): { words: RecapVideoSongWord[] }[] {
  return LYRICS.map((line, index) => {
    const texts = line.split(" "), [from, to] = LINE_SPANS[index] ?? [0, 0], step = (to - from) / texts.length;
    return { words: texts.map((text, at) => ({ text, startMs: Math.round(from + step * at), endMs: Math.round(from + step * (at + 1) - (at === texts.length - 1 ? 0 : 40)) })) };
  });
}

export const FIXTURE_PAGES: RecapVideoPage[] = [
  { id: "page-0", kind: "cover", background: "night", imageIndex: 1, blocks: [{ kind: "headline", text: "The Mat Takes the Stand" }], fallback: { kind: "photo", entryIds: ["entry-leo-1"] } },
  { id: "page-1", kind: "print", background: "night", blocks: [
    { kind: "headline", text: "Leo's first post was a yoga mat." }, { kind: "photo", entryIds: ["entry-leo-1"] }, { kind: "headline", text: "Ava wanted a person on it." },
  ] },
  { id: "page-2", kind: "scene", background: "sienna", imageIndex: 1, blocks: [
    { kind: "headline", text: "Leo offered Ava a do-over." }, { kind: "quote", quote: { who: "Ava", text: "keep your charity" } },
  ], fallback: { kind: "text", entryIds: [] } },
  { id: "page-3", kind: "print", background: "slate", blocks: [
    { kind: "headline", text: "Thursday, both posted at 11pm." }, { kind: "photoPair", entryIds: ["entry-leo-4", "entry-ava-4"] }, { kind: "headline", text: "Neither would go to bed first." },
  ] },
  { id: "page-4", kind: "scene", background: "night", imageIndex: 1, blocks: [
    { kind: "headline", text: "Leo won by one day." }, { kind: "headline", text: "Leo needed a minute." },
  ], fallback: { kind: "photo", entryIds: ["entry-leo-1"] } },
  { id: "card-member-leo", kind: "superlative", background: "paper", blocks: [], card: { memberId: "member-leo", title: "bring a lawyer to yoga", line: "Leo answered one doubt with three more photos of the same mat." } },
  { id: "song", kind: "song", background: "night", blocks: [], song: { title: "The Mat Takes the Stand", lyrics: LYRICS, lines: timedLines() } },
  { id: "result", kind: "result", background: "paper", blocks: [] },
];

/** A made-up picture: bands of color with a few shapes, so a drift or a crop shows. */
function picture(width: number, height: number, hue: number): Buffer {
  const canvas = createCanvas(width, height), ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, width, height);
  sky.addColorStop(0, `hsl(${hue}, 55%, 62%)`);
  sky.addColorStop(1, `hsl(${(hue + 40) % 360}, 60%, 28%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  for (let shape = 0; shape < 9; shape++) {
    ctx.fillStyle = `hsla(${(hue + shape * 37) % 360}, 70%, ${35 + shape * 5}%, 0.8)`;
    ctx.beginPath();
    ctx.arc(width * ((shape * 0.37) % 1), height * ((shape * 0.61) % 1), width * (0.06 + (shape % 3) * 0.04), 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.toBuffer("image/jpeg", 88);
}

/** A soft two-tone hum as a 16-bit mono WAV, so no audio file is kept in the repository. */
function tone(durationMs: number): Buffer {
  const rate = 24000, samples = Math.round(rate * durationMs / 1000), wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0, "latin1");
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8, "latin1");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "latin1");
  wav.writeUInt32LE(samples * 2, 40);
  for (let at = 0; at < samples; at++) {
    const seconds = at / rate;
    wav.writeInt16LE(Math.round(6000 * (Math.sin(2 * Math.PI * 220 * seconds) + 0.5 * Math.sin(2 * Math.PI * 330 * seconds)) / 1.5), 44 + at * 2);
  }
  return wav;
}

export type FixtureMusic = "score" | "song";

/**
 * Writes the fixture's pictures and music under `directory` and returns the
 * renderer's input. `score` is one fifty-second piece with a cue per story
 * page; `song` is the twenty-second song alone, as production has today.
 */
export async function writeFixture(directory: string, music: FixtureMusic = "score"): Promise<RecapVideoInput> {
  await mkdir(directory, { recursive: true });
  const save = async (name: string, bytes: Buffer): Promise<string> => {
    const file = path.join(directory, name);
    await writeFile(file, bytes);
    return file;
  };
  const story = FIXTURE_PAGES.filter(page => page.kind !== "song" && page.kind !== "result");
  const songStartMs = story.length * 5000;
  return {
    show: { treatment: "Courtroom drama", pages: FIXTURE_PAGES },
    players: { "member-ava": { name: "Ava", avatarPath: await save("ava-face.jpg", picture(400, 400, 300)) }, "member-leo": { name: "Leo" } },
    scores: { "member-leo": 7, "member-ava": 6 },
    outcome: { kind: "won", winnerId: "member-leo", loserId: "member-ava" },
    stake: { kind: "prize", title: "Breakfast in Bed" },
    scenes: {
      "page-0": await save("scene-0.jpg", picture(1024, 1536, 24)),
      "page-2": await save("scene-2.jpg", picture(1024, 1536, 200)),
      "page-4": await save("scene-4.jpg", picture(1024, 1536, 90)),
    },
    photos: {
      "entry-leo-1": await save("leo-1.jpg", picture(768, 1024, 150)),
      "entry-leo-4": await save("leo-4.jpg", picture(768, 1024, 40)),
      "entry-ava-4": await save("ava-4.jpg", picture(1024, 768, 260)),
    },
    soundtrack: music === "score"
      ? { path: await save("score.wav", tone(50040)), durationMs: 50040, startsAtMs: 0, songStartMs, songMs: 20000, cuesMs: story.map((_, index) => index * 5000) }
      : { path: await save("song.wav", tone(20040)), durationMs: 20040, startsAtMs: songStartMs, songStartMs, songMs: 20000 },
  };
}
