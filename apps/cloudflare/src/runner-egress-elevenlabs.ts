import {
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
} from "@murphai/hosted-execution/runtime-control";

export const DEFAULT_ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
export const HOSTED_ELEVENLABS_TTS_MAX_BODY_BYTES = 32 * 1024;

const HOSTED_ELEVENLABS_TTS_MAX_TEXT_CHARS = 4_000;
const HOSTED_ELEVENLABS_TTS_MAX_ID_CHARS = 200;

export interface HostedElevenLabsTtsRequestBody {
  characterCount: number;
  modelId: string;
  upstreamBody: string;
}

export function isAllowedElevenLabsRequest(
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

export function parseHostedElevenLabsTtsRequestBody(input: {
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
