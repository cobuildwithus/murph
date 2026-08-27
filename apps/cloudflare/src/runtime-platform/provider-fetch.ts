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
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_PROVIDER_EGRESS_TOKEN_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../runner-outbound/headers.ts";
import { writeRunnerRuntimeWriteFenceHeaders } from "../runner-outbound/write-fence.ts";
import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import {
  HostedRuntimeControlPlaneRejectedError,
  HostedRuntimeInternalAuthorityRejectedError,
  isHostedRuntimeInternalAuthorityRejectedError,
  isInternalAuthorityRejectedStatus,
} from "./authority-headers.ts";
import { buildHostedRuntimeSafeErrorMetadata } from "./diagnostics.ts";
import { normalizeCloudflareWorkerFetch } from "../worker-fetch.ts";

export function createCloudflareHostedInternalFetch(
  boundUserId: string,
  fetchImpl: typeof fetch,
  options: {
    injectBoundUserIdHeader?: boolean;
    readCurrentLease?: HostedWorkspaceCheckpointBridgeAuthority["readCurrentLease"];
  } = {},
): typeof fetch {
  const normalizedFetchImpl = normalizeCloudflareWorkerFetch(fetchImpl);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
      return normalizedFetchImpl(request);
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

    return await fetchCloudflareHostedInternalRequest({
      boundUserId,
      fetchImpl: normalizedFetchImpl,
      headers,
      injectBoundUserIdHeader: options.injectBoundUserIdHeader ?? false,
      request,
      url,
    });
  }) as typeof fetch;
}

export function createCloudflareHostedTrustedInternalFetch(
  boundUserId: string,
  fetchImpl: typeof fetch,
  options: {
    injectBoundUserIdHeader?: boolean;
  } = {},
): typeof fetch {
  const normalizedFetchImpl = normalizeCloudflareWorkerFetch(fetchImpl);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
      return normalizedFetchImpl(request);
    }

    return await fetchCloudflareHostedInternalRequest({
      boundUserId,
      fetchImpl: normalizedFetchImpl,
      headers: new Headers(request.headers),
      injectBoundUserIdHeader: options.injectBoundUserIdHeader ?? false,
      request,
      url,
    });
  }) as typeof fetch;
}

async function fetchCloudflareHostedInternalRequest(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  headers: Headers;
  injectBoundUserIdHeader: boolean;
  request: Request;
  url: URL;
}): Promise<Response> {
  if (input.injectBoundUserIdHeader) {
    input.headers.set(HOSTED_RUNNER_BOUND_USER_ID_HEADER, input.boundUserId);
  }
  const internalRequest = createHostedInternalRequest(input.request, input.headers);
  const operation = readHostedRunnerInternalOperation({
    hostname: input.url.hostname,
    method: internalRequest.method,
    pathname: input.url.pathname,
  });
  const safePath = readHostedRuntimeInternalRequestLogPath(input.url);
  const details = {
    effectsFingerprintPresent: input.url.searchParams.has("fingerprint"),
    host: input.url.hostname,
    hostKind: readHostedRunnerInternalHostKind(input.url.hostname),
    method: readHostedRunnerDiagnosticMethod(internalRequest.method),
    operation,
    path: safePath,
    userIdPresent: input.boundUserId.length > 0,
  };

  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details,
    message: "Hosted runtime internal request started.",
    phase: "outbox",
    userId: input.boundUserId,
  });

  try {
    const response = await input.fetchImpl(internalRequest);
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        ...details,
        ok: response.ok ? "true" : "false",
        status: String(response.status),
      },
      message: "Hosted runtime internal request completed.",
      phase: "outbox",
      userId: input.boundUserId,
    });
    if (isInternalAuthorityRejectedStatus(response.status)) {
      const error = new HostedRuntimeInternalAuthorityRejectedError({
        description: readHostedRuntimeInternalRequestDescription({
          hostname: input.url.hostname,
          method: internalRequest.method,
          operation,
          pathname: input.url.pathname,
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
        userId: input.boundUserId,
      });
      throw error;
    }
    if (response.status === 403) {
      throw await buildHostedRuntimeControlPlaneRejectedError({
        description: readHostedRuntimeInternalRequestDescription({
          hostname: input.url.hostname,
          method: internalRequest.method,
          operation,
          pathname: input.url.pathname,
        }),
        response,
      });
    }
    return response;
  } catch (error) {
    if (!isHostedRuntimeInternalAuthorityRejectedError(error)) {
      emitHostedExecutionStructuredLog({
        component: "assistant-delivery",
        details,
        error,
        level: "warn",
        message: "Hosted runtime internal request failed.",
        phase: "outbox",
        userId: input.boundUserId,
      });
    }
    throw error;
  }
}

async function buildHostedRuntimeControlPlaneRejectedError(input: {
  description: string;
  response: Response;
}): Promise<HostedRuntimeControlPlaneRejectedError> {
  const body = await input.response.text().catch(() => null);
  const parsed = parseHostedRuntimeControlPlaneErrorBody(body);
  return new HostedRuntimeControlPlaneRejectedError({
    code: parsed?.code ?? null,
    description: input.description,
    message: parsed?.message ?? null,
    status: input.response.status,
  });
}

function parseHostedRuntimeControlPlaneErrorBody(
  body: string | null,
): { code: string | null; message: string | null } | null {
  if (!body || body.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const error = record.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }

  const errorRecord = error as Record<string, unknown>;
  return {
    code: normalizeHostedRuntimeControlPlaneErrorText(errorRecord.code),
    message: normalizeHostedRuntimeControlPlaneErrorText(errorRecord.message),
  };
}

function normalizeHostedRuntimeControlPlaneErrorText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function createCloudflareHostedProviderFetch(
  boundUserId: string,
  fetchImpl: typeof fetch,
  options: {
    injectBoundUserIdHeader?: boolean;
    providerFetchBaseUrlSource?: Readonly<Record<string, unknown>>;
    providerFetchBaseUrls?: readonly string[];
    readCurrentLease?: HostedWorkspaceCheckpointBridgeAuthority["readCurrentLease"];
  },
): typeof fetch {
  const normalizedFetchImpl = normalizeCloudflareWorkerFetch(fetchImpl);
  const internalFetch = createCloudflareHostedInternalFetch(
    boundUserId,
    normalizedFetchImpl,
    options,
  );
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
      return await internalFetch(request);
    }
    assertCloudflareHostedProviderFetchUrl(
      url,
      options.providerFetchBaseUrls ?? [],
      options.providerFetchBaseUrlSource,
    );

    const headers = new Headers(request.headers);
    headers.delete(HOSTED_RUNTIME_ATTEMPT_ID_HEADER);
    headers.delete(HOSTED_RUNTIME_LEASE_GENERATION_HEADER);
    headers.delete(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);
    headers.delete(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER);
    headers.delete(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER);
    headers.set(HOSTED_RUNNER_BOUND_USER_ID_HEADER, boundUserId);
    const lease = await options.readCurrentLease?.() ?? null;
    if (lease?.providerEgressToken) {
      headers.set(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER, lease.providerEgressToken);
    }

    const providerRequest = new Request(request, { headers });
    try {
      return await normalizedFetchImpl(providerRequest);
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
] as const;

const CLOUDFLARE_HOSTED_PROVIDER_FETCH_HOSTNAMES = new Set([
  "api.elevenlabs.io",
  "api.linqapp.com",
  "api.mapbox.com",
  "api.openai.com",
  "api.telegram.org",
  "api.x.ai",
  "generativelanguage.googleapis.com",
]);

export function readCloudflareHostedProviderFetchBaseUrls(
  source: Readonly<Record<string, unknown>>,
): string[] {
  const values: string[] = [];

  for (const key of CLOUDFLARE_HOSTED_PROVIDER_FETCH_BASE_URL_ENV_KEYS) {
    const value = typeof source[key] === "string" ? source[key].trim() : "";
    if (!value || !parseAllowedCloudflareHostedProviderFetchBaseUrl(value, source)) {
      continue;
    }
    values.push(value);
  }

  return values;
}

function assertCloudflareHostedProviderFetchUrl(
  url: URL,
  providerFetchBaseUrls: readonly string[],
  providerFetchBaseUrlSource?: Readonly<Record<string, unknown>>,
): void {
  if (CLOUDFLARE_HOSTED_PROVIDER_FETCH_HOSTNAMES.has(normalizeCloudflareHostedFetchHostname(url.hostname))) {
    return;
  }
  if (isConfiguredCloudflareHostedProviderFetchUrl(
    url,
    providerFetchBaseUrls,
    providerFetchBaseUrlSource,
  )) {
    return;
  }

  throw new Error(
    `Hosted provider request for ${url.hostname} is not routed through the hosted provider egress boundary.`,
  );
}

function isConfiguredCloudflareHostedProviderFetchUrl(
  url: URL,
  providerFetchBaseUrls: readonly string[],
  providerFetchBaseUrlSource?: Readonly<Record<string, unknown>>,
): boolean {
  for (const value of providerFetchBaseUrls) {
    const baseUrl = parseAllowedCloudflareHostedProviderFetchBaseUrl(
      value,
      providerFetchBaseUrlSource,
    );
    if (!baseUrl || url.origin !== baseUrl.origin) {
      continue;
    }
    if (isCloudflareHostedProviderFetchPathWithinBase(url, baseUrl)) {
      return true;
    }
  }

  return false;
}

function parseAllowedCloudflareHostedProviderFetchBaseUrl(
  value: string,
  source?: Readonly<Record<string, unknown>>,
): URL | null {
  try {
    const url = new URL(value);
    return isAllowedCloudflareHostedProviderFetchBaseUrl(url, source) ? url : null;
  } catch {
    return null;
  }
}

function isAllowedCloudflareHostedProviderFetchBaseUrl(
  url: URL,
  source?: Readonly<Record<string, unknown>>,
): boolean {
  return url.protocol === "https:"
    || (
      url.protocol === "http:"
      && (
        isLocalOrTestCloudflareHostedProviderFetchHost(url.hostname)
        || isConfiguredHostedRunnerHostAlias(url.hostname, source)
      )
    );
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

function isConfiguredHostedRunnerHostAlias(
  hostname: string,
  source?: Readonly<Record<string, unknown>>,
): boolean {
  const rawAlias = source?.HOSTED_EXECUTION_RUNNER_HOST_ALIAS;
  const alias = typeof rawAlias === "string"
    ? normalizeCloudflareHostedFetchHostname(rawAlias.trim())
    : "";
  return Boolean(alias)
    && normalizeCloudflareHostedFetchHostname(hostname) === alias
    && isHostedLocalProviderFetchHostAliasSource(source)
    && isAllowedHostedRunnerHostAlias(alias);
}

function isHostedLocalProviderFetchHostAliasSource(
  source?: Readonly<Record<string, unknown>>,
): boolean {
  const rawProfile = source?.MURPH_HOSTED_LOCAL_PROFILE;
  const profile = typeof rawProfile === "string"
    ? rawProfile.trim().toLowerCase()
    : "";
  return source?.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED === "1"
    || profile === "dev"
    || profile === "worker-only"
    || profile === "e2e:stub"
    || profile === "e2e:live";
}

function isAllowedHostedRunnerHostAlias(hostname: string): boolean {
  return isLocalOrTestCloudflareHostedProviderFetchHost(hostname)
    || isPrivateIpv4Address(hostname);
}

function isPrivateIpv4Address(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => {
    if (!/^(0|[1-9]\d{0,2})$/u.test(part)) {
      return null;
    }
    const value = Number(part);
    return value <= 255 ? value : null;
  });
  if (octets.some((part) => part === null)) {
    return false;
  }
  const first = octets[0];
  const second = octets[1];
  if (first === null || second === null) {
    return false;
  }
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
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
  assistant_personalization_tool: "Hosted assistant personalization tool",
  assistant_runtime_issue_export: "Hosted assistant runtime issue export",
  browser_vault_replica_publish: "Hosted browser-vault replica publish",
  browser_vault_replica_write: "Hosted browser-vault replica write",
  clinical_records_connect_link: "Hosted clinical records connect link",
  clinical_records_fetch_page: "Hosted clinical records fetch page",
  clinical_records_read_run: "Hosted clinical records read run",
  clinical_records_record_outcome: "Hosted clinical records record outcome",
  device_sync_connect_link: "Hosted device-sync connect link",
  device_sync_dirty_ack: "Hosted device-sync dirty ack",
  device_sync_pending_dirty_state: "Hosted device-sync pending dirty state",
  device_sync_runtime_apply: "Hosted device-sync runtime apply",
  device_sync_runtime_snapshot: "Hosted device-sync runtime snapshot",
  family_plan_tool: "Hosted family plan tool",
  mailbox_fetch: "Hosted mailbox fetch",
  mailbox_payload_decode: "Hosted mailbox payload decode",
  mailbox_payload_fetch: "Hosted mailbox payload fetch",
  member_action_outcome: "Hosted member action outcome",
  meal_photo_delete: "Hosted meal photo delete",
  meal_photo_read: "Hosted meal photo read",
  product_feedback_recording: "Hosted product feedback recording",
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

  if (
    url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort
    && /^\/meal-photos\/[a-f0-9]{40}$/u.test(url.pathname)
  ) {
    return "/meal-photos/REDACTED";
  }

  if (
    url.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort
    && /^\/environment-voice\/[a-f0-9]{40}$/u.test(url.pathname)
  ) {
    return "/environment-voice/REDACTED";
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
