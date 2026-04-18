import { describe, expect, it } from "vitest";

import {
  createHostedArtifactStore,
  createHostedRunnerSecretsStore,
} from "../src/bundle-store.js";
import { buildHostedStorageAad } from "../src/crypto-context.js";
import { writeEncryptedR2Json, writeEncryptedR2Payload } from "../src/crypto.js";
import { createHostedExecutionJournalStore } from "../src/execution-journal.js";
import { readHostedEmailRawMessage, writeHostedEmailRawMessage } from "../src/hosted-email.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";
import { expectOpaqueStrings } from "./object-key-assertions.js";

describe("opaque storage path rotation", () => {
  it("ignores removed raw-path runner-secrets objects", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(3);
    const nextKey = createTestRootKey(4);
    const userId = "user_legacy_env";
    const objectKey = `users/${encodeURIComponent(userId)}/user-env.json`;
    const plaintext = new TextEncoder().encode(JSON.stringify({ OPENAI_API_KEY: "secret" }));

    await writeEncryptedR2Payload({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "runner-secrets",
        userId,
      }),
      bucket,
      cryptoKey: oldKey,
      key: objectKey,
      keyId: "old",
      plaintext,
      scope: "runner-secrets",
    });

    const store = createHostedRunnerSecretsStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
    });

    expect(await store.readRunnerSecrets(userId)).toBeNull();
    await store.clearRunnerSecrets(userId);
    expectOpaqueStrings(bucket.deleted, [objectKey]);
  });

  it("requires a rewrite before runner secrets survive platform root-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(5);
    const nextKey = createTestRootKey(6);
    const userId = "user_live_rotate";
    const plaintext = new TextEncoder().encode(JSON.stringify({ OPENAI_API_KEY: "secret" }));

    await createHostedRunnerSecretsStore({
      bucket,
      key: oldKey,
      keyId: "old",
      keysById: { old: oldKey },
    }).writeRunnerSecrets(userId, plaintext);

    const rotatedStore = createHostedRunnerSecretsStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
    });

    expect(await rotatedStore.readRunnerSecrets(userId)).toBeNull();

    await rotatedStore.clearRunnerSecrets(userId);
    expect(bucket.deleted).toHaveLength(1);
    expect(await createHostedRunnerSecretsStore({
      bucket,
      key: oldKey,
      keyId: "old",
      keysById: { next: nextKey, old: oldKey },
    }).readRunnerSecrets(userId)).toEqual(plaintext);
  });

  it("ignores removed raw-path per-user artifacts", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(9);
    const nextKey = createTestRootKey(10);
    const userId = "user_legacy_artifact";
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
    const objectKey = `users/${encodeURIComponent(userId)}/artifacts/${sha256}.artifact.bin`;

    await writeEncryptedR2Payload({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "artifact",
        sha256,
        userId,
      }),
      bucket,
      cryptoKey: oldKey,
      key: objectKey,
      keyId: "old",
      plaintext,
      scope: "artifact",
    });

    const store = createHostedArtifactStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
      userId,
    });

    expect(await store.readArtifact(sha256)).toBeNull();
    await store.deleteArtifact(sha256);
    expectOpaqueStrings(bucket.deleted, [objectKey]);
  });

  it("requires a rewrite before per-user artifacts survive platform root-key rotation", async () => {
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

    expect(await rotatedStore.readArtifact(sha256)).toBeNull();
    await rotatedStore.deleteArtifact(sha256);
    expect(await rotatedStore.readArtifact(sha256)).toBeNull();
    expect(bucket.deleted).toHaveLength(1);
    expect(await createHostedArtifactStore({
      bucket,
      key: oldKey,
      keyId: "old",
      keysById: { next: nextKey, old: oldKey },
      userId,
    }).readArtifact(sha256)).toEqual(plaintext);
  });

  it("ignores removed raw-path execution journals", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(15);
    const nextKey = createTestRootKey(16);
    const userId = "user_legacy_journal";
    const eventId = "evt_legacy_123";
    const objectKey = `transient/execution-journal/${encodeURIComponent(userId)}/${encodeURIComponent(eventId)}.json`;

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        eventId,
        key: objectKey,
        purpose: "execution-journal",
        userId,
      }),
      bucket,
      cryptoKey: oldKey,
      key: objectKey,
      keyId: "old",
      scope: "execution-journal",
      value: {
        assistantDeliveryEffects: [],
        bundleRef: null,
        committedAt: "2026-04-04T00:00:00.000Z",
        eventId,
        finalizedAt: null,
        gatewayProjectionSnapshot: null,
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
        userId,
      },
    });

    const store = createHostedExecutionJournalStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
    });

    expect(await store.readCommittedResult(userId, eventId)).toBeNull();
    await store.deleteCommittedResult(userId, eventId);
    expectOpaqueStrings(bucket.deleted, [objectKey]);
  });

  it("requires a rewrite before execution journals survive platform root-key rotation", async () => {
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
      assistantDeliveryEffects: [],
      bundleRef: null,
      committedAt: "2026-04-04T00:00:00.000Z",
      eventId,
      finalizedAt: null,
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      userId,
    });

    const rotatedStore = createHostedExecutionJournalStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
    });

    expect(await rotatedStore.readCommittedResult(userId, eventId)).toBeNull();
    await rotatedStore.deleteCommittedResult(userId, eventId);
    expect(await rotatedStore.readCommittedResult(userId, eventId)).toBeNull();
    expect(bucket.deleted).toHaveLength(1);
    expect(await createHostedExecutionJournalStore({
      bucket,
      key: oldKey,
      keyId: "old",
      keysById: { next: nextKey, old: oldKey },
    }).readCommittedResult(userId, eventId)).toMatchObject({
      eventId,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      userId,
    });
  });

  it("requires a rewrite before hosted raw email messages survive platform root-key rotation", async () => {
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
    })).toBeNull();
  });
});
