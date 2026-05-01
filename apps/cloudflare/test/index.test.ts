import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ContainerProxy as PackageContainerProxy } from "@cloudflare/containers";
import type { HostedAssistantWorkspaceRuntimeJobResult } from "@murphai/assistant-runtime";
import {
  createHostedWebCallbackSignatureHeaders,
} from "../src/web-callback-auth.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import worker, { ContainerProxy as ExportedContainerProxy } from "../src/index.ts";
import {
  hostedArtifactObjectKey,
  hostedBrowserVaultReplicaObjectKey,
} from "../src/storage-paths.ts";
import type {
  UserRunnerDurableObjectStubLike,
  WorkerEnvironmentSource,
} from "../src/worker-routes/shared.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import {
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
} from "@murphai/hosted-execution/routes";
import { afterEach, describe as baseDescribe, expect, it, vi } from "vitest";

import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures";
import {
  createTestHostedRuntimeCryptoContext,
  getTestHostedRuntimeRootKey,
} from "./hosted-runtime-crypto-fixtures";
import { asWorkerStringEnvironment } from "../src/worker-contracts.ts";

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
const ACTIVE_INVOCATION_LEASE_HEADERS = {
  "x-hosted-runtime-attempt-id": "attempt_current",
  "x-hosted-runtime-lease-generation": "9",
  "x-hosted-runtime-workspace-version": "workspace_current",
} as const;
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

  it("exposes the invoked Worker version when the version metadata binding is present", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/"),
      {
        ...createWorkerEnv(),
        CF_VERSION_METADATA: {
          id: "version-123",
          tag: "test",
          timestamp: "2026-04-24T00:00:00.000Z",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "cloudflare-hosted-runner",
      workerVersionId: "version-123",
    });
  });

  it("runs the deploy-signed managed container smoke route", async () => {
    const env = createWorkerEnv();
    const url = new URL("https://runner.example.test/internal/deploy/container-smoke");
    const callbackSigning = readHostedExecutionEnvironment(asWorkerStringEnvironment(env)).webCallbackSigning;
    const request = new Request(url, {
      headers: await createHostedWebCallbackSignatureHeaders({
        environment: callbackSigning,
        method: "POST",
        path: url.pathname,
        payload: "",
        search: url.search,
      }),
      method: "POST",
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      runnerContainer: {
        ok: true,
        runnerBundle: {
          buildSkipped: false,
          bundleFingerprint: "bundle-fingerprint",
          generatedAt: "2026-04-24T00:00:00.000Z",
          schemaVersion: 2,
          sourceFingerprint: "source-fingerprint",
        },
        service: "cloudflare-hosted-runner-node",
        status: 200,
      },
      service: "cloudflare-hosted-runner",
    });
  });

  it("uses a version-specific deploy smoke Durable Object name when version metadata is present", async () => {
    const baseEnv = createWorkerEnv();
    const getByName = vi.fn(createRunnerContainerNamespace().getByName);
    const env = {
      ...baseEnv,
      CF_VERSION_METADATA: {
        id: "version-123",
        tag: "test",
        timestamp: "2026-04-24T00:00:00.000Z",
      },
      RUNNER_CONTAINER: {
        getByName,
      },
    };
    const url = new URL("https://runner.example.test/internal/deploy/container-smoke");
    const callbackSigning = readHostedExecutionEnvironment(asWorkerStringEnvironment(env)).webCallbackSigning;
    const request = new Request(url, {
      headers: await createHostedWebCallbackSignatureHeaders({
        environment: callbackSigning,
        method: "POST",
        path: url.pathname,
        payload: "",
        search: url.search,
      }),
      method: "POST",
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    expect(getByName).toHaveBeenCalledWith("__deploy-smoke-version-123");
  });

  it("rejects unsigned deploy container smoke requests", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/deploy/container-smoke", {
        method: "POST",
      }),
      createWorkerEnv(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("returns method-not-allowed before smoke signature verification on wrong methods", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/deploy/container-smoke", {
        method: "GET",
      }),
      createWorkerEnv(),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "Method not allowed.",
    });
  });

  it("does not expose the removed legacy local loopback proxy route", async () => {
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

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("routes local internal proxy requests onto the results.worker handler", async () => {
    installOidcJwksFetch();
    const env = createWorkerEnv(undefined, {
      ALLOW_LOCAL_INTERNAL_PROXY: "true",
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "https://localhost:8787",
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
    });

    const missingProxyTokenResponse = await worker.fetch(
      new Request(
        "https://localhost:8787/__murph/local-internal-proxy/users/member_123/results.worker/messages/raw_local_internal",
        {
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
        "https://localhost:8787/__murph/local-internal-proxy/users/member_123/results.worker/messages/raw_local_internal",
        {
          headers: {
            [HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER]: RUNNER_PROXY_TOKEN,
          },
          method: "GET",
        },
      ),
      env,
    );

    expect(readResponse.status).toBe(404);
    await expect(readResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("rejects local internal proxy requests when the proxy token is replayed against another user", async () => {
    const env = createWorkerEnv(undefined, {
      ALLOW_LOCAL_INTERNAL_PROXY: "true",
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "https://localhost:8787",
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
    });

    const response = await worker.fetch(
      new Request(
        "https://localhost:8787/__murph/local-internal-proxy/users/member_456/results.worker/messages/raw_local_internal",
        {
          headers: {
            [HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER]: RUNNER_PROXY_TOKEN,
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

  it("rejects local workspace checkpoints when the proxy token lease does not match", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      }),
    );
    const env = createWorkerEnv(undefined, {
      ALLOW_LOCAL_INTERNAL_PROXY: "true",
      HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "https://localhost:8787",
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
    });

    const response = await worker.fetch(
      new Request(
        "https://localhost:8787/__murph/local-internal-proxy/users/member_123/web-control.worker/api/internal/hosted-workspace/checkpoint",
        {
          body: JSON.stringify({
            attemptId: "attempt_stale",
            expectedWorkspaceVersion: "4",
            leaseGeneration: "9",
            reason: "import",
            snapshotRef: null,
          }),
          headers: {
            [HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER]: RUNNER_PROXY_TOKEN,
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      ),
      env,
    );

    expect(response.status).toBe(401);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("hard-fails when the local internal proxy is configured outside development", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/health"),
      createWorkerEnv(undefined, {
        ALLOW_LOCAL_INTERNAL_PROXY: "true",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "https://localhost:8787",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "production",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request.",
    });
  });

  it("rejects public local internal proxy ingress hosts even in development", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/health"),
      createWorkerEnv(undefined, {
        ALLOW_LOCAL_INTERNAL_PROXY: "true",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "https://runner.example.test",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request.",
    });
  });

  it("does not expose the removed wake route", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/wake", {
        method: "POST",
      })),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(404);
    expect(stub.bindUser).not.toHaveBeenCalled();
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
    expect(stub.bindUser).not.toHaveBeenCalled();
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
    expect(stub.bindUser).not.toHaveBeenCalled();
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
    expect(stub.bindUser).not.toHaveBeenCalled();
  });

  it("keeps the removed internal events alias hidden from OIDC dispatch callers", async () => {
    const stub = createUserRunnerStub();
    const request = await createSignedWakeRequest("/internal/events", createWake("evt_removed_alias"));

    const response = await worker.fetch(request, createWorkerEnv(stub));

    expect(response.status).toBe(404);
    expect(stub.bindUser).not.toHaveBeenCalled();
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
    expect(stub.bindUser).not.toHaveBeenCalled();
  });

  it("reads canonical per-user status while keeping the per-event status route removed", async () => {
    const stub = createUserRunnerStub({
      runnerStatus: vi.fn(async () => ({
        inFlight: false,
        lastInvocationAt: "2026-04-16T10:05:00.000Z",
        mailboxLag: [],
        nextAlarmAt: null,
        recentLogs: [],
        userId: "member_123",
        workspace: null,
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
      mailboxLag: [],
      userId: "member_123",
      workspace: null,
    });
    expect(stub.runnerStatus).toHaveBeenCalledTimes(1);

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

  it("fails closed when canonical per-user status cannot be validated", async () => {
    const stub = createUserRunnerStub({
      runnerStatus: vi.fn(async () => {
        throw new Error("Hosted workspace read returned a different user.");
      }),
    });

    const statusResponse = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/status", {
        method: "GET",
      })),
      createWorkerEnv(stub),
    );

    expect(statusResponse.status).toBe(500);
    await expect(statusResponse.json()).resolves.toEqual({
      error: "Internal error.",
    });
    expect(stub.runnerStatus).toHaveBeenCalledTimes(1);
  });

  it("returns a stable browser-vault missing-replica code from the browser-vault route", async () => {
    const env = createWorkerEnv();
    await resolveHostedUserCryptoContextForTest(env, "member_123");
    const replicaRef = await createMissingBrowserVaultReplicaRefForTest(env, "member_123");

    const response = await worker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/internal/users/member_123/browser-vault/session",
        {
          body: JSON.stringify({
            browserPublicKeyJwk: createBrowserSessionPublicKeyJwk(),
            replicaRef,
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      )),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
      error: "Browser vault replica was not found.",
    });
    expect(env.__bucketStore.getCalls.filter((key) => key.includes("/browser-vault-replicas/"))).toEqual([
      replicaRef.objectKey,
    ]);
  });

  it("rejects browser-vault replica refs outside the bound user's namespace before bucket lookup", async () => {
    const env = createWorkerEnv();
    await resolveHostedUserCryptoContextForTest(env, "member_123");
    await resolveHostedUserCryptoContextForTest(env, "member_456");
    const foreignReplicaRef = await createMissingBrowserVaultReplicaRefForTest(env, "member_456");

    const response = await worker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/internal/users/member_123/browser-vault/session",
        {
          body: JSON.stringify({
            browserPublicKeyJwk: createBrowserSessionPublicKeyJwk(),
            replicaRef: foreignReplicaRef,
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      )),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
      error: "Browser vault replica was not found.",
    });
    expect(env.__bucketStore.getCalls.filter((key) => key.includes("/browser-vault-replicas/"))).toEqual([]);
  });

  it("nudges the hosted runner without enqueuing a normal-path wake", async () => {
    const stub = createUserRunnerStub({
      nudgeHostedRunner: vi.fn(async () => ({
        accepted: true,
        alarmScheduled: true,
        alreadyRunning: false,
        inFlight: false,
        nextAlarmAt: "2026-04-26T00:00:00.000Z",
      })),
    });
    const env = createWorkerEnv(stub);

    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/nudge", {
        body: "{}",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      })),
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
      inFlight: false,
      nextAlarmAt: "2026-04-26T00:00:00.000Z",
    });
    expect(stub.nudgeHostedRunner).toHaveBeenCalledTimes(1);
    expect(stub.runUntilIdleOrBudget).not.toHaveBeenCalled();
  });

  it("deletes hosted runner user data without queuing a new invocation", async () => {
    const stub = createUserRunnerStub({
      deleteHostedUserData: vi.fn(async (userId: string) => ({
        deletedAt: "2026-04-29T00:00:00.000Z",
        durableObject: {
          alarmCleared: true,
          stateDeleted: true,
        },
        ok: true,
        r2: {
          deletedObjectCount: 3,
          skippedUserScopedPrefixes: false,
          supported: true,
          userScopedSkipReason: null,
        },
        userId,
      })),
    });
    const env = createWorkerEnv(stub);

    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/account-data/delete", {
        body: "{}",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      })),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      durableObject: {
        alarmCleared: true,
        stateDeleted: true,
      },
      ok: true,
      r2: {
        deletedObjectCount: 3,
        skippedUserScopedPrefixes: false,
        supported: true,
        userScopedSkipReason: null,
      },
      userId: "member_123",
    });
    expect(stub.deleteHostedUserData).toHaveBeenCalledWith("member_123");
    expect(stub.nudgeHostedRunner).not.toHaveBeenCalled();
    expect(stub.runUntilIdleOrBudget).not.toHaveBeenCalled();
  });

  it("rejects user-data deletion route/user mismatches before touching the Durable Object", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      await signControlRequest(
        new Request("https://runner.example.test/internal/users/member_123/account-data/delete", {
          method: "POST",
        }),
        { boundUserId: "member_other" },
      ),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the route user.",
    });
    expect(stub.deleteHostedUserData).not.toHaveBeenCalled();
  });

  it("rejects oversized user-data deletion request bodies before touching the Durable Object", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      await signControlRequest(
        new Request("https://runner.example.test/internal/users/member_123/account-data/delete", {
          body: JSON.stringify({ padding: "x".repeat(5_000) }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        }),
      ),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request.",
    });
    expect(stub.deleteHostedUserData).not.toHaveBeenCalled();
  });

  it("does not start another workspace invocation when the nudge is already running", async () => {
    const stub = createUserRunnerStub({
      nudgeHostedRunner: vi.fn(async () => ({
        accepted: true,
        alarmScheduled: true,
        alreadyRunning: true,
        inFlight: true,
        nextAlarmAt: "2026-04-26T00:00:00.000Z",
      })),
    });
    const env = createWorkerEnv(stub);

    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/nudge", {
        body: "{}",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      })),
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      alreadyRunning: true,
      inFlight: true,
    });
    expect(stub.nudgeHostedRunner).toHaveBeenCalledTimes(1);
    expect(stub.runUntilIdleOrBudget).not.toHaveBeenCalled();
  });

  it("accepts runner nudges through the direct Durable Object nudge path", async () => {
    const stub = createUserRunnerStub({
      nudgeHostedRunner: vi.fn(async () => ({
        accepted: true,
        alarmScheduled: true,
        alreadyRunning: false,
        inFlight: false,
        nextAlarmAt: "2026-04-26T00:00:00.000Z",
      })),
    });
    const env = createWorkerEnv(stub);

    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/nudge", {
        body: "{}",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      })),
      env,
    );

    expect(response.status).toBe(202);
    expect(stub.runUntilIdleOrBudget).not.toHaveBeenCalled();
    expect(stub.nudgeHostedRunner).toHaveBeenCalledTimes(1);
  });

  it("rejects runner nudge route/user mismatches before touching the Durable Object", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      await signControlRequest(
        new Request("https://runner.example.test/internal/users/member_123/nudge", {
          method: "POST",
        }),
        { boundUserId: "member_other" },
      ),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the route user.",
    });
    expect(stub.bindUser).not.toHaveBeenCalled();
    expect(stub.nudgeHostedRunner).not.toHaveBeenCalled();
  });

  it("does not expose the legacy hosted-run nudge route", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/run", {
        method: "POST",
      })),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(404);
    expect(stub.nudgeHostedRunner).not.toHaveBeenCalled();
    expect(stub.runUntilIdleOrBudget).not.toHaveBeenCalled();
  });

  it("stores and reads encrypted hosted artifact objects through the outbound artifacts.worker handler", async () => {
    installOidcJwksFetch();
    const env = createWorkerEnv();
    const artifactBytes = Buffer.from("artifact-payload\n", "utf8");
    const artifactSha256 = "fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b";

    const writeResponse = await callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        body: artifactBytes,
        headers: {
          "content-type": "application/octet-stream",
          ...ACTIVE_INVOCATION_LEASE_HEADERS,
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
    installOidcJwksFetch();
    const env = createWorkerEnv();
    const artifactSha256 = "fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b";

    await expect(() => callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        body: Buffer.from("wrong-payload\n", "utf8"),
        headers: {
          "content-type": "application/octet-stream",
          ...ACTIVE_INVOCATION_LEASE_HEADERS,
        },
        method: "PUT",
      }),
      env,
    )).rejects.toThrow(
      `Hosted artifact hash mismatch: expected ${artifactSha256}`,
    );

    expect(env.__bucketStore.keys()).toHaveLength(0);
  });

  it("keeps hosted artifact objects isolated per user", async () => {
    installOidcJwksFetch();
    const env = createWorkerEnv();
    const artifactBytes = Buffer.from("artifact-payload\n", "utf8");
    const artifactSha256 = "fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b";

    const writeResponse = await callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        body: artifactBytes,
        headers: {
          "content-type": "application/octet-stream",
          ...ACTIVE_INVOCATION_LEASE_HEADERS,
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

  it("hard-cuts removed callback routes from the outbound results.worker handler", async () => {
    const env = createWorkerEnv();

    const firstRemovedResponse = await callRunnerOutbound(
      new Request("http://results.worker/removed-callbacks/evt_alpha", {
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    const secondRemovedResponse = await callRunnerOutbound(
      new Request("http://results.worker/removed-callbacks/evt_bravo", {
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

    expect(firstRemovedResponse.status).toBe(404);
    expect(secondRemovedResponse.status).toBe(404);
  });

  it("keeps removed outbound routes hidden from public and internal callers", async () => {
    const env = createWorkerEnv();

    const removedFirstResponse = await callRunnerOutbound(
      new Request("http://results.worker/removed-callbacks/evt_auth", {
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
    expect(removedFirstResponse.status).toBe(404);

    const removedSecondResponse = await callRunnerOutbound(
      new Request("http://results.worker/removed-callbacks/evt_bad", {
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
    expect(removedSecondResponse.status).toBe(404);

    const publicRemovedResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/removed-callbacks/member_123/evt_removed", {
        method: "POST",
      }),
      env,
    );
    expect(publicRemovedResponse.status).toBe(404);

    const publicOutboxResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-outbox/member_123/outbox_123", {
        method: "GET",
      }),
      env,
    );
    expect(publicOutboxResponse.status).toBe(404);
  });

  it("hard-cuts the removed outbound journal route from the results.worker handler", async () => {
    const env = createWorkerEnv();

    const getResponse = await callRunnerOutbound(
      new Request("http://results.worker/removed-journal/outbox_123?fingerprint=dedupe_123", {
        method: "GET",
      }),
      env,
    );
    const putResponse = await callRunnerOutbound(
      new Request("http://results.worker/removed-journal/outbox_123?fingerprint=dedupe_123", {
        body: JSON.stringify({ ignored: true }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );
    const deleteResponse = await callRunnerOutbound(
      new Request("http://results.worker/removed-journal/outbox_123?fingerprint=dedupe_123", {
        method: "DELETE",
      }),
      env,
    );

    expect(getResponse.status).toBe(404);
    expect(putResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
  });

  it("keeps removed wake paths absent while protected outbound routes preserve existing method ordering", async () => {
    const removedRunResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/wake", {
        method: "GET",
      }),
      createWorkerEnv(),
    );

    expect(removedRunResponse.status).toBe(404);
    await expect(removedRunResponse.json()).resolves.toEqual({
      error: "Not found",
    });

    const wrongMethodOutboxResponse = await callRunnerOutbound(
      new Request("http://results.worker/messages/raw_123", {
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
      new Request("https://runner.example.test/internal/removed-callbacks/%E0%A4%A/evt_removed", {
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
        async invoke(): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
          throw new Error("Runner container should not be invoked by route tests.");
        },
        async ownsInternalWorkerProxyToken(input: {
          attemptId?: string;
          leaseGeneration?: string;
          token: string;
        }): Promise<boolean> {
          const tokenMatches = name === "member_123" && input.token === RUNNER_PROXY_TOKEN;
          if (!tokenMatches) {
            return false;
          }
          if (input.attemptId === undefined && input.leaseGeneration === undefined) {
            return true;
          }
          return input.attemptId === "attempt_current" && input.leaseGeneration === "9";
        },
        async smokeHealth() {
          return {
            ok: true,
            runnerBundle: {
              buildSkipped: false,
              bundleFingerprint: "bundle-fingerprint",
              generatedAt: "2026-04-24T00:00:00.000Z",
              schemaVersion: 2,
              sourceFingerprint: "source-fingerprint",
            },
            service: "cloudflare-hosted-runner-node",
            status: 200,
          };
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
      bindUser: vi.fn(async (boundUserId: string) => {
        return baseStub.bindUser(boundUserId);
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
  const getCalls: string[] = [];

  return {
    api: {
      async delete(key: string) {
        values.delete(key);
      },
      async get(key: string) {
        getCalls.push(key);
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
    getCalls,
    keys() {
      return [...values.keys()].sort();
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
    occurredAt: "2026-04-16T10:00:00.000Z",
    userId: "member_123",
  };
}

function createBrowserSessionPublicKeyJwk() {
  return {
    crv: "P-256",
    kty: "EC",
    x: "browser-session-x",
    y: "browser-session-y",
  };
}

async function createMissingBrowserVaultReplicaRefForTest(
  env: WorkerTestEnv,
  userId: string,
) {
  const crypto = await resolveHostedUserCryptoContextForTest(env, userId);
  const dataVersion = "d".repeat(64);

  return {
    byteLength: 128,
    dataVersion,
    generatedAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    objectKey: await hostedBrowserVaultReplicaObjectKey({
      dataVersion,
      rootKey: crypto.rootKey,
      userId,
    }),
    replicaSchema: "murph.browser-vault-replica.v1",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: "a".repeat(64),
  };
}

async function hostedArtifactObjectKeyForTest(
  env: WorkerTestEnv,
  userId: string,
  sha256: string,
): Promise<string> {
  const crypto = await resolveHostedUserCryptoContextForTest(env, userId);
  return hostedArtifactObjectKey(crypto.rootKey, userId, sha256);
}

async function resolveHostedUserCryptoContextForTest(
  _env: WorkerTestEnv,
  userId: string,
) {
  return {
    rootKey: getTestHostedRuntimeRootKey("runtime"),
    rootKeyId: "udrk:runtime:test-root",
    userId,
  };
}

function createUserRunnerStub(overrides: Record<string, unknown> = {}) {
  return {
    bindUser: vi.fn(async (userId: string) => ({ userId })),
    deleteHostedUserData: vi.fn(async (userId: string) => ({
      deletedAt: "2026-04-29T00:00:00.000Z",
      durableObject: {
        alarmCleared: true,
        stateDeleted: true,
      },
      ok: true as const,
      r2: {
        deletedObjectCount: 0,
        skippedUserScopedPrefixes: true,
        supported: true,
        userScopedSkipReason: null,
      },
      userId,
    })),
    nudgeHostedRunner: vi.fn(async () => ({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
      inFlight: false,
      nextAlarmAt: null,
    })),
    ownsActiveInvocationLease: vi.fn(async () => true),
    recordActiveInvocationHeartbeat: vi.fn(async () => ({
      inputAvailable: false,
      nextAlarmAt: null,
      ok: true as const,
      pendingNudge: false,
    })),
    recordActiveInvocationWorkspaceCheckpoint: vi.fn(async () => ({
      recorded: true,
    })),
    runUntilIdleOrBudget: vi.fn(async () => ({
      nextWakeAt: null,
      status: "idle" as const,
    })),
    runnerStatus: vi.fn(async () => ({
      inFlight: false,
      mailboxLag: [],
      nextAlarmAt: null,
      recentLogs: [],
      userId: "member_123",
      workspace: null,
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

    const url = new URL(String(input));
    if (url.pathname === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH) {
      const headers = new Headers(init?.headers);
      const userId = headers.get(HOSTED_EXECUTION_USER_ID_HEADER);
      if (!userId) {
        return Response.json({ error: "Missing hosted user id." }, { status: 400 });
      }
      return Response.json(await createTestHostedRuntimeCryptoContext(userId));
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
