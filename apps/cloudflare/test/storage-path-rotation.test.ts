import { describe, expect, it } from "vitest";

import { createHostedUserEnvStore } from "../src/bundle-store.js";
import { createHostedDispatchPayloadStore } from "../src/dispatch-payload-store.js";
import { readHostedEmailRawMessage, writeHostedEmailRawMessage } from "../src/hosted-email.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers";

describe("opaque storage path rotation", () => {
  it("keeps per-user env readable and clearable across bundle-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(5);
    const nextKey = createTestRootKey(6);
    const userId = "user_live_rotate";
    const plaintext = new TextEncoder().encode(JSON.stringify({ OPENAI_API_KEY: "secret" }));

    await createHostedUserEnvStore({
      bucket,
      key: oldKey,
      keyId: "old",
      keysById: { old: oldKey },
    }).writeUserEnv(userId, plaintext);

    const rotatedStore = createHostedUserEnvStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
    });

    expect(await rotatedStore.readUserEnv(userId)).toEqual(plaintext);

    await rotatedStore.clearUserEnv(userId);
    expect(await rotatedStore.readUserEnv(userId)).toBeNull();
    expect(bucket.deleted.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps referenced dispatch payload blobs readable across bundle-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(7);
    const nextKey = createTestRootKey(8);
    const dispatch = {
      event: {
        kind: "vault.share.accepted",
        share: {
          shareId: "hshare_123",
        },
        userId: "user_live_share",
      },
      eventId: "evt_share_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    } as const;

    const oldStore = createHostedDispatchPayloadStore({
      bucket,
      key: oldKey,
      keyId: "old",
      keysById: { old: oldKey },
    });
    const payloadJson = await oldStore.writeStoredDispatch(dispatch);

    const rotatedStore = createHostedDispatchPayloadStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
    });

    expect(await rotatedStore.readStoredDispatch(payloadJson)).toEqual(dispatch);
    await rotatedStore.deleteStoredDispatchPayload(payloadJson);
    expect(bucket.deleted.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps hosted raw email messages readable across bundle-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(9);
    const nextKey = createTestRootKey(10);
    const userId = "user_live_email";
    const plaintext = new TextEncoder().encode("Subject: hi\n\nbody");

    const rawMessageKey = await writeHostedEmailRawMessage({
      bucket,
      key: oldKey,
      keyId: "old",
      plaintext,
      userId,
    });

    expect(await readHostedEmailRawMessage({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
      rawMessageKey,
      userId,
    })).toEqual(plaintext);
  });
});
