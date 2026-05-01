import { describe, expect, it } from "vitest";

import {
  createHostedArtifactStore,
  createHostedRunnerSecretsReader,
} from "../src/bundle-store.js";
import { buildHostedStorageAad } from "../src/crypto-context.js";
import { writeEncryptedR2Json, writeEncryptedR2Payload } from "../src/crypto.js";
import { readHostedEmailRawMessage, writeHostedEmailRawMessage } from "../src/hosted-email.js";
import { hostedRunnerSecretsObjectKey } from "../src/storage-paths.js";

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

    const reader = createHostedRunnerSecretsReader({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
    });

    expect(await reader.readRunnerSecrets(userId)).toBeNull();
  });

  it("reads runner secrets across runtime root-key rotation when the old root remains in the keyring", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(5);
    const nextKey = createTestRootKey(6);
    const userId = "user_live_rotate";
    const plaintext = new TextEncoder().encode(JSON.stringify({ OPENAI_API_KEY: "secret" }));

    await writeRunnerSecretsObject({
      bucket,
      key: oldKey,
      keyId: "old",
      plaintext,
      userId,
    });

    const rotatedReader = createHostedRunnerSecretsReader({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
    });

    expect(await rotatedReader.readRunnerSecrets(userId)).toEqual(plaintext);
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
    expect(bucket.deleted).toHaveLength(1);
    expect(bucket.deleted[0]).not.toBe(objectKey);
    expectOpaqueStrings(bucket.deleted, [objectKey, userId, sha256]);
  });

  it("reads per-user artifacts across runtime root-key rotation when the old root remains in the keyring", async () => {
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
    expect(bucket.deleted).toHaveLength(1);
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

async function writeRunnerSecretsObject(input: {
  bucket: MemoryEncryptedR2Bucket;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  userId: string;
}): Promise<void> {
  const objectKey = await hostedRunnerSecretsObjectKey(input.key, input.userId);

  await writeEncryptedR2Payload({
    aad: buildHostedStorageAad({
      key: objectKey,
      purpose: "runner-secrets",
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    key: objectKey,
    keyId: input.keyId,
    plaintext: input.plaintext,
    scope: "runner-secrets",
  });
}
