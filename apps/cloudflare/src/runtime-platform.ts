import {
  parseHostedRuntimeUsageRecordResponse,
  readHostedRunnerCommitTimeoutMs,
  type HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedAssistantDeliveryRecord,
} from "@murphai/hosted-execution/side-effects";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
  buildHostedExecutionRunnerEmailMessagePath,
  buildHostedExecutionRunnerSideEffectPath,
} from "@murphai/hosted-execution/routes";
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
import { fetchHostedExecutionWebControlPlaneResponse } from "./web-control-plane.ts";
import type { HostedWebCallbackSigningEnvironment } from "./web-callback-auth.ts";

const HOSTED_WEB_USAGE_RECORD_PATH = "/api/internal/hosted-execution/usage/record";

export function buildHostedExecutionRuntimePlatform(input: {
  boundUserId: string;
  commitTimeoutMs?: number | null;
  fetchImpl?: typeof fetch;
  internalWorkerProxyToken?: string | null;
  localInternalProxyBaseUrl?: string | null;
  localLoopbackProxyToken?: string | null;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl?: string | null;
}): HostedRuntimePlatform {
  const fetchImpl = createCloudflareHostedRuntimeFetch(
    input.boundUserId,
    input.internalWorkerProxyToken ?? null,
    input.localInternalProxyBaseUrl ?? process.env.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL ?? null,
    input.localLoopbackProxyToken ?? process.env.HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN ?? null,
    input.fetchImpl ?? fetch,
  );
  const timeoutMs = readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs ?? null);
  const webControlBaseUrl = input.webControlBaseUrl ?? null;
  const webCallbackSigning = input.webCallbackSigning ?? null;
  const hostedWebDeviceSyncPort = webControlBaseUrl && webCallbackSigning
    ? createHostedWebDeviceSyncPort({
        baseUrl: webControlBaseUrl,
        boundUserId: input.boundUserId,
        callbackSigning: webCallbackSigning,
        fetchImpl,
        timeoutMs,
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
    ...(hostedWebDeviceSyncPort ? { deviceSyncPort: hostedWebDeviceSyncPort } : {}),
    effectsPort: {
      async deletePreparedAssistantDelivery(sideEffect) {
        const url = createHostedAssistantDeliveryUrl(sideEffect);
        const response = await fetchHostedResponse({
          description: `Hosted side-effect delete ${sideEffect.effectId}`,
          fetchImpl,
          init: {
            method: "DELETE",
          },
          timeoutMs,
          url,
        });

        assertHostedOk(response, `Hosted side-effect delete ${sideEffect.effectId}`);
      },
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
      async readAssistantDeliveryRecord(sideEffect) {
        const payload = await fetchHostedJson({
          allowNotFound: false,
          description: `Hosted side-effect read ${sideEffect.effectId}`,
          fetchImpl,
          method: "GET",
          timeoutMs,
          url: createHostedAssistantDeliveryUrl(sideEffect),
        });

        const record = readHostedRecordField(payload, "record");
        return record === null ? null : parseHostedAssistantDeliveryRecord(record);
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
      async writeAssistantDeliveryRecord(record) {
        const payload = await fetchHostedJson({
          body: record,
          description: `Hosted side-effect write ${record.effectId}`,
          fetchImpl,
          method: "PUT",
          timeoutMs,
          url: createHostedAssistantDeliveryUrl(record),
        });

        return parseHostedAssistantDeliveryRecord(
          requireRecordField(payload, "record"),
        );
      },
    },
    ...(webControlBaseUrl && webCallbackSigning
      ? {
          usageExportPort: {
            async recordUsage(usage) {
              const body = JSON.stringify({
                usage,
              });
              const response = await fetchHostedExecutionWebControlPlaneResponse({
                baseUrl: webControlBaseUrl,
                body,
                boundUserId: input.boundUserId,
                callbackSigning: webCallbackSigning,
                fetchImpl,
                method: "POST",
                path: HOSTED_WEB_USAGE_RECORD_PATH,
                timeoutMs,
              });
              assertHostedOk(response, "Hosted usage export");
              const text = await response.text();

              try {
                return parseHostedRuntimeUsageRecordResponse(JSON.parse(text) as unknown);
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

function createCloudflareHostedRuntimeFetch(
  boundUserId: string,
  internalWorkerProxyToken: string | null,
  localInternalProxyBaseUrl: string | null,
  localLoopbackProxyToken: string | null,
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
        requireLocalLoopbackProxyToken(localLoopbackProxyToken),
      )
      : url;
    if (localInternalProxyBaseUrl) {
      headers.set(HOSTED_EXECUTION_USER_ID_HEADER, boundUserId);
    }
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
  token: string,
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
  const proxyBaseUrl = isTokenizedLocalInternalProxyBaseUrl(normalizedBasePath)
    ? normalizedBasePath
    : new URL(
      `__murph/local-internal-proxy/${encodeURIComponent(token)}/`,
      normalizedBasePath,
    );
  const proxyUrl = new URL(
    `${encodeURIComponent(targetUrl.hostname)}${targetUrl.pathname}`,
    proxyBaseUrl,
  );
  proxyUrl.search = targetUrl.search;
  return proxyUrl;
}

function requireLocalLoopbackProxyToken(value: string | null): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(
    "HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN must be configured when HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL is set.",
  );
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

function createHostedAssistantDeliveryUrl(input: {
  effectId: string;
  fingerprint: string;
}): URL {
  const url = new URL(
    buildHostedExecutionRunnerSideEffectPath(input.effectId),
    `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
  );
  url.searchParams.set("fingerprint", input.fingerprint);
  return url;
}

function ensureTrailingSlash(value: URL): URL {
  if (value.pathname.endsWith("/")) {
    return value;
  }

  const next = new URL(value.toString());
  next.pathname = `${next.pathname}/`;
  return next;
}

function isTokenizedLocalInternalProxyBaseUrl(value: URL): boolean {
  return /^\/__murph\/local-internal-proxy\/[^/]+\/$/u.test(value.pathname);
}

function createHostedWebDeviceSyncPort(input: {
  baseUrl: string;
  boundUserId: string;
  callbackSigning: HostedWebCallbackSigningEnvironment;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}) {
  return {
    async applyUpdates(runtimeInput: {
      occurredAt?: string | null;
      updates: unknown;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        baseUrl: input.baseUrl,
        body: {
          ...(runtimeInput.occurredAt ? { occurredAt: runtimeInput.occurredAt } : {}),
          updates: runtimeInput.updates,
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        callbackSigning: input.callbackSigning,
        description: "Hosted device-sync runtime apply",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
        timeoutMs: input.timeoutMs,
      });

      return parseHostedExecutionDeviceSyncRuntimeApplyResponse(payload);
    },
    async createConnectLink({ provider }: { provider: string }) {
      const payload = await fetchHostedWebControlPlaneJson({
        baseUrl: input.baseUrl,
        boundUserId: input.boundUserId,
        callbackSigning: input.callbackSigning,
        description: `Hosted device-sync connect link ${provider}`,
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: buildHostedExecutionDeviceSyncConnectLinkPath(provider),
        timeoutMs: input.timeoutMs,
      });

      return parseHostedExecutionDeviceSyncConnectLinkResponse(payload);
    },
    async fetchSnapshot(runtimeInput: {
      connectionId?: string | null;
      provider?: string | null;
    } = {}) {
      const payload = await fetchHostedWebControlPlaneJson({
        baseUrl: input.baseUrl,
        body: {
          ...(runtimeInput.connectionId ? { connectionId: runtimeInput.connectionId } : {}),
          ...(runtimeInput.provider ? { provider: runtimeInput.provider } : {}),
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        callbackSigning: input.callbackSigning,
        description: "Hosted device-sync runtime snapshot",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
        timeoutMs: input.timeoutMs,
      });

      return parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(payload);
    },
  };
}

async function fetchHostedWebControlPlaneJson(input: {
  baseUrl: string;
  body?: Record<string, unknown>;
  boundUserId: string;
  callbackSigning: HostedWebCallbackSigningEnvironment;
  description: string;
  fetchImpl: typeof fetch;
  method?: "GET" | "POST";
  path: string;
  timeoutMs: number;
}): Promise<unknown> {
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body,
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: input.method ?? (input.body === undefined ? "GET" : "POST"),
    path: input.path,
    timeoutMs: input.timeoutMs,
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
    throw error;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
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
    throw error;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
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
  throw error;
}

function readHostedRecordField(
  value: unknown,
  field: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime response must be an object.");
  }

  const entry = (value as Record<string, unknown>)[field];
  if (entry === null || entry === undefined) {
    return null;
  }

  if (typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`Hosted runtime response.${field} must be an object or null.`);
  }

  return entry as Record<string, unknown>;
}

function requireRecordField(value: unknown, field: string): Record<string, unknown> {
  const record = readHostedRecordField(value, field);

  if (!record) {
    throw new TypeError(`Hosted runtime response.${field} must be present.`);
  }

  return record;
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
