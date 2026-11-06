export const HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR = [
  500,
  1_000,
  2_000,
  5_000,
] as const;

export type HostedGroupSponsorshipMonthlyCapMinor =
  (typeof HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR)[number];

export function parseHostedGroupSponsorshipMonthlyCapMinor(
  value: unknown,
): HostedGroupSponsorshipMonthlyCapMinor | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  for (const monthlyCapMinor of HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR) {
    if (value === monthlyCapMinor) {
      return monthlyCapMinor;
    }
  }
  return null;
}

export const HOSTED_GROUP_SPONSORSHIP_CREATIVE_FORMATS = [
  "message",
  "poem",
  "song",
] as const;

export type HostedGroupSponsorshipCreativeFormat =
  (typeof HOSTED_GROUP_SPONSORSHIP_CREATIVE_FORMATS)[number];

export interface HostedGroupSponsorshipCreativeRequest {
  format: HostedGroupSponsorshipCreativeFormat;
  prompt: string | null;
  styleRequest: string | null;
}

export const HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT =
  "funding_participants_v1" as const;

export type HostedGroupFundingRecognitionConsent =
  typeof HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT;

export interface HostedGroupSponsorshipDraft {
  creativeRequest?: HostedGroupSponsorshipCreativeRequest;
  publicAlias: string | null;
  publicAliasRecognition?: HostedGroupFundingRecognitionConsent;
  runningBitRequest: string | null;
  sponsorMessage: string | null;
}

export const HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS = 80;
export const HOSTED_GROUP_SPONSORSHIP_MESSAGE_MAX_CODE_POINTS = 280;
export const HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS = 240;
export const HOSTED_GROUP_SPONSORSHIP_CREATIVE_PROMPT_MAX_CODE_POINTS = 280;
export const HOSTED_GROUP_SPONSORSHIP_CREATIVE_STYLE_MAX_CODE_POINTS = 160;
