import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  type HostedExecutionStructuredLogDetails,
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
  readHostedRunnerSafeResponseBodyMetadata,
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
const DEFAULT_TELEGRAM_FILE_BASE_URL = "https://api.telegram.org/file";
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
  workspaceSnapshotStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.workspaceSnapshotStore,
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
  {
    method: "GET",
    pathname: "/v1/responses",
    requiresWebSocketUpgrade: true,
  },
] as const;
const OPENAI_CACHE_DIAGNOSTIC_MODEL_KINDS = new Set([
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-5.2",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "o3",
  "o3-mini",
  "o4-mini",
]);
export const HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE =
  "runner.provider_egress_diagnostic";
const HOSTED_OPENAI_CACHE_DIAGNOSTIC_VERSION = 1;
const OPENAI_CACHE_DIAGNOSTIC_MAX_JSON_BYTES = 6 * 1024 * 1024;
const OPENAI_CACHE_DIAGNOSTIC_MAX_FULL_FINGERPRINT_BYTES = 256 * 1024;
const OPENAI_CACHE_DIAGNOSTIC_MIN_DIGEST_BYTES = 4 * 1024;
const OPENAI_CACHE_DIAGNOSTIC_PREFIX_WINDOWS = [8 * 1024, 32 * 1024, 128 * 1024] as const;
const OPENAI_CACHE_NAMESPACE_MIN_DIGEST_CHARS = 12;
const OPENAI_CACHE_DIAGNOSTIC_FINGERPRINT_CONTEXT =
  "murph.hosted-openai-cache-diagnostic.v1";
const OPENAI_CACHE_DIAGNOSTIC_TEXT_DECODER = new TextDecoder();
const OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER = new TextEncoder();
const OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_DEPTH = 128;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_NODES = 50_000;
const OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS = 16;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_TAIL_ITEM_COUNT = 8;
const OPENAI_CACHE_DIAGNOSTIC_FUNCTION_NAME_MAX_CHARS = 96;
const OPENAI_CACHE_DIAGNOSTIC_DUPLICATE_FUNCTION_NAME_KIND = "duplicate";
const OPENAI_CACHE_DIAGNOSTIC_SAFE_FUNCTION_NAME_PATTERN =
  /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/u;
const OPENAI_CACHE_DIAGNOSTIC_UNSAFE_FUNCTION_NAME_PATTERN =
  /authorization|bearer|cookie|password|secret|token|api_?key|(?:sk|pk|rk)_(?:live|test)_|whsec_/iu;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_ITEM_TYPE_KINDS = [
  "computer_call",
  "computer_call_output",
  "file_search_call",
  "function_call",
  "function_call_output",
  "image_generation_call",
  "local_shell_call",
  "local_shell_call_output",
  "message",
  "reasoning",
  "web_search_call",
] as const;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_ITEM_ROLE_KINDS = [
  "assistant",
  "developer",
  "system",
  "tool",
  "user",
] as const;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_KEYS = new Set(["content", "output"]);
const OPENAI_CACHE_DIAGNOSTIC_INPUT_NESTED_METRIC_KINDS = [
  "content",
  "output",
  "string",
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
  knownHosts: readonly string[];
  routes: readonly ProviderBaseRoute[];
}

interface ProviderBaseRoute {
  acceptedBaseUrl: URL;
  upstreamBaseUrl: URL;
}

interface ProviderPathMatch {
  pathnameSuffix: string;
  upstreamBaseUrl: URL;
}

interface HostedRunnerOutboundContext {
  containerId?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
}

interface HostedRunnerDiagnosticBodySource {
  arrayBuffer(): Promise<ArrayBuffer>;
}

type HostedProviderEgressValidationMode =
  | "active_container"
  | "exact_headers"
  | "missing_identity";
type HostedProviderEgressActiveContainerIdentitySource =
  | "bound_user_header"
  | "container_name";

interface HostedProviderEgressAuthorization {
  activeContainerIdentitySource: HostedProviderEgressActiveContainerIdentitySource | null;
  authorized: boolean;
  durationMs: number;
  mode: HostedProviderEgressValidationMode;
  runtimeAuthorityHeadersPresent: boolean;
  userId: string | null;
  writeFence: HostedProviderEgressWriteFenceMetadata | null;
}

interface HostedProviderEgressWriteFenceMetadata {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
  workspaceVersion: string | null;
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
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.workspaceSnapshotStore]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.whatsApp]: handleHostedRunnerWhatsAppOutbound,
  // Hosted-local rewrites loopback provider bases to this container-reachable
  // host. Send it through the multiplexer so provider policy still applies.
  "host.docker.internal": handleHostedRunnerOpenInternetOutbound,
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
    ?? await maybeHandleMapboxRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleLinqRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleTelegramRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleWhatsAppRequest({ ctx, env, request, url, userId });

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
  const startedAt = Date.now();
  const url = new URL(request.url);
  if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
    return disallowedProviderEgress();
  }

  const userId = readHostedRunnerBoundUserId(request);
  const diagnosticDetails = {
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
  } satisfies HostedExecutionStructuredLogDetails;
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: diagnosticDetails,
    message: "Hosted runner internal outbound request received.",
    phase: "wake.running",
  });
  if (!userId) {
    const response = new Response("Missing hosted runner identity.", { status: 403 });
    await emitHostedRunnerInternalOutboundResponseCompleted({
      diagnosticDetails,
      response,
      startedAt,
    });
    return response;
  }

  try {
    const response = await handleRunnerOutboundRequest(
      createHostedRunnerInternalRequest(request),
      env,
      userId,
    );
    await emitHostedRunnerInternalOutboundResponseCompleted({
      diagnosticDetails,
      response,
      startedAt,
    });
    return response;
  } catch (error) {
    const safeErrorDetails = buildHostedExecutionSafeErrorDetails(error);
    const errorName = readHostedExecutionSafeErrorName(error);
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...diagnosticDetails,
        durationMs: Date.now() - startedAt,
        errorCode: deriveHostedExecutionErrorCode(error),
        errorDetailsPresent: safeErrorDetails !== null,
        errorMessagePresent: error instanceof Error && error.message.trim().length > 0,
        ...(errorName ? { errorName } : {}),
      },
      level: "warn",
      message: "Hosted runner internal outbound response failed.",
      phase: "wake.running",
    });
    throw error;
  }
}

async function emitHostedRunnerInternalOutboundResponseCompleted(input: {
  diagnosticDetails: HostedExecutionStructuredLogDetails;
  response: Response;
  startedAt: number;
}): Promise<void> {
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      ...input.diagnosticDetails,
      durationMs: Date.now() - input.startedAt,
      responseOk: input.response.ok,
      responseStatus: input.response.status,
      ...(input.response.ok
        ? {}
        : await readHostedRunnerSafeResponseBodyMetadata(input.response.clone())),
    },
    level: input.response.ok ? "info" : "warn",
    message: "Hosted runner internal outbound response completed.",
    phase: "wake.running",
  });
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
      ctx: _ctx,
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
      ctx: _ctx,
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
      ctx: _ctx,
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
      ctx: _ctx,
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
  if (!isAllowedOpenAiRequest(input.request, pathnameSuffix)) {
    return disallowedProviderEgress();
  }
  if (!hasBearerCredentialSentinel(input.request.headers)) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    providerKind: "openai",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "openai",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const token = readRequiredInterceptSecret(input.env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("authorization", `Bearer ${token}`);
  const upstreamRequest = await createHostedRunnerUpstreamRequest(
    input.request,
    createProviderUpstreamUrl(input.url, pathMatch),
    headers,
  );
  const endpointKind = readOpenAiCacheDiagnosticEndpointKind(
    input.request.method,
    pathnameSuffix,
  );
  if (endpointKind) {
    const diagnosticPromise = emitHostedRunnerOpenAiCacheDiagnostic({
      ctx: input.ctx ?? null,
      endpointKind,
      env: input.env,
      request: input.request,
      upstreamRequestBody: upstreamRequest.clone(),
      userId: authorization.userId,
      writeFence: authorization.writeFence,
    });
    if (typeof input.ctx?.waitUntil === "function") {
      input.ctx.waitUntil(diagnosticPromise);
    } else {
      const response = await fetchAuthorizedProviderUpstream({
        authorization,
        providerKind: "openai",
        request: input.request,
        startedAt,
        upstreamRequest,
        url: input.url,
      });
      await diagnosticPromise;
      return response;
    }
  }
  return await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "openai",
    request: input.request,
    startedAt,
    upstreamRequest,
    url: input.url,
  });
}

function readOpenAiCacheDiagnosticEndpointKind(
  method: string,
  pathnameSuffix: string,
): HostedOpenAiCacheDiagnosticEndpointKind | null {
  if (method !== "POST") {
    return null;
  }
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
  upstreamRequestBody: HostedRunnerDiagnosticBodySource;
  userId: string | null;
  writeFence: HostedProviderEgressWriteFenceMetadata | null;
}): Promise<void> {
  let diagnostic: HostedRunnerDiagnosticJson;
  try {
    const requestBytes = new Uint8Array(await input.upstreamRequestBody.arrayBuffer());
    diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: input.endpointKind,
      fingerprintSecret: readOpenAiCacheDiagnosticFingerprintSecret(input.env),
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

  if (!input.userId) {
    return;
  }

  await writeHostedRunnerOpenAiCacheDiagnosticRuntimeLog({
    diagnostic,
    env: input.env,
    request: input.request,
    userId: input.userId,
    writeFence: input.writeFence,
  }).catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        endpointKind: input.endpointKind,
        runtimeLogScheduled,
      },
      error,
      level: "warn",
      message: "Hosted runner OpenAI cache diagnostic runtime-log write failed.",
      phase: "wake.running",
    });
  });
}

export async function buildHostedOpenAiCacheDiagnostic(input: {
  endpointKind: HostedOpenAiCacheDiagnosticEndpointKind;
  fingerprintSecret?: string | null;
  method: string;
  requestBytes: Uint8Array;
}): Promise<HostedRunnerDiagnosticJson> {
  const fingerprintKey = await createOpenAiCacheDiagnosticFingerprintKey(
    input.fingerprintSecret ?? null,
  );
  const diagnostic: HostedRunnerDiagnosticJson = {
    diagnosticVersion: HOSTED_OPENAI_CACHE_DIAGNOSTIC_VERSION,
    endpointKind: input.endpointKind,
    fingerprintKind: fingerprintKey ? "hmac-sha256" : "none",
    jsonType: "unknown",
    jsonValid: false,
    methodKind: readOpenAiDiagnosticMethodKind(input.method),
    providerKind: "openai",
    requestBytes: input.requestBytes.byteLength,
  };

  await appendFingerprintDiagnostics({
    bytes: input.requestBytes,
    fieldPrefix: "request",
    fingerprintKey,
    output: diagnostic,
  });

  if (input.requestBytes.byteLength > OPENAI_CACHE_DIAGNOSTIC_MAX_JSON_BYTES) {
    diagnostic.jsonSkippedReasonKind = "too_large";
    return diagnostic;
  }

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
  diagnostic.modelKind = readOpenAiDiagnosticModelKind(readStringRecordProperty(parsed, "model"));
  diagnostic.cacheRetentionKind = readOpenAiCacheRetentionKind(parsed.prompt_cache_retention);

  const cacheNamespace = readStringRecordProperty(parsed, "prompt_cache_key");
  diagnostic.cacheNamespacePresent = cacheNamespace !== null;
  if (cacheNamespace) {
    await appendSensitiveIdentifierFingerprint({
      fieldPrefix: "cacheNamespace",
      fingerprintKey,
      output: diagnostic,
      value: cacheNamespace,
    });
  }

  const previousResponseId = readStringRecordProperty(parsed, "previous_response_id");
  diagnostic.previousResponsePresent = previousResponseId !== null;
  if (previousResponseId) {
    await appendSensitiveIdentifierFingerprint({
      fieldPrefix: "previousResponse",
      fingerprintKey,
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
    await appendFingerprintDiagnostics({
      bytes: inputBytes,
      fieldPrefix: "input",
      fingerprintKey,
      output: diagnostic,
    });
  }
  await appendOpenAiInputShapeDiagnostics({
    diagnostic,
    fingerprintKey,
    inputValue,
  });

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
  writeFence: HostedProviderEgressWriteFenceMetadata | null;
}): Promise<void> {
  const writeFence = input.writeFence ?? readRuntimeLogWriteFenceMetadata({
    headers: input.request.headers,
    userId: input.userId,
  });
  const response = await handleRunnerOutboundRequest(
    new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}${HOSTED_RUNTIME_LOG_PATH}`, {
      body: JSON.stringify({
        entries: [{
          at: new Date().toISOString(),
          ...(writeFence ? { attemptId: writeFence.attemptId } : {}),
          component: "runner",
          eventCode: HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE,
          ...(writeFence ? { leaseGeneration: writeFence.leaseGeneration } : {}),
          level: "debug",
          phase: "fetch",
          redactedJson: input.diagnostic,
          ...(writeFence?.workspaceVersion ? { workspaceVersion: writeFence.workspaceVersion } : {}),
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

async function appendFingerprintDiagnostics(input: {
  bytes: Uint8Array;
  fieldPrefix: "input" | "request";
  fingerprintKey: CryptoKey | null;
  output: HostedRunnerDiagnosticJson;
}): Promise<void> {
  const fingerprintKey = input.fingerprintKey;
  const fingerprintPresentKey = `${input.fieldPrefix}FingerprintPresent`;
  const prefixFingerprintEligible =
    Boolean(fingerprintKey)
    && input.bytes.byteLength >= OPENAI_CACHE_DIAGNOSTIC_MIN_DIGEST_BYTES;
  const fullFingerprintEligible =
    prefixFingerprintEligible
    && input.bytes.byteLength <= OPENAI_CACHE_DIAGNOSTIC_MAX_FULL_FINGERPRINT_BYTES;
  input.output[fingerprintPresentKey] = fullFingerprintEligible;
  if (
    !fingerprintKey
    || input.bytes.byteLength < OPENAI_CACHE_DIAGNOSTIC_MIN_DIGEST_BYTES
  ) {
    return;
  }
  const activeFingerprintKey = fingerprintKey;

  if (fullFingerprintEligible) {
    input.output[`${input.fieldPrefix}Fingerprint`] = await hmacDiagnosticFingerprint({
      bytes: input.bytes,
      fieldPrefix: input.fieldPrefix,
      fingerprintKey: activeFingerprintKey,
    });
  } else {
    input.output[`${input.fieldPrefix}FullFingerprintSkipped`] = true;
  }
  const prefixLengths = readOpenAiCacheDiagnosticPrefixLengths(input.bytes.byteLength);
  input.output[`${input.fieldPrefix}PrefixLengths`] = prefixLengths;
  input.output[`${input.fieldPrefix}PrefixFingerprints`] = await Promise.all(
    prefixLengths.map((length) =>
      hmacDiagnosticFingerprint({
        bytes: input.bytes.subarray(0, length),
        fieldPrefix: `${input.fieldPrefix}:prefix:${length}`,
        fingerprintKey: activeFingerprintKey,
      })),
  );
}

async function appendSensitiveIdentifierFingerprint(input: {
  fieldPrefix: "cacheNamespace" | "previousResponse";
  fingerprintKey: CryptoKey | null;
  output: HostedRunnerDiagnosticJson;
  value: string;
}): Promise<void> {
  const fingerprintKey = input.fingerprintKey;
  input.output[`${input.fieldPrefix}FingerprintPresent`] =
    Boolean(fingerprintKey)
    && input.value.length >= OPENAI_CACHE_NAMESPACE_MIN_DIGEST_CHARS;
  if (
    !fingerprintKey
    || input.value.length < OPENAI_CACHE_NAMESPACE_MIN_DIGEST_CHARS
  ) {
    return;
  }
  const activeFingerprintKey = fingerprintKey;

  input.output[`${input.fieldPrefix}Fingerprint`] = await hmacDiagnosticFingerprint({
    bytes: OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(input.value),
    fieldPrefix: input.fieldPrefix,
    fingerprintKey: activeFingerprintKey,
  });
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

function readOpenAiDiagnosticModelKind(value: string | null): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "missing";
  }
  return OPENAI_CACHE_DIAGNOSTIC_MODEL_KINDS.has(normalized) ? normalized : "other";
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
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string"
      ? OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(serialized)
      : null;
  } catch {
    return null;
  }
}

async function appendOpenAiInputShapeDiagnostics(input: {
  diagnostic: HostedRunnerDiagnosticJson;
  fingerprintKey: CryptoKey | null;
  inputValue: unknown;
}): Promise<void> {
  const diagnostic = input.diagnostic;
  const inputValue = input.inputValue;
  if (!Array.isArray(inputValue)) {
    return;
  }

  const functionCallNamesById = readOpenAiInputFunctionCallNamesById(inputValue);
  const typeCounts = new Map<string, number>();
  const typeBytes = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  const functionCallNameCounts = new Map<string, number>();
  const functionCallBytes = new Map<string, number>();
  const functionOutputNameCounts = new Map<string, number>();
  const functionOutputBytes = new Map<string, number>();
  let largestItemBytes = 0;
  let largestItemIndex = -1;
  let largestItemKinds = ["type:missing", "role:missing"];
  let largestFunctionOutputBytes = 0;
  let largestFunctionOutputIndex = -1;
  let largestFunctionOutputNameKind = "missing";

  for (const [index, item] of inputValue.entries()) {
    const typeKind = readOpenAiInputItemTypeKind(item);
    const roleKind = readOpenAiInputItemRoleKind(item);
    const itemBytes = encodeOpenAiDiagnosticJsonValue(item)?.byteLength ?? 0;
    incrementDiagnosticCount(typeCounts, typeKind);
    addDiagnosticBytes(typeBytes, typeKind, itemBytes);
    incrementDiagnosticCount(roleCounts, roleKind);

    if (itemBytes > largestItemBytes) {
      largestItemBytes = itemBytes;
      largestItemIndex = index;
      largestItemKinds = [`type:${typeKind}`, `role:${roleKind}`];
    }

    if (typeKind === "function_call") {
      const functionNameKind = readOpenAiInputFunctionCallNameKind(item, functionCallNamesById);
      incrementDiagnosticCount(functionCallNameCounts, functionNameKind);
      addDiagnosticBytes(functionCallBytes, functionNameKind, itemBytes);
    } else if (typeKind === "function_call_output") {
      const functionNameKind = readOpenAiInputFunctionOutputNameKind(
        item,
        functionCallNamesById,
      );
      const outputBytes = readOpenAiInputFunctionOutputBytes(item);
      incrementDiagnosticCount(functionOutputNameCounts, functionNameKind);
      addDiagnosticBytes(functionOutputBytes, functionNameKind, outputBytes);
      if (outputBytes > largestFunctionOutputBytes) {
        largestFunctionOutputBytes = outputBytes;
        largestFunctionOutputIndex = index;
        largestFunctionOutputNameKind = functionNameKind;
      }
    }
  }

  const nestedShape = summarizeOpenAiInputNestedShape(inputValue);
  const typeSummary = summarizeOpenAiDiagnosticCountsAndBytes(typeCounts, typeBytes);
  const roleSummary = summarizeOpenAiDiagnosticCounts(roleCounts);
  const functionCallNameSummary = summarizeOpenAiDiagnosticCountsAndBytes(
    functionCallNameCounts,
    functionCallBytes,
  );
  const functionOutputNameSummary = summarizeOpenAiDiagnosticCountsAndBytes(
    functionOutputNameCounts,
    functionOutputBytes,
  );

  diagnostic.inputItemTypeKinds = typeSummary.kinds;
  diagnostic.inputItemTypeCounts = typeSummary.counts;
  diagnostic.inputItemTypeBytes = typeSummary.bytes;
  diagnostic.inputItemRoleKinds = roleSummary.kinds;
  diagnostic.inputItemRoleCounts = roleSummary.counts;
  diagnostic.inputLargestItemBytes = largestItemBytes;
  diagnostic.inputLargestItemIndex = largestItemIndex;
  diagnostic.inputLargestItemReverseIndex =
    largestItemIndex >= 0 ? inputValue.length - 1 - largestItemIndex : -1;
  diagnostic.inputLargestItemKinds = largestItemKinds;
  diagnostic.inputNestedMetricKinds = [...OPENAI_CACHE_DIAGNOSTIC_INPUT_NESTED_METRIC_KINDS];
  diagnostic.inputNestedMetricCounts = [
    nestedShape.contentCount,
    nestedShape.outputCount,
    nestedShape.stringCount,
  ];
  diagnostic.inputNestedMetricBytes = [
    nestedShape.contentBytes,
    nestedShape.outputBytes,
    nestedShape.stringBytes,
  ];
  if (nestedShape.truncated) {
    diagnostic.inputShapeTraversalTruncated = true;
  }
  if (functionCallNameSummary.kinds.length > 0) {
    diagnostic.inputFunctionCallNameKinds = functionCallNameSummary.kinds;
    diagnostic.inputFunctionCallNameCounts = functionCallNameSummary.counts;
    diagnostic.inputFunctionCallBytes = functionCallNameSummary.bytes;
  }
  if (functionOutputNameSummary.kinds.length > 0) {
    diagnostic.inputFunctionOutputNameKinds = functionOutputNameSummary.kinds;
    diagnostic.inputFunctionOutputNameCounts = functionOutputNameSummary.counts;
    diagnostic.inputFunctionOutputBytes = functionOutputNameSummary.bytes;
    diagnostic.inputLargestFunctionOutputBytes = largestFunctionOutputBytes;
    diagnostic.inputLargestFunctionOutputIndex = largestFunctionOutputIndex;
    diagnostic.inputLargestFunctionOutputReverseIndex =
      largestFunctionOutputIndex >= 0 ? inputValue.length - 1 - largestFunctionOutputIndex : -1;
    diagnostic.inputLargestFunctionOutputNameKind = largestFunctionOutputNameKind;
  }

  await appendOpenAiInputTailItemDiagnostics({
    diagnostic,
    fingerprintKey: input.fingerprintKey,
    functionCallNamesById,
    inputValue,
  });
}

async function appendOpenAiInputTailItemDiagnostics(input: {
  diagnostic: HostedRunnerDiagnosticJson;
  fingerprintKey: CryptoKey | null;
  functionCallNamesById: ReadonlyMap<string, string>;
  inputValue: readonly unknown[];
}): Promise<void> {
  const tailItems = input.inputValue.slice(-OPENAI_CACHE_DIAGNOSTIC_INPUT_TAIL_ITEM_COUNT);
  if (tailItems.length === 0) {
    return;
  }

  const startIndex = input.inputValue.length - tailItems.length;
  const indexes: number[] = [];
  const reverseIndexes: number[] = [];
  const typeKinds: string[] = [];
  const roleKinds: string[] = [];
  const itemBytes: number[] = [];
  const contentBytes: number[] = [];
  const outputBytes: number[] = [];
  const stringBytes: number[] = [];
  const functionNameKinds: string[] = [];
  const fingerprints: string[] = [];
  let traversalTruncated = false;
  let functionNameDiagnosticsPresent = false;

  for (const [offset, item] of tailItems.entries()) {
    const index = startIndex + offset;
    const encodedItem = encodeOpenAiDiagnosticJsonValue(item);
    const nestedShape = summarizeOpenAiInputNestedShape(item);
    const typeKind = readOpenAiInputItemTypeKind(item);

    indexes.push(index);
    reverseIndexes.push(input.inputValue.length - 1 - index);
    typeKinds.push(typeKind);
    roleKinds.push(readOpenAiInputItemRoleKind(item));
    itemBytes.push(encodedItem?.byteLength ?? 0);
    contentBytes.push(nestedShape.contentBytes);
    outputBytes.push(nestedShape.outputBytes);
    stringBytes.push(nestedShape.stringBytes);
    traversalTruncated = traversalTruncated || nestedShape.truncated;
    if (typeKind === "function_call") {
      functionNameKinds.push(readOpenAiInputFunctionCallNameKind(
        item,
        input.functionCallNamesById,
      ));
      functionNameDiagnosticsPresent = true;
    } else if (typeKind === "function_call_output") {
      functionNameKinds.push(readOpenAiInputFunctionOutputNameKind(
        item,
        input.functionCallNamesById,
      ));
      functionNameDiagnosticsPresent = true;
    } else {
      functionNameKinds.push("none");
    }

    if (input.fingerprintKey && encodedItem) {
      fingerprints.push(await hmacDiagnosticFingerprint({
        bytes: encodedItem,
        fieldPrefix: "input:item",
        fingerprintKey: input.fingerprintKey,
      }));
    }
  }

  input.diagnostic.inputTailItemCount = tailItems.length;
  input.diagnostic.inputTailItemIndexes = indexes;
  input.diagnostic.inputTailItemReverseIndexes = reverseIndexes;
  input.diagnostic.inputTailItemTypeKinds = typeKinds;
  input.diagnostic.inputTailItemRoleKinds = roleKinds;
  input.diagnostic.inputTailItemBytes = itemBytes;
  input.diagnostic.inputTailItemContentBytes = contentBytes;
  input.diagnostic.inputTailItemOutputBytes = outputBytes;
  input.diagnostic.inputTailItemStringBytes = stringBytes;
  if (functionNameDiagnosticsPresent) {
    input.diagnostic.inputTailItemFunctionNameKinds = functionNameKinds;
  }
  input.diagnostic.inputTailItemFingerprintPresent = fingerprints.length > 0;
  if (fingerprints.length > 0) {
    input.diagnostic.inputTailItemFingerprints = fingerprints;
  }
  if (traversalTruncated) {
    input.diagnostic.inputTailItemShapeTraversalTruncated = true;
  }
}

function readOpenAiInputItemTypeKind(value: unknown): string {
  return readOpenAiInputItemAllowedKind(
    value,
    "type",
    OPENAI_CACHE_DIAGNOSTIC_INPUT_ITEM_TYPE_KINDS,
  );
}

function readOpenAiInputItemRoleKind(value: unknown): string {
  return readOpenAiInputItemAllowedKind(
    value,
    "role",
    OPENAI_CACHE_DIAGNOSTIC_INPUT_ITEM_ROLE_KINDS,
  );
}

function readOpenAiInputItemAllowedKind(
  value: unknown,
  field: "role" | "type",
  allowed: readonly string[],
): string {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return "missing";
  }

  const raw = value[field];
  if (typeof raw !== "string") {
    return "missing";
  }

  const normalized = raw.trim();
  if (normalized.length === 0) {
    return "missing";
  }
  return allowed.includes(normalized) ? normalized : "other";
}

function readOpenAiInputFunctionNameKind(value: unknown): string {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return "unknown";
  }
  return normalizeOpenAiInputFunctionNameKind(readStringRecordProperty(value, "name"));
}

function readOpenAiInputFunctionCallNamesById(inputValue: readonly unknown[]): ReadonlyMap<string, string> {
  const functionCallNamesById = new Map<string, string>();
  for (const item of inputValue) {
    if (readOpenAiInputItemTypeKind(item) !== "function_call") {
      continue;
    }

    const callId = readOpenAiInputFunctionCallLookupId(item);
    if (!callId) {
      continue;
    }

    if (functionCallNamesById.has(callId)) {
      functionCallNamesById.set(callId, OPENAI_CACHE_DIAGNOSTIC_DUPLICATE_FUNCTION_NAME_KIND);
    } else {
      functionCallNamesById.set(callId, readOpenAiInputFunctionNameKind(item));
    }
  }
  return functionCallNamesById;
}

function readOpenAiInputFunctionCallNameKind(
  value: unknown,
  functionCallNamesById: ReadonlyMap<string, string>,
): string {
  const callId = readOpenAiInputFunctionCallLookupId(value);
  if (
    callId
    && functionCallNamesById.get(callId) === OPENAI_CACHE_DIAGNOSTIC_DUPLICATE_FUNCTION_NAME_KIND
  ) {
    return OPENAI_CACHE_DIAGNOSTIC_DUPLICATE_FUNCTION_NAME_KIND;
  }
  return readOpenAiInputFunctionNameKind(value);
}

function readOpenAiInputFunctionOutputNameKind(
  value: unknown,
  functionCallNamesById: ReadonlyMap<string, string>,
): string {
  const callId = readOpenAiInputFunctionOutputLookupId(value);
  return callId ? functionCallNamesById.get(callId) ?? "unknown" : "unknown";
}

function normalizeOpenAiInputFunctionNameKind(value: string | null): string {
  if (!value) {
    return "unknown";
  }
  if (value.length > OPENAI_CACHE_DIAGNOSTIC_FUNCTION_NAME_MAX_CHARS) {
    return "other";
  }
  if (
    !OPENAI_CACHE_DIAGNOSTIC_SAFE_FUNCTION_NAME_PATTERN.test(value)
    || OPENAI_CACHE_DIAGNOSTIC_UNSAFE_FUNCTION_NAME_PATTERN.test(value)
  ) {
    return "other";
  }
  return value;
}

function readOpenAiInputFunctionCallLookupId(value: unknown): string | null {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return null;
  }
  return readStringRecordProperty(value, "call_id") ?? readStringRecordProperty(value, "id");
}

function readOpenAiInputFunctionOutputLookupId(value: unknown): string | null {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return null;
  }
  return readStringRecordProperty(value, "call_id");
}

function readOpenAiInputFunctionOutputBytes(value: unknown): number {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return 0;
  }
  return encodeOpenAiDiagnosticJsonValue(value.output)?.byteLength ?? 0;
}

function summarizeOpenAiInputNestedShape(value: unknown): {
  contentBytes: number;
  contentCount: number;
  outputBytes: number;
  outputCount: number;
  stringCount: number;
  stringBytes: number;
  truncated: boolean;
} {
  const summary = {
    contentBytes: 0,
    contentCount: 0,
    outputBytes: 0,
    outputCount: 0,
    stringCount: 0,
    stringBytes: 0,
    truncated: false,
  };

  const stack: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  let visitedNodes = 0;
  while (stack.length > 0) {
    if (visitedNodes >= OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_NODES) {
      summary.truncated = true;
      break;
    }
    visitedNodes += 1;

    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (typeof current.value === "string") {
      summary.stringCount += 1;
      summary.stringBytes += byteLengthOfDiagnosticText(current.value);
      continue;
    }

    if (!current.value || typeof current.value !== "object") {
      continue;
    }

    if (current.depth >= OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_DEPTH) {
      summary.truncated = true;
      continue;
    }

    if (Array.isArray(current.value)) {
      for (const entry of current.value) {
        if (visitedNodes + stack.length >= OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_NODES) {
          summary.truncated = true;
          break;
        }
        stack.push({ depth: current.depth + 1, value: entry });
      }
      continue;
    }

    for (const [key, entry] of Object.entries(current.value)) {
      if (OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_KEYS.has(key)) {
        const entryBytes = encodeOpenAiDiagnosticJsonValue(entry)?.byteLength ?? 0;
        if (key === "content") {
          summary.contentCount += 1;
          summary.contentBytes += entryBytes;
        } else {
          summary.outputCount += 1;
          summary.outputBytes += entryBytes;
        }
      }
      if (visitedNodes + stack.length >= OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_NODES) {
        summary.truncated = true;
        break;
      }
      stack.push({ depth: current.depth + 1, value: entry });
    }
  }

  return summary;
}

function incrementDiagnosticCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function addDiagnosticBytes(bytesByKind: Map<string, number>, key: string, bytes: number): void {
  bytesByKind.set(key, (bytesByKind.get(key) ?? 0) + bytes);
}

function summarizeOpenAiDiagnosticCounts(counts: Map<string, number>): {
  counts: number[];
  kinds: string[];
} {
  const entries = [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (entries.length > OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS) {
    const visible = entries.slice(0, OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS - 1);
    const overflowCount = entries
      .slice(OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS - 1)
      .reduce((total, [, count]) => total + count, 0);
    const otherIndex = visible.findIndex(([kind]) => kind === "other");
    if (otherIndex >= 0) {
      const [kind, count] = visible[otherIndex] ?? ["other", 0];
      visible[otherIndex] = [kind, count + overflowCount];
    } else {
      visible.push(["other", overflowCount]);
    }
    return {
      counts: visible.map(([, count]) => count),
      kinds: visible.map(([kind]) => kind),
    };
  }
  return {
    counts: entries.map(([, count]) => count),
    kinds: entries.map(([kind]) => kind),
  };
}

function summarizeOpenAiDiagnosticCountsAndBytes(
  counts: Map<string, number>,
  bytesByKind: Map<string, number>,
): {
  bytes: number[];
  counts: number[];
  kinds: string[];
} {
  const entries = [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const readBytes = (kind: string) => bytesByKind.get(kind) ?? 0;
  const summaryEntries: Array<[string, number, number]> = entries.map(([kind, count]) => [
    kind,
    count,
    readBytes(kind),
  ]);
  if (entries.length > OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS) {
    const visible = summaryEntries.slice(0, OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS - 1);
    const overflow = summaryEntries.slice(OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS - 1);
    const overflowCount = overflow.reduce((total, [, count]) => total + count, 0);
    const overflowBytes = overflow.reduce((total, [, , bytes]) => total + bytes, 0);
    const otherIndex = visible.findIndex(([kind]) => kind === "other");
    if (otherIndex >= 0) {
      const [kind, count, bytes] = visible[otherIndex] ?? ["other", 0, 0];
      visible[otherIndex] = [kind, count + overflowCount, bytes + overflowBytes];
    } else {
      visible.push(["other", overflowCount, overflowBytes]);
    }
    return {
      bytes: visible.map(([, , bytes]) => bytes),
      counts: visible.map(([, count]) => count),
      kinds: visible.map(([kind]) => kind),
    };
  }
  return {
    bytes: summaryEntries.map(([, , bytes]) => bytes),
    counts: summaryEntries.map(([, count]) => count),
    kinds: summaryEntries.map(([kind]) => kind),
  };
}

function byteLengthOfDiagnosticText(value: string): number {
  return OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(value).byteLength;
}

async function createOpenAiCacheDiagnosticFingerprintKey(
  secret: string | null,
): Promise<CryptoKey | null> {
  const normalized = secret?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  return await crypto.subtle.importKey(
    "raw",
    OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(normalized),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
}

async function hmacDiagnosticFingerprint(input: {
  bytes: Uint8Array;
  fieldPrefix: string;
  fingerprintKey: CryptoKey;
}): Promise<string> {
  const context = OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(
    `${OPENAI_CACHE_DIAGNOSTIC_FINGERPRINT_CONTEXT}\0${input.fieldPrefix}\0`,
  );
  const payload = new Uint8Array(context.byteLength + input.bytes.byteLength);
  payload.set(context);
  payload.set(input.bytes, context.byteLength);
  const digestInput = payload.buffer instanceof ArrayBuffer
    ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
    : copyDiagnosticBytesToArrayBuffer(payload);
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    input.fingerprintKey,
    digestInput,
  ));
  return `hmac-sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function copyDiagnosticBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isHostedOpenAiDiagnosticRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOpenAiCacheDiagnosticFingerprintSecret(
  env: RunnerOutboundEnvironmentSource,
): string | null {
  const value = env.HOSTED_LOG_FINGERPRINT_SECRET;
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function readRuntimeLogHeader(headers: Headers, name: string): string | null {
  const normalized = headers.get(name)?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function readRuntimeLogWriteFenceMetadata(input: {
  headers: Headers;
  userId: string;
}): HostedProviderEgressWriteFenceMetadata | null {
  const attemptId = readRuntimeLogHeader(input.headers, HOSTED_RUNTIME_ATTEMPT_ID_HEADER);
  const leaseGeneration = readRuntimeLogHeader(
    input.headers,
    HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  );
  if (!attemptId || !leaseGeneration) {
    return null;
  }
  return {
    attemptId,
    leaseGeneration,
    userId: input.userId,
    workspaceVersion: readRuntimeLogHeader(
      input.headers,
      HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
    ),
  };
}

async function drainHostedRunnerMetadataResponse(response: Response): Promise<void> {
  if (response.body === null || response.bodyUsed) {
    return;
  }
  await response.arrayBuffer();
}

async function maybeHandleMapboxRequest(input: {
  ctx?: HostedRunnerOutboundContext;
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

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    providerKind: "mapbox",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "mapbox",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const token = readRequiredInterceptSecret(input.env.MAPBOX_ACCESS_TOKEN, "MAPBOX_ACCESS_TOKEN");
  const upstreamUrl = createProviderUpstreamUrl(input.url, pathMatch);
  upstreamUrl.searchParams.set("access_token", token);
  return await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "mapbox",
    request: input.request,
    startedAt,
    upstreamRequest: await createHostedRunnerUpstreamRequest(
      input.request,
      upstreamUrl,
      stripHostedProviderUpstreamHeaders(input.request.headers),
    ),
    url: input.url,
  });
}

async function maybeHandleLinqRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(
    input.env.LINQ_API_BASE_URL,
    DEFAULT_LINQ_API_BASE_URL,
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

  if (!isAllowedLinqRequest(input.request.method, pathMatch.pathnameSuffix)) {
    return disallowedProviderEgress();
  }
  if (!hasBearerCredentialSentinel(input.request.headers)) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    providerKind: "linq",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "linq",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const token = readRequiredInterceptSecret(input.env.LINQ_API_TOKEN, "LINQ_API_TOKEN");
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "linq",
    request: input.request,
    startedAt,
    upstreamRequest: await createHostedRunnerUpstreamRequest(
      input.request,
      createProviderUpstreamUrl(input.url, pathMatch),
      headers,
    ),
    url: input.url,
  });
}

async function maybeHandleTelegramRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const apiProviderBase = readProviderBaseConfig(
    input.env.TELEGRAM_API_BASE_URL,
    DEFAULT_TELEGRAM_API_BASE_URL,
    input.env,
    { acceptFallbackBaseUrl: true },
  );
  const fileProviderBase = readProviderBaseConfig(
    input.env.TELEGRAM_FILE_BASE_URL,
    DEFAULT_TELEGRAM_FILE_BASE_URL,
    input.env,
    { acceptFallbackBaseUrl: true },
  );

  const apiPathMatch = readProviderPathMatch(input.url, apiProviderBase);
  if (apiPathMatch) {
    const operation = readTelegramSentinelOperation(apiPathMatch.pathnameSuffix);
    if (operation) {
      if (!isAllowedTelegramOperation(operation)) {
        return disallowedProviderEgress();
      }
      return await handleTelegramTokenRewrite(input, apiPathMatch, (token) =>
        `/bot${token}/${operation}`
      );
    }
  }

  const filePathMatch = readProviderPathMatch(input.url, fileProviderBase);
  if (filePathMatch) {
    const filePath = readTelegramSentinelFilePath(filePathMatch.pathnameSuffix);
    if (filePath) {
      if (input.request.method !== "GET") {
        return disallowedProviderEgress();
      }
      return await handleTelegramTokenRewrite(input, filePathMatch, (token) =>
        `/bot${token}/${filePath}`
      );
    }
  }

  if (
    isKnownProviderHost(input.url, apiProviderBase)
    || isKnownProviderHost(input.url, fileProviderBase)
  ) {
    return disallowedProviderEgress();
  }

  return null;
}

async function handleTelegramTokenRewrite(
  input: {
    ctx?: HostedRunnerOutboundContext;
    env: RunnerOutboundEnvironmentSource;
    request: Request;
    url: URL;
    userId: string | null;
  },
  pathMatch: ProviderPathMatch,
  createPathnameSuffix: (token: string) => string,
): Promise<Response> {
  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    providerKind: "telegram",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "telegram",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }
  const token = readRequiredInterceptSecret(input.env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN");
  const upstreamUrl = createProviderUpstreamUrl(input.url, pathMatch);
  const prefix = normalizedProviderBasePath(pathMatch.upstreamBaseUrl);
  upstreamUrl.pathname = `${prefix}${createPathnameSuffix(token)}`;
  return await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "telegram",
    request: input.request,
    startedAt,
    upstreamRequest: await createHostedRunnerUpstreamRequest(
      input.request,
      upstreamUrl,
      stripHostedProviderUpstreamHeaders(input.request.headers),
    ),
    url: input.url,
  });
}

async function maybeHandleWhatsAppRequest(input: {
  ctx?: HostedRunnerOutboundContext;
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
  if (!hasBearerCredentialSentinel(input.request.headers)) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    providerKind: "whatsapp",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "whatsapp",
      request: input.request,
      startedAt,
      url: input.url,
    });
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
  return await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "whatsapp",
    request: input.request,
    startedAt,
    upstreamRequest: await createHostedRunnerUpstreamRequest(input.request, upstreamUrl, headers),
    url: input.url,
  });
}

function readHostedRunnerBoundUserId(request: Request): string | null {
  const value = request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER);
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function hostedRuntimeAuthorityHeadersPresent(headers: Headers): boolean {
  return HOSTED_RUNTIME_AUTHORITY_HEADER_NAMES.some((name) => headers.has(name));
}

function isAllowedOpenAiRequest(request: Request, pathname: string): boolean {
  return OPENAI_EGRESS_POLICY.some((policy) =>
    request.method === policy.method
    && pathname === policy.pathname
    && (!("requiresWebSocketUpgrade" in policy) || isWebSocketUpgradeRequest(request.headers))
  );
}

function isWebSocketUpgradeRequest(headers: Headers): boolean {
  const connectionTokens = headers.get("connection")
    ?.split(",")
    .map((token) => token.trim().toLowerCase())
    ?? [];
  return headers.get("upgrade")?.trim().toLowerCase() === "websocket"
    && connectionTokens.includes("upgrade")
    && headers.get("sec-websocket-version")?.trim() === "13"
    && isValidWebSocketKeyHeader(headers.get("sec-websocket-key"));
}

function isValidWebSocketKeyHeader(value: string | null): boolean {
  const normalized = value?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) {
    return false;
  }
  try {
    return atob(normalized).length === 16;
  } catch {
    return false;
  }
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
  if (method === "GET" && /^\/attachments\/[^/]+$/u.test(pathnameSuffix)) {
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

function readTelegramSentinelFilePath(pathname: string): string | null {
  const prefix = `/bot${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const filePath = pathname.slice(prefix.length);
  return filePath.length > 0 ? filePath : null;
}

function isAllowedTelegramOperation(operation: string): boolean {
  return operation === "sendMessage"
    || operation === "sendChatAction"
    || operation === "deleteMessages"
    || operation === "deleteBusinessMessages"
    || operation === "getFile";
}

async function authorizeHostedProviderEgress(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  providerKind: string;
  request: Request;
  userId: string | null;
}): Promise<HostedProviderEgressAuthorization> {
  const startedAt = Date.now();
  const runtimeAuthorityHeadersPresent = hostedRuntimeAuthorityHeadersPresent(
    input.request.headers,
  );
  if (input.userId && runtimeAuthorityHeadersPresent) {
    const writeFence = readRuntimeLogWriteFenceMetadata({
      headers: input.request.headers,
      userId: input.userId,
    });
    try {
      await requireRunnerRuntimeWriteFenceWrite({
        env: input.env,
        request: input.request,
        userId: input.userId,
      });
      return {
        activeContainerIdentitySource: null,
        authorized: true,
        durationMs: Date.now() - startedAt,
        mode: "exact_headers",
        runtimeAuthorityHeadersPresent,
        userId: input.userId,
        writeFence,
      };
    } catch (error) {
      if (error instanceof RunnerRuntimeWriteFenceError) {
        return {
          activeContainerIdentitySource: null,
          authorized: false,
          durationMs: Date.now() - startedAt,
          mode: "exact_headers",
          runtimeAuthorityHeadersPresent,
          userId: input.userId,
          writeFence,
        };
      }
      throw error;
    }
  }

  const runnerContainerName = readHostedRunnerContainerName(input.ctx);
  const containerUserId = readHostedRunnerContainerUserId(input);
  const activeUserId = input.userId ?? containerUserId;
  if (!activeUserId || !runnerContainerName || !containerUserId) {
    return {
      activeContainerIdentitySource: readHostedProviderEgressActiveContainerIdentitySource({
        containerUserId,
        userId: input.userId,
      }),
      authorized: false,
      durationMs: Date.now() - startedAt,
      mode: "missing_identity",
      runtimeAuthorityHeadersPresent,
      userId: activeUserId,
      writeFence: null,
    };
  }
  if (containerUserId !== activeUserId) {
    return {
      activeContainerIdentitySource: readHostedProviderEgressActiveContainerIdentitySource({
        containerUserId,
        userId: input.userId,
      }),
      authorized: false,
      durationMs: Date.now() - startedAt,
      mode: "active_container",
      runtimeAuthorityHeadersPresent,
      userId: activeUserId,
      writeFence: null,
    };
  }

  const runner = input.env.USER_RUNNER.getByName(activeUserId);
  if (typeof runner.validateActiveRuntimeWriteFence !== "function") {
    return {
      activeContainerIdentitySource: readHostedProviderEgressActiveContainerIdentitySource({
        containerUserId,
        userId: input.userId,
      }),
      authorized: false,
      durationMs: Date.now() - startedAt,
      mode: "active_container",
      runtimeAuthorityHeadersPresent,
      userId: activeUserId,
      writeFence: null,
    };
  }

  const validation = normalizeActiveRuntimeWriteFenceValidationResult(
    await runner.validateActiveRuntimeWriteFence({
      runnerContainerName,
      userId: activeUserId,
    }),
  );
  return {
    activeContainerIdentitySource: readHostedProviderEgressActiveContainerIdentitySource({
      containerUserId,
      userId: input.userId,
    }),
    authorized: validation.owns,
    durationMs: Date.now() - startedAt,
    mode: "active_container",
    runtimeAuthorityHeadersPresent,
    userId: activeUserId,
    writeFence: validation.writeFence,
  };
}

function readHostedProviderEgressActiveContainerIdentitySource(input: {
  containerUserId: string | null;
  userId: string | null;
}): HostedProviderEgressActiveContainerIdentitySource | null {
  if (input.userId) {
    return "bound_user_header";
  }
  return input.containerUserId ? "container_name" : null;
}

function readHostedRunnerContainerName(ctx?: HostedRunnerOutboundContext): string | null {
  const containerName = typeof ctx?.containerId === "string"
    ? ctx.containerId.trim()
    : "";
  return containerName.length > 0 ? containerName : null;
}

function readHostedRunnerContainerUserId(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
}): string | null {
  const containerId = readHostedRunnerContainerName(input.ctx);
  if (!containerId) {
    return null;
  }
  const versionSegment = readRunnerContainerWorkerVersionSegment(input.env);
  const versionSuffix = versionSegment ? `--v-${versionSegment}` : null;
  const userId = versionSuffix && containerId.endsWith(versionSuffix)
    ? containerId.slice(0, -versionSuffix.length)
    : containerId;
  const normalized = userId.trim();
  return normalized.length > 0 ? normalized : null;
}

function readRunnerContainerWorkerVersionSegment(source: RunnerOutboundEnvironmentSource): string | null {
  const metadata = source.CF_VERSION_METADATA;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const versionId = (metadata as { id?: unknown }).id;
  return typeof versionId === "string"
    ? sanitizeRunnerContainerNameSegment(versionId)
    : null;
}

function sanitizeRunnerContainerNameSegment(value: string): string | null {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return sanitized.length > 0 ? sanitized : null;
}

function normalizeActiveRuntimeWriteFenceValidationResult(value: unknown): {
  owns: boolean;
  writeFence: HostedProviderEgressWriteFenceMetadata | null;
} {
  if (typeof value === "boolean") {
    return {
      owns: false,
      writeFence: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      owns: false,
      writeFence: null,
    };
  }

  const record = value as Record<string, unknown>;
  if (record.owns !== true) {
    return {
      owns: false,
      writeFence: null,
    };
  }
  if (
    typeof record.attemptId !== "string"
    || typeof record.leaseGeneration !== "string"
    || typeof record.userId !== "string"
    || (
      record.workspaceVersion !== null
      && record.workspaceVersion !== undefined
      && typeof record.workspaceVersion !== "string"
    )
  ) {
    return {
      owns: false,
      writeFence: null,
    };
  }

  return {
    owns: true,
    writeFence: {
      attemptId: record.attemptId,
      leaseGeneration: record.leaseGeneration,
      userId: record.userId,
      workspaceVersion: typeof record.workspaceVersion === "string"
        ? record.workspaceVersion
        : null,
    },
  };
}

function unauthorizedProviderEgress(input: {
  authorization: HostedProviderEgressAuthorization;
  providerKind: string;
  request: Request;
  startedAt: number;
  url: URL;
}): Response {
  const response = new Response("Unauthorized", { status: 401 });
  emitHostedProviderEgressDiagnostic({
    authorization: input.authorization,
    providerKind: input.providerKind,
    request: input.request,
    response,
    startedAt: input.startedAt,
    upstreamDurationMs: null,
    url: input.url,
  });
  return response;
}

async function fetchAuthorizedProviderUpstream(input: {
  authorization: HostedProviderEgressAuthorization;
  providerKind: string;
  request: Request;
  startedAt: number;
  upstreamRequest: Request;
  url: URL;
}): Promise<Response> {
  const upstreamStartedAt = Date.now();
  try {
    const response = await fetch(input.upstreamRequest);
    emitHostedProviderEgressDiagnostic({
      authorization: input.authorization,
      providerKind: input.providerKind,
      request: input.request,
      response,
      startedAt: input.startedAt,
      upstreamDurationMs: Date.now() - upstreamStartedAt,
      url: input.url,
    });
    return response;
  } catch (error) {
    emitHostedProviderEgressDiagnostic({
      authorization: input.authorization,
      error,
      providerKind: input.providerKind,
      request: input.request,
      startedAt: input.startedAt,
      upstreamDurationMs: Date.now() - upstreamStartedAt,
      url: input.url,
    });
    throw error;
  }
}

function emitHostedProviderEgressDiagnostic(input: {
  authorization: HostedProviderEgressAuthorization;
  error?: unknown;
  providerKind: string;
  request: Request;
  response?: Response;
  startedAt: number;
  upstreamDurationMs: number | null;
  url: URL;
}): void {
  const errorCode = input.error ? deriveHostedExecutionErrorCode(input.error) : null;
  const errorName = input.error ? readHostedExecutionSafeErrorName(input.error) : null;
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      host: input.url.hostname,
      method: readHostedRunnerDiagnosticMethod(input.request.method),
      providerKind: input.providerKind,
      providerRequestAuthorized: input.authorization.authorized,
      providerTotalDurationMs: Date.now() - input.startedAt,
      providerUpstreamDurationMs: input.upstreamDurationMs,
      responseOk: input.response?.ok ?? null,
      responseStatus: input.response?.status ?? null,
      activeContainerIdentitySource: input.authorization.activeContainerIdentitySource,
      activeContainerSameUserOffTurnCaveat:
        input.authorization.mode === "active_container" && input.authorization.authorized,
      runtimeAuthorityHeadersPresent: input.authorization.runtimeAuthorityHeadersPresent,
      userIdPresent: input.authorization.userId !== null,
      writeFenceMetadataPresent: input.authorization.writeFence !== null,
      writeFenceValidationDurationMs: input.authorization.durationMs,
      writeFenceValidationMode: input.authorization.mode,
      ...(errorCode ? { errorCode } : {}),
      ...(errorName ? { errorName } : {}),
    },
    level: input.authorization.authorized && !input.error ? "info" : "warn",
    message: "Hosted runner provider egress completed.",
    phase: "wake.running",
  });
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
  const fallbackRoutes = createIdentityProviderBaseRoutes(withContainerHostAlias(fallbackUrl, env));
  const fallbackHosts = fallbackRoutes.map((route) => route.acceptedBaseUrl.hostname);
  const rawValue = typeof value === "string" && value.trim() ? value.trim() : null;
  if (!rawValue) {
    return {
      knownHosts: fallbackHosts,
      routes: fallbackRoutes,
    };
  }

  try {
    const url = new URL(rawValue);
    if (isAllowedProviderBaseUrl(url)) {
      const routes = uniqueProviderBaseRoutes(
        ...createIdentityProviderBaseRoutes(withContainerHostAlias(url, env)),
        ...(options.acceptFallbackBaseUrl
          ? createProviderBaseRoutes(url, fallbackRoutes.map((route) => route.acceptedBaseUrl))
          : []),
      );
      return {
        knownHosts: uniqueProviderHosts(
          ...routes.map((route) => route.acceptedBaseUrl.hostname),
          fallbackUrl.hostname,
        ),
        routes,
      };
    }
    return {
      knownHosts: uniqueProviderHosts(url.hostname, fallbackUrl.hostname),
      routes: fallbackRoutes,
    };
  } catch {
    return {
      knownHosts: fallbackHosts,
      routes: fallbackRoutes,
    };
  }
}

function createProviderBaseRoutes(upstreamBaseUrl: URL, acceptedBaseUrls: readonly URL[]): ProviderBaseRoute[] {
  return acceptedBaseUrls.map((acceptedBaseUrl) => ({
    acceptedBaseUrl,
    upstreamBaseUrl,
  }));
}

function createIdentityProviderBaseRoutes(acceptedBaseUrls: readonly URL[]): ProviderBaseRoute[] {
  return acceptedBaseUrls.map((acceptedBaseUrl) => ({
    acceptedBaseUrl,
    upstreamBaseUrl: acceptedBaseUrl,
  }));
}

function uniqueProviderBaseRoutes(...routes: ProviderBaseRoute[]): ProviderBaseRoute[] {
  const seen = new Set<string>();
  const unique: ProviderBaseRoute[] = [];

  for (const route of routes) {
    const key = route.acceptedBaseUrl.origin + normalizedProviderBasePath(route.acceptedBaseUrl);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(route);
  }

  return unique;
}

function readProviderPathMatch(url: URL, providerBase: ProviderBaseConfig): ProviderPathMatch | null {
  for (const route of providerBase.routes) {
    const acceptedBaseUrl = route.acceptedBaseUrl;
    if (url.origin !== acceptedBaseUrl.origin) {
      continue;
    }
    const prefix = normalizedProviderBasePath(acceptedBaseUrl);
    if (!url.pathname.startsWith(prefix)) {
      continue;
    }
    return {
      pathnameSuffix: url.pathname.slice(prefix.length),
      upstreamBaseUrl: route.upstreamBaseUrl,
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
