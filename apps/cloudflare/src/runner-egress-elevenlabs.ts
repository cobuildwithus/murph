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
  if (pathnameSuffix === "/v1/text-to-dialogue"
    || /^\/v1\/text-to-speech\/[^/]+$/u.test(pathnameSuffix)) {
    return "mp3_44100_128";
  }
  if (pathnameSuffix === "/v1/music" || pathnameSuffix === "/v1/music/detailed") {
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
  if (input.pathnameSuffix === "/v1/text-to-dialogue") {
    return parseHostedElevenLabsDialogueRequestBody(record);
  }
  if (input.pathnameSuffix === "/v1/music") {
    return parseHostedElevenLabsMusicRequestBody(record);
  }
  if (input.pathnameSuffix === "/v1/music/detailed") {
    return parseHostedElevenLabsDetailedMusicRequestBody(record);
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

function parseHostedElevenLabsDialogueRequestBody(
  record: Record<string, unknown>,
): HostedElevenLabsTtsRequestBody | null {
  if (!hasExactKeys(record, ["inputs", "model_id"])
    || record.model_id !== "eleven_v4"
    || !Array.isArray(record.inputs)
    || record.inputs.length !== 1) {
    return null;
  }
  const input: unknown = record.inputs[0];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const entry = input as Record<string, unknown>;
  if (!hasExactKeys(entry, ["text", "voice_id"])) {
    return null;
  }
  // One voice memo, below the dialogue API's 2,000-character guidance.
  const text = normalizeHostedElevenLabsString(entry.text, 1_000);
  const voiceId = normalizeHostedElevenLabsString(entry.voice_id, HOSTED_ELEVENLABS_MAX_ID_CHARS);
  if (!text || !voiceId) {
    return null;
  }
  return {
    characterCount: text.length,
    kind: "tts",
    modelId: "eleven_v4",
    upstreamBody: JSON.stringify({
      inputs: [{ text, voice_id: voiceId }],
      model_id: "eleven_v4",
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

function parseHostedElevenLabsDetailedMusicRequestBody(record: Record<string, unknown>): HostedElevenLabsMusicRequestBody | null {
  if (!hasExactKeys(record, ["composition_plan", "model_id", "with_timestamps"])
    || record.model_id !== "music_v2" || record.with_timestamps !== true) return null;
  const plan = asRecord(record.composition_plan);
  if (!plan || !hasExactKeys(plan, ["chunks"]) || !Array.isArray(plan.chunks) || plan.chunks.length !== 1) return null;
  const chunk = parseDetailedMusicChunk(plan.chunks[0]);
  if (!chunk) return null;
  return { kind: "music", modelId: "music_v2", durationMs: chunk.duration_ms, upstreamBody: JSON.stringify({
    model_id: "music_v2", with_timestamps: true, composition_plan: { chunks: [chunk] },
  }) };
}

function parseDetailedMusicChunk(value: unknown) {
  const chunk = asRecord(value);
  if (!chunk || !hasExactKeys(chunk, ["text", "duration_ms", "positive_styles", "negative_styles"])) return null;
  const durationMs = chunk.duration_ms;
  if (typeof durationMs !== "number" || !Number.isSafeInteger(durationMs) || durationMs < 3000 || durationMs > 120_000
    || typeof chunk.text !== "string" || chunk.text.length > 4019
    || !Array.isArray(chunk.positive_styles) || chunk.positive_styles.length !== 1
    || !Array.isArray(chunk.negative_styles) || chunk.negative_styles.length !== 0) return null;
  const prompt = normalizeHostedElevenLabsString(chunk.positive_styles[0], HOSTED_ELEVENLABS_MUSIC_MAX_PROMPT_CHARS);
  const lines = chunk.text.split("\n");
  if (!prompt || lines.length > 20 || lines.some(line => !line.trim() || line.length > 200 || line.includes("\r"))) return null;
  return { text: chunk.text, duration_ms: durationMs, positive_styles: [prompt], negative_styles: [] };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
