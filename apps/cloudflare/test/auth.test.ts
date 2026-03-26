import { describe, expect, it } from "vitest";

import { createHostedExecutionSignature, verifyHostedExecutionSignature } from "../src/auth.js";

describe("hosted execution auth", () => {
  it("creates and verifies matching HMAC signatures", async () => {
    const signature = await createHostedExecutionSignature({
      payload: "{\"ok\":true}",
      secret: "top-secret",
      timestamp: "2026-03-26T12:00:00.000Z",
    });

    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature,
        timestamp: "2026-03-26T12:00:00.000Z",
      }),
    ).resolves.toBe(true);
  });

  it("rejects altered signatures", async () => {
    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature: "deadbeef",
        timestamp: "2026-03-26T12:00:00.000Z",
      }),
    ).resolves.toBe(false);
  });
});
