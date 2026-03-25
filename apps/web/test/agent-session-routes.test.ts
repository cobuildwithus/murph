import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deviceSyncError } from "@healthybob/device-syncd";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  requireAgentSession: vi.fn(),
  exportTokenBundle: vi.fn(),
  refreshTokenBundle: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

type ExportRouteModule = typeof import("../app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route");
type RefreshRouteModule = typeof import("../app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route");

let exportRoute: ExportRouteModule;
let refreshRoute: RefreshRouteModule;

function createRouteContext(connectionId: string) {
  return {
    params: Promise.resolve({ connectionId }),
  };
}

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
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      requireAgentSession: mocks.requireAgentSession,
      exportTokenBundle: mocks.exportTokenBundle,
      refreshTokenBundle: mocks.refreshTokenBundle,
    });
    mocks.requireAgentSession.mockResolvedValue(session);
    mocks.exportTokenBundle.mockResolvedValue({
      connection: {
        id: "dsc_123",
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
        id: "dsa_rotated",
        label: "Mac mini",
        createdAt: "2026-03-25T00:05:00.000Z",
        expiresAt: "2026-03-26T00:05:00.000Z",
        bearerToken: "hbds_agent_rotated",
      },
    });
    mocks.refreshTokenBundle.mockResolvedValue({
      connection: {
        id: "dsc_123",
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
        id: "dsa_rotated",
        label: "Mac mini",
        createdAt: "2026-03-25T01:00:00.000Z",
        expiresAt: "2026-03-26T01:00:00.000Z",
        bearerToken: "hbds_agent_rotated",
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
      new Request("https://example.test/api/device-sync/agent/connections/dsc_123/export-token-bundle", {
        method: "POST",
        headers: {
          authorization: "Bearer hbds_agent_expired",
        },
      }),
      createRouteContext("dsc_123"),
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
      new Request("https://example.test/api/device-sync/agent/connections/dsc_123/refresh-token-bundle", {
        method: "POST",
        headers: {
          authorization: "Bearer hbds_agent_expired",
        },
        body: JSON.stringify({
          expectedTokenVersion: 2,
          force: true,
        }),
      }),
      createRouteContext("dsc_123"),
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

  it("passes the authenticated session into export-token-bundle so the handler can rotate it", async () => {
    const response = await exportRoute.POST(
      new Request("https://example.test/api/device-sync/agent/connections/dsc_123/export-token-bundle", {
        method: "POST",
        headers: {
          authorization: "Bearer hbds_agent_active",
        },
      }),
      createRouteContext("dsc_123"),
    );

    expect(response.status).toBe(200);
    expect(mocks.exportTokenBundle).toHaveBeenCalledWith(session, "dsc_123");
    await expect(response.json()).resolves.toMatchObject({
      agentSession: {
        id: "dsa_rotated",
        bearerToken: "hbds_agent_rotated",
      },
    });
  });

  it("passes the authenticated session and refresh options into refresh-token-bundle", async () => {
    const response = await refreshRoute.POST(
      new Request("https://example.test/api/device-sync/agent/connections/dsc_123/refresh-token-bundle", {
        method: "POST",
        headers: {
          authorization: "Bearer hbds_agent_active",
        },
        body: JSON.stringify({
          expectedTokenVersion: 2,
          force: true,
        }),
      }),
      createRouteContext("dsc_123"),
    );

    expect(response.status).toBe(200);
    expect(mocks.refreshTokenBundle).toHaveBeenCalledWith(session, "dsc_123", {
      expectedTokenVersion: 2,
      force: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      refreshed: true,
      agentSession: {
        id: "dsa_rotated",
        bearerToken: "hbds_agent_rotated",
      },
    });
  });
});
