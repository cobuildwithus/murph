import { hostedRecapMediaObjectKey } from '../src/storage-paths.ts';
import { purgeHostedRuntimeResource } from '../src/worker/route-handlers/runtime-resource-purge.ts';
import { describe, expect, it } from "vitest";
import { createRecapMediaStore, retireRecapMediaObject } from "../src/recap-media-store.ts";
import { recapMediaRoutes } from "../src/worker/route-handlers/recap-media.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

class ConditionalBucket extends MemoryEncryptedR2Bucket {
  override async put(key: string, value: string, options?: { onlyIf?: unknown }): Promise<unknown> {
    if (options?.onlyIf && this.objects.has(key)) return null;
    return super.put(key, value);
  }
}
const id = `recap/${"a".repeat(32)}/scene-0.jpg`;
const envelope = JSON.stringify({ alg: "AES-256-GCM-HKDF-SHA256", ciphertext: "c3ludGhldGlj", domain: "control", iv: "c3ludGhldGlj",
  lane: "hosted-member-private-field", rootKeyId: "root-synthetic", schema: "murph.hosted-secure-box.v1", scope: "weekly-game" });

describe("recap sealed storage", () => {
  it("elects one immutable byte identity, allowing identical retries", async () => {
    const bucket = new ConditionalBucket();
    const store = createRecapMediaStore({ bucket, userId: "synthetic-owner" });
    const outcomes = await Promise.allSettled([store.write(id, envelope, "a".repeat(64)), store.write(id, envelope, "b".repeat(64))]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await store.read(id)).toEqual({ envelope, hash: "a".repeat(64) });
    expect(await store.write(id, envelope, "a".repeat(64))).toMatchObject({ stored: true, created: false });
    expect([...bucket.objects.keys()][0]).not.toContain("synthetic-owner");
  });
  it("retirement before or after upload prevents late resurrection", async () => {
    for (const uploadFirst of [false, true]) {
      const bucket = new ConditionalBucket();
      const store = createRecapMediaStore({ bucket, userId: "synthetic-owner" });
      if (uploadFirst) await store.write(id, envelope, "a".repeat(64));
      await store.retire(id);
      await expect(store.write(id, envelope, "a".repeat(64))).rejects.toThrow("retired");
      expect(await store.read(id)).toBeNull();
      expect([...bucket.objects.values()]).toEqual(['{"version":1,"retired":true}']);
    }
  });
  it.each(['jpg', 'mp3'])('tombstones content-hash %s keys through the real purge path before and after upload', async extension => {
    const mediaId = `recap/${'b'.repeat(32)}/${'c'.repeat(64)}.${extension}`;
    const userId = 'synthetic-surviving-owner';
    for (const uploadFirst of [false, true]) {
      const bucket = new ConditionalBucket();
      const store = createRecapMediaStore({ bucket, userId });
      const objectKey = hostedRecapMediaObjectKey({ userId, mediaId });
      if (uploadFirst) await store.write(mediaId, envelope, 'c'.repeat(64));
      await purgeHostedRuntimeResource({ source: { BUNDLES: bucket }, userId, resource: { kind: 'game_recap', objectKey } });
      expect(bucket.objects.get(objectKey)).toBe('{"version":1,"retired":true}');
      expect(await store.read(mediaId)).toBeNull();
      await expect(store.write(mediaId, envelope, 'c'.repeat(64))).rejects.toThrow('retired');
      await expect(store.write(mediaId, envelope, 'd'.repeat(64))).rejects.toThrow('retired');
      await expect(purgeHostedRuntimeResource({ source: { BUNDLES: bucket }, userId: 'synthetic-other-owner', resource: { kind: 'game_recap', objectKey } })).rejects.toThrow();
    }
  });
  it("rejects plaintext, upload-family keys, oversized data and cross-owner retirement", async () => {
    const bucket = new ConditionalBucket();
    const store = createRecapMediaStore({ bucket, userId: "synthetic-owner" });
    await expect(store.write(id, "plain", "a".repeat(64))).rejects.toThrow();
    await expect(store.write(`game/synthetic/${"a".repeat(64)}.jpg`, envelope, "a".repeat(64))).rejects.toThrow();
    await expect(retireRecapMediaObject({ bucket, userId: "synthetic-owner", objectKey: "other/recap.json.enc" })).rejects.toThrow();
  });
  it("binds every storage route to authenticated Web and its owner", () => {
    for (const route of recapMediaRoutes) expect(route).toMatchObject({ authorization: "vercel-oidc", authorizeBeforeMethod: true, beforeMethod: expect.any(Function) });
  });
});
