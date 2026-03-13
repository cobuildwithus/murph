import type { FfmpegToolOptions } from "../adapters/ffmpeg.js";
import { createPaddleOcrProvider } from "../adapters/paddleocr.js";
import { createPdfToTextProvider } from "../adapters/pdftotext.js";
import { createTextFileProvider } from "../adapters/text-file.js";
import { createWhisperCppProvider } from "../adapters/whisper-cpp.js";
import type { ParserRegistry } from "../registry/registry.js";
import { createParserRegistry } from "../registry/registry.js";
import { resolveExecutable } from "../shared.js";
import type {
  ParserToolName,
  ParserToolchainConfig,
  ParserToolchainToolConfig,
} from "./config.js";
import {
  getParserToolchainPaths,
  readParserToolchainConfig,
} from "./config.js";

export type ParserToolDiscoverySource = "config" | "env" | "system" | "missing";

export interface ParserToolDiscovery {
  available: boolean;
  command: string | null;
  modelPath?: string | null;
  source: ParserToolDiscoverySource;
  reason: string;
}

export interface ParserDoctorReport {
  configPath: string;
  discoveredAt: string;
  tools: Record<ParserToolName, ParserToolDiscovery>;
}

export async function discoverParserToolchain(input: {
  vaultRoot: string;
}): Promise<ParserDoctorReport> {
  const paths = getParserToolchainPaths(input.vaultRoot);
  const loadedConfig = await readParserToolchainConfig(input.vaultRoot);
  const config = loadedConfig?.config ?? null;

  return {
    configPath: paths.configPath,
    discoveredAt: new Date().toISOString(),
    tools: {
      ffmpeg: await discoverCommandTool({
        config: config?.tools.ffmpeg,
        envValue: process.env.HEALTHYBOB_FFMPEG_COMMAND,
        fallbackCommands: ["ffmpeg"],
        availableReason: "ffmpeg CLI available.",
        missingReason: "ffmpeg CLI not found.",
      }),
      pdftotext: await discoverCommandTool({
        config: config?.tools.pdftotext,
        envValue: process.env.HEALTHYBOB_PDFTOTEXT_COMMAND,
        fallbackCommands: ["pdftotext"],
        availableReason: "pdftotext CLI available.",
        missingReason: "pdftotext CLI not found.",
      }),
      whisper: await discoverWhisperTool(config),
      paddleocr: await discoverCommandTool({
        config: config?.tools.paddleocr,
        envValue: process.env.HEALTHYBOB_PADDLEOCR_COMMAND,
        fallbackCommands: ["paddleocr", "paddlex"],
        availableReason: "PaddleOCR CLI available.",
        missingReason: "PaddleOCR CLI not found.",
      }),
    },
  };
}

export async function createConfiguredParserRegistry(input: {
  vaultRoot: string;
}): Promise<{
  doctor: ParserDoctorReport;
  registry: ParserRegistry;
  ffmpeg: FfmpegToolOptions | undefined;
}> {
  const loadedConfig = await readParserToolchainConfig(input.vaultRoot);
  const config = loadedConfig?.config ?? null;
  const doctor = await discoverParserToolchain(input);

  return {
    doctor,
    registry: createParserRegistry([
      createTextFileProvider(),
      createWhisperCppProvider({
        commandCandidates: toCommandCandidates(config?.tools.whisper?.command),
        modelPath:
          normalizeNullableString(config?.tools.whisper?.modelPath) ?? undefined,
      }),
      createPdfToTextProvider({
        commandCandidates: toCommandCandidates(config?.tools.pdftotext?.command),
      }),
      createPaddleOcrProvider({
        commandCandidates: toCommandCandidates(config?.tools.paddleocr?.command),
      }),
    ]),
    ffmpeg: ffmpegOptionsFromDoctor(doctor),
  };
}

export function ffmpegOptionsFromDoctor(
  doctor: ParserDoctorReport,
): FfmpegToolOptions | undefined {
  const command = normalizeNullableString(doctor.tools.ffmpeg.command);
  if (!command) {
    return undefined;
  }

  return {
    commandCandidates: [command],
    allowSystemLookup: doctor.tools.ffmpeg.source !== "config",
  };
}

async function discoverWhisperTool(
  config: ParserToolchainConfig | null,
): Promise<ParserToolDiscovery> {
  const toolConfig = config?.tools.whisper;
  const commandResolution = await resolveCommand({
    configCommand: toolConfig?.command,
    envValue: process.env.HEALTHYBOB_WHISPER_COMMAND,
    fallbackCommands: ["whisper-cli", "whisper-cpp"],
  });
  const modelResolution = resolveModelPath(
    toolConfig?.modelPath,
    process.env.HEALTHYBOB_WHISPER_MODEL_PATH,
  );
  const source = selectCompositeSource(commandResolution.source, modelResolution.source);

  if (!commandResolution.command) {
    return {
      available: false,
      command: null,
      modelPath: modelResolution.modelPath,
      source,
      reason: "whisper.cpp CLI executable not found.",
    };
  }

  if (!modelResolution.modelPath) {
    return {
      available: false,
      command: commandResolution.command,
      modelPath: null,
      source,
      reason: "Whisper model path is not configured.",
    };
  }

  return {
    available: true,
    command: commandResolution.command,
    modelPath: modelResolution.modelPath,
    source,
    reason: "whisper.cpp CLI and model path configured.",
  };
}

async function discoverCommandTool(input: {
  config?: ParserToolchainToolConfig;
  envValue?: string | null;
  fallbackCommands: string[];
  availableReason: string;
  missingReason: string;
}): Promise<ParserToolDiscovery> {
  const resolution = await resolveCommand({
    configCommand: input.config?.command,
    envValue: input.envValue,
    fallbackCommands: input.fallbackCommands,
  });

  return {
    available: resolution.command !== null,
    command: resolution.command,
    source: resolution.source,
    reason: resolution.command ? input.availableReason : input.missingReason,
  };
}

async function resolveCommand(input: {
  configCommand?: string | null;
  envValue?: string | null;
  fallbackCommands: string[];
}): Promise<{ command: string | null; source: ParserToolDiscoverySource }> {
  const normalizedConfigCommand = normalizeNullableString(input.configCommand);
  if (normalizedConfigCommand) {
    const command = await resolveExecutable([normalizedConfigCommand]);
    if (command) {
      return {
        command,
        source: "config",
      };
    }
  }

  const normalizedEnvValue = normalizeNullableString(input.envValue);
  if (normalizedEnvValue) {
    const command = await resolveExecutable([normalizedEnvValue]);
    if (command) {
      return {
        command,
        source: "env",
      };
    }
  }

  const command = await resolveExecutable(input.fallbackCommands);
  if (command) {
    return {
      command,
      source: "system",
    };
  }

  if (normalizedConfigCommand) {
    return {
      command: null,
      source: "config",
    };
  }

  if (normalizedEnvValue) {
    return {
      command: null,
      source: "env",
    };
  }

  return {
    command: null,
    source: "missing",
  };
}

function resolveModelPath(
  configModelPath?: string | null,
  envValue?: string | null,
): { modelPath: string | null; source: ParserToolDiscoverySource } {
  const normalizedConfigModelPath = normalizeNullableString(configModelPath);
  if (normalizedConfigModelPath) {
    return {
      modelPath: normalizedConfigModelPath,
      source: "config",
    };
  }

  const normalizedEnvValue = normalizeNullableString(envValue);
  if (normalizedEnvValue) {
    return {
      modelPath: normalizedEnvValue,
      source: "env",
    };
  }

  return {
    modelPath: null,
    source: "missing",
  };
}

function selectCompositeSource(
  commandSource: ParserToolDiscoverySource,
  modelSource: ParserToolDiscoverySource,
): ParserToolDiscoverySource {
  if (commandSource === "config" || modelSource === "config") {
    return "config";
  }

  if (commandSource === "env" || modelSource === "env") {
    return "env";
  }

  if (commandSource === "system") {
    return "system";
  }

  return "missing";
}

function toCommandCandidates(command: string | null | undefined): string[] | undefined {
  const normalized = normalizeNullableString(command);
  return normalized ? [normalized] : undefined;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
