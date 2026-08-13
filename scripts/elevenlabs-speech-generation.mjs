import {
  ElevenLabsClient,
  ElevenLabsError,
  ElevenLabsTimeoutError,
} from "@elevenlabs/elevenlabs-js";

const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
const ELEVENLABS_MAX_RETRIES = 0;
const ELEVENLABS_PROVIDER_MESSAGE_MAX_LENGTH = 300;

export const ELEVENLABS_SCRIPT_TTS_MAX_TEXT_LENGTH = 1_000;
// 64 kbps mono keeps these committed short-form previews and setup memos small.
// Changing this rewrites every generated clip.
export const ELEVENLABS_SCRIPT_TTS_OUTPUT_FORMAT = "mp3_44100_64";
export const ELEVENLABS_SCRIPT_TTS_TIMEOUT_MS = 90_000;

export class ElevenLabsGenerationError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = "ElevenLabsGenerationError";
    this.diagnostics = diagnostics;
  }
}

export async function generateElevenLabsSpeechMp3(input) {
  const apiKey = readRequiredString(input.apiKey, "api key");
  const modelId = readRequiredString(input.modelId, "model id");
  const text = readRequiredString(input.text, "text", { trimResult: false });
  const voiceId = readRequiredString(input.voiceId, "voice id");
  if (text.length > ELEVENLABS_SCRIPT_TTS_MAX_TEXT_LENGTH) {
    throw createConfigurationError(
      `ElevenLabs speech text must contain at most ${ELEVENLABS_SCRIPT_TTS_MAX_TEXT_LENGTH} characters.`,
    );
  }

  const fetchImplementation =
    input.fetchImplementation ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetchImplementation !== "function") {
    throw createConfigurationError(
      "ElevenLabs speech generation requires fetch support in the current Node.js runtime.",
    );
  }

  const timeout = createTimeoutAbortController(
    input.signal,
    ELEVENLABS_SCRIPT_TTS_TIMEOUT_MS,
  );
  const client = new ElevenLabsClient({
    apiKey,
    baseUrl: ELEVENLABS_API_BASE_URL,
    fetch: fetchImplementation,
    headers: {
      accept: "audio/mpeg",
    },
    maxRetries: ELEVENLABS_MAX_RETRIES,
    timeoutInSeconds: ELEVENLABS_SCRIPT_TTS_TIMEOUT_MS / 1_000,
  });
  const startedAtMs = Date.now();
  try {
    const stream = await client.textToSpeech.convert(
      voiceId,
      {
        modelId,
        outputFormat: ELEVENLABS_SCRIPT_TTS_OUTPUT_FORMAT,
        text,
      },
      {
        abortSignal: timeout.signal,
        maxRetries: ELEVENLABS_MAX_RETRIES,
        timeoutInSeconds: ELEVENLABS_SCRIPT_TTS_TIMEOUT_MS / 1_000,
      },
    );
    return await readAudioStream(stream);
  } catch (error) {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? error;
    }

    if (
      error instanceof ElevenLabsError
      && typeof error.statusCode === "number"
    ) {
      const providerError = readProviderError(error.body, error.requestId);
      throw new ElevenLabsGenerationError(
        `ElevenLabs speech request failed with HTTP ${error.statusCode}.`,
        {
          elapsedMs: Date.now() - startedAtMs,
          failureStage: "http",
          provider: "elevenlabs",
          providerErrorCode: providerError.code,
          providerErrorMessage: providerError.message,
          providerRequestId: providerError.requestId,
          responseBodyTextLength: providerError.textLength,
          retryable:
            error.statusCode === 408
            || error.statusCode === 429
            || error.statusCode >= 500,
          status: error.statusCode,
        },
      );
    }

    const timedOut =
      timeout.timedOut() || error instanceof ElevenLabsTimeoutError;
    throw new ElevenLabsGenerationError(
      timedOut
        ? `ElevenLabs speech request timed out after ${ELEVENLABS_SCRIPT_TTS_TIMEOUT_MS}ms.`
        : "ElevenLabs speech request failed before a response was returned.",
      {
        elapsedMs: Date.now() - startedAtMs,
        failureStage: "transport",
        provider: "elevenlabs",
        retryable: true,
        timedOut,
        timeoutMs: ELEVENLABS_SCRIPT_TTS_TIMEOUT_MS,
        transportErrorName: readSafeErrorName(error),
        transportErrorTextLength: readErrorMessageLength(error),
      },
    );
  } finally {
    timeout.cleanup();
  }
}

function readRequiredString(value, label, options = {}) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createConfigurationError(
      `ElevenLabs ${label} must be a non-empty string.`,
    );
  }
  return options.trimResult === false ? value : value.trim();
}

function createConfigurationError(message) {
  return new ElevenLabsGenerationError(message, {
    failureStage: "configuration",
    provider: "elevenlabs",
  });
}

function createTimeoutAbortController(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  return {
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal,
    timedOut: () => timedOut,
  };
}

async function readAudioStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let totalLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      totalLength += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function readProviderError(body, fallbackRequestId) {
  const text = stringifyProviderBody(body);
  const detail = readProviderErrorDetail(body);
  return {
    code: readBoundedString(detail?.code ?? detail?.status, 100),
    message: readBoundedString(
      detail?.message,
      ELEVENLABS_PROVIDER_MESSAGE_MAX_LENGTH,
    ),
    requestId: readBoundedString(
      detail?.request_id ?? fallbackRequestId,
      100,
    ),
    textLength: text?.length ?? null,
  };
}

function stringifyProviderBody(body) {
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body) ?? null;
  } catch {
    return null;
  }
}

function readProviderErrorDetail(body) {
  if (typeof body === "string") {
    try {
      return readProviderErrorDetail(JSON.parse(body));
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const detail = body.detail;
  return detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail
    : null;
}

function readBoundedString(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}…`
    : trimmed;
}

function readSafeErrorName(error) {
  if (!(error instanceof Error)) return null;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(error.name)
    ? error.name
    : null;
}

function readErrorMessageLength(error) {
  return error instanceof Error ? error.message.length : String(error).length;
}
