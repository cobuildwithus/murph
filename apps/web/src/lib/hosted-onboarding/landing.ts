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

export function resolveHostedInstallScriptUrl(source: NodeJS.ProcessEnv = process.env): string | null {
  const baseUrl = resolveHostedPublicBaseUrl(source);

  if (!baseUrl) {
    return null;
  }

  return new URL("/install.sh", baseUrl).toString();
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

function resolveHostedPublicBaseUrl(source: NodeJS.ProcessEnv): URL | null {
  const value = normalizeEnvValue(
    source.HOSTED_ONBOARDING_PUBLIC_BASE_URL ?? source.NEXT_PUBLIC_SITE_URL,
  );

  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeEnvValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
