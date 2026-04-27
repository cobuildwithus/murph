import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );

  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import { buildHostedExecutionRuntimePlatform } from "../src/runtime-platform.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

function requireFetchCallArgs(
  call: readonly unknown[] | undefined,
  label: string,
): { init?: RequestInit; input: RequestInfo | URL } {
  if (!call) {
    throw new Error(`${label} was not called.`);
  }

  const [input, init] = call;
  if (!(input instanceof Request) && !(input instanceof URL) && typeof input !== "string") {
    throw new Error(`${label} must receive a Request, URL, or string input.`);
  }
  if (init !== undefined && (typeof init !== "object" || init === null || Array.isArray(init))) {
    throw new Error(`${label} init must be an object when provided.`);
  }

  return {
    init: init as RequestInit | undefined,
    input,
  };
}

function requireFetchRequest(call: readonly unknown[] | undefined, label: string): Request {
  const { init, input } = requireFetchCallArgs(call, label);
  return input instanceof Request ? input : new Request(input, init);
}

describe("buildHostedExecutionRuntimePlatform", () => {
  beforeEach(() => {
    mocks.emitHostedExecutionStructuredLog.mockReset();
  });

  it("logs upstream request failures with safe request metadata", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow("Hosted raw email read raw_123 request failed.");

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          description: "Hosted raw email read raw_123",
          method: "GET",
          path: "/messages/raw_123",
          responseOrigin: "http://results.worker",
        },
        level: "warn",
        message: "Hosted runtime upstream request failed.",
        phase: "side-effects.draining",
        userId: null,
      }),
    );
  });

  it("logs non-OK control-plane responses with response metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 503,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    })).rejects.toThrow(/Hosted device-sync runtime snapshot failed with HTTP 503/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          description: "Hosted device-sync runtime snapshot",
          method: "POST",
          path: "/api/internal/device-sync/runtime/snapshot",
          responseOrigin: "https://web.example.test",
          responseStatus: 503,
          transport: "direct",
          userId: "member_123",
        },
        level: "warn",
        message: "Hosted runtime control-plane response returned non-OK.",
        phase: "side-effects.draining",
        userId: "member_123",
      }),
    );
  });

  it("logs non-OK internal upstream responses with response metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("artifact missing", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 500,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow("Hosted raw email read raw_123 failed with HTTP 500.");

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          description: "Hosted raw email read raw_123",
          responseStatus: 500,
        },
        level: "warn",
        message: "Hosted runtime upstream response returned non-OK.",
        phase: "side-effects.draining",
        userId: null,
      }),
    );
  });

  it("routes raw email reads through the Cloudflare internal effects port and attaches the per-run proxy token", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    await platform.effectsPort.readRawEmailMessage("raw/message#1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "effects port fetch");
    expect(request.url).toBe("http://results.worker/messages/raw%2Fmessage%231");
    expect(request.headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
    expect(request.method).toBe("GET");
  });

  it("routes hosted turn-input refreshes through the Cloudflare internal effects port", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      events: [
        {
          ingressEventId: "wake_11",
          seq: "11",
          wake: {
            eventId: "evt_timer",
            kind: "runtime.timer",
            occurredAt: "2026-04-23T00:00:00.000Z",
            triggerKind: "runtime_timer",
            userId: "member_123",
          },
        },
      ],
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      hostedRunId: "run_123",
      hostedRunToken: "run-token",
      internalWorkerProxyToken: "runner-proxy-token",
    });

    const result = await platform.turnInputPort!.refresh({
      afterSeq: "10",
      phase: "before_delivery",
      requestId: "req_123",
    });

    expect(result.events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "turn-input fetch");
    expect(request.url).toBe("http://results.worker/turn-input/refresh");
    expect(request.headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
    expect(request.method).toBe("POST");
    await expect(request.json()).resolves.toEqual({
      afterSeq: "10",
      phase: "before_delivery",
      requestId: "req_123",
      runId: "run_123",
      runToken: "run-token",
    });
  });

  it("fails closed before issuing internal-host requests when the per-run proxy token is missing", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow(
      "Hosted raw email read raw_123 request failed.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes local hosted internal message reads through the worker loopback bridge when configured", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
      localInternalProxyBaseUrl: "http://127.0.0.1:8787",
    });

    await platform.effectsPort.readRawEmailMessage("raw/message#1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "bridged effects port fetch");
    expect(request.url).toBe(
      "http://127.0.0.1:8787/__murph/local-internal-proxy/users/member_123/results.worker/messages/raw%2Fmessage%231",
    );
    expect(request.headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
    expect(request.method).toBe("GET");
  });

  it("does not require a second local bridge token when loopback proxying is enabled", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
      localInternalProxyBaseUrl: "http://127.0.0.1:8787",
    });

    await platform.effectsPort.readRawEmailMessage("raw/message#1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "bridged effects port fetch");
    expect(request.url).toBe(
      "http://127.0.0.1:8787/__murph/local-internal-proxy/users/member_123/results.worker/messages/raw%2Fmessage%231",
    );
  });

  it("does not fall back to ambient local proxy base env when the scoped option is missing", async () => {
    const previousLocalProxyBaseUrl = process.env.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL;
    process.env.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL = "http://127.0.0.1:8787";
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

    try {
      const platform = buildHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
        internalWorkerProxyToken: "runner-proxy-token",
      });

      await platform.effectsPort.readRawEmailMessage("raw/message#1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = requireFetchRequest(fetchMock.mock.calls[0], "direct effects port fetch");
      expect(request.url).toBe("http://results.worker/messages/raw%2Fmessage%231");
      expect(request.headers.get("x-hosted-execution-runner-proxy-token")).toBe(
        "runner-proxy-token",
      );
    } finally {
      if (previousLocalProxyBaseUrl === undefined) {
        delete process.env.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL;
      } else {
        process.env.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL = previousLocalProxyBaseUrl;
      }
    }
  });

  it("rejects a pre-scoped local bridge base for a different member", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
      localInternalProxyBaseUrl:
        "http://127.0.0.1:8787/__murph/local-internal-proxy/users/member_other/",
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw/message#1"),
    ).rejects.toThrow(
      "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL is scoped to a different user.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds device-sync runtime requests to the hosted member id at the signed web callback seam", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body: unknown = await request.json();

      expect(body).toEqual({
        connectionId: "conn_123",
        userId: "member_123",
      });

      return new Response(JSON.stringify({
        connections: [],
        generatedAt: "2026-04-07T00:00:00.000Z",
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const snapshot = await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(snapshot.userId).toBe("member_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { init, input: url } = requireFetchCallArgs(fetchMock.mock.calls[0], "device-sync fetch");
    expect(String(url)).toBe("https://web.example.test/api/internal/device-sync/runtime/snapshot");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
    expect(headers.get("x-hosted-execution-nonce")).toMatch(/^[a-f0-9]{32}$/u);
    expect(headers.get("x-hosted-execution-timestamp")).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("forces hosted device-sync connect-link creation through the signed POST callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      authorizationUrl: "https://sync.example.test/oauth",
      expiresAt: "2026-04-07T00:00:00.000Z",
      provider: "oura",
      providerLabel: "Oura",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const connectLink = await platform.deviceSyncPort!.createConnectLink({
      provider: "oura",
    });

    expect(connectLink.provider).toBe("oura");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { init, input: url } = requireFetchCallArgs(
      fetchMock.mock.calls[0],
      "device-sync connect-link fetch",
    );
    expect(String(url)).toBe("https://web.example.test/api/internal/device-sync/providers/oura/connect-link");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("passes messaging return targets through the signed hosted device-sync connect-link route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      authorizationUrl: "https://sync.example.test/oauth",
      expiresAt: "2026-04-07T00:00:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await platform.deviceSyncPort!.createConnectLink({
      messagingReturnTarget: "telegram",
      provider: "whoop",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { init, input: url } = requireFetchCallArgs(
      fetchMock.mock.calls[0],
      "device-sync connect-link fetch",
    );
    expect(String(url)).toBe("https://web.example.test/api/internal/device-sync/providers/whoop/connect-link");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      messagingReturnTarget: "telegram",
    }));
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("resolves delegated billing Stripe customers through the signed hosted web callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      stripeCustomerId: "cus_123",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const billing = await platform.billingPort!.resolveVercelAiGatewayStripeCustomerId();

    expect(billing).toEqual({
      stripeCustomerId: "cus_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { init, input: url } = requireFetchCallArgs(
      fetchMock.mock.calls[0],
      "delegated billing fetch",
    );
    expect(String(url)).toBe(
      "https://web.example.test/api/internal/hosted-execution/billing/stripe/customer/resolve",
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
  });

  it("rejects malformed delegated billing JSON from the signed hosted web callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      stripeCustomerId: 123,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(platform.billingPort!.resolveVercelAiGatewayStripeCustomerId()).rejects.toThrow(
      "Hosted delegated billing Stripe customer lookup returned invalid JSON.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects direct hosted web control base URLs with non-root paths", async () => {
    const fetchMock = vi.fn();
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test/app",
    });

    await expect(platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    })).rejects.toThrow(/must not include a path/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes hosted web control-plane calls through the worker proxy when callback signing stays outside the child", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      connections: [],
      generatedAt: "2026-04-07T00:00:00.000Z",
      userId: "member_123",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    const snapshot = await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(snapshot.userId).toBe("member_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "proxied web-control fetch");
    expect(request.url).toBe("http://web-control.worker/api/internal/device-sync/runtime/snapshot");
    expect(request.method).toBe("POST");
    expect(request.headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
    expect(request.headers.get("content-type")).toBe("application/json");
    await expect(request.json()).resolves.toEqual({
      connectionId: "conn_123",
      userId: "member_123",
    });
  });

  it("routes delegated billing Stripe customer lookup through the worker proxy when callback signing stays outside the child", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      stripeCustomerId: "cus_123",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    const billing = await platform.billingPort!.resolveVercelAiGatewayStripeCustomerId();

    expect(billing).toEqual({
      stripeCustomerId: "cus_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "proxied delegated billing fetch");
    expect(request.url).toBe(
      "http://web-control.worker/api/internal/hosted-execution/billing/stripe/customer/resolve",
    );
    expect(request.method).toBe("POST");
    expect(request.headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
    expect(request.headers.get("content-type")).toBeNull();
  });

  it("routes hosted mailbox fetches through the worker proxy without run adoption fields", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [
        {
          createdAt: "2026-04-26T00:00:01.000Z",
          dedupeKey: "conversation:test:1",
          id: "mailbox_1",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "1",
          occurredAt: "2026-04-26T00:00:00.000Z",
          payloadBytes: 64,
          payloadRef: "payload_1",
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: "2026-04-26T00:00:01.000Z",
          userId: "member_123",
        },
      ],
      maxSeqByLane: [
        {
          lane: "conversation",
          maxSeq: "1",
        },
      ],
      userId: "member_123",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_1",
    });

    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "mailbox fetch");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-mailbox/fetch");
    expect(request.method).toBe("POST");
    expect(request.headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
    await expect(request.json()).resolves.toEqual({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_1",
    });
  });

  it("threads checkpoint fencing fields through the workspace callback body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      checkpointed: true,
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {
          importedConversationSeq: "1",
        },
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    const result = await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {
        importedConversationSeq: "1",
      },
      snapshotRef: null,
    });

    expect(result.workspace.version).toBe("5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "workspace checkpoint");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-workspace/checkpoint");
    expect(request.method).toBe("POST");
    await expect(request.json()).resolves.toEqual({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {
        importedConversationSeq: "1",
      },
      snapshotRef: null,
    });
  });

  it("reads workspace state through the web callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {
          importedConversationSeq: "1",
        },
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    const readWorkspace = platform.workspacePort!.read;
    if (typeof readWorkspace !== "function") {
      throw new Error("Expected hosted workspace read port.");
    }

    const result = await readWorkspace();

    expect(result.workspace?.version).toBe("5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "workspace read");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-workspace");
    expect(request.method).toBe("GET");
  });

  it("writes only structured runtime logs through the web callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      loggedCount: 1,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    const result = await platform.logPort!.write({
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          attemptId: "attempt_1",
          component: "mailbox",
          eventCode: "mailbox.imported",
          leaseGeneration: "9",
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: "1",
          mailboxSeqStart: "1",
          phase: "import",
          redactedJson: {
            importedCount: 1,
          },
          workspaceVersion: "4",
        },
      ],
    });

    expect(result.loggedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "runtime log");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-runtime/log");
    expect(request.method).toBe("POST");
    await expect(request.json()).resolves.toEqual({
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          attemptId: "attempt_1",
          component: "mailbox",
          eventCode: "mailbox.imported",
          leaseGeneration: "9",
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: "1",
          mailboxSeqStart: "1",
          phase: "import",
          redactedJson: {
            importedCount: 1,
          },
          workspaceVersion: "4",
        },
      ],
    });
  });

  it("signs hosted share payload callbacks for the runtime-supplied owner user", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      payload: null,
      unavailable: {
        code: "not_found",
        retryable: false,
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const result = await platform.sharePort!.fetchPayload({
      ownerUserId: "member_sender",
      requestId: "request_share_1",
      shareId: "share_123",
    });

    expect(result.payload).toBeNull();
    expect(result.unavailable).toEqual({
      code: "not_found",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { init, input: url } = requireFetchCallArgs(fetchMock.mock.calls[0], "share payload fetch");
    expect(String(url)).toBe(
      "https://web.example.test/api/internal/hosted-execution/share/share_123/payload?requestId=request_share_1",
    );
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_sender");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("omits hosted side-input request query strings from structured failure logs", async () => {
    const fetchMock = vi.fn(async () => new Response("unavailable", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 503,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(platform.sharePort!.fetchPayload({
      ownerUserId: "member_sender",
      requestId: "request_share_1",
      shareId: "share_123",
    })).rejects.toThrow(/Hosted share payload fetch failed with HTTP 503/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          path: "/api/internal/hosted-execution/share/:shareId/payload",
        }),
        message: "Hosted runtime control-plane response returned non-OK.",
      }),
    );
  });

  it("carries hosted share owner signing through the worker proxy header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      payload: null,
      unavailable: {
        code: "not_found",
        retryable: false,
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    const result = await platform.sharePort!.fetchPayload({
      ownerUserId: "member_sender",
      requestId: "request_share_1",
      shareId: "share_123",
    });

    expect(result.payload).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "proxied share payload fetch");
    expect(request.url).toBe(
      "http://web-control.worker/api/internal/hosted-execution/share/share_123/payload?requestId=request_share_1",
    );
    expect(request.method).toBe("GET");
    expect(request.headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
    expect(request.headers.get("x-hosted-runtime-web-control-user-id")).toBe("member_sender");
  });

  it("omits hosted side-input identifiers from proxied request failure logs", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    await expect(platform.sharePort!.fetchPayload({
      ownerUserId: "member_sender",
      requestId: "request_share_1",
      shareId: "share_123",
    })).rejects.toThrow(/Hosted share payload fetch request failed/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          path: "/api/internal/hosted-execution/share/:shareId/payload",
        }),
        message: "Hosted runtime upstream request failed.",
      }),
    );
  });

  it("routes hosted vault-sync payload fetch and import callbacks through the worker proxy", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === "GET") {
        return new Response(JSON.stringify({
          fetchedAt: "2026-04-26T00:00:06.000Z",
          payload: {
            bundleBase64: "dmF1bHQ=",
            payloadSchema: "murph.hosted-vault-sync-payload.v1",
            sessionId: "vault_sync_123",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      return new Response(JSON.stringify({
        recorded: true,
        sessionId: "vault_sync_123",
        status: "imported",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    const fetchResult = await platform.vaultSyncPort!.fetchPayload({
      requestId: "request_vault_sync_1",
      sessionId: "vault_sync_123",
    });
    const importResult = await platform.vaultSyncPort!.recordImport({
      importedAt: "2026-04-26T00:00:07.000Z",
      sessionId: "vault_sync_123",
      status: "imported",
      summary: {
        conflictCount: 0,
        importedJsonlRecords: 1,
        importedRawFiles: 0,
        importedTextFiles: 1,
        skippedDuplicates: 0,
        skippedExcludedFiles: 0,
      },
    });

    expect(fetchResult.payload?.sessionId).toBe("vault_sync_123");
    expect(importResult.recorded).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fetchRequest = requireFetchRequest(fetchMock.mock.calls[0], "vault-sync payload fetch");
    expect(fetchRequest.url).toBe(
      "http://web-control.worker/api/internal/hosted-execution/vault-sync/vault_sync_123/payload?requestId=request_vault_sync_1",
    );
    expect(fetchRequest.method).toBe("GET");
    expect(fetchRequest.headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );

    const importRequest = requireFetchRequest(fetchMock.mock.calls[1], "vault-sync import record");
    expect(importRequest.url).toBe("http://web-control.worker/api/internal/hosted-execution/vault-sync/import");
    expect(importRequest.method).toBe("POST");
    await expect(importRequest.json()).resolves.toEqual({
      importedAt: "2026-04-26T00:00:07.000Z",
      sessionId: "vault_sync_123",
      status: "imported",
      summary: {
        conflictCount: 0,
        importedJsonlRecords: 1,
        importedRawFiles: 0,
        importedTextFiles: 1,
        skippedDuplicates: 0,
        skippedExcludedFiles: 0,
      },
    });
  });

  it("exposes only the shared hosted effects port methods needed after the cutover", async () => {
    const rawMessage = new Uint8Array([0x61, 0x62, 0x63]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);

      if (request.method === "GET") {
        return new Response(rawMessage, {
          headers: {
            "content-type": "message/rfc822",
          },
          status: 200,
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        target: "assistant@example.com",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });
    const { effectsPort } = platform;

    expect("deletePreparedAssistantDelivery" in effectsPort).toBe(false);
    expect("readAssistantDeliveryRecord" in effectsPort).toBe(false);
    expect("writeAssistantDeliveryRecord" in effectsPort).toBe(false);

    const readResult = await effectsPort.readRawEmailMessage("raw_123");
    const sendResult = await effectsPort.sendEmail({
      identityId: "identity_123",
      message: "hello",
      subject: "subject",
      target: "assistant@example.com",
      targetKind: "explicit",
    });

    expect(readResult).toEqual(rawMessage);
    expect(sendResult).toEqual({ target: "assistant@example.com" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const readRequest = fetchMock.mock.calls[0]?.[0] as Request;
    const sendRequest = fetchMock.mock.calls[1]?.[0] as Request;

    expect(readRequest).toBeInstanceOf(Request);
    expect(sendRequest).toBeInstanceOf(Request);
    expect(readRequest.url).toBe("http://results.worker/messages/raw_123");
    expect(sendRequest.url).toBe("http://results.worker/send");
  });

  it("preserves HTTP status on hosted raw email read failures", async () => {
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: vi.fn(async () => new Response("unavailable", { status: 503 })) as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow(/Hosted raw email read raw_123 failed with HTTP 503/u);

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toMatchObject({
      status: 503,
      statusCode: 503,
    });
  });
});
