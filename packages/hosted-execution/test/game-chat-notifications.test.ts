import { describe, expect, it } from "vitest";
import { hostedGameChatStateSchema } from "../src/game-tools.ts";
import { GAME_LIVE_LORE_GUIDANCE, GAME_PRIZE_WORDS, buildGameChangeExpiredInstructions, buildGameChangeCancelledInstructions, buildGameKickoffInstructions, buildGameMissedDayInstructions, buildGameProposalInstructions, buildGameRecapInstructions, buildGameRematchInstructions, gameLiveLoreGuidanceForState } from "../src/game-chat-notifications.ts";

describe("game v1 notification instructions", () => {
  it("keeps a rematch short, app-controlled and free of link or lifecycle jargon", () => {
    const rules = { checkInKind: "photo" as const, lengthDays: 7, schedule: { days: [0, 1, 2, 3, 4] },
      stakes: [{ kind: "prize" as const, item: "breakfast" }], tasksByMember: { member_maya: "Walk", member_sam: "Walk" } };
    const instructions = buildGameRematchInstructions({ requesterName: "Maya", previous: rules,
      rematch: { ...rules, lengthDays: 10 }, startsOn: null });
    expect(instructions).toContain("one short, natural message");
    expect(instructions).toContain("Shake on it in the Murph app or suggest changes there");
    expect(instructions).toContain("never call it the same game or the same challenge");
    expect(instructions).toContain("Do not include a link");
    expect(instructions).toContain("never use the words invite, round or token");
    expect(JSON.parse(instructions.split("\n").at(-1)!)).toEqual({
      requester: "Maya", sameGame: false, previous: rules, rematch: { ...rules, lengthDays: 10 }, startsOn: null,
    });
  });
  it("compares asymmetric rematch tasks by person when the requester changes seats", () => {
    const shared = { checkInKind: "photo" as const, lengthDays: 7, schedule: { days: [0, 1, 2, 3, 4] }, stakes: [] };
    const instructions = buildGameRematchInstructions({ requesterName: "Sam", startsOn: null,
      previous: { ...shared, tasksByMember: { member_alex: "Run", member_sam: "Lift" } },
      rematch: { ...shared, tasksByMember: { member_sam: "Lift", member_alex: "Run" } } });
    const data = JSON.parse(instructions.split("\n").at(-1)!);
    expect(data.sameGame).toBe(true);
    expect(data.previous.tasksByMember).toEqual({ member_alex: "Run", member_sam: "Lift" });
    expect(data.rematch.tasksByMember).toEqual(data.previous.tasksByMember);
  });
  it("explains a refused approval once without claiming the game ended", () => {
    const reason = "The proposed start date has passed. Propose a new date.";
    const instructions = buildGameChangeExpiredInstructions(reason);
    expect(instructions).toContain("one brief, plain line");
    expect(instructions).toContain("could not apply and why");
    expect(instructions).toContain("Do not say the game was cancelled or changed");
    expect(JSON.parse(instructions.split("\n").at(-1)!)).toEqual({reason});
  });
  it("distinguishes a cancelled request from the challenge and a later request", () => {
    const instructions = buildGameChangeCancelledInstructions();
    expect(instructions).toContain("one brief, natural group message");
    expect(instructions).toContain("did not alter the game");
    expect(instructions).toContain("earlier request only");
    expect(instructions).toContain("Do not describe any later request as cancelled");
    expect(instructions).not.toMatch(/is now pending|has not started|still waiting for agreement/);
    expect(instructions).not.toContain("calendar days");
  });
  it("keeps total duration clear without player-facing jargon", () => {
    const instructions = buildGameProposalInstructions({ change: { kind: "edit", lengthDays: 75 }, startsOn: null }, { proposerName: "Maya", recipientName: "Sam", lengthDays: 7 });
    expect(instructions).toContain("total days, never additional days");
    expect(instructions).not.toContain("calendar days");
  });
  it("names what the loser owes a prize in the texts that describe it, never a bet", () => {
    const proposal = buildGameProposalInstructions({ change: { kind: "edit", stakes: [{ kind: "prize", item: "breakfast in bed" }] }, startsOn: null }, { proposerName: "Maya", recipientName: "Sam", lengthDays: 7 });
    const [game] = hostedGameChatStateSchema.parse({ games: [{
      id: "game_synthetic", status: "live", startsOn: null, lengthDays: 7, pendingChange: null,
      terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "100 pushups" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "breakfast in bed" }] },
      players: [{ memberId: "member_maya", seat: 0, firstName: "Maya", dayOne: "2030-03-04", timeZone: "UTC" }, { memberId: "member_sam", seat: 1, firstName: "Sam", dayOne: "2030-03-04", timeZone: "UTC" }],
      changeControls: { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, editableFromDay: null },
    }] }).games;
    const kickoff = buildGameKickoffInstructions({ kind: "started", game: game! });
    for (const instructions of [proposal, kickoff]) expect(instructions).toContain(GAME_PRIZE_WORDS);
    expect(GAME_PRIZE_WORDS).toContain("owes you breakfast in bed.");
    for (const word of ["ticket", "bet", "wager", "stake", "winnings", "cash in"]) expect(GAME_PRIZE_WORDS).toContain(word);
  });
  it("snapshots the recap and missed-day prompt boundaries", () => {
    const recap = buildGameRecapInstructions([{ playerName: "Ava", text: "My alarm won." }]);
    expect(recap).not.toMatch(/\b(?:read_chat|read_lore|add_lore)\b/u);
    const transcript = [{ playerName: "Ava", text: "My alarm won." }];
    const missed = buildGameMissedDayInstructions({ playerName: "Ava", firstMissedDate: "2030-03-04", missedDates: ["2030-03-04", "2030-03-05"], transcript });
    expect({
      recapOpening: recap.split("\n")[0],
      recapToolOrder: recap.includes("Use murph.read_game first") && recap.includes("then use murph.write_recap"),
      recapReply: recap.includes("chatLine is the message you post") && recap.includes("Lead with the week's funniest specific moment"),
      recapLore: recap.includes("murph.game_lore") && recap.includes("Chat line used:"),
      recapTranscript: recap.includes('"playerName":"Ava","text":"My alarm won."'),
      missedOpening: missed.split("\n")[0],
      missedCanSkip: missed.includes("finish without a reply"),
      missedData: JSON.parse(missed.split("\n").at(-1)!),
      liveLoreGuidance: GAME_LIVE_LORE_GUIDANCE,
    }).toMatchInlineSnapshot(`
      {
        "liveLoreGuidance": "This room has a live game. Use murph.game_lore to keep about 200 lines of brief dated pair lore from current chat and game evidence—verbatim excuses, trash talk, firsts, streaks, comebacks, running and used bits—trimming oldest first.",
        "missedCanSkip": true,
        "missedData": {
          "firstMissedDate": "2030-03-04",
          "missedDates": [
            "2030-03-04",
            "2030-03-05",
          ],
          "playerName": "Ava",
          "transcript": [
            {
              "playerName": "Ava",
              "text": "My alarm won.",
            },
          ],
        },
        "missedOpening": "A player missed one or more consecutive scheduled game days. Read the pair lore with murph.game_lore and use the bounded same-room transcript below before deciding whether to speak.",
        "recapLore": true,
        "recapOpening": "The game just ended. Write its recap: a short story of the week the two players swipe through in the app, like Instagram stories. Use murph.read_game first, read the pair lore with murph.game_lore, use the bounded current-room transcript below, then use murph.write_recap and update the pair lore with murph.game_lore.",
        "recapReply": true,
        "recapToolOrder": true,
        "recapTranscript": true,
      }
    `);
  });
  it("adds lore guidance only when the bound shared state has a live game", () => {
    const live = hostedGameChatStateSchema.parse({ games: [{
      id: "game_synthetic", status: "live", startsOn: null, lengthDays: 7, terms: { n: 1, fromDay: 0, tasks: [], schedule: { count: 3 }, stakes: [] }, players: [], pendingChange: null,
      changeControls: { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, editableFromDay: null },
    }] });
    expect(gameLiveLoreGuidanceForState(live)).toBe(GAME_LIVE_LORE_GUIDANCE);
    expect(gameLiveLoreGuidanceForState({ games: live.games.map((game) => ({ ...game, status: "settled" as const })) })).toBeUndefined();
    expect(gameLiveLoreGuidanceForState({ games: [] })).toBeUndefined();
  });
});
