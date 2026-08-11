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
  readDeployContainerSmokeAttempt,
  resolveDeployContainerSmokeObjectName,
} from "../src/worker/route-handlers/deploy-smoke.ts";
import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
} from "../src/deploy-smoke-live-model.ts";
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
  hostedWorkspaceSnapshotObjectKey,
} from "../src/storage-paths.ts";
import type {
  UserRunnerDurableObjectStubLike,
  WorkerExecutionContext,
  WorkerEnvironmentSource,
} from "../src/worker-routes/shared.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import {
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_ACTIVITY_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_DIRECT_REQUEST_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_REQUEST_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_CRYPTO_ROOT_PATH,
  HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type {
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
    expect(workerSource).not.toContain("readActiveRuntimeFenceForTest");
    expect(workerSource).not.toContain("armCanonicalCheckpointLostAckForTest");
    expect(workerSource).not.toContain("foregroundPriorityOrderingControlForTest");
    expect(workerSource).not.toContain("armSnapshotPublicationCorruptionForTest");
    expect(workerSource).not.toContain("armIdleSnapshotStartBarrierForTest");
    expect(workerSource).not.toContain("armShutdownCheckpointPublicationBarrierForTest");
    expect(workerSource).not.toContain("beginShutdownCheckpointGracefulStopForTest");
    expect(workerSource).not.toContain("readShutdownCheckpointPublicationBarrierForTest");
    expect(workerSource).not.toContain("releaseShutdownCheckpointPublicationBarrierForTest");
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
      "private-media-delivery",
      "service-banner",
    ]);
    expect(workerInternalRoutes.map(({ name }) => name)).toEqual([
      "deploy-container-smoke",
      "runtime-ensure-processing",
      "runtime-shell-prewarm",
      "runtime-health-data-consent",
      "inference-verification",
      "user-data-delete",
      "telegram-usage-limit-notice",
      "environment-voice-stage",
      "environment-voice-delete",
      "meal-photo-stage",
      "meal-photo-delete",
      "browser-vault-session",
      "user-status",
    ]);
    expect(hostedLocalTestInternalRoutes.map(({ name }) => name)).toEqual([
      "test-artifact-seed",
      "test-run-until-idle",
      "test-run-alarm",
      "test-canonical-checkpoint-lost-ack",
      "test-foreground-priority-ordering",
      "test-arm-generated-image-provider-barrier",
      "test-release-generated-image-provider-barrier",
      "test-snapshot-publication-corruption",
      "test-shutdown-checkpoint-publication-barrier",
      "test-container-activity-expired",
      "test-container-active-operation-drop",
      "test-read-active-runtime-fence",
      "test-start-stuck-invocation",
      "test-temporal-mailbox-signal-fault-arm",
      "test-temporal-mailbox-signal-fault-clear",
      "test-temporal-mailbox-signal-fault-consume",
      "test-direct-r2-presigned-put",
      "test-direct-r2-locator-marker",
      "deploy-container-smoke",
      "runtime-ensure-processing",
      "runtime-shell-prewarm",
      "runtime-health-data-consent",
      "inference-verification",
      "user-data-delete",
      "telegram-usage-limit-notice",
      "environment-voice-stage",
      "environment-voice-delete",
      "meal-photo-stage",
      "meal-photo-delete",
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

  it("returns smoke failure detail instead of a redacted 500 from the container smoke route", async () => {
    const env = createWorkerEnv(createUserRunnerStub(), {
      RUNNER_CONTAINER_SMOKE: {
        getByName() {
          return {
            async destroyInstance() {},
            async invoke(): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
              throw new Error("Runner container should not be invoked by smoke route tests.");
            },
            async smokeHealth() {
              throw new Error(
                "Hosted runner container Codex shell smoke failed with HTTP 500. "
                  + "Hosted Codex shell smoke assistant CLI surface contract was missing hot-path schemas. proofCount=1",
              );
            },
          };
        },
      },
    });
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

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      detail: "Hosted runner container Codex shell smoke failed with HTTP 500. "
        + "Hosted Codex shell smoke assistant CLI surface contract was missing hot-path schemas. proofCount=1",
      error: "Deploy container smoke failed.",
      ok: false,
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

  it("forwards the live model turn flag to the managed container smoke", async () => {
    const smokeHealth = vi.fn(async (input: {
      liveModelTurn?: {
        model: string;
      };
    }) => {
      if (input.liveModelTurn?.model !== DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL) {
        throw new Error("Expected the live model turn smoke input.");
      }

      return {
        liveModelTurn: {
          durationMs: 1_234,
          egressGrantConsumed: true,
          model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
          stdoutBytes: 2_048,
        },
        ok: true,
        runnerBundle: null,
        service: "cloudflare-hosted-runner-node",
        status: 200,
      };
    });
    const env = createWorkerEnv(createUserRunnerStub(), {
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
      "https://runner.example.test/internal/deploy/container-smoke?liveModelTurn=1",
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
      liveModelTurn: {
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      runnerContainer: {
        liveModelTurn: {
          durationMs: 1_234,
          egressGrantConsumed: true,
          model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
          stdoutBytes: 2_048,
        },
      },
      service: "cloudflare-hosted-runner",
    });
  });

  it("rejects unsupported live model turn values before managed container smoke", async () => {
    const smokeHealth = vi.fn(async () => {
      throw new Error("Runner container should not receive unsupported live model turn smoke.");
    });
    const env = createWorkerEnv(createUserRunnerStub(), {
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
      "https://runner.example.test/internal/deploy/container-smoke?liveModelTurn=gpt-5.6-terra",
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

    expect(response.status).toBe(400);
    expect(smokeHealth).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported deploy container smoke live model turn.",
      ok: false,
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

  it("routes a signed attempt-scoped deploy smoke request to its own container", async () => {
    const baseEnv = createWorkerEnv();
    const smokeGetByName = vi.fn(createRunnerContainerNamespace().getByName);
    const env = {
      ...baseEnv,
      CF_VERSION_METADATA: {
        id: "version-123",
        tag: "test",
        timestamp: "2026-04-24T00:00:00.000Z",
      },
      RUNNER_CONTAINER_SMOKE: {
        getByName: smokeGetByName,
      },
    };
    const url = new URL("https://runner.example.test/internal/deploy/container-smoke?attempt=2");
    const callbackSigning = readHostedExecutionEnvironment(asWorkerStringEnvironment(env)).webCallbackSigning;
    const request = new Request(url, {
      // Signing over the attempt-bearing search proves the smoke's attempt is
      // covered by the signature rather than an unauthenticated tack-on.
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
    expect(smokeGetByName).toHaveBeenCalledWith("__deploy-smoke-version-123-attempt-2");
  });

  it("rejects a signed deploy smoke request with a malformed attempt before starting a container", async () => {
    const baseEnv = createWorkerEnv();
    const smokeGetByName = vi.fn(createRunnerContainerNamespace().getByName);
    const env = {
      ...baseEnv,
      CF_VERSION_METADATA: {
        id: "version-123",
        tag: "test",
        timestamp: "2026-04-24T00:00:00.000Z",
      },
      RUNNER_CONTAINER_SMOKE: {
        getByName: smokeGetByName,
      },
    };
    const url = new URL("https://runner.example.test/internal/deploy/container-smoke?attempt=0");
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported deploy container smoke attempt.",
      ok: false,
    });
    expect(smokeGetByName).not.toHaveBeenCalled();
  });

  it("uses the local build deploy smoke Durable Object name before version metadata", () => {
    expect(resolveDeployContainerSmokeObjectName({
      CF_VERSION_METADATA: {
        id: "version-123",
        tag: "test",
        timestamp: "2026-04-24T00:00:00.000Z",
      },
      MURPH_HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "local build/123",
    })).toBe("__deploy-smoke-local-build-123");
  });

  it("uses version metadata before local build id without a hosted-local marker", () => {
    expect(resolveDeployContainerSmokeObjectName({
      CF_VERSION_METADATA: {
        id: "version-123",
        tag: "test",
        timestamp: "2026-04-24T00:00:00.000Z",
      },
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "local build/123",
    })).toBe("__deploy-smoke-version-123");
  });

  it("scopes the deploy smoke Durable Object name to the retry attempt", () => {
    const env = {
      CF_VERSION_METADATA: {
        id: "version-123",
        tag: "test",
        timestamp: "2026-04-24T00:00:00.000Z",
      },
    } as const;

    // The worker version is constant for a whole smoke run, so the attempt is the
    // only thing that moves a retry onto a fresh container instance.
    expect(resolveDeployContainerSmokeObjectName(env, 1))
      .toBe("__deploy-smoke-version-123-attempt-1");
    expect(resolveDeployContainerSmokeObjectName(env, 2))
      .toBe("__deploy-smoke-version-123-attempt-2");
    expect(resolveDeployContainerSmokeObjectName(env)).toBe("__deploy-smoke-version-123");
  });

  it("reads a positive deploy smoke attempt and rejects malformed ones", () => {
    const read = (search: string) =>
      readDeployContainerSmokeAttempt(
        new URL(`https://worker.example.test/internal/deploy/container-smoke${search}`),
      );

    expect(read("")).toBeNull();
    expect(read("?attempt=1")).toBe(1);
    expect(read("?attempt=300")).toBe(300);
    for (const search of ["?attempt=0", "?attempt=-1", "?attempt=1.5", "?attempt=abc", "?attempt=10000"]) {
      expect(() => read(search)).toThrow(RangeError);
    }
  });

  it("uses a local-build-specific deploy smoke Durable Object name in hosted-local mode", async () => {
    const baseEnv = createWorkerEnv();
    const runnerGetByName = vi.fn(createRunnerContainerNamespace().getByName);
    const smokeGetByName = vi.fn(createRunnerContainerNamespace().getByName);
    const env = {
      ...baseEnv,
      MURPH_HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID: "1",
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

  it("serves the user-bound Temporal mailbox fault lifecycle without OIDC in test mode", async () => {
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });
    const baseUrl =
      "https://runner.example.test/__test/users/member_123/temporal-mailbox-signal-fault";
    const requestHeaders = {
      "content-type": "application/json; charset=utf-8",
      [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
    };

    const mismatchedResponse = await hostedLocalTestWorker.fetch(
      new Request(`${baseUrl}/arm`, {
        body: JSON.stringify({ mailboxItemId: "mailbox-item-1" }),
        headers: {
          ...requestHeaders,
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_other",
        },
        method: "POST",
      }),
      env,
    );
    expect(mismatchedResponse.status).toBe(401);

    const armResponse = await hostedLocalTestWorker.fetch(
      new Request(`${baseUrl}/arm`, {
        body: JSON.stringify({ mailboxItemId: "mailbox-item-1" }),
        headers: requestHeaders,
        method: "POST",
      }),
      env,
    );
    expect(armResponse.status).toBe(200);
    await expect(armResponse.json()).resolves.toEqual({
      armed: true,
      deliveredToPendingConsumer: false,
    });

    const consumeResponse = await hostedLocalTestWorker.fetch(
      new Request(`${baseUrl}/consume`, {
        body: JSON.stringify({ mailboxItemId: "mailbox-item-1" }),
        headers: requestHeaders,
        method: "POST",
      }),
      env,
    );
    expect(consumeResponse.status).toBe(200);
    await expect(consumeResponse.json()).resolves.toEqual({ consume: true });

    const clearResponse = await hostedLocalTestWorker.fetch(
      new Request(`${baseUrl}/clear`, {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
        method: "POST",
      }),
      env,
    );
    expect(clearResponse.status).toBe(200);
    await expect(clearResponse.json()).resolves.toEqual({
      cleared: true,
      ok: true,
    });
  });

  it("hides the Temporal mailbox fault control outside hosted-local test mode", async () => {
    const response = await hostedLocalTestWorker.fetch(
      new Request(
        "https://runner.example.test/__test/users/member_123/temporal-mailbox-signal-fault/arm",
        {
          body: JSON.stringify({ mailboxItemId: "mailbox-item-1" }),
          headers: {
            "content-type": "application/json; charset=utf-8",
            [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
          },
          method: "POST",
        },
      ),
      createWorkerEnv(createUserRunnerStub(), {
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "production",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
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

    const activeOperationDropResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/container-active-operation-drop",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(activeOperationDropResponse.status).toBe(401);
    await expect(activeOperationDropResponse.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test runner user.",
    });

    const canonicalCheckpointLostAckResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/canonical-checkpoint-lost-ack",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(canonicalCheckpointLostAckResponse.status).toBe(401);
    await expect(canonicalCheckpointLostAckResponse.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test runner user.",
    });

    const foregroundPriorityOrderingResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123"
          + "/foreground-priority-ordering?action=status",
        { method: "POST" },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(foregroundPriorityOrderingResponse.status).toBe(401);
    await expect(foregroundPriorityOrderingResponse.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test runner user.",
    });

    const snapshotPublicationCorruptionResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/snapshot-publication-corruption",
        {
          method: "POST",
        },
      ), {
        boundUserId: "member_other",
      }),
      env,
    );

    expect(snapshotPublicationCorruptionResponse.status).toBe(401);
    await expect(snapshotPublicationCorruptionResponse.json()).resolves.toEqual({
      error: "Hosted execution bound user does not match the test runner user.",
    });

    const shutdownCheckpointPublicationBarrierResponse =
      await hostedLocalTestWorker.fetch(
        await signControlRequest(new Request(
          "https://runner.example.test/__test/users/member_123"
            + "/shutdown-checkpoint-publication-barrier?action=status",
          {
            method: "POST",
          },
        ), {
          boundUserId: "member_other",
        }),
        env,
      );

    expect(shutdownCheckpointPublicationBarrierResponse.status).toBe(401);
    await expect(shutdownCheckpointPublicationBarrierResponse.json()).resolves.toEqual({
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

  it("seeds a bound hosted-local direct R2 locator marker", async () => {
    const userId = "member_123";
    const snapshotId = "snapshot-direct-r2-marker";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId,
    });
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        `https://runner.example.test/__test/users/${userId}/direct-r2-locator-marker`,
        {
          body: JSON.stringify({ objectKey, snapshotId }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      ), {
        boundUserId: userId,
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(env.__bucketStore.keys()).toContain(objectKey);
  });

  it("rejects a hosted-local direct R2 locator marker outside the bound snapshot", async () => {
    const userId = "member_123";
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });
    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        `https://runner.example.test/__test/users/${userId}/direct-r2-locator-marker`,
        {
          body: JSON.stringify({
            objectKey: "users/other/workspace-snapshots/snapshot.snapshot.enc",
            snapshotId: "snapshot-direct-r2-marker",
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
      ), {
        boundUserId: userId,
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "objectKey does not match the bound snapshot.",
    });
    expect(env.__bucketStore.keys()).toEqual([]);
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

  it("drops the hosted-local runner active-operation pointer for correctly bound callers", async () => {
    const baseRunnerContainerNamespace = createRunnerContainerNamespace();
    const dropActiveOperationForTest = vi.fn(async () => ({ ok: true as const }));
    const getByName = vi.fn((name: string) => ({
      ...baseRunnerContainerNamespace.getByName(name),
      dropActiveOperationForTest,
    }));
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
      RUNNER_CONTAINER: {
        getByName,
      },
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/container-active-operation-drop",
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
    expect(getByName).toHaveBeenCalledWith(expect.stringContaining("member_123"));
    expect(dropActiveOperationForTest).toHaveBeenCalledWith({ userId: "member_123" });
  });

  it("arms canonical checkpoint lost-ack injection for correctly bound callers", async () => {
    const baseRunnerContainerNamespace = createRunnerContainerNamespace();
    const armCanonicalCheckpointLostAckForTest = vi.fn(async () => ({ ok: true as const }));
    const getByName = vi.fn((name: string) => ({
      ...baseRunnerContainerNamespace.getByName(name),
      armCanonicalCheckpointLostAckForTest,
    }));
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
      RUNNER_CONTAINER: {
        getByName,
      },
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/canonical-checkpoint-lost-ack",
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
    expect(getByName).toHaveBeenCalledWith(expect.stringContaining("member_123"));
    expect(armCanonicalCheckpointLostAckForTest).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  it("arms snapshot publication corruption for correctly bound callers", async () => {
    const baseRunnerContainerNamespace = createRunnerContainerNamespace();
    const armSnapshotPublicationCorruptionForTest = vi.fn(async () => ({ ok: true as const }));
    const getByName = vi.fn((name: string) => ({
      ...baseRunnerContainerNamespace.getByName(name),
      armSnapshotPublicationCorruptionForTest,
    }));
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
      RUNNER_CONTAINER: {
        getByName,
      },
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/snapshot-publication-corruption",
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
    expect(getByName).toHaveBeenCalledWith(expect.stringContaining("member_123"));
    expect(armSnapshotPublicationCorruptionForTest).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  it("controls the user-scoped shutdown checkpoint publication barrier", async () => {
    const baseRunnerContainerNamespace = createRunnerContainerNamespace();
    const armShutdownCheckpointPublicationBarrierForTest =
      vi.fn(async () => ({ ok: true as const }));
    const armCanonicalCheckpointPublicationBarrierForTest =
      vi.fn(async () => ({ ok: true as const }));
    const armIdleSnapshotStartBarrierForTest =
      vi.fn(async () => ({ ok: true as const }));
    const beginShutdownCheckpointGracefulStopForTest =
      vi.fn(async () => ({ ok: true as const }));
    const readShutdownCheckpointPublicationBarrierForTest =
      vi.fn(async () => ({ state: "entered" as const }));
    const releaseShutdownCheckpointPublicationBarrierForTest =
      vi.fn(async () => ({ ok: true as const, released: true }));
    const getByName = vi.fn((name: string) => ({
      ...baseRunnerContainerNamespace.getByName(name),
      armCanonicalCheckpointPublicationBarrierForTest,
      armIdleSnapshotStartBarrierForTest,
      armShutdownCheckpointPublicationBarrierForTest,
      beginShutdownCheckpointGracefulStopForTest,
      readShutdownCheckpointPublicationBarrierForTest,
      releaseShutdownCheckpointPublicationBarrierForTest,
    }));
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
      RUNNER_CONTAINER: {
        getByName,
      },
    });
    const request = async (
      action:
        | "arm"
        | "arm-canonical"
        | "arm-snapshot-start"
        | "release"
        | "shutdown"
        | "status",
    ) =>
      await hostedLocalTestWorker.fetch(
        await signControlRequest(new Request(
          "https://runner.example.test/__test/users/member_123"
            + `/shutdown-checkpoint-publication-barrier?action=${action}`,
          { method: "POST" },
        ), {
          boundUserId: "member_123",
        }),
        env,
      );

    const armResponse = await request("arm");
    const armCanonicalResponse = await request("arm-canonical");
    const armSnapshotStartResponse = await request("arm-snapshot-start");
    const statusResponse = await request("status");
    const shutdownResponse = await request("shutdown");
    const releaseResponse = await request("release");

    expect(armResponse.status).toBe(200);
    await expect(armResponse.json()).resolves.toEqual({ ok: true });
    expect(armCanonicalResponse.status).toBe(200);
    await expect(armCanonicalResponse.json()).resolves.toEqual({ ok: true });
    expect(armSnapshotStartResponse.status).toBe(200);
    await expect(armSnapshotStartResponse.json()).resolves.toEqual({ ok: true });
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual({ state: "entered" });
    expect(shutdownResponse.status).toBe(200);
    await expect(shutdownResponse.json()).resolves.toEqual({ ok: true });
    expect(releaseResponse.status).toBe(200);
    await expect(releaseResponse.json()).resolves.toEqual({ ok: true, released: true });
    expect(getByName).toHaveBeenCalledWith(expect.stringContaining("member_123"));
    expect(armShutdownCheckpointPublicationBarrierForTest).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(armCanonicalCheckpointPublicationBarrierForTest).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(armIdleSnapshotStartBarrierForTest).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(readShutdownCheckpointPublicationBarrierForTest).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(beginShutdownCheckpointGracefulStopForTest).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(releaseShutdownCheckpointPublicationBarrierForTest).toHaveBeenCalledWith({
      userId: "member_123",
    });

    const invalidResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123"
          + "/shutdown-checkpoint-publication-barrier?action=arm&extra=1",
        { method: "POST" },
      ), {
        boundUserId: "member_123",
      }),
      env,
    );
    expect(invalidResponse.status).toBe(400);
  });

  it("maps the user-scoped foreground-priority ordering controls", async () => {
    const baseRunnerContainerNamespace = createRunnerContainerNamespace();
    const foregroundPriorityOrderingControlForTest = vi.fn(
      async (input: unknown) => input,
    );
    const getByName = vi.fn((name: string) => ({
      ...baseRunnerContainerNamespace.getByName(name),
      foregroundPriorityOrderingControlForTest,
    }));
    const env = createWorkerEnv(createUserRunnerStub(), {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
      RUNNER_CONTAINER: {
        getByName,
      },
    });
    const request = async (action: string) =>
      await hostedLocalTestWorker.fetch(
        await signControlRequest(new Request(
          "https://runner.example.test/__test/users/member_123"
            + `/foreground-priority-ordering?action=${action}`,
          { method: "POST" },
        ), {
          boundUserId: "member_123",
        }),
        env,
      );

    for (const action of [
      "arm-canonical",
      "arm-empty-probe",
      "clear",
      "provider-start",
      "release",
      "status",
    ]) {
      const response = await request(action);
      expect(response.status).toBe(200);
    }

    expect(foregroundPriorityOrderingControlForTest.mock.calls).toEqual([
      [{
        action: "arm",
        barrierTarget: "canonical_post_commit",
        userId: "member_123",
      }],
      [{
        action: "arm",
        barrierTarget: "empty_conversation_probe",
        userId: "member_123",
      }],
      [{ action: "clear", userId: "member_123" }],
      [{ action: "record-provider-start", userId: "member_123" }],
      [{ action: "release", userId: "member_123" }],
      [{ action: "status", userId: "member_123" }],
    ]);
    expect(getByName).toHaveBeenCalledWith(expect.stringContaining("member_123"));

    const invalidResponse = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123"
          + "/foreground-priority-ordering?action=status&extra=1",
        { method: "POST" },
      ), {
        boundUserId: "member_123",
      }),
      env,
    );
    expect(invalidResponse.status).toBe(400);
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

  it("reads the active hosted-local runtime fence for correctly bound callers", async () => {
    const stub = createUserRunnerStub({
      readActiveRuntimeFenceForTest: vi.fn(async () => ({
        attemptId: "workspace-invocation-test",
        processingMode: "system_mailbox" as const,
      })),
    });
    const env = createWorkerEnv(stub, {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/active-runtime-fence",
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
      processingMode: "system_mailbox",
    });
    expect(stub.readActiveRuntimeFenceForTest).toHaveBeenCalledWith({
      userId: "member_123",
    });
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
        "https://runner.example.test/__test/users/member_123/stuck-invocation?startedAgoMs=35000",
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

  it("passes a reason-less test run-until-idle request to the Durable Object", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    const response = await hostedLocalTestWorker.fetch(
      await signControlRequest(new Request(
        "https://runner.example.test/__test/users/member_123/run-until-idle",
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
      userId: "member_123",
    });
  });

  it("rejects removed test run-until-idle reason query hints", async () => {
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
      error: "Test run-until-idle reason is no longer supported.",
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
            }),
            headers: {
              "content-type": "application/json; charset=utf-8",
              [HOSTED_RUNTIME_ENSURE_PROCESSING_ACTIVITY_STARTED_AT_MS_HEADER]:
                "1776999999000",
              [HOSTED_RUNTIME_ENSURE_PROCESSING_REQUEST_STARTED_AT_MS_HEADER]:
                "1776999999050",
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
        orchestration: {
          temporalActivityStartedAtEpochMs: 1_776_999_999_000,
          temporalActivityRequestStartedAtEpochMs: 1_776_999_999_050,
          runtimeControlAuthFinishedAtEpochMs: expect.any(Number),
          runtimeControlAuthStartedAtEpochMs: expect.any(Number),
          cloudflareRouteReceivedAtEpochMs: expect.any(Number),
        },
        userId: "test-user",
      });
    });

    it("runs runtime health-data consent reconciliation synchronously for Web OIDC", async () => {
      const reconcileRuntimeHealthDataConsentForUser = vi.fn(async () => ({
        activeInvocationPreempted: true,
        consentState: "revoked" as const,
        processingAllowed: false,
        runnerContainerDestroyAttempted: true,
        runnerContainerDestroyOk: true,
        userId: "test-user",
      }));
      const stub = createUserRunnerStub({ reconcileRuntimeHealthDataConsentForUser });
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        await signControlRequest(new Request(
          "https://runner.example.test/internal/users/test-user/runtime/health-data-consent",
          {
            body: "{}",
            headers: { "content-type": "application/json; charset=utf-8" },
            method: "POST",
          },
        )),
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        activeInvocationPreempted: true,
        consentState: "revoked",
        processingAllowed: false,
        runnerContainerDestroyAttempted: true,
        runnerContainerDestroyOk: true,
        userId: "test-user",
      });
      expect(reconcileRuntimeHealthDataConsentForUser).toHaveBeenCalledWith("test-user");
    });

    it("rejects callback-signature-only health-data reconciliation requests", async () => {
      const reconcileRuntimeHealthDataConsentForUser = vi.fn();
      const stub = createUserRunnerStub({ reconcileRuntimeHealthDataConsentForUser });
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        await signWebCallbackControlRequest(
          new Request(
            "https://runner.example.test/internal/users/test-user/runtime/health-data-consent",
            { body: "{}", method: "POST" },
          ),
          env,
        ),
        env,
      );

      expect(response.status).toBe(401);
      expect(reconcileRuntimeHealthDataConsentForUser).not.toHaveBeenCalled();
    });

    it("rejects nonempty runtime health-data consent reconciliation bodies", async () => {
      const reconcileRuntimeHealthDataConsentForUser = vi.fn();
      const stub = createUserRunnerStub({ reconcileRuntimeHealthDataConsentForUser });
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        await signControlRequest(new Request(
          "https://runner.example.test/internal/users/test-user/runtime/health-data-consent",
          {
            body: JSON.stringify({ consentState: "revoked" }),
            headers: { "content-type": "application/json; charset=utf-8" },
            method: "POST",
          },
        )),
        env,
      );

      expect(response.status).toBe(400);
      expect(reconcileRuntimeHealthDataConsentForUser).not.toHaveBeenCalled();
    });

    it("acks web-plane OIDC runtime ensure-processing requests early and schedules the Durable Object call", async () => {
      let resolveEnsure!: (value: {
        action: "woken";
        kind: "runtime_processing_accepted";
        recommendedRecheckAt: string;
        runtimeAttemptId: string;
      }) => void;
      const ensurePromise = new Promise<{
        action: "woken";
        kind: "runtime_processing_accepted";
        recommendedRecheckAt: string;
        runtimeAttemptId: string;
      }>((resolve) => {
        resolveEnsure = resolve;
      });
      const stub = createUserRunnerStub({
        ensureRuntimeProcessingForUser: vi.fn(() => ensurePromise),
      });
      const env = createWorkerEnv(stub);
      const execution = createWorkerExecutionContextForTest();

      const response = await worker.fetch(
        await signControlRequest(
          new Request("https://runner.example.test/internal/users/test-user/runtime/ensure-processing", {
            body: JSON.stringify({
              orchestrationAttemptId: "web-ingress-attempt-test",
            }),
            headers: {
              "content-type": "application/json; charset=utf-8",
              [HOSTED_RUNTIME_ENSURE_PROCESSING_DIRECT_REQUEST_STARTED_AT_MS_HEADER]:
                "1777000000012",
              [HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER]:
                "1777000000010",
              [HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER]:
                "1777000000000",
            },
            method: "POST",
          }),
        ),
        env,
        execution.ctx,
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        accepted: true,
      });
      expect(execution.waitUntil).toHaveBeenCalledTimes(1);
      expect(execution.waitUntilPromises).toHaveLength(1);
      expect(stub.ensureRuntimeProcessingForUser).toHaveBeenCalledWith({
        orchestrationAttemptId: "web-ingress-attempt-test",
        orchestration: {
          cloudflareRouteReceivedAtEpochMs: expect.any(Number),
          directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
          runtimeControlAuthFinishedAtEpochMs: expect.any(Number),
          runtimeControlAuthStartedAtEpochMs: expect.any(Number),
          tokenAcquiredAtEpochMs: 1_777_000_000_010,
          tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
          triggeredByWebDirect: true,
        },
        userId: "test-user",
      });
      resolveEnsure({
        action: "woken",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-04-27T00:03:00.000Z",
        runtimeAttemptId: "runtime-attempt-test",
      });
      await expect(execution.waitUntilPromises[0]).resolves.toEqual({
        action: "woken",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-04-27T00:03:00.000Z",
        runtimeAttemptId: "runtime-attempt-test",
      });
    });

    it("logs web-plane OIDC waitUntil ensure-processing failures without rethrowing", async () => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
      const stub = createUserRunnerStub({
        ensureRuntimeProcessingForUser: vi.fn(async () => {
          throw new Error("direct ensure failed");
        }),
      });
      const env = createWorkerEnv(stub);
      const execution = createWorkerExecutionContextForTest();

      const response = await worker.fetch(
        await signControlRequest(
          new Request("https://runner.example.test/internal/users/test-user/runtime/ensure-processing", {
            body: JSON.stringify({
              orchestrationAttemptId: "web-ingress-attempt-test",
            }),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          }),
        ),
        env,
        execution.ctx,
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        accepted: true,
      });
      expect(execution.waitUntilPromises).toHaveLength(1);
      await expect(execution.waitUntilPromises[0]).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalledTimes(1);
      const serializedErrorLogs = errorLog.mock.calls
        .map(([payload]) => String(payload))
        .join("\n");
      expect(serializedErrorLogs).toContain("runtime-ensure-processing-waituntil-failed");
      expect(serializedErrorLogs).toContain("/internal/users/<REDACTED_USER>/runtime/ensure-processing");
      expect(serializedErrorLogs).toContain("direct ensure failed");
    });

    it("rejects runtime ensure-processing requests whose only credential is an invalid OIDC bearer", async () => {
      const stub = createUserRunnerStub();
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        new Request("https://runner.example.test/internal/users/test-user/runtime/ensure-processing", {
          body: JSON.stringify({
            orchestrationAttemptId: "web-ingress-attempt-test",
          }),
          headers: {
            authorization: "Bearer not-a-jwt",
            "content-type": "application/json; charset=utf-8",
            [HOSTED_EXECUTION_USER_ID_HEADER]: "test-user",
          },
          method: "POST",
        }),
        env,
      );

      expect(response.status).toBe(401);
      expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
    });

    it("keeps a bad callback signature fail-closed even when a valid OIDC bearer is attached", async () => {
      const stub = createUserRunnerStub();
      const env = createWorkerEnv(stub);

      const signedRequest = await signWebCallbackControlRequest(
        new Request("https://runner.example.test/internal/users/test-user/runtime/ensure-processing", {
          body: JSON.stringify({
            orchestrationAttemptId: "orchestration-attempt-test",
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        }),
        env,
      );
      const tamperedHeaders = new Headers(signedRequest.headers);
      tamperedHeaders.set(HOSTED_EXECUTION_SIGNATURE_HEADER, "invalid-signature");
      installOidcJwksFetch();
      tamperedHeaders.set("authorization", `Bearer ${createTestVercelOidcToken({})}`);

      const response = await worker.fetch(
        new Request(signedRequest, { headers: tamperedHeaders }),
        env,
      );

      expect(response.status).toBe(401);
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
        orchestration: {
          cloudflareRouteReceivedAtEpochMs: expect.any(Number),
          runtimeControlAuthFinishedAtEpochMs: expect.any(Number),
          runtimeControlAuthStartedAtEpochMs: expect.any(Number),
        },
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

    it("keeps the removed runtime prewarm-hint route hidden from OIDC callers", async () => {
      const stub = createUserRunnerStub();
      const env = createWorkerEnv(stub);

      const response = await worker.fetch(
        await signControlRequest(
          new Request("https://runner.example.test/internal/users/test-user/runtime/prewarm-hint", {
            body: JSON.stringify({
              prewarmAttemptId: "linq-message:00000000-0000-4000-8000-000000000000",
              source: "linq.message.ingress",
            }),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          }),
        ),
        env,
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "Not found",
      });
      expect(stub.bindUser).not.toHaveBeenCalled();
      expect(stub.ensureRuntimeProcessingForUser).not.toHaveBeenCalled();
    });

    it("routes shell startup through the consent-owning user runner", async () => {
      const prewarmRuntimeShellForUser = vi.fn(async () => undefined);
      const stub = createUserRunnerStub({ prewarmRuntimeShellForUser });
      const runnerContainerGetByName = vi.fn();
      const userRunnerGetByName = vi.fn(() => stub);
      const env = createWorkerEnv(createUserRunnerStub(), {
        RUNNER_CONTAINER: { getByName: runnerContainerGetByName },
        USER_RUNNER: { getByName: userRunnerGetByName },
      });

      const response = await worker.fetch(
        await signControlRequest(new Request(
          "https://runner.example.test/internal/users/test-user/runtime/shell-prewarm",
          {
            body: JSON.stringify({ source: "linq-typing-started" }),
            headers: { "content-type": "application/json; charset=utf-8" },
            method: "POST",
          },
        )),
        env,
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({ accepted: true });
      expect(userRunnerGetByName).toHaveBeenCalledWith("test-user");
      expect(stub.bindUser).not.toHaveBeenCalled();
      expect(prewarmRuntimeShellForUser).toHaveBeenCalledWith(
        "test-user",
        "linq-typing-started",
      );
      expect(runnerContainerGetByName).not.toHaveBeenCalled();
    });

    it("does not recreate runner state for a delayed shell hint after account deletion", async () => {
      const request = await signControlRequest(new Request(
        "https://runner.example.test/internal/users/test-user/runtime/shell-prewarm",
        {
          body: "{}",
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "POST",
        },
      ));
      const harness = createRuntimeControlRunnerHarness({
        healthDataAdmission: {
          consentState: "missing",
          processingAllowed: false,
        },
      });
      await harness.runner.bindUser("test-user");
      await expect(
        harness.runner.deleteHostedUserData("test-user"),
      ).resolves.toMatchObject({ ok: true });
      vi.mocked(harness.namespace.getByName).mockClear();
      const bindUser = vi.fn(async (userId: string) =>
        await harness.runner.bindUser(userId)
      );
      const prewarmRuntimeShellForUser = vi.fn(async (userId: string) =>
        await harness.runner.prewarmRuntimeShellForUser(userId)
      );
      const stub = createUserRunnerStub({
        bindUser,
        prewarmRuntimeShellForUser,
      });
      const env = createWorkerEnv(createUserRunnerStub(), {
        USER_RUNNER: {
          getByName: vi.fn(() => stub),
        },
      });

      const response = await worker.fetch(request, env);

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({ accepted: true });
      expect(bindUser).not.toHaveBeenCalled();
      expect(prewarmRuntimeShellForUser).toHaveBeenCalledWith(
        "test-user",
        undefined,
      );
      expect(harness.namespace.getByName).not.toHaveBeenCalled();
      expect(
        harness.sql.exec("SELECT user_id FROM runner_meta").toArray(),
      ).toEqual([]);
    });

    it("rejects nonempty shell-prewarm bodies without resolving a runtime owner", async () => {
      const runnerContainerGetByName = vi.fn();
      const userRunnerGetByName = vi.fn(() => createUserRunnerStub());
      const env = createWorkerEnv(createUserRunnerStub(), {
        RUNNER_CONTAINER: { getByName: runnerContainerGetByName },
        USER_RUNNER: { getByName: userRunnerGetByName },
      });

      const response = await worker.fetch(
        await signControlRequest(new Request(
          "https://runner.example.test/internal/users/test-user/runtime/shell-prewarm",
          {
            body: JSON.stringify({ wake: true }),
            headers: { "content-type": "application/json; charset=utf-8" },
            method: "POST",
          },
        )),
        env,
      );

      expect(response.status).toBe(400);
      expect(runnerContainerGetByName).not.toHaveBeenCalled();
      expect(userRunnerGetByName).not.toHaveBeenCalled();
    });

    it("rejects shell prewarm when the only credential is a web callback signature", async () => {
      const runnerContainerGetByName = vi.fn();
      const env = createWorkerEnv(createUserRunnerStub(), {
        RUNNER_CONTAINER: { getByName: runnerContainerGetByName },
      });

      const response = await worker.fetch(
        await signWebCallbackControlRequest(
          new Request(
            "https://runner.example.test/internal/users/test-user/runtime/shell-prewarm",
            {
              body: "{}",
              headers: { "content-type": "application/json; charset=utf-8" },
              method: "POST",
            },
          ),
          env,
        ),
        env,
      );

      expect(response.status).toBe(401);
      expect(runnerContainerGetByName).not.toHaveBeenCalled();
    });

    it("starts runtime processing without an active fence", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
      const runtimeNextWakeAt = "2026-04-27T00:04:00.000Z";
      const { alarms, invoke, runner, sql } = createRuntimeControlRunnerHarness({
        invocationResults: [{
          nextWakeAt: runtimeNextWakeAt,
          nextWakeReason: "assistant",
          status: "idle",
        }],
      });

      const response = await runner.ensureRuntimeProcessingForUser({
        orchestration: { triggeredByWebDirect: true },
        orchestrationAttemptId:
          "web-ingress-33333333-3333-4333-8333-333333333333",
        userId: "test-user",
      });

      expect(response).toEqual({
        action: "started",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-04-27T00:01:34.000Z",
        runtimeAttemptId: expect.stringMatching(/^runtime-write-/u),
      });
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke.mock.calls[0]?.[0].job.request).toMatchObject({
        userId: "test-user",
        workspaceVersion: "7",
      });
      expect(invoke.mock.calls[0]?.[0].orchestration).toMatchObject({
        runtimeInvocationOrchestrationAttemptId:
          "web-ingress-33333333-3333-4333-8333-333333333333",
        triggeredByWebDirect: true,
      });
      await vi.waitFor(() =>
        expect(readRunnerMetaForRuntimeControl(sql)).toMatchObject({
          active_attempt_id: null,
          failure_count: 0,
        })
      );
      expect(alarms).toEqual([]);
    });

    it("sends activation diagnostics for an active fence wake", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
      const activeWakeEnsureProcessing = vi.fn<
        NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>
      >(async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }));
      const { ensureProcessing, invoke, runner, sql } = createRuntimeControlRunnerHarness({
        ensureProcessing: activeWakeEnsureProcessing,
      });
      const token = await writeRuntimeControlFenceForTest({
        runner,
        sql,
        userId: "test-user",
        workspaceVersion: "7",
      });

      const response = await runner.ensureRuntimeProcessingForUser({
        orchestration: { triggeredByWebDirect: true },
        orchestrationAttemptId:
          "web-ingress-44444444-4444-4444-8444-444444444444",
        userId: "test-user",
      });

      expect(response).toEqual({
        action: "woken",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-04-27T00:01:34.000Z",
        runtimeAttemptId: token.attemptId,
      });
      expect(ensureProcessing).toHaveBeenCalledWith({
        activeRuntime: {
          attemptId: token.attemptId,
          leaseGeneration: token.generation,
          orchestration: {
            activeFenceObservedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            activeFenceTargetWasPriorVersion: false,
            activeWakeStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            healthDataAdmissionReadFinishedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            healthDataAdmissionReadStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runnerStateBindFinishedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runnerStateBindStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runnerStateReadFinishedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runnerStateReadStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runtimeConsentLockAcquiredAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            triggeredByWebDirect: true,
            userRunnerEnsureStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
          },
          processingMode: "default",
          userId: "test-user",
        },
        userId: "test-user",
      });
      expect(
        activeWakeEnsureProcessing.mock.calls[0]?.[0].activeRuntime?.orchestration,
      ).not.toHaveProperty("runtimeInvocationOrchestrationAttemptId");
      expect(invoke).not.toHaveBeenCalled();
      expect(readRunnerMetaForRuntimeControl(sql)).toMatchObject({
        active_attempt_id: token.attemptId,
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
        userId: "test-user",
      });

      expect(response).toEqual({
        kind: "retry_later",
        retryAt: "2026-04-27T00:00:03.000Z",
      });
      expect(ensureProcessing).toHaveBeenCalledOnce();
      expect(ensureProcessing).toHaveBeenCalledWith({
        activeRuntime: {
          attemptId: oldToken.attemptId,
          leaseGeneration: oldToken.generation,
          orchestration: {
            activeFenceObservedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            activeFenceTargetWasPriorVersion: false,
            activeWakeStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            healthDataAdmissionReadFinishedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            healthDataAdmissionReadStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runnerStateBindFinishedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runnerStateBindStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runnerStateReadFinishedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runnerStateReadStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            runtimeConsentLockAcquiredAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
            userRunnerEnsureStartedAtEpochMs: Date.parse("2026-04-27T00:00:00.000Z"),
          },
          processingMode: "default",
          userId: "test-user",
        },
        userId: "test-user",
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(readRunnerMetaForRuntimeControl(sql)).toMatchObject({
        active_attempt_id: oldToken.attemptId,
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
        userId: "test-user",
      })).resolves.toEqual({
        kind: "retry_later",
        retryAt: "2026-04-27T00:00:10.000Z",
      });

      expect(invoke).not.toHaveBeenCalled();
      expect(readRunnerMetaForRuntimeControl(sql)).toMatchObject({
        active_attempt_id: token.attemptId,
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
          deleteAllCompleted: true,
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
        deleteAllCompleted: true,
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
        headers: ACTIVE_INVOCATION_LEASE_HEADERS,
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
        headers: ACTIVE_INVOCATION_LEASE_HEADERS,
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
  failure_count: number;
};

function createRuntimeControlRunnerHarness(input: {
  afterInvocationResult?: (input: {
    result: HostedWorkspaceInvocationResult;
    sql: ReturnType<typeof createTestSqlStorage>;
  }) => void;
  deleteAlarmError?: Error;
  ensureReadyForProcessing?: HostedExecutionContainerStubLike["ensureReadyForProcessing"];
  ensureProcessing?: HostedExecutionContainerStubLike["ensureProcessing"];
  healthDataAdmission?: {
    consentState: "granted" | "missing" | "revoked";
    processingAllowed: boolean;
  };
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

    if (url.pathname === HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH) {
      return Response.json({
        consentState: input.healthDataAdmission?.consentState ?? "granted",
        processingAllowed:
          input.healthDataAdmission?.processingAllowed ?? true,
        userId: "test-user",
      });
    }

    throw new Error(`Unexpected hosted runtime control fetch: ${String(requestInput)}`);
  });

  const alarms: string[] = [];
  const values = new Map<string, unknown>();
  const sql = createTestSqlStorage();
  const storage: DurableObjectStorageLike = {
    delete: vi.fn(async (key: string) => values.delete(key)),
    deleteAll: vi.fn(async () => values.clear()),
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
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "35000",
    })),
    createBucketStore().api,
    {
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
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
    `SELECT active_attempt_id, failure_count
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
        async dropActiveOperationForTest() {
          return { ok: true as const };
        },
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
    cliSurfaceContractBytes: 37282,
    cliSurfaceHotPathProofCount: 4,
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
      async head(key: string) {
        const value = values.get(key);
        return value === undefined
          ? null
          : { size: Buffer.byteLength(value, "utf8") };
      },
      async list(options: { prefix?: string } = {}) {
        const prefix = options.prefix ?? "";
        return {
          objects: [...values.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({
              key,
              size: Buffer.byteLength(value, "utf8"),
            })),
          truncated: false,
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
      generatedAt: "2026-04-20T08:00:00.000Z",
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
  readActiveRuntimeFenceForTest(input: {
    userId: string;
  }): Promise<{
    attemptId: string;
    processingMode: "default" | "inbox_media_retention" | "system_mailbox";
  } | null>;
  runAlarmForTest(input: { userId: string }): Promise<{ ok: true }>;
  runUntilIdleForTest(input: { userId: string }): Promise<HostedWorkspaceInvocationResult>;
  startStuckInvocationForTest(input: {
    startedAgoMs?: number;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult>;
};

function createWorkerExecutionContextForTest(): {
  ctx: WorkerExecutionContext;
  waitUntil: ReturnType<typeof vi.fn>;
  waitUntilPromises: Promise<unknown>[];
} {
  const waitUntilPromises: Promise<unknown>[] = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    waitUntilPromises.push(promise);
  });
  return {
    ctx: { waitUntil },
    waitUntil,
    waitUntilPromises,
  };
}

function createUserRunnerStub(overrides: Record<string, unknown> = {}) {
  return {
    bindUser: vi.fn(async (userId: string) => ({ userId })),
    deleteHostedUserData: vi.fn(async (userId: string) => ({
      deletedAt: "2026-04-29T00:00:00.000Z",
      durableObject: {
        alarmCleared: true,
        deleteAllCompleted: true,
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
    prewarmRuntimeShellForUser: vi.fn(async () => undefined),
    publishHostedPrivateMedia: vi.fn(async () => ({
      ok: false as const,
      reason: "not-configured" as const,
    })),
    readActiveRuntimeFenceForTest: vi.fn(async () => null),
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
