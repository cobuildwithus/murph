import { describe, expect, it } from "vitest";
import { buildGameChangeExpiredInstructions, buildGameChangeCancelledInstructions, buildGameProposalInstructions } from "../src/game-chat-notifications.ts";

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
});
