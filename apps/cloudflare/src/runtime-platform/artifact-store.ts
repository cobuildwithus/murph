import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import {
  HostedRuntimeArtifactReadError,
  HostedRuntimeArtifactWriteError,
  type HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../internal-hosts.ts";
import {
  HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER,
  HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../runner-outbound/headers.ts";
import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import {
  createHostedRuntimeWriteFenceHeaders,
  isHostedRuntimeInternalAuthorityRejectedError,
  requireHostedRuntimeWriteFenceHeaders,
} from "./authority-headers.ts";
import {
  HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS,
  HostedRuntimeControlPlaneFetchError,
  readHostedRuntimeControlPlaneFetchFailureDiagnostics,
  shouldPreserveHostedRuntimeFetchError,
  shouldRetryHostedRuntimeReplaySafeRead,
  sleepHostedReplaySafeReadRetryDelay,
} from "./control-plane-fetch.ts";
import { buildHostedRuntimeSafeErrorMetadata } from "./diagnostics.ts";
import {
  assertHostedOk,
  copyBytesToArrayBuffer,
  fetchHostedResponse,
} from "./hosted-http.ts";

export function createCloudflareArtifactStore(input: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  workspaceCheckpointBridge?: HostedWorkspaceCheckpointBridgeAuthority | null;
}): HostedRuntimePlatform["artifactStore"] {
  const fetchImpl = input.fetchImpl;
  const timeoutMs = input.timeoutMs;
  const uploadedArtifactShas = new Set<string>();
  const inFlightArtifactUploads = new Map<string, Promise<void>>();
  let artifactUploadOrdinal = 0;
  const putArtifactUncached = async (
    artifact: {
      bytes: Uint8Array;
      sha256: string;
    },
    options: {
      requireWriteFence?: boolean;
    } = {},
  ): Promise<void> => {
    const ordinal = ++artifactUploadOrdinal;
    const startedAt = Date.now();
    const logDetails = {
      artifactByteLength: artifact.bytes.byteLength,
      artifactUploadOrdinal: ordinal,
      method: "PUT",
      operation: "artifact_upload",
      path: "/objects/REDACTED",
      requireWriteFence: options.requireWriteFence === true,
      responseOrigin: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore,
      timeoutMs,
    };
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.artifact-store",
      details: logDetails,
      message: "Hosted runtime artifact upload started.",
      phase: "checkpoint",
      userId: null,
    });

    const headerStartedAt = Date.now();
    let headers: Headers;
    try {
      headers = input.workspaceCheckpointBridge
        ? options.requireWriteFence
          ? await requireHostedRuntimeWriteFenceHeaders(
              input.workspaceCheckpointBridge,
              "Hosted artifact upload",
            )
          : await createHostedRuntimeWriteFenceHeaders(input.workspaceCheckpointBridge)
        : new Headers();
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.artifact-store",
        details: {
          ...logDetails,
          durationMs: Date.now() - startedAt,
          headerDurationMs: Date.now() - headerStartedAt,
          ...buildHostedRuntimeSafeErrorMetadata(error),
        },
        level: "warn",
        message: "Hosted runtime artifact upload authority headers failed.",
        phase: "checkpoint",
        userId: null,
      });
      throw error;
    }

    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.artifact-store",
      details: {
        ...logDetails,
        attemptHeaderPresent: headers.has(HOSTED_RUNTIME_ATTEMPT_ID_HEADER),
        headerDurationMs: Date.now() - headerStartedAt,
        leaseGenerationHeaderPresent: headers.has(HOSTED_RUNTIME_LEASE_GENERATION_HEADER),
        workspaceVersionHeaderPresent: headers.has(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER),
      },
      message: "Hosted runtime artifact upload authority headers prepared.",
      phase: "checkpoint",
      userId: null,
    });

    let response: Response;
    try {
      response = await fetchHostedResponse({
        description: "Hosted artifact upload",
        fetchImpl,
        init: {
          body: copyBytesToArrayBuffer(artifact.bytes),
          headers,
          method: "PUT",
        },
        redactedLogPath: "/objects/REDACTED",
        timeoutMs,
        url: new URL(`/objects/${artifact.sha256}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore}/`),
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.artifact-store",
        details: {
          ...logDetails,
          durationMs: Date.now() - startedAt,
          ...buildHostedRuntimeSafeErrorMetadata(error),
        },
        level: "warn",
        message: "Hosted runtime artifact upload failed before response.",
        phase: "checkpoint",
        userId: null,
      });
      if (shouldPreserveHostedRuntimeFetchError(error)) {
        throw error;
      }
      throw new HostedRuntimeArtifactWriteError({
        cause: error,
        retryable: true,
      });
    }

    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.artifact-store",
      details: {
        ...logDetails,
        contentLengthPresent: response.headers.has("content-length"),
        contentTypePresent: response.headers.has("content-type"),
        durationMs: Date.now() - startedAt,
        responseOk: response.ok,
        responseStatus: response.status,
      },
      level: response.ok ? "info" : "warn",
      message: "Hosted runtime artifact upload response received.",
      phase: "checkpoint",
      userId: null,
    });
    try {
      assertHostedOk(response, "Hosted artifact upload");
    } catch (error) {
      if (shouldPreserveHostedRuntimeFetchError(error)) {
        throw error;
      }
      throw new HostedRuntimeArtifactWriteError({
        cause: error,
        retryable: isRetryableHostedArtifactWriteStatus(response.status),
      });
    }
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.artifact-store",
      details: {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        responseStatus: response.status,
      },
      message: "Hosted runtime artifact upload completed.",
      phase: "checkpoint",
      userId: null,
    });
  };
  const putArtifactOnce = async (
    artifact: {
      bytes: Uint8Array;
      sha256: string;
    },
    options: {
      requireWriteFence?: boolean;
    } = {},
  ): Promise<void> => {
    if (uploadedArtifactShas.has(artifact.sha256)) {
      return;
    }

    const existing = inFlightArtifactUploads.get(artifact.sha256);
    if (existing) {
      await existing;
      return;
    }

    const upload = putArtifactUncached(artifact, options)
      .then(() => {
        uploadedArtifactShas.add(artifact.sha256);
      })
      .finally(() => {
        inFlightArtifactUploads.delete(artifact.sha256);
      });
    inFlightArtifactUploads.set(artifact.sha256, upload);
    await upload;
  };

  let artifactFetchOrdinal = 0;
  return {
    async get(sha256, context) {
      assertHostedArtifactFetchLive(context.signal);
      const ordinal = ++artifactFetchOrdinal;
      const startedAt = Date.now();
      const correlationId = crypto.randomUUID();
      const logDetails = {
        artifactFetchCorrelationId: correlationId,
        artifactFetchOrdinal: ordinal,
        artifactReadPurpose: context.purpose,
        method: "GET",
        operation: "artifact_fetch",
        path: "/objects/REDACTED",
        responseOrigin: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore,
        timeoutMs,
      };

      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.artifact-store",
        details: logDetails,
        message: "Hosted runtime artifact fetch started.",
        phase: "runtime.starting",
        userId: null,
      });

      for (
        let attempt = 1;
        attempt <= HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS;
        attempt += 1
      ) {
        assertHostedArtifactFetchLive(context.signal);
        const attemptLogDetails = {
          ...logDetails,
          artifactFetchAttempt: attempt,
          artifactFetchMaxAttempts: HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS,
        };
        let response: Response;
        try {
          const headers = input.workspaceCheckpointBridge
            ? await requireHostedRuntimeWriteFenceHeaders(
                input.workspaceCheckpointBridge,
                "Hosted artifact fetch",
              )
            : new Headers();
          headers.set(
            HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER,
            correlationId,
          );
          headers.set(
            HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_HEADER,
            context.purpose,
          );
          response = await fetchHostedResponse({
            description: "Hosted artifact fetch",
            fetchImpl,
            init: { headers },
            redactedLogPath: "/objects/REDACTED",
            signal: context.signal ?? null,
            timeoutMs,
            url: new URL(`/objects/${sha256}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore}/`),
          });
        } catch (error) {
          assertHostedArtifactFetchLive(context.signal);
          const retrying = shouldRetryHostedRuntimeReplaySafeRead({
            attempt,
            error,
          });
          emitHostedExecutionStructuredLog({
            component: "hosted.runtime.artifact-store",
            details: {
              ...attemptLogDetails,
              durationMs: Date.now() - startedAt,
              retrying,
              ...buildHostedRuntimeSafeErrorMetadata(error),
            },
            level: "warn",
            message: retrying
              ? "Hosted runtime artifact fetch failed before response; retrying."
              : "Hosted runtime artifact fetch failed before response.",
            phase: "runtime.starting",
            userId: null,
          });
          if (retrying) {
            await sleepHostedReplaySafeReadRetryDelay();
            assertHostedArtifactFetchLive(context.signal);
            continue;
          }
          throw new HostedRuntimeArtifactReadError({
            cause: error,
            retryable: isRetryableHostedArtifactReadError(error),
          });
        }
        assertHostedArtifactFetchLive(context.signal);

        emitHostedExecutionStructuredLog({
          component: "hosted.runtime.artifact-store",
          details: {
            ...attemptLogDetails,
            contentLengthPresent: response.headers.has("content-length"),
            contentTypePresent: response.headers.has("content-type"),
            durationMs: Date.now() - startedAt,
            responseOk: response.ok,
            responseStatus: response.status,
          },
          level: response.ok || response.status === 404 ? "info" : "warn",
          message: "Hosted runtime artifact fetch response received.",
          phase: "runtime.starting",
          userId: null,
        });

        if (response.status === 404) {
          return null;
        }

        try {
          assertHostedOk(response, "Hosted artifact fetch");
        } catch (error) {
          throw new HostedRuntimeArtifactReadError({
            cause: error,
            retryable: isRetryableHostedArtifactReadStatus(response.status),
          });
        }
        const bodyStartedAt = Date.now();
        emitHostedExecutionStructuredLog({
          component: "hosted.runtime.artifact-store",
          details: {
            ...attemptLogDetails,
            durationMs: bodyStartedAt - startedAt,
            responseStatus: response.status,
          },
          message: "Hosted runtime artifact fetch body read started.",
          phase: "runtime.starting",
          userId: null,
        });

        let body: ArrayBuffer;
        try {
          body = await response.arrayBuffer();
        } catch (error) {
          assertHostedArtifactFetchLive(context.signal);
          const wrappedError = new HostedRuntimeControlPlaneFetchError({
            cause: error,
            description: "Hosted artifact fetch response body read",
            signalState: {
              callerSignalAborted: false,
              requestSignalAborted: false,
              timeoutMs,
              timeoutSignalAborted: false,
            },
          });
          const retrying = shouldRetryHostedRuntimeReplaySafeRead({
            attempt,
            error: wrappedError,
          });
          emitHostedExecutionStructuredLog({
            component: "hosted.runtime.artifact-store",
            details: {
              ...attemptLogDetails,
              bodyDurationMs: Date.now() - bodyStartedAt,
              durationMs: Date.now() - startedAt,
              responseStatus: response.status,
              retrying,
              ...buildHostedRuntimeSafeErrorMetadata(wrappedError),
            },
            level: "warn",
            message: retrying
              ? "Hosted runtime artifact fetch body read failed; retrying."
              : "Hosted runtime artifact fetch body read failed.",
            phase: "runtime.starting",
            userId: null,
          });
          if (retrying) {
            await sleepHostedReplaySafeReadRetryDelay();
            assertHostedArtifactFetchLive(context.signal);
            continue;
          }
          throw new HostedRuntimeArtifactReadError({
            cause: wrappedError,
            retryable: true,
          });
        }
        assertHostedArtifactFetchLive(context.signal);

        emitHostedExecutionStructuredLog({
          component: "hosted.runtime.artifact-store",
          details: {
            ...attemptLogDetails,
            artifactByteLength: body.byteLength,
            bodyDurationMs: Date.now() - bodyStartedAt,
            durationMs: Date.now() - startedAt,
            responseStatus: response.status,
          },
          message: "Hosted runtime artifact fetch body read completed.",
          phase: "runtime.starting",
          userId: null,
        });
        return new Uint8Array(body);
      }

      throw new HostedRuntimeArtifactReadError({
        cause: new Error("Hosted artifact fetch exhausted retry attempts."),
        retryable: true,
      });
    },
    async put({ bytes, sha256 }) {
      await putArtifactOnce({ bytes, sha256 });
    },
  };
}

function isRetryableHostedArtifactReadStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableHostedArtifactReadError(error: unknown): boolean {
  if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
    return false;
  }

  const status = readHostedArtifactErrorStatus(error);
  if (status !== null) {
    return isRetryableHostedArtifactReadStatus(status);
  }

  const diagnostics = readHostedRuntimeControlPlaneFetchFailureDiagnostics(error);
  if (!diagnostics || diagnostics.fetchCallerSignalAborted) {
    return false;
  }
  return diagnostics.fetchCauseKind === "cloudflare_rpc_destroy"
    || diagnostics.fetchCauseKind === "fetch_failed"
    || diagnostics.fetchCauseKind === "network"
    || diagnostics.fetchCauseKind === "timeout";
}

function readHostedArtifactErrorStatus(error: unknown): number | null {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    for (const key of ["status", "statusCode", "responseStatus"] as const) {
      const value = (current as Partial<Record<typeof key, unknown>>)[key];
      if (typeof value === "number" && Number.isSafeInteger(value)) {
        return value;
      }
    }
    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return null;
}

function isRetryableHostedArtifactWriteStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function assertHostedArtifactFetchLive(
  signal: AbortSignal | null | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted artifact fetch was interrupted.");
}
