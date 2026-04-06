import { CONTRACT_SCHEMA_VERSION, type SharePack } from "@murphai/contracts";
import { describe, expect, it } from "vitest";

import { createHostedShareStore } from "../src/share-store.js";

import { MemoryEncryptedR2Bucket } from "./test-helpers";

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
