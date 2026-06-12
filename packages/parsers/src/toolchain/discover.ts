import { promises as fs } from "node:fs";
import path from "node:path";

import type { FfmpegToolOptions } from "../adapters/ffmpeg.js";
import { createPopplerPdfProvider } from "../adapters/poppler-pdf.js";
import { createRemoteTranscriptionProvider } from "../adapters/remote-transcription.js";
import { createTextFileProvider } from "../adapters/text-file.js";
import { createWhisperCppProvider } from "../adapters/whisper-cpp.js";
import { createZxingWasmProvider } from "../adapters/zxing-wasm.js";
import type { ParserRegistry } from "../registry/registry.js";
import { createParserRegistry } from "../registry/registry.js";
import { readConfiguredEnvValue, resolveExecutable } from "../shared.js";
import type {
  ParserToolName,
  ParserToolchainConfig,
  ParserToolchainToolConfig,
  ParserToolchainTools,
} from "./config.js";
import {
  getParserToolchainPaths,
  readParserToolchainConfig,
} from "./config.js";

export type ParserToolDiscoverySource = "config" | "env" | "platform" | "system" | "missing";

export interface ParserToolchainRuntimeConfig {
  source: "config" | "platform";
  tools: ParserToolchainTools;
}

export interface ParserToolDiscovery {
  available: boolean;
  command: string | null;
  endpoint?: string | null;
  modelPath?: string | null;
  source: ParserToolDiscoverySource;
  reason: string;
}

export interface ParserDoctorReport {
  configPath: string;
  discoveredAt: string;
  tools: Record<ParserToolName, ParserToolDiscovery>;
}

interface ParserToolchainContext {
  allowEnvToolchain: boolean;
  allowSystemToolchainLookup: boolean;
  config: ParserToolchainConfig | null;
  configPath: string;
  configSource: "config" | "platform";
}

interface ResolvedWhisperToolDiscovery extends ParserToolDiscovery {
  absoluteModelPath: string | null;
}

export async function discoverParserToolchain(input: {
  allowEnvToolchain?: boolean;
  allowSystemToolchainLookup?: boolean;
  readVaultToolchainConfig?: boolean;
  toolchain?: ParserToolchainRuntimeConfig;
  vaultRoot: string;
}): Promise<ParserDoctorReport> {
  const context = await loadParserToolchainContext(input);

  return discoverParserToolchainFromContext({
    allowEnvToolchain: context.allowEnvToolchain,
    allowSystemToolchainLookup: context.allowSystemToolchainLookup,
    config: context.config,
    configPath: context.configPath,
    configSource: context.configSource,
    vaultRoot: input.vaultRoot,
  });
}

async function discoverParserToolchainFromContext(input: {
  allowEnvToolchain: boolean;
  allowSystemToolchainLookup: boolean;
  config: ParserToolchainConfig | null;
  configPath: string;
  configSource: "config" | "platform";
  vaultRoot: string;
}): Promise<ParserDoctorReport> {
  const state = await discoverParserToolchainStateFromContext(input);
  return state.doctor;
}

async function discoverParserToolchainStateFromContext(input: {
  allowEnvToolchain: boolean;
  allowSystemToolchainLookup: boolean;
  config: ParserToolchainConfig | null;
  configPath: string;
  configSource: "config" | "platform";
  vaultRoot: string;
}): Promise<{
  doctor: ParserDoctorReport;
  whisper: ResolvedWhisperToolDiscovery;
}> {
  const ffmpeg = await discoverCommandTool({
    allowSystemToolchainLookup: input.allowSystemToolchainLookup,
    config: input.config?.tools.ffmpeg,
    configSource: input.configSource,
    vaultRoot: input.vaultRoot,
    envValue: input.allowEnvToolchain
      ? readConfiguredEnvValue(process.env, ["FFMPEG_COMMAND"])
      : null,
    fallbackCommands: ["ffmpeg"],
    availableReason: "ffmpeg CLI available.",
    missingReason: "ffmpeg CLI not found.",
  });
  const pdfinfo = await discoverCommandTool({
    allowSystemToolchainLookup: input.allowSystemToolchainLookup,
    config: input.config?.tools.pdfinfo,
    configSource: input.configSource,
    vaultRoot: input.vaultRoot,
    envValue: input.allowEnvToolchain
      ? readConfiguredEnvValue(process.env, ["PDFINFO_COMMAND"])
      : null,
    fallbackCommands: ["pdfinfo"],
    availableReason: "pdfinfo CLI available.",
    missingReason: "pdfinfo CLI not found.",
  });
  const pdftotext = await discoverCommandTool({
    allowSystemToolchainLookup: input.allowSystemToolchainLookup,
    config: input.config?.tools.pdftotext,
    configSource: input.configSource,
    vaultRoot: input.vaultRoot,
    envValue: input.allowEnvToolchain
      ? readConfiguredEnvValue(process.env, ["PDFTOTEXT_COMMAND"])
      : null,
    fallbackCommands: ["pdftotext"],
    availableReason: "pdftotext CLI available.",
    missingReason: "pdftotext CLI not found.",
  });
  const whisper = await discoverWhisperTool({
    allowEnvToolchain: input.allowEnvToolchain,
    allowSystemToolchainLookup: input.allowSystemToolchainLookup,
    config: input.config,
    configSource: input.configSource,
    vaultRoot: input.vaultRoot,
  });
  const transcription = discoverTranscriptionTool({
    config: input.config,
    configSource: input.configSource,
  });

  return {
    doctor: {
      configPath: input.configPath,
      discoveredAt: new Date().toISOString(),
      tools: {
        ffmpeg,
        pdfinfo,
        pdftotext,
        transcription,
        whisper: toPublicWhisperToolDiscovery(whisper),
      },
    },
    whisper,
  };
}

export async function createConfiguredParserRegistry(input: {
  allowEnvToolchain?: boolean;
  allowSystemToolchainLookup?: boolean;
  readVaultToolchainConfig?: boolean;
  toolchain?: ParserToolchainRuntimeConfig;
  vaultRoot: string;
}): Promise<{
  doctor: ParserDoctorReport;
  registry: ParserRegistry;
  ffmpeg: FfmpegToolOptions | undefined;
}> {
  const context = await loadParserToolchainContext(input);
  const state = await discoverParserToolchainStateFromContext({
    allowEnvToolchain: context.allowEnvToolchain,
    allowSystemToolchainLookup: context.allowSystemToolchainLookup,
    config: context.config,
    configPath: context.configPath,
    configSource: context.configSource,
    vaultRoot: input.vaultRoot,
  });

  const transcriptionEndpoint = state.doctor.tools.transcription.endpoint ?? null;

  return {
    doctor: state.doctor,
    registry: createParserRegistry([
      createTextFileProvider(),
      createPopplerPdfProvider(popplerPdfOptionsFromDoctor(state.doctor)),
      createZxingWasmProvider(),
      createWhisperCppProvider(
        whisperProviderOptionsFromDiscovery(state.whisper),
      ),
      ...(transcriptionEndpoint
        ? [createRemoteTranscriptionProvider({ endpoint: transcriptionEndpoint })]
        : []),
    ]),
    ffmpeg: ffmpegOptionsFromDoctor(state.doctor),
  };
}

async function loadParserToolchainContext(input: {
  allowEnvToolchain?: boolean;
  allowSystemToolchainLookup?: boolean;
  readVaultToolchainConfig?: boolean;
  toolchain?: ParserToolchainRuntimeConfig;
  vaultRoot: string;
}): Promise<ParserToolchainContext> {
  const paths = getParserToolchainPaths(input.vaultRoot);
  if (input.toolchain) {
    return {
      allowEnvToolchain: input.allowEnvToolchain ?? false,
      allowSystemToolchainLookup: input.allowSystemToolchainLookup ?? false,
      config: {
        updatedAt: new Date(0).toISOString(),
        tools: input.toolchain.tools,
      },
      configPath: paths.configPath,
      configSource: input.toolchain.source,
    };
  }

  const loadedConfig = input.readVaultToolchainConfig === false
    ? null
    : await readParserToolchainConfig(input.vaultRoot);

  return {
    allowEnvToolchain: input.allowEnvToolchain ?? true,
    allowSystemToolchainLookup: input.allowSystemToolchainLookup ?? true,
    config: loadedConfig?.config ?? null,
    configPath: paths.configPath,
    configSource: "config",
  };
}

export function ffmpegOptionsFromDoctor(
  doctor: ParserDoctorReport,
): FfmpegToolOptions | undefined {
  const remoteTranscriptionOnly =
    doctor.tools.transcription.available && !doctor.tools.whisper.available;
  const command = normalizeNullableString(doctor.tools.ffmpeg.command);
  if (!command) {
    return remoteTranscriptionOnly
      ? { remoteTranscriptionOnly: true }
      : undefined;
  }

  return {
    commandCandidates: [command],
    allowSystemLookup:
      doctor.tools.ffmpeg.source !== "config"
      && doctor.tools.ffmpeg.source !== "platform",
    ...(remoteTranscriptionOnly ? { remoteTranscriptionOnly: true } : {}),
  };
}

export function popplerPdfOptionsFromDoctor(
  doctor: ParserDoctorReport,
) {
  const pdfInfoCommand = normalizeNullableString(doctor.tools.pdfinfo.command);
  const pdfToTextCommand = normalizeNullableString(doctor.tools.pdftotext.command);
  const available = Boolean(
    doctor.tools.pdfinfo.available &&
    doctor.tools.pdftotext.available &&
    pdfInfoCommand &&
    pdfToTextCommand,
  );

  return {
    resolvedToolState: {
      available,
      reason: available
        ? "Poppler PDF text extraction tools available."
        : !pdfInfoCommand
          ? doctor.tools.pdfinfo.reason
          : doctor.tools.pdftotext.reason,
      pdfInfoCommandPath: pdfInfoCommand,
      pdfToTextCommandPath: pdfToTextCommand,
    },
  };
}

async function discoverWhisperTool(input: {
  allowEnvToolchain: boolean;
  allowSystemToolchainLookup: boolean;
  config: ParserToolchainConfig | null;
  configSource: "config" | "platform";
  vaultRoot: string;
}): Promise<ResolvedWhisperToolDiscovery> {
  const toolConfig = input.config?.tools.whisper;
  const commandResolution = await resolveCommand({
    allowSystemToolchainLookup: input.allowSystemToolchainLookup,
    configCommand: toolConfig?.command,
    configSource: input.configSource,
    vaultRoot: input.vaultRoot,
    envValue: input.allowEnvToolchain
      ? readConfiguredEnvValue(process.env, ["WHISPER_COMMAND"])
      : null,
    fallbackCommands: ["whisper-cli", "whisper-cpp"],
  });
  const modelResolution = resolveModelPath(
    toolConfig?.modelPath,
    input.configSource,
    input.allowEnvToolchain
      ? readConfiguredEnvValue(process.env, ["WHISPER_MODEL_PATH"])
      : null,
  );
  const source = selectCompositeSource(commandResolution.source, modelResolution.source);
  const absoluteModelPath = modelResolution.modelPath
    ? resolveModelPathAbsolute(input.vaultRoot, modelResolution)
    : null;

  if (!commandResolution.command) {
    return {
      available: false,
      command: null,
      modelPath: modelResolution.modelPath,
      absoluteModelPath,
      source,
      reason: "whisper.cpp CLI executable not found.",
    };
  }

  if (!modelResolution.modelPath) {
    return {
      available: false,
      command: commandResolution.command,
      modelPath: null,
      absoluteModelPath: null,
      source,
      reason: "Whisper model path is not configured.",
    };
  }

  if (!absoluteModelPath || !(await fileExists(absoluteModelPath))) {
    return {
      available: false,
      command: commandResolution.command,
      modelPath: modelResolution.modelPath,
      absoluteModelPath,
      source,
      reason: "Whisper model path does not exist.",
    };
  }

  return {
    available: true,
    command: commandResolution.command,
    modelPath: modelResolution.modelPath,
    absoluteModelPath,
    source,
    reason: "whisper.cpp CLI and model path configured.",
  };
}

function discoverTranscriptionTool(input: {
  config: ParserToolchainConfig | null;
  configSource: "config" | "platform";
}): ParserToolDiscovery {
  const endpoint = normalizeNullableString(input.config?.tools.transcription?.endpoint);
  if (!endpoint) {
    return {
      available: false,
      command: null,
      endpoint: null,
      source: "missing",
      reason: "Remote transcription endpoint is not configured.",
    };
  }

  return {
    available: true,
    command: null,
    endpoint,
    source: input.configSource,
    reason: "Remote transcription endpoint configured.",
  };
}

async function discoverCommandTool(input: {
  allowSystemToolchainLookup: boolean;
  config?: ParserToolchainToolConfig;
  configSource: "config" | "platform";
  vaultRoot: string;
  envValue?: string | null;
  fallbackCommands: string[];
  availableReason: string;
  missingReason: string;
}): Promise<ParserToolDiscovery> {
  const resolution = await resolveCommand({
    allowSystemToolchainLookup: input.allowSystemToolchainLookup,
    configCommand: input.config?.command,
    configSource: input.configSource,
    vaultRoot: input.vaultRoot,
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
  allowSystemToolchainLookup: boolean;
  configCommand?: string | null;
  configSource: "config" | "platform";
  vaultRoot: string;
  envValue?: string | null;
  fallbackCommands: string[];
}): Promise<{ command: string | null; source: ParserToolDiscoverySource }> {
  const normalizedConfigCommand = normalizeNullableString(input.configCommand);
  if (normalizedConfigCommand) {
    return {
      command: await resolveExecutable([
        resolveConfigCommandCandidate(input.vaultRoot, normalizedConfigCommand),
      ]),
      source: input.configSource,
    };
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

  const command = input.allowSystemToolchainLookup
    ? await resolveExecutable(input.fallbackCommands)
    : null;
  if (command) {
    return {
      command,
      source: "system",
    };
  }

  if (normalizedConfigCommand) {
    return {
      command: null,
      source: input.configSource,
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
  configSource: "config" | "platform" = "config",
  envValue?: string | null,
): { modelPath: string | null; source: ParserToolDiscoverySource } {
  const normalizedConfigModelPath = normalizeNullableString(configModelPath);
  if (normalizedConfigModelPath) {
    return {
      modelPath: normalizedConfigModelPath,
      source: configSource,
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
  if (commandSource === "platform" || modelSource === "platform") {
    return "platform";
  }

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

function toPublicWhisperToolDiscovery(
  whisper: ResolvedWhisperToolDiscovery,
): ParserToolDiscovery {
  return {
    available: whisper.available,
    command: whisper.command,
    modelPath: whisper.modelPath,
    source: whisper.source,
    reason: whisper.reason,
  };
}

function whisperProviderOptionsFromDiscovery(
  whisper: ResolvedWhisperToolDiscovery,
) {
  return {
    resolvedToolState: {
      available: whisper.available,
      reason: whisper.reason,
      commandPath: whisper.command,
      modelPath: whisper.absoluteModelPath,
    },
  };
}

function resolveConfigCommandCandidate(
  vaultRoot: string,
  command: string,
): string {
  if (!isPathLikeCommandCandidate(command)) {
    return command;
  }

  const normalizedPath = command.replace(/[\\/]/gu, path.sep);
  if (path.isAbsolute(normalizedPath)) {
    return normalizedPath;
  }

  return path.resolve(vaultRoot, normalizedPath);
}

function isPathLikeCommandCandidate(command: string): boolean {
  return (
    command.includes("/") ||
    command.includes("\\") ||
    path.isAbsolute(command)
  );
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveModelPathAbsolute(
  vaultRoot: string,
  modelResolution: {
    modelPath: string | null;
    source: ParserToolDiscoverySource;
  },
): string {
  const modelPath = modelResolution.modelPath ?? "";
  if (path.isAbsolute(modelPath)) {
    return modelPath;
  }

  return modelResolution.source === "config"
    ? path.resolve(vaultRoot, modelPath)
    : path.resolve(modelPath);
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
