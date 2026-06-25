import { describe, expect, it } from "vitest";

import { hostedComputerPauseForUserRequestSchema } from "../src/computer-use.js";

describe("hosted computer pause-for-user request schema", () => {
  it("keeps final confirmation pauses in chat", () => {
    const chatOnlyPause = hostedComputerPauseForUserRequestSchema.safeParse({
      reason: "final_confirmation",
      suggestedReply: "Yes, go ahead.",
    });

    expect(chatOnlyPause.success).toBe(true);
    if (chatOnlyPause.success) {
      expect(chatOnlyPause.data.handoffPurpose).toBeNull();
    }

    const browserHandoffPause = hostedComputerPauseForUserRequestSchema.safeParse({
      handoffPurpose: "manual_browser_help",
      reason: "final_confirmation",
      suggestedReply: "Yes, go ahead.",
    });

    expect(browserHandoffPause.success).toBe(false);
    if (!browserHandoffPause.success) {
      expect(browserHandoffPause.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("chat approval"),
            path: ["handoffPurpose"],
          }),
        ]),
      );
    }
  });

  it("still permits handoff links for private or blocked browser steps", () => {
    expect(
      hostedComputerPauseForUserRequestSchema.safeParse({
        handoffPurpose: "managed_login",
        reason: "login_needed",
      }).success,
    ).toBe(true);

    expect(
      hostedComputerPauseForUserRequestSchema.safeParse({
        handoffPurpose: "payment",
        reason: "payment_needed",
      }).success,
    ).toBe(true);
  });
});
