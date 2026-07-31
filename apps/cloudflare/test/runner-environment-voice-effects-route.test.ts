import { beforeEach, describe, expect, it, vi } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  createHostedEnvironmentVoiceStore,
} from "../src/environment-voice-store.ts";
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

describe("runner environment voice effects route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the active write fence for read and idempotent deletion", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(95);
    const rootKeyId = "ingress-root-current";
    const userId = "user_123";
    const bytes = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
    const sha256 = await sha256Hex(bytes);
    const store = createHostedEnvironmentVoiceStore({
      bucket,
      rootKey,
      rootKeyId,
      userId,
    });
    const staged = await store.stageAudio({
      bytes,
      captureId: sha256,
      sha256,
    });
    const { env, environment } = createRunnerContext(bucket);
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
    const url =
      `http://results.worker/environment-voice/${staged.audioKey}`;

    const read = await handleRunnerResultsRequest({
      bucket,
      env,
      environment,
      request: new Request(url),
      url: new URL(url),
      userId,
    });
    expect(read.status).toBe(200);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const deleted = await handleRunnerResultsRequest({
        bucket,
        env,
        environment,
        request: new Request(url, { method: "DELETE" }),
        url: new URL(url),
        userId,
      });
      expect(deleted.status).toBe(204);
    }
    await expect(store.readAudio(staged.audioKey)).resolves.toBeNull();
    expect(mocks.requireRunnerRuntimeWriteFenceWrite).toHaveBeenCalledTimes(3);
  });

  it("rejects stale write fences and unsupported methods", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const { env, environment } = createRunnerContext(bucket);
    const url =
      `http://results.worker/environment-voice/${"a".repeat(40)}`;
    mocks.requireRunnerRuntimeWriteFenceWrite.mockRejectedValueOnce(
      new RunnerRuntimeWriteFenceError(),
    );

    const stale = await handleRunnerResultsRequest({
      bucket,
      env,
      environment,
      request: new Request(url),
      url: new URL(url),
      userId: "user_123",
    });
    expect(stale.status).toBe(401);

    const wrongMethod = await handleRunnerResultsRequest({
      bucket,
      env,
      environment,
      request: new Request(url, { method: "POST" }),
      url: new URL(url),
      userId: "user_123",
    });
    expect(wrongMethod.status).toBe(405);
    expect(mocks.requireRunnerRuntimeWriteFenceWrite).toHaveBeenCalledTimes(1);
  });
});

function createRunnerContext(bucket: MemoryEncryptedR2Bucket): {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
} {
  const source = createHostedExecutionTestEnv();
  return {
    env: {
      ...source,
      BUNDLES: bucket,
      USER_RUNNER: {
        getByName() {
          return {};
        },
      },
    },
    environment: readHostedExecutionEnvironment(source),
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copy.buffer),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
