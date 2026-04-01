import path from "node:path";
import { promises as fs } from "node:fs";

import { resolveRuntimePaths } from "@murphai/runtime-state/node";

import { ensureDirectory, fileExists, readUtf8IfExists } from "../shared.js";

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
  configPath: string;
}

export interface WriteParserToolchainConfigInput {
  vaultRoot: string;
  tools?: Partial<Record<ParserToolName, ParserToolchainToolConfig>>;
  now?: Date;
}

export function getParserToolchainPaths(vaultRoot: string): ParserToolchainPaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);
  const parsersRoot = path.join(runtimePaths.runtimeRoot, "parsers");

  return {
    runtimeRoot: runtimePaths.runtimeRoot,
    parsersRoot,
    configPath: path.join(parsersRoot, "toolchain.json"),
  };
}

export async function readParserToolchainConfig(
  vaultRoot: string,
): Promise<{ config: ParserToolchainConfig; configPath: string } | null> {
  const paths = getParserToolchainPaths(vaultRoot);
  if (!(await fileExists(paths.configPath))) {
    return null;
  }

  const raw = await readUtf8IfExists(paths.configPath);
  if (raw === null) {
    return null;
  }

  return {
    config: parseParserToolchainConfig(JSON.parse(raw) as unknown),
    configPath: paths.configPath,
  };
}

export async function writeParserToolchainConfig(
  input: WriteParserToolchainConfigInput,
): Promise<{ config: ParserToolchainConfig; configPath: string }> {
  const paths = getParserToolchainPaths(input.vaultRoot);
  const existing = await readParserToolchainConfig(input.vaultRoot);
  const mergedTools = mergeToolConfigs(existing?.config.tools ?? {}, input.tools ?? {});
  const config: ParserToolchainConfig = {
    version: PARSER_TOOLCHAIN_VERSION,
    updatedAt: (input.now ?? new Date()).toISOString(),
    tools: mergedTools,
  };

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
