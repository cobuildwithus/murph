import type { RecapVideoInput, RecapVideoPage } from "../src/index.js";
import { FIXTURE_PAGES, FIXTURE_SCORE, withCues, type FixtureExtras } from "./fixture.js";

/**
 * Every shape a recap can take that the renderer draws, one frame each: the
 * same list feeds the structure check in CI and the proof sheet. Each starts
 * from the usual show and changes one thing. Words and names are invented.
 */
export interface Shape {
  name: string;
  /** The page to look at. */
  page: string;
  /** How far into that page, once everything on it has arrived. */
  atMs?: number;
  build(base: RecapVideoInput & { extras: FixtureExtras }): RecapVideoInput;
}

type Base = RecapVideoInput & { extras: FixtureExtras };
type Block = RecapVideoPage["blocks"][number];
/** The usual show with its pages changed, and a score to fit however many story pages that leaves. */
const pages = (base: Base, change: (pages: RecapVideoPage[]) => RecapVideoPage[]): RecapVideoInput => {
  const changed = change(structuredClone(FIXTURE_PAGES)), story = changed.filter(page => page.kind !== "song" && page.kind !== "result").length;
  const origin = story * 5000 + 88;
  return { ...base, show: { ...base.show, pages: withCues(changed, origin + 212) }, score: { ...base.score, durationMs: origin + FIXTURE_SCORE.songMs } };
};
const onPage = (base: Base, id: string, change: (page: RecapVideoPage) => RecapVideoPage): RecapVideoInput => pages(base, all => all.map(page => page.id === id ? change(page) : page));
const withBlocks = (base: Base, id: string, blocks: Block[], more: Partial<RecapVideoPage> = {}): RecapVideoInput => onPage(base, id, page => ({ ...page, ...more, blocks }));
const withoutScenes = (base: Base, ...ids: string[]): RecapVideoInput["scenes"] => Object.fromEntries(Object.entries(base.scenes).filter(([id]) => !ids.includes(id)));
const even = (everyDay: boolean, scores: number): Partial<RecapVideoInput> => ({ outcome: { kind: "even", everyDay }, scores: { "member-leo": scores, "member-ava": scores } });
const SHEET = ["entry-leo-1", "entry-leo-2", "entry-leo-3", "entry-leo-4", "entry-leo-5", "entry-ava-1", "entry-ava-2", "entry-ava-3", "entry-ava-4"];
const sheet = (count: number): Block[] => [{ kind: "headline", text: "Leo posted the mat every single day." }, { kind: "contactSheet", entryIds: SHEET.slice(0, count) }, { kind: "headline", text: "Same mat. Same corner." }];
const LONG_QUOTE = "I was going to do it right after dinner and then dinner went long and then it was tomorrow";

export const SHAPES: Shape[] = [
  // The usual show: the pages the approved sample has.
  { name: "cover", page: "page-0", build: base => base },
  { name: "print", page: "page-1", build: base => base },
  { name: "scene-quote-sienna", page: "page-2", build: base => base },
  { name: "pair-slate", page: "page-3", build: base => base },
  { name: "scene-night", page: "page-4", build: base => base },
  { name: "card-initial", page: "card-member-leo", build: base => base },
  { name: "song-timed", page: "song", atMs: 6000, build: base => base },
  { name: "stake-prize", page: "result", build: base => base },

  // Cards: none, one for a player with a photo, two.
  { name: "card-photo", page: "card-member-ava", build: base => pages(base, all => all.map(page => page.kind === "superlative" ? { ...page, id: "card-member-ava", card: { memberId: "member-ava", title: "ask for a recount", line: "Ava wanted a person on the mat, in writing." } } : page)) },
  { name: "cards-two", page: "card-member-ava", build: base => pages(base, all => all.flatMap(page => page.kind === "superlative" ? [page, { ...page, id: "card-member-ava", card: { memberId: "member-ava", title: "ask for a recount", line: "Ava wanted a person on the mat, in writing." } }] : [page])) },
  { name: "cards-none", page: "song", atMs: 6000, build: base => pages(base, all => all.filter(page => page.kind !== "superlative")) },
  { name: "card-long-title", page: "card-member-leo", build: base => onPage(base, "card-member-leo", page => ({ ...page, card: { memberId: "member-leo", title: "photograph the same yoga mat from four slightly different angles", line: "Leo answered one doubt with three more photos of the same mat, and then a fourth for the record." } })) },

  // Covers: a long title, a failed scene with and without a photo to stand in, the label the app would draw.
  { name: "cover-long-title", page: "page-0", build: base => withBlocks(base, "page-0", [{ kind: "headline", text: "The Long and Winding Trial of the Yoga Mat" }]) },
  { name: "cover-failed-photo", page: "page-0", build: base => ({ ...base, scenes: withoutScenes(base, "page-0") }) },
  { name: "cover-failed-words", page: "page-0", build: base => ({ ...onPage(base, "page-0", page => ({ ...page, fallback: { kind: "text", entryIds: [] } })), scenes: withoutScenes(base, "page-0") }) },
  { name: "cover-label", page: "page-0", build: base => withBlocks(base, "page-0", [{ kind: "kicker", text: "Week three" }, { kind: "headline", text: "The Mat Takes the Stand" }]) },

  // Story pages: words alone, failed scenes, kicker, stat, long quote, each ground.
  { name: "words-alone-paper", page: "page-1", build: base => withBlocks(base, "page-1", [{ kind: "headline", text: "Ava missed Wednesday." }, { kind: "quote", quote: { who: "Ava", text: "it was raining inside" } }, { kind: "headline", text: "It was not raining inside." }], { kind: "text", background: "paper" }) },
  { name: "scene-failed-photo", page: "page-4", build: base => ({ ...base, scenes: withoutScenes(base, "page-4") }) },
  { name: "scene-failed-words", page: "page-2", build: base => ({ ...base, scenes: withoutScenes(base, "page-2") }) },
  { name: "kicker-sage", page: "page-1", build: base => withBlocks(base, "page-1", [{ kind: "kicker", text: "Wednesday" }, { kind: "headline", text: "Leo's first post was a yoga mat." }, { kind: "photo", entryIds: ["entry-leo-1"] }, { kind: "headline", text: "Ava wanted a person on it." }], { background: "sage" }) },
  { name: "stat-paper", page: "page-1", build: base => withBlocks(base, "page-1", [{ kind: "stat", statValue: "11:58", text: "when Ava posted, every single night" }, { kind: "headline", text: "Two minutes to spare, seven times." }], { kind: "text", background: "paper" }) },
  { name: "stat-long", page: "page-1", build: base => withBlocks(base, "page-1", [{ kind: "stat", statValue: "1,204 reps", text: "between the two of them" }], { kind: "text" }) },
  { name: "quote-long", page: "page-2", build: base => withBlocks(base, "page-2", [{ kind: "headline", text: "Ava explained Wednesday." }, { kind: "quote", quote: { who: "Ava", text: LONG_QUOTE, date: "Wed" } }]) },
  { name: "photo-wide", page: "page-1", build: base => withBlocks(base, "page-1", [{ kind: "headline", text: "Ava's proof was a ceiling." }, { kind: "photo", entryIds: ["entry-ava-4"] }, { kind: "headline", text: "A nice ceiling." }]) },

  // Real posts: a missed print, a day given back, a pair with one missed, contact sheets.
  { name: "print-missed", page: "page-1", build: base => ({ ...base, photos: { ...base.photos, "entry-leo-1": null } }) },
  { name: "print-unfinished", page: "page-1", build: base => ({ ...base, unfinished: ["entry-leo-1"] }) },
  { name: "pair-missed", page: "page-3", build: base => ({ ...base, photos: { ...base.photos, "entry-ava-4": null } }) },
  { name: "sheet-3", page: "page-3", build: base => withBlocks(base, "page-3", sheet(3)) },
  { name: "sheet-4", page: "page-3", build: base => withBlocks(base, "page-3", sheet(4)) },
  { name: "sheet-5", page: "page-3", build: base => withBlocks(base, "page-3", sheet(5)) },
  { name: "sheet-6", page: "page-3", build: base => withBlocks(base, "page-3", sheet(6)) },
  { name: "sheet-7", page: "page-3", build: base => withBlocks(base, "page-3", sheet(7)) },
  { name: "sheet-9", page: "page-3", build: base => withBlocks(base, "page-3", sheet(9)) },

  // The song: untimed lyrics, a title that shrinks onto two lines.
  { name: "song-untimed", page: "song", atMs: 6000, build: base => onPage(base, "song", page => page.song ? { ...page, song: { title: page.song.title, lyrics: page.song.lyrics } } : page) },
  { name: "song-long-title", page: "song", atMs: 6000, build: base => onPage(base, "song", page => page.song ? { ...page, song: { ...page.song, title: "The Ballad of the Mat That Took the Stand Twice" } } : page) },

  // The last screen: every stake, both faces, long names, prizes and dares, two-digit scores.
  { name: "stake-prize-long", page: "result", build: base => ({ ...base, stake: { kind: "prize", title: "A Night off Dishes" } }) },
  { name: "stake-prize-own-words", page: "result", build: base => ({ ...base, stake: { kind: "prize", title: "Loser Buys Tacos" } }) },
  { name: "stake-prize-cut", page: "result", build: base => ({ ...base, stake: { kind: "prize", title: "A full weekend of pottery classes at the studio downtown with lunch and a new apron" } }) },
  { name: "stake-both-win", page: "result", build: base => ({ ...base, ...even(true, 7), stake: { kind: "bothWin", title: "Dinner Out Together" } }) },
  { name: "stake-even", page: "result", build: base => ({ ...base, ...even(false, 6), stake: { kind: "none" } }) },
  { name: "stake-even-every-day", page: "result", build: base => ({ ...base, ...even(true, 7), stake: { kind: "none" } }) },
  { name: "stake-punishment", page: "result", build: base => ({ ...base, stake: { kind: "punishment", title: "Cold plunge at dawn" } }) },
  { name: "stake-punishment-long", page: "result", build: base => ({ ...base, stake: { kind: "punishment", title: "Sing the national anthem at the next family dinner, standing on a chair" } }) },
  { name: "result-long-names", page: "result", build: base => ({ ...base, players: { "member-ava": { name: "Josephine" }, "member-leo": { name: "Bartholomew", avatarPath: base.extras.leoFace } } }) },
  { name: "result-two-digit-score", page: "result", build: base => ({ ...base, scores: { "member-leo": 28, "member-ava": 26 } }) },
  { name: "result-no-cover", page: "result", build: base => ({ ...onPage(base, "page-0", page => ({ ...page, fallback: { kind: "text", entryIds: [] } })), scenes: withoutScenes(base, "page-0") }) },

  // Emoji, and names and words in Cyrillic: drawn from the borrowed faces.
  { name: "emoji-quote-name", page: "page-2", build: base => ({ ...withBlocks(base, "page-2", [{ kind: "headline", text: "Leo offered Ava a do-over." }, { kind: "quote", quote: { who: "Ava \u{1F33B}", text: "keep your charity \u{1F602}\u{1F64F}\u{1F3FD}" } }]), players: { ...base.players, "member-ava": { ...base.players["member-ava"], name: "Ava \u{1F33B}" } } }) },
  { name: "emoji-cover-card", page: "card-member-leo", build: base => onPage({ ...base, players: { ...base.players, "member-leo": { name: "Лео" } } }, "card-member-leo", page => ({ ...page, card: { memberId: "member-leo", title: "bring a lawyer to yoga \u{1F9D8}\u{200D}\u{2642}\u{FE0F}", line: "Лео answered one doubt with three more photos of the same mat \u{1F4F8}." } })) },
];
