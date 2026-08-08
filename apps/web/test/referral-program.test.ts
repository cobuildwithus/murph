import { describe, expect, it } from "vitest";

import {
  formatApproximateReferralUsageDays,
  HOSTED_PUBLIC_REFERRAL_REWARDS,
} from "@/src/lib/hosted-growth/referral-program";
import {
  computeHostedUsageReferralRewardDays,
} from "@/src/lib/hosted-growth/referral-reward-days";
import { HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY } from "@/src/lib/hosted-growth/signup-referral-policy";
import {
  buildHostedUsageReferralRewardLabel,
  getHostedUsageReferralPolicyDisplay,
  HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS,
  HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_MESSAGES,
  HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_MESSAGES,
  HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_SPEAKERS,
} from "@/src/lib/hosted-growth/usage-referral";

function readReward(id: (typeof HOSTED_PUBLIC_REFERRAL_REWARDS)[number]["id"]) {
  const reward = HOSTED_PUBLIC_REFERRAL_REWARDS.find(
    (candidate) => candidate.id === id,
  );
  expect(reward).toBeDefined();
  return reward!;
}

describe("public referral program projection", () => {
  it("keeps public reward labels aligned with runtime policy", () => {
    const signup = readReward("signup-link");
    const newPersonGroup = readReward("new-person-group");
    const activeGroup = readReward("active-group");

    expect(signup.title).toBe(HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY.title);
    expect(newPersonGroup.title).toBe(
      getHostedUsageReferralPolicyDisplay("new_person_activation_v1").title,
    );
    expect(activeGroup.title).toBe(
      getHostedUsageReferralPolicyDisplay("active_group_v1").title,
    );

    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "personal",
      policyCode: "new_person_activation_v1",
    })).toContain(
      `about ${
        computeHostedUsageReferralRewardDays(
          newPersonGroup.approximateMessageCount,
        )
      } more days of usage`,
    );
    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "personal",
      policyCode: "active_group_v1",
    })).toContain(
      `about ${
        computeHostedUsageReferralRewardDays(
          activeGroup.approximateMessageCount,
        )
      } more days of usage`,
    );
    expect(signup.approximateMessageCount).toBe(
      newPersonGroup.approximateMessageCount,
    );
    expect(formatApproximateReferralUsageDays(100)).toBe(
      "About 10 more days of usage",
    );
  });

  it("keeps the active-group public requirements exact", () => {
    const activeGroup = readReward("active-group");
    const minimumMinutes =
      HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS / 60_000;

    expect(activeGroup.description).toContain(
      `${HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_MESSAGES} human messages`,
    );
    expect(activeGroup.description).toContain(
      `${HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_MESSAGES} from at least ${HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_SPEAKERS} other people`,
    );
    expect(activeGroup.description).toContain(
      `at least ${minimumMinutes} minutes`,
    );
  });
});
