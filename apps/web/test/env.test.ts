import { describe, expect, it } from "vitest";

import { readHostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";

const TEST_KEY = Buffer.alloc(32, 9).toString("base64url");

describe("readHostedDeviceSyncEnvironment", () => {
  it("accepts legacy HEALTHYBOB_* aliases", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      HEALTHYBOB_DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL: "https://example.test/device-sync",
      HEALTHYBOB_DEVICE_SYNC_DEV_USER_ID: "legacy-dev-user",
      HEALTHYBOB_WHOOP_CLIENT_ID: "legacy-whoop-client",
      HEALTHYBOB_WHOOP_CLIENT_SECRET: "legacy-whoop-secret",
    });

    expect(environment.publicBaseUrl).toBe("https://example.test/device-sync");
    expect(environment.devUserId).toBe("legacy-dev-user");
    expect(environment.providers.whoop).toEqual({
      clientId: "legacy-whoop-client",
      clientSecret: "legacy-whoop-secret",
    });
  });

  it("prefers unprefixed env vars over legacy aliases", () => {
    const environment = readHostedDeviceSyncEnvironment({
      NODE_ENV: "test",
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      DEVICE_SYNC_DEV_USER_ID: "primary-dev-user",
      HEALTHYBOB_DEVICE_SYNC_DEV_USER_ID: "legacy-dev-user",
      WHOOP_CLIENT_ID: "primary-whoop-client",
      WHOOP_CLIENT_SECRET: "primary-whoop-secret",
      HEALTHYBOB_WHOOP_CLIENT_ID: "legacy-whoop-client",
      HEALTHYBOB_WHOOP_CLIENT_SECRET: "legacy-whoop-secret",
    });

    expect(environment.devUserId).toBe("primary-dev-user");
    expect(environment.providers.whoop).toEqual({
      clientId: "primary-whoop-client",
      clientSecret: "primary-whoop-secret",
    });
  });
});
