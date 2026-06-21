import { describe, expect, it } from "vitest";

import {
  createHostedArtifactStore,
  createHostedRunnerSecretsReader,
} from "../src/bundle-store.js";
import { buildHostedStorageAad, deriveHostedStorageOpaqueId } from "../src/crypto-context.js";
import { writeEncryptedR2Json, writeEncryptedR2Payload } from "../src/crypto.js";
import {
  deleteHostedEmailRawMessage,
  readHostedEmailRawMessage,
  writeHostedEmailRawMessage,
} from "../src/hosted-email.js";
import { hostedRunnerSecretsObjectKey } from "../src/storage-paths.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";
import { expectOpaqueStrings, findStoredObjectKey } from "./object-key-assertions.js";

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

  it("reads hosted raw email messages across ingress root-key rotation by stored envelope key id", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(9);
    const nextKey = createTestRootKey(10);
    const userId = "user_live_email";
    const plaintext = new TextEncoder().encode("Subject: hi\n\nbody");
    const resolvedRootKeyIds: string[] = [];

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
      rawMessageKey,
      resolveKeyById: async (rootKeyId) => {
        resolvedRootKeyIds.push(rootKeyId);
        return rootKeyId === "old" ? oldKey : null;
      },
      userId,
    })).toEqual(plaintext);
    expect(resolvedRootKeyIds).toEqual(["old"]);
  });

  it("keeps hosted raw email message ids stable across ingress root-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(11);
    const nextKey = createTestRootKey(12);
    const userId = "user_live_email_retry";
    const plaintext = new TextEncoder().encode("Subject: retry\n\nbody");

    const oldRawMessageKey = await writeHostedEmailRawMessage({
      bucket,
      key: oldKey,
      keyId: "old",
      plaintext,
      userId,
    });
    const storedEmailKey = findStoredObjectKey(bucket, (key) =>
      key.startsWith("hosted-email/messages/"),
    );
    const nextRawMessageKey = await writeHostedEmailRawMessage({
      bucket,
      key: nextKey,
      keyId: "next",
      plaintext,
      userId,
    });

    expect(nextRawMessageKey).toBe(oldRawMessageKey);
    expect([...bucket.objects.keys()]).toEqual([storedEmailKey]);
  });

  it("deletes hosted raw email messages after ingress root-key rotation without root material", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(13);
    const nextKey = createTestRootKey(14);
    const userId = "user_live_email_delete";
    const plaintext = new TextEncoder().encode("Subject: bye\n\nbody");

    const rawMessageKey = await writeHostedEmailRawMessage({
      bucket,
      key: oldKey,
      keyId: "old",
      plaintext,
      userId,
    });
    const storedEmailKey = findStoredObjectKey(bucket, (key) =>
      key.startsWith("hosted-email/messages/"),
    );

    expect(storedEmailKey).toMatch(
      /^hosted-email\/messages\/hsn_[0-9a-f]{24}\/[0-9a-f]{48}\.eml$/u,
    );
    await deleteHostedEmailRawMessage({
      bucket,
      rawMessageKey,
      userId,
    });

    expect(bucket.objects.has(storedEmailKey)).toBe(false);
    expect(bucket.deleted).toEqual([
      storedEmailKey,
      storedEmailKey.replace(/\.eml$/u, ".recovery.json"),
    ]);
    expectOpaqueStrings(bucket.deleted, [userId, rawMessageKey]);
    expect(await readHostedEmailRawMessage({
      bucket,
      key: nextKey,
      keyId: "next",
      rawMessageKey,
      resolveKeyById: async (rootKeyId) => {
        return rootKeyId === "old" ? oldKey : null;
      },
      userId,
    })).toBeNull();
  });

  it("ignores removed root-derived hosted raw email object paths", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(15);
    const nextKey = createTestRootKey(16);
    const userId = "user_legacy_email";
    const plaintext = new TextEncoder().encode("Subject: legacy\n\nbody");
    const rawMessageKey = await legacyHostedEmailRawMessageKey({
      plaintext,
      rootKey: oldKey,
      userId,
    });
    const legacyObjectKey = await legacyHostedEmailRawMessageObjectKey({
      rawMessageKey,
      rootKey: oldKey,
      userId,
    });

    await writeEncryptedR2Payload({
      aad: buildHostedStorageAad({
        key: legacyObjectKey,
        purpose: "email-raw",
        rawMessageKey,
        userId,
      }),
      bucket,
      cryptoKey: oldKey,
      key: legacyObjectKey,
      keyId: "old",
      plaintext,
      scope: "email-raw",
    });

    expect(await readHostedEmailRawMessage({
      bucket,
      key: nextKey,
      keyId: "next",
      rawMessageKey,
      resolveKeyById: async (rootKeyId) => {
        return rootKeyId === "old" ? oldKey : null;
      },
      userId,
    })).toBeNull();
    await deleteHostedEmailRawMessage({
      bucket,
      rawMessageKey,
      userId,
    });
    expect(bucket.objects.has(legacyObjectKey)).toBe(true);
    expect(bucket.deleted).not.toContain(legacyObjectKey);
  });
});

async function legacyHostedEmailRawMessageKey(input: {
  plaintext: Uint8Array;
  rootKey: Uint8Array;
  userId: string;
}): Promise<string> {
  const plaintextHash = await sha256Hex(input.plaintext);

  return await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey: input.rootKey,
    scope: "email-raw-id",
    value: `message:${input.userId}:${plaintextHash}`,
  });
}

async function legacyHostedEmailRawMessageObjectKey(input: {
  rawMessageKey: string;
  rootKey: Uint8Array;
  userId: string;
}): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey: input.rootKey,
    scope: "email-raw",
    value: `user:${input.userId}`,
  });
  const messageSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey: input.rootKey,
    scope: "email-raw",
    value: `message:${input.userId}:${input.rawMessageKey}`,
  });

  return `hosted-email/messages/${userSegment}/${messageSegment}.eml`;
}

async function writeRunnerSecretsObject(input: {
  bucket: MemoryEncryptedR2Bucket;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  userId: string;
}): Promise<void> {
  const objectKey = await hostedRunnerSecretsObjectKey({ userId: input.userId });

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

async function sha256Hex(input: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      input.buffer.slice(
        input.byteOffset,
        input.byteOffset + input.byteLength,
      ) as ArrayBuffer,
    ),
  );

  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
