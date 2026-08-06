import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import type {
  HostedRuntimePlatform,
  HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails,
  HostedRuntimeWorkspaceSnapshotRestoreTimingDetails,
  HostedRuntimeWorkspaceSnapshotSessionStart,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { parseHostedWorkspaceCheckpointResponse, parseHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import type { HostedWorkspaceCheckpointResponse } from "@murphai/hosted-execution/runtime-control";
import {
  decodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
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
  HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION,
  HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION_HEADER,
} from "../workspace-snapshot-store.ts";
import { restoreEncryptedWorkspaceSnapshotFromEncryptedStream } from "../workspace-snapshot-local.ts";
import {
  requireHostedWorkspaceSnapshotPreparedRestoreForRef,
  type HostedWorkspaceSnapshotPreparedRestore,
} from "../workspace-snapshot-restore-preparation.ts";
import { requireHostedRuntimeWriteFenceHeaders, type HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import {
  buildHostedWorkspaceSnapshotRestoreLogDetails,
  readHostedRuntimeStepElapsedMs,
  runHostedWorkspaceSnapshotRestoreReplaySafeReadStep,
  runHostedWorkspaceSnapshotRestoreStep,
} from "./diagnostics.ts";
import { readHostedRuntimeResponseBodyChunks } from "./hosted-response-body.ts";
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
  preparedSnapshotRestore?: HostedWorkspaceSnapshotPreparedRestore | null;
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
          exposeResponseBodyInError: false,
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
          exposeResponseBodyInError: false,
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
      assertHostedWorkspaceSnapshotOperationLive(request.signal);
      if (!Number.isSafeInteger(request.encryptedByteSize) || request.encryptedByteSize <= 0) {
        throw new TypeError("Hosted workspace snapshot encryptedByteSize must be a positive safe integer.");
      }
      const timings: HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails = {};
      const source = await stat(request.sourceFilePath);
      assertHostedWorkspaceSnapshotOperationLive(request.signal);
      if (source.size !== request.encryptedByteSize) {
        throw new Error("Hosted workspace snapshot source file size does not match encryptedByteSize.");
      }
      const presignStartedAt = Date.now();
      let presignedPut: { expiresAt: string; putUrl: string };
      try {
        presignedPut = await presignWorkspaceSnapshotPut({
          encryptedByteSize: request.encryptedByteSize,
          encryptedObjectSha256: request.encryptedObjectSha256,
          fetchImpl: input.fetchImpl,
          headers: await readSessionWriteFenceHeaders(
            request.snapshotId,
            "Hosted workspace snapshot presign PUT",
          ),
          objectKey: request.objectKey,
          signal: request.signal,
          snapshotId: request.snapshotId,
          timeoutMs: input.timeoutMs,
          workspaceCheckpointBridge: input.workspaceCheckpointBridge,
        });
      } catch (error) {
        assertHostedWorkspaceSnapshotOperationLive(request.signal);
        throw error;
      }
      assertHostedWorkspaceSnapshotOperationLive(request.signal);
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
      let response: Response;
      try {
        response = await fetchHostedResponse({
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
          signal: request.signal,
          timeoutMs: putTimeoutMs,
          url: new URL(presignedPut.putUrl),
        });
      } catch (error) {
        assertHostedWorkspaceSnapshotOperationLive(request.signal);
        throw new Error(
          "Hosted workspace snapshot direct R2 upload is not resumable after a transport failure; "
          + "abandon this snapshot session and start a fresh snapshot before retrying.",
          { cause: error },
        );
      }
      timings.snapshotDirectR2PutElapsedMs =
        readHostedRuntimeStepElapsedMs(putStartedAt);
      assertHostedWorkspaceSnapshotOperationLive(request.signal);
      try {
        assertHostedOk(response, "Hosted workspace snapshot direct R2 upload");
      } catch (error) {
        throw new Error(
          `Hosted workspace snapshot direct R2 upload is not resumable after HTTP ${response.status}; `
          + "abandon this snapshot session and start a fresh snapshot before retrying.",
          { cause: error },
        );
      }
      return timings;
    },

    async restoreWorkspaceSnapshot(request) {
      const restoreLogDetails = buildHostedWorkspaceSnapshotRestoreLogDetails({
        ref: request.ref,
        timeoutMs: input.timeoutMs,
      });
      // Per-step timers wrap each restore step at the port level so they capture
      // the TOTAL wall-clock for that step including any replay-safe retries — the
      // latency a user actually waits on. This intentionally differs from the inner
      // runHostedWorkspaceSnapshotRestoreStep log duration, which is per-attempt;
      // do not collapse these into the helper's elapsed or retry time is lost.
      const timing: HostedRuntimeWorkspaceSnapshotRestoreTimingDetails = {
        encryptedBytes: request.ref.archive.encryptedByteSize,
        plainBytes: request.ref.archive.totalPlainBytes,
      };
      const sizeGuardStartedAt = Date.now();
      await runHostedWorkspaceSnapshotRestoreStep({
        details: restoreLogDetails,
        run: async () => {
          if (request.ref.archive.encryptedByteSize >= HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES) {
            throw new RangeError("Hosted workspace snapshot restore exceeds the single-part size guard.");
          }
          if (request.ref.archive.totalPlainBytes >= HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES) {
            throw new RangeError("Hosted workspace snapshot restore exceeds the total plain size guard.");
          }
        },
        step: "size_guard",
      });
      timing.sizeGuardMs = readHostedRuntimeStepElapsedMs(sizeGuardStartedAt);

      let dataKey: string;
      let compatibilityGet: { expiresAtMs: number; getUrl: string } | null = null;
      if (input.preparedSnapshotRestore) {
        const prepared = requireHostedWorkspaceSnapshotPreparedRestoreForRef({
          prepared: input.preparedSnapshotRestore,
          ref: request.ref,
        });
        dataKey = prepared.dataKey;
        compatibilityGet = prepared.compatibilityGet;
        timing.dataKeyUnwrapMs = 0;
        timing.presignGetMs = 0;
      } else {
        const dataKeyUnwrapStartedAt = Date.now();
        const dataKeyPromise = runHostedWorkspaceSnapshotRestoreReplaySafeReadStep({
          details: restoreLogDetails,
          run: async () => await unwrapWorkspaceSnapshotDataKey({
            aad: request.ref.encryption.aad,
            fetchImpl: input.fetchImpl,
            rootKeyId: request.ref.encryption.rootKeyId,
            signal: request.signal ?? null,
            timeoutMs: input.timeoutMs,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge,
            wrappedDataKey: request.ref.encryption.wrappedDataKey,
          }),
          step: "data_key_unwrap",
        }).finally(() => {
          timing.dataKeyUnwrapMs = readHostedRuntimeStepElapsedMs(dataKeyUnwrapStartedAt);
        });

        dataKey = await dataKeyPromise;
        timing.presignGetMs = 0;
      }

      const objectFetchStartedAt = Date.now();
      const archiveTimings = await runHostedWorkspaceSnapshotRestoreReplaySafeReadStep({
        details: restoreLogDetails,
        run: async () => {
          const objectFetchAttemptTiming = {
            objectFetchResponseHeadersMs: 0,
            objectFetchBodyReadMs: 0,
          };
          const objectFetchTimeoutMs = input.timeoutMs;
          const objectFetchDeadlineMs = Date.now() + objectFetchTimeoutMs;
          const encryptedStream = readHostedWorkspaceSnapshotEncryptedObjectStream({
            compatibilityGet,
            deadlineMs: objectFetchDeadlineMs,
            expectedEncryptedByteSize: request.ref.archive.encryptedByteSize,
            fetchImpl: input.fetchImpl,
            onCompatibilityPresignElapsedMs(elapsedMs) {
              timing.presignGetMs = (timing.presignGetMs ?? 0) + elapsedMs;
            },
            ref: request.ref,
            signal: request.signal ?? null,
            timing: objectFetchAttemptTiming,
            timeoutMs: objectFetchTimeoutMs,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge,
          });
          const archiveRestoreTiming =
            await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
              dataKey,
              durableRoot: request.durableRoot,
              encryptedStream,
              ref: request.ref,
              signal: request.signal ?? null,
            });
          // Keep the subspans attempt-local: failed replay-safe attempts never
          // leak partial values into the successful restore diagnostics.
          timing.objectFetchResponseHeadersMs =
            objectFetchAttemptTiming.objectFetchResponseHeadersMs;
          timing.objectFetchBodyReadMs = objectFetchAttemptTiming.objectFetchBodyReadMs;
          return archiveRestoreTiming;
        },
        step: "object_fetch",
      });
      timing.objectFetchMs = readHostedRuntimeStepElapsedMs(objectFetchStartedAt);
      timing.decryptMs = archiveTimings.decryptMs;
      timing.archiveExtractMs = archiveTimings.archiveExtractMs;
      timing.durableRootReplaceMs = archiveTimings.durableRootReplaceMs;
      timing.cleanupMs = archiveTimings.cleanupMs;
      timing.extractMs = archiveTimings.extractMs;
      return timing;
    },

    async startSnapshotSession({ signal, ...request }) {
      assertHostedWorkspaceSnapshotOperationLive(signal);
      const headers = await requireHostedRuntimeWriteFenceHeaders(
        input.workspaceCheckpointBridge,
        "Hosted workspace snapshot session start",
      );
      assertHostedWorkspaceSnapshotOperationLive(signal);
      let payload: unknown;
      try {
        payload = await fetchHostedJson({
          body: request,
          description: "Hosted workspace snapshot session start",
          exposeResponseBodyInError: false,
          fetchImpl: input.fetchImpl,
          headers,
          method: "POST",
          signal,
          timeoutMs: input.timeoutMs,
          url: new URL(
            "/workspace-snapshots/start",
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
          ),
        });
      } catch (error) {
        assertHostedWorkspaceSnapshotOperationLive(signal);
        throw error;
      }
      assertHostedWorkspaceSnapshotOperationLive(signal);
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
  signal?: AbortSignal | null;
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
    exposeResponseBodyInError: false,
    fetchImpl: input.fetchImpl,
    headers,
    redactedLogPath: "/workspace-snapshots/REDACTED/presign-put",
    method: "POST",
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs,
    url: new URL(
      `/workspace-snapshots/${encodeURIComponent(input.snapshotId)}/presign-put`,
      `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
    ),
  });
  return parseHostedWorkspaceSnapshotPresignedPutPayload(payload);
}

function assertHostedWorkspaceSnapshotOperationLive(
  signal: AbortSignal | null | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted workspace snapshot direct upload was interrupted.");
}

async function presignWorkspaceSnapshotGet(input: {
  fetchImpl: typeof fetch;
  objectKey: string;
  ref: HostedWorkspaceSnapshotV2Ref;
  signal?: AbortSignal | null;
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
    exposeResponseBodyInError: false,
    fetchImpl: input.fetchImpl,
    headers,
    redactedLogPath: "/workspace-snapshots/REDACTED/presign-get",
    method: "POST",
    signal: input.signal ?? null,
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
  signal?: AbortSignal | null;
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
    exposeResponseBodyInError: false,
    fetchImpl: input.fetchImpl,
    headers,
    redactedLogPath: "/workspace-snapshots/REDACTED/data-key/unwrap",
    method: "POST",
    signal: input.signal ?? null,
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

async function* readHostedWorkspaceSnapshotEncryptedObjectStream(input: {
  compatibilityGet: { expiresAtMs: number; getUrl: string } | null;
  deadlineMs: number;
  expectedEncryptedByteSize: number;
  fetchImpl: typeof fetch;
  onCompatibilityPresignElapsedMs: (elapsedMs: number) => void;
  ref: HostedWorkspaceSnapshotV2Ref;
  signal?: AbortSignal | null;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): AsyncIterable<Uint8Array> {
  const headers = await requireHostedRuntimeWriteFenceHeaders(
    input.workspaceCheckpointBridge,
    "Hosted workspace snapshot object read",
  );
  headers.set("content-type", "application/json; charset=utf-8");
  const response = await fetchHostedResponse({
    description: "Hosted workspace snapshot fetch",
    fetchImpl: input.fetchImpl,
    init: {
      body: JSON.stringify({
        objectKey: input.ref.objectKey,
        ref: input.ref,
        snapshotId: input.ref.snapshotId,
      }),
      headers,
      method: "POST",
    },
    redactedLogPath: "/workspace-snapshots/REDACTED/object",
    redactedResponseOrigin: "workspace_snapshot_object",
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs,
    url: new URL(
      `/workspace-snapshots/${encodeURIComponent(input.ref.snapshotId)}/object`,
      `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
    ),
  });
  const responseVersion = response.headers.get(
    HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION_HEADER,
  );
  // Compatibility Workers cannot mark this route, whether their router returns
  // 404/405 directly or an older proxy normalizes that miss to another error.
  // A current Worker marks every handled response, so its failures stay closed.
  if (
    responseVersion === null
    && !response.ok
  ) {
    await cancelHostedWorkspaceSnapshotResponseBody(response.body);
    const compatibilityGet = input.compatibilityGet
      ?? await presignWorkspaceSnapshotCompatibilityGet(input);
    yield* readHostedWorkspaceSnapshotEncryptedCompatibilityStream({
      ...input,
      compatibilityGet,
    });
    return;
  }
  if (
    responseVersion !== HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION
  ) {
    await cancelHostedWorkspaceSnapshotResponseBody(response.body);
    throw new Error("Hosted workspace snapshot object read version is unsupported.");
  }
  yield* readHostedWorkspaceSnapshotEncryptedResponseStream({
    ...input,
    response,
  });
}

async function presignWorkspaceSnapshotCompatibilityGet(input: {
  fetchImpl: typeof fetch;
  onCompatibilityPresignElapsedMs: (elapsedMs: number) => void;
  ref: HostedWorkspaceSnapshotV2Ref;
  signal?: AbortSignal | null;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): Promise<{ expiresAtMs: number; getUrl: string }> {
  const startedAt = Date.now();
  try {
    const result = await presignWorkspaceSnapshotGet({
      fetchImpl: input.fetchImpl,
      objectKey: input.ref.objectKey,
      ref: input.ref,
      signal: input.signal ?? null,
      snapshotId: input.ref.snapshotId,
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
  } finally {
    input.onCompatibilityPresignElapsedMs(readHostedRuntimeStepElapsedMs(startedAt));
  }
}

async function* readHostedWorkspaceSnapshotEncryptedCompatibilityStream(input: {
  compatibilityGet: { expiresAtMs: number; getUrl: string };
  deadlineMs: number;
  expectedEncryptedByteSize: number;
  fetchImpl: typeof fetch;
  signal?: AbortSignal | null;
  timing: {
    objectFetchResponseHeadersMs: number;
    objectFetchBodyReadMs: number;
  };
  timeoutMs: number;
}): AsyncIterable<Uint8Array> {
  const compatibilityTimeoutMs = Math.max(
    1,
    input.compatibilityGet.expiresAtMs - Date.now() - 5_000,
  );
  const responseHeadersStartedAt = Date.now();
  const response = await fetchHostedResponse({
    description: "Hosted workspace snapshot fetch",
    fetchImpl: input.fetchImpl,
    init: {
      method: "GET",
    },
    redactedLogPath: "/workspace-snapshot-object",
    redactedResponseOrigin: "workspace_snapshot_object",
    signal: input.signal ?? null,
    timeoutMs: compatibilityTimeoutMs,
    url: new URL(input.compatibilityGet.getUrl),
  });
  input.timing.objectFetchResponseHeadersMs =
    readHostedRuntimeStepElapsedMs(responseHeadersStartedAt);
  yield* readHostedWorkspaceSnapshotEncryptedResponseStream({
    ...input,
    deadlineMs: Date.now() + compatibilityTimeoutMs,
    response,
  });
}

async function* readHostedWorkspaceSnapshotEncryptedResponseStream(input: {
  deadlineMs: number;
  expectedEncryptedByteSize: number;
  response: Response;
  signal?: AbortSignal | null;
  timing: {
    objectFetchResponseHeadersMs: number;
    objectFetchBodyReadMs: number;
  };
}): AsyncIterable<Uint8Array> {
  const { response } = input;
  if (response.status === 404) {
    await cancelHostedWorkspaceSnapshotResponseBody(response.body);
    throw new Error("Hosted workspace snapshot encrypted object is unavailable.");
  }
  if (!response.ok) {
    await cancelHostedWorkspaceSnapshotResponseBody(response.body);
  }
  assertHostedOk(response, "Hosted workspace snapshot fetch");
  if (!response.body) {
    throw new Error("Hosted workspace snapshot fetch response body is unavailable.");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && contentLength !== String(input.expectedEncryptedByteSize)) {
    await cancelHostedWorkspaceSnapshotResponseBody(response.body);
    throw new Error("Hosted workspace snapshot fetch content-length does not match its ref.");
  }
  const bodyReadStartedAt = Date.now();
  let byteCount = 0;
  for await (const next of readHostedRuntimeResponseBodyChunks({
    body: response.body,
    description: "Hosted workspace snapshot fetch",
    signal: input.signal ?? null,
    timeoutMs: Math.max(1, input.deadlineMs - Date.now()),
  })) {
    byteCount += next.byteLength;
    if (byteCount > input.expectedEncryptedByteSize) {
      throw new Error("Hosted workspace snapshot fetch exceeded its ref byte count.");
    }
    yield next;
  }
  if (byteCount !== input.expectedEncryptedByteSize) {
    throw new Error("Hosted workspace snapshot fetch byte count does not match its ref.");
  }
  input.timing.objectFetchBodyReadMs = readHostedRuntimeStepElapsedMs(bodyReadStartedAt);
}

async function cancelHostedWorkspaceSnapshotResponseBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Best-effort cleanup only; preserve the original restore failure.
  }
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
