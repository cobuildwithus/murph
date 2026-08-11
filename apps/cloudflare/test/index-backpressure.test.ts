import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH,
  HOSTED_RUNTIME_STATUS_PATH,
} from "@murphai/hosted-execution/routes";
import worker, { UserRunnerDurableObject } from "../src/index.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import { RunnerStateStore } from "../src/user-runner/runner-state-store.ts";

import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.js";
import { createTestSqlStorage } from "./sql-storage.ts";

const TEST_VERCEL_OIDC_TEAM_SLUG = "murph-team";
const TEST_VERCEL_OIDC_PROJECT_NAME = "murph-web";
const TEST_VERCEL_OIDC_ISSUER = `https://oidc.vercel.com/${TEST_VERCEL_OIDC_TEAM_SLUG}`;
const TEST_VERCEL_OIDC_AUDIENCE = `https://vercel.com/${TEST_VERCEL_OIDC_TEAM_SLUG}`;
const TEST_VERCEL_OIDC_SUBJECT =
  `owner:${TEST_VERCEL_OIDC_TEAM_SLUG}:project:${TEST_VERCEL_OIDC_PROJECT_NAME}:environment:production`;
const TEST_VERCEL_OIDC_JWKS_URL = `${TEST_VERCEL_OIDC_ISSUER}/.well-known/jwks`;
const TEST_VERCEL_OIDC_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const TEST_VERCEL_OIDC_PUBLIC_JWK = {
  ...(createPublicKey(TEST_VERCEL_OIDC_PRIVATE_KEY).export({ format: "jwk" }) as JsonWebKey),
  alg: "RS256",
  kid: "test-kid",
  use: "sig",
};

describe("cloudflare worker queue backpressure routes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the removed dispatch route unavailable without relying on legacy local queue state", async () => {
    const harness = createUserRunnerDurableObject();
    await harness.durableObject.bindUser("member_123");

    const overflowResponse = await worker.fetch(
      await createSignedWakeRequest("/internal/dispatch", createWake("evt_overflow")),
      harness.env as never,
    );

    expect(overflowResponse.status).toBe(404);
    await expect(overflowResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("keeps the removed runner nudge route unavailable", async () => {
    const harness = createUserRunnerDurableObject({
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });
    const stub = {
      bindUser: vi.fn(async (userId: string) => ({ userId })),
      ensureRuntimeProcessingForUser: vi.fn(),
      runnerStatus: vi.fn(),
    };
    const env = {
      ...harness.env,
      USER_RUNNER: {
        getByName() {
          return stub;
        },
      },
    };
    const runResponse = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/nudge", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "POST",
      })),
      env as never,
    );

    expect(runResponse.status).toBe(404);
    expect(stub.bindUser).not.toHaveBeenCalled();
    expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
  });

  it("stamps UserRunner RPC entry before delegating to the hosted runner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00.000Z"));
    const ensure = vi.spyOn(
      HostedUserRunner.prototype,
      "ensureRuntimeProcessingForUser",
    ).mockResolvedValue({
      action: "started",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-08-06T12:01:00.000Z",
      runtimeAttemptId: "runtime-attempt-test",
    });
    const harness = createUserRunnerDurableObject();

    await harness.durableObject.ensureRuntimeProcessingForUser({
      orchestration: {
        cloudflareRouteReceivedAtEpochMs: Date.parse("2026-08-06T11:59:59.900Z"),
      },
      orchestrationAttemptId: "rpc-entry-test",
      userId: "member_123",
    });

    expect(ensure).toHaveBeenCalledWith({
      orchestration: {
        cloudflareRouteReceivedAtEpochMs: Date.parse("2026-08-06T11:59:59.900Z"),
        userRunnerRpcStartedAtEpochMs: Date.parse("2026-08-06T12:00:00.000Z"),
      },
      orchestrationAttemptId: "rpc-entry-test",
      userId: "member_123",
    });
  });

  it("keeps an active write fence in flight through the production Durable Object constructor", async () => {
    const writeDataPoint = vi.fn();
    const harness = createUserRunnerDurableObject({
      CF_VERSION_METADATA: {
        id: "worker_version_current",
      },
      HOSTED_RUNTIME_RETRY_ANALYTICS: { writeDataPoint },
    });
    const stateStore = new RunnerStateStore(harness.storage.state);
    await stateStore.bindUser("member_123");
    await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-worker_version_current",
      userId: "member_123",
    });
    installOidcJwksFetch(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === "https://web.example.test" && url.pathname === HOSTED_RUNTIME_STATUS_PATH) {
        return Response.json({
          mailboxLag: [
            {
              importedSeq: "0",
              lag: "1",
              lane: "conversation",
              maxSeq: "1",
            },
          ],
          userId: "member_123",
          workspace: null,
        });
      }

      if (
        url.origin === "https://web.example.test" &&
        url.pathname === HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH
      ) {
        return Response.json({
          consentState: "granted",
          processingAllowed: true,
          userId: "member_123",
        });
      }

      throw new Error(`Unexpected fetch during Cloudflare backpressure test: ${url.origin}${url.pathname}`);
    });

    await expect(harness.durableObject.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "backpressure-active-fence-test",
      userId: "member_123",
    })).resolves.toMatchObject({
      kind: "retry_later",
      retryAt: expect.any(String),
    });
    const state = await stateStore.readState();

    expect(state.writeFence).toMatchObject({
      kind: "runtime",
    });
    expect(writeDataPoint).toHaveBeenCalledOnce();
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["murph.hosted-runtime-retry.v1", "container_rpc_error"],
      doubles: [1, 30_000],
      indexes: ["container_rpc_error"],
    });
  });

});

function createUserRunnerDurableObject(
  overrides: Partial<Record<string, unknown>> = {},
) {
  const bucket = createBucketStore();
  const storage = createStorage();
  const baseEnv = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: bucket.api,
    RUNNER_CONTAINER: storage.runnerContainerNamespace,
    RUNNER_CONTAINER_SMOKE: storage.runnerContainerNamespace,
    ...overrides,
  };
  const durableObject = new UserRunnerDurableObject(storage.state, baseEnv as never);

  return {
    durableObject,
    env: {
      ...baseEnv,
      USER_RUNNER: {
        getByName() {
          return durableObject;
        },
      },
    },
    storage,
  };
}

function createBucketStore() {
  const values = new Map<string, string>();

  return {
    api: {
      async delete(key: string | string[]) {
        for (const item of Array.isArray(key) ? key : [key]) {
          values.delete(item);
        }
      },
      async get(key: string) {
        const value = values.get(key);

        if (!value) {
          return null;
        }

        return {
          async arrayBuffer() {
            const bytes = Buffer.from(value, "utf8");
            return bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            );
          },
          key,
          size: Buffer.byteLength(value),
        };
      },
      async head(key: string) {
        const value = values.get(key);
        return value === undefined
          ? null
          : {
              key,
              size: Buffer.byteLength(value),
            };
      },
      async list(input: { prefix?: string } = {}) {
        return {
          objects: [...values.keys()]
            .filter((key) => input.prefix ? key.startsWith(input.prefix) : true)
            .sort()
            .map((key) => ({ key })),
          truncated: false,
        };
      },
      async put(key: string, value: string) {
        values.set(key, value);
      },
    },
  };
}

function createStorage() {
  const values = new Map<string, unknown>();
  const sql = createTestSqlStorage();

  return {
    runnerContainerNamespace: {
      getByName() {
        return {
          async destroyInstance() {},
          async invoke() {
            throw new Error("Runner container should not be invoked by the seeded backpressure tests.");
          },
          async smokeHealth() {
            return {
              ok: true,
              runnerBundle: null,
              service: "cloudflare-hosted-runner-node",
              status: 200,
            };
          },
        };
      },
    },
    state: {
      storage: {
        async delete(key: string): Promise<boolean> {
          return values.delete(key);
        },
        async deleteAlarm(): Promise<void> {},
        async get<T>(key: string): Promise<T | undefined> {
          return values.get(key) as T | undefined;
        },
        async getAlarm(): Promise<number | null> {
          return null;
        },
        async put<T>(key: string, value: T): Promise<void> {
          values.set(key, value);
        },
        async setAlarm(): Promise<void> {},
        sql,
      },
      waitUntil() {},
    },
  };
}

function createWake(eventId: string): HostedExecutionWake {
  return {
    eventId,
    kind: "member.activated",
    memberChannels: {
      email: false,
      linq: false,
      telegram: false,
    },
    occurredAt: "2026-03-26T12:00:00.000Z",
    userId: "member_123",
  };
}

async function createSignedWakeRequest(
  path: string,
  wake: HostedExecutionWake,
  input: {
    aud?: string;
    boundUserId?: string | null;
    iss?: string;
    sub?: string;
  } = {},
): Promise<Request> {
  installOidcJwksFetch();

  const headers = new Headers({
    authorization: `Bearer ${createTestVercelOidcToken(input)}`,
    "content-type": "application/json; charset=utf-8",
  });

  if (input.boundUserId !== null) {
    headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId ?? wake.userId);
  }

  return new Request(`https://runner.example.test${path}`, {
    body: JSON.stringify(wake),
    headers,
    method: "POST",
  });
}

async function signControlRequest(
  request: Request,
  input: {
    aud?: string;
    boundUserId?: string | null;
    iss?: string;
    sub?: string;
  } = {},
): Promise<Request> {
  installOidcJwksFetch();
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${createTestVercelOidcToken(input)}`);
  const derivedUserId = /^\/internal\/users\/(?<userId>[^/]+)/u.exec(new URL(request.url).pathname)?.groups?.userId;

  if (input.boundUserId !== null && (input.boundUserId || derivedUserId)) {
    headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId ?? derivedUserId ?? "");
  }

  return new Request(request, { headers });
}

function installOidcJwksFetch(delegate?: typeof fetch): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === TEST_VERCEL_OIDC_JWKS_URL) {
      return new Response(JSON.stringify({ keys: [TEST_VERCEL_OIDC_PUBLIC_JWK] }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    }

    if (delegate) {
      return delegate(input, init);
    }

    throw new Error(`Unexpected fetch during Cloudflare OIDC test: ${String(input)}`);
  }));
}

function createTestVercelOidcToken(
  input: Partial<{
    aud: string;
    iss: string;
    sub: string;
  }> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    kid: "test-kid",
    typ: "JWT",
  };
  const payload = {
    aud: TEST_VERCEL_OIDC_AUDIENCE,
    exp: now + 300,
    iat: now,
    iss: TEST_VERCEL_OIDC_ISSUER,
    sub: TEST_VERCEL_OIDC_SUBJECT,
    ...input,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), TEST_VERCEL_OIDC_PRIVATE_KEY);

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
