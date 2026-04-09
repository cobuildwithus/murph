import { CONTRACT_SCHEMA_VERSION, type SharePack } from "@murphai/contracts";
import { describe, expect, it } from "vitest";

import { createHostedShareStore } from "../src/share-store.js";
import { hostedSharePackObjectKey } from "../src/storage-paths.js";

import { createTestRootKey, MemoryEncryptedR2Bucket } from "./test-helpers.js";

const ROOT_KEY = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 11));
const ROOT_KEY_ID = "urk:test";

describe("createHostedShareStore", () => {
  it("keeps share packs isolated to the owning user root-key domain", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
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
            kind: "supplement",
            status: "active",
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

  it("requires a rewrite before share packs survive platform root-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(9);
    const nextKey = createTestRootKey(10);
    const oldStore = createHostedShareStore({
      bucket,
      key: oldKey,
      keyId: "old",
      ownerUserId: "member_owner",
    });
    const rotatedStore = createHostedShareStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
      ownerUserId: "member_owner",
    });

    await oldStore.writeSharePack("share_rotated", {
      createdAt: "2026-04-05T00:00:00.000Z",
      entities: [
        {
          kind: "protocol",
          payload: {
            kind: "supplement",
            status: "active",
            title: "Rotated protocol",
          },
          ref: "rotated-protocol",
        },
      ],
      schemaVersion: CONTRACT_SCHEMA_VERSION.sharePack,
      title: "Rotated Murph pack",
    });

    await expect(oldStore.readSharePack("share_rotated")).resolves.toEqual({
      createdAt: "2026-04-05T00:00:00.000Z",
      entities: [
        {
          kind: "protocol",
          payload: {
            kind: "supplement",
            status: "active",
            title: "Rotated protocol",
          },
          ref: "rotated-protocol",
        },
      ],
      schemaVersion: CONTRACT_SCHEMA_VERSION.sharePack,
      title: "Rotated Murph pack",
    });
    await expect(rotatedStore.readSharePack("share_rotated")).resolves.toBeNull();
  });

  it("deletes only the authoritative share-pack object key", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedShareStore({
      bucket,
      key: ROOT_KEY,
      keyId: ROOT_KEY_ID,
      ownerUserId: "member_owner",
    });
    const objectKey = await hostedSharePackObjectKey(ROOT_KEY, "member_owner", "share_delete");

    await store.writeSharePack("share_delete", {
      createdAt: "2026-04-05T00:00:00.000Z",
      entities: [
        {
          kind: "protocol",
          payload: {
            kind: "supplement",
            status: "active",
            title: "Delete protocol",
          },
          ref: "delete-protocol",
        },
      ],
      schemaVersion: CONTRACT_SCHEMA_VERSION.sharePack,
      title: "Delete Murph pack",
    });
    await store.deleteSharePack("share_delete");

    expect(bucket.deleted).toEqual([objectKey]);
    await expect(store.readSharePack("share_delete")).resolves.toBeNull();
  });
});
