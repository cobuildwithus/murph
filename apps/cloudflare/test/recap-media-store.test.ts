import { hostedRecapMediaObjectKey, hostedProgressPicObjectKey } from '../src/storage-paths.ts';
import { purgeHostedRuntimeResource } from '../src/worker/route-handlers/runtime-resource-purge.ts';
import { describe, expect, it } from "vitest";
import { createRecapMediaStore, createProgressPicStore, requireRecapMediaEnvelope, requireProgressPicUpload, retireRecapMediaObject } from "../src/recap-media-store.ts";
import { recapMediaRoutes } from "../src/worker/route-handlers/recap-media.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";
import { readHostedExecutionEnvironment } from '../src/env.ts';
import type { WorkerRouteContext } from '../src/worker-routes/shared.ts';
import { createHostedExecutionTestEnv } from './hosted-execution-fixtures.ts';

class ConditionalBucket extends MemoryEncryptedR2Bucket {
  override async put(key: string, value: string, options?: { onlyIf?: unknown }): Promise<unknown> {
    if (options?.onlyIf && this.objects.has(key)) return null;
    return super.put(key, value);
  }
}
const id = `recap/${"a".repeat(32)}/scene-0.jpg`;
const envelope = JSON.stringify({ alg: "AES-256-GCM-HKDF-SHA256", ciphertext: "c3ludGhldGlj", domain: "control", iv: "AAAAAAAAAAAAAAAA",
  lane: "hosted-member-private-field", rootKeyId: "root-synthetic", schema: "murph.hosted-secure-box.v1", scope: "weekly-game" });

async function write(store: ReturnType<typeof createRecapMediaStore>, id: string, envelope: string, hash: string) {
  return store.write(id, id.startsWith("progress/") ? requireProgressPicUpload(envelope, hash)
    : { envelope: requireRecapMediaEnvelope(envelope, hash), hash });
}

describe("recap sealed storage", () => {
  it("elects one immutable byte identity, allowing identical retries", async () => {
    const bucket = new ConditionalBucket();
    const store = createRecapMediaStore({ bucket, userId: "synthetic-owner" });
    const outcomes = await Promise.allSettled([write(store, id, envelope, "a".repeat(64)), write(store, id, envelope, "b".repeat(64))]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await store.read(id)).toEqual({ envelope, hash: "a".repeat(64) });
    expect(await write(store, id, envelope, "a".repeat(64))).toMatchObject({ stored: true, created: false });
    expect([...bucket.objects.keys()][0]).not.toContain("synthetic-owner");
  });
  it("retirement before or after upload prevents late resurrection", async () => {
    for (const uploadFirst of [false, true]) {
      const bucket = new ConditionalBucket();
      const store = createRecapMediaStore({ bucket, userId: "synthetic-owner" });
      if (uploadFirst) await write(store, id, envelope, "a".repeat(64));
      await store.retire(id);
      await expect(write(store, id, envelope, "a".repeat(64))).rejects.toThrow("retired");
      expect(await store.read(id)).toBeNull();
      expect([...bucket.objects.values()]).toEqual(['{"version":1,"retired":true}']);
    }
  });
  it.each(['jpg', 'mp3', 'mp4'])('tombstones content-hash %s keys through the real purge path before and after upload', async extension => {
    const mediaId = `recap/${'b'.repeat(32)}/${'c'.repeat(64)}.${extension}`;
    const userId = 'synthetic-surviving-owner';
    for (const uploadFirst of [false, true]) {
      const bucket = new ConditionalBucket();
      const store = createRecapMediaStore({ bucket, userId });
      const objectKey = hostedRecapMediaObjectKey({ userId, mediaId });
      if (uploadFirst) await write(store, mediaId, envelope, 'c'.repeat(64));
      await purgeHostedRuntimeResource({ source: { BUNDLES: bucket }, userId, resource: { kind: 'game_recap', objectKey } });
      expect(bucket.objects.get(objectKey)).toBe('{"version":1,"retired":true}');
      expect(await store.read(mediaId)).toBeNull();
      await expect(write(store, mediaId, envelope, 'c'.repeat(64))).rejects.toThrow('retired');
      await expect(write(store, mediaId, envelope, 'd'.repeat(64))).rejects.toThrow('retired');
      await expect(purgeHostedRuntimeResource({ source: { BUNDLES: bucket }, userId: 'synthetic-other-owner', resource: { kind: 'game_recap', objectKey } })).rejects.toThrow();
    }
  });
  it("stores a recap video part under its content hash and refuses every other video key", async () => {
    const bucket = new ConditionalBucket();
    const store = createRecapMediaStore({ bucket, userId: "synthetic-owner" });
    const part = `recap/${"a".repeat(32)}/${"e".repeat(64)}.mp4`;
    expect(await write(store, part, envelope, "e".repeat(64))).toMatchObject({ stored: true, created: true });
    expect(await store.read(part)).toEqual({ envelope, hash: "e".repeat(64) });
    for (const key of [`recap/${"a".repeat(32)}/video-0.mp4`, `recap/${"a".repeat(32)}/video.mp4`, `recap/${"a".repeat(32)}/${"e".repeat(64)}.mov`, `recap/${"a".repeat(32)}/${"e".repeat(63)}.mp4`]) {
      await expect(write(store, key, envelope, "e".repeat(64))).rejects.toThrow();
    }
  });
  it("rejects plaintext, upload-family keys, oversized data and cross-owner retirement", async () => {
    const bucket = new ConditionalBucket();
    const store = createRecapMediaStore({ bucket, userId: "synthetic-owner" });
    await expect(write(store, id, "plain", "a".repeat(64))).rejects.toThrow();
    await expect(write(store, `game/synthetic/${"a".repeat(64)}.jpg`, envelope, "a".repeat(64))).rejects.toThrow();
    await expect(retireRecapMediaObject({ bucket, userId: "synthetic-owner", objectKey: "other/recap.json.enc" })).rejects.toThrow();
  });
  it("binds every storage route to authenticated Web and its owner", () => {
    for (const route of recapMediaRoutes) expect(route).toMatchObject({ authorization: "vercel-oidc", authorizeBeforeMethod: true, beforeMethod: expect.any(Function) });
  });
});


describe("Progress sealed storage", () => {
  const envelope = JSON.stringify({ alg: "AES-256-GCM-HKDF-SHA256", ciphertext: "c3ludGhldGlj", domain: "control", iv: "AAAAAAAAAAAAAAAA",
    lane: "hosted-member-private-field", rootKeyId: "root-synthetic", schema: "murph.hosted-secure-box.v1", scope: "game-progress" });
  const mediaId = `progress/${"c".repeat(32)}.jpg`;
  function context(bucket: ConditionalBucket, method: 'POST' | 'GET', boundUser: string, body: string | undefined): WorkerRouteContext {
    const request = new Request('https://runner.example.test/internal/users/member_ava/progress-pics/' + (method === 'POST' ? 'stage' : 'read'), {
      method, body, headers: { 'x-hosted-execution-user-id': boundUser, 'x-murph-recap-media-id': mediaId, 'x-murph-recap-hash': 'a'.repeat(64) },
    });
    const unused = { getByName() { throw new Error('Progress must not activate a runner.'); } };
    return { request, url: new URL(request.url), environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      env: { ...createHostedExecutionTestEnv(), BUNDLES: bucket, RUNNER_CONTAINER: unused, RUNNER_CONTAINER_SMOKE: unused } };
  }
  it('serves the dedicated HTTP contract only for the bound owner and Progress crypto scope', async () => {
    const bucket = new ConditionalBucket();
    const stage = recapMediaRoutes.find(route => route.name === 'progressPicStage')!;
    const read = recapMediaRoutes.find(route => route.name === 'progressPicRead')!;
    const params = { userId: 'member_ava' };
    for (const route of [stage, read]) {
      expect(route.beforeMethod!(context(bucket, 'GET', 'member_leo', undefined), params)).toMatchObject({ status: 401 });
      expect(route.beforeMethod!(context(bucket, 'GET', 'member_ava', undefined), params)).toBeNull();
    }
    expect((await stage.handle(context(bucket, 'POST', 'member_ava', JSON.stringify({ ...JSON.parse(envelope), scope: 'weekly-game' })), params)).status).toBe(400);
    expect(bucket.objects.size).toBe(0);
    expect((await stage.handle(context(bucket, 'POST', 'member_ava', envelope), params)).status).toBe(200);
    const response = await read.handle(context(bucket, 'GET', 'member_ava', undefined), params);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ envelope, hash: 'a'.repeat(64) });
  });
  it.each([false, true])("permanently retires before/after upload (%s)", async uploadFirst => {
    const bucket = new ConditionalBucket(), userId = "synthetic-owner";
    const store = createProgressPicStore({ bucket, userId });
    const objectKey = hostedProgressPicObjectKey({ userId, mediaId });
    if (uploadFirst) await write(store, mediaId, envelope, "a".repeat(64));
    await purgeHostedRuntimeResource({ source: { BUNDLES: bucket }, userId, resource: { kind: "game_progress_pic", objectKey } });
    await expect(write(store, mediaId, envelope, "a".repeat(64))).rejects.toThrow("retired");
    expect(await store.read(mediaId)).toBeNull();
    expect(bucket.objects.get(objectKey)).toBe('{"version":1,"retired":true}');
  });
  it("rejects a recap envelope on the Progress upload boundary", () => {
    const recap = JSON.stringify({ ...JSON.parse(envelope), scope: "weekly-game" });
    expect(() => requireProgressPicUpload(recap, "a".repeat(64))).toThrow("scope");
  });
  it("isolates owners and namespaces even when bytes are identical", async () => {
    const bucket = new ConditionalBucket();
    const owner = createProgressPicStore({ bucket, userId: "synthetic-owner" });
    const other = createProgressPicStore({ bucket, userId: "synthetic-other" });
    await write(owner, mediaId, envelope, "a".repeat(64));
    expect(await other.read(mediaId)).toBeNull();
    await expect(createRecapMediaStore({ bucket, userId: "synthetic-owner" }).read(mediaId)).rejects.toThrow();
    await expect(purgeHostedRuntimeResource({ source: { BUNDLES: bucket }, userId: "synthetic-other",
      resource: { kind: "game_progress_pic", objectKey: hostedProgressPicObjectKey({ userId: "synthetic-owner", mediaId }) } })).rejects.toThrow();
    expect(await owner.read(mediaId)).toEqual({ envelope, hash: "a".repeat(64) });
  });
});
