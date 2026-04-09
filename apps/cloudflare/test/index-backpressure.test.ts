import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution";
import worker, { UserRunnerDurableObject } from "../src/index.ts";

import { MAX_PENDING_EVENTS } from "../src/user-runner/types.js";
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

  it("returns HTTP 429 when signed dispatch backpressures a full per-user queue", async () => {
    const harness = createUserRunnerDurableObject();
    await seedFullRunnerQueue(harness, "member_123");

    const overflowResponse = await worker.fetch(
      await createSignedDispatchRequest("/internal/dispatch", createDispatch("evt_overflow")),
      harness.env as never,
    );

    expect(overflowResponse.status).toBe(429);
    await expect(overflowResponse.json()).resolves.toMatchObject({
      event: {
        eventId: "evt_overflow",
        state: "backpressured",
      },
      status: {
        backpressuredEventIds: ["evt_overflow"],
        poisonedEventIds: [],
      },
    });
  });

  it("returns HTTP 429 for manual runs when the queue is already full", async () => {
    const harness = createUserRunnerDurableObject({
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });
    await seedFullRunnerQueue(harness, "member_123");

    const runResponse = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/run", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "POST",
      })),
      harness.env as never,
    );

    expect(runResponse.status).toBe(429);
    await expect(runResponse.json()).resolves.toMatchObject({
      backpressuredEventIds: [expect.stringMatching(/^manual:/u)],
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

async function seedFullRunnerQueue(
  harness: ReturnType<typeof createUserRunnerDurableObject>,
  userId: string,
): Promise<void> {
  await harness.durableObject.bootstrapUser(userId);
  await harness.durableObject.provisionManagedUserCrypto(userId);
  const sql = harness.storage.state.storage.sql;
  if (!sql) {
    throw new Error("Test storage.sql is required.");
  }
  for (let index = 0; index < MAX_PENDING_EVENTS; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 2, 26, 12, 0, index)).toISOString();
    sql.exec(
      `INSERT INTO pending_events (
        event_id,
        payload_key,
        attempts,
        available_at,
        enqueued_at,
        last_error_code
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      `evt_seed_${index.toString().padStart(3, "0")}`,
      `seeded/payload/${index.toString().padStart(3, "0")}`,
      0,
      timestamp,
      timestamp,
      null,
    );
  }
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
        };
      },
    },
    state: {
      storage: {
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

function createDispatch(eventId: string): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "assistant.cron.tick",
      reason: "manual",
      userId: "member_123",
    },
    eventId,
    occurredAt: "2026-03-26T12:00:00.000Z",
  };
}

async function createSignedDispatchRequest(
  path: string,
  dispatch: HostedExecutionDispatchRequest,
  input: {
    aud?: string;
    iss?: string;
    sub?: string;
  } = {},
): Promise<Request> {
  installOidcJwksFetch();

  return new Request(`https://runner.example.test${path}`, {
    body: JSON.stringify(dispatch),
    headers: {
      authorization: `Bearer ${createTestVercelOidcToken(input)}`,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
}

async function signControlRequest(
  request: Request,
  input: {
    aud?: string;
    iss?: string;
    sub?: string;
  } = {},
): Promise<Request> {
  installOidcJwksFetch();
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${createTestVercelOidcToken(input)}`);

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
