import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGameImageStore, deleteGameImagesForUser, type GameImagesBinding } from "../src/game-image-store.ts";
import { gameImageRoutes } from "../src/worker/route-handlers/game-images.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import type { WorkerRouteContext } from "../src/worker-routes/shared.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const deploymentOrigin = "https://runner.example.test";
const bytes = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
const mediaId = `${createHash("sha256").update(bytes).digest("hex")}.jpg`;

class IndexBucket extends MemoryEncryptedR2Bucket {
  async list({ prefix = "", limit = 1000 }: { prefix?: string; limit?: number }) {
    const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix));
    return { objects: keys.slice(0, limit).map(key => ({ key })), truncated: keys.length > limit };
  }
  override async put(key: string, value: string, options?: { onlyIf?: unknown }): Promise<void> {
    if (options?.onlyIf && this.objects.has(key)) return;
    return super.put(key, value);
  }
}

function provider() {
  const stored = new Map<string, { creator: string }>();
  const info = vi.fn<GameImagesBinding["info"]>(async () => ({ format: "image/jpeg", width: 1280, height: 720 }));
  const sign = vi.fn(async () => "https://imagedelivery.net/account/image/game-photo?exp=9999999999&sig=synthetic");
  const deleted = vi.fn(async (id: string) => stored.delete(id));
  const upload = vi.fn(async (_bytes: ArrayBuffer, options: { creator: string; requireSignedURLs: true }) => {
    const id = randomUUID();
    stored.set(id, { creator: options.creator });
    return { id, requireSignedURLs: Boolean(options.requireSignedURLs) };
  });
  const images: GameImagesBinding = { info, hosted: {
    upload,
    image: (id) => ({ delete: () => deleted(id), signedUrl: sign }),
    list: async ({ creator, limit }) => {
      const all = [...stored].filter(([, value]) => value.creator === creator);
      return { images: all.slice(0, limit).map(([id, value]) => ({ id, creator: value.creator })), listComplete: all.length <= limit };
    },
  } };
  return { images, info, upload, sign, deleted, stored };
}

describe("private game Images", () => {
  it.each([
    ["invalid image", Object.assign(new Error("synthetic private provider detail"), { code: 9412 }), "content is invalid"],
    ["inspection outage", new Error("synthetic private provider detail"), "inspection failed"],
  ])("keeps %s failures outside upload admission so account deletion can finish", async (_label, error, message) => {
    const bucket = new IndexBucket(), p = provider();
    p.info.mockRejectedValueOnce(error);
    const store = createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" });
    await expect(store.upload(mediaId, bytes)).rejects.toThrow(message);
    expect(p.upload).not.toHaveBeenCalled();
    expect(bucket.objects.size).toBe(0);
    await expect(deleteGameImagesForUser(p.images, "member_leo", bucket, deploymentOrigin)).resolves.toBeUndefined();
  });

  it.each([
    { format: "image/svg+xml" },
    { format: "image/gif", width: 1280, height: 720 },
    { format: "image/heic", width: 1280, height: 720 },
    { format: "image/jpeg", width: 12_001, height: 1 },
    { format: "image/jpeg", width: 11_000, height: 11_000 },
    { format: "image/jpeg", width: 0, height: 720 },
    { format: "image/jpeg", width: 1280.5, height: 720 },
  ])("rejects unsupported or oversized raster metadata before admitting uploads: %j", async (info) => {
    const bucket = new IndexBucket(), p = provider();
    p.info.mockResolvedValueOnce(info);
    await expect(createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" }).upload(mediaId, bytes))
      .rejects.toThrow("content is invalid");
    expect(p.upload).not.toHaveBeenCalled();
    expect(bucket.objects.size).toBe(0);
  });

  it("accepts HEIC raster inspection without changing its content address", async () => {
    const bucket = new IndexBucket(), p = provider();
    p.info.mockResolvedValueOnce({ format: "image/heic", width: 4032, height: 3024 });
    const store = createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" });
    await store.upload(mediaId.replace(".jpg", ".heic"), bytes);
    expect(p.upload).toHaveBeenCalledExactlyOnceWith(bytes.buffer, expect.objectContaining({ filename: "game.heic" }));
    expect(await new Response(p.info.mock.calls[0]![0]).arrayBuffer()).toEqual(bytes.buffer);
  });

  it("fences an upload whose inspection finishes after account deletion", async () => {
    const bucket = new IndexBucket(), p = provider();
    let release!: () => void, started!: () => void;
    const inspecting = new Promise<void>(resolve => { started = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    p.info.mockImplementationOnce(async () => {
      started(); await barrier;
      return { format: "image/jpeg", width: 1280, height: 720 };
    });
    const uploading = createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" }).upload(mediaId, bytes);
    await inspecting;
    await deleteGameImagesForUser(p.images, "member_leo", bucket, deploymentOrigin);
    release();
    await expect(uploading).rejects.toThrow("owner was deleted");
    expect(p.upload).not.toHaveBeenCalled();
    expect([...bucket.objects.keys()].some(key => key.startsWith("game-image-uploads/"))).toBe(false);
  });

  it.each(["", "not-an-origin", "file:///tmp", "https://user:password@runner.example.test"])("rejects invalid deployment scope %s before storage", (origin) => {
    const bucket = new IndexBucket(), p = provider();
    expect(() => createGameImageStore({ deploymentOrigin: origin, bucket, images: p.images, userId: "member_leo" }))
      .toThrow("deployment origin is invalid");
    expect(bucket.objects.size).toBe(0);
  });

  it("keeps only opaque provider pointers in R2 and signs a fixed variant for five minutes", async () => {
    const bucket = new IndexBucket(), p = provider();
    const store = createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" });
    await store.upload(mediaId, bytes);
    await store.upload(mediaId, bytes);
    expect(p.upload).toHaveBeenCalledTimes(1);
    expect(p.upload.mock.calls[0]?.[1]).toMatchObject({ requireSignedURLs: true });
    expect(p.upload.mock.calls[0]?.[1].creator).not.toContain("member_leo");
    const [pointer] = [...bucket.objects.values()];
    expect(JSON.parse(pointer!)).toEqual({ schema: "murph.game-image.v1", imageId: expect.any(String), byteLength: bytes.length });
    expect(pointer).not.toContain("sig=");
    await expect(store.stat(mediaId)).resolves.toEqual({ byteLength: bytes.length });
    await expect(store.delivery(mediaId, "avatar")).resolves.toMatchObject({ url: expect.stringContaining("imagedelivery.net") });
    expect(p.sign).toHaveBeenCalledWith({ variant: "game-avatar", expiresIn: 300 });
    await store.delivery(mediaId, "photo");
    expect(p.sign).toHaveBeenLastCalledWith({ variant: "game-photo", expiresIn: 300 });
  });

  it("elects one provider image for concurrent upload retries and deletes the loser", async () => {
    const bucket = new IndexBucket(), p = provider();
    const store = createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" });
    // Hold both requests inside the provider so neither sees a completed pointer.
    const original = p.upload.getMockImplementation()!;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    p.upload.mockImplementation(async (...args) => {
      if (p.upload.mock.calls.length === 2) release();
      await barrier;
      return original(...args);
    });
    await Promise.all([store.upload(mediaId, bytes), store.upload(mediaId, bytes)]);
    expect(p.upload).toHaveBeenCalledTimes(2);
    expect(p.stored.size).toBe(1);
    expect(p.deleted).toHaveBeenCalledTimes(1);
    const pointer = JSON.parse([...bucket.objects.values()][0]!);
    expect(p.stored.has(pointer.imageId)).toBe(true);
  });

  it("rejects a mismatched content hash and never finds another owner's pointer", async () => {
    const bucket = new IndexBucket(), p = provider();
    const leo = createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" });
    await expect(leo.upload(mediaId, new Uint8Array([1]))).rejects.toThrow("content key");
    expect(p.upload).not.toHaveBeenCalled();
    await leo.upload(mediaId, bytes);
    const ava = createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_ava" });
    await expect(ava.stat(mediaId)).resolves.toBeNull();
    await expect(ava.delivery(mediaId, "photo")).resolves.toBeNull();
    expect(p.sign).not.toHaveBeenCalled();
  });

  it("deletes an upload when the provider does not confirm private access", async () => {
    const p = provider();
    p.upload.mockResolvedValueOnce({ id: randomUUID(), requireSignedURLs: false });
    const bucket = new IndexBucket();
    await expect(createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" }).upload(mediaId, bytes))
      .rejects.toThrow("privacy");
    expect(p.deleted).toHaveBeenCalledTimes(1);
    expect(bucket.objects.size).toBe(0);
  });

  it("rejects unsigned URLs and unexpected delivery origins", async () => {
    const p = provider(), bucket = new IndexBucket();
    const store = createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" });
    await store.upload(mediaId, bytes);
    for (const url of ["https://imagedelivery.net/account/id/photo", "https://other.example.test/image?sig=x&exp=1"]) {
      p.sign.mockResolvedValueOnce(url);
      await expect(store.delivery(mediaId, "photo")).rejects.toThrow("delivery URL");
    }
  });

  it("account deletion removes referenced and orphaned images, preserving other members", async () => {
    const p = provider(), bucket = new IndexBucket();
    await createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" }).upload(mediaId, bytes);
    const creator = p.upload.mock.calls[0]![1].creator;
    p.stored.set(randomUUID(), { creator });
    await createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_ava" }).upload(mediaId, bytes);
    await deleteGameImagesForUser(p.images, "member_leo", bucket, deploymentOrigin);
    expect(p.stored.size).toBe(1);
    expect([...p.stored.values()][0]?.creator).not.toBe(creator);
    await expect(deleteGameImagesForUser(undefined, "member_leo", bucket, deploymentOrigin)).rejects.toThrow("unavailable");
  });

  it("isolates account-wide Images deletion between deployment origins", async () => {
    const p = provider(), productionBucket = new IndexBucket(), previewBucket = new IndexBucket();
    const production = createGameImageStore({ deploymentOrigin, bucket: productionBucket,
      images: p.images, userId: "member_leo" });
    const previewOrigin = "https://preview.example.test";
    const preview = createGameImageStore({ deploymentOrigin: previewOrigin, bucket: previewBucket,
      images: p.images, userId: "member_leo" });
    await production.upload(mediaId, bytes);
    await preview.upload(mediaId, bytes);
    const productionCreator = p.upload.mock.calls[0]![1].creator;
    expect(p.upload.mock.calls[1]![1].creator).not.toBe(productionCreator);
    await deleteGameImagesForUser(p.images, "member_leo", previewBucket, previewOrigin);
    expect([...p.stored.values()]).toEqual([{ creator: productionCreator }]);
    await expect(production.delivery(mediaId, "photo")).resolves.not.toBeNull();
    // A different deployment's fence must not reject production uploads.
    const otherBytes = Uint8Array.from([...bytes.slice(0, -1), 9]);
    const otherMediaId = `${createHash("sha256").update(otherBytes).digest("hex")}.jpg`;
    await production.upload(otherMediaId, otherBytes);
    expect(p.stored.size).toBe(2);
  });

  it("drains an admitted upload before deletion and rejects delayed uploads afterwards", async () => {
    const p = provider(), bucket = new IndexBucket();
    const original = p.upload.getMockImplementation()!;
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    p.upload.mockImplementation(async (...args) => { started(); await barrier; return original(...args); });
    const store = createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" });
    const uploading = store.upload(mediaId, bytes);
    await entered;
    await expect(deleteGameImagesForUser(p.images, "member_leo", bucket, deploymentOrigin)).rejects.toThrow("not drained");
    release(); await uploading;
    await deleteGameImagesForUser(p.images, "member_leo", bucket, deploymentOrigin);
    expect(p.stored.size).toBe(0);
    // Simulate the subsequent ordinary account R2 pointer cleanup.
    for (const key of bucket.objects.keys()) if (key.endsWith(".image.json")) await bucket.delete(key);
    await expect(store.upload(mediaId, bytes)).rejects.toThrow("owner was deleted");
    expect(p.upload).toHaveBeenCalledTimes(1);
  });

  it("retains an ambiguous upload receipt so deletion cannot silently skip it", async () => {
    const p = provider(), bucket = new IndexBucket();
    p.upload.mockRejectedValueOnce(new Error("synthetic lost response"));
    await expect(createGameImageStore({ deploymentOrigin, bucket, images: p.images, userId: "member_leo" }).upload(mediaId, bytes)).rejects.toThrow();
    await expect(deleteGameImagesForUser(p.images, "member_leo", bucket, deploymentOrigin)).rejects.toThrow("not drained");
  });

  it("composes stage, stat and private delivery through the bound Worker routes", async () => {
    const p = provider(), bucket = new IndexBucket();
    const configured = createHostedExecutionTestEnv();
    const unused = { getByName() { throw new Error("Unexpected runtime access"); } };
    async function call(name: string, options: { body?: Uint8Array; variant?: string; owner?: string } = {}) {
      const route = gameImageRoutes.find(candidate => candidate.name === name)!;
      const headers = new Headers({ "x-murph-game-media-id": mediaId, "x-hosted-execution-user-id": options.owner ?? "member_leo",
        "content-type": "image/jpeg", "x-murph-image-variant": options.variant ?? "avatar" });
      const request = new Request("https://runner.example.test/internal/users/member_leo/game-images/stage", {
        method: options.body ? "POST" : "GET", headers, ...(options.body ? { body: new Uint8Array(options.body) } : {}),
      });
      const context: WorkerRouteContext = { request, url: new URL(request.url), environment: readHostedExecutionEnvironment(configured),
        env: { ...configured, CF_PUBLIC_BASE_URL: deploymentOrigin, BUNDLES: bucket, GAME_IMAGES: p.images, RUNNER_CONTAINER: unused, RUNNER_CONTAINER_SMOKE: unused } };
      const denied = await route.beforeMethod?.(context, { userId: "member_leo" });
      return denied ?? await route.handle(context, { userId: "member_leo" });
    }
    expect((await call("gameImageStage", { body: bytes, owner: "member_ava" })).status).toBe(401);
    expect(p.upload).not.toHaveBeenCalled();
    expect((await call("gameImageStage", { body: bytes })).status).toBe(200);
    expect(await (await call("gameImageStat")).json()).toEqual({ byteLength: bytes.length });
    expect((await call("gameImageDelivery", { variant: "public" })).status).toBe(400);
    const delivered = await call("gameImageDelivery");
    expect(delivered.headers.get("cache-control")).toBe("private, no-store");
    expect(await delivered.json()).toMatchObject({ url: expect.stringContaining("sig=") });
    expect(p.sign).toHaveBeenCalledExactlyOnceWith({ variant: "game-avatar", expiresIn: 300 });
  });

  it("keeps the Images routes behind the existing owner-bound Vercel OIDC gate", () => {
    expect(gameImageRoutes).toHaveLength(3);
    for (const route of gameImageRoutes) {
      expect(route.authorization).toBe("vercel-oidc");
      expect(route.authorizeBeforeMethod).toBe(true);
      expect(route.beforeMethod).toBeTypeOf("function");
    }
  });
});
