import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import {
  parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeUsageRecordResponse,
  readHostedRunnerCommitTimeoutMs,
  type HostedRuntimeDeviceSyncMessagingReturnTarget,
  type HostedRuntimeEffectsPort,
  type HostedRuntimePlatform,
  type HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails,
  type HostedRuntimeWorkspaceSnapshotSessionStart,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  sha256HostedBundleHex,
} from "@murphai/runtime-state/node";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  type HostedExecutionErrorCode,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  parseHostedMailboxFetchResponse,
  parseHostedMailboxPayloadFetchResponse,
  parseHostedBrowserVaultReplicaRef,
  parseHostedBrowserVaultReplicaPublishResponse,
  parseHostedRuntimeLogResponse,
  parseHostedWorkspaceSnapshotV2Ref,
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_LOG_PATH,
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
  HOSTED_RUNTIME_ISSUE_RECORD_PATH,
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
  HOSTED_RUNTIME_USAGE_RECORD_PATH,
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  decodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
} from "./runner-email-route.ts";
import {
  HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
  parseHostedRunnerProviderEffectErrorResponse,
  parseHostedRunnerTelegramDownloadFileResponse,
  parseHostedRunnerTelegramGetFileResponse,
} from "./runner-effects-contract.ts";
import {
  writeRunnerRuntimeWriteFenceHeaders,
} from "./runner-outbound/write-fence.ts";
import {
  readHostedRunnerDiagnosticMethod,
  readHostedRunnerInternalHostKind,
  readHostedRunnerInternalOperation,
} from "./runner-outbound/diagnostics.ts";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  buildHostedExecutionDeviceSyncConnectLinkPath,
  parseHostedExecutionDeviceSyncConnectLinkResponse,
  parseHostedExecutionDeviceSyncDirtyAckResponse,
  parseHostedExecutionDeviceSyncDirtyPendingResponse,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
} from "./internal-hosts.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "./runner-outbound/headers.ts";
import {
  encodeHostedWorkspaceSnapshotSha256Base64,
  HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
} from "./workspace-snapshot-store.ts";
import {
  restoreEncryptedWorkspaceSnapshot,
} from "./workspace-snapshot-local.ts";
import {
  assertAllowedHostedRunnerWebControlRequest,
  readHostedRunnerWebControlRoute,
} from "./runner-outbound/shared-web-control-policy.ts";
import {
  checkpointHostedRuntimeBridgeWebWorkspace,
  type HostedRuntimeBridgeCheckpointLease,
} from "./runtime-bridge-checkpoint.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "./web-control-plane.ts";
import type { HostedWebCallbackSigningEnvironment } from "./web-callback-auth.ts";
type HostedWebControlTransport =
  | {
    callbackSigning: HostedWebCallbackSigningEnvironment;
    mode: "direct";
    webControlBaseUrl: string;
  }
  | {
    mode: "proxy";
  };

const HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS = 2;
const HOSTED_REPLAY_SAFE_READ_RETRY_DELAY_MS = 100;
const HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY_CODE =
  "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY";
const HOSTED_RUNTIME_INTERNAL_AUTHORITY_REJECTED_REASON =
  "internal_authority_rejected";
const HOSTED_RUNTIME_CONTROL_PLANE_FETCH_FAILURE_MARKER =
  "hostedRuntimeControlPlaneFetchFailure";
const HOSTED_RUNTIME_FETCH_CAUSE_NAMES = new Set([
  "AbortError",
  "Error",
  "TimeoutError",
  "TypeError",
]);

export type HostedRuntimeControlPlaneFetchCauseKind =
  | "abort"
  | "cloudflare_rpc_destroy"
  | "fetch_failed"
  | "network"
  | "timeout"
  | "unknown";

export interface HostedRuntimeControlPlaneFetchFailureDiagnostics {
  fetchCallerSignalAborted: boolean;
  fetchCauseCode: HostedExecutionErrorCode;
  fetchCauseKind: HostedRuntimeControlPlaneFetchCauseKind;
  fetchCauseName?: string;
  fetchRequestSignalAborted: boolean;
  fetchTimeoutMs: number;
  fetchTimeoutSignalAborted: boolean;
}

interface HostedRuntimeControlPlaneFetchSignalState {
  callerSignalAborted: boolean;
  requestSignalAborted: boolean;
  timeoutMs: number;
  timeoutSignalAborted: boolean;
}

class HostedRuntimeControlPlaneFetchError extends Error {
  readonly code: HostedExecutionErrorCode;
  readonly [HOSTED_RUNTIME_CONTROL_PLANE_FETCH_FAILURE_MARKER] = true;
  readonly hostedRuntimeFetchCallerSignalAborted: boolean;
  readonly hostedRuntimeFetchCauseCode: HostedExecutionErrorCode;
  readonly hostedRuntimeFetchCauseKind: HostedRuntimeControlPlaneFetchCauseKind;
  readonly hostedRuntimeFetchCauseName?: string;
  readonly hostedRuntimeFetchRequestSignalAborted: boolean;
  readonly hostedRuntimeFetchTimeoutMs: number;
  readonly hostedRuntimeFetchTimeoutSignalAborted: boolean;

  constructor(input: {
    cause: unknown;
    description: string;
    signalState: HostedRuntimeControlPlaneFetchSignalState;
  }) {
    super(`${input.description} request failed.`, { cause: input.cause });
    this.name = "Error";
    this.code = deriveHostedExecutionErrorCode(input.cause);
    this.hostedRuntimeFetchCauseCode = this.code;
    this.hostedRuntimeFetchCauseKind = classifyHostedRuntimeFetchCause(
      input.cause,
      input.signalState,
    );
    const causeName = readHostedRuntimeFetchCauseName(input.cause);
    if (causeName) {
      this.hostedRuntimeFetchCauseName = causeName;
    }
    this.hostedRuntimeFetchCallerSignalAborted =
      input.signalState.callerSignalAborted;
    this.hostedRuntimeFetchRequestSignalAborted =
      input.signalState.requestSignalAborted;
    this.hostedRuntimeFetchTimeoutMs = input.signalState.timeoutMs;
    this.hostedRuntimeFetchTimeoutSignalAborted =
      input.signalState.timeoutSignalAborted;
  }
}

const HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEP_MARKER =
  "hostedWorkspaceSnapshotRestoreStep";

export class HostedRuntimeInternalAuthorityRejectedError extends Error {
  readonly code = HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY_CODE;
  readonly reason = HOSTED_RUNTIME_INTERNAL_AUTHORITY_REJECTED_REASON;
  readonly responseStatus: number;
  readonly status: number;
  readonly statusCode: number;

  constructor(input: {
    description: string;
    status: number;
  }) {
    super(
      `${input.description} failed with HTTP ${input.status}. `
      + `Hosted invocation is stale: ${HOSTED_RUNTIME_INTERNAL_AUTHORITY_REJECTED_REASON}.`,
    );
    this.name = "HostedRuntimeInternalAuthorityRejectedError";
    this.responseStatus = input.status;
    this.status = input.status;
    this.statusCode = input.status;
  }
}

export function isHostedRuntimeInternalAuthorityRejectedError(
  error: unknown,
): error is HostedRuntimeInternalAuthorityRejectedError {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);

    if (current instanceof HostedRuntimeInternalAuthorityRejectedError) {
      return true;
    }

    const code = (current as { code?: unknown }).code;
    if (code === HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY_CODE) {
      return true;
    }

    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }

  return false;
}

export interface HostedWorkspaceCheckpointBridgeAuthority {
  readCurrentLease():
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
  recordCheckpoint?(input: {
    workspaceVersion: string;
  }): Promise<void> | void;
}

export function buildHostedExecutionRuntimePlatform(input: {
  boundUserId: string;
  commitTimeoutMs?: number | null;
  fetchImpl?: typeof fetch;
  proxyBoundUserIdHeader?: boolean | null;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl?: string | null;
  workspaceCheckpointBridge?: HostedWorkspaceCheckpointBridgeAuthority | null;
}): HostedRuntimePlatform {
  const fetchImpl = createCloudflareHostedProviderFetch(
    input.boundUserId,
    input.fetchImpl ?? fetch,
    {
      injectBoundUserIdHeader: input.proxyBoundUserIdHeader ?? false,
      readCurrentLease: input.workspaceCheckpointBridge?.readCurrentLease,
    },
  );
  const timeoutMs = readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs ?? null);
  const hostedWebControlTransport = resolveHostedWebControlTransport({
    webCallbackSigning: input.webCallbackSigning ?? null,
    webControlBaseUrl: input.webControlBaseUrl ?? null,
    workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
  });
  const hostedWebDeviceSyncPort = hostedWebControlTransport
    ? createHostedWebDeviceSyncPort({
        boundUserId: input.boundUserId,
        fetchImpl,
        timeoutMs,
        transport: hostedWebControlTransport,
      })
    : null;
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
          ...buildHostedRuntimeControlPlaneSafeErrorMetadata(error),
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
          ...buildHostedRuntimeControlPlaneSafeErrorMetadata(error),
        },
        level: "warn",
        message: "Hosted runtime artifact upload failed before response.",
        phase: "checkpoint",
        userId: null,
      });
      throw error;
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
    assertHostedOk(response, "Hosted artifact upload");
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
  const providerFileEffectsPort = input.workspaceCheckpointBridge
    ? createCloudflareRunnerProviderFileEffectsPort({
        fetchImpl,
        timeoutMs,
        workspaceCheckpointBridge: input.workspaceCheckpointBridge,
      })
    : {};
  let artifactFetchOrdinal = 0;
  return {
    artifactStore: {
      async get(sha256) {
        const ordinal = ++artifactFetchOrdinal;
        const startedAt = Date.now();
        const logDetails = {
          artifactFetchOrdinal: ordinal,
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
          const attemptLogDetails = {
            ...logDetails,
            artifactFetchAttempt: attempt,
            artifactFetchMaxAttempts: HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS,
          };
          let response: Response;
          try {
            response = await fetchHostedResponse({
              description: "Hosted artifact fetch",
              fetchImpl,
              redactedLogPath: "/objects/REDACTED",
              timeoutMs,
              url: new URL(`/objects/${sha256}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore}/`),
            });
          } catch (error) {
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
                ...buildHostedRuntimeControlPlaneSafeErrorMetadata(error),
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
              continue;
            }
            throw error;
          }

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

          assertHostedOk(response, "Hosted artifact fetch");
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
                ...buildHostedRuntimeControlPlaneSafeErrorMetadata(wrappedError),
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
              continue;
            }
            throw wrappedError;
          }

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

        throw new Error("Hosted artifact fetch exhausted retry attempts.");
      },
      async put({ bytes, sha256 }) {
        await putArtifactOnce({ bytes, sha256 });
      },
    },
    ...(input.workspaceCheckpointBridge
      ? {
          workspaceSnapshotPort: createCloudflareWorkspaceSnapshotPort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport: hostedWebControlTransport,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge,
          }),
        }
      : {}),
    ...(input.workspaceCheckpointBridge
      ? {
          providerFetch: createCloudflareHostedProviderFetch(
            input.boundUserId,
            input.fetchImpl ?? fetch,
            {
              injectBoundUserIdHeader: input.proxyBoundUserIdHeader ?? false,
              readCurrentLease: input.workspaceCheckpointBridge.readCurrentLease,
            },
          ),
        }
      : {}),
    ...(hostedWebControlTransport
      ? {
          logPort: createHostedWebRuntimeLogPort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport: hostedWebControlTransport,
          }),
          mailboxPort: createHostedWebMailboxPort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport: hostedWebControlTransport,
          }),
          workspacePort: createHostedWebWorkspacePort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport: hostedWebControlTransport,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
          }),
        }
      : {}),
    ...(hostedWebDeviceSyncPort ? { deviceSyncPort: hostedWebDeviceSyncPort } : {}),
    ...(input.workspaceCheckpointBridge
      ? {
          browserVaultReplicaPort: createCloudflareBrowserVaultReplicaPort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport: hostedWebControlTransport,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge,
          }),
        }
      : {}),
    effectsPort: {
      ...providerFileEffectsPort,
      async readRawEmailMessage(rawMessageKey) {
        const response = await fetchHostedResponse({
          description: "Hosted raw email read",
          fetchImpl,
          timeoutMs,
          url: new URL(
            buildHostedExecutionRunnerEmailMessagePath(rawMessageKey),
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
          ),
        });

        if (response.status === 404) {
          return null;
        }

        assertHostedOk(response, "Hosted raw email read");
        return new Uint8Array(await response.arrayBuffer());
      },
      async sendEmail(request) {
        const headers = new Headers();
        const lease = await input.workspaceCheckpointBridge?.readCurrentLease() ?? null;
        if (lease) {
          headers.set(HOSTED_RUNTIME_ATTEMPT_ID_HEADER, lease.attemptId);
          headers.set(HOSTED_RUNTIME_LEASE_GENERATION_HEADER, lease.leaseGeneration);
          headers.set(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER, lease.workspaceVersion);
        }
        const payload = await fetchHostedJson({
          body: request,
          description: "Hosted email send",
          fetchImpl,
          headers,
          method: "POST",
          timeoutMs,
          url: new URL(
            HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
          ),
        });
        const target = readOptionalStringField(payload, "target");

        return target ? { target } : undefined;
      },
    },
    ...(hostedWebControlTransport
      ? {
          issueExportPort: {
            async recordIssues(issues) {
              const payload = await fetchHostedWebControlPlaneJson({
                body: {
                  issues,
                },
                boundUserId: input.boundUserId,
                description: "Hosted assistant runtime issue export",
                fetchImpl,
                path: HOSTED_RUNTIME_ISSUE_RECORD_PATH,
                timeoutMs,
                transport: hostedWebControlTransport,
              });

              try {
                return parseHostedRuntimeIssueRecordResponse(payload);
              } catch (error) {
                throw new Error("Hosted assistant runtime issue export returned invalid JSON.", {
                  cause: error,
                });
              }
            },
          },
          usageRecordPort: {
            async recordUsage(record) {
              const payload = await fetchHostedWebControlPlaneJson({
                body: {
                  usage: record,
                },
                boundUserId: input.boundUserId,
                description: "Hosted usage recording",
                fetchImpl,
                path: HOSTED_RUNTIME_USAGE_RECORD_PATH,
                timeoutMs,
                transport: hostedWebControlTransport,
              });

              try {
                return parseHostedRuntimeUsageRecordResponse(payload);
              } catch (error) {
                throw new Error("Hosted usage recording returned invalid JSON.", {
                  cause: error,
                });
              }
            },
          },
        }
      : {}),
  };
}

function buildHostedExecutionRunnerEmailMessagePath(rawMessageKey: string): string {
  return `/messages/${encodeURIComponent(rawMessageKey)}`;
}

function createCloudflareRunnerProviderFileEffectsPort(input: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): Partial<HostedRuntimeEffectsPort> {
  const post = async (requestInput: {
    body: unknown;
    description: string;
    path: string;
  }) => await fetchHostedProviderEffectJson({
    body: requestInput.body,
    description: requestInput.description,
    fetchImpl: input.fetchImpl,
    headers: await requireHostedRuntimeWriteFenceHeaders(
      input.workspaceCheckpointBridge,
      requestInput.description,
    ),
    timeoutMs: input.timeoutMs,
    url: new URL(
      requestInput.path,
      `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
    ),
  });

  return {
    async downloadTelegramFile(request) {
      const payload = await post({
        body: request,
        description: "Hosted Telegram file download",
        path: HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
      });
      return parseHostedRunnerTelegramDownloadFileResponse(payload).file;
    },
    async getTelegramFile(request) {
      const payload = await post({
        body: request,
        description: "Hosted Telegram file lookup",
        path: HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
      });
      return parseHostedRunnerTelegramGetFileResponse(payload).file;
    },
  };
}

async function createHostedRuntimeWriteFenceHeaders(
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority,
): Promise<Headers> {
  const headers = new Headers();
  const lease = await workspaceCheckpointBridge.readCurrentLease();
  if (lease) {
    writeRunnerRuntimeWriteFenceHeaders(headers, lease);
  }
  return headers;
}

async function requireHostedRuntimeWriteFenceHeaders(
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority,
  description: string,
): Promise<Headers> {
  const headers = new Headers();
  const lease = await workspaceCheckpointBridge.readCurrentLease();
  if (!lease) {
    throw new Error(`${description} requires an active hosted runtime write fence.`);
  }
  writeRunnerRuntimeWriteFenceHeaders(headers, lease);
  return headers;
}

function createCloudflareBrowserVaultReplicaPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport | null;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}) {
  return {
    ...(input.transport
      ? {
          async publishRef(publishInput: {
            replicaRef: NonNullable<ReturnType<typeof parseHostedBrowserVaultReplicaRef>>;
            signal?: AbortSignal | null;
          }) {
            const payload = await fetchHostedWebControlPlaneJson({
              body: {
                replicaRef: publishInput.replicaRef,
              },
              boundUserId: input.boundUserId,
              description: "Hosted browser-vault replica publish",
              fetchImpl: input.fetchImpl,
              headers: await createHostedBrowserVaultReplicaPublishHeaders({
                workspaceCheckpointBridge: input.workspaceCheckpointBridge,
              }),
              path: HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
              signal: publishInput.signal ?? null,
              timeoutMs: input.timeoutMs,
              transport: input.transport!,
              acceptedStatuses: [404, 409],
            });

            return parseHostedBrowserVaultReplicaPublishResponse(payload);
          },
        }
      : {}),
    async write(writeInput: {
      replica: unknown;
      signal?: AbortSignal | null;
    }) {
      const payload = await fetchHostedJson({
        body: {
          replica: writeInput.replica,
        },
        description: "Hosted browser-vault replica write",
        fetchImpl: input.fetchImpl,
        headers: await createHostedBrowserVaultReplicaWriteHeaders({
          workspaceCheckpointBridge: input.workspaceCheckpointBridge,
        }),
        method: "POST",
        signal: writeInput.signal ?? null,
        timeoutMs: input.timeoutMs,
        url: new URL(
          "/replicas",
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.browserVaultReplicaStore}/`,
        ),
      });
      const replicaRef = parseHostedBrowserVaultReplicaRef(
        readRequiredField(payload, "replicaRef"),
        "Hosted browser-vault replica write response.replicaRef",
      );

      if (!replicaRef) {
        throw new TypeError(
          "Hosted browser-vault replica write response.replicaRef must not be null.",
        );
      }

      return replicaRef;
    },
  };
}

export async function createHostedBrowserVaultReplicaWriteHeaders(input: {
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}): Promise<Headers> {
  if (!input.workspaceCheckpointBridge) {
    throw new Error("Hosted browser-vault replica write requires a runtime write fence.");
  }
  return await requireHostedRuntimeWriteFenceHeaders(
    input.workspaceCheckpointBridge,
    "Browser-vault replica write",
  );
}

async function createHostedBrowserVaultReplicaPublishHeaders(input: {
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}): Promise<Headers> {
  if (!input.workspaceCheckpointBridge) {
    throw new Error("Hosted browser-vault replica publish requires a runtime write fence.");
  }
  return await requireHostedRuntimeWriteFenceHeaders(
    input.workspaceCheckpointBridge,
    "Browser-vault replica publish",
  );
}

function resolveHostedWebControlTransport(input: {
  webCallbackSigning: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl: string | null;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}): HostedWebControlTransport | null {
  if (input.webControlBaseUrl && input.webCallbackSigning) {
    return {
      callbackSigning: input.webCallbackSigning,
      mode: "direct",
      webControlBaseUrl: input.webControlBaseUrl,
    };
  }

  if (input.workspaceCheckpointBridge) {
    return {
      mode: "proxy",
    };
  }

  return null;
}

function createCloudflareHostedInternalFetch(
  boundUserId: string,
  fetchImpl: typeof fetch,
  options: {
    injectBoundUserIdHeader?: boolean;
    readCurrentLease?: HostedWorkspaceCheckpointBridgeAuthority["readCurrentLease"];
  } = {},
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
      return fetchImpl(request);
    }

    if (!options.readCurrentLease) {
      throw new Error(
        `Hosted runtime internal request for ${url.hostname}${url.pathname} is missing a runtime write-fence authority.`,
      );
    }

    const headers = new Headers(request.headers);
    const hasSuppliedWorkspaceSnapshotWriteFence =
      url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.workspaceSnapshotStore
      && headers.has(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)
      && headers.has(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)
      && headers.has(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);
    if (!hasSuppliedWorkspaceSnapshotWriteFence) {
      const lease = await options.readCurrentLease?.() ?? null;
      if (!lease) {
        throw new Error(
          `Hosted runtime internal request for ${url.hostname}${url.pathname} is missing a runtime write-fence lease.`,
        );
      }
      writeRunnerRuntimeWriteFenceHeaders(headers, lease);
    }
    if (options.injectBoundUserIdHeader) {
      headers.set(HOSTED_RUNNER_BOUND_USER_ID_HEADER, boundUserId);
    }
    const internalRequest = createHostedInternalRequest(request, headers);
    const shouldLogInternalRequest = true;
    const operation = readHostedRunnerInternalOperation({
      hostname: url.hostname,
      method: internalRequest.method,
      pathname: url.pathname,
    });
    const safePath = readHostedRuntimeInternalRequestLogPath(url);
    const details = {
      effectsFingerprintPresent: url.searchParams.has("fingerprint"),
      host: url.hostname,
      hostKind: readHostedRunnerInternalHostKind(url.hostname),
      method: readHostedRunnerDiagnosticMethod(internalRequest.method),
      operation,
      path: safePath,
      userIdPresent: boundUserId.length > 0,
    };

    if (shouldLogInternalRequest) {
      emitHostedExecutionStructuredLog({
        component: "assistant-delivery",
        details,
        message: "Hosted runtime internal request started.",
        phase: "outbox",
        userId: boundUserId,
      });
    }

    try {
      const response = await fetchImpl(internalRequest);
      if (shouldLogInternalRequest) {
        emitHostedExecutionStructuredLog({
          component: "assistant-delivery",
          details: {
            ...details,
            ok: response.ok ? "true" : "false",
            status: String(response.status),
          },
          message: "Hosted runtime internal request completed.",
          phase: "outbox",
          userId: boundUserId,
        });
      }
      if (isInternalAuthorityRejectedStatus(response.status)) {
        const error = new HostedRuntimeInternalAuthorityRejectedError({
          description: readHostedRuntimeInternalRequestDescription({
            hostname: url.hostname,
            method: internalRequest.method,
            operation,
            pathname: url.pathname,
          }),
          status: response.status,
        });
        emitHostedExecutionStructuredLog({
          component: "assistant-delivery",
          details: {
            ...details,
            responseStatus: response.status,
          },
          error,
          level: "warn",
          message: "Hosted runtime internal authority rejected invocation.",
          phase: "outbox",
          userId: boundUserId,
        });
        throw error;
      }
      return response;
    } catch (error) {
      if (
        shouldLogInternalRequest
        && !isHostedRuntimeInternalAuthorityRejectedError(error)
      ) {
        emitHostedExecutionStructuredLog({
          component: "assistant-delivery",
          details,
          error,
          level: "warn",
          message: "Hosted runtime internal request failed.",
          phase: "outbox",
          userId: boundUserId,
        });
      }
      throw error;
    }
  }) as typeof fetch;
}

export function createCloudflareHostedProviderFetch(
  boundUserId: string,
  fetchImpl: typeof fetch,
  options: {
    injectBoundUserIdHeader?: boolean;
    readCurrentLease?: HostedWorkspaceCheckpointBridgeAuthority["readCurrentLease"];
  } = {},
): typeof fetch {
  const internalFetch = createCloudflareHostedInternalFetch(boundUserId, fetchImpl, options);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
      return await internalFetch(request);
    }

    const headers = new Headers(request.headers);
    const lease = await options.readCurrentLease?.() ?? null;
    if (options.injectBoundUserIdHeader && lease) {
      writeRunnerRuntimeWriteFenceHeaders(headers, lease);
    }
    if (options.injectBoundUserIdHeader) {
      headers.set(HOSTED_RUNNER_BOUND_USER_ID_HEADER, boundUserId);
    }

    return await fetchImpl(new Request(request, { headers }));
  }) as typeof fetch;
}

function isInternalAuthorityRejectedStatus(status: number): boolean {
  return status === 401 || status === 403;
}

const HOSTED_RUNTIME_INTERNAL_OPERATION_DESCRIPTIONS: Record<string, string> = {
  artifact_fetch: "Hosted artifact fetch",
  artifact_upload: "Hosted artifact upload",
  assistant_runtime_issue_export: "Hosted assistant runtime issue export",
  browser_vault_replica_publish: "Hosted browser-vault replica publish",
  browser_vault_replica_write: "Hosted browser-vault replica write",
  device_sync_connect_link: "Hosted device-sync connect link",
  device_sync_dirty_ack: "Hosted device-sync dirty ack",
  device_sync_pending_dirty_state: "Hosted device-sync pending dirty state",
  device_sync_runtime_apply: "Hosted device-sync runtime apply",
  device_sync_runtime_snapshot: "Hosted device-sync runtime snapshot",
  mailbox_fetch: "Hosted mailbox fetch",
  mailbox_payload_decode: "Hosted mailbox payload decode",
  mailbox_payload_fetch: "Hosted mailbox payload fetch",
  runtime_log_write: "Hosted runtime log write",
  usage_recording: "Hosted usage recording",
  workspace_checkpoint: "Hosted workspace checkpoint",
  workspace_read: "Hosted workspace read",
};

function readHostedRuntimeInternalRequestDescription(input: {
  hostname: string;
  method: string;
  operation: string;
  pathname: string;
}): string {
  const fixedDescription =
    HOSTED_RUNTIME_INTERNAL_OPERATION_DESCRIPTIONS[input.operation];
  if (fixedDescription) {
    return fixedDescription;
  }

  if (input.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort) {
    if (
      input.method === "POST"
      && input.pathname === HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH
    ) {
      return "Hosted email send";
    }

    if (input.method === "GET" && /^\/messages\/[^/]+$/u.test(input.pathname)) {
      return "Hosted raw email read";
    }

    if (
      input.method === "POST"
      && input.pathname === HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH
    ) {
      return "Hosted Telegram file download";
    }

    if (
      input.method === "POST"
      && input.pathname === HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH
    ) {
      return "Hosted Telegram file lookup";
    }
  }

  return `Hosted runtime internal request to ${input.hostname}${input.pathname}`;
}

function readHostedRuntimeInternalRequestLogPath(url: URL): string {
  if (
    url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore
    && /^\/objects\/[a-f0-9]{64}$/u.test(url.pathname)
  ) {
    return "/objects/REDACTED";
  }

  if (
    url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort
    && /^\/messages\/[^/]+$/u.test(url.pathname)
  ) {
    return "/messages/REDACTED";
  }

  return url.pathname;
}

function createHostedInternalRequest(
  request: Request,
  headers: Headers,
): Request {
  return new Request(request, {
    headers,
  });
}

function createHostedWebDeviceSyncPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async applyUpdates(runtimeInput: {
      occurredAt?: string | null;
      updates: unknown;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          ...(runtimeInput.occurredAt ? { occurredAt: runtimeInput.occurredAt } : {}),
          updates: runtimeInput.updates,
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted device-sync runtime apply",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncRuntimeApplyResponse(payload);
    },
    async createConnectLink(runtimeInput: {
      connectTarget: string;
      messagingReturnTarget?: HostedRuntimeDeviceSyncMessagingReturnTarget | null;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        ...(runtimeInput.messagingReturnTarget
          ? {
              body: {
                messagingReturnTarget: runtimeInput.messagingReturnTarget,
              },
            }
          : {}),
        boundUserId: input.boundUserId,
        description: `Hosted device-sync connect link ${runtimeInput.connectTarget}`,
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: buildHostedExecutionDeviceSyncConnectLinkPath(runtimeInput.connectTarget),
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncConnectLinkResponse(payload);
    },
    async fetchSnapshot(runtimeInput: {
      connectionId?: string | null;
      provider?: string | null;
      sourceProviderSlug?: string | null;
    } = {}) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          ...(runtimeInput.connectionId ? { connectionId: runtimeInput.connectionId } : {}),
          includeCredentialMaterial: input.transport.mode === "direct",
          ...(runtimeInput.provider ? { provider: runtimeInput.provider } : {}),
          ...(runtimeInput.sourceProviderSlug ? { sourceProviderSlug: runtimeInput.sourceProviderSlug } : {}),
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted device-sync runtime snapshot",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(payload);
    },
    async fetchDirtyStates(runtimeInput?: {
      limit?: number | null;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          ...(runtimeInput?.limit === undefined ? {} : { limit: runtimeInput.limit }),
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted device-sync pending dirty state",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncDirtyPendingResponse(payload);
    },
    async ackDirtyStateProcessed(runtimeInput: {
      connectionId: string;
      processedDirtyPayloadIds?: string[];
      processedRevision: string;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          connectionId: runtimeInput.connectionId,
          ...(runtimeInput.processedDirtyPayloadIds
            ? { processedDirtyPayloadIds: runtimeInput.processedDirtyPayloadIds }
            : {}),
          processedRevision: runtimeInput.processedRevision,
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted device-sync dirty ack",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncDirtyAckResponse(payload);
    },
  };
}

function createHostedWebMailboxPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async fetch(request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetch"]>[0]) {
      const payload = await fetchReplaySafeHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted mailbox fetch",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedMailboxFetchResponse(payload);
    },
    async fetchPayload(
      request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetchPayload"]>[0],
    ) {
      const payload = await fetchReplaySafeHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted mailbox payload fetch",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedMailboxPayloadFetchResponse(payload);
    },
  };
}

function createHostedWebWorkspacePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}) {
  return {
    async read() {
      const payload = await fetchHostedWebControlPlaneJson({
        boundUserId: input.boundUserId,
        description: "Hosted workspace read",
        fetchImpl: input.fetchImpl,
        method: "GET",
        path: HOSTED_RUNTIME_WORKSPACE_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedWorkspaceReadResponse(payload);
    },
    async checkpoint(
      request: Parameters<NonNullable<HostedRuntimePlatform["workspacePort"]>["checkpoint"]>[0],
    ) {
      const checkpointWorkspace = async (
        checkpointRequest: Parameters<
          NonNullable<HostedRuntimePlatform["workspacePort"]>["checkpoint"]
        >[0],
      ) => {
        const payload = await fetchHostedWebControlPlaneJson({
          body: checkpointRequest,
          boundUserId: input.boundUserId,
          description: "Hosted workspace checkpoint",
          fetchImpl: input.fetchImpl,
          ...(input.workspaceCheckpointBridge
            ? {
                headers: await requireHostedRuntimeWriteFenceHeaders(
                  input.workspaceCheckpointBridge,
                  "Hosted workspace checkpoint",
                ),
              }
            : {}),
          path: HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        });

        return parseHostedWorkspaceCheckpointResponse(payload);
      };

      if (!input.workspaceCheckpointBridge) {
        return await checkpointWorkspace(request);
      }

      const response = await checkpointHostedRuntimeBridgeWebWorkspace({
        checkpointWorkspace,
        readCurrentLease: input.workspaceCheckpointBridge.readCurrentLease,
        request,
        userId: input.boundUserId,
      });
      if (response.checkpointed) {
        await input.workspaceCheckpointBridge.recordCheckpoint?.({
          workspaceVersion: response.workspace.version,
        });
      }
      return response;
    },
  };
}

function createCloudflareWorkspaceSnapshotPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport | null;
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
      const body = Readable.toWeb(createReadStream(request.sourceFilePath)) as BodyInit;
      const checksumSha256Base64 = encodeHostedWorkspaceSnapshotSha256Base64(
        request.encryptedObjectSha256,
      );
      const putStartedAt = Date.now();
      const response = await fetchHostedResponse({
        description: "Hosted workspace snapshot direct R2 upload",
        fetchImpl: input.fetchImpl,
        init: {
          body,
          duplex: "half",
          headers: {
            "content-length": String(request.encryptedByteSize),
            "content-type": HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
            "if-none-match": "*",
            "x-amz-checksum-sha256": checksumSha256Base64,
            "x-amz-meta-encryptedsha256": request.encryptedObjectSha256,
            "x-amz-meta-schema": HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
            "x-amz-meta-snapshotid": request.snapshotId,
          },
          method: "PUT",
        } as RequestInit & { duplex: "half" },
        redactedLogPath: "/workspace-snapshot-object",
        redactedResponseOrigin: "workspace_snapshot_object",
        timeoutMs: Math.max(1, expiresAtMs - Date.now()),
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

export type HostedWorkspaceSnapshotRestoreStep =
  | "archive_restore"
  | "data_key_unwrap"
  | "object_fetch"
  | "presign_get"
  | "scratch_prepare"
  | "size_guard";

const HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEPS =
  new Set<HostedWorkspaceSnapshotRestoreStep>([
    "archive_restore",
    "data_key_unwrap",
    "object_fetch",
    "presign_get",
    "scratch_prepare",
    "size_guard",
  ]);

function buildHostedWorkspaceSnapshotRestoreLogDetails(input: {
  ref: HostedWorkspaceSnapshotV2Ref;
  scratchRootPresent: boolean;
  timeoutMs: number;
}): HostedExecutionStructuredLogDetails {
  return {
    archiveCompression: input.ref.archive.compression,
    archiveEncryptedByteSize: input.ref.archive.encryptedByteSize,
    archiveFileCount: input.ref.archive.fileCount,
    archiveTotalPlainBytes: input.ref.archive.totalPlainBytes,
    operation: "workspace_snapshot_restore",
    scratchRootPresent: input.scratchRootPresent,
    timeoutMs: input.timeoutMs,
  };
}

async function runHostedWorkspaceSnapshotRestoreReplaySafeReadStep<T>(input: {
  details: HostedExecutionStructuredLogDetails;
  run(): Promise<T>;
  step: HostedWorkspaceSnapshotRestoreStep;
}): Promise<T> {
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS;
    attempt += 1
  ) {
    const attemptDetails = {
      ...input.details,
      workspaceSnapshotRestoreAttempt: attempt,
      workspaceSnapshotRestoreMaxAttempts: HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS,
    };

    try {
      return await runHostedWorkspaceSnapshotRestoreStep({
        ...input,
        details: attemptDetails,
      });
    } catch (error) {
      lastError = error;
      const retrying = shouldRetryHostedRuntimeReplaySafeRead({
        attempt,
        error,
      });
      if (!retrying) {
        throw error;
      }

      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.workspace-snapshot",
        details: {
          ...attemptDetails,
          retrying,
          workspaceSnapshotRestoreStep: input.step,
          ...buildHostedRuntimeControlPlaneSafeErrorMetadata(error),
        },
        level: "warn",
        message: "Hosted workspace snapshot restore read step failed; retrying.",
        phase: "runtime.starting",
        userId: null,
      });
      await sleepHostedReplaySafeReadRetryDelay();
    }
  }

  throw lastError;
}

async function runHostedWorkspaceSnapshotRestoreStep<T>(input: {
  details: HostedExecutionStructuredLogDetails;
  run(): Promise<T>;
  step: HostedWorkspaceSnapshotRestoreStep;
}): Promise<T> {
  const startedAt = Date.now();
  emitHostedExecutionStructuredLog({
    component: "hosted.runtime.workspace-snapshot",
    details: {
      ...input.details,
      workspaceSnapshotRestoreStep: input.step,
    },
    message: "Hosted workspace snapshot restore step started.",
    phase: "runtime.starting",
    userId: null,
  });

  try {
    const result = await input.run();
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.workspace-snapshot",
      details: {
        ...input.details,
        durationMs: Date.now() - startedAt,
        workspaceSnapshotRestoreStep: input.step,
      },
      message: "Hosted workspace snapshot restore step completed.",
      phase: "runtime.starting",
      userId: null,
    });
    return result;
  } catch (error) {
    annotateHostedWorkspaceSnapshotRestoreStep(error, input.step);
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.workspace-snapshot",
      details: {
        ...input.details,
        durationMs: Date.now() - startedAt,
        workspaceSnapshotRestoreStep: input.step,
        ...buildHostedRuntimeControlPlaneSafeErrorMetadata(error),
      },
      level: "warn",
      message: "Hosted workspace snapshot restore step failed.",
      phase: "runtime.starting",
      userId: null,
    });
    throw error;
  }
}

function annotateHostedWorkspaceSnapshotRestoreStep(
  error: unknown,
  step: HostedWorkspaceSnapshotRestoreStep,
): void {
  if (!error || typeof error !== "object") {
    return;
  }
  const record = error as Record<string, unknown>;
  if (
    readHostedWorkspaceSnapshotRestoreStepValue(
      record[HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEP_MARKER],
    )
  ) {
    return;
  }
  try {
    Object.defineProperty(error, HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEP_MARKER, {
      configurable: true,
      enumerable: false,
      value: step,
    });
  } catch {
    // Best-effort diagnostics only; never mask the original restore failure.
  }
}

export function readHostedWorkspaceSnapshotRestoreStep(
  error: unknown,
): HostedWorkspaceSnapshotRestoreStep | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const step = readHostedWorkspaceSnapshotRestoreStepValue(
      record[HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEP_MARKER],
    );
    if (step) {
      return step;
    }
    current = "cause" in record ? record.cause : null;
  }

  return null;
}

function readHostedWorkspaceSnapshotRestoreStepValue(
  value: unknown,
): HostedWorkspaceSnapshotRestoreStep | null {
  return (
    typeof value === "string"
    && HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEPS.has(
      value as HostedWorkspaceSnapshotRestoreStep,
    )
  )
    ? (value as HostedWorkspaceSnapshotRestoreStep)
    : null;
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

function createHostedWebRuntimeLogPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async write(request: Parameters<NonNullable<HostedRuntimePlatform["logPort"]>["write"]>[0]) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted runtime log write",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_LOG_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedRuntimeLogResponse(payload);
    },
  };
}

async function fetchReplaySafeHostedWebControlPlaneJson(input: {
  body?: unknown;
  boundUserId: string;
  description: string;
  fetchImpl: typeof fetch;
  method?: "GET" | "POST";
  path: string;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): Promise<unknown> {
  assertReplaySafeHostedWebControlRetryPath(input.path);

  let attempt = 0;
  let lastError: unknown;

  while (attempt < HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS) {
    try {
      return await fetchHostedWebControlPlaneJson(input);
    } catch (error) {
      attempt += 1;
      lastError = error;
      if (
        attempt >= HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS
        || !isRetryableHostedWebControlReadError(error)
      ) {
        throw error;
      }

      await sleepHostedReplaySafeReadRetryDelay();
    }
  }

  throw lastError;
}

function assertReplaySafeHostedWebControlRetryPath(path: string): void {
  const { pathname } = readHostedRunnerWebControlRoute(path);
  if (
    pathname !== HOSTED_RUNTIME_MAILBOX_FETCH_PATH
    && pathname !== HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH
  ) {
    throw new TypeError("Hosted web-control retry is only allowed for hosted mailbox reads.");
  }
}

async function fetchHostedWebControlPlaneJson(input: {
  acceptedStatuses?: readonly number[];
  body?: unknown;
  boundUserId: string;
  description: string;
  fetchImpl: typeof fetch;
  headers?: Headers;
  method?: "GET" | "POST";
  path: string;
  signal?: AbortSignal | null;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): Promise<unknown> {
  const method = input.method ?? (input.body === undefined ? "GET" : "POST");
  const route = readHostedRunnerWebControlRoute(input.path);
  assertAllowedHostedRunnerWebControlRequest({
    method,
    path: route.pathname,
  });
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const requestStartedAt = Date.now();
  const requestLogDetails = buildHostedWebControlRequestLogDetails({
    body,
    description: input.description,
    method,
    path: route.pathname,
    timeoutMs: input.timeoutMs,
    transport: input.transport,
  });

  emitHostedExecutionStructuredLog({
    component: "hosted.runtime.control-plane",
    details: requestLogDetails,
    message: "Hosted runtime control-plane request started.",
    phase: "runtime.starting",
    userId: input.boundUserId,
  });

  let response: Response;
  const directTimeoutSignal = input.transport.mode === "direct"
    ? AbortSignal.timeout(input.timeoutMs)
    : null;
  const directRequestSignal = directTimeoutSignal
    ? combineAbortSignals(input.signal ?? null, directTimeoutSignal)
    : null;
  try {
    response = input.transport.mode === "direct"
      ? await fetchHostedExecutionWebControlPlaneResponse({
        baseUrl: input.transport.webControlBaseUrl,
        body,
        boundUserId: input.boundUserId,
        callbackSigning: input.transport.callbackSigning,
        fetchImpl: input.fetchImpl,
        headers: input.headers,
        method,
        path: route.pathAndSearch,
        signal: directRequestSignal,
        timeoutMs: input.timeoutMs,
      })
      : await fetchHostedResponse({
        description: input.description,
        fetchImpl: input.fetchImpl,
        init: {
          ...(body === undefined ? {} : { body }),
          headers: createHostedWebControlProxyHeaders({
            headers: input.headers,
            hasJsonBody: body !== undefined,
          }),
          method,
        },
        redactedLogPath: createHostedWebControlLogPath(route.pathname),
        signal: input.signal ?? null,
        timeoutMs: input.timeoutMs,
        url: createHostedWebControlProxyUrl(route.pathAndSearch),
      });
  } catch (error) {
    const shouldPreserveError =
      shouldPreserveHostedRuntimeFetchError(error)
      || (
        error instanceof Error
        && error.message.startsWith(`${input.description} request failed`)
      );
    const loggedError = shouldPreserveError
      ? error
      : new HostedRuntimeControlPlaneFetchError({
        cause: error,
        description: input.description,
        signalState: {
          callerSignalAborted: false,
          requestSignalAborted: directRequestSignal?.aborted ?? false,
          timeoutMs: input.timeoutMs,
          timeoutSignalAborted: directTimeoutSignal?.aborted ?? false,
        },
      });
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.control-plane",
      details: {
        ...requestLogDetails,
        durationMs: Date.now() - requestStartedAt,
        ...buildHostedRuntimeControlPlaneSafeErrorMetadata(loggedError),
      },
      level: "warn",
      message: "Hosted runtime control-plane request failed before response.",
      phase: "runtime.starting",
      userId: input.boundUserId,
    });

    if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
      throw error;
    }

    if (shouldPreserveError) {
      throw error;
    }

    throw loggedError;
  }

  emitHostedExecutionStructuredLog({
    component: "hosted.runtime.control-plane",
    details: {
      ...requestLogDetails,
      acceptedStatus: input.acceptedStatuses?.includes(response.status) ?? false,
      contentLengthPresent: response.headers.has("content-length"),
      contentTypePresent: response.headers.has("content-type"),
      durationMs: Date.now() - requestStartedAt,
      responseOk: response.ok,
      responseStatus: response.status,
    },
    message: "Hosted runtime control-plane response received.",
    phase: "runtime.starting",
    userId: input.boundUserId,
  });

  const acceptedStatus = input.acceptedStatuses?.includes(response.status) ?? false;
  if (!response.ok && !acceptedStatus) {
    const detail = (await response.text()).trim();
    const error = new Error(
      detail.length > 0
        ? `${input.description} failed with HTTP ${response.status}. ${detail}`
        : `${input.description} failed with HTTP ${response.status}.`,
    ) as Error & {
      status: number;
      statusCode: number;
    };
    error.status = response.status;
    error.statusCode = response.status;
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: input.description,
        method,
        path: createHostedWebControlLogPath(route.pathname),
        responseOrigin: input.transport.mode === "direct"
          ? new URL(input.transport.webControlBaseUrl).origin
          : CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane,
        responseStatus: response.status,
        transport: input.transport.mode,
        userId: input.boundUserId,
      },
      error,
      level: "warn",
      message: "Hosted runtime control-plane response returned non-OK.",
      phase: "outbox",
      userId: input.boundUserId,
    });
    throw error;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.control-plane",
      details: {
        ...requestLogDetails,
        durationMs: Date.now() - requestStartedAt,
        ...buildHostedRuntimeControlPlaneSafeErrorMetadata(error),
        responseBodyBytes: new TextEncoder().encode(text).byteLength,
        responseStatus: response.status,
      },
      level: "warn",
      message: "Hosted runtime control-plane response returned invalid JSON.",
      phase: "runtime.starting",
      userId: input.boundUserId,
    });
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
}

function buildHostedRuntimeControlPlaneSafeErrorMetadata(
  error: unknown,
): HostedExecutionStructuredLogDetails {
  const fetchFailureDiagnostics =
    readHostedRuntimeControlPlaneFetchFailureDiagnostics(error);
  const workspaceSnapshotRestoreStep =
    readHostedWorkspaceSnapshotRestoreStep(error);
  return {
    errorCode: fetchFailureDiagnostics?.fetchCauseCode
      ?? deriveHostedExecutionErrorCode(error),
    errorMessagePresent: error instanceof Error && error.message.trim().length > 0,
    ...(readHostedExecutionSafeErrorName(error)
      ? { errorName: readHostedExecutionSafeErrorName(error) }
      : {}),
    ...(fetchFailureDiagnostics
      ? {
          fetchCallerSignalAborted:
            fetchFailureDiagnostics.fetchCallerSignalAborted,
          fetchCauseCode: fetchFailureDiagnostics.fetchCauseCode,
          fetchCauseKind: fetchFailureDiagnostics.fetchCauseKind,
          ...(fetchFailureDiagnostics.fetchCauseName
            ? { fetchCauseName: fetchFailureDiagnostics.fetchCauseName }
            : {}),
          fetchRequestSignalAborted:
            fetchFailureDiagnostics.fetchRequestSignalAborted,
          fetchTimeoutMs: fetchFailureDiagnostics.fetchTimeoutMs,
          fetchTimeoutSignalAborted:
            fetchFailureDiagnostics.fetchTimeoutSignalAborted,
        }
      : {}),
    ...(workspaceSnapshotRestoreStep
      ? { workspaceSnapshotRestoreStep }
      : {}),
  };
}

export function readHostedRuntimeControlPlaneFetchFailureDiagnostics(
  error: unknown,
): HostedRuntimeControlPlaneFetchFailureDiagnostics | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (record[HOSTED_RUNTIME_CONTROL_PLANE_FETCH_FAILURE_MARKER] === true) {
      const fetchCauseKind = readHostedRuntimeFetchCauseKind(
        record.hostedRuntimeFetchCauseKind,
      );
      const fetchCauseCode = readHostedRuntimeFetchCauseCode(
        record.hostedRuntimeFetchCauseCode,
      );
      const fetchTimeoutMs = readHostedRuntimeFetchTimeoutMs(
        record.hostedRuntimeFetchTimeoutMs,
      );
      const fetchCallerSignalAborted =
        readHostedRuntimeFetchBoolean(record.hostedRuntimeFetchCallerSignalAborted);
      const fetchRequestSignalAborted =
        readHostedRuntimeFetchBoolean(record.hostedRuntimeFetchRequestSignalAborted);
      const fetchTimeoutSignalAborted =
        readHostedRuntimeFetchBoolean(record.hostedRuntimeFetchTimeoutSignalAborted);
      if (
        fetchCauseKind
        && fetchCauseCode
        && fetchTimeoutMs !== null
        && fetchCallerSignalAborted !== null
        && fetchRequestSignalAborted !== null
        && fetchTimeoutSignalAborted !== null
      ) {
        const fetchCauseName = readHostedRuntimeFetchCauseNameValue(
          record.hostedRuntimeFetchCauseName,
        );
        return {
          fetchCallerSignalAborted,
          fetchCauseCode,
          fetchCauseKind,
          ...(fetchCauseName ? { fetchCauseName } : {}),
          fetchRequestSignalAborted,
          fetchTimeoutMs,
          fetchTimeoutSignalAborted,
        };
      }
    }

    current = "cause" in record ? record.cause : null;
  }

  return null;
}

function buildHostedWebControlRequestLogDetails(input: {
  body: string | undefined;
  description: string;
  method: "GET" | "POST";
  path: string;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): HostedExecutionStructuredLogDetails {
  return {
    bodyBytes: input.body === undefined ? 0 : new TextEncoder().encode(input.body).byteLength,
    bodyPresent: input.body !== undefined,
    description: input.description,
    method: input.method,
    path: createHostedWebControlLogPath(input.path),
    responseOrigin: readHostedWebControlResponseOrigin(input.transport),
    timeoutMs: input.timeoutMs,
    transport: input.transport.mode,
  };
}

function readHostedWebControlResponseOrigin(transport: HostedWebControlTransport): string {
  return transport.mode === "direct"
    ? new URL(transport.webControlBaseUrl).origin
    : CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane;
}

function createHostedWebControlProxyUrl(path: string): URL {
  return new URL(
    path.replace(/^\/+/u, ""),
    `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}/`,
  );
}

function createHostedWebControlLogPath(path: string): string {
  const url = new URL(path.replace(/^\/+/u, ""), "https://hosted-runtime.invalid/");
  return url.pathname;
}

function createHostedWebControlProxyHeaders(input: {
  headers?: Headers;
  hasJsonBody: boolean;
}): Headers | undefined {
  const headers = new Headers(input.headers);
  let hasHeaders = false;

  if (input.hasJsonBody) {
    headers.set("content-type", "application/json");
    hasHeaders = true;
  }

  headers.forEach(() => {
    hasHeaders = true;
  });

  return hasHeaders ? headers : undefined;
}

function appendHostedRuntimeRequestIdQuery(
  path: string,
  requestId: string,
  extraParams: Readonly<Record<string, string>> = {},
): string {
  const url = new URL(path.replace(/^\/+/u, ""), "https://hosted-runtime.invalid/");
  url.searchParams.set("requestId", requestId);
  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

async function fetchHostedJson(input: {
  allowNotFound?: boolean;
  body?: unknown;
  description: string;
  fetchImpl: typeof fetch;
  headers?: Headers;
  redactedLogPath?: string;
  method: "DELETE" | "GET" | "POST" | "PUT";
  signal?: AbortSignal | null;
  timeoutMs: number;
  url: URL;
}): Promise<unknown> {
  const response = await fetchHostedResponse({
    description: input.description,
    fetchImpl: input.fetchImpl,
    init: {
      ...(input.body === undefined
        ? {}
        : {
            body: JSON.stringify(input.body),
            headers: mergeHostedRuntimeJsonHeaders(input.headers),
          }),
      ...(input.body === undefined && input.headers
        ? { headers: input.headers }
        : {}),
      method: input.method,
    },
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs,
    url: input.url,
    ...(input.redactedLogPath ? { redactedLogPath: input.redactedLogPath } : {}),
  });

  if (input.allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const detail = (await response.text()).trim();
    const error = new Error(
      detail.length > 0
        ? `${input.description} failed with HTTP ${response.status}. ${detail}`
        : `${input.description} failed with HTTP ${response.status}.`,
    ) as Error & {
      status: number;
      statusCode: number;
    };
    error.status = response.status;
    error.statusCode = response.status;
    const logError = new Error(
      `${input.description} failed with HTTP ${response.status}.`,
    ) as Error & {
      status: number;
      statusCode: number;
    };
    logError.status = response.status;
    logError.statusCode = response.status;
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: input.description,
        method: input.method,
        path: input.redactedLogPath ?? input.url.pathname,
        responseBodyBytes: new TextEncoder().encode(detail).byteLength,
        responseBodyPresent: detail.length > 0,
        responseOrigin: input.url.origin,
        responseStatus: response.status,
      },
      error: logError,
      level: "warn",
      message: "Hosted runtime upstream response returned non-OK.",
      phase: "outbox",
      userId: null,
    });
    throw error;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
}

async function fetchHostedProviderEffectJson(input: {
  body: unknown;
  description: string;
  fetchImpl: typeof fetch;
  headers: Headers;
  timeoutMs: number;
  url: URL;
}): Promise<unknown> {
  const response = await fetchHostedResponse({
    description: input.description,
    fetchImpl: input.fetchImpl,
    init: {
      body: JSON.stringify(input.body),
      headers: mergeHostedRuntimeJsonHeaders(input.headers),
      method: "POST",
    },
    timeoutMs: input.timeoutMs,
    url: input.url,
  });

  const text = await response.text();
  if (!response.ok) {
    throw createHostedProviderEffectError({
      description: input.description,
      payload: parseJsonObjectOrNull(text),
      status: response.status,
    });
  }

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
}

function createHostedProviderEffectError(input: {
  description: string;
  payload: unknown;
  status: number;
}): Error {
  const providerError = parseHostedRunnerProviderEffectErrorResponse(input.payload);
  const error = new Error(
    providerError?.error
      ? `${input.description} failed with HTTP ${input.status}. ${providerError.error}`
      : `${input.description} failed with HTTP ${input.status}.`,
  ) as Error & {
    cleanupMessages?: unknown;
    cleanupTargetAliases?: unknown;
    code?: string;
    context?: unknown;
    providerMessageId?: string | null;
    providerMessageIds?: unknown;
    status: number;
    statusCode: number;
    target?: string;
  };
  error.status = input.status;
  error.statusCode = input.status;
  if (providerError?.code) {
    error.code = providerError.code;
  }
  if (providerError?.context) {
    error.context = providerError.context;
  }
  if (providerError?.providerMessageIds) {
    error.providerMessageIds = providerError.providerMessageIds;
  }
  if (providerError?.providerMessageId !== undefined) {
    error.providerMessageId = providerError.providerMessageId;
  } else if (providerError?.providerMessageIds) {
    error.providerMessageId = providerError.providerMessageIds.at(-1) ?? null;
  }
  if (providerError?.cleanupMessages) {
    error.cleanupMessages = providerError.cleanupMessages;
  }
  if (providerError?.cleanupTargetAliases) {
    error.cleanupTargetAliases = providerError.cleanupTargetAliases;
  }
  if (providerError?.target) {
    error.target = providerError.target;
  }
  return error;
}

function parseJsonObjectOrNull(text: string): unknown {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mergeHostedRuntimeJsonHeaders(headers: Headers | undefined): Headers {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json; charset=utf-8");
  return merged;
}

async function fetchHostedResponse(input: {
  description: string;
  fetchImpl: typeof fetch;
  init?: RequestInit;
  redactedLogPath?: string;
  redactedResponseOrigin?: string;
  signal?: AbortSignal | null;
  timeoutMs: number;
  url: URL;
}): Promise<Response> {
  const callerSignal = input.signal ?? input.init?.signal ?? null;
  const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
  const requestSignal = combineAbortSignals(callerSignal, timeoutSignal);
  try {
    return await input.fetchImpl(input.url, {
      ...input.init,
      signal: requestSignal,
    });
  } catch (error) {
    if (shouldPreserveHostedRuntimeFetchError(error)) {
      throw error;
    }

    const wrappedError = new HostedRuntimeControlPlaneFetchError({
      cause: error,
      description: input.description,
      signalState: {
        callerSignalAborted: callerSignal?.aborted ?? false,
        requestSignalAborted: requestSignal.aborted,
        timeoutMs: input.timeoutMs,
        timeoutSignalAborted: timeoutSignal.aborted,
      },
    });

    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: input.description,
        method: input.init?.method ?? "GET",
        path: input.redactedLogPath ?? input.url.pathname,
        responseOrigin: input.redactedResponseOrigin ?? input.url.origin,
        ...buildHostedRuntimeControlPlaneSafeErrorMetadata(wrappedError),
      },
      level: "warn",
      message: "Hosted runtime upstream request failed.",
      phase: "outbox",
      userId: null,
    });
    throw wrappedError;
  }
}

function combineAbortSignals(
  first: AbortSignal | null,
  second: AbortSignal,
): AbortSignal {
  if (!first) {
    return second;
  }

  if (first.aborted) {
    return first;
  }

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  const abortFirst = () => abort(first);
  const abortSecond = () => abort(second);
  first.addEventListener("abort", abortFirst, { once: true });
  second.addEventListener("abort", abortSecond, { once: true });
  return controller.signal;
}

function classifyHostedRuntimeFetchCause(
  error: unknown,
  signalState: HostedRuntimeControlPlaneFetchSignalState,
): HostedRuntimeControlPlaneFetchCauseKind {
  const message = readHostedRuntimeFetchCauseMessage(error).toLowerCase();
  const causeName = error instanceof Error ? error.name : "";

  if (message === "the rpc call destroy() was called") {
    return "cloudflare_rpc_destroy";
  }

  if (
    signalState.timeoutSignalAborted
    || causeName === "TimeoutError"
    || message.includes("timed out")
    || message.includes("timeout")
  ) {
    return "timeout";
  }

  if (
    signalState.callerSignalAborted
    || causeName === "AbortError"
    || message.includes("abort")
  ) {
    return "abort";
  }

  if (
    message.includes("network")
    || message.includes("socket")
    || message.includes("connection reset")
  ) {
    return "network";
  }

  if (error instanceof TypeError || message.includes("fetch failed")) {
    return "fetch_failed";
  }

  return "unknown";
}

function shouldPreserveHostedRuntimeFetchError(error: unknown): boolean {
  if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
    return true;
  }

  const message = readHostedRuntimeFetchCauseMessage(error).toLowerCase();
  return message.includes("missing a runtime write-fence authority")
    || message.includes("hosted web control-plane baseurl")
    || message.includes("must not include a path");
}

function readHostedRuntimeFetchCauseMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }

  if (typeof error === "string") {
    return error.trim();
  }

  return "";
}

function readHostedRuntimeFetchCauseName(error: unknown): string | null {
  return error instanceof Error
    ? readHostedRuntimeFetchCauseNameValue(error.name)
    : null;
}

function readHostedRuntimeFetchCauseNameValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return HOSTED_RUNTIME_FETCH_CAUSE_NAMES.has(normalized) ? normalized : null;
}

function readHostedRuntimeFetchCauseKind(
  value: unknown,
): HostedRuntimeControlPlaneFetchCauseKind | null {
  switch (value) {
    case "abort":
    case "cloudflare_rpc_destroy":
    case "fetch_failed":
    case "network":
    case "timeout":
    case "unknown":
      return value;
    default:
      return null;
  }
}

function readHostedRuntimeFetchCauseCode(
  value: unknown,
): HostedExecutionErrorCode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  switch (normalized) {
    case "authorization_error":
    case "bundle_archive_validation_error":
    case "checkpoint_error":
    case "configuration_error":
    case "invalid_request":
    case "outbox_error":
    case "range_error":
    case "reference_error":
    case "runner_http_error":
    case "runtime_error":
    case "syntax_error":
    case "timeout":
    case "type_error":
    case "uri_error":
      return normalized;
    default:
      return null;
  }
}

function readHostedRuntimeFetchBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readHostedRuntimeFetchTimeoutMs(value: unknown): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= 3_600_000
    ? value
    : null;
}

function shouldRetryHostedRuntimeReplaySafeRead(input: {
  attempt: number;
  error: unknown;
}): boolean {
  if (input.attempt >= HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS) {
    return false;
  }

  return isRetryableHostedRuntimeReplaySafeReadTransportError(input.error);
}

function isRetryableHostedRuntimeReplaySafeReadTransportError(
  error: unknown,
): boolean {
  if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
    return false;
  }

  const diagnostics = readHostedRuntimeControlPlaneFetchFailureDiagnostics(error);
  if (diagnostics) {
    if (
      diagnostics.fetchCallerSignalAborted
      || diagnostics.fetchRequestSignalAborted
      || diagnostics.fetchTimeoutSignalAborted
    ) {
      return false;
    }

    return diagnostics.fetchCauseKind === "cloudflare_rpc_destroy"
      || diagnostics.fetchCauseKind === "fetch_failed"
      || diagnostics.fetchCauseKind === "network";
  }

  if (isHostedWebControlAbortError(error) || isHostedWebControlTimeoutError(error)) {
    return false;
  }

  if (readHostedWebControlErrorStatus(error) !== null) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.trim().toLowerCase();
  return message === "fetch failed"
    || message === "the rpc call destroy() was called"
    || message.includes(" fetch failed")
    || message.includes("network")
    || message.includes("socket")
    || message.includes("connection reset");
}

function isRetryableHostedWebControlReadError(error: unknown): boolean {
  if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
    return false;
  }

  if (isHostedWebControlAbortError(error)) {
    return false;
  }

  const status = readHostedWebControlErrorStatus(error);
  if (status !== null) {
    return status === 408 || status === 429 || status === 500 || status === 502
      || status === 503 || status === 504;
  }

  if (isHostedWebControlTimeoutError(error)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.trim().toLowerCase();
  return message === "fetch failed"
    || message.includes(" fetch failed")
    || message.includes("request failed")
    || message.includes("network")
    || message.includes("socket")
    || message.includes("connection reset");
}

function isHostedWebControlAbortError(error: unknown): boolean {
  return hasHostedWebControlErrorName(error, "AbortError");
}

function isHostedWebControlTimeoutError(error: unknown): boolean {
  return hasHostedWebControlErrorName(error, "TimeoutError");
}

function hasHostedWebControlErrorName(error: unknown, name: "AbortError" | "TimeoutError"): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);

    if (current instanceof Error && current.name === name) {
      return true;
    }

    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }

  return false;
}

function readHostedWebControlErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  for (const property of ["status", "statusCode", "responseStatus"] as const) {
    const value = (error as Partial<Record<typeof property, unknown>>)[property];
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return value;
    }
  }

  return null;
}

function sleepHostedReplaySafeReadRetryDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, HOSTED_REPLAY_SAFE_READ_RETRY_DELAY_MS);
  });
}

function readHostedRuntimeStepElapsedMs(startedAt: number): number {
  const elapsedMs = Date.now() - startedAt;
  return Number.isSafeInteger(elapsedMs) && elapsedMs >= 0
    ? elapsedMs
    : 0;
}

function assertHostedOk(response: Response, description: string): void {
  if (response.ok) {
    return;
  }

  const error = new Error(`${description} failed with HTTP ${response.status}.`) as Error & {
    status: number;
    statusCode: number;
  };
  error.status = response.status;
  error.statusCode = response.status;
  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details: {
      description,
      responseStatus: response.status,
    },
    error,
    level: "warn",
    message: "Hosted runtime upstream response returned non-OK.",
    phase: "outbox",
    userId: null,
  });
  throw error;
}

function readOptionalStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime response must be an object.");
  }

  const entry = (value as Record<string, unknown>)[field];
  if (entry === undefined || entry === null) {
    return null;
  }

  if (typeof entry !== "string") {
    throw new TypeError(`Hosted runtime response.${field} must be a string.`);
  }

  return entry;
}

function readRequiredHostedRuntimeString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function readRequiredHostedRuntimeObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readRequiredHostedRuntimePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function readRequiredField(value: unknown, field: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime response must be an object.");
  }

  const entry = (value as Record<string, unknown>)[field];
  if (entry === undefined) {
    throw new TypeError(`Hosted runtime response.${field} is required.`);
  }

  return entry;
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
