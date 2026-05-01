import type {
  HostedAssistantRuntimeParserToolchainConfig,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

export const HOSTED_RUNNER_WHISPER_MODEL_PATH =
  "/home/runner/.murph/models/whisper/model.bin";
const HOSTED_RUNNER_DEFAULT_FFMPEG_COMMAND = "/usr/bin/ffmpeg";
const HOSTED_RUNNER_DEFAULT_PDFINFO_COMMAND = "/usr/bin/pdfinfo";
const HOSTED_RUNNER_DEFAULT_PDFTOTEXT_COMMAND = "/usr/bin/pdftotext";
const HOSTED_RUNNER_DEFAULT_WHISPER_COMMAND = "/usr/local/bin/whisper-cli";

export function createHostedRunnerNativeParserToolchain():
  HostedAssistantRuntimeParserToolchainConfig {
  return {
    tools: {
      ffmpeg: {
        command: HOSTED_RUNNER_DEFAULT_FFMPEG_COMMAND,
      },
      pdfinfo: {
        command: HOSTED_RUNNER_DEFAULT_PDFINFO_COMMAND,
      },
      pdftotext: {
        command: HOSTED_RUNNER_DEFAULT_PDFTOTEXT_COMMAND,
      },
      whisper: {
        command: HOSTED_RUNNER_DEFAULT_WHISPER_COMMAND,
        modelPath: HOSTED_RUNNER_WHISPER_MODEL_PATH,
      },
    },
  };
}
