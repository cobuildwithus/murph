import {
  HOSTED_GROUP_SPONSORSHIP_OFFER_CODES,
  type HostedGroupSponsorshipOfferCode,
} from "../hosted-onboarding/usage-credit-offers";

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
