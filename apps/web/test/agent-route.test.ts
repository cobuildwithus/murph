import {
  deviceSyncError,
} from "@murphai/device-syncd/errors";
import { Prisma } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createBearerRequest, createJsonPostRequest, createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncAgentSessionContext: vi.fn(),
  createHostedDeviceSyncAgentSessionService: vi.fn(),
  createHostedDeviceSyncProviderAuthorityAgentSessionService: vi.fn(),
  assertBrowserMutationOrigin: vi.fn(),
  createHostedDeviceSyncProviderAgentSessionService: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  exportTokenBundle: vi.fn(),
  handleWebhook: vi.fn(),
  pairAgent: vi.fn(),
  readWebhookRawBody: vi.fn(),
  refreshTokenBundle: vi.fn(),
  resolveWebhookPreflight: vi.fn(),
  requireAgentSession: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
  requireRegistry: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));
vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: mocks.createHostedDeviceSyncPublicIngressService,
}));
vi.mock("@/src/lib/device-sync/agent-session-service", () => ({
  createHostedDeviceSyncAgentSessionContext: mocks.createHostedDeviceSyncAgentSessionContext,
  createHostedDeviceSyncAgentSessionService: mocks.createHostedDeviceSyncAgentSessionService,
}));
vi.mock("@/src/lib/device-sync/agent-session-provider-service", () => ({
  createHostedDeviceSyncProviderAgentSessionService: mocks.createHostedDeviceSyncProviderAgentSessionService,
}));
vi.mock("@/src/lib/device-sync/agent-session-provider-authority-service", () => ({
  createHostedDeviceSyncProviderAuthorityAgentSessionService:
    mocks.createHostedDeviceSyncProviderAuthorityAgentSessionService,
}));
vi.mock("@/src/lib/device-sync/auth", () => ({
  assertBrowserMutationOrigin: mocks.assertBrowserMutationOrigin,
  requireAuthenticatedHostedUser: mocks.requireAuthenticatedUser,
}));

type ExportRouteModule = typeof import("../app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route");
type PairRouteModule = typeof import("../app/api/device-sync/agents/pair/route");
type RefreshRouteModule = typeof import("../app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route");
type WebhookRouteModule = typeof import("../app/api/device-sync/webhooks/[provider]/route");

let exportRoute: ExportRouteModule;
let pairRoute: PairRouteModule;
let refreshRoute: RefreshRouteModule;
let webhookRoute: WebhookRouteModule;

describe("hosted device-sync agent and webhook routes", () => {
  beforeAll(async () => {
    exportRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route");
    pairRoute = await import("../app/api/device-sync/agents/pair/route");
    refreshRoute = await import("../app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route");
    webhookRoute = await import("../app/api/device-sync/webhooks/[provider]/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      assertBrowserMutationOrigin: mocks.assertBrowserMutationOrigin,
      pairAgent: mocks.pairAgent,
      requireAuthenticatedUser: mocks.requireAuthenticatedUser,
      requireRegistry: mocks.requireRegistry,
    });
    mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
      handleWebhook: mocks.handleWebhook,
      readWebhookRawBody: mocks.readWebhookRawBody,
      resolveWebhookPreflight: mocks.resolveWebhookPreflight,
    });
    mocks.createHostedDeviceSyncAgentSessionService.mockReturnValue({
      exportTokenBundle: mocks.exportTokenBundle,
      refreshTokenBundle: mocks.refreshTokenBundle,
      requireAgentSession: mocks.requireAgentSession,
    });
    mocks.createHostedDeviceSyncProviderAgentSessionService.mockReturnValue({
      exportTokenBundle: mocks.exportTokenBundle,
      refreshTokenBundle: mocks.refreshTokenBundle,
      requireAgentSession: mocks.requireAgentSession,
    });
    mocks.createHostedDeviceSyncProviderAuthorityAgentSessionService.mockReturnValue({
      exportTokenBundle: mocks.exportTokenBundle,
      refreshTokenBundle: mocks.refreshTokenBundle,
      requireAgentSession: mocks.requireAgentSession,
    });
    mocks.createHostedDeviceSyncAgentSessionContext.mockReturnValue({
      agentSessions: {
        createAgentSession: mocks.pairAgent,
      },
      env: {},
      store: {},
    });
    mocks.requireAuthenticatedUser.mockResolvedValue({
      email: "person@example.test",
      id: "user-123",
      name: "Person",
      source: "trusted-header",
    });
    mocks.requireAgentSession.mockResolvedValue({
      id: "dsa_current",
      userId: "user-123",
    });
    mocks.readWebhookRawBody.mockResolvedValue(Buffer.from('{"event":"sleep.updated"}', "utf8"));
    mocks.resolveWebhookPreflight.mockResolvedValue(null);
    mocks.pairAgent.mockResolvedValue({
      agent: {
        createdAt: "2026-03-26T12:00:00.000Z",
        expiresAt: "2026-04-25T12:00:00.000Z",
        id: "dsa_pair_123",
        label: "local laptop",
      },
      token: "device-sync-agent-token",
    });
  });

  it("authenticates browser pair requests before parsing the body", async () => {
    mocks.requireAuthenticatedUser.mockRejectedValueOnce(deviceSyncError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Hosted device-sync browser routes require authentication.",
      retryable: false,
    }));

    const response = await pairRoute.POST(
      new Request("https://example.test/api/device-sync/agents/pair", {
        body: "{",
        headers: {
          origin: "https://example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.assertBrowserMutationOrigin).toHaveBeenCalledTimes(1);
    expect(mocks.requireAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(mocks.pairAgent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "AUTH_REQUIRED",
      },
    });
  });

  it("bounds authenticated browser pair request bodies before creating a session", async () => {
    const response = await pairRoute.POST(
      new Request("https://example.test/api/device-sync/agents/pair", {
        body: JSON.stringify({
          label: "x".repeat(2_000),
        }),
        headers: {
          origin: "https://example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.requireAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(mocks.pairAgent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AGENT_PAIR_BODY_TOO_LARGE",
        message: "Hosted device-sync agent pair request body is too large.",
        retryable: false,
      },
    });
  });

  it("passes the authenticated browser user when pairing an agent", async () => {
    const response = await pairRoute.POST(
      createJsonPostRequest("https://example.test/api/device-sync/agents/pair", {
        label: "local laptop",
      }, {
        headers: {
          origin: "https://example.test",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.pairAgent).toHaveBeenCalledWith({
      email: "person@example.test",
      id: "user-123",
      name: "Person",
      source: "trusted-header",
    }, "local laptop");
    await expect(response.json()).resolves.toEqual({
      agent: {
        createdAt: "2026-03-26T12:00:00.000Z",
        expiresAt: "2026-04-25T12:00:00.000Z",
        id: "dsa_pair_123",
        label: "local laptop",
      },
      token: "device-sync-agent-token",
    });
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

  it("exports token bundles through the provider-application authority adapter", async () => {
    mocks.exportTokenBundle.mockResolvedValueOnce({
      connection: {
        id: "dsc_123",
        provider: "oura",
      },
      tokenBundle: {
        accessToken: "bundle-token-test",
        refreshToken: null,
        tokenVersion: 7,
      },
    });

    const response = await exportRoute.POST(
      createBearerRequest(
        "https://example.test/api/device-sync/agent/connections/dsc_123/export-token-bundle",
        "valid-session-token",
        { method: "POST" },
      ),
      createRouteContext({ connectionId: "dsc_123" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createHostedDeviceSyncProviderAuthorityAgentSessionService).toHaveBeenCalledTimes(1);
    expect(mocks.createHostedDeviceSyncAgentSessionService).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncProviderAgentSessionService).not.toHaveBeenCalled();
    expect(mocks.exportTokenBundle).toHaveBeenCalledWith({
      id: "dsa_current",
      userId: "user-123",
    }, "dsc_123");
    await expect(response.json()).resolves.toEqual({
      connection: {
        id: "dsc_123",
        provider: "oura",
      },
      tokenBundle: {
        accessToken: "bundle-token-test",
        refreshToken: null,
        tokenVersion: 7,
      },
    });
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

  it("returns Oura webhook verification challenges as JSON", async () => {
    mocks.resolveWebhookPreflight.mockResolvedValueOnce({
      status: 200,
      body: {
        challenge: "oura-challenge-token",
      },
    });

    const response = await webhookRoute.GET(
      new Request(
        "https://example.test/api/device-sync/webhooks/oura?verification_token=verify-token&challenge=oura-challenge-token",
      ),
      createRouteContext({ provider: "oura" }),
    );

    expect(mocks.resolveWebhookPreflight).toHaveBeenCalledWith("oura", Buffer.alloc(0));
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

  it("returns 202 for hosted Junction orphan webhook deliveries instead of 503", async () => {
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
    expect(mocks.readWebhookRawBody).toHaveBeenCalledTimes(1);
    expect(mocks.handleWebhook).toHaveBeenCalledWith(
      "junction",
      Buffer.from('{"event":"sleep.updated"}', "utf8"),
    );
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      orphaned: true,
      provider: "junction",
    });
  });

  it("returns a retryable 503 when webhook admission loses its bounded member-row lock wait", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The production adapter-pg shape raised when the webhook admission
    // transaction's bounded lock_timeout gives up waiting on the member row.
    mocks.handleWebhook.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        "Raw query failed. Code: `55P03`.",
        {
          clientVersion: "7.8.0",
          code: "P2010",
          meta: {
            driverAdapterError: {
              cause: {
                kind: "postgres",
                message: "canceling statement due to lock timeout",
                originalCode: "55P03",
                severity: "ERROR",
              },
              name: "DriverAdapterError",
            },
          },
        },
      ),
    );

    const response = await webhookRoute.POST(
      new Request("https://example.test/api/device-sync/webhooks/junction", {
        method: "POST",
      }),
      createRouteContext({ provider: "junction" }),
    );

    // A 500 would break the provider redelivery contract; the claimed webhook
    // trace is released by the ingress on failure so the retry reprocesses.
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "STORE_CONTENTION",
        message: "The device-sync store timed out under contention. Retry later.",
        retryable: true,
      },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("short-circuits hosted webhook POSTs when provider preflight returns a response", async () => {
    mocks.resolveWebhookPreflight.mockResolvedValueOnce({
      status: 200,
      body: {
        challenge: "demo-preflight-challenge",
      },
    });

    const response = await webhookRoute.POST(
      new Request("https://example.test/api/device-sync/webhooks/oura?via=preflight", {
        method: "POST",
      }),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.readWebhookRawBody).toHaveBeenCalledTimes(1);
    expect(mocks.resolveWebhookPreflight).toHaveBeenCalledWith(
      "oura",
      Buffer.from('{"event":"sleep.updated"}', "utf8"),
    );
    expect(mocks.handleWebhook).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      challenge: "demo-preflight-challenge",
    });
  });

  it("surfaces hosted webhook verification token mismatch errors", async () => {
    mocks.resolveWebhookPreflight.mockRejectedValueOnce(deviceSyncError({
      code: "OURA_WEBHOOK_VERIFICATION_FAILED",
      message: "Oura webhook verification token did not match the configured verification token.",
      retryable: false,
      httpStatus: 403,
    }));

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

  it("surfaces hosted webhook verification missing-token errors", async () => {
    mocks.resolveWebhookPreflight.mockRejectedValueOnce(deviceSyncError({
      code: "OURA_WEBHOOK_VERIFICATION_TOKEN_MISSING",
      message: "Oura webhook verification requires OURA_WEBHOOK_VERIFICATION_TOKEN.",
      retryable: false,
      httpStatus: 500,
    }));

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
