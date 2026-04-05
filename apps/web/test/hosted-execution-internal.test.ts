import { createHostedExecutionSignatureHeaders } from "@murphai/hosted-execution";
import { afterEach, describe, expect, it } from "vitest";

import {
  authorizeHostedExecutionInternalRequest,
  requireHostedExecutionSchedulerToken,
  requireHostedExecutionUserId,
  requireHostedWebInternalSignedRequest,
} from "@/src/lib/hosted-execution/internal";

describe("hosted execution internal auth", () => {
  const originalSchedulerTokens = process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;
  const originalWebInternalSigningSecret = process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET;

  afterEach(() => {
    if (originalSchedulerTokens === undefined) {
      delete process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;
    } else {
      process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS = originalSchedulerTokens;
    }

    if (originalWebInternalSigningSecret === undefined) {
      delete process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET;
    } else {
      process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET = originalWebInternalSigningSecret;
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

  it("verifies Cloudflare-owned hosted web callbacks with the web internal signing secret", async () => {
    process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET = "web-internal-secret";
    const timestamp = new Date().toISOString();
    const headers = await createHostedExecutionSignatureHeaders({
      method: "POST",
      path: "/api/internal/device-sync/providers/whoop/connect-link",
      payload: "",
      secret: "web-internal-secret",
      timestamp,
      userId: "member_123",
    });

    await expect(
      requireHostedWebInternalSignedRequest(
        new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
          headers: {
            ...headers,
            "x-hosted-execution-user-id": "member_123",
          },
          method: "POST",
        }),
        {
          nonceStore: createNonceStore(),
        },
      ),
    ).resolves.toBe("member_123");
  });

  it("rejects requests signed with the wrong secret on Cloudflare-owned hosted web routes", async () => {
    process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET = "web-internal-secret";
    const timestamp = new Date().toISOString();
    const headers = await createHostedExecutionSignatureHeaders({
      method: "POST",
      path: "/api/internal/device-sync/providers/whoop/connect-link",
      payload: "",
      secret: "wrong-secret",
      timestamp,
      userId: "member_123",
    });

    await expect(
      requireHostedWebInternalSignedRequest(
        new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
          headers: {
            ...headers,
            "x-hosted-execution-user-id": "member_123",
          },
          method: "POST",
        }),
        {
          nonceStore: createNonceStore(),
        },
      ),
    ).rejects.toThrow("Unauthorized hosted web internal request.");
  });

  it("rejects signed hosted web requests when the bound user header does not match the MAC", async () => {
    process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET = "web-internal-secret";

    const headers = await createHostedExecutionSignatureHeaders({
      method: "POST",
      path: "/api/internal/device-sync/providers/whoop/connect-link",
      payload: "",
      secret: "web-internal-secret",
      timestamp: new Date().toISOString(),
      userId: "member_123",
    });

    await expect(
      requireHostedWebInternalSignedRequest(
        new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
          headers: {
            ...headers,
            "x-hosted-execution-user-id": "member_999",
          },
          method: "POST",
        }),
        {
          nonceStore: createNonceStore(),
        },
      ),
    ).rejects.toThrow("Unauthorized hosted web internal request.");
  });

  it("rejects replayed hosted web requests even inside the timestamp skew window", async () => {
    process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET = "web-internal-secret";
    const nonceStore = createNonceStore();
    const headers = await createHostedExecutionSignatureHeaders({
      method: "POST",
      path: "/api/internal/device-sync/providers/whoop/connect-link",
      payload: "",
      secret: "web-internal-secret",
      timestamp: "2026-04-05T06:00:00.000Z",
      userId: "member_123",
    });
    const request = new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
      headers: {
        ...headers,
        "x-hosted-execution-user-id": "member_123",
      },
      method: "POST",
    });

    await expect(
      requireHostedWebInternalSignedRequest(request.clone(), {
        nonceStore,
        nowMs: Date.parse("2026-04-05T06:00:30.000Z"),
      }),
    ).resolves.toBe("member_123");

    await expect(
      requireHostedWebInternalSignedRequest(request.clone(), {
        nonceStore,
        nowMs: Date.parse("2026-04-05T06:00:30.000Z"),
      }),
    ).rejects.toThrow("Hosted web internal request was already used and cannot be replayed.");
  });
});

function createNonceStore() {
  const consumed = new Set<string>();

  return {
    async consumeHostedWebInternalRequestNonce({ nonceHash }: { nonceHash: string }) {
      if (consumed.has(nonceHash)) {
        return false;
      }

      consumed.add(nonceHash);
      return true;
    },
  };
}
