import { describe, expect, it, vi } from "vitest";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
} from "../src/bundle-store.js";
import { buildHostedStorageAad } from "../src/crypto-context.js";
import { writeHostedEmailRawMessage } from "../src/hosted-email.js";
import { hostedRunnerSecretsObjectKey } from "../src/storage-paths.js";
import {
  encryptHostedStorageEnvelope,
  HostedEncryptedR2PayloadUnreadableError,
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
} from "../src/crypto.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";
import { expectOpaqueStrings, findStoredObjectKey } from "./object-key-assertions.js";

describe("readEncryptedR2Payload", () => {
  it("reads older envelopes without rewriting them on read", async () => {
    const previousKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const nextKey = Uint8Array.from({ length: 32 }, () => 7);
    const plaintext = new TextEncoder().encode("{\"ok\":true}");
    const envelope = await encryptHostedStorageEnvelope({
      key: previousKey,
      keyId: "v1",
      plaintext,
      scope: "bundle",
    });
    let putAttempts = 0;

    const payload = new TextEncoder().encode(JSON.stringify(envelope));
    const bucket = {
      async get() {
        return {
          async arrayBuffer() {
            return payload.buffer.slice(
              payload.byteOffset,
              payload.byteOffset + payload.byteLength,
            );
          },
        };
      },
      async put() {
        putAttempts += 1;
        throw new Error("simulated rewrite failure");
      },
    };

    await expect(readEncryptedR2Payload({
      bucket,
      cryptoKey: nextKey,
      cryptoKeysById: {
        v1: previousKey,
        v2: nextKey,
      },
      expectedKeyId: "v2",
      key: "users/member_123/bundle.json",
      scope: "bundle",
    })).resolves.toEqual(plaintext);
    expect(putAttempts).toBe(0);
  });

  it("fails closed when an envelope omits its storage scope", async () => {
    const key = createTestRootKey(13);
    const envelope = await encryptHostedStorageEnvelope({
      key,
      keyId: "k-current",
      plaintext: new TextEncoder().encode("{\"ok\":true}"),
      scope: "bundle",
    });
    const payload = new TextEncoder().encode(JSON.stringify({
      ...envelope,
      scope: undefined,
    }));

    const read = readEncryptedR2Payload({
      bucket: {
        async get() {
          return {
            async arrayBuffer() {
              return payload.buffer.slice(
                payload.byteOffset,
                payload.byteOffset + payload.byteLength,
              );
            },
          };
        },
        async put() {
          throw new Error("unexpected rewrite");
        },
      },
      callerLabel: "Hosted bundle envelope",
      cryptoKey: key,
      expectedKeyId: "k-current",
      key: "bundles/vault/test.bundle.json",
      scope: "bundle",
    });
    await expect(read).rejects.toBeInstanceOf(
      HostedEncryptedR2PayloadUnreadableError,
    );
    await expect(read).rejects.toThrow("Hosted encrypted R2 payload is unreadable.");
  });

  it.each([
    ["whitespace-only", " "],
    ["surrounding-whitespace", " udrk:runtime:previous-root "],
    ["unbounded", "k".repeat(257)],
    ["embedded-control", "udrk:runtime:\0bad"],
    ["nonportable", "udrk:runtime:résumé"],
  ])("rejects a %s stored key ID before historical-key lookup", async (_case, keyId) => {
    const key = createTestRootKey(19);
    const envelope = await encryptHostedStorageEnvelope({
      key,
      keyId: "udrk:runtime:current-root",
      plaintext: new TextEncoder().encode("{\"ok\":true}"),
      scope: "artifact",
    });
    const payload = new TextEncoder().encode(JSON.stringify({ ...envelope, keyId }));
    const resolveCryptoKeyById = vi.fn(async () => key);

    await expect(readEncryptedR2Payload({
      bucket: {
        async get() {
          return {
            async arrayBuffer() {
              return payload.buffer.slice(
                payload.byteOffset,
                payload.byteOffset + payload.byteLength,
              );
            },
          };
        },
        async put() {
          throw new Error("unexpected rewrite");
        },
      },
      cryptoKey: key,
      expectedKeyId: "udrk:runtime:current-root",
      key: "artifacts/test",
      resolveCryptoKeyById,
      scope: "artifact",
    })).rejects.toBeInstanceOf(HostedEncryptedR2PayloadUnreadableError);
    expect(resolveCryptoKeyById).not.toHaveBeenCalled();
  });

  it("fails closed when a stored payload is rebound without the expected AAD", async () => {
    const key = createTestRootKey(17);
    const aad = new TextEncoder().encode("expected-aad");
    const envelope = await encryptHostedStorageEnvelope({
      aad,
      key,
      keyId: "k-current",
      plaintext: new TextEncoder().encode("{\"ok\":true}"),
      scope: "bundle",
    });
    const payload = new TextEncoder().encode(JSON.stringify(envelope));

    await expect(readEncryptedR2Payload({
      aad: new TextEncoder().encode("different-aad"),
      bucket: {
        async get() {
          return {
            async arrayBuffer() {
              return payload.buffer.slice(
                payload.byteOffset,
                payload.byteOffset + payload.byteLength,
              );
            },
          };
        },
        async put() {
          throw new Error("unexpected rewrite");
        },
      },
      cryptoKey: key,
      expectedKeyId: "k-current",
      key: "bundles/vault/test.bundle.json",
      scope: "bundle",
    })).rejects.toBeInstanceOf(HostedEncryptedR2PayloadUnreadableError);
  });
});

describe("hosted storage object keys", () => {
  it("avoids raw bundle hashes, user ids, and transient identifiers in object keys", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(31);
    const keyId = "k-current";

    const bundleStore = createHostedBundleStore({
      bucket,
      key: rootKey,
      keyId,
      userId: "user_bundle_123",
    });
    const bundlePlaintext = new TextEncoder().encode("bundle-plaintext");
    const bundleRef = await bundleStore.writeBundle("vault", bundlePlaintext);

    expect(bundleRef.key).toMatch(/^users\/hsn_[0-9a-f]{24}\/bundles\/vault\//u);
    expectOpaqueStrings([bundleRef.key], ["user_bundle_123", bundleRef.hash]);

    const artifactStore = createHostedArtifactStore({
      bucket,
      key: rootKey,
      keyId,
      userId: "user_artifact_123",
    });
    const artifactPlaintext = new TextEncoder().encode("artifact-plaintext");
    const artifactDigest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        artifactPlaintext.buffer.slice(
          artifactPlaintext.byteOffset,
          artifactPlaintext.byteOffset + artifactPlaintext.byteLength,
        ) as ArrayBuffer,
      ),
    );
    const artifactSha = [...artifactDigest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await artifactStore.writeArtifact(artifactSha, artifactPlaintext);
    const storedArtifactKey = findStoredObjectKey(bucket, (key) => key.endsWith(".artifact.bin"));
    expectOpaqueStrings([storedArtifactKey], ["user_artifact_123", artifactSha]);

    const runnerSecretsUserId = "user_env_123";
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey({ userId: runnerSecretsUserId });
    await writeEncryptedR2Payload({
      aad: buildHostedStorageAad({
        key: runnerSecretsKey,
        purpose: "runner-secrets",
        userId: runnerSecretsUserId,
      }),
      bucket,
      cryptoKey: rootKey,
      key: runnerSecretsKey,
      keyId,
      plaintext: new TextEncoder().encode('{"OPENAI_API_KEY":"secret"}'),
      scope: "runner-secrets",
    });
    const storedRunnerSecretsKey = findStoredObjectKey(bucket, (key) =>
      /^users\/hsn_[0-9a-f]{24}\/runner-secrets\.json$/u.test(key)
    );
    expectOpaqueStrings([storedRunnerSecretsKey], [runnerSecretsUserId]);

    const rawMessageKey = await writeHostedEmailRawMessage({
      bucket,
      key: rootKey,
      keyId,
      plaintext: new TextEncoder().encode("From: hi@example.com\n\nHello"),
      userId: "user_email_123",
    });
    const storedEmailKey = findStoredObjectKey(bucket, (key) =>
      key.startsWith("hosted-email/messages/"),
    );
    expect(storedEmailKey).toMatch(
      /^hosted-email\/messages\/hsn_[0-9a-f]{24}\/[0-9a-f]{48}\.eml$/u,
    );
    expectOpaqueStrings([storedEmailKey], ["user_email_123", rawMessageKey]);
  });
});
