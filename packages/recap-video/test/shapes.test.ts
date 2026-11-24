import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RecapVideoRefusal, createRecapVideoRenderer, type RecapVideoInput } from "../src/index.js";
import { slantRuns } from "../src/surface.js";
import { writeFixture, type FixtureExtras } from "./fixture.js";
import { SHAPES } from "./shapes.js";

// The plan's visual gate, in CI: every shape a recap can take is laid out and drawn, and its structure is compared
// with what was recorded when the frames were checked by eye beside the app. A change to any page's layout shows here.

let directory: string;
let base: RecapVideoInput & { extras: FixtureExtras };

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "recap-video-shapes-"));
  base = await writeFixture(directory);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const tenth = (value: number): number => Math.round(value * 10) / 10;

describe("every shape a recap can take", () => {
  for (const shape of SHAPES) {
    it(`draws ${shape.name}`, async () => {
      const renderer = await createRecapVideoRenderer(shape.build(base));
      const entry = renderer.timeline.entries.find(found => found.page.id === shape.page || (shape.page === "result" && found.kind === "poster"));
      if (!entry) throw new Error(`${shape.name} has no page ${shape.page}.`);
      const ms = entry.fromMs + (shape.atMs ?? Math.min(4600, entry.toMs - entry.fromMs - 40)), state = renderer.frameState(ms);
      // Everything on the page has arrived, sits on the page, and the frame draws.
      expect(state.pieces.every(piece => piece.opacity === 1)).toBe(true);
      const pixels = renderer.drawFrame(ms).data();
      expect(pixels.length).toBe(804 * 1748 * 4);
      expect(state.pieces.map(piece => `${piece.name} ${tenth(piece.box.x)},${tenth(piece.box.y)} ${tenth(piece.box.width)}x${tenth(piece.box.height)}`)).toMatchSnapshot();
    });
  }

  it("covers each ground, each picture and each last screen", () => {
    const names = SHAPES.map(shape => shape.name).join(" ");
    for (const wanted of ["night", "paper", "sage", "sienna", "slate", "pair", "sheet", "missed", "unfinished", "stat", "kicker", "quote-long", "song-untimed", "prize", "punishment", "both-win", "even"]) {
      expect(names).toContain(wanted);
    }
  });
});

describe("what the borrowed faces draw", () => {
  const refuses = async (changed: RecapVideoInput, code: string): Promise<void> => {
    await expect(createRecapVideoRenderer(changed)).rejects.toSatisfy(error => error instanceof RecapVideoRefusal && error.code === code);
  };
  const headline = (text: string): RecapVideoInput => ({ ...base, show: { ...base.show, pages: base.show.pages.map(page => page.id === "page-1" ? { ...page, blocks: [{ kind: "headline", text }, ...page.blocks.slice(1)] } : page) } });

  it("draws emoji, and Greek and Cyrillic letters, beside the recap's own faces", async () => {
    for (const text of ["Leo's mat \u{1F9D8}\u{200D}\u{2642}\u{FE0F} again", "Leo's mat \u{1F64F}\u{1F3FD}", "Лео posted the mat", "Λέων posted the mat", "Léo posted the mat à la carte"]) {
      const renderer = await createRecapVideoRenderer(headline(text));
      expect(renderer.frameState(8000).pieces.map(piece => piece.name), text).toEqual(["setup", "picture", "payoff"]);
    }
    // An emoji is drawn in color: the first frame of a page of them has pixels no ink or ground has.
    const emoji = await createRecapVideoRenderer(headline("\u{1F7E5}\u{1F7E5}\u{1F7E5}"));
    const pixels = emoji.drawFrame(6000).data();
    let red = 0;
    for (let at = 0; at < pixels.length; at += 4) if ((pixels[at] ?? 0) > 200 && (pixels[at + 1] ?? 0) < 90 && (pixels[at + 2] ?? 0) < 90) red++;
    expect(red).toBeGreaterThan(1500);
  });

  it("leans only the display face's own letters in italics, even inside a word", () => {
    expect(slantRuns("“nice\u{1F602}” day", "display")).toEqual([{ text: "“nice", leans: true }, { text: "\u{1F602}", leans: false }, { text: "” day", leans: true }]);
    expect(slantRuns("Лео said so \u{1F64F}\u{1F3FD} twice", "display").map(run => run.leans)).toEqual([false, true, false, true]);
  });

  it("refuses a joiner with no emoji to join, and a dare of any length in an alphabet it cannot set", async () => {
    // On its own, or after a letter, the mark that joins emoji would be a block with nothing to see.
    for (const text of ["\u{200D}", "\u{FE0F}", "Leo\u{FE0F} posted", "5\u{FE0F}\u{20E3} days"]) await refuses(headline(text), "unsupported_text");
    await refuses({ ...base, stake: { kind: "punishment", title: "ヨガ" } }, "unsupported_text");
  });

  it("refuses alphabets it cannot set correctly, whatever its faces cover", async () => {
    // Right to left, or written without spaces, or shaped in ways this renderer does not lay out.
    for (const text of ["مرحبا Leo", "שלום Leo", "レオのヨガマット", "레오의 요가 매트", "ลีโอ", "लियो", "Leo\u{202E}oeL"]) await refuses(headline(text), "unsupported_text");
    await refuses({ ...base, players: { ...base.players, "member-leo": { name: "李" } } }, "unsupported_text");
  });

  it("types a punishment slip on one line, or smaller on ruled lines, and cuts a dare past three of them short", async () => {
    const dare = (title: string): RecapVideoInput => ({ ...base, stake: { kind: "punishment", title } });
    const stakeBox = async (title: string): Promise<number> => (await createRecapVideoRenderer(dare(title))).frameState(50000).pieces.find(piece => piece.name === "stake")?.box.height ?? 0;
    const short = await stakeBox("Cold plunge at dawn"), two = await stakeBox("Let the winner pick your outfit for a day"), three = await stakeBox("Sing the national anthem at the next family dinner, standing on a chair");
    // One line is 34 points; ruled lines are 30.5 each. These are the lines the app's own text breaks these dares onto.
    expect([two - short, three - short]).toEqual([27, 57.5]);
    expect(await stakeBox(Array.from({ length: 12 }, () => "sing the national anthem").join(" "))).toBe(three);
  });
});
