import { describe, expect, it } from "vitest";

import { parseHostedInitialOnboardingCompletionRequest } from "@/src/lib/hosted-onboarding/initial-onboarding";

// Transactional completion and competing surfaces are exercised against the
// real database in initial-onboarding-postgres-concurrency.test.ts.
describe("initial onboarding request validation", () => {
  it("accepts only exact save and skip request shapes", () => {
    expect(parseHostedInitialOnboardingCompletionRequest({
      action: "skip",
    })).toEqual({ action: "skip" });
    expect(parseHostedInitialOnboardingCompletionRequest({
      action: "save",
      preferences: {
        persona: "classic",
        tone: "formal",
        voice: "upbeat",
      },
    })).toEqual({
      action: "save",
      preferences: {
        persona: "classic",
        tone: "formal",
        voice: "upbeat",
      },
    });
    expect(() => parseHostedInitialOnboardingCompletionRequest({
      action: "skip",
      preferences: {},
    })).toThrow("Skipped onboarding cannot include preferences");
    expect(() => parseHostedInitialOnboardingCompletionRequest({
      action: "save",
      preferences: {
        persona: "classic",
        tone: "formal",
        voice: "not-a-voice",
      },
    })).toThrow("Choose a valid Murph persona, tone, and voice");
  });

  it.each(["scientist-with-classic", "navy-seal", "longevity-scientist"])(
    "rejects a new onboarding save with retired persona %s instead of silently changing it",
    (persona) => {
      expect(() => parseHostedInitialOnboardingCompletionRequest({
        action: "save",
        preferences: { persona, tone: "casual", voice: "warm" },
      })).toThrow("Refresh Murph before completing setup.");
    },
  );
});
