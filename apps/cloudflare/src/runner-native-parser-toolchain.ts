import type {
  HostedAssistantRuntimeParserToolchainConfig,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { posix as pathPosix } from "node:path";

import { CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT } from "./internal-hosts.ts";

export const HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV =
  "HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN";
const HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ROOT = "/app/test-parser-toolchain";
const HOSTED_LOCAL_E2E_FFMPEG_COMMAND = `${HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ROOT}/ffmpeg`;
const HOSTED_RUNNER_DEFAULT_FFMPEG_COMMAND = "/usr/bin/ffmpeg";
const HOSTED_RUNNER_DEFAULT_PDFINFO_COMMAND = "/usr/bin/pdfinfo";
const HOSTED_RUNNER_DEFAULT_PDFTOTEXT_COMMAND = "/usr/bin/pdftotext";

export function createHostedRunnerNativeParserToolchain(
  source: Readonly<Record<string, string | undefined>> = process.env,
  input: { providerEgressCredential?: string | null } = {},
):
  HostedAssistantRuntimeParserToolchainConfig {
  const localE2eToolchain = createHostedRunnerLocalE2eParserToolchain(source, input);
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
        ...buildHostedRunnerTranscribeConfig(input.providerEgressCredential ?? null),
      },
    },
  };
}

export function createHostedRunnerLocalE2eParserToolchain(
  source: Readonly<Record<string, string | undefined>>,
  input: { providerEgressCredential?: string | null } = {},
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
      // E2E keeps the production transcription endpoint so the hosted-local
      // suite proves the real worker transcribe route; only the AI binding is
      // faked in the hosted-local test entrypoint.
      transcription: {
        ...buildHostedRunnerTranscribeConfig(input.providerEgressCredential ?? null),
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
    isHostedRunnerTranscribeEndpoint(tools.transcription?.endpoint) &&
    tools.whisper === undefined;
}

export function isHostedRunnerNativeParserToolchain(
  parserToolchain: HostedAssistantRuntimeParserToolchainConfig,
): boolean {
  const tools = parserToolchain.tools;
  return tools.ffmpeg?.command === HOSTED_RUNNER_DEFAULT_FFMPEG_COMMAND &&
    tools.pdfinfo?.command === HOSTED_RUNNER_DEFAULT_PDFINFO_COMMAND &&
    tools.pdftotext?.command === HOSTED_RUNNER_DEFAULT_PDFTOTEXT_COMMAND &&
    isHostedRunnerTranscribeEndpoint(tools.transcription?.endpoint) &&
    tools.whisper === undefined;
}

function buildHostedRunnerTranscribeConfig(providerEgressCredential: string | null): {
  authorizationHeader?: string;
  endpoint: string;
} {
  return {
    ...(providerEgressCredential
      ? { authorizationHeader: `Bearer ${providerEgressCredential}` }
      : {}),
    endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT,
  };
}

function isHostedRunnerTranscribeEndpoint(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const expected = new URL(CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT);
  return parsed.origin === expected.origin &&
    parsed.pathname === expected.pathname &&
    parsed.search === "" &&
    parsed.hash === "";
}
