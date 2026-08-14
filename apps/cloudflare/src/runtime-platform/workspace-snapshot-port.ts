import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import type {
  HostedRuntimePlatform,
  HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails,
  HostedRuntimeWorkspaceSnapshotRestoreTimingDetails,
  HostedRuntimeWorkspaceSnapshotSessionStart,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { readHostedRuntimeSafeErrorText } from "@murphai/hosted-execution";
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
  HOSTED_WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_STALE_MS,
} from "../workspace-snapshot-store.ts";
import { restoreEncryptedWorkspaceSnapshotFromEncryptedStream } from "../workspace-snapshot-local.ts";
import {
  requireHostedWorkspaceSnapshotPreparedRestoreForRef,
  type HostedWorkspaceSnapshotPreparedRestore,
} from "../workspace-snapshot-restore-preparation.ts";
import { requireHostedRuntimeWriteFenceHeaders, type HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import {
  combineAbortSignalsWithCleanup,
  isRetryableHostedRuntimeReplaySafeReadTransportError,
  readHostedRuntimeControlPlaneFetchFailureDiagnostics,
} from "./control-plane-fetch.ts";
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

const WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_INTERVAL_MS = 2_000;
const WORKSPACE_SNAPSHOT_PRESIGN_PUT_MAX_ATTEMPTS = 2;
const WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_TIMEOUT_MS = 2_000;
const WORKSPACE_SNAPSHOT_R2_ERROR_BODY_MAX_BYTES = 16 * 1024;
const WORKSPACE_SNAPSHOT_R2_ERROR_BODY_READ_TIMEOUT_MS = 1_000;
const WORKSPACE_SNAPSHOT_R2_PUT_MAX_ATTEMPTS = 2;
// Space same-key conditional writes by at least one second and leave the retry
// a non-trivial request window inside the original presigned deadline.
const WORKSPACE_SNAPSHOT_R2_PUT_RETRY_MIN_DELAY_MS = 1_000;
const WORKSPACE_SNAPSHOT_R2_PUT_RETRY_MAX_DELAY_MS = 1_500;
const WORKSPACE_SNAPSHOT_R2_PUT_RETRY_MIN_REQUEST_WINDOW_MS = 1_000;
const WORKSPACE_SNAPSHOT_R2_PUT_RETRYABLE_ERROR_CODES = new Set([
  "BadDigest",
  "ClientDisconnect",
  "IncompleteBody",
  "InternalError",
  "ServiceUnavailable",
  "TooManyRequests",
]);
const WORKSPACE_SNAPSHOT_R2_PUT_RETRYABLE_STATUSES = new Set([
  429,
  500,
  503,
]);
// Session creation records the server heartbeat before its response reaches the
// runtime. Cap that handshake so an immediate first heartbeat still has one
// full cadence of margin before replacement may consider the session stale.
const WORKSPACE_SNAPSHOT_HANDOFF_START_TIMEOUT_MS =
  HOSTED_WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_STALE_MS
  - WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_TIMEOUT_MS
  - WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_INTERVAL_MS;

export function createCloudflareWorkspaceSnapshotPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  preparedSnapshotRestore?: HostedWorkspaceSnapshotPreparedRestore | null;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): NonNullable<HostedRuntimePlatform["workspaceSnapshotPort"]> {
  const sessionRuntimeState = new Map<string, {
    headers: Headers;
    signal: AbortSignal | null;
  }>();
  const sessionHeartbeatStops = new Map<string, () => void>();
  const readSessionWriteFenceHeaders = async (
    snapshotId: string,
    description: string,
  ): Promise<Headers> => {
    const stored = sessionRuntimeState.get(snapshotId)?.headers;
    if (stored) {
      return new Headers(stored);
    }
    return await requireHostedRuntimeWriteFenceHeaders(
      input.workspaceCheckpointBridge,
      description,
    );
  };
  const stopSessionHeartbeat = (snapshotId: string): void => {
    sessionHeartbeatStops.get(snapshotId)?.();
    sessionHeartbeatStops.delete(snapshotId);
  };
  const startSessionHeartbeat = (
    snapshotId: string,
    headers: Headers,
    signal?: AbortSignal | null,
  ): void => {
    stopSessionHeartbeat(snapshotId);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failureLogged = false;
    const schedule = (delayMs: number) => {
      if (stopped) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void heartbeat();
      }, delayMs);
    };
    const heartbeat = async () => {
      const startedAtMs = Date.now();
      try {
        await fetchHostedJson({
          body: { snapshotId },
          description: "Hosted workspace snapshot handoff heartbeat",
          exposeResponseBodyInError: false,
          fetchImpl: input.fetchImpl,
          headers: new Headers(headers),
          method: "POST",
          redactedLogPath: "/workspace-snapshots/REDACTED/heartbeat",
          signal: signal ?? null,
          timeoutMs: Math.min(
            input.timeoutMs,
            WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_TIMEOUT_MS,
          ),
          url: new URL(
            `/workspace-snapshots/${encodeURIComponent(snapshotId)}/heartbeat`,
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
          ),
        });
        failureLogged = false;
      } catch (error) {
        if (!stopped && signal?.aborted !== true && !failureLogged) {
          failureLogged = true;
          console.warn("Hosted workspace snapshot handoff heartbeat failed.", {
            errorName: error instanceof Error ? error.name : typeof error,
          });
        }
      } finally {
        schedule(Math.max(
          0,
          WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_INTERVAL_MS
          - (Date.now() - startedAtMs),
        ));
      }
    };
    const stopForAbort = () => {
      stopSessionHeartbeat(snapshotId);
    };
    const stop = () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      signal?.removeEventListener("abort", stopForAbort);
    };
    sessionHeartbeatStops.set(snapshotId, stop);
    if (signal?.aborted) {
      stopSessionHeartbeat(snapshotId);
      return;
    }
    signal?.addEventListener("abort", stopForAbort, { once: true });
    void heartbeat();
  };
  const port: NonNullable<HostedRuntimePlatform["workspaceSnapshotPort"]> = {
    async abortSnapshotSession(request) {
      stopSessionHeartbeat(request.snapshotId);
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
        sessionRuntimeState.delete(request.snapshotId);
      }
    },

    async completeSnapshotSession(request) {
      const snapshotId = request.ref.snapshotId;
      const headers = await readSessionWriteFenceHeaders(
        snapshotId,
        "Hosted workspace snapshot complete",
      );
      headers.set("content-type", "application/json; charset=utf-8");
      // Canonical publication stays non-interruptible once `/complete` starts.
      // The session signal only prevents replay after foreground cancellation.
      const sessionCancellationSignal =
        sessionRuntimeState.get(snapshotId)?.signal ?? null;
      const body = JSON.stringify({
        archive: request.ref.archive,
        checkpointRequest: request.checkpointRequest,
        objectKey: request.ref.objectKey,
        snapshotId,
      });
      const url = new URL(
        `/workspace-snapshots/${encodeURIComponent(snapshotId)}/complete`,
        `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
      );
      const deadlineMs = Date.now() + input.timeoutMs;
      const complete = async (timeoutMs: number): Promise<unknown> => {
        const response = await fetchHostedResponse({
          description: "Hosted workspace snapshot complete",
          fetchImpl: input.fetchImpl,
          init: {
            body,
            headers,
            method: "POST",
          },
          redactedLogPath: "/workspace-snapshots/REDACTED/complete",
          timeoutMs,
          url,
        });
        if (!response.ok) {
          await cancelHostedWorkspaceSnapshotResponseBody(response.body);
        }
        assertHostedOk(response, "Hosted workspace snapshot complete");
        return await readHostedWorkspaceSnapshotCompleteResponsePayload({
          deadlineMs,
          response,
        });
      };
      let payload: unknown;
      try {
        try {
          payload = await complete(Math.max(0, deadlineMs - Date.now()));
        } catch (error) {
          assertHostedWorkspaceSnapshotOperationLive(sessionCancellationSignal);
          const replayTimeoutMs = deadlineMs - Date.now();
          if (
            replayTimeoutMs <= 0
            || !isRetryableHostedRuntimeReplaySafeReadTransportError(error)
          ) {
            throw error;
          }
          try {
            payload = await complete(replayTimeoutMs);
          } catch (replayError) {
            assertHostedWorkspaceSnapshotOperationLive(sessionCancellationSignal);
            throw replayError;
          }
        }
      } finally {
        stopSessionHeartbeat(snapshotId);
        sessionRuntimeState.delete(snapshotId);
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
      let precedingAttemptWasAmbiguous = false;
      for (
        let attempt = 1;
        attempt <= WORKSPACE_SNAPSHOT_R2_PUT_MAX_ATTEMPTS;
        attempt += 1
      ) {
        assertHostedWorkspaceSnapshotOperationLive(request.signal);
        const putTimeoutMs = expiresAtMs - Date.now();
        if (putTimeoutMs <= 0) {
          throw new Error("Hosted workspace snapshot direct R2 upload URL is expired.");
        }
        const body = Readable.toWeb(
          createReadStream(request.sourceFilePath),
        ) as ReadableStream<Uint8Array>;
        let response: Response;
        try {
          response = await fetchHostedResponse({
            description: "Hosted workspace snapshot direct R2 upload",
            fetchImpl: input.fetchImpl,
            init: {
              body: body as BodyInit,
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
          await cancelHostedWorkspaceSnapshotResponseBody(body);
          const terminalError = new Error(
            "Hosted workspace snapshot direct R2 upload is not resumable after a transport failure; "
            + "abandon this snapshot session and start a fresh snapshot before retrying.",
            { cause: error },
          );
          if (
            attempt >= WORKSPACE_SNAPSHOT_R2_PUT_MAX_ATTEMPTS
            || !isRetryableHostedWorkspaceSnapshotR2TransportFailure(error)
          ) {
            throw terminalError;
          }
          const retryWithinDeadline =
            await waitForHostedWorkspaceSnapshotR2PutRetry({
              expiresAtMs,
              signal: request.signal,
            });
          if (!retryWithinDeadline) {
            throw terminalError;
          }
          precedingAttemptWasAmbiguous = true;
          continue;
        }

        assertHostedWorkspaceSnapshotOperationLive(request.signal);
        if (response.ok) {
          timings.snapshotDirectR2PutElapsedMs =
            readHostedRuntimeStepElapsedMs(putStartedAt);
          return timings;
        }
        if (
          response.status === 412
          && attempt > 1
          && precedingAttemptWasAmbiguous
        ) {
          await cancelHostedWorkspaceSnapshotResponseBody(response.body);
          assertHostedWorkspaceSnapshotOperationLive(request.signal);
          timings.snapshotDirectR2PutElapsedMs =
            readHostedRuntimeStepElapsedMs(putStartedAt);
          return timings;
        }

        const r2FailureDiagnostics =
          await readHostedWorkspaceSnapshotR2FailureDiagnostics({
            response,
            signal: request.signal,
            timeoutMs: Math.min(
              WORKSPACE_SNAPSHOT_R2_ERROR_BODY_READ_TIMEOUT_MS,
              input.timeoutMs,
            ),
          });
        assertHostedWorkspaceSnapshotOperationLive(request.signal);
        let responseError: unknown;
        try {
          assertHostedOk(response, "Hosted workspace snapshot direct R2 upload");
        } catch (error) {
          responseError = error;
        }
        const terminalError = new Error(
          `Hosted workspace snapshot direct R2 upload is not resumable after HTTP ${response.status}; `
          + "abandon this snapshot session and start a fresh snapshot before retrying.",
          {
            cause: buildHostedWorkspaceSnapshotR2FailureError({
              cause: responseError,
              diagnostics: r2FailureDiagnostics,
              status: response.status,
            }),
          },
        );
        if (
          attempt >= WORKSPACE_SNAPSHOT_R2_PUT_MAX_ATTEMPTS
          || response.status === 412
          || !isRetryableHostedWorkspaceSnapshotR2Response({
            diagnostics: r2FailureDiagnostics,
            status: response.status,
          })
        ) {
          throw terminalError;
        }
        const retryWithinDeadline =
          await waitForHostedWorkspaceSnapshotR2PutRetry({
            expiresAtMs,
            signal: request.signal,
          });
        if (!retryWithinDeadline) {
          throw terminalError;
        }
        precedingAttemptWasAmbiguous = false;
      }

      throw new Error("Hosted workspace snapshot direct R2 upload exhausted its attempt bound.");
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
      const noteReplaySafeReadAttempt = (attempt: number): void => {
        timing.replaySafeReadMaxAttempt = Math.max(
          timing.replaySafeReadMaxAttempt ?? 0,
          attempt,
        );
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
      let presignedGet: { expiresAtMs: number; getUrl: string };
      if (input.preparedSnapshotRestore) {
        const prepared = requireHostedWorkspaceSnapshotPreparedRestoreForRef({
          prepared: input.preparedSnapshotRestore,
          ref: request.ref,
        });
        dataKey = prepared.dataKey;
        presignedGet = {
          expiresAtMs: prepared.expiresAtMs,
          getUrl: prepared.getUrl,
        };
        timing.dataKeyUnwrapMs = 0;
        timing.presignGetMs = 0;
      } else {
        const dataKeyUnwrapStartedAt = Date.now();
        const dataKeyPromise = runHostedWorkspaceSnapshotRestoreReplaySafeReadStep({
          details: restoreLogDetails,
          onAttempt: noteReplaySafeReadAttempt,
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

        const presignGetStartedAt = Date.now();
        const presignedGetPromise = runHostedWorkspaceSnapshotRestoreReplaySafeReadStep({
          details: restoreLogDetails,
          onAttempt: noteReplaySafeReadAttempt,
          run: async () => {
            const result = await presignWorkspaceSnapshotGet({
              fetchImpl: input.fetchImpl,
              objectKey: request.ref.objectKey,
              ref: request.ref,
              signal: request.signal ?? null,
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
        }).finally(() => {
          timing.presignGetMs = readHostedRuntimeStepElapsedMs(presignGetStartedAt);
        });

        [dataKey, presignedGet] = await Promise.all([
          dataKeyPromise,
          presignedGetPromise,
        ]);
      }

      const objectFetchStartedAt = Date.now();
      const archiveTimings = await runHostedWorkspaceSnapshotRestoreReplaySafeReadStep({
        details: restoreLogDetails,
        onAttempt: noteReplaySafeReadAttempt,
        run: async () => {
          const objectFetchAttemptTiming = {
            objectFetchResponseHeadersMs: 0,
            objectFetchBodyReadMs: 0,
          };
          const objectFetchTimeoutMs =
            Math.max(1, presignedGet.expiresAtMs - Date.now() - 5_000);
          const objectFetchDeadlineMs = Date.now() + objectFetchTimeoutMs;
          const encryptedStream = readHostedWorkspaceSnapshotEncryptedObjectStream({
            deadlineMs: objectFetchDeadlineMs,
            expectedEncryptedByteSize: request.ref.archive.encryptedByteSize,
            fetchImpl: input.fetchImpl,
            getUrl: presignedGet.getUrl,
            signal: request.signal ?? null,
            timing: objectFetchAttemptTiming,
            timeoutMs: objectFetchTimeoutMs,
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
      const startTimeoutMs = Math.min(
        input.timeoutMs,
        WORKSPACE_SNAPSHOT_HANDOFF_START_TIMEOUT_MS,
      );
      const startSignal = combineAbortSignalsWithCleanup(
        signal ?? null,
        AbortSignal.timeout(startTimeoutMs),
      );
      let payload: unknown;
      try {
        payload = await fetchHostedJson({
          body: request,
          description: "Hosted workspace snapshot session start",
          exposeResponseBodyInError: false,
          fetchImpl: input.fetchImpl,
          headers,
          method: "POST",
          signal: startSignal.signal,
          timeoutMs: startTimeoutMs,
          url: new URL(
            "/workspace-snapshots/start",
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
          ),
        });
      } catch (error) {
        assertHostedWorkspaceSnapshotOperationLive(signal);
        throw error;
      } finally {
        startSignal.dispose();
      }
      assertHostedWorkspaceSnapshotOperationLive(signal);
      const started = parseHostedWorkspaceSnapshotStartPayload(payload, input.boundUserId);
      sessionRuntimeState.set(started.snapshotId, {
        headers: new Headers(headers),
        signal: signal ?? null,
      });
      startSessionHeartbeat(started.snapshotId, headers, signal);
      return started;
    },
  };
  return port;
}

interface HostedWorkspaceSnapshotR2FailureDiagnostics {
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
}

function isRetryableHostedWorkspaceSnapshotR2TransportFailure(
  error: unknown,
): boolean {
  const diagnostics = readHostedRuntimeControlPlaneFetchFailureDiagnostics(error);
  if (
    !diagnostics
    || diagnostics.fetchCallerSignalAborted
    || diagnostics.fetchRequestSignalAborted
    || diagnostics.fetchTimeoutSignalAborted
  ) {
    return false;
  }

  return areHostedWorkspaceSnapshotR2NestedCausesRetryable(error)
    && (
      diagnostics.fetchCauseKind === "cloudflare_rpc_destroy"
      || diagnostics.fetchCauseKind === "fetch_failed"
      || diagnostics.fetchCauseKind === "network"
    );
}

const WORKSPACE_SNAPSHOT_R2_RETRYABLE_NESTED_TRANSPORT_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
]);

function areHostedWorkspaceSnapshotR2NestedCausesRetryable(
  error: unknown,
): boolean {
  const fetchError = readHostedWorkspaceSnapshotErrorCause(error);
  let current = readHostedWorkspaceSnapshotErrorCause(fetchError);
  const seen = new Set<unknown>();
  let depth = 0;

  while (
    current
    && typeof current === "object"
    && !seen.has(current)
    && depth < 8
  ) {
    seen.add(current);
    depth += 1;
    const record = current as Record<string, unknown>;
    const name = current instanceof Error ? current.name : "";
    const message = current instanceof Error
      ? current.message.trim().toLowerCase()
      : "";
    const code = typeof record.code === "string"
      ? record.code.trim().toUpperCase()
      : "";
    const isRemoteTransportCause =
      WORKSPACE_SNAPSHOT_R2_RETRYABLE_NESTED_TRANSPORT_CODES.has(code)
      || message === "the rpc call destroy() was called"
      || message.includes("network")
      || message.includes("socket")
      || message.includes("connection reset")
      || message.includes("connection closed")
      || message.includes("broken pipe");
    if (
      name === "AbortError"
      || name === "TimeoutError"
      || message.includes("abort")
      || message.includes("timed out")
      || message.includes("timeout")
      || !isRemoteTransportCause
    ) {
      return false;
    }
    current = readHostedWorkspaceSnapshotErrorCause(current);
  }

  return true;
}

function readHostedWorkspaceSnapshotErrorCause(error: unknown): unknown {
  return error && typeof error === "object" && "cause" in error
    ? (error as Record<string, unknown>).cause
    : null;
}

function isRetryableHostedWorkspaceSnapshotR2Response(input: {
  diagnostics: HostedWorkspaceSnapshotR2FailureDiagnostics | null;
  status: number;
}): boolean {
  return WORKSPACE_SNAPSHOT_R2_PUT_RETRYABLE_STATUSES.has(input.status)
    || (
      input.diagnostics?.errorCode !== null
      && input.diagnostics?.errorCode !== undefined
      && WORKSPACE_SNAPSHOT_R2_PUT_RETRYABLE_ERROR_CODES.has(
        input.diagnostics.errorCode,
      )
    );
}

async function waitForHostedWorkspaceSnapshotR2PutRetry(input: {
  expiresAtMs: number;
  signal?: AbortSignal | null;
}): Promise<boolean> {
  assertHostedWorkspaceSnapshotOperationLive(input.signal);
  const retryDelayMs = readHostedWorkspaceSnapshotR2PutRetryDelayMs();
  if (
    input.expiresAtMs - Date.now()
    < retryDelayMs + WORKSPACE_SNAPSHOT_R2_PUT_RETRY_MIN_REQUEST_WINDOW_MS
  ) {
    return false;
  }

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      input.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(input.signal?.reason instanceof Error
        ? input.signal.reason
        : new Error("Hosted workspace snapshot direct upload was interrupted."));
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, retryDelayMs);
    if (input.signal?.aborted) {
      onAbort();
      return;
    }
    input.signal?.addEventListener("abort", onAbort, { once: true });
  });

  assertHostedWorkspaceSnapshotOperationLive(input.signal);
  return input.expiresAtMs - Date.now()
    >= WORKSPACE_SNAPSHOT_R2_PUT_RETRY_MIN_REQUEST_WINDOW_MS;
}

function readHostedWorkspaceSnapshotR2PutRetryDelayMs(): number {
  return WORKSPACE_SNAPSHOT_R2_PUT_RETRY_MIN_DELAY_MS + Math.floor(
    Math.random() * (
      WORKSPACE_SNAPSHOT_R2_PUT_RETRY_MAX_DELAY_MS
      - WORKSPACE_SNAPSHOT_R2_PUT_RETRY_MIN_DELAY_MS
      + 1
    ),
  );
}

async function readHostedWorkspaceSnapshotR2FailureDiagnostics(input: {
  response: Response;
  signal?: AbortSignal | null;
  timeoutMs: number;
}): Promise<HostedWorkspaceSnapshotR2FailureDiagnostics | null> {
  if (!input.response.body) {
    return null;
  }

  const decoder = new TextDecoder();
  let body = "";
  let bodyBytes = 0;
  try {
    for await (const chunk of readHostedRuntimeResponseBodyChunks({
      body: input.response.body,
      description: "Hosted workspace snapshot direct R2 error",
      signal: input.signal ?? null,
      timeoutMs: input.timeoutMs,
    })) {
      const remainingBytes = WORKSPACE_SNAPSHOT_R2_ERROR_BODY_MAX_BYTES - bodyBytes;
      if (remainingBytes <= 0) {
        break;
      }
      const retained = chunk.byteLength <= remainingBytes
        ? chunk
        : chunk.subarray(0, remainingBytes);
      body += decoder.decode(retained, { stream: true });
      bodyBytes += retained.byteLength;
      if (retained.byteLength !== chunk.byteLength) {
        break;
      }
    }
    body += decoder.decode();
  } catch {
    return null;
  }

  const errorCode = readHostedWorkspaceSnapshotR2XmlField(body, "Code");
  const errorMessage = readHostedWorkspaceSnapshotR2XmlField(body, "Message");
  const requestId = readHostedWorkspaceSnapshotR2XmlField(body, "RequestId");
  return {
    errorCode: errorCode && /^[A-Za-z][A-Za-z0-9]{0,95}$/u.test(errorCode)
      ? errorCode
      : null,
    errorMessage: readHostedWorkspaceSnapshotR2SafeMessage(errorMessage),
    requestId: requestId && /^[A-Za-z0-9_-]{8,128}$/u.test(requestId)
      ? requestId
      : null,
  };
}

function readHostedWorkspaceSnapshotR2XmlField(
  body: string,
  field: "Code" | "Message" | "RequestId",
): string | null {
  const match = new RegExp(`<${field}>([^<]{1,1000})</${field}>`, "iu").exec(body);
  if (!match?.[1]) {
    return null;
  }
  return match[1]
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&apos;/giu, "'")
    .trim();
}

function readHostedWorkspaceSnapshotR2SafeMessage(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = readHostedRuntimeSafeErrorText(
    new Error(value.replace(/\s+/gu, " ").trim()),
  );
  return normalized?.slice(0, 500) ?? null;
}

function buildHostedWorkspaceSnapshotR2FailureError(input: {
  cause: unknown;
  diagnostics: HostedWorkspaceSnapshotR2FailureDiagnostics | null;
  status: number;
}): Error {
  const detail = [
    `Hosted workspace snapshot direct R2 upload failed with HTTP ${input.status}.`,
    ...(input.diagnostics?.errorCode
      ? [`R2 error code ${input.diagnostics.errorCode}.`]
      : []),
    ...(input.diagnostics?.errorMessage
      ? [`R2 error message: ${input.diagnostics.errorMessage}`]
      : []),
    ...(input.diagnostics?.requestId
      ? [`R2 request ID ${input.diagnostics.requestId}.`]
      : []),
  ].join(" ");
  const error = new Error(detail, { cause: input.cause }) as Error & {
    code?: string;
    status: number;
    statusCode: number;
  };
  error.status = input.status;
  error.statusCode = input.status;
  if (input.diagnostics?.errorCode) {
    error.code = `R2_${input.diagnostics.errorCode}`;
  }
  return error;
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
  const body = {
    encryptedByteSize: input.encryptedByteSize,
    encryptedObjectSha256: input.encryptedObjectSha256,
    objectKey: input.objectKey,
    snapshotId: input.snapshotId,
  };
  const url = new URL(
    `/workspace-snapshots/${encodeURIComponent(input.snapshotId)}/presign-put`,
    `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/`,
  );
  // A lost response is replay-safe only for this exact session-bound request:
  // the server revalidates the same write fence and monotonically records its
  // bounded R2 PUT-drain deadline before returning another presign.
  let attempt = 0;
  while (true) {
    attempt += 1;
    assertHostedWorkspaceSnapshotOperationLive(input.signal);
    try {
      const payload = await fetchHostedJson({
        body,
        description: "Hosted workspace snapshot presign PUT",
        exposeResponseBodyInError: false,
        fetchImpl: input.fetchImpl,
        headers,
        redactedLogPath: "/workspace-snapshots/REDACTED/presign-put",
        method: "POST",
        signal: input.signal ?? null,
        timeoutMs: input.timeoutMs,
        url,
      });
      return parseHostedWorkspaceSnapshotPresignedPutPayload(payload);
    } catch (error) {
      assertHostedWorkspaceSnapshotOperationLive(input.signal);
      if (
        attempt >= WORKSPACE_SNAPSHOT_PRESIGN_PUT_MAX_ATTEMPTS
        || !isRetryableHostedRuntimeReplaySafeReadTransportError(error)
      ) {
        throw error;
      }
    }
  }
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
  deadlineMs: number;
  expectedEncryptedByteSize: number;
  fetchImpl: typeof fetch;
  getUrl: string;
  signal?: AbortSignal | null;
  timing: {
    objectFetchResponseHeadersMs: number;
    objectFetchBodyReadMs: number;
  };
  timeoutMs: number;
}): AsyncIterable<Uint8Array> {
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
    timeoutMs: input.timeoutMs,
    url: new URL(input.getUrl),
  });
  input.timing.objectFetchResponseHeadersMs =
    readHostedRuntimeStepElapsedMs(responseHeadersStartedAt);
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

async function readHostedWorkspaceSnapshotCompleteResponsePayload(input: {
  deadlineMs: number;
  response: Response;
}): Promise<unknown> {
  if (!input.response.body) {
    return null;
  }

  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of readHostedRuntimeResponseBodyChunks({
    body: input.response.body,
    description: "Hosted workspace snapshot complete",
    timeoutMs: Math.max(0, input.deadlineMs - Date.now()),
  })) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("Hosted workspace snapshot complete returned invalid JSON.", {
      cause: error,
    });
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
