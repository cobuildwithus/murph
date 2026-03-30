import { describe, expect, it } from "vitest";

import { readHostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";

const TEST_KEY = Buffer.alloc(32, 9).toString("base64url");

describe("readHostedDeviceSyncEnvironment", () => {
  it("reads the hosted device-sync env from unprefixed variables", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://example.test/device-sync",
      DEVICE_SYNC_DEV_USER_ID: "dev-user",
      WHOOP_BASE_URL: "https://whoop.test",
      WHOOP_RECONCILE_INTERVAL_MS: "900000",
      WHOOP_REQUEST_TIMEOUT_MS: "45000",
      WHOOP_SCOPES: "offline,read:sleep,custom",
      WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS: "120000",
      WHOOP_CLIENT_ID: "whoop-client",
      WHOOP_CLIENT_SECRET: "whoop-secret",
    });

    expect(environment.publicBaseUrl).toBe("https://example.test/device-sync");
    expect(environment.devUserId).toBe("dev-user");
    expect(environment.trustedUserAssertionHeader).toBe("x-hosted-user-assertion");
    expect(environment.trustedUserSignatureHeader).toBe("x-hosted-user-signature");
    expect(environment.providers.whoop).toEqual(expect.objectContaining({
      baseUrl: "https://whoop.test",
      clientId: "whoop-client",
      clientSecret: "whoop-secret",
      reconcileIntervalMs: 900000,
      requestTimeoutMs: 45000,
      webhookTimestampToleranceMs: 120000,
    }));
    expect(environment.providers.whoop?.scopes).toContain("custom");
  });

  it("passes Oura provider tuning through the shared hosted config reader", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://example.test/device-sync",
      OURA_AUTH_BASE_URL: "https://oura-auth.test",
      OURA_API_BASE_URL: "https://oura-api.test",
      OURA_CLIENT_ID: "oura-client",
      OURA_CLIENT_SECRET: "oura-secret",
      OURA_RECONCILE_INTERVAL_MS: "600000",
      OURA_REQUEST_TIMEOUT_MS: "30000",
      OURA_SCOPES: "daily,heartrate,custom",
      OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS: "180000",
    });

    expect(environment.providers.oura).toEqual(expect.objectContaining({
      authBaseUrl: "https://oura-auth.test",
      apiBaseUrl: "https://oura-api.test",
      clientId: "oura-client",
      clientSecret: "oura-secret",
      reconcileIntervalMs: 600000,
      requestTimeoutMs: 30000,
      webhookTimestampToleranceMs: 180000,
    }));
    expect(environment.providers.oura?.scopes).toContain("custom");
  });

  it("falls back to the Vercel production domain for hosted defaults", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    });

    expect(environment.publicBaseUrl).toBe("https://www.withmurph.ai/api/device-sync");
    expect(environment.allowedMutationOrigins).toEqual(["https://www.withmurph.ai"]);
    expect(environment.allowedReturnOrigins).toEqual(["https://www.withmurph.ai"]);
  });

  it("rejects an invalid Vercel production-domain fallback", () => {
    expect(() =>
      readHostedDeviceSyncEnvironment({
        NODE_ENV: "test",
        DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
        VERCEL_PROJECT_PRODUCTION_URL: "http://www.withmurph.ai",
      }),
    ).toThrow(/Hosted execution base URLs must use HTTPS/u);
  });

  it("preserves explicit device-sync values when a lower-priority hosted public URL is invalid", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://api.withmurph.ai/device-sync",
      DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS: "https://www.withmurph.ai",
      DEVICE_SYNC_ALLOWED_RETURN_ORIGINS: "https://www.withmurph.ai",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "not-a-url",
    });

    expect(environment.publicBaseUrl).toBe("https://api.withmurph.ai/device-sync");
    expect(environment.allowedMutationOrigins).toEqual(["https://www.withmurph.ai"]);
    expect(environment.allowedReturnOrigins).toEqual(["https://www.withmurph.ai"]);
  });

  it("preserves explicit empty allowlists instead of activating the canonical fallback origin", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS: "",
      DEVICE_SYNC_ALLOWED_RETURN_ORIGINS: "",
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    });

    expect(environment.allowedMutationOrigins).toEqual([]);
    expect(environment.allowedReturnOrigins).toEqual([]);
  });

  it("requires DEVICE_SYNC_ENCRYPTION_KEY", () => {
    expect(() =>
      readHostedDeviceSyncEnvironment({
        NODE_ENV: "test",
        WHOOP_CLIENT_ID: "whoop-client",
        WHOOP_CLIENT_SECRET: "whoop-secret",
      }),
    ).toThrow(/DEVICE_SYNC_ENCRYPTION_KEY/u);
  });
});
