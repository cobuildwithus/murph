import { describe, expect, it } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  createHostedGameMediaStore,
  HOSTED_GAME_MEDIA_MAX_ENVELOPE_BYTES,
  requireHostedGameMediaEnvelope,
} from "../src/game-media-store.ts";
import { gameMediaRoutes } from "../src/worker/route-handlers/game-media.ts";
import type {
  WorkerEnvironmentSource,
  WorkerRouteContext,
} from "../src/worker-routes/shared.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const MEDIA_ID = `${"a".repeat(64)}.jpg`;
const ENVELOPE = {
  alg: "AES-256-GCM-HKDF-SHA256",
  ciphertext: "c2VhbGVkLXBob3Rv",
  domain: "control",
  iv: "aXYtc3ludGhldGlj",
  lane: "hosted-member-private-field",
  rootKeyId: "root-synthetic",
  schema: "murph.hosted-secure-box.v1",
  scope: "weekly-game",
};

describe("hosted game media store", () => {
  it("keeps sealed envelopes under the owner's prefix without naming them", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const leo = createHostedGameMediaStore({ bucket, userId: "member_leo" });
    const ava = createHostedGameMediaStore({ bucket, userId: "member_ava" });

    const written = await leo.write(MEDIA_ID, JSON.stringify(ENVELOPE));

    expect(written.byteLength).toBeGreaterThan(0);
    expect(JSON.parse(await leo.read(MEDIA_ID) ?? "null")).toEqual(ENVELOPE);
    await expect(leo.stat(MEDIA_ID)).resolves.toEqual({ byteLength: written.byteLength });
    await expect(ava.read(MEDIA_ID)).resolves.toBeNull();
    const [objectKey] = [...bucket.objects.keys()];
    expect(objectKey).toMatch(/^hosted-game-media\/objects\/hsn_[a-f0-9]{24}\/[a-f0-9]{48}\.json\.enc$/u);
    expect(objectKey).not.toContain("member_leo");
    expect(objectKey).not.toContain("a".repeat(64));

    await leo.delete(MEDIA_ID);
    await expect(leo.read(MEDIA_ID)).resolves.toBeNull();
  });

  it("refuses plaintext and envelopes sealed for anything but the game", () => {
    expect(() => requireHostedGameMediaEnvelope("\xff\xd8\xff plain jpeg")).toThrow(TypeError);
    expect(() => requireHostedGameMediaEnvelope(JSON.stringify({ photo: "plain" }))).toThrow(TypeError);
    expect(() => requireHostedGameMediaEnvelope(JSON.stringify({ ...ENVELOPE, scope: "other" }))).toThrow(
      "Hosted game media must be sealed for the weekly game.",
    );
    expect(() => requireHostedGameMediaEnvelope(JSON.stringify({ ...ENVELOPE, lane: "mailbox-payload", domain: "ingress" }))).toThrow(
      "Hosted game media must be sealed for the weekly game.",
    );
  });
});

describe("worker game media routes", () => {
  it("requires Vercel OIDC and the matching bound-user header on every route", () => {
    expect(gameMediaRoutes.map((route) => route.name)).toEqual([
      "game-media-stage",
      "game-media-read",
      "game-media-stat",
      "game-media-delete",
    ]);
    for (const route of gameMediaRoutes) {
      const missing = createContext({ method: "GET", suffix: "read" });
      const mismatched = createContext({ boundUserId: "member_ava", method: "GET", suffix: "read" });
      const matching = createContext({ boundUserId: "member_leo", method: "GET", suffix: "read" });
      expect(route.authorization).toBe("vercel-oidc");
      expect(route.authorizeBeforeMethod).toBe(true);
      expect(route.beforeMethod?.(missing, { userId: "member_leo" })).toMatchObject({ status: 401 });
      expect(route.beforeMethod?.(mismatched, { userId: "member_leo" })).toMatchObject({ status: 401 });
      expect(route.beforeMethod?.(matching, { userId: "member_leo" })).toBeNull();
    }
  });

  it("stages, reads, stats and deletes one sealed photo", async () => {
    const bucket = new MemoryEncryptedR2Bucket();

    const staged = await call("stage", { body: JSON.stringify(ENVELOPE), bucket, method: "POST" });
    expect(staged.status).toBe(200);
    await expect(staged.json()).resolves.toMatchObject({ stored: true });

    const read = await call("read", { bucket, method: "GET" });
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    await expect(read.json()).resolves.toEqual(ENVELOPE);

    const stat = await call("stat", { bucket, method: "GET" });
    await expect(stat.json()).resolves.toEqual({ byteLength: expect.any(Number) });

    const deleted = await call("delete", { bucket, method: "DELETE" });
    await expect(deleted.json()).resolves.toEqual({ deleted: true });
    expect((await call("read", { bucket, method: "GET" })).status).toBe(404);
    expect((await call("stat", { bucket, method: "GET" })).status).toBe(404);
  });

  it("rejects bad names, plaintext and oversized bodies before storing", async () => {
    const bucket = new MemoryEncryptedR2Bucket();

    expect((await call("read", { bucket, mediaId: "photo.jpg", method: "GET" })).status).toBe(400);
    expect((await call("stage", { body: "plain bytes", bucket, method: "POST" })).status).toBe(400);
    expect((await call("stage", {
      body: JSON.stringify(ENVELOPE),
      bucket,
      contentLength: String(HOSTED_GAME_MEDIA_MAX_ENVELOPE_BYTES + 1),
      method: "POST",
    })).status).toBe(413);
    expect(bucket.objects.size).toBe(0);
  });
});

async function call(
  suffix: "delete" | "read" | "stage" | "stat",
  input: { body?: string; bucket: MemoryEncryptedR2Bucket; contentLength?: string; mediaId?: string; method: string },
): Promise<Response> {
  const route = gameMediaRoutes.find((candidate) => candidate.name === `game-media-${suffix}`);
  if (!route) throw new Error(`No game-media-${suffix} route.`);
  const context = createContext({ ...input, boundUserId: "member_leo", suffix });
  return await route.handle(context, { userId: "member_leo" });
}

function createContext(input: {
  body?: string;
  boundUserId?: string;
  bucket?: MemoryEncryptedR2Bucket;
  contentLength?: string;
  mediaId?: string;
  method: string;
  suffix: string;
}): WorkerRouteContext {
  const headers = new Headers({ "x-murph-game-media-id": input.mediaId ?? MEDIA_ID });
  if (input.boundUserId) headers.set("x-hosted-execution-user-id", input.boundUserId);
  if (input.contentLength) headers.set("content-length", input.contentLength);
  const request = new Request(
    `https://runner.example.test/internal/users/member_leo/game-media/${input.suffix}`,
    { ...(input.body === undefined ? {} : { body: input.body }), headers, method: input.method },
  );
  const env: WorkerEnvironmentSource = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: input.bucket ?? new MemoryEncryptedR2Bucket(),
    RUNNER_CONTAINER: createUnusedContainerNamespace(),
    RUNNER_CONTAINER_SMOKE: createUnusedContainerNamespace(),
  };
  return {
    env,
    environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
    request,
    url: new URL(request.url),
  };
}

function createUnusedContainerNamespace(): WorkerEnvironmentSource["RUNNER_CONTAINER"] {
  return {
    getByName() {
      return {
        destroyInstance: failUnusedTestDependency,
        invoke: failUnusedTestDependency,
        smokeHealth: failUnusedTestDependency,
      };
    },
  };
}

async function failUnusedTestDependency(): Promise<never> {
  throw new Error("Unexpected test dependency call.");
}
