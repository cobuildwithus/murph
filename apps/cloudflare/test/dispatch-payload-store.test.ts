import { describe, expect, it } from "vitest";
import {
  buildHostedExecutionDeviceSyncWakeDispatch,
  buildHostedExecutionDispatchRef,
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

import {
  createHostedExecutionDispatchPayloadStore,
} from "../src/dispatch-payload-store.ts";
import type { R2BucketLike } from "../src/bundle-store.ts";

class MemoryR2Bucket implements R2BucketLike {
  readonly deleted: string[] = [];
  readonly objects = new Map<string, string>();

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const value = this.objects.get(key);

    if (value === undefined) {
      return null;
    }

    return {
      async arrayBuffer(): Promise<ArrayBuffer> {
        return new TextEncoder().encode(value).buffer;
      },
    };
  }

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }
}

function createTestDispatch(input?: Partial<{
  eventId: string;
  hint: Record<string, unknown> | null;
}>): HostedExecutionDispatchRequest {
  return buildHostedExecutionDeviceSyncWakeDispatch({
    connectionId: "conn_test_1",
    eventId: input?.eventId ?? "device-sync.wake:test-user:event-1",
    ...(input?.hint === undefined ? {} : { hint: input.hint }),
    occurredAt: "2026-04-05T00:00:00.000Z",
    provider: "oura",
    reason: "webhook_hint",
    userId: "test-user",
  });
}

describe("hosted dispatch payload store", () => {
  it("writes staged reference payload envelopes for reference-backed dispatches", async () => {
    const bucket = new MemoryR2Bucket();
    const store = createHostedExecutionDispatchPayloadStore({
      bucket,
      key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
      keyId: "test-key",
    });
    const dispatch = createTestDispatch();

    const payload = await store.writeStoredDispatch(dispatch);

    expect(payload.storage).toBe("reference");
    expect(payload.stagedPayloadId).toBeTruthy();
    expect(bucket.objects.size).toBe(1);
    await expect(store.readStoredDispatch(payload)).resolves.toEqual(dispatch);
    await store.deleteStoredDispatchPayload(payload);
    expect(bucket.deleted).toEqual([payload.stagedPayloadId]);
  });

  it("uses content-addressed payload keys for new staged blobs", async () => {
    const bucket = new MemoryR2Bucket();
    const store = createHostedExecutionDispatchPayloadStore({
      bucket,
      key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
      keyId: "test-key",
    });
    const baseDispatch = createTestDispatch();
    const sameDispatch = createTestDispatch();
    const changedDispatch = createTestDispatch({
      hint: {
        traceId: "trace-2",
      },
    });

    const firstRef = await store.writeDispatchPayload(baseDispatch);
    const secondRef = await store.writeDispatchPayload(sameDispatch);
    const changedRef = await store.writeDispatchPayload(changedDispatch);

    expect(secondRef.stagedPayloadId).toBe(firstRef.stagedPayloadId);
    expect(changedRef.stagedPayloadId).not.toBe(firstRef.stagedPayloadId);
  });

  it("rejects reference payload envelopes without staged payload ids", async () => {
    const bucket = new MemoryR2Bucket();
    const store = createHostedExecutionDispatchPayloadStore({
      bucket,
      key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
      keyId: "test-key",
    });
    const dispatch = createTestDispatch({ eventId: "device-sync.wake:test-user:event-legacy" });
    const legacyPayload = {
      dispatchRef: buildHostedExecutionDispatchRef(dispatch),
      storage: "reference",
    };

    await expect(store.readStoredDispatch(legacyPayload)).rejects.toThrow(
      "Hosted dispatch payload envelope is invalid.",
    );
    expect(store.readStoredDispatchRef(legacyPayload)).toBeNull();
    await expect(store.deleteStoredDispatchPayload(legacyPayload)).resolves.toBeUndefined();
  });
});
