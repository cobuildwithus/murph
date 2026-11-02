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
  it.each([3, 4])("accepts an absent scoreLine for a settled result with first score %s", (score) => {
    const recap = { pages: valid.pages, chatLine: valid.chatLine };
    const result = [{ memberId: "a", name: "Ava", score }, { memberId: "l", name: "Leo", score: 3 }];
    expect(validateGameRecap({ recap, players, entries, result })).toEqual([]);
  });
  it.each([
    [4, 3, "Ava won 4-3. Leo brought a laundry basket to training."],
    [3, 4, "Leo won 4 to 3. Ava kept the mat on payroll."],
    [5, 5, "The week ended in a tie, 5–5. Leo trained beside the laundry."],
    [5, 5, "Game over, tied 5–5. Leo called an 11:58 pm post pacing."],
    [0, 0, "Game over, a 0:0 tie. Ava's mat had a quiet week."],
  ])("accepts the canonical result %s to %s: %s", (a, b, chatLine) => {
    const result = [{ memberId: "a", name: "Ava", score: a }, { memberId: "l", name: "Leo", score: b }];
    expect(validateGameRecap({ recap: { pages: valid.pages, chatLine }, players, entries, result })).toEqual([]);
  });
  it.each(["Ava won 6-3.", "Game over, tied 4 to 4.", "Ava won 4—2.", "Final score 4:3. Actually, 7-6."])("rejects invented scores: %s", (chatLine) => {
    const result = [{ memberId: "a", name: "Ava", score: 4 }, { memberId: "l", name: "Leo", score: 3 }];
    expect(validateGameRecap({ recap: { pages: valid.pages, chatLine }, players, entries, result }))
      .toContain("chatLine: score must match the settled result (3 to 4).");
  });
  it("rejects a non-tie score for a canonical tie", () => {
    const result = [{ memberId: "a", name: "Ava", score: 5 }, { memberId: "l", name: "Leo", score: 5 }];
    expect(validateGameRecap({ recap: { pages: valid.pages, chatLine: "Ava won 5-4. The mat earned tenure." }, players, entries, result }))
      .toContain("chatLine: score must match the settled result (5 to 5).");
  });
  it("exempts only the opening result from earlier-line trigrams", () => {
    const priorChatLines = ["The week ended in a tie, 5 to 5. The laundry basket supervised."];
    const result = [{ memberId: "a", name: "Ava", score: 5 }, { memberId: "l", name: "Leo", score: 5 }];
    const check = (chatLine: string) => validateGameRecap({ recap: { pages: valid.pages, chatLine }, players, entries, result, priorChatLines });
    expect(check("The week ended in a tie, 5 to 5. Ava gave the mat tenure.")).toEqual([]);
    expect(check("The week ended in a tie, 5 to 5. The laundry basket supervised."))
      .toContain("chatLine: repeats \"laundry basket supervised\" from an earlier week's chat line in the lore; say it a new way.");
    expect(check("The laundry basket supervised the week, 5 to 5.").some((error) => error.includes("repeats"))).toBe(true);
    expect(check("The laundry basket supervised. The week ended 5 to 5.").some((error) => error.includes("repeats"))).toBe(true);
    expect(check("The week ended in a tie. A different moment.").some((error) => error.includes("repeats"))).toBe(true);
  });
  it("still validates an empty or overlong legacy scoreLine", () => {
    expect(validateGameRecap({ recap: { ...valid, scoreLine: "" }, players, entries }).some((error) => error.startsWith("scoreLine:"))).toBe(true);
    expect(validateGameRecap({ recap: { ...valid, scoreLine: "Ava " + "a".repeat(80) }, players, entries }).some((error) => error.startsWith("scoreLine:"))).toBe(true);
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
      "chatLine: lead with the finished game and its result, not with the recap being ready.",
      "chatLine: skip stock recap phrases and invitations; the next line already supplies the link.",
    ]));
  });
});
