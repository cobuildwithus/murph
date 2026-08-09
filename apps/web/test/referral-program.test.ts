import { describe, expect, it } from "vitest";

import {
  formatHostedPublicReferralRewardAmount,
  formatHostedPublicReferralRewardDays,
  formatHostedPublicReferralRewardValue,
  getAvailableHostedPublicReferralRewards,
  HOSTED_PUBLIC_REFERRAL_REWARDS,
} from "@/src/lib/hosted-growth/referral-program";
import { HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY } from "@/src/lib/hosted-growth/signup-referral-policy";
import {
  buildHostedUsageReferralRewardLabel,
  getHostedUsageReferralPolicyDisplay,
  HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
  HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS,
  HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_MESSAGES,
  HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_MESSAGES,
  HOSTED_USAGE_REFERRAL_GROUP_REQUIRED_NON_REFERRER_SPEAKERS,
  HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
} from "@/src/lib/hosted-growth/usage-referral";

function readReward(id: (typeof HOSTED_PUBLIC_REFERRAL_REWARDS)[number]["id"]) {
  const reward = HOSTED_PUBLIC_REFERRAL_REWARDS.find(
    (candidate) => candidate.id === id,
  );
  expect(reward).toBeDefined();
  return reward!;
}

describe("public referral program projection", () => {
  it.each([
    {
      expectedIds: [],
      groupEnabled: false,
      signupEnabled: false,
    },
    {
      expectedIds: ["signup-link"],
      groupEnabled: false,
      signupEnabled: true,
    },
    {
      expectedIds: ["new-person-group", "active-group"],
      groupEnabled: true,
      signupEnabled: false,
    },
    {
      expectedIds: ["signup-link", "new-person-group", "active-group"],
      groupEnabled: true,
      signupEnabled: true,
    },
  ])(
    "projects only rewards enabled by the signup=$signupEnabled group=$groupEnabled gates",
    ({ expectedIds, groupEnabled, signupEnabled }) => {
      const source = {
        HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED: signupEnabled ? "1" : "0",
        HOSTED_USAGE_REFERRALS_ENABLED: groupEnabled ? "1" : "0",
      };

      expect(
        getAvailableHostedPublicReferralRewards(source).map(({ id }) => id),
      ).toEqual(expectedIds);
    },
  );

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
      rewardUsdMicros: newPersonGroup.rewardUsdMicros,
    })).toBe("$2.00 of cost-weighted usage credit for your Murph");
    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "personal",
      rewardUsdMicros: activeGroup.rewardUsdMicros,
    })).toBe("$3.50 of cost-weighted usage credit for your Murph");
    expect(signup.rewardUsdMicros).toBe(
      HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
    );
    expect(signup.description).toContain(
      "eligibility and rolling-limit checks pass",
    );
    expect(signup.description).not.toMatch(
      /when setup completes|checks at completion/u,
    );
    expect(signup.description).not.toContain(
      "the reward is added automatically",
    );
    expect(newPersonGroup.rewardUsdMicros).toBe(
      HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
    );
    expect(activeGroup.rewardUsdMicros).toBe(
      HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
    );
    expect(formatHostedPublicReferralRewardValue(
      HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
    )).toBe(
      "$2.00 of cost-weighted usage credit",
    );
    expect(formatHostedPublicReferralRewardAmount(
      HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
    )).toBe("$3.50");
    expect(formatHostedPublicReferralRewardDays(
      signup.estimatedUsageDays,
    )).toBe("≈10 days of Murph");
    expect(formatHostedPublicReferralRewardDays(
      activeGroup.estimatedUsageDays,
    )).toBe("≈14 days of Murph");
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
