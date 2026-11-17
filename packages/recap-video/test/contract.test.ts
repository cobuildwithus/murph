import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRecapVideoRenderer, type RecapVideoInput, type RecapVideoPage, type RecapVideoRenderer } from "../src/index.js";
import { fixturePicture, fixtureTone } from "./fixture.js";

// The recap contract's own example of a show with a score, as the app's payload carries it: its pages go to the
// renderer as they are, and its times come from the score's cues, not from a fixed grid. Read from the contracts
// package's fixture so a change to the contract's shape shows here.
const FIXTURE = fileURLToPath(new URL("../../contracts/fixtures/recap-show/score-show.json", import.meta.url));
interface Presented { show: { treatment: string; pages: (RecapVideoPage & { media?: { status: string; durationMs?: number } })[]; score?: { media: { durationMs: number } } } }

let directory: string;
let input: RecapVideoInput;
let renderer: RecapVideoRenderer;

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "recap-video-contract-"));
  const { show } = JSON.parse(await readFile(FIXTURE, "utf8")) as Presented;
  const save = async (name: string, bytes: Buffer): Promise<string> => {
    const file = path.join(directory, name);
    await writeFile(file, bytes);
    return file;
  };
  // Invented pictures stand in for the fixture's media: one per ready scene and per post its pages name.
  const scenes: Record<string, string> = {}, photos: Record<string, string> = {};
  for (const page of show.pages) {
    if ((page.kind === "cover" || page.kind === "scene") && page.media?.status === "ready") scenes[page.id] = await save(`${page.id}.jpg`, fixturePicture(1024, 1536, 30 + Object.keys(scenes).length * 70));
    for (const id of [...page.blocks.flatMap(block => block.entryIds ?? []), ...(page.fallback?.entryIds ?? [])]) {
      photos[id] ??= await save(`photo-${Object.keys(photos).length}.jpg`, fixturePicture(768, 1024, Object.keys(photos).length * 40));
    }
  }
  const cards = show.pages.flatMap(page => page.card ? [page.card.memberId] : []), first = cards[0] ?? "synthetic-player-a";
  const score = show.score?.media.durationMs ?? 0, song = show.pages.find(page => page.kind === "song")?.media?.durationMs ?? 0;
  input = {
    show: { treatment: show.treatment, pages: show.pages },
    players: { [first]: { name: "Ava" }, "synthetic-player-b": { name: "Leo" } },
    scores: { [first]: 6, "synthetic-player-b": 7 },
    outcome: { kind: "won", winnerId: "synthetic-player-b", loserId: first },
    stake: { kind: "prize", title: "Breakfast in Bed" },
    scenes, photos,
    score: { path: await save("score.wav", fixtureTone(score)), durationMs: score, songMs: song },
  };
  renderer = await createRecapVideoRenderer(input);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("the contract's show with a score", () => {
  it("turns its pages on the score's cues and opens the song on time for a late singer", () => {
    const { pages } = input.show, starts = renderer.timeline.entries.map(entry => entry.fromMs);
    // T = 55,008 and the song is 20,016 long, so the song's clock starts at 34,992, by the planned start at 35,000. Its singer comes in 300 ms late, at 35,300.
    expect(input.score).toMatchObject({ durationMs: 55008, songMs: 20016 });
    expect(pages.filter(page => page.cueMs !== undefined).map(page => page.cueMs)).toEqual([0, 5000, 10000, 15000, 20000, 25000, 30000, 35000]);
    expect(starts.slice(0, 8)).toEqual([0, 5000, 10000, 15000, 20000, 25000, 30000, 35000]);
    expect(renderer.timeline.entries.map(entry => entry.kind)).toEqual(["cover", "print", "scene", "text", "print", "print", "superlative", "song", "poster"]);
    // The card before the song keeps its 5 s. The last sung word ends 10,208 ms into the song: the last screen follows 350 ms later, on a frame.
    expect(renderer.timeline.entries[6]).toMatchObject({ kind: "superlative", fromMs: 30000, toMs: 35000 });
    expect(renderer.timeline.entries.at(-1)?.fromMs).toBe(Math.ceil((34992 + 10208 + 350) * 30 / 1000) * 1000 / 30);
    expect(renderer.timeline.frameCount).toBe(Math.floor(56008 * 30 / 1000));
  });

  it("lights each word on the song's own clock", () => {
    // The page opens 8 ms into the song with nothing lit; "The" lights as it is sung, 308 ms into the song.
    expect(renderer.frameState(35000)).toMatchObject({ kind: "song", localMs: 0, sungWords: 0 });
    expect(renderer.frameState(35299).sungWords).toBe(0);
    expect(renderer.frameState(35300).sungWords).toBe(1);
    expect(renderer.frameState(34992 + 9808).sungWords).toBe(20);
  });

  it("draws every one of its pages", () => {
    for (const entry of renderer.timeline.entries) {
      const ms = entry.fromMs + Math.min(4600, entry.toMs - entry.fromMs - 40), state = renderer.frameState(ms);
      expect(state.pieces.every(piece => piece.opacity === 1), entry.page.id).toBe(true);
      expect(renderer.drawFrame(ms).data().length).toBe(804 * 1748 * 4);
    }
  });
});
