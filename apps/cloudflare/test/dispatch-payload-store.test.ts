import { describe, expect, it } from "vitest";
import {
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionOutboxPayload,
  type HostedExecutionDispatchRequest,
  type HostedExecutionMemberActivatedEvent,
} from "@murphai/hosted-execution";

import {
  createHostedExecutionDispatchPayloadStore,
} from "../src/dispatch-payload-store.ts";
import type { R2BucketLike } from "../src/bundle-store.ts";

class MemoryR2Bucket implements R2BucketLike {
  readonly objects = new Map<string, string>();

  async delete(key: string): Promise<void> {
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
  firstContact: HostedExecutionMemberActivatedEvent["firstContact"];
}>): HostedExecutionDispatchRequest {
  return buildHostedExecutionMemberActivatedDispatch({
    eventId: input?.eventId ?? "member.activated:test-user:event-1",
    ...(input?.firstContact === undefined ? {} : { firstContact: input.firstContact }),
    memberId: "test-user",
    occurredAt: "2026-04-05T00:00:00.000Z",
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
    expect(payload.payloadRef?.key).toBeTruthy();
    await expect(store.readStoredDispatch(payload)).resolves.toEqual(dispatch);
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
      firstContact: {
        channel: "linq",
        identityId: "+15555550123",
        threadId: "linq-thread-2",
        threadIsDirect: true,
      },
    });

    const firstRef = await store.writeDispatchPayload(baseDispatch);
    const secondRef = await store.writeDispatchPayload(sameDispatch);
    const changedRef = await store.writeDispatchPayload(changedDispatch);

    expect(secondRef.key).toBe(firstRef.key);
    expect(changedRef.key).not.toBe(firstRef.key);
  });

  it("rejects reference payload envelopes without payload refs", async () => {
    const bucket = new MemoryR2Bucket();
    const store = createHostedExecutionDispatchPayloadStore({
      bucket,
      key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
      keyId: "test-key",
    });
    const dispatch = createTestDispatch({ eventId: "member.activated:test-user:event-legacy" });
    const legacyPayload = buildHostedExecutionOutboxPayload(dispatch, { storage: "reference" });

    await expect(store.readStoredDispatch(legacyPayload)).rejects.toThrow(
      "Hosted dispatch reference payloads must include payloadRef.",
    );
    expect(store.readStoredDispatchRef(legacyPayload)).toBeNull();
    await expect(store.deleteStoredDispatchPayload(legacyPayload)).resolves.toBeUndefined();
  });
});
