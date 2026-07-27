import {
  HOSTED_GROUP_SPONSORSHIP_OFFER_CODES,
  type HostedGroupSponsorshipOfferCode,
} from "../hosted-onboarding/usage-credit-offers";

const DAY_MS = 24 * 60 * 60 * 1_000;

export type HostedGroupSponsorshipCelebrationScale =
  | "small"
  | "medium"
  | "large";

export interface HostedGroupSponsorshipExperiencePolicy {
  celebrationScale: HostedGroupSponsorshipCelebrationScale;
  runningBitDurationLabel: string | null;
  runningBitDurationMs: number | null;
}

const HOSTED_GROUP_SPONSORSHIP_EXPERIENCE = {
  usage_5_usd: {
    celebrationScale: "small",
    runningBitDurationLabel: null,
    runningBitDurationMs: null,
  },
  usage_10_usd: {
    celebrationScale: "medium",
    runningBitDurationLabel: "1 day",
    runningBitDurationMs: DAY_MS,
  },
  usage_20_usd: {
    celebrationScale: "large",
    runningBitDurationLabel: "3 days",
    runningBitDurationMs: 3 * DAY_MS,
  },
} as const satisfies Record<
  HostedGroupSponsorshipOfferCode,
  HostedGroupSponsorshipExperiencePolicy
>;

export function getHostedGroupSponsorshipExperiencePolicy(
  offerCode: HostedGroupSponsorshipOfferCode,
): HostedGroupSponsorshipExperiencePolicy {
  return HOSTED_GROUP_SPONSORSHIP_EXPERIENCE[offerCode];
}

export function isHostedGroupSponsorshipOfferCode(
  value: string,
): value is HostedGroupSponsorshipOfferCode {
  return HOSTED_GROUP_SPONSORSHIP_OFFER_CODES.includes(
    value as HostedGroupSponsorshipOfferCode,
  );
}

export function readHostedConfiguredGroupSponsorshipOfferCodes(input: {
  configuredOfferCodes: readonly string[];
}): HostedGroupSponsorshipOfferCode[] {
  return input.configuredOfferCodes.filter(
    (offerCode): offerCode is HostedGroupSponsorshipOfferCode =>
      isHostedGroupSponsorshipOfferCode(offerCode),
  );
}
