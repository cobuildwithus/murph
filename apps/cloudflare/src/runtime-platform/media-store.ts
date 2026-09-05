import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import {
  HostedRuntimeMediaReadError,
  HostedRuntimeMediaWriteError,
  type HostedRuntimeMediaDescriptor,
  type HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../internal-hosts.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_MEDIA_BYTE_SIZE_HEADER,
  HOSTED_RUNTIME_MEDIA_EXPIRES_AT_HEADER,
  HOSTED_RUNTIME_MEDIA_FETCH_CORRELATION_ID_HEADER,
  HOSTED_RUNTIME_MEDIA_KIND_HEADER,
  HOSTED_RUNTIME_MEDIA_READ_PURPOSE_HEADER,
  HOSTED_RUNTIME_MEDIA_SHA256_HEADER,
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

type CloudflareMediaStore = NonNullable<HostedRuntimePlatform["mediaStore"]>;
type CloudflareMediaWriteDescriptor = HostedRuntimeMediaDescriptor & {
  expiresAt?: string | null;
};

export function createCloudflareMediaStore(input: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  workspaceCheckpointBridge?: HostedWorkspaceCheckpointBridgeAuthority | null;
}): CloudflareMediaStore {
  const fetchImpl = input.fetchImpl;
  const timeoutMs = input.timeoutMs;
  const uploadedMediaIds = new Set<string>();
  const inFlightMediaUploads = new Map<string, Promise<void>>();
  let mediaUploadOrdinal = 0;

  const putMediaUncached = async (
    descriptor: CloudflareMediaWriteDescriptor & {
      bytes: Uint8Array;
    },
    options: {
      requireWriteFence?: boolean;
    } = {},
  ): Promise<void> => {
    const ordinal = ++mediaUploadOrdinal;
    const startedAt = Date.now();
    const logDetails = {
      mediaByteLength: descriptor.bytes.byteLength,
      mediaKind: descriptor.mediaKind,
      mediaUploadOrdinal: ordinal,
      method: "PUT",
      operation: "media_upload",
      path: "/media/REDACTED",
      requireWriteFence: options.requireWriteFence === true,
      responseOrigin: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.mediaStore,
      timeoutMs,
    };
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.media-store",
      details: logDetails,
      message: "Hosted runtime media upload started.",
      phase: "checkpoint",
      userId: null,
    });

    let headers: Headers;
    try {
      headers = input.workspaceCheckpointBridge
        ? options.requireWriteFence
          ? await requireHostedRuntimeWriteFenceHeaders(
              input.workspaceCheckpointBridge,
              "Hosted media upload",
            )
          : await createHostedRuntimeWriteFenceHeaders(input.workspaceCheckpointBridge)
        : new Headers();
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.media-store",
        details: {
          ...logDetails,
          durationMs: Date.now() - startedAt,
          ...buildHostedRuntimeSafeErrorMetadata(error),
        },
        level: "warn",
        message: "Hosted runtime media upload authority headers failed.",
        phase: "checkpoint",
        userId: null,
      });
      throw error;
    }

    writeMediaDescriptorHeaders(headers, descriptor);
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.media-store",
      details: {
        ...logDetails,
        attemptHeaderPresent: headers.has(HOSTED_RUNTIME_ATTEMPT_ID_HEADER),
        leaseGenerationHeaderPresent: headers.has(HOSTED_RUNTIME_LEASE_GENERATION_HEADER),
        workspaceVersionHeaderPresent: headers.has(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER),
      },
      message: "Hosted runtime media upload authority headers prepared.",
      phase: "checkpoint",
      userId: null,
    });

    let response: Response;
    try {
      response = await fetchHostedResponse({
        description: "Hosted media upload",
        fetchImpl,
        init: {
          body: copyBytesToArrayBuffer(descriptor.bytes),
          headers,
          method: "PUT",
        },
        redactedLogPath: "/media/REDACTED",
        timeoutMs,
        url: new URL(`/media/${descriptor.mediaId}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.mediaStore}/`),
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.media-store",
        details: {
          ...logDetails,
          durationMs: Date.now() - startedAt,
          ...buildHostedRuntimeSafeErrorMetadata(error),
        },
        level: "warn",
        message: "Hosted runtime media upload failed before response.",
        phase: "checkpoint",
        userId: null,
      });
      if (shouldPreserveHostedRuntimeFetchError(error)) {
        throw error;
      }
      throw new HostedRuntimeMediaWriteError({
        cause: error,
        retryable: true,
      });
    }

    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.media-store",
      details: {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        responseOk: response.ok,
        responseStatus: response.status,
      },
      level: response.ok ? "info" : "warn",
      message: "Hosted runtime media upload response received.",
      phase: "checkpoint",
      userId: null,
    });
    try {
      assertHostedOk(response, "Hosted media upload");
    } catch (error) {
      if (shouldPreserveHostedRuntimeFetchError(error)) {
        throw error;
      }
      throw new HostedRuntimeMediaWriteError({
        cause: error,
        retryable: isRetryableHostedMediaWriteStatus(response.status),
      });
    }
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.media-store",
      details: {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        responseStatus: response.status,
      },
      message: "Hosted runtime media upload completed.",
      phase: "checkpoint",
      userId: null,
    });
  };

  const putMediaOnce = async (
    descriptor: CloudflareMediaWriteDescriptor & {
      bytes: Uint8Array;
    },
  ): Promise<void> => {
    if (uploadedMediaIds.has(descriptor.mediaId)) {
      await recordMediaLifetime(descriptor);
      return;
    }

    const existing = inFlightMediaUploads.get(descriptor.mediaId);
    if (existing) {
      await existing;
      await recordMediaLifetime(descriptor);
      return;
    }

    const upload = putMediaUncached(descriptor)
      .then(() => {
        uploadedMediaIds.add(descriptor.mediaId);
      })
      .finally(() => {
        inFlightMediaUploads.delete(descriptor.mediaId);
      });
    inFlightMediaUploads.set(descriptor.mediaId, upload);
    await upload;
  };

  const recordMediaLifetime = async (
    descriptor: CloudflareMediaWriteDescriptor,
  ): Promise<void> => {
    const startedAt = Date.now();
    const logDetails = {
      mediaKind: descriptor.mediaKind,
      method: "POST",
      operation: "media_record",
      path: "/media/REDACTED",
      responseOrigin: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.mediaStore,
      timeoutMs,
    };
    const headers = input.workspaceCheckpointBridge
      ? await requireHostedRuntimeWriteFenceHeaders(
          input.workspaceCheckpointBridge,
          "Hosted media lifetime registration",
        )
      : new Headers();
    writeMediaDescriptorHeaders(headers, descriptor);
    let response: Response;
    try {
      response = await fetchHostedResponse({
        description: "Hosted media lifetime registration",
        fetchImpl,
        init: {
          headers,
          method: "POST",
        },
        redactedLogPath: "/media/REDACTED",
        timeoutMs,
        url: new URL(`/media/${descriptor.mediaId}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.mediaStore}/`),
      });
    } catch (error) {
      if (shouldPreserveHostedRuntimeFetchError(error)) {
        throw error;
      }
      throw new HostedRuntimeMediaWriteError({
        cause: error,
        retryable: true,
      });
    }
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.media-store",
      details: {
        ...logDetails,
        durationMs: Date.now() - startedAt,
        responseOk: response.ok,
        responseStatus: response.status,
      },
      level: response.ok ? "info" : "warn",
      message: "Hosted runtime media lifetime registration response received.",
      phase: "checkpoint",
      userId: null,
    });
    try {
      assertHostedOk(response, "Hosted media lifetime registration");
    } catch (error) {
      if (shouldPreserveHostedRuntimeFetchError(error)) {
        throw error;
      }
      throw new HostedRuntimeMediaWriteError({
        cause: error,
        retryable: isRetryableHostedMediaWriteStatus(response.status),
      });
    }
  };

  let mediaFetchOrdinal = 0;
  return {
    async delete({ mediaId }) {
      const startedAt = Date.now();
      const logDetails = {
        method: "DELETE",
        operation: "media_delete",
        path: "/media/REDACTED",
        responseOrigin: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.mediaStore,
        timeoutMs,
      };
      const headers = input.workspaceCheckpointBridge
        ? await requireHostedRuntimeWriteFenceHeaders(
            input.workspaceCheckpointBridge,
            "Hosted media delete",
          )
        : new Headers();
      let response: Response;
      try {
        response = await fetchHostedResponse({
          description: "Hosted media delete",
          fetchImpl,
          init: {
            headers,
            method: "DELETE",
          },
          redactedLogPath: "/media/REDACTED",
          timeoutMs,
          url: new URL(`/media/${mediaId}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.mediaStore}/`),
        });
      } catch (error) {
        if (shouldPreserveHostedRuntimeFetchError(error)) {
          throw error;
        }
        throw new HostedRuntimeMediaWriteError({
          cause: error,
          retryable: true,
        });
      }
      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.media-store",
        details: {
          ...logDetails,
          durationMs: Date.now() - startedAt,
          responseOk: response.ok,
          responseStatus: response.status,
        },
        level: response.ok || response.status === 404 ? "info" : "warn",
        message: "Hosted runtime media delete response received.",
        phase: "checkpoint",
        userId: null,
      });
      if (response.status === 404) {
        return;
      }
      try {
        assertHostedOk(response, "Hosted media delete");
      } catch (error) {
        throw new HostedRuntimeMediaWriteError({
          cause: error,
          retryable: isRetryableHostedMediaWriteStatus(response.status),
        });
      }
      uploadedMediaIds.delete(mediaId);
    },
    async get(descriptor, context) {
      assertHostedMediaFetchLive(context.signal);
      const ordinal = ++mediaFetchOrdinal;
      const startedAt = Date.now();
      const correlationId = crypto.randomUUID();
      const logDetails = {
        mediaFetchCorrelationId: correlationId,
        mediaFetchOrdinal: ordinal,
        mediaKind: descriptor.mediaKind,
        mediaReadPurpose: context.purpose,
        method: "GET",
        operation: "media_fetch",
        path: "/media/REDACTED",
        responseOrigin: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.mediaStore,
        timeoutMs,
      };

      for (
        let attempt = 1;
        attempt <= HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS;
        attempt += 1
      ) {
        assertHostedMediaFetchLive(context.signal);
        const attemptLogDetails = {
          ...logDetails,
          mediaFetchAttempt: attempt,
          mediaFetchMaxAttempts: HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS,
        };
        let response: Response;
        try {
          const headers = input.workspaceCheckpointBridge
            ? await requireHostedRuntimeWriteFenceHeaders(
                input.workspaceCheckpointBridge,
                "Hosted media fetch",
              )
            : new Headers();
          headers.set(
            HOSTED_RUNTIME_MEDIA_FETCH_CORRELATION_ID_HEADER,
            correlationId,
          );
          headers.set(
            HOSTED_RUNTIME_MEDIA_READ_PURPOSE_HEADER,
            context.purpose,
          );
          writeMediaDescriptorHeaders(headers, descriptor);
          response = await fetchHostedResponse({
            description: "Hosted media fetch",
            fetchImpl,
            init: { headers },
            redactedLogPath: "/media/REDACTED",
            signal: context.signal ?? null,
            timeoutMs,
            url: new URL(`/media/${descriptor.mediaId}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.mediaStore}/`),
          });
        } catch (error) {
          assertHostedMediaFetchLive(context.signal);
          const retrying = shouldRetryHostedRuntimeReplaySafeRead({
            attempt,
            error,
          });
          emitHostedExecutionStructuredLog({
            component: "hosted.runtime.media-store",
            details: {
              ...attemptLogDetails,
              durationMs: Date.now() - startedAt,
              retrying,
              ...buildHostedRuntimeSafeErrorMetadata(error),
            },
            level: "warn",
            message: retrying
              ? "Hosted runtime media fetch failed before response; retrying."
              : "Hosted runtime media fetch failed before response.",
            phase: "runtime.starting",
            userId: null,
          });
          if (retrying) {
            await sleepHostedReplaySafeReadRetryDelay();
            assertHostedMediaFetchLive(context.signal);
            continue;
          }
          throw new HostedRuntimeMediaReadError({
            cause: error,
            retryable: isRetryableHostedMediaReadError(error),
          });
        }
        assertHostedMediaFetchLive(context.signal);

        emitHostedExecutionStructuredLog({
          component: "hosted.runtime.media-store",
          details: {
            ...attemptLogDetails,
            durationMs: Date.now() - startedAt,
            responseOk: response.ok,
            responseStatus: response.status,
          },
          level: response.ok || response.status === 404 ? "info" : "warn",
          message: "Hosted runtime media fetch response received.",
          phase: "runtime.starting",
          userId: null,
        });

        if (response.status === 404) {
          return null;
        }

        try {
          assertHostedOk(response, "Hosted media fetch");
        } catch (error) {
          throw new HostedRuntimeMediaReadError({
            cause: error,
            retryable: isRetryableHostedMediaReadStatus(response.status),
          });
        }

        let body: ArrayBuffer;
        try {
          body = await response.arrayBuffer();
        } catch (error) {
          assertHostedMediaFetchLive(context.signal);
          const wrappedError = new HostedRuntimeControlPlaneFetchError({
            cause: error,
            description: "Hosted media fetch response body read",
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
          if (retrying) {
            await sleepHostedReplaySafeReadRetryDelay();
            assertHostedMediaFetchLive(context.signal);
            continue;
          }
          throw new HostedRuntimeMediaReadError({
            cause: wrappedError,
            retryable: true,
          });
        }
        assertHostedMediaFetchLive(context.signal);
        const bytes = new Uint8Array(body);
        await assertHostedMediaDescriptorBytes(descriptor, bytes);
        return bytes;
      }

      throw new HostedRuntimeMediaReadError({
        cause: new Error("Hosted media fetch exhausted retry attempts."),
        retryable: true,
      });
    },
    async record(input) {
      await recordMediaLifetime(input);
    },
    async put(input) {
      await assertHostedMediaDescriptorBytes(input, input.bytes);
      await putMediaOnce(input);
    },
  };
}

function writeMediaDescriptorHeaders(
  headers: Headers,
  descriptor: CloudflareMediaWriteDescriptor,
): void {
  headers.set(HOSTED_RUNTIME_MEDIA_BYTE_SIZE_HEADER, String(descriptor.byteSize));
  headers.set(HOSTED_RUNTIME_MEDIA_KIND_HEADER, descriptor.mediaKind);
  headers.set(HOSTED_RUNTIME_MEDIA_SHA256_HEADER, descriptor.sha256);
  if (descriptor.expiresAt !== undefined) {
    headers.set(HOSTED_RUNTIME_MEDIA_EXPIRES_AT_HEADER, descriptor.expiresAt ?? "");
  }
}

function isRetryableHostedMediaReadStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableHostedMediaWriteStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableHostedMediaReadError(error: unknown): boolean {
  if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
    return false;
  }

  const status = readHostedMediaErrorStatus(error);
  if (status !== null) {
    return isRetryableHostedMediaReadStatus(status);
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

function readHostedMediaErrorStatus(error: unknown): number | null {
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

async function assertHostedMediaDescriptorBytes(
  descriptor: HostedRuntimeMediaDescriptor,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength !== descriptor.byteSize) {
    throw new Error(
      `Hosted media byte-size mismatch: expected ${descriptor.byteSize}, got ${bytes.byteLength}.`,
    );
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    ),
  );
  const actualSha256 = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actualSha256 !== descriptor.sha256) {
    throw new Error(
      `Hosted media hash mismatch: expected ${descriptor.sha256}, got ${actualSha256}.`,
    );
  }
}

function assertHostedMediaFetchLive(
  signal: AbortSignal | null | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted media fetch was interrupted.");
}
