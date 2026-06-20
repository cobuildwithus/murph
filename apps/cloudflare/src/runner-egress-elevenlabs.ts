import {
  buildHostedExecutionSafeErrorDetails,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  buildHostedElevenLabsTtsUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
} from "@murphai/hosted-execution/runtime-control";

import { readHostedExecutionEnvironment } from "./env.ts";
import {
  recordHostedRuntimeUsageRecord,
} from "./runtime-platform/usage-record-port.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "./runner-outbound/shared.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";

const DEFAULT_ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
const HOSTED_ELEVENLABS_TTS_MAX_BODY_BYTES = 32 * 1024;
const HOSTED_ELEVENLABS_TTS_MAX_TEXT_CHARS = 4_000;
const HOSTED_ELEVENLABS_TTS_MAX_ID_CHARS = 200;

export interface HostedElevenLabsProviderBaseConfig {
  knownHosts: readonly string[];
  routes: readonly unknown[];
}

export interface HostedElevenLabsProviderPathMatch {
  pathnameSuffix: string;
  upstreamBaseUrl: URL;
}

export interface HostedElevenLabsProviderAuthorization {
  authorized: boolean;
  userId: string | null;
}

export interface HostedElevenLabsRunnerOutboundContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export interface HostedElevenLabsEgressDependencies<
  Authorization extends HostedElevenLabsProviderAuthorization,
  ProviderBase extends HostedElevenLabsProviderBaseConfig,
  PathMatch extends HostedElevenLabsProviderPathMatch,
> {
  authorizeHostedProviderEgress(input: {
    ctx?: HostedElevenLabsRunnerOutboundContext;
    env: RunnerOutboundEnvironmentSource;
    providerKind: "elevenlabs";
    request: Request;
    userId: string | null;
  }): Promise<Authorization>;
  createHostedRunnerUpstreamRequest(
    source: Request,
    url: URL,
    headers: Headers,
    options: {
      body?: BodyInit | null;
      redirect?: RequestRedirect;
    },
  ): Promise<Request>;
  createProviderUpstreamUrl(sourceUrl: URL, match: PathMatch): URL;
  disallowedProviderEgress(): Response;
  fetchAuthorizedProviderUpstream(input: {
    authorization: Authorization;
    providerKind: "elevenlabs";
    request: Request;
    startedAt: number;
    upstreamRequest: Request;
    url: URL;
  }): Promise<Response>;
  hasHeaderCredentialSentinel(headers: Headers, name: string): boolean;
  isKnownProviderHost(url: URL, providerBase: ProviderBase): boolean;
  readBoundedRequestBody(
    request: Pick<Request, "body" | "headers">,
    maxBytes: number,
  ): Promise<ArrayBuffer | null>;
  readProviderBaseConfig(
    value: unknown,
    fallback: string,
    env: RunnerOutboundEnvironmentSource,
  ): ProviderBase;
  readProviderPathMatch(url: URL, providerBase: ProviderBase): PathMatch | null;
  readRequiredInterceptSecret(value: unknown, label: string): string;
  stripHostedProviderUpstreamHeaders(headers: Headers): Headers;
  unauthorizedProviderEgress(input: {
    authorization: Authorization;
    providerKind: "elevenlabs";
    request: Request;
    startedAt: number;
    url: URL;
  }): Response;
}

interface HostedElevenLabsTtsRequestBody {
  characterCount: number;
  modelId: string;
  upstreamBody: string;
}

export async function maybeHandleHostedRunnerElevenLabsRequest<
  Authorization extends HostedElevenLabsProviderAuthorization,
  ProviderBase extends HostedElevenLabsProviderBaseConfig,
  PathMatch extends HostedElevenLabsProviderPathMatch,
>(input: {
  ctx?: HostedElevenLabsRunnerOutboundContext;
  deps: HostedElevenLabsEgressDependencies<Authorization, ProviderBase, PathMatch>;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  const providerBase = input.deps.readProviderBaseConfig(
    undefined,
    DEFAULT_ELEVENLABS_API_BASE_URL,
    input.env,
  );
  const pathMatch = input.deps.readProviderPathMatch(input.url, providerBase);
  if (!pathMatch) {
    if (input.deps.isKnownProviderHost(input.url, providerBase)) {
      return input.deps.disallowedProviderEgress();
    }
    return null;
  }
  const { pathnameSuffix } = pathMatch;
  if (!isAllowedElevenLabsRequest(input.request, input.url, pathnameSuffix)) {
    return input.deps.disallowedProviderEgress();
  }
  if (!input.deps.hasHeaderCredentialSentinel(input.request.headers, "xi-api-key")) {
    return input.deps.disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await input.deps.authorizeHostedProviderEgress({
    ctx: input.ctx,
    env: input.env,
    providerKind: "elevenlabs",
    request: input.request,
    userId: input.userId,
  });
  if (!authorization.authorized) {
    return input.deps.unauthorizedProviderEgress({
      authorization,
      providerKind: "elevenlabs",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }

  const requestBody = await input.deps.readBoundedRequestBody(
    input.request,
    HOSTED_ELEVENLABS_TTS_MAX_BODY_BYTES,
  );
  if (requestBody === null) {
    return new Response("Payload Too Large", { status: 413 });
  }
  const ttsRequest = parseHostedElevenLabsTtsRequestBody({
    body: requestBody,
    contentType: input.request.headers.get("content-type"),
    pathnameSuffix,
  });
  if (ttsRequest === null) {
    return input.deps.disallowedProviderEgress();
  }

  const token = input.deps.readRequiredInterceptSecret(
    input.env.ELEVENLABS_API_KEY,
    "ELEVENLABS_API_KEY",
  );
  const headers = input.deps.stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.set("content-type", "application/json");
  headers.set("xi-api-key", token);
  const response = await input.deps.fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "elevenlabs",
    request: input.request,
    startedAt,
    upstreamRequest: await input.deps.createHostedRunnerUpstreamRequest(
      input.request,
      input.deps.createProviderUpstreamUrl(input.url, pathMatch),
      headers,
      {
        body: ttsRequest.upstreamBody,
      },
    ),
    url: input.url,
  });
  if (response.ok) {
    const usageRecording = recordHostedElevenLabsTtsUsage({
      characterCount: ttsRequest.characterCount,
      env: input.env,
      memberId: authorization.userId,
      model: ttsRequest.modelId,
    });
    if (typeof input.ctx?.waitUntil === "function") {
      input.ctx.waitUntil(usageRecording);
    } else {
      await usageRecording;
    }
  }
  return response;
}

function isAllowedElevenLabsRequest(
  request: Request,
  url: URL,
  pathnameSuffix: string,
): boolean {
  if (
    request.method !== "POST" ||
    !/^\/v1\/text-to-speech\/[^/]+$/u.test(pathnameSuffix)
  ) {
    return false;
  }

  const allowedParams = new Set(["output_format"]);
  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key)) {
      return false;
    }
  }
  const outputFormat = url.searchParams.get("output_format");
  return outputFormat === null || outputFormat === "mp3_44100_128";
}

function parseHostedElevenLabsTtsRequestBody(input: {
  body: ArrayBuffer;
  contentType: string | null;
  pathnameSuffix: string;
}): HostedElevenLabsTtsRequestBody | null {
  if (!isJsonContentType(input.contentType)) {
    return null;
  }

  const voiceId = normalizeHostedElevenLabsTtsString(
    decodeURIComponentSafe(input.pathnameSuffix.replace(/^\/v1\/text-to-speech\//u, "")),
    HOSTED_ELEVENLABS_TTS_MAX_ID_CHARS,
  );
  if (!voiceId) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input.body));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes("model_id") || !keys.includes("text")) {
    return null;
  }

  const modelId = normalizeHostedElevenLabsTtsString(
    record.model_id,
    HOSTED_ELEVENLABS_TTS_MAX_ID_CHARS,
  );
  const text = normalizeHostedElevenLabsTtsString(
    record.text,
    HOSTED_ELEVENLABS_TTS_MAX_TEXT_CHARS,
  );
  const pricedModelId = normalizeHostedAiUsageAllowanceElevenLabsTtsModelId(modelId);
  if (!pricedModelId || !text) {
    return null;
  }

  return {
    characterCount: text.length,
    modelId: pricedModelId,
    upstreamBody: JSON.stringify({
      model_id: pricedModelId,
      text,
    }),
  };
}

function recordHostedElevenLabsTtsUsage(input: {
  characterCount: number;
  env: RunnerOutboundEnvironmentSource;
  memberId: string | null;
  model: string;
}): Promise<void> {
  return (async () => {
    if (!input.memberId) {
      throw new TypeError("Hosted ElevenLabs TTS usage recording requires a member id.");
    }
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.env));
    const record = buildHostedElevenLabsTtsUsageRecord({
      characterCount: input.characterCount,
      memberId: input.memberId,
      model: input.model,
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
        providerKind: "elevenlabs_tts",
      },
      level: "warn",
      message: "Hosted ElevenLabs TTS usage recording failed; delivery unaffected.",
      phase: "wake.running",
    });
  });
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function decodeURIComponentSafe(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function normalizeHostedElevenLabsTtsString(
  value: unknown,
  maxChars: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxChars) {
    return null;
  }

  return normalized;
}
