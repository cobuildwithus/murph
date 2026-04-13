import { describe, expect, it } from "vitest";

import type { R2BucketLike } from "../src/bundle-store.js";
import {
  persistHostedExecutionCommit,
  persistHostedExecutionFinalBundles,
} from "../src/execution-journal.js";

const textEncoder = new TextEncoder();

class InMemoryR2Bucket implements R2BucketLike {
  readonly entries = new Map<string, string>();

  async get(key: string) {
    const value = this.entries.get(key);

    if (value === undefined) {
      return null;
    }

    return {
      async arrayBuffer() {
        return textEncoder.encode(value).buffer.slice(0);
      },
    };
  }

  async put(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }
}

function createBaseCommit(bucket: InMemoryR2Bucket) {
  return {
    bucket,
    currentBundleRef: null,
    eventId: "evt_123",
    key: textEncoder.encode("murph-cloudflare-execution-journal-test-key"),
    keyId: "test-key",
    userId: "user_123",
  } as const;
}

function encodeBundle(label: string): string {
  return Buffer.from(label, "utf8").toString("base64");
}

describe("persistHostedExecutionCommit", () => {
  it("accepts duplicate commits when structured payload keys are reordered", async () => {
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    const first = await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [],
        bundle: null,
        gatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-12T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await expect(
      persistHostedExecutionCommit({
        ...baseCommit,
        payload: {
          assistantDeliveryEffects: [],
          bundle: null,
          gatewayProjectionSnapshot: {
            permissions: [],
            messages: [],
            conversations: [],
            generatedAt: "2026-04-12T00:00:00.000Z",
            schema: "murph.gateway-projection-snapshot.v1",
          },
          result: {
            summary: "ok",
            nextWakeAt: null,
            eventsHandled: 1,
          },
        },
      }),
    ).resolves.toEqual(first);

    expect(bucket.entries.size).toBe(1);
  });
});

describe("persistHostedExecutionFinalBundles", () => {
  it("accepts equivalent duplicate finalizes without rewriting the durable result", async () => {
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    const finalized = await persistHostedExecutionFinalBundles({
      bucket,
      eventId: baseCommit.eventId,
      key: baseCommit.key,
      keyId: baseCommit.keyId,
      payload: {
        bundle: encodeBundle("bundle-a"),
        gatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-12T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
      },
      userId: baseCommit.userId,
    });

    await expect(
      persistHostedExecutionFinalBundles({
        bucket,
        eventId: baseCommit.eventId,
        key: baseCommit.key,
        keyId: baseCommit.keyId,
        payload: {
          bundle: encodeBundle("bundle-a"),
          gatewayProjectionSnapshot: {
            permissions: [],
            messages: [],
            conversations: [],
            generatedAt: "2026-04-12T00:00:00.000Z",
            schema: "murph.gateway-projection-snapshot.v1",
          },
        },
        userId: baseCommit.userId,
      }),
    ).resolves.toEqual(finalized);

    expect(bucket.entries.size).toBe(2);
  });

  it("rejects post-finalize retries that try to replace the durable gateway snapshot", async () => {
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await persistHostedExecutionFinalBundles({
      bucket,
      eventId: baseCommit.eventId,
      key: baseCommit.key,
      keyId: baseCommit.keyId,
      payload: {
        bundle: encodeBundle("bundle-a"),
        gatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-12T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
      },
      userId: baseCommit.userId,
    });

    await expect(
      persistHostedExecutionFinalBundles({
        bucket,
        eventId: baseCommit.eventId,
        key: baseCommit.key,
        keyId: baseCommit.keyId,
        payload: {
          bundle: encodeBundle("bundle-a"),
          gatewayProjectionSnapshot: {
            schema: "murph.gateway-projection-snapshot.v1",
            generatedAt: "2026-04-12T00:00:00.000Z",
            conversations: [
              {
                schema: "murph.gateway-conversation.v1",
                sessionKey: "conversation-2",
                title: null,
                titleSource: null,
                lastMessagePreview: null,
                lastActivityAt: null,
                messageCount: null,
                canSend: false,
                route: {
                  channel: null,
                  identityId: null,
                  participantId: null,
                  threadId: null,
                  directness: null,
                  reply: {
                    kind: null,
                    target: null,
                  },
                },
              },
            ],
            messages: [],
            permissions: [],
          },
        },
        userId: baseCommit.userId,
      }),
    ).rejects.toThrow(/gateway projection snapshot does not match the existing durable finalize/i);

    expect(bucket.entries.size).toBe(2);
  });

  it("rejects post-finalize retries that try to replace the durable bundle", async () => {
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await persistHostedExecutionFinalBundles({
      bucket,
      eventId: baseCommit.eventId,
      key: baseCommit.key,
      keyId: baseCommit.keyId,
      payload: {
        bundle: encodeBundle("bundle-a"),
      },
      userId: baseCommit.userId,
    });

    await expect(
      persistHostedExecutionFinalBundles({
        bucket,
        eventId: baseCommit.eventId,
        key: baseCommit.key,
        keyId: baseCommit.keyId,
        payload: {
          bundle: encodeBundle("bundle-b"),
        },
        userId: baseCommit.userId,
      }),
    ).rejects.toThrow(/vault bundle ref does not match the existing durable finalize/i);

    expect(bucket.entries.size).toBe(2);
  });
});
