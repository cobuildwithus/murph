import { describe, expect, it, vi } from "vitest";

import { buildHostedExecutionRuntimePlatform } from "../src/runtime-platform.ts";

describe("buildHostedExecutionRuntimePlatform", () => {
  it("routes effects through the Cloudflare internal effects port and attaches the per-run proxy token", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      internalWorkerProxyToken: "runner-proxy-token",
    });

    await platform.effectsPort.commit({
      eventId: "evt_123",
      payload: {
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the effects port fetch to run.");
    }
    const [request] = firstCall as unknown as [RequestInfo | URL, RequestInit?];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe("http://results.worker/events/evt_123/commit");
    expect((request as Request).headers.get("x-hosted-execution-runner-proxy-token")).toBe(
      "runner-proxy-token",
    );
  });

  it("binds device-sync requests to the hosted member id at the Cloudflare port seam", async () => {
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
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
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
    const [request] = firstCall as unknown as [RequestInfo | URL, RequestInit?];
    expect(request).toBeInstanceOf(URL);
    expect(String(request)).toBe("http://device-sync.worker/api/internal/device-sync/runtime/snapshot");
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
});
