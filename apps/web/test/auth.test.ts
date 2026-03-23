import { describe, expect, it } from "vitest";

import { requireAuthenticatedHostedUser } from "@/src/lib/device-sync/auth";
import type { HostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";

const BASE_ENVIRONMENT: HostedDeviceSyncEnvironment = {
  allowedReturnOrigins: [],
  encryptionKey: Buffer.alloc(32, 0),
  encryptionKeyVersion: "v1",
  isProduction: false,
  ouraWebhookVerificationToken: null,
  publicBaseUrl: null,
  trustedUserEmailHeader: "x-healthybob-user-email",
  trustedUserIdHeader: "x-healthybob-user-id",
  trustedUserNameHeader: "x-healthybob-user-name",
  devUserEmail: "dev@example.com",
  devUserId: "dev-user",
  devUserName: "Dev User",
  providers: {
    whoop: null,
    oura: null,
  },
};

describe("requireAuthenticatedHostedUser", () => {
  it("prefers trusted user headers", () => {
    const request = new Request("https://example.test/device-sync", {
      headers: {
        "x-healthybob-user-id": "user-123",
        "x-healthybob-user-email": "person@example.com",
        "x-healthybob-user-name": "Person",
      },
    });

    expect(requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT)).toEqual({
      id: "user-123",
      email: "person@example.com",
      name: "Person",
      source: "trusted-header",
    });
  });

  it("falls back to the development user when trusted headers are absent", () => {
    const request = new Request("https://example.test/device-sync");

    expect(requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT)).toEqual({
      id: "dev-user",
      email: "dev@example.com",
      name: "Dev User",
      source: "development-fallback",
    });
  });
});
