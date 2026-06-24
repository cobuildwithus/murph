import {
  normalizeHostedAiUsageAllowanceElevenLabsMusicModelId,
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
  type HostedAiUsageAllowanceElevenLabsMusicPricedModel,
  type HostedAiUsageAllowanceElevenLabsTtsPricedModel,
} from "@murphai/hosted-execution/runtime-control";

export const DEFAULT_ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
export const HOSTED_ELEVENLABS_MAX_BODY_BYTES = 32 * 1024;

const HOSTED_ELEVENLABS_TTS_MAX_TEXT_CHARS = 4_000;
const HOSTED_ELEVENLABS_MUSIC_MAX_PROMPT_CHARS = 4_100;
const HOSTED_ELEVENLABS_MAX_ID_CHARS = 200;
const HOSTED_ELEVENLABS_MUSIC_MIN_DURATION_MS = 3_000;
const HOSTED_ELEVENLABS_MUSIC_MAX_DURATION_MS = 300_000;

export interface HostedElevenLabsTtsRequestBody {
  characterCount: number;
  kind: "tts";
  modelId: HostedAiUsageAllowanceElevenLabsTtsPricedModel;
  upstreamBody: string;
}

export interface HostedElevenLabsMusicRequestBody {
  durationMs: number;
  kind: "music";
  modelId: HostedAiUsageAllowanceElevenLabsMusicPricedModel;
  upstreamBody: string;
}

export type HostedElevenLabsRequestBody =
  | HostedElevenLabsTtsRequestBody
  | HostedElevenLabsMusicRequestBody;

export function isAllowedElevenLabsRequest(
  request: Request,
  url: URL,
  pathnameSuffix: string,
): boolean {
  if (request.method !== "POST") {
    return false;
  }
  const requiredOutputFormat = requiredOutputFormatFor(pathnameSuffix);
  if (requiredOutputFormat === null) {
    return false;
  }
  const keys = [...url.searchParams.keys()];
  return keys.length === 1
    && keys[0] === "output_format"
    && url.searchParams.get("output_format") === requiredOutputFormat;
}

function requiredOutputFormatFor(pathnameSuffix: string): string | null {
  if (/^\/v1\/text-to-speech\/[^/]+$/u.test(pathnameSuffix)) {
    return "mp3_44100_128";
  }
  if (pathnameSuffix === "/v1/music") {
    return "mp3_48000_192";
  }
  return null;
}

export function parseHostedElevenLabsRequestBody(input: {
  body: ArrayBuffer;
  contentType: string | null;
  pathnameSuffix: string;
}): HostedElevenLabsRequestBody | null {
  if (!isJsonContentType(input.contentType)) {
    return null;
  }

  const record = parseJsonRecord(input.body);
  if (!record) {
    return null;
  }

  if (/^\/v1\/text-to-speech\/[^/]+$/u.test(input.pathnameSuffix)) {
    return parseHostedElevenLabsTtsRequestBody({
      pathnameSuffix: input.pathnameSuffix,
      record,
    });
  }
  if (input.pathnameSuffix === "/v1/music") {
    return parseHostedElevenLabsMusicRequestBody(record);
  }
  return null;
}

function parseHostedElevenLabsTtsRequestBody(input: {
  pathnameSuffix: string;
  record: Record<string, unknown>;
}): HostedElevenLabsTtsRequestBody | null {
  const voiceId = normalizeHostedElevenLabsString(
    decodeURIComponentSafe(input.pathnameSuffix.replace(/^\/v1\/text-to-speech\//u, "")),
    HOSTED_ELEVENLABS_MAX_ID_CHARS,
  );
  if (!voiceId || !hasExactKeys(input.record, ["model_id", "text"])) {
    return null;
  }

  const modelId = normalizeHostedAiUsageAllowanceElevenLabsTtsModelId(
    normalizeHostedElevenLabsString(input.record.model_id, HOSTED_ELEVENLABS_MAX_ID_CHARS),
  );
  const text = normalizeHostedElevenLabsString(
    input.record.text,
    HOSTED_ELEVENLABS_TTS_MAX_TEXT_CHARS,
  );
  if (!modelId || !text) {
    return null;
  }

  return {
    characterCount: text.length,
    kind: "tts",
    modelId,
    upstreamBody: JSON.stringify({
      model_id: modelId,
      text,
    }),
  };
}

function parseHostedElevenLabsMusicRequestBody(
  record: Record<string, unknown>,
): HostedElevenLabsMusicRequestBody | null {
  if (
    !hasExactKeys(record, [
      "force_instrumental",
      "model_id",
      "music_length_ms",
      "prompt",
    ])
  ) {
    return null;
  }

  const modelId = normalizeHostedAiUsageAllowanceElevenLabsMusicModelId(
    normalizeHostedElevenLabsString(record.model_id, HOSTED_ELEVENLABS_MAX_ID_CHARS),
  );
  const prompt = normalizeHostedElevenLabsString(
    record.prompt,
    HOSTED_ELEVENLABS_MUSIC_MAX_PROMPT_CHARS,
  );
  const durationMs = record.music_length_ms;
  if (
    !modelId
    || !prompt
    || typeof record.force_instrumental !== "boolean"
    || !Number.isSafeInteger(durationMs)
    || (durationMs as number) < HOSTED_ELEVENLABS_MUSIC_MIN_DURATION_MS
    || (durationMs as number) > HOSTED_ELEVENLABS_MUSIC_MAX_DURATION_MS
  ) {
    return null;
  }

  return {
    durationMs: durationMs as number,
    kind: "music",
    modelId,
    upstreamBody: JSON.stringify({
      force_instrumental: record.force_instrumental,
      model_id: modelId,
      music_length_ms: durationMs,
      prompt,
    }),
  };
}

function parseJsonRecord(body: ArrayBuffer): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function hasExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(record).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index]);
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

function normalizeHostedElevenLabsString(
  value: unknown,
  maxChars: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= maxChars ? normalized : null;
}
