import type {
  HostedAssistantRuntimeParserToolchainConfig,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

export const HOSTED_RUNNER_WHISPER_MODEL_FILE = "ggml-base.en.bin";
const HOSTED_RUNNER_DEFAULT_FFMPEG_COMMAND = "/usr/bin/ffmpeg";
const HOSTED_RUNNER_DEFAULT_PDFINFO_COMMAND = "/usr/bin/pdfinfo";
const HOSTED_RUNNER_DEFAULT_PDFTOTEXT_COMMAND = "/usr/bin/pdftotext";
const HOSTED_RUNNER_DEFAULT_WHISPER_COMMAND = "/usr/local/bin/whisper-cli";
const HOSTED_RUNNER_DEFAULT_WHISPER_MODEL_PATH =
  `/home/runner/.murph/models/whisper/${HOSTED_RUNNER_WHISPER_MODEL_FILE}`;

export function createHostedRunnerNativeParserToolchain(
  source: Readonly<Record<string, string | undefined>> = {},
): HostedAssistantRuntimeParserToolchainConfig {
  return {
    tools: {
      ffmpeg: {
        command: readAbsoluteToolPath(
          source.FFMPEG_COMMAND,
          HOSTED_RUNNER_DEFAULT_FFMPEG_COMMAND,
        ),
      },
      pdfinfo: {
        command: readAbsoluteToolPath(
          source.PDFINFO_COMMAND,
          HOSTED_RUNNER_DEFAULT_PDFINFO_COMMAND,
        ),
      },
      pdftotext: {
        command: readAbsoluteToolPath(
          source.PDFTOTEXT_COMMAND,
          HOSTED_RUNNER_DEFAULT_PDFTOTEXT_COMMAND,
        ),
      },
      whisper: {
        command: readAbsoluteToolPath(
          source.WHISPER_COMMAND,
          HOSTED_RUNNER_DEFAULT_WHISPER_COMMAND,
        ),
        modelPath: readAbsoluteToolPath(
          source.WHISPER_MODEL_PATH,
          HOSTED_RUNNER_DEFAULT_WHISPER_MODEL_PATH,
        ),
      },
    },
  };
}

function readAbsoluteToolPath(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  if (!normalized.startsWith("/")) {
    throw new TypeError("Hosted runner native parser tool paths must be absolute.");
  }
  return normalized;
}
