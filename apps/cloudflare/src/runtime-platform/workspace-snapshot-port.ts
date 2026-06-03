import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import type {
  HostedRuntimePlatform,
  HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails,
  HostedRuntimeWorkspaceSnapshotSessionStart,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { HostedExecutionStructuredLogDetails } from "@murphai/hosted-execution";
import { parseHostedWorkspaceCheckpointResponse, parseHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import type { HostedWorkspaceCheckpointResponse } from "@murphai/hosted-execution/runtime-control";
import {
  decodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
} from "../internal-hosts.ts";
import {
  encodeHostedWorkspaceSnapshotSha256Base64,
  HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
} from "../workspace-snapshot-store.ts";
import { restoreEncryptedWorkspaceSnapshot } from "../workspace-snapshot-local.ts";
import { requireHostedRuntimeWriteFenceHeaders, type HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import {
  HostedRuntimeControlPlaneFetchError,
  isRetryableHostedRuntimeReplaySafeReadTransportError,
} from "./control-plane-fetch.ts";
import {
  buildHostedWorkspaceSnapshotRestoreLogDetails,
  buildHostedRuntimeSafeErrorMetadata,
  readHostedRuntimeStepElapsedMs,
  runHostedWorkspaceSnapshotRestoreReplaySafeReadStep,
  runHostedWorkspaceSnapshotRestoreStep,
} from "./diagnostics.ts";
import {
  assertHostedOk,
  fetchHostedResponse,
  fetchHostedJson,
  readRequiredHostedRuntimeObject,
  readRequiredHostedRuntimePositiveInteger,
  readRequiredHostedRuntimeString,
} from "./hosted-http.ts";

export function createCloudflareWorkspaceSnapshotPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): NonNullable<HostedRuntimePlatform["workspaceSnapshotPort"]> {
  const sessionWriteFenceHeaders = new Map<string, Headers>();
  const readSessionWriteFenceHeaders = async (
    snapshotId: string,
    description: string,
  ): Promise<Headers> => {
    const stored = sessionWriteFenceHeaders.get(snapshotId);
    if (stored) {
      return new Headers(stored);
    }
    return await requireHostedRuntimeWriteFenceHeaders(
      input.workspaceCheckpointBridge,
      description,
    );
  };
  const port: NonNullable<HostedRuntimePlatform["workspaceSnapshotPort"]> = {
    async abortSnapshotSession(request) {
      const headers = await readSessionWriteFenceHeaders(
        request.snapshotId,
        "Hosted workspace snapshot session abort",
      );
      try {
        await fetchHostedJson({
          body: {
            objectKey: request.objectKey,
            snapshotId: request.snapshotId,
          },
          description: "Hosted workspace snapshot session abort",
          fetchImpl: input.fetchImpl,
          headers,
          redactedLogPath: "/workspace-snapshots/REDACTED",
          method: "DELETE",
          timeoutMs: input.timeoutMs,
          url: new URL(
            `/workspace-snapshots/${encodeURIComponent(request.snapshotId)}`,
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
          ),
        });
      } finally {
        sessionWriteFenceHeaders.delete(request.snapshotId);
      }
    },

    async completeSnapshotSession(request) {
      const headers = await readSessionWriteFenceHeaders(
        request.ref.snapshotId,
        "Hosted workspace snapshot complete",
      );
      let payload: unknown;
      try {
        payload = await fetchHostedJson({
          body: {
            archive: request.ref.archive,
            checkpointRequest: request.checkpointRequest,
            objectKey: request.ref.objectKey,
            snapshotId: request.ref.snapshotId,
          },
          description: "Hosted workspace snapshot complete",
          fetchImpl: input.fetchImpl,
          headers,
          redactedLogPath: "/workspace-snapshots/REDACTED/complete",
          method: "POST",
          timeoutMs: input.timeoutMs,
          url: new URL(
            `/workspace-snapshots/${encodeURIComponent(request.ref.snapshotId)}/complete`,
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
          ),
        });
      } finally {
        sessionWriteFenceHeaders.delete(request.ref.snapshotId);
      }
      const completed = parseHostedWorkspaceSnapshotCompletePayload(payload);
      const { checkpoint } = completed;
      if (checkpoint.checkpointed) {
        await input.workspaceCheckpointBridge.recordCheckpoint?.({
          workspaceVersion: checkpoint.workspace.version,
        });
      }
      return completed;
    },

    async putSnapshotObjectDirect(request) {
      if (!Number.isSafeInteger(request.encryptedByteSize) || request.encryptedByteSize <= 0) {
        throw new TypeError("Hosted workspace snapshot encryptedByteSize must be a positive safe integer.");
      }
      const timings: HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails = {};
      const source = await stat(request.sourceFilePath);
      if (source.size !== request.encryptedByteSize) {
        throw new Error("Hosted workspace snapshot source file size does not match encryptedByteSize.");
      }
      const presignStartedAt = Date.now();
      const presignedPut = await presignWorkspaceSnapshotPut({
        encryptedByteSize: request.encryptedByteSize,
        encryptedObjectSha256: request.encryptedObjectSha256,
        fetchImpl: input.fetchImpl,
        headers: await readSessionWriteFenceHeaders(
          request.snapshotId,
          "Hosted workspace snapshot presign PUT",
        ),
        objectKey: request.objectKey,
        snapshotId: request.snapshotId,
        timeoutMs: input.timeoutMs,
        workspaceCheckpointBridge: input.workspaceCheckpointBridge,
      });
      timings.snapshotDirectR2PresignElapsedMs =
        readHostedRuntimeStepElapsedMs(presignStartedAt);
      const expiresAtMs = Date.parse(presignedPut.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        throw new Error("Hosted workspace snapshot direct R2 upload URL is expired.");
      }
      const putTimeoutMs = Math.max(1, expiresAtMs - Date.now());
      const body = Readable.toWeb(createReadStream(request.sourceFilePath)) as BodyInit;
      const checksumSha256Base64 = encodeHostedWorkspaceSnapshotSha256Base64(
        request.encryptedObjectSha256,
      );
      const putStartedAt = Date.now();
      const putHeaders = {
        "content-length": String(request.encryptedByteSize),
        "content-type": HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
        "if-none-match": "*",
        "x-amz-checksum-sha256": checksumSha256Base64,
        "x-amz-meta-encryptedsha256": request.encryptedObjectSha256,
        "x-amz-meta-schema": HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
        "x-amz-meta-snapshotid": request.snapshotId,
      };
      const response = await fetchHostedResponse({
        description: "Hosted workspace snapshot direct R2 upload",
        fetchImpl: input.fetchImpl,
        init: {
          body,
          duplex: "half",
          headers: putHeaders,
          method: "PUT",
        } as RequestInit & { duplex: "half" },
        redactedLogPath: "/workspace-snapshot-object",
        redactedResponseOrigin: "workspace_snapshot_object",
        timeoutMs: putTimeoutMs,
        url: new URL(presignedPut.putUrl),
      });
      timings.snapshotDirectR2PutElapsedMs =
        readHostedRuntimeStepElapsedMs(putStartedAt);
      assertHostedOk(response, "Hosted workspace snapshot direct R2 upload");
      return timings;
    },

    async restoreWorkspaceSnapshot(request) {
      const restoreLogDetails = buildHostedWorkspaceSnapshotRestoreLogDetails({
        ref: request.ref,
        scratchRootPresent: request.scratchRoot !== null && request.scratchRoot !== undefined,
        timeoutMs: input.timeoutMs,
      });
      await runHostedWorkspaceSnapshotRestoreStep({
        details: restoreLogDetails,
        run: async () => {
          if (request.ref.archive.encryptedByteSize >= HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES) {
            throw new RangeError("Hosted workspace snapshot restore exceeds the single-part size guard.");
          }
        },
        step: "size_guard",
      });
      const dataKey = await runHostedWorkspaceSnapshotRestoreReplaySafeReadStep({
        details: restoreLogDetails,
        run: async () => await unwrapWorkspaceSnapshotDataKey({
          aad: request.ref.encryption.aad,
          fetchImpl: input.fetchImpl,
          rootKeyId: request.ref.encryption.rootKeyId,
          timeoutMs: input.timeoutMs,
          workspaceCheckpointBridge: input.workspaceCheckpointBridge,
          wrappedDataKey: request.ref.encryption.wrappedDataKey,
        }),
        step: "data_key_unwrap",
      });
      const scratchRoot = path.resolve(request.scratchRoot ?? tmpdir());
      const tempDir = await runHostedWorkspaceSnapshotRestoreStep({
        details: restoreLogDetails,
        run: async () => {
          await mkdir(scratchRoot, { mode: 0o700, recursive: true });
          return await mkdtemp(path.join(scratchRoot, "workspace-snapshot-fetch-"));
        },
        step: "scratch_prepare",
      });
      const encryptedFilePath = path.join(tempDir, "workspace.snapshot.enc");
      try {
        const presignedGet = await runHostedWorkspaceSnapshotRestoreReplaySafeReadStep({
          details: restoreLogDetails,
          run: async () => {
            const result = await presignWorkspaceSnapshotGet({
              fetchImpl: input.fetchImpl,
              objectKey: request.ref.objectKey,
              ref: request.ref,
              snapshotId: request.ref.snapshotId,
              timeoutMs: input.timeoutMs,
              workspaceCheckpointBridge: input.workspaceCheckpointBridge,
            });
            const expiresAtMs = Date.parse(result.expiresAt);
            if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
              throw new Error("Hosted workspace snapshot direct R2 download URL is expired.");
            }
            return {
              ...result,
              expiresAtMs,
            };
          },
          step: "presign_get",
        });
        await runHostedWorkspaceSnapshotRestoreReplaySafeReadStep({
          details: restoreLogDetails,
          run: async () => {
            const fetched = await fetchHostedWorkspaceSnapshotEncryptedObjectToFile({
              encryptedFilePath,
              expectedEncryptedByteSize: request.ref.archive.encryptedByteSize,
              fetchImpl: input.fetchImpl,
              getUrl: presignedGet.getUrl,
              timeoutMs: Math.max(1, presignedGet.expiresAtMs - Date.now() - 5_000),
            });
            if (!fetched) {
              throw new Error("Hosted workspace snapshot encrypted object is unavailable.");
            }
          },
          step: "object_fetch",
        });
        await runHostedWorkspaceSnapshotRestoreStep({
          details: restoreLogDetails,
          run: async () => {
            await restoreEncryptedWorkspaceSnapshot({
              dataKey,
              durableRoot: request.durableRoot,
              encryptedFilePath,
              ref: request.ref,
              scratchRoot: request.scratchRoot ?? null,
            });
          },
          step: "archive_restore",
        });
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    },

    async startSnapshotSession(request) {
      const headers = await requireHostedRuntimeWriteFenceHeaders(
        input.workspaceCheckpointBridge,
        "Hosted workspace snapshot session start",
      );
      const payload = await fetchHostedJson({
        body: request,
        description: "Hosted workspace snapshot session start",
        fetchImpl: input.fetchImpl,
        headers,
        method: "POST",
        timeoutMs: input.timeoutMs,
        url: new URL(
          "/workspace-snapshots/start",
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
        ),
      });
      const started = parseHostedWorkspaceSnapshotStartPayload(payload, input.boundUserId);
      sessionWriteFenceHeaders.set(started.snapshotId, new Headers(headers));
      return started;
    },
  };
  return port;
}
function parseHostedWorkspaceSnapshotStartPayload(
  value: unknown,
  boundUserId: string,
): HostedRuntimeWorkspaceSnapshotSessionStart {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted workspace snapshot session start response must be an object.");
  }
  const record = value as Record<string, unknown>;
  const encryptionRecord = readRequiredHostedRuntimeObject(
    record.encryption,
    "Hosted workspace snapshot session start encryption",
  );
  const scheme = readRequiredHostedRuntimeString(
    encryptionRecord.scheme,
    "Hosted workspace snapshot scheme",
  );
  if (scheme !== HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME) {
    throw new TypeError("Hosted workspace snapshot scheme is invalid.");
  }
  const limitsRecord = readRequiredHostedRuntimeObject(
    record.limits,
    "Hosted workspace snapshot session start limits",
  );
  const aad = parseHostedWorkspaceSnapshotAad(encryptionRecord.aad);
  const objectKey = readRequiredHostedRuntimeString(record.objectKey, "Hosted workspace snapshot objectKey");
  const snapshotId = readRequiredHostedRuntimeString(record.snapshotId, "Hosted workspace snapshot snapshotId");
  if (aad.objectKey !== objectKey || aad.snapshotId !== snapshotId) {
    throw new TypeError("Hosted workspace snapshot session start response AAD does not match its object binding.");
  }
  if (aad.userId !== boundUserId) {
    throw new TypeError("Hosted workspace snapshot session start response AAD does not match its user binding.");
  }
  return {
    encryption: {
      aad,
      dataKeyBase64: readRequiredHostedRuntimeString(
        encryptionRecord.dataKeyBase64,
        "Hosted workspace snapshot dataKeyBase64",
      ),
      ivBase64: readRequiredHostedRuntimeString(
        encryptionRecord.ivBase64,
        "Hosted workspace snapshot ivBase64",
      ),
      rootKeyId: readRequiredHostedRuntimeString(
        encryptionRecord.rootKeyId,
        "Hosted workspace snapshot rootKeyId",
      ),
      scheme,
      wrappedDataKey: readRequiredHostedRuntimeString(
        encryptionRecord.wrappedDataKey,
        "Hosted workspace snapshot wrappedDataKey",
      ),
    },
    limits: {
      maxSinglePartEncryptedBytes: readRequiredHostedRuntimePositiveInteger(
        limitsRecord.maxSinglePartEncryptedBytes,
        "Hosted workspace snapshot maxSinglePartEncryptedBytes",
      ),
      warnEncryptedBytes: readRequiredHostedRuntimePositiveInteger(
        limitsRecord.warnEncryptedBytes,
        "Hosted workspace snapshot warnEncryptedBytes",
      ),
    },
    objectKey,
    snapshotId,
  };
}

function parseHostedWorkspaceSnapshotPresignedPutPayload(
  value: unknown,
): { expiresAt: string; putUrl: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted workspace snapshot presign response must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    expiresAt: readRequiredHostedRuntimeString(record.expiresAt, "Hosted workspace snapshot presign expiresAt"),
    putUrl: readRequiredHostedRuntimeString(record.putUrl, "Hosted workspace snapshot presign putUrl"),
  };
}

async function presignWorkspaceSnapshotPut(input: {
  encryptedByteSize: number;
  encryptedObjectSha256: string;
  fetchImpl: typeof fetch;
  headers?: Headers;
  objectKey: string;
  snapshotId: string;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): Promise<{ expiresAt: string; putUrl: string }> {
  const headers = input.headers
    ?? await requireHostedRuntimeWriteFenceHeaders(
      input.workspaceCheckpointBridge,
      "Hosted workspace snapshot presign PUT",
    );
  const payload = await fetchHostedJson({
    body: {
      encryptedByteSize: input.encryptedByteSize,
      encryptedObjectSha256: input.encryptedObjectSha256,
      objectKey: input.objectKey,
      snapshotId: input.snapshotId,
    },
    description: "Hosted workspace snapshot presign PUT",
    fetchImpl: input.fetchImpl,
    headers,
    redactedLogPath: "/workspace-snapshots/REDACTED/presign-put",
    method: "POST",
    timeoutMs: input.timeoutMs,
    url: new URL(
      `/workspace-snapshots/${encodeURIComponent(input.snapshotId)}/presign-put`,
      `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
    ),
  });
  return parseHostedWorkspaceSnapshotPresignedPutPayload(payload);
}

async function presignWorkspaceSnapshotGet(input: {
  fetchImpl: typeof fetch;
  objectKey: string;
  ref: HostedWorkspaceSnapshotV2Ref;
  snapshotId: string;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): Promise<{ expiresAt: string; getUrl: string }> {
  const headers = await requireHostedRuntimeWriteFenceHeaders(
    input.workspaceCheckpointBridge,
    "Hosted workspace snapshot presign download",
  );
  const payload = await fetchHostedJson({
    body: {
      objectKey: input.objectKey,
      ref: input.ref,
      snapshotId: input.snapshotId,
    },
    description: "Hosted workspace snapshot presign download",
    fetchImpl: input.fetchImpl,
    headers,
    redactedLogPath: "/workspace-snapshots/REDACTED/presign-get",
    method: "POST",
    timeoutMs: input.timeoutMs,
    url: new URL(
      `/workspace-snapshots/${encodeURIComponent(input.snapshotId)}/presign-get`,
      `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
    ),
  });
  return parseHostedWorkspaceSnapshotPresignedGetPayload(payload);
}

function parseHostedWorkspaceSnapshotPresignedGetPayload(
  value: unknown,
): { expiresAt: string; getUrl: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted workspace snapshot presign response must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    expiresAt: readRequiredHostedRuntimeString(record.expiresAt, "Hosted workspace snapshot presign expiresAt"),
    getUrl: readRequiredHostedRuntimeString(record.getUrl, "Hosted workspace snapshot presign getUrl"),
  };
}

async function unwrapWorkspaceSnapshotDataKey(input: {
  aad: HostedWorkspaceSnapshotV2Aad;
  fetchImpl: typeof fetch;
  rootKeyId: string;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
  wrappedDataKey: string;
}): Promise<string> {
  const headers = await requireHostedRuntimeWriteFenceHeaders(
    input.workspaceCheckpointBridge,
    "Hosted workspace snapshot data key unwrap",
  );
  const payload = await fetchHostedJson({
    body: {
      aad: input.aad,
      rootKeyId: input.rootKeyId,
      wrappedDataKey: input.wrappedDataKey,
    },
    description: "Hosted workspace snapshot data key unwrap",
    fetchImpl: input.fetchImpl,
    headers,
    redactedLogPath: "/workspace-snapshots/REDACTED/data-key/unwrap",
    method: "POST",
    timeoutMs: input.timeoutMs,
    url: new URL(
      `/workspace-snapshots/${encodeURIComponent(input.aad.snapshotId)}/data-key/unwrap`,
      `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
    ),
  });

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Hosted workspace snapshot data key unwrap response must be an object.");
  }
  const dataKey = (payload as Record<string, unknown>).dataKey;
  if (typeof dataKey !== "string" || dataKey.length === 0) {
    throw new TypeError("Hosted workspace snapshot data key unwrap response dataKey is required.");
  }
  const decoded = decodeHostedWorkspaceSnapshotV2DataKey(dataKey);
  decoded.fill(0);
  return dataKey;
}

async function fetchHostedWorkspaceSnapshotEncryptedObjectToFile(input: {
  encryptedFilePath: string;
  expectedEncryptedByteSize: number;
  fetchImpl: typeof fetch;
  getUrl: string;
  timeoutMs: number;
}): Promise<boolean> {
  const response = await fetchHostedResponse({
    description: "Hosted workspace snapshot fetch",
    fetchImpl: input.fetchImpl,
    init: {
      method: "GET",
    },
    redactedLogPath: "/workspace-snapshot-object",
    redactedResponseOrigin: "workspace_snapshot_object",
    timeoutMs: input.timeoutMs,
    url: new URL(input.getUrl),
  });
  if (response.status === 404) {
    return false;
  }
  assertHostedOk(response, "Hosted workspace snapshot fetch");
  if (!response.body) {
    throw new Error("Hosted workspace snapshot fetch response body is unavailable.");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && contentLength !== String(input.expectedEncryptedByteSize)) {
    throw new Error("Hosted workspace snapshot fetch content-length does not match its ref.");
  }
  try {
    await pipeline(
      Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
      createExpectedByteCountTransform({
        expectedBytes: input.expectedEncryptedByteSize,
        label: "Hosted workspace snapshot fetch",
      }),
      createWriteStream(input.encryptedFilePath, { mode: 0o600 }),
    );
  } catch (error) {
    const wrappedError = new HostedRuntimeControlPlaneFetchError({
      cause: error,
      description: "Hosted workspace snapshot fetch response body read",
      signalState: {
        callerSignalAborted: false,
        requestSignalAborted: false,
        timeoutMs: input.timeoutMs,
        timeoutSignalAborted: false,
      },
    });

    if (isRetryableHostedRuntimeReplaySafeReadTransportError(wrappedError)) {
      throw wrappedError;
    }

    throw error;
  }
  return true;
}

function createExpectedByteCountTransform(input: {
  expectedBytes: number;
  label: string;
}): Transform {
  let byteCount = 0;
  return new Transform({
    flush(callback) {
      if (byteCount !== input.expectedBytes) {
        callback(new Error(`${input.label} byte count does not match its ref.`));
        return;
      }
      callback();
    },
    transform(chunk: Buffer, _encoding, callback) {
      byteCount += chunk.byteLength;
      if (byteCount > input.expectedBytes) {
        callback(new Error(`${input.label} exceeded its ref byte count.`));
        return;
      }
      callback(null, chunk);
    },
  });
}

function parseHostedWorkspaceSnapshotCompletePayload(
  value: unknown,
): {
  checkpoint: HostedWorkspaceCheckpointResponse;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted workspace snapshot complete response must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    checkpoint: parseHostedWorkspaceCheckpointResponse(record.checkpoint),
    snapshotRef: parseHostedWorkspaceSnapshotV2Ref(
      record.snapshotRef,
      "Hosted workspace snapshot complete response snapshotRef",
    ),
  };
}

function parseHostedWorkspaceSnapshotAad(value: unknown): HostedWorkspaceSnapshotV2Aad {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted workspace snapshot AAD must be an object.");
  }
  const record = value as Record<string, unknown>;
  const purpose = readRequiredHostedRuntimeString(
    record.purpose,
    "Hosted workspace snapshot AAD purpose",
  );
  const schema = readRequiredHostedRuntimeString(
    record.schema,
    "Hosted workspace snapshot AAD schema",
  );
  if (purpose !== HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE) {
    throw new TypeError("Hosted workspace snapshot AAD purpose is invalid.");
  }
  if (schema !== HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA) {
    throw new TypeError("Hosted workspace snapshot AAD schema is invalid.");
  }
  return {
    objectKey: readRequiredHostedRuntimeString(record.objectKey, "Hosted workspace snapshot AAD objectKey"),
    purpose,
    schema,
    snapshotId: readRequiredHostedRuntimeString(record.snapshotId, "Hosted workspace snapshot AAD snapshotId"),
    userId: readRequiredHostedRuntimeString(record.userId, "Hosted workspace snapshot AAD userId"),
  };
}
