import {
  parseHostedRuntimeBillingStripeCustomerResponse,
  parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeUsageRecordResponse,
  readHostedRunnerCommitTimeoutMs,
  type HostedRuntimeDeviceSyncMessagingReturnTarget,
  type HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedMailboxFetchResponse,
  parseHostedMailboxPayloadFetchResponse,
  parseHostedRuntimeLogResponse,
  parseHostedRuntimeShareImportResponse,
  parseHostedRuntimeSharePayloadFetchResponse,
  parseHostedRuntimeVaultSyncImportResponse,
  parseHostedRuntimeVaultSyncPayloadFetchResponse,
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUNTIME_LOG_PATH,
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
  HOSTED_RUNTIME_SHARE_IMPORT_PATH,
  HOSTED_RUNTIME_VAULT_SYNC_IMPORT_PATH,
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
  buildHostedRuntimeSharePayloadPath,
  buildHostedRuntimeVaultSyncPayloadPath,
} from "@murphai/hosted-execution/routes";
import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
} from "./runner-email-route.ts";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  buildHostedExecutionDeviceSyncConnectLinkPath,
  parseHostedExecutionDeviceSyncConnectLinkResponse,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
} from "./internal-hosts.ts";
import {
  buildLocalInternalProxyRouteBaseUrl,
  isScopedLocalInternalProxyBaseUrl,
  readScopedLocalInternalProxyRouteUserId,
} from "./local-internal-proxy-route.ts";
import {
  assertHostedLocalInternalProxyBaseUrl,
} from "./local-loopback-proxy.ts";
import {
  assertAllowedHostedRunnerWebControlRequest,
  HOSTED_WEB_ISSUE_RECORD_PATH,
  HOSTED_WEB_STRIPE_CUSTOMER_LOOKUP_PATH,
  HOSTED_WEB_USAGE_RECORD_PATH,
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

export interface HostedWorkspaceCheckpointBridgeAuthority {
  readCurrentLease():
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
}

export function buildHostedExecutionRuntimePlatform(input: {
  boundUserId: string;
  commitTimeoutMs?: number | null;
  fetchImpl?: typeof fetch;
  internalWorkerProxyToken?: string | null;
  localInternalProxyBaseUrl?: string | null;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl?: string | null;
  workspaceCheckpointBridge?: HostedWorkspaceCheckpointBridgeAuthority | null;
}): HostedRuntimePlatform {
  const fetchImpl = createCloudflareHostedRuntimeFetch(
    input.boundUserId,
    input.internalWorkerProxyToken ?? null,
    input.localInternalProxyBaseUrl ?? null,
    input.fetchImpl ?? fetch,
  );
  const timeoutMs = readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs ?? null);
  const hostedWebControlTransport = resolveHostedWebControlTransport({
    internalWorkerProxyToken: input.internalWorkerProxyToken ?? null,
    webCallbackSigning: input.webCallbackSigning ?? null,
    webControlBaseUrl: input.webControlBaseUrl ?? null,
  });
  const hostedWebDeviceSyncPort = hostedWebControlTransport
    ? createHostedWebDeviceSyncPort({
        boundUserId: input.boundUserId,
        fetchImpl,
        timeoutMs,
        transport: hostedWebControlTransport,
      })
    : null;
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
        const headers = new Headers();
        const lease = await input.workspaceCheckpointBridge?.readCurrentLease() ?? null;
        if (lease) {
          headers.set("x-hosted-runtime-attempt-id", lease.attemptId);
          headers.set("x-hosted-runtime-lease-generation", lease.leaseGeneration);
          headers.set("x-hosted-runtime-workspace-version", lease.workspaceVersion);
        }
        const response = await fetchHostedResponse({
          description: `Hosted artifact upload ${sha256}`,
          fetchImpl,
          init: {
            body: copyBytesToArrayBuffer(bytes),
            headers,
            method: "PUT",
          },
          timeoutMs,
          url: new URL(`/objects/${sha256}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore}/`),
        });

        assertHostedOk(response, `Hosted artifact upload ${sha256}`);
      },
    },
    ...(hostedWebControlTransport
      ? {
          billingPort: createHostedWebBillingPort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport: hostedWebControlTransport,
          }),
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
          sharePort: createHostedWebSharePort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport: hostedWebControlTransport,
          }),
          vaultSyncPort: createHostedWebVaultSyncPort({
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
    effectsPort: {
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
        const payload = await fetchHostedJson({
          body: request,
          description: "Hosted email send",
          fetchImpl,
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
                path: HOSTED_WEB_ISSUE_RECORD_PATH,
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
          usageExportPort: {
            async recordUsage(usage) {
              const payload = await fetchHostedWebControlPlaneJson({
                body: {
                  usage,
                },
                boundUserId: input.boundUserId,
                description: "Hosted usage export",
                fetchImpl,
                path: HOSTED_WEB_USAGE_RECORD_PATH,
                timeoutMs,
                transport: hostedWebControlTransport,
              });

              try {
                return parseHostedRuntimeUsageRecordResponse(payload);
              } catch (error) {
                throw new Error("Hosted usage export returned invalid JSON.", {
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

function resolveHostedWebControlTransport(input: {
  internalWorkerProxyToken: string | null;
  webCallbackSigning: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl: string | null;
}): HostedWebControlTransport | null {
  if (input.internalWorkerProxyToken) {
    return {
      mode: "proxy",
    };
  }

  if (input.webControlBaseUrl && input.webCallbackSigning) {
    return {
      callbackSigning: input.webCallbackSigning,
      mode: "direct",
      webControlBaseUrl: input.webControlBaseUrl,
    };
  }

  return null;
}

function createCloudflareHostedRuntimeFetch(
  boundUserId: string,
  internalWorkerProxyToken: string | null,
  localInternalProxyBaseUrl: string | null,
  fetchImpl: typeof fetch,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
      return input instanceof Request ? fetchImpl(input) : fetchImpl(input, init);
    }

    if (!internalWorkerProxyToken) {
      throw new Error(
        `Hosted runtime internal request for ${url.hostname}${url.pathname} is missing the invocation proxy token.`,
      );
    }

    const headers = new Headers(request.headers);
    headers.set(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER, internalWorkerProxyToken);
    const proxiedUrl = localInternalProxyBaseUrl
      ? createHostedLocalInternalProxyUrl(
        localInternalProxyBaseUrl,
        url,
        boundUserId,
      )
      : url;
    const proxiedRequest = createHostedInternalProxyRequest(proxiedUrl, request, headers);
    const details = {
      effectsFingerprintPresent: url.searchParams.has("fingerprint"),
      host: url.hostname,
      method: proxiedRequest.method,
      path: url.pathname,
      proxiedViaLoopback: localInternalProxyBaseUrl ? "true" : "false",
      userId: boundUserId,
    };

    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details,
      message: "Hosted runtime internal request started.",
      phase: "outbox",
      userId: boundUserId,
    });

    try {
      const response = await fetchImpl(proxiedRequest);
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
      return response;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "assistant-delivery",
        details,
        error,
        level: "warn",
        message: "Hosted runtime internal request failed.",
        phase: "outbox",
        userId: boundUserId,
      });
      throw error;
    }
  }) as typeof fetch;
}

function createHostedLocalInternalProxyUrl(
  baseUrl: string,
  targetUrl: URL,
  boundUserId: string,
): URL {
  const normalizedBaseUrl = assertHostedLocalInternalProxyBaseUrl(baseUrl);
  const normalizedBasePath = ensureTrailingSlash(normalizedBaseUrl);
  const scopedUserId = readScopedLocalInternalProxyRouteUserId(normalizedBasePath);
  if (scopedUserId !== null && scopedUserId !== boundUserId) {
    throw new TypeError("HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL is scoped to a different user.");
  }

  const proxyBaseUrl = isScopedLocalInternalProxyBaseUrl(normalizedBasePath)
    ? normalizedBasePath
    : new URL(buildLocalInternalProxyRouteBaseUrl({
      baseUrl: normalizedBasePath.toString(),
      userId: boundUserId,
    }));
  const proxyUrl = new URL(
    `${encodeURIComponent(targetUrl.hostname)}${targetUrl.pathname}`,
    proxyBaseUrl,
  );
  proxyUrl.search = targetUrl.search;
  return proxyUrl;
}

interface HostedRequestInitWithDuplex extends RequestInit {
  duplex?: "half";
}

function createHostedInternalProxyRequest(
  proxiedUrl: URL,
  request: Request,
  headers: Headers,
): Request {
  const init: HostedRequestInitWithDuplex = {
    body: request.body,
    headers,
    method: request.method,
    signal: request.signal,
  };

  if (request.body) {
    init.duplex = "half";
  }

  return new Request(proxiedUrl, init);
}

function ensureTrailingSlash(value: URL): URL {
  if (value.pathname.endsWith("/")) {
    return value;
  }

  const next = new URL(value.toString());
  next.pathname = `${next.pathname}/`;
  return next;
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
      messagingReturnTarget?: HostedRuntimeDeviceSyncMessagingReturnTarget | null;
      provider: string;
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
        description: `Hosted device-sync connect link ${runtimeInput.provider}`,
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: buildHostedExecutionDeviceSyncConnectLinkPath(runtimeInput.provider),
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncConnectLinkResponse(payload);
    },
    async fetchSnapshot(runtimeInput: {
      connectionId?: string | null;
      provider?: string | null;
    } = {}) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          ...(runtimeInput.connectionId ? { connectionId: runtimeInput.connectionId } : {}),
          ...(runtimeInput.provider ? { provider: runtimeInput.provider } : {}),
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
      const payload = await fetchHostedWebControlPlaneJson({
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
      const payload = await fetchHostedWebControlPlaneJson({
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
          path: HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        });

        return parseHostedWorkspaceCheckpointResponse(payload);
      };

      if (!input.workspaceCheckpointBridge) {
        return await checkpointWorkspace(request);
      }

      return await checkpointHostedRuntimeBridgeWebWorkspace({
        checkpointWorkspace,
        readCurrentLease: input.workspaceCheckpointBridge.readCurrentLease,
        request,
        userId: input.boundUserId,
      });
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

function createHostedWebSharePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async fetchPayload(
      request: Parameters<NonNullable<HostedRuntimePlatform["sharePort"]>["fetchPayload"]>[0],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        boundUserId: input.boundUserId,
        description: "Hosted share payload fetch",
        fetchImpl: input.fetchImpl,
        method: "GET",
        path: appendHostedRuntimeRequestIdQuery(
          buildHostedRuntimeSharePayloadPath(request.shareId),
          request.requestId,
          {
            eventId: request.eventId,
            ownerUserId: request.ownerUserId,
          },
        ),
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedRuntimeSharePayloadFetchResponse(payload);
    },
    async recordImport(
      request: Parameters<NonNullable<HostedRuntimePlatform["sharePort"]>["recordImport"]>[0],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted share import record",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_SHARE_IMPORT_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedRuntimeShareImportResponse(payload);
    },
  };
}

function createHostedWebVaultSyncPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async fetchPayload(
      request: Parameters<NonNullable<HostedRuntimePlatform["vaultSyncPort"]>["fetchPayload"]>[0],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        boundUserId: input.boundUserId,
        description: "Hosted vault-sync payload fetch",
        fetchImpl: input.fetchImpl,
        method: "GET",
        path: appendHostedRuntimeRequestIdQuery(
          buildHostedRuntimeVaultSyncPayloadPath(request.sessionId),
          request.requestId,
        ),
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedRuntimeVaultSyncPayloadFetchResponse(payload);
    },
    async recordImport(
      request: Parameters<NonNullable<HostedRuntimePlatform["vaultSyncPort"]>["recordImport"]>[0],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted vault-sync import record",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_VAULT_SYNC_IMPORT_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedRuntimeVaultSyncImportResponse(payload);
    },
  };
}

function createHostedWebBillingPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async resolveVercelAiGatewayStripeCustomerId() {
      const payload = await fetchHostedWebControlPlaneJson({
        boundUserId: input.boundUserId,
        description: "Hosted delegated billing Stripe customer lookup",
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: HOSTED_WEB_STRIPE_CUSTOMER_LOOKUP_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeBillingStripeCustomerResponse(payload);
      } catch (error) {
        throw new Error(
          "Hosted delegated billing Stripe customer lookup returned invalid JSON.",
          { cause: error },
        );
      }
    },
  };
}

async function fetchHostedWebControlPlaneJson(input: {
  body?: unknown;
  boundUserId: string;
  description: string;
  fetchImpl: typeof fetch;
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
          hasJsonBody: body !== undefined,
        }),
        method,
      },
      logPath: createHostedWebControlLogPath(route.pathname),
      timeoutMs: input.timeoutMs,
      url: createHostedWebControlProxyUrl(route.pathAndSearch),
    });

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
  if (/^\/api\/internal\/hosted-execution\/share\/[^/]+\/payload$/u.test(url.pathname)) {
    return "/api/internal/hosted-execution/share/:shareId/payload";
  }
  if (/^\/api\/internal\/hosted-execution\/vault-sync\/[^/]+\/payload$/u.test(url.pathname)) {
    return "/api/internal/hosted-execution/vault-sync/:sessionId/payload";
  }

  return url.pathname;
}

function createHostedWebControlProxyHeaders(input: {
  hasJsonBody: boolean;
}): Headers | undefined {
  const headers = new Headers();
  let hasHeaders = false;

  if (input.hasJsonBody) {
    headers.set("content-type", "application/json");
    hasHeaders = true;
  }

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
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          }),
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

async function fetchHostedResponse(input: {
  description: string;
  fetchImpl: typeof fetch;
  init?: RequestInit;
  logPath?: string;
  timeoutMs: number;
  url: URL;
}): Promise<Response> {
  try {
    return await input.fetchImpl(input.url, {
      ...input.init,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
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
    throw new Error(
      `${input.description} request failed.${formatHostedResponseFetchCause(error)}`,
      { cause: error },
    );
  }
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

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
