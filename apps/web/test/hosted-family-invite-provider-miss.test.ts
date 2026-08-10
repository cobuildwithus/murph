import { describe, expect, it } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { isExpectedHostedLinqFamilyInviteAcceptanceMiss } from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import { isExpectedHostedTelegramFamilyInviteAcceptanceMiss } from "@/src/lib/hosted-onboarding/webhook-provider-telegram";

describe("hosted Family invite provider miss classification", () => {
  it.each([
    ["Linq", isExpectedHostedLinqFamilyInviteAcceptanceMiss],
    ["Telegram", isExpectedHostedTelegramFamilyInviteAcceptanceMiss],
  ])("treats an already-active member as an expected %s invite miss", (_provider, classify) => {
    expect(classify(hostedOnboardingError({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_IN_GROUP",
      httpStatus: 409,
      message: "This member is already in this Family plan.",
    }))).toBe(true);
  });

  it.each([
    ["Linq", isExpectedHostedLinqFamilyInviteAcceptanceMiss],
    ["Telegram", isExpectedHostedTelegramFamilyInviteAcceptanceMiss],
  ])("does not hide a retryable %s billing failure", (_provider, classify) => {
    expect(classify(hostedOnboardingError({
      code: "HOSTED_FAMILY_MEMBER_PLAN_SYNCING",
      httpStatus: 409,
      message: "Family billing is still syncing.",
      retryable: true,
    }))).toBe(false);
  });
});
