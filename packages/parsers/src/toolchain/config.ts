import path from "node:path";
import { promises as fs } from "node:fs";

import {
  hasLocalStatePath,
  promoteLegacyLocalStateDirectory,
  readLocalStateTextFileWithFallback,
  resolveParserRuntimePaths,
} from "@murphai/runtime-state/node";

import { ensureDirectory } from "../shared.js";

export const PARSER_TOOLCHAIN_VERSION = 1 as const;

export type ParserToolName = "ffmpeg" | "pdftotext" | "whisper";

export interface ParserToolchainToolConfig {
  command?: string | null;
  modelPath?: string | null;
}

export interface ParserToolchainConfig {
  version: typeof PARSER_TOOLCHAIN_VERSION;
  updatedAt: string;
  tools: Partial<Record<ParserToolName, ParserToolchainToolConfig>>;
}

export interface ParserToolchainPaths {
  runtimeRoot: string;
  parsersRoot: string;
  legacyParsersRoot: string;
  configPath: string;
  legacyConfigPath: string;
}

export interface WriteParserToolchainConfigInput {
  vaultRoot: string;
  tools?: Partial<Record<ParserToolName, ParserToolchainToolConfig>>;
  now?: Date;
}

export function getParserToolchainPaths(vaultRoot: string): ParserToolchainPaths {
  const runtimePaths = resolveParserRuntimePaths(vaultRoot);

  return {
    runtimeRoot: runtimePaths.runtimeRoot,
    parsersRoot: runtimePaths.parserRuntimeRoot,
    legacyParsersRoot: runtimePaths.parserRuntimeLegacyRoot,
    configPath: runtimePaths.parserToolchainConfigPath,
    legacyConfigPath: runtimePaths.parserToolchainConfigLegacyPath,
  };
}

export async function readParserToolchainConfig(
  vaultRoot: string,
): Promise<{ config: ParserToolchainConfig; configPath: string } | null> {
  const paths = getParserToolchainPaths(vaultRoot);
  if (!(await hasLocalStatePath({
    currentPath: paths.configPath,
    legacyPath: paths.legacyConfigPath,
  }))) {
    return null;
  }

  const { path: configPath, text: raw } = await readLocalStateTextFileWithFallback({
    currentPath: paths.configPath,
    legacyPath: paths.legacyConfigPath,
  });
  const config = parseParserToolchainConfig(JSON.parse(raw) as unknown);
  await validateParserToolchainPaths(vaultRoot, config.tools);

  return {
    config,
    configPath,
  };
}

export async function writeParserToolchainConfig(
  input: WriteParserToolchainConfigInput,
): Promise<{ config: ParserToolchainConfig; configPath: string }> {
  const paths = getParserToolchainPaths(input.vaultRoot);
  const existing = await readParserToolchainConfig(input.vaultRoot);
  const mergedTools = mergeToolConfigs(existing?.config.tools ?? {}, input.tools ?? {});
  await validateParserToolchainPaths(input.vaultRoot, mergedTools);
  const config: ParserToolchainConfig = {
    version: PARSER_TOOLCHAIN_VERSION,
    updatedAt: (input.now ?? new Date()).toISOString(),
    tools: mergedTools,
  };

  await promoteLegacyLocalStateDirectory({
    currentPath: paths.parsersRoot,
    legacyPath: paths.legacyParsersRoot,
  });
  await ensureDirectory(paths.parsersRoot);
  await fs.writeFile(
    paths.configPath,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );

  return {
    config,
    configPath: paths.configPath,
  };
}

async function validateParserToolchainPaths(
  vaultRoot: string,
  tools: Partial<Record<ParserToolName, ParserToolchainToolConfig>>,
): Promise<void> {
  const whisperModelPath = normalizeNullableString(tools.whisper?.modelPath);

  if (!whisperModelPath || path.isAbsolute(whisperModelPath)) {
    return;
  }

  const absoluteVaultRoot = path.resolve(vaultRoot);
  const resolvedPath = path.resolve(absoluteVaultRoot, whisperModelPath);
  const relativeToVault = path.relative(absoluteVaultRoot, resolvedPath);

  if (
    relativeToVault === ".."
    || relativeToVault.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeToVault)
  ) {
    throw parserWhisperModelPathOutsideVaultError();
  }

  await assertParserPathWithinVaultOnDisk(absoluteVaultRoot, resolvedPath);
}

async function assertParserPathWithinVaultOnDisk(
  absoluteVaultRoot: string,
  absolutePath: string,
): Promise<void> {
  const canonicalRoot = await fs.realpath(absoluteVaultRoot);
  const relativeToVault = path.relative(absoluteVaultRoot, absolutePath);

  if (!relativeToVault) {
    return;
  }

  const segments = relativeToVault.split(path.sep).filter(Boolean);
  let currentPath = canonicalRoot;

  for (const segment of segments) {
    const nextPath = path.join(currentPath, segment);

    try {
      const stats = await fs.lstat(nextPath);
      if (stats.isSymbolicLink()) {
        throw parserWhisperModelPathOutsideVaultError();
      }

      currentPath = await fs.realpath(nextPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return;
      }

      throw error;
    }
  }
}

function parserWhisperModelPathOutsideVaultError(): TypeError {
  return new TypeError(
    'Parser tool "whisper" modelPath relative paths must stay inside the vault root. Use an absolute path to reference a shared model outside the vault.',
  );
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function parseParserToolchainConfig(value: unknown): ParserToolchainConfig {
  if (!isPlainObject(value)) {
    throw new TypeError("Parser toolchain config must be an object.");
  }

  if (value.version !== PARSER_TOOLCHAIN_VERSION) {
    throw new TypeError(`Parser toolchain config version must be ${PARSER_TOOLCHAIN_VERSION}.`);
  }

  const updatedAt = requireNonEmptyString(value.updatedAt, "Parser toolchain config updatedAt must be a string.");
  const rawTools = value.tools;
  if (!isPlainObject(rawTools)) {
    throw new TypeError("Parser toolchain config tools must be an object.");
  }

  const tools: Partial<Record<ParserToolName, ParserToolchainToolConfig>> = {};
  for (const toolName of parserToolNames) {
    const rawTool = rawTools[toolName];
    if (rawTool === undefined) {
      continue;
    }

    tools[toolName] = parseToolConfig(rawTool, toolName);
  }

  return {
    version: PARSER_TOOLCHAIN_VERSION,
    updatedAt,
    tools,
  };
}

function parseToolConfig(value: unknown, toolName: ParserToolName): ParserToolchainToolConfig {
  if (!isPlainObject(value)) {
    throw new TypeError(`Parser tool "${toolName}" config must be an object.`);
  }

  const config: ParserToolchainToolConfig = {};
  if ("command" in value) {
    config.command = normalizeConfigString(value.command, `Parser tool "${toolName}" command must be a string, null, or omitted.`);
  }
  if ("modelPath" in value) {
    config.modelPath = normalizeConfigString(value.modelPath, `Parser tool "${toolName}" modelPath must be a string, null, or omitted.`);
  }

  return config;
}

function mergeToolConfigs(
  current: Partial<Record<ParserToolName, ParserToolchainToolConfig>>,
  updates: Partial<Record<ParserToolName, ParserToolchainToolConfig>>,
): Partial<Record<ParserToolName, ParserToolchainToolConfig>> {
  const merged: Partial<Record<ParserToolName, ParserToolchainToolConfig>> = {};

  for (const toolName of parserToolNames) {
    const nextTool = mergeToolConfig(current[toolName], updates[toolName]);
    if (nextTool) {
      merged[toolName] = nextTool;
    }
  }

  return merged;
}

function mergeToolConfig(
  current: ParserToolchainToolConfig | undefined,
  update: ParserToolchainToolConfig | undefined,
): ParserToolchainToolConfig | null {
  if (!current && !update) {
    return null;
  }

  const next: ParserToolchainToolConfig = {};
  if (current?.command !== undefined) {
    next.command = current.command;
  }
  if (current?.modelPath !== undefined) {
    next.modelPath = current.modelPath;
  }

  if (update) {
    if (Object.prototype.hasOwnProperty.call(update, "command")) {
      const normalized = normalizeNullableString(update.command);
      if (normalized === null) {
        delete next.command;
      } else {
        next.command = normalized;
      }
    }

    if (Object.prototype.hasOwnProperty.call(update, "modelPath")) {
      const normalized = normalizeNullableString(update.modelPath);
      if (normalized === null) {
        delete next.modelPath;
      } else {
        next.modelPath = normalized;
      }
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}

function normalizeConfigString(value: unknown, errorMessage: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(errorMessage);
  }

  return normalizeNullableString(value);
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmptyString(value: unknown, errorMessage: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(errorMessage);
  }

  return value.trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const parserToolNames = [
  "ffmpeg",
  "pdftotext",
  "whisper",
] as const satisfies readonly ParserToolName[];
