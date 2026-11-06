import { normalizePhoneNumber } from "./phone";


export interface HostedSignupPhoneDetails {
  displayValue: string;
  smsValue: string;
}

export function resolveHostedSignupPhoneNumber(
  source: NodeJS.ProcessEnv = process.env,
): HostedSignupPhoneDetails | null {
  return parseHostedSignupPhoneNumber(source.HOSTED_ONBOARDING_SIGNUP_PHONE_NUMBER);
}

export function parseHostedSignupPhoneNumber(value: string | null | undefined): HostedSignupPhoneDetails | null {
  const displayValue = value?.trim() ?? "";

  if (!displayValue) {
    return null;
  }

  const smsValue = normalizePhoneNumber(displayValue);

  if (!smsValue) {
    return null;
  }

  return {
    displayValue,
    smsValue,
  };
}
