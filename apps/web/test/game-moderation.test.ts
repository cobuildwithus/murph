import { describe, expect, it } from "vitest";

import type { GameCommand, GameStakeKind } from "../src/lib/game/contract";
import { gameCommandTexts, moderateGameCommand } from "../src/lib/game/moderation";
import { GameRuleError } from "../src/lib/game/rules";

const create = (stakes: { kind: GameStakeKind; item: string }[], tasks: string[] = ["100 pushups"]): GameCommand => ({
  gameId: "game_moderation", inviteeFirstName: "Ava", type: "createGame",
  terms: { schedule: { count: 3 }, stakes, tasks: tasks.map((text, seat) => ({ seat, text })) },
});
const words = (text: string, kind: "words" | "excuse" = "words"): GameCommand =>
  ({ entryId: "entry_moderation", gameId: "game_moderation", kind, mediaKeys: [], text, type: "post" });

function refused(command: GameCommand): boolean {
  try {
    moderateGameCommand(command);
    return false;
  } catch (error) {
    if (!(error instanceof GameRuleError)) throw error;
    expect(error.error).toEqual({ code: "CONTENT_NOT_ALLOWED", message: "This can't be posted." });
    return true;
  }
}

describe("weekly game content check", () => {
  it("moderates talk as shared words without treating objections as proposed rules", () => {
    const talk = (note: string): GameCommand => ({ type: "negotiate", token: "invite", proposalId: "proposal_talk", termsVersion: 1, timeZone: "UTC", note });
    for (const note of ["Coffee costs $20, can we pick something cheaper?", "I won't jump off a roof."]) {
      expect(gameCommandTexts(talk(note))).toEqual([{ kind: "words", text: note }]);
      expect(refused(talk(note))).toBe(false);
    }
    expect(refused(talk("Go die"))).toBe(true);
    expect(refused({ type: "negotiate", token: "invite", proposalId: "proposal_change", termsVersion: 1,
      timeZone: "UTC", change: { kind: "edit", stakes: [{ kind: "prize", item: "$20" }] } })).toBe(true);
  });

  it.each([
    ["$50", "prize"], ["Venmo me 20", "prize"], ["20 bucks", "dare"], ["Fifty dollars", "prize"], ["Pay me on Cash App", "dare"],
    ["A Zelle transfer", "prize"], ["£10 note", "prize"], ["5k usd", "prize"],
  ] as const)("refuses money in a stake: %s", (item, kind) => {
    expect(refused(create([{ item, kind }]))).toBe(true);
  });

  it.each([
    "Chug a beer", "Three shots of vodka", "Eat a ghost pepper", "Jump off the roof", "Don't eat for three days",
    "Drink bleach", "Get drunk", "Tide pod challenge", "Set yourself on fire",
  ])("refuses a clearly dangerous dare or task: %s", (text) => {
    expect(refused(create([{ item: text, kind: "dare" }]))).toBe(true);
    expect(refused(create([{ item: "Coffee", kind: "prize" }], [text]))).toBe(true);
  });

  it.each(["kys", "Go die", "Kill yourself", "you retard", "Send nudes", "Watch porn"])("refuses abuse anywhere: %s", (text) => {
    expect(refused(words(text))).toBe(true);
    expect(refused(words(text, "excuse"))).toBe(true);
    expect(refused({ firstName: text, type: "setProfile" })).toBe(true);
    expect(refused({ change: { kind: "edit", tasks: [{ seat: 0, text }] }, expectedTermsVersion: 1, gameId: "game_moderation",
      proposalId: "proposal_moderation", type: "proposeChange" })).toBe(true);
  });

  it.each([
    "Starbucks", "Buckle up", "A flu shot", "Shot put", "Photo shoot", "Gin rummy night", "Cocktail night", "Rum cake",
    "A trip to the dollar store", "Bleach your hair", "Fire retardant", "Sussex", "Scunthorpe", "Analysis", "Hornets game",
    "Methodical", "Don't hurt yourself", "Cut the cake", "Drink water", "Pay for dinner", "Spice rack", "Cash in your chips",
    "No food after 8pm", "Stop eating sugar", "Shitake soup", "Classic car show", "Dick's Sporting Goods", "Grape soda",
  ])("lets an everyday phrase through: %s", (text) => {
    expect(refused(create([{ item: text, kind: "prize" }, { item: text, kind: "dare" }], [text]))).toBe(false);
    expect(refused(words(text))).toBe(false);
  });

  it("checks only what players share: never a private label or a report note", () => {
    expect(gameCommandTexts({ ...create([{ item: "Coffee", kind: "prize" }]), inviteeFirstName: "kys" } as GameCommand)).toEqual([
      { kind: "task", text: "100 pushups" }, { kind: "prize", text: "Coffee" },
    ]);
    expect(refused({ about: "post", entryId: "entry_x123", gameId: "game_moderation", note: "they said kys", reason: "harassment",
      reportId: "report_moderation", type: "report" })).toBe(false);
  });
});


it("checks typed replies exactly as words posts and never treats audio as text", () => {
  const base = { type: "replyToPost" as const, gameId: "game_reply", entryId: "entry_reply", replyId: "reply_0001" };
  expect(() => moderateGameCommand({ ...base, kind: "text", text: "Nice work" })).not.toThrow();
  expect(() => moderateGameCommand({ ...base, kind: "text", text: "kill yourself" })).toThrow();
  expect(gameCommandTexts({ ...base, kind: "voice", audio: "private-audio", levels: Array(32).fill(0) })).toEqual([]);
});
