import {
  deviceSyncError,
} from "@murphai/device-syncd/public-ingress";
import { createOuraDeviceSyncProvider } from "@murphai/device-syncd/providers/oura";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createBearerRequest, createJsonPostRequest, createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  deviceSyncEnv: {
    ouraWebhookVerificationToken: "verify-token" as string | null,
  },
  exportTokenBundle: vi.fn(),
  handleWebhook: vi.fn(),
  listSignals: vi.fn(),
  refreshTokenBundle: vi.fn(),
  requireAgentSession: vi.fn(),
  webhookRegistry: {
    get: vi.fn(),
  },
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

describe("hosted device-sync agent and webhook routes", () => {
  beforeAll(async () => {
    exportRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route");
    refreshRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route");
    signalsRoute = await import("../app/api/device-sync/agent/signals/route");
    webhookRoute = await import("../app/api/device-sync/webhooks/[provider]/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deviceSyncEnv.ouraWebhookVerificationToken = "verify-token";
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      env: mocks.deviceSyncEnv,
      exportTokenBundle: mocks.exportTokenBundle,
      handleWebhook: mocks.handleWebhook,
      listSignals: mocks.listSignals,
      registry: mocks.webhookRegistry,
      refreshTokenBundle: mocks.refreshTokenBundle,
      requireAgentSession: mocks.requireAgentSession,
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
    mocks.webhookRegistry.get.mockImplementation((provider: string) =>
      provider === "oura"
        ? createOuraDeviceSyncProvider({
            clientId: "oura-client-id",
            clientSecret: "oura-client-secret",
          })
        : undefined
    );
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
      createBearerRequest(
        "https://example.test/api/device-sync/agent/connections/dsc_123/export-token-bundle",
        "expired-session-token",
        { method: "POST" },
      ),
      createRouteContext({ connectionId: "dsc_123" }),
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
      createJsonPostRequest(
        "https://example.test/api/device-sync/agent/connections/dsc_123/refresh-token-bundle",
        {
          expectedTokenVersion: 7,
          force: true,
        },
        {
          headers: {
            authorization: "Bearer expired-session-token",
          },
        },
      ),
      createRouteContext({ connectionId: "dsc_123" }),
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
      createBearerRequest("https://example.test/api/device-sync/agent/signals?after=7&limit=2", "active-session-token"),
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
    const response = await webhookRoute.GET(
      new Request(
        "https://example.test/api/device-sync/webhooks/oura?verification_token=verify-token&challenge=oura-challenge-token",
      ),
      createRouteContext({ provider: "oura" }),
    );

    expect(mocks.webhookRegistry.get).toHaveBeenCalledWith("oura");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      challenge: "oura-challenge-token",
    });
  });

  it("decodes encoded webhook provider params before calling the control plane", async () => {
    mocks.handleWebhook.mockResolvedValue({
      ok: true,
    });

    const response = await webhookRoute.POST(
      new Request("https://example.test/api/device-sync/webhooks/oura%2Flegacy", {
        method: "POST",
      }),
      createRouteContext({ provider: "oura%2Flegacy" }),
    );

    expect(response.status).toBe(202);
    expect(mocks.handleWebhook).toHaveBeenCalledWith("oura/legacy");
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  it("keeps hosted webhook verification token mismatch behavior aligned with the shared Oura helper", async () => {
    const response = await webhookRoute.GET(
      new Request(
        "https://example.test/api/device-sync/webhooks/oura?verification_token=wrong-token&challenge=oura-challenge-token",
      ),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "OURA_WEBHOOK_VERIFICATION_FAILED",
        message: "Oura webhook verification token did not match the configured verification token.",
        retryable: false,
      },
    });
  });

  it("keeps hosted webhook verification missing-token behavior aligned with the shared Oura helper", async () => {
    mocks.deviceSyncEnv.ouraWebhookVerificationToken = null;

    const response = await webhookRoute.GET(
      new Request(
        "https://example.test/api/device-sync/webhooks/oura?verification_token=verify-token&challenge=oura-challenge-token",
      ),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "OURA_WEBHOOK_VERIFICATION_TOKEN_MISSING",
        message: "Oura webhook verification requires OURA_WEBHOOK_VERIFICATION_TOKEN.",
        retryable: false,
      },
    });
  });
});
