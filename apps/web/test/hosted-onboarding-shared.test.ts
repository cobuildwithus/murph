import { describe, expect, it } from "vitest";

import {
  extractLinqTextMessage,
  maskPhoneNumber,
  normalizePhoneNumber,
  shouldStartHostedOnboarding,
} from "@/src/lib/hosted-onboarding/shared";

describe("hosted onboarding shared helpers", () => {
  it("normalizes E.164-ish phone numbers", () => {
    expect(normalizePhoneNumber("+61 400-111-222")).toBe("+61400111222");
    expect(normalizePhoneNumber("0044 7700 900123")).toBe("+447700900123");
    expect(normalizePhoneNumber("not-a-number")).toBeNull();
  });

  it("masks phone numbers for invite copy", () => {
    expect(maskPhoneNumber("+61400111222")).toBe("*** 1222");
    expect(maskPhoneNumber(null)).toBe("your number");
  });

  it("detects onboarding trigger phrases", () => {
    expect(shouldStartHostedOnboarding("I want to get healthy")).toBe(true);
    expect(shouldStartHostedOnboarding("murph please")).toBe(true);
    expect(shouldStartHostedOnboarding("start murph")).toBe(true);
    expect(shouldStartHostedOnboarding("start")).toBe(false);
    expect(shouldStartHostedOnboarding("hello there")).toBe(false);
  });

  it("extracts Linq text parts into a single message body", () => {
    expect(
      extractLinqTextMessage({
        parts: [
          { type: "text", value: "I want to get healthy" },
          { type: "media", url: "https://example.test/a.jpg" },
          { type: "text", value: "Please" },
        ],
      }),
    ).toBe("I want to get healthy\nPlease");
  });
});
