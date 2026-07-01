import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deviceSyncError } from "@murphai/device-syncd/errors";

import { createBearerRequest, createRouteContext } from "./route-test-helpers";

function createJsonPostBearerRequest(url: string, bearerToken: string, body: unknown) {
  return createBearerRequest(url, bearerToken, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncAgentSessionService: vi.fn(),
  exportTokenBundle: vi.fn(),
  refreshTokenBundle: vi.fn(),
  requireAgentSession: vi.fn(),
  revokeAgentSession: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/agent-session-service", () => ({
  createHostedDeviceSyncAgentSessionService: mocks.createHostedDeviceSyncAgentSessionService,
}));

type ExportRouteModule = typeof import("../app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route");
type RefreshRouteModule = typeof import("../app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route");
type RevokeRouteModule = typeof import("../app/api/device-sync/agent/session/revoke/route");

let exportRoute: ExportRouteModule;
let refreshRoute: RefreshRouteModule;
let revokeRoute: RevokeRouteModule;

describe("hosted device-sync agent token routes", () => {
  const session = {
    id: "dsa_active",
    userId: "user-123",
    label: "Mac mini",
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    expiresAt: "2026-03-26T00:00:00.000Z",
    lastSeenAt: "2026-03-25T00:00:00.000Z",
    revokedAt: null,
    revokeReason: null,
    replacedBySessionId: null,
  };

  beforeAll(async () => {
    exportRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route");
    refreshRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route");
    revokeRoute = await import("../app/api/device-sync/agent/session/revoke/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncAgentSessionService.mockReturnValue({
      requireAgentSession: mocks.requireAgentSession,
      exportTokenBundle: mocks.exportTokenBundle,
      refreshTokenBundle: mocks.refreshTokenBundle,
      revokeAgentSession: mocks.revokeAgentSession,
    });
    mocks.requireAgentSession.mockResolvedValue(session);
    mocks.exportTokenBundle.mockResolvedValue({
      connection: {
        id: "dsc_123",
        externalAccountId: "acct_123",
        provider: "oura",
      },
      tokenBundle: {
        accessToken: "access",
        refreshToken: "refresh",
        accessTokenExpiresAt: "2026-03-25T01:00:00.000Z",
        tokenVersion: 2,
        keyVersion: "v1",
        exportedAt: "2026-03-25T00:05:00.000Z",
      },
      agentSession: {
        id: "dsa_active",
        label: "Mac mini",
        createdAt: "2026-03-25T00:00:00.000Z",
        expiresAt: "2026-03-26T00:05:00.000Z",
        bearerToken: "hbds_agent_active",
      },
    });
    mocks.refreshTokenBundle.mockResolvedValue({
      connection: {
        id: "dsc_123",
        externalAccountId: "acct_123",
        provider: "oura",
      },
      tokenBundle: {
        accessToken: "access-next",
        refreshToken: "refresh-next",
        accessTokenExpiresAt: "2026-03-25T02:00:00.000Z",
        tokenVersion: 3,
        keyVersion: "v1",
        exportedAt: "2026-03-25T01:00:00.000Z",
      },
      refreshed: true,
      tokenVersionChanged: false,
      agentSession: {
        id: "dsa_active",
        label: "Mac mini",
        createdAt: "2026-03-25T00:00:00.000Z",
        expiresAt: "2026-03-26T01:00:00.000Z",
        bearerToken: "hbds_agent_active",
      },
    });
    mocks.revokeAgentSession.mockResolvedValue({
      agentSession: {
        id: "dsa_active",
        revokedAt: "2026-03-25T01:30:00.000Z",
        revokeReason: "agent_request",
      },
    });
  });

  it("rejects expired bearer tokens before export-token-bundle", async () => {
    mocks.requireAgentSession.mockRejectedValueOnce(
      deviceSyncError({
        code: "AGENT_AUTH_EXPIRED",
        message: "Hosted device-sync agent bearer token expired.",
        retryable: false,
        httpStatus: 401,
      }),
    );

    const response = await exportRoute.POST(
      createBearerRequest(
        "https://example.test/api/device-sync/agent/connections/dsc_123/export-token-bundle",
        "hbds_agent_expired",
        { method: "POST" },
      ),
      createRouteContext({ connectionId: "dsc_123" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AGENT_AUTH_EXPIRED",
        message: "Hosted device-sync agent bearer token expired.",
        retryable: false,
      },
    });
    expect(mocks.exportTokenBundle).not.toHaveBeenCalled();
  });

  it("rejects expired bearer tokens before refresh-token-bundle", async () => {
    mocks.requireAgentSession.mockRejectedValueOnce(
      deviceSyncError({
        code: "AGENT_AUTH_EXPIRED",
        message: "Hosted device-sync agent bearer token expired.",
        retryable: false,
        httpStatus: 401,
      }),
    );

    const response = await refreshRoute.POST(
      createJsonPostBearerRequest(
        "https://example.test/api/device-sync/agent/connections/dsc_123/refresh-token-bundle",
        "hbds_agent_expired",
        {
          expectedTokenVersion: 2,
          force: true,
        },
      ),
      createRouteContext({ connectionId: "dsc_123" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AGENT_AUTH_EXPIRED",
        message: "Hosted device-sync agent bearer token expired.",
        retryable: false,
      },
    });
    expect(mocks.refreshTokenBundle).not.toHaveBeenCalled();
  });

  it("passes the authenticated session into export-token-bundle", async () => {
    const response = await exportRoute.POST(
      createBearerRequest(
        "https://example.test/api/device-sync/agent/connections/dsc_123/export-token-bundle",
        "hbds_agent_active",
        { method: "POST" },
      ),
      createRouteContext({ connectionId: "dsc_123" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.exportTokenBundle).toHaveBeenCalledWith(session, "dsc_123");
    const body = await response.json();
    expect(body).toMatchObject({
      connection: {
        externalAccountId: "acct_123",
        id: "dsc_123",
      },
      tokenBundle: {
        accessToken: "access",
        tokenVersion: 2,
      },
    });
    expect(body).not.toHaveProperty("agentSession");
    expect(JSON.stringify(body)).not.toContain("hbds_agent_active");
  });

  it("passes the authenticated session and refresh options into refresh-token-bundle", async () => {
    const response = await refreshRoute.POST(
      createJsonPostBearerRequest(
        "https://example.test/api/device-sync/agent/connections/dsc_123/refresh-token-bundle",
        "hbds_agent_active",
        {
          expectedTokenVersion: 2,
          force: true,
        },
      ),
      createRouteContext({ connectionId: "dsc_123" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.refreshTokenBundle).toHaveBeenCalledWith(session, "dsc_123", {
      expectedTokenVersion: 2,
      force: true,
    });
    const body = await response.json();
    expect(body).toMatchObject({
      connection: {
        externalAccountId: "acct_123",
        id: "dsc_123",
      },
      refreshed: true,
      tokenVersionChanged: false,
    });
    expect(body).not.toHaveProperty("agentSession");
    expect(JSON.stringify(body)).not.toContain("hbds_agent_active");
  });

  it("omits the refresh-token-bundle version fence when expectedTokenVersion is absent or null", async () => {
    for (const body of [
      { force: true },
      { expectedTokenVersion: null, force: false },
    ]) {
      mocks.refreshTokenBundle.mockClear();

      const response = await refreshRoute.POST(
        createJsonPostBearerRequest(
          "https://example.test/api/device-sync/agent/connections/dsc_123/refresh-token-bundle",
          "hbds_agent_active",
          body,
        ),
        createRouteContext({ connectionId: "dsc_123" }),
      );

      expect(response.status).toBe(200);
      expect(mocks.refreshTokenBundle).toHaveBeenCalledWith(session, "dsc_123", {
        expectedTokenVersion: null,
        force: body.force === true,
      });
    }
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["string", "2"],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a present non-positive-safe-integer expectedTokenVersion: %s", async (_label, expectedTokenVersion) => {
    const response = await refreshRoute.POST(
      createJsonPostBearerRequest(
        "https://example.test/api/device-sync/agent/connections/dsc_123/refresh-token-bundle",
        "hbds_agent_active",
        {
          expectedTokenVersion,
          force: true,
        },
      ),
      createRouteContext({ connectionId: "dsc_123" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_EXPECTED_TOKEN_VERSION",
        message: "expectedTokenVersion must be a positive safe integer when provided.",
        retryable: false,
      },
    });
    expect(mocks.refreshTokenBundle).not.toHaveBeenCalled();
  });

  it("passes the authenticated session into revoke so the handler can invalidate it", async () => {
    const response = await revokeRoute.POST(
      createBearerRequest("https://example.test/api/device-sync/agent/session/revoke", "hbds_agent_active", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.revokeAgentSession).toHaveBeenCalledWith(session);
    await expect(response.json()).resolves.toEqual({
      agentSession: {
        id: "dsa_active",
        revokedAt: "2026-03-25T01:30:00.000Z",
        revokeReason: "agent_request",
      },
    });
  });
});
