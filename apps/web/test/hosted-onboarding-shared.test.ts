import { describe, expect, it, vi } from "vitest";

import {
  extractLinqTextMessage,
  maskPhoneNumber,
  normalizePhoneNumber,
  normalizePhoneNumberForCountry,
  withHostedOnboardingTransaction,
} from "@/src/lib/hosted-onboarding/shared";

describe("hosted onboarding shared helpers", () => {
  it("normalizes E.164-ish phone numbers", () => {
    expect(normalizePhoneNumber("+61 400-111-222")).toBe("+61400111222");
    expect(normalizePhoneNumber("0044 7700 900123")).toBe("+447700900123");
    expect(normalizePhoneNumber("not-a-number")).toBeNull();
  });

  it("normalizes local numbers against a selected country code", () => {
    expect(normalizePhoneNumberForCountry("(415) 555-2671", "+1")).toBe("+14155552671");
    expect(normalizePhoneNumberForCountry("+1 (415) 555-2671", "+1")).toBe("+14155552671");
    expect(normalizePhoneNumberForCountry("0400 111 222", "+61")).toBe("+61400111222");
    expect(normalizePhoneNumberForCountry("+44 7700 900123", "+1")).toBe("+447700900123");
  });

  it("rejects incomplete +1 numbers instead of silently treating them as valid", () => {
    expect(normalizePhoneNumberForCountry("404409252", "+1")).toBeNull();
    expect(normalizePhoneNumberForCountry("+1404409252", "+1")).toBeNull();
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

  it("uses an explicit transaction maxWait for hosted onboarding transactions", async () => {
    const tx = { kind: "tx" };
    const callback = vi.fn(async () => "ok");
    const transaction = vi.fn(async (fn: (txArg: { kind: string }) => Promise<string>, options?: { maxWait?: number }) => {
      expect(options).toEqual({ maxWait: 5_000 });
      return fn(tx);
    });

    const result = await withHostedOnboardingTransaction(
      { $transaction: transaction } as never,
      callback as never,
    );

    expect(result).toBe("ok");
    expect(transaction).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(tx);
  });

  it("passes through an existing transaction client without nesting another transaction", async () => {
    const tx = { kind: "existing-tx" };
    const callback = vi.fn(async () => "ok");

    const result = await withHostedOnboardingTransaction(
      tx as never,
      callback as never,
    );

    expect(result).toBe("ok");
    expect(callback).toHaveBeenCalledWith(tx);
  });
});
