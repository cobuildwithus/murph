import { describe, expect, it } from "vitest";

import { resolvePublicGoalContactOptions } from "@/src/lib/goals/goal-contact";
import { MURPH_CONTACT_EMAIL } from "@/src/lib/murph-contact-routing";

describe("goal contact routing", () => {
  it("prefills the authored prompt unchanged in every usable public messaging channel", () => {
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
    ]);

    for (const option of options) {
      const parameter = option.kind === "telegram" ? "text" : "body";
      expect(new URL(option.href).searchParams.get(parameter)).toBe(body);
    }
  });

  it("uses Telegram alone when no public phone is configured", () => {
    const options = resolvePublicGoalContactOptions({
      contactInfo: {
        phone: "+15555550100",
        phoneConfigured: false,
        telegram: "withmurph_bot",
      },
      startPrompt: "Hey Murph, help me sleep better.",
    });

    expect(options.map((option) => option.kind)).toEqual(["telegram"]);
    expect(
      options.every((option) => option.href.startsWith("https://t.me/")),
    ).toBe(true);
  });

  it("never routes an intent-bearing draft through the public email bootstrap", () => {
    const options = resolvePublicGoalContactOptions({
      contactInfo: {
        phone: "+15555550100",
        phoneConfigured: false,
        telegram: "withmurph_bot",
      },
      startPrompt: "Hey Murph, help me improve my deep sleep.",
    });

    expect(options.some((option) => option.kind === "email")).toBe(false);
    expect(
      options.some((option) => option.href.includes(MURPH_CONTACT_EMAIL)),
    ).toBe(false);
  });
});
