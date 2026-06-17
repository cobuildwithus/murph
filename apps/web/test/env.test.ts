import { describe, expect, it } from "vitest";

import { readHostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";

const TEST_KEY = Buffer.alloc(32, 9).toString("base64url");

describe("readHostedDeviceSyncEnvironment", () => {
  it("reads the hosted device-sync env from unprefixed variables", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      HOSTED_DEVICE_ROUTING_INDEX_KEY: TEST_KEY,
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://example.test/device-sync",
      OURA_CLIENT_ID: "oura-client",
      OURA_CLIENT_SECRET: "oura-secret",
      OURA_WEBHOOK_VERIFICATION_TOKEN: "verify-token-for-tests",
    });

    expect(environment.publicBaseUrl).toBe("https://example.test/device-sync");
    expect(environment.trustedUserAssertionHeader).toBe("x-hosted-user-assertion");
    expect(environment.trustedUserSignatureHeader).toBe("x-hosted-user-signature");
    expect(environment).not.toHaveProperty("ouraWebhookVerificationToken");
    expect(environment).not.toHaveProperty("providers");
  });

  it("falls back to the Vercel production domain for hosted defaults", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      HOSTED_DEVICE_ROUTING_INDEX_KEY: TEST_KEY,
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
        HOSTED_DEVICE_ROUTING_INDEX_KEY: TEST_KEY,
        VERCEL_PROJECT_PRODUCTION_URL: "http://www.withmurph.ai",
      }),
    ).toThrow(/Hosted execution base URLs must use HTTPS/u);
  });

  it("preserves explicit device-sync values when a lower-priority hosted public URL is invalid", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      HOSTED_DEVICE_ROUTING_INDEX_KEY: TEST_KEY,
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://api.withmurph.ai/device-sync",
      DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS: "https://www.withmurph.ai",
      DEVICE_SYNC_ALLOWED_RETURN_ORIGINS: "https://www.withmurph.ai",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://",
    });

    expect(environment.publicBaseUrl).toBe("https://api.withmurph.ai/device-sync");
    expect(environment.allowedMutationOrigins).toEqual(["https://www.withmurph.ai"]);
    expect(environment.allowedReturnOrigins).toEqual(["https://www.withmurph.ai"]);
  });

  it("preserves explicit empty allowlists instead of activating the canonical fallback origin", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      HOSTED_DEVICE_ROUTING_INDEX_KEY: TEST_KEY,
      DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS: "",
      DEVICE_SYNC_ALLOWED_RETURN_ORIGINS: "",
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    });

    expect(environment.allowedMutationOrigins).toEqual([]);
    expect(environment.allowedReturnOrigins).toEqual([]);
  });

  it("requires HOSTED_DEVICE_ROUTING_INDEX_KEY", () => {
    expect(() =>
      readHostedDeviceSyncEnvironment({
        NODE_ENV: "test",
        WHOOP_CLIENT_ID: "whoop-client",
        WHOOP_CLIENT_SECRET: "whoop-secret",
      }),
    ).toThrow(/HOSTED_DEVICE_ROUTING_INDEX_KEY/u);
  });

});
