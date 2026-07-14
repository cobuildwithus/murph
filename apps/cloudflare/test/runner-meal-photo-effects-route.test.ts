import { beforeEach, describe, expect, it, vi } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  createHostedMealPhotoStore,
} from "../src/meal-photo-store.ts";
import {
  handleRunnerResultsRequest,
} from "../src/runner-outbound/results.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound/shared.ts";
import {
  RunnerRuntimeWriteFenceError,
} from "../src/runner-outbound/write-fence.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createTestRootKey, MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const mocks = vi.hoisted(() => ({
  requireRunnerRuntimeWriteFenceWrite: vi.fn(),
  resolveRunnerOutboundUserCryptoContext: vi.fn(),
}));

vi.mock("../src/runner-outbound/shared.ts", async () => {
  const actual = await vi.importActual<
    typeof import("../src/runner-outbound/shared.ts")
  >("../src/runner-outbound/shared.ts");
  return {
    ...actual,
    resolveRunnerOutboundUserCryptoContext:
      mocks.resolveRunnerOutboundUserCryptoContext,
  };
});

vi.mock("../src/runner-outbound/write-fence.ts", async () => {
  const actual = await vi.importActual<
    typeof import("../src/runner-outbound/write-fence.ts")
  >("../src/runner-outbound/write-fence.ts");
  return {
    ...actual,
    requireRunnerRuntimeWriteFenceWrite:
      mocks.requireRunnerRuntimeWriteFenceWrite,
  };
});

describe("runner meal-photo effects routes", () => {
  beforeEach(() => {
    mocks.requireRunnerRuntimeWriteFenceWrite.mockReset();
    mocks.resolveRunnerOutboundUserCryptoContext.mockReset();
  });

  it("requires the active write fence for GET and idempotent DELETE", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(83);
    const rootKeyId = "ingress-root-current";
    const userId = "user_123";
    const bytes = createJpegBytes();
    const store = createHostedMealPhotoStore({
      bucket,
      rootKey,
      rootKeyId,
      userId,
    });
    const staged = await store.stageMealPhoto({
      bytes,
      captureId: "c".repeat(64),
      sha256: await sha256Hex(bytes),
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const env: RunnerOutboundEnvironmentSource = {
      ...createHostedExecutionTestEnv(),
      BUNDLES: bucket,
      USER_RUNNER: {
        getByName() {
          return {};
        },
      },
    };
    mocks.requireRunnerRuntimeWriteFenceWrite.mockResolvedValue({
      attemptId: "attempt_1",
      generation: "1",
      workspaceVersion: "1",
    });
    mocks.resolveRunnerOutboundUserCryptoContext.mockResolvedValue({
      keysById: { [rootKeyId]: rootKey },
      resolveKeyById: async () => null,
      rootKey,
      rootKeyId,
    });
    const url = `http://results.worker/meal-photos/${staged.mealPhotoKey}`;

    const readResponse = await handleRunnerResultsRequest({
      bucket,
      env,
      environment,
      request: new Request(url),
      url: new URL(url),
      userId,
    });
    expect(readResponse.status).toBe(200);
    expect(new Uint8Array(await readResponse.arrayBuffer())).toEqual(bytes);
    mocks.resolveRunnerOutboundUserCryptoContext.mockClear();
    mocks.resolveRunnerOutboundUserCryptoContext.mockRejectedValue(
      new Error("crypto context unavailable"),
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const deleteRequest = new Request(url, { method: "DELETE" });
      const deleteResponse = await handleRunnerResultsRequest({
        bucket,
        env,
        environment,
        request: deleteRequest,
        url: new URL(url),
        userId,
      });
      expect(deleteResponse.status).toBe(204);
    }

    expect(mocks.requireRunnerRuntimeWriteFenceWrite).toHaveBeenCalledTimes(3);
    expect(mocks.requireRunnerRuntimeWriteFenceWrite).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ request: expect.objectContaining({ method: "GET" }), userId }),
    );
    expect(mocks.requireRunnerRuntimeWriteFenceWrite).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ request: expect.objectContaining({ method: "DELETE" }), userId }),
    );
    expect(mocks.resolveRunnerOutboundUserCryptoContext).not.toHaveBeenCalled();
    await expect(store.readMealPhoto(staged.mealPhotoKey)).resolves.toBeNull();
  });

  it("rejects reads when the active write fence is stale", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const env: RunnerOutboundEnvironmentSource = {
      ...createHostedExecutionTestEnv(),
      BUNDLES: bucket,
      USER_RUNNER: {
        getByName() {
          return {};
        },
      },
    };
    mocks.requireRunnerRuntimeWriteFenceWrite.mockRejectedValueOnce(
      new RunnerRuntimeWriteFenceError(),
    );
    const url = `http://results.worker/meal-photos/${"a".repeat(40)}`;

    const response = await handleRunnerResultsRequest({
      bucket,
      env,
      environment,
      request: new Request(url),
      url: new URL(url),
      userId: "user_123",
    });

    expect(response.status).toBe(401);
    expect(mocks.resolveRunnerOutboundUserCryptoContext).not.toHaveBeenCalled();
  });
});

function createJpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
