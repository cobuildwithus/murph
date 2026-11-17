import { execFile, spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  RECAP_VIDEO_MAX_BYTES, RecapVideoRefusal, billing, buildRecapVideoTimeline, createRecapVideoRenderer, encodeRecapVideo, posterWords, starringLine, videoKbpsCeiling,
  type RecapVideoInput, type RecapVideoPage, type RecapVideoRenderer, type RecapVideoSongWord,
} from "../src/index.js";
import { pictureSize, registerRecapFonts, textWidth, wrapText, type TextStyle } from "../src/surface.js";
import { FIXTURE_PAGES, fixturePicture, writeFixture, type FixtureExtras } from "./fixture.js";

const run = promisify(execFile);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
// The runner image lane sets this: there, a missing ffmpeg is a failure, not a reason to skip the encode.
if (process.env.RECAP_VIDEO_REQUIRE_FFMPEG && !hasFfmpeg) throw new Error("This lane proves the encode and found no ffmpeg.");

const NIGHT = [0x1c, 0x19, 0x15], SIENNA = [0x8b, 0x5d, 0x3f], SLATE = [0x4f, 0x6b, 0x78], PAPER = [0xff, 0xff, 0xff];
/** A spot low on the page that no page draws on, so it shows the page's ground. */
const GROUND_SPOT = { x: 20, y: 1716 };

let directory: string;
let input: RecapVideoInput & { extras: FixtureExtras };
let renderer: RecapVideoRenderer;

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "recap-video-test-"));
  input = await writeFixture(path.join(directory, "score"));
  renderer = await createRecapVideoRenderer(input);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function pixel(pixels: Uint8Array, x: number, y: number, width = 804, channels = 4): number[] {
  const at = (y * width + x) * channels;
  return [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0];
}
/** How many pixels in a box are close to a color. */
function count(pixels: Uint8Array, box: { x: number; y: number; width: number; height: number }, color: number[], within = 24): number {
  let found = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const [red = 0, green = 0, blue = 0] = pixel(pixels, x, y);
      if (Math.abs(red - (color[0] ?? 0)) <= within && Math.abs(green - (color[1] ?? 0)) <= within && Math.abs(blue - (color[2] ?? 0)) <= within) found++;
    }
  }
  return found;
}
const frame = (ms: number): Uint8Array => renderer.drawFrame(ms).data();
const opacity = (ms: number, name: string): number | undefined => renderer.frameState(ms).pieces.find(piece => piece.name === name)?.opacity;
const withPages = (change: (pages: RecapVideoPage[]) => RecapVideoPage[]): RecapVideoInput => ({ ...input, show: { ...input.show, pages: change(structuredClone(FIXTURE_PAGES)) } });

describe("timeline", () => {
  it("puts story pages on the score's cues, the song from its first sung word to its last, then the last screen to the end of the music", () => {
    // The song's clock starts at 30,088 ms and its last word ends 14,980 ms in: the last screen takes the first frame 350 ms after that, and the video ends on a frame.
    const posterFrom = 1363 * 1000 / 30, end = 1531 * 1000 / 30;
    expect(renderer.timeline.entries.map(entry => [entry.kind, entry.fromMs, entry.toMs])).toEqual([
      ["cover", 0, 5000], ["print", 5000, 10000], ["scene", 10000, 15000], ["print", 15000, 20000], ["scene", 20000, 25000],
      ["superlative", 25000, 30300], ["song", 30300, posterFrom], ["poster", posterFrom, end],
    ]);
    expect(renderer.timeline.durationMs).toBe(end);
    expect(renderer.timeline.frameCount).toBe(1531);
    expect(renderer.frameState(1362 * 1000 / 30).kind).toBe("song");
    expect(renderer.frameState(posterFrom)).toMatchObject({ kind: "poster", localMs: 0 });
  });

  it.each([["on time", 0], ["five seconds late", 5000]])("opens the song on the planned start for a singer %s, and lights its first word as it is sung", async (_singer, delay) => {
    // The score as it is made now: the song page's cue is the planned start, 30,000 ms, and the song's clock starts
    // 200 ms before the first word, never after the planned start. A late singer's band plays on under the song page.
    const first = 30000 + delay, origin = Math.min(first - 200, 30000), shift = first - origin - 212;
    const timed = withPages(pages => pages.map(page => page.song?.lines ? { ...page, cueMs: 30000, song: { ...page.song,
      lines: page.song.lines.map(line => ({ words: line.words.map(word => ({ ...word, startMs: word.startMs + shift, endMs: word.endMs + shift })) })) } } : page));
    const scored = await createRecapVideoRenderer({ ...timed, score: { ...timed.score, songMs: timed.score.durationMs - origin } });
    // The card before the song keeps its five seconds.
    expect(scored.timeline.entries.slice(5, 7).map(entry => [entry.kind, entry.fromMs])).toEqual([["superlative", 25000], ["song", 30000]]);
    expect(scored.timeline.entries[5]?.toMs).toBe(30000);
    expect(scored.frameState(30000)).toMatchObject({ kind: "song", localMs: 0 });
    if (delay > 0) expect(scored.frameState(first - 1).sungWords).toBe(0);
    expect(scored.frameState(first).sungWords).toBe(1);
  });

  it("holds the last screen five seconds when the song is sung to its end", () => {
    const late = withPages(pages => pages.map(page => page.song?.lines
      ? { ...page, song: { ...page.song, lines: page.song.lines.map((line, index, all) => index === all.length - 1 ? { words: line.words.map(word => ({ ...word, endMs: 19900 })) } : line) } }
      : page));
    const timeline = buildRecapVideoTimeline(late), poster = timeline.entries.at(-1);
    // 50,338 ms falls between two frames: the last screen takes the next one and holds a full 150.
    expect(poster).toMatchObject({ kind: "poster", fromMs: 1511 * 1000 / 30, toMs: 1661 * 1000 / 30 });
    expect(timeline.frameCount).toBe(1661);
  });

  it("refuses a recap without a song, a show without a score, and cues that do not fit", () => {
    const score = expect.objectContaining({ code: "invalid_soundtrack" });
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.filter(page => page.kind !== "song")))).toThrowError(expect.objectContaining({ code: "missing_song" }));
    // A recap from before shows had scores has a song and no cues: its story pages would play in silence, so it gets no video.
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.map(({ cueMs: _none, ...page }) => page)))).toThrowError(score);
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.map(page => page.id === "page-2" ? { ...page, cueMs: 4000 } : page)))).toThrowError(score);
    // The song page opens inside the song: not before its clock starts, not after the music ends.
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.map(page => page.kind === "song" ? { ...page, cueMs: 29000 } : page)))).toThrowError(score);
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.map(page => page.kind === "song" ? { ...page, cueMs: 50040 } : page)))).toThrowError(score);
    expect(() => buildRecapVideoTimeline(withPages(pages => [...pages, { id: "x", kind: "filmRolls", background: "night", blocks: [] }]))).toThrowError(expect.objectContaining({ code: "unsupported_page" }));
  });

  it("refuses music and word timings that are not real times in order", () => {
    const refusal = expect.objectContaining({ code: "invalid_soundtrack" });
    const withWords = (change: (word: RecapVideoSongWord, at: number) => RecapVideoSongWord): RecapVideoInput => withPages(pages => pages.map(page => page.song?.lines
      ? { ...page, song: { ...page.song, lines: page.song.lines.map(line => ({ words: line.words.map(change) })) } } : page));
    expect(() => buildRecapVideoTimeline({ ...input, score: { ...input.score, durationMs: Number.NaN } })).toThrowError(refusal);
    expect(() => buildRecapVideoTimeline({ ...input, score: { ...input.score, songMs: Number.POSITIVE_INFINITY } })).toThrowError(refusal);
    // Ends before their starts would put the last screen ahead of the song.
    expect(() => buildRecapVideoTimeline(withWords(word => ({ ...word, endMs: -1000 })))).toThrowError(refusal);
    expect(() => buildRecapVideoTimeline(withWords((word, at) => at === 2 ? { ...word, startMs: 0, endMs: 10 } : word))).toThrowError(refusal);
    expect(() => buildRecapVideoTimeline(withWords(word => ({ ...word, startMs: Number.NaN })))).toThrowError(refusal);
    // The timed words are the lyrics' own words: any other would be drawn in their place.
    expect(() => buildRecapVideoTimeline(withWords((word, at) => at === 0 ? { ...word, text: "Goodbye" } : word))).toThrowError(refusal);
  });

  it("refuses a show larger than a recap can be, and blocks a page kind has no place for", () => {
    const refusal = expect.objectContaining({ code: "unsupported_page" });
    const story = FIXTURE_PAGES[1];
    if (!story) throw new Error("The fixture has a story page.");
    expect(() => buildRecapVideoTimeline(withPages(pages => [...pages.slice(0, 5), ...Array.from({ length: 5 }, (_, index) => ({ ...story, id: `more-${index}` })), ...pages.slice(5)]))).toThrowError(refusal);
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.map(page => page.id === "page-1" ? { ...page, blocks: [...page.blocks, ...page.blocks] } : page)))).toThrowError(refusal);
    // A cover is its title: a second headline, a quote or a stat on it would be left out.
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.map(page => page.kind === "cover" ? { ...page, blocks: [...page.blocks, { kind: "stat", statValue: "7", text: "days" }] } : page)))).toThrowError(refusal);
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.map(page => page.kind === "cover" ? { ...page, blocks: [...page.blocks, ...page.blocks] } : page)))).toThrowError(refusal);
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.map(page => page.kind === "superlative" ? { ...page, blocks: [{ kind: "headline", text: "One more thing" }] } : page)))).toThrowError(refusal);
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.flatMap(page => page.kind === "song" ? [page, { ...page, id: "song-2" }] : [page])))).toThrowError(refusal);
  });
});

describe("what is on screen at a time", () => {
  it("shows the whole cover on the first frame", () => {
    expect(renderer.frameState(0)).toMatchObject({ pageId: "page-0", kind: "cover", pieces: [{ name: "words", opacity: 1 }] });
    // The title's letters are already there, in the cream the app sets them in.
    expect(count(frame(0), { x: 60, y: 960, width: 680, height: 340 }, [0xff, 0xfc, 0xf6])).toBeGreaterThan(10_000);
  });

  it("brings a story page in as three beats: setup, picture, payoff", () => {
    const page = 5000;
    expect(opacity(page + 100, "setup")).toBe(0);
    expect(opacity(page + 330, "setup")).toBeCloseTo(0.875, 3);
    expect([opacity(page + 600, "setup"), opacity(page + 600, "picture"), opacity(page + 600, "payoff")]).toEqual([1, 0, 0]);
    expect([opacity(page + 1500, "picture"), opacity(page + 1500, "payoff")]).toEqual([1, 0]);
    expect(opacity(page + 2999, "payoff")).toBe(0);
    expect(opacity(page + 3500, "payoff")).toBe(1);
    // A pair's second print lands a quarter second after the first.
    expect([opacity(15000 + 1100, "picture"), opacity(15000 + 1100, "second picture")]).not.toContain(1);
    expect(opacity(15000 + 1100, "second picture")).toBe(0);
    expect(opacity(15000 + 1700, "second picture")).toBe(1);
  });

  it("draws those beats: the picture's place is empty ground until its beat", () => {
    const middle = { x: 300, y: 800, width: 200, height: 200 };
    expect(count(frame(5000 + 800), middle, NIGHT, 2)).toBe(middle.width * middle.height);
    expect(count(frame(5000 + 1600), middle, NIGHT, 2)).toBe(0);
    // The payoff's lines sit under the print and stay dark until three seconds in.
    const payoff = { x: 100, y: 1410, width: 600, height: 150 };
    expect(count(frame(5000 + 2900), payoff, [0xff, 0xfc, 0xf6])).toBe(0);
    expect(count(frame(5000 + 3600), payoff, [0xff, 0xfc, 0xf6])).toBeGreaterThan(2000);
  });

  it("staggers Most likely to and the last screen", () => {
    const card = 25000, poster = 1363 * 1000 / 30;
    expect(renderer.frameState(card + 1100).pieces.map(piece => [piece.name, piece.opacity === 1])).toEqual([
      ["face", true], ["name", true], ["lead", true], ["title", false], ["rule", false], ["line", false],
    ]);
    expect(renderer.frameState(card + 2300).pieces.every(piece => piece.opacity === 1)).toBe(true);
    expect(renderer.frameState(poster + 1000).pieces.map(piece => [piece.name, piece.opacity === 1])).toEqual([
      ["score", true], ["title", false], ["stake", false], ["footer", false],
    ]);
    expect(renderer.frameState(poster + 3000).pieces.every(piece => piece.opacity === 1)).toBe(true);
  });

  it("fades the cover into the night with no light line at its foot", () => {
    // 874 x 0.555 is 485.07 points: drawn at that height, the partly covered pixel row under the fade let the picture through.
    for (const [ms, foot] of [[2500, Math.floor(874 * 0.69) * 2], [1363 * 1000 / 30 + 3000, Math.floor(874 * 0.555) * 2]] as const) {
      const pixels = frame(ms);
      for (let y = foot - 3; y <= foot + 3; y++) expect(count(pixels, { x: 8, y, width: 40, height: 1 }, NIGHT, 3), `row ${y} at ${ms} ms`).toBe(40);
    }
  });

  it("fills one story bar per page as the page plays", () => {
    expect(renderer.frameState(12500).bars).toEqual([1, 1, 0.5, 0, 0, 0, 0, 0]);
    // The third bar is half cream, half the dim track.
    const bars = frame(12500), top = 62 * 2 + 2;
    expect(pixel(bars, 250, top)).toEqual([0xff, 0xfc, 0xf6]);
    expect(pixel(bars, 290, top)).not.toEqual([0xff, 0xfc, 0xf6]);
  });

  it("gives each page its ground", () => {
    const ground = (ms: number): number[] => pixel(frame(ms), GROUND_SPOT.x, GROUND_SPOT.y);
    expect([ground(2500), ground(7500), ground(12500), ground(17500), ground(22500), ground(27500), ground(40000), ground(50000)])
      .toEqual([NIGHT, NIGHT, SIENNA, SLATE, NIGHT, PAPER, NIGHT, NIGHT]);
  });

  it("lights the lyrics word by word, on the words' own times", () => {
    // The song's clock starts at 30,088 ms; its page opens 212 ms later, as the first word is sung.
    const song = 30088, words = FIXTURE_PAGES.find(page => page.song)?.song?.lines?.flatMap(line => line.words) ?? [];
    expect(renderer.frameState(30300)).toMatchObject({ kind: "song", localMs: 0, sungWords: 1 });
    expect(renderer.frameState(song + (words[3]?.startMs ?? 0)).sungWords).toBe(4);
    expect(renderer.frameState(song + 15000).sungWords).toBe(words.length);
    const pane = { x: 60, y: 1470, width: 680, height: 278 };
    const lit = (ms: number): number => count(frame(song + ms), pane, [0xff, 0xfc, 0xf6]);
    expect(lit(300)).toBeLessThan(lit(1200));
    expect(lit(1200)).toBeLessThan(lit(1900));
  });

  it("lights whole lines through an untimed song", async () => {
    const untimed = await createRecapVideoRenderer(withPages(pages => pages.map(page => page.song ? { ...page, song: { title: page.song.title, lyrics: page.song.lyrics } } : page)));
    const song = untimed.timeline.entries.find(entry => entry.kind === "song");
    expect(untimed.frameState((song?.fromMs ?? 0) + 100).sungWords).toBe(8);
    expect(untimed.frameState((song?.fromMs ?? 0) + 19000).sungWords).toBe(49);
  });

  it("speaks of both players in the third person on the last screen, and to both where the app's words already do", () => {
    const even = (everyDay: boolean): RecapVideoInput["outcome"] => ({ kind: "even", everyDay });
    expect(posterWords(input)).toEqual({ title: "Leo wins.", line: "Ava owes Leo" });
    expect(posterWords({ ...input, stake: { kind: "punishment", title: "Cold plunge at dawn" } })).toEqual({ title: "Leo wins." });
    expect(posterWords({ ...input, outcome: even(true), stake: { kind: "bothWin", title: "Dinner Out Together" } })).toEqual({ title: "You both win.", line: "You both get", caption: "You both did every day." });
    expect(posterWords({ ...input, outcome: even(false), stake: { kind: "none" } })).toEqual({ title: "Dead even.", caption: "Nobody owes anything." });
    expect(posterWords({ ...input, outcome: even(true), stake: { kind: "none" } })).toEqual({ title: "Dead even.", caption: "You both did every day, so nobody owes anything." });
  });

  it("takes the winner's seat everywhere: on the left of the score, named last on the cover; an even game goes by name", () => {
    expect(billing(input)).toEqual(["member-leo", "member-ava"]);
    expect(starringLine(input)).toBe("A courtroom drama, starring Ava and Leo");
    const avaWon: RecapVideoInput = { ...input, outcome: { kind: "won", winnerId: "member-ava", loserId: "member-leo" } };
    expect(billing(avaWon)).toEqual(["member-ava", "member-leo"]);
    expect(starringLine(avaWon)).toBe("A courtroom drama, starring Leo and Ava");
    expect(posterWords(avaWon)).toEqual({ title: "Ava wins.", line: "Leo owes Ava" });
    const tied: RecapVideoInput = { ...input, outcome: { kind: "even", everyDay: false }, stake: { kind: "none" } };
    expect(billing(tied)).toEqual(["member-ava", "member-leo"]);
    expect(starringLine({ ...tied, show: { ...tied.show, treatment: "" } })).toBe("Starring Leo and Ava");
  });

  it("brings a page of words alone in one block after another, as the app does", async () => {
    const failed = await createRecapVideoRenderer({ ...input, scenes: { "page-0": input.scenes["page-0"] ?? "" } });
    const page = 10000, at = (ms: number, name: string): number | undefined => failed.frameState(page + ms).pieces.find(piece => piece.name === name)?.opacity;
    expect(failed.frameState(page + 4000).pieces.map(piece => piece.name)).toEqual(["setup", "next"]);
    expect([at(600, "setup"), at(1000, "next"), at(1500, "next")]).toEqual([1, 0, 1]);
  });
});

describe("refusals", () => {
  const refuses = async (changed: RecapVideoInput, code: string): Promise<void> => {
    await expect(createRecapVideoRenderer(changed)).rejects.toSatisfy(error => error instanceof RecapVideoRefusal && error.code === code);
  };
  const withBlock = (pageId: string, block: RecapVideoPage["blocks"][number]): RecapVideoInput =>
    withPages(pages => pages.map(page => page.id === pageId ? { ...page, blocks: [block, ...page.blocks.slice(1)] } : page));

  it("refuses what it has no drawing for, instead of drawing it wrong", async () => {
    const sheet = (entryIds: string[]): RecapVideoInput => withPages(pages => pages.map(page => page.id === "page-3" ? { ...page, blocks: [{ kind: "contactSheet", entryIds }] } : page));
    await refuses(withBlock("page-1", { kind: "filmStrip", text: "days" }), "unsupported_block");
    await refuses(withBlock("page-1", { kind: "stat", text: "a label with no number" }), "unsupported_block");
    await refuses(sheet(["entry-leo-1", "entry-leo-4"]), "unsupported_block");
    // A day given back wears a tag wider than a sheet's small prints.
    await refuses({ ...sheet(["entry-leo-1", "entry-leo-4", "entry-ava-4"]), unfinished: ["entry-leo-4"] }, "unsupported_block");
    // A page holds one picture: the app draws the first and drops the rest.
    await refuses(withPages(pages => pages.map(page => page.id === "page-1" ? { ...page, blocks: [{ kind: "photo", entryIds: ["entry-leo-1"] }, { kind: "photo", entryIds: ["entry-leo-4"] }] } : page)), "unsupported_page");
  });

  it("refuses a last screen whose outcome and stake do not go together", async () => {
    await refuses({ ...input, outcome: { kind: "even", everyDay: false } }, "unsupported_stake");
    await refuses({ ...input, outcome: { kind: "even", everyDay: false }, stake: { kind: "bothWin", title: "Dinner Out Together" } }, "unsupported_stake");
    await refuses({ ...input, stake: { kind: "none" } }, "unsupported_stake");
    await refuses({ ...input, stake: { kind: "bothWin", title: "Dinner Out Together" } }, "unsupported_stake");
    await refuses({ ...input, players: { ...input.players, "member-sam": { name: "Sam" } } }, "unsupported_outcome");
    await refuses({ ...input, outcome: { kind: "won", winnerId: "member-leo", loserId: "member-sam" } }, "unsupported_outcome");
  });

  it("refuses a stake with no words or far too many, before anything is done with them", async () => {
    for (const kind of ["prize", "punishment"] as const) {
      await refuses({ ...input, stake: { kind, title: "   " } }, "unsupported_stake");
      await refuses({ ...input, stake: { kind, title: "coffee ".repeat(400) } }, "unsupported_page");
    }
  });

  it("refuses a day given back whose photo is too narrow for its tag", async () => {
    const sliver = path.join(directory, "sliver.jpg");
    await writeFile(sliver, fixturePicture(60, 1024, 10));
    const narrow: RecapVideoInput = { ...input, photos: { ...input.photos, "entry-ava-4": sliver } };
    // The same pair draws without the tag, and with the tag on the photo that has room for it.
    expect((await createRecapVideoRenderer(narrow)).frameState(18000).pieces.map(piece => piece.name)).toEqual(["setup", "picture", "second picture", "payoff"]);
    expect((await createRecapVideoRenderer({ ...narrow, unfinished: ["entry-leo-4"] })).frameState(18000).pieces).toHaveLength(4);
    await refuses({ ...narrow, unfinished: ["entry-ava-4"] }, "does_not_fit");
  });

  it("refuses words the app would cut short with an ellipsis", async () => {
    const song = (change: (song: NonNullable<RecapVideoPage["song"]>) => NonNullable<RecapVideoPage["song"]>): RecapVideoInput => withPages(pages => pages.map(page => page.song ? { ...page, song: change(page.song) } : page));
    // A song's title past two lines at its smallest size; a treatment past one line under it.
    await refuses(song(found => ({ ...found, title: "The Ballad of the Mat That Took the Stand Twice and Then Once More for Luck on a Thursday" })), "does_not_fit");
    await refuses({ ...input, show: { ...input.show, treatment: "70s American high school pep rally the night before prom" } }, "does_not_fit");
    // Beside its drawing a prize keeps to one line, down to three fifths of its size: the app cuts a longer one short.
    expect((await createRecapVideoRenderer({ ...input, stake: { kind: "prize", title: "A Night off Dishes" } })).frameState(50000).pieces.map(piece => piece.name)).toContain("stake");
    await refuses({ ...input, stake: { kind: "prize", title: "Pick of the Restaurant" } }, "does_not_fit");
    await refuses(withBlock("page-1", { kind: "stat", statValue: "one hundred and four thousand", text: "steps" }), "does_not_fit");
  });

  it("shrinks long scores to share their row, as the app does", async () => {
    const wide = await createRecapVideoRenderer({ ...input, scores: { "member-leo": 128, "member-ava": 126 } });
    expect(wide.frameState(50000).pieces.map(piece => piece.name)).toEqual(["score", "title", "stake", "footer"]);
    // The row is as wide as the page allows and no wider: nothing cream reaches the page's margins, and the digits sit between the faces.
    const pixels = wide.drawFrame(50000).data(), cream = [0xff, 0xfc, 0xf6];
    const score = wide.frameState(50000).pieces[0]?.box ?? { x: 0, y: 0, width: 0, height: 0 };
    expect(count(pixels, { x: 0, y: Math.round(score.y * 2) + 30, width: 44, height: 170 }, cream)).toBe(0);
    expect(count(pixels, { x: 760, y: Math.round(score.y * 2) + 30, width: 44, height: 170 }, cream)).toBe(0);
    expect(count(pixels, { x: 230, y: Math.round(score.y * 2) + 30, width: 340, height: 170 }, cream)).toBeGreaterThan(3000);
  });

  it("refuses text its fonts cannot draw, and words that do not fit their page", async () => {
    await refuses(withBlock("page-1", { kind: "headline", text: "Leo's first post was a ヨガマット" }), "unsupported_text");
    await refuses(withBlock("page-1", { kind: "headline", text: Array.from({ length: 30 }, () => "Leo kept posting the mat").join(" ") }), "does_not_fit");
  });

  it("refuses a page whose picture is missing", async () => {
    await refuses({ ...input, photos: {} }, "missing_picture");
  });

  it("refuses a picture that would decode larger than a recap's pictures, from its header alone", async () => {
    // A PNG header that claims 20,000 by 20,000 pixels, with nothing behind it to decode.
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "latin1");
    header.writeUInt32BE(20000, 16);
    header.writeUInt32BE(20000, 20);
    expect(pictureSize(header)).toEqual({ width: 20000, height: 20000 });
    const huge = path.join(directory, "huge.png"), other = path.join(directory, "other.gif");
    await writeFile(huge, header);
    await writeFile(other, Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1"));
    await refuses({ ...input, photos: { ...input.photos, "entry-leo-1": huge } }, "unsupported_picture");
    await refuses({ ...input, photos: { ...input.photos, "entry-leo-1": other } }, "unsupported_picture");
    expect(pictureSize(await readFile(input.photos["entry-ava-4"] ?? ""))).toEqual({ width: 1024, height: 768 });
  });

  it("refuses a lyric line too long for the two rows the lyrics card shows", async () => {
    await refuses(withPages(pages => pages.map(page => page.song ? { ...page, song: { title: page.song.title, lyrics: [Array.from({ length: 30 }, () => "hello").join(" "), ...page.song.lyrics.slice(1)] } } : page)), "does_not_fit");
  });

  it("falls back from a failed scene to its photo, or to its words alone", async () => {
    const failed = await createRecapVideoRenderer({ ...input, scenes: {} });
    // The fourth page falls back to a print of its photo; the second scene has only its words; the cover stands its photo in over its words.
    expect(failed.frameState(22000).pieces.map(piece => piece.name)).toEqual(["setup", "picture", "payoff"]);
    expect(failed.frameState(12000).pieces.map(piece => piece.name)).toEqual(["setup", "next"]);
    expect(failed.frameState(0).pieces).toMatchObject([{ name: "picture", opacity: 1 }, { name: "words", opacity: 1 }]);
  });

  it("prints a \"missed\" card for a post whose photo is gone, and refuses a post it was never given", async () => {
    const missed = await createRecapVideoRenderer({ ...input, photos: { ...input.photos, "entry-leo-1": null } });
    // The card is dark where the photo's greens were.
    const middle = { x: 300, y: 800, width: 200, height: 200 };
    expect(count(missed.drawFrame(8000).data(), middle, [0x2a, 0x26, 0x22], 12)).toBeGreaterThan(30_000);
    expect(count(frame(8000), middle, [0x2a, 0x26, 0x22], 12)).toBe(0);
    const { "entry-leo-1": _gone, ...rest } = input.photos;
    await refuses({ ...input, photos: rest }, "missing_picture");
  });
});

describe("the encoder", () => {
  /** A stand-in for ffmpeg: it notes its process, starts its output file, reads its frames and exits as told. */
  const standIn = async (name: string, exit: number, bytes = 8): Promise<{ file: string; pid: () => Promise<number> }> => {
    const file = path.join(directory, name), noted = `${file}.pid`;
    await writeFile(file, `#!/bin/sh\nfor last; do :; done\necho $$ > "${noted}"\nhead -c ${bytes} /dev/zero > "$last"\ncat > /dev/null\nexit ${exit}\n`);
    await chmod(file, 0o755);
    return { file, pid: async () => Number((await readFile(noted, "utf8")).trim()) };
  };
  const gone = (file: string): Promise<boolean> => access(file).then(() => false, () => true);

  it("refuses, instead of waiting, when ffmpeg cannot be started", async () => {
    await expect(encodeRecapVideo(renderer, input.score, path.join(directory, "never.mp4"), { ffmpegPath: path.join(directory, "no-such-ffmpeg") }))
      .rejects.toSatisfy(error => error instanceof RecapVideoRefusal && error.code === "encoder_failed");
  });

  it("leaves no file behind when ffmpeg fails after starting one", async () => {
    const out = path.join(directory, "failed.mp4"), ffmpeg = await standIn("failing-ffmpeg", 3);
    const short: RecapVideoRenderer = { ...renderer, timeline: { ...renderer.timeline, frameCount: 3 }, drawFrame: ms => renderer.drawFrame(ms), frameState: ms => renderer.frameState(ms) };
    await expect(encodeRecapVideo(short, input.score, out, { ffmpegPath: ffmpeg.file }))
      .rejects.toSatisfy(error => error instanceof RecapVideoRefusal && error.code === "encoder_failed");
    expect(await gone(out)).toBe(true);
  });

  it("stops ffmpeg and leaves no file behind when a frame cannot be drawn", async () => {
    const out = path.join(directory, "undrawn.mp4"), ffmpeg = await standIn("waiting-ffmpeg", 0);
    const broken: RecapVideoRenderer = {
      ...renderer, frameState: ms => renderer.frameState(ms),
      drawFrame: ms => {
        if (ms > 400) throw new Error("This frame cannot be drawn.");
        return renderer.drawFrame(ms);
      },
    };
    await expect(encodeRecapVideo(broken, input.score, out, { ffmpegPath: ffmpeg.file })).rejects.toThrowError("This frame cannot be drawn.");
    expect(await gone(out)).toBe(true);
    // The stand-in was stopped before this returned: nothing answers at its process id.
    const pid = await ffmpeg.pid();
    expect(() => process.kill(pid, 0)).toThrowError();
  });

  it("refuses a video over its byte budget and removes it", async () => {
    const out = path.join(directory, "oversize.mp4"), ffmpeg = await standIn("large-ffmpeg", 0, 4_500_000);
    const short: RecapVideoRenderer = { ...renderer, timeline: { ...renderer.timeline, frameCount: 2 }, drawFrame: ms => renderer.drawFrame(ms), frameState: ms => renderer.frameState(ms) };
    await expect(encodeRecapVideo(short, input.score, out, { ffmpegPath: ffmpeg.file, maxBytes: 4_000_000 }))
      .rejects.toSatisfy(error => error instanceof RecapVideoRefusal && error.code === "too_large");
    expect(await gone(out)).toBe(true);
  });
});

describe("fonts", () => {
  // Advances come from the font files alone, at the axes the app pins its display face to (soft, wonky, optical size 36).
  // A missing or substituted face, or a changed axis, moves these and every line break with them. The same strings set
  // by the app's own text engine measure 189.5 and 249.0 for the first and third.
  const advances: [string, TextStyle, number][] = [
    ["Leo wins.", { font: "display", weight: 600, size: 44, lineHeight: 53, tracking: -0.88, color: "#000" }, 189.17],
    ["The Mat Takes the Stand", { font: "display", weight: 700, size: 30, lineHeight: 41, color: "#000" }, 362.03],
    ["“keep your charity”", { font: "display", weight: 400, italic: true, size: 28, lineHeight: 38, color: "#000" }, 248.55],
    ["A courtroom drama, starring Ava and Leo", { font: "sans", size: 15, lineHeight: 19.5, color: "#000" }, 289.1],
    ["Wednesday Ava missed", { font: "sansBold", size: 19, lineHeight: 25, tracking: -0.3, color: "#000" }, 214.0],
    ["WITHMURPH.AI", { font: "mono", size: 13, lineHeight: 16, tracking: 3.9, color: "#000" }, 140.4],
  ];

  it("measures text with the bundled faces", () => {
    registerRecapFonts();
    for (const [text, style, width] of advances) expect(textWidth(text, style), text).toBeCloseTo(width, 1);
  });

  it("breaks lines as the approved pages do", () => {
    const headline: TextStyle = { font: "display", weight: 700, size: 30, lineHeight: 41, color: "#000" };
    const wrap = (text: string): string[] => wrapText(text, headline, 354, { pretty: true, keepHyphens: true });
    expect(wrap("Leo's first post was a yoga mat.")).toEqual(["Leo's first post was a", "yoga mat."]);
    // No word alone on a last line, and a hyphenated word stays whole.
    expect(wrap("Ava wanted a person on it.")).toEqual(["Ava wanted a person", "on it."]);
    expect(wrap("Leo offered Ava a do-over.")).toEqual(["Leo offered Ava a", "do-over."]);
    expect(wrapText("The Mat Takes the Stand", { ...headline, size: 58, lineHeight: 58, tracking: -1.16 }, 354)).toEqual(["The Mat", "Takes the", "Stand"]);
  });
});

describe.skipIf(!hasFfmpeg)("the encoded file", () => {
  let file: string;
  let bytes: number;

  beforeAll(async () => {
    file = path.join(directory, "recap.mp4");
    ({ bytes } = await encodeRecapVideo(renderer, input.score, file, { preset: "veryfast" }));
  });

  it("is one vertical H.264 video with sound, the length of its timeline, within its byte budget", async () => {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,nb_frames:format=duration", "-of", "json", file]);
    const probe = JSON.parse(stdout) as { streams: Record<string, string | number>[]; format: { duration: string } };
    const video = probe.streams.find(stream => stream.codec_type === "video"), audio = probe.streams.find(stream => stream.codec_type === "audio");
    expect(video).toMatchObject({ codec_name: "h264", width: 804, height: 1748, pix_fmt: "yuv420p", r_frame_rate: "30/1", nb_frames: "1531" });
    expect(audio).toMatchObject({ codec_name: "aac" });
    expect(Number(probe.format.duration)).toBeCloseTo(51.03, 1);
    expect(bytes).toBeLessThanOrEqual(RECAP_VIDEO_MAX_BYTES);
    expect(videoKbpsCeiling(renderer.timeline.durationMs, RECAP_VIDEO_MAX_BYTES)).toBeGreaterThan(900);
  });

  it("turns its pages on the timeline's frames and shows what the renderer drew", async () => {
    // The frames either side of two page turns, and one mid-page frame to compare with the renderer's own.
    // `-fps_mode passthrough` (ffmpeg 5.1 and later) keeps only the selected frames; `-vsync` is gone from ffmpeg 7.
    const wanted = [299, 300, 749, 750, 400];
    const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-vf", `select='${wanted.map(index => `eq(n\\,${index})`).join("+")}'`, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
    const size = 804 * 1748 * 3;
    expect(stdout.length).toBe(size * wanted.length);
    const decoded = [...wanted].sort((a, b) => a - b).map((index, at) => ({ index, pixels: stdout.subarray(at * size, (at + 1) * size) }));
    const ground = (index: number): number[] => pixel(decoded.find(entry => entry.index === index)?.pixels ?? new Uint8Array(), GROUND_SPOT.x, GROUND_SPOT.y, 804, 3);
    const near = (actual: number[], wantedColor: number[]): boolean => actual.every((value, channel) => Math.abs(value - (wantedColor[channel] ?? 0)) <= 6);
    expect([near(ground(299), NIGHT), near(ground(300), SIENNA), near(ground(749), NIGHT), near(ground(750), PAPER)]).toEqual([true, true, true, true]);
    const drawn = frame(400 * 1000 / 30), mid = decoded.find(entry => entry.index === 400)?.pixels ?? new Uint8Array();
    let difference = 0;
    for (let at = 0; at < 804 * 1748; at += 7) {
      for (let channel = 0; channel < 3; channel++) difference += Math.abs((drawn[at * 4 + channel] ?? 0) - (mid[at * 3 + channel] ?? 0));
    }
    expect(difference / (Math.ceil(804 * 1748 / 7) * 3)).toBeLessThan(4);
  });
});
