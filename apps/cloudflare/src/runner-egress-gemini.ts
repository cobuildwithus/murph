import {
  HOSTED_GEMINI_VIDEO_ANALYSIS_API_BASE_URL,
  HOSTED_GEMINI_VIDEO_ANALYSIS_FPS_BY_SAMPLING_MODE,
  HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_REQUEST_BODY_BYTES,
  HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_RESPONSE_BODY_BYTES as SHARED_GEMINI_VIDEO_ANALYSIS_MAX_RESPONSE_BODY_BYTES,
  HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_VIDEO_BYTES,
  HOSTED_GEMINI_VIDEO_ANALYSIS_MODEL,
  HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL,
  HOSTED_GEMINI_VIDEO_ANALYSIS_ROLLOUT_MODELS,
  HOSTED_GEMINI_VIDEO_ANALYSIS_SUPPORTED_MIME_TYPES,
  HOSTED_GEMINI_VIDEO_ANALYSIS_SYSTEM_INSTRUCTION,
  HOSTED_GEMINI_VIDEO_ANALYSIS_THINKING_LEVEL,
  type HostedGeminiVideoAnalysisRolloutModel,
} from "@murphai/hosted-execution/assistant-capabilities";

export const DEFAULT_GEMINI_API_BASE_URL =
  HOSTED_GEMINI_VIDEO_ANALYSIS_API_BASE_URL;
export const HOSTED_GEMINI_VIDEO_ANALYSIS_PATH =
  `/v1beta/models/${HOSTED_GEMINI_VIDEO_ANALYSIS_MODEL}:generateContent`;
export const HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL_PATH =
  `/v1beta/models/${HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL}:generateContent`;
export const HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_BODY_BYTES =
  HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_REQUEST_BODY_BYTES;
export const HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_RESPONSE_BODY_BYTES =
  SHARED_GEMINI_VIDEO_ANALYSIS_MAX_RESPONSE_BODY_BYTES;

const MAX_QUESTION_CHARS = 1_000;
// Rollout-only reader values for warm runners built before selectable sampling.
// Remove after the runner rollback floor and every warm container have advanced.
const LEGACY_GEMINI_VIDEO_ANALYSIS_FPS = 1;
const LEGACY_GEMINI_VIDEO_ANALYSIS_MAX_OUTPUT_TOKENS = 1_800;
const LEGACY_GEMINI_VIDEO_ANALYSIS_THINKING_LEVEL = "low";
const MAX_BASE64_CHARS = Math.ceil(
  HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_VIDEO_BYTES / 3,
) * 4;
const supportedMimeTypes = new Set<string>(
  HOSTED_GEMINI_VIDEO_ANALYSIS_SUPPORTED_MIME_TYPES,
);
const supportedFps = new Set<number>(
  Object.values(HOSTED_GEMINI_VIDEO_ANALYSIS_FPS_BY_SAMPLING_MODE),
);
const modelByPath = new Map<string, HostedGeminiVideoAnalysisRolloutModel>(
  HOSTED_GEMINI_VIDEO_ANALYSIS_ROLLOUT_MODELS.map((model) => [
    `/v1beta/models/${model}:generateContent`,
    model,
  ]),
);

type HostedGeminiVideoAnalysisGenerationConfig =
  | {
      thinkingConfig: {
        thinkingLevel: typeof HOSTED_GEMINI_VIDEO_ANALYSIS_THINKING_LEVEL;
      };
    }
  | {
      maxOutputTokens: typeof LEGACY_GEMINI_VIDEO_ANALYSIS_MAX_OUTPUT_TOKENS;
      thinkingConfig: {
        thinkingLevel: typeof LEGACY_GEMINI_VIDEO_ANALYSIS_THINKING_LEVEL;
      };
    };

type HostedGeminiVideoAnalysisRequestBody = {
  contents: [{
    parts: [
      {
        inlineData: { data: string; mimeType: string };
        videoMetadata: { fps: number };
      },
      { text: string },
    ];
    role: "user";
  }];
  generationConfig: HostedGeminiVideoAnalysisGenerationConfig;
  systemInstruction: {
    parts: [{ text: string }];
  };
};

export function isAllowedHostedGeminiVideoAnalysisRequest(
  method: string,
  pathname: string,
): boolean {
  return readHostedGeminiVideoAnalysisRequestModel(method, pathname) !== null;
}

export function readHostedGeminiVideoAnalysisRequestModel(
  method: string,
  pathname: string,
): HostedGeminiVideoAnalysisRolloutModel | null {
  return method === "POST" ? modelByPath.get(pathname) ?? null : null;
}

export function parseHostedGeminiVideoAnalysisRequestBody(
  value: unknown,
  model: HostedGeminiVideoAnalysisRolloutModel =
    HOSTED_GEMINI_VIDEO_ANALYSIS_MODEL,
): HostedGeminiVideoAnalysisRequestBody {
  const body = exactRecord(value, "Gemini video-analysis request", [
    "contents",
    "generationConfig",
    "systemInstruction",
  ]);
  const systemInstruction = exactRecord(
    body.systemInstruction,
    "Gemini video-analysis system instruction",
    ["parts"],
  );
  const systemParts = exactArray(
    systemInstruction.parts,
    "Gemini video-analysis system instruction parts",
    1,
  );
  const systemPart = exactRecord(
    systemParts[0],
    "Gemini video-analysis system instruction part",
    ["text"],
  );
  if (systemPart.text !== HOSTED_GEMINI_VIDEO_ANALYSIS_SYSTEM_INSTRUCTION) {
    throw new TypeError(
      "Gemini video-analysis system instruction is not allowed.",
    );
  }

  const contents = exactArray(body.contents, "Gemini video-analysis contents", 1);
  const content = exactRecord(contents[0], "Gemini video-analysis content", [
    "parts",
    "role",
  ]);
  if (content.role !== "user") {
    throw new TypeError("Gemini video-analysis content role must be user.");
  }
  const parts = exactArray(content.parts, "Gemini video-analysis parts", 2);
  const videoPart = exactRecord(parts[0], "Gemini video-analysis video part", [
    "inlineData",
    "videoMetadata",
  ]);
  const inlineData = exactRecord(
    videoPart.inlineData,
    "Gemini video-analysis inline data",
    ["data", "mimeType"],
  );
  const data = readBase64VideoData(inlineData.data);
  const mimeType = boundedText(
    inlineData.mimeType,
    "Gemini video-analysis MIME type",
    64,
  ).toLowerCase();
  if (!supportedMimeTypes.has(mimeType)) {
    throw new TypeError("Gemini video-analysis MIME type is unsupported.");
  }
  const videoMetadata = exactRecord(
    videoPart.videoMetadata,
    "Gemini video-analysis video metadata",
    ["fps"],
  );
  if (
    typeof videoMetadata.fps !== "number"
    || !supportedFps.has(videoMetadata.fps)
  ) {
    throw new TypeError("Gemini video-analysis FPS is not allowed.");
  }
  const fps = videoMetadata.fps;

  const questionPart = exactRecord(
    parts[1],
    "Gemini video-analysis question part",
    ["text"],
  );
  const question = boundedText(
    questionPart.text,
    "Gemini video-analysis question",
    MAX_QUESTION_CHARS,
  );

  const rawGenerationConfig = readRecord(body.generationConfig);
  if (!rawGenerationConfig) {
    throw new TypeError("Gemini video-analysis generation config must be an object.");
  }
  const legacyProfile = Object.prototype.hasOwnProperty.call(
    rawGenerationConfig,
    "maxOutputTokens",
  );
  const generationConfig = exactRecord(
    rawGenerationConfig,
    "Gemini video-analysis generation config",
    legacyProfile
      ? ["maxOutputTokens", "thinkingConfig"]
      : ["thinkingConfig"],
  );
  const thinkingConfig = exactRecord(
    generationConfig.thinkingConfig,
    "Gemini video-analysis thinking config",
    ["thinkingLevel"],
  );
  if (legacyProfile) {
    if (
      model !== HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL
      || fps !== LEGACY_GEMINI_VIDEO_ANALYSIS_FPS
      || generationConfig.maxOutputTokens
        !== LEGACY_GEMINI_VIDEO_ANALYSIS_MAX_OUTPUT_TOKENS
      || thinkingConfig.thinkingLevel
        !== LEGACY_GEMINI_VIDEO_ANALYSIS_THINKING_LEVEL
    ) {
      throw new TypeError("Gemini video-analysis legacy profile is not allowed.");
    }
  } else if (
    thinkingConfig.thinkingLevel !== HOSTED_GEMINI_VIDEO_ANALYSIS_THINKING_LEVEL
  ) {
    throw new TypeError("Gemini video-analysis thinking level is not allowed.");
  }

  const normalizedGenerationConfig: HostedGeminiVideoAnalysisGenerationConfig =
    legacyProfile
      ? {
          maxOutputTokens: LEGACY_GEMINI_VIDEO_ANALYSIS_MAX_OUTPUT_TOKENS,
          thinkingConfig: {
            thinkingLevel: LEGACY_GEMINI_VIDEO_ANALYSIS_THINKING_LEVEL,
          },
        }
      : {
          thinkingConfig: {
            thinkingLevel: HOSTED_GEMINI_VIDEO_ANALYSIS_THINKING_LEVEL,
          },
        };

  return {
    contents: [{
      parts: [
        {
          inlineData: { data, mimeType },
          videoMetadata: { fps },
        },
        { text: question },
      ],
      role: "user",
    }],
    generationConfig: normalizedGenerationConfig,
    systemInstruction: {
      parts: [{ text: HOSTED_GEMINI_VIDEO_ANALYSIS_SYSTEM_INSTRUCTION }],
    },
  };
}

export function readHostedGeminiVideoAnalysisUsageMetadata(
  body: ArrayBuffer | Uint8Array,
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  const usage = readRecord(readRecord(parsed)?.usageMetadata);
  if (!usage) {
    return null;
  }

  const output: Record<string, unknown> = {};
  for (const key of [
    "cachedContentTokenCount",
    "candidatesTokenCount",
    "promptTokenCount",
    "thoughtsTokenCount",
    "totalTokenCount",
  ] as const) {
    const value = usage[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      output[key] = value;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

function readBase64VideoData(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Gemini video-analysis data must be a base64 string.");
  }
  if (
    value.length > MAX_BASE64_CHARS
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new TypeError("Gemini video-analysis data is invalid or too large.");
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedBytes = (value.length / 4) * 3 - padding;
  if (
    decodedBytes <= 0
    || decodedBytes > HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_VIDEO_BYTES
  ) {
    throw new RangeError("Gemini video-analysis data exceeds the inline limit.");
  }
  return value;
}

function exactRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  const keys = Object.keys(record);
  if (
    keys.length !== allowedKeys.length
    || keys.some((key) => !allowed.has(key))
    || allowedKeys.some((key) => !(key in record))
  ) {
    throw new TypeError(`${label} has an unsupported shape.`);
  }
  return record;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactArray(value: unknown, label: string, length: number): unknown[] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new TypeError(`${label} must contain exactly ${length} item(s).`);
  }
  return value;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be text.`);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new TypeError(`${label} is empty or too long.`);
  }
  return text;
}
