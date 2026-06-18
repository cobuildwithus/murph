import { type HostedPrivyIdentity } from "./privy";

import {
  hostedEmailLookupKeyMatchesValue,
  createHostedPhoneLookupKey,
  hostedPhoneLookupKeyMatchesValue,
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
    privyUserId: null,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  };
}

export function buildHostedPersistedPhoneIdentityFields(input: {
  currentIdentity?: {
    maskedPhoneNumberHint: string | null;
    phoneLookupKey: string | null;
    phoneNumber: string | null;
    phoneNumberVerifiedAt: Date | null;
  } | null;
  now: Date;
  phone: HostedPrivyIdentity["phone"];
}) {
  if (input.phone) {
    return {
      ...buildHostedOptionalMemberPhoneIdentityFields(input.phone),
      phoneNumberVerifiedAt: input.now,
    };
  }

  return {
    maskedPhoneNumberHint: input.currentIdentity?.maskedPhoneNumberHint ?? null,
    phoneLookupKey: input.currentIdentity?.phoneLookupKey ?? null,
    phoneNumber: input.currentIdentity?.phoneNumber ?? null,
    phoneNumberVerifiedAt: input.currentIdentity?.phoneNumberVerifiedAt ?? null,
  };
}

export function assertHostedPrivyIdentityMatchesExpectedPhone(input: {
  expectedPhoneHint?: string;
  expectedPhoneLookupKey?: string;
  identity: HostedPrivyIdentity;
}): void {
  if (!input.expectedPhoneLookupKey) {
    return;
  }

  if (!input.identity.phone) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_REQUIRED",
      message: "Finish phone verification before continuing.",
      httpStatus: 400,
    });
  }

  if (
    !hostedPhoneLookupKeyMatchesValue(
      input.identity.phone.number,
      input.expectedPhoneLookupKey,
    )
  ) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_MISMATCH",
      message: `Enter the same phone number that received this invite (${input.expectedPhoneHint ?? "your invited number"}).`,
      httpStatus: 403,
    });
  }
}

export function assertHostedPrivyIdentityMatchesExpectedEmail(input: {
  expectedEmailLookupKey?: string;
  identity: HostedPrivyIdentity;
}): void {
  if (!input.expectedEmailLookupKey) {
    return;
  }

  if (!input.identity.email?.verifiedAt) {
    throw hostedOnboardingError({
      code: "PRIVY_EMAIL_REQUIRED",
      message: "Finish email verification before continuing.",
      httpStatus: 400,
    });
  }

  if (
    !hostedEmailLookupKeyMatchesValue(
      input.identity.email.address,
      input.expectedEmailLookupKey,
    )
  ) {
    throw hostedOnboardingError({
      code: "PRIVY_EMAIL_MISMATCH",
      message: "Use the same email address that received this invite.",
      httpStatus: 403,
    });
  }
}

function buildHostedOptionalMemberPhoneIdentityFields(
  phone: HostedPrivyIdentity["phone"],
) {
  if (!phone) {
    return {
      maskedPhoneNumberHint: null,
      phoneLookupKey: null,
      phoneNumber: null,
    };
  }

  const fields = buildHostedMemberPhoneIdentityFields(phone.number);

  return {
    maskedPhoneNumberHint: fields.maskedPhoneNumberHint,
    phoneLookupKey: fields.phoneLookupKey,
    phoneNumber: fields.phoneNumber,
  };
}
