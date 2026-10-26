import { describe, expect, it } from "vitest";
import { hostedGameChatStateSchema } from "../src/game-tools.ts";
import { GAME_PRIZE_WORDS, buildGameChangeExpiredInstructions, buildGameChangeCancelledInstructions, buildGameKickoffInstructions, buildGameProposalInstructions } from "../src/game-chat-notifications.ts";

describe("game v1 notification instructions", () => {
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
});
