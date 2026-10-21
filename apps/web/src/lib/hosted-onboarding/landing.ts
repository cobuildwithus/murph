import { normalizePhoneNumber } from "./phone";
import { resolveHostedPublicBaseUrl as resolveHostedWebPublicBaseUrl } from "../hosted-web/public-url";


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
  const baseUrl = resolveHostedPublicBaseUrlObject(source);

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

function resolveHostedPublicBaseUrlObject(source: NodeJS.ProcessEnv): URL | null {
  const value = resolveHostedWebPublicBaseUrl(source);

  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}
