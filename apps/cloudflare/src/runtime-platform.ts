import {
  parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeUsageRecordResponse,
  readHostedRunnerCommitTimeoutMs,
  type HostedRuntimeDeviceSyncMessagingReturnTarget,
  type HostedRuntimeEffectsPort,
  type HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  sha256HostedBundleHex,
} from "@murphai/runtime-state/node";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedMailboxFetchResponse,
  parseHostedMailboxPayloadFetchResponse,
  parseHostedBrowserVaultReplicaRef,
  parseHostedBrowserVaultReplicaPublishResponse,
  parseHostedRuntimeLogResponse,
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
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "./runner-outbound/headers.ts";
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

const HOSTED_MAILBOX_READ_RETRY_ATTEMPTS = 2;
const HOSTED_MAILBOX_READ_RETRY_DELAY_MS = 100;
const HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY_CODE =
  "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY";
const HOSTED_RUNTIME_INTERNAL_AUTHORITY_REJECTED_REASON =
  "internal_authority_rejected";

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
      `Hosted invocation is stale: ${HOSTED_RUNTIME_INTERNAL_AUTHORITY_REJECTED_REASON}. `
      + `${input.description} returned HTTP ${input.status}.`,
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
  const putArtifactUncached = async (
    artifact: {
      bytes: Uint8Array;
      sha256: string;
    },
    options: {
      requireWriteFence?: boolean;
    } = {},
  ): Promise<void> => {
    const headers = input.workspaceCheckpointBridge
      ? options.requireWriteFence
        ? await requireHostedRuntimeWriteFenceHeaders(
            input.workspaceCheckpointBridge,
            `Hosted artifact upload ${artifact.sha256}`,
          )
        : await createHostedRuntimeWriteFenceHeaders(input.workspaceCheckpointBridge)
      : new Headers();
    const response = await fetchHostedResponse({
      description: `Hosted artifact upload ${artifact.sha256}`,
      fetchImpl,
      init: {
        body: copyBytesToArrayBuffer(artifact.bytes),
        headers,
        method: "PUT",
      },
      timeoutMs,
      url: new URL(`/objects/${artifact.sha256}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore}/`),
    });

    assertHostedOk(response, `Hosted artifact upload ${artifact.sha256}`);
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
  return {
    artifactStore: {
      async get(sha256) {
        const response = await fetchHostedResponse({
          description: `Hosted artifact fetch ${sha256}`,
          fetchImpl,
          timeoutMs,
          url: new URL(`/objects/${sha256}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore}/`),
        });

        if (response.status === 404) {
          return null;
        }

        assertHostedOk(response, `Hosted artifact fetch ${sha256}`);
        return new Uint8Array(await response.arrayBuffer());
      },
      async put({ bytes, sha256 }) {
        await putArtifactOnce({ bytes, sha256 });
      },
    },
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
          headers.set("x-hosted-runtime-attempt-id", lease.attemptId);
          headers.set("x-hosted-runtime-lease-generation", lease.leaseGeneration);
          headers.set("x-hosted-runtime-workspace-version", lease.workspaceVersion);
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
          }) {
            const payload = await fetchHostedWebControlPlaneJson({
              body: publishInput,
              boundUserId: input.boundUserId,
              description: "Hosted browser-vault replica publish",
              fetchImpl: input.fetchImpl,
              path: HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
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
    const lease = await options.readCurrentLease?.() ?? null;
    if (!lease) {
      throw new Error(
        `Hosted runtime internal request for ${url.hostname}${url.pathname} is missing a runtime write-fence lease.`,
      );
    }
    writeRunnerRuntimeWriteFenceHeaders(headers, lease);
    if (options.injectBoundUserIdHeader) {
      headers.set(HOSTED_RUNNER_BOUND_USER_ID_HEADER, boundUserId);
    }
    const internalRequest = createHostedInternalRequest(request, headers);
    const shouldLogInternalRequest = true;
    const details = {
      effectsFingerprintPresent: url.searchParams.has("fingerprint"),
      host: url.hostname,
      method: internalRequest.method,
      path: url.pathname,
      userId: boundUserId,
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
          description: `Hosted runtime internal request to ${url.hostname}${url.pathname}`,
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
      processedRevision: string;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          connectionId: runtimeInput.connectionId,
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

  while (attempt < HOSTED_MAILBOX_READ_RETRY_ATTEMPTS) {
    try {
      return await fetchHostedWebControlPlaneJson(input);
    } catch (error) {
      attempt += 1;
      lastError = error;
      if (
        attempt >= HOSTED_MAILBOX_READ_RETRY_ATTEMPTS
        || !isRetryableHostedWebControlReadError(error)
      ) {
        throw error;
      }

      await sleepHostedMailboxReadRetryDelay();
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
  const response = input.transport.mode === "direct"
    ? await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.transport.webControlBaseUrl,
      body,
      boundUserId: input.boundUserId,
      callbackSigning: input.transport.callbackSigning,
      fetchImpl: input.fetchImpl,
      method,
      path: route.pathAndSearch,
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
      logPath: createHostedWebControlLogPath(route.pathname),
      timeoutMs: input.timeoutMs,
      url: createHostedWebControlProxyUrl(route.pathAndSearch),
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
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
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
  method: "DELETE" | "GET" | "POST" | "PUT";
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
    timeoutMs: input.timeoutMs,
    url: input.url,
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
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: input.description,
        method: input.method,
        path: input.url.pathname,
        responseOrigin: input.url.origin,
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
  logFailures?: boolean;
  logPath?: string;
  signal?: AbortSignal | null;
  timeoutMs: number;
  url: URL;
}): Promise<Response> {
  try {
    const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
    return await input.fetchImpl(input.url, {
      ...input.init,
      signal: combineAbortSignals(input.signal ?? input.init?.signal ?? null, timeoutSignal),
    });
  } catch (error) {
    if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
      throw error;
    }

    if (input.logFailures !== false) {
      emitHostedExecutionStructuredLog({
        component: "assistant-delivery",
        details: {
          description: input.description,
          method: input.init?.method ?? "GET",
          path: input.logPath ?? input.url.pathname,
          responseOrigin: input.url.origin,
        },
        error,
        level: "warn",
        message: "Hosted runtime upstream request failed.",
        phase: "outbox",
        userId: null,
      });
    }
    throw new Error(
      `${input.description} request failed.${formatHostedResponseFetchCause(error)}`,
      { cause: error },
    );
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

function formatHostedResponseFetchCause(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? ` ${message}` : "";
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return ` ${error.trim()}`;
  }

  return "";
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

function sleepHostedMailboxReadRetryDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, HOSTED_MAILBOX_READ_RETRY_DELAY_MS);
  });
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
