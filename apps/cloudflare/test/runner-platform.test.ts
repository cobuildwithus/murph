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
    const request = fetchMock.mock.calls[0]?.[0];
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
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(URL);
    expect(String(request)).toBe("http://device-sync.worker/api/internal/device-sync/runtime/snapshot");
  });
});
