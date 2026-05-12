import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import {
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
} from "./internal-hosts.ts";
import {
  handleRunnerOutboundRequest,
} from "./runner-outbound.ts";
import {
  requireRunnerRuntimeWriteFenceWrite,
  RunnerRuntimeWriteFenceError,
} from "./runner-outbound/write-fence.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "./runner-outbound/shared.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "./runner-outbound/headers.ts";
export {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "./runner-injected-credential.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "./runner-injected-credential.ts";

type HostedRunnerOutboundHandler = (
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: HostedRunnerOutboundContext,
) => Promise<Response>;

const HOSTED_RUNTIME_AUTHORITY_HEADER_NAMES = [
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
] as const;

const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const DEFAULT_OPENAI_API_BASE_URL = "https://api.openai.com";
const DEFAULT_MAPBOX_API_BASE_URL = "https://api.mapbox.com";
const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const DEFAULT_WHATSAPP_API_BASE_URL = "https://graph.facebook.com";

export const HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS = {
  artifactStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore,
  browserVaultReplicaStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore,
  effectsPort: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort,
  linq: "api.linqapp.com",
  mapbox: "api.mapbox.com",
  openAi: "api.openai.com",
  runnerControl: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl,
  telegram: "api.telegram.org",
  webControlPlane: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
  whatsApp: "graph.facebook.com",
} as const;

const OPENAI_EGRESS_POLICY = [
  {
    method: "POST",
    pathname: "/v1/responses",
  },
  {
    method: "GET",
    pathname: "/v1/models",
  },
] as const;

const MAPBOX_EGRESS_POLICY = [
  {
    method: "GET",
    pathPrefix: "/directions/",
  },
  {
    method: "GET",
    pathPrefix: "/search/geocode/",
  },
  {
    method: "GET",
    pathPrefix: "/search/searchbox/",
  },
  {
    method: "GET",
    pathPrefix: "/v4/mapbox.mapbox-terrain-v2/tilequery/",
  },
] as const;

interface ProviderBaseConfig {
  baseUrl: URL;
  knownHosts: readonly string[];
}

interface HostedRunnerOutboundContext {
  containerId?: string;
}

export const HOSTED_RUNNER_OUTBOUND_BY_HOST: Record<string, HostedRunnerOutboundHandler> = {
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.artifactStore]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.browserVaultReplicaStore]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.effectsPort]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.linq]: handleHostedRunnerLinqOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.mapbox]: handleHostedRunnerMapboxOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.openAi]: handleHostedRunnerOpenAiOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.runnerControl]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.telegram]: handleHostedRunnerTelegramOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.webControlPlane]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.whatsApp]: handleHostedRunnerWhatsAppOutbound,
};

export async function handleHostedRunnerOpenInternetOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  const userId = readHostedRunnerBoundUserId(request);

  if (CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
    return await handleHostedRunnerInternalOutbound(request, env, ctx);
  }

  const handled =
    await maybeHandleOpenAiRequest({ env, request, url, userId })
    ?? await maybeHandleMapboxRequest({ env, request, url, userId })
    ?? await maybeHandleLinqRequest({ env, request, url, userId })
    ?? await maybeHandleTelegramRequest({ env, request, url, userId })
    ?? await maybeHandleWhatsAppRequest({ env, request, url, userId });

  if (handled) {
    return handled;
  }

  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      host: url.hostname,
      method: request.method,
      path: url.pathname,
      policy: "open_internet_passthrough",
      userId: userId ?? null,
    },
    level: "warn",
    message: "Hosted runner open-internet passthrough forwarded outbound request.",
    phase: "wake.running",
    userId: userId ?? undefined,
  });
  return await fetch(createHostedRunnerOpenInternetPassthroughRequest(request));
}

export const hostedRunnerIntercept = handleHostedRunnerOpenInternetOutbound;

export async function handleHostedRunnerInternalOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
    return disallowedProviderEgress();
  }

  const userId = readHostedRunnerBoundUserId(request);
  if (!userId) {
    return new Response("Missing hosted runner identity.", { status: 403 });
  }

  return await handleRunnerOutboundRequest(
    createHostedRunnerInternalRequest(request),
    env,
    userId,
  );
}

export async function handleHostedRunnerOpenAiOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleOpenAiRequest({
      env,
      request,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerMapboxOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleMapboxRequest({
      env,
      request,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerLinqOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleLinqRequest({
      env,
      request,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerTelegramOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleTelegramRequest({
      env,
      request,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerWhatsAppOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleWhatsAppRequest({
      env,
      request,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

async function requireHandledProviderEgress(response: Response | null): Promise<Response> {
  return response ?? disallowedProviderEgress();
}

async function maybeHandleOpenAiRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(undefined, DEFAULT_OPENAI_API_BASE_URL);
  const baseUrl = providerBase.baseUrl;
  const pathnameSuffix = readProviderPathSuffix(input.url, baseUrl);
  if (pathnameSuffix === null) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }
  if (!isAllowedOpenAiRequest(input.request.method, pathnameSuffix)) {
    return disallowedProviderEgress();
  }
  if (!hasBearerCredentialSentinel(input.request.headers)) {
    return disallowedProviderEgress();
  }

  const authorized = await requestOwnsRuntimeWriteFence(input);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = readRequiredInterceptSecret(input.env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return await fetch(await createHostedRunnerUpstreamRequest(input.request, input.url, headers));
}

async function maybeHandleMapboxRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(undefined, DEFAULT_MAPBOX_API_BASE_URL);
  const baseUrl = providerBase.baseUrl;
  const pathnameSuffix = readProviderPathSuffix(input.url, baseUrl);
  if (pathnameSuffix === null) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }
  if (!isAllowedMapboxRequest(input.request.method, pathnameSuffix)) {
    return disallowedProviderEgress();
  }
  if (!hasQueryCredentialSentinel(input.url, "access_token")) {
    return disallowedProviderEgress();
  }

  const authorized = await requestOwnsRuntimeWriteFence(input);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = readRequiredInterceptSecret(input.env.MAPBOX_ACCESS_TOKEN, "MAPBOX_ACCESS_TOKEN");
  const upstreamUrl = new URL(input.url);
  upstreamUrl.searchParams.set("access_token", token);
  return await fetch(
    await createHostedRunnerUpstreamRequest(
      input.request,
      upstreamUrl,
      stripHostedProviderUpstreamHeaders(input.request.headers),
    ),
  );
}

async function maybeHandleLinqRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(input.env.LINQ_API_BASE_URL, DEFAULT_LINQ_API_BASE_URL);
  const baseUrl = providerBase.baseUrl;
  const suffix = readProviderPathSuffix(input.url, baseUrl);
  if (suffix === null) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }

  if (!isAllowedLinqRequest(input.request.method, suffix)) {
    return disallowedProviderEgress();
  }
  if (!hasBearerCredentialSentinel(input.request.headers)) {
    return disallowedProviderEgress();
  }

  const authorized = await requestOwnsRuntimeWriteFence(input);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = readRequiredInterceptSecret(input.env.LINQ_API_TOKEN, "LINQ_API_TOKEN");
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return await fetch(await createHostedRunnerUpstreamRequest(input.request, input.url, headers));
}

async function maybeHandleTelegramRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(input.env.TELEGRAM_API_BASE_URL, DEFAULT_TELEGRAM_API_BASE_URL);
  const baseUrl = providerBase.baseUrl;
  const prefix = normalizedProviderBasePath(baseUrl);
  const pathnameSuffix = readProviderPathSuffix(input.url, baseUrl);
  if (pathnameSuffix === null) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }

  const operation = readTelegramSentinelOperation(pathnameSuffix);
  if (!operation || !isAllowedTelegramOperation(operation)) {
    return disallowedProviderEgress();
  }

  const authorized = await requestOwnsRuntimeWriteFence(input);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = readRequiredInterceptSecret(input.env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN");
  const upstreamUrl = new URL(input.url);
  upstreamUrl.pathname = `${prefix}/bot${token}/${operation}`;
  return await fetch(
    await createHostedRunnerUpstreamRequest(
      input.request,
      upstreamUrl,
      stripHostedProviderUpstreamHeaders(input.request.headers),
    ),
  );
}

async function maybeHandleWhatsAppRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(input.env.WHATSAPP_API_BASE_URL, DEFAULT_WHATSAPP_API_BASE_URL);
  const baseUrl = providerBase.baseUrl;
  const prefix = normalizedProviderBasePath(baseUrl);
  const pathnameSuffix = readProviderPathSuffix(input.url, baseUrl);
  if (pathnameSuffix === null) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }

  if (
    input.request.method !== "POST"
    || !/^\/v[0-9]+\.[0-9]+\/__cloudflare_injected__\/messages$/u.test(pathnameSuffix)
  ) {
    return disallowedProviderEgress();
  }

  const authorized = await requestOwnsRuntimeWriteFence(input);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = readRequiredInterceptSecret(input.env.WHATSAPP_ACCESS_TOKEN, "WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = readRequiredInterceptSecret(
    input.env.WHATSAPP_PHONE_NUMBER_ID,
    "WHATSAPP_PHONE_NUMBER_ID",
  );
  const upstreamUrl = new URL(input.url);
  upstreamUrl.pathname = `${prefix}${pathnameSuffix.replace(
    "/__cloudflare_injected__/messages",
    `/${encodeURIComponent(phoneNumberId)}/messages`,
  )}`;
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return await fetch(await createHostedRunnerUpstreamRequest(input.request, upstreamUrl, headers));
}

function readHostedRunnerBoundUserId(request: Request): string | null {
  const value = request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER);
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function isAllowedOpenAiRequest(method: string, pathname: string): boolean {
  return OPENAI_EGRESS_POLICY.some((policy) =>
    method === policy.method && pathname === policy.pathname
  );
}

function isAllowedMapboxRequest(method: string, pathname: string): boolean {
  return MAPBOX_EGRESS_POLICY.some((policy) =>
    method === policy.method && pathname.startsWith(policy.pathPrefix)
  );
}

function hasBearerCredentialSentinel(headers: Headers): boolean {
  const value = headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/iu.exec(value);
  return match?.[1]?.trim() === HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
}

function hasQueryCredentialSentinel(url: URL, name: string): boolean {
  return url.searchParams.get(name)?.trim() === HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
}

function isAllowedLinqRequest(method: string, pathnameSuffix: string): boolean {
  if (method === "GET" && pathnameSuffix === "/phone_numbers") {
    return true;
  }
  if (method === "POST" && pathnameSuffix === "/chats") {
    return true;
  }
  if (
    method === "POST"
    && /^\/chats\/[^/]+\/(?:messages|typing|read)$/u.test(pathnameSuffix)
  ) {
    return true;
  }
  if (method === "DELETE" && /^\/chats\/[^/]+\/typing$/u.test(pathnameSuffix)) {
    return true;
  }
  return method === "DELETE" && /^\/messages\/[^/]+$/u.test(pathnameSuffix);
}

function readTelegramSentinelOperation(pathname: string): string | null {
  const prefix = `/bot${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const operation = pathname.slice(prefix.length);
  return operation.length > 0 && !operation.includes("/") ? operation : null;
}

function isAllowedTelegramOperation(operation: string): boolean {
  return operation === "sendMessage"
    || operation === "sendChatAction"
    || operation === "deleteMessages"
    || operation === "deleteBusinessMessages"
    || operation === "getFile";
}

async function requestOwnsRuntimeWriteFence(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string | null;
}): Promise<boolean> {
  if (!input.userId) {
    return false;
  }

  try {
    await requireRunnerRuntimeWriteFenceWrite({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
    return true;
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return false;
    }
    throw error;
  }
}

function stripHostedRuntimeAuthorityHeaders(headers: Headers): Headers {
  const stripped = new Headers(headers);
  for (const name of HOSTED_RUNTIME_AUTHORITY_HEADER_NAMES) {
    stripped.delete(name);
  }
  stripped.delete(HOSTED_RUNNER_BOUND_USER_ID_HEADER);
  return stripped;
}

function stripHostedProviderUpstreamHeaders(headers: Headers): Headers {
  const stripped = stripHostedRuntimeAuthorityHeaders(headers);
  stripped.delete("authorization");
  stripped.delete("cookie");
  stripped.delete("proxy-authorization");
  stripped.delete("x-api-key");
  stripped.delete("openai-organization");
  stripped.delete("openai-project");
  return stripped;
}

function createHostedRunnerInternalRequest(source: Request): Request {
  const headers = new Headers(source.headers);
  headers.delete(HOSTED_RUNNER_BOUND_USER_ID_HEADER);
  return new Request(source, {
    headers,
  });
}

function createHostedRunnerOpenInternetPassthroughRequest(source: Request): Request {
  return new Request(source, {
    headers: stripHostedRuntimeAuthorityHeaders(source.headers),
  });
}

async function createHostedRunnerUpstreamRequest(
  source: Request,
  url: URL,
  headers: Headers,
): Promise<Request> {
  return new Request(url, {
    body: source.method === "GET" || source.method === "HEAD"
      ? null
      : await source.arrayBuffer(),
    headers,
    method: source.method,
    redirect: source.redirect,
    signal: source.signal,
  });
}

function readRequiredInterceptSecret(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized === HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL) {
    throw new Error(`Hosted runner intercept requires Worker secret ${label}.`);
  }
  return normalized;
}

function disallowedProviderEgress(): Response {
  return new Response("Forbidden", { status: 403 });
}

function readProviderBaseConfig(value: unknown, fallback: string): ProviderBaseConfig {
  const fallbackUrl = new URL(fallback);
  const fallbackHosts = [fallbackUrl.hostname];
  const rawValue = typeof value === "string" && value.trim() ? value.trim() : null;
  if (!rawValue) {
    return {
      baseUrl: fallbackUrl,
      knownHosts: fallbackHosts,
    };
  }

  try {
    const url = new URL(rawValue);
    if (isAllowedProviderBaseUrl(url)) {
      return {
        baseUrl: url,
        knownHosts: uniqueProviderHosts(url.hostname, fallbackUrl.hostname),
      };
    }
    return {
      baseUrl: fallbackUrl,
      knownHosts: uniqueProviderHosts(url.hostname, fallbackUrl.hostname),
    };
  } catch {
    return {
      baseUrl: fallbackUrl,
      knownHosts: fallbackHosts,
    };
  }
}

function readProviderPathSuffix(url: URL, base: URL): string | null {
  if (url.origin !== base.origin) {
    return null;
  }
  const prefix = normalizedProviderBasePath(base);
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }
  return url.pathname.slice(prefix.length);
}

function normalizedProviderBasePath(base: URL): string {
  return base.pathname.replace(/\/+$/u, "");
}

function isKnownProviderHost(url: URL, providerBase: ProviderBaseConfig): boolean {
  return providerBase.knownHosts.includes(normalizeProviderHostname(url.hostname));
}

function isAllowedProviderBaseUrl(url: URL): boolean {
  return url.protocol === "https:"
    || (url.protocol === "http:" && isLocalOrTestProviderHost(url.hostname));
}

function isLocalOrTestProviderHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]"
    || normalized === "host.docker.internal"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".test");
}

function uniqueProviderHosts(...hosts: string[]): string[] {
  return [...new Set(hosts.map(normalizeProviderHostname))];
}

function normalizeProviderHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, "");
}
