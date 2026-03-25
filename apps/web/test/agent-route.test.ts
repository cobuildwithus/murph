import { deviceSyncError } from "@healthybob/device-syncd";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  exportTokenBundle: vi.fn(),
  refreshTokenBundle: vi.fn(),
  requireAgentSession: vi.fn(),
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
  beforeAll(async () => {
    exportRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route");
    refreshRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      exportTokenBundle: mocks.exportTokenBundle,
      refreshTokenBundle: mocks.refreshTokenBundle,
      requireAgentSession: mocks.requireAgentSession,
    });
    mocks.requireAgentSession.mockResolvedValue({
      id: "dsa_current",
      userId: "user-123",
    });
  });

  it("rejects export-token-bundle when the bearer token has expired", async () => {
    mocks.requireAgentSession.mockRejectedValue(
      deviceSyncError({
        code: "AGENT_AUTH_EXPIRED",
        message:
          "Hosted device-sync agent bearer token expired. Pair again or keep using the latest bearer returned by export-token-bundle or refresh-token-bundle.",
        httpStatus: 401,
      }),
    );

    const response = await exportRoute.POST(
      new Request("https://example.test/api/device-sync/agent/connections/dsc_123/export-token-bundle", {
        method: "POST",
        headers: {
          authorization: "Bearer expired-session-token",
        },
      }),
      createRouteContext("dsc_123"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "AGENT_AUTH_EXPIRED",
        message:
          "Hosted device-sync agent bearer token expired. Pair again or keep using the latest bearer returned by export-token-bundle or refresh-token-bundle.",
        retryable: false,
      },
    });
    expect(mocks.exportTokenBundle).not.toHaveBeenCalled();
  });

  it("rejects refresh-token-bundle when the bearer token has expired", async () => {
    mocks.requireAgentSession.mockRejectedValue(
      deviceSyncError({
        code: "AGENT_AUTH_EXPIRED",
        message:
          "Hosted device-sync agent bearer token expired. Pair again or keep using the latest bearer returned by export-token-bundle or refresh-token-bundle.",
        httpStatus: 401,
      }),
    );

    const response = await refreshRoute.POST(
      new Request("https://example.test/api/device-sync/agent/connections/dsc_123/refresh-token-bundle", {
        method: "POST",
        headers: {
          authorization: "Bearer expired-session-token",
        },
        body: JSON.stringify({
          expectedTokenVersion: 7,
          force: true,
        }),
      }),
      createRouteContext("dsc_123"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "AGENT_AUTH_EXPIRED",
        message:
          "Hosted device-sync agent bearer token expired. Pair again or keep using the latest bearer returned by export-token-bundle or refresh-token-bundle.",
        retryable: false,
      },
    });
    expect(mocks.refreshTokenBundle).not.toHaveBeenCalled();
  });
});
