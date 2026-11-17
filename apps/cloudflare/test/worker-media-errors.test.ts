import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import type { GameImagesBinding } from "../src/game-image-store.ts";
import { classifyPublicRouteError } from "../src/worker/errors.ts";
import { gameImageRoutes } from "../src/worker/route-handlers/game-images.ts";
import { gameMediaRoutes } from "../src/worker/route-handlers/game-media.ts";
import { recapMediaRoutes } from "../src/worker/route-handlers/recap-media.ts";
import type { DeclarativeRoute } from "../src/worker/routes.ts";
import type { WorkerRouteContext } from "../src/worker-routes/shared.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const bytes = new Uint8Array([255, 216, 255, 224, 1, 2, 255, 217]);
const mediaId = `${createHash("sha256").update(bytes).digest("hex")}.jpg`;
const recapId = `recap/${"a".repeat(32)}/scene-0.jpg`;
const envelope = JSON.stringify({
  alg: "AES-256-GCM-HKDF-SHA256", ciphertext: "c3ludGhldGlj", domain: "control", iv: "AAAAAAAAAAAAAAAA",
  lane: "hosted-member-private-field", rootKeyId: "root-synthetic", schema: "murph.hosted-secure-box.v1", scope: "weekly-game",
});

const shortIvEnvelope = envelope.replace("AAAAAAAAAAAAAAAA", "AA==");

class ImageBucket extends MemoryEncryptedR2Bucket {
  async list({ prefix = "", limit = 1000 }: { prefix?: string; limit?: number }) {
    const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix));
    return { objects: keys.slice(0, limit).map(key => ({ key })), truncated: keys.length > limit };
  }
}

function provider() {
  const info = vi.fn<GameImagesBinding["info"]>(async () => ({ format: "image/jpeg", width: 1280, height: 720 }));
  const upload = vi.fn<GameImagesBinding["hosted"]["upload"]>(async () => ({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", requireSignedURLs: true,
  }));
  const images: GameImagesBinding = {
    info,
    hosted: { upload, image: () => ({ delete: async () => true, signedUrl: async () => "" }),
      list: async () => ({ images: [], listComplete: true }) },
  };
  return { images, info, upload };
}

function context(input: {
  body?: string | Uint8Array;
  bucket?: MemoryEncryptedR2Bucket;
  images?: GameImagesBinding;
  headers?: Record<string, string>;
} = {}): WorkerRouteContext {
  const configured = createHostedExecutionTestEnv();
  const request = new Request("https://runner.example.test/internal/users/synthetic-owner/media/stage", {
    method: "POST", body: typeof input.body === "string" ? input.body : new Uint8Array(input.body ?? bytes),
    headers: { "content-type": "image/jpeg", "x-murph-game-media-id": mediaId,
      "x-murph-recap-media-id": recapId, "x-murph-recap-hash": "a".repeat(64), ...input.headers },
  });
  const unused = { getByName() { throw new Error("Unexpected runtime access."); } };
  return { request, url: new URL(request.url), environment: readHostedExecutionEnvironment(configured),
    env: { ...configured, CF_PUBLIC_BASE_URL: "https://runner.example.test", BUNDLES: input.bucket ?? new ImageBucket(),
      GAME_IMAGES: input.images, RUNNER_CONTAINER: unused, RUNNER_CONTAINER_SMOKE: unused } };
}

function route(routes: readonly DeclarativeRoute<WorkerRouteContext>[], name: string) {
  const found = routes.find(candidate => candidate.name === name);
  if (!found) throw new Error(`Missing route: ${name}`);
  return found;
}

// Exercise the same public error classification as the Worker's fetch boundary.
async function call(handler: DeclarativeRoute<WorkerRouteContext>, input: WorkerRouteContext): Promise<Response> {
  try { return await handler.handle(input, { userId: "synthetic-owner" }); }
  catch (error) {
    const classified = classifyPublicRouteError(error);
    return Response.json({ error: classified.error }, { status: classified.status });
  }
}

async function expectError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual({ error });
}

const recap = route(recapMediaRoutes, "recapMediaStage");
const game = route(gameImageRoutes, "gameImageStage");
const sealedGame = route(gameMediaRoutes, "game-media-stage");

describe("media input rejection boundaries", () => {
  it.each([
    ["invalid identity", envelope, { "x-murph-recap-media-id": "invalid" }, 400, "Invalid recap identity."],
    ["invalid hash", envelope, { "x-murph-recap-hash": "invalid" }, 400, "Invalid sealed recap asset."],
    ["malformed JSON", "{", {}, 400, "Invalid sealed recap asset."],
    ["malformed envelope", "{}", {}, 400, "Invalid sealed recap asset."],
    ["short IV", shortIvEnvelope, {}, 400, "Invalid sealed recap asset."],
    ["wrong scope", envelope.replace("weekly-game", "other"), {}, 400, "Invalid sealed recap asset."],
    ["oversized declared body", envelope, { "content-length": String(3 * 1024 * 1024 + 1) }, 413, "Recap asset is too large."],
    ["oversized streamed body", " ".repeat(3 * 1024 * 1024 + 1), {}, 413, "Recap asset is too large."],
  ] as const)("preserves recap rejection: %s", async (_label, body, headers, status, message) => {
    const bucket = new ImageBucket();
    await expectError(await call(recap, context({ bucket, body, headers })), status, message);
    expect(bucket.objects.size).toBe(0);
  });

  it.each([
    ["invalid identity", bytes, { "x-murph-game-media-id": "invalid" }, 400, "Game image id is invalid."],
    ["invalid type", bytes, { "content-type": "image/png" }, 400, "Game image type is invalid."],
    ["mismatched type", bytes, { "content-type": "image/heic" }, 400, "Game image type does not match."],
    ["empty body", new Uint8Array(), {}, 400, "Game image is empty."],
    ["mismatched hash", new Uint8Array([1]), {}, 400, "Game image is invalid."],
    ["oversized declared body", bytes, { "content-length": String(4 * 1024 * 1024 + 1) }, 413, "Game image is too large."],
    ["oversized streamed body", new Uint8Array(4 * 1024 * 1024 + 1), {}, 413, "Game image is too large."],
  ] as const)("preserves image rejection: %s", async (_label, body, headers, status, message) => {
    const p = provider(), bucket = new ImageBucket();
    await expectError(await call(game, context({ bucket, images: p.images, body, headers })), status, message);
    expect(p.upload).not.toHaveBeenCalled();
    expect(bucket.objects.size).toBe(0);
  });

  it.each([
    { format: "image/png", width: 10, height: 10 },
    { format: "image/jpeg", width: 0, height: 10 },
    { format: "image/jpeg", width: 12_001, height: 10 },
    { format: "image/jpeg", width: 11_000, height: 11_000 },
  ])("preserves raster format/dimension rejection: %j", async info => {
    const p = provider(), bucket = new ImageBucket();
    p.info.mockResolvedValueOnce(info);
    await expectError(await call(game, context({ bucket, images: p.images })), 400, "Game image is invalid.");
    expect(p.upload).not.toHaveBeenCalled();
    expect(bucket.objects.size).toBe(0);
  });

  it("preserves the provider's invalid-image rejection", async () => {
    const p = provider(), bucket = new ImageBucket();
    p.info.mockRejectedValueOnce(Object.assign(new Error("Synthetic invalid image."), { code: 9412 }));
    await expectError(await call(game, context({ bucket, images: p.images })), 400, "Game image is invalid.");
    expect(p.upload).not.toHaveBeenCalled();
    expect(bucket.objects.size).toBe(0);
  });

  it.each([
    ["bad identity", envelope, { "x-murph-game-media-id": "invalid" }, 400, "Game media id is invalid."],
    ["bad envelope", "{}", {}, 400, "Game media must be sealed."],
    ["short IV", shortIvEnvelope, {}, 400, "Game media must be sealed."],
    ["oversized", envelope, { "content-length": String(6 * 1024 * 1024 + 1) }, 413, "Game media is too large."],
  ] as const)("preserves sealed game rejection: %s", async (_label, body, headers, status, message) => {
    await expectError(await call(sealedGame, context({ body, headers })), status, message);
  });
});

describe("media storage failures stay retryable", () => {
  it.each([TypeError, RangeError, SyntaxError])("maps recap R2 failures to 500: %s", async ErrorType => {
    for (const operation of ["put", "get"] as const) {
      const bucket = new ImageBucket();
      vi.spyOn(bucket, operation).mockRejectedValueOnce(new ErrorType("Synthetic storage failure."));
      await expectError(await call(recap, context({ bucket, body: envelope })), 500, "Internal error.");
    }
  });

  it.each(["{}", "{", JSON.stringify({ version: 1, hash: "a".repeat(64), envelope: "{}" }),
    JSON.stringify({ version: 1, hash: "a".repeat(64), envelope: shortIvEnvelope })])(
    "maps invalid stored recap data to 500: %s", async stored => {
      const bucket = new ImageBucket();
      vi.spyOn(bucket, "get").mockResolvedValue({ arrayBuffer: async () => new TextEncoder().encode(stored).buffer });
      await expectError(await call(recap, context({ bucket, body: envelope })), 500, "Internal error.");
      await expectError(await call(route(recapMediaRoutes, "recapMediaRead"), context({ bucket })), 500, "Internal error.");
    },
  );

  it.each(["get", "put", "upload", "info", "pointer"] as const)("maps image %s failures to 500", async operation => {
    const p = provider(), bucket = new ImageBucket();
    const error = new TypeError("Synthetic backend failure.");
    if (operation === "upload") p.upload.mockRejectedValueOnce(error);
    else if (operation === "info") p.info.mockRejectedValueOnce(error);
    else if (operation === "pointer") {
      vi.spyOn(bucket, "get").mockResolvedValueOnce({ arrayBuffer: async () => new TextEncoder().encode("{}").buffer });
    } else vi.spyOn(bucket, operation).mockRejectedValueOnce(error);
    await expectError(await call(game, context({ bucket, images: p.images })), 500, "Internal error.");
    if (operation === "upload") expect(p.upload).toHaveBeenCalledTimes(1);
  });

  it("maps corrupt image stat data to 500", async () => {
    const p = provider(), bucket = new ImageBucket();
    vi.spyOn(bucket, "get").mockResolvedValueOnce({ arrayBuffer: async () => new TextEncoder().encode("{}").buffer });
    await expectError(await call(route(gameImageRoutes, "gameImageStat"), context({ bucket, images: p.images })), 500, "Internal error.");
  });

  it("accepts a stored image retry without waiting for inspection", async () => {
    const p = provider(), bucket = new ImageBucket();
    expect((await call(game, context({ bucket, images: p.images }))).status).toBe(200);
    p.info.mockRejectedValueOnce(new TypeError("Synthetic inspection outage."));
    expect((await call(game, context({ bucket, images: p.images }))).status).toBe(200);
    expect(p.upload).toHaveBeenCalledTimes(1);
    expect(p.info).toHaveBeenCalledTimes(2);
  });

  it("maps sealed game storage TypeError to 500", async () => {
    const bucket = new ImageBucket();
    vi.spyOn(bucket, "put").mockRejectedValueOnce(new TypeError("Synthetic storage failure."));
    await expectError(await call(sealedGame, context({ bucket, body: envelope })), 500, "Internal error.");
  });
});
