import { deviceSyncError } from "@murph/device-syncd";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  exportTokenBundle: vi.fn(),
  handleWebhook: vi.fn(),
  listSignals: vi.fn(),
  refreshTokenBundle: vi.fn(),
  requireAgentSession: vi.fn(),
  resolveWebhookVerificationChallenge: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

type ExportRouteModule = typeof import("../app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route");
type RefreshRouteModule = typeof import("../app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route");
type SignalsRouteModule = typeof import("../app/api/device-sync/agent/signals/route");
type WebhookRouteModule = typeof import("../app/api/device-sync/webhooks/[provider]/route");

let exportRoute: ExportRouteModule;
let refreshRoute: RefreshRouteModule;
let signalsRoute: SignalsRouteModule;
let webhookRoute: WebhookRouteModule;

function createRouteContext(connectionId: string) {
  return {
    params: Promise.resolve({ connectionId }),
  };
}

describe("hosted device-sync agent and webhook routes", () => {
  beforeAll(async () => {
    exportRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route");
    refreshRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route");
    signalsRoute = await import("../app/api/device-sync/agent/signals/route");
    webhookRoute = await import("../app/api/device-sync/webhooks/[provider]/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      exportTokenBundle: mocks.exportTokenBundle,
      handleWebhook: mocks.handleWebhook,
      listSignals: mocks.listSignals,
      refreshTokenBundle: mocks.refreshTokenBundle,
      requireAgentSession: mocks.requireAgentSession,
      resolveWebhookVerificationChallenge: mocks.resolveWebhookVerificationChallenge,
    });
    mocks.requireAgentSession.mockResolvedValue({
      id: "dsa_current",
      userId: "user-123",
    });
    mocks.listSignals.mockResolvedValue({
      nextCursor: 9,
      signals: [
        {
          id: 8,
          kind: "webhook_hint",
          payload: {
            eventType: "sleep.updated",
            traceId: "trace_123",
            occurredAt: "2026-03-26T11:59:00.000Z",
            resourceCategory: "daily_sleep",
          },
        },
      ],
    });
    mocks.resolveWebhookVerificationChallenge.mockReturnValue(null);
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

  it("passes the authenticated agent user and returns sparse webhook hints from signals", async () => {
    const response = await signalsRoute.GET(
      new Request("https://example.test/api/device-sync/agent/signals?after=7&limit=2", {
        headers: {
          authorization: "Bearer active-session-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.listSignals).toHaveBeenCalledTimes(1);
    expect(mocks.listSignals.mock.calls[0]?.[0]).toBe("user-123");
    expect(mocks.listSignals.mock.calls[0]?.[1]).toBeInstanceOf(URL);
    expect(mocks.listSignals.mock.calls[0]?.[1]?.searchParams.get("after")).toBe("7");
    expect(mocks.listSignals.mock.calls[0]?.[1]?.searchParams.get("limit")).toBe("2");
    await expect(response.json()).resolves.toEqual({
      nextCursor: 9,
      signals: [
        {
          id: 8,
          kind: "webhook_hint",
          payload: {
            eventType: "sleep.updated",
            traceId: "trace_123",
            occurredAt: "2026-03-26T11:59:00.000Z",
            resourceCategory: "daily_sleep",
          },
        },
      ],
    });
  });

  it("returns Oura webhook verification challenges as JSON", async () => {
    mocks.resolveWebhookVerificationChallenge.mockReturnValue("oura-challenge-token");

    const response = await webhookRoute.GET(
      new Request("https://example.test/api/device-sync/webhooks/oura?challenge=1"),
      {
        params: Promise.resolve({ provider: "oura" }),
      },
    );

    expect(mocks.resolveWebhookVerificationChallenge).toHaveBeenCalledWith("oura");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      challenge: "oura-challenge-token",
    });
  });
});
