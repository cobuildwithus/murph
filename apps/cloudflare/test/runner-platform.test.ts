import { describe, expect, it, vi } from "vitest";

import { buildHostedExecutionRuntimePlatform } from "../src/runtime-platform.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

describe("buildHostedExecutionRuntimePlatform", () => {
  it("routes effects through the Cloudflare internal effects port and attaches the per-run proxy token", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    await platform.effectsPort.deletePreparedAssistantDelivery({
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the effects port fetch to run.");
    }
    const [request] = firstCall as unknown as [RequestInfo | URL, RequestInit?];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe(
      "http://results.worker/effects/effect_123?fingerprint=fingerprint_123",
    );
    expect((request as Request).headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
    expect((request as Request).method).toBe("DELETE");
  });

  it("rewrites internal worker requests through the loopback proxy when configured", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyBaseUrl: "http://127.0.0.1:8080/__internal/worker-proxy/",
      internalWorkerProxyToken: "runner-proxy-token",
    });

    await platform.effectsPort.deletePreparedAssistantDelivery({
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the proxied effects port fetch to run.");
    }
    const [request] = firstCall as unknown as [RequestInfo | URL, RequestInit?];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe(
      "http://127.0.0.1:8080/__internal/worker-proxy/results.worker/effects/effect_123?fingerprint=fingerprint_123",
    );
    expect((request as Request).headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
    expect((request as Request).method).toBe("DELETE");
  });

  it("binds device-sync runtime requests to the hosted member id at the signed web callback seam", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = await request.json() as Record<string, unknown>;

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
      HOSTED_WEB_BASE_URL: "https://web.example.test/app",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test/app",
    });

    const snapshot = await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(snapshot.userId).toBe("member_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the device-sync fetch to run.");
    }
    const [url, init] = firstCall as unknown as [RequestInfo | URL, RequestInit?];
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
      HOSTED_WEB_BASE_URL: "https://web.example.test/app",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test/app",
    });

    const connectLink = await platform.deviceSyncPort!.createConnectLink({
      provider: "oura",
    });

    expect(connectLink.provider).toBe("oura");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the device-sync connect-link fetch to run.");
    }
    const [url, init] = firstCall as unknown as [RequestInfo | URL, RequestInit?];
    expect(String(url)).toBe("https://web.example.test/api/internal/device-sync/providers/oura/connect-link");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("supports the assistant-delivery-specific journal method names", async () => {
    const record = {
      delivery: {
        channel: "email",
        idempotencyKey: "idem_123",
        messageLength: 42,
        providerMessageId: null,
        providerThreadId: null,
        sentAt: "2026-04-08T00:00:00.000Z",
        target: "assistant@example.com",
        targetKind: "participant" as const,
      },
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      kind: "assistant.delivery" as const,
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent" as const,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);

      if (request.method === "DELETE") {
        return new Response(null, { status: 200 });
      }

      return new Response(JSON.stringify({
        ok: true,
        record,
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
    });
    const { effectsPort } = platform;

    if (
      !("deletePreparedAssistantDelivery" in effectsPort)
      || !("readAssistantDeliveryRecord" in effectsPort)
      || !("writeAssistantDeliveryRecord" in effectsPort)
      || !effectsPort.deletePreparedAssistantDelivery
      || !effectsPort.readAssistantDeliveryRecord
      || !effectsPort.writeAssistantDeliveryRecord
    ) {
      throw new Error("Expected assistant-delivery journal methods to be available.");
    }

    await effectsPort.deletePreparedAssistantDelivery({
      effectId: "intent_123",
      fingerprint: "dedupe_123",
    });
    const readRecord = await effectsPort.readAssistantDeliveryRecord({
      effectId: "intent_123",
      fingerprint: "dedupe_123",
    });
    const writtenRecord = await effectsPort.writeAssistantDeliveryRecord(record);

    expect(readRecord).toEqual(record);
    expect(writtenRecord).toEqual(record);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const deleteRequest = fetchMock.mock.calls[0]?.[0] as URL;
    const readRequest = fetchMock.mock.calls[1]?.[0] as URL;
    const writeRequest = fetchMock.mock.calls[2]?.[0] as URL;

    expect(String(deleteRequest)).toBe("http://results.worker/effects/intent_123?fingerprint=dedupe_123");
    expect(String(readRequest)).toBe("http://results.worker/effects/intent_123?fingerprint=dedupe_123");
    expect(String(writeRequest)).toBe("http://results.worker/effects/intent_123?fingerprint=dedupe_123");
  });

  it("preserves HTTP status on hosted assistant-delivery journal failures", async () => {
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: vi.fn(async () => new Response("unavailable", { status: 503 })) as typeof fetch,
    });

    await expect(
      platform.effectsPort.readAssistantDeliveryRecord({
        effectId: "intent_123",
        fingerprint: "dedupe_123",
      }),
    ).rejects.toMatchObject({
      message: "Hosted side-effect read intent_123 failed with HTTP 503. unavailable",
      status: 503,
      statusCode: 503,
    });
  });
});
