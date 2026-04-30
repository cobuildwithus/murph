import {
  deviceSyncError,
} from "@murphai/device-syncd/public-ingress";
import { createOuraDeviceSyncProvider } from "@murphai/device-syncd/providers/oura";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createBearerRequest, createJsonPostRequest, createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  exportTokenBundle: vi.fn(),
  handleWebhook: vi.fn(),
  listSignals: vi.fn(),
  readWebhookRawBody: vi.fn(),
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
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      exportTokenBundle: mocks.exportTokenBundle,
      handleWebhook: mocks.handleWebhook,
      listSignals: mocks.listSignals,
      readWebhookRawBody: mocks.readWebhookRawBody,
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
          occurredAt: "2026-03-26T11:59:00.000Z",
          traceId: "trace_123",
          eventType: "sleep.updated",
          resourceCategory: "daily_sleep",
          reason: null,
          nextReconcileAt: null,
          revokeWarning: null,
        },
      ],
    });
    mocks.readWebhookRawBody.mockResolvedValue(Buffer.from('{"event":"sleep.updated"}', "utf8"));
    mocks.webhookRegistry.get.mockImplementation((provider: string) =>
      provider === "oura" || provider === "oura/legacy"
        ? createOuraDeviceSyncProvider({
            clientId: "oura-client-id",
            clientSecret: "oura-client-secret",
            webhookVerificationToken: "verify-token",
          })
        : undefined
    );
  });

  it("rejects export-token-bundle when the bearer token has expired", async () => {
    mocks.requireAgentSession.mockRejectedValue(
      deviceSyncError({
        code: "AGENT_AUTH_EXPIRED",
        message: "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
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
        message: "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
        retryable: false,
      },
    });
    expect(mocks.exportTokenBundle).not.toHaveBeenCalled();
  });

  it("rejects refresh-token-bundle when the bearer token has expired", async () => {
    mocks.requireAgentSession.mockRejectedValue(
      deviceSyncError({
        code: "AGENT_AUTH_EXPIRED",
        message: "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
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
        message: "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
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
          occurredAt: "2026-03-26T11:59:00.000Z",
          traceId: "trace_123",
          eventType: "sleep.updated",
          resourceCategory: "daily_sleep",
          reason: null,
          nextReconcileAt: null,
          revokeWarning: null,
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
      new Request("https://example.test/api/device-sync/webhooks/%6Fura", {
        method: "POST",
      }),
      createRouteContext({ provider: "%6Fura" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.readWebhookRawBody).toHaveBeenCalledTimes(1);
    expect(mocks.handleWebhook).toHaveBeenCalledWith(
      "oura",
      Buffer.from('{"event":"sleep.updated"}', "utf8"),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  it("returns accepted for verified orphan webhook deliveries without forcing provider retries", async () => {
    mocks.webhookRegistry.get.mockImplementation((provider: string) =>
      provider === "junction"
        ? createOuraDeviceSyncProvider({
            clientId: "oura-client-id",
            clientSecret: "oura-client-secret",
            webhookVerificationToken: "verify-token",
          })
        : undefined
    );
    mocks.handleWebhook.mockResolvedValue({
      accepted: true,
      duplicate: false,
      orphaned: true,
      provider: "junction",
      eventType: "provider.connection.created",
      traceId: "junction:trace",
    });

    const response = await webhookRoute.POST(
      new Request("https://example.test/api/device-sync/webhooks/junction", {
        method: "POST",
      }),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      orphaned: true,
      provider: "junction",
    });
  });

  it("short-circuits hosted webhook POSTs when provider preflight returns a response", async () => {
    const preflightProvider = createOuraDeviceSyncProvider({
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      webhookVerificationToken: "verify-token",
    });
    let observedUrl: string | null = null;
    preflightProvider.webhookAdmin!.handleWebhookPreflight = async ({ method, url }) => {
      if (method !== "POST") {
        return null;
      }

      observedUrl = url.toString();

      return {
        status: 200,
        body: {
          challenge: "demo-preflight-challenge",
        },
      };
    };

    mocks.webhookRegistry.get.mockImplementation((provider: string) =>
      provider === "oura"
        ? preflightProvider
        : provider === "oura" || provider === "oura/legacy"
          ? createOuraDeviceSyncProvider({
              clientId: "oura-client-id",
              clientSecret: "oura-client-secret",
              webhookVerificationToken: "verify-token",
            })
          : undefined
    );

    const response = await webhookRoute.POST(
      new Request("https://example.test/api/device-sync/webhooks/oura?via=preflight", {
        method: "POST",
      }),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(200);
    expect(observedUrl).toBe("https://example.test/api/device-sync/webhooks/oura?via=preflight");
    expect(mocks.readWebhookRawBody).toHaveBeenCalledTimes(1);
    expect(mocks.handleWebhook).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      challenge: "demo-preflight-challenge",
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
    mocks.webhookRegistry.get.mockImplementation((provider: string) =>
      provider === "oura"
        ? createOuraDeviceSyncProvider({
            clientId: "oura-client-id",
            clientSecret: "oura-client-secret",
          })
        : undefined
    );

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
