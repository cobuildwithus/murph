import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const nextServer = vi.hoisted(() => ({
  NextResponse: class NextResponse extends Response {
    static json(payload: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    }

    static redirect(url: string, init?: number | ResponseInit) {
      const responseInit = typeof init === "number" ? { status: init } : (init ?? {});
      return new NextResponse(null, {
        ...responseInit,
        headers: {
          location: url,
          ...(responseInit.headers ?? {}),
        },
      });
    }
  },
}));

const deviceSyncd = vi.hoisted(() => ({
  DeviceSyncError: Error,
  deviceSyncError: (input: {
    code: string;
    message: string;
    retryable?: boolean;
    httpStatus?: number;
    details?: unknown;
  }) =>
    Object.assign(new Error(input.message), {
      code: input.code,
      retryable: input.retryable ?? false,
      httpStatus: input.httpStatus ?? 500,
      details: input.details,
    }),
  isDeviceSyncError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "code" in error && "httpStatus" in error),
}));

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  recordLocalHeartbeat: vi.fn(),
  requireAgentSession: vi.fn(),
}));

vi.mock("next/server", () => nextServer);
vi.mock("@healthybob/device-syncd", () => deviceSyncd);

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

type RouteModule = typeof import("../app/api/device-sync/agent/connections/[connectionId]/local-heartbeat/route");

let route: RouteModule;

function createRouteContext(connectionId: string) {
  return {
    params: Promise.resolve({ connectionId }),
  };
}

describe("hosted device-sync local-heartbeat route", () => {
  beforeAll(async () => {
    route = await import("../app/api/device-sync/agent/connections/[connectionId]/local-heartbeat/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      recordLocalHeartbeat: mocks.recordLocalHeartbeat,
      requireAgentSession: mocks.requireAgentSession,
    });
    mocks.requireAgentSession.mockResolvedValue({
      id: "dsa_current",
      userId: "user-123",
    });
    mocks.recordLocalHeartbeat.mockResolvedValue({
      connection: {
        id: "dsc_123",
      },
    });
  });

  it("rejects attempts to overwrite server-owned heartbeat fields", async () => {
    const response = await route.POST(
      new Request("https://example.test/api/device-sync/agent/connections/dsc_123/local-heartbeat", {
        method: "POST",
        headers: {
          authorization: "Bearer live-session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "disconnected",
          nextReconcileAt: "2099-01-01T00:00:00.000Z",
          clearError: true,
        }),
      }),
      createRouteContext("dsc_123"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_LOCAL_HEARTBEAT",
        message: "Local heartbeat may not update server-owned fields: status, nextReconcileAt, clearError.",
      },
    });
    expect(mocks.recordLocalHeartbeat).not.toHaveBeenCalled();
  });

  it("rejects malformed or out-of-contract telemetry values", async () => {
    const response = await route.POST(
      new Request("https://example.test/api/device-sync/agent/connections/dsc_123/local-heartbeat", {
        method: "POST",
        headers: {
          authorization: "Bearer live-session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lastSyncStartedAt: "not-a-date",
          lastErrorCode: "SYNC_FAILED",
        }),
      }),
      createRouteContext("dsc_123"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_LOCAL_HEARTBEAT",
      },
    });
    expect(mocks.recordLocalHeartbeat).not.toHaveBeenCalled();
  });

  it("forwards only validated telemetry fields with canonical timestamps", async () => {
    await route.POST(
      new Request("https://example.test/api/device-sync/agent/connections/dsc_123/local-heartbeat", {
        method: "POST",
        headers: {
          authorization: "Bearer live-session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lastSyncStartedAt: "2026-03-25T10:00:00+10:00",
          lastSyncErrorAt: "2026-03-25T10:15:00+10:00",
          lastErrorCode: "AUTH_REFRESH_FAILED",
          lastErrorMessage: "Refresh token expired",
        }),
      }),
      createRouteContext("dsc_123"),
    );

    expect(mocks.recordLocalHeartbeat).toHaveBeenCalledWith("user-123", "dsc_123", {
      lastSyncStartedAt: "2026-03-25T00:00:00.000Z",
      lastSyncErrorAt: "2026-03-25T00:15:00.000Z",
      lastErrorCode: "AUTH_REFRESH_FAILED",
      lastErrorMessage: "Refresh token expired",
    });
  });
});
