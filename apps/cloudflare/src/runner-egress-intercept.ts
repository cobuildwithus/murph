import { Buffer } from "node:buffer";

import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  sanitizeHostedExecutionStructuredLogDetails,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_LOG_PATH,
} from "@murphai/hosted-execution/routes";
import {
  buildHostedTranscriptionUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";

import { readHostedExecutionEnvironment } from "./env.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import {
  recordHostedRuntimeUsageRecord,
} from "./runtime-platform/usage-record-port.ts";

import {
  CLOUDFLARE_HOSTED_CONTAINER_FATAL_PATH,
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
  CLOUDFLARE_HOSTED_TRANSCRIBE_HOST,
  CLOUDFLARE_HOSTED_TRANSCRIBE_PATH,
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
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_PROVIDER_EGRESS_TOKEN_HEADER,
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
import {
  readDeployLiveModelTurnSmokeOpenAiModel,
} from "./deploy-smoke-live-model.ts";

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
const HOSTED_DATA_API_RUNTIME_BASE_URL = "http://murph-data-api.worker";
const HOSTED_DATA_API_ALLOWED_PATHS = new Set([
  "/api/foods",
  "/api/supplements",
]);
const HOSTED_DATA_API_RUNTIME_HOST =
  new URL(HOSTED_DATA_API_RUNTIME_BASE_URL).hostname;
const HOSTED_DATA_API_MAX_POST_BODY_BYTES = 32 * 1024;
// 16 kHz mono PCM WAV is ~1.9 MiB/min, so this covers ~8 minutes of the
// local-whisper WAV normalization path. Remote-only parser sanitization and
// passthrough use compressed audio and may cover much longer, while this byte
// cap keeps body + base64 + inference payload inside the Worker isolate memory
// limit. Keep in sync with the parsers remote-transcription provider input cap.
const HOSTED_TRANSCRIBE_MAX_BODY_BYTES = 16 * 1024 * 1024;
const HOSTED_TRANSCRIBE_WORKERS_AI_MODEL = "@cf/openai/whisper-large-v3-turbo";
const HOSTED_TRANSCRIBE_MAX_SEGMENTS = 10_000;
export const HOSTED_DEPLOY_SMOKE_OPENAI_REQUEST_MAX_BODY_BYTES = 256 * 1024;

export const HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS = {
  artifactStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore,
  browserVaultReplicaStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore,
  dataApi: HOSTED_DATA_API_RUNTIME_HOST,
  effectsPort: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort,
  linq: "api.linqapp.com",
  mapbox: "api.mapbox.com",
  openAi: "api.openai.com",
  runnerControl: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl,
  telegram: "api.telegram.org",
  transcribe: CLOUDFLARE_HOSTED_TRANSCRIBE_HOST,
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
    method: "POST",
    pathname: "/v1/images/generations",
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
  "gpt-5.5",
  "o3",
  "o3-mini",
  "o4-mini",
]);
export const HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE =
  "runner.provider_egress_diagnostic";
const HOSTED_OPENAI_CACHE_DIAGNOSTIC_VERSION = 1;
const OPENAI_CACHE_DIAGNOSTIC_CODEX_TURN_METADATA_HEADER = "x-codex-turn-metadata";
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
const OPENAI_CACHE_DIAGNOSTIC_CODEX_REQUEST_KINDS = new Set([
  "compaction",
  "memory",
  "prewarm",
  "turn",
]);
const OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_TRIGGER_KINDS = new Set([
  "auto",
  "manual",
]);
const OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_REASON_KINDS = new Set([
  "context_limit",
  "model_downshift",
  "user_requested",
]);
const OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_IMPLEMENTATION_KINDS = new Set([
  "responses",
  "responses_compact",
  "responses_compaction_v2",
]);
const OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_PHASE_KINDS = new Set([
  "mid_turn",
  "pre_turn",
  "standalone_turn",
]);

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
  | "active_user_fence"
  | "deploy_smoke_live_model_turn"
  | "exact_headers"
  | "missing_identity"
  | "provider_egress_token";
type HostedProviderEgressActiveContainerIdentitySource =
  | "bound_user_header"
  | "container_name";
const HOSTED_ACTIVE_WRITE_FENCE_REJECT_REASONS = [
  "missing_runner_state",
  "missing_write_fence",
  "write_fence_mismatch",
] as const;
const HOSTED_PROVIDER_EGRESS_TOKEN_REJECT_REASONS = [
  "missing_provider_egress_token",
  "missing_runner_state",
  "missing_write_fence",
  "provider_egress_token_mismatch",
  "write_fence_mismatch",
] as const;
type HostedActiveWriteFenceRejectReason =
  typeof HOSTED_ACTIVE_WRITE_FENCE_REJECT_REASONS[number];
type HostedProviderEgressTokenRejectReason =
  typeof HOSTED_PROVIDER_EGRESS_TOKEN_REJECT_REASONS[number];
type HostedProviderEgressRejectReason =
  | HostedActiveWriteFenceRejectReason
  | HostedProviderEgressTokenRejectReason
  | "active_user_context_missing"
  | "active_user_context_mismatch"
  | "active_user_context_read_error"
  | "active_user_context_rpc_missing"
  | "active_validation_rpc_missing"
  | "active_write_fence_rejected"
  | "active_write_fence_validation_error"
  | "bound_user_missing"
  | "exact_write_fence_rejected"
  | "provider_egress_token_missing"
  | "provider_egress_token_rejected"
  | "provider_egress_token_validation_error"
  | "validation_rpc_missing";

interface HostedProviderEgressAuthorization {
  activeContainerIdentitySource: HostedProviderEgressActiveContainerIdentitySource | null;
  authorized: boolean;
  durationMs: number;
  mode: HostedProviderEgressValidationMode;
  providerEgressTokenPresent: boolean;
  rejectReason?: HostedProviderEgressRejectReason;
  runtimeAuthorityHeadersPresent: boolean;
  userId: string | null;
  validationErrorCode?: string;
  validationErrorName?: string;
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
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.dataApi]: handleHostedRunnerOpenInternetOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.effectsPort]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.linq]: handleHostedRunnerLinqOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.mapbox]: handleHostedRunnerMapboxOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.openAi]: handleHostedRunnerOpenAiOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.runnerControl]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.telegram]: handleHostedRunnerTelegramOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe]: handleHostedRunnerOpenInternetOutbound,
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
    await maybeHandleHostedDataApiRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleHostedTranscribeRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleOpenAiRequest({ ctx, env, request, url, userId })
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
  // Container fatal reports are accepted before the user-binding gate: the
  // unattributable container deaths this sink exists for happen outside any
  // invocation, when no bound user or write fence exists.
  const containerFatalResponse = await maybeHandleHostedContainerFatalReport({
    ctx,
    request,
    url,
    userId,
  });
  if (containerFatalResponse) {
    await emitHostedRunnerInternalOutboundResponseCompleted({
      diagnosticDetails,
      response: containerFatalResponse,
      startedAt,
    });
    return containerFatalResponse;
  }
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

async function maybeHandleHostedDataApiRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  if (normalizeProviderHostname(input.url.hostname) !== HOSTED_DATA_API_RUNTIME_HOST) {
    return null;
  }
  if (!HOSTED_DATA_API_ALLOWED_PATHS.has(input.url.pathname)) {
    return disallowedProviderEgress();
  }
  if (!["GET", "POST"].includes(input.request.method.toUpperCase())) {
    return disallowedProviderEgress();
  }
  const upstreamBaseUrl = readHostedDataApiUpstreamBaseUrl(input.env);
  if (!upstreamBaseUrl) {
    return new Response("Hosted data API upstream is not configured.", { status: 500 });
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    allowActiveUserFenceWithoutToken: true,
    providerKind: "murph_data_api",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "murph_data_api",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const upstreamBody = input.request.method.toUpperCase() === "POST"
    ? await readBoundedRequestBody(input.request, HOSTED_DATA_API_MAX_POST_BODY_BYTES)
    : undefined;
  if (upstreamBody === null) {
    return new Response("Payload Too Large", { status: 413 });
  }

  const token = readRequiredInterceptSecret(input.env.MURPH_DATA_API_KEY, "MURPH_DATA_API_KEY");
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("authorization", `Bearer ${token}`);

  return await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "murph_data_api",
    request: input.request,
    startedAt,
    upstreamRequest: await createHostedRunnerUpstreamRequest(
      input.request,
      createHostedDataApiUpstreamUrl(input.url, upstreamBaseUrl),
      headers,
      {
        body: upstreamBody,
        redirect: "manual",
      },
    ),
    url: input.url,
  });
}

const HOSTED_CONTAINER_FATAL_REPORT_ROUTE_MAX_BODY_BYTES = 8 * 1024;
// Per-isolate fixed window: a real death produces a handful of reports, while
// arbitrary in-container code could otherwise mint unlimited error-level log
// lines through this unauthenticated sink and drown the attribution signal.
const HOSTED_CONTAINER_FATAL_REPORT_LOG_WINDOW_MS = 60_000;
const HOSTED_CONTAINER_FATAL_REPORT_LOG_WINDOW_LIMIT = 5;
let hostedContainerFatalReportLogWindowStartedAtMs = 0;
let hostedContainerFatalReportLogWindowCount = 0;

function admitHostedContainerFatalReportLog(nowMs: number): "admitted" | "suppressed" | "suppressed_quietly" {
  if (
    nowMs - hostedContainerFatalReportLogWindowStartedAtMs
      >= HOSTED_CONTAINER_FATAL_REPORT_LOG_WINDOW_MS
  ) {
    hostedContainerFatalReportLogWindowStartedAtMs = nowMs;
    hostedContainerFatalReportLogWindowCount = 0;
  }
  hostedContainerFatalReportLogWindowCount += 1;
  if (hostedContainerFatalReportLogWindowCount <= HOSTED_CONTAINER_FATAL_REPORT_LOG_WINDOW_LIMIT) {
    return "admitted";
  }
  // One suppression marker per window, then silence until the window rolls.
  return hostedContainerFatalReportLogWindowCount
      === HOSTED_CONTAINER_FATAL_REPORT_LOG_WINDOW_LIMIT + 1
    ? "suppressed"
    : "suppressed_quietly";
}

// Durable sink for dying-container fatal reports (container-fatal-report.ts).
// Deliberately reachable without a bound user or live write fence: the
// container deaths this attributes happen outside any invocation, when no
// fence or user binding exists (trust boundary documented in
// agent-docs/SECURITY.md). The only effect is one sanitized, size-capped,
// rate-limited worker log line, and the host is reachable only from inside
// hosted containers through this egress intercept. Never forwarded to the
// DO — the DO may be the component that is wedged.
async function maybeHandleHostedContainerFatalReport(input: {
  ctx: HostedRunnerOutboundContext;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  if (
    input.url.hostname !== CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl
    || input.url.pathname !== CLOUDFLARE_HOSTED_CONTAINER_FATAL_PATH
  ) {
    return null;
  }
  if (input.request.method.toUpperCase() !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const body = await readBoundedRequestBody(
    input.request,
    HOSTED_CONTAINER_FATAL_REPORT_ROUTE_MAX_BODY_BYTES,
  );
  if (body === null) {
    return new Response("Payload Too Large", { status: 413 });
  }

  const admission = admitHostedContainerFatalReportLog(Date.now());
  if (admission !== "admitted") {
    if (admission === "suppressed") {
      emitHostedExecutionStructuredLog({
        component: "container",
        level: "warn",
        message: "Hosted container fatal report log suppressed by rate limit.",
        phase: "failed",
        userId: input.userId,
      });
    }
    // Sink semantics stay identical for the dying container either way.
    return new Response(null, { status: 204 });
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    parsed = null;
  }
  const record: Record<string, unknown> =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const safeErrorDetails = sanitizeHostedExecutionStructuredLogDetails(
    record.safeErrorDetails && typeof record.safeErrorDetails === "object"
        && !Array.isArray(record.safeErrorDetails)
      ? (record.safeErrorDetails as HostedExecutionStructuredLogDetails)
      : null,
  );
  emitHostedExecutionStructuredLog({
    component: "container",
    details: {
      containerIdPresent: typeof input.ctx.containerId === "string"
        && input.ctx.containerId.length > 0,
      detailsTruncated: record.detailsTruncated === true,
      errorCode: readHostedContainerFatalReportCode(record.errorCode),
      errorName: readHostedContainerFatalReportCode(record.errorName),
      reportBodyBytes: body.byteLength,
      stage: readHostedContainerFatalReportCode(record.stage),
      ...(safeErrorDetails ? { safeErrorDetails } : {}),
    },
    level: "error",
    message: "Hosted container fatal report received.",
    phase: "failed",
    userId: input.userId,
  });
  return new Response(null, { status: 204 });
}

function readHostedContainerFatalReportCode(value: unknown): string {
  if (typeof value !== "string") {
    return "unclassified";
  }
  const normalized = value.trim();
  return normalized.length > 0
      && normalized.length <= 96
      && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)
    ? normalized
    : "unclassified";
}

async function maybeHandleHostedTranscribeRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  if (normalizeProviderHostname(input.url.hostname) !== CLOUDFLARE_HOSTED_TRANSCRIBE_HOST) {
    return null;
  }
  if (input.url.pathname !== CLOUDFLARE_HOSTED_TRANSCRIBE_PATH) {
    return disallowedProviderEgress();
  }
  if (input.request.method.toUpperCase() !== "POST") {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    allowActiveUserFenceWithoutToken: true,
    providerKind: "workers_ai_transcribe",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "workers_ai_transcribe",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const ai = input.env.AI;
  if (!ai || typeof ai.run !== "function") {
    return new Response("Hosted transcription Workers AI binding is not configured.", {
      status: 500,
    });
  }

  const audio = await readBoundedRequestBody(input.request, HOSTED_TRANSCRIBE_MAX_BODY_BYTES);
  if (audio === null) {
    return new Response("Payload Too Large", { status: 413 });
  }
  if (audio.byteLength === 0) {
    return new Response("Hosted transcription request body must include audio bytes.", {
      status: 400,
    });
  }

  const upstreamStartedAt = Date.now();
  let output: unknown;
  try {
    output = await ai.run(HOSTED_TRANSCRIBE_WORKERS_AI_MODEL, {
      audio: Buffer.from(audio).toString("base64"),
    });
  } catch (error) {
    emitHostedProviderEgressDiagnostic({
      authorization,
      audioBytes: audio.byteLength,
      error,
      providerKind: "workers_ai_transcribe",
      request: input.request,
      startedAt,
      upstreamDurationMs: Date.now() - upstreamStartedAt,
      url: input.url,
    });
    return new Response("Hosted transcription failed.", { status: 502 });
  }

  // Workers AI bills the audio minutes for every completed run, so meter
  // before transcript validation: empty or malformed transcripts still cost
  // money, and a 502 below must not drop the usage row.
  const usageRecording = recordHostedTranscribeUsage({
    audioBytes: audio.byteLength,
    durationMs: readHostedTranscribeOutputDurationMs(output),
    env: input.env,
    memberId: authorization.userId,
  });

  let response: Response;
  try {
    const responsePayload = readHostedTranscribeResponsePayload(output);
    response = Response.json(responsePayload);
    emitHostedProviderEgressDiagnostic({
      authorization,
      audioBytes: audio.byteLength,
      providerKind: "workers_ai_transcribe",
      request: input.request,
      response,
      startedAt,
      transcriptDurationMs: responsePayload.durationMs,
      upstreamDurationMs: Date.now() - upstreamStartedAt,
      url: input.url,
    });
  } catch (error) {
    emitHostedProviderEgressDiagnostic({
      authorization,
      audioBytes: audio.byteLength,
      error,
      providerKind: "workers_ai_transcribe",
      request: input.request,
      startedAt,
      upstreamDurationMs: Date.now() - upstreamStartedAt,
      url: input.url,
    });
    // 422, not 5xx: the run completed and was billed/metered, and the same
    // audio would fail the same way again, so the parser's 5xx retry must not
    // re-run it. Only thrown ai.run calls above return a retryable 502.
    response = new Response("Hosted transcription returned no usable transcript.", {
      status: 422,
    });
  }

  // Production containers proxy through a ctx without waitUntil, where a
  // floating promise may be canceled with the invocation; await the
  // failure-isolated recording there (same shape as the OpenAI cache
  // diagnostic above).
  if (typeof input.ctx?.waitUntil === "function") {
    input.ctx.waitUntil(usageRecording);
  } else {
    await usageRecording;
  }
  return response;
}

// Failure-isolated hosted_ai_usage recording for the Workers AI transcription
// spend. The returned promise never rejects and must never fail the transcript
// response; failures only emit a structured warn log.
function recordHostedTranscribeUsage(input: {
  audioBytes: number;
  durationMs: number | null;
  env: RunnerOutboundEnvironmentSource;
  memberId: string | null;
}): Promise<void> {
  return (async () => {
    if (!input.memberId) {
      throw new TypeError("Hosted transcription usage recording requires a member id.");
    }
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.env));
    const record = buildHostedTranscriptionUsageRecord({
      audioBytes: input.audioBytes,
      durationMs: input.durationMs,
      memberId: input.memberId,
      model: HOSTED_TRANSCRIBE_WORKERS_AI_MODEL,
    });
    await recordHostedRuntimeUsageRecord({
      boundUserId: input.memberId,
      fetchImpl: fetch,
      record,
      timeoutMs: environment.webControlTimeoutMs,
      transport: {
        callbackSigning: environment.webCallbackSigning,
        mode: "direct",
        webControlBaseUrl: environment.hostedWebBaseUrl,
        workspaceCheckpointBridge: null,
      },
    });
  })().catch((error: unknown) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...buildHostedExecutionSafeErrorDetails(error),
        providerKind: "workers_ai_transcribe",
      },
      level: "warn",
      message: "Hosted transcription usage recording failed; transcript delivery unaffected.",
      phase: "wake.running",
    });
  });
}

interface HostedTranscribeResponsePayload {
  durationMs: number | null;
  language: string | null;
  segments: Array<{
    endMs: number | null;
    startMs: number | null;
    text: string;
  }>;
  text: string;
}

function readHostedTranscribeResponsePayload(
  output: unknown,
): HostedTranscribeResponsePayload {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new TypeError("Workers AI transcription output must be an object.");
  }

  const record = output as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) {
    throw new TypeError("Workers AI transcription output did not include transcript text.");
  }

  const transcriptionInfo = readHostedTranscribeTranscriptionInfo(output);
  const language = typeof transcriptionInfo?.language === "string"
      && transcriptionInfo.language.trim().length > 0
    ? transcriptionInfo.language.trim()
    : null;
  const segments = Array.isArray(record.segments)
    ? record.segments
      .slice(0, HOSTED_TRANSCRIBE_MAX_SEGMENTS)
      .flatMap((segment) => {
        if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
          return [];
        }
        const segmentRecord = segment as Record<string, unknown>;
        const segmentText = typeof segmentRecord.text === "string"
          ? segmentRecord.text.trim()
          : "";
        if (!segmentText) {
          return [];
        }
        const startSeconds = readHostedTranscribeNonNegativeNumber(segmentRecord.start);
        const endSeconds = readHostedTranscribeNonNegativeNumber(segmentRecord.end);
        return [{
          endMs: endSeconds === null ? null : Math.round(endSeconds * 1_000),
          startMs: startSeconds === null ? null : Math.round(startSeconds * 1_000),
          text: segmentText,
        }];
      })
    : [];

  return {
    durationMs: readHostedTranscribeOutputDurationMs(output),
    language,
    segments,
    text,
  };
}

// Reads the billed audio duration from any Workers AI transcription output,
// independent of transcript validation and response truncation: usage metering
// needs it even when the transcript comes back empty or malformed. When
// transcription_info is absent the furthest segment end still bounds the
// billed time, mirroring the parsers-side fallback.
function readHostedTranscribeOutputDurationMs(output: unknown): number | null {
  const durationSeconds = readHostedTranscribeNonNegativeNumber(
    readHostedTranscribeTranscriptionInfo(output)?.duration,
  ) ?? readHostedTranscribeMaxSegmentEndSeconds(output);
  return durationSeconds === null ? null : Math.round(durationSeconds * 1_000);
}

function readHostedTranscribeMaxSegmentEndSeconds(output: unknown): number | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const segments = (output as Record<string, unknown>).segments;
  if (!Array.isArray(segments)) {
    return null;
  }

  let maxEndSeconds: number | null = null;
  for (const segment of segments) {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      continue;
    }
    const endSeconds = readHostedTranscribeNonNegativeNumber(
      (segment as Record<string, unknown>).end,
    );
    if (endSeconds !== null && (maxEndSeconds === null || endSeconds > maxEndSeconds)) {
      maxEndSeconds = endSeconds;
    }
  }
  return maxEndSeconds;
}

function readHostedTranscribeTranscriptionInfo(
  output: unknown,
): Record<string, unknown> | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const transcriptionInfo = (output as Record<string, unknown>).transcription_info;
  return transcriptionInfo && typeof transcriptionInfo === "object"
      && !Array.isArray(transcriptionInfo)
    ? transcriptionInfo as Record<string, unknown>
    : null;
}

function readHostedTranscribeNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
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
    openAiPathnameSuffix: pathnameSuffix,
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

async function readDeploySmokeLiveModelTurnOpenAiModel(input: {
  pathnameSuffix: string;
  request: Request;
}): Promise<string | null> {
  if (input.request.method !== "POST" || input.pathnameSuffix !== "/v1/responses") {
    return null;
  }
  const body = await readBoundedRequestBody(
    input.request.clone(),
    HOSTED_DEPLOY_SMOKE_OPENAI_REQUEST_MAX_BODY_BYTES,
  );
  if (body === null || body.byteLength === 0) {
    return null;
  }

  return readDeployLiveModelTurnSmokeOpenAiModel(
    OPENAI_CACHE_DIAGNOSTIC_TEXT_DECODER.decode(body),
  );
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
      turnMetadataHeader: input.request.headers.get(
        OPENAI_CACHE_DIAGNOSTIC_CODEX_TURN_METADATA_HEADER,
      ),
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
  turnMetadataHeader?: string | null;
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
  appendCodexTurnMetadataDiagnostics({
    diagnostic,
    turnMetadataHeader: input.turnMetadataHeader ?? null,
  });

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

function appendCodexTurnMetadataDiagnostics(input: {
  diagnostic: HostedRunnerDiagnosticJson;
  turnMetadataHeader: string | null;
}): void {
  const header = input.turnMetadataHeader?.trim();
  if (!header) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    input.diagnostic.codexTurnMetadataStatus = "invalid";
    return;
  }
  if (!isHostedOpenAiDiagnosticRecord(parsed)) {
    input.diagnostic.codexTurnMetadataStatus = "invalid";
    return;
  }

  input.diagnostic.codexTurnMetadataStatus = "valid";
  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_REQUEST_KINDS,
    field: "codexRequestKind",
    output: input.diagnostic,
    value: parsed.request_kind,
  });

  const compaction = parsed.compaction;
  if (!isHostedOpenAiDiagnosticRecord(compaction)) {
    return;
  }

  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_TRIGGER_KINDS,
    field: "codexCompactionTriggerKind",
    output: input.diagnostic,
    value: compaction.trigger,
  });
  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_REASON_KINDS,
    field: "codexCompactionReasonKind",
    output: input.diagnostic,
    value: compaction.reason,
  });
  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_IMPLEMENTATION_KINDS,
    field: "codexCompactionImplementationKind",
    output: input.diagnostic,
    value: compaction.implementation,
  });
  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_PHASE_KINDS,
    field: "codexCompactionPhaseKind",
    output: input.diagnostic,
    value: compaction.phase,
  });
}

function appendAllowedStringDiagnosticKind(input: {
  allowed: ReadonlySet<string>;
  field: string;
  output: HostedRunnerDiagnosticJson;
  value: unknown;
}): void {
  const normalized = typeof input.value === "string" ? input.value.trim() : "";
  if (!normalized) {
    return;
  }
  input.output[input.field] = input.allowed.has(normalized) ? normalized : "other";
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
  allowActiveUserFenceWithoutToken?: boolean;
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  openAiPathnameSuffix?: string;
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
        providerEgressTokenPresent: false,
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
          providerEgressTokenPresent: false,
          rejectReason: "exact_write_fence_rejected",
          runtimeAuthorityHeadersPresent,
          userId: input.userId,
          writeFence,
        };
      }
      throw error;
    }
  }

  const providerEgressToken = readHostedProviderEgressToken(input.request);
  if (input.userId && providerEgressToken) {
    return await authorizeHostedProviderEgressToken({
      activeUserId: input.userId,
      env: input.env,
      providerEgressToken,
      providerEgressTokenPresent: true,
      runtimeAuthorityHeadersPresent,
      startedAt,
    });
  }

  if (input.providerKind !== "openai" && input.allowActiveUserFenceWithoutToken !== true) {
    if (!input.userId) {
      return {
        activeContainerIdentitySource: null,
        authorized: false,
        durationMs: Date.now() - startedAt,
        mode: "missing_identity",
        providerEgressTokenPresent: providerEgressToken !== null,
        rejectReason: "bound_user_missing",
        runtimeAuthorityHeadersPresent,
        userId: null,
        writeFence: null,
      };
    }

    return {
      activeContainerIdentitySource: null,
      authorized: false,
      durationMs: Date.now() - startedAt,
      mode: "provider_egress_token",
      providerEgressTokenPresent: false,
      rejectReason: "provider_egress_token_missing",
      runtimeAuthorityHeadersPresent,
      userId: input.userId,
      writeFence: null,
    };
  }

  const activeUserFence = await authorizeHostedProviderEgressActiveUserFence({
    ctx: input.ctx,
    env: input.env,
    providerEgressTokenPresent: providerEgressToken !== null,
    runtimeAuthorityHeadersPresent,
    startedAt,
    userId: input.userId,
  });
  if (activeUserFence.authorized || input.providerKind !== "openai") {
    return activeUserFence;
  }

  // Deploy-smoke live model turn: the post-deploy managed-container smoke
  // runs one real codex turn from the dedicated deploy-smoke container,
  // which has no active user runtime. Authorize that egress only when the
  // originating container id belongs to the deploy-smoke namespace AND that
  // Durable Object reports an in-flight live-turn fence, so the window is
  // both identity- and time-scoped. Production turns authorize above and
  // never reach this leg.
  const deploySmokeLiveModelTurnModel = await readDeploySmokeLiveModelTurnOpenAiModel({
    pathnameSuffix: input.openAiPathnameSuffix ?? "",
    request: input.request,
  });
  const deploySmokeLiveModelTurn = await authorizeHostedProviderEgressDeploySmokeLiveModelTurn({
    ctx: input.ctx,
    deploySmokeLiveModelTurnModel,
    env: input.env,
    providerEgressTokenPresent: providerEgressToken !== null,
    runtimeAuthorityHeadersPresent,
    startedAt,
  });
  return deploySmokeLiveModelTurn ?? activeUserFence;
}

async function authorizeHostedProviderEgressDeploySmokeLiveModelTurn(input: {
  ctx?: HostedRunnerOutboundContext;
  deploySmokeLiveModelTurnModel: string | null;
  env: RunnerOutboundEnvironmentSource;
  providerEgressTokenPresent: boolean;
  runtimeAuthorityHeadersPresent: boolean;
  startedAt: number;
}): Promise<HostedProviderEgressAuthorization | null> {
  if (!input.deploySmokeLiveModelTurnModel) {
    return null;
  }
  const containerId = input.ctx?.containerId?.trim();
  const namespace = readHostedRunnerDeploySmokeContainerNamespace(input.env);
  if (
    !containerId
    || !namespace
    || typeof namespace.idFromString !== "function"
    || typeof namespace.get !== "function"
  ) {
    return null;
  }

  try {
    const id = namespace.idFromString(containerId);
    const container = namespace.get(id);
    if (typeof container.readDeploySmokeLiveModelTurnFence !== "function") {
      return null;
    }
    const fence = await container.readDeploySmokeLiveModelTurnFence();
    if (
      !isHostedDeploySmokeLiveModelTurnFenceResult(fence)
      || !fence.active
      || fence.model !== input.deploySmokeLiveModelTurnModel
    ) {
      return null;
    }
    return {
      activeContainerIdentitySource: null,
      authorized: true,
      durationMs: Date.now() - input.startedAt,
      mode: "deploy_smoke_live_model_turn",
      providerEgressTokenPresent: input.providerEgressTokenPresent,
      runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
      userId: null,
      writeFence: null,
    };
  } catch {
    // Container ids from other namespaces fail idFromString here; fall back
    // to the primary rejection instead of authorizing.
    return null;
  }
}

function readHostedRunnerDeploySmokeContainerNamespace(
  env: RunnerOutboundEnvironmentSource,
): RunnerOutboundEnvironmentSource["RUNNER_CONTAINER_SMOKE"] | null {
  const namespace = env.RUNNER_CONTAINER_SMOKE;
  if (!namespace || typeof namespace !== "object") {
    return null;
  }
  return namespace;
}

function isHostedDeploySmokeLiveModelTurnFenceResult(value: unknown): value is {
  active: boolean;
  model?: string;
} {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { active?: unknown }).active === "boolean"
    && (
      (value as { model?: unknown }).model === undefined
      || typeof (value as { model?: unknown }).model === "string"
    ),
  );
}

function readHostedProviderEgressToken(request: Request): string | null {
  const token = request.headers.get(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)?.trim();
  return token ? token : null;
}

async function authorizeHostedProviderEgressToken(input: {
  activeUserId: string;
  env: RunnerOutboundEnvironmentSource;
  providerEgressToken: string;
  providerEgressTokenPresent: boolean;
  runtimeAuthorityHeadersPresent: boolean;
  startedAt: number;
}): Promise<HostedProviderEgressAuthorization> {
  const runner = input.env.USER_RUNNER.getByName(input.activeUserId);
  if (typeof runner.validateRuntimeProviderEgressToken !== "function") {
    return {
      activeContainerIdentitySource: null,
      authorized: false,
      durationMs: Date.now() - input.startedAt,
      mode: "provider_egress_token",
      providerEgressTokenPresent: input.providerEgressTokenPresent,
      rejectReason: "validation_rpc_missing",
      runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
      userId: input.activeUserId,
      writeFence: null,
    };
  }

  let rawValidation: unknown;
  try {
    rawValidation = await runner.validateRuntimeProviderEgressToken({
      providerEgressToken: input.providerEgressToken,
      userId: input.activeUserId,
    });
  } catch (error) {
    const validationErrorName = readHostedExecutionSafeErrorName(error);
    return {
      activeContainerIdentitySource: null,
      authorized: false,
      durationMs: Date.now() - input.startedAt,
      mode: "provider_egress_token",
      providerEgressTokenPresent: input.providerEgressTokenPresent,
      rejectReason: "provider_egress_token_validation_error",
      runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
      userId: input.activeUserId,
      validationErrorCode: deriveHostedExecutionErrorCode(error),
      ...(validationErrorName ? { validationErrorName } : {}),
      writeFence: null,
    };
  }

  const validation = normalizeProviderEgressTokenValidationResult(rawValidation);
  return {
    activeContainerIdentitySource: null,
    authorized: validation.owns,
    durationMs: Date.now() - input.startedAt,
    mode: "provider_egress_token",
    providerEgressTokenPresent: input.providerEgressTokenPresent,
    ...(validation.rejectReason ? { rejectReason: validation.rejectReason } : {}),
    runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
    userId: input.activeUserId,
    writeFence: validation.writeFence,
  };
}

async function authorizeHostedProviderEgressActiveUserFence(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  providerEgressTokenPresent: boolean;
  runtimeAuthorityHeadersPresent: boolean;
  startedAt: number;
  userId: string | null;
}): Promise<HostedProviderEgressAuthorization> {
  const activeUser = await readHostedProviderEgressActiveUserFromCurrentContainer({
    ctx: input.ctx,
    env: input.env,
  });
  if (!activeUser.ok) {
    return {
      activeContainerIdentitySource: null,
      authorized: false,
      durationMs: Date.now() - input.startedAt,
      mode: "missing_identity",
      providerEgressTokenPresent: input.providerEgressTokenPresent,
      rejectReason: activeUser.rejectReason,
      runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
      userId: null,
      ...(activeUser.validationErrorCode
        ? { validationErrorCode: activeUser.validationErrorCode }
        : {}),
      ...(activeUser.validationErrorName
        ? { validationErrorName: activeUser.validationErrorName }
        : {}),
      writeFence: null,
    };
  }

  const activeUserId = activeUser.userId;
  if (input.userId && input.userId !== activeUserId) {
    return {
      activeContainerIdentitySource: null,
      authorized: false,
      durationMs: Date.now() - input.startedAt,
      mode: "active_user_fence",
      providerEgressTokenPresent: input.providerEgressTokenPresent,
      rejectReason: "active_user_context_mismatch",
      runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
      userId: activeUserId,
      writeFence: null,
    };
  }

  const runner = input.env.USER_RUNNER.getByName(activeUserId);
  if (typeof runner.validateActiveRuntimeWriteFence !== "function") {
    return {
      activeContainerIdentitySource: null,
      authorized: false,
      durationMs: Date.now() - input.startedAt,
      mode: "active_user_fence",
      providerEgressTokenPresent: input.providerEgressTokenPresent,
      rejectReason: "active_validation_rpc_missing",
      runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
      userId: activeUserId,
      writeFence: null,
    };
  }

  let rawValidation: unknown;
  try {
    rawValidation = await runner.validateActiveRuntimeWriteFence({
      userId: activeUserId,
    });
  } catch (error) {
    const validationErrorName = readHostedExecutionSafeErrorName(error);
    return {
      activeContainerIdentitySource: null,
      authorized: false,
      durationMs: Date.now() - input.startedAt,
      mode: "active_user_fence",
      providerEgressTokenPresent: input.providerEgressTokenPresent,
      rejectReason: "active_write_fence_validation_error",
      runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
      userId: activeUserId,
      validationErrorCode: deriveHostedExecutionErrorCode(error),
      ...(validationErrorName ? { validationErrorName } : {}),
      writeFence: null,
    };
  }

  const validation = normalizeActiveRuntimeWriteFenceValidationResult(rawValidation);
  return {
    activeContainerIdentitySource: null,
    authorized: validation.owns,
    durationMs: Date.now() - input.startedAt,
    mode: "active_user_fence",
    providerEgressTokenPresent: input.providerEgressTokenPresent,
    ...(validation.rejectReason ? { rejectReason: validation.rejectReason } : {}),
    runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
    userId: activeUserId,
    writeFence: validation.writeFence,
  };
}

async function readHostedProviderEgressActiveUserFromCurrentContainer(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
}): Promise<
  | {
      ok: false;
      rejectReason: Extract<
        HostedProviderEgressRejectReason,
        | "active_user_context_missing"
        | "active_user_context_read_error"
        | "active_user_context_rpc_missing"
      >;
      validationErrorCode?: string;
      validationErrorName?: string;
    }
  | {
      ok: true;
      userId: string;
    }
> {
  const containerId = input.ctx?.containerId?.trim();
  const runnerContainerNamespace = readHostedRunnerContainerNamespace(input.env);
  if (
    !containerId
    || !runnerContainerNamespace
    || typeof runnerContainerNamespace.idFromString !== "function"
    || typeof runnerContainerNamespace.get !== "function"
  ) {
    return { ok: false, rejectReason: "active_user_context_missing" };
  }

  try {
    const id = runnerContainerNamespace.idFromString(containerId);
    const container = runnerContainerNamespace.get(id);
    if (typeof container.readActiveRuntimeUserFence !== "function") {
      return { ok: false, rejectReason: "active_user_context_rpc_missing" };
    }
    const result = await container.readActiveRuntimeUserFence();
    if (isHostedActiveRuntimeUserFenceResult(result) && result.active) {
      return { ok: true, userId: result.userId };
    }
    return { ok: false, rejectReason: "active_user_context_missing" };
  } catch (error) {
    const validationErrorName = readHostedExecutionSafeErrorName(error);
    return {
      ok: false,
      rejectReason: "active_user_context_read_error",
      validationErrorCode: deriveHostedExecutionErrorCode(error),
      ...(validationErrorName ? { validationErrorName } : {}),
    };
  }
}

function readHostedRunnerContainerNamespace(
  env: RunnerOutboundEnvironmentSource,
): {
  get?(id: unknown): {
    readActiveRuntimeUserFence?: () => Promise<unknown>;
  };
  idFromString?(id: string): unknown;
} | null {
  const namespace = (env as { RUNNER_CONTAINER?: unknown }).RUNNER_CONTAINER;
  if (!namespace || typeof namespace !== "object") {
    return null;
  }
  return namespace as {
    get?(id: unknown): {
      readActiveRuntimeUserFence?: () => Promise<unknown>;
    };
    idFromString?(id: string): unknown;
  };
}

function isHostedActiveRuntimeUserFenceResult(value: unknown): value is {
  active: true;
  userId: string;
} | {
  active: false;
  reason?: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.active === true) {
    return typeof record.userId === "string" && record.userId.length > 0;
  }
  return record.active === false;
}

function normalizeActiveRuntimeWriteFenceValidationResult(value: unknown): {
  owns: boolean;
  rejectReason: HostedProviderEgressRejectReason | null;
  writeFence: HostedProviderEgressWriteFenceMetadata | null;
} {
  if (typeof value === "boolean") {
    return {
      owns: false,
      rejectReason: "active_write_fence_rejected",
      writeFence: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      owns: false,
      rejectReason: "active_write_fence_rejected",
      writeFence: null,
    };
  }

  const record = value as Record<string, unknown>;
  if (record.owns !== true) {
    return {
      owns: false,
      rejectReason: readActiveRuntimeWriteFenceRejectReason(record.reason)
        ?? "active_write_fence_rejected",
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
      rejectReason: "active_write_fence_rejected",
      writeFence: null,
    };
  }

  return {
    owns: true,
    rejectReason: null,
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

function normalizeProviderEgressTokenValidationResult(value: unknown): {
  owns: boolean;
  rejectReason: HostedProviderEgressRejectReason | null;
  writeFence: HostedProviderEgressWriteFenceMetadata | null;
} {
  if (typeof value === "boolean") {
    return {
      owns: false,
      rejectReason: "provider_egress_token_rejected",
      writeFence: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      owns: false,
      rejectReason: "provider_egress_token_rejected",
      writeFence: null,
    };
  }

  const record = value as Record<string, unknown>;
  if (record.owns !== true) {
    return {
      owns: false,
      rejectReason: readProviderEgressTokenRejectReason(record.reason)
        ?? "provider_egress_token_rejected",
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
      rejectReason: "provider_egress_token_rejected",
      writeFence: null,
    };
  }

  return {
    owns: true,
    rejectReason: null,
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

function readActiveRuntimeWriteFenceRejectReason(
  value: unknown,
): HostedActiveWriteFenceRejectReason | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const reason of HOSTED_ACTIVE_WRITE_FENCE_REJECT_REASONS) {
    if (value === reason) {
      return reason;
    }
  }
  return null;
}

function readProviderEgressTokenRejectReason(
  value: unknown,
): HostedProviderEgressTokenRejectReason | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const reason of HOSTED_PROVIDER_EGRESS_TOKEN_REJECT_REASONS) {
    if (value === reason) {
      return reason;
    }
  }
  return null;
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
  audioBytes?: number;
  error?: unknown;
  providerKind: string;
  request: Request;
  response?: Response;
  startedAt: number;
  transcriptDurationMs?: number | null;
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
      providerEgressTokenPresent: input.authorization.providerEgressTokenPresent,
      runtimeAuthorityHeadersPresent: input.authorization.runtimeAuthorityHeadersPresent,
      userIdPresent: input.authorization.userId !== null,
      writeFenceMetadataPresent: input.authorization.writeFence !== null,
      writeFenceValidationDurationMs: input.authorization.durationMs,
      writeFenceValidationMode: input.authorization.mode,
      ...(input.audioBytes === undefined ? {} : { audioBytes: input.audioBytes }),
      ...(errorCode ? { errorCode } : {}),
      ...(errorName ? { errorName } : {}),
      ...(input.transcriptDurationMs === undefined
        ? {}
        : { transcriptDurationMs: input.transcriptDurationMs }),
      ...(input.authorization.rejectReason
        ? { writeFenceValidationRejectReason: input.authorization.rejectReason }
        : {}),
      ...(input.authorization.validationErrorCode
        ? { writeFenceValidationErrorCode: input.authorization.validationErrorCode }
        : {}),
      ...(input.authorization.validationErrorName
        ? { writeFenceValidationErrorName: input.authorization.validationErrorName }
        : {}),
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
  stripped.delete(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER);
  stripped.delete(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER);
  return stripped;
}

function stripHostedProviderUpstreamHeaders(headers: Headers): Headers {
  const stripped = stripHostedRuntimeAuthorityHeaders(headers);
  stripped.delete("authorization");
  stripped.delete("cookie");
  stripped.delete("proxy-authorization");
  stripped.delete("x-api-key");
  stripped.delete("x-murph-api-key");
  stripped.delete("x-murph-data-api-key");
  stripped.delete("openai-organization");
  stripped.delete("openai-project");
  return stripped;
}

function createHostedRunnerInternalRequest(source: Request): Request {
  const headers = new Headers(source.headers);
  headers.delete(HOSTED_RUNNER_BOUND_USER_ID_HEADER);
  headers.delete(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER);
  headers.delete(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER);
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
  options: {
    body?: BodyInit | null;
    redirect?: RequestRedirect;
  } = {},
): Promise<Request> {
  return new Request(url, {
    body: source.method === "GET" || source.method === "HEAD"
      ? null
      : options.body ?? await source.arrayBuffer(),
    headers,
    method: source.method,
    redirect: options.redirect ?? source.redirect,
    signal: source.signal,
  });
}

async function readBoundedRequestBody(
  request: Pick<Request, "body" | "headers">,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return null;
    }
  }

  if (!request.body) {
    return new ArrayBuffer(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body.buffer;
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

function readHostedDataApiUpstreamBaseUrl(
  env: RunnerOutboundEnvironmentSource,
): URL | null {
  const rawValue = typeof env.HOSTED_WEB_BASE_URL === "string"
    ? env.HOSTED_WEB_BASE_URL.trim()
    : "";
  if (!rawValue) {
    return null;
  }

  try {
    const url = new URL(rawValue);
    if (!isAllowedProviderBaseUrl(url, env)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function createHostedDataApiUpstreamUrl(sourceUrl: URL, upstreamBaseUrl: URL): URL {
  const upstreamUrl = new URL(upstreamBaseUrl.toString());
  upstreamUrl.pathname = `${normalizedProviderBasePath(upstreamBaseUrl)}${sourceUrl.pathname}`;
  upstreamUrl.search = sourceUrl.search;
  upstreamUrl.hash = sourceUrl.hash;
  return upstreamUrl;
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
    if (isAllowedProviderBaseUrl(url, env)) {
      const configuredUpstreamBaseUrl =
        createHostedLocalProviderAliasUpstreamUrl(url, env) ?? url;
      const routes = uniqueProviderBaseRoutes(
        ...createConfiguredProviderBaseRoutes(url, env),
        ...(options.acceptFallbackBaseUrl
          ? createProviderBaseRoutes(
              configuredUpstreamBaseUrl,
              fallbackRoutes.map((route) => route.acceptedBaseUrl),
            )
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

function createConfiguredProviderBaseRoutes(
  configuredBaseUrl: URL,
  env: RunnerOutboundEnvironmentSource,
): ProviderBaseRoute[] {
  const configuredUpstreamBaseUrl =
    createHostedLocalProviderAliasUpstreamUrl(configuredBaseUrl, env);
  return withContainerHostAlias(configuredBaseUrl, env).map((acceptedBaseUrl) => ({
    acceptedBaseUrl,
    upstreamBaseUrl:
      configuredUpstreamBaseUrl && isSameProviderBaseUrl(acceptedBaseUrl, configuredBaseUrl)
        ? configuredUpstreamBaseUrl
        : acceptedBaseUrl,
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

function isSameProviderBaseUrl(left: URL, right: URL): boolean {
  return left.origin === right.origin
    && normalizedProviderBasePath(left) === normalizedProviderBasePath(right);
}

function isKnownProviderHost(url: URL, providerBase: ProviderBaseConfig): boolean {
  return providerBase.knownHosts.includes(normalizeProviderHostname(url.hostname));
}

function isAllowedProviderBaseUrl(url: URL, env: RunnerOutboundEnvironmentSource): boolean {
  return url.protocol === "https:"
    || (
      url.protocol === "http:"
      && (
        isLocalOrTestProviderHost(url.hostname)
        || isExplicitHostedLocalRunnerHostAlias(url.hostname, env)
      )
    );
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

function createHostedLocalProviderAliasUpstreamUrl(
  baseUrl: URL,
  env: RunnerOutboundEnvironmentSource,
): URL | null {
  const alias = readLocalProviderHostAlias(env);
  if (
    !alias
    || isLocalOrTestProviderHost(alias)
    || !isContainerAliasableProviderHost(baseUrl.hostname)
  ) {
    return null;
  }

  const aliasUrl = new URL(baseUrl.toString());
  aliasUrl.hostname = alias;
  return aliasUrl.origin === baseUrl.origin ? null : aliasUrl;
}

function readLocalProviderHostAlias(env: RunnerOutboundEnvironmentSource): string | null {
  const alias = typeof env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS === "string"
    ? env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS.trim()
    : "";
  if (
    !alias
    || (
      !isLocalOrTestProviderHost(alias)
      && !isExplicitHostedLocalRunnerHostAlias(alias, env)
    )
  ) {
    return null;
  }
  return alias;
}

function isContainerAliasableProviderHost(hostname: string): boolean {
  const normalized = normalizeProviderHostname(hostname);
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]"
    || normalized === "host.docker.internal"
    || normalized.endsWith(".localhost");
}

function isExplicitHostedLocalRunnerHostAlias(
  hostname: string,
  env: RunnerOutboundEnvironmentSource,
): boolean {
  const alias = typeof env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS === "string"
    ? env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS.trim()
    : "";
  return alias.length > 0
    && isHostedLocalRunnerHostAliasSource(env)
    && normalizeProviderHostname(hostname) === normalizeProviderHostname(alias);
}

function isHostedLocalRunnerHostAliasSource(env: RunnerOutboundEnvironmentSource): boolean {
  const profile = normalizeHostedLocalRunnerHostAliasMarker(env.MURPH_HOSTED_LOCAL_PROFILE);
  return env.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED === "1"
    || profile === "dev"
    || profile === "worker-only"
    || profile === "e2e:stub"
    || profile === "e2e:live";
}

function normalizeHostedLocalRunnerHostAliasMarker(value: string | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

function uniqueProviderHosts(...hosts: string[]): string[] {
  return [...new Set(hosts.map(normalizeProviderHostname))];
}

function normalizeProviderHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, "");
}
