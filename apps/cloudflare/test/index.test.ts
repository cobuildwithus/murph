import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ContainerProxy as PackageContainerProxy } from "@cloudflare/containers";
import type { HostedAssistantRuntimeJobResult } from "@murphai/assistant-runtime";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "../src/crypto-context.ts";
import { writeEncryptedR2Json } from "../src/crypto.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import worker, { ContainerProxy as ExportedContainerProxy } from "../src/index.ts";
import { createLocalInternalProxyUserToken } from "../src/local-internal-proxy-token.ts";
import { hostedArtifactObjectKey } from "../src/storage-paths.ts";
import { createHostedUserKeyStore } from "../src/user-key-store.ts";
import { asWorkerStringEnvironment } from "../src/worker-contracts.ts";
import type {
  UserRunnerDurableObjectStubLike,
  WorkerEnvironmentSource,
} from "../src/worker-routes/shared.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import {
  buildHostedExecutionAssistantCronTickWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import { afterEach, describe as baseDescribe, expect, it, vi } from "vitest";

import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures";

const describe = baseDescribe.sequential;
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(TEST_DIR, "..");

const RUNNER_PROXY_TOKEN = "runner-proxy-token";
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cloudflare worker routes", () => {
  it("re-exports ContainerProxy for container outbound routing", () => {
    expect(ExportedContainerProxy).toBe(PackageContainerProxy);
  });

  it("keeps inbox email parsing isolated to the hosted email ingress module", async () => {
    const [workerSource, hostedEmailIngressSource] = await Promise.all([
      readFile(path.join(APP_DIR, "src/index.ts"), "utf8"),
      readFile(path.join(APP_DIR, "src/hosted-email/worker-ingress.ts"), "utf8"),
    ]);

    expect(workerSource).not.toMatch(/from "@murphai\/inboxd";/u);
    expect(workerSource).not.toMatch(/@murphai\/inboxd\/connectors\/email\/parsed/u);
    expect(hostedEmailIngressSource).not.toMatch(/from "@murphai\/inboxd";/u);
    expect(hostedEmailIngressSource).toMatch(/@murphai\/inboxd\/connectors\/email\/parsed/u);
  });

  it("serves a health endpoint even before secrets are configured", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/health"),
      {
        BUNDLES: createBucketStore().api,
        RUNNER_CONTAINER: createRunnerContainerNamespace(),
        USER_RUNNER: {
          getByName() {
            return createUserRunnerStub();
          },
        },
      } as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "cloudflare-hosted-runner",
    });
  });

  it("serves the service banner for root and health and 404s unknown routes", async () => {
    const rootResponse = await worker.fetch(
      new Request("https://runner.example.test/"),
      createWorkerEnv(),
    );

    expect(rootResponse.status).toBe(200);
    await expect(rootResponse.json()).resolves.toEqual({
      ok: true,
      service: "cloudflare-hosted-runner",
    });

    const healthResponse = await worker.fetch(
      new Request("https://runner.example.test/health"),
      createWorkerEnv(),
    );

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toEqual({
      ok: true,
      service: "cloudflare-hosted-runner",
    });

    const unknownResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/events"),
      createWorkerEnv(),
    );

    expect(unknownResponse.status).toBe(404);
    await expect(unknownResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("proxies local loopback requests through the worker when a local proxy token is configured", async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify({
        ok: true,
        proxied: input instanceof Request ? input.url : String(input),
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          connection: "keep-alive",
        },
        status: 202,
      }));
    vi.stubGlobal("fetch", upstreamFetch as typeof fetch);

    const response = await worker.fetch(
      new Request(
        "https://runner.example.test/__murph/local-loopback-proxy/local-token/http%3A%2F%2F127.0.0.1%3A8788/chats/chat_123/messages?foo=bar",
        {
          body: JSON.stringify({ message: "hello" }),
          headers: {
            authorization: "Bearer local",
            connection: "keep-alive",
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      ),
      createWorkerEnv(createUserRunnerStub(), {
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-token",
      }),
    );

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [upstreamInput] = upstreamFetch.mock.calls[0] ?? [];
    expect(upstreamInput).toBeInstanceOf(Request);
    const upstreamRequest = upstreamInput as Request;
    expect(upstreamRequest.url).toBe("http://127.0.0.1:8788/chats/chat_123/messages?foo=bar");
    expect(upstreamRequest.method).toBe("POST");
    expect(await upstreamRequest.text()).toBe(JSON.stringify({ message: "hello" }));
    expect(upstreamRequest.headers.get("authorization")).toBe("Bearer local");
    expect(upstreamRequest.headers.get("connection")).toBeNull();

    expect(response.status).toBe(202);
    expect(response.headers.get("connection")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      ok: true,
      proxied: "http://127.0.0.1:8788/chats/chat_123/messages?foo=bar",
    });
  });

  it("streams local loopback proxy POST bodies to a real loopback upstream", async () => {
    const observedRequests: Array<{
      body: string;
      headers: Record<string, string | string[] | undefined>;
      method: string;
      url: string;
    }> = [];
    const server = createServer(async (request, response) => {
      observedRequests.push({
        body: await readIncomingMessageBody(request),
        headers: request.headers,
        method: request.method ?? "GET",
        url: request.url ?? "/",
      });
      response.statusCode = 201;
      response.setHeader("connection", "keep-alive");
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the loopback proxy test server to expose a TCP port.");
      }

      const response = await worker.fetch(
        new Request(
          `https://runner.example.test/__murph/local-loopback-proxy/local-token/${encodeURIComponent(`http://127.0.0.1:${address.port}`)}/chats/chat_123/messages?foo=bar`,
          {
            body: JSON.stringify({ message: "hello" }),
            headers: {
              authorization: "Bearer local",
              connection: "keep-alive",
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          },
        ),
        createWorkerEnv(createUserRunnerStub(), {
          HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-token",
        }),
      );

      expect(response.status).toBe(201);
      expect(response.headers.get("connection")).toBeNull();
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(observedRequests).toHaveLength(1);
      expect(observedRequests[0]).toMatchObject({
        body: JSON.stringify({ message: "hello" }),
        headers: expect.objectContaining({
          authorization: "Bearer local",
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
        url: "/chats/chat_123/messages?foo=bar",
      });
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it("rejects non-loopback local proxy targets and bad local proxy tokens", async () => {
    const env = createWorkerEnv(createUserRunnerStub(), {
      HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-token",
    });

    const unauthorizedResponse = await worker.fetch(
      new Request(
        "https://runner.example.test/__murph/local-loopback-proxy/wrong-token/http%3A%2F%2F127.0.0.1%3A8788/ping",
      ),
      env,
    );
    expect(unauthorizedResponse.status).toBe(401);

    const invalidTargetResponse = await worker.fetch(
      new Request(
        "https://runner.example.test/__murph/local-loopback-proxy/local-token/http%3A%2F%2Fexample.com%2Fapi/ping",
      ),
      env,
    );
    expect(invalidTargetResponse.status).toBe(400);
    await expect(invalidTargetResponse.json()).resolves.toEqual({
      error: "Local loopback proxy only supports loopback http(s) targets.",
    });
  });

  it("routes local internal proxy requests onto the results.worker handler", async () => {
    const env = createWorkerEnv(undefined, {
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "https://runner.example.test",
      HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-token",
    });
    const runnerProxyToken = await createLocalInternalProxyUserToken({
      boundUserId: "member_123",
      proxyTokenSecret: "local-token",
    });

    const writeResponse = await worker.fetch(
      new Request(
        "https://runner.example.test/__murph/local-internal-proxy/local-token/results.worker/effects/outbox_local_internal?fingerprint=dedupe_local_internal",
        {
          body: JSON.stringify(createPreparedSideEffectRecord({
            effectId: "outbox_local_internal",
            fingerprint: "dedupe_local_internal",
          })),
          headers: {
            "content-type": "application/json; charset=utf-8",
            [HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER]: runnerProxyToken,
            [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
          },
          method: "PUT",
        },
      ),
      env,
    );

    expect(writeResponse.status).toBe(200);

    const missingProxyTokenResponse = await worker.fetch(
      new Request(
        "https://runner.example.test/__murph/local-internal-proxy/local-token/results.worker/effects/outbox_local_internal?fingerprint=dedupe_local_internal",
        {
          headers: {
            [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
          },
          method: "GET",
        },
      ),
      env,
    );

    expect(missingProxyTokenResponse.status).toBe(401);
    await expect(missingProxyTokenResponse.json()).resolves.toEqual({
      error: `${HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER} header is required for local internal proxy requests.`,
    });

    const readResponse = await worker.fetch(
      new Request(
        "https://runner.example.test/__murph/local-internal-proxy/local-token/results.worker/effects/outbox_local_internal?fingerprint=dedupe_local_internal",
        {
          headers: {
            [HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER]: runnerProxyToken,
            [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
          },
          method: "GET",
        },
      ),
      env,
    );

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      effectId: "outbox_local_internal",
      record: {
        effectId: "outbox_local_internal",
        kind: "assistant.delivery",
        state: "sending",
      },
    });
  });

  it("rejects local internal proxy requests when the proxy token is replayed against another user", async () => {
    const env = createWorkerEnv(undefined, {
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "https://runner.example.test",
      HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-token",
    });
    const runnerProxyToken = await createLocalInternalProxyUserToken({
      boundUserId: "member_123",
      proxyTokenSecret: "local-token",
    });

    const response = await worker.fetch(
      new Request(
        "https://runner.example.test/__murph/local-internal-proxy/local-token/results.worker/effects/outbox_local_internal?fingerprint=dedupe_local_internal",
        {
          headers: {
            [HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER]: runnerProxyToken,
            [HOSTED_EXECUTION_USER_ID_HEADER]: "member_456",
          },
          method: "GET",
        },
      ),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("does not expose the removed manual-run route", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/run", {
        method: "POST",
      })),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(404);
    expect(stub.bootstrapUser).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("keeps the removed internal dispatch route hidden from OIDC callers", async () => {
    const stub = createUserRunnerStub();
    const wake = createWake("evt_123");
    const request = await createSignedWakeRequest("/internal/dispatch", wake);

    const response = await worker.fetch(
      request,
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(404);
    expect(stub.bootstrapUser).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("hard-cuts bound-user checks with a 404 before dispatch route auth runs", async () => {
    const stub = createUserRunnerStub();
    const wake = createWake("evt_123");

    const missingHeaderResponse = await worker.fetch(
      await createSignedWakeRequest("/internal/dispatch", wake, { boundUserId: null }),
      createWorkerEnv(stub),
    );

    expect(missingHeaderResponse.status).toBe(404);
    await expect(missingHeaderResponse.json()).resolves.toEqual({
      error: "Not found",
    });

    const mismatchedHeaderResponse = await worker.fetch(
      await createSignedWakeRequest("/internal/dispatch", wake, { boundUserId: "member_other" }),
      createWorkerEnv(stub),
    );

    expect(mismatchedHeaderResponse.status).toBe(404);
    await expect(mismatchedHeaderResponse.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(stub.bootstrapUser).not.toHaveBeenCalled();
  });

  it("keeps the removed legacy-reference dispatch route hidden from OIDC callers", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      await createSignedJsonControlRequest("/internal/dispatch/legacy-reference", {
        dispatchRef: {
          eventId: "evt_legacy",
          eventKind: "gateway.message.send",
          occurredAt: "2026-04-16T10:00:00.000Z",
          userId: "member_123",
        },
        stagedPayloadId: "staged/evt_legacy",
        storage: "reference",
      }, {
        boundUserId: "member_123",
      }),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(404);
    expect(stub.bootstrapUser).not.toHaveBeenCalled();
  });

  it("keeps the removed internal events alias hidden from OIDC dispatch callers", async () => {
    const stub = createUserRunnerStub();
    const request = await createSignedWakeRequest("/internal/events", createWake("evt_removed_alias"));

    const response = await worker.fetch(request, createWorkerEnv(stub));

    expect(response.status).toBe(404);
    expect(stub.bootstrapUser).not.toHaveBeenCalled();
  });

  it("keeps the removed dispatch route hidden even for missing, malformed, and mismatched OIDC bearer requests", async () => {
    const stub = createUserRunnerStub();
    const wake = createWake("evt_signed");

    const missingAuthorizationResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/dispatch", {
        body: JSON.stringify(wake),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stub),
    );
    expect(missingAuthorizationResponse.status).toBe(404);
    await expect(missingAuthorizationResponse.json()).resolves.toEqual({
      error: "Not found",
    });

    const malformedResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/dispatch", {
        body: JSON.stringify(wake),
        headers: {
          authorization: "Bearer not-a-jwt",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stub),
    );
    expect(malformedResponse.status).toBe(404);
    await expect(malformedResponse.json()).resolves.toEqual({
      error: "Not found",
    });

    const wrongSubjectResponse = await worker.fetch(
      await createSignedWakeRequest("/internal/dispatch", wake, {
        sub: `owner:${TEST_VERCEL_OIDC_TEAM_SLUG}:project:wrong-project:environment:production`,
      }),
      createWorkerEnv(stub),
    );
    expect(wrongSubjectResponse.status).toBe(404);
    await expect(wrongSubjectResponse.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(stub.bootstrapUser).not.toHaveBeenCalled();
  });

  it("reads canonical per-user status while keeping the per-event status route removed", async () => {
    const stub = createUserRunnerStub({
      status: vi.fn(async () => ({
        backpressuredEventIds: [],
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: "evt_done",
        lastRunAt: "2026-04-16T10:05:00.000Z",
        nextWakeAt: null,
        pendingEventCount: 0,
        poisonedEventIds: [],
        retryingEventId: null,
        userId: "member_123",
      })),
    });

    const statusResponse = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/status", {
        method: "GET",
      })),
      createWorkerEnv(stub),
    );

    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      lastEventId: "evt_done",
      userId: "member_123",
    });

    const eventStatusResponse = await worker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/internal/users/member_123/events/evt_done/status",
        { method: "GET" },
      )),
      createWorkerEnv(stub),
    );

    expect(eventStatusResponse.status).toBe(404);
    await expect(eventStatusResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("stores and reads encrypted hosted artifact objects through the outbound artifacts.worker handler", async () => {
    const env = createWorkerEnv();
    const artifactBytes = Buffer.from("artifact-payload\n", "utf8");
    const artifactSha256 = "fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b";

    const writeResponse = await callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        body: artifactBytes,
        headers: {
          "content-type": "application/octet-stream",
        },
        method: "PUT",
      }),
      env,
    );

    expect(writeResponse.status).toBe(200);
    await expect(writeResponse.json()).resolves.toMatchObject({
      ok: true,
      sha256: artifactSha256,
      size: artifactBytes.byteLength,
    });

    const readResponse = await callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        method: "GET",
      }),
      env,
    );

    expect(readResponse.status).toBe(200);
    expect(Buffer.from(await readResponse.arrayBuffer())).toEqual(artifactBytes);
    await expect(hostedArtifactObjectKeyForTest(env, "member_123", artifactSha256)).resolves.toSatisfy(
      (expectedKey) => env.__bucketStore.keys().includes(expectedKey),
    );
  });

  it("rejects artifact writes when the request hash does not match the payload", async () => {
    const env = createWorkerEnv();
    const artifactSha256 = "fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b";

    await expect(() => callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        body: Buffer.from("wrong-payload\n", "utf8"),
        headers: {
          "content-type": "application/octet-stream",
        },
        method: "PUT",
      }),
      env,
    )).rejects.toThrow(
      `Hosted artifact hash mismatch: expected ${artifactSha256}`,
    );

    expect(env.__bucketStore.keys()).toHaveLength(1);
    await expect(hostedUserKeyEnvelopeObjectKeyForTest(env, "member_123")).resolves.toBe(
      env.__bucketStore.keys()[0],
    );
  });

  it("keeps hosted artifact objects isolated per user", async () => {
    const env = createWorkerEnv();
    const artifactBytes = Buffer.from("artifact-payload\n", "utf8");
    const artifactSha256 = "fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b";

    const writeResponse = await callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        body: artifactBytes,
        headers: {
          "content-type": "application/octet-stream",
        },
        method: "PUT",
      }),
      env,
      "member_alpha",
    );

    expect(writeResponse.status).toBe(200);

    const readResponse = await callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        method: "GET",
      }),
      env,
      "member_bravo",
    );

    expect(readResponse.status).toBe(404);
    await expect(hostedArtifactObjectKeyForTest(env, "member_alpha", artifactSha256)).resolves.toSatisfy(
      (expectedKey) => env.__bucketStore.keys().includes(expectedKey),
    );
  });

  it("hard-cuts the removed commit and finalize routes from the outbound results.worker handler", async () => {
    const env = createWorkerEnv();

    const commitResponse = await callRunnerOutbound(
      new Request("http://results.worker/events/evt_finalize/commit", {
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    const finalizeResponse = await callRunnerOutbound(
      new Request("http://results.worker/events/evt_finalize/finalize", {
        body: JSON.stringify({
          bundle: Buffer.from("vault-final").toString("base64"),
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );

    expect(commitResponse.status).toBe(404);
    expect(finalizeResponse.status).toBe(404);
  });

  it("keeps removed outbound callback routes hidden from public and internal callers", async () => {
    const env = createWorkerEnv();

    const removedFinalizeResponse = await callRunnerOutbound(
      new Request("http://results.worker/events/evt_finalize_auth/finalize", {
        body: JSON.stringify({
          bundle: 42,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    expect(removedFinalizeResponse.status).toBe(404);

    const removedCommitResponse = await callRunnerOutbound(
      new Request("http://results.worker/events/evt_bad_commit/commit", {
        body: JSON.stringify({
          ignored: true,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    expect(removedCommitResponse.status).toBe(404);

    const publicCommitResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_commit/commit", {
        method: "POST",
      }),
      env,
    );
    expect(publicCommitResponse.status).toBe(404);

    const publicOutboxResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-outbox/member_123/outbox_123", {
        method: "GET",
      }),
      env,
    );
    expect(publicOutboxResponse.status).toBe(404);
  });

  it("persists side-effect journal records through the side-effects route and reads them back through the outbox route", async () => {
    const env = createWorkerEnv();

    const response = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_123?fingerprint=dedupe_123", {
        body: JSON.stringify(createPreparedSideEffectRecord({
          effectId: "outbox_123",
          fingerprint: "dedupe_123",
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    expect(response.status).toBe(200);

    const readResponse = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_123?fingerprint=dedupe_123", {
        method: "GET",
      }),
      env,
    );

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      effectId: "outbox_123",
      record: {
        effectId: "outbox_123",
        kind: "assistant.delivery",
        state: "sending",
      },
    });
  });

  it("reads side-effect journal records even when the outbound bridge drops the fingerprint query", async () => {
    const env = createWorkerEnv();

    await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_missing_fingerprint?fingerprint=dedupe_missing", {
        body: JSON.stringify(createPreparedSideEffectRecord({
          effectId: "outbox_missing_fingerprint",
          fingerprint: "dedupe_missing",
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    const response = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_missing_fingerprint", {
        method: "GET",
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      effectId: "outbox_missing_fingerprint",
      record: {
        effectId: "outbox_missing_fingerprint",
        kind: "assistant.delivery",
        state: "sending",
      },
    });
  });

  it("returns 409 when the same effect id is reused with a mismatched fingerprint", async () => {
    const env = createWorkerEnv();

    await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_a?fingerprint=dedupe_123", {
        body: JSON.stringify(createPreparedSideEffectRecord({
          effectId: "outbox_a",
          fingerprint: "dedupe_123",
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    const conflictResponse = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_a?fingerprint=dedupe_conflict", {
        body: JSON.stringify(createPreparedSideEffectRecord({
          effectId: "outbox_a",
          fingerprint: "dedupe_conflict",
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("cannot change identity"),
    });
  });

  it("deletes only non-terminal side-effect reservations through the side-effects route", async () => {
    const env = createWorkerEnv();

    await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_prepared?fingerprint=dedupe_prepared", {
        body: JSON.stringify(createPreparedSideEffectRecord({
          effectId: "outbox_prepared",
          fingerprint: "dedupe_prepared",
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );
    await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_sent?fingerprint=dedupe_sent", {
        body: JSON.stringify(createSentSideEffectRecord({
          effectId: "outbox_sent",
          fingerprint: "dedupe_sent",
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    const deletePreparedResponse = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_prepared?fingerprint=dedupe_prepared", {
        method: "DELETE",
      }),
      env,
    );
    expect(deletePreparedResponse.status).toBe(200);

    const readPreparedResponse = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_prepared?fingerprint=dedupe_prepared", {
        method: "GET",
      }),
      env,
    );
    await expect(readPreparedResponse.json()).resolves.toMatchObject({
      effectId: "outbox_prepared",
      record: null,
    });

    const deleteSentResponse = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_sent?fingerprint=dedupe_sent", {
        method: "DELETE",
      }),
      env,
    );
    expect(deleteSentResponse.status).toBe(200);

    const readSentResponse = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_sent?fingerprint=dedupe_sent", {
        method: "GET",
      }),
      env,
    );
    await expect(readSentResponse.json()).resolves.toMatchObject({
      effectId: "outbox_sent",
      record: {
        effectId: "outbox_sent",
        kind: "assistant.delivery",
        state: "sent",
      },
    });
  });

  it("deletes non-terminal side-effect reservations even when the outbound bridge omits the fingerprint query", async () => {
    const env = createWorkerEnv();

    await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_delete_missing_fingerprint?fingerprint=dedupe_delete_missing", {
        body: JSON.stringify(createPreparedSideEffectRecord({
          effectId: "outbox_delete_missing_fingerprint",
          fingerprint: "dedupe_delete_missing",
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    const deleteResponse = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_delete_missing_fingerprint", {
        method: "DELETE",
      }),
      env,
    );
    expect(deleteResponse.status).toBe(200);

    const readResponse = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_delete_missing_fingerprint", {
        method: "GET",
      }),
      env,
    );
    await expect(readResponse.json()).resolves.toMatchObject({
      effectId: "outbox_delete_missing_fingerprint",
      record: null,
    });
  });

  it("reads pre-existing side-effect journal records through the outbound route using the user's root key", async () => {
    const env = createWorkerEnv();
    const record = createSentSideEffectRecord({
      effectId: "outbox_rotated",
      fingerprint: "dedupe_rotated",
    });
    const crypto = await resolveHostedUserCryptoContextForTest(env, "member_123");
    const key = await sideEffectRecordObjectKey(crypto.rootKey, "member_123", record.effectId);

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        effectId: record.effectId,
        key,
        purpose: "side-effect-journal",
        userId: "member_123",
      }),
      bucket: env.BUNDLES,
      cryptoKey: crypto.rootKey,
      key,
      keyId: crypto.rootKeyId,
      scope: "side-effect-journal",
      value: record,
    });

    const response = await callRunnerOutbound(
      new Request(`http://results.worker/effects/${record.effectId}?fingerprint=${record.fingerprint}`, {
        method: "GET",
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      effectId: "outbox_rotated",
      record: {
        delivery: {
          channel: "telegram",
          target: "thread_123",
        },
        effectId: "outbox_rotated",
        kind: "assistant.delivery",
        state: "sent",
      },
    });
  });

  it("keeps removed manual-run paths absent while protected outbound routes preserve existing method ordering", async () => {
    const removedRunResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/run", {
        method: "GET",
      }),
      createWorkerEnv(),
    );

    expect(removedRunResponse.status).toBe(404);
    await expect(removedRunResponse.json()).resolves.toEqual({
      error: "Not found",
    });

    const wrongMethodOutboxResponse = await callRunnerOutbound(
      new Request("http://results.worker/effects/outbox_123", {
        method: "POST",
      }),
      createWorkerEnv(),
    );

    expect(wrongMethodOutboxResponse.status).toBe(405);
    await expect(wrongMethodOutboxResponse.json()).resolves.toEqual({
      error: "Method not allowed.",
    });
  });

  it("returns 405 before bound-user validation on user-bound routes", async () => {
    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/status", {
        method: "POST",
      }), {
        boundUserId: "member_other",
      }),
      createWorkerEnv(),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "Method not allowed.",
    });
  });

  it("keeps malformed encoded route params behind existing auth and hidden-method boundaries", async () => {
    const controlResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/%E0%A4%A/status", {
        method: "GET",
      }),
      createWorkerEnv(),
    );

    expect(controlResponse.status).toBe(401);
    await expect(controlResponse.json()).resolves.toEqual({
      error: "Unauthorized",
    });

    const runnerEventResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/%E0%A4%A/evt_commit/commit", {
        method: "GET",
      }),
      createWorkerEnv(),
    );

    expect(runnerEventResponse.status).toBe(404);
    await expect(runnerEventResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("preserves hidden not-found responses for wrong methods on worker routes that were never public", async () => {
    const removedRouteResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/dispatch", {
        method: "GET",
      }),
      createWorkerEnv(),
    );

    expect(removedRouteResponse.status).toBe(404);
    await expect(removedRouteResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });
});

type WorkerTestEnv = WorkerEnvironmentSource & {
  __bucketStore: ReturnType<typeof createBucketStore>;
} & Record<string, unknown>;

type UserRunnerStub = ReturnType<typeof createUserRunnerStub>;

function createRunnerContainerNamespace(): WorkerEnvironmentSource["RUNNER_CONTAINER"] {
  return {
    getByName(name: string) {
      return {
        async destroyInstance() {},
        async invoke(): Promise<HostedAssistantRuntimeJobResult> {
          throw new Error("Runner container should not be invoked by route tests.");
        },
        async ownsInternalWorkerProxyToken(input: { token: string }): Promise<boolean> {
          return name === "member_123" && input.token === RUNNER_PROXY_TOKEN;
        },
      };
    },
  };
}

function createWorkerEnv(
  userRunnerStub: UserRunnerStub = createUserRunnerStub(),
  overrides: Partial<WorkerEnvironmentSource & Record<string, unknown>> = {},
): WorkerTestEnv {
  const bucketStore = createBucketStore();
  const wrappedUserRunnerStubs = new Map<string, UserRunnerStub>();
  const defaultUserRunnerNamespace: WorkerEnvironmentSource["USER_RUNNER"] = {
    getByName(userId: string) {
      return getOrCreateWrappedUserRunnerStub(userId, userRunnerStub);
    },
  };
  const userRunnerNamespace = overrides.USER_RUNNER ?? defaultUserRunnerNamespace;
  const env: WorkerTestEnv = {
    __bucketStore: bucketStore,
    ...createHostedExecutionTestEnv(),
    BUNDLES: bucketStore.api,
    RUNNER_CONTAINER: createRunnerContainerNamespace(),
    ...overrides,
    USER_RUNNER: {
      getByName(userId: string) {
        return userRunnerNamespace.getByName(userId);
      },
    },
  };

  return env;

  function getOrCreateWrappedUserRunnerStub(userId: string, seedStub: UserRunnerStub): UserRunnerStub {
    const existing = wrappedUserRunnerStubs.get(userId);

    if (existing) {
      return existing;
    }

    const baseStub = wrappedUserRunnerStubs.size === 0 ? seedStub : createUserRunnerStub();
    const wrappedStub: UserRunnerStub = {
      ...baseStub,
      bootstrapUser: vi.fn(async (boundUserId: string) => {
        await resolveHostedUserCryptoContextForTest(env, boundUserId);
        return baseStub.bootstrapUser(boundUserId);
      }),
    };
    wrappedUserRunnerStubs.set(userId, wrappedStub);
    return wrappedStub;
  }
}

function callRunnerOutbound(
  request: Request,
  env: WorkerTestEnv,
  userId = "member_123",
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER, RUNNER_PROXY_TOKEN);
  return handleRunnerOutboundRequest(
    new Request(request, { headers }),
    env,
    userId,
    RUNNER_PROXY_TOKEN,
  );
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
    keys() {
      return [...values.keys()].sort();
    },
  };
}

function createWake(eventId: string): HostedExecutionWake {
  return buildHostedExecutionAssistantCronTickWake({
    eventId,
    occurredAt: "2026-04-16T10:00:00.000Z",
    reason: "manual",
    userId: "member_123",
  });
}

function createOutboxDelivery() {
  return {
    channel: "telegram",
    idempotencyKey: "assistant-outbox:intent_123",
    messageLength: "Queued reply".length,
    sentAt: "2026-03-26T12:00:00.000Z",
    target: "thread_123",
    targetKind: "thread" as const,
  };
}

function createPreparedSideEffectRecord(input: {
  effectId: string;
  fingerprint: string;
}) {
  return {
    attempt: {
      channel: "telegram",
      idempotencyKey: `assistant-outbox:${input.effectId}`,
      messageLength: "Queued reply".length,
      providerMessageId: null,
      providerThreadId: null,
      startedAt: "2026-03-26T12:00:05.000Z",
      target: "thread_123",
      targetKind: "thread" as const,
    },
    effectId: input.effectId,
    fingerprint: input.fingerprint,
    kind: "assistant.delivery" as const,
    recordedAt: "2026-03-26T12:00:05.000Z",
    state: "sending" as const,
  };
}

function createSentSideEffectRecord(input: {
  effectId: string;
  fingerprint: string;
}) {
  return {
    ...createPreparedSideEffectRecord(input),
    delivery: createOutboxDelivery(),
    recordedAt: "2026-03-26T12:00:00.000Z",
    state: "sent" as const,
  };
}

async function sideEffectRecordObjectKey(
  rootKey: Uint8Array,
  userId: string,
  effectId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "side-effect-path",
    value: `user:${userId}`,
  });
  const effectSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "side-effect-path",
    value: `effect:${userId}:${effectId}`,
  });

  return `transient/side-effects/${userSegment}/${effectSegment}.json`;
}

async function hostedArtifactObjectKeyForTest(
  env: WorkerTestEnv,
  userId: string,
  sha256: string,
): Promise<string> {
  const crypto = await resolveHostedUserCryptoContextForTest(env, userId);
  return hostedArtifactObjectKey(crypto.rootKey, userId, sha256);
}

async function hostedUserKeyEnvelopeObjectKeyForTest(
  env: WorkerTestEnv,
  userId: string,
): Promise<string> {
  const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey: environment.platformEnvelopeKey,
    scope: "user-key-envelope-path",
    value: `user:${userId}`,
  });

  return `users/keys/${userSegment}.json`;
}

async function resolveHostedUserCryptoContextForTest(
  env: WorkerTestEnv,
  userId: string,
) {
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
  return store.requireUserCryptoContext(userId);
}

function createUserRunnerStub(overrides: Record<string, unknown> = {}) {
  return {
    bootstrapUser: vi.fn(async (userId: string) => ({ userId })),
    status: vi.fn(async () => ({
      backpressuredEventIds: [],
      bundleRef: null,
      inFlight: false,
      lastError: null,
      lastEventId: null,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "member_123",
    })),
    wakeHostedWakes: vi.fn(async () => ({
      backpressuredEventIds: [],
      bundleRef: null,
      inFlight: false,
      lastError: null,
      lastEventId: null,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "member_123",
    })),
    ...overrides,
  } satisfies UserRunnerDurableObjectStubLike;
}

async function createSignedJsonControlRequest(
  path: string,
  payload: unknown,
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

  if (input.boundUserId !== null && input.boundUserId) {
    headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId);
  }

  return new Request(`https://runner.example.test${path}`, {
    body: JSON.stringify(payload),
    headers,
    method: "POST",
  });
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
  return createSignedJsonControlRequest(path, wake, {
    ...input,
    boundUserId: Object.prototype.hasOwnProperty.call(input, "boundUserId")
      ? input.boundUserId
      : wake.userId,
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

async function readIncomingMessageBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}
