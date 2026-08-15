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

  it("binds the native iOS custom environment to the exact Vercel deployment URL", () => {
    const source = createProcessEnv({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://stale.example.test/api/device-sync",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://stale.example.test",
      VERCEL_PROJECT_PRODUCTION_URL: "project.example.test",
      VERCEL_TARGET_ENV: "native-ios-e2e",
      VERCEL_URL: "exact-pr-sha.vercel.app",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBe("https://exact-pr-sha.vercel.app");
    expect(resolveHostedPublicOrigin(source)).toBe("https://exact-pr-sha.vercel.app");
    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBe(
      "https://exact-pr-sha.vercel.app/api/device-sync",
    );
  });

  it("fails closed when the native iOS custom environment lacks an exact Vercel URL", () => {
    const source = createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://stale.example.test",
      VERCEL_PROJECT_PRODUCTION_URL: "project.example.test",
      VERCEL_TARGET_ENV: "native-ios-e2e",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBeNull();
    expect(resolveHostedPublicOrigin(source)).toBeNull();
    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBeNull();
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

  it("normalizes explicit hosted public-base values without a scheme", () => {
    const source = createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "join.example.test",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBe("https://join.example.test");
    expect(resolveHostedPublicOrigin(source)).toBe("https://join.example.test");
  });

  it("accepts bracketed IPv6 loopback public-base URLs for local development", () => {
    const source = createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "http://[::1]:3000",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBe("http://[::1]:3000");
    expect(resolveHostedPublicOrigin(source)).toBe("http://[::1]:3000");
    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBe("http://[::1]:3000/api/device-sync");
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

  it("preserves explicit same-host device-sync public base URLs", () => {
    const source = createProcessEnv({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://www.withmurph.ai/device-sync",
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    });

    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBe("https://www.withmurph.ai/device-sync");
  });

  it("fails closed when a configured hosted public base URL includes a non-root path", () => {
    const source = createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test/app",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBeNull();
    expect(resolveHostedPublicOrigin(source)).toBeNull();
    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBeNull();
  });

  it("fails closed when HOSTED_WEB_BASE_URL includes a non-root path", () => {
    const source = createProcessEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test/app",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBeNull();
    expect(resolveHostedPublicOrigin(source)).toBeNull();
    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBeNull();
  });

  it("fails closed when the Vercel production fallback includes a non-root path", () => {
    const source = createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai/app",
    });

    expect(resolveHostedPublicBaseUrl(source)).toBeNull();
    expect(resolveHostedPublicOrigin(source)).toBeNull();
    expect(resolveHostedDeviceSyncPublicBaseUrl(source)).toBeNull();
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
