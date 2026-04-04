import { describe, expect, it } from "vitest";

import {
  extractLinqTextMessage,
  maskPhoneNumber,
  normalizePhoneNumber,
  normalizePhoneNumberForCountry,
} from "@/src/lib/hosted-onboarding/shared";

describe("hosted onboarding shared helpers", () => {
  it("normalizes E.164-ish phone numbers", () => {
    expect(normalizePhoneNumber("+61 400-111-222")).toBe("+61400111222");
    expect(normalizePhoneNumber("0044 7700 900123")).toBe("+447700900123");
    expect(normalizePhoneNumber("not-a-number")).toBeNull();
  });

  it("normalizes local numbers against a selected country code", () => {
    expect(normalizePhoneNumberForCountry("(415) 555-2671", "+1")).toBe("+14155552671");
    expect(normalizePhoneNumberForCountry("0400 111 222", "+61")).toBe("+61400111222");
    expect(normalizePhoneNumberForCountry("+44 7700 900123", "+1")).toBe("+447700900123");
  });

  it("masks phone numbers for invite copy", () => {
    expect(maskPhoneNumber("+61400111222")).toBe("*** 1222");
    expect(maskPhoneNumber(null)).toBe("your number");
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
