import { describe, expect, it } from "vitest";

import {
  resolveHostedDeviceSyncPublicBaseUrl,
  resolveHostedPublicBaseUrl,
  resolveHostedPublicOrigin,
} from "@/src/lib/hosted-web/public-url";

describe("hosted public URL helpers", () => {
  it("prefers explicit hosted env over the Vercel production domain", () => {
    const source = createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test",
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBe("https://join.example.test");
  });

  it("normalizes the Vercel production domain into an HTTPS URL", () => {
    const source = createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBe("https://www.withmurph.ai");
    expect(resolveHostedPublicOrigin(source)).toBe("https://www.withmurph.ai");
  });

  it("uses HOSTED_WEB_BASE_URL when higher-priority public-base envs are unset", () => {
    const source = createProcessEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBe("https://web.example.test");
  });

  it("keeps higher-priority hosted public-base envs ahead of HOSTED_WEB_BASE_URL", () => {
    expect(resolveHostedPublicBaseUrl(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }))).toBe("https://join.example.test");
  });

  it("derives the hosted device-sync route from the canonical public origin", () => {
    const source = createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    });

    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBe("https://www.withmurph.ai/api/device-sync");
  });

  it("preserves explicit device-sync public base URLs", () => {
    const source = createProcessEnv({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://api.example.test/device-sync",
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    });

    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBe("https://api.example.test/device-sync");
  });

  it("returns null for an invalid Vercel production-domain fallback", () => {
    const source = createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "http://www.withmurph.ai",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBeNull();
    expect(resolveHostedPublicOrigin(source)).toBeNull();
    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBeNull();
  });
});

function createProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values,
  };
}
