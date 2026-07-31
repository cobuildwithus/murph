import { describe, expect, it } from "vitest";

import {
  createHostedEnvironmentVoiceStore,
  HOSTED_ENVIRONMENT_VOICE_MAX_BYTES,
} from "../src/environment-voice-store.ts";
import { createTestRootKey, MemoryEncryptedR2Bucket } from "./test-helpers.ts";

describe("hosted environment voice store", () => {
  it("round-trips application-encrypted audio with attempt-owned opaque keys", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedEnvironmentVoiceStore({
      bucket,
      rootKey: createTestRootKey(91),
      rootKeyId: "ingress-root-current",
      userId: "user_123",
    });
    const bytes = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
    const sha256 = await sha256Hex(bytes);

    const first = await store.stageAudio({
      bytes,
      captureId: sha256,
      sha256,
    });
    const retry = await store.stageAudio({
      bytes,
      captureId: sha256,
      sha256,
    });

    expect(first).toEqual({
      audioKey: expect.stringMatching(/^[a-f0-9]{40}$/u),
      byteLength: bytes.byteLength,
      sha256,
    });
    expect(retry.audioKey).not.toBe(first.audioKey);
    expect(JSON.stringify([...bucket.objects])).not.toContain("user_123");
    expect([...bucket.objects.keys()][0]).toMatch(
      /^hosted-environment-voice\/audio\/hsn_[a-f0-9]{24}\/[a-f0-9]{48}\.audio\.enc$/u,
    );
    expect([...bucket.objects.values()][0]).toContain(
      '"scope":"environment-voice"',
    );

    await expect(store.readAudio(first.audioKey)).resolves.toEqual(bytes);
    await store.deleteAudio(first.audioKey);
    await store.deleteAudio(first.audioKey);
    await expect(store.readAudio(first.audioKey)).resolves.toBeNull();
    await expect(store.readAudio(retry.audioKey)).resolves.toEqual(bytes);
  });

  it("binds ownership to the user's storage namespace", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(92);
    const owner = createHostedEnvironmentVoiceStore({
      bucket,
      rootKey,
      rootKeyId: "ingress-root-current",
      userId: "user_owner",
    });
    const foreign = createHostedEnvironmentVoiceStore({
      bucket,
      rootKey,
      rootKeyId: "ingress-root-current",
      userId: "user_foreign",
    });
    const bytes = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 1]);
    const sha256 = await sha256Hex(bytes);
    const staged = await owner.stageAudio({
      bytes,
      captureId: sha256,
      sha256,
    });

    await expect(foreign.readAudio(staged.audioKey)).resolves.toBeNull();
    await foreign.deleteAudio(staged.audioKey);
    await expect(owner.readAudio(staged.audioKey)).resolves.toEqual(bytes);
  });

  it("rejects empty, oversized, and hash-mismatched bytes before R2 writes", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedEnvironmentVoiceStore({
      bucket,
      rootKey: createTestRootKey(93),
      rootKeyId: "ingress-root-current",
      userId: "user_123",
    });

    for (const bytes of [
      new Uint8Array(),
      new Uint8Array(HOSTED_ENVIRONMENT_VOICE_MAX_BYTES + 1),
    ]) {
      await expect(store.stageAudio({
        bytes,
        captureId: "c".repeat(64),
        sha256: "0".repeat(64),
      })).rejects.toThrow(/must contain between 1/u);
    }
    await expect(store.stageAudio({
      bytes: Uint8Array.from([1, 2, 3]),
      captureId: "c".repeat(64),
      sha256: "0".repeat(64),
    })).rejects.toThrow(/sha256 must match/u);
    expect(bucket.objects.size).toBe(0);
  });
});

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copy.buffer),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
