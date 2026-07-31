import { beforeEach, describe, expect, it, vi } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import type {
  WorkerEnvironmentSource,
  WorkerRouteContext,
} from "../src/worker-routes/shared.ts";
import {
  environmentVoiceRoutes,
  handleEnvironmentVoiceDeleteRoute,
  handleEnvironmentVoiceStageRoute,
} from "../src/worker/route-handlers/environment-voice-stage.ts";
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

describe("worker environment voice routes", () => {
  beforeEach(() => {
    mocks.resolveHostedExecutionUserCryptoContext.mockReset();
  });

  it("requires Vercel OIDC and the matching bound user", async () => {
    const matching = await createStageContext({
      boundUserId: "user_123",
      bytes: createWebmBytes(),
    });
    const missing = await createStageContext({ bytes: createWebmBytes() });

    for (const route of environmentVoiceRoutes) {
      expect(route.authorization).toBe("vercel-oidc");
      expect(route.authorizeBeforeMethod).toBe(true);
      expect(route.beforeMethod?.(missing, { userId: "user_123" })).toMatchObject(
        { status: 401 },
      );
      expect(route.beforeMethod?.(matching, { userId: "user_123" })).toBeNull();
    }
  });

  it("stages encrypted audio and supports idempotent owner deletion", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    mocks.resolveHostedExecutionUserCryptoContext.mockResolvedValue({
      keysById: {},
      resolveKeyById: async () => null,
      rootKey: createTestRootKey(94),
      rootKeyId: "ingress-root-current",
    });
    const bytes = createWebmBytes();
    const stageContext = await createStageContext({ bucket, bytes });
    const response = await handleEnvironmentVoiceStageRoute(
      stageContext,
      "user_123",
    );

    expect(response.status).toBe(200);
    const staged = await response.json() as { audioKey: string };
    expect(staged.audioKey).toMatch(/^[a-f0-9]{40}$/u);
    expect([...bucket.objects.values()][0]).toContain(
      '"scope":"environment-voice"',
    );

    const deleted = await handleEnvironmentVoiceDeleteRoute(
      createDeleteContext({ audioKey: staged.audioKey, bucket }),
      "user_123",
    );
    expect(deleted.status).toBe(200);
    expect(bucket.objects.size).toBe(0);
    await expect(
      handleEnvironmentVoiceDeleteRoute(
        createDeleteContext({ audioKey: staged.audioKey, bucket }),
        "user_123",
      ),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("rejects unsupported media and oversized bodies before crypto access", async () => {
    const wrongType = await createStageContext({
      bytes: createWebmBytes(),
      contentType: "audio/wav",
    });
    const oversized = await createStageContext({
      bytes: createWebmBytes(),
      contentLength: String(3 * 1024 * 1024 + 1),
    });

    await expect(
      handleEnvironmentVoiceStageRoute(wrongType, "user_123"),
    ).resolves.toMatchObject({ status: 415 });
    await expect(
      handleEnvironmentVoiceStageRoute(oversized, "user_123"),
    ).resolves.toMatchObject({ status: 413 });
    expect(
      mocks.resolveHostedExecutionUserCryptoContext,
    ).not.toHaveBeenCalled();
  });
});

async function createStageContext(input: {
  boundUserId?: string;
  bucket?: MemoryEncryptedR2Bucket;
  bytes: Uint8Array;
  contentLength?: string;
  contentType?: string;
}): Promise<WorkerRouteContext> {
  const sha256 = await sha256Hex(input.bytes);
  const headers = new Headers({
    "content-type": input.contentType ?? "audio/webm",
    "x-murph-environment-voice-capture-id": sha256,
    "x-murph-environment-voice-sha256": sha256,
  });
  if (input.boundUserId) {
    headers.set("x-hosted-execution-user-id", input.boundUserId);
  }
  if (input.contentLength) {
    headers.set("content-length", input.contentLength);
  }
  const request = new Request(
    "https://runner.example.test/internal/users/user_123/environment-voice/stage",
    {
      body: Uint8Array.from(input.bytes),
      headers,
      method: "POST",
    },
  );
  return createContext(request, input.bucket ?? new MemoryEncryptedR2Bucket());
}

function createDeleteContext(input: {
  audioKey: string;
  bucket: MemoryEncryptedR2Bucket;
}): WorkerRouteContext {
  const request = new Request(
    "https://runner.example.test/internal/users/user_123/environment-voice/delete",
    {
      headers: { "x-murph-environment-voice-key": input.audioKey },
      method: "DELETE",
    },
  );
  return createContext(request, input.bucket);
}

function createContext(
  request: Request,
  bucket: MemoryEncryptedR2Bucket,
): WorkerRouteContext {
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
          deleteHostedUserData: failUnused,
          ensureRuntimeProcessingForUser: failUnused,
          publishHostedPrivateMedia: failUnused,
          runnerStatus: failUnused,
        };
      },
    },
  };
  return {
    env,
    environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
    request,
    url: new URL(request.url),
  };
}

function createUnusedContainerNamespace():
  WorkerEnvironmentSource["RUNNER_CONTAINER"] {
  return {
    getByName() {
      return {
        destroyInstance: failUnused,
        invoke: failUnused,
        smokeHealth: failUnused,
      };
    },
  };
}

async function failUnused(): Promise<never> {
  throw new Error("Unexpected test dependency call.");
}

function createWebmBytes(): Uint8Array {
  return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
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
