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
      WHOOP_CLIENT_ID: "whoop-client",
      WHOOP_CLIENT_SECRET: "whoop-secret",
    });

    expect(environment.publicBaseUrl).toBe("https://example.test/device-sync");
    expect(environment.devUserId).toBe("dev-user");
    expect(environment.trustedUserAssertionHeader).toBe("x-healthybob-user-assertion");
    expect(environment.trustedUserSignatureHeader).toBe("x-healthybob-user-signature");
    expect(environment.providers.whoop).toEqual({
      clientId: "whoop-client",
      clientSecret: "whoop-secret",
    });
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
