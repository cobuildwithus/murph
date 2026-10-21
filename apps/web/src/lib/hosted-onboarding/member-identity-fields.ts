import {
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";

export function buildHostedMemberPhoneIdentityFields(phoneNumber: string) {
  const maskedPhoneNumberHint = readHostedPhoneHint(phoneNumber);
  const phoneLookupKey = createHostedPhoneLookupKey(phoneNumber);

  if (!phoneLookupKey) {
    throw hostedOnboardingError({
      code: "PHONE_NUMBER_INVALID",
      message: "A valid phone number is required to continue.",
      httpStatus: 400,
    });
  }

  return {
    maskedPhoneNumberHint,
    phoneLookupKey,
    phoneNumberVerifiedAt: null,
    phoneNumber: phoneNumber.trim(),
  };
}
