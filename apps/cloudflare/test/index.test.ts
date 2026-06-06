import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HostedAssistantWorkspaceRuntimeJobResult } from "@murphai/assistant-runtime";
import {
  createBrowserVaultReplica,
  createVaultReadModel,
} from "@murphai/query/browser";
import {
  parseHostedBrowserSessionKeyEnvelope,
} from "@murphai/runtime-state";
import {
  createHostedWebCallbackSignatureHeaders,
} from "../src/web-callback-auth.ts";
import {
  createHostedBrowserVaultReplicaStore,
} from "../src/browser-vault-store.ts";
import {
  createHostedBundleStore,
} from "../src/bundle-store.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import hostedLocalTestWorker from "../src/hosted-local-test-index.ts";
import worker from "../src/index.ts";
import { hostedLocalTestInternalRoutes } from "../src/worker/hosted-local-test-routes.ts";
import { workerInternalRoutes } from "../src/worker/internal-routes.ts";
import { workerPublicRoutes } from "../src/worker/public-routes.ts";
import {
  HostedUserRunner,
} from "../src/user-runner.ts";
import type {
  HostedRunnerStuckInvocationTestResult,
} from "../src/user-runner/hosted-user-runner-test.ts";
import {
  parseTestPositiveInteger,
  parseTestPositiveIntegerValue,
} from "../src/worker/route-handlers/test-runner.ts";
import type {
  HostedExecutionContainerNamespaceLike,
  HostedExecutionContainerStubLike,
} from "../src/runner-container.ts";
import type {
  DurableObjectStateLike,
  DurableObjectStorageLike,
} from "../src/user-runner/types.ts";
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
  HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_CRYPTO_ROOT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { afterEach, describe as baseDescribe, expect, it, vi } from "vitest";

import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures";
import {
  createTestHostedRuntimeCryptoContext,
  getTestHostedRuntimeRootKey,
} from "./hosted-runtime-crypto-fixtures";
import { asWorkerStringEnvironment } from "../src/worker-contracts.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

const describe = baseDescribe.sequential;
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(TEST_DIR, "..");

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

async function readWorkerEntrypointSource(): Promise<string> {
  return await readTypeScriptImportGraphSource([path.join(APP_DIR, "src/index.ts")]);
}

async function readWorkerHttpRouteSource(): Promise<string> {
  return await readTypeScriptImportGraphSource([
    path.join(APP_DIR, "src/worker/fetch-handler.ts"),
    path.join(APP_DIR, "src/worker/internal-routes.ts"),
    path.join(APP_DIR, "src/worker/public-routes.ts"),
  ]);
}

async function readTypeScriptImportGraphSource(entryPaths: readonly string[]): Promise<string> {
  const seen = new Set<string>();
  const sourceFiles = (await Promise.all(
    entryPaths.map((entryPath) => listTypeScriptImportGraph(entryPath, seen)),
  )).flat();
  const sources = await Promise.all(
    [...new Set(sourceFiles)].sort().map((filePath) => readFile(filePath, "utf8")),
  );
  return sources.join("\n");
}

async function listTypeScriptImportGraph(
  entryPath: string,
  seen = new Set<string>(),
): Promise<string[]> {
  const normalizedEntryPath = path.normalize(entryPath);
  if (seen.has(normalizedEntryPath)) {
    return [];
  }
  seen.add(normalizedEntryPath);

  const source = await readFile(normalizedEntryPath, "utf8");
  const imports = [
    ...source.matchAll(/(?:import|export)\s+(?:type\s+)?[^"'`]*?\s+from\s+["']([^"']+)["']/gu),
    ...source.matchAll(/import\s+["']([^"']+)["']/gu),
  ];
  const importedFiles = await Promise.all(imports.map(async (match) => {
    const specifier = match[1];
    if (!specifier?.startsWith(".")) {
      return [];
    }
    const resolved = await resolveTypeScriptImportPath(normalizedEntryPath, specifier);
    return resolved ? listTypeScriptImportGraph(resolved, seen) : [];
  }));

  return [normalizedEntryPath, ...importedFiles.flat()].sort();
}

async function resolveTypeScriptImportPath(
  importerPath: string,
  specifier: string,
): Promise<string | null> {
  const rawPath = path.resolve(path.dirname(importerPath), specifier);
  const candidates = [
    rawPath,
    rawPath.replace(/\.js$/u, ".ts"),
    `${rawPath}.ts`,
    path.join(rawPath, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cloudflare worker routes", () => {
  it("keeps inbox email parsing isolated to the hosted email ingress module", async () => {
    const [workerHttpRouteSource, hostedEmailIngressSource] = await Promise.all([
      readWorkerHttpRouteSource(),
      readFile(path.join(APP_DIR, "src/hosted-email/worker-ingress.ts"), "utf8"),
    ]);

    expect(workerHttpRouteSource).not.toMatch(/from "@murphai\/inboxd";/u);
    expect(workerHttpRouteSource).not.toMatch(/@murphai\/inboxd\/connectors\/email\/parsed/u);
    expect(hostedEmailIngressSource).not.toMatch(/from "@murphai\/inboxd";/u);
    expect(hostedEmailIngressSource).toMatch(/@murphai\/inboxd\/connectors\/email\/parsed/u);
  });

  it("keeps runner wake traffic off Cloudflare Queues", async () => {
    const [deployAutomationSource, wranglerSource] = await Promise.all([
      readFile(path.join(APP_DIR, "scripts/deploy-automation.ts"), "utf8"),
      readFile(path.join(APP_DIR, "wrangler.jsonc"), "utf8"),
    ]);
    const workerSource = await readWorkerEntrypointSource();

    expect(worker).not.toHaveProperty("queue");
    expect(workerSource).not.toMatch(/\bqueue\s*\(/u);
    expect(workerSource).not.toContain("legacy-runner-wake-queue");
    await expect(
      readFile(path.join(APP_DIR, "src/legacy-runner-wake-queue.ts"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(deployAutomationSource).not.toMatch(/\bqueues\b/u);
    expect(wranglerSource).not.toMatch(/\bqueues\b/u);
  });

  it("keeps hosted-local test routes and toggles out of the production Worker graph", async () => {
    const workerSource = await readWorkerEntrypointSource();

    expect(workerInternalRoutes.some((route) =>
      route.match("/__test/users/member_123/run-until-idle")
    )).toBe(false);
    expect(workerSource).not.toContain("/__test/");
    expect(workerSource).not.toContain("MURPH_HOSTED_LOCAL_TEST_ROUTES");
    expect(workerSource).not.toContain("runUntilIdleForTest");
    expect(workerSource).not.toContain("startStuckInvocationForTest");
    expect(workerSource).not.toContain("expireActivityForTest");
    expect(workerSource).not.toContain("ageActiveInvocationForTest");
    expect(workerSource).not.toContain("probeActiveContainerProviderEgressForTest");
    expect(workerSource).not.toContain("provider-egress-active-container-probe");
    expect(workerSource).not.toContain("HostedRunnerStuckInvocationTestResult");
    expect(workerSource).not.toContain("matchHostedLocalTestUserRoute");
  });

  it("keeps generated worker contracts free of Queue producer bindings", async () => {
    const [workerSource, workerContractsSource] = await Promise.all([
      readWorkerEntrypointSource(),
      readFile(path.join(APP_DIR, "src/worker-contracts.ts"), "utf8"),
    ]);

    expect(workerSource).not.toContain("env.RUNNER_WAKE_QUEUE");
    expect(workerContractsSource).not.toContain("WorkerQueueBinding");
    expect(workerContractsSource).not.toContain("WorkerQueueMessage");
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

  it("reassembles the Worker route tables in the stable route order", () => {
    expect(workerPublicRoutes.map(({ name }) => name)).toEqual([
      "service-banner",
    ]);
    expect(workerInternalRoutes.map(({ name }) => name)).toEqual([
      "deploy-container-smoke",
      "runtime-ensure-processing",
      "runtime-prewarm",
      "user-data-delete",
      "browser-vault-session",
      "user-status",
    ]);
    expect(hostedLocalTestInternalRoutes.map(({ name }) => name)).toEqual([
      "test-artifact-seed",
      "test-run-until-idle",
      "test-run-alarm",
      "test-container-activity-expired",
      "test-start-stuck-invocation",
      "test-direct-r2-presigned-put",
      "deploy-container-smoke",
      "runtime-ensure-processing",
      "runtime-prewarm",
      "user-data-delete",
      "browser-vault-session",
      "user-status",
    ]);
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
        codexShell: createCodexShellSmokeResult(),
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

  it("can run deploy-signed direct R2 presigned PUT smoke against the bundles bucket", async () => {
    const uploadedObjects = new Map<string, { customMetadata: Record<string, string>; size: number }>();
    const deletedKeys: string[] = [];
    const smokeHealth = vi.fn(async (input: {
      directR2PresignedPut?: {
        byteLength: number;
        presignedPutUrl: string;
      };
    }) => {
      const directR2PresignedPut = input.directR2PresignedPut;
      if (!directR2PresignedPut) {
        throw new Error("Expected direct R2 presigned PUT smoke input.");
      }
      const presignedUrl = new URL(directR2PresignedPut.presignedPutUrl);
      const objectKey = decodeURIComponent(
        presignedUrl.pathname.replace(/^\/smoke-bucket\//u, ""),
      );
      uploadedObjects.set(objectKey, {
        customMetadata: { payloadSha256: "a".repeat(64) },
        size: directR2PresignedPut.byteLength,
      });

      return {
        directR2PresignedPut: {
          byteLength: directR2PresignedPut.byteLength,
          durationMs: 10,
          ok: true,
          payloadSha256: "a".repeat(64),
          responseBodyBytes: 0,
          status: 200,
        },
        ok: true,
        runnerBundle: null,
        service: "cloudflare-hosted-runner-node",
        status: 200,
      };
    });
    const bucket = {
      async delete(key: string) {
        deletedKeys.push(key);
        uploadedObjects.delete(key);
      },
      async get() {
        return null;
      },
      async head(key: string) {
        const object = uploadedObjects.get(key);
        return object ? { key, ...object } : null;
      },
      async put() {},
    };
    const env = createWorkerEnv(createUserRunnerStub(), {
      BUNDLES: bucket,
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "r2-access-fixture",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2-account",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "smoke-bucket",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "r2-signing-fixture",
      RUNNER_CONTAINER_SMOKE: {
        getByName() {
          return {
            async destroyInstance() {},
            async invoke(): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
              throw new Error("Runner container should not be invoked by smoke route tests.");
            },
            smokeHealth,
          };
        },
      },
    });
    const url = new URL(
      "https://runner.example.test/internal/deploy/container-smoke?directR2PresignedPut=1",
    );
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
    expect(smokeHealth).toHaveBeenCalledWith({
      directR2PresignedPut: {
        byteLength: 160 * 1024 * 1024,
        presignedPutUrl: expect.stringContaining(
          "https://r2-account.r2.cloudflarestorage.com/smoke-bucket/deploy-smoke/direct-r2-presigned-put/",
        ),
      },
    });
    expect(deletedKeys).toHaveLength(1);
    expect(deletedKeys[0]).toMatch(/^deploy-smoke\/direct-r2-presigned-put\/.+\.bin$/u);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      runnerContainer: {
        directR2PresignedPut: {
          byteLength: 160 * 1024 * 1024,
          ok: true,
          payloadSha256: "a".repeat(64),
          status: 200,
        },
      },
      service: "cloudflare-hosted-runner",
    });
  });

  it("rejects replayed deploy-signed managed container smoke requests", async () => {
    const env = createWorkerEnv();
    const url = new URL("https://runner.example.test/internal/deploy/container-smoke");
    const callbackSigning = readHostedExecutionEnvironment(asWorkerStringEnvironment(env)).webCallbackSigning;
    const headers = await createHostedWebCallbackSignatureHeaders({
      environment: callbackSigning,
      method: "POST",
      nonce: "0123456789abcdef0123456789abcdef",
      path: url.pathname,
      payload: "",
      search: url.search,
    });

    const firstResponse = await worker.fetch(new Request(url, {
      headers,
      method: "POST",
    }), env);
    const replayResponse = await worker.fetch(new Request(url, {
      headers,
      method: "POST",
    }), env);

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(401);
  });

  it("rejects oversized deploy smoke request bodies before signature verification", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/deploy/container-smoke", {
        body: "x".repeat(4097),
        method: "POST",
      }),
      createWorkerEnv(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body too large.",
    });
  });

  it("uses a version-specific deploy smoke Durable Object name when version metadata is present", async () => {
    const baseEnv = createWorkerEnv();
    const runnerGetByName = vi.fn(createRunnerContainerNamespace().getByName);
    const smokeGetByName = vi.fn(createRunnerContainerNamespace().getByName);
    const env = {
      ...baseEnv,
      CF_VERSION_METADATA: {
        id: "version-123",
        tag: "test",
        timestamp: "2026-04-24T00:00:00.000Z",
      },
      RUNNER_CONTAINER: {
        getByName: runnerGetByName,
      },
      RUNNER_CONTAINER_SMOKE: {
        getByName: smokeGetByName,
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
    expect(smokeGetByName).toHaveBeenCalledWith("__deploy-smoke-version-123");
    expect(runnerGetByName).not.toHaveBeenCalled();
  });

  it("uses a local-build-specific deploy smoke Durable Object name without version metadata", async () => {
    const baseEnv = createWorkerEnv();
    const runnerGetByName = vi.fn(createRunnerContainerNamespace().getByName);
    const smokeGetByName = vi.fn(createRunnerContainerNamespace().getByName);
    const env = {
      ...baseEnv,
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "local build/123",
      RUNNER_CONTAINER: {
        getByName: runnerGetByName,
      },
      RUNNER_CONTAINER_SMOKE: {
        getByName: smokeGetByName,
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
    expect(smokeGetByName).toHaveBeenCalledWith("__deploy-smoke-local-build-123");
    expect(runnerGetByName).not.toHaveBeenCalled();
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

  it("rejects deploy container smoke requests with a short signed nonce", async () => {
    const env = createWorkerEnv();
    const url = new URL("https://runner.example.test/internal/deploy/container-smoke");
    const callbackSigning = readHostedExecutionEnvironment(asWorkerStringEnvironment(env)).webCallbackSigning;
    const request = new Request(url, {
      headers: await createHostedWebCallbackSignatureHeaders({
        environment: callbackSigning,
        method: "POST",
        nonce: "short",
        path: url.pathname,
        payload: "",
        search: url.search,
      }),
      method: "POST",
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects deploy container smoke requests outside the signature timestamp window", async () => {
    const env = createWorkerEnv();
    const url = new URL("https://runner.example.test/internal/deploy/container-smoke");
    const callbackSigning = readHostedExecutionEnvironment(asWorkerStringEnvironment(env)).webCallbackSigning;
    const staleTimestamp = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const request = new Request(url, {
      headers: await createHostedWebCallbackSignatureHeaders({
        environment: callbackSigning,
        method: "POST",
        path: url.pathname,
        payload: "",
        search: url.search,
        timestamp: staleTimestamp,
      }),
      method: "POST",
    });

    const response = await worker.fetch(request, env);

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

  it("keeps hosted-local test routes out of the production worker even when local flags are present", async () => {
    const response = await worker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/artifacts?userId=member_123&sha256=fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b",
        {
          body: "artifact-payload",
          method: "PUT",
        },
      ), {
        boundUserId: "member_123",
      }),
      createWorkerEnv(createUserRunnerStub(), {
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "test",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("keeps hosted-local test routes hidden outside NODE_ENV=test", async () => {
    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/artifacts?userId=member_123&sha256=fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b",
        {
          method: "GET",
        },
      ), {
        boundUserId: "member_123",
      }),
      createWorkerEnv(createUserRunnerStub(), {
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "production",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("keeps hosted-local test routes hidden without the explicit test-route flag", async () => {
    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/artifacts?userId=member_123&sha256=fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b",
        {
          method: "GET",
        },
      ), {
        boundUserId: "member_123",
      }),
      createWorkerEnv(createUserRunnerStub(), {
        NODE_ENV: "test",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("keeps wrong methods on enabled hosted-local test routes hidden before auth", async () => {
    const stub = createUserRunnerStub();
    const response = await hostedLocalTestWorker.fetch(
      new Request("https://runner.example.test/__test/users/member_123/run-until-idle", {
        method: "GET",
      }),
      createWorkerEnv(stub, {
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "test",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(stub.runUntilIdleForTest).not.toHaveBeenCalled();
  });

  it("requires hosted-local test route callers to be bound to the target user", async () => {
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    const artifactResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/artifacts?userId=member_123&sha256=fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b",
        {
          body: "artifact-payload",
          method: "PUT",
        },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(artifactResponse.status).toBe(401);
    await expect(artifactResponse.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test artifact user.",
    });

    const artifactReadResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/artifacts?userId=member_123&sha256=fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b",
        {
          method: "GET",
        },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(artifactReadResponse.status).toBe(401);
    await expect(artifactReadResponse.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test artifact user.",
    });

    const runResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/run-until-idle",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(runResponse.status).toBe(401);
    await expect(runResponse.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test runner user.",
    });

    const alarmResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/alarm",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(alarmResponse.status).toBe(401);
    await expect(alarmResponse.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test runner user.",
    });

    const stuckInvocationResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/stuck-invocation",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(stuckInvocationResponse.status).toBe(401);
    await expect(stuckInvocationResponse.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test runner user.",
    });

    const directR2Response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/direct-r2-presigned-put",
        {
          body: JSON.stringify({
            byteLength: 4096,
            presignedPutUrl:
              "https://example-account.r2.cloudflarestorage.com/test-bucket/snapshot.enc?X-Amz-Signature=test",
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(directR2Response.status).toBe(401);
    await expect(directR2Response.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test runner user.",
    });
  });

  it("stores and reads hosted-local test artifacts for correctly bound callers", async () => {
    const artifactBytes = Buffer.from("artifact-payload\n", "utf8");
    const artifactSha256 = "fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b";
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });
    const url =
      `https://runner.example.test/__test/artifacts?userId=member_123&sha256=${artifactSha256}`;

    const writeResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(url, {
        body: artifactBytes,
        method: "PUT",
      }), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(writeResponse.status).toBe(200);
    await expect(writeResponse.json()).resolves.toMatchObject({
      ok: true,
      sha256: artifactSha256,
      size: artifactBytes.byteLength,
      userId: "member_123",
    });

    const readResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(url, {
        method: "GET",
      }), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(readResponse.status).toBe(200);
    expect(Buffer.from(await readResponse.arrayBuffer())).toEqual(artifactBytes);
  });

  it("runs hosted-local direct R2 presigned PUT smoke for correctly bound callers", async () => {
    const presignedPutUrl =
      "https://example-account.r2.cloudflarestorage.com/test-bucket/snapshot.enc?X-Amz-Signature=test";
    const smokeHealth = vi.fn(async () => ({
      directR2PresignedPut: {
        byteLength: 4096,
        durationMs: 5,
        ok: true,
        payloadSha256: "c".repeat(64),
        responseBodyBytes: 2,
        status: 200,
      },
      ok: true,
      runnerBundle: null,
      service: "cloudflare-hosted-runner-node",
      status: 200,
    }));
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
      RUNNER_CONTAINER_SMOKE: {
        getByName() {
          return {
            async destroyInstance() {},
            async invoke(): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
              throw new Error("Runner container should not be invoked by direct R2 smoke route tests.");
            },
            smokeHealth,
          };
        },
      },
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/direct-r2-presigned-put",
        {
          body: JSON.stringify({
            byteLength: 4096,
            presignedPutUrl,
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      ), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(smokeHealth).toHaveBeenCalledWith({
      directR2PresignedPut: {
        byteLength: 4096,
        presignedPutUrl,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      directR2PresignedPut: {
        byteLength: 4096,
        ok: true,
        status: 200,
      },
      ok: true,
      service: "cloudflare-hosted-runner",
    });
  });

  it("reads hosted-local test bundle refs for correctly bound callers", async () => {
    const bundleBytes = Buffer.from("bundle-payload\n", "utf8");
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });
    const bundleStore = createHostedBundleStore({
      bucket: env.BUNDLES,
      key: getTestHostedRuntimeRootKey("runtime"),
      keyId: "udrk:runtime:test-root",
      userId: "member_123",
    });
    const bundleRef = await bundleStore.writeBundle("vault", bundleBytes);
    const url = "https://runner.example.test/__test/artifacts"
      + `?userId=member_123&sha256=${bundleRef.hash}`
      + `&key=${encodeURIComponent(bundleRef.key)}&size=${bundleRef.size}`;

    const readResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(url, {
        method: "GET",
      }), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(readResponse.status).toBe(200);
    expect(Buffer.from(await readResponse.arrayBuffer())).toEqual(bundleBytes);
  });

  it.each(["10abc", "1e3", "0x10"])(
    "rejects malformed hosted-local test bundle ref size %s",
    async (size) => {
      const env = createWorkerEnv(createUserRunnerStub(), {
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "test",
      });
      const url = "https://runner.example.test/__test/artifacts"
        + "?userId=member_123"
        + "&sha256=fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b"
        + "&key=cloudflare-workspace-snapshots%2Ffec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b.bundle"
        + `&size=${encodeURIComponent(size)}`;

      const response = await hostedLocalTestWorker.fetch(
        await signControlRequest(new Request(url, {
          method: "GET",
        }), {
          boundUserId: "member_123",
        }),
        env,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "size is required.",
      });
    },
  );

  it("reads artifact-backed hosted-local workspace snapshot bundle refs", async () => {
    const snapshotBytes = Buffer.from("workspace-snapshot-payload\n", "utf8");
    const snapshotSha256 = createHash("sha256").update(snapshotBytes).digest("hex");
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });
    const artifactUrl = `https://runner.example.test/__test/artifacts?userId=member_123&sha256=${snapshotSha256}`;
    const bundleUrl = artifactUrl
      + `&key=${encodeURIComponent(`cloudflare-workspace-snapshots/${snapshotSha256}.bundle`)}`
      + `&size=${snapshotBytes.byteLength}`;

    const writeResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(artifactUrl, {
        body: snapshotBytes,
        method: "PUT",
      }), {
        boundUserId: "member_123",
      }),
      env,
    );
    expect(writeResponse.status).toBe(200);

    const readResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(bundleUrl, {
        method: "GET",
      }), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(readResponse.status).toBe(200);
    expect(Buffer.from(await readResponse.arrayBuffer())).toEqual(snapshotBytes);
  });

  it("runs the hosted-local test alarm route for correctly bound callers", async () => {
    const stub = createUserRunnerStub({
      runAlarmForTest: vi.fn(async () => ({ ok: true })),
    });
    const env = createWorkerEnv(stub, {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/alarm",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(stub.runAlarmForTest).toHaveBeenCalledWith({ userId: "member_123" });
  });

  it("starts the hosted-local stuck invocation test route for correctly bound callers", async () => {
    const stub = createUserRunnerStub({
      startStuckInvocationForTest: vi.fn(async () => ({
        attemptId: "workspace-invocation-test",
        nextWakeAt: "2026-05-09T00:00:00.000Z",
        ok: true as const,
      })),
    });
    const env = createWorkerEnv(stub, {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/stuck-invocation",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      attemptId: "workspace-invocation-test",
      nextWakeAt: "2026-05-09T00:00:00.000Z",
      ok: true,
    });
    expect(stub.startStuckInvocationForTest).toHaveBeenCalledWith({ userId: "member_123" });
  });

  it("starts a stale hosted-local stuck invocation test route for correctly bound callers", async () => {
    const stub = createUserRunnerStub({
      startStuckInvocationForTest: vi.fn(async () => ({
        attemptId: "workspace-invocation-test",
        nextWakeAt: "2026-05-09T00:00:00.000Z",
        ok: true as const,
      })),
    });
    const env = createWorkerEnv(stub, {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/stuck-invocation?reason=manual&startedAgoMs=35000",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(stub.startStuckInvocationForTest).toHaveBeenCalledWith({
      reason: "manual",
      startedAgoMs: 35000,
      userId: "member_123",
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
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/status?logLimit=999", {
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
    expect(stub.runnerStatus).toHaveBeenCalledWith({ logLimit: 50 });

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

  it("ignores malformed per-user status log limits instead of partially parsing them", async () => {
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
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/status?logLimit=10abc", {
        method: "GET",
      })),
      createWorkerEnv(stub),
    );

    expect(statusResponse.status).toBe(200);
    expect(stub.runnerStatus).toHaveBeenCalledTimes(1);
    expect(stub.runnerStatus).toHaveBeenCalledWith(undefined);
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
            browserPublicKeyJwk: await createBrowserSessionPublicKeyJwk(),
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

  it("returns browser-vault sessions keyed by the replica storage key id", async () => {
    const env = createWorkerEnv();
    const runtimeRoot = await resolveHostedUserCryptoContextForTest(env, "member_123");
    const replicaRef = await createStoredBrowserVaultReplicaRefForTest(env, "member_123", {
      rootKey: runtimeRoot.rootKey,
      rootKeyId: runtimeRoot.rootKeyId,
    });

    const response = await worker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/internal/users/member_123/browser-vault/session",
        {
          body: JSON.stringify({
            browserPublicKeyJwk: await createBrowserSessionPublicKeyJwk(),
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

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      replicaRef,
      state: "ready",
    });
    const sessionKeyEnvelope = parseHostedBrowserSessionKeyEnvelope(
      (body as { replicaKeyEnvelope?: unknown }).replicaKeyEnvelope,
    );
    expect(sessionKeyEnvelope.keyId).toBe(replicaRef.dataKeyEnvelope?.dataKeyId ?? replicaRef.keyId);
  });

  it("returns the stable browser-vault missing-replica code when the replica runtime root is unavailable", async () => {
    const env = createWorkerEnv();
    const unavailableRootKeyId = "udrk:runtime:retired-root";
    const replicaRef = await createStoredBrowserVaultReplicaRefForTest(env, "member_123", {
      rootKey: Uint8Array.from({ length: 32 }, (_, index) => 201 - index),
      rootKeyId: unavailableRootKeyId,
    });
    const signedRequest = await signControlRequest(new Request(
      "https://runner.example.test/internal/users/member_123/browser-vault/session",
      {
        body: JSON.stringify({
          browserPublicKeyJwk: await createBrowserSessionPublicKeyJwk(),
          replicaRef,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    ));
    const rootFetches: unknown[] = [];
    installOidcJwksFetch(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname !== HOSTED_RUNTIME_CRYPTO_ROOT_PATH) {
        throw new Error(`Unexpected delegated fetch during browser-vault root lookup test: ${String(input)}`);
      }

      rootFetches.push(JSON.parse(String(init?.body)));
      return Response.json({ error: "Runtime root not found." }, { status: 404 });
    });

    const response = await worker.fetch(signedRequest, env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
      error: "Browser vault replica was not found.",
    });
    expect(rootFetches).toEqual([{
      domain: "runtime",
      rootKeyId: unavailableRootKeyId,
    }]);
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
            browserPublicKeyJwk: await createBrowserSessionPublicKeyJwk(),
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

  it("does not expose the removed runner nudge route", async () => {
    const stub = createUserRunnerStub();
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

    expect(response.status).toBe(404);
    expect(stub.bindUser).not.toHaveBeenCalled();
    expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
  });

  it("passes the test run-until-idle reason to the Durable Object", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/run-until-idle?reason=manual",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      nextWakeAt: null,
      status: "idle",
    });
    expect(stub.runUntilIdleForTest).toHaveBeenCalledWith({
      reason: "manual",
      userId: "member_123",
    });
  });

  it("rejects unsupported test run-until-idle reasons", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/run-until-idle?reason=unsupported",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_123",
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported test workspace invocation reason.",
    });
    expect(stub.runUntilIdleForTest).not.toHaveBeenCalled();
  });

  it("rejects non-decimal positive integers on hosted-local test control helpers", () => {
    expect(parseTestPositiveInteger("45000")).toBe(45_000);
    expect(parseTestPositiveInteger("45e3")).toBe("invalid");
    expect(parseTestPositiveInteger("45000ms")).toBe("invalid");
    expect(parseTestPositiveInteger(" 45000")).toBe("invalid");
    expect(parseTestPositiveIntegerValue(45_000)).toBe(45_000);
    expect(parseTestPositiveIntegerValue("45000")).toBe(45_000);
    expect(parseTestPositiveIntegerValue("45e3")).toBe("invalid");
    expect(parseTestPositiveIntegerValue("45000ms")).toBe("invalid");
    expect(parseTestPositiveIntegerValue("45000 ")).toBe("invalid");
  });

  describe("hosted runtime control", () => {
    it("maps runtime ensure-processing route calls to the Durable Object adapter", async () => {
      const stub = createUserRunnerStub({
        ensureRuntimeProcessingForUser: vi.fn(async () => ({
          action: "started" as const,
          kind: "runtime_processing_accepted" as const,
          recommendedRecheckAt: "2026-04-27T00:03:00.000Z",
          runtimeAttemptId: "runtime-attempt-test",
        })),
      });
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        await signWebCallbackControlRequest(
          new Request("https://runner.example.test/internal/users/test-user/runtime/ensure-processing", {
            body: JSON.stringify({
              orchestrationAttemptId: "orchestration-attempt-test",
              reason: "nudge",
              source: "workspace_wake",
            }),
            headers: {
              "content-type": "application/json; charset=utf-8",
              [HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER]: "10000",
            },
            method: "POST",
          }),
          env,
        ),
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        action: "started",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-04-27T00:03:00.000Z",
        runtimeAttemptId: "runtime-attempt-test",
      });
      expect(stub.ensureRuntimeProcessingForUser).toHaveBeenCalledWith({
        orchestrationAttemptId: "orchestration-attempt-test",
        commandTimeoutMs: 10_000,
        reason: "nudge",
        source: "workspace_wake",
        userId: "test-user",
      });
    });

    it("maps runtime prewarm route calls to the prewarm-only Durable Object adapter", async () => {
      const stub = createUserRunnerStub({
        prewarmRuntimeContainerForUser: vi.fn(async () => ({
          action: "already_warm" as const,
          kind: "runtime_prewarm_accepted" as const,
        })),
      });
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        await signWebCallbackControlRequest(
          new Request("https://runner.example.test/internal/users/test-user/runtime/prewarm", {
            body: JSON.stringify({
              prewarmAttemptId: "prewarm-attempt-test",
              source: "linq.imessage.typing",
            }),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          }),
          env,
        ),
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        action: "already_warm",
        kind: "runtime_prewarm_accepted",
      });
      expect(stub.prewarmRuntimeContainerForUser).toHaveBeenCalledWith({
        prewarmAttemptId: "prewarm-attempt-test",
        source: "linq.imessage.typing",
        userId: "test-user",
      });
      expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
    });

    it("returns retry-later for runtime prewarm Durable Object RPC failures", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
      const stub = createUserRunnerStub({
        prewarmRuntimeContainerForUser: vi.fn(async () => {
          throw new Error("durable object unavailable");
        }),
      });
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        await signWebCallbackControlRequest(
          new Request("https://runner.example.test/internal/users/test-user/runtime/prewarm", {
            body: JSON.stringify({
              prewarmAttemptId: "prewarm-attempt-rpc-failure",
              source: "linq.imessage.typing",
            }),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          }),
          env,
        ),
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        kind: "retry_later",
        retryAt: "2026-04-27T00:00:30.000Z",
      });
      expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
    });

    it("returns a stable code for invalid runtime ensure-processing requests", async () => {
      const stub = createUserRunnerStub();
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        await signWebCallbackControlRequest(
          new Request("https://runner.example.test/internal/users/test-user/runtime/ensure-processing", {
            body: JSON.stringify({
              orchestrationAttemptId: "orchestration-attempt-test",
              reason: "nudge",
              source: "unsupported-source",
            }),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          }),
          env,
        ),
        env,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        code: "invalid_request",
        error: "Invalid request.",
      });
      expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
    });

    it("accepts runtime ensure-processing requests without timeout metadata", async () => {
      const stub = createUserRunnerStub();
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        await signWebCallbackControlRequest(
          new Request("https://runner.example.test/internal/users/test-user/runtime/ensure-processing", {
            body: JSON.stringify({
              orchestrationAttemptId: "orchestration-attempt-test",
              reason: "nudge",
              source: "workspace_wake",
            }),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          }),
          env,
        ),
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        action: "woken",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-04-27T00:00:10.000Z",
        runtimeAttemptId: "runtime-attempt-test",
      });
      expect(stub.ensureRuntimeProcessingForUser).toHaveBeenCalledWith({
        orchestrationAttemptId: "orchestration-attempt-test",
        reason: "nudge",
        source: "workspace_wake",
        userId: "test-user",
      });
    });

    it("rejects invalid runtime ensure-processing timeout headers before calling the Durable Object", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");

      for (const invalidTimeout of [
        "10000ms",
        "10e3",
        "not-a-timeout",
        String(HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS),
      ]) {
        const stub = createUserRunnerStub();
        const env = createWorkerEnv(stub);

        const response = await worker.fetch(
          await signWebCallbackControlRequest(
            new Request("https://runner.example.test/internal/users/test-user/runtime/ensure-processing", {
              body: JSON.stringify({
                orchestrationAttemptId: "orchestration-attempt-test",
                reason: "nudge",
                source: "workspace_wake",
              }),
              headers: {
                "content-type": "application/json; charset=utf-8",
                [HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER]: invalidTimeout,
              },
              method: "POST",
            }),
            env,
          ),
          env,
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          code: "invalid_request",
          error: "Invalid request.",
        });
        expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
      }

      const serializedWarnLogs = warn.mock.calls
        .map(([payload]) => String(payload))
        .join("\n");
      expect(serializedWarnLogs).toContain("runtime-ensure-processing-request-invalid");
      expect(serializedWarnLogs).toContain("/internal/users/<REDACTED_USER>/runtime/ensure-processing");
      expect(serializedWarnLogs).not.toContain("/internal/users/test-user/runtime/ensure-processing");
    });

    it("starts runtime processing without an active fence", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
      const runtimeNextWakeAt = "2026-04-27T00:04:00.000Z";
      const { alarms, invoke, runner, sql, waitUntil } = createRuntimeControlRunnerHarness({
        invocationResults: [{
          nextWakeAt: runtimeNextWakeAt,
          nextWakeReason: "assistant",
          status: "idle",
        }],
      });

      const response = await runner.ensureRuntimeProcessingForUser({
        orchestrationAttemptId: "orchestration-attempt-test",
        reason: "nudge",
        userId: "test-user",
      });

      expect(response).toEqual({
        action: "started",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-04-27T00:01:00.000Z",
        runtimeAttemptId: expect.stringMatching(/^runtime-write-/u),
      });
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke.mock.calls[0]?.[0].job.request).toMatchObject({
        reason: "nudge",
        userId: "test-user",
        workspaceVersion: "7",
      });
      expect(waitUntil).toHaveBeenCalledOnce();
      const background = waitUntil.mock.calls[0]?.[0];
      if (background instanceof Promise) {
        await background;
      }
      expect(readRunnerMetaForRuntimeControl(sql)).toMatchObject({
        active_attempt_id: null,
        backoff_until: null,
        failure_count: 0,
        wake_at: null,
      });
      expect(alarms).toContain("deleted");
      expect(alarms).not.toContain(runtimeNextWakeAt);
    });

    it("sends a payloadless wake for an active fence", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
      const { ensureProcessing, invoke, runner, sql } = createRuntimeControlRunnerHarness({
        ensureProcessing: vi.fn(async () => ({
          action: "woken" as const,
          kind: "accepted" as const,
        })),
      });
      const token = await writeRuntimeControlFenceForTest({
        runner,
        sql,
        userId: "test-user",
        workspaceVersion: "7",
      });

      const response = await runner.ensureRuntimeProcessingForUser({
        orchestrationAttemptId: "orchestration-attempt-test",
        reason: "nudge",
        userId: "test-user",
      });

      expect(response).toEqual({
        action: "woken",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-04-27T00:01:00.000Z",
        runtimeAttemptId: token.attemptId,
      });
      expect(ensureProcessing).toHaveBeenCalledWith({
        activeRuntime: {
          attemptId: token.attemptId,
          leaseGeneration: token.generation,
          userId: "test-user",
        },
        reason: "nudge",
        userId: "test-user",
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(readRunnerMetaForRuntimeControl(sql)).toMatchObject({
        active_attempt_id: token.attemptId,
        backoff_until: null,
        wake_at: null,
      });
    });

    it("returns retry_later for a fresh no-active-child fence instead of pretending it is running", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
      const { ensureProcessing, invoke, runner, sql } = createRuntimeControlRunnerHarness({
        ensureProcessing: vi.fn(async () => ({
          kind: "start-required" as const,
          reason: "no-active-child" as const,
        })),
        invocationResults: [{ nextWakeAt: null, status: "idle" }],
      });
      const oldToken = await writeRuntimeControlFenceForTest({
        runner,
        sql,
        userId: "test-user",
        workspaceVersion: "7",
      });

      const response = await runner.ensureRuntimeProcessingForUser({
        orchestrationAttemptId: "orchestration-attempt-test",
        reason: "nudge",
        userId: "test-user",
      });

      expect(response).toEqual({
        kind: "retry_later",
        retryAt: "2026-04-27T00:00:10.000Z",
      });
      expect(ensureProcessing).toHaveBeenCalledOnce();
      expect(ensureProcessing).toHaveBeenCalledWith({
        activeRuntime: {
          attemptId: oldToken.attemptId,
          leaseGeneration: oldToken.generation,
          userId: "test-user",
        },
        reason: "nudge",
        userId: "test-user",
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(readRunnerMetaForRuntimeControl(sql)).toMatchObject({
        active_attempt_id: oldToken.attemptId,
        backoff_until: null,
        wake_at: null,
      });
    });

    it("returns retry_later for unconfirmed active wakes and preserves the fence", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
      const { invoke, runner, sql } = createRuntimeControlRunnerHarness({
        ensureProcessing: vi.fn(async () => ({
          kind: "wake-unconfirmed" as const,
          reason: "container-rpc-timeout" as const,
        })),
      });
      const token = await writeRuntimeControlFenceForTest({
        runner,
        sql,
        userId: "test-user",
        workspaceVersion: "7",
      });

      await expect(runner.ensureRuntimeProcessingForUser({
        orchestrationAttemptId: "orchestration-attempt-test",
        reason: "nudge",
        userId: "test-user",
      })).resolves.toEqual({
        kind: "retry_later",
        retryAt: "2026-04-27T00:00:10.000Z",
      });

      expect(invoke).not.toHaveBeenCalled();
      expect(readRunnerMetaForRuntimeControl(sql)).toMatchObject({
        active_attempt_id: token.attemptId,
        backoff_until: null,
        wake_at: null,
      });
    });

  });

  it("requires the bound-user auth header on runtime ensure-processing requests", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub);

    const response = await worker.fetch(
      await signWebCallbackControlRequest(
        new Request("https://runner.example.test/internal/users/test-user/runtime/ensure-processing", {
          body: JSON.stringify({
            orchestrationAttemptId: "orchestration-attempt-test",
            reason: "nudge",
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        }),
        env,
        {
          boundUserId: "other-test-user",
        },
      ),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the route user.",
    });
    expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
  });

  it("does not expose the removed browser-vault refresh route", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub);

    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/browser-vault/refresh", {
        body: "{}",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      })),
      env,
    );

    expect(response.status).toBe(404);
    expect(stub.bindUser).not.toHaveBeenCalled();
    expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
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
    expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
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

  it("does not expose the legacy hosted-run nudge route", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      await signControlRequest(new Request("https://runner.example.test/internal/users/member_123/run", {
        method: "POST",
      })),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(404);
    expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
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

  it("keeps auth-before-method ordering on protected user routes", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/status", {
        method: "POST",
      }),
      createWorkerEnv(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("returns 405 before bound-user validation on user-bound routes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");

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

    const serializedWarnLogs = warn.mock.calls
      .map(([payload]) => String(payload))
      .join("\n");
    expect(serializedWarnLogs).toContain("wrong-method");
    expect(serializedWarnLogs).toContain("/internal/users/<REDACTED_USER>/status");
    expect(serializedWarnLogs).not.toContain("/internal/users/member_123/status");
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
type RuntimeControlMetaRow = {
  active_attempt_id: string | null;
  backoff_until: string | null;
  failure_count: number;
  wake_at: string | null;
};

function createRuntimeControlRunnerHarness(input: {
  afterInvocationResult?: (input: {
    result: HostedWorkspaceInvocationResult;
    sql: ReturnType<typeof createTestSqlStorage>;
  }) => void;
  deleteAlarmError?: Error;
  ensureReadyForProcessing?: HostedExecutionContainerStubLike["ensureReadyForProcessing"];
  ensureProcessing?: HostedExecutionContainerStubLike["ensureProcessing"];
  invocationResults?: Array<Error | HostedWorkspaceInvocationResult>;
  workspace?: HostedWorkspaceState | null;
} = {}) {
  installOidcJwksFetch(async (requestInput) => {
    const url = new URL(String(requestInput));
    if (url.pathname === HOSTED_RUNTIME_WORKSPACE_PATH) {
      return Response.json({
        fetchedAt: "2026-04-27T00:00:00.000Z",
        workspace: input.workspace ?? createRuntimeControlWorkspaceState("test-user"),
      });
    }

    throw new Error(`Unexpected hosted runtime control fetch: ${String(requestInput)}`);
  });

  const alarms: string[] = [];
  const values = new Map<string, unknown>();
  const sql = createTestSqlStorage();
  const storage: DurableObjectStorageLike = {
    delete: vi.fn(async (key: string) => values.delete(key)),
    deleteAlarm: vi.fn(async () => {
      if (input.deleteAlarmError) {
        throw input.deleteAlarmError;
      }
      alarms.push("deleted");
    }),
    async get<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    getAlarm: vi.fn(async () => null),
    async list<T>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
      const result = new Map<string, T>();
      for (const [key, value] of values) {
        if (!options.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T);
        }
      }
      return result;
    },
    async put<T>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
    setAlarm: vi.fn(async (scheduledTime: number | Date) => {
      const date = scheduledTime instanceof Date
        ? scheduledTime
        : new Date(scheduledTime);
      alarms.push(date.toISOString());
    }),
    sql,
  };
  const waitUntil = vi.fn();
  const invocationResults = [...(input.invocationResults ?? [])];
  const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
    const next = invocationResults.shift() ?? { nextWakeAt: null, status: "idle" };
    if (next instanceof Error) {
      throw next;
    }
    input.afterInvocationResult?.({
      result: next,
      sql,
    });
    return next;
  });
  const stub: HostedExecutionContainerStubLike = {
    destroyInstance: vi.fn(async () => undefined),
    ensureReadyForProcessing: vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async (ensureInput) =>
      await input.ensureReadyForProcessing?.(ensureInput) ?? { kind: "ready" }
    ),
    ...(input.ensureProcessing
      ? {
          ensureProcessing: vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
            async (ensureInput) => {
              if (ensureInput.invoke) {
                return {
                  action: ensureInput.activeRuntime ? "restarted" : "started",
                  kind: "accepted",
                  result: await invoke(ensureInput.invoke),
                };
              }

              const result = await input.ensureProcessing?.(ensureInput);
              return result ?? {
                kind: "start-required",
                reason: "no-active-child",
              };
            },
          ),
        }
      : {}),
    invoke,
    smokeHealth: vi.fn(async () => ({
      ok: true,
      runnerBundle: null,
      service: "runner",
      status: 200,
    })),
  };
  const namespace: HostedExecutionContainerNamespaceLike = {
    getByName: vi.fn(() => stub),
  };
  const runner = new HostedUserRunner(
    {
      storage,
      waitUntil(promise) {
        waitUntil(promise);
      },
    } satisfies DurableObjectStateLike,
    readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "54000",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "1000",
    })),
    createBucketStore().api,
    {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
    },
    namespace,
  );

  return {
    alarms,
    ensureProcessing: stub.ensureProcessing,
    invoke,
    namespace,
    runner,
    sql,
    storage,
    waitUntil,
  };
}

function createRuntimeControlWorkspaceState(userId: string): HostedWorkspaceState {
  return {
    createdAt: "2026-04-27T00:00:00.000Z",
    snapshotRef: null,
    updatedAt: "2026-04-27T00:00:00.000Z",
    userId,
    version: "7",
  };
}

function readRunnerMetaForRuntimeControl(
  sql: ReturnType<typeof createTestSqlStorage>,
): RuntimeControlMetaRow {
  return sql.exec<RuntimeControlMetaRow>(
    `SELECT active_attempt_id, backoff_until, failure_count, wake_at
     FROM runner_meta
     WHERE singleton = 1`,
  ).one();
}

async function writeRuntimeControlFenceForTest(input: {
  runner: HostedUserRunner;
  sql: ReturnType<typeof createTestSqlStorage>;
  userId: string;
  workspaceVersion: string;
}): Promise<{
  attemptId: string;
  generation: string;
}> {
  await input.runner.bindUser(input.userId);
  const attemptId = "attempt_runtime_control_active";
  const generation = 2;
  input.sql.exec(
    `UPDATE runner_meta
     SET active_attempt_id = ?,
         active_generation = ?,
         active_kind = ?,
         active_reason = ?,
         active_runner_container_name = ?,
         active_started_at = ?,
         active_workspace_version = ?
     WHERE singleton = 1`,
    attemptId,
    generation,
    "runtime",
    "nudge",
    input.userId,
    "2026-04-27T00:00:00.000Z",
    input.workspaceVersion,
  );
  return {
    attemptId,
    generation: String(generation),
  };
}

function createRunnerContainerNamespace(): WorkerEnvironmentSource["RUNNER_CONTAINER"] {
  return {
    getByName(name: string) {
      return {
        async destroyInstance() {},
        async invoke(): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
          throw new Error("Runner container should not be invoked by route tests.");
        },
        async smokeHealth() {
          return {
            codexShell: createCodexShellSmokeResult(),
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

function createCodexShellSmokeResult() {
  return {
    client: "codex-app-server",
    murphPathBytes: 28,
    noteAddBytes: 128,
    stderrBytes: 0,
    vaultCliLlmsBytes: 4096,
    vaultCliPathBytes: 32,
    vaultShowBytes: 256,
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
    RUNNER_CONTAINER_SMOKE: createRunnerContainerNamespace(),
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
  return handleRunnerOutboundRequest(
    request,
    env,
    userId ,
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

async function createBrowserSessionPublicKeyJwk(): Promise<JsonWebKey> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return crypto.subtle.exportKey("jwk", keyPair.publicKey);
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
      userId,
    }),
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: crypto.rootKeyId,
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: "a".repeat(64),
  };
}

async function createStoredBrowserVaultReplicaRefForTest(
  env: WorkerTestEnv,
  userId: string,
  input: {
    rootKey: Uint8Array;
    rootKeyId: string;
  },
) {
  await resolveHostedUserCryptoContextForTest(env, userId);
  const store = createHostedBrowserVaultReplicaStore({
    bucket: env.BUNDLES,
    rootKey: input.rootKey,
    rootKeyId: input.rootKeyId,
    userId,
  });
  const replica = await createBrowserVaultReplica({
    metricPoints: [],
    generatedAt: "2026-04-20T08:00:00.000Z",
    sourceBundleHash: "a".repeat(64),
    vault: createVaultReadModel({
      entities: [],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  return store.writeBrowserVaultReplica({ replica, userId });
}

async function hostedArtifactObjectKeyForTest(
  env: WorkerTestEnv,
  userId: string,
  sha256: string,
): Promise<string> {
  await resolveHostedUserCryptoContextForTest(env, userId);
  return hostedArtifactObjectKey({ sha256, userId });
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

type WorkerTestUserRunnerStub = UserRunnerDurableObjectStubLike & {
  runAlarmForTest(input: { userId: string }): Promise<{ ok: true }>;
  runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult>;
  startStuckInvocationForTest(input: {
    reason?: HostedWorkspaceInvocationReason;
    startedAgoMs?: number;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult>;
};

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
    ensureRuntimeProcessingForUser: vi.fn(async () => ({
      action: "woken" as const,
      kind: "runtime_processing_accepted" as const,
      recommendedRecheckAt: "2026-04-27T00:00:10.000Z",
      runtimeAttemptId: "runtime-attempt-test",
    })),
    prewarmRuntimeContainerForUser: vi.fn(async () => ({
      action: "already_warm" as const,
      kind: "runtime_prewarm_accepted" as const,
    })),
    runUntilIdleForTest: vi.fn(async () => ({
      nextWakeAt: null,
      status: "idle" as const,
    })),
    runAlarmForTest: vi.fn(async () => ({ ok: true as const })),
    startStuckInvocationForTest: vi.fn(async () => ({
      attemptId: "workspace-invocation-test",
      nextWakeAt: null,
      ok: true as const,
    })),
    runnerStatus: vi.fn(async () => ({
      inFlight: false,
      mailboxLag: [],
      nextAlarmAt: null,
      recentLogs: [],
      userId: "member_123",
      workspace: null,
    })),
    validateRuntimeWriteFence: vi.fn(async () => true),
    ...overrides,
  } satisfies WorkerTestUserRunnerStub;
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

async function signWebCallbackControlRequest(
  request: Request,
  env: WorkerEnvironmentSource,
  input: { boundUserId?: string | null } = {},
): Promise<Request> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const derivedUserId = /^\/internal\/users\/(?<userId>[^/]+)/u.exec(url.pathname)?.groups?.userId;

  if (input.boundUserId !== null && (input.boundUserId || derivedUserId)) {
    headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId ?? derivedUserId ?? "");
  }

  const callbackSigning = readHostedExecutionEnvironment(
    asWorkerStringEnvironment(env),
  ).webCallbackSigning;
  const payload = await request.clone().text();
  const signatureHeaders = await createHostedWebCallbackSignatureHeaders({
    environment: callbackSigning,
    method: request.method,
    path: url.pathname,
    payload,
    search: url.search,
    userId: headers.get(HOSTED_EXECUTION_USER_ID_HEADER),
  });

  for (const [key, value] of Object.entries(signatureHeaders)) {
    headers.set(key, value);
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
