import { describe, expect, it } from "vitest";

import { resolvePublicGoalContactOptions } from "@/src/lib/goals/goal-contact";

describe("goal contact routing", () => {
  it("prefills the authored prompt unchanged in every public contact channel", () => {
    const body = "Hey Murph, help me lower my resting heart rate.";
    const options = resolvePublicGoalContactOptions({
      contactInfo: {
        phone: "+15550100001",
        phoneConfigured: true,
        telegram: "withmurph_bot",
      },
      startPrompt: body,
    });

    expect(options.map((option) => option.kind)).toEqual([
      "text",
      "telegram",
      "email",
    ]);

    for (const option of options) {
      const parameter = option.kind === "telegram" ? "text" : "body";
      expect(new URL(option.href).searchParams.get(parameter)).toBe(body);
    }
  });

  it("keeps Telegram and email available when no public phone is configured", () => {
    const options = resolvePublicGoalContactOptions({
      contactInfo: {
        phone: "+15555550100",
        phoneConfigured: false,
        telegram: "withmurph_bot",
      },
      startPrompt: "Hey Murph, help me sleep better.",
    });

    expect(options.map((option) => option.kind)).toEqual(["telegram", "email"]);
  });
});
