import { describe, expect, it } from "vitest";

import { resolveGoalContactOption } from "@/src/lib/goals/goal-contact";

describe("goal contact routing", () => {
  it("opens the signed-in member's assigned Murph line in Messages", () => {
    const body = "Hey Murph, help me lower my resting heart rate.";
    const option = resolveGoalContactOption({
      murphPhoneNumber: "+15550100001",
      startPrompt: body,
      textAvailable: true,
    });

    expect(option.kind).toBe("text");
    expect(option.href).toBe(
      `sms:+15550100001?body=${encodeURIComponent(body)}`,
    );
    expect(new URL(option.href).searchParams.get("body")).toBe(body);
  });

  it("opens Telegram when the member does not have a verified text channel", () => {
    const body = "Hey Murph, help me sleep better.";
    const option = resolveGoalContactOption({
      murphPhoneNumber: "+15550100001",
      startPrompt: body,
      textAvailable: false,
    });

    expect(option.kind).toBe("telegram");
    expect(new URL(option.href).searchParams.get("text")).toBe(body);
  });

  it.each([null, "not-a-phone-number"])(
    "falls back to Telegram when an assigned line is missing or invalid: %s",
    (murphPhoneNumber) => {
      const option = resolveGoalContactOption({
        murphPhoneNumber,
        startPrompt: "Hey Murph, help me improve my deep sleep.",
        textAvailable: true,
      });

      expect(option.kind).toBe("telegram");
      expect(option.kind).not.toBe("email");
    },
  );
});
