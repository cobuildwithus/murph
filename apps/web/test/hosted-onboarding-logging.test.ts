import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";

describe("hosted onboarding timing logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a sanitized elapsed timing payload", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const dateNow = vi.spyOn(Date, "now");

    dateNow.mockReturnValueOnce(1_000).mockReturnValueOnce(1_245);

    const timing = startHostedOnboardingTiming("hosted-onboarding.route.billing-checkout", {
      checkoutUrl: "https://stripe.example.test/session_123",
      inviteCode: "invite_123",
      nonFiniteNumber: Number.NaN,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      memberEmail: "user@example.com",
      stage: "checkout",
    });

    expect(consoleInfo).toHaveBeenCalledWith("Hosted onboarding timing.", {
      checkoutUrl: "<redacted-url>",
      elapsedMs: 245,
      inviteCode: "invite_123",
      memberEmail: "<redacted-email>",
      outcome: "completed",
      stage: "checkout",
      step: "hosted-onboarding.route.billing-checkout",
    });
  });

  it("normalizes timing error names without exposing messages", () => {
    expect(deriveHostedOnboardingTimingErrorName(new TypeError("boom"))).toBe("TypeError");
    expect(deriveHostedOnboardingTimingErrorName("boom")).toBe("StringError");
    expect(deriveHostedOnboardingTimingErrorName({})).toBe("UnknownError");
  });
});
