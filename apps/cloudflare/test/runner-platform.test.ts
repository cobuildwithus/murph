import { createCipheriv, createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  serializeHostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

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
  buildHostedExecutionRuntimePlatform,
  createCloudflareHostedProviderFetch,
  createHostedBrowserVaultReplicaWriteHeaders,
  HostedRuntimeInternalAuthorityRejectedError,
  isHostedRuntimeInternalAuthorityRejectedError,
  readHostedRuntimeControlPlaneFetchFailureDiagnostics,
  readHostedWorkspaceSnapshotRestoreStep,
} from "../src/runtime-platform.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../src/runner-outbound/headers.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";
import {
  createEncryptedWorkspaceSnapshotFile,
} from "../src/workspace-snapshot-local.ts";

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

function readWorkspaceSnapshotDiagnosticLogs(): Array<{
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
      && (input as { component?: unknown }).component === "hosted.runtime.workspace-snapshot"
    );
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
    requestedModel: "gpt-5.5",
    routeId: "route_usage",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: null,
    sessionId: "session_usage",
    stripeMeterSource: "murph",
    surface: null,
    totalTokens: 3,
    triggerKind: null,
    turnId: "turn_usage",
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
      totalPlainBytes: input.encryptedByteSize,
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
      scratchRoot: "unused-scratch-root",
    })).rejects.toThrow("Hosted workspace snapshot restore exceeds the single-part size guard.");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed workspace snapshot data-key unwraps before presign GET", async () => {
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

    await expect(platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
      durableRoot: "unused-durable-root",
      ref,
      scratchRoot: "unused-scratch-root",
    })).rejects.toThrow("Invalid character");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const unwrapRequest = requireFetchRequest(fetchMock.mock.calls[0], "workspace snapshot unwrap");
    expect(unwrapRequest.url).toBe(
      "http://workspace-snapshots.worker/workspace-snapshots/snapshot_runner_platform/data-key/unwrap",
    );
  });

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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const abortRequest = requireFetchRequest(fetchMock.mock.calls[1], "workspace snapshot abort");
    expect(abortRequest.method).toBe("DELETE");
    expect(abortRequest.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(abortRequest.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(abortRequest.headers.get("x-hosted-runtime-workspace-version")).toBe("4");
  });

  it("reuses the snapshot session write fence when completing after the runtime lease changes", async () => {
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const completeRequest = requireFetchRequest(fetchMock.mock.calls[1], "workspace snapshot complete");
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
    const scratchRoot = path.join(tempRoot, "scratch");
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
        dataKey: dataKeyBase64,
        durableRoot: sourceRoot,
        ivBase64: "AQIDBAUGBwgJCgsM",
        maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        outputDir: scratchRoot,
      });
      const encryptedBytes = await readFile(encrypted.encryptedFilePath);
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
          await delayWithAbort(25, request.signal);
          return new Response(encryptedBytes, {
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

      await platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
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
        scratchRoot,
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const unwrapRequest = requireFetchRequest(fetchMock.mock.calls[0], "workspace snapshot unwrap");
      expect(unwrapRequest.url).toBe(
        "http://workspace-snapshots.worker/workspace-snapshots/snapshot_runner_platform_restore/data-key/unwrap",
      );
      await expect(unwrapRequest.json()).resolves.toEqual({
        aad,
        rootKeyId: "root_key_test",
        wrappedDataKey: "wrapped_data_key_test",
      });
      const presignRequest = requireFetchRequest(fetchMock.mock.calls[1], "workspace snapshot GET presign");
      expect(presignRequest.url).toBe(
        "http://workspace-snapshots.worker/workspace-snapshots/snapshot_runner_platform_restore/presign-get",
      );
      await expect(presignRequest.json()).resolves.toEqual({
        objectKey,
        ref: expect.objectContaining({
          objectKey,
          snapshotId,
          userId: "member_123",
        }),
        snapshotId,
      });
      expect(requireFetchRequest(fetchMock.mock.calls[2], "direct R2 workspace snapshot GET").url).toBe(getUrl);
      await expect(access(path.join(durableRoot, "note.md"))).resolves.toBeUndefined();
      const workspaceSnapshotLogs = readWorkspaceSnapshotDiagnosticLogs();
      const completedSteps = workspaceSnapshotLogs
        .filter((log) => log.message === "Hosted workspace snapshot restore step completed.")
        .map((log) => log.details?.workspaceSnapshotRestoreStep);
      expect(completedSteps).toEqual([
        "size_guard",
        "data_key_unwrap",
        "scratch_prepare",
        "presign_get",
        "object_fetch",
        "archive_restore",
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
      expect(serializedLogs).not.toContain(scratchRoot);
      expect(serializedLogs).not.toContain("note.md");
      expect(serializedLogs).not.toContain("restored through direct r2");
    } finally {
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
        dataKey: dataKeyBase64,
        durableRoot: sourceRoot,
        ivBase64: "AQIDBAUGBwgJCgsM",
        maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        outputDir: scratchRoot,
      });
      const encryptedBytes = await readFile(encrypted.encryptedFilePath);
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
            throw new TypeError(`fetch failed for ${getUrl} with hidden retry detail`);
          }
          return new Response(encryptedBytes, {
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

      await platform.workspaceSnapshotPort!.restoreWorkspaceSnapshot({
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
        scratchRoot,
      });

      expect(objectFetchCount).toBe(2);
      await expect(access(path.join(durableRoot, "note.md"))).resolves.toBeUndefined();
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
      const serializedLogs = JSON.stringify(readWorkspaceSnapshotDiagnosticLogs());
      expect(serializedLogs).not.toContain(objectKey);
      expect(serializedLogs).not.toContain(snapshotId);
      expect(serializedLogs).not.toContain(getUrl);
      expect(serializedLogs).not.toContain("hidden retry detail");
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

  it("does not retry v2 workspace snapshot byte-count mismatches", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-platform-r2-byte-count-"));
    const durableRoot = path.join(tempRoot, "durable");
    const scratchRoot = path.join(tempRoot, "scratch");
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
        scratchRoot,
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
    const scratchRoot = path.join(tempRoot, "scratch");
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
        scratchRoot,
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
    const scratchRoot = path.join(tempRoot, "scratch");
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
        scratchRoot,
      })).rejects.toThrow("Hosted workspace snapshot data key unwrap failed with HTTP 500.");

      const failedLogs = readWorkspaceSnapshotDiagnosticLogs()
        .filter((log) => log.message === "Hosted workspace snapshot restore step failed.");
      expect(failedLogs).toHaveLength(1);
      expect(failedLogs[0]).toEqual(expect.objectContaining({
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
      expect(serializedLogs).not.toContain(ref.objectKey);
      expect(serializedLogs).not.toContain(ref.snapshotId);
      expect(serializedLogs).not.toContain("body-presigned");
      expect(serializedLogs).not.toContain("member_123");
      expect(serializedLogs).not.toContain("root_key_test");
      expect(serializedLogs).not.toContain("wrapped_data_key_test");
      expect(serializedLogs).not.toContain(tempRoot);
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
    const scratchRoot = path.join(tempRoot, "scratch");
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
          scratchRoot,
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
      expect(serializedLogs).not.toContain("hidden transport detail");
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
    const scratchRoot = path.join(tempRoot, "scratch");
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
        scratchRoot,
      })).rejects.toThrow(/^Hosted workspace snapshot zstd command failed with /u);

      const failedLogs = readWorkspaceSnapshotDiagnosticLogs()
        .filter((log) => log.message === "Hosted workspace snapshot restore step failed.");
      expect(failedLogs.at(-1)).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          errorCode: "runtime_error",
          errorMessagePresent: true,
          errorName: "Error",
          operation: "workspace_snapshot_restore",
          workspaceSnapshotProcessExitCode: expect.any(Number),
          workspaceSnapshotProcessLabel: "zstd",
          workspaceSnapshotProcessStderrBytes: expect.any(Number),
          workspaceSnapshotProcessStderrLineCount: expect.any(Number),
          workspaceSnapshotProcessStderrMarkers: expect.arrayContaining([
            "unsupported_format",
          ]),
          workspaceSnapshotProcessStderrTruncated: false,
          workspaceSnapshotRestoreStep: "archive_restore",
        }),
        level: "warn",
        phase: "runtime.starting",
        userId: null,
      }));

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

  it("attaches safe artifact fetch cause metadata without logging raw transport detail", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed with hidden artifact transport detail");
    });
    const platform = buildTestHostedExecutionRuntimePlatform({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
    });

    let thrown: unknown;
    try {
      await platform.artifactStore.get("a".repeat(64));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
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
    expect(serializedLogs).not.toContain("hidden artifact transport detail");
    expect(serializedLogs).not.toContain("a".repeat(64));
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

    const result = await platform.artifactStore.get("b".repeat(64));

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

    const result = await platform.artifactStore.get("c".repeat(64));

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

      await expect(platform.artifactStore.get("d".repeat(64)))
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

  it("logs direct control-plane fetch failures without raw error detail", async () => {
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
      .not.toContain("hidden request detail");
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
          userId: "member_123",
          workspaceVersion: "6",
        }),
      },
    );

    const response = await hostedFetch("https://api.openai.com/v1/responses");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "external provider fetch");
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("runtime_write_123");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("6");
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
  });

  it("preserves Request init overrides and authority-binds external provider fetches", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
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
    const original = new Request("https://api.openai.com/v1/responses", {
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
    const forwarded = requireFetchRequest(fetchMock.mock.calls[0], "external passthrough fetch");
    expect(forwarded.headers.get("x-test")).toBe("1");
    expect(forwarded.headers.get("x-hosted-runtime-attempt-id")).toBe("runtime_write_123");
    expect(forwarded.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
    expect(forwarded.headers.get("x-hosted-runtime-workspace-version")).toBe("6");
    expect(forwarded.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    expect(forwarded.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
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

  it("rejects external provider fetches when the runtime write-fence lease is missing", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hostedFetch = createCloudflareHostedProviderFetch(
      "member_123",
      fetchMock as typeof fetch,
      {
        readCurrentLease: () => null,
      },
    );

    await expect(
      hostedFetch("https://api.openai.com/v1/responses"),
    ).rejects.toThrow(
      "Hosted provider request for api.openai.com is missing a runtime write-fence lease.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authority-binds platform providerFetch without relying on proxy header opt-in", async () => {
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

    await platform.providerFetch!("https://api.telegram.org/bot/sendMessage", {
      body: "{}",
      method: "POST",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "platform provider fetch");
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("runtime_write_123");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("6");
    expect(request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
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
        "x-hosted-execution-runner-proxy-token": "proxy_token",
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
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
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

  it("routes raw email reads through the Cloudflare internal effects port and attaches the invocation proxy token", async () => {
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
    expect(platform.issueExportPort).toBeDefined();
    expect(platform.usageRecordPort).toBeDefined();
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
    await platform.issueExportPort!.recordIssues([{ code: "runtime.issue" }]);
    await platform.usageRecordPort!.recordUsage(createAssistantUsageRecord());
    await platform.deviceSyncPort!.fetchSnapshot({
      connectionId: "conn_123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(7);
    const requests = fetchMock.mock.calls.map((call, index) =>
      requireFetchRequest(call, `callback web-control request ${index}`)
    );
    expect(requests.map((request) => request.url)).toEqual([
      "http://web-control.worker/api/internal/hosted-mailbox/fetch",
      "http://web-control.worker/api/internal/hosted-workspace",
      "http://web-control.worker/api/internal/hosted-runtime/log",
      "http://web-control.worker/api/internal/hosted-runtime/latency",
      "http://web-control.worker/api/internal/hosted-execution/issues/record",
      "http://web-control.worker/api/internal/hosted-execution/usage/record",
      "http://web-control.worker/api/internal/device-sync/runtime/snapshot",
    ]);
    for (const request of requests) {
      expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("runtime_write_123");
      expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("7");
      expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("6");
      expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    }
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

  it("records hosted usage through the signed web callback seam", async () => {
    const usageRecord = createAssistantUsageRecord();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      await expect(request.clone().json()).resolves.toEqual({
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
      platform.usageRecordPort!.recordUsage(usageRecord),
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
      includeCredentialMaterial: false,
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

    const result = await platform.browserVaultReplicaPort!.write({ replica });

    expect(result).toEqual(replicaRef);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requireFetchRequest(fetchMock.mock.calls[0], "browser-vault replica write");
    expect(request.url).toBe("http://browser-vault.worker/replicas");
    expect(request.method).toBe("POST");
    expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
    expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(request.headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(request.headers.get("x-hosted-runtime-workspace-version")).toBe("5");
    await expect(request.json()).resolves.toEqual({ replica });
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
    expect("sendWhatsApp" in platform.effectsPort).toBe(false);
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

    const result = await platform.workspacePort!.checkpoint({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "canonical_runtime_commit",
      redactedStatus: {},
      snapshotRef: null,
    });

    expect(result.checkpointed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("exposes only the shared hosted effects port methods needed after the cutover", async () => {
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
    const sendResult = await effectsPort.sendEmail({
      identityId: "identity_123",
      message: "hello",
      subject: "subject",
      target: "assistant@example.com",
      targetKind: "explicit",
    });

    expect(readResult).toEqual(rawMessage);
    expect(sendResult).toEqual({ target: "assistant@example.com" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const readRequest = fetchMock.mock.calls[0]?.[0] as Request;
    const sendRequest = fetchMock.mock.calls[1]?.[0] as Request;

    expect(readRequest).toBeInstanceOf(Request);
    expect(sendRequest).toBeInstanceOf(Request);
    expect(readRequest.url).toBe("http://results.worker/messages/raw_123");
    expect(sendRequest.url).toBe("http://results.worker/send");
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
    expect("sendWhatsApp" in platform.effectsPort).toBe(false);
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

  it("classifies internal provider-effect 403 responses as stale invocation authority", async () => {
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
      code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY",
      reason: "internal_authority_rejected",
      status: 403,
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
