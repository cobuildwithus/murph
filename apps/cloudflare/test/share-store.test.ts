import { CONTRACT_SCHEMA_VERSION, type SharePack } from "@murphai/contracts";
import { describe, expect, it } from "vitest";

import type { R2BucketLike } from "../src/bundle-store.js";
import { createHostedShareStore } from "../src/share-store.js";

const ROOT_KEY = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 11));
const ROOT_KEY_ID = "urk:test";

class MemoryR2Object {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const encoded = new TextEncoder().encode(this.value);
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
  }
}

class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, string>();

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async get(key: string): Promise<MemoryR2Object | null> {
    const value = this.objects.get(key);
    return value === undefined ? null : new MemoryR2Object(value);
  }

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }
}

describe("createHostedShareStore", () => {
  it("keeps share packs isolated to the owning user root-key domain", async () => {
    const bucket = new MemoryBucket();
    const ownerStore = createHostedShareStore({
      bucket,
      key: ROOT_KEY,
      keyId: ROOT_KEY_ID,
      ownerUserId: "member_owner",
    });
    const otherOwnerStore = createHostedShareStore({
      bucket,
      key: ROOT_KEY,
      keyId: ROOT_KEY_ID,
      ownerUserId: "member_other",
    });
    const sharePack: SharePack = {
      createdAt: "2026-04-05T00:00:00.000Z",
      entities: [
        {
          kind: "protocol",
          payload: {
            title: "Shared protocol",
          },
          ref: "shared-protocol",
        },
      ],
      schemaVersion: CONTRACT_SCHEMA_VERSION.sharePack,
      title: "Shared Murph pack",
    };

    await ownerStore.writeSharePack("share_123", sharePack);

    await expect(ownerStore.readSharePack("share_123")).resolves.toEqual({
      createdAt: "2026-04-05T00:00:00.000Z",
      entities: [
        {
          kind: "protocol",
          payload: {
            kind: "supplement",
            status: "active",
            title: "Shared protocol",
          },
          ref: "shared-protocol",
        },
      ],
      schemaVersion: CONTRACT_SCHEMA_VERSION.sharePack,
      title: "Shared Murph pack",
    });
    await expect(otherOwnerStore.readSharePack("share_123")).resolves.toBeNull();
  });
});
