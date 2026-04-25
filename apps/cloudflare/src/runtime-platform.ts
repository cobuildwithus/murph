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
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
  HOSTED_EXECUTION_RUNNER_TURN_INPUT_REFRESH_PATH,
} from "@murphai/hosted-execution/routes";
import {
  parseHostedRuntimeDrainEvent,
} from "@murphai/hosted-execution/parsers";
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
  HOSTED_WEB_ISSUE_RECORD_PATH,
  HOSTED_WEB_STRIPE_CUSTOMER_LOOKUP_PATH,
  HOSTED_WEB_USAGE_RECORD_PATH,
} from "./runner-outbound/shared-web-control-policy.ts";
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

export function buildHostedExecutionRuntimePlatform(input: {
  boundUserId: string;
  commitTimeoutMs?: number | null;
  fetchImpl?: typeof fetch;
  hostedRunId?: string | null;
  hostedRunToken?: string | null;
  internalWorkerProxyToken?: string | null;
  localInternalProxyBaseUrl?: string | null;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl?: string | null;
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
  const hostedTurnInputRun = input.hostedRunId && input.hostedRunToken
    ? {
        runId: input.hostedRunId,
        runToken: input.hostedRunToken,
      }
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
        const response = await fetchHostedResponse({
          description: `Hosted artifact upload ${sha256}`,
          fetchImpl,
          init: {
            body: copyBytesToArrayBuffer(bytes),
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
        }
      : {}),
    ...(hostedWebDeviceSyncPort ? { deviceSyncPort: hostedWebDeviceSyncPort } : {}),
    effectsPort: {
      async readRawEmailMessage(rawMessageKey) {
        const response = await fetchHostedResponse({
          description: `Hosted raw email read ${rawMessageKey}`,
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

        assertHostedOk(response, `Hosted raw email read ${rawMessageKey}`);
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
    ...(hostedTurnInputRun
      ? {
          turnInputPort: {
            async refresh(refreshInput) {
              const payload = await fetchHostedJson({
                body: {
                  ...(refreshInput.afterSeq === undefined
                    ? {}
                    : { afterSeq: refreshInput.afterSeq }),
                  phase: refreshInput.phase,
                  requestId: refreshInput.requestId,
                  runId: hostedTurnInputRun.runId,
                  runToken: hostedTurnInputRun.runToken,
                },
                description: "Hosted turn-input refresh",
                fetchImpl,
                method: "POST",
                timeoutMs,
                url: new URL(
                  HOSTED_EXECUTION_RUNNER_TURN_INPUT_REFRESH_PATH,
                  `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
                ),
              });

              return parseHostedRuntimeTurnInputRefreshResponse(payload);
            },
          },
        }
      : {}),
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
  if (input.webControlBaseUrl && input.webCallbackSigning) {
    return {
      callbackSigning: input.webCallbackSigning,
      mode: "direct",
      webControlBaseUrl: input.webControlBaseUrl,
    };
  }

  if (input.internalWorkerProxyToken) {
    return {
      mode: "proxy",
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
        `Hosted runtime internal request for ${url.hostname}${url.pathname} is missing the per-run proxy token.`,
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
      phase: "side-effects.draining",
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
        phase: "side-effects.draining",
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
        phase: "side-effects.draining",
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
  let normalizedBaseUrl: URL;
  try {
    normalizedBaseUrl = new URL(baseUrl);
  } catch {
    throw new TypeError("HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL must be an absolute URL.");
  }

  if (normalizedBaseUrl.protocol !== "http:" && normalizedBaseUrl.protocol !== "https:") {
    throw new TypeError("HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL must use http or https.");
  }

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
  body?: Record<string, unknown>;
  boundUserId: string;
  description: string;
  fetchImpl: typeof fetch;
  method?: "GET" | "POST";
  path: string;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): Promise<unknown> {
  const method = input.method ?? (input.body === undefined ? "GET" : "POST");
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const response = input.transport.mode === "direct"
    ? await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.transport.webControlBaseUrl,
      body,
      boundUserId: input.boundUserId,
      callbackSigning: input.transport.callbackSigning,
      fetchImpl: input.fetchImpl,
      method,
      path: input.path,
      timeoutMs: input.timeoutMs,
    })
    : await fetchHostedResponse({
      description: input.description,
      fetchImpl: input.fetchImpl,
      init: {
        ...(body === undefined ? {} : { body }),
        ...(body === undefined
          ? {}
          : {
            headers: {
              "content-type": "application/json",
            },
          }),
        method,
      },
      timeoutMs: input.timeoutMs,
      url: createHostedWebControlProxyUrl(input.path),
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
        path: input.path,
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
      phase: "side-effects.draining",
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
      phase: "side-effects.draining",
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
        path: input.url.pathname,
        responseOrigin: input.url.origin,
      },
      error,
      level: "warn",
      message: "Hosted runtime upstream request failed.",
      phase: "side-effects.draining",
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
    phase: "side-effects.draining",
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

function parseHostedRuntimeTurnInputRefreshResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted turn-input refresh response must be an object.");
  }

  const events = (value as Record<string, unknown>).events;
  if (!Array.isArray(events)) {
    throw new TypeError("Hosted turn-input refresh response.events must be an array.");
  }

  return {
    events: events.map((event, index) =>
      parseHostedRuntimeDrainEvent(
        event,
        `Hosted turn-input refresh response events[${index}]`,
      )
    ),
  };
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
