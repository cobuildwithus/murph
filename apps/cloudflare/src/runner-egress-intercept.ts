import { Buffer } from "node:buffer";

import {
  buildExaResearchScoutBatchLaneRequest,
  buildExaResearchScoutRequest,
  clampExaResearchScoutPublishedWindow,
  EXA_RESEARCH_SCOUT_METHOD,
  EXA_RESEARCH_SCOUT_PATH,
  parseExaResearchScoutRequestBody,
  type ExaResearchScoutRequestBody,
  type ExaResearchScoutParsedRequest,
} from "@murphai/contracts";
import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  sanitizeHostedExecutionStructuredLogDetails,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  buildHostedCodexMemoryUsageRecord,
  buildHostedElevenLabsMusicUsageRecord,
  buildHostedElevenLabsTtsUsageRecord,
  buildHostedGeminiVideoAnalysisUsageRecord,
  buildHostedTranscriptionUsageRecord,
  buildHostedXaiSearchUsageRecord,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  resolveHostedAiUsageTokenPricingBasis,
  type HostedRuntimeUsageRecordResponse,
} from "@murphai/hosted-execution/runtime-control";

import { readHostedExecutionEnvironment } from "./env.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import {
  recordHostedRuntimeUsageRecord,
} from "./runtime-platform/usage-record-port.ts";

import {
  CLOUDFLARE_HOSTED_CONTAINER_FATAL_PATH,
  CLOUDFLARE_HOSTED_CUSTOM_INFERENCE_HOST,
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
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
} from "./runner-outbound/shared-web-control-policy.ts";
import {
  applyRunnerRuntimeUsageSettlement,
  requireRunnerRuntimeWriteFence,
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
  readAllowedHostedLinqOperation,
  type HostedLinqProviderOperation,
} from "./runner-egress-linq-policy.ts";
import {
  isHostedProviderEgressCredential,
  verifyHostedProviderEgressCredential,
} from "./hosted-provider-egress-credential.ts";
import {
  readHostedProviderCredentialDiagnosticKind,
} from "./hosted-provider-credential-diagnostics.ts";
import {
  openHostedInferenceRuntimeTarget,
} from "./hosted-inference-target-envelope.ts";
import {
  HOSTED_CUSTOM_INFERENCE_RESPONSES_MAX_BODY_BYTES,
  HostedCustomInferenceRequestError,
  adaptHostedCustomInferenceUpstreamResponse,
  buildHostedCustomInferenceUpstreamRequestBody,
  injectHostedCustomInferenceAuth,
} from "./runner-egress-custom-inference.ts";
import {
  HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES,
  hasHostedCodexMemoryBillableUsage,
  parseHostedCodexMemoryTerminalResponse,
  parseHostedCodexMemoryRequestMetadata,
  readHostedCodexNativeMemoryKind,
  type HostedCodexMemoryProviderRequestOutcome,
  type HostedCodexMemoryRequestMetadata,
  type HostedCodexMemoryUsage,
  type HostedCodexNativeMemoryKind,
} from "./runner-egress-codex-memory.ts";
import {
  relayHostedOpenAiResponsesWebSocketUpgrade,
  type HostedCodexMemoryWebSocketCompletion,
  type HostedOpenAiWebSocketFailurePhase,
} from "./runner-egress-openai-responses-websocket.ts";
import { readHostedOpenAiImageRequest } from "./runner-egress-openai-image-request.ts";
import {
  DEFAULT_ELEVENLABS_API_BASE_URL,
  HOSTED_ELEVENLABS_MAX_BODY_BYTES,
  isAllowedElevenLabsRequest,
  parseHostedElevenLabsRequestBody,
} from "./runner-egress-elevenlabs.ts";
import {
  DEFAULT_XAI_API_BASE_URL,
  HOSTED_XAI_MAX_BODY_BYTES,
  HOSTED_XAI_MAX_RESPONSE_BODY_BYTES,
  parseHostedXaiRequestBody,
  readHostedXaiResponseMetadata,
} from "./runner-egress-xai.ts";
import { fetchHostedWebControlPlaneJson } from "./runtime-platform/web-control-transport.ts";
import {
  DEFAULT_GEMINI_API_BASE_URL,
  HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_BODY_BYTES,
  HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_RESPONSE_BODY_BYTES,
  parseHostedGeminiVideoAnalysisRequestBody,
  readHostedGeminiVideoAnalysisRequestModel,
  readHostedGeminiVideoAnalysisUsageMetadata,
} from "./runner-egress-gemini.ts";
import {
  DEFAULT_VENICE_API_BASE_URL,
  HOSTED_VENICE_RESPONSES_MAX_BODY_BYTES,
  buildHostedVeniceResponsesRequestBody,
  isAllowedHostedVeniceRequest,
} from "./runner-egress-venice.ts";
import {
  buildHostedOpenAiCacheDiagnostic,
  readHostedResponsesRequestModelKind,
  readVeniceDiagnosticModelKind,
  type HostedOpenAiCacheDiagnosticEndpointKind,
  type HostedResponsesDiagnosticProviderKind,
  type HostedRunnerDiagnosticJson,
} from "./runner-egress-responses-diagnostics.ts";
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
const OPENAI_AUTHORIZATION_ALERT_SINGLETON_NAME = "production";
const OPENAI_AUTHORIZATION_ALERT_REPORT_FAILURE_CODE =
  "openai_authorization_alert_report_failed";
const OPENAI_AUTHORIZATION_ALERT_REPORT_FAILURE_MESSAGE =
  "OpenAI authorization alert report failed.";
const DEFAULT_EXA_API_BASE_URL = "https://api.exa.ai";
const DEFAULT_MAPBOX_API_BASE_URL = "https://api.mapbox.com";
const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const DEFAULT_TELEGRAM_FILE_BASE_URL = "https://api.telegram.org/file";
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
// Worker-side ceiling for POST /v1/images/edits multipart uploads. Sized just
// above the 32 MiB assistant-engine aggregate reference budget so a well-formed
// call stays under the cap; the slack absorbs multipart boundaries, headers,
// and per-part metadata without letting a rogue caller pin the Worker on an
// unbounded body buffer at the egress boundary.
const HOSTED_OPENAI_IMAGES_EDITS_MAX_BODY_BYTES = 36 * 1024 * 1024;
export const HOSTED_DEPLOY_SMOKE_OPENAI_REQUEST_MAX_BODY_BYTES = 256 * 1024;

export const HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS = {
  artifactStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore,
  browserVaultReplicaStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore,
  customInference: CLOUDFLARE_HOSTED_CUSTOM_INFERENCE_HOST,
  dataApi: HOSTED_DATA_API_RUNTIME_HOST,
  effectsPort: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort,
  elevenLabs: "api.elevenlabs.io",
  exa: "api.exa.ai",
  gemini: "generativelanguage.googleapis.com",
  linq: "api.linqapp.com",
  mapbox: "api.mapbox.com",
  mediaStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.mediaStore,
  openAi: "api.openai.com",
  runnerControl: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl,
  telegram: "api.telegram.org",
  transcribe: CLOUDFLARE_HOSTED_TRANSCRIBE_HOST,
  venice: "api.venice.ai",
  webControlPlane: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
  workspaceSnapshotStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.workspaceSnapshotStore,
  xai: "api.x.ai",
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
    pathname: "/v1/alpha/search",
  },
  {
    method: "POST",
    pathname: "/v1/images/generations",
  },
  {
    method: "POST",
    pathname: "/v1/images/edits",
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
export const HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE =
  "runner.provider_egress_diagnostic";
const OPENAI_CACHE_DIAGNOSTIC_CODEX_TURN_METADATA_HEADER = "x-codex-turn-metadata";
const PROVIDER_REQUEST_TEXT_DECODER = new TextDecoder();

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

const EXA_EGRESS_POLICY = [
  {
    method: EXA_RESEARCH_SCOUT_METHOD,
    pathname: EXA_RESEARCH_SCOUT_PATH,
  },
] as const;
const HOSTED_EXA_RESEARCH_SCOUT_MAX_BODY_BYTES = 32 * 1024;

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
  | "deploy_smoke_live_model_turn"
  | "exact_headers"
  | "missing_identity"
  | "provider_egress_credential"
  | "provider_egress_token";
const HOSTED_PROVIDER_EGRESS_TOKEN_REJECT_REASONS = [
  "missing_provider_egress_token",
  "missing_runner_state",
  "missing_write_fence",
  "provider_egress_token_mismatch",
  "write_fence_mismatch",
] as const;
const HOSTED_PROVIDER_EGRESS_CREDENTIAL_REJECT_REASONS = [
  "missing_runner_state",
  "missing_write_fence",
  "provider_egress_not_allowed",
  "runner_container_mismatch",
  "write_fence_mismatch",
] as const;
type HostedProviderEgressTokenRejectReason =
  typeof HOSTED_PROVIDER_EGRESS_TOKEN_REJECT_REASONS[number];
type HostedProviderEgressCredentialRejectReason =
  typeof HOSTED_PROVIDER_EGRESS_CREDENTIAL_REJECT_REASONS[number];
type HostedProviderEgressRejectReason =
  | HostedProviderEgressCredentialRejectReason
  | HostedProviderEgressTokenRejectReason
  | "bound_user_missing"
  | "exact_write_fence_rejected"
  | "provider_egress_credential_invalid"
  | "provider_egress_credential_provider_mismatch"
  | "provider_egress_credential_rejected"
  | "provider_egress_credential_signature_mismatch"
  | "provider_egress_credential_validation_error"
  | "provider_egress_token_missing"
  | "provider_egress_token_rejected"
  | "provider_egress_token_validation_error"
  | "validation_rpc_missing";

interface HostedProviderEgressAuthorization {
  authorized: boolean;
  customInferenceEnvelope?: string | null;
  durationMs: number;
  mode: HostedProviderEgressValidationMode;
  providerEgressTokenPresent: boolean;
  platformAiUsageAllowed?: boolean;
  rejectReason?: HostedProviderEgressRejectReason;
  runtimeAuthorityHeadersPresent: boolean;
  userId: string | null;
  validationError?: unknown;
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

const HOSTED_PLATFORM_METERED_PROVIDER_KINDS = new Set([
  "elevenlabs",
  "gemini",
  "exa",
  "mapbox",
  "openai",
  "venice",
  "xai",
]);

export const HOSTED_RUNNER_OUTBOUND_BY_HOST: Record<string, HostedRunnerOutboundHandler> = {
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.artifactStore]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.browserVaultReplicaStore]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.customInference]:
    handleHostedRunnerCustomInferenceOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.dataApi]: handleHostedRunnerOpenInternetOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.effectsPort]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.elevenLabs]: handleHostedRunnerElevenLabsOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.exa]: handleHostedRunnerExaOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.gemini]: handleHostedRunnerGeminiOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.linq]: handleHostedRunnerLinqOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.mapbox]: handleHostedRunnerMapboxOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.mediaStore]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.openAi]: handleHostedRunnerOpenAiOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.runnerControl]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.telegram]: handleHostedRunnerTelegramOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe]: handleHostedRunnerOpenInternetOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.venice]: handleHostedRunnerVeniceOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.webControlPlane]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.workspaceSnapshotStore]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.xai]: handleHostedRunnerXaiOutbound,
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
    ?? await maybeHandleCustomInferenceRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleHostedTranscribeRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleElevenLabsRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleXaiRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleGeminiRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleOpenAiRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleVeniceRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleExaRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleMapboxRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleLinqRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleTelegramRequest({ ctx, env, request, url, userId });

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

export async function handleHostedRunnerCustomInferenceOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleCustomInferenceRequest({
      ctx,
      env,
      request,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerOpenAiOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
  upstreamFetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleOpenAiRequest({
      ctx: _ctx,
      env,
      request,
      upstreamFetchImpl,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerVeniceOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleVeniceRequest({
      ctx,
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

export async function handleHostedRunnerExaOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleExaRequest({
      ctx: _ctx,
      env,
      request,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerGeminiOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: HostedRunnerOutboundContext,
  upstreamFetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleGeminiRequest({
      ctx,
      env,
      request,
      upstreamFetchImpl,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerElevenLabsOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleElevenLabsRequest({
      ctx: _ctx,
      env,
      request,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerXaiOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  _ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleXaiRequest({
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
  const bearerCredential = readBearerCredential(input.request.headers);
  if (!bearerCredential) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeNativeHostedProviderCredential({
    credential: bearerCredential,
    env: input.env,
    providerKind: "murph_data_api",
    request: input.request,
  });
  if (!authorization) {
    return disallowedProviderEgress();
  }
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
  const providerCredential = readBearerCredential(input.request.headers);
  if (!providerCredential) {
    return disallowedProviderEgress();
  }
  const authorization = await authorizeNativeHostedProviderCredential({
    credential: providerCredential,
    env: input.env,
    providerKind: "workers_ai_transcribe",
    request: input.request,
  });
  if (!authorization) {
    return disallowedProviderEgress();
  }
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "workers_ai_transcribe",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }
  if (authorization.platformAiUsageAllowed === false) {
    return platformAiUsageDenied();
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
    authorization,
    durationMs: readHostedTranscribeOutputDurationMs(output),
    env: input.env,
    occurredAt: new Date(upstreamStartedAt).toISOString(),
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
  authorization: HostedProviderEgressAuthorization;
  durationMs: number | null;
  env: RunnerOutboundEnvironmentSource;
  occurredAt: string;
}): Promise<void> {
  return (async () => {
    const writeFence = requireHostedDirectUsageWriteFence(input.authorization);
    const record = buildHostedTranscriptionUsageRecord({
      audioBytes: input.audioBytes,
      durationMs: input.durationMs,
      memberId: writeFence.userId,
      model: HOSTED_TRANSCRIBE_WORKERS_AI_MODEL,
      occurredAt: input.occurredAt,
    });
    await recordHostedDirectRuntimeUsage({
      env: input.env,
      record,
      writeFence,
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

async function recordHostedDirectRuntimeUsage(input: {
  env: RunnerOutboundEnvironmentSource;
  record: AssistantUsageRecord;
  writeFence: HostedProviderEgressWriteFenceMetadata;
}): Promise<HostedRuntimeUsageRecordResponse> {
  let settlement: HostedRuntimeUsageRecordResponse | null = null;
  try {
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.env));
    settlement = await recordHostedRuntimeUsageRecord({
      boundUserId: input.writeFence.userId,
      fetchImpl: fetch,
      record: input.record,
      timeoutMs: environment.webControlTimeoutMs,
      transport: {
        callbackSigning: environment.webCallbackSigning,
        mode: "direct",
        webControlBaseUrl: environment.hostedWebBaseUrl,
        workspaceCheckpointBridge: null,
      },
    });
    return settlement;
  } finally {
    await applyRunnerRuntimeUsageSettlement({
      env: input.env,
      settlement,
      userId: input.writeFence.userId,
      writeAuthority: {
        attemptId: input.writeFence.attemptId,
        generation: input.writeFence.leaseGeneration,
        workspaceVersion: input.writeFence.workspaceVersion,
      },
    });
  }
}

function requireHostedDirectUsageWriteFence(
  authorization: HostedProviderEgressAuthorization,
): HostedProviderEgressWriteFenceMetadata {
  const writeFence = authorization.writeFence;
  if (
    !authorization.authorized
    || !authorization.userId
    || !writeFence
    || writeFence.userId !== authorization.userId
  ) {
    throw new TypeError("Hosted direct usage recording requires exact runtime authority.");
  }
  return writeFence;
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

async function maybeHandleCustomInferenceRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  upstreamFetchImpl?: typeof fetch;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  if (input.url.hostname !== CLOUDFLARE_HOSTED_CUSTOM_INFERENCE_HOST) {
    return null;
  }
  if (
    input.request.method !== "POST"
    || input.url.pathname !== "/v1/responses"
    || !hasBearerCredentialSentinel(input.request.headers)
  ) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ctx: input.ctx,
    env: input.env,
    providerKind: "custom_inference",
    request: input.request,
    userId: input.userId,
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "custom_inference",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }
  if (!authorization.customInferenceEnvelope) {
    return new Response("Custom inference is not active for this invocation.", {
      status: 409,
    });
  }

  let target;
  try {
    target = await openHostedInferenceRuntimeTarget({
      envelope: authorization.customInferenceEnvelope,
      source: input.env,
    });
  } catch {
    return new Response("Hosted custom inference configuration is unavailable.", {
      status: 500,
    });
  }
  const body = await readBoundedRequestBody(
    input.request,
    HOSTED_CUSTOM_INFERENCE_RESPONSES_MAX_BODY_BYTES,
  );
  if (body === null) {
    return new Response("Payload Too Large", { status: 413 });
  }

  let upstreamBody: string;
  try {
    upstreamBody = buildHostedCustomInferenceUpstreamRequestBody({
      body,
      target,
    });
  } catch (error) {
    if (error instanceof HostedCustomInferenceRequestError) {
      return new Response(error.message, { status: error.httpStatus });
    }
    return new Response("The custom inference request was invalid.", {
      status: 400,
    });
  }

  // The upstream endpoint is member-controlled, so the header set is built
  // from scratch rather than stripped from the inbound request: only the
  // JSON/SSE transport headers plus the one configured auth header may cross
  // this boundary.
  const headers = new Headers({
    accept: "text/event-stream",
    "content-type": "application/json",
  });
  injectHostedCustomInferenceAuth(headers, target);
  try {
    return await adaptHostedCustomInferenceUpstreamResponse({
      protocol: target.protocol,
      response: await fetchAuthorizedProviderUpstream({
        authorization,
        providerKind: "custom_inference",
        request: input.request,
        startedAt,
        upstreamRequest: await createHostedRunnerUpstreamRequest(
          input.request,
          new URL(target.endpointUrl),
          headers,
          {
            body: upstreamBody,
            redirect: "manual",
          },
        ),
        upstreamFetchImpl: input.upstreamFetchImpl,
        url: input.url,
      }),
      revision: target.revision,
    });
  } catch (error) {
    if (error instanceof HostedCustomInferenceRequestError) {
      return new Response(error.message, { status: error.httpStatus });
    }
    throw error;
  }
}

function reportOpenAiAuthorizationFailureSafely(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  status: 401 | 403;
}): Promise<void> | undefined {
  let failureLogged = false;
  const logFailure = (): void => {
    if (failureLogged) {
      return;
    }
    failureLogged = true;
    console.warn(OPENAI_AUTHORIZATION_ALERT_REPORT_FAILURE_MESSAGE, {
      failureCode: OPENAI_AUTHORIZATION_ALERT_REPORT_FAILURE_CODE,
    });
  };

  try {
    const namespace = input.env.OPENAI_AUTHORIZATION_ALERT_MONITOR;
    if (!namespace) {
      logFailure();
      return;
    }
    const reportPromise = namespace
      .getByName(OPENAI_AUTHORIZATION_ALERT_SINGLETON_NAME)
      .reportFailure({
        observedAtMs: Date.now(),
        status: input.status,
      })
      .then(() => undefined)
      .catch(() => {
        logFailure();
      });
    if (typeof input.ctx?.waitUntil === "function") {
      try {
        input.ctx.waitUntil(reportPromise);
        return;
      } catch {
        logFailure();
      }
    }
    return reportPromise;
  } catch {
    logFailure();
    return;
  }
}

async function readHostedOpenAiRequestBody(input: {
  nativeMemory: boolean;
  pathnameSuffix: string;
  request: Request;
}): Promise<Response | {
  boundedBody: ArrayBuffer | undefined;
  imageGenerationRequested: boolean;
  memoryRequestMetadata: HostedCodexMemoryRequestMetadata | null;
}> {
  let boundedBody: ArrayBuffer | undefined;
  let imageGenerationRequested = false;
  let memoryRequestMetadata: HostedCodexMemoryRequestMetadata | null = null;
  if (
    input.request.method === "POST"
    && input.pathnameSuffix === "/v1/responses"
  ) {
    const body = await readBoundedRequestBody(
      input.request,
      HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES,
    );
    if (body === null) {
      return new Response("Payload Too Large", { status: 413 });
    }
    const imageRequest = readHostedOpenAiImageRequest(body);
    if (imageRequest === "invalid") {
      return new Response("Invalid Responses request.", { status: 400 });
    }
    imageGenerationRequested = imageRequest === "image";
    if (input.nativeMemory) {
      memoryRequestMetadata = parseHostedCodexMemoryRequestMetadata(body);
      if (!memoryRequestMetadata) {
        return new Response("Invalid Codex memory request.", { status: 400 });
      }
    }
    boundedBody = body;
  } else if (
    input.request.method === "POST"
    && input.pathnameSuffix === "/v1/images/edits"
  ) {
    const body = await readBoundedRequestBody(
      input.request,
      HOSTED_OPENAI_IMAGES_EDITS_MAX_BODY_BYTES,
    );
    if (body === null) {
      return new Response("Payload Too Large", { status: 413 });
    }
    boundedBody = body;
  }

  return { boundedBody, imageGenerationRequested, memoryRequestMetadata };
}

async function maybeHandleOpenAiRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  upstreamFetchImpl?: typeof fetch;
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
  const bearerCredential = readBearerCredential(input.request.headers);
  if (!bearerCredential) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedOpenAiProviderEgress({
    ...input,
    bearerCredential,
    openAiPathnameSuffix: pathnameSuffix,
  });
  if (!authorization) {
    return disallowedProviderEgress();
  }
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "openai",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const nativeMemoryKind = authorization.platformAiUsageAllowed !== false
    ? readHostedCodexNativeMemoryKind(input.request.headers)
    : null;
  const token = readRequiredInterceptSecret(input.env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("authorization", "Bearer " + token);
  const bodyRead = await readHostedOpenAiRequestBody({
    nativeMemory: nativeMemoryKind !== null,
    pathnameSuffix,
    request: input.request,
  });
  if (bodyRead instanceof Response) return bodyRead;
  const { boundedBody, imageGenerationRequested, memoryRequestMetadata } = bodyRead;

  if (imageGenerationRequested || pathnameSuffix === "/v1/images/generations" || pathnameSuffix === "/v1/images/edits") {
    const denied = await checkHostedImageGenerationAccess({ authorization, env: input.env });
    if (denied) return denied;
  }

  const upstreamRequest = await createHostedRunnerUpstreamRequest(
    input.request,
    createProviderUpstreamUrl(input.url, pathMatch),
    headers,
    boundedBody !== undefined ? { body: boundedBody } : {},
  );
  const endpointKind = readOpenAiCacheDiagnosticEndpointKind(
    input.request.method,
    pathnameSuffix,
  );
  let diagnosticPromise: Promise<void> | null = null;
  if (endpointKind) {
    diagnosticPromise = emitHostedRunnerOpenAiCacheDiagnostic({
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
    }
  }

  const response = await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "openai",
    request: input.request,
    startedAt,
    upstreamRequest,
    upstreamFetchImpl: input.upstreamFetchImpl,
    url: input.url,
  });
  if (response.status === 401 || response.status === 403) {
    const reportPromise = reportOpenAiAuthorizationFailureSafely({
      ctx: input.ctx,
      env: input.env,
      status: response.status,
    });
    if (reportPromise) {
      await reportPromise;
    }
  }
  if (diagnosticPromise && typeof input.ctx?.waitUntil !== "function") {
    await diagnosticPromise;
  }

  if (
    input.request.method === "GET"
    && pathnameSuffix === "/v1/responses"
  ) {
    return relayHostedOpenAiResponsesWebSocketUpgrade({
      authorizeClientFrame: async (data) => {
        const imageRequest = readHostedOpenAiImageRequest(data);
        if (imageRequest === "invalid") {
          return Response.json({ error: {
            code: "MURPH_RESPONSES_REQUEST_INVALID",
            message: "Invalid Responses request.",
          } }, { status: 400 });
        }
        return imageRequest === "image"
          ? await checkHostedImageGenerationAccess({ authorization, env: input.env })
          : null;
      },
      ...(typeof input.ctx?.waitUntil === "function"
        ? {
            defer: (promise) => {
              input.ctx?.waitUntil?.(promise);
            },
          }
        : {}),
      ...(nativeMemoryKind
        ? {
            persistUsage: async (completion: HostedCodexMemoryWebSocketCompletion) => {
              await recordHostedCodexMemoryUsage({
                apiKeyEnv: "OPENAI_API_KEY",
                authorization,
                baseUrl: DEFAULT_OPENAI_API_BASE_URL + "/v1",
                env: input.env,
                providerName: "hosted-openai",
                providerRequestOutcome: completion.providerRequestOutcome,
                requestMetadata: completion.requestMetadata,
                usage: completion.usage,
              });
            },
            reportFailure: ({ phase }: { phase: HostedOpenAiWebSocketFailurePhase }) => {
              reportHostedCodexMemoryUsageFailure({
                memoryKind: nativeMemoryKind,
                providerName: "hosted-openai",
                reason: "websocket_" + phase,
              });
            },
          }
        : {}),
      upstreamResponse: response,
    });
  }

  return memoryRequestMetadata && nativeMemoryKind
    ? await handleHostedCodexMemoryUsageResponse({
        apiKeyEnv: "OPENAI_API_KEY",
        authorization,
        baseUrl: DEFAULT_OPENAI_API_BASE_URL + "/v1",
        env: input.env,
        memoryKind: nativeMemoryKind,
        providerName: "hosted-openai",
        requestMetadata: memoryRequestMetadata,
        response,
      })
    : response;
}

async function maybeHandleVeniceRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(
    undefined,
    DEFAULT_VENICE_API_BASE_URL,
    input.env,
  );
  const pathMatch = readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    return isKnownProviderHost(input.url, providerBase)
      ? disallowedProviderEgress()
      : null;
  }
  if (!isAllowedHostedVeniceRequest(input.request.method, pathMatch.pathnameSuffix)) {
    return disallowedProviderEgress();
  }

  const credential = readBearerCredential(input.request.headers);
  if (!credential) {
    return disallowedProviderEgress();
  }
  const startedAt = Date.now();
  const authorization = await authorizeNativeHostedProviderCredential({
    credential,
    env: input.env,
    providerKind: "venice",
    request: input.request,
  });
  if (!authorization) {
    return disallowedProviderEgress();
  }
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "venice",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const nativeMemoryKind = authorization.platformAiUsageAllowed !== false
    ? readHostedCodexNativeMemoryKind(input.request.headers)
    : null;
  const body = await readBoundedRequestBody(
    input.request,
    HOSTED_VENICE_RESPONSES_MAX_BODY_BYTES,
  );
  if (body === null) {
    return new Response("Payload Too Large", { status: 413 });
  }
  const memoryRequestMetadata = nativeMemoryKind
    ? parseHostedCodexMemoryRequestMetadata(body)
    : null;
  if (nativeMemoryKind && !memoryRequestMetadata) {
    return new Response("Invalid Codex memory request.", { status: 400 });
  }
  const upstreamBody = buildHostedVeniceResponsesRequestBody({
    body,
    pathnameSuffix: pathMatch.pathnameSuffix,
  });
  if (upstreamBody === null) {
    return disallowedProviderEgress();
  }

  const token = readRequiredInterceptSecret(input.env.VENICE_API_KEY, "VENICE_API_KEY");
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");

  const upstreamRequest = await createHostedRunnerUpstreamRequest(
    input.request,
    createProviderUpstreamUrl(input.url, pathMatch),
    headers,
    { body: upstreamBody },
  );
  const captureMemoryDiagnostic = nativeMemoryKind !== null;
  const diagnosticBody = captureMemoryDiagnostic
    ? upstreamRequest.clone()
    : null;
  const canonicalModelKind = captureMemoryDiagnostic
    ? readHostedResponsesRequestModelKind(body)
    : null;
  const providerStartedAt = Date.now();
  let response: Response;
  try {
    response = await fetchAuthorizedProviderUpstream({
      authorization,
      providerKind: "venice",
      request: input.request,
      startedAt,
      upstreamRequest,
      url: input.url,
    });
  } catch (error) {
    if (diagnosticBody) {
      const diagnosticPromise = emitHostedRunnerOpenAiCacheDiagnostic({
        canonicalModelKind,
        ctx: input.ctx ?? null,
        endpointKind: readVeniceCacheDiagnosticEndpointKind(pathMatch.pathnameSuffix),
        env: input.env,
        providerKind: "venice",
        providerTransportFailed: true,
        request: input.request,
        upstreamRequestBody: diagnosticBody,
        userId: authorization.userId,
        writeFence: authorization.writeFence,
      });
      scheduleHostedProviderDiagnostic({
        ctx: input.ctx ?? null,
        promise: diagnosticPromise,
      });
    }
    throw error;
  }

  if (diagnosticBody) {
    const diagnosticPromise = emitHostedRunnerOpenAiCacheDiagnostic({
      canonicalModelKind,
      ctx: input.ctx ?? null,
      endpointKind: readVeniceCacheDiagnosticEndpointKind(pathMatch.pathnameSuffix),
      env: input.env,
      providerKind: "venice",
      providerResponseTtfbMs: Date.now() - providerStartedAt,
      request: input.request,
      response,
      upstreamRequestBody: diagnosticBody,
      userId: authorization.userId,
      writeFence: authorization.writeFence,
    });
    scheduleHostedProviderDiagnostic({
      ctx: input.ctx ?? null,
      promise: diagnosticPromise,
    });
  }
  return memoryRequestMetadata && nativeMemoryKind
    ? await handleHostedCodexMemoryUsageResponse({
        apiKeyEnv: "VENICE_API_KEY",
        authorization,
        baseUrl: DEFAULT_VENICE_API_BASE_URL,
        env: input.env,
        memoryKind: nativeMemoryKind,
        providerName: "venice",
        requestMetadata: memoryRequestMetadata,
        response,
      })
    : response;
}

async function handleHostedCodexMemoryUsageResponse(input: {
  apiKeyEnv: string;
  authorization: HostedProviderEgressAuthorization;
  baseUrl: string;
  env: RunnerOutboundEnvironmentSource;
  memoryKind: HostedCodexNativeMemoryKind;
  providerName: "hosted-openai" | "venice";
  requestMetadata: HostedCodexMemoryRequestMetadata;
  response: Response;
}): Promise<Response> {
  if (!input.response.ok) {
    return input.response;
  }

  const responseBody = await readBoundedRequestBody(
    input.response,
    HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES,
  );
  if (responseBody === null) {
    reportHostedCodexMemoryUsageFailure({
      memoryKind: input.memoryKind,
      providerName: input.providerName,
      reason: "response_too_large",
    });
    return new Response("Hosted Codex memory response too large.", {
      status: 502,
    });
  }

  const terminal = parseHostedCodexMemoryTerminalResponse(responseBody);
  if (
    input.requestMetadata.usageRequired
    && (
      terminal === null
      || (
        terminal.usage === null
        && terminal.providerRequestOutcome === "succeeded"
      )
    )
  ) {
    reportHostedCodexMemoryUsageFailure({
      memoryKind: input.memoryKind,
      providerName: input.providerName,
      reason: "terminal_usage_missing",
    });
    return new Response("Hosted Codex memory usage was unavailable.", {
      status: 502,
    });
  }

  if (
    terminal?.usage
    && hasHostedCodexMemoryBillableUsage(terminal.usage)
  ) {
    try {
      await recordHostedCodexMemoryUsage({
        apiKeyEnv: input.apiKeyEnv,
        authorization: input.authorization,
        baseUrl: input.baseUrl,
        env: input.env,
        providerName: input.providerName,
        providerRequestOutcome: terminal.providerRequestOutcome,
        requestMetadata: input.requestMetadata,
        usage: terminal.usage,
      });
    } catch (error) {
      reportHostedCodexMemoryUsageFailure({
        error,
        memoryKind: input.memoryKind,
        providerName: input.providerName,
        reason: "persistence_failed",
      });
      // The provider work has already completed. Preserve its terminal
      // response so Codex does not retry an irreversible, billable request.
    }
  }

  return rebuildBufferedProviderResponse(input.response, responseBody);
}

async function recordHostedCodexMemoryUsage(input: {
  apiKeyEnv: string;
  authorization: HostedProviderEgressAuthorization;
  baseUrl: string;
  env: RunnerOutboundEnvironmentSource;
  providerName: "hosted-openai" | "venice";
  providerRequestOutcome: HostedCodexMemoryProviderRequestOutcome;
  requestMetadata: HostedCodexMemoryRequestMetadata;
  usage: HostedCodexMemoryUsage;
}): Promise<void> {
  const writeFence = requireHostedDirectUsageWriteFence(input.authorization);
  const record = buildHostedCodexMemoryUsageRecord({
    apiKeyEnv: input.apiKeyEnv,
    baseUrl: input.baseUrl,
    cacheWriteTokens: input.usage.cacheWriteTokens,
    cachedInputTokens: input.usage.cachedInputTokens,
    inputTokens: input.usage.inputTokens,
    memberId: writeFence.userId,
    occurredAt: input.usage.occurredAt,
    outputTokens: input.usage.outputTokens,
    providerName: input.providerName,
    providerRequestId: input.usage.providerRequestId,
    providerRequestOutcome: input.providerRequestOutcome,
    rawUsageJson: input.usage.rawUsageJson,
    reasoningTokens: input.usage.reasoningTokens,
    requestedModel: input.requestMetadata.requestedModel,
    // Venice exposes its translated provider id. The canonical request model
    // remains the priceable identity for that provider.
    servedModel: input.providerName === "venice"
      ? null
      : input.usage.servedModel,
    tokenPricingBasis: resolveHostedAiUsageTokenPricingBasis({
      model: input.requestMetadata.requestedModel,
      providerName: input.providerName,
      serviceTier: input.usage.serviceTier
        ?? input.requestMetadata.serviceTier,
    }),
    totalTokens: input.usage.totalTokens,
  });
  await recordHostedDirectRuntimeUsage({
    env: input.env,
    record,
    writeFence,
  });
}

function rebuildBufferedProviderResponse(
  response: Response,
  body: ArrayBuffer,
): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function reportHostedCodexMemoryUsageFailure(input: {
  error?: unknown;
  memoryKind: HostedCodexNativeMemoryKind;
  providerName: "hosted-openai" | "venice";
  reason: string;
}): void {
  const errorName = input.error === undefined
    ? null
    : readHostedExecutionSafeErrorName(input.error);
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      ...(input.error === undefined
        ? {}
        : {
            errorCode: deriveHostedExecutionErrorCode(input.error),
            ...(errorName ? { errorName } : {}),
          }),
      memoryKind: input.memoryKind,
      providerKind: input.providerName + "_codex_memory",
      reason: input.reason,
    },
    level: "warn",
    message: "Hosted Codex memory usage accounting failed.",
    phase: "wake.running",
  });
}

async function maybeHandleElevenLabsRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(
    undefined,
    DEFAULT_ELEVENLABS_API_BASE_URL,
    input.env,
  );
  const pathMatch = readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }
  const { pathnameSuffix } = pathMatch;
  if (!isAllowedElevenLabsRequest(input.request, input.url, pathnameSuffix)) {
    return disallowedProviderEgress();
  }
  if (!hasHeaderCredentialSentinel(input.request.headers, "xi-api-key")) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    providerKind: "elevenlabs",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "elevenlabs",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const requestBody = await readBoundedRequestBody(
    input.request,
    HOSTED_ELEVENLABS_MAX_BODY_BYTES,
  );
  if (requestBody === null) {
    return new Response("Payload Too Large", { status: 413 });
  }
  const providerRequest = parseHostedElevenLabsRequestBody({
    body: requestBody,
    contentType: input.request.headers.get("content-type"),
    pathnameSuffix,
  });
  if (providerRequest === null) {
    return disallowedProviderEgress();
  }

  const token = readRequiredInterceptSecret(
    input.env.ELEVENLABS_API_KEY,
    "ELEVENLABS_API_KEY",
  );
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("content-type", "application/json");
  headers.set("xi-api-key", token);
  const upstreamRequest = await createHostedRunnerUpstreamRequest(
    input.request,
    createProviderUpstreamUrl(input.url, pathMatch),
    headers,
    {
      body: providerRequest.upstreamBody,
    },
  );
  const providerRequestStartedAt = Date.now();
  const response = await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "elevenlabs",
    request: input.request,
    startedAt,
    upstreamRequest,
    url: input.url,
  });
  if (response.ok) {
    const usageRecording = providerRequest.kind === "tts"
      ? recordHostedElevenLabsTtsUsage({
          authorization,
          characterCount: providerRequest.characterCount,
          env: input.env,
          model: providerRequest.modelId,
          occurredAt: new Date(providerRequestStartedAt).toISOString(),
        })
      : recordHostedElevenLabsMusicUsage({
          authorization,
          durationMs: providerRequest.durationMs,
          env: input.env,
          model: providerRequest.modelId,
          occurredAt: new Date(providerRequestStartedAt).toISOString(),
          providerRequestId: response.headers.get("request-id"),
        });
    if (typeof input.ctx?.waitUntil === "function") {
      input.ctx.waitUntil(usageRecording);
    } else {
      await usageRecording;
    }
  }
  return response;
}

function recordHostedElevenLabsTtsUsage(input: {
  authorization: HostedProviderEgressAuthorization;
  characterCount: number;
  env: RunnerOutboundEnvironmentSource;
  model: string;
  occurredAt: string;
}): Promise<void> {
  return (async () => {
    const writeFence = requireHostedDirectUsageWriteFence(input.authorization);
    const record = buildHostedElevenLabsTtsUsageRecord({
      characterCount: input.characterCount,
      memberId: writeFence.userId,
      model: input.model,
      occurredAt: input.occurredAt,
    });
    await recordHostedDirectRuntimeUsage({
      env: input.env,
      record,
      writeFence,
    });
  })().catch((error: unknown) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...buildHostedExecutionSafeErrorDetails(error),
        providerKind: "elevenlabs_tts",
      },
      level: "warn",
      message: "Hosted ElevenLabs TTS usage recording failed; delivery unaffected.",
      phase: "wake.running",
    });
  });
}

function recordHostedElevenLabsMusicUsage(input: {
  authorization: HostedProviderEgressAuthorization;
  durationMs: number;
  env: RunnerOutboundEnvironmentSource;
  model: string;
  occurredAt: string;
  providerRequestId: string | null;
}): Promise<void> {
  return (async () => {
    const writeFence = requireHostedDirectUsageWriteFence(input.authorization);
    const record = buildHostedElevenLabsMusicUsageRecord({
      durationMs: input.durationMs,
      memberId: writeFence.userId,
      model: input.model,
      occurredAt: input.occurredAt,
      providerRequestId: input.providerRequestId,
    });
    await recordHostedDirectRuntimeUsage({
      env: input.env,
      record,
      writeFence,
    });
  })().catch((error: unknown) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...buildHostedExecutionSafeErrorDetails(error),
        providerKind: "elevenlabs_music",
      },
      level: "warn",
      message: "Hosted ElevenLabs Music usage recording failed; delivery unaffected.",
      phase: "wake.running",
    });
  });
}

async function maybeHandleGeminiRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  upstreamFetchImpl?: typeof fetch;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  if (input.url.origin !== DEFAULT_GEMINI_API_BASE_URL) {
    return null;
  }
  const model = readHostedGeminiVideoAnalysisRequestModel(
    input.request.method,
    input.url.pathname,
  );
  if (
    model === null
    || input.url.search.length > 0
    || input.request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
      !== "application/json"
    || input.request.headers.get("x-goog-api-key")
      !== HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL
  ) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    providerKind: "gemini",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "gemini",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const requestBody = await readBoundedRequestBody(
    input.request,
    HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_BODY_BYTES,
  );
  if (requestBody === null) {
    return new Response("Payload Too Large", { status: 413 });
  }
  let parsedBody: unknown;
  try {
    parsedBody = parseHostedGeminiVideoAnalysisRequestBody(
      JSON.parse(new TextDecoder().decode(requestBody)),
      model,
    );
  } catch {
    return disallowedProviderEgress();
  }

  const token = readRequiredInterceptSecret(
    input.env.GEMINI_API_KEY,
    "GEMINI_API_KEY",
  );
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("content-type", "application/json");
  headers.set("x-goog-api-key", token);
  const upstreamRequest = await createHostedRunnerUpstreamRequest(
    input.request,
    input.url,
    headers,
    { body: JSON.stringify(parsedBody), redirect: "manual" },
  );
  const providerRequestStartedAt = Date.now();
  const response = await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "gemini",
    request: input.request,
    startedAt,
    upstreamRequest,
    upstreamFetchImpl: input.upstreamFetchImpl,
    url: input.url,
  });
  if (!response.ok) {
    return response;
  }

  const responseBody = await readBoundedRequestBody(
    response,
    HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_RESPONSE_BODY_BYTES,
  );
  if (responseBody === null) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        providerKind: "gemini",
        responseStatus: response.status,
      },
      level: "warn",
      message: "Hosted Gemini response exceeded the delivery body limit; no usage recorded.",
      phase: "wake.running",
    });
    return new Response("Hosted Gemini response too large.", { status: 502 });
  }
  const usageRecording = recordHostedGeminiVideoAnalysisUsage({
    authorization,
    env: input.env,
    model,
    occurredAt: new Date(providerRequestStartedAt).toISOString(),
    providerRequestId:
      response.headers.get("x-goog-request-id")
      ?? response.headers.get("x-request-id"),
    responseBody,
  });
  if (typeof input.ctx?.waitUntil === "function") {
    input.ctx.waitUntil(usageRecording);
  } else {
    // Production container interception has no waitUntil. The recorder owns
    // its catch/log path, so usage accounting cannot withhold the answer.
    void usageRecording;
  }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  return new Response(responseBody, {
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  });
}

function recordHostedGeminiVideoAnalysisUsage(input: {
  authorization: HostedProviderEgressAuthorization;
  env: RunnerOutboundEnvironmentSource;
  model: string;
  occurredAt: string;
  providerRequestId: string | null;
  responseBody: ArrayBuffer;
}): Promise<void> {
  return (async () => {
    const writeFence = requireHostedDirectUsageWriteFence(input.authorization);
    const record = buildHostedGeminiVideoAnalysisUsageRecord({
      memberId: writeFence.userId,
      model: input.model,
      occurredAt: input.occurredAt,
      providerRequestId: input.providerRequestId,
      usage: readHostedGeminiVideoAnalysisUsageMetadata(input.responseBody),
    });
    const result = await recordHostedDirectRuntimeUsage({
      env: input.env,
      record,
      writeFence,
    });
    if (!result.recorded || result.usageId !== record.usageId) {
      throw new Error("Hosted Gemini video usage was not durably accepted.");
    }
  })().catch((error: unknown) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...buildHostedExecutionSafeErrorDetails(error),
        providerKind: "gemini",
      },
      level: "warn",
      message: "Hosted Gemini video usage recording failed; response delivery unaffected.",
      phase: "wake.running",
    });
  });
}

async function maybeHandleXaiRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(
    undefined,
    DEFAULT_XAI_API_BASE_URL,
    input.env,
  );
  const pathMatch = readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }
  const { pathnameSuffix } = pathMatch;
  if (input.request.method !== "POST" || pathnameSuffix !== "/v1/responses") {
    return disallowedProviderEgress();
  }
  if (!hasBearerCredentialSentinel(input.request.headers)) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ...input,
    providerKind: "xai",
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "xai",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const requestBody = await readBoundedRequestBody(
    input.request,
    HOSTED_XAI_MAX_BODY_BYTES,
  );
  if (requestBody === null) {
    return new Response("Payload Too Large", { status: 413 });
  }
  const providerRequest = parseHostedXaiRequestBody({
    body: requestBody,
    contentType: input.request.headers.get("content-type"),
  });
  if (providerRequest === null) {
    return disallowedProviderEgress();
  }

  const token = readRequiredInterceptSecret(input.env.XAI_API_KEY, "XAI_API_KEY");
  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  const upstreamRequest = await createHostedRunnerUpstreamRequest(
    input.request,
    createProviderUpstreamUrl(input.url, pathMatch),
    headers,
    {
      body: requestBody,
    },
  );
  const providerRequestStartedAt = Date.now();
  const response = await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "xai",
    request: input.request,
    startedAt,
    upstreamRequest,
    url: input.url,
  });
  if (!response.ok) {
    // Never bill a failed provider call: non-ok responses pass through
    // without a usage record.
    return response;
  }

  // The billing basis (usage.cost_in_usd_ticks) is in the response body, so
  // buffer it, start failure-isolated usage recording off the reply path, and
  // hand the engine a new response carrying the same payload.
  const responseBody = await readBoundedRequestBody(
    response,
    HOSTED_XAI_MAX_RESPONSE_BODY_BYTES,
  );
  if (responseBody === null) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        providerKind: "xai",
        responseStatus: response.status,
      },
      level: "warn",
      message: "Hosted xAI response exceeded the buffered body limit; no usage recorded.",
      phase: "wake.running",
    });
    return new Response("Hosted xAI response too large.", { status: 502 });
  }
  const responseMetadata = readHostedXaiResponseMetadata(responseBody);
  const usageRecording = recordHostedXaiSearchUsage({
    authorization,
    env: input.env,
    model: providerRequest.model,
    occurredAt: new Date(providerRequestStartedAt).toISOString(),
    providerRequestId: responseMetadata.providerRequestId,
    usage: responseMetadata.usage,
  });
  if (typeof input.ctx?.waitUntil === "function") {
    input.ctx.waitUntil(usageRecording);
  } else {
    // Production container interception has no waitUntil. The recorder owns
    // its catch/log path, so deliberately let the already-started best-effort
    // post continue without extending the member-visible provider budget.
    void usageRecording;
  }
  // The buffered body may differ from the wire encoding (fetch decompresses),
  // so drop the stale entity headers before re-wrapping.
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  return new Response(responseBody, {
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  });
}

function recordHostedXaiSearchUsage(input: {
  authorization: HostedProviderEgressAuthorization;
  env: RunnerOutboundEnvironmentSource;
  model: string;
  occurredAt: string;
  providerRequestId: string | null;
  usage: Record<string, unknown> | null;
}): Promise<void> {
  return (async () => {
    const writeFence = requireHostedDirectUsageWriteFence(input.authorization);
    const record = buildHostedXaiSearchUsageRecord({
      memberId: writeFence.userId,
      model: input.model,
      occurredAt: input.occurredAt,
      providerRequestId: input.providerRequestId,
      usage: input.usage,
    });
    await recordHostedDirectRuntimeUsage({
      env: input.env,
      record,
      writeFence,
    });
  })().catch((error: unknown) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...buildHostedExecutionSafeErrorDetails(error),
        providerKind: "xai",
      },
      level: "warn",
      message: "Hosted xAI search usage recording failed; response delivery unaffected.",
      phase: "wake.running",
    });
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

function readVeniceCacheDiagnosticEndpointKind(
  pathnameSuffix: string,
): HostedOpenAiCacheDiagnosticEndpointKind {
  return pathnameSuffix === "/responses/compact"
    ? "responses_compact"
    : "responses";
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
    PROVIDER_REQUEST_TEXT_DECODER.decode(body),
  );
}

function scheduleHostedProviderDiagnostic(input: {
  ctx: HostedRunnerOutboundContext | null;
  promise: Promise<void>;
}): void {
  if (typeof input.ctx?.waitUntil === "function") {
    try {
      input.ctx.waitUntil(input.promise);
      return;
    } catch {
      // Production container interception has no lifecycle owner. If an
      // optional scheduler rejects synchronously, use the same best-effort
      // detached fallback without extending the provider-response budget.
    }
  }
  void input.promise.catch((error: unknown) => {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        ...buildHostedExecutionSafeErrorDetails(error),
        providerKind: "venice",
      },
      level: "warn",
      message: "Hosted runner provider request diagnostic detached task failed.",
      phase: "wake.running",
    });
  });
}

async function emitHostedRunnerOpenAiCacheDiagnostic(input: {
  canonicalModelKind?: string | null;
  ctx: HostedRunnerOutboundContext | null;
  endpointKind: HostedOpenAiCacheDiagnosticEndpointKind;
  env: RunnerOutboundEnvironmentSource;
  providerKind?: HostedResponsesDiagnosticProviderKind;
  providerResponseTtfbMs?: number;
  providerTransportFailed?: boolean;
  request: Request;
  response?: Response;
  upstreamRequestBody: HostedRunnerDiagnosticBodySource;
  userId: string | null;
  writeFence: HostedProviderEgressWriteFenceMetadata | null;
}): Promise<void> {
  let diagnostic: HostedRunnerDiagnosticJson;
  try {
    const requestBytes = new Uint8Array(await input.upstreamRequestBody.arrayBuffer());
    diagnostic = await buildHostedOpenAiCacheDiagnostic({
      canonicalModelKind: input.canonicalModelKind ?? null,
      endpointKind: input.endpointKind,
      fingerprintSecret: readOpenAiCacheDiagnosticFingerprintSecret(input.env),
      method: input.request.method,
      providerKind: input.providerKind ?? "openai",
      requestBytes,
      turnMetadataHeader: input.request.headers.get(
        OPENAI_CACHE_DIAGNOSTIC_CODEX_TURN_METADATA_HEADER,
      ),
    });
    appendProviderResponseDiagnostics({
      diagnostic,
      providerKind: input.providerKind ?? "openai",
      providerResponseTtfbMs: input.providerResponseTtfbMs,
      providerTransportFailed: input.providerTransportFailed ?? false,
      response: input.response,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        diagnosticCaptured: false,
        endpointKind: input.endpointKind,
        providerKind: input.providerKind ?? "openai",
      },
      error,
      level: "warn",
      message: "Hosted runner provider request diagnostic capture failed.",
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
    message: "Hosted runner provider request diagnostic captured.",
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
        providerKind: input.providerKind ?? "openai",
        runtimeLogScheduled,
      },
      error,
      level: "warn",
      message: "Hosted runner provider request diagnostic runtime-log write failed.",
      phase: "wake.running",
    });
  });
}

function readBoundedProviderRetryCount(value: string | null): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^\d{1,3}$/u.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return parsed <= 100 ? parsed : null;
}

function appendProviderResponseDiagnostics(input: {
  diagnostic: HostedRunnerDiagnosticJson;
  providerKind: HostedResponsesDiagnosticProviderKind;
  providerResponseTtfbMs?: number;
  providerTransportFailed: boolean;
  response?: Response;
}): void {
  if (input.providerResponseTtfbMs !== undefined) {
    input.diagnostic.providerResponseTtfbMs = Math.max(
      0,
      Math.trunc(input.providerResponseTtfbMs),
    );
  }
  if (input.providerTransportFailed) {
    input.diagnostic.providerResponseOutcomeKind = "transport_error";
    return;
  }
  if (!input.response) {
    return;
  }

  input.diagnostic.providerResponseOk = input.response.ok;
  input.diagnostic.providerResponseOutcomeKind = input.response.ok
    ? "accepted"
    : "rejected";
  input.diagnostic.providerResponseStatus = input.response.status;
  input.diagnostic.providerResponseContentKind = readResponseContentKind(
    input.response.headers.get("content-type"),
  );

  if (input.providerKind !== "venice") {
    return;
  }
  const cloudflareRay = readSafeCloudflareRay(input.response.headers.get("cf-ray"));
  if (cloudflareRay) {
    input.diagnostic.providerResponseCloudflareRay = cloudflareRay;
  }
  const responseModelKind = readVeniceDiagnosticModelKind(
    input.response.headers.get("x-venice-model-id"),
  );
  input.diagnostic.providerResponseModelKind = responseModelKind;
  const requestModelKind = input.diagnostic.upstreamModelKind;
  input.diagnostic.providerResponseModelMatchesRequest =
    typeof requestModelKind === "string"
    && requestModelKind !== "missing"
    && requestModelKind !== "other"
    && responseModelKind === requestModelKind;

  const retryCount = readBoundedProviderRetryCount(
    input.response.headers.get("x-retry-count"),
  );
  if (retryCount !== null) {
    input.diagnostic.providerResponseRetryCount = retryCount;
  }
}

async function writeHostedRunnerOpenAiCacheDiagnosticRuntimeLog(input: {
  diagnostic: HostedRunnerDiagnosticJson;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
  writeFence: HostedProviderEgressWriteFenceMetadata | null;
}): Promise<void> {
  const route = HOSTED_RUNNER_WEB_CONTROL_ROUTES.runtimeLogWrite;
  const writeFence = input.writeFence ?? readRuntimeLogWriteFenceMetadata({
    headers: input.request.headers,
    userId: input.userId,
  });
  const response = await handleRunnerOutboundRequest(
    new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}${route.path}`, {
      body: JSON.stringify({
        entries: [{
          at: new Date().toISOString(),
          ...(writeFence ? { attemptId: writeFence.attemptId } : {}),
          component: "runner",
          eventCode: HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE,
          ...(writeFence ? { leaseGeneration: writeFence.leaseGeneration } : {}),
          level:
            input.diagnostic.providerResponseOutcomeKind === "rejected"
              || input.diagnostic.providerResponseOutcomeKind === "transport_error"
              ? "warn"
              : "debug",
          phase: "fetch",
          redactedJson: input.diagnostic,
          ...(writeFence?.workspaceVersion ? { workspaceVersion: writeFence.workspaceVersion } : {}),
        }],
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(writeFence
          ? {
              [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: writeFence.attemptId,
              [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: writeFence.leaseGeneration,
              ...(writeFence.workspaceVersion
                ? { [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: writeFence.workspaceVersion }
                : {}),
            }
          : {}),
      },
      method: route.method,
    }),
    input.env,
    input.userId,
  );

  if (!response.ok) {
    throw new Error(`Hosted provider request diagnostic runtime-log write returned HTTP ${response.status}.`);
  }
  await drainHostedRunnerMetadataResponse(response);
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

async function maybeHandleExaRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = readProviderBaseConfig(undefined, DEFAULT_EXA_API_BASE_URL, input.env);
  const pathMatch = readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    if (isKnownProviderHost(input.url, providerBase)) {
      return disallowedProviderEgress();
    }
    return null;
  }

  const { pathnameSuffix } = pathMatch;
  if (!isAllowedExaRequest(input.request.method, pathnameSuffix)) {
    return disallowedProviderEgress();
  }
  const providerCredential = input.request.headers.get("x-api-key")?.trim() ?? "";
  if (!providerCredential) {
    return disallowedProviderEgress();
  }
  if (input.url.search || input.url.hash) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeNativeHostedProviderCredential({
    credential: providerCredential,
    env: input.env,
    providerKind: "exa",
    request: input.request,
  });
  if (!authorization) {
    return disallowedProviderEgress();
  }
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "exa",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const upstreamBody = await readBoundedRequestBody(
    input.request,
    HOSTED_EXA_RESEARCH_SCOUT_MAX_BODY_BYTES,
  );
  if (upstreamBody === null) {
    return new Response("Payload Too Large", { status: 413 });
  }
  const validatedBody = readHostedExaResearchScoutRequestBody(upstreamBody);
  if (!validatedBody) {
    return disallowedProviderEgress();
  }

  const token = readRequiredInterceptSecret(input.env.EXA_API_KEY, "EXA_API_KEY");
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json; charset=utf-8",
  });
  headers.set("x-api-key", token);

  return await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "exa",
    request: input.request,
    startedAt,
    upstreamRequest: await createHostedRunnerUpstreamRequest(
      input.request,
      createProviderCanonicalUpstreamUrl(pathMatch),
      headers,
      {
        body: JSON.stringify(buildHostedExaResearchScoutCanonicalRequest(validatedBody)),
      },
    ),
    url: input.url,
  });
}

function readHostedExaResearchScoutRequestBody(
  body: ArrayBuffer,
): ExaResearchScoutParsedRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }

  const request = parseExaResearchScoutRequestBody(parsed);
  if (!request) {
    return null;
  }
  const clamped = clampExaResearchScoutPublishedWindow({
    now: new Date(),
    since: request.since,
    until: request.until,
  });
  if (!clamped) {
    return null;
  }
  return { ...request, ...clamped };
}

function buildHostedExaResearchScoutCanonicalRequest(
  input: ExaResearchScoutParsedRequest,
): ExaResearchScoutRequestBody {
  return "mode" in input.profile
    ? buildExaResearchScoutRequest({
        maxCandidates: input.numResults,
        profile: input.profile,
        since: input.since,
        until: input.until,
      })
    : buildExaResearchScoutBatchLaneRequest({
        maxCandidates: input.numResults,
        profile: input.profile,
        since: input.since,
        until: input.until,
      });
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
  const providerCredential = input.url.searchParams.get("access_token")?.trim() ?? "";
  if (!providerCredential) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeNativeHostedProviderCredential({
    credential: providerCredential,
    env: input.env,
    providerKind: "mapbox",
    request: input.request,
  });
  if (!authorization) {
    return disallowedProviderEgress();
  }
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

  const providerOperation = readAllowedHostedLinqOperation(
    input.request.method,
    pathMatch.pathnameSuffix,
  );
  if (!providerOperation) {
    emitHostedLinqProviderPolicyRejection({
      request: input.request,
      reason: "operation_not_allowed",
      userId: input.userId,
    });
    return disallowedProviderEgress();
  }
  if (!hasBearerCredentialSentinel(input.request.headers)) {
    emitHostedLinqProviderPolicyRejection({
      providerOperation,
      request: input.request,
      reason: "credential_sentinel_missing",
      userId: input.userId,
    });
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
    providerOperation,
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

function isAllowedExaRequest(method: string, pathname: string): boolean {
  return EXA_EGRESS_POLICY.some((policy) =>
    method === policy.method && pathname === policy.pathname
  );
}

function hasBearerCredentialSentinel(headers: Headers): boolean {
  return readBearerCredential(headers) === HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
}

function readBearerCredential(headers: Headers): string | null {
  const value = headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/iu.exec(value);
  const credential = match?.[1]?.trim() ?? "";
  return credential.length > 0 ? credential : null;
}

function hasHeaderCredentialSentinel(headers: Headers, name: string): boolean {
  return headers.get(name)?.trim() === HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
}

function emitHostedLinqProviderPolicyRejection(input: {
  providerOperation?: HostedLinqProviderOperation;
  request: Request;
  reason: "credential_sentinel_missing" | "operation_not_allowed";
  userId: string | null;
}): void {
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      method: readHostedRunnerDiagnosticMethod(input.request.method),
      providerEgressPolicyRejectReason: input.reason,
      providerKind: "linq",
      providerRequestAuthorized: false,
      ...(input.providerOperation
        ? { providerOperation: input.providerOperation }
        : {}),
      runtimeAuthorityHeadersPresent: hostedRuntimeAuthorityHeadersPresent(
        input.request.headers,
      ),
      userIdPresent: input.userId !== null,
    },
    level: "warn",
    message: "Hosted runner Linq provider egress rejected by policy.",
    phase: "wake.running",
  });
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
    || operation === "sendPhoto"
    || operation === "sendDocument"
    || operation === "sendRichMessage"
    || operation === "sendVoice"
    || operation === "sendChatAction"
    || operation === "deleteMessages"
    || operation === "deleteBusinessMessages"
    || operation === "setMessageReaction"
    || operation === "getFile";
}

async function authorizeHostedProviderEgress(input: {
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
      await requireRunnerRuntimeWriteFence({
        env: input.env,
        request: input.request,
        userId: input.userId,
      });
      return {
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

  if (input.providerKind === "openai") {
    // Deploy-smoke live model turn: the post-deploy managed-container smoke
    // runs one real codex turn from the dedicated deploy-smoke container,
    // which has no active user runtime. Authorize that egress only when the
    // originating container id belongs to the deploy-smoke namespace AND that
    // Durable Object reports an in-flight live-turn fence, so the window is
    // both identity- and time-scoped. Production turns authorize through a
    // provider credential, exact runtime headers, or a provider token.
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
      userId: input.userId,
    });
    if (deploySmokeLiveModelTurn) {
      return deploySmokeLiveModelTurn;
    }
  }

  if (!input.userId) {
    return {
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

async function authorizeHostedProviderEgressDeploySmokeLiveModelTurn(input: {
  ctx?: HostedRunnerOutboundContext;
  deploySmokeLiveModelTurnModel: string | null;
  env: RunnerOutboundEnvironmentSource;
  providerEgressTokenPresent: boolean;
  runtimeAuthorityHeadersPresent: boolean;
  startedAt: number;
  userId: string | null;
}): Promise<HostedProviderEgressAuthorization | null> {
  if (!input.deploySmokeLiveModelTurnModel) {
    return null;
  }
  if (
    input.userId !== null
    || input.providerEgressTokenPresent
    || input.runtimeAuthorityHeadersPresent
  ) {
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

async function authorizeHostedOpenAiProviderEgress(input: {
  bearerCredential: string;
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  openAiPathnameSuffix?: string;
  request: Request;
  userId: string | null;
}): Promise<HostedProviderEgressAuthorization | null> {
  if (isHostedProviderEgressCredential(input.bearerCredential)) {
    return await authorizeHostedProviderEgressCredential({
      credential: input.bearerCredential,
      env: input.env,
      providerKind: "openai",
      request: input.request,
    });
  }

  if (input.bearerCredential !== HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL) {
    return null;
  }

  return await authorizeHostedProviderEgress({
    ctx: input.ctx,
    env: input.env,
    openAiPathnameSuffix: input.openAiPathnameSuffix,
    providerKind: "openai",
    request: input.request,
    userId: input.userId,
  });
}

async function authorizeHostedProviderEgressCredential(input: {
  credential: string;
  env: RunnerOutboundEnvironmentSource;
  providerKind: string;
  request: Request;
}): Promise<HostedProviderEgressAuthorization> {
  const startedAt = Date.now();
  const runtimeAuthorityHeadersPresent = hostedRuntimeAuthorityHeadersPresent(
    input.request.headers,
  );
  const providerEgressTokenPresent = readHostedProviderEgressToken(input.request) !== null;
  let verification: Awaited<ReturnType<typeof verifyHostedProviderEgressCredential>>;
  try {
    verification = await verifyHostedProviderEgressCredential({
      credential: input.credential,
      source: input.env,
    });
  } catch (error) {
    const validationErrorName = readHostedExecutionSafeErrorName(error);
    return {
      authorized: false,
      durationMs: Date.now() - startedAt,
      mode: "provider_egress_credential",
      providerEgressTokenPresent,
      rejectReason: "provider_egress_credential_validation_error",
      runtimeAuthorityHeadersPresent,
      userId: null,
      validationError: error,
      validationErrorCode: deriveHostedExecutionErrorCode(error),
      ...(validationErrorName ? { validationErrorName } : {}),
      writeFence: null,
    };
  }
  if (!verification.ok) {
    return {
      authorized: false,
      durationMs: Date.now() - startedAt,
      mode: "provider_egress_credential",
      providerEgressTokenPresent,
      rejectReason: verification.rejectReason,
      runtimeAuthorityHeadersPresent,
      userId: null,
      writeFence: null,
    };
  }

  if (verification.claims.providerKind !== input.providerKind) {
    return {
      authorized: false,
      durationMs: Date.now() - startedAt,
      mode: "provider_egress_credential",
      providerEgressTokenPresent,
      rejectReason: "provider_egress_credential_provider_mismatch",
      runtimeAuthorityHeadersPresent,
      userId: verification.claims.userId,
      writeFence: null,
    };
  }

  const runner = input.env.USER_RUNNER.getByName(verification.claims.userId);
  if (typeof runner.validateRuntimeProviderEgressCredential !== "function") {
    return {
      authorized: false,
      durationMs: Date.now() - startedAt,
      mode: "provider_egress_credential",
      providerEgressTokenPresent,
      rejectReason: "validation_rpc_missing",
      runtimeAuthorityHeadersPresent,
      userId: verification.claims.userId,
      writeFence: null,
    };
  }

  let rawValidation: unknown;
  try {
    rawValidation = await runner.validateRuntimeProviderEgressCredential({
      providerKind: verification.claims.providerKind,
      runnerContainerName: verification.claims.runnerContainerName,
      userId: verification.claims.userId,
    });
  } catch (error) {
    const validationErrorName = readHostedExecutionSafeErrorName(error);
    return {
      authorized: false,
      durationMs: Date.now() - startedAt,
      mode: "provider_egress_credential",
      providerEgressTokenPresent,
      rejectReason: "provider_egress_credential_validation_error",
      runtimeAuthorityHeadersPresent,
      userId: verification.claims.userId,
      validationError: error,
      validationErrorCode: deriveHostedExecutionErrorCode(error),
      ...(validationErrorName ? { validationErrorName } : {}),
      writeFence: null,
    };
  }

  const validation = normalizeProviderEgressCredentialValidationResult(rawValidation);
  return {
    authorized: validation.owns,
    durationMs: Date.now() - startedAt,
    mode: "provider_egress_credential",
    providerEgressTokenPresent,
    ...(validation.platformAiUsageAllowed === undefined
      ? {}
      : { platformAiUsageAllowed: validation.platformAiUsageAllowed }),
    ...(validation.rejectReason ? { rejectReason: validation.rejectReason } : {}),
    runtimeAuthorityHeadersPresent,
    userId: verification.claims.userId,
    writeFence: validation.writeFence,
  };
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
    authorized: validation.owns,
    ...(validation.customInferenceEnvelope
      ? { customInferenceEnvelope: validation.customInferenceEnvelope }
      : {}),
    durationMs: Date.now() - input.startedAt,
    mode: "provider_egress_token",
    providerEgressTokenPresent: input.providerEgressTokenPresent,
    ...(validation.platformAiUsageAllowed === undefined
      ? {}
      : { platformAiUsageAllowed: validation.platformAiUsageAllowed }),
    ...(validation.rejectReason ? { rejectReason: validation.rejectReason } : {}),
    runtimeAuthorityHeadersPresent: input.runtimeAuthorityHeadersPresent,
    userId: input.activeUserId,
    writeFence: validation.writeFence,
  };
}

function normalizeProviderEgressCredentialValidationResult(value: unknown): {
  owns: boolean;
  platformAiUsageAllowed?: boolean;
  rejectReason: HostedProviderEgressRejectReason | null;
  writeFence: HostedProviderEgressWriteFenceMetadata | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      owns: false,
      rejectReason: "provider_egress_credential_rejected",
      writeFence: null,
    };
  }

  const record = value as Record<string, unknown>;
  if (record.owns !== true) {
    return {
      owns: false,
      rejectReason: readProviderEgressCredentialRejectReason(record.reason)
        ?? "provider_egress_credential_rejected",
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
      rejectReason: "provider_egress_credential_rejected",
      writeFence: null,
    };
  }

  return {
    owns: true,
    ...(typeof record.platformAiUsageAllowed === "boolean"
      ? { platformAiUsageAllowed: record.platformAiUsageAllowed }
      : {}),
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
  customInferenceEnvelope?: string;
  owns: boolean;
  platformAiUsageAllowed?: boolean;
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
    ...(typeof record.customInferenceEnvelope === "string"
        && record.customInferenceEnvelope.length > 0
      ? { customInferenceEnvelope: record.customInferenceEnvelope }
      : {}),
    owns: true,
    ...(typeof record.platformAiUsageAllowed === "boolean"
      ? { platformAiUsageAllowed: record.platformAiUsageAllowed }
      : {}),
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

function readProviderEgressCredentialRejectReason(
  value: unknown,
): HostedProviderEgressCredentialRejectReason | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const reason of HOSTED_PROVIDER_EGRESS_CREDENTIAL_REJECT_REASONS) {
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
  providerOperation?: HostedLinqProviderOperation;
  request: Request;
  startedAt: number;
  upstreamRequest: Request;
  upstreamFetchImpl?: typeof fetch;
  url: URL;
}): Promise<Response> {
  if (
    input.authorization.platformAiUsageAllowed === false
    && HOSTED_PLATFORM_METERED_PROVIDER_KINDS.has(input.providerKind)
  ) {
    const response = platformAiUsageDenied();
    emitHostedProviderEgressDiagnostic({
      authorization: input.authorization,
      providerKind: input.providerKind,
      ...(input.providerOperation
        ? { providerOperation: input.providerOperation }
        : {}),
      request: input.request,
      response,
      startedAt: input.startedAt,
      upstreamDurationMs: null,
      url: input.url,
    });
    return response;
  }
  const upstreamStartedAt = Date.now();
  try {
    const response = await (input.upstreamFetchImpl ?? fetch)(input.upstreamRequest);
    emitHostedProviderEgressDiagnostic({
      authorization: input.authorization,
      providerKind: input.providerKind,
      ...(input.providerOperation ? { providerOperation: input.providerOperation } : {}),
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
      ...(input.providerOperation ? { providerOperation: input.providerOperation } : {}),
      request: input.request,
      startedAt: input.startedAt,
      upstreamDurationMs: Date.now() - upstreamStartedAt,
      url: input.url,
    });
    throw error;
  }
}

function platformAiUsageDenied(): Response {
  return Response.json({
    error: {
      code: "HOSTED_PLATFORM_AI_USAGE_DENIED",
      message:
        "This Murph-funded tool is unavailable because the managed AI allowance is exhausted.",
    },
  }, {
    headers: { "cache-control": "no-store" },
    status: 402,
  });
}

function emitHostedProviderEgressDiagnostic(input: {
  authorization: HostedProviderEgressAuthorization;
  audioBytes?: number;
  error?: unknown;
  providerKind: string;
  providerOperation?: HostedLinqProviderOperation;
  request: Request;
  response?: Response;
  startedAt: number;
  transcriptDurationMs?: number | null;
  upstreamDurationMs: number | null;
  url: URL;
}): void {
  const diagnosticError = input.error ?? input.authorization.validationError;
  const errorCode = diagnosticError ? deriveHostedExecutionErrorCode(diagnosticError) : null;
  const errorName = diagnosticError ? readHostedExecutionSafeErrorName(diagnosticError) : null;
  const providerBearerCredentialKind = input.providerKind === "openai"
    ? readHostedProviderCredentialDiagnosticKind(readBearerCredential(input.request.headers))
    : null;
  const linqFailureResponseMetadata = input.providerKind === "linq"
      && input.providerOperation
      && input.response
      && !input.response.ok
    ? readLinqFailureResponseMetadata(input.response)
    : {};
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      host: input.url.hostname,
      method: readHostedRunnerDiagnosticMethod(input.request.method),
      providerKind: input.providerKind,
      providerRequestAuthorized: input.authorization.authorized,
      providerTotalDurationMs: Date.now() - input.startedAt,
      providerUpstreamDurationMs: input.upstreamDurationMs,
      providerEgressAuthDurationMs: input.authorization.durationMs,
      providerEgressAuthMode: input.authorization.mode,
      ...(input.providerOperation ? { providerOperation: input.providerOperation } : {}),
      responseOk: input.response?.ok ?? null,
      responseStatus: input.response?.status ?? null,
      ...linqFailureResponseMetadata,
      ...(providerBearerCredentialKind
        ? { providerBearerCredentialKind }
        : {}),
      providerEgressCredentialPresent:
        input.authorization.mode === "provider_egress_credential",
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
        ? {
            providerEgressRejectReason: input.authorization.rejectReason,
            writeFenceValidationRejectReason: input.authorization.rejectReason,
          }
        : {}),
      ...(input.authorization.validationErrorCode
        ? {
            providerEgressValidationErrorCode: input.authorization.validationErrorCode,
            writeFenceValidationErrorCode: input.authorization.validationErrorCode,
          }
        : {}),
      ...(input.authorization.validationErrorName
        ? {
            providerEgressValidationErrorName: input.authorization.validationErrorName,
            writeFenceValidationErrorName: input.authorization.validationErrorName,
          }
        : {}),
    },
    ...(diagnosticError ? { error: diagnosticError } : {}),
    level: input.authorization.authorized && !input.error ? "info" : "warn",
    message: "Hosted runner provider egress completed.",
    phase: "wake.running",
  });
}

type HostedLinqResponseContentKind = "html" | "json" | "missing" | "other" | "text";

function readLinqFailureResponseMetadata(response: Response): {
  providerResponseCloudflareChallenge: boolean;
  providerResponseCloudflareRay?: string;
  providerResponseContentKind: HostedLinqResponseContentKind;
} {
  const cloudflareRay = readSafeCloudflareRay(response.headers.get("cf-ray"));
  return {
    providerResponseCloudflareChallenge:
      response.headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge",
    ...(cloudflareRay ? { providerResponseCloudflareRay: cloudflareRay } : {}),
    providerResponseContentKind: readResponseContentKind(
      response.headers.get("content-type"),
    ),
  };
}

function readResponseContentKind(value: string | null): HostedLinqResponseContentKind {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!mediaType) {
    return "missing";
  }
  if (mediaType === "application/json" || mediaType.endsWith("+json")) {
    return "json";
  }
  if (mediaType === "text/html") {
    return "html";
  }
  if (mediaType.startsWith("text/")) {
    return "text";
  }
  return "other";
}

function readSafeCloudflareRay(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return /^[0-9A-Fa-f]{16,32}(?:-[A-Z]{3})?$/u.test(normalized)
    ? normalized
    : null;
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
  stripped.delete("api-key");
  stripped.delete("authorization");
  stripped.delete("cookie");
  stripped.delete("proxy-authorization");
  stripped.delete("x-api-key");
  stripped.delete("xi-api-key");
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

function createProviderCanonicalUpstreamUrl(match: ProviderPathMatch): URL {
  const upstreamUrl = new URL(match.upstreamBaseUrl.toString());
  upstreamUrl.pathname = `${normalizedProviderBasePath(match.upstreamBaseUrl)}${match.pathnameSuffix}`;
  upstreamUrl.search = "";
  upstreamUrl.hash = "";
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
async function authorizeNativeHostedProviderCredential(input: {
  credential: string;
  env: RunnerOutboundEnvironmentSource;
  providerKind: string;
  request: Request;
}): Promise<HostedProviderEgressAuthorization | null> {
  if (isHostedProviderEgressCredential(input.credential)) {
    return await authorizeHostedProviderEgressCredential(input);
  }
  if (input.credential !== HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL) {
    return null;
  }
  return await authorizeHostedProviderEgress({
    env: input.env,
    providerKind: input.providerKind,
    request: input.request,
    userId: readHostedRunnerBoundUserId(input.request),
  });
}

async function checkHostedImageGenerationAccess(input: {
  authorization: HostedProviderEgressAuthorization;
  env: RunnerOutboundEnvironmentSource;
}): Promise<Response | null> {
  try {
    const fence = requireHostedDirectUsageWriteFence(input.authorization);
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.env));
    const result = await fetchHostedWebControlPlaneJson({
      body: {},
      boundUserId: fence.userId,
      description: "Hosted image generation access",
      fetchImpl: fetch,
      route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.imageGenerationAccess,
      timeoutMs: environment.webControlTimeoutMs,
      transport: {
        callbackSigning: environment.webCallbackSigning,
        mode: "direct",
        webControlBaseUrl: environment.hostedWebBaseUrl,
        workspaceCheckpointBridge: null,
      },
    });
    if (result && typeof result === "object" && "allowed" in result && "reason" in result) {
      if (result.allowed === true && result.reason === "allowed") return null;
      if (result.allowed === false && result.reason === "card_required") {
        return Response.json({ error: {
          code: "MURPH_IMAGE_CARD_REQUIRED",
          message: "Save a card at https://www.withmurph.ai/settings#subscription to generate images. Saving a card does not charge you or start a subscription.",
        } }, { status: 403 });
      }
    }
  } catch {
    // An unavailable or old Web deployment cannot grant paid image access.
  }
  return Response.json({ error: {
    code: "MURPH_IMAGE_ACCESS_UNAVAILABLE",
    message: "Image generation access could not be confirmed. Try again later.",
  } }, { status: 503 });
}
