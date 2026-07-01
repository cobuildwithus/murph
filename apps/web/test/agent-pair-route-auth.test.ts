import { describe, expect, it, vi } from "vitest";

import {
  createHostedUserAssertionSignature,
  encodeHostedUserAssertion,
  type HostedUserAssertionClaims,
} from "@/src/lib/device-sync/auth";
import type { HostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncAgentSessionContext: vi.fn(),
  createAgentSession: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/agent-session-service", () => ({
  createHostedDeviceSyncAgentSessionContext: mocks.createHostedDeviceSyncAgentSessionContext,
}));

const pairRoute = await import("../app/api/device-sync/agents/pair/route");

const TRUSTED_USER_SIGNING_SECRET = "test-signing-secret";

const PRODUCTION_ENV_WITHOUT_CANONICAL_PUBLIC_ORIGIN: HostedDeviceSyncEnvironment = {
  allowedMutationOrigins: [],
  allowedReturnOrigins: [],
  isProduction: true,
  publicBaseUrl: null,
  routingIndexKey: Buffer.alloc(32, 0),
  trustedUserAssertionHeader: "x-hosted-user-assertion",
  trustedUserSignatureHeader: "x-hosted-user-signature",
  trustedUserSigningSecret: TRUSTED_USER_SIGNING_SECRET,
};

describe("hosted device-sync agent pair browser auth", () => {
  it("fails closed before creating an agent session when production has no canonical public origin", async () => {
    mocks.createAgentSession.mockResolvedValue({
      agent: {
        createdAt: "2026-03-26T12:00:00.000Z",
        expiresAt: "2026-04-25T12:00:00.000Z",
        id: "dsa_pair_123",
        label: "local laptop",
      },
      token: "device-sync-agent-token",
    });
    mocks.createHostedDeviceSyncAgentSessionContext.mockReturnValue({
      agentSessions: {
        createAgentSession: mocks.createAgentSession,
      },
      env: PRODUCTION_ENV_WITHOUT_CANONICAL_PUBLIC_ORIGIN,
      store: {
        consumeBrowserAssertionNonce: vi.fn().mockResolvedValue(true),
      },
    });

    const response = await pairRoute.POST(createSignedPairRequest("https://control.example.test"));

    expect(response.status).toBe(403);
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CSRF_ORIGIN_INVALID",
      },
    });
  });
});

function createSignedPairRequest(origin: string): Request {
  const url = `${origin}/api/device-sync/agents/pair`;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims: HostedUserAssertionClaims = {
    id: "user-123",
    email: "person@example.test",
    name: "Person",
    aud: origin,
    method: "POST",
    path: "/api/device-sync/agents/pair",
    origin,
    nonce: "nonce-production-pair-123456",
    iat: nowSeconds - 10,
    exp: nowSeconds + 60,
  };
  const assertion = encodeHostedUserAssertion(claims);

  return new Request(url, {
    body: JSON.stringify({
      label: "local laptop",
    }),
    headers: {
      "content-type": "application/json",
      origin,
      "x-hosted-user-assertion": assertion,
      "x-hosted-user-signature": createHostedUserAssertionSignature(
        assertion,
        TRUSTED_USER_SIGNING_SECRET,
      ),
    },
    method: "POST",
  });
}
