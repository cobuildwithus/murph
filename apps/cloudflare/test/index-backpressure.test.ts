import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import { HOSTED_RUNTIME_STATUS_PATH } from "@murphai/hosted-execution/routes";
import worker, { UserRunnerDurableObject } from "../src/index.ts";
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

  it("exposes runtime write-fence methods for deploy smoke on the user runner durable object", async () => {
    const harness = createUserRunnerDurableObject();
    await harness.durableObject.bindUser("member_123");

    const lease = await harness.durableObject.beginRuntimeWriteFenceForSmoke({
      userId: "member_123",
      workspaceVersion: "7",
    });

    expect(lease).toMatchObject({
      reason: "manual",
      userId: "member_123",
      workspaceVersion: "7",
    });
    expect(lease).not.toBeNull();
    if (!lease) {
      throw new Error("Expected runtime write fence.");
    }

    await expect(harness.durableObject.validateRuntimeWriteFence({
      attemptId: lease.attemptId,
      generation: lease.generation,
      userId: "member_123",
    })).resolves.toBe(true);

    await expect(harness.durableObject.finishRuntimeWriteFenceForSmoke({
      attemptId: lease.attemptId,
      generation: lease.generation,
      userId: "member_123",
    })).resolves.toEqual({ completed: true });
  });

  it("keeps an active write fence in flight through the production Durable Object constructor", async () => {
    const harness = createUserRunnerDurableObject({
      CF_VERSION_METADATA: {
        id: "worker_version_current",
      },
    });
    const stateStore = new RunnerStateStore(harness.storage.state);
    await stateStore.bindUser("member_123");
    await stateStore.beginInvocation({
      expiresAt: "2999-01-01T00:00:00.000Z",
      reason: "manual",
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

      throw new Error(`Unexpected fetch during Cloudflare backpressure test: ${url.origin}${url.pathname}`);
    });

    await expect(harness.durableObject.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "backpressure-active-fence-test",
      reason: "nudge",
      userId: "member_123",
    })).resolves.toMatchObject({
      kind: "retry_later",
      retryAt: expect.any(String),
    });
    const state = await stateStore.readState();

    expect(state.writeFence).toMatchObject({
      expiresAt: "2999-01-01T00:00:00.000Z",
      kind: "runtime",
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
      async delete(key: string) {
        values.delete(key);
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
