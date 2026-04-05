import { createHostedExecutionSignatureHeaders } from "@murphai/hosted-execution";
import { afterEach, describe, expect, it } from "vitest";

import {
  requireHostedExecutionSignedRequest,
  requireHostedExecutionSchedulerToken,
  requireHostedExecutionUserId,
} from "@/src/lib/hosted-execution/internal";

describe("hosted execution internal auth", () => {
  const originalSchedulerTokens = process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;
  const originalSigningSecret = process.env.HOSTED_EXECUTION_SIGNING_SECRET;

  afterEach(() => {
    if (originalSchedulerTokens === undefined) {
      delete process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;
    } else {
      process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS = originalSchedulerTokens;
    }

    if (originalSigningSecret === undefined) {
      delete process.env.HOSTED_EXECUTION_SIGNING_SECRET;
    } else {
      process.env.HOSTED_EXECUTION_SIGNING_SECRET = originalSigningSecret;
    }
  });

  it("fails when scheduler tokens are not configured", () => {
    delete process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;

    expect(() =>
      requireHostedExecutionSchedulerToken(
        new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron"),
      ),
    ).toThrow("HOSTED_EXECUTION_SCHEDULER_TOKENS must be configured for scheduled hosted execution drains.");
  });

  it("requires the bound hosted execution user header for user-scoped internal routes", () => {
    expect(() =>
      requireHostedExecutionUserId(
        new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link"),
      ),
    ).toThrow("x-hosted-execution-user-id header is required for hosted execution user-bound routes.");

    expect(
      requireHostedExecutionUserId(
        new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
          headers: {
            "x-hosted-execution-user-id": "member_123",
          },
        }),
      ),
    ).toBe("member_123");
  });

  it("verifies signed hosted execution requests for user-scoped internal routes", async () => {
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "dispatch-secret";
    const timestamp = new Date().toISOString();
    const headers = await createHostedExecutionSignatureHeaders({
      method: "POST",
      path: "/api/internal/device-sync/providers/whoop/connect-link",
      payload: "",
      secret: "dispatch-secret",
      timestamp,
    });

    await expect(
      requireHostedExecutionSignedRequest({
        payload: "",
        request: new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
          headers,
          method: "POST",
        }),
      }),
    ).resolves.toBeUndefined();
  });
});
