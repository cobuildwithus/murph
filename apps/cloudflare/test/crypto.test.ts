import { describe, expect, it } from "vitest";

import {
  buildHostedAssistantDeliveryPreparedRecord,
  mapHostedExecutionBundleSlots,
} from "@murphai/hosted-execution";
import {
  createHostedArtifactStore,
  createHostedBundleStore,
  createHostedUserEnvStore,
} from "../src/bundle-store.js";
import { createHostedExecutionJournalStore } from "../src/execution-journal.js";
import { writeHostedEmailRawMessage } from "../src/hosted-email.js";
import { createHostedExecutionSideEffectJournalStore } from "../src/outbox-delivery-journal.js";
import {
  encryptHostedBundle,
  readEncryptedR2Payload,
} from "../src/crypto.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers";

describe("readEncryptedR2Payload", () => {
  it("reads older envelopes without rewriting them on read", async () => {
    const previousKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const nextKey = Uint8Array.from({ length: 32 }, () => 7);
    const plaintext = new TextEncoder().encode("{\"ok\":true}");
    const envelope = await encryptHostedBundle({
      key: previousKey,
      keyId: "v1",
      plaintext,
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
    })).resolves.toEqual(plaintext);
    expect(putAttempts).toBe(0);
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
    expect(bundleRef.key).not.toContain(bundleRef.hash);

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
    const artifactKey = [...bucket.objects.keys()].find((key) => key.endsWith(".artifact.bin"));
    expect(artifactKey).toBeTruthy();
    const storedArtifactKey = artifactKey ?? "";
    expect(storedArtifactKey).not.toContain("user_artifact_123");
    expect(storedArtifactKey).not.toContain(artifactSha);

    const userEnvStore = createHostedUserEnvStore({
      bucket,
      key: rootKey,
      keyId,
    });
    await userEnvStore.writeUserEnv(
      "user_env_123",
      new TextEncoder().encode('{"OPENAI_API_KEY":"secret"}'),
    );
    const userEnvKey = [...bucket.objects.keys()].find((key) => key.startsWith("users/env/"));
    expect(userEnvKey).toBeTruthy();
    const storedUserEnvKey = userEnvKey ?? "";
    expect(storedUserEnvKey).not.toContain("user_env_123");

    const journalStore = createHostedExecutionJournalStore({
      bucket,
      key: rootKey,
      keyId,
    });
    await journalStore.writeCommittedResult("user_journal_123", "evt_journal_1", {
      bundleRefs: mapHostedExecutionBundleSlots(() => null),
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
    const journalKey = [...bucket.objects.keys()].find((key) =>
      key.startsWith("transient/execution-journal/"),
    );
    expect(journalKey).toBeTruthy();
    const storedJournalKey = journalKey ?? "";
    expect(storedJournalKey).not.toContain("user_journal_123");
    expect(storedJournalKey).not.toContain("evt_journal_1");

    const sideEffectStore = createHostedExecutionSideEffectJournalStore({
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
    const sideEffectKey = [...bucket.objects.keys()].find((key) =>
      key.startsWith("transient/side-effects/"),
    );
    expect(sideEffectKey).toBeTruthy();
    const storedSideEffectKey = sideEffectKey ?? "";
    expect(storedSideEffectKey).not.toContain("user_side_effect_123");
    expect(storedSideEffectKey).not.toContain("effect_1");

    const rawMessageKey = await writeHostedEmailRawMessage({
      bucket,
      key: rootKey,
      keyId,
      plaintext: new TextEncoder().encode("From: hi@example.com\n\nHello"),
      userId: "user_email_123",
    });
    const emailKey = [...bucket.objects.keys()].find((key) =>
      key.startsWith("transient/hosted-email/messages/"),
    );
    expect(emailKey).toBeTruthy();
    const storedEmailKey = emailKey ?? "";
    expect(storedEmailKey).not.toContain("user_email_123");
    expect(storedEmailKey).not.toContain(rawMessageKey);
  });
});
