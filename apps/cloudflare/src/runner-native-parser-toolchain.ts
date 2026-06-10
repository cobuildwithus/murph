import type {
  HostedAssistantRuntimeParserToolchainConfig,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { posix as pathPosix } from "node:path";

import { CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT } from "./internal-hosts.ts";

export const HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV =
  "HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN";
const HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ROOT = "/app/test-parser-toolchain";
const HOSTED_LOCAL_E2E_FFMPEG_COMMAND = `${HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ROOT}/ffmpeg`;
const HOSTED_LOCAL_E2E_WHISPER_COMMAND = `${HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ROOT}/whisper-cli`;
const HOSTED_LOCAL_E2E_WHISPER_MODEL_PATH = `${HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ROOT}/ggml-test.bin`;
const HOSTED_RUNNER_DEFAULT_FFMPEG_COMMAND = "/usr/bin/ffmpeg";
const HOSTED_RUNNER_DEFAULT_PDFINFO_COMMAND = "/usr/bin/pdfinfo";
const HOSTED_RUNNER_DEFAULT_PDFTOTEXT_COMMAND = "/usr/bin/pdftotext";

export function createHostedRunnerNativeParserToolchain(
  source: Readonly<Record<string, string | undefined>> = process.env,
):
  HostedAssistantRuntimeParserToolchainConfig {
  const localE2eToolchain = createHostedRunnerLocalE2eParserToolchain(source);
  if (localE2eToolchain) {
    return localE2eToolchain;
  }

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
      transcription: {
        endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT,
      },
    },
  };
}

export function createHostedRunnerLocalE2eParserToolchain(
  source: Readonly<Record<string, string | undefined>>,
): HostedAssistantRuntimeParserToolchainConfig | null {
  if (source[HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV] !== "1") {
    return null;
  }

  return {
    tools: {
      ffmpeg: {
        command: readRequiredExactLocalE2eParserPath(
          source.FFMPEG_COMMAND,
          "FFMPEG_COMMAND",
          HOSTED_LOCAL_E2E_FFMPEG_COMMAND,
        ),
      },
      pdfinfo: {
        command: HOSTED_RUNNER_DEFAULT_PDFINFO_COMMAND,
      },
      pdftotext: {
        command: HOSTED_RUNNER_DEFAULT_PDFTOTEXT_COMMAND,
      },
      whisper: {
        command: readRequiredExactLocalE2eParserPath(
          source.WHISPER_COMMAND,
          "WHISPER_COMMAND",
          HOSTED_LOCAL_E2E_WHISPER_COMMAND,
        ),
        modelPath: readRequiredExactLocalE2eParserPath(
          source.WHISPER_MODEL_PATH,
          "WHISPER_MODEL_PATH",
          HOSTED_LOCAL_E2E_WHISPER_MODEL_PATH,
        ),
      },
    },
  };
}

function readRequiredExactLocalE2eParserPath(
  value: string | undefined,
  name: string,
  expected: string,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized.startsWith("/")) {
    throw new TypeError(
      `${HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV}=1 requires absolute ${name}.`,
    );
  }

  if (
    normalized !== expected ||
    pathPosix.resolve(normalized) !== expected
  ) {
    throw new TypeError(
      `${HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV}=1 requires ${name}=${expected}.`,
    );
  }

  return normalized;
}

export function isHostedRunnerLocalE2eParserToolchain(
  parserToolchain: HostedAssistantRuntimeParserToolchainConfig,
): boolean {
  const tools = parserToolchain.tools;
  return tools.ffmpeg?.command === HOSTED_LOCAL_E2E_FFMPEG_COMMAND &&
    tools.pdfinfo?.command === HOSTED_RUNNER_DEFAULT_PDFINFO_COMMAND &&
    tools.pdftotext?.command === HOSTED_RUNNER_DEFAULT_PDFTOTEXT_COMMAND &&
    tools.whisper?.command === HOSTED_LOCAL_E2E_WHISPER_COMMAND &&
    tools.whisper?.modelPath === HOSTED_LOCAL_E2E_WHISPER_MODEL_PATH;
}
