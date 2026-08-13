import { createCipheriv, createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
  HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
} from "@murphai/hosted-execution/assistant-personalization";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  serializeHostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  HostedRuntimeBridgeCheckpointLeaseError,
} from "@murphai/assistant-runtime/hosted-checkpoint-bridge";
import {
  HostedRuntimeArtifactReadError,
  HostedRuntimeArtifactWriteError,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH,
  HOSTED_RUNTIME_GROUP_TOOL_PATH,
  HOSTED_RUNTIME_CODEX_AUTH_PATH,
  HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH,
  HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH,
  HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
  HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH,
} from "@murphai/hosted-execution/routes";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_PARAM,
  HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_VERSION,
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  HOSTED_VAULT_SHARE_PROJECTION_MODE_PARAM,
} from "@murphai/hosted-execution/vault-share";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

function buildExpectedSupportedProjectionScopePath(path: string): string {
  const params = new URLSearchParams();
  for (const projectionScope of HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES) {
    params.append(
      "supportedProjectionScope",
      buildHostedVaultShareProjectionScopeKey(projectionScope),
    );
  }

  return `${path}?${params.toString()}`;
}

function buildExpectedVaultShareActiveKindsPath(
  projectionMode?: typeof HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
): string {
  const path = buildExpectedSupportedProjectionScopePath(
    HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH,
  );
  const capabilityPath =
    `${path}&${HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_PARAM}=${HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_VERSION}`;
  return projectionMode
    ? `${capabilityPath}&${HOSTED_VAULT_SHARE_PROJECTION_MODE_PARAM}=${projectionMode}`
    : capabilityPath;
}

function buildExpectedGroupToolPath(): string {
  return buildExpectedSupportedProjectionScopePath(HOSTED_RUNTIME_GROUP_TOOL_PATH);
}

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );

  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  buildHostedExecutionStructuredLogRecord,
  readHostedRuntimeSafeErrorText,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionRuntimePlatform,
  createCloudflareHostedProviderFetch,
  createHostedBrowserVaultReplicaWriteHeaders,
  HostedRuntimeInternalAuthorityRejectedError,
  isHostedRuntimeInternalAuthorityRejectedError,
  readCloudflareHostedProviderFetchBaseUrls,
  readHostedRuntimeControlPlaneFetchFailureDiagnostics,
  readHostedWorkspaceSnapshotRestoreStep,
} from "../src/runtime-platform.ts";
import {
  fetchHostedWebControlPlaneJson,
  HostedWebControlPlaneResponseError,
} from "../src/runtime-platform/web-control-transport.ts";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../src/web-control-plane.ts";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_PROVIDER_EGRESS_TOKEN_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
  HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER,
  HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../src/runner-outbound/headers.ts";
import {
  buildHostedRunnerContainerEnv,
} from "../src/runner-env.ts";
import {
} from "../src/runner-effects-contract.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";
import {
  createEncryptedWorkspaceSnapshotFile,
} from "../src/workspace-snapshot-local.ts";
import {
  assertEstablishedR2ColdStartAttempt,
} from "./helpers/hosted-local-cold-start-benchmark.js";

function requireFetchCallArgs(
  call: readonly unknown[] | undefined,
  label: string,
): { init?: RequestInit; input: RequestInfo | URL } {
  if (!call) {
    throw new Error(`${label} was not called.`);
  }

  const [input, init] = call;
  if (!(input instanceof Request) && !(input instanceof URL) && typeof input !== "string") {
    throw new Error(`${label} must receive a Request, URL, or string input.`);
  }
  if (init !== undefined && (typeof init !== "object" || init === null || Array.isArray(init))) {
    throw new Error(`${label} init must be an object when provided.`);
  }

  return {
    init: init as RequestInit | undefined,
    input,
  };
}

function requireFetchRequest(call: readonly unknown[] | undefined, label: string): Request {
  const { init, input } = requireFetchCallArgs(call, label);
  return input instanceof Request ? input : new Request(input, init);
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function delayWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw signal.reason;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}

function readHostedExecutionStructuredLogs(): Array<{
  component?: unknown;
  details?: Record<string, unknown>;
  message?: unknown;
  userId?: unknown;
}> {
  return mocks.emitHostedExecutionStructuredLog.mock.calls
    .map(([input]) => input)
    .filter((input): input is {
      component?: unknown;
      details?: Record<string, unknown>;
      message?: unknown;
      userId?: unknown;
    } =>
      Boolean(input)
      && typeof input === "object"
      && !Array.isArray(input)
    );
}

function readWorkspaceSnapshotDiagnosticLogs(): Array<{
  component?: unknown;
  details?: Record<string, unknown>;
  message?: unknown;
  userId?: unknown;
}> {
  return readHostedExecutionStructuredLogs()
    .filter((input) => input.component === "hosted.runtime.workspace-snapshot");
}

function createAssistantUsageRecord(): AssistantUsageRecord {
  return {
    apiKeyEnv: null,
    attemptCount: 1,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: [],
    inputTokens: 1,
    memberId: "member_123",
    occurredAt: "2026-04-08T10:00:00.000Z",
    outputTokens: 2,
    provider: "codex-cli",
    providerName: null,
    providerRequestId: null,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: null,
    requestedModel: "gpt-5.6-terra",
    routeId: "route_usage",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: null,
    sessionId: "session_usage",
    stripeMeterSource: "murph",
    surface: null,
    tokenPricingBasis: "standard",
    totalTokens: 3,
    triggerKind: null,
    turnId: "turn_usage",
    turnProfileJson: null,
    usageExtractionSourcePath: null,
    usageExtractionVersion: "test",
    usageId: "turn_usage.attempt-1",
  };
}

function buildTestHostedExecutionRuntimePlatform(
  input: Parameters<typeof buildHostedExecutionRuntimePlatform>[0],
) {
  return buildHostedExecutionRuntimePlatform({
    workspaceCheckpointBridge: {
      readCurrentLease: () => ({
        attemptId: "runtime_write_123",
        leaseGeneration: "7",
        userId: "member_123",
        workspaceVersion: "6",
      }),
    },
    ...input,
  });
}

function expectDefaultRuntimeWriteFenceHeaders(request: Request): void {
  expect(request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe("runtime_write_123");
  expect(request.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe("7");
  expect(request.headers.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)).toBe("6");
}

async function fetchDirectHostedWorkspaceReadWithHeaders(input: {
  fetchImpl: typeof fetch;
  headers: Headers;
  sensitiveResponseBody?: {
    maxBytes: number;
  };
}): Promise<unknown> {
  const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
    HOSTED_WEB_BASE_URL: "https://web.example.test",
  }));
  return await fetchHostedWebControlPlaneJson({
    boundUserId: "member_123",
    description: "Hosted workspace read",
    fetchImpl: input.fetchImpl,
    headers: input.headers,
    method: "GET",
    path: "/api/internal/hosted-workspace",
    ...(input.sensitiveResponseBody
      ? { sensitiveResponseBody: input.sensitiveResponseBody }
      : {}),
    timeoutMs: 1_000,
    transport: {
      callbackSigning: environment.webCallbackSigning,
      mode: "direct",
      webControlBaseUrl: "https://web.example.test",
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-123",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    },
  });
}

function createBrowserVaultReplicaRef(sourceBundleHash: string) {
  return {
    byteLength: 256,
    dataVersion: "runner-platform-test",
    generatedAt: "2026-04-26T00:00:00.000Z",
    keyId: "browser-key-runner-platform",
    objectKey: "browser-vault/member-test/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:runner-platform",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  } as const;
}

function createWorkspaceSnapshotV2Ref(input: {
  encryptedByteSize: number;
  totalPlainBytes?: number;
}): HostedWorkspaceSnapshotV2Ref {
  const snapshotId = "snapshot_runner_platform";
  const objectKey = `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
  return {
    archive: {
      compression: "zstd",
      encryptedByteSize: input.encryptedByteSize,
      encryptedObjectSha256: "a".repeat(64),
      fileCount: 1,
      format: "tar",
      plaintextArchiveSha256: "b".repeat(64),
      totalPlainBytes: input.totalPlainBytes ?? input.encryptedByteSize,
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId: "member_123",
      }),
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: "root_key_test",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_test",
    },
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: "member_123",
  };
}

function createWorkspaceSnapshotSessionStartResponse(input: {
  dataKeyBase64: string;
  objectKey: string;
  snapshotId: string;
}): Response {
  return new Response(JSON.stringify({
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey: input.objectKey,
        snapshotId: input.snapshotId,
        userId: "member_123",
      }),
      dataKeyBase64: input.dataKeyBase64,
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: "root_key_test",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_test",
    },
    limits: {
      maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
      warnEncryptedBytes: 128 * 1024 * 1024,
    },
    objectKey: input.objectKey,
    snapshotId: input.snapshotId,
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  });
}

function createWorkspaceSnapshotCheckpointRequest(
  ref: HostedWorkspaceSnapshotV2Ref,
): HostedWorkspaceCheckpointRequest {
  return {
    attemptId: "attempt_1",
    expectedWorkspaceVersion: "4",
    leaseGeneration: "9",
    reason: "idle_shutdown",
    snapshotRef: ref,
  };
}

function createWorkspaceSnapshotCompleteResponse(
  ref: HostedWorkspaceSnapshotV2Ref,
): Response {
  return new Response(JSON.stringify({
    checkpoint: {
      checkpointed: true,
      workspace: {
        checkpointedAt: "2026-04-26T00:00:05.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: null,
        snapshotRef: ref,
        updatedAt: "2026-04-26T00:00:05.000Z",
        userId: "member_123",
        version: "5",
      },
    },
    ok: true,
    snapshotRef: ref,
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  });
}

function createEncryptedWorkspaceSnapshotBytes(input: {
  aad: HostedWorkspaceSnapshotV2Aad;
  dataKey: Uint8Array;
  ivBase64: string;
  plaintextArchive: Buffer;
}): {
  encryptedBytes: Buffer;
  encryptedObjectSha256: string;
  plaintextArchiveSha256: string;
} {
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(input.dataKey),
    Buffer.from(input.ivBase64, "base64url"),
  );
  cipher.setAAD(Buffer.from(serializeHostedWorkspaceSnapshotV2Aad(input.aad)));
  const encryptedBody = Buffer.concat([
    cipher.update(input.plaintextArchive),
    cipher.final(),
  ]);
  const encryptedBytes = Buffer.concat([encryptedBody, cipher.getAuthTag()]);
  return {
    encryptedBytes,
    encryptedObjectSha256: createHash("sha256").update(encryptedBytes).digest("hex"),
    plaintextArchiveSha256: createHash("sha256")
      .update(input.plaintextArchive)
      .digest("hex"),
  };
}

function copyBufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const result = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(result).set(buffer);
  return result;
}

describe("buildHostedExecutionRuntimePlatform", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mocks.emitHostedExecutionStructuredLog.mockReset();
  });

  it("does not attach stale runtime liveness controls to the Cloudflare platform", () => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    expect(platform.runtimeLivenessIntervalMs).toBeUndefined();
    expect(platform.runtimeLivenessPort).toBeUndefined();
    expect(platform.runtimeLivenessRequired).toBeUndefined();
  });

  it("attaches the hosted assistant configuration port to the Cloudflare platform", () => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
    });

    expect(platform.assistantConfigurationToolPort).toBeDefined();
    expect(platform.assistantConfigurationToolPort?.request).toEqual(
      expect.any(Function),
    );
  });

  it("attaches the hosted subscription port to the Cloudflare platform", () => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
    });

    expect(platform.subscriptionToolPort).toBeDefined();
    expect(platform.subscriptionToolPort?.request).toEqual(expect.any(Function));
  });

  it("attaches physical-note transport only when explicitly enabled", () => {
    const disabled = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
    });
    const enabled = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      physicalNotesEnabled: true,
    });

    expect(disabled.physicalNotes).toBeUndefined();
    expect(enabled.physicalNotes?.send).toEqual(expect.any(Function));
  });

  it("attaches the hosted labs port when web-control transport is available", () => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
    });

    expect(platform.labsToolPort).toBeDefined();
    expect(platform.labsToolPort?.request).toEqual(expect.any(Function));
  });

  it("omits the hosted labs port when web-control transport is unavailable", () => {
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
    });

    expect(platform.labsToolPort).toBeUndefined();
  });

  it("rejects oversized workspace snapshot restores before unwrap or fetch", async () => {
    const fetchMock = vi.fn();
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
      durableRoot: "unused-durable-root",
      ref: createWorkspaceSnapshotV2Ref({
        encryptedByteSize: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
      }),
    })).rejects.toThrow("Hosted workspace snapshot restore exceeds the single-part size guard.");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized plain workspace snapshot restores before unwrap or fetch", async () => {
    const fetchMock = vi.fn();
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
      durableRoot: "unused-durable-root",
      ref: createWorkspaceSnapshotV2Ref({
        encryptedByteSize: 128,
        totalPlainBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
      }),
    })).rejects.toThrow("Hosted workspace snapshot restore exceeds the total plain size guard.");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed workspace snapshot data-key unwraps without extracting", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-unwrap-malformed-"));
    const ref = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 128,
    });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot unwrap");
      if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/data-key/unwrap`)) {
        return new Response(
          JSON.stringify({ dataKey: "not-valid" }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    try {
      // The malformed unwrap fails before presign or extraction work starts.
      const durableRoot = path.join(tempRoot, "durable");
      await expect(platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref,
      })).rejects.toThrow("Invalid character");

      const unwrapRequest = fetchMock.mock.calls
        .map((call) => requireFetchRequest(call, "workspace snapshot unwrap"))
        .find((request) => request.url.endsWith("/data-key/unwrap"));
      expect(unwrapRequest?.url).toBe(
        "http://workspace-snapshots.worker/workspace-snapshots/snapshot_runner_platform/data-key/unwrap",
      );
      await expect(access(durableRoot)).rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("does not open the snapshot object body when the data-key unwrap fails", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-no-body-before-unwrap-"));
    const ref = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 128,
    });
    const getUrl = `https://r2.example.test/bundles/${ref.objectKey}?X-Amz-Signature=fixture-get`;
    let objectFetchCount = 0;
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot unwrap body fetch");
      if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/data-key/unwrap`)) {
        await delayWithAbort(50, request.signal);
        return new Response("unwrap denied", { status: 403 });
      }
      if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/presign-get`)) {
        return new Response(JSON.stringify({
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          getUrl,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (request.url === getUrl) {
        objectFetchCount += 1;
        return new Response("unexpected object fetch", { status: 500 });
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    try {
      await expect(platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot: path.join(tempRoot, "durable"),
        ref,
      })).rejects.toThrow(/data key unwrap request failed/u);

      expect(objectFetchCount).toBe(0);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }, 15_000);

  it("aborts and cancels stalled v2 workspace snapshot unwrap response bodies", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-unwrap-body-abort-"));
    const durableRoot = path.join(tempRoot, "durable");
    const ref = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 128,
    });
    const getUrl = `https://r2.example.test/bundles/${ref.objectKey}?X-Amz-Signature=fixture-get`;
    const abortController = new AbortController();
    let objectFetchCount = 0;
    let unwrapBodyCanceled = false;
    let resolveUnwrapBodyOpened: (() => void) | null = null;
    const unwrapBodyOpened = new Promise<void>((resolve) => {
      resolveUnwrapBodyOpened = resolve;
    });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot stalled unwrap body fetch");
      if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/data-key/unwrap`)) {
        return new Response(new ReadableStream<Uint8Array>({
          cancel: () => {
            unwrapBodyCanceled = true;
          },
          start: () => {
            resolveUnwrapBodyOpened?.();
            resolveUnwrapBodyOpened = null;
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/presign-get`)) {
        return new Response(JSON.stringify({
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          getUrl,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (request.url === getUrl) {
        objectFetchCount += 1;
        return new Response("unexpected object fetch", { status: 500 });
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    try {
      const restore = platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref,
        signal: abortController.signal,
      });
      await unwrapBodyOpened;
      abortController.abort(new Error("restore aborted while reading unwrap response"));

      await expect(restore).rejects.toThrow("restore aborted while reading unwrap response");
      expect(unwrapBodyCanceled).toBe(true);
      expect(objectFetchCount).toBe(0);
      await expect(access(durableRoot)).rejects.toThrow();
      expect(readWorkspaceSnapshotDiagnosticLogs().filter((log) =>
        log.message === "Hosted workspace snapshot restore read step failed; retrying."
      )).toHaveLength(0);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }, 15_000);

  it("aborts and cancels stalled v2 workspace snapshot presign response bodies", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-presign-body-abort-"));
    const durableRoot = path.join(tempRoot, "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);
    const ref = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 128,
    });
    const abortController = new AbortController();
    let presignBodyCanceled = false;
    let objectFetchCount = 0;
    let resolvePresignBodyOpened: (() => void) | null = null;
    const presignBodyOpened = new Promise<void>((resolve) => {
      resolvePresignBodyOpened = resolve;
    });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot stalled presign body fetch");
      if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/data-key/unwrap`)) {
        return new Response(JSON.stringify({ dataKey: dataKeyBase64 }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/presign-get`)) {
        await delayWithAbort(50, request.signal);
        return new Response(new ReadableStream<Uint8Array>({
          cancel: () => {
            presignBodyCanceled = true;
          },
          start: () => {
            resolvePresignBodyOpened?.();
            resolvePresignBodyOpened = null;
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      objectFetchCount += 1;
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    try {
      const restore = platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref,
        signal: abortController.signal,
      });
      await presignBodyOpened;
      abortController.abort(new Error("restore aborted while reading presign response"));

      await expect(restore).rejects.toThrow("restore aborted while reading presign response");
      expect(presignBodyCanceled).toBe(true);
      expect(objectFetchCount).toBe(0);
      await expect(access(durableRoot)).rejects.toThrow();
      expect(readWorkspaceSnapshotDiagnosticLogs().filter((log) =>
        log.message === "Hosted workspace snapshot restore read step failed; retrying."
      )).toHaveLength(0);
    } finally {
      dataKey.fill(0);
      await rm(tempRoot, { force: true, recursive: true });
    }
  }, 15_000);

  it("sends direct R2 workspace snapshot PUTs with signed metadata headers", async () => {
    const encryptedBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-put-"));

    try {
      const encryptedFilePath = path.join(tempRoot, "workspace.snapshot.enc");
      await writeFile(encryptedFilePath, encryptedBytes);
      const objectKey =
        "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_runner_platform.snapshot.enc";
      const putUrl =
        `https://r2.example.test/bundles/${objectKey}?X-Amz-Signature=fixture`;
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot platform fetch");
        if (request.url.includes("/workspace-snapshots/snapshot_runner_platform/presign-put")) {
          return new Response(
            JSON.stringify({
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              putUrl,
            }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }

        return new Response(null, { status: 200 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      const timings = await platform.workspaceSnapshotPort!.putSnapshotObjectDirect({
        encryptedByteSize: encryptedBytes.byteLength,
        encryptedObjectSha256: "c".repeat(64),
        objectKey,
        snapshotId: "snapshot_runner_platform",
        sourceFilePath: encryptedFilePath,
      });

      expect(timings).toEqual({
        snapshotDirectR2PresignElapsedMs: expect.any(Number),
        snapshotDirectR2PutElapsedMs: expect.any(Number),
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const presignRequest = requireFetchRequest(fetchMock.mock.calls[0], "workspace snapshot PUT presign");
      expect(presignRequest.url).toBe(
        "http://workspace-snapshots.worker/workspace-snapshots/snapshot_runner_platform/presign-put",
      );
      await expect(presignRequest.json()).resolves.toEqual({
        encryptedByteSize: encryptedBytes.byteLength,
        encryptedObjectSha256: "c".repeat(64),
        objectKey,
        snapshotId: "snapshot_runner_platform",
      });
      const request = requireFetchRequest(fetchMock.mock.calls[1], "direct R2 workspace snapshot PUT");
      expect(request.method).toBe("PUT");
      expect(request.url).toBe(putUrl);
      expect(request.headers.get("content-length")).toBe(String(encryptedBytes.byteLength));
      expect(request.headers.get("content-type")).toBe("application/octet-stream");
      expect(request.headers.get("if-none-match")).toBe("*");
      expect(request.headers.get("x-amz-checksum-sha256")).toBe(
        Buffer.from("c".repeat(64), "hex").toString("base64"),
      );
      expect(request.headers.get("x-amz-meta-encryptedsha256")).toBe("c".repeat(64));
      expect(request.headers.get("x-amz-meta-schema")).toBe(HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA);
      expect(request.headers.get("x-amz-meta-snapshotid")).toBe("snapshot_runner_platform");
    } finally {
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("preserves cancellation while a direct R2 snapshot presign is pending", async () => {
    const encryptedBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-presign-abort-"));
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted snapshot presign");
    let resolvePresignStarted: (() => void) | null = null;
    const presignStarted = new Promise<void>((resolve) => {
      resolvePresignStarted = resolve;
    });

    try {
      const encryptedFilePath = path.join(tempRoot, "workspace.snapshot.enc");
      await writeFile(encryptedFilePath, encryptedBytes);
      const objectKey =
        "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_runner_platform.snapshot.enc";
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot pending presign fetch");
        resolvePresignStarted?.();
        resolvePresignStarted = null;
        await delayWithAbort(60_000, request.signal);
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      const upload = platform.workspaceSnapshotPort!.putSnapshotObjectDirect({
        encryptedByteSize: encryptedBytes.byteLength,
        encryptedObjectSha256: "c".repeat(64),
        objectKey,
        signal: abortController.signal,
        snapshotId: "snapshot_runner_platform",
        sourceFilePath: encryptedFilePath,
      });
      await presignStarted;
      abortController.abort(abortReason);

      await expect(upload).rejects.toBe(abortReason);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("preserves cancellation while the direct R2 snapshot PUT is pending", async () => {
    const encryptedBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-put-abort-"));
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted snapshot PUT");
    const objectKey =
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_runner_platform.snapshot.enc";
    const putUrl =
      `https://r2.example.test/bundles/${objectKey}?X-Amz-Signature=fixture`;
    let resolvePutStarted: (() => void) | null = null;
    const putStarted = new Promise<void>((resolve) => {
      resolvePutStarted = resolve;
    });

    try {
      const encryptedFilePath = path.join(tempRoot, "workspace.snapshot.enc");
      await writeFile(encryptedFilePath, encryptedBytes);
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot pending PUT fetch");
        if (request.url.includes("/workspace-snapshots/snapshot_runner_platform/presign-put")) {
          return new Response(
            JSON.stringify({
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              putUrl,
            }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }

        resolvePutStarted?.();
        resolvePutStarted = null;
        await delayWithAbort(60_000, request.signal);
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      const upload = platform.workspaceSnapshotPort!.putSnapshotObjectDirect({
        encryptedByteSize: encryptedBytes.byteLength,
        encryptedObjectSha256: "c".repeat(64),
        objectKey,
        signal: abortController.signal,
        snapshotId: "snapshot_runner_platform",
        sourceFilePath: encryptedFilePath,
      });
      await putStarted;
      abortController.abort(abortReason);

      await expect(upload).rejects.toBe(abortReason);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const putRequest = requireFetchRequest(
        fetchMock.mock.calls[1],
        "cancelled direct R2 workspace snapshot PUT",
      );
      expect(putRequest.method).toBe("PUT");
      expect(putRequest.url).toBe(putUrl);
    } finally {
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("logs redacted direct R2 transport failure text without presigned URL material", async () => {
    const encryptedBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-put-"));

    try {
      const encryptedFilePath = path.join(tempRoot, "workspace.snapshot.enc");
      await writeFile(encryptedFilePath, encryptedBytes);
      const objectKey =
        "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_runner_platform.snapshot.enc";
      const putUrl =
        `https://r2.example.test/bundles/${objectKey}?X-Amz-Signature=fixture-secret`;
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot platform fetch");
        if (request.url.includes("/workspace-snapshots/snapshot_runner_platform/presign-put")) {
          return new Response(
            JSON.stringify({
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              putUrl,
            }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }

        throw new TypeError(
          `fetch failed for ${putUrl} with local scratch ${tempRoot}`,
        );
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      await expect(platform.workspaceSnapshotPort!.putSnapshotObjectDirect({
        encryptedByteSize: encryptedBytes.byteLength,
        encryptedObjectSha256: "c".repeat(64),
        objectKey,
        snapshotId: "snapshot_runner_platform",
        sourceFilePath: encryptedFilePath,
      })).rejects.toThrow(
        "Hosted workspace snapshot direct R2 upload is not resumable after a transport failure; "
        + "abandon this snapshot session and start a fresh snapshot before retrying.",
      );

      const logs = readHostedExecutionStructuredLogs();
      const failureLog = logs.find((log) =>
        log.message === "Hosted runtime upstream request failed."
        && log.details?.description === "Hosted workspace snapshot direct R2 upload");
      expect(failureLog?.details).toMatchObject({
        description: "Hosted workspace snapshot direct R2 upload",
        method: "PUT",
        path: "/workspace-snapshot-object",
        responseOrigin: "workspace_snapshot_object",
        safeErrorText:
          "Hosted workspace snapshot direct R2 upload request failed. | fetch failed for <redacted-url> with local scratch <redacted-path>",
      });
      const serializedLogs = JSON.stringify(logs);
      expect(serializedLogs).not.toContain(objectKey);
      expect(serializedLogs).not.toContain("fixture-secret");
      expect(serializedLogs).not.toContain(tempRoot);
      expect(serializedLogs).not.toContain(putUrl);
    } finally {
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("fails direct R2 workspace snapshot PUT status errors as non-resumable sessions", async () => {
    const encryptedBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-put-"));

    try {
      const encryptedFilePath = path.join(tempRoot, "workspace.snapshot.enc");
      await writeFile(encryptedFilePath, encryptedBytes);
      const objectKey =
        "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_runner_platform.snapshot.enc";
      const putUrl =
        `https://r2.example.test/bundles/${objectKey}?X-Amz-Signature=fixture`;
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot platform fetch");
        if (request.url.includes("/workspace-snapshots/snapshot_runner_platform/presign-put")) {
          return new Response(
            JSON.stringify({
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              putUrl,
            }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }

        return new Response("precondition failed", { status: 412 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      await expect(platform.workspaceSnapshotPort!.putSnapshotObjectDirect({
        encryptedByteSize: encryptedBytes.byteLength,
        encryptedObjectSha256: "c".repeat(64),
        objectKey,
        snapshotId: "snapshot_runner_platform",
        sourceFilePath: encryptedFilePath,
      })).rejects.toThrow(
        "Hosted workspace snapshot direct R2 upload is not resumable after HTTP 412; "
        + "abandon this snapshot session and start a fresh snapshot before retrying.",
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const putRequest = requireFetchRequest(fetchMock.mock.calls[1], "direct R2 workspace snapshot PUT");
      expect(putRequest.method).toBe("PUT");
      expect(putRequest.url).toBe(putUrl);
    } finally {
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("retains bounded R2 error diagnostics without presigned URL material", async () => {
    const encryptedBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-put-"));

    try {
      const encryptedFilePath = path.join(tempRoot, "workspace.snapshot.enc");
      await writeFile(encryptedFilePath, encryptedBytes);
      const objectKey =
        "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_runner_platform.snapshot.enc";
      const putUrl =
        `https://r2.example.test/bundles/${objectKey}?X-Amz-Signature=fixture-secret`;
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot platform fetch");
        if (request.url.includes("/workspace-snapshots/snapshot_runner_platform/presign-put")) {
          return new Response(
            JSON.stringify({
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              putUrl,
            }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }

        return new Response(
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            + "<Error><Code>InternalError</Code>"
            + "<Message>We encountered an internal error. Please try again. "
            + `Object ${objectKey}?X-Amz-Signature=fixture-secret.</Message>`
            + "<RequestId>r2request0123456789</RequestId>"
            + `<Resource>${objectKey}?X-Amz-Signature=fixture-secret</Resource>`
            + "</Error>",
          {
            headers: {
              "content-type": "application/xml",
            },
            status: 500,
          },
        );
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      let uploadError: unknown;
      try {
        await platform.workspaceSnapshotPort!.putSnapshotObjectDirect({
          encryptedByteSize: encryptedBytes.byteLength,
          encryptedObjectSha256: "c".repeat(64),
          objectKey,
          snapshotId: "snapshot_runner_platform",
          sourceFilePath: encryptedFilePath,
        });
      } catch (error) {
        uploadError = error;
      }

      const safeError = readHostedRuntimeSafeErrorText(uploadError);
      expect(safeError).toContain("R2 error code InternalError.");
      expect(safeError).toContain(
        "R2 error message: We encountered an internal error. Please try again.",
      );
      expect(safeError).toContain("R2 request ID r2request0123456789.");
      expect(safeError).not.toContain(objectKey);
      expect(safeError).not.toContain("fixture-secret");
      expect(safeError).not.toContain(putUrl);
    } finally {
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("preserves cancellation while a workspace snapshot session start is pending", async () => {
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted snapshot session start");
    let resolveStartRequested: (() => void) | null = null;
    const startRequested = new Promise<void>((resolve) => {
      resolveStartRequested = resolve;
    });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot pending session start");
      expect(request.url).toBe("http://workspace-snapshots.worker/workspace-snapshots/start");
      resolveStartRequested?.();
      resolveStartRequested = null;
      await delayWithAbort(60_000, request.signal);
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const start = platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "6",
      reason: "idle_shutdown",
      signal: abortController.signal,
    });
    await startRequested;
    abortController.abort(abortReason);

    await expect(start).rejects.toBe(abortReason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reuses the snapshot session write fence when aborting after the runtime lease changes", async () => {
    const snapshotId = "snapshot_runner_platform";
    const objectKey =
      `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    let currentLease = {
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    };
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot session fetch");
      if (request.url.includes("/workspace-snapshots/start")) {
        return new Response(
          JSON.stringify({
            encryption: {
              aad: buildHostedWorkspaceSnapshotV2Aad({
                objectKey,
                snapshotId,
                userId: "member_123",
              }),
              dataKeyBase64,
              ivBase64: "AQIDBAUGBwgJCgsM",
              rootKeyId: "root_key_test",
              scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
              wrappedDataKey: "wrapped_data_key_test",
            },
            limits: {
              maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
              warnEncryptedBytes: 128 * 1024 * 1024,
            },
            objectKey,
            snapshotId,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      }
      if (request.url.endsWith(`/workspace-snapshots/${snapshotId}/heartbeat`)) {
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${snapshotId}`)) {
        return new Response(JSON.stringify({ aborted: true, ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
      },
    });

    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "4",
      reason: "idle_shutdown",
    });
    currentLease = {
      attemptId: "attempt_2",
      leaseGeneration: "10",
      userId: "member_123",
      workspaceVersion: "5",
    };
    await platform.workspaceSnapshotPort!.abortSnapshotSession({
      objectKey,
      snapshotId,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const abortRequest = requireFetchRequest(fetchMock.mock.calls[2], "workspace snapshot abort");
    expect(abortRequest.method).toBe("DELETE");
    expect(abortRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(abortRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(abortRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("4");
  });

  it("heartbeats immediately and stops on abort before session cleanup settles", async () => {
    vi.useFakeTimers();
    const snapshotId = "snapshot_runner_platform_heartbeat";
    const objectKey =
      `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const abortResponse = createDeferred<Response>();
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot heartbeat fetch");
      if (request.url.endsWith("/workspace-snapshots/start")) {
        return createWorkspaceSnapshotSessionStartResponse({
          dataKeyBase64,
          objectKey,
          snapshotId,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${snapshotId}/heartbeat`)) {
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${snapshotId}`)) {
        return await abortResponse.promise;
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });
    const snapshotAbort = new AbortController();

    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "4",
      reason: "idle_shutdown",
      signal: snapshotAbort.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const heartbeatRequest = requireFetchRequest(
      fetchMock.mock.calls[1],
      "workspace snapshot heartbeat",
    );
    expect(heartbeatRequest.method).toBe("POST");
    expect(heartbeatRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(heartbeatRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");

    snapshotAbort.abort(new Error("foreground preemption"));
    const abortSnapshotSession = platform.workspaceSnapshotPort!.abortSnapshotSession({
      objectKey,
      snapshotId,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    abortResponse.resolve(new Response(JSON.stringify({ aborted: true, ok: true }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }));
    await abortSnapshotSession;
  });

  it("caps delayed session start and heartbeats before the stale boundary", async () => {
    vi.useFakeTimers();
    const startedAtMs = Date.parse("2026-04-27T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const snapshotId = "snapshot_runner_platform_delayed_start";
    const objectKey =
      `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const startResponse = createDeferred<Response>();
    const timeoutCalls: number[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((delayMs) => {
      timeoutCalls.push(delayMs);
      return new AbortController().signal;
    });
    let firstHeartbeatAtMs: number | null = null;
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "delayed workspace snapshot start");
      if (request.url.endsWith("/workspace-snapshots/start")) {
        return await startResponse.promise;
      }
      if (request.url.endsWith(`/workspace-snapshots/${snapshotId}/heartbeat`)) {
        firstHeartbeatAtMs = Date.now();
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const snapshotAbort = new AbortController();
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      commitTimeoutMs: 30_000,
      fetchImpl: fetchMock as typeof fetch,
    });

    try {
      const startSnapshotSession = platform.workspaceSnapshotPort!.startSnapshotSession({
        expectedWorkspaceVersion: "4",
        reason: "idle_shutdown",
        signal: snapshotAbort.signal,
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      vi.setSystemTime(startedAtMs + 5_500);
      startResponse.resolve(createWorkspaceSnapshotSessionStartResponse({
        dataKeyBase64,
        objectKey,
        snapshotId,
      }));
      await startSnapshotSession;
      await vi.waitFor(() => expect(firstHeartbeatAtMs).not.toBeNull());

      expect(timeoutCalls).toContain(6_000);
      expect(firstHeartbeatAtMs).toBe(startedAtMs + 5_500);
      expect((firstHeartbeatAtMs ?? Infinity) - startedAtMs).toBeLessThan(10_000);
    } finally {
      snapshotAbort.abort(new Error("test complete"));
      timeoutSpy.mockRestore();
    }
  });

  it("abandons session start when its handoff timeout fires", async () => {
    const timeoutControllers: Array<{
      controller: AbortController;
      delayMs: number;
    }> = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((delayMs) => {
      const controller = new AbortController();
      timeoutControllers.push({ controller, delayMs });
      return controller.signal;
    });
    const fetchMock = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({ start: () => undefined }),
      {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      },
    ));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      commitTimeoutMs: 30_000,
      fetchImpl: fetchMock as typeof fetch,
    });

    try {
      const startSnapshotSession = platform.workspaceSnapshotPort!.startSnapshotSession({
        expectedWorkspaceVersion: "4",
        reason: "idle_shutdown",
      });
      await vi.waitFor(() =>
        expect(timeoutControllers.some(({ delayMs }) => delayMs === 6_000)).toBe(true)
      );
      const startTimeout = timeoutControllers.find(({ delayMs }) => delayMs === 6_000);
      if (!startTimeout) {
        throw new Error("Workspace snapshot start timeout was not created.");
      }
      const timeoutError = new Error("The operation timed out.");
      timeoutError.name = "TimeoutError";
      startTimeout.controller.abort(timeoutError);

      await expect(startSnapshotSession).rejects.toBe(timeoutError);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("starts the next serialized heartbeat without another idle interval", async () => {
    vi.useFakeTimers();
    const startedAtMs = Date.parse("2026-04-27T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const snapshotId = "snapshot_runner_platform_serial_heartbeat";
    const objectKey =
      `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const firstHeartbeat = createDeferred<Response>();
    const heartbeatStartedAt: number[] = [];
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "serialized workspace snapshot heartbeat");
      if (request.url.endsWith("/workspace-snapshots/start")) {
        return createWorkspaceSnapshotSessionStartResponse({
          dataKeyBase64,
          objectKey,
          snapshotId,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${snapshotId}/heartbeat`)) {
        heartbeatStartedAt.push(Date.now());
        if (heartbeatStartedAt.length === 1) {
          return await firstHeartbeat.promise;
        }
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const snapshotAbort = new AbortController();
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      commitTimeoutMs: 30_000,
      fetchImpl: fetchMock as typeof fetch,
    });

    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "4",
      reason: "idle_shutdown",
      signal: snapshotAbort.signal,
    });
    await vi.waitFor(() => expect(heartbeatStartedAt).toEqual([startedAtMs]));
    vi.setSystemTime(startedAtMs + 2_000);
    const timeoutError = new Error("The operation timed out.");
    timeoutError.name = "TimeoutError";
    firstHeartbeat.reject(timeoutError);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(heartbeatStartedAt).toHaveLength(2));

    expect(heartbeatStartedAt).toEqual([startedAtMs, startedAtMs + 2_000]);
    snapshotAbort.abort(new Error("test complete"));
  });

  it("reuses the snapshot session write fence when completing after the runtime lease changes", async () => {
    vi.useFakeTimers();
    const ref = createWorkspaceSnapshotV2Ref({ encryptedByteSize: 4 });
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    let currentLease = {
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    };
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot session fetch");
      if (request.url.includes("/workspace-snapshots/start")) {
        return new Response(
          JSON.stringify({
            encryption: {
              aad: buildHostedWorkspaceSnapshotV2Aad({
                objectKey: ref.objectKey,
                snapshotId: ref.snapshotId,
                userId: "member_123",
              }),
              dataKeyBase64,
              ivBase64: ref.encryption.ivBase64,
              rootKeyId: ref.encryption.rootKeyId,
              scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
              wrappedDataKey: ref.encryption.wrappedDataKey,
            },
            limits: {
              maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
              warnEncryptedBytes: 128 * 1024 * 1024,
            },
            objectKey: ref.objectKey,
            snapshotId: ref.snapshotId,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/heartbeat`)) {
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/complete`)) {
        return new Response(JSON.stringify({ error: "stale" }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 409,
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
      },
    });

    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "4",
      reason: "idle_shutdown",
    });
    currentLease = {
      attemptId: "attempt_2",
      leaseGeneration: "10",
      userId: "member_123",
      workspaceVersion: "5",
    };
    await expect(platform.workspaceSnapshotPort!.completeSnapshotSession({
      checkpointRequest: {
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "9",
        reason: "idle_shutdown",
        snapshotRef: ref,
      },
      ref,
    })).rejects.toThrow("Hosted workspace snapshot complete failed with HTTP 409.");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const completeRequest = requireFetchRequest(fetchMock.mock.calls[2], "workspace snapshot complete");
    expect(completeRequest.method).toBe("POST");
    expect(completeRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(completeRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(completeRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("4");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("replays one transport-ambiguous snapshot completion with the identical payload and headers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAtMs = Date.parse("2026-05-01T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const ref = createWorkspaceSnapshotV2Ref({ encryptedByteSize: 4 });
    const checkpointRequest = createWorkspaceSnapshotCheckpointRequest(ref);
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const completionBodies: string[] = [];
    const completionHeaders: Array<Array<[string, string]>> = [];
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot completion replay");
      if (request.url.endsWith("/workspace-snapshots/start")) {
        return createWorkspaceSnapshotSessionStartResponse({
          dataKeyBase64,
          objectKey: ref.objectKey,
          snapshotId: ref.snapshotId,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/heartbeat`)) {
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/complete`)) {
        completionBodies.push(await request.clone().text());
        completionHeaders.push(Array.from(request.headers.entries()));
        if (completionBodies.length === 1) {
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("{"));
              vi.setSystemTime(startedAtMs + 250);
              controller.error(new TypeError("fetch failed"));
            },
          }), {
            headers: { "content-type": "application/json; charset=utf-8" },
            status: 200,
          });
        }
        return createWorkspaceSnapshotCompleteResponse(ref);
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      commitTimeoutMs: 1_000,
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "4",
      reason: "idle_shutdown",
    });
    const completed = await platform.workspaceSnapshotPort!.completeSnapshotSession({
      checkpointRequest,
      ref,
    });

    expect(completed.snapshotRef).toEqual(ref);
    expect(completionBodies).toHaveLength(2);
    expect(completionBodies[1]).toBe(completionBodies[0]);
    expect(JSON.parse(completionBodies[0] ?? "null")).toEqual({
      archive: ref.archive,
      checkpointRequest,
      objectKey: ref.objectKey,
      snapshotId: ref.snapshotId,
    });
    expect(completionHeaders).toHaveLength(2);
    expect(completionHeaders[1]).toEqual(completionHeaders[0]);
    expect(Object.fromEntries(completionHeaders[0] ?? [])).toEqual(expect.objectContaining({
      "x-hosted-runtime-attempt-id": "attempt_1",
      "x-hosted-runtime-lease-generation": "9",
      "x-hosted-runtime-workspace-version": "4",
    }));
    expect(timeoutSpy.mock.calls.slice(-2)).toEqual([[750], [750]]);
    vi.useRealTimers();
  });

  it("does not replay an application 5xx when its response body transport closes", async () => {
    const ref = createWorkspaceSnapshotV2Ref({ encryptedByteSize: 4 });
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    let completionCalls = 0;
    let responseBodyCancelled = false;
    let responseBodyRead = false;
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot completion 5xx");
      if (request.url.endsWith("/workspace-snapshots/start")) {
        return createWorkspaceSnapshotSessionStartResponse({
          dataKeyBase64,
          objectKey: ref.objectKey,
          snapshotId: ref.snapshotId,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/heartbeat`)) {
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/complete`)) {
        completionCalls += 1;
        return new Response(new ReadableStream<Uint8Array>({
          cancel() {
            responseBodyCancelled = true;
          },
          pull(controller) {
            responseBodyRead = true;
            controller.error(new TypeError("fetch failed"));
          },
        }, {
          highWaterMark: 0,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 503,
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "4",
      reason: "idle_shutdown",
    });
    await expect(platform.workspaceSnapshotPort!.completeSnapshotSession({
      checkpointRequest: createWorkspaceSnapshotCheckpointRequest(ref),
      ref,
    })).rejects.toThrow("Hosted workspace snapshot complete failed with HTTP 503.");

    expect(completionCalls).toBe(1);
    expect(responseBodyCancelled).toBe(true);
    expect(responseBodyRead).toBe(false);
  });

  it("does not replay snapshot completion after cancellation", async () => {
    const ref = createWorkspaceSnapshotV2Ref({ encryptedByteSize: 4 });
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted snapshot completion");
    let completionCalls = 0;
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "cancelled workspace snapshot completion");
      if (request.url.endsWith("/workspace-snapshots/start")) {
        return createWorkspaceSnapshotSessionStartResponse({
          dataKeyBase64,
          objectKey: ref.objectKey,
          snapshotId: ref.snapshotId,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/heartbeat`)) {
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/complete`)) {
        completionCalls += 1;
        abortController.abort(abortReason);
        throw new TypeError("fetch failed");
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "4",
      reason: "idle_shutdown",
      signal: abortController.signal,
    });
    await expect(platform.workspaceSnapshotPort!.completeSnapshotSession({
      checkpointRequest: createWorkspaceSnapshotCheckpointRequest(ref),
      ref,
    })).rejects.toBe(abortReason);

    expect(completionCalls).toBe(1);
  });

  it("terminates snapshot completion after a second transport closure", async () => {
    const ref = createWorkspaceSnapshotV2Ref({ encryptedByteSize: 4 });
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    let completionCalls = 0;
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot repeated transport closure");
      if (request.url.endsWith("/workspace-snapshots/start")) {
        return createWorkspaceSnapshotSessionStartResponse({
          dataKeyBase64,
          objectKey: ref.objectKey,
          snapshotId: ref.snapshotId,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/heartbeat`)) {
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/complete`)) {
        completionCalls += 1;
        throw new TypeError("fetch failed");
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "4",
      reason: "idle_shutdown",
    });
    await expect(platform.workspaceSnapshotPort!.completeSnapshotSession({
      checkpointRequest: createWorkspaceSnapshotCheckpointRequest(ref),
      ref,
    })).rejects.toThrow("Hosted workspace snapshot complete request failed.");

    expect(completionCalls).toBe(2);
  });

  it("keeps snapshot heartbeat and stored headers through replay, then clears both", async () => {
    vi.useFakeTimers();
    const ref = createWorkspaceSnapshotV2Ref({ encryptedByteSize: 4 });
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    let currentLease = {
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    };
    const replayResponse = createDeferred<Response>();
    const completionHeaders: Array<Array<[string, string]>> = [];
    const heartbeatHeaders: Array<Array<[string, string]>> = [];
    const abortHeaders: Array<Array<[string, string]>> = [];
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot replay lifecycle");
      if (request.url.endsWith("/workspace-snapshots/start")) {
        return createWorkspaceSnapshotSessionStartResponse({
          dataKeyBase64,
          objectKey: ref.objectKey,
          snapshotId: ref.snapshotId,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/heartbeat`)) {
        heartbeatHeaders.push(Array.from(request.headers.entries()));
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/complete`)) {
        completionHeaders.push(Array.from(request.headers.entries()));
        if (completionHeaders.length === 1) {
          throw new TypeError("fetch failed");
        }
        return await replayResponse.promise;
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}`)) {
        abortHeaders.push(Array.from(request.headers.entries()));
        return new Response(JSON.stringify({ aborted: false, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      commitTimeoutMs: 30_000,
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
      },
    });

    try {
      await platform.workspaceSnapshotPort!.startSnapshotSession({
        expectedWorkspaceVersion: "4",
        reason: "idle_shutdown",
      });
      await vi.waitFor(() => expect(heartbeatHeaders).toHaveLength(1));
      currentLease = {
        attemptId: "attempt_2",
        leaseGeneration: "10",
        userId: "member_123",
        workspaceVersion: "5",
      };

      const completion = platform.workspaceSnapshotPort!.completeSnapshotSession({
        checkpointRequest: createWorkspaceSnapshotCheckpointRequest(ref),
        ref,
      });
      await vi.waitFor(() => expect(completionHeaders).toHaveLength(2));
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(heartbeatHeaders).toHaveLength(2));

      expect(Object.fromEntries(completionHeaders[0] ?? [])).toEqual(expect.objectContaining({
        "x-hosted-runtime-attempt-id": "attempt_1",
        "x-hosted-runtime-lease-generation": "9",
        "x-hosted-runtime-workspace-version": "4",
      }));
      expect(completionHeaders[1]).toEqual(completionHeaders[0]);
      expect(Object.fromEntries(heartbeatHeaders[1] ?? [])).toEqual(expect.objectContaining({
        "x-hosted-runtime-attempt-id": "attempt_1",
        "x-hosted-runtime-lease-generation": "9",
        "x-hosted-runtime-workspace-version": "4",
      }));

      replayResponse.resolve(createWorkspaceSnapshotCompleteResponse(ref));
      await completion;
      const heartbeatCountAfterCompletion = heartbeatHeaders.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(heartbeatHeaders).toHaveLength(heartbeatCountAfterCompletion);

      await platform.workspaceSnapshotPort!.abortSnapshotSession({
        objectKey: ref.objectKey,
        snapshotId: ref.snapshotId,
      });
      expect(abortHeaders).toHaveLength(1);
      expect(Object.fromEntries(abortHeaders[0] ?? [])).toEqual(expect.objectContaining({
        "x-hosted-runtime-attempt-id": "attempt_2",
        "x-hosted-runtime-lease-generation": "10",
        "x-hosted-runtime-workspace-version": "5",
      }));
    } finally {
      replayResponse.resolve(createWorkspaceSnapshotCompleteResponse(ref));
      vi.useRealTimers();
    }
  });

  it("returns foreground-pending snapshot completion checkpoints to the runtime", async () => {
    const ref = createWorkspaceSnapshotV2Ref({ encryptedByteSize: 4 });
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    let currentLease = {
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    };
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot session fetch");
      if (request.url.includes("/workspace-snapshots/start")) {
        return new Response(
          JSON.stringify({
            encryption: {
              aad: buildHostedWorkspaceSnapshotV2Aad({
                objectKey: ref.objectKey,
                snapshotId: ref.snapshotId,
                userId: "member_123",
              }),
              dataKeyBase64,
              ivBase64: ref.encryption.ivBase64,
              rootKeyId: ref.encryption.rootKeyId,
              scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
              wrappedDataKey: ref.encryption.wrappedDataKey,
            },
            limits: {
              maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
              warnEncryptedBytes: 128 * 1024 * 1024,
            },
            objectKey: ref.objectKey,
            snapshotId: ref.snapshotId,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/heartbeat`)) {
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/complete`)) {
        return new Response(
          JSON.stringify({
            checkpoint: {
              checkpointConflictReason: "foreground_pending",
              checkpointed: false,
              workspace: {
                checkpointedAt: "2026-04-26T00:00:05.000Z",
                createdAt: "2026-04-26T00:00:00.000Z",
                nextWakeAt: null,
                nextWakeReason: null,
                redactedStatus: null,
                snapshotRef: null,
                updatedAt: "2026-04-26T00:00:05.000Z",
                userId: "member_123",
                version: "4",
              },
            },
            ok: true,
            snapshotRef: ref,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      }
      return new Response("unexpected", { status: 500 });
    });
    const recordCheckpoint = vi.fn();
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
        recordCheckpoint,
      },
    });

    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "4",
      reason: "idle_shutdown",
    });
    currentLease = {
      attemptId: "attempt_2",
      leaseGeneration: "10",
      userId: "member_123",
      workspaceVersion: "5",
    };
    const completed = await platform.workspaceSnapshotPort!.completeSnapshotSession({
      checkpointRequest: {
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "9",
        reason: "idle_shutdown",
        snapshotRef: ref,
      },
      ref,
    });

    expect(completed.checkpoint).toEqual(expect.objectContaining({
      checkpointConflictReason: "foreground_pending",
      checkpointed: false,
    }));
    expect(completed.snapshotRef).toEqual(ref);
    expect(recordCheckpoint).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const completeRequest = requireFetchRequest(fetchMock.mock.calls[2], "workspace snapshot complete");
    expect(completeRequest.method).toBe("POST");
    expect(completeRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(completeRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(completeRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("4");
  });

  it("rejects workspace snapshot start payloads whose AAD user is not the bound runner user", async () => {
    const snapshotId = "snapshot_runner_platform_start";
    const objectKey =
      `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "workspace snapshot start");
      if (request.url.includes("/workspace-snapshots/start")) {
        return new Response(
          JSON.stringify({
            encryption: {
              aad: buildHostedWorkspaceSnapshotV2Aad({
                objectKey,
                snapshotId,
                userId: "other_member",
              }),
              dataKeyBase64,
              ivBase64: "AQIDBAUGBwgJCgsM",
              rootKeyId: "root_key_test",
              scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
              wrappedDataKey: "wrapped_data_key_test",
            },
            limits: {
              maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
              warnEncryptedBytes: 128 * 1024 * 1024,
            },
            objectKey,
            snapshotId,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "6",
      reason: "idle_shutdown",
    })).rejects.toThrow(
      "Hosted workspace snapshot session start response AAD does not match its user binding.",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("restores v2 workspace snapshots through unwrap, presigned GET, and direct R2 fetch", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-restore-"));
    const sourceRoot = path.join(tempRoot, "source");
    const snapshotScratchRoot = path.join(tempRoot, "snapshot-scratch");
    const durableRoot = path.join(tempRoot, "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);

    try {
      await mkdir(sourceRoot, { mode: 0o700, recursive: true });
      await writeFile(path.join(sourceRoot, "note.md"), "restored through direct r2\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      const snapshotId = "snapshot_runner_platform_restore";
      const objectKey =
        `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId: "member_123",
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: [{
          absolutePath: path.join(sourceRoot, "note.md"),
          archivePath: "note.md",
          kind: "file",
        }],
        dataKey: dataKeyBase64,
        durableRoot: sourceRoot,
        ivBase64: "AQIDBAUGBwgJCgsM",
        maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        outputDir: snapshotScratchRoot,
      });
      const encryptedBytes = await readFile(encrypted.encryptedFilePath);
      await rm(snapshotScratchRoot, { force: true, recursive: true });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"));
      const getUrl = `https://r2.example.test/bundles/${objectKey}?X-Amz-Signature=fixture-get`;
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot restore fetch");
        if (request.url.includes(`/workspace-snapshots/${snapshotId}/data-key/unwrap`)) {
          return new Response(
            JSON.stringify({ dataKey: dataKeyBase64 }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }
        if (request.url.includes(`/workspace-snapshots/${snapshotId}/presign-get`)) {
          return new Response(
            JSON.stringify({
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              getUrl,
            }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }
        if (request.url === getUrl) {
          vi.setSystemTime(new Date(Date.now() + 25));
          let bodySent = false;
          return new Response(new ReadableStream<Uint8Array>({
            pull(controller) {
              if (bodySent) {
                return;
              }
              bodySent = true;
              vi.setSystemTime(new Date(Date.now() + 30));
              controller.enqueue(encryptedBytes);
              controller.close();
            },
          }, { highWaterMark: 0 }), {
            headers: {
              "content-length": String(encrypted.encryptedByteSize),
              "content-type": "application/octet-stream",
            },
            status: 200,
          });
        }
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        commitTimeoutMs: 10,
        fetchImpl: fetchMock as typeof fetch,
        workspaceCheckpointBridge: {
          readCurrentLease: () => ({
            attemptId: "runtime_write_123",
            leaseGeneration: "7",
            userId: "member_123",
            workspaceVersion: "6",
          }),
        },
      });

      const restoreTimings = await platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref: {
          archive: {
            compression: encrypted.compression,
            encryptedByteSize: encrypted.encryptedByteSize,
            encryptedObjectSha256: encrypted.encryptedObjectSha256,
            fileCount: encrypted.fileCount,
            format: "tar",
            plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
            totalPlainBytes: encrypted.totalPlainBytes,
          },
          createdAt: "2026-05-20T00:00:00.000Z",
          encryption: {
            aad,
            ivBase64: encrypted.ivBase64,
            rootKeyId: "root_key_test",
            scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
            wrappedDataKey: "wrapped_data_key_test",
          },
          objectKey,
          schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
          snapshotId,
          upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
          userId: "member_123",
        },
      });
      for (const key of [
        "sizeGuardMs",
        "dataKeyUnwrapMs",
        "presignGetMs",
        "objectFetchMs",
        "objectFetchResponseHeadersMs",
        "objectFetchBodyReadMs",
        "decryptMs",
        "archiveExtractMs",
        "durableRootReplaceMs",
        "cleanupMs",
        "extractMs",
      ] as const) {
        expect(typeof restoreTimings?.[key]).toBe("number");
        expect(Number.isFinite(restoreTimings?.[key])).toBe(true);
        expect(restoreTimings?.[key]).toBeGreaterThanOrEqual(0);
      }
      expect(restoreTimings?.encryptedBytes).toBe(encrypted.encryptedByteSize);
      expect(restoreTimings?.plainBytes).toBe(encrypted.totalPlainBytes);
      expect(restoreTimings?.replaySafeReadMaxAttempt).toBe(1);
      expect(restoreTimings?.objectFetchResponseHeadersMs).toBe(25);
      expect(restoreTimings?.objectFetchBodyReadMs).toBe(30);
      expect(
        (restoreTimings?.objectFetchResponseHeadersMs ?? 0)
          + (restoreTimings?.objectFetchBodyReadMs ?? 0),
      ).toBeLessThanOrEqual(restoreTimings?.decryptMs ?? 0);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const restoreRequests = fetchMock.mock.calls.map((call) =>
        requireFetchRequest(call, "workspace snapshot restore request"),
      );
      expect(restoreRequests.map((request) => request.url)).toEqual([
        "http://workspace-snapshots.worker/workspace-snapshots/snapshot_runner_platform_restore/data-key/unwrap",
        "http://workspace-snapshots.worker/workspace-snapshots/snapshot_runner_platform_restore/presign-get",
        getUrl,
      ]);
      const unwrapRequest = restoreRequests.find((request) => request.url.endsWith("/data-key/unwrap"));
      expect(unwrapRequest?.url).toBe(
        "http://workspace-snapshots.worker/workspace-snapshots/snapshot_runner_platform_restore/data-key/unwrap",
      );
      await expect(unwrapRequest!.json()).resolves.toEqual({
        aad,
        rootKeyId: "root_key_test",
        wrappedDataKey: "wrapped_data_key_test",
      });
      const presignRequest = restoreRequests.find((request) => request.url.endsWith("/presign-get"));
      expect(presignRequest?.url).toBe(
        "http://workspace-snapshots.worker/workspace-snapshots/snapshot_runner_platform_restore/presign-get",
      );
      await expect(presignRequest!.json()).resolves.toEqual({
        objectKey,
        ref: expect.objectContaining({
          objectKey,
          snapshotId,
          userId: "member_123",
        }),
        snapshotId,
      });
      expect(restoreRequests.some((request) => request.url === getUrl)).toBe(true);
      await expect(access(path.join(durableRoot, "note.md"))).resolves.toBeUndefined();
      const workspaceSnapshotLogs = readWorkspaceSnapshotDiagnosticLogs();
      const completedSteps = workspaceSnapshotLogs
        .filter((log) => log.message === "Hosted workspace snapshot restore step completed.")
        .map((log) => log.details?.workspaceSnapshotRestoreStep);
      expect(completedSteps).toEqual([
        "size_guard",
        "data_key_unwrap",
        "presign_get",
        "object_fetch",
      ]);
      expect(workspaceSnapshotLogs[0]?.details).toEqual(expect.objectContaining({
        archiveEncryptedByteSize: encrypted.encryptedByteSize,
        archiveFileCount: encrypted.fileCount,
        operation: "workspace_snapshot_restore",
      }));
      expect(workspaceSnapshotLogs.every((log) => log.userId === null)).toBe(true);
      const serializedLogs = JSON.stringify(workspaceSnapshotLogs);
      expect(serializedLogs).not.toContain(objectKey);
      expect(serializedLogs).not.toContain(snapshotId);
      expect(serializedLogs).not.toContain(getUrl);
      expect(serializedLogs).not.toContain("member_123");
      expect(serializedLogs).not.toContain("root_key_test");
      expect(serializedLogs).not.toContain(dataKeyBase64);
      expect(serializedLogs).not.toContain(sourceRoot);
      expect(serializedLogs).not.toContain(durableRoot);
      expect(serializedLogs).not.toContain(snapshotScratchRoot);
      expect(serializedLogs).not.toContain("note.md");
      expect(serializedLogs).not.toContain("restored through direct r2");
    } finally {
      vi.useRealTimers();
      dataKey.fill(0);
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("retries v2 workspace snapshot object fetch transport failures once", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-retry-"));
    const sourceRoot = path.join(tempRoot, "source");
    const durableRoot = path.join(tempRoot, "durable");
    const scratchRoot = path.join(tempRoot, "scratch");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);

    try {
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(path.join(sourceRoot, "note.md"), "restored after retry", {
        mode: 0o600,
      });
      const snapshotId = "snapshot_runner_platform_retry";
      const objectKey =
        `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId: "member_123",
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: [{
          absolutePath: path.join(sourceRoot, "note.md"),
          archivePath: "note.md",
          kind: "file",
        }],
        dataKey: dataKeyBase64,
        durableRoot: sourceRoot,
        ivBase64: "AQIDBAUGBwgJCgsM",
        maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        outputDir: scratchRoot,
      });
      const encryptedBytes = await readFile(encrypted.encryptedFilePath);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"));
      const getUrl = `https://r2.example.test/bundles/${objectKey}?X-Amz-Signature=fixture-get`;
      let objectFetchCount = 0;
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot restore retry fetch");
        if (request.url.includes(`/workspace-snapshots/${snapshotId}/data-key/unwrap`)) {
          return new Response(JSON.stringify({ dataKey: dataKeyBase64 }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        if (request.url.includes(`/workspace-snapshots/${snapshotId}/presign-get`)) {
          return new Response(JSON.stringify({
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            getUrl,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        if (request.url === getUrl) {
          objectFetchCount += 1;
          if (objectFetchCount === 1) {
            vi.setSystemTime(new Date(Date.now() + 80));
            let prefixSent = false;
            return new Response(new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!prefixSent) {
                  prefixSent = true;
                  vi.setSystemTime(new Date(Date.now() + 70));
                  controller.enqueue(encryptedBytes.subarray(0, 32));
                  return;
                }
                controller.error(new TypeError("connection reset"));
              },
            }, { highWaterMark: 0 }), {
              headers: {
                "content-length": String(encrypted.encryptedByteSize),
                "content-type": "application/octet-stream",
              },
              status: 200,
            });
          }
          vi.setSystemTime(new Date(Date.now() + 7));
          let bodySent = false;
          return new Response(new ReadableStream<Uint8Array>({
            pull(controller) {
              if (bodySent) {
                return;
              }
              bodySent = true;
              vi.setSystemTime(new Date(Date.now() + 11));
              controller.enqueue(encryptedBytes);
              controller.close();
            },
          }, { highWaterMark: 0 }), {
            headers: {
              "content-length": String(encrypted.encryptedByteSize),
              "content-type": "application/octet-stream",
            },
            status: 200,
          });
        }
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      const restoreTimings = await platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref: {
          archive: {
            compression: encrypted.compression,
            encryptedByteSize: encrypted.encryptedByteSize,
            encryptedObjectSha256: encrypted.encryptedObjectSha256,
            fileCount: encrypted.fileCount,
            format: "tar",
            plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
            totalPlainBytes: encrypted.totalPlainBytes,
          },
          createdAt: "2026-05-20T00:00:00.000Z",
          encryption: {
            aad,
            ivBase64: encrypted.ivBase64,
            rootKeyId: "root_key_test",
            scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
            wrappedDataKey: "wrapped_data_key_test",
          },
          objectKey,
          schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
          snapshotId,
          upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
          userId: "member_123",
        },
      });

      expect(objectFetchCount).toBe(2);
      expect(restoreTimings?.objectFetchResponseHeadersMs).toBe(7);
      expect(restoreTimings?.objectFetchBodyReadMs).toBe(11);
      await expect(access(path.join(durableRoot, "note.md"))).resolves.toBeUndefined();
      await expect(
        readdir(tempRoot).then((entries) =>
          entries.filter((entry) => entry.startsWith(".workspace-snapshot-restore-")),
        ),
      ).resolves.toEqual([]);
      const retryLogs = readWorkspaceSnapshotDiagnosticLogs()
        .filter((log) =>
          log.message === "Hosted workspace snapshot restore read step failed; retrying."
        );
      expect(retryLogs).toHaveLength(1);
      expect(retryLogs[0]?.details).toEqual(expect.objectContaining({
        fetchCauseKind: "network",
        retrying: true,
        workspaceSnapshotRestoreAttempt: 1,
        workspaceSnapshotRestoreStep: "object_fetch",
      }));
      expect(restoreTimings).toMatchObject({ replaySafeReadMaxAttempt: 2 });
      expect(() => assertEstablishedR2ColdStartAttempt({
        expectedEncryptedBytes: encrypted.encryptedByteSize,
        expectedPlainBytes: encrypted.totalPlainBytes,
        runtimeLogs: [{
          attemptId: "runtime_write_123",
          level: "info",
          phase: "idle",
        }],
        successfulAttemptId: "runtime_write_123",
        trace: {
          phaseBreakdown: {
            schemaVersion: 1,
            boot: { restoreWasCold: true },
            restore: restoreTimings ?? {},
          },
          runtimeAttemptId: "runtime_write_123",
        },
        workspaceWriteFenceGeneration: "1",
      })).toThrow("recovered workspace snapshot restore");
      const serializedLogs = JSON.stringify(readWorkspaceSnapshotDiagnosticLogs());
      expect(serializedLogs).not.toContain(objectKey);
      expect(serializedLogs).not.toContain(snapshotId);
      expect(serializedLogs).not.toContain(getUrl);
      expect(serializedLogs).toContain("connection reset");
      expect(serializedLogs).not.toContain(dataKeyBase64);
      expect(serializedLogs).not.toContain(tempRoot);
    } finally {
      vi.useRealTimers();
      dataKey.fill(0);
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("aborts and cancels stalled v2 workspace snapshot object body reads", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-body-abort-"));
    const durableRoot = path.join(tempRoot, "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);
    const ref = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 128,
    });
    const getUrl = `https://r2.example.test/bundles/${ref.objectKey}?X-Amz-Signature=fixture-get`;
    const abortController = new AbortController();
    let objectFetchCount = 0;
    let objectBodyCancelCount = 0;
    let resolveObjectBodyOpened: (() => void) | null = null;
    const objectBodyOpened = new Promise<void>((resolve) => {
      resolveObjectBodyOpened = resolve;
    });

    try {
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot stalled body fetch");
        if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/data-key/unwrap`)) {
          return new Response(JSON.stringify({ dataKey: dataKeyBase64 }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/presign-get`)) {
          return new Response(JSON.stringify({
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            getUrl,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        if (request.url === getUrl) {
          objectFetchCount += 1;
          return new Response(new ReadableStream<Uint8Array>({
            cancel: () => {
              objectBodyCancelCount += 1;
            },
            start: () => {
              resolveObjectBodyOpened?.();
              resolveObjectBodyOpened = null;
            },
          }), {
            headers: {
              "content-length": String(ref.archive.encryptedByteSize),
              "content-type": "application/octet-stream",
            },
            status: 200,
          });
        }
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      const restore = platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref,
        signal: abortController.signal,
      });
      await objectBodyOpened;
      abortController.abort(new Error("restore aborted while reading snapshot body"));

      await expect(restore).rejects.toThrow("restore aborted while reading snapshot body");
      expect(objectFetchCount).toBe(1);
      expect(objectBodyCancelCount).toBe(1);
      await expect(access(durableRoot)).rejects.toThrow();
      expect(readWorkspaceSnapshotDiagnosticLogs().filter((log) =>
        log.message === "Hosted workspace snapshot restore read step failed; retrying."
      )).toHaveLength(0);
    } finally {
      dataKey.fill(0);
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("does not retry v2 workspace snapshot byte-count mismatches", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-byte-count-"));
    const durableRoot = path.join(tempRoot, "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);
    const ref = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 1024,
    });
    const getUrl = `https://r2.example.test/bundles/${ref.objectKey}?X-Amz-Signature=fixture-get`;
    let objectFetchCount = 0;

    try {
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot byte-count mismatch fetch");
        if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/data-key/unwrap`)) {
          return new Response(JSON.stringify({ dataKey: dataKeyBase64 }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/presign-get`)) {
          return new Response(JSON.stringify({
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            getUrl,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        if (request.url === getUrl) {
          objectFetchCount += 1;
          return new Response(new Uint8Array([1, 2, 3]), {
            headers: {
              "content-type": "application/octet-stream",
            },
            status: 200,
          });
        }
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      await expect(platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref,
      })).rejects.toThrow("Hosted workspace snapshot fetch byte count does not match its ref.");

      expect(objectFetchCount).toBe(1);
      expect(readWorkspaceSnapshotDiagnosticLogs().filter((log) =>
        log.message === "Hosted workspace snapshot restore read step failed; retrying."
      )).toHaveLength(0);
    } finally {
      dataKey.fill(0);
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("logs the failing v2 workspace snapshot restore step without object identifiers", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-restore-fail-"));
    const durableRoot = path.join(tempRoot, "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);
    const ref = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 1024,
    });
    const getUrl = "https://r2.example.test/bundles/hidden-object?X-Amz-Signature=fixture-get";

    try {
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot restore failure fetch");
        if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/data-key/unwrap`)) {
          return new Response(
            JSON.stringify({ dataKey: dataKeyBase64 }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }
        if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/presign-get`)) {
          return new Response(
            JSON.stringify({
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              getUrl,
            }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }
        if (request.url === getUrl) {
          return new Response("missing", { status: 404 });
        }
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      await expect(platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref,
      })).rejects.toThrow("Hosted workspace snapshot encrypted object is unavailable.");

      const failedLogs = readWorkspaceSnapshotDiagnosticLogs()
        .filter((log) => log.message === "Hosted workspace snapshot restore step failed.");
      expect(failedLogs).toHaveLength(1);
      expect(failedLogs[0]).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          errorCode: "runtime_error",
          errorMessagePresent: true,
          errorName: "Error",
          operation: "workspace_snapshot_restore",
          workspaceSnapshotRestoreStep: "object_fetch",
        }),
        level: "warn",
        phase: "runtime.starting",
        userId: null,
      }));
      const serializedLogs = JSON.stringify(readWorkspaceSnapshotDiagnosticLogs());
      expect(serializedLogs).not.toContain(ref.objectKey);
      expect(serializedLogs).not.toContain(ref.snapshotId);
      expect(serializedLogs).not.toContain(getUrl);
      expect(serializedLogs).not.toContain("hidden-object");
      expect(serializedLogs).not.toContain("member_123");
      expect(serializedLogs).not.toContain(dataKeyBase64);
      expect(serializedLogs).not.toContain(tempRoot);
      expect(serializedLogs).not.toContain("missing");
    } finally {
      dataKey.fill(0);
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("logs v2 workspace snapshot unwrap response failures without snapshot path material", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-unwrap-fail-"));
    const durableRoot = path.join(tempRoot, "durable");
    const ref = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 1024,
    });
    const responseDetail =
      `unwrap failed for ${ref.snapshotId} ${ref.objectKey} root_key_test wrapped_data_key_test https://r2.example.test/bundles/body-presigned`;

    try {
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot unwrap failure fetch");
        if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/data-key/unwrap`)) {
          return new Response(responseDetail, {
            headers: {
              "content-type": "text/plain; charset=utf-8",
            },
            status: 500,
          });
        }
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      await expect(platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref,
      })).rejects.toThrow("Hosted workspace snapshot data key unwrap failed with HTTP 500.");

      // The unwrap failure stops restore before presign or object fetch work.
      const failedUnwrapLogs = readWorkspaceSnapshotDiagnosticLogs()
        .filter((log) => log.message === "Hosted workspace snapshot restore step failed.")
        .filter((log) => log.details?.workspaceSnapshotRestoreStep === "data_key_unwrap");
      expect(failedUnwrapLogs).toHaveLength(1);
      expect(failedUnwrapLogs[0]).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          errorCode: "runtime_error",
          errorMessagePresent: true,
          errorName: "Error",
          operation: "workspace_snapshot_restore",
          workspaceSnapshotRestoreStep: "data_key_unwrap",
        }),
        level: "warn",
        phase: "runtime.starting",
        userId: null,
      }));

      const upstreamNonOkLogs = mocks.emitHostedExecutionStructuredLog.mock.calls
        .map(([input]) => input)
        .filter((input): input is {
          details?: Record<string, unknown>;
          message?: unknown;
        } =>
          Boolean(input)
          && typeof input === "object"
          && !Array.isArray(input)
          && (input as { message?: unknown }).message === "Hosted runtime upstream response returned non-OK."
        )
        .filter((input) =>
          input.details?.description === "Hosted workspace snapshot data key unwrap"
        );
      expect(upstreamNonOkLogs).toHaveLength(1);
      expect(upstreamNonOkLogs[0]?.details).toEqual(expect.objectContaining({
        description: "Hosted workspace snapshot data key unwrap",
        method: "POST",
        path: "/workspace-snapshots/REDACTED/data-key/unwrap",
        responseBodyBytes: new TextEncoder().encode(responseDetail).byteLength,
        responseBodyPresent: true,
        responseOrigin: "http://workspace-snapshots.worker",
        responseStatus: 500,
      }));

      const serializedLogs = JSON.stringify([
        ...readWorkspaceSnapshotDiagnosticLogs(),
        ...upstreamNonOkLogs,
      ]);
      const serializedAllStructuredLogs = JSON.stringify(
        mocks.emitHostedExecutionStructuredLog.mock.calls,
      );
      expect(serializedLogs).not.toContain(ref.objectKey);
      expect(serializedLogs).not.toContain(ref.snapshotId);
      expect(serializedLogs).not.toContain("body-presigned");
      expect(serializedLogs).not.toContain("member_123");
      expect(serializedLogs).not.toContain("root_key_test");
      expect(serializedLogs).not.toContain("wrapped_data_key_test");
      expect(serializedLogs).not.toContain(tempRoot);
      expect(serializedAllStructuredLogs).not.toContain(responseDetail);
      expect(serializedAllStructuredLogs).not.toContain(ref.objectKey);
      expect(serializedAllStructuredLogs).not.toContain("body-presigned");
      expect(serializedAllStructuredLogs).not.toContain("root_key_test");
      expect(serializedAllStructuredLogs).not.toContain("wrapped_data_key_test");
      expect(serializedAllStructuredLogs).not.toContain(tempRoot);
    } finally {
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("logs v2 workspace snapshot direct object transport errors without R2 path or query material", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-transport-fail-"));
    const durableRoot = path.join(tempRoot, "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);
    const ref = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 1024,
    });
    const getUrl = `https://r2.example.test/bundles/${ref.objectKey}?X-Amz-Signature=fixture-get&X-Amz-Credential=hidden`;

    try {
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot restore transport failure fetch");
        if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/data-key/unwrap`)) {
          return new Response(
            JSON.stringify({ dataKey: dataKeyBase64 }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }
        if (request.url.includes(`/workspace-snapshots/${ref.snapshotId}/presign-get`)) {
          return new Response(
            JSON.stringify({
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              getUrl,
            }),
            {
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              status: 200,
            },
          );
        }
        if (request.url === getUrl) {
          throw new TypeError(`fetch failed for ${getUrl} with hidden transport detail`);
        }
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      let thrown: unknown;
      try {
        await platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
          durableRoot,
          ref,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(
        "Hosted workspace snapshot fetch request failed.",
      );
      expect(readHostedWorkspaceSnapshotRestoreStep(thrown)).toBe("object_fetch");

      const failedLogs = readWorkspaceSnapshotDiagnosticLogs()
        .filter((log) => log.message === "Hosted workspace snapshot restore step failed.");
      expect(failedLogs).toHaveLength(2);
      expect(failedLogs.at(-1)).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          errorCode: "type_error",
          errorMessagePresent: true,
          errorName: "Error",
          fetchCauseCode: "type_error",
          fetchCauseKind: "fetch_failed",
          fetchCauseName: "TypeError",
          operation: "workspace_snapshot_restore",
          workspaceSnapshotRestoreStep: "object_fetch",
        }),
        level: "warn",
        phase: "runtime.starting",
        userId: null,
      }));
      const retryLogs = readWorkspaceSnapshotDiagnosticLogs()
        .filter((log) =>
          log.message === "Hosted workspace snapshot restore read step failed; retrying."
        );
      expect(retryLogs).toHaveLength(1);
      expect(retryLogs[0]?.details).toEqual(expect.objectContaining({
        fetchCauseKind: "fetch_failed",
        retrying: true,
        workspaceSnapshotRestoreAttempt: 1,
        workspaceSnapshotRestoreStep: "object_fetch",
      }));

      const directFetchFailureLogs = mocks.emitHostedExecutionStructuredLog.mock.calls
        .map(([input]) => input)
        .filter((input): input is {
          details?: Record<string, unknown>;
          message?: unknown;
        } =>
          Boolean(input)
          && typeof input === "object"
          && !Array.isArray(input)
          && (input as { message?: unknown }).message === "Hosted runtime upstream request failed."
        );
      expect(directFetchFailureLogs).toHaveLength(2);
      expect(directFetchFailureLogs.at(-1)?.details).toEqual(expect.objectContaining({
        description: "Hosted workspace snapshot fetch",
        fetchCauseCode: "type_error",
        fetchCauseKind: "fetch_failed",
        fetchCauseName: "TypeError",
        method: "GET",
        path: "/workspace-snapshot-object",
        responseOrigin: "workspace_snapshot_object",
      }));

      const serializedLogs = JSON.stringify([
        ...readWorkspaceSnapshotDiagnosticLogs(),
        ...directFetchFailureLogs,
      ]);
      expect(serializedLogs).not.toContain(ref.objectKey);
      expect(serializedLogs).not.toContain(ref.snapshotId);
      expect(serializedLogs).not.toContain(getUrl);
      expect(serializedLogs).not.toContain("r2.example.test");
      expect(serializedLogs).not.toContain("/bundles/");
      expect(serializedLogs).not.toContain("X-Amz");
      expect(serializedLogs).not.toContain("fixture-get");
      expect(serializedLogs).toContain("hidden transport detail");
      expect(serializedLogs).not.toContain("member_123");
      expect(serializedLogs).not.toContain("root_key_test");
      expect(serializedLogs).not.toContain("wrapped_data_key_test");
      expect(serializedLogs).not.toContain(dataKeyBase64);
      expect(serializedLogs).not.toContain(tempRoot);
    } finally {
      dataKey.fill(0);
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("logs archive restore tar/zstd process failures without stderr text", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-archive-process-fail-"));
    const durableRoot = path.join(tempRoot, "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(dataKey);
    const snapshotId = "snapshot_runner_platform_archive_process_fail";
    const objectKey =
      `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const invalidPlaintextArchive = Buffer.from(
      "not a zstd archive; hidden local path /tmp/private-snapshot-detail\n",
      "utf8",
    );
    const encrypted = createEncryptedWorkspaceSnapshotBytes({
      aad,
      dataKey,
      ivBase64: "AQIDBAUGBwgJCgsM",
      plaintextArchive: invalidPlaintextArchive,
    });
    const getUrl = `https://r2.example.test/bundles/${objectKey}?X-Amz-Signature=fixture-get`;

    try {
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        const request = requireFetchRequest(args, "workspace snapshot archive process fetch");
        if (request.url.includes(`/workspace-snapshots/${snapshotId}/data-key/unwrap`)) {
          return new Response(JSON.stringify({ dataKey: dataKeyBase64 }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        if (request.url.includes(`/workspace-snapshots/${snapshotId}/presign-get`)) {
          return new Response(JSON.stringify({
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            getUrl,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }
        if (request.url === getUrl) {
          return new Response(copyBufferToArrayBuffer(encrypted.encryptedBytes), {
            headers: {
              "content-length": String(encrypted.encryptedBytes.byteLength),
              "content-type": "application/octet-stream",
            },
            status: 200,
          });
        }
        return new Response("unexpected", { status: 500 });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      await expect(platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
        durableRoot,
        ref: {
          archive: {
            compression: "zstd",
            encryptedByteSize: encrypted.encryptedBytes.byteLength,
            encryptedObjectSha256: encrypted.encryptedObjectSha256,
            fileCount: 1,
            format: "tar",
            plaintextArchiveSha256: encrypted.plaintextArchiveSha256,
            totalPlainBytes: invalidPlaintextArchive.byteLength,
          },
          createdAt: "2026-05-20T00:00:00.000Z",
          encryption: {
            aad,
            ivBase64: "AQIDBAUGBwgJCgsM",
            rootKeyId: "root_key_test",
            scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
            wrappedDataKey: "wrapped_data_key_test",
          },
          objectKey,
          schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
          snapshotId,
          upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
          userId: "member_123",
        },
      })).rejects.toThrow(/^Hosted workspace snapshot zstd command failed with /u);

      const failedLogs = readWorkspaceSnapshotDiagnosticLogs()
        .filter((log) => log.message === "Hosted workspace snapshot restore step failed.");
      expect(failedLogs.at(-1)).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          errorCode: "runtime_error",
          errorMessagePresent: true,
          errorName: "Error",
          operation: "workspace_snapshot_restore",
          workspaceSnapshotProcessLabel: "zstd",
          workspaceSnapshotProcessStderrBytes: expect.any(Number),
          workspaceSnapshotProcessStderrLineCount: expect.any(Number),
          workspaceSnapshotProcessStderrTruncated: false,
          workspaceSnapshotRestoreStep: "object_fetch",
        }),
        level: "warn",
        phase: "runtime.starting",
        userId: null,
      }));
      const processFailureDetails = failedLogs.at(-1)?.details;
      expect(processFailureDetails).not.toHaveProperty(
        "workspaceSnapshotProcessStderrErrorDetail",
      );
      expect(
        typeof processFailureDetails?.workspaceSnapshotProcessExitCode === "number"
        || typeof processFailureDetails?.workspaceSnapshotProcessSignal === "string",
      ).toBe(true);

      const serializedLogs = JSON.stringify(readWorkspaceSnapshotDiagnosticLogs());
      expect(serializedLogs).not.toContain(snapshotId);
      expect(serializedLogs).not.toContain(objectKey);
      expect(serializedLogs).not.toContain(getUrl);
      expect(serializedLogs).not.toContain("private-snapshot-detail");
      expect(serializedLogs).not.toContain("member_123");
      expect(serializedLogs).not.toContain("root_key_test");
      expect(serializedLogs).not.toContain("wrapped_data_key_test");
      expect(serializedLogs).not.toContain(dataKeyBase64);
      expect(serializedLogs).not.toContain(tempRoot);
    } finally {
      dataKey.fill(0);
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("logs upstream request failures with safe request metadata", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow("Hosted raw email read request failed.");

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: expect.objectContaining({
          description: "Hosted raw email read",
          method: "GET",
          path: "/messages/raw_123",
          responseOrigin: "http://results.worker",
        }),
        level: "warn",
        message: "Hosted runtime upstream request failed.",
        phase: "outbox",
        userId: null,
      }),
    );
  });

  it("attaches raw redacted artifact fetch cause metadata", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed with hidden artifact transport detail");
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    let thrown: unknown;
    try {
      await platform.artifactStore.get("a".repeat(64), {
        purpose: "workspace_restore",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HostedRuntimeArtifactReadError);
    expect(thrown).toMatchObject({ retryable: true });
    expect((thrown as Error).message).toBe(
      "Hosted artifact fetch request failed.",
    );
    expect(String(thrown)).not.toContain("hidden artifact transport detail");
    expect(readHostedRuntimeControlPlaneFetchFailureDiagnostics(thrown)).toEqual({
      fetchCallerSignalAborted: false,
      fetchCauseCode: "type_error",
      fetchCauseKind: "fetch_failed",
      fetchCauseName: "TypeError",
      fetchRequestSignalAborted: false,
      fetchTimeoutMs: expect.any(Number),
      fetchTimeoutSignalAborted: false,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactFetchOrdinal: 1,
          method: "GET",
          operation: "artifact_fetch",
          path: "/objects/REDACTED",
          timeoutMs: expect.any(Number),
        }),
        message: "Hosted runtime artifact fetch started.",
        phase: "runtime.starting",
        userId: null,
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactFetchOrdinal: 1,
          errorCode: "type_error",
          errorMessagePresent: true,
          fetchCauseCode: "type_error",
          fetchCauseKind: "fetch_failed",
          fetchCauseName: "TypeError",
          fetchRequestSignalAborted: false,
          fetchTimeoutSignalAborted: false,
          method: "GET",
          operation: "artifact_fetch",
          path: "/objects/REDACTED",
        }),
        level: "warn",
        message: "Hosted runtime artifact fetch failed before response.",
        phase: "runtime.starting",
        userId: null,
      }),
    );
    const serializedLogs = JSON.stringify(
      mocks.emitHostedExecutionStructuredLog.mock.calls.filter(([input]) =>
        input?.component === "hosted.runtime.artifact-store"
      ),
    );
    expect(serializedLogs).toContain("hidden artifact transport detail");
    expect(serializedLogs).not.toContain("a".repeat(64));
  });

  it.each([
    { retryable: false, status: 422 },
    { retryable: true, status: 503 },
  ])("maps artifact HTTP $status to retryable=$retryable", async ({
    retryable,
    status,
  }) => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: vi.fn(async () => new Response(null, { status })) as typeof fetch,
    });

    let thrown: unknown;
    try {
      await platform.artifactStore.get("a".repeat(64), {
        purpose: "workspace_restore",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HostedRuntimeArtifactReadError);
    expect(thrown).toMatchObject({ retryable });
  });

  it("attaches the active runtime write fence to legacy artifact reads", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));

    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.artifactStore.get("a".repeat(64), {
      purpose: "workspace_restore",
    })).resolves.toBeNull();

    const request = requireFetchRequest(fetchMock.mock.calls[0], "artifact read");
    expect(request.url).toBe(`http://artifacts.worker/objects/${"a".repeat(64)}`);
    expectDefaultRuntimeWriteFenceHeaders(request);
    expect(request.headers.get(HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_HEADER))
      .toBe("workspace_restore");
    const correlationId = request.headers.get(
      HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER,
    );
    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactFetchCorrelationId: correlationId,
          artifactReadPurpose: "workspace_restore",
        }),
      }),
    );
  });

  it("preserves cancellation while a legacy snapshot artifact fetch is pending", async () => {
    const abortController = new AbortController();
    const abortReason = new Error("foreground wake interrupted legacy artifact fetch");
    let resolveFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "pending legacy snapshot artifact fetch");
      resolveFetchStarted?.();
      resolveFetchStarted = null;
      await delayWithAbort(60_000, request.signal);
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const artifact = platform.artifactStore.get("a".repeat(64), {
      purpose: "legacy_snapshot_materialization",
      signal: abortController.signal,
    });
    await fetchStarted;
    abortController.abort(abortReason);

    await expect(artifact).rejects.toBe(abortReason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries replay-safe artifact fetch transport failures once", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new TypeError("fetch failed");
      }

      return new Response("artifact-bytes", {
        headers: {
          "content-type": "application/octet-stream",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.artifactStore.get("b".repeat(64), {
      purpose: "workspace_artifact_materialization",
    });

    expect(new TextDecoder().decode(result ?? new Uint8Array())).toBe("artifact-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = requireFetchRequest(fetchMock.mock.calls[0], "first artifact read");
    const secondRequest = requireFetchRequest(fetchMock.mock.calls[1], "retried artifact read");
    expect(firstRequest.headers.get(HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_HEADER))
      .toBe("workspace_artifact_materialization");
    expect(secondRequest.headers.get(HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER))
      .toBe(firstRequest.headers.get(HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER));
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactFetchAttempt: 1,
          artifactFetchMaxAttempts: 2,
          fetchCauseKind: "fetch_failed",
          retrying: true,
        }),
        level: "warn",
        message: "Hosted runtime artifact fetch failed before response; retrying.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactByteLength: 14,
          artifactFetchAttempt: 2,
          artifactFetchMaxAttempts: 2,
        }),
        message: "Hosted runtime artifact fetch body read completed.",
      }),
    );
  });

  it("retries replay-safe artifact response body read failures once", async () => {
    const failedResponse = new Response("unused", {
      headers: {
        "content-type": "application/octet-stream",
      },
      status: 200,
    });
    vi.spyOn(failedResponse, "arrayBuffer").mockRejectedValueOnce(
      new TypeError("fetch failed"),
    );
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return failedResponse;
      }

      return new Response("artifact-bytes", {
        headers: {
          "content-type": "application/octet-stream",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.artifactStore.get("c".repeat(64), {
      purpose: "canonical_write_receipt",
    });

    expect(new TextDecoder().decode(result ?? new Uint8Array())).toBe("artifact-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactFetchAttempt: 1,
          artifactFetchMaxAttempts: 2,
          fetchCauseKind: "fetch_failed",
          retrying: true,
        }),
        level: "warn",
        message: "Hosted runtime artifact fetch body read failed; retrying.",
      }),
    );
  });

  it("does not retry artifact fetch failures that are not replay-safe transport errors", async () => {
    const cases: Array<{
      createResult(): Promise<Response>;
      expectedMessage: string | RegExp;
      label: string;
    }> = [
      {
        createResult: async () => new Response("unavailable", { status: 503 }),
        expectedMessage: /Hosted artifact fetch failed with HTTP 503/u,
        label: "http_status",
      },
      {
        createResult: async () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        },
        expectedMessage: "Hosted artifact fetch request failed.",
        label: "abort",
      },
      {
        createResult: async () => {
          const error = new Error("timed out");
          error.name = "TimeoutError";
          throw error;
        },
        expectedMessage: "Hosted artifact fetch request failed.",
        label: "timeout",
      },
      {
        createResult: async () => {
          throw new HostedRuntimeInternalAuthorityRejectedError({
            description: "Hosted artifact fetch",
            status: 401,
          });
        },
        expectedMessage: "Hosted invocation is stale",
        label: "stale_authority",
      },
    ];

    for (const testCase of cases) {
      vi.clearAllMocks();
      const fetchMock = vi.fn(testCase.createResult);
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
      });

      await expect(platform.artifactStore.get("d".repeat(64), {
        purpose: "workspace_restore",
      }))
        .rejects.toThrow(testCase.expectedMessage);
      expect(fetchMock, testCase.label).toHaveBeenCalledTimes(1);
      const serializedLogs = JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls);
      expect(serializedLogs).not.toContain('"retrying":true');
      if (testCase.label !== "http_status") {
        expect(serializedLogs).toContain('"retrying":false');
      }
    }
  });

  it("logs non-OK control-plane responses with response metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 503,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    })).rejects.toThrow(/Hosted device-sync runtime snapshot failed with HTTP 503/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          description: "Hosted device-sync runtime snapshot",
          method: "POST",
          path: "/api/internal/device-sync/runtime/snapshot",
          responseOrigin: "https://web.example.test",
          responseStatus: 503,
          transport: "direct",
          userId: "member_123",
        },
        level: "warn",
        message: "Hosted runtime control-plane response returned non-OK.",
        phase: "outbox",
        userId: "member_123",
      }),
    );
  });

  it("preserves structured non-retryable web-control errors without raw JSON in the message", async () => {
    const requestId = `aask_req_${"a".repeat(64)}`;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
        message: "Recent recipient reply required before iMessage delivery.",
        retryable: false,
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        [HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER]: requestId,
      },
      status: 403,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test",
    });

    try {
      await platform.workspacePort!.read!();
      throw new Error("Expected web-control read to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(HostedWebControlPlaneResponseError);
      expect(error).toMatchObject({
        code: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
        context: {
          requestId,
          retryable: false,
          status: 403,
          statusCode: 403,
        },
        retryable: false,
        requestId,
        status: 403,
        statusCode: 403,
      });
      expect(error instanceof Error ? error.message : String(error))
        .toContain("Recent recipient reply required before iMessage delivery.");
      expect(error instanceof Error ? error.message : String(error))
        .not.toContain("\"retryable\":false");
    }
  });

  it.each([
    [`aask_req_${"b".repeat(64)}`, "P2010", `aask_req_${"b".repeat(64)}`, "P2010"],
    ["aask_req_not-a-valid-correlation-id", "PRIVATE_CODE", undefined, "INTERNAL_ERROR"],
  ])(
    "bounds Assistant Ask diagnostics from web-control headers",
    async (requestIdHeader, diagnosticCodeHeader, expectedRequestId, expectedCode) => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal error.",
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER]: diagnosticCodeHeader,
          [HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER]: requestIdHeader,
        },
        status: 500,
      }));
      const platform = buildHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
        webCallbackSigning: {
          keyId: "v1",
          privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
        },
        webControlBaseUrl: "https://web.example.test",
      });

      try {
        await platform.workspacePort!.read!();
        throw new Error("Expected web-control read to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(HostedWebControlPlaneResponseError);
        expect(error).toMatchObject({
          code: expectedCode,
          requestId: expectedRequestId,
          status: 500,
          statusCode: 500,
        });
        if (expectedRequestId === undefined) {
          expect(
            error instanceof HostedWebControlPlaneResponseError
              ? error.context
              : {},
          ).not.toHaveProperty("requestId");
        }
      }
    },
  );

  it("stops buffering sensitive chunked web-control responses at the byte limit", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("12345"));
        controller.enqueue(encoder.encode("private-clinical-detail"));
        controller.close();
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));

    await expect(fetchDirectHostedWorkspaceReadWithHeaders({
      fetchImpl: fetchMock as typeof fetch,
      headers: new Headers(),
      sensitiveResponseBody: { maxBytes: 8 },
    })).rejects.toThrow("response exceeded the 8 byte safety limit");

    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls))
      .not.toContain("private-clinical-detail");
  });

  it("omits sensitive web-control error detail from errors and logs", async () => {
    const sensitiveDetail = "Patient diagnosis should never enter diagnostics.";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "provider_error",
        message: sensitiveDetail,
        retryable: false,
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 403,
    }));

    try {
      await fetchDirectHostedWorkspaceReadWithHeaders({
        fetchImpl: fetchMock as typeof fetch,
        headers: new Headers(),
        sensitiveResponseBody: { maxBytes: 1_024 },
      });
      throw new Error("Expected sensitive web-control read to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(HostedWebControlPlaneResponseError);
      expect(error).toMatchObject({
        code: undefined,
        retryable: undefined,
        status: 403,
      });
      expect(error instanceof Error ? error.message : String(error))
        .toBe("Hosted workspace read failed with HTTP 403.");
    }

    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls))
      .not.toContain(sensitiveDetail);
  });

  it("logs direct control-plane fetch failures with raw redacted error detail", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network failure with hidden request detail");
    });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(platform.workspacePort!.read!()).rejects.toThrow(
      "Hosted workspace read request failed.",
    );

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.control-plane",
        details: expect.objectContaining({
          bodyBytes: 0,
          bodyPresent: false,
          description: "Hosted workspace read",
          errorCode: "type_error",
          errorMessagePresent: true,
          errorName: "Error",
          fetchCauseCode: "type_error",
          fetchCauseKind: "network",
          fetchCauseName: "TypeError",
          method: "GET",
          path: "/api/internal/hosted-workspace",
          responseOrigin: "https://web.example.test",
          timeoutMs: expect.any(Number),
          transport: "direct",
        }),
        level: "warn",
        message: "Hosted runtime control-plane request failed before response.",
        phase: "runtime.starting",
        userId: "member_123",
      }),
    );
    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls))
      .toContain("hidden request detail");
  });

  it("marks caller-aborted direct control-plane failures in diagnostics", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      await delayWithAbort(1_000, request.signal);
      return new Response(JSON.stringify({
        connections: [],
        generatedAt: "2026-04-07T00:00:00.000Z",
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const abortController = new AbortController();
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test",
    });
    abortController.abort(new DOMException("caller cancelled", "AbortError"));

    await expect(platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
      signal: abortController.signal,
    })).rejects.toThrow("Hosted device-sync runtime snapshot request failed.");

    const failureLog = readHostedExecutionStructuredLogs().find((log) =>
      log.message === "Hosted runtime control-plane request failed before response."
      && log.details?.description === "Hosted device-sync runtime snapshot");
    expect(failureLog?.details).toMatchObject({
      description: "Hosted device-sync runtime snapshot",
      fetchCallerSignalAborted: true,
      fetchCauseKind: "abort",
      fetchRequestSignalAborted: true,
      fetchTimeoutSignalAborted: false,
      method: "POST",
      path: "/api/internal/device-sync/runtime/snapshot",
      responseOrigin: "https://web.example.test",
      transport: "direct",
    });
  });

  it("logs invalid control-plane JSON without response body text", async () => {
    const fetchMock = vi.fn(async () => new Response("hidden response body", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(platform.workspacePort!.read!()).rejects.toThrow(
      "Hosted workspace read returned invalid JSON.",
    );

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.control-plane",
        details: expect.objectContaining({
          description: "Hosted workspace read",
          errorCode: "syntax_error",
          errorMessagePresent: true,
          errorName: "SyntaxError",
          method: "GET",
          path: "/api/internal/hosted-workspace",
          responseBodyBytes: expect.any(Number),
          responseOrigin: "https://web.example.test",
          responseStatus: 200,
          transport: "direct",
        }),
        level: "warn",
        message: "Hosted runtime control-plane response returned invalid JSON.",
        phase: "runtime.starting",
        userId: "member_123",
      }),
    );
    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls))
      .not.toContain("hidden response body");
  });

  it("accepts missing workspace browser-vault publish responses as stale work", async () => {
    const sourceBundleHash = "b".repeat(64);
    const replicaRef = createBrowserVaultReplicaRef(sourceBundleHash);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      published: false,
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 404,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    const result = await platform.browserVaultReplicaPort!.publishRef!({
      replicaRef,
    });

    expect(result).toEqual({
      published: false,
      workspace: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "browser-vault publish");
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runtime control-plane response returned non-OK.",
      }),
    );
  });

  it("accepts conflicted workspace browser-vault publish responses as stale work", async () => {
    const sourceBundleHash = "b".repeat(64);
    const replicaRef = createBrowserVaultReplicaRef(sourceBundleHash);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      published: false,
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 409,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    const result = await platform.browserVaultReplicaPort!.publishRef!({
      replicaRef,
    });

    expect(result).toEqual({
      published: false,
      workspace: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runtime control-plane response returned non-OK.",
      }),
    );
  });

  it("logs non-OK internal upstream responses with response metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("artifact missing", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 500,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow("Hosted raw email read failed with HTTP 500.");

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: expect.objectContaining({
          description: "Hosted raw email read",
          responseStatus: 500,
        }),
        level: "warn",
        message: "Hosted runtime upstream response returned non-OK.",
        phase: "outbox",
        userId: null,
      }),
    );
  });

  it("does not classify external provider 401 responses as stale invocation authority", async () => {
    const fetchMock = vi.fn(async () => new Response("bad provider key", {
      status: 401,
    }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-123",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    const response = await hostedFetch("https://api.openai.com/v1/responses");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "external provider fetch");
    expect(request.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(request.headers.get(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(
      "provider-egress-token-123",
    );
  });

  it("calls ambient Worker fetch with the global receiver across hosted fetch boundaries", async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(function (
      this: unknown,
      input: RequestInfo | URL,
      _init?: RequestInit,
    ) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      seenUrls.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
    });

    await expect(platform.providerFetch!("https://api.openai.com/v1/responses"))
      .resolves.toHaveProperty("status", 204);
    await expect(platform.publicInternetFetch!("https://public.example.test/file.pdf"))
      .resolves.toHaveProperty("status", 204);
    await expect(fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: "https://web-control.example.test",
      boundUserId: "member_123",
      method: "GET",
      path: "/api/internal/runtime",
      timeoutMs: null,
    })).resolves.toHaveProperty("status", 204);
    await expect(platform.effectsPort.readRawEmailMessage("raw_receiver_guard"))
      .resolves.toEqual(new Uint8Array());

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(seenUrls).toEqual([
      "https://api.openai.com/v1/responses",
      "https://public.example.test/file.pdf",
      "https://web-control.example.test/api/internal/runtime",
      "http://results.worker/messages/raw_receiver_guard",
    ]);
  });

  it("logs external provider transport failures with redacted underlying error text", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(
        "provider fetch failed for https://api.linqapp.com/v1/messages"
          + "?token=secret-token and user member_123",
      );
    });
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-456",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    await expect(hostedFetch("https://api.linqapp.com/v1/messages")).rejects.toThrow(
      "provider fetch failed",
    );

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: expect.objectContaining({
          host: "api.linqapp.com",
          method: "GET",
          operation: "provider_fetch",
          safeErrorText:
            "provider fetch failed for <redacted-url> and user <redacted-user-id>",
        }),
        level: "warn",
        message: "Hosted provider fetch failed before response.",
        phase: "outbox",
      }),
    );
    const serializedLogs = JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls);
    expect(serializedLogs).not.toContain("secret-token");
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain("/v1/messages");

    const providerFailureLog = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) =>
        input?.message === "Hosted provider fetch failed before response.");
    if (!providerFailureLog) {
      throw new Error("Expected provider fetch failure log.");
    }
    const productionRecord =
      buildHostedExecutionStructuredLogRecord(providerFailureLog);
    const serializedRecord = JSON.stringify(productionRecord);
    expect(serializedRecord).toContain(
      "provider fetch failed for <redacted-url> and user <redacted-user-id>",
    );
    expect(serializedRecord).not.toContain("secret-token");
    expect(serializedRecord).not.toContain("member_123");
    expect(serializedRecord).not.toContain("/v1/messages");
  });

  it("preserves Request init overrides and bound-user provider identity", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-456",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );
    const abortController = new AbortController();
    const original = new Request("https://api.openai.com/v1/responses", {
      body: "a",
      method: "POST",
    });

    await hostedFetch(original, {
      body: "b",
      headers: {
        [HOSTED_PROVIDER_EGRESS_TOKEN_HEADER]: "stale-provider-egress-token",
        "x-hosted-runtime-attempt-id": "runtime_write_stale",
        "x-hosted-runtime-lease-generation": "99",
        "x-hosted-runtime-workspace-version": "99",
        [HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER]: "proxy_token",
        "x-test": "1",
      },
      method: "PUT",
      signal: abortController.signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const forwarded = requireFetchRequest(fetchMock.mock.calls[0], "external passthrough fetch");
    expect(forwarded.headers.get("x-test")).toBe("1");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwarded.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(forwarded.headers.get(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(
      "provider-egress-token-456",
    );
    expect(forwarded.headers.has(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER)).toBe(false);
    expect(forwarded.method).toBe("PUT");
    expect(await forwarded.text()).toBe("b");

    expect(forwarded.signal.aborted).toBe(false);
    abortController.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });

  it("rejects external provider fetches to hosts outside the intercepted provider boundary", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-local",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    await expect(hostedFetch("https://example.test/")).rejects.toThrow(
      "Hosted provider request for example.test is not routed through the hosted provider egress boundary.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes configured local provider base URLs with bound-user identity", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        providerFetchBaseUrls: ["http://host.docker.internal:4011/api/partner/v3"],
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-local",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    const response = await hostedFetch("http://host.docker.internal:4011/api/partner/v3/chats", {
      body: "{}",
      method: "POST",
    });

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "configured provider fetch");
    expect(request.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(request.headers.get(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(
      "provider-egress-token-local",
    );
  });

  it("rejects configured local provider fetches outside the configured base path", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        providerFetchBaseUrls: ["http://host.docker.internal:4011/api/partner/v3"],
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    await expect(hostedFetch("http://host.docker.internal:4011/api/partner/v30/chats"))
      .rejects
      .toThrow(
        "Hosted provider request for host.docker.internal is not routed through the hosted provider egress boundary.",
      );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads configured provider fetch base URLs from safe runner env keys", () => {
    expect(readCloudflareHostedProviderFetchBaseUrls({
      LINQ_API_BASE_URL: "http://host.docker.internal:4011/",
      TELEGRAM_API_BASE_URL: "http://telegram.example.com/bot",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example/",
      // xAI is pinned to api.x.ai and must not join the configurable provider
      // base-URL allowlist, even when a stale environment value is present.
      XAI_API_BASE_URL: "http://host.docker.internal:4014/",
    })).toEqual([
      "http://host.docker.internal:4011/",
      "https://files.telegram.example/",
    ]);
  });

  it("allows hosted xAI provider fetches through the intercepted provider boundary", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-local",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    const response = await hostedFetch("https://api.x.ai/v1/responses", {
      body: "{}",
      method: "POST",
    });

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "xai provider fetch");
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
  });

  it("allows configured hosted-local provider fetch URLs through the runner host alias", async () => {
    const providerFetchBaseUrlSource = {
      HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "172.17.0.1",
      LINQ_API_BASE_URL: "http://172.17.0.1:4011/api/partner/v3",
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
      TELEGRAM_API_BASE_URL: "http://172.17.0.1:4012/",
      TELEGRAM_FILE_BASE_URL: "http://172.17.0.1:4013/file",
    };
    const providerFetchBaseUrls = readCloudflareHostedProviderFetchBaseUrls(
      providerFetchBaseUrlSource,
    );
    expect(providerFetchBaseUrls).toEqual([
      "http://172.17.0.1:4011/api/partner/v3",
      "http://172.17.0.1:4012/",
      "http://172.17.0.1:4013/file",
    ]);

    expect(readCloudflareHostedProviderFetchBaseUrls({
      LINQ_API_BASE_URL: "http://172.17.0.1:4011/api/partner/v3",
      TELEGRAM_API_BASE_URL: "http://172.17.0.1:4012/",
    })).toEqual([]);

    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        providerFetchBaseUrlSource,
        providerFetchBaseUrls,
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-local",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    const response = await hostedFetch(
      "http://172.17.0.1:4012/bot__cloudflare_injected__/sendMessage",
      {
        body: "{}",
        method: "POST",
      },
    );

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "configured hosted-local provider fetch",
    );
    expect(request.url).toBe("http://172.17.0.1:4012/bot__cloudflare_injected__/sendMessage");
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(request.headers.get(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(
      "provider-egress-token-local",
    );

    const rejectedFetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const rejectedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      rejectedFetchMock as typeof fetch,
      {
        providerFetchBaseUrls: ["http://172.17.0.1:4012/"],
      },
    );
    await expect(rejectedFetch(
      "http://172.17.0.1:4012/bot__cloudflare_injected__/sendMessage",
      {
        body: "{}",
        method: "POST",
      },
    )).rejects.toThrow(
      "Hosted provider request for 172.17.0.1 is not routed through the hosted provider egress boundary.",
    );
    expect(rejectedFetchMock).not.toHaveBeenCalled();
  });

  it("keeps hosted-local Linq URL rewrite and provider fetch allowlist in sync", async () => {
    const runnerEnv = buildHostedRunnerContainerEnv({
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq",
      HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
      LINQ_API_BASE_URL: "http://127.0.0.1:4011/api/partner/v3",
    });

    expect(runnerEnv.LINQ_API_BASE_URL).toBe(
      "http://host.docker.internal:4011/api/partner/v3",
    );
    const providerFetchBaseUrls = readCloudflareHostedProviderFetchBaseUrls(runnerEnv);
    expect(providerFetchBaseUrls).toEqual([
      "http://host.docker.internal:4011/api/partner/v3",
    ]);

    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        providerFetchBaseUrls,
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-linq-local",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    const response = await hostedFetch("http://host.docker.internal:4011/api/partner/v3/chats", {
      body: "{}",
      method: "POST",
    });

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "configured Linq provider fetch");
    expect(request.url).toBe("http://host.docker.internal:4011/api/partner/v3/chats");
    expect(request.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(request.headers.get(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(
      "provider-egress-token-linq-local",
    );
  });

  it("does not require external provider fetches to carry a runtime write-fence lease", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => null,
      },
    );

    const response = await hostedFetch("https://api.openai.com/v1/responses");

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "external provider fetch");
    expect(request.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(request.headers.has(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(false);
  });

  it("passes platform providerFetch without exact write-fence headers", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          providerEgressToken: "provider-egress-token-platform",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    });

    await platform.providerFetch!("https://api.telegram.org/bot/sendMessage", {
      body: "{}",
      method: "POST",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "platform provider fetch");
    expect(request.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(request.headers.get(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(
      "provider-egress-token-platform",
    );
  });

  it("keeps public Internet fetches free of runtime authority headers", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    });

    const authorityBearingRequest = new Request("https://cdn.linqapp.com/files/direct.png", {
      headers: {
        [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
        [HOSTED_PROVIDER_EGRESS_TOKEN_HEADER]: "provider-egress-token-public",
        [HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER]: "proxy_token",
        "x-hosted-runtime-attempt-id": "runtime_write_123",
        "x-hosted-runtime-lease-generation": "7",
        "x-hosted-runtime-workspace-version": "6",
        "x-test": "retained",
      },
    });

    await platform.publicInternetFetch!(authorityBearingRequest);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "platform public fetch");
    expect(request.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(request.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(request.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
    expect(request.headers.has(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(false);
    expect(request.headers.has(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER)).toBe(false);
    expect(request.headers.get("x-test")).toBe("retained");
  });

  it("classifies internal authority 401 responses as stale invocation authority", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: "Unauthorized",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 401,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    let rejectedError: unknown;
    try {
      await platform.effectsPort.readRawEmailMessage("raw_123");
    } catch (error) {
      rejectedError = error;
    }

    expect(isHostedRuntimeInternalAuthorityRejectedError(rejectedError)).toBe(true);
    expect(rejectedError).toMatchObject({
      code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY",
      name: "HostedRuntimeInternalAuthorityRejectedError",
      reason: "internal_authority_rejected",
      status: 401,
      statusCode: 401,
    });
    expect(rejectedError).toBeInstanceOf(Error);
    expect((rejectedError as Error).message).toContain(
      "Hosted raw email read failed with HTTP 401.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces internal control-plane 403 response codes without stale authority labeling", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
        message: "Recipient must reply before another outbound message.",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 403,
    }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        providerFetchBaseUrls: [],
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    );

    let rejectedError: unknown;
    try {
      await hostedFetch(`http://web-control.worker${HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH}`, {
        body: "{}",
        method: "POST",
      });
    } catch (error) {
      rejectedError = error;
    }

    expect(isHostedRuntimeInternalAuthorityRejectedError(rejectedError)).toBe(false);
    expect(rejectedError).toMatchObject({
      code: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
      name: "HostedRuntimeControlPlaneRejectedError",
      reason: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
      responseStatus: 403,
      status: 403,
      statusCode: 403,
    });
    expect(rejectedError).toBeInstanceOf(Error);
    expect((rejectedError as Error).message).toContain(
      "Recipient must reply before another outbound message.",
    );
    expect((rejectedError as Error).message).not.toContain("Hosted invocation is stale");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes raw email reads through the Cloudflare internal effects port with the active runtime fence", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await platform.effectsPort.readRawEmailMessage("raw/message#1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "effects port fetch");
    expect(request.url).toBe("http://results.worker/messages/raw%2Fmessage%231");
    expect(request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe("attempt_1");
    expect(request.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe("9");
    expect(request.headers.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)).toBe("4");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.method).toBe("GET");
  });

  it("preserves Request init overrides for internal virtual-host fetches", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );
    const abortController = new AbortController();
    const original = new Request("https://results.worker/messages/raw", {
      body: "a",
      method: "POST",
    });

    await hostedFetch(original, {
      body: "b",
      headers: { "x-test": "1" },
      method: "PUT",
      signal: abortController.signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const forwarded = requireFetchRequest(fetchMock.mock.calls[0], "internal fetch");
    expect(forwarded.url).toBe("https://results.worker/messages/raw");
    expect(forwarded.headers.get("x-test")).toBe("1");
    expect(forwarded.method).toBe("PUT");
    expect(await forwarded.text()).toBe("b");

    expect(forwarded.signal.aborted).toBe(false);
    abortController.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });

  it("routes internal runtime requests through virtual hosts with write-fence headers", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      proxyBoundUserIdHeader: true,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    });

    await platform.effectsPort.readRawEmailMessage("raw/message#1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "internal effects port fetch");
    expect(request.url).toBe(
      "http://results.worker/messages/raw%2Fmessage%231",
    );
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("runtime_write_123");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("6");
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.method).toBe("GET");
  });

  it("attaches web-control ports and routes them through internal virtual hosts", async () => {
    const fetchMock = vi.fn(async (requestInput: RequestInfo | URL) => {
      const request = requestInput instanceof Request ? requestInput : new Request(requestInput);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/api/internal/hosted-mailbox/fetch")) {
        return new Response(JSON.stringify({
          fetchedAt: "2026-04-26T00:00:02.000Z",
          items: [],
          maxSeqByLane: [],
          userId: "member_123",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-workspace")) {
        return new Response(JSON.stringify({
          fetchedAt: "2026-04-26T00:00:02.000Z",
          workspace: {
            checkpointedAt: "2026-04-26T00:00:00.000Z",
            createdAt: "2026-04-26T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: null,
            updatedAt: "2026-04-26T00:00:02.000Z",
            userId: "member_123",
            version: "6",
          },
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-runtime/log")) {
        return new Response(JSON.stringify({
          loggedCount: 1,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-runtime/latency")) {
        return new Response(JSON.stringify({
          matchedCount: 1,
          recorded: true,
          unmatchedCount: 0,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith(HOSTED_RUNTIME_CODEX_AUTH_PATH)) {
        return new Response(JSON.stringify({
          applied: true,
          status: "applied",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-execution/issues/record")) {
        return new Response(JSON.stringify({
          issueIds: ["issue_123"],
          recorded: 1,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-execution/usage/record")) {
        return new Response(JSON.stringify({
          recorded: true,
          usageId: "turn_usage.runtime_write_123",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-execution/product-feedback/record")) {
        return new Response(JSON.stringify({
          feedbackId: "product_feedback_123",
          recorded: true,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith(HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH)) {
        const body = await request.clone().json() as { action?: unknown };
        if (body.action === HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION) {
          return new Response(JSON.stringify({
            action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
            result: {
              outcomes: {
                detail: "unchanged",
                humor: "saved",
              },
              settings: {
                detail: { source: "default", value: 5 },
                humor: { source: "custom", value: 8 },
                push: { source: "default", value: 3 },
                unhinged: { source: "default", value: 0 },
              },
            },
          }), {
            headers: { "content-type": "application/json; charset=utf-8" },
            status: 200,
          });
        }
        return new Response(JSON.stringify({
          action: "read",
          result: {
            mainPersona: "classic",
            model: "gpt-5.6-terra",
            solAvailable: false,
            supportingPersona: null,
            tone: "formal",
            voice: "warm",
          },
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith(HOSTED_RUNTIME_GROUP_TOOL_PATH)) {
        return new Response(JSON.stringify({
          action: "read_current",
          result: { group: null, status: "none" },
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith(HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH)) {
        const projectionMode = url.searchParams.get(
          HOSTED_VAULT_SHARE_PROJECTION_MODE_PARAM,
        );
        return new Response(JSON.stringify({
          projectionKinds: ["activity-days.v0"],
          ...(projectionMode === HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE
            ? { projectionMode }
            : {}),
          projectionScopes: [{ projectionKind: "activity-days.v0" }],
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/device-sync/runtime/snapshot")) {
        return new Response(JSON.stringify({
          connections: [],
          generatedAt: "2026-04-26T00:00:02.000Z",
          userId: "member_123",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      throw new Error(`Unexpected callback URL: ${request.url}`);
    });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    });

    expect(platform.mailboxPort).toBeDefined();
    expect(platform.workspacePort).toBeDefined();
    expect(platform.logPort).toBeDefined();
    expect(platform.latencyTracePort).toBeDefined();
    expect(platform.codexAuthPort).toBeDefined();
    expect(platform.issueExportPort).toBeDefined();
    expect(platform.usageRecordPort).toBeDefined();
    expect(platform.productFeedbackPort).toBeDefined();
    expect(platform.assistantAskPort).toBeDefined();
    expect(platform.assistantPersonalizationToolPort).toBeDefined();
    expect(platform.groupToolPort).toBeDefined();
    expect(platform.vaultSharePort).toBeDefined();
    expect(platform.deviceSyncPort).toBeDefined();
    await platform.mailboxPort!.fetch({
      lanes: [{ importedSeq: "0", lane: "conversation" }],
      limitPerLane: 10,
      requestId: "request_mailbox_1",
    });
    await platform.workspacePort!.read!();
    await platform.logPort!.write({
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          attemptId: "runtime_write_123",
          component: "mailbox",
          eventCode: "mailbox.imported",
          leaseGeneration: "7",
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: "1",
          mailboxSeqStart: "1",
          phase: "import",
          redactedJson: { importedCount: 1 },
          workspaceVersion: "6",
        },
      ],
    });
    await platform.latencyTracePort!.record({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:03.000Z",
        mailboxItemId: "mailbox_item_1",
        runtimeAttemptId: "runtime_write_123",
        source: "linq",
        type: "assistant_input_staged",
      },
    });
    await platform.codexAuthPort!.update({
      attemptId: "hca_abcdefghijklmnop",
      phase: "connected",
    });
    await platform.issueExportPort!.recordIssues([{ code: "runtime.issue" }]);
    await platform.usageRecordPort!.recordUsage(createAssistantUsageRecord());
    await platform.productFeedbackPort!.recordProductFeedback({
      idempotencyKey: "a".repeat(64),
      kind: "feature_interest",
      relatedChangelogItemIds: ["native-message-formatting"],
      summary: "Interested in native message formatting.",
    });
    await expect(platform.assistantPersonalizationToolPort!.request({ action: "read" }))
      .resolves.toEqual({
        action: "read",
        result: {
          mainPersona: "classic",
          model: "gpt-5.6-terra",
          solAvailable: false,
          supportingPersona: null,
          tone: "formal",
          voice: "warm",
        },
      });
    await expect(platform.assistantPersonalizationToolPort!.request(
      { action: "read" },
      { assistantInputId: "ain_0123456789abcdef0123456789abcdef" },
    )).resolves.toMatchObject({ action: "read" });
    await expect(platform.assistantPersonalizationToolPort!.request(
      {
        action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
        personality: {
          detail: null,
          humor: 8,
        },
      },
      { assistantInputId: "ain_0123456789abcdef0123456789abcdef" },
    )).resolves.toEqual({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      result: {
        outcomes: {
          detail: "unchanged",
          humor: "saved",
        },
        settings: {
          detail: { source: "default", value: 5 },
          humor: { source: "custom", value: 8 },
          push: { source: "default", value: 3 },
          unhinged: { source: "default", value: 0 },
        },
      },
    });
    await expect(platform.groupToolPort!.request({ action: "read_current" }))
      .resolves.toEqual({
        action: "read_current",
        result: { group: null, status: "none" },
      });
    await expect(platform.vaultSharePort!.listActiveProjectionScopes()).resolves.toEqual({
      hasDeferredProjectionWork: false,
      projectionKinds: ["activity-days.v0"],
      projectionScopes: [{ projectionKind: "activity-days.v0" }],
    });
    await expect(platform.vaultSharePort!.listActiveProjectionScopes({
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
    })).resolves.toEqual({
      hasDeferredProjectionWork: false,
      projectionKinds: ["activity-days.v0"],
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      projectionScopes: [{ projectionKind: "activity-days.v0" }],
    });
    await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(15);
    const requests = fetchMock.mock.calls.map((call, index) =>
      requireFetchRequest(call, `callback web-control request ${index}`)
    );
    expect(requests.map((request) => request.url)).toEqual([
      "http://web-control.worker/api/internal/hosted-mailbox/fetch",
      "http://web-control.worker/api/internal/hosted-workspace",
      "http://web-control.worker/api/internal/hosted-runtime/log",
      "http://web-control.worker/api/internal/hosted-runtime/latency",
      "http://web-control.worker/api/internal/hosted-runtime/codex-auth",
      "http://web-control.worker/api/internal/hosted-execution/issues/record",
      "http://web-control.worker/api/internal/hosted-execution/usage/record",
      "http://web-control.worker/api/internal/hosted-execution/product-feedback/record",
      `http://web-control.worker${HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH}`,
      `http://web-control.worker${HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH}?assistantInputId=ain_0123456789abcdef0123456789abcdef`,
      `http://web-control.worker${HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH}?assistantInputId=ain_0123456789abcdef0123456789abcdef`,
      `http://web-control.worker${buildExpectedGroupToolPath()}`,
      `http://web-control.worker${buildExpectedVaultShareActiveKindsPath()}`,
      `http://web-control.worker${buildExpectedVaultShareActiveKindsPath(HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE)}`,
      "http://web-control.worker/api/internal/device-sync/runtime/snapshot",
    ]);
    for (const request of requests) {
      expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("runtime_write_123");
      expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
      expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("6");
      expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    }
    await expect(requests[10]?.clone().json()).resolves.toEqual({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      personality: {
        detail: null,
        humor: 8,
      },
    });
  });

  it("rejects malformed personality update responses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      result: {
        outcomes: { humor: "saved" },
        settings: {
          humor: { source: "custom", value: 8 },
          push: { source: "default", value: 3 },
        },
      },
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "runtime_write_123",
          leaseGeneration: "7",
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    });

    await expect(platform.assistantPersonalizationToolPort!.request(
      {
        action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
        personality: { humor: 8 },
      },
      { assistantInputId: "ain_0123456789abcdef0123456789abcdef" },
    )).rejects.toThrow(
      "Hosted assistant personalization tool returned invalid JSON.",
    );

    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "personality update callback request",
    );
    expect(request.url).toBe(
      `http://web-control.worker${HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH}?assistantInputId=ain_0123456789abcdef0123456789abcdef`,
    );
    expectDefaultRuntimeWriteFenceHeaders(request);
  });

  it("attaches active lease headers to direct signed web-control callbacks", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/api/internal/hosted-runtime/log")) {
        return new Response(JSON.stringify({
          loggedCount: 1,
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/device-sync/runtime/snapshot")) {
        return new Response(JSON.stringify({
          connections: [],
          generatedAt: "2026-04-26T00:00:02.000Z",
          userId: "member_123",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (url.pathname.endsWith("/api/internal/hosted-execution/usage/record")) {
        return new Response(JSON.stringify({
          recorded: true,
          usageId: "turn_usage.runtime_write_123",
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      throw new Error(`Unexpected callback URL: ${request.url}`);
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await platform.logPort!.write({
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          attemptId: "runtime_write_123",
          component: "mailbox",
          eventCode: "mailbox.imported",
          leaseGeneration: "7",
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: "1",
          mailboxSeqStart: "1",
          phase: "import",
          redactedJson: { importedCount: 1 },
          workspaceVersion: "6",
        },
      ],
    });
    await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });
    await platform.usageRecordPort!.recordUsage(createAssistantUsageRecord());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requests = fetchMock.mock.calls.map((call, index) =>
      requireFetchRequest(call, `direct web-control request ${index}`)
    );
    expect(requests.map((request) => request.url)).toEqual([
      "https://web.example.test/api/internal/hosted-runtime/log",
      "https://web.example.test/api/internal/device-sync/runtime/snapshot",
      "https://web.example.test/api/internal/hosted-execution/usage/record",
    ]);
    for (const request of requests) {
      expectDefaultRuntimeWriteFenceHeaders(request);
      expect(request.headers.get("x-hosted-execution-user-id")).toBe("member_123");
      expect(request.headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
      expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    }
  });

  it("routes device reconcile through the signed web-control port", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(new URL(request.url).pathname).toBe("/api/internal/device-sync/reconcile");
      await expect(request.json()).resolves.toEqual({ connectionId: "conn_123" });
      return new Response(JSON.stringify({
        connectionId: "conn_123",
        occurredAt: "2026-07-15T12:00:00.000Z",
        status: "queued",
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(platform.deviceSyncPort!.reconcileAccount!({
      connectionId: "conn_123",
    })).resolves.toEqual({
      connectionId: "conn_123",
      occurredAt: "2026-07-15T12:00:00.000Z",
      status: "queued",
    });

    const request = requireFetchRequest(fetchMock.mock.calls[0], "device reconcile request");
    expectDefaultRuntimeWriteFenceHeaders(request);
    expect(request.headers.get("x-hosted-execution-user-id")).toBe("member_123");
  });

  it("write-fences exact external thread route authority through direct web-control", async () => {
    const authority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(new URL(request.url).pathname).toBe(
        HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
      );
      await expect(request.json()).resolves.toEqual(authority);
      return new Response(JSON.stringify({ authorized: true }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const assertExternalThreadRouteAuthority =
      platform.effectsPort.assertExternalThreadRouteAuthority;
    if (!assertExternalThreadRouteAuthority) {
      throw new Error("Expected external thread route authority effect.");
    }
    await expect(
      assertExternalThreadRouteAuthority(authority),
    ).resolves.toBeUndefined();

    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "direct external thread route authority request",
    );
    expect(request.url).toBe(
      `https://web.example.test${HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH}`,
    );
    expectDefaultRuntimeWriteFenceHeaders(request);
    expect(request.headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(request.headers.get("x-hosted-execution-signature"))
      .toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("binds private Assistant Ask completion proof to its exact authorized direct route", async () => {
    const privateCompletionRequest = {
      answeredMailboxItemIds: ["aask_done_private_provider_entry"],
      assistantAskCompletionExpiresAt: "2026-08-09T18:00:00.000Z",
      idempotencyKey:
        "assistant-ask-private:aask_done_private_provider_entry",
      responseTextDigest:
        "01e93e1ac156d325ccf1df0f18518b899140ae48588be6a01876aa20ece0cadd",
      route: {
        actorId: null,
        channel: "telegram" as const,
        delivery: {
          kind: "thread" as const,
          target: "telegram_direct_456",
        },
        identityId: `hid_${"1".repeat(32)}`,
        threadId: `hid_${"2".repeat(32)}`,
        threadIsDirect: true,
      },
    };
    let authorized = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(new URL(request.url).pathname).toBe(
        HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
      );
      await expect(request.json()).resolves.toEqual({
        authority: privateCompletionRequest.route,
        privateAssistantAskCompletion: {
          answeredMailboxItemIds: privateCompletionRequest.answeredMailboxItemIds,
          expiresAt: privateCompletionRequest.assistantAskCompletionExpiresAt,
          idempotencyKey: privateCompletionRequest.idempotencyKey,
          responseTextDigest: privateCompletionRequest.responseTextDigest,
        },
      });
      return new Response(JSON.stringify({ authorized }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });
    const assertAssistantAskPrivateCompletionAuthority =
      platform.effectsPort.assertAssistantAskPrivateCompletionAuthority;
    if (!assertAssistantAskPrivateCompletionAuthority) {
      throw new Error("Expected private Assistant Ask completion authority effect.");
    }

    await expect(
      assertAssistantAskPrivateCompletionAuthority(privateCompletionRequest),
    ).resolves.toBeUndefined();

    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "private Assistant Ask completion authority request",
    );
    expect(request.url).toBe(
      `https://web.example.test${HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH}`,
    );
    expectDefaultRuntimeWriteFenceHeaders(request);
    expect(request.headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(request.headers.get("x-hosted-execution-signature"))
      .toMatch(/^[A-Za-z0-9\-_]+$/u);

    authorized = false;
    await expect(
      assertAssistantAskPrivateCompletionAuthority(privateCompletionRequest),
    ).rejects.toThrow(
      "Hosted Assistant Ask private completion authority response is invalid.",
    );
  });

  it("carries reviewed Assistant Ask proof through external route authority", async () => {
    const authority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const assistantAskCompletion = {
      answeredMailboxItemIds: ["aask_done_telegram_provider_entry"],
      assistantAskCompletionExpiresAt: "2026-07-27T18:00:00.000Z",
      assistantAskFallback: false,
      idempotencyKey:
        "assistant-ask-reviewed-completion:aask_done_telegram_provider_entry",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      await expect(request.json()).resolves.toEqual({
        assistantAskCompletion,
        authority,
      });
      return new Response(JSON.stringify({
        assistantAskFallbackRequired: true,
        authorized: true,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });
    const assertExternalThreadRouteAuthority =
      platform.effectsPort.assertExternalThreadRouteAuthority;
    if (!assertExternalThreadRouteAuthority) {
      throw new Error("Expected external thread route authority effect.");
    }

    await expect(assertExternalThreadRouteAuthority(authority, {
      assistantAskCompletion,
    })).resolves.toEqual({ assistantAskFallbackRequired: true });
  });

  it("resolves the current verified-email recipient through direct web-control", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(new URL(request.url).pathname).toBe(
        HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH,
      );
      await expect(request.json()).resolves.toEqual({});
      return new Response(JSON.stringify({
        deliveryTarget: "current@example.test",
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(
      platform.effectsPort.resolveCurrentVerifiedEmailRecipient?.(),
    ).resolves.toBe("current@example.test");

    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "direct email recipient authority request",
    );
    expect(request.url).toBe(
      `https://web.example.test${HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH}`,
    );
    expectDefaultRuntimeWriteFenceHeaders(request);
    expect(request.headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(request.headers.get("x-hosted-execution-signature"))
      .toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("write-fences Linq egress authority assertions and preserves boolean fallback/directness", async () => {
    let responseCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(new URL(request.url).pathname).toBe(HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH);
      responseCount += 1;
      const body = await request.json() as {
        assistantAskCompletionExpiresAt?: unknown;
        assistantAskFallback?: unknown;
        authorityCheckOnly?: unknown;
      };
      expect(body.authorityCheckOnly).toBe(responseCount === 1 ? false : true);
      expect(body.assistantAskFallback).toBe(
        responseCount === 1 ? undefined : false,
      );
      expect(body.assistantAskCompletionExpiresAt).toBe(
        responseCount === 1 ? undefined : "2026-07-16T12:10:00.000Z",
      );
      return new Response(JSON.stringify({
        ...(body.assistantAskFallback === false
          ? { assistantAskFallbackRequired: true }
          : {}),
        ok: true,
        ...(body.authorityCheckOnly === false
          ? {
              deliveryPosture: "cautious",
              providerDispatchClaimed: true,
            }
          : {}),
        resolvedRoute: responseCount === 1
          ? {
              conversationThreadId: null,
              directRecipientPhoneNumber: null,
              fromPhoneNumber: "+15550002",
              target: "chat_123",
              targetKind: "thread",
              threadIsDirect: false,
            }
          : {
              conversationThreadId: "hid_current_chat",
              directRecipientPhoneNumber: "+15550001",
              fromPhoneNumber: "+15550002",
              target: "chat_current",
              targetKind: "thread",
              threadIsDirect: true,
            },
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const assertLinqRecentInboundEngagement =
      platform.effectsPort.assertLinqRecentInboundEngagement;
    if (!assertLinqRecentInboundEngagement) {
      throw new Error("Expected hosted Linq egress authority assertion effect.");
    }

    await expect(assertLinqRecentInboundEngagement({
      authorityCheckOnly: false,
      target: "chat_123",
      targetKind: "thread",
    })).resolves.toEqual({
      deliveryPosture: "cautious",
      providerDispatchClaimed: true,
      resolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: null,
        fromPhoneNumber: "+15550002",
        target: "chat_123",
        targetKind: "thread",
        threadIsDirect: false,
      },
    });
    await expect(assertLinqRecentInboundEngagement({
      assistantAskCompletionExpiresAt: "2026-07-16T12:10:00.000Z",
      assistantAskFallback: false,
      authorityCheckOnly: true,
      target: "chat_456",
      targetKind: "thread",
    })).resolves.toEqual({
      assistantAskFallbackRequired: true,
      resolvedRoute: {
        conversationThreadId: "hid_current_chat",
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        target: "chat_current",
        targetKind: "thread",
        threadIsDirect: true,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [index, call] of fetchMock.mock.calls.entries()) {
      const request = requireFetchRequest(call, `direct Linq egress authority request ${index}`);
      expect(request.url).toBe(`https://web.example.test${HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH}`);
      expectDefaultRuntimeWriteFenceHeaders(request);
      expect(request.headers.get("x-hosted-execution-user-id")).toBe("member_123");
      expect(request.headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
    }
  });

  it("does not synthesize a canonical Linq route from a legacy Web response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        targetOverride: {
          conversationThreadId: "hid_legacy_chat",
          target: "chat_legacy",
          targetKind: "thread",
        },
        threadIsDirect: true,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })
    );
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });
    const assertLinqRecentInboundEngagement =
      platform.effectsPort.assertLinqRecentInboundEngagement;
    if (!assertLinqRecentInboundEngagement) {
      throw new Error("Expected hosted Linq egress authority assertion effect.");
    }

    await expect(assertLinqRecentInboundEngagement({
      authorityCheckOnly: true,
      target: "chat_legacy",
      targetKind: "thread",
    })).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("strictly parses typed Linq health blocks from web-control", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        deliveryBlockCode: "chat_opted_out",
        deliveryPosture: "unknown-posture",
        ok: true,
        resolvedRoute: {
          conversationThreadId: null,
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: "+15550002",
          target: "chat_blocked",
          targetKind: "thread",
          threadIsDirect: true,
        },
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })
    );
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });
    const assertLinqRecentInboundEngagement =
      platform.effectsPort.assertLinqRecentInboundEngagement;
    if (!assertLinqRecentInboundEngagement) {
      throw new Error("Expected hosted Linq egress authority assertion effect.");
    }

    await expect(assertLinqRecentInboundEngagement({
      authorityCheckOnly: true,
      target: "chat_blocked",
      targetKind: "thread",
    })).resolves.toEqual({
      deliveryBlockCode: "chat_opted_out",
      resolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        target: "chat_blocked",
        targetKind: "thread",
        threadIsDirect: true,
      },
    });
  });

  it("write-fences Linq delivery outcomes through direct web-control", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(new URL(request.url).pathname).toBe(HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH);
      return new Response(JSON.stringify({ ok: true, recorded: true }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const recordLinqDeliveryOutcome = platform.effectsPort.recordLinqDeliveryOutcome;
    if (!recordLinqDeliveryOutcome) {
      throw new Error("Expected hosted Linq delivery outcome effect.");
    }

    await recordLinqDeliveryOutcome({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "direct Linq delivery request");
    expect(request.url).toBe(`https://web.example.test${HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH}`);
    expectDefaultRuntimeWriteFenceHeaders(request);
    expect(request.headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(request.headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
    await expect(request.clone().json()).resolves.toEqual(
      expect.objectContaining({
        acceptedAt: "2026-04-26T00:00:04.000Z",
        attemptedAt: "2026-04-26T00:00:03.000Z",
        idempotencyKey: "assistant-outbox:intent_123",
        providerMessageId: "linq_message_sent",
      }),
    );
  });

  it("fails closed before direct web-control fetches with incomplete write-fence headers", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const headers = new Headers({
      [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "runtime_write_123",
    });
    let thrown: unknown;

    try {
      await fetchDirectHostedWorkspaceReadWithHeaders({
        fetchImpl: fetchMock as typeof fetch,
        headers,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Hosted workspace read request failed.");
    expect((thrown as Error).cause).toBeInstanceOf(Error);
    expect(((thrown as Error).cause as Error).message).toBe(
      "Hosted workspace read has incomplete hosted runtime write-fence headers.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed before direct web-control fetches with stale write-fence headers", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const headers = new Headers({
      [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "runtime_write_stale",
      [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "7",
      [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "6",
    });
    let thrown: unknown;

    try {
      await fetchDirectHostedWorkspaceReadWithHeaders({
        fetchImpl: fetchMock as typeof fetch,
        headers,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Hosted workspace read request failed.");
    expect((thrown as Error).cause).toBeInstanceOf(Error);
    expect(((thrown as Error).cause as Error).message).toBe(
      "Hosted workspace read has stale hosted runtime write-fence headers.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps latency trace callbacks bound to their event attempt", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        matchedCount: 1,
        recorded: true,
        unmatchedCount: 0,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })
    );
    const readCurrentLease = vi.fn()
      .mockReturnValueOnce({
        attemptId: "attempt_1",
        leaseGeneration: "7",
        userId: "member_123",
        workspaceVersion: "6",
      })
      .mockReturnValueOnce({
        attemptId: "attempt_2",
        leaseGeneration: "8",
        userId: "member_123",
        workspaceVersion: "7",
      });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease,
      },
    });

    const response = await platform.latencyTracePort!.record({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:03.000Z",
        mailboxItemId: "mailbox_item_1",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_input_staged",
      },
    });

    expect(response).toEqual({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });
    expect(readCurrentLease).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "latency trace request");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-runtime/latency");
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("6");
  });

  it("skips stale latency trace callbacks without calling web-control", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        matchedCount: 1,
        recorded: true,
        unmatchedCount: 0,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })
    );
    const readCurrentLease = vi.fn(() => ({
      attemptId: "attempt_2",
      leaseGeneration: "8",
      userId: "member_123",
      workspaceVersion: "7",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease,
      },
    });

    const response = await platform.latencyTracePort!.record({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:03.000Z",
        mailboxItemId: "mailbox_item_1",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_input_staged",
      },
    });

    expect(response).toEqual({
      matchedCount: 0,
      recorded: false,
      unmatchedCount: 0,
    });
    expect(readCurrentLease).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips unbound latency trace callbacks without calling web-control", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        matchedCount: 1,
        recorded: true,
        unmatchedCount: 0,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })
    );
    const readCurrentLease = vi.fn(() => null);
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease,
      },
    });

    const missingAttemptResponse = await platform.latencyTracePort!.record({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:03.000Z",
        mailboxItemId: "mailbox_item_1",
        source: "linq",
        type: "assistant_input_staged",
      },
    });
    const inactiveLeaseResponse = await platform.latencyTracePort!.record({
      event: {
        assistantInputId: "input_2",
        at: "2026-04-26T00:00:04.000Z",
        mailboxItemId: "mailbox_item_2",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_input_staged",
      },
    });

    expect(missingAttemptResponse).toEqual({
      matchedCount: 0,
      recorded: false,
      unmatchedCount: 0,
    });
    expect(inactiveLeaseResponse).toEqual({
      matchedCount: 0,
      recorded: false,
      unmatchedCount: 0,
    });
    expect(readCurrentLease).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("overwrites caller-supplied web-control write-fence headers outside latency telemetry", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => ({
          attemptId: "attempt_current",
          leaseGeneration: "8",
          userId: "member_123",
          workspaceVersion: "7",
        }),
      },
    );

    await hostedFetch("http://web-control.worker/api/internal/hosted-runtime/log", {
      body: "{}",
      headers: {
        "x-hosted-runtime-attempt-id": "attempt_supplied",
        "x-hosted-runtime-lease-generation": "1",
        "x-hosted-runtime-workspace-version": "2",
      },
      method: "POST",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "web-control log request");
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_current");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("8");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("7");
  });

  it("fails closed before issuing internal-host requests when the invocation proxy token is missing", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow(
      "missing a runtime write-fence authority",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds device-sync runtime requests to the hosted member id at the signed web callback seam", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body: unknown = await request.json();

      expect(body).toEqual({
        connectionId: "conn_123",
        includeCredentialMaterial: true,
        userId: "member_123",
      });

      return new Response(JSON.stringify({
        connections: [],
        generatedAt: "2026-04-07T00:00:00.000Z",
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const snapshot = await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(snapshot.userId).toBe("member_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "device-sync fetch");
    expect(request.url).toBe("https://web.example.test/api/internal/device-sync/runtime/snapshot");
    const headers = request.headers;
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
    expect(headers.get("x-hosted-execution-nonce")).toMatch(/^[a-f0-9]{32}$/u);
    expect(headers.get("x-hosted-execution-timestamp")).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("forwards hosted device-sync snapshot cursors without owning pagination policy", async () => {
    const cursor = {
      createdAt: "2026-08-11T12:00:00.000Z",
      id: "conn_032",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      await expect(request.json()).resolves.toEqual({
        cursor,
        includeCredentialMaterial: true,
        limit: 32,
        userId: "member_123",
      });
      return new Response(JSON.stringify({
        connections: [],
        generatedAt: "2026-08-11T12:01:00.000Z",
        nextCursor: null,
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(platform.deviceSyncPort!.fetchSnapshot({
      cursor,
      includeCredentialMaterial: true,
      limit: 32,
    })).resolves.toMatchObject({ nextCursor: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records hosted usage through the signed web callback seam", async () => {
    const usageRecord = createAssistantUsageRecord();
    const noticeDeliveryTarget = {
      channel: "telegram" as const,
      replyToMessageId: "telegram_message_usage_1",
      target: "telegram_thread_usage_1",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      await expect(request.clone().json()).resolves.toEqual({
        noticeDeliveryTarget,
        usage: usageRecord,
      });

      return new Response(JSON.stringify({
        recorded: true,
        usageId: "turn_usage.attempt-1",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(
      platform.usageRecordPort!.recordUsage(usageRecord, noticeDeliveryTarget),
    ).resolves.toEqual({
      recorded: true,
      usageId: "turn_usage.attempt-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "usage fetch");
    expect(request.url).toBe("https://web.example.test/api/internal/hosted-execution/usage/record");
    expect(request.method).toBe("POST");
    const headers = request.headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("preserves omitted and explicit-null usage notice targets", async () => {
    const usageRecord = createAssistantUsageRecord();
    const requestBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requestBodies.push(await request.json());

      return new Response(JSON.stringify({
        recorded: true,
        usageId: usageRecord.usageId,
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await platform.usageRecordPort!.recordUsage(usageRecord);
    await platform.usageRecordPort!.recordUsage(usageRecord, null);

    expect(requestBodies).toEqual([
      { usage: usageRecord },
      { noticeDeliveryTarget: null, usage: usageRecord },
    ]);
  });

  it("wraps invalid hosted usage recording responses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      recorded: 2,
      usageId: "turn_usage.attempt-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(
      platform.usageRecordPort!.recordUsage(createAssistantUsageRecord()),
    ).rejects.toThrow("Hosted usage recording returned invalid JSON.");
  });

  it("fetches pending hosted device-sync dirty state through the signed web callback seam", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      await expect(request.clone().json()).resolves.toEqual({
        connectionId: "dsc_123",
        limit: 1,
        stagedDirtyAcks: [
          {
            connectionId: "dsc_123",
            processedDirtyPayloadIds: ["dsp_1"],
            processedRevision: "7",
          },
        ],
        userId: "member_123",
      });

      return new Response(JSON.stringify({
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const pending = await platform.deviceSyncPort!.fetchDirtyStates({
      connectionId: "dsc_123",
      limit: 1,
      stagedDirtyAcks: [
        {
          connectionId: "dsc_123",
          processedDirtyPayloadIds: ["dsp_1"],
          processedRevision: "7",
        },
      ],
    });

    expect(pending).toEqual({
      hasMore: false,
      items: [],
      nextWakeAt: null,
      userId: "member_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "device-sync dirty pending fetch",
    );
    expect(request.url).toBe("https://web.example.test/api/internal/device-sync/runtime/dirty-pending");
    expect(request.method).toBe("POST");
    await expect(request.text()).resolves.toBe(JSON.stringify({
      connectionId: "dsc_123",
      limit: 1,
      stagedDirtyAcks: [
        {
          connectionId: "dsc_123",
          processedDirtyPayloadIds: ["dsp_1"],
          processedRevision: "7",
        },
      ],
      userId: "member_123",
    }));
    const headers = request.headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("acks hosted device-sync dirty state with staged batch overlays through the signed web callback seam", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      await expect(request.clone().json()).resolves.toEqual({
        connectionId: "dsc_current",
        processedDirtyPayloadIds: ["dsp_current"],
        processedRevision: "21",
        stagedDirtyAcks: [
          {
            connectionId: "dsc_next",
            processedDirtyPayloadIds: ["dsp_next"],
            processedRevision: "22",
          },
        ],
        userId: "member_123",
      });

      return new Response(JSON.stringify({
        connectionId: "dsc_current",
        dirtyRevision: "21",
        nextWakeAt: null,
        processedRevision: "21",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const ack = await platform.deviceSyncPort!.ackDirtyStateProcessed({
      connectionId: "dsc_current",
      processedDirtyPayloadIds: ["dsp_current"],
      processedRevision: "21",
      stagedDirtyAcks: [
        {
          connectionId: "dsc_next",
          processedDirtyPayloadIds: ["dsp_next"],
          processedRevision: "22",
        },
      ],
    });

    expect(ack.recorded).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "device-sync dirty ack",
    );
    expect(request.url).toBe("https://web.example.test/api/internal/device-sync/runtime/dirty-ack");
    expect(request.method).toBe("POST");
    const headers = request.headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("forwards cancellation into hosted device-sync dirty acknowledgement", async () => {
    const requestStarted = createDeferred<void>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requestStarted.resolve();
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(
          request.signal.reason instanceof Error
            ? request.signal.reason
            : new DOMException("Synthetic dirty acknowledgement aborted.", "AbortError"),
        );
        if (request.signal.aborted) {
          abort();
          return;
        }
        request.signal.addEventListener("abort", abort, { once: true });
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });
    const abortController = new AbortController();
    const acknowledgement = platform.deviceSyncPort!.ackDirtyStateProcessed({
      connectionId: "dsc_abort",
      processedRevision: "22",
      signal: abortController.signal,
    });

    await requestStarted.promise;
    const abortReason = new Error("synthetic exact wake");
    abortController.abort(abortReason);

    await expect(acknowledgement).rejects.toMatchObject({
      hostedRuntimeFetchCallerSignalAborted: true,
      hostedRuntimeFetchCauseKind: "abort",
      hostedRuntimeFetchRequestSignalAborted: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forces hosted device-sync connect-link creation through the signed POST callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      authorizationUrl: "https://sync.example.test/oauth",
      expiresAt: "2026-04-07T00:00:00.000Z",
      provider: "oura",
      providerLabel: "Oura",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const connectLink = await platform.deviceSyncPort!.createConnectLink({
      connectTarget: "oura",
    });

    expect(connectLink.provider).toBe("oura");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "device-sync connect-link fetch",
    );
    expect(request.url).toBe("https://web.example.test/api/internal/device-sync/connect-targets/oura/connect-link");
    expect(request.method).toBe("POST");
    expect(request.body).toBeNull();
    const headers = request.headers;
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("passes messaging return targets through the signed hosted device-sync connect-link route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      authorizationUrl: "https://sync.example.test/oauth",
      expiresAt: "2026-04-07T00:00:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    await platform.deviceSyncPort!.createConnectLink({
      messagingReturnTarget: "telegram",
      connectTarget: "whoop",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(
      fetchMock.mock.calls[0],
      "device-sync connect-link fetch",
    );
    expect(request.url).toBe("https://web.example.test/api/internal/device-sync/connect-targets/whoop/connect-link");
    expect(request.method).toBe("POST");
    await expect(request.text()).resolves.toBe(JSON.stringify({
      messagingReturnTarget: "telegram",
    }));
    const headers = request.headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(headers.get("x-hosted-execution-signature")).toMatch(/^[A-Za-z0-9\-_]+$/u);
  });

  it("does not retry mutating hosted device-sync connect-link transport failures", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await expect(platform.deviceSyncPort!.createConnectLink({
      connectTarget: "whoop",
    })).rejects.toThrow("Hosted device-sync connect link whoop request failed.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects direct hosted web control base URLs with non-root paths", async () => {
    const fetchMock = vi.fn();
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: "https://web.example.test/app",
    });

    await expect(platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    })).rejects.toThrow(/must not include a path/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes hosted web control-plane calls through the worker proxy when callback signing stays outside the child", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      connections: [],
      generatedAt: "2026-04-07T00:00:00.000Z",
      userId: "member_123",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const snapshot = await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(snapshot.userId).toBe("member_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "proxied web-control fetch");
    expect(request.url).toBe("http://web-control.worker/api/internal/device-sync/runtime/snapshot");
    expect(request.method).toBe("POST");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.headers.get("content-type")).toBe("application/json");
    await expect(request.json()).resolves.toEqual({
      connectionId: "conn_123",
      userId: "member_123",
    });
  });

  it("routes hosted mailbox fetches through the worker proxy without run adoption fields", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [
        {
          createdAt: "2026-04-26T00:00:01.000Z",
          dedupeKey: "conversation:test:1",
          id: "mailbox_1",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "1",
          occurredAt: "2026-04-26T00:00:00.000Z",
          payloadBytes: 64,
          payloadRef: "payload_1",
          payloadSchema: "murph.hosted-mailbox-item.v1",
          updatedAt: "2026-04-26T00:00:01.000Z",
          userId: "member_123",
        },
      ],
      maxSeqByLane: [
        {
          lane: "conversation",
          maxSeq: "1",
        },
      ],
      userId: "member_123",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_1",
    });

    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "mailbox fetch");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-mailbox/fetch");
    expect(request.method).toBe("POST");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    await expect(request.json()).resolves.toEqual({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_1",
    });
  });

  it("retries replay-safe hosted mailbox fetch transport failures once", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new Error("fetch failed");
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        items: [],
        maxSeqByLane: [],
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_retry",
    });

    expect(result.items).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedRequest = requireFetchRequest(fetchMock.mock.calls[1], "retried mailbox fetch");
    expect(retriedRequest.url).toBe("http://web-control.worker/api/internal/hosted-mailbox/fetch");
    expect(retriedRequest.method).toBe("POST");
    expect(retriedRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
  });

  it("does not retry replay-safe mailbox reads after internal authority rejection", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: "Unauthorized",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 401,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_stale_authority",
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY",
      reason: "internal_authority_rejected",
      status: 401,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries replay-safe hosted mailbox fetch failures once on the signed direct web-control route", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new Error("fetch failed");
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        items: [],
        maxSeqByLane: [],
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_direct_retry",
    });

    expect(result.items).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedRequest = requireFetchRequest(
      fetchMock.mock.calls[1],
      "retried direct mailbox fetch",
    );
    expect(String(retriedRequest.url)).toBe(
      "https://web.example.test/api/internal/hosted-mailbox/fetch",
    );
    expect(retriedRequest.method).toBe("POST");
    expect(retriedRequest.headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(retriedRequest.headers.get("x-hosted-execution-signing-key-id")).toBe("v1");
    expect(retriedRequest.headers.get("x-hosted-execution-signature")).toMatch(
      /^[A-Za-z0-9\-_]+$/u,
    );
  });

  it("retries replay-safe hosted mailbox fetch TimeoutError failures once", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        const error = new Error("The operation timed out.");
        error.name = "TimeoutError";
        throw error;
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        items: [],
        maxSeqByLane: [],
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_timeout_retry",
    });

    expect(result.items).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry replay-safe hosted mailbox fetch AbortError failures", async () => {
    const fetchMock = vi.fn(async () => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      throw error;
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_abort",
    })).rejects.toThrow("Hosted mailbox fetch request failed.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries replay-safe hosted mailbox fetch HTTP 503 responses once", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("try again", {
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
          status: 503,
        });
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        items: [],
        maxSeqByLane: [],
        userId: "member_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetch({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      requestId: "request_mailbox_http_retry",
    });

    expect(result.items).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries replay-safe hosted mailbox payload fetch transport failures once", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new Error("socket closed");
      }

      return new Response(JSON.stringify({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        payload: {
          createdAt: "2026-04-26T00:00:01.000Z",
          mailboxItemId: "mailbox_payload_1",
          payloadCiphertext: "ciphertext",
          payloadSchema: "murph.hosted-mailbox-payload.v1",
          userId: "member_123",
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.mailboxPort!.fetchPayload({
      dedupeKey: "dedupe_payload_1",
      mailboxItemId: "mailbox_payload_1",
      payloadRef: "hosted-mailbox-payload:mailbox_payload_1",
      requestId: "request_payload_retry",
    });

    expect(result.payload?.payloadCiphertext).toBe("ciphertext");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedRequest = requireFetchRequest(
      fetchMock.mock.calls[1],
      "retried mailbox payload fetch",
    );
    expect(retriedRequest.url).toBe(
      "http://web-control.worker/api/internal/hosted-mailbox/payload/fetch",
    );
    expect(retriedRequest.method).toBe("POST");
    expect(retriedRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
  });

  it("threads checkpoint fencing fields through the workspace callback body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      checkpointed: true,
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {
          importedConversationSeq: "1",
        },
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    const result = await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {
        importedConversationSeq: "1",
      },
      snapshotRef: null,
    });

    expect(result.workspace.version).toBe("5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "workspace checkpoint");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-workspace/checkpoint");
    expect(request.method).toBe("POST");
    await expect(request.json()).resolves.toEqual({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {
        importedConversationSeq: "1",
      },
      snapshotRef: null,
    });
  });

  it("sends active lease headers on proxied workspace checkpoints", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      checkpointed: true,
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {},
      snapshotRef: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "workspace checkpoint");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-workspace/checkpoint");
    expect(request.method).toBe("POST");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("4");
    await expect(request.json()).resolves.toMatchObject({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
    });
  });

  it("advances artifact upload lease headers after a successful workspace checkpoint", async () => {
    let currentLease = {
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === "http://web-control.worker/api/internal/hosted-workspace/checkpoint") {
        return new Response(JSON.stringify({
          checkpointed: true,
          workspace: {
            checkpointedAt: "2026-04-26T00:00:04.000Z",
            createdAt: "2026-04-26T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: {},
            snapshotRef: null,
            updatedAt: "2026-04-26T00:00:04.000Z",
            userId: "member_123",
            version: "5",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      return new Response(null, { status: 200 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
        recordCheckpoint: ({ workspaceVersion }) => {
          currentLease = {
            ...currentLease,
            workspaceVersion,
          };
        },
      },
    });

    await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {},
      snapshotRef: null,
    });
    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const artifactRequest = requireFetchRequest(fetchMock.mock.calls[1], "artifact upload");
    expect(artifactRequest.url).toBe(`http://artifacts.worker/objects/${"a".repeat(64)}`);
    expect(artifactRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(artifactRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(artifactRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
  });

  it("reconciles a canonical checkpoint whose committed response is lost", async () => {
    const redactedStatus = {
      hostedCanonicalWriteReceiptLogByteSize: 512,
      hostedCanonicalWriteReceiptLogSha256: "b".repeat(64),
    };
    const committedWorkspace = {
      checkpointedAt: "2026-04-26T00:00:04.000Z",
      createdAt: "2026-04-26T00:00:00.000Z",
      inboxMediaRetentionWakeAt: "2026-04-30T00:00:00.000Z",
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      nextWakeReason: "assistant",
      redactedStatus,
      snapshotRef: null,
      updatedAt: "2026-04-26T00:00:04.000Z",
      userId: "member_123",
      version: "5",
    };
    let currentLease = {
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    };
    const recordCheckpoint = vi.fn(({ workspaceVersion }: { workspaceVersion: string }) => {
      currentLease = {
        ...currentLease,
        workspaceVersion,
      };
    });
    let checkpointCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === "http://web-control.worker/api/internal/hosted-workspace/checkpoint") {
        checkpointCalls += 1;
        if (checkpointCalls === 1) {
          throw new Error("Synthetic response loss after the workspace CAS committed.");
        }
        return new Response(JSON.stringify({
          checkpointConflictReason: "workspace_version",
          checkpointed: false,
          workspace: committedWorkspace,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      return new Response(null, { status: 200 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
        recordCheckpoint,
      },
    });
    const checkpointRequest = {
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      inboxMediaRetentionWakeAt: committedWorkspace.inboxMediaRetentionWakeAt,
      leaseGeneration: "9",
      nextWakeAt: committedWorkspace.nextWakeAt,
      nextWakeReason: committedWorkspace.nextWakeReason,
      reason: "canonical_runtime_commit" as const,
      redactedStatus,
      snapshotRef: null,
    };

    const result = await platform.workspacePort!.checkpoint(checkpointRequest);

    expect(result).toEqual({
      checkpointed: true,
      workspace: committedWorkspace,
    });
    expect(recordCheckpoint).toHaveBeenCalledOnce();
    expect(recordCheckpoint).toHaveBeenCalledWith({ workspaceVersion: "5" });
    expect(checkpointCalls).toBe(2);
    expect(currentLease.workspaceVersion).toBe("5");
    const firstRequest = requireFetchRequest(fetchMock.mock.calls[0], "initial checkpoint");
    const retryRequest = requireFetchRequest(fetchMock.mock.calls[1], "retried checkpoint");
    await expect(firstRequest.json()).resolves.toEqual(checkpointRequest);
    await expect(retryRequest.json()).resolves.toEqual(checkpointRequest);
  });

  it("rejects ambiguous canonical checkpoints without exact successor proof", async () => {
    const rejectionCases: Array<{
      label: string;
      mutate(input: {
        request: HostedWorkspaceCheckpointRequest;
        workspace: HostedWorkspaceState;
      }): void;
    }> = [
      {
        label: "receipt state mismatch",
        mutate({ workspace }) {
          workspace.redactedStatus = {
            ...workspace.redactedStatus,
            hostedCanonicalWriteReceiptLogByteSize: 513,
          };
        },
      },
      {
        label: "non-successor version",
        mutate({ workspace }) {
          workspace.version = "6";
        },
      },
      {
        label: "invalid receipt authority",
        mutate({ request, workspace }) {
          request.redactedStatus = {
            hostedCanonicalWriteReceiptLogByteSize: 512,
            hostedCanonicalWriteReceiptLogSha256: "invalid",
          };
          workspace.redactedStatus = request.redactedStatus;
        },
      },
      {
        label: "implicit retention wake",
        mutate({ request }) {
          delete request.inboxMediaRetentionWakeAt;
        },
      },
    ];

    for (const rejectionCase of rejectionCases) {
      const redactedStatus = {
        hostedCanonicalWriteReceiptLogByteSize: 512,
        hostedCanonicalWriteReceiptLogSha256: "d".repeat(64),
      };
      const request: HostedWorkspaceCheckpointRequest = {
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "4",
        inboxMediaRetentionWakeAt: null,
        leaseGeneration: "9",
        nextWakeAt: null,
        nextWakeReason: null,
        reason: "canonical_runtime_commit",
        redactedStatus,
        snapshotRef: null,
      };
      const workspace: HostedWorkspaceState = {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus,
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      };
      rejectionCase.mutate({ request, workspace });
      const recordCheckpoint = vi.fn();
      const fetchMock = vi.fn(async () => {
        if (fetchMock.mock.calls.length === 1) {
          throw new Error(`Synthetic ambiguous failure: ${rejectionCase.label}.`);
        }
        return new Response(JSON.stringify({
          checkpointConflictReason: "workspace_version",
          checkpointed: false,
          workspace,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      });
      const platform = buildTestHostedExecutionRuntimePlatform({
        boundUserId: "member_123",
        fetchImpl: fetchMock as typeof fetch,
        workspaceCheckpointBridge: {
          readCurrentLease: () => ({
            attemptId: "attempt_1",
            leaseGeneration: "9",
            userId: "member_123",
            workspaceVersion: "4",
          }),
          recordCheckpoint,
        },
      });

      await expect(platform.workspacePort!.checkpoint(request)).rejects.toThrow(
        "Hosted workspace checkpoint request failed.",
      );
      expect(fetchMock, rejectionCase.label).toHaveBeenCalledTimes(2);
      expect(recordCheckpoint, rejectionCase.label).not.toHaveBeenCalled();
    }
  });

  it("rethrows the first error when canonical checkpoint reconciliation stays ambiguous", async () => {
    const firstFailure = new Error("Synthetic first ambiguous checkpoint failure.");
    const retryFailure = new Error("Synthetic retry checkpoint failure.");
    const recordCheckpoint = vi.fn();
    const fetchMock = vi.fn(async () => {
      throw fetchMock.mock.calls.length === 1 ? firstFailure : retryFailure;
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
        recordCheckpoint,
      },
    });

    let rejected: unknown = null;
    try {
      await platform.workspacePort!.checkpoint({
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "4",
        inboxMediaRetentionWakeAt: null,
        leaseGeneration: "9",
        nextWakeAt: null,
        nextWakeReason: null,
        reason: "canonical_runtime_commit",
        redactedStatus: {
          hostedCanonicalWriteReceiptLogByteSize: 512,
          hostedCanonicalWriteReceiptLogSha256: "e".repeat(64),
        },
        snapshotRef: null,
      });
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toBeInstanceOf(Error);
    if (!(rejected instanceof Error)) {
      throw new Error("Expected canonical checkpoint failure.");
    }
    expect(rejected.cause).toBe(firstFailure);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recordCheckpoint).not.toHaveBeenCalled();
  });

  it("does not retry a canonical checkpoint after its active lease changes", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("Synthetic ambiguous checkpoint failure.");
    });
    const recordCheckpoint = vi.fn();
    let leaseReads = 0;
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => {
          leaseReads += 1;
          return {
            attemptId: "attempt_1",
            leaseGeneration: "9",
            userId: "member_123",
            workspaceVersion: leaseReads <= 2 ? "4" : "5",
          };
        },
        recordCheckpoint,
      },
    });

    await expect(platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      inboxMediaRetentionWakeAt: null,
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "canonical_runtime_commit",
      redactedStatus: {
        hostedCanonicalWriteReceiptLogByteSize: 512,
        hostedCanonicalWriteReceiptLogSha256: "1".repeat(64),
      },
      snapshotRef: null,
    })).rejects.toThrow("Hosted workspace checkpoint request failed.");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordCheckpoint).not.toHaveBeenCalled();
  });

  it("does not retry deterministic canonical checkpoint rejection responses", async () => {
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    const recordCheckpoint = vi.fn();
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
        recordCheckpoint,
      },
    });

    await expect(platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      inboxMediaRetentionWakeAt: null,
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "canonical_runtime_commit",
      redactedStatus: {
        hostedCanonicalWriteReceiptLogByteSize: 512,
        hostedCanonicalWriteReceiptLogSha256: "f".repeat(64),
      },
      snapshotRef: null,
    })).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordCheckpoint).not.toHaveBeenCalled();
  });

  it("does not retry ambiguous non-canonical checkpoints", async () => {
    const transportFailure = new Error("Synthetic import checkpoint transport failure.");
    const fetchMock = vi.fn(async () => {
      throw transportFailure;
    });
    const recordCheckpoint = vi.fn();
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
        recordCheckpoint,
      },
    });

    let rejected: unknown = null;
    try {
      await platform.workspacePort!.checkpoint({
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "9",
        reason: "import",
        snapshotRef: null,
      });
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toBeInstanceOf(Error);
    if (!(rejected instanceof Error)) {
      throw new Error("Expected non-canonical checkpoint failure.");
    }
    expect(rejected.cause).toBe(transportFailure);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordCheckpoint).not.toHaveBeenCalled();
  });

  it("retries a server-error canonical checkpoint response once", async () => {
    const redactedStatus = {
      hostedCanonicalWriteReceiptLogByteSize: 512,
      hostedCanonicalWriteReceiptLogSha256: "0".repeat(64),
    };
    const recordCheckpoint = vi.fn();
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("Temporarily unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({
        checkpointed: true,
        workspace: {
          checkpointedAt: "2026-04-26T00:00:04.000Z",
          createdAt: "2026-04-26T00:00:00.000Z",
          inboxMediaRetentionWakeAt: null,
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatus,
          snapshotRef: null,
          updatedAt: "2026-04-26T00:00:04.000Z",
          userId: "member_123",
          version: "5",
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
        recordCheckpoint,
      },
    });

    const result = await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      inboxMediaRetentionWakeAt: null,
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "canonical_runtime_commit",
      redactedStatus,
      snapshotRef: null,
    });

    expect(result.checkpointed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recordCheckpoint).toHaveBeenCalledOnce();
  });

  it("uses the advanced checkpoint version for direct-R2 snapshot start and complete", async () => {
    const ref = createWorkspaceSnapshotV2Ref({ encryptedByteSize: 4 });
    const dataKeyBase64 = encodeHostedWorkspaceSnapshotV2DataKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    let currentLease = {
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    };
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const request = requireFetchRequest(args, "checkpointed snapshot fetch");
      if (request.url === "http://web-control.worker/api/internal/hosted-workspace/checkpoint") {
        return new Response(JSON.stringify({
          checkpointed: true,
          workspace: {
            checkpointedAt: "2026-04-26T00:00:04.000Z",
            createdAt: "2026-04-26T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: {},
            snapshotRef: null,
            updatedAt: "2026-04-26T00:00:04.000Z",
            userId: "member_123",
            version: "5",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (request.url.includes("/workspace-snapshots/start")) {
        return new Response(
          JSON.stringify({
            encryption: {
              aad: buildHostedWorkspaceSnapshotV2Aad({
                objectKey: ref.objectKey,
                snapshotId: ref.snapshotId,
                userId: "member_123",
              }),
              dataKeyBase64,
              ivBase64: ref.encryption.ivBase64,
              rootKeyId: ref.encryption.rootKeyId,
              scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
              wrappedDataKey: ref.encryption.wrappedDataKey,
            },
            limits: {
              maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
              warnEncryptedBytes: 128 * 1024 * 1024,
            },
            objectKey: ref.objectKey,
            snapshotId: ref.snapshotId,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/heartbeat`)) {
        return new Response(JSON.stringify({ alive: true, ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      if (request.url.endsWith(`/workspace-snapshots/${ref.snapshotId}/complete`)) {
        return new Response(
          JSON.stringify({
            checkpoint: {
              checkpointed: true,
              workspace: {
                checkpointedAt: "2026-04-26T00:00:05.000Z",
                createdAt: "2026-04-26T00:00:00.000Z",
                nextWakeAt: null,
                nextWakeReason: null,
                redactedStatus: null,
                snapshotRef: ref,
                updatedAt: "2026-04-26T00:00:05.000Z",
                userId: "member_123",
                version: "6",
              },
            },
            ok: true,
            snapshotRef: ref,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      }
      return new Response("unexpected", { status: 500 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => currentLease,
        recordCheckpoint: ({ workspaceVersion }) => {
          currentLease = {
            ...currentLease,
            workspaceVersion,
          };
        },
      },
    });

    await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {},
      snapshotRef: null,
    });
    await platform.workspaceSnapshotPort!.startSnapshotSession({
      expectedWorkspaceVersion: "5",
      reason: "idle_shutdown",
    });
    await platform.workspaceSnapshotPort!.completeSnapshotSession({
      checkpointRequest: {
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "5",
        leaseGeneration: "9",
        reason: "idle_shutdown",
        snapshotRef: ref,
      },
      ref,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const startRequest = requireFetchRequest(fetchMock.mock.calls[1], "advanced snapshot start");
    expect(startRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(startRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(startRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
    await expect(startRequest.json()).resolves.toEqual(expect.objectContaining({
      expectedWorkspaceVersion: "5",
      reason: "idle_shutdown",
    }));
    const completeRequest = requireFetchRequest(fetchMock.mock.calls[3], "advanced snapshot complete");
    expect(completeRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(completeRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(completeRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
    await expect(completeRequest.json()).resolves.toEqual(expect.objectContaining({
      checkpointRequest: expect.objectContaining({
        expectedWorkspaceVersion: "5",
      }),
    }));
  });

  it("uses locally prepared artifact upload write-fence headers without transport restamping", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const readCurrentLease = vi.fn(() => {
      const callCount = readCurrentLease.mock.calls.length;
      return callCount === 1
        ? {
            attemptId: "attempt_local",
            leaseGeneration: "9",
            userId: "member_123",
            workspaceVersion: "4",
          }
        : {
            attemptId: "attempt_transport",
            leaseGeneration: "10",
            userId: "member_123",
            workspaceVersion: "5",
          };
    });
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease,
      },
    });

    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });

    expect(readCurrentLease).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const artifactRequest = requireFetchRequest(fetchMock.mock.calls[0], "artifact upload");
    expect(artifactRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_local");
    expect(artifactRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(artifactRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("4");
  });

  it("writes browser-vault replicas through the Cloudflare internal store with active lease headers", async () => {
    const sourceBundleHash = "b".repeat(64);
    const replica = {
      generatedAt: "2026-04-26T00:00:00.000Z",
      schema: "murph.browser-vault-replica",
      source: {
        dataVersion: "runner-platform-test",
        sourceBundleHash,
      },
    };
    const replicaRef = createBrowserVaultReplicaRef(sourceBundleHash);
    const replacedReplicaRef = createBrowserVaultReplicaRef("a".repeat(64));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ replicaRef }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    const result = await platform.browserVaultReplicaPort!.write({
      replica,
      replacedReplicaRef,
    });

    expect(result).toEqual(replicaRef);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "browser-vault replica write");
    expect(request.url).toBe("http://browser-vault.worker/replicas");
    expect(request.method).toBe("POST");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
    await expect(request.json()).resolves.toEqual({
      replica,
      replacedReplicaRef,
    });
  });

  it("exposes callback-only browser-vault writes without legacy provider delivery effects", async () => {
    const sourceBundleHash = "c".repeat(64);
    const replica = {
      generatedAt: "2026-04-26T00:00:00.000Z",
      schema: "murph.browser-vault-replica",
      source: {
        dataVersion: "runner-platform-callback-test",
        sourceBundleHash,
      },
    };
    const replicaRef = createBrowserVaultReplicaRef(sourceBundleHash);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/telegram/files/get")) {
        return new Response(JSON.stringify({
          file: {
            file_id: "telegram_file_123",
          },
        }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      return new Response(JSON.stringify({ replicaRef }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    expect(platform.browserVaultReplicaPort).toBeDefined();
    expect(platform.effectsPort.getTelegramFile).toBeDefined();
    expect("sendTelegram" in platform.effectsPort).toBe(false);
    expect("sendTelegramChatAction" in platform.effectsPort).toBe(false);
    expect("sendLinq" in platform.effectsPort).toBe(false);
    expect("sendLinqChatAction" in platform.effectsPort).toBe(false);
    expect("markLinqRead" in platform.effectsPort).toBe(false);
    expect("deleteLinqMessages" in platform.effectsPort).toBe(false);
    await platform.browserVaultReplicaPort!.write({ replica });
    await platform.effectsPort.getTelegramFile!({
      fileId: "telegram_file_123",
    });

    const replicaRequest = requireFetchRequest(fetchMock.mock.calls[0], "callback browser-vault write");
    const telegramRequest = requireFetchRequest(fetchMock.mock.calls[1], "callback telegram file lookup");
    expect(replicaRequest.url).toBe(
      "http://browser-vault.worker/replicas",
    );
    expect(telegramRequest.url).toBe(
      "http://results.worker/telegram/files/get",
    );
    expect(replicaRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(telegramRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(replicaRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(telegramRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
  });

  it("rejects browser-vault replica write headers without an active runtime write fence", async () => {
    await expect(
      createHostedBrowserVaultReplicaWriteHeaders({
        workspaceCheckpointBridge: null,
      }),
    ).rejects.toThrow(
      "Hosted browser-vault replica write requires a runtime write fence.",
    );
  });

  it("rejects browser-vault replica writes when the workspace bridge has no active lease", async () => {
    const sourceBundleHash = "e".repeat(64);
    const replica = {
      generatedAt: "2026-04-26T00:00:00.000Z",
      schema: "murph.browser-vault-replica",
      source: {
        dataVersion: "runner-platform-no-lease-test",
        sourceBundleHash,
      },
    };
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => null,
      },
    });

    await expect(
      platform.browserVaultReplicaPort!.write({ replica }),
    ).rejects.toThrow(
      "Browser-vault replica write requires an active hosted runtime write fence.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects browser-vault replica publishes when the workspace bridge has no active lease", async () => {
    const replicaRef = createBrowserVaultReplicaRef("e".repeat(64));
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => null,
      },
    });

    await expect(
      platform.browserVaultReplicaPort!.publishRef!({ replicaRef }),
    ).rejects.toThrow(
      "Browser-vault replica publish requires an active hosted runtime write fence.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates successful artifact uploads by SHA within one platform instance", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    await platform.artifactStore.put({
      bytes: new Uint8Array([4, 5, 6]),
      sha256: "b".repeat(64),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requireFetchRequest(fetchMock.mock.calls[0], "first artifact upload").url).toBe(
      `http://artifacts.worker/objects/${"a".repeat(64)}`,
    );
    expect(requireFetchRequest(fetchMock.mock.calls[1], "second artifact upload").url).toBe(
      `http://artifacts.worker/objects/${"b".repeat(64)}`,
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactByteLength: 3,
          artifactUploadOrdinal: 1,
          method: "PUT",
          operation: "artifact_upload",
          path: "/objects/REDACTED",
          responseOrigin: "http://artifacts.worker",
        }),
        message: "Hosted runtime artifact upload started.",
        phase: "checkpoint",
        userId: null,
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactUploadOrdinal: 1,
          responseOk: true,
          responseStatus: 200,
        }),
        message: "Hosted runtime artifact upload response received.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactUploadOrdinal: 1,
          responseStatus: 200,
        }),
        message: "Hosted runtime artifact upload completed.",
      }),
    );
    const serializedLogs = JSON.stringify(
      mocks.emitHostedExecutionStructuredLog.mock.calls.filter(([input]) =>
        input?.component === "hosted.runtime.artifact-store"
      ),
    );
    expect(serializedLogs).not.toContain("a".repeat(64));
  });

  it("reports artifact upload authority rejection with artifact operation metadata", async () => {
    const artifactSha = "a".repeat(64);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: "Unauthorized",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 401,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "4",
        }),
      },
    });

    let rejectedError: unknown;
    try {
      await platform.artifactStore.put({
        bytes: new Uint8Array([1, 2, 3]),
        sha256: artifactSha,
      });
    } catch (error) {
      rejectedError = error;
    }

    expect(rejectedError).toMatchObject({
      code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY",
      reason: "internal_authority_rejected",
      status: 401,
    });
    expect(rejectedError).toBeInstanceOf(Error);
    expect((rejectedError as Error).message).toContain(
      "Hosted artifact upload failed with HTTP 401.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requireFetchRequest(fetchMock.mock.calls[0], "artifact upload").url).toBe(
      `http://artifacts.worker/objects/${artifactSha}`,
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: expect.objectContaining({
          hostKind: "artifact_store",
          method: "PUT",
          operation: "artifact_upload",
          path: "/objects/REDACTED",
          responseStatus: 401,
        }),
        level: "warn",
        message: "Hosted runtime internal authority rejected invocation.",
      }),
    );
  });

  it("shares concurrent same-SHA artifact uploads with the in-flight request", async () => {
    let resolveUpload = (_response: Response): void => {
      throw new Error("Expected the artifact upload resolver to be initialized.");
    };
    const uploadResponse = new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    });
    const fetchMock = vi.fn(async () => uploadResponse);
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const firstUpload = platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    const secondUpload = platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    resolveUpload(new Response(null, { status: 200 }));
    await Promise.all([firstUpload, secondUpload]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a shared in-flight artifact upload until the response is OK", async () => {
    let resolveUpload = (_response: Response): void => {
      throw new Error("Expected the artifact upload resolver to be initialized.");
    };
    const uploadResponse = new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    });
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return uploadResponse;
      }

      return new Response(null, { status: 200 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const firstUpload = platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    const secondUpload = platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    resolveUpload(new Response("temporary failure", { status: 503 }));
    await expect(firstUpload).rejects.toThrow(/Hosted artifact upload/u);
    await expect(secondUpload).rejects.toThrow(/Hosted artifact upload/u);

    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not mark failed artifact uploads as deduplicated", async () => {
    const artifactSha = "a".repeat(64);
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("temporary failure", { status: 503 });
      }

      return new Response(null, { status: 200 });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: artifactSha,
    })).rejects.toThrow(/Hosted artifact upload/u);
    await platform.artifactStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: artifactSha,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runtime.artifact-store",
        details: expect.objectContaining({
          artifactByteLength: 3,
          artifactUploadOrdinal: 1,
          contentLengthPresent: false,
          contentTypePresent: true,
          method: "PUT",
          operation: "artifact_upload",
          path: "/objects/REDACTED",
          responseOk: false,
          responseStatus: 503,
        }),
        level: "warn",
        message: "Hosted runtime artifact upload response received.",
        phase: "checkpoint",
        userId: null,
      }),
    );
    const serializedLogs = JSON.stringify(
      mocks.emitHostedExecutionStructuredLog.mock.calls.filter(([input]) =>
        input?.component === "hosted.runtime.artifact-store"
      ),
    );
    expect(serializedLogs).not.toContain(artifactSha);
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain("runtime_write_123");
    expect(serializedLogs).not.toContain("temporary failure");
  });

  it.each([
    { retryable: true, status: 408 },
    { retryable: true, status: 429 },
    { retryable: true, status: 503 },
    { retryable: false, status: 422 },
  ])("classifies artifact upload HTTP $status failures", async ({
    retryable,
    status,
  }) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    let rejectedError: unknown;
    try {
      await platform.artifactStore.put({
        bytes: new Uint8Array([1, 2, 3]),
        sha256: "a".repeat(64),
      });
    } catch (error) {
      rejectedError = error;
    }

    expect(rejectedError).toBeInstanceOf(HostedRuntimeArtifactWriteError);
    expect(rejectedError).toMatchObject({ retryable });
  });

  it("classifies artifact upload transport failures as retryable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    let rejectedError: unknown;
    try {
      await platform.artifactStore.put({
        bytes: new Uint8Array([1, 2, 3]),
        sha256: "a".repeat(64),
      });
    } catch (error) {
      rejectedError = error;
    }

    expect(rejectedError).toBeInstanceOf(HostedRuntimeArtifactWriteError);
    expect(rejectedError).toMatchObject({ retryable: true });
  });

  it("validates the workspace lease immediately before web checkpoint callbacks", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      checkpointed: true,
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "3",
        }),
      },
    });

    let rejected: unknown = null;
    try {
      await platform.workspacePort!.checkpoint({
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "9",
        nextWakeAt: null,
        nextWakeReason: null,
        reason: "canonical_runtime_commit",
        redactedStatus: {},
        snapshotRef: null,
      });
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toBeInstanceOf(HostedRuntimeBridgeCheckpointLeaseError);
    expect(rejected).toMatchObject({
      code: "stale_workspace_version",
      stage: "before_web_checkpoint",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads workspace state through the web callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      workspace: {
        checkpointedAt: "2026-04-26T00:00:04.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {
          importedConversationSeq: "1",
        },
        snapshotRef: null,
        updatedAt: "2026-04-26T00:00:04.000Z",
        userId: "member_123",
        version: "5",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const readWorkspace = platform.workspacePort!.read;
    if (typeof readWorkspace !== "function") {
      throw new Error("Expected hosted workspace read port.");
    }

    const result = await readWorkspace();

    expect(result.workspace?.version).toBe("5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "workspace read");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-workspace");
    expect(request.method).toBe("GET");
  });

  it("writes only structured runtime logs through the web callback route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      loggedCount: 1,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await platform.logPort!.write({
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          attemptId: "attempt_1",
          component: "mailbox",
          eventCode: "mailbox.imported",
          leaseGeneration: "9",
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: "1",
          mailboxSeqStart: "1",
          phase: "import",
          redactedJson: {
            importedCount: 1,
          },
          workspaceVersion: "4",
        },
      ],
    });

    expect(result.loggedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "runtime log");
    expect(request.url).toBe("http://web-control.worker/api/internal/hosted-runtime/log");
    expect(request.method).toBe("POST");
    await expect(request.json()).resolves.toEqual({
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          attemptId: "attempt_1",
          component: "mailbox",
          eventCode: "mailbox.imported",
          leaseGeneration: "9",
          level: "info",
          mailboxLane: "conversation",
          mailboxSeqEnd: "1",
          mailboxSeqStart: "1",
          phase: "import",
          redactedJson: {
            importedCount: 1,
          },
          workspaceVersion: "4",
        },
      ],
    });
  });

  it("does not expose the deleted hosted share web-control port", () => {
    const fetchMock = vi.fn(async () => new Response("unexpected", { status: 200 }));
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    }));
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      webCallbackSigning: environment.webCallbackSigning,
      webControlBaseUrl: "https://web.example.test",
    });

    expect("sharePort" in platform).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes the shared hosted effects and meal-photo object methods", async () => {
    const rawMessage = new Uint8Array([0x61, 0x62, 0x63]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);

      if (request.method === "GET") {
        return new Response(rawMessage, {
          headers: {
            "content-type": "message/rfc822",
          },
          status: 200,
        });
      }

      return new Response(JSON.stringify({
        fanoutRecipientMemberIds: ["member_one", "member_two"],
        ok: true,
        target: "assistant@example.com",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });
    const { effectsPort } = platform;

    expect("deletePreparedAssistantDelivery" in effectsPort).toBe(false);
    expect("readAssistantDeliveryRecord" in effectsPort).toBe(false);
    expect("writeAssistantDeliveryRecord" in effectsPort).toBe(false);

    const readResult = await effectsPort.readRawEmailMessage("raw_123");
    const mealPhotoKey = "a".repeat(40);
    const mealPhotoResult = await effectsPort.readMealPhoto?.(mealPhotoKey);
    await effectsPort.deleteMealPhoto?.(mealPhotoKey);
    const groupEmailAuthorizationProof = "a".repeat(64);
    const sendResult = await effectsPort.sendEmail({
      groupEmailAuthorizationProof,
      message: "hello",
      subject: "subject",
      target: "assistant@example.com",
      targetKind: "explicit",
    });

    expect(readResult).toEqual(rawMessage);
    expect(mealPhotoResult).toEqual(rawMessage);
    expect(sendResult).toEqual({
      delivery: null,
      fanoutRecipientMemberIds: ["member_one", "member_two"],
      target: "assistant@example.com",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const readRequest = fetchMock.mock.calls[0]?.[0] as Request;
    const mealPhotoReadRequest = fetchMock.mock.calls[1]?.[0] as Request;
    const mealPhotoDeleteRequest = fetchMock.mock.calls[2]?.[0] as Request;
    const sendRequest = fetchMock.mock.calls[3]?.[0] as Request;

    expect(readRequest).toBeInstanceOf(Request);
    expect(sendRequest).toBeInstanceOf(Request);
    expect(readRequest.url).toBe("http://results.worker/messages/raw_123");
    expect(mealPhotoReadRequest.url).toBe(
      `http://results.worker/meal-photos/${mealPhotoKey}`,
    );
    expect(mealPhotoReadRequest.method).toBe("GET");
    expect(mealPhotoDeleteRequest.url).toBe(
      `http://results.worker/meal-photos/${mealPhotoKey}`,
    );
    expect(mealPhotoDeleteRequest.method).toBe("DELETE");
    expect(sendRequest.url).toBe("http://results.worker/send");
    await expect(sendRequest.json()).resolves.toEqual({
      groupEmailAuthorizationProof,
      message: "hello",
      subject: "subject",
      target: "assistant@example.com",
      targetKind: "explicit",
    });
  });

  it("preserves hosted email pre-provider failure proof across the effects port", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: "ASSISTANT_EMAIL_PROVIDER_ENTRY_FAILED",
      deliveryMayHaveSucceeded: false,
      error: "Hosted email delivery failed before provider entry.",
      retryable: true,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 503,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.effectsPort.sendEmail({
      message: "group reply",
      target: "hosted-group-recipient-target",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "ASSISTANT_EMAIL_PROVIDER_ENTRY_FAILED",
      deliveryMayHaveSucceeded: false,
      retryable: true,
      status: 503,
      statusCode: 503,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("bounds and cancels stalled hosted email response bodies", async () => {
    let bodyCanceled = false;
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      cancel: () => {
        bodyCanceled = true;
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      commitTimeoutMs: 25,
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(platform.effectsPort.sendEmail({
      message: "group reply",
      target: "hosted-group-recipient-target",
      targetKind: "thread",
    })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(bodyCanceled).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps only Telegram file lookup on the provider effects port after delivery cutover", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/telegram/files/get")) {
        return new Response(JSON.stringify({
          file: {
            file_id: "telegram_file_123",
            file_path: "photos/file.jpg",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    await expect(platform.effectsPort.getTelegramFile!({
      fileId: "telegram_file_123",
    })).resolves.toEqual({
      file_id: "telegram_file_123",
      file_path: "photos/file.jpg",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const telegramRequest = requireFetchRequest(fetchMock.mock.calls[0], "telegram file lookup");
    expect(telegramRequest.url).toBe("http://results.worker/telegram/files/get");
    expect(telegramRequest.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(telegramRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(telegramRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(telegramRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
    await expect(telegramRequest.json()).resolves.toEqual({
      fileId: "telegram_file_123",
    });
    expect("sendTelegram" in platform.effectsPort).toBe(false);
    expect("sendTelegramChatAction" in platform.effectsPort).toBe(false);
    expect("sendLinq" in platform.effectsPort).toBe(false);
    expect("sendLinqChatAction" in platform.effectsPort).toBe(false);
    expect("markLinqRead" in platform.effectsPort).toBe(false);
    expect("deleteLinqMessages" in platform.effectsPort).toBe(false);
  });

  it("passes Telegram provider-effect caller signals to the internal fetch", async () => {
    const controller = new AbortController();
    let observedAbort = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      request.signal.addEventListener("abort", () => {
        observedAbort = true;
      }, { once: true });
      controller.abort(new DOMException("Stopped", "AbortError"));
      await Promise.resolve();
      return new Response(JSON.stringify({
        file: {
          file_id: "telegram_file_123",
          file_path: "photos/file.jpg",
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    await expect(platform.effectsPort.getTelegramFile!(
      { fileId: "telegram_file_123" },
      { signal: controller.signal },
    )).resolves.toEqual({
      file_id: "telegram_file_123",
      file_path: "photos/file.jpg",
    });

    expect(observedAbort).toBe(true);
  });

  it("preserves structured details from remaining provider effect failures", async () => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        cleanupMessages: [{ messageId: "1001", target: "telegram_chat_123" }],
        code: "ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS",
        error: "Telegram delivery outcome is ambiguous.",
        providerMessageIds: ["1001"],
        target: "telegram_chat_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 502,
      })) as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    await expect(platform.effectsPort.getTelegramFile!({
      fileId: "telegram_file_123",
    })).rejects.toMatchObject({
      cleanupMessages: [{ messageId: "1001", target: "telegram_chat_123" }],
      code: "ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS",
      providerMessageId: "1001",
      providerMessageIds: ["1001"],
      status: 502,
      target: "telegram_chat_123",
    });
  });

  it("classifies internal provider-effect 403 responses as control-plane rejections", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: "Forbidden",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 403,
    }));
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt_1",
          leaseGeneration: "9",
          userId: "member_123",
          workspaceVersion: "5",
        }),
      },
    });

    await expect(platform.effectsPort.getTelegramFile!({
      fileId: "telegram_file_123",
    })).rejects.toMatchObject({
      code: "authorization_error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves HTTP status on hosted raw email read failures", async () => {
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: vi.fn(async () => new Response("unavailable", { status: 503 })) as typeof fetch,
    });

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toThrow(/Hosted raw email read failed with HTTP 503/u);

    await expect(
      platform.effectsPort.readRawEmailMessage("raw_123"),
    ).rejects.toMatchObject({
      status: 503,
      statusCode: 503,
    });
  });
});
