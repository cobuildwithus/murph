/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import {
  afterEach,
  describe as baseDescribe,
  expect,
  it,
  vi,
} from "vitest";

import { createHostedBundleStore } from "../../src/bundle-store.js";
import { createHostedExecutionJournalStore } from "../../src/execution-journal.js";
import { readHostedExecutionEnvironment } from "../../src/env.js";
import { handleRunnerOutboundRequest } from "../../src/runner-outbound.js";
import { createHostedUserKeyStore } from "../../src/user-key-store.js";

const RUNNER_PROXY_TOKEN = "runner-proxy-token";
const RUNNER_PROXY_TOKEN_HEADER = "x-hosted-execution-runner-proxy-token";
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

import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchResult,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";

interface UserRunnerRpcStub {
  bootstrapUser(userId: string): Promise<{ userId: string }>;
  clearUserEnv(): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus>;
  dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult>;
  getUserEnvStatus(): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  status(): Promise<HostedExecutionUserStatus>;
  updateUserEnv(update: { env: Record<string, string | null>; mode: "merge" | "replace" }): Promise<{
    configuredUserEnvKeys: string[];
    userId: string;
  }>;
}

const describe = baseDescribe.sequential;
const worker = (exports as {
  default: {
    fetch(input: Request): Promise<Response>;
  };
}).default;

describe("cloudflare worker runtime suite", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects invalid signed dispatches before they reach the user runner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const response = await worker.fetch(
      await createSignedDispatchRequest("/internal/dispatch", createDispatch("evt_invalid"), {
        sub: `owner:${TEST_VERCEL_OIDC_TEAM_SLUG}:project:wrong-project:environment:production`,
      }),
    );

    expect(response.status).toBe(401);
    const stub = getUserRunnerStub("member_invalid");
    await expect(stub.bootstrapUser("member_invalid")).resolves.toEqual({
      userId: "member_invalid",
    });
    await expect(stub.status()).resolves.toMatchObject({
      lastEventId: null,
      pendingEventCount: 0,
      userId: "member_invalid",
    });
  });

  it("accepts signed dispatches in the Workers runtime and writes durable bundle state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const dispatch = createDispatch("evt_signed_runtime", "member_signed_runtime");
    await resolveHostedUserCryptoContext(dispatch.event.userId);
    const response = await worker.fetch(
      await createSignedDispatchRequest("/internal/dispatch", dispatch),
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as HostedExecutionDispatchResult;
    expect(payload).toMatchObject({
      event: {
        eventId: "evt_signed_runtime",
        state: "completed",
      },
      status: {
        bundleRef: expect.objectContaining({
          key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
        }),
        lastEventId: "evt_signed_runtime",
        nextWakeAt: "2026-03-26T12:01:00.000Z",
        pendingEventCount: 0,
        retryingEventId: null,
        userId: dispatch.event.userId,
      },
    });
    await expect(readBundleText(dispatch.event.userId, payload.status.bundleRef)).resolves.toBe(
      `vault:${dispatch.eventId}`,
    );
  });

  it("keeps the removed internal events alias hidden in the Workers runtime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const userId = "member_removed_alias";

    const response = await worker.fetch(
      await createSignedDispatchRequest("/internal/events", createDispatch("evt_removed_alias", userId)),
    );

    expect(response.status).toBe(404);
    await expect(getUserRunnerStub(userId).bootstrapUser(userId)).resolves.toEqual({
      userId,
    });
    await expect(getUserRunnerStub(userId).status()).resolves.toMatchObject({
      lastEventId: null,
      pendingEventCount: 0,
      userId,
    });
  });

  it("supports direct Durable Object RPC and alarm execution inside the Workers runtime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const userId = "member_alarm";
    await resolveHostedUserCryptoContext(userId);
    const stub = getUserRunnerStub(userId);
    const initialStatus = await stub.dispatch(createDispatch("evt_alarm_seed", userId));

    expect(initialStatus.lastEventId).toBe("evt_alarm_seed");
    await expect(runDurableObjectAlarm(stub as never)).resolves.toBeTypeOf("boolean");
    await vi.waitFor(async () => {
      await expect(stub.status()).resolves.toMatchObject({
        lastEventId: expect.stringMatching(/^alarm:/u),
        pendingEventCount: 0,
        retryingEventId: null,
        userId,
      });
    });
  });

  it("supports direct Durable Object user-env updates inside the Workers runtime", async () => {
    const userId = "member_control";
    await resolveHostedUserCryptoContext(userId);
    const stub = getUserRunnerStub(userId);
    await expect(stub.bootstrapUser(userId)).resolves.toEqual({ userId });

    await expect(stub.updateUserEnv({
      env: {
        OPENAI_API_KEY: "test-key",
      },
      mode: "merge",
    })).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId,
    });

    await expect(stub.getUserEnvStatus()).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId,
    });
    await expect(stub.clearUserEnv()).resolves.toEqual({
      configuredUserEnvKeys: [],
      userId,
    });
  });

  it("rejects removed, operator-only, and unknown hosted user env keys through direct Durable Object RPC", async () => {
    const userId = "member_control_env_reject";
    await resolveHostedUserCryptoContext(userId);
    const stub = getUserRunnerStub(userId);
    await expect(stub.bootstrapUser(userId)).resolves.toEqual({ userId });

    let rejectedError: unknown = null;
    try {
      await stub.updateUserEnv({
        env: {
          AGENTMAIL_API_BASE_URL: "https://legacy-mail.example.test/v0",
          AGENTMAIL_TIMEOUT_MS: "5000",
          FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
          FFMPEG_THREADS: "2",
          NODE_OPTIONS: "--require /tmp/evil-loader.js",
          PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
        },
        mode: "merge",
      });
    } catch (error) {
      rejectedError = error;
    }

    expect(String(rejectedError)).toMatch(/Hosted user env key is not allowed/u);
    await expect(stub.getUserEnvStatus()).resolves.toEqual({
      configuredUserEnvKeys: [],
      userId,
    });

    await expect(stub.updateUserEnv({
      env: {
        OPENAI_API_KEY: "sk-user",
      },
      mode: "merge",
    })).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId,
    });
  });

  it("hard-cuts the removed finalize route from the internal runner outbound handlers in the Workers runtime", async () => {
    const userId = "member_journal";
    const eventId = "evt_finalize_runtime";
    await resolveHostedUserCryptoContext(userId);

    const commitResponse = await callRunnerOutbound(
      new Request(`http://results.worker/events/${eventId}/commit`, {
        body: JSON.stringify({
          bundle: btoa("vault-commit"),
          currentBundleRef: null,
          result: {
            eventsHandled: 1,
            summary: "committed",
          },
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      userId,
    );

    expect(commitResponse.status).toBe(200);

    const finalizeResponse = await callRunnerOutbound(
      new Request(`http://results.worker/events/${eventId}/finalize`, {
        body: JSON.stringify({
          bundle: btoa("vault-final"),
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      userId,
    );

    expect(finalizeResponse.status).toBe(404);
    await expect((await createJournalStore(userId)).readCommittedResult(userId, eventId)).resolves.toMatchObject({
      eventId,
      finalizedAt: null,
      result: {
        summary: "committed",
      },
    });
  });
});

function createDispatch(
  eventId: string,
  userId = "member_invalid",
): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "member.activated",
      userId,
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
  const payload = JSON.stringify(dispatch);
  const request = new Request(`https://runner.example.test${path}`, {
    body: payload,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
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

async function resolveHostedUserCryptoContext(userId: string) {
  const environment = readHostedExecutionEnvironment(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );

  return createHostedUserKeyStore({
    automationRecipientKeyId: environment.automationRecipientKeyId,
    automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: environment.automationRecipientPublicKey,
    bucket: (env as { BUNDLES: never }).BUNDLES,
    envelopeEncryptionKey: environment.platformEnvelopeKey,
    envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
    envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
    recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
    teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
  }).bootstrapManagedUserCryptoContext(userId);
}

async function createJournalStore(userId: string) {
  const crypto = await resolveHostedUserCryptoContext(userId);
  return createHostedExecutionJournalStore({
    bucket: (env as { BUNDLES: never }).BUNDLES,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
  });
}

async function createBundleStore(userId: string) {
  const crypto = await resolveHostedUserCryptoContext(userId);
  return createHostedBundleStore({
    bucket: (env as { BUNDLES: never }).BUNDLES,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
  });
}

async function readBundleText(
  userId: string,
  bundleRef: HostedExecutionBundleRef | null,
): Promise<string | null> {
  const bundle = await (await createBundleStore(userId)).readBundle(bundleRef);

  if (!bundle) {
    return null;
  }

  return new TextDecoder().decode(bundle);
}

function callRunnerOutbound(request: Request, userId: string): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set(RUNNER_PROXY_TOKEN_HEADER, RUNNER_PROXY_TOKEN);
  return handleRunnerOutboundRequest(
    new Request(request, { headers }),
    env as unknown as Parameters<typeof handleRunnerOutboundRequest>[1],
    userId,
    RUNNER_PROXY_TOKEN,
  );
}

function getUserRunnerStub(userId: string): UserRunnerRpcStub {
  return ((env as { USER_RUNNER: { getByName(name: string): UserRunnerRpcStub } }).USER_RUNNER)
    .getByName(userId);
}
