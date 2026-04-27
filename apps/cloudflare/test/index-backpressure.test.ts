import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type HostedIngressEnvelope,
} from "@murphai/hosted-execution";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import worker, { UserRunnerDurableObject } from "../src/index.ts";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  createHostedUserKeyStore,
} from "../src/user-key-store.ts";
import {
  asWorkerStringEnvironment,
} from "../src/worker-contracts.ts";
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
    await harness.durableObject.bootstrapUser("member_123");
    await provisionManagedUserCryptoAtActivationForTest(harness.env as never, "member_123");

    const overflowResponse = await worker.fetch(
      await createSignedWakeRequest("/internal/dispatch", createWake("evt_overflow")),
      harness.env as never,
    );

    expect(overflowResponse.status).toBe(404);
    await expect(overflowResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("accepts the runner nudge route without relying on legacy local queue state", async () => {
    const harness = createUserRunnerDurableObject({
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });
    const stub = {
      bootstrapUser: vi.fn(async (userId: string) => ({ userId })),
      drainHostedRuns: vi.fn(),
      nudgeHostedRun: vi.fn(),
      nudgeHostedRunner: vi.fn(async () => ({
        accepted: true,
        alarmScheduled: false,
        alreadyRunning: false,
        inFlight: false,
        leaseGeneration: "0",
        nextAlarmAt: null,
      })),
      runnerStatus: vi.fn(),
      status: vi.fn(async () => ({
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: null,
        lastRunAt: null,
        nextWakeAt: null,
        pendingIngressEventCount: 0,
        userId: "member_123",
      })),
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

    expect(runResponse.status).toBe(202);
    await expect(runResponse.json()).resolves.toEqual({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      inFlight: false,
      leaseGeneration: "0",
      nextAlarmAt: null,
    });
    expect(stub.bootstrapUser).toHaveBeenCalledWith("member_123");
    expect(stub.nudgeHostedRunner).toHaveBeenCalledTimes(1);
    expect(stub.drainHostedRuns).not.toHaveBeenCalled();
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

async function provisionManagedUserCryptoAtActivationForTest(
  env: ReturnType<typeof createUserRunnerDurableObject>["env"],
  userId: string,
): Promise<void> {
  const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));
  const store = createHostedUserKeyStore({
    automationRecipientKeyId: environment.automationRecipientKeyId,
    automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: environment.automationRecipientPublicKey,
    bucket: env.BUNDLES,
    envelopeEncryptionKey: environment.platformEnvelopeKey,
    envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
    envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
    recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
    teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
  });
  await store.provisionManagedUserCryptoAtActivation(userId);
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
    },
  };
}

function createWake(eventId: string): HostedIngressEnvelope {
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
  wake: HostedIngressEnvelope,
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
