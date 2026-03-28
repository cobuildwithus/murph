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
