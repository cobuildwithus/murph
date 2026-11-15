import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  RECAP_VIDEO_MAX_BYTES, RecapVideoRefusal, buildRecapVideoTimeline, createRecapVideoRenderer, encodeRecapVideo, posterWords, videoKbpsCeiling,
  type RecapVideoInput, type RecapVideoPage, type RecapVideoRenderer,
} from "../src/index.js";
import { registerRecapFonts, textWidth, wrapText, type TextStyle } from "../src/surface.js";
import { FIXTURE_PAGES, writeFixture } from "./fixture.js";

const run = promisify(execFile);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

const NIGHT = [0x1c, 0x19, 0x15], SIENNA = [0x8b, 0x5d, 0x3f], SLATE = [0x4f, 0x6b, 0x78], PAPER = [0xff, 0xff, 0xff];
/** A spot low on the page that no page draws on, so it shows the page's ground. */
const GROUND_SPOT = { x: 20, y: 1716 };

let directory: string;
let input: RecapVideoInput;
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
  it("puts five-second story pages on the score's cues, the song to its last word, then the last screen to the end of the music", () => {
    expect(renderer.timeline.entries.map(entry => [entry.kind, entry.fromMs, entry.toMs])).toEqual([
      ["cover", 0, 5000], ["print", 5000, 10000], ["scene", 10000, 15000], ["print", 15000, 20000], ["scene", 20000, 25000],
      ["superlative", 25000, 30000], ["song", 30000, 45330], ["poster", 45330, 51040],
    ]);
    expect(renderer.timeline.durationMs).toBe(51040);
    expect(renderer.timeline.frameCount).toBe(1531);
  });

  it("keeps the same pages when the music is the song alone", async () => {
    const song = await writeFixture(path.join(directory, "song"), "song");
    expect(song.soundtrack.startsAtMs).toBe(30000);
    expect(buildRecapVideoTimeline(song)).toEqual(renderer.timeline);
  });

  it("holds the last screen five seconds when the song is sung to its end", () => {
    const late = withPages(pages => pages.map(page => page.song?.lines
      ? { ...page, song: { ...page.song, lines: page.song.lines.map((line, index, all) => index === all.length - 1 ? { words: line.words.map(word => ({ ...word, endMs: 19900 })) } : line) } }
      : page));
    const timeline = buildRecapVideoTimeline(late);
    expect(timeline.entries.at(-1)).toMatchObject({ kind: "poster", fromMs: 50250, toMs: 55250 });
  });

  it("refuses a recap without a song, and music whose cues do not fit", () => {
    expect(() => buildRecapVideoTimeline(withPages(pages => pages.filter(page => page.kind !== "song")))).toThrowError(expect.objectContaining({ code: "missing_song" }));
    expect(() => buildRecapVideoTimeline({ ...input, soundtrack: { ...input.soundtrack, cuesMs: [0, 5000] } })).toThrowError(expect.objectContaining({ code: "invalid_soundtrack" }));
    expect(() => buildRecapVideoTimeline(withPages(pages => [...pages, { id: "x", kind: "filmRolls", background: "night", blocks: [] }]))).toThrowError(expect.objectContaining({ code: "unsupported_page" }));
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
    const card = 25000, poster = 45330;
    expect(renderer.frameState(card + 1100).pieces.map(piece => [piece.name, piece.opacity === 1])).toEqual([
      ["face", true], ["name", true], ["lead", true], ["title", false], ["rule", false], ["line", false],
    ]);
    expect(renderer.frameState(card + 2300).pieces.every(piece => piece.opacity === 1)).toBe(true);
    expect(renderer.frameState(poster + 1000).pieces.map(piece => [piece.name, piece.opacity === 1])).toEqual([
      ["score", true], ["title", false], ["stake", false], ["footer", false],
    ]);
    expect(renderer.frameState(poster + 3000).pieces.every(piece => piece.opacity === 1)).toBe(true);
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
    const song = 30000, words = FIXTURE_PAGES.find(page => page.song)?.song?.lines?.flatMap(line => line.words) ?? [];
    expect(renderer.frameState(song).sungWords).toBe(0);
    expect(renderer.frameState(song + (words[3]?.startMs ?? 0)).sungWords).toBe(4);
    expect(renderer.frameState(song + 15000).sungWords).toBe(words.length);
    const pane = { x: 60, y: 1470, width: 680, height: 278 };
    const lit = (ms: number): number => count(frame(song + ms), pane, [0xff, 0xfc, 0xf6]);
    expect(lit(200)).toBeLessThan(lit(1200));
    expect(lit(1200)).toBeLessThan(lit(1900));
  });

  it("lights whole lines through an untimed song", async () => {
    const untimed = await createRecapVideoRenderer(withPages(pages => pages.map(page => page.song ? { ...page, song: { title: page.song.title, lyrics: page.song.lyrics } } : page)));
    const song = untimed.timeline.entries.find(entry => entry.kind === "song");
    expect(untimed.frameState((song?.fromMs ?? 0) + 100).sungWords).toBe(8);
    expect(untimed.frameState((song?.fromMs ?? 0) + 19000).sungWords).toBe(49);
  });

  it("speaks of both players in the third person on the last screen", () => {
    expect(posterWords(input)).toEqual({ title: "Leo wins.", owes: "Ava owes Leo" });
  });
});

describe("refusals", () => {
  const refuses = async (changed: RecapVideoInput, code: string): Promise<void> => {
    await expect(createRecapVideoRenderer(changed)).rejects.toSatisfy(error => error instanceof RecapVideoRefusal && error.code === code);
  };
  const withBlock = (pageId: string, block: RecapVideoPage["blocks"][number]): RecapVideoInput =>
    withPages(pages => pages.map(page => page.id === pageId ? { ...page, blocks: [block, ...page.blocks.slice(1)] } : page));

  it("refuses what it has no drawing for, instead of drawing it wrong", async () => {
    await refuses(withBlock("page-1", { kind: "stat", statValue: "7", text: "days" }), "unsupported_block");
    await refuses(withPages(pages => pages.map(page => page.id === "page-3" ? { ...page, blocks: [{ kind: "contactSheet", entryIds: ["entry-leo-1", "entry-leo-4", "entry-ava-4"] }] } : page)), "unsupported_block");
    await refuses({ ...input, outcome: { kind: "even" } }, "unsupported_outcome");
    await refuses({ ...input, stake: { kind: "punishment", title: "Cold plunge at dawn" } }, "unsupported_stake");
  });

  it("refuses text its fonts cannot draw, and words that do not fit their page", async () => {
    await refuses(withBlock("page-1", { kind: "headline", text: "Leo's first post was a yoga mat \u{1F9D8}" }), "unsupported_text");
    await refuses(withBlock("page-1", { kind: "headline", text: Array.from({ length: 60 }, () => "Leo kept posting the mat").join(" ") }), "does_not_fit");
    await refuses({ ...input, stake: { kind: "prize", title: "A very long weekend away somewhere warm" } }, "does_not_fit");
  });

  it("refuses a page whose picture is missing", async () => {
    await refuses({ ...input, photos: {} }, "missing_picture");
  });

  it("falls back from a failed scene to its photo, or to its words alone", async () => {
    const failed = await createRecapVideoRenderer({ ...input, scenes: { "page-0": input.scenes["page-0"] ?? "" } });
    // The fourth page falls back to a print of its photo; the second scene has only its words.
    expect(failed.frameState(22000).pieces.map(piece => piece.name)).toEqual(["setup", "picture", "payoff"]);
    expect(failed.frameState(12000).pieces.map(piece => piece.name)).toEqual(["setup", "payoff"]);
  });
});

describe("the encoder", () => {
  it("refuses, instead of waiting, when ffmpeg cannot be started", async () => {
    await expect(encodeRecapVideo(renderer, input.soundtrack, path.join(directory, "never.mp4"), { ffmpegPath: path.join(directory, "no-such-ffmpeg") }))
      .rejects.toSatisfy(error => error instanceof RecapVideoRefusal && error.code === "encoder_failed");
  });
});

describe("fonts", () => {
  // Advances come from the font files alone. A missing or substituted face, or a changed optical size, moves these and every line break with them.
  const advances: [string, TextStyle, number][] = [
    ["Leo wins.", { font: "display", weight: 600, size: 44, lineHeight: 53, tracking: -0.88, color: "#000" }, 192.39],
    ["The Mat Takes the Stand", { font: "display", weight: 700, size: 30, lineHeight: 41, color: "#000" }, 367.91],
    ["“keep your charity”", { font: "display", weight: 400, italic: true, size: 28, lineHeight: 38, color: "#000" }, 254.98],
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
    ({ bytes } = await encodeRecapVideo(renderer, input.soundtrack, file, { preset: "veryfast" }));
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
    const wanted = [299, 300, 749, 750, 400];
    const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-vf", `select='${wanted.map(index => `eq(n\\,${index})`).join("+")}'`, "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
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
