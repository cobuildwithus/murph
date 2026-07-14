import { describe, expect, it } from "vitest";

import {
  createHostedMealPhotoStore,
  HOSTED_MEAL_PHOTO_MAX_BYTES,
} from "../src/meal-photo-store.ts";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.ts";

describe("hosted meal photo store", () => {
  it("round-trips ingress-encrypted JPEGs with attempt-owned keys", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedMealPhotoStore({
      bucket,
      rootKey: createTestRootKey(71),
      rootKeyId: "ingress-root-current",
      userId: "user_123",
    });
    const bytes = createJpegBytes(1);
    const sha256 = await sha256Hex(bytes);

    const first = await store.stageMealPhoto({
      bytes,
      captureId: "c".repeat(64),
      sha256,
    });
    const retry = await store.stageMealPhoto({
      bytes,
      captureId: "c".repeat(64),
      sha256,
    });
    const distinctCapture = await store.stageMealPhoto({
      bytes,
      captureId: "d".repeat(64),
      sha256,
    });

    expect(first).toEqual({
      byteLength: bytes.byteLength,
      mealPhotoKey: expect.stringMatching(/^[a-f0-9]{40}$/u),
      sha256,
    });
    expect(retry).toMatchObject({
      byteLength: bytes.byteLength,
      mealPhotoKey: expect.stringMatching(/^[a-f0-9]{40}$/u),
      sha256,
    });
    expect(retry.mealPhotoKey).not.toBe(first.mealPhotoKey);
    expect(distinctCapture.mealPhotoKey).not.toBe(first.mealPhotoKey);
    expect(bucket.objects.size).toBe(3);
    const objectKeys = [...bucket.objects.keys()];
    expect(objectKeys).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^hosted-meal-photos\/images\/hsn_[a-f0-9]{24}\/[a-f0-9]{48}\.jpg\.enc$/u,
        ),
      ]),
    );
    expect(JSON.stringify([...bucket.objects])).not.toContain("c".repeat(64));
    expect(JSON.stringify([...bucket.objects])).not.toContain("user_123");

    await expect(store.readMealPhoto(first.mealPhotoKey)).resolves.toEqual(bytes);
    await store.deleteMealPhoto(first.mealPhotoKey);
    await store.deleteMealPhoto(first.mealPhotoKey);
    await expect(store.readMealPhoto(first.mealPhotoKey)).resolves.toBeNull();
    await expect(store.readMealPhoto(retry.mealPhotoKey)).resolves.toEqual(bytes);
    await expect(store.readMealPhoto(distinctCapture.mealPhotoKey)).resolves.toEqual(bytes);
  });

  it("keeps meal-photo ownership bound to the user storage namespace", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(72);
    const ownerStore = createHostedMealPhotoStore({
      bucket,
      rootKey,
      rootKeyId: "ingress-root-current",
      userId: "user_owner",
    });
    const foreignStore = createHostedMealPhotoStore({
      bucket,
      rootKey,
      rootKeyId: "ingress-root-current",
      userId: "user_foreign",
    });
    const bytes = createJpegBytes(2);
    const staged = await ownerStore.stageMealPhoto({
      bytes,
      captureId: "c".repeat(64),
      sha256: await sha256Hex(bytes),
    });

    await expect(foreignStore.readMealPhoto(staged.mealPhotoKey)).resolves.toBeNull();
    await foreignStore.deleteMealPhoto(staged.mealPhotoKey);
    await expect(ownerStore.readMealPhoto(staged.mealPhotoKey)).resolves.toEqual(bytes);
  });

  it("rejects oversized, malformed, and hash-mismatched payloads before R2 writes", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedMealPhotoStore({
      bucket,
      rootKey: createTestRootKey(73),
      rootKeyId: "ingress-root-current",
      userId: "user_123",
    });

    await expect(store.stageMealPhoto({
      bytes: new Uint8Array(HOSTED_MEAL_PHOTO_MAX_BYTES + 1),
      captureId: "c".repeat(64),
      sha256: "0".repeat(64),
    })).rejects.toThrow("Hosted meal photo must contain between 1");
    await expect(store.stageMealPhoto({
      bytes: Uint8Array.from([0x01, 0x02, 0x03, 0x04]),
      captureId: "c".repeat(64),
      sha256: "0".repeat(64),
    })).rejects.toThrow("Hosted meal photo must be a complete JPEG image.");
    await expect(store.stageMealPhoto({
      bytes: createJpegBytes(3),
      captureId: "c".repeat(64),
      sha256: "0".repeat(64),
    })).rejects.toThrow("Hosted meal photo sha256 must match the JPEG bytes.");
    expect(bucket.objects.size).toBe(0);
  });
});

function createJpegBytes(seed: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, seed, seed + 1, 0xff, 0xd9]);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
