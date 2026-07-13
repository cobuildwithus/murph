import { beforeEach, describe, expect, it, vi } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import type {
  WorkerEnvironmentSource,
  WorkerRouteContext,
} from "../src/worker-routes/shared.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createTestRootKey, MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const mocks = vi.hoisted(() => ({
  resolveHostedExecutionUserCryptoContext: vi.fn(),
}));

vi.mock("../src/worker-routes/shared.ts", async () => {
  const actual = await vi.importActual<
    typeof import("../src/worker-routes/shared.ts")
  >("../src/worker-routes/shared.ts");
  return {
    ...actual,
    resolveHostedExecutionUserCryptoContext:
      mocks.resolveHostedExecutionUserCryptoContext,
  };
});

import {
  handleMealPhotoStageRoute,
  mealPhotoStageRoutes,
} from "../src/worker/route-handlers/meal-photo-stage.ts";
import {
  HOSTED_MEAL_PHOTO_MAX_BYTES,
} from "../src/meal-photo-store.ts";

describe("worker meal-photo staging route", () => {
  beforeEach(() => {
    mocks.resolveHostedExecutionUserCryptoContext.mockReset();
  });

  it("requires Vercel OIDC and the matching bound-user header", async () => {
    const route = mealPhotoStageRoutes[0];
    if (!route?.beforeMethod) {
      throw new TypeError("Expected the meal-photo stage route auth guard.");
    }
    const bytes = createJpegBytes();
    const context = await createRouteContext({ bytes });

    expect(route.authorization).toBe("vercel-oidc");
    expect(route.authorizeBeforeMethod).toBe(true);
    expect(route.beforeMethod(context, { userId: "user_123" })).toMatchObject({
      status: 401,
    });
  });

  it("stages a bounded JPEG into the user's ingress-encrypted store", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    mocks.resolveHostedExecutionUserCryptoContext.mockResolvedValue({
      keysById: {},
      resolveKeyById: async () => null,
      rootKey: createTestRootKey(81),
      rootKeyId: "ingress-root-current",
    });
    const bytes = createJpegBytes();
    const context = await createRouteContext({ bucket, bytes });

    const response = await handleMealPhotoStageRoute(context, "user_123");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      byteLength: bytes.byteLength,
      mealPhotoKey: expect.stringMatching(/^[a-f0-9]{40}$/u),
      sha256: await sha256Hex(bytes),
    });
    expect(mocks.resolveHostedExecutionUserCryptoContext).toHaveBeenCalledWith({
      bucket,
      domain: "ingress",
      environment: context.environment,
      userId: "user_123",
    });
    expect(bucket.objects.size).toBe(1);
    expect([...bucket.objects.values()][0]).toContain('"scope":"meal-photo"');
  });

  it("rejects unsupported media and oversized bodies before crypto access", async () => {
    const wrongType = await createRouteContext({
      bytes: createJpegBytes(),
      contentType: "image/png",
    });
    const oversized = await createRouteContext({
      bytes: createJpegBytes(),
      contentLength: String(4 * 1024 * 1024 + 1),
    });

    await expect(handleMealPhotoStageRoute(wrongType, "user_123")).resolves.toMatchObject({
      status: 415,
    });
    await expect(handleMealPhotoStageRoute(oversized, "user_123")).resolves.toMatchObject({
      status: 413,
    });
    expect(mocks.resolveHostedExecutionUserCryptoContext).not.toHaveBeenCalled();
  });

  it("accepts an exact 4 MiB JPEG and rejects a mismatched SHA", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    mocks.resolveHostedExecutionUserCryptoContext.mockResolvedValue({
      keysById: {},
      resolveKeyById: async () => null,
      rootKey: createTestRootKey(82),
      rootKeyId: "ingress-root-current",
    });
    const bytes = createMaxSizeJpegBytes();
    const exactLimit = await createRouteContext({ bucket, bytes });

    const accepted = await handleMealPhotoStageRoute(exactLimit, "user_123");

    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      byteLength: HOSTED_MEAL_PHOTO_MAX_BYTES,
      sha256: await sha256Hex(bytes),
    });

    const mismatch = await createRouteContext({
      bucket: new MemoryEncryptedR2Bucket(),
      bytes: createJpegBytes(),
      sha256: "0".repeat(64),
    });
    const rejected = await handleMealPhotoStageRoute(mismatch, "user_123");

    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toEqual({
      error: "Meal photo payload is invalid.",
    });
  });
});

async function createRouteContext(input: {
  bucket?: MemoryEncryptedR2Bucket;
  bytes: Uint8Array;
  contentLength?: string;
  contentType?: string;
  sha256?: string;
}): Promise<Parameters<typeof handleMealPhotoStageRoute>[0]> {
  const sha256 = input.sha256 ?? await sha256Hex(input.bytes);
  const headers = new Headers({
    "content-type": input.contentType ?? "image/jpeg",
    "x-murph-meal-photo-capture-id": "c".repeat(64),
    "x-murph-meal-photo-sha256": sha256,
  });
  if (input.contentLength) {
    headers.set("content-length", input.contentLength);
  }
  const request = new Request(
    "https://runner.example.test/internal/users/user_123/meal-photos/stage",
    {
      body: Uint8Array.from(input.bytes),
      headers,
      method: "POST",
    },
  );
  const bucket = input.bucket ?? new MemoryEncryptedR2Bucket();
  const env: WorkerEnvironmentSource = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: bucket,
    RUNNER_CONTAINER: createUnusedContainerNamespace(),
    RUNNER_CONTAINER_SMOKE: createUnusedContainerNamespace(),
    USER_RUNNER: {
      getByName() {
        return {
          async bindUser(userId) {
            return { userId };
          },
          deleteHostedUserData: failUnusedTestDependency,
          ensureRuntimeProcessingForUser: failUnusedTestDependency,
          runnerStatus: failUnusedTestDependency,
        };
      },
    },
  };
  const context: WorkerRouteContext = {
    env,
    environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
    request,
    url: new URL(request.url),
  };
  return {
    ...context,
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

function createJpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);
}

function createMaxSizeJpegBytes(): Uint8Array {
  const bytes = new Uint8Array(HOSTED_MEAL_PHOTO_MAX_BYTES);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], bytes.byteLength - 2);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
