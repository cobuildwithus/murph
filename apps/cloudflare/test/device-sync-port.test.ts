import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  type HostedExecutionDeviceSyncRuntimeApplyRequest,
} from "@murphai/device-syncd/hosted-runtime";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedWebDeviceSyncPort,
} from "../src/runtime-platform/device-sync-port.ts";

describe("hosted device-sync runtime port", () => {
  it("partitions runtime apply callbacks by final serialized body bytes", async () => {
    const received: Array<{
      body: HostedExecutionDeviceSyncRuntimeApplyRequest;
      bodyBytes: number;
      path: string;
    }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const bodyText = await request.text();
      const body = JSON.parse(bodyText) as HostedExecutionDeviceSyncRuntimeApplyRequest;
      received.push({
        body,
        bodyBytes: new TextEncoder().encode(bodyText).byteLength,
        path: new URL(request.url).pathname,
      });
      return Response.json({
        appliedAt: `2026-08-11T12:00:${String(received.length).padStart(2, "0")}.000Z`,
        updates: body.updates.map((update) => ({
          connection: null,
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate: "unchanged",
          writeUpdate: "applied",
        })),
        userId: body.userId,
      });
    });
    const updates = Array.from(
      { length: 100 },
      (_, index) => buildRuntimeApplyUpdate(index, {
        sourceCount: 64,
        sourceKeyPadding: "x".repeat(80),
      }),
    );
    const unsplitBytes = new TextEncoder().encode(JSON.stringify({
      occurredAt: "2026-08-11T12:00:00.000Z",
      updates,
      userId: "member_device_sync_1",
    })).byteLength;
    const port = createHostedWebDeviceSyncPort({
      boundUserId: "member_device_sync_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    const response = await port.applyUpdates({
      occurredAt: "2026-08-11T12:00:00.000Z",
      updates,
    });

    expect(unsplitBytes).toBeGreaterThan(
      HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
    );
    expect(received.length).toBeGreaterThan(1);
    expect(received.every((entry) =>
      entry.bodyBytes <= HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES
    )).toBe(true);
    expect(received.every((entry) => entry.body.updates.length <= 100)).toBe(true);
    expect(received.every((entry) => entry.path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH))
      .toBe(true);
    expect(received.flatMap((entry) => entry.body.updates).map((update) => update.connectionId))
      .toEqual(updates.map((update) => update.connectionId));
    expect(response.userId).toBe("member_device_sync_1");
    expect(response.updates.map((update) => update.connectionId))
      .toEqual(updates.map((update) => update.connectionId));
    expect(response.updates.every((update) => update.writeUpdate === "applied")).toBe(true);
  });

  it("does not return a misleading complete response after a later split request fails", async () => {
    const received: HostedExecutionDeviceSyncRuntimeApplyRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = await request.json() as HostedExecutionDeviceSyncRuntimeApplyRequest;
      received.push(body);
      if (received.length === 2) {
        return new Response("temporary failure", { status: 502 });
      }
      return Response.json({
        appliedAt: "2026-08-11T12:00:00.000Z",
        updates: body.updates.map((update) => ({
          connection: null,
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate: "unchanged",
          writeUpdate: "applied",
        })),
        userId: body.userId,
      });
    });
    const port = createHostedWebDeviceSyncPort({
      boundUserId: "member_device_sync_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.applyUpdates({
      updates: Array.from(
        { length: 100 },
        (_, index) => buildRuntimeApplyUpdate(index, {
          sourceCount: 64,
          sourceKeyPadding: "x".repeat(80),
        }),
      ),
    })).rejects.toThrow("Hosted device-sync runtime apply failed with HTTP 502.");
    expect(received.length).toBe(2);
  });

  it("rejects one independently oversized update before transport retry loops", async () => {
    const fetchMock = vi.fn();
    const port = createHostedWebDeviceSyncPort({
      boundUserId: "member_device_sync_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.applyUpdates({
      updates: [buildRuntimeApplyUpdate(1, {
        sourceCount: 1,
        sourceKeyPadding: "x".repeat(HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES),
      })],
    })).rejects.toThrow("Hosted device-sync runtime apply update exceeds the callback body limit.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function buildRuntimeApplyUpdate(
  index: number,
  options: {
    sourceCount: number;
    sourceKeyPadding: string;
  },
): HostedExecutionDeviceSyncRuntimeApplyRequest["updates"][number] {
  const connectionId = `connection_${String(index).padStart(3, "0")}`;
  return {
    connectionId,
    observedConnectedAt: "2026-08-11T12:00:00.000Z",
    sources: Array.from({ length: options.sourceCount }, (_, sourceIndex) => ({
      lastSeenAt: "2026-08-11T12:00:00.000Z",
      observedLastSeenAt: null,
      sourceInstanceKey:
        `${connectionId}:source:${String(sourceIndex).padStart(2, "0")}:${options.sourceKeyPadding}`,
      sourceProviderSlug: `source_${sourceIndex}`,
      status: "connected",
    })),
  };
}
