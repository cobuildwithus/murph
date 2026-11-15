import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { stakeArtFile, stakeArtId } from "../src/stake-art.js";

interface Catalog { stakes: { id: string; sha256: string }[]; ideas: { title: string; art: string }[] }
/** What the iOS app's own picking code answered for each prize: [the prize as typed, the drawing's id]. */
interface Parity { pairs: [string, string][] }

const ART = fileURLToPath(new URL("../assets/stake-art/", import.meta.url));
const GIFT = "a-tiny-surprise-gift";
const catalog = JSON.parse(readFileSync(path.join(ART, "catalog.json"), "utf8")) as Catalog;
const parity = JSON.parse(readFileSync(new URL("./stake-art-parity.json", import.meta.url), "utf8")) as Parity;

describe("prize art", () => {
  it("picks the drawing the iOS app picks, for every prize the app's code was asked about", () => {
    expect(parity.pairs.length).toBeGreaterThanOrEqual(5000);
    const wrong = parity.pairs.filter(([prize, id]) => stakeArtId(prize) !== id).map(([prize, id]) => ({ prize, app: id, here: stakeArtId(prize) }));
    expect({ wrong: wrong.length, first: wrong.slice(0, 20) }).toEqual({ wrong: 0, first: [] });
    // The app's answers reach every drawing, so none is here untested.
    expect(new Set(parity.pairs.map(([, id]) => id))).toEqual(new Set(catalog.stakes.map(stake => stake.id)));
  });

  it("looks for a suggested prize, then a drawing's own title, then shared words, then gives the gift", () => {
    // A suggested prize names its drawing, whatever its words are.
    expect(stakeArtId("First dibs on leftovers")).toBe("a-home-cooked-meal");
    expect(stakeArtId("tacos on the loser")).toBe("tacos");
    // A drawing's own title, with or without its article, in any case.
    expect(stakeArtId("A massage")).toBe("a-massage");
    expect(stakeArtId("THE MASSAGE!")).toBe("a-massage");
    // Words of one's own find a drawing by whole words only: an espresso is a coffee, a theater is not a tea.
    expect(stakeArtId("bring me an espresso")).toBe("coffee");
    expect(stakeArtId("a backrub")).toBe("a-massage");
    expect(stakeArtId("theater")).toBe("a-cinema-outing");
    for (const prize of ["cartography", "something for you", "$20", "", "   "]) expect(stakeArtId(prize), prize).toBe(GIFT);
  });

  it("holds every drawing the catalog lists, unchanged, and no other", () => {
    const ids = catalog.stakes.map(stake => stake.id);
    for (const { id, sha256 } of catalog.stakes) {
      expect(createHash("sha256").update(readFileSync(path.join(ART, `${id}.svg`))).digest("hex"), id).toBe(sha256);
    }
    expect(readdirSync(ART).filter(name => name !== "catalog.json").sort()).toEqual(ids.map(id => `${id}.svg`).sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(catalog.ideas.filter(idea => !ids.includes(idea.art))).toEqual([]);
    expect(ids).toContain(GIFT);
  });

  it("finds the gift's file for a prize that matches nothing", () => {
    const file = stakeArtFile("a week of gloating in iambic pentameter");
    expect(path.isAbsolute(file)).toBe(true);
    expect(path.basename(file)).toBe(`${GIFT}.svg`);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(/^<svg /u);
  });
});
