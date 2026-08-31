import { describe, expect, it } from "vitest";

import {
  resolvePublicGoalContactOptions,
  withPublicGoalContactDraft,
} from "@/src/lib/goals/goal-contact";
import { MURPH_CONTACT_EMAIL } from "@/src/lib/murph-contact-routing";

describe("goal contact routing", () => {
  it("provides best-effort draft links while the UI owns the copy fallback", () => {
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
    expect(new URL(options[0]!.href).searchParams.get("body")).toBe(body);
    expect(new URL(options[1]!.href).searchParams.get("text")).toBe(body);

    const editedBody = "Hey Murph, help me lower my RHR & improve my 10K.";
    const editedText = withPublicGoalContactDraft(options[0]!, editedBody);
    const editedTelegram = withPublicGoalContactDraft(options[1]!, editedBody);
    expect(editedText.href).toBe(
      `sms:+15550100001?body=${encodeURIComponent(editedBody)}`,
    );
    expect(new URL(editedTelegram.href).searchParams.get("text")).toBe(editedBody);
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
    expect(options[0]?.href).toContain("https://t.me/withmurph_bot?text=");
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
