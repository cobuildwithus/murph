import { describe, expect, it } from "vitest";

import {
  hasHostedPrivyClientConfig,
  parseHostedSignupPhoneNumber,
  resolveHostedInstallScriptUrl,
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

  it("derives the hosted install-script URL from the public base URL", () => {
    expect(resolveHostedInstallScriptUrl(createProcessEnv({}))).toBeNull();
    expect(
      resolveHostedInstallScriptUrl(
        createProcessEnv({ HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test" }),
      ),
    ).toBe("https://join.example.test/install.sh");
    expect(
      resolveHostedInstallScriptUrl(
        createProcessEnv({ NEXT_PUBLIC_SITE_URL: "https://murph.example.test/app" }),
      ),
    ).toBe("https://murph.example.test/install.sh");
    expect(
      resolveHostedInstallScriptUrl(
        createProcessEnv({ HOSTED_ONBOARDING_PUBLIC_BASE_URL: "not-a-url" }),
      ),
    ).toBeNull();
    expect(
      resolveHostedInstallScriptUrl(
        createProcessEnv({ VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai" }),
      ),
    ).toBe("https://www.withmurph.ai/install.sh");
  });
});

function createProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values,
  };
}
