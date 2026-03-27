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

export function resolveHostedPrivyClientAppId(source: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeEnvValue(source.NEXT_PUBLIC_PRIVY_APP_ID);
}

export function hasHostedPrivyClientConfig(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveHostedPrivyClientAppId(source));
}

export function hasHostedPrivyPhoneAuthConfig(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveHostedPrivyClientAppId(source) && normalizeEnvValue(source.PRIVY_APP_SECRET));
}

function normalizeEnvValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
