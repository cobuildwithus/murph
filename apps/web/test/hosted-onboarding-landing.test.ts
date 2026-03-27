import { describe, expect, it } from "vitest";

import {
  hasHostedPrivyClientConfig,
  parseHostedSignupPhoneNumber,
  resolveHostedPrivyClientAppId,
  resolveHostedSignupPhoneNumber,
} from "@/src/lib/hosted-onboarding/landing";

describe("hosted onboarding landing helpers", () => {
  it("returns null when no public signup number is configured", () => {
    expect(parseHostedSignupPhoneNumber(null)).toBeNull();
    expect(parseHostedSignupPhoneNumber("")).toBeNull();
    expect(resolveHostedSignupPhoneNumber({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("normalizes the SMS href value while preserving the display value", () => {
    expect(parseHostedSignupPhoneNumber("+1 (415) 555-2671")).toEqual({
      displayValue: "+1 (415) 555-2671",
      smsValue: "+14155552671",
    });
  });

  it("rejects values that do not contain a valid phone-length digit count", () => {
    expect(parseHostedSignupPhoneNumber("abc")).toBeNull();
    expect(parseHostedSignupPhoneNumber("1234")).toBeNull();
  });

  it("derives Privy client readiness from the public app id only", () => {
    expect(resolveHostedPrivyClientAppId({} as NodeJS.ProcessEnv)).toBeNull();
    expect(hasHostedPrivyClientConfig(createProcessEnv({}))).toBe(false);
    expect(hasHostedPrivyClientConfig(createProcessEnv({ NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123" }))).toBe(true);
  });
});

function createProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values,
  };
}
