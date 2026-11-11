import {
  deviceSyncError,
} from "@murphai/device-syncd/errors";
import { Prisma } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonPostRequest, createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncAgentSessionContext: vi.fn(),
  assertBrowserMutationOrigin: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  enqueueHostedDeviceWebhook: vi.fn(),
  handleWebhook: vi.fn(),
  pairAgent: vi.fn(),
  prepareWebhookForDurableEnqueue: vi.fn(),
  prepareHostedDeviceWebhookQueueTransport: vi.fn(),
  readWebhookRawBody: vi.fn(),
  resolveWebhookPreflight: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: mocks.createHostedDeviceSyncPublicIngressService,
}));
vi.mock("@/src/lib/device-sync/webhook-queue", () => ({
  enqueueHostedDeviceWebhook: mocks.enqueueHostedDeviceWebhook,
  prepareHostedDeviceWebhookQueueTransport:
    mocks.prepareHostedDeviceWebhookQueueTransport,
}));
vi.mock("@/src/lib/device-sync/agent-session-service", () => ({
  createHostedDeviceSyncAgentSessionContext: mocks.createHostedDeviceSyncAgentSessionContext,
}));
vi.mock("@/src/lib/device-sync/auth", () => ({
  assertBrowserMutationOrigin: mocks.assertBrowserMutationOrigin,
  requireAuthenticatedHostedUser: mocks.requireAuthenticatedUser,
}));

type PairRouteModule = typeof import("../app/api/device-sync/agents/pair/route");
type WebhookRouteModule = typeof import("../app/api/device-sync/webhooks/[provider]/route");

let pairRoute: PairRouteModule;
let webhookRoute: WebhookRouteModule;

describe("hosted device-sync agent and webhook routes", () => {
  beforeAll(async () => {
    pairRoute = await import("../app/api/device-sync/agents/pair/route");
    webhookRoute = await import("../app/api/device-sync/webhooks/[provider]/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
      handleWebhook: mocks.handleWebhook,
      prepareWebhookForDurableEnqueue: mocks.prepareWebhookForDurableEnqueue,
      readWebhookRawBody: mocks.readWebhookRawBody,
      resolveWebhookPreflight: mocks.resolveWebhookPreflight,
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
    mocks.readWebhookRawBody.mockResolvedValue(Buffer.from('{"event":"sleep.updated"}', "utf8"));
    mocks.resolveWebhookPreflight.mockResolvedValue(null);
    mocks.prepareHostedDeviceWebhookQueueTransport.mockReturnValue({
      enabled: false,
      reason: "provider_not_enabled",
    });
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

  it("durably enqueues a verified provider-gated webhook without synchronous admission", async () => {
    const rawBody = Buffer.from('{"event":"sleep.updated"}', "utf8");
    const preparedWebhook = createPreparedWebhook();
    mocks.prepareHostedDeviceWebhookQueueTransport.mockReturnValueOnce({
      enabled: true,
    });
    mocks.prepareWebhookForDurableEnqueue.mockResolvedValueOnce(preparedWebhook);
    mocks.enqueueHostedDeviceWebhook.mockResolvedValueOnce({
      accepted: true,
      transportId: "00000000-0000-4000-8000-000000000001",
    });

    const response = await webhookRoute.POST(
      new Request("https://example.test/api/device-sync/webhooks/oura", {
        headers: { "x-oura-signature": "opaque-signature" },
        method: "POST",
      }),
      createRouteContext({ provider: "oura" }),
    );

    expect(mocks.prepareWebhookForDurableEnqueue).toHaveBeenCalledWith(
      "oura",
      rawBody,
      expect.any(Date),
    );
    expect(mocks.enqueueHostedDeviceWebhook).toHaveBeenCalledWith({
      preparedWebhook,
    });
    expect(mocks.handleWebhook).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      queued: true,
    });
  });

  it("does not fall back to synchronous admission after an enqueue failure", async () => {
    mocks.prepareHostedDeviceWebhookQueueTransport.mockReturnValueOnce({
      enabled: true,
    });
    mocks.prepareWebhookForDurableEnqueue.mockResolvedValueOnce(
      createPreparedWebhook(),
    );
    mocks.enqueueHostedDeviceWebhook.mockRejectedValueOnce(deviceSyncError({
      code: "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED",
      httpStatus: 503,
      message: "Durable transport did not confirm acceptance.",
      retryable: true,
    }));

    const response = await webhookRoute.POST(
      new Request("https://example.test/api/device-sync/webhooks/oura", {
        method: "POST",
      }),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(503);
    expect(mocks.handleWebhook).not.toHaveBeenCalled();
  });

  it.each(["body_too_large", "provider_not_enabled", "queue_enabled"])(
    "records a content-free %s transport decision alongside retryable failures",
    async (reason) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const privateBody = Buffer.from("synthetic-private-payload-and-account");
      mocks.readWebhookRawBody.mockResolvedValueOnce(privateBody);
      mocks.prepareHostedDeviceWebhookQueueTransport.mockReturnValueOnce({
        enabled: reason === "queue_enabled", reason,
      });
      const error = deviceSyncError({ code: "HOSTED_DEVICE_SYNC_PREPARATION_STALE",
        httpStatus: 503, retryable: true, message: "Retry the request.",
        details: { payload: privateBody.toString() } });
      if (reason === "queue_enabled") {
        mocks.prepareWebhookForDurableEnqueue.mockRejectedValueOnce(error);
      } else {
        mocks.handleWebhook.mockRejectedValueOnce(error);
      }
      const response = await webhookRoute.POST(new Request("https://example.test/api/device-sync/webhooks/junction", {
        method: "POST", headers: { authorization: "synthetic-private-header" },
      }), createRouteContext({ provider: "junction" }));
      expect(response.status).toBe(503);
      expect(info).toHaveBeenCalledWith("Hosted device webhook transport selected.", {
        eventCode: "device_webhook.transport_selected", reason,
        transport: reason === "queue_enabled" ? "queue" : "synchronous",
        rawBodyBytes: privateBody.byteLength,
      });
      const emitted = JSON.stringify([info.mock.calls, warn.mock.calls]);
      expect(emitted).not.toContain(privateBody.toString());
      expect(emitted).not.toContain("synthetic-private-header");
      info.mockRestore();
      warn.mockRestore();
    },
  );

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

function createPreparedWebhook() {
  return {
    acceptanceMode: "level_dirty_hint" as const,
    eventType: "sleep.updated",
    externalAccountId: "opaque-account",
    jobs: [],
    provider: "oura",
    receivedAt: "2026-04-10T12:00:00.000Z",
    schema: "murph.device-sync-prepared-webhook.v1" as const,
    traceId: "a".repeat(64),
  };
}
