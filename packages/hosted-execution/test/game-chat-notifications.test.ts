import { describe, expect, it } from "vitest";
import { buildGameChangeCancelledInstructions, buildGameProposalInstructions } from "../src/game-chat-notifications.ts";

describe("game v1 notification instructions", () => {
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
