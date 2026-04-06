import { describe, expect, it } from "vitest";

import { createHostedDeviceSyncRuntimeStore } from "../src/device-sync-runtime-store.js";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "../src/crypto-context.js";
import { writeEncryptedR2Json } from "../src/crypto.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

describe("createHostedDeviceSyncRuntimeStore", () => {
  it("rejects the removed mirror schema instead of reading it as current state", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const key = createTestRootKey(27);
    const userId = "user_legacy_runtime";
    const objectKey = await deviceSyncRuntimeStateObjectKey(key, userId);

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "device-sync-runtime",
        userId,
      }),
      bucket,
      cryptoKey: key,
      key: objectKey,
      keyId: "v1",
      scope: "device-sync-runtime",
      value: {
        generatedAt: "2026-04-06T00:00:00.000Z",
        schema: "murph.hosted-device-sync-runtime-mirror.v1",
        snapshot: {
          connections: [],
          generatedAt: "2026-04-06T00:00:00.000Z",
          userId,
        },
      },
    });

    const store = createHostedDeviceSyncRuntimeStore({
      bucket,
      key,
      keyId: "v1",
    });

    await expect(store.readSnapshot({ userId })).rejects.toThrow(
      "Hosted device-sync runtime state.schema must be murph.hosted-device-sync-runtime.v1.",
    );
  });
});

async function deviceSyncRuntimeStateObjectKey(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "device-sync-runtime-path",
    value: `user:${userId}`,
  });

  return `transient/device-sync-runtime/${userSegment}.json`;
}
