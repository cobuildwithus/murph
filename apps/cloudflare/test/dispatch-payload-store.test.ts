import { describe, expect, it } from "vitest";
import {
  buildHostedExecutionDeviceSyncWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";

import {
  createHostedDispatchPayloadStore,
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

function createTestWake(input?: Partial<{
  eventId: string;
  hint: Record<string, unknown> | null;
}>): HostedExecutionWake {
  return buildHostedExecutionDeviceSyncWake({
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
  it("writes encrypted wake payload blobs and reads them back", async () => {
    const bucket = new MemoryR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
      keyId: "test-key",
    });
    const wake = createTestWake();

    const payloadRef = await store.writeDispatchPayload(wake);

    expect(payloadRef.stagedPayloadId).toBeTruthy();
    expect(bucket.objects.size).toBe(1);
    await expect(store.readDispatchPayload(payloadRef)).resolves.toEqual(wake);
    await store.deleteDispatchPayload(payloadRef);
    expect(bucket.deleted).toEqual([payloadRef.stagedPayloadId]);
  });

  it("uses content-addressed payload keys for new staged blobs", async () => {
    const bucket = new MemoryR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
      keyId: "test-key",
    });
    const baseWake = createTestWake();
    const sameWake = createTestWake();
    const changedWake = createTestWake({
      hint: {
        traceId: "trace-2",
      },
    });

    const firstRef = await store.writeDispatchPayload(baseWake);
    const secondRef = await store.writeDispatchPayload(sameWake);
    const changedRef = await store.writeDispatchPayload(changedWake);

    expect(secondRef.stagedPayloadId).toBe(firstRef.stagedPayloadId);
    expect(changedRef.stagedPayloadId).not.toBe(firstRef.stagedPayloadId);
  });

  it("keeps the same staged payload id when equivalent nested wake JSON keys are reordered", async () => {
    const bucket = new MemoryR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
      keyId: "test-key",
    });
    const firstWake = createTestWake({
      hint: {
        nested: {
          alpha: 1,
          beta: true,
        },
        traceId: "trace-1",
      },
    });
    const reorderedWake = createTestWake({
      hint: {
        traceId: "trace-1",
        nested: {
          beta: true,
          alpha: 1,
        },
      },
    });

    const firstRef = await store.writeDispatchPayload(firstWake);
    const reorderedRef = await store.writeDispatchPayload(reorderedWake);

    expect(reorderedRef.stagedPayloadId).toBe(firstRef.stagedPayloadId);
  });

  it("treats unknown staged payload ids as absent instead of failing", async () => {
    const bucket = new MemoryR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
      keyId: "test-key",
    });
    await expect(store.readDispatchPayload({
      stagedPayloadId: "transient/dispatch-payloads/test-user/missing",
    })).resolves.toBeNull();
  });

  it("treats missing staged payload probes as absent instead of failing", async () => {
    const bucket = new MemoryR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
      keyId: "test-key",
    });
    const wake = createTestWake({ eventId: "device-sync.wake:test-user:event-missing" });
    const payloadRef = await store.writeDispatchPayload(wake);

    bucket.objects.clear();

    await expect(store.readDispatchPayload(payloadRef)).resolves.toBeNull();
  });
});
