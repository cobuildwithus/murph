import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedPendingUsageDirtyUserStore,
  createHostedPendingUsageStore,
} from "../src/usage-store.ts";

const textEncoder = new TextEncoder();

describe("hosted pending usage dirty user store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the dirty-user limit after decrypting and sorting by updatedAt", async () => {
    vi.useFakeTimers();

    const bucket = createBucketStore();
    const usageStore = createHostedPendingUsageStore({
      bucket: bucket.api,
      dirtyKey: textEncoder.encode("dirty-root-key"),
      dirtyKeyId: "dirty-root-key",
      key: textEncoder.encode("usage-root-key"),
      keyId: "usage-root-key",
    });
    const dirtyUserStore = createHostedPendingUsageDirtyUserStore({
      bucket: bucket.api,
      key: textEncoder.encode("dirty-root-key"),
      keyId: "dirty-root-key",
    });

    vi.setSystemTime(new Date("2026-04-06T00:00:00.000Z"));
    await usageStore.appendUsage({
      usage: [{ occurredAt: "2026-04-06T00:00:00.000Z", usageId: "usage-a" }],
      userId: "user-a",
    });

    vi.setSystemTime(new Date("2026-04-06T00:00:01.000Z"));
    await usageStore.appendUsage({
      usage: [{ occurredAt: "2026-04-06T00:00:01.000Z", usageId: "usage-b" }],
      userId: "user-b",
    });

    vi.setSystemTime(new Date("2026-04-06T00:00:02.000Z"));
    await usageStore.appendUsage({
      usage: [{ occurredAt: "2026-04-06T00:00:02.000Z", usageId: "usage-c" }],
      userId: "user-c",
    });

    await expect(dirtyUserStore.listDirtyUsers({ limit: 2 })).resolves.toEqual([
      "user-c",
      "user-b",
    ]);
  });
});

function createBucketStore() {
  const values = new Map<string, string>();

  return {
    api: {
      async delete(key: string) {
        values.delete(key);
      },
      async get(key: string) {
        const value = values.get(key);

        if (!value) {
          return null;
        }

        return {
          async arrayBuffer() {
            const bytes = Buffer.from(value, "utf8");
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          },
        };
      },
      async list(input: { cursor?: string; limit?: number; prefix?: string }) {
        const keys = [...values.keys()].filter((key) => input.prefix ? key.startsWith(input.prefix) : true);
        const start = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
        const limit = Math.max(1, input.limit ?? 1000);
        const pageKeys = keys.slice(start, start + limit);
        const nextIndex = start + pageKeys.length;

        return {
          cursor: nextIndex < keys.length ? String(nextIndex) : undefined,
          objects: pageKeys.map((key) => ({ key })),
          truncated: nextIndex < keys.length,
        };
      },
      async put(key: string, value: string) {
        values.set(key, value);
      },
    },
  };
}
