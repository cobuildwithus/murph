import { createHostedExecutionSignatureHeaders } from "@murphai/hosted-execution";
import { afterEach, describe, expect, it } from "vitest";

import {
  authorizeHostedExecutionInternalRequest,
  requireHostedExecutionSignedControlRequest,
  requireHostedExecutionSchedulerToken,
  requireHostedExecutionUserId,
} from "@/src/lib/hosted-execution/internal";

describe("hosted execution internal auth", () => {
  const originalControlSigningSecret = process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET;
  const originalSchedulerTokens = process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;
  const originalSigningSecret = process.env.HOSTED_EXECUTION_SIGNING_SECRET;

  afterEach(() => {
    if (originalControlSigningSecret === undefined) {
      delete process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET;
    } else {
      process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET = originalControlSigningSecret;
    }

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

  it("accepts configured scheduler bearer tokens after normalizing the authorization header", () => {
    process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS = "token-one, token-two";

    expect(() =>
      authorizeHostedExecutionInternalRequest({
        acceptedToken: "scheduler",
        request: new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron", {
          headers: {
            authorization: "  Bearer token-two  ",
          },
        }),
      }),
    ).not.toThrow();
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

  it("verifies signed hosted control requests with the control secret when configured", async () => {
    process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET = "control-secret";
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "dispatch-secret";
    const timestamp = new Date().toISOString();
    const headers = await createHostedExecutionSignatureHeaders({
      method: "POST",
      path: "/api/internal/device-sync/providers/whoop/connect-link",
      payload: "",
      secret: "control-secret",
      timestamp,
    });

    await expect(
      requireHostedExecutionSignedControlRequest(
        new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
          headers,
          method: "POST",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects dispatch-secret signatures when a distinct control secret is configured", async () => {
    process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET = "control-secret";
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
      requireHostedExecutionSignedControlRequest(
        new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
          headers,
          method: "POST",
        }),
      ),
    ).rejects.toThrow("Unauthorized hosted execution request.");
  });

  it("falls back to the dispatch signing secret for control routes when no separate control secret is configured", async () => {
    delete process.env.HOSTED_EXECUTION_CONTROL_SIGNING_SECRET;
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
      requireHostedExecutionSignedControlRequest(
        new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
          headers,
          method: "POST",
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
