export const ELEVENLABS_SCRIPT_TTS_MAX_TEXT_LENGTH: 1_000;
export const ELEVENLABS_SCRIPT_TTS_OUTPUT_FORMAT: "mp3_44100_64";
export const ELEVENLABS_SCRIPT_TTS_TIMEOUT_MS: 90_000;

export interface ElevenLabsConfigurationDiagnostics {
  failureStage: "configuration";
  provider: "elevenlabs";
}

export interface ElevenLabsHttpDiagnostics {
  elapsedMs: number;
  failureStage: "http";
  provider: "elevenlabs";
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  providerRequestId: string | null;
  responseBodyTextLength: number | null;
  retryable: boolean;
  status: number;
}

export interface ElevenLabsTransportDiagnostics {
  elapsedMs: number;
  failureStage: "transport";
  provider: "elevenlabs";
  retryable: true;
  timedOut: boolean;
  timeoutMs: 90_000;
  transportErrorName: string | null;
  transportErrorTextLength: number;
}

export type ElevenLabsGenerationDiagnostics =
  | ElevenLabsConfigurationDiagnostics
  | ElevenLabsHttpDiagnostics
  | ElevenLabsTransportDiagnostics;

export class ElevenLabsGenerationError extends Error {
  readonly diagnostics: ElevenLabsGenerationDiagnostics;

  constructor(
    message: string,
    diagnostics: ElevenLabsGenerationDiagnostics,
  );
}

export interface GenerateElevenLabsSpeechMp3Input {
  apiKey: string;
  fetchImplementation?: typeof fetch;
  modelId: string;
  signal?: AbortSignal;
  text: string;
  voiceId: string;
}

export function generateElevenLabsSpeechMp3(
  input: GenerateElevenLabsSpeechMp3Input,
): Promise<Uint8Array>;
