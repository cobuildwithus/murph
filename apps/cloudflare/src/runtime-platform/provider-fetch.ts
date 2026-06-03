import {
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import { HOSTED_RUNTIME_LATENCY_TRACE_PATH } from "@murphai/hosted-execution/routes";

import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
} from "../internal-hosts.ts";
import { HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH } from "../runner-email-route.ts";
import {
  HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
} from "../runner-effects-contract.ts";
import {
  readHostedRunnerDiagnosticMethod,
  readHostedRunnerInternalHostKind,
  readHostedRunnerInternalOperation,
} from "../runner-outbound/diagnostics.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../runner-outbound/headers.ts";
import { writeRunnerRuntimeWriteFenceHeaders } from "../runner-outbound/write-fence.ts";
import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import {
  HostedRuntimeInternalAuthorityRejectedError,
  isHostedRuntimeInternalAuthorityRejectedError,
  isInternalAuthorityRejectedStatus,
} from "./authority-headers.ts";
import { buildHostedRuntimeSafeErrorMetadata } from "./diagnostics.ts";

export function createCloudflareHostedInternalFetch(
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
    const hasSuppliedLatencyTraceWriteFence =
      url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane
      && request.method === "POST"
      && url.pathname === HOSTED_RUNTIME_LATENCY_TRACE_PATH
      && headers.has(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)
      && headers.has(HOSTED_RUNTIME_LEASE_GENERATION_HEADER);
    if (!hasSuppliedWorkspaceSnapshotWriteFence && !hasSuppliedLatencyTraceWriteFence) {
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
    providerFetchBaseUrls?: readonly string[];
    readCurrentLease: HostedWorkspaceCheckpointBridgeAuthority["readCurrentLease"];
  },
): typeof fetch {
  const internalFetch = createCloudflareHostedInternalFetch(boundUserId, fetchImpl, options);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
      return await internalFetch(request);
    }
    assertCloudflareHostedProviderFetchUrl(url, options.providerFetchBaseUrls ?? []);

    const headers = new Headers(request.headers);
    const lease = await options.readCurrentLease();
    if (!lease) {
      throw new Error(
        `Hosted provider request for ${url.hostname} is missing a runtime write-fence lease.`,
      );
    }
    writeRunnerRuntimeWriteFenceHeaders(headers, lease);
    headers.set(HOSTED_RUNNER_BOUND_USER_ID_HEADER, boundUserId);

    const providerRequest = new Request(request, { headers });
    try {
      return await fetchImpl(providerRequest);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "assistant-delivery",
        details: {
          host: normalizeCloudflareHostedFetchHostname(url.hostname),
          method: readHostedRunnerDiagnosticMethod(providerRequest.method),
          operation: "provider_fetch",
          ...buildHostedRuntimeSafeErrorMetadata(error),
        },
        level: "warn",
        message: "Hosted provider fetch failed before response.",
        phase: "outbox",
        userId: null,
      });
      throw error;
    }
  }) as typeof fetch;
}

const CLOUDFLARE_HOSTED_PROVIDER_FETCH_BASE_URL_ENV_KEYS = [
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
  "LINQ_API_BASE_URL",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_FILE_BASE_URL",
  "WHATSAPP_API_BASE_URL",
] as const;

const CLOUDFLARE_HOSTED_PROVIDER_FETCH_HOSTNAMES = new Set([
  "api.linqapp.com",
  "api.mapbox.com",
  "api.openai.com",
  "api.telegram.org",
  "graph.facebook.com",
]);

export function readCloudflareHostedProviderFetchBaseUrls(
  source: Readonly<Record<string, unknown>>,
): string[] {
  const values: string[] = [];

  for (const key of CLOUDFLARE_HOSTED_PROVIDER_FETCH_BASE_URL_ENV_KEYS) {
    const value = typeof source[key] === "string" ? source[key].trim() : "";
    if (!value || !parseAllowedCloudflareHostedProviderFetchBaseUrl(value)) {
      continue;
    }
    values.push(value);
  }

  return values;
}

function assertCloudflareHostedProviderFetchUrl(
  url: URL,
  providerFetchBaseUrls: readonly string[],
): void {
  if (CLOUDFLARE_HOSTED_PROVIDER_FETCH_HOSTNAMES.has(normalizeCloudflareHostedFetchHostname(url.hostname))) {
    return;
  }
  if (isConfiguredCloudflareHostedProviderFetchUrl(url, providerFetchBaseUrls)) {
    return;
  }

  throw new Error(
    `Hosted provider request for ${url.hostname} is not routed through the hosted provider egress boundary.`,
  );
}

function isConfiguredCloudflareHostedProviderFetchUrl(
  url: URL,
  providerFetchBaseUrls: readonly string[],
): boolean {
  for (const value of providerFetchBaseUrls) {
    const baseUrl = parseAllowedCloudflareHostedProviderFetchBaseUrl(value);
    if (!baseUrl || url.origin !== baseUrl.origin) {
      continue;
    }
    if (isCloudflareHostedProviderFetchPathWithinBase(url, baseUrl)) {
      return true;
    }
  }

  return false;
}

function parseAllowedCloudflareHostedProviderFetchBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return isAllowedCloudflareHostedProviderFetchBaseUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function isAllowedCloudflareHostedProviderFetchBaseUrl(url: URL): boolean {
  return url.protocol === "https:"
    || (url.protocol === "http:" && isLocalOrTestCloudflareHostedProviderFetchHost(url.hostname));
}

function isLocalOrTestCloudflareHostedProviderFetchHost(hostname: string): boolean {
  const normalized = normalizeCloudflareHostedFetchHostname(hostname);
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]"
    || normalized === "host.docker.internal"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".test");
}

function isCloudflareHostedProviderFetchPathWithinBase(url: URL, baseUrl: URL): boolean {
  const basePath = normalizeCloudflareHostedProviderFetchBasePath(baseUrl);
  return !basePath
    || url.pathname === basePath
    || url.pathname.startsWith(`${basePath}/`);
}

function normalizeCloudflareHostedProviderFetchBasePath(url: URL): string {
  return url.pathname.replace(/\/+$/u, "");
}

function normalizeCloudflareHostedFetchHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, "");
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
  runtime_latency_trace: "Hosted runtime latency trace",
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
