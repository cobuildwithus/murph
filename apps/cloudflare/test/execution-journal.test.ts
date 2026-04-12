import { describe, expect, it } from "vitest";

import type { R2BucketLike } from "../src/bundle-store.js";
import { persistHostedExecutionCommit } from "../src/execution-journal.js";

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

describe("persistHostedExecutionCommit", () => {
  it("accepts duplicate commits when structured payload keys are reordered", async () => {
    const bucket = new InMemoryR2Bucket();
    const key = textEncoder.encode("murph-cloudflare-execution-journal-test-key");
    const baseCommit = {
      bucket,
      currentBundleRef: null,
      eventId: "evt_123",
      key,
      keyId: "test-key",
      userId: "user_123",
    } as const;

    const first = await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
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
