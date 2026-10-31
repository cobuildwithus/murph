import { describe, expect, it } from "vitest";
import type { HostedGameRecap } from "@murphai/hosted-execution/runtime-control";
import { gameRecapToolResult, validateGameRecap } from "@/src/lib/game/recap";

const players = ["Ava", "Leo"];
const entries = [
  { entryId: "entry_photo", kind: "photo", playerName: "Ava", text: null, visibleToBoth: true },
  { entryId: "entry_words", kind: "words", playerName: "Leo", text: "spiritually doing pushups", visibleToBoth: true },
  { entryId: "entry_hidden", kind: "photo", playerName: "Leo", text: null, visibleToBoth: false },
];
const valid: HostedGameRecap = { pages: [
  { background: "paper", blocks: [{ kind: "headline", text: "Breakfast changed hands" }, { kind: "photo", entryIds: ["entry_photo"], style: "fullBleed" }] },
  { background: "slate", blocks: [{ kind: "quote", quote: { who: "Leo", text: "spiritually doing pushups" } }] },
  { background: "sage", blocks: [{ kind: "stat", statValue: "4", text: "days Ava showed up" }] },
], scoreLine: "Leo owes Ava breakfast in bed.", chatLine: "Sauna citizenship held. Open the week for the paperwork." };

describe("game recap validation", () => {
  it("accepts the fixed kit and returns the eval success text", () => {
    expect(validateGameRecap({ recap: valid, players, entries })).toEqual([]);
    expect(gameRecapToolResult([])).toBe("ok: saved. The players will see this recap.");
  });
  it("returns fixable eval messages for authority, visual, copy and score failures", () => {
    const recap: HostedGameRecap = { pages: [
      { background: "night", blocks: [{ kind: "photo", entryIds: ["entry_hidden"] }] },
      { background: "sage", blocks: [{ kind: "photo", entryIds: ["entry_words"] }] },
    ], scoreLine: "Ava 4-3 Leo won the ticket!", chatLine: "The purple mat prevailed. Open the week for the evidence." };
    const errors = validateGameRecap({ recap, players, entries });
    expect(gameRecapToolResult(errors)).toContain("Not saved. Fix these and call write_recap again:\n- pages: 2; write 3 to 7.");
    expect(errors).toContain("page 1 block 1 (photo): entry entry_hidden isn't in this game.");
    expect(errors).toContain("page 2 block 1 (photo): entry_words is a words post; show words with a quote block.");
    expect(errors).toContain("scoreLine: the card already shows the score; land the result and who owes what instead.");
  });
  it("keeps shared copy in third person and names who owes whom", () => {
    const recap: HostedGameRecap = { ...valid,
      pages: valid.pages.map((page, index) => index === 0 ? { ...page, blocks: [{ kind: "headline", text: "Your breakfast changed hands" }] } : page),
      scoreLine: "You owe breakfast in bed.",
    };
    expect(validateGameRecap({ recap, players, entries })).toEqual(expect.arrayContaining([
      "page 1 block 1: both players read this; write about them by name, not you.",
      "scoreLine: name who owes whom.",
      "scoreLine: write about them by name, not you.",
    ]));
  });
  it("checks score copy against the canonical settled winner and tie", () => {
    const result = [{ memberId: "a", name: "Ava", score: 4 }, { memberId: "l", name: "Leo", score: 3 }];
    expect(validateGameRecap({ recap: { ...valid, scoreLine: "Ava owes Leo breakfast in bed." }, players, entries, result }))
      .toContain("scoreLine: Leo, the settled loser, must be on the owing side to Ava.");
    expect(validateGameRecap({ recap: valid, players, entries, result: result.map((score) => ({ ...score, score: 3 })) }))
      .toContain("scoreLine: the settled result is a tie; name the players and describe the tie without owe, owes, owed or owing.");
    const tie = result.map((score) => ({ ...score, score: 3 }));
    expect(validateGameRecap({ recap: { ...valid, scoreLine: "Ava and Leo tied. Nobody owes breakfast." }, players, entries, result: tie }))
      .toContain("scoreLine: the settled result is a tie; name the players and describe the tie without owe, owes, owed or owing.");
    expect(validateGameRecap({ recap: { ...valid, scoreLine: "Ava and Leo tied; breakfast stays unclaimed." }, players, entries, result: tie })).toEqual([]);
    expect(validateGameRecap({ recap: valid, players, entries, result })).toEqual([]);
  });
  it("ports quote density, chat-line originality and exact quote checks", () => {
    const recap: HostedGameRecap = { pages: [
      { background: "night", blocks: [{ kind: "headline", text: "Ava opened on the purple mat" }, { kind: "quote", quote: { who: "Ava", text: "mat jurisdiction" } }, { kind: "quote", quote: { who: "Leo", text: "spiritually doing pushups" } }] },
      { background: "sage", blocks: [{ kind: "quote", quote: { who: "Leo", text: "spiritually doing pushups" } }, { kind: "quote", quote: { who: "Leo", text: "spiritually doing pushups" } }] },
      { background: "slate", blocks: [{ kind: "quote", quote: { who: "Ava", text: "not something Ava said" } }] },
      { background: "paper", blocks: [{ kind: "headline", text: "Leo closed the week in theory" }] },
    ], scoreLine: "Leo owes Ava breakfast in bed.", chatLine: "Sauna citizenship held. Open the week for the paperwork." };
    expect(validateGameRecap({ recap, players, entries,
      chatMessages: [{ playerName: "Ava", text: "mat jurisdiction remains settled" }],
      priorChatLines: ["Sauna citizenship held. Earlier evidence arrived."],
    })).toEqual(expect.arrayContaining([
      "Only one page can stack several quotes (a back-and-forth). Let your headlines carry the other pages.",
      "Quotes on 3 of 4 pages; keep them to about half and let your own lines carry the rest.",
      "page 3 block 1 (quote): quote isn't something Ava said in the chat or posted. Copy it exactly.",
      "chatLine: repeats \"sauna citizenship held\" from an earlier week's chat line in the lore; say it a new way.",
    ]));
  });
  it("rejects stock chat lines and second-person page copy with the eval messages", () => {
    const recap: HostedGameRecap = { ...valid,
      pages: valid.pages.map((page, index) => index === 2 ? { ...page, blocks: [{ kind: "stat", statValue: "4", text: "days you showed up" }] } : page),
      chatLine: "The recap's up! 🏆",
    };
    expect(validateGameRecap({ recap, players, entries })).toEqual(expect.arrayContaining([
      "page 3 block 1: both players read this; write about them by name, not you.",
      "chatLine: no exclamation marks.",
      "chatLine: no emoji.",
      "chatLine: lead with the week's funniest moment, not with the recap being ready.",
      "chatLine: that ending is a stock phrase; point them to the recap in your own words.",
    ]));
  });
});
