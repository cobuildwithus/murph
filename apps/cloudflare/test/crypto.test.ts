import { describe, expect, it } from "vitest";

import {
  buildHostedAssistantDeliveryPreparedRecord,
} from "@murphai/hosted-execution/side-effects";
import {
  createHostedArtifactStore,
  createHostedBundleStore,
  createHostedUserEnvStore,
} from "../src/bundle-store.js";
import { createHostedExecutionJournalStore } from "../src/execution-journal.js";
import { writeHostedEmailRawMessage } from "../src/hosted-email.js";
import { createHostedAssistantDeliveryJournalStore } from "../src/side-effect-journal.js";
import {
  encryptHostedBundle,
  readEncryptedR2Payload,
} from "../src/crypto.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";
import { expectOpaqueStrings, findStoredObjectKey } from "./object-key-assertions.js";

describe("readEncryptedR2Payload", () => {
  it("reads older envelopes without rewriting them on read", async () => {
    const previousKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const nextKey = Uint8Array.from({ length: 32 }, () => 7);
    const plaintext = new TextEncoder().encode("{\"ok\":true}");
    const envelope = await encryptHostedBundle({
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
    const envelope = await encryptHostedBundle({
      key,
      keyId: "k-current",
      plaintext: new TextEncoder().encode("{\"ok\":true}"),
      scope: "bundle",
    });
    const payload = new TextEncoder().encode(JSON.stringify({
      ...envelope,
      scope: undefined,
    }));

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
      expectedKeyId: "k-current",
      key: "bundles/vault/test.bundle.json",
      scope: "bundle",
    })).rejects.toThrow("Hosted bundle envelope scope mismatch");
  });

  it("fails closed when a stored payload is rebound without the expected AAD", async () => {
    const key = createTestRootKey(17);
    const aad = new TextEncoder().encode("expected-aad");
    const envelope = await encryptHostedBundle({
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
    })).rejects.toThrow();
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
    });
    const bundlePlaintext = new TextEncoder().encode("bundle-plaintext");
    const bundleRef = await bundleStore.writeBundle("vault", bundlePlaintext);

    expect(bundleRef.key).toMatch(/^bundles\/vault\//u);
    expectOpaqueStrings([bundleRef.key], [bundleRef.hash]);

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

    const userEnvStore = createHostedUserEnvStore({
      bucket,
      key: rootKey,
      keyId,
    });
    await userEnvStore.writeUserEnv(
      "user_env_123",
      new TextEncoder().encode('{"OPENAI_API_KEY":"secret"}'),
    );
    const storedUserEnvKey = findStoredObjectKey(bucket, (key) => key.startsWith("users/env/"));
    expectOpaqueStrings([storedUserEnvKey], ["user_env_123"]);

    const journalStore = createHostedExecutionJournalStore({
      bucket,
      key: rootKey,
      keyId,
    });
    await journalStore.writeCommittedResult("user_journal_123", "evt_journal_1", {
      assistantDeliveryEffects: [],
      bundleRef: null,
      committedAt: "2026-04-03T00:00:00.000Z",
      eventId: "evt_journal_1",
      finalizedAt: null,
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      sideEffects: [],
      userId: "user_journal_123",
    });
    const storedJournalKey = findStoredObjectKey(bucket, (key) =>
      key.startsWith("transient/execution-journal/"),
    );
    expectOpaqueStrings([storedJournalKey], ["user_journal_123", "evt_journal_1"]);

    const sideEffectStore = createHostedAssistantDeliveryJournalStore({
      bucket,
      key: rootKey,
      keyId,
    });
    await sideEffectStore.write({
      userId: "user_side_effect_123",
      record: buildHostedAssistantDeliveryPreparedRecord({
        dedupeKey: "fingerprint_1",
        intentId: "effect_1",
        recordedAt: "2026-04-03T00:00:00.000Z",
      }),
    });
    const storedSideEffectKey = findStoredObjectKey(bucket, (key) =>
      key.startsWith("transient/side-effects/"),
    );
    expectOpaqueStrings([storedSideEffectKey], ["user_side_effect_123", "effect_1"]);

    const rawMessageKey = await writeHostedEmailRawMessage({
      bucket,
      key: rootKey,
      keyId,
      plaintext: new TextEncoder().encode("From: hi@example.com\n\nHello"),
      userId: "user_email_123",
    });
    const storedEmailKey = findStoredObjectKey(bucket, (key) =>
      key.startsWith("transient/hosted-email/messages/"),
    );
    expectOpaqueStrings([storedEmailKey], ["user_email_123", rawMessageKey]);
  });
});
