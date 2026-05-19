import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_LOG_PATH,
} from "@murphai/hosted-execution/routes";

import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
} from "./internal-hosts.ts";
import {
  handleRunnerOutboundRequest,
} from "./runner-outbound.ts";
import {
  readHostedRunnerDiagnosticMethod,
  readHostedRunnerInternalHostKind,
  readHostedRunnerInternalOperation,
} from "./runner-outbound/diagnostics.ts";
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
    method: "POST",
    pathname: "/v1/responses/compact",
  },
  {
    method: "GET",
    pathname: "/v1/models",
  },
] as const;
export const HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE =
  "runner.provider_egress_diagnostic";
const HOSTED_OPENAI_CACHE_DIAGNOSTIC_VERSION = 1;
const OPENAI_CACHE_DIAGNOSTIC_MIN_DIGEST_BYTES = 4 * 1024;
const OPENAI_CACHE_DIAGNOSTIC_PREFIX_WINDOWS = [8 * 1024, 32 * 1024, 128 * 1024] as const;
const OPENAI_CACHE_NAMESPACE_MIN_DIGEST_CHARS = 12;
const OPENAI_CACHE_DIAGNOSTIC_TEXT_DECODER = new TextDecoder();
const OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER = new TextEncoder();

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
  acceptedBaseUrls: readonly URL[];
  baseUrl: URL;
  knownHosts: readonly string[];
}

interface ProviderPathMatch {
  pathnameSuffix: string;
  upstreamBaseUrl: URL;
}

interface HostedRunnerOutboundContext {
  containerId?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type HostedOpenAiCacheDiagnosticEndpointKind = "responses" | "responses_compact";
type HostedRunnerDiagnosticScalar = boolean | null | number | string;
export type HostedRunnerDiagnosticJson = Record<
  string,
  HostedRunnerDiagnosticScalar | HostedRunnerDiagnosticScalar[]
>;

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
    await maybeHandleOpenAiRequest({ ctx, env, request, url, userId })
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
      method: readHostedRunnerDiagnosticMethod(request.method),
      policy: "open_internet_passthrough",
      userIdPresent: userId !== null,
    },
    level: "warn",
    message: "Hosted runner open-internet passthrough forwarded outbound request.",
    phase: "wake.running",
  });
  return await fetch(createHostedRunnerOpenInternetPassthroughRequest(request));
}

export const hostedRunnerIntercept = handleHostedRunnerOpenInternetOutbound;

export async function handleHostedRunnerInternalOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
    return disallowedProviderEgress();
  }

  const userId = readHostedRunnerBoundUserId(request);
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      boundUserIdHeaderPresent: userId !== null,
      containerIdPresent: typeof ctx.containerId === "string" && ctx.containerId.length > 0,
      hostKind: readHostedRunnerInternalHostKind(url.hostname),
      method: readHostedRunnerDiagnosticMethod(request.method),
      operation: readHostedRunnerInternalOperation({
        hostname: url.hostname,
        method: request.method,
        pathname: url.pathname,
      }),
      runtimeAuthorityHeadersPresent: hostedRuntimeAuthorityHeadersPresent(request.headers),
    },
    message: "Hosted runner internal outbound request received.",
    phase: "wake.running",
  });
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
      ctx: _ctx,
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
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(undefined, DEFAULT_OPENAI_API_BASE_URL, input.env);
  const pathMatch = readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }
  const { pathnameSuffix } = pathMatch;
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
  const upstreamRequest = await createHostedRunnerUpstreamRequest(
    input.request,
    createProviderUpstreamUrl(input.url, pathMatch),
    headers,
  );
  const endpointKind = readOpenAiCacheDiagnosticEndpointKind(pathnameSuffix);
  if (endpointKind) {
    await emitHostedRunnerOpenAiCacheDiagnostic({
      ctx: input.ctx ?? null,
      endpointKind,
      env: input.env,
      request: input.request,
      upstreamRequest,
      userId: input.userId,
    });
  }
  return await fetch(upstreamRequest);
}

function readOpenAiCacheDiagnosticEndpointKind(
  pathnameSuffix: string,
): HostedOpenAiCacheDiagnosticEndpointKind | null {
  if (pathnameSuffix === "/v1/responses") {
    return "responses";
  }
  if (pathnameSuffix === "/v1/responses/compact") {
    return "responses_compact";
  }
  return null;
}

async function emitHostedRunnerOpenAiCacheDiagnostic(input: {
  ctx: HostedRunnerOutboundContext | null;
  endpointKind: HostedOpenAiCacheDiagnosticEndpointKind;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  upstreamRequest: Request;
  userId: string | null;
}): Promise<void> {
  let diagnostic: HostedRunnerDiagnosticJson;
  try {
    const requestBytes = new Uint8Array(await input.upstreamRequest.clone().arrayBuffer());
    diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: input.endpointKind,
      method: input.request.method,
      requestBytes,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        diagnosticCaptured: false,
        endpointKind: input.endpointKind,
      },
      error,
      level: "warn",
      message: "Hosted runner OpenAI cache diagnostic capture failed.",
      phase: "wake.running",
    });
    return;
  }

  const runtimeLogScheduled =
    input.userId !== null
    && typeof input.ctx?.waitUntil === "function";
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      runtimeLogScheduled,
      ...diagnostic,
    },
    message: "Hosted runner OpenAI cache diagnostic captured.",
    phase: "wake.running",
  });

  if (!runtimeLogScheduled || !input.userId || !input.ctx?.waitUntil) {
    return;
  }

  input.ctx.waitUntil(writeHostedRunnerOpenAiCacheDiagnosticRuntimeLog({
    diagnostic,
    env: input.env,
    request: input.request,
    userId: input.userId,
  }).catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        endpointKind: input.endpointKind,
        runtimeLogScheduled: true,
      },
      error,
      level: "warn",
      message: "Hosted runner OpenAI cache diagnostic runtime-log write failed.",
      phase: "wake.running",
    });
  }));
}

export async function buildHostedOpenAiCacheDiagnostic(input: {
  endpointKind: HostedOpenAiCacheDiagnosticEndpointKind;
  method: string;
  requestBytes: Uint8Array;
}): Promise<HostedRunnerDiagnosticJson> {
  const diagnostic: HostedRunnerDiagnosticJson = {
    diagnosticVersion: HOSTED_OPENAI_CACHE_DIAGNOSTIC_VERSION,
    endpointKind: input.endpointKind,
    jsonType: "unknown",
    jsonValid: false,
    methodKind: readOpenAiDiagnosticMethodKind(input.method),
    providerKind: "openai",
    requestBytes: input.requestBytes.byteLength,
  };

  await appendDigestDiagnostics({
    bytes: input.requestBytes,
    fieldPrefix: "request",
    output: diagnostic,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(OPENAI_CACHE_DIAGNOSTIC_TEXT_DECODER.decode(input.requestBytes));
  } catch {
    diagnostic.jsonType = "invalid";
    return diagnostic;
  }

  diagnostic.jsonValid = true;
  diagnostic.jsonType = readOpenAiDiagnosticJsonType(parsed);
  if (!isHostedOpenAiDiagnosticRecord(parsed)) {
    return diagnostic;
  }

  diagnostic.requestFieldCount = Object.keys(parsed).length;
  diagnostic.modelKind = readOpenAiDiagnosticCode(readStringRecordProperty(parsed, "model")) ?? "missing";
  diagnostic.cacheRetentionKind = readOpenAiCacheRetentionKind(parsed.prompt_cache_retention);

  const cacheNamespace = readStringRecordProperty(parsed, "prompt_cache_key");
  diagnostic.cacheNamespacePresent = cacheNamespace !== null;
  if (cacheNamespace) {
    await appendSensitiveIdentifierDigest({
      fieldPrefix: "cacheNamespace",
      output: diagnostic,
      value: cacheNamespace,
    });
  }

  const previousResponseId = readStringRecordProperty(parsed, "previous_response_id");
  diagnostic.previousResponsePresent = previousResponseId !== null;
  if (previousResponseId) {
    await appendSensitiveIdentifierDigest({
      fieldPrefix: "previousResponse",
      output: diagnostic,
      value: previousResponseId,
    });
  }

  const instructions = readStringRecordProperty(parsed, "instructions");
  diagnostic.instructionsPresent = instructions !== null;
  if (instructions) {
    diagnostic.instructionsBytes = byteLengthOfDiagnosticText(instructions);
  }

  const inputValue = parsed.input;
  diagnostic.inputPresent = Object.hasOwn(parsed, "input");
  diagnostic.inputType = readOpenAiDiagnosticJsonType(inputValue);
  diagnostic.inputCount = readOpenAiInputCount(inputValue);
  const inputBytes = encodeOpenAiDiagnosticJsonValue(inputValue);
  if (inputBytes) {
    diagnostic.inputBytes = inputBytes.byteLength;
    await appendDigestDiagnostics({
      bytes: inputBytes,
      fieldPrefix: "input",
      output: diagnostic,
    });
  }

  diagnostic.toolCount = Array.isArray(parsed.tools) ? parsed.tools.length : 0;
  diagnostic.includeCount = Array.isArray(parsed.include) ? parsed.include.length : 0;
  diagnostic.storePresent = Object.hasOwn(parsed, "store");
  diagnostic.streamPresent = Object.hasOwn(parsed, "stream");

  return diagnostic;
}

async function writeHostedRunnerOpenAiCacheDiagnosticRuntimeLog(input: {
  diagnostic: HostedRunnerDiagnosticJson;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<void> {
  const attemptId = readRuntimeLogHeader(input.request.headers, HOSTED_RUNTIME_ATTEMPT_ID_HEADER);
  const leaseGeneration = readRuntimeLogHeader(
    input.request.headers,
    HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  );
  const workspaceVersion = readRuntimeLogHeader(
    input.request.headers,
    HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  );
  const response = await handleRunnerOutboundRequest(
    new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}${HOSTED_RUNTIME_LOG_PATH}`, {
      body: JSON.stringify({
        entries: [{
          at: new Date().toISOString(),
          ...(attemptId ? { attemptId } : {}),
          component: "runner",
          eventCode: HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE,
          ...(leaseGeneration ? { leaseGeneration } : {}),
          level: "debug",
          phase: "fetch",
          redactedJson: input.diagnostic,
          ...(workspaceVersion ? { workspaceVersion } : {}),
        }],
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    }),
    input.env,
    input.userId,
  );

  if (!response.ok) {
    throw new Error(`Hosted OpenAI cache diagnostic runtime-log write returned HTTP ${response.status}.`);
  }
  await drainHostedRunnerMetadataResponse(response);
}

async function appendDigestDiagnostics(input: {
  bytes: Uint8Array;
  fieldPrefix: "input" | "request";
  output: HostedRunnerDiagnosticJson;
}): Promise<void> {
  const digestPresentKey = `${input.fieldPrefix}DigestPresent`;
  input.output[digestPresentKey] = input.bytes.byteLength >= OPENAI_CACHE_DIAGNOSTIC_MIN_DIGEST_BYTES;
  if (input.bytes.byteLength < OPENAI_CACHE_DIAGNOSTIC_MIN_DIGEST_BYTES) {
    return;
  }

  input.output[`${input.fieldPrefix}Digest`] = await sha256DiagnosticDigest(input.bytes);
  const prefixLengths = readOpenAiCacheDiagnosticPrefixLengths(input.bytes.byteLength);
  input.output[`${input.fieldPrefix}PrefixLengths`] = prefixLengths;
  input.output[`${input.fieldPrefix}PrefixDigests`] = await Promise.all(
    prefixLengths.map((length) => sha256DiagnosticDigest(input.bytes.subarray(0, length))),
  );
}

async function appendSensitiveIdentifierDigest(input: {
  fieldPrefix: "cacheNamespace" | "previousResponse";
  output: HostedRunnerDiagnosticJson;
  value: string;
}): Promise<void> {
  const eligible = input.value.length >= OPENAI_CACHE_NAMESPACE_MIN_DIGEST_CHARS;
  input.output[`${input.fieldPrefix}DigestPresent`] = eligible;
  if (!eligible) {
    return;
  }

  input.output[`${input.fieldPrefix}Digest`] = await sha256DiagnosticDigest(
    OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(input.value),
  );
}

function readOpenAiCacheDiagnosticPrefixLengths(byteLength: number): number[] {
  return Array.from(new Set(
    OPENAI_CACHE_DIAGNOSTIC_PREFIX_WINDOWS
      .map((limit) => Math.min(limit, byteLength))
      .filter((length) => length > 0),
  ));
}

function readOpenAiDiagnosticMethodKind(method: string): string {
  return method === "POST" ? "POST" : "other";
}

function readOpenAiDiagnosticCode(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(normalized)
    ? normalized
    : "other";
}

function readOpenAiCacheRetentionKind(value: unknown): string {
  if (value === undefined || value === null) {
    return "default";
  }
  if (value === "24h" || value === "in_memory") {
    return value;
  }
  return "other";
}

function readOpenAiDiagnosticJsonType(value: unknown): string {
  if (value === undefined) {
    return "missing";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return typeof value;
    case "object":
      return "object";
    default:
      return "other";
  }
}

function readOpenAiInputCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value === undefined || value === null) {
    return 0;
  }
  return typeof value === "string" && value.length === 0 ? 0 : 1;
}

function readStringRecordProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function encodeOpenAiDiagnosticJsonValue(value: unknown): Uint8Array | null {
  if (value === undefined) {
    return null;
  }
  const serialized = JSON.stringify(value);
  return typeof serialized === "string"
    ? OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(serialized)
    : null;
}

function byteLengthOfDiagnosticText(value: string): number {
  return OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(value).byteLength;
}

async function sha256DiagnosticDigest(bytes: Uint8Array): Promise<string> {
  const digestInput = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : copyDiagnosticBytesToArrayBuffer(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function copyDiagnosticBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isHostedOpenAiDiagnosticRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRuntimeLogHeader(headers: Headers, name: string): string | null {
  const normalized = headers.get(name)?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function drainHostedRunnerMetadataResponse(response: Response): Promise<void> {
  if (response.body === null || response.bodyUsed) {
    return;
  }
  await response.arrayBuffer();
}

async function maybeHandleMapboxRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(undefined, DEFAULT_MAPBOX_API_BASE_URL, input.env);
  const pathMatch = readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }
  const { pathnameSuffix } = pathMatch;
  if (!isAllowedMapboxRequest(input.request.method, pathnameSuffix)) {
    return disallowedProviderEgress();
  }
  if (!hasQueryCredentialSentinel(input.url, "access_token")) {
    return disallowedProviderEgress();
  }

  const token = readRequiredInterceptSecret(input.env.MAPBOX_ACCESS_TOKEN, "MAPBOX_ACCESS_TOKEN");
  const upstreamUrl = createProviderUpstreamUrl(input.url, pathMatch);
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
  const providerBase = readProviderBaseConfig(
    input.env.LINQ_API_BASE_URL,
    DEFAULT_LINQ_API_BASE_URL,
    input.env,
  );
  const pathMatch = readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }

  if (!isAllowedLinqRequest(input.request.method, pathMatch.pathnameSuffix)) {
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
  return await fetch(await createHostedRunnerUpstreamRequest(
    input.request,
    createProviderUpstreamUrl(input.url, pathMatch),
    headers,
  ));
}

async function maybeHandleTelegramRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(
    input.env.TELEGRAM_API_BASE_URL,
    DEFAULT_TELEGRAM_API_BASE_URL,
    input.env,
    { acceptFallbackBaseUrl: true },
  );
  const pathMatch = readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }

  const operation = readTelegramSentinelOperation(pathMatch.pathnameSuffix);
  if (!operation || !isAllowedTelegramOperation(operation)) {
    return disallowedProviderEgress();
  }

  const authorized = await requestOwnsRuntimeWriteFence(input);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = readRequiredInterceptSecret(input.env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN");
  const upstreamUrl = createProviderUpstreamUrl(input.url, pathMatch);
  const prefix = normalizedProviderBasePath(pathMatch.upstreamBaseUrl);
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
  const providerBase = readProviderBaseConfig(
    input.env.WHATSAPP_API_BASE_URL,
    DEFAULT_WHATSAPP_API_BASE_URL,
    input.env,
    { acceptFallbackBaseUrl: true },
  );
  const pathMatch = readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }
  const { pathnameSuffix } = pathMatch;

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
  const upstreamUrl = createProviderUpstreamUrl(input.url, pathMatch);
  const prefix = normalizedProviderBasePath(pathMatch.upstreamBaseUrl);
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

function hostedRuntimeAuthorityHeadersPresent(headers: Headers): boolean {
  return HOSTED_RUNTIME_AUTHORITY_HEADER_NAMES.some((name) => headers.has(name));
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

function readProviderBaseConfig(
  value: unknown,
  fallback: string,
  env: RunnerOutboundEnvironmentSource,
  options: {
    acceptFallbackBaseUrl?: boolean;
  } = {},
): ProviderBaseConfig {
  const fallbackUrl = new URL(fallback);
  const fallbackBaseUrls = withContainerHostAlias(fallbackUrl, env);
  const fallbackHosts = fallbackBaseUrls.map((url) => url.hostname);
  const rawValue = typeof value === "string" && value.trim() ? value.trim() : null;
  if (!rawValue) {
    return {
      acceptedBaseUrls: fallbackBaseUrls,
      baseUrl: fallbackUrl,
      knownHosts: fallbackHosts,
    };
  }

  try {
    const url = new URL(rawValue);
    if (isAllowedProviderBaseUrl(url)) {
      const acceptedBaseUrls = uniqueProviderBaseUrls(
        ...withContainerHostAlias(url, env),
        ...(options.acceptFallbackBaseUrl ? fallbackBaseUrls : []),
      );
      return {
        acceptedBaseUrls,
        baseUrl: url,
        knownHosts: uniqueProviderHosts(
          ...acceptedBaseUrls.map((accepted) => accepted.hostname),
          fallbackUrl.hostname,
        ),
      };
    }
    return {
      acceptedBaseUrls: fallbackBaseUrls,
      baseUrl: fallbackUrl,
      knownHosts: uniqueProviderHosts(url.hostname, fallbackUrl.hostname),
    };
  } catch {
    return {
      acceptedBaseUrls: fallbackBaseUrls,
      baseUrl: fallbackUrl,
      knownHosts: fallbackHosts,
    };
  }
}

function uniqueProviderBaseUrls(...urls: URL[]): URL[] {
  const seen = new Set<string>();
  const unique: URL[] = [];

  for (const url of urls) {
    const key = url.origin + normalizedProviderBasePath(url);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(url);
  }

  return unique;
}

function readProviderPathMatch(url: URL, providerBase: ProviderBaseConfig): ProviderPathMatch | null {
  for (const acceptedBaseUrl of providerBase.acceptedBaseUrls) {
    if (url.origin !== acceptedBaseUrl.origin) {
      continue;
    }
    const prefix = normalizedProviderBasePath(acceptedBaseUrl);
    if (!url.pathname.startsWith(prefix)) {
      continue;
    }
    return {
      pathnameSuffix: url.pathname.slice(prefix.length),
      upstreamBaseUrl: providerBase.baseUrl,
    };
  }
  return null;
}

function createProviderUpstreamUrl(sourceUrl: URL, match: ProviderPathMatch): URL {
  const upstreamUrl = new URL(match.upstreamBaseUrl.toString());
  upstreamUrl.pathname = `${normalizedProviderBasePath(match.upstreamBaseUrl)}${match.pathnameSuffix}`;
  upstreamUrl.search = sourceUrl.search;
  upstreamUrl.hash = sourceUrl.hash;
  return upstreamUrl;
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

function withContainerHostAlias(baseUrl: URL, env: RunnerOutboundEnvironmentSource): URL[] {
  const urls = [baseUrl];
  const alias = readLocalProviderHostAlias(env);
  if (!alias || !isLocalOrTestProviderHost(baseUrl.hostname)) {
    return urls;
  }

  const aliasUrl = new URL(baseUrl.toString());
  aliasUrl.hostname = alias;
  if (aliasUrl.origin !== baseUrl.origin) {
    urls.push(aliasUrl);
  }
  return urls;
}

function readLocalProviderHostAlias(env: RunnerOutboundEnvironmentSource): string | null {
  const alias = typeof env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS === "string"
    ? env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS.trim()
    : "";
  if (!alias || !isLocalOrTestProviderHost(alias)) {
    return null;
  }
  return alias;
}

function uniqueProviderHosts(...hosts: string[]): string[] {
  return [...new Set(hosts.map(normalizeProviderHostname))];
}

function normalizeProviderHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, "");
}
