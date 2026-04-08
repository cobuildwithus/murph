import { describe, expect, it } from "vitest";

import { sanitizeStoredDeviceSyncMetadata } from "@murphai/device-syncd/public-ingress";

describe("sanitizeStoredDeviceSyncMetadata", () => {
  it("drops secret-like keys before connection metadata is persisted or mirrored", () => {
    expect(
      sanitizeStoredDeviceSyncMetadata({
        syncMode: "polling",
        accessToken: "access-token",
        refresh_token: "refresh-token",
        authorization: "Bearer secret",
        clientSecret: "client-secret",
        apiKey: "api-key",
        sessionId: "session-id",
      }),
    ).toEqual({
      syncMode: "polling",
    });
  });
});
