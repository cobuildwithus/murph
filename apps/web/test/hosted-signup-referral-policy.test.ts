import { describe, expect, it } from "vitest";

import {
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSIONS,
  isHostedSignupReferralPolicyVersion,
} from "@/src/lib/hosted-growth/signup-referral-policy";

describe("hosted signup-referral policy versions", () => {
  it("keeps persisted signup receipts recognizable across policy evolution", () => {
    expect([...HOSTED_SIGNUP_REFERRAL_POLICY_VERSIONS]).toEqual([
      HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
    ]);
    expect(
      isHostedSignupReferralPolicyVersion(
        HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
      ),
    ).toBe(true);
    expect(
      isHostedSignupReferralPolicyVersion(
        "hosted-usage-referral-2026-07-v1",
      ),
    ).toBe(false);
  });
});
