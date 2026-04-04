import { describe, expect, it } from "vitest";

import { mapHostedExecutionBundleSlots } from "@murphai/hosted-execution";

import {
  createHostedArtifactStore,
  createHostedUserEnvStore,
} from "../src/bundle-store.js";
import { createHostedDispatchPayloadStore } from "../src/dispatch-payload-store.js";
import { createHostedExecutionJournalStore } from "../src/execution-journal.js";
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

  it("keeps per-user artifacts readable and deletable across bundle-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(11);
    const nextKey = createTestRootKey(12);
    const userId = "user_live_artifact";
    const plaintext = new TextEncoder().encode("artifact payload");
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        plaintext.buffer.slice(
          plaintext.byteOffset,
          plaintext.byteOffset + plaintext.byteLength,
        ) as ArrayBuffer,
      ),
    );
    const sha256 = [...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    await createHostedArtifactStore({
      bucket,
      key: oldKey,
      keyId: "old",
      keysById: { old: oldKey },
      userId,
    }).writeArtifact(sha256, plaintext);

    const rotatedStore = createHostedArtifactStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
      userId,
    });

    expect(await rotatedStore.readArtifact(sha256)).toEqual(plaintext);
    await rotatedStore.deleteArtifact(sha256);
    expect(await rotatedStore.readArtifact(sha256)).toBeNull();
    expect(bucket.deleted.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps execution journals readable and deletable across bundle-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(13);
    const nextKey = createTestRootKey(14);
    const userId = "user_live_journal";
    const eventId = "evt_rotate_123";

    await createHostedExecutionJournalStore({
      bucket,
      key: oldKey,
      keyId: "old",
      keysById: { old: oldKey },
    }).writeCommittedResult(userId, eventId, {
      bundleRefs: mapHostedExecutionBundleSlots(() => null),
      committedAt: "2026-04-04T00:00:00.000Z",
      eventId,
      finalizedAt: null,
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      sideEffects: [],
      userId,
    });

    const rotatedStore = createHostedExecutionJournalStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
    });

    expect(await rotatedStore.readCommittedResult(userId, eventId)).toMatchObject({
      eventId,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      userId,
    });
    await rotatedStore.deleteCommittedResult(userId, eventId);
    expect(await rotatedStore.readCommittedResult(userId, eventId)).toBeNull();
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
