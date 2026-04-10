import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  assertPathWithinVaultOnDisk,
  isVaultError,
  normalizeRelativeVaultPath,
  resolveVaultPathOnDisk,
} from "@murphai/core";

import type { ParserArtifactRef, ParserArtifactSummary } from "./contracts/artifact.js";
import type { ParsedBlock, ParseBlockKind } from "./contracts/parse.js";
import type { ProviderAvailability } from "./contracts/provider.js";

const USER_PATH_PATTERNS = [
  /^\/Users\/[^/]+/u,
  /^\/home\/[^/]+/u,
  /^[A-Za-z]:\\Users\\[^\\]+/u,
];

const SAFE_CHILD_PROCESS_ENV_KEYS = new Set([
  "APPDATA",
  "ComSpec",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "windir",
]);
const SAFE_CHILD_PROCESS_ENV_PREFIXES = ["LC_"];

export function sanitizeChildProcessEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") {
      continue;
    }

    if (
      SAFE_CHILD_PROCESS_ENV_KEYS.has(key) ||
      SAFE_CHILD_PROCESS_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      nextEnv[key] = value;
    }
  }

  return nextEnv;
}

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true });
}

export async function removeDirectoryIfExists(directoryPath: string): Promise<void> {
  await fs.rm(directoryPath, { recursive: true, force: true });
}

export async function resetDirectory(directoryPath: string): Promise<void> {
  await removeDirectoryIfExists(directoryPath);
  await ensureDirectory(directoryPath);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readUtf8IfExists(filePath: string): Promise<string | null> {
  if (!(await fileExists(filePath))) {
    return null;
  }

  return fs.readFile(filePath, "utf8");
}

export function normalizeRelativePath(relativePath: string): string {
  try {
    return normalizeRelativeVaultPath(relativePath);
  } catch (error) {
    throw toTypeError(error);
  }
}

export async function resolveVaultRelativePath(vaultRoot: string, relativePath: string): Promise<string> {
  try {
    const resolved = await resolveVaultPathOnDisk(vaultRoot, relativePath);
    return resolved.absolutePath;
  } catch (error) {
    throw toTypeError(error);
  }
}

export async function assertVaultPathOnDisk(vaultRoot: string, absolutePath: string): Promise<void> {
  try {
    await assertPathWithinVaultOnDisk(vaultRoot, absolutePath);
  } catch (error) {
    throw toTypeError(error);
  }
}

export async function removeVaultDirectoryIfExists(
  vaultRoot: string,
  relativePath: string,
): Promise<void> {
  await fs.rm(await resolveVaultRelativePath(vaultRoot, relativePath), {
    recursive: true,
    force: true,
  });
}

export async function resetVaultDirectory(
  vaultRoot: string,
  relativePath: string,
): Promise<string> {
  const absolutePath = await resolveVaultRelativePath(vaultRoot, relativePath);
  await fs.rm(absolutePath, { recursive: true, force: true });
  await assertVaultPathOnDisk(vaultRoot, absolutePath);
  await fs.mkdir(absolutePath, { recursive: true });
  await assertVaultPathOnDisk(vaultRoot, absolutePath);
  return absolutePath;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: sanitizeChildProcessEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? 0;
      if (exitCode !== 0) {
        reject(new Error(`Command failed (${path.basename(command)}): ${redactSensitiveText(stderr.trim() || stdout.trim() || `exit ${exitCode}`)}`));
        return;
      }

      resolve({ stdout, stderr, exitCode });
    });
  });
}

export async function resolveExecutable(candidates: string[]): Promise<string | null> {
  const unique = [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];

  for (const candidate of unique) {
    if (candidate.includes(path.sep) || path.isAbsolute(candidate)) {
      if (await fileExists(candidate)) {
        return candidate;
      }
      continue;
    }

    const locator = process.platform === "win32" ? "where" : "which";
    try {
      const result = await runCommand(locator, [candidate]);
      const firstLine = result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
      if (firstLine) {
        return firstLine;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function resolveConfiguredExecutable(input: {
  explicitCandidates?: string[];
  envValue?: string | null | undefined | (() => string | null | undefined);
  fallbackCommands?: string[];
}): Promise<string | null> {
  const envValue = typeof input.envValue === "function" ? input.envValue() : input.envValue;
  return resolveExecutable([
    ...(input.explicitCandidates ?? []),
    envValue ?? "",
    ...(input.fallbackCommands ?? []),
  ]);
}

export function readConfiguredEnvValue(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export function describeExecutableAvailability(input: {
  executablePath: string | null;
  availableReason: string;
  missingReason: string;
}): ProviderAvailability {
  return input.executablePath
    ? {
        available: true,
        reason: input.availableReason,
        executablePath: input.executablePath,
      }
    : {
        available: false,
        reason: input.missingReason,
      };
}

export function requireExecutable(executablePath: string | null, missingMessage: string): string {
  if (!executablePath) {
    throw new TypeError(missingMessage);
  }

  return executablePath;
}

export function isTextLikeArtifact(fileName: string | null | undefined, mime: string | null | undefined): boolean {
  const extension = path.extname(fileName ?? "").toLowerCase();
  if ([".csv", ".html", ".htm", ".json", ".md", ".markdown", ".txt", ".tsv", ".xml", ".yaml", ".yml"].includes(extension)) {
    return true;
  }

  const normalizedMime = String(mime ?? "").toLowerCase();
  return (
    normalizedMime.startsWith("text/") ||
    normalizedMime === "application/json" ||
    normalizedMime === "application/xml" ||
    normalizedMime === "application/yaml"
  );
}

export function redactSensitiveText(text: string): string {
  if (!text) {
    return text;
  }

  return text
    .split(/\s+/u)
    .map((token) => redactToken(token))
    .join(" ");
}

export function splitTextIntoBlocks(
  text: string,
  options: { defaultKind?: Extract<ParseBlockKind, "line" | "paragraph" | "segment"> } = {},
): ParsedBlock[] {
  const defaultKind = options.defaultKind ?? "paragraph";
  const sections =
    defaultKind === "line"
      ? text.split(/\r?\n/u)
      : text.split(/\r?\n\s*\r?\n/u);

  return sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .map((section, index) => ({
      id: `blk_${String(index + 1).padStart(4, "0")}`,
      kind: inferMarkdownBlockKind(section, defaultKind),
      text: section,
      order: index,
    }));
}

function toTypeError(error: unknown): Error {
  if (error instanceof Error && isVaultError(error)) {
    return new TypeError(error.message);
  }

  return error instanceof Error ? error : new TypeError(String(error));
}

export function buildMarkdown(text: string, blocks: ParsedBlock[]): string {
  if (blocks.length === 0) {
    return text.trim();
  }

  return blocks
    .map((block) => {
      if (block.kind === "heading") {
        return `## ${block.text}`;
      }
      if (block.kind === "list_item") {
        return `- ${block.text.replace(/^-\s+/u, "")}`;
      }
      return block.text;
    })
    .join("\n\n")
    .trim();
}

export async function collectFilesRecursively(directoryPath: string): Promise<string[]> {
  if (!(await fileExists(directoryPath))) {
    return [];
  }

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(absolutePath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

export function toArtifactSummary(artifact: ParserArtifactRef): ParserArtifactSummary {
  return {
    captureId: artifact.captureId,
    attachmentId: artifact.attachmentId,
    kind: artifact.kind,
    mime: artifact.mime ?? null,
    fileName: artifact.fileName ?? null,
    storedPath: artifact.storedPath,
  };
}

function inferMarkdownBlockKind(
  text: string,
  fallback: Extract<ParseBlockKind, "line" | "paragraph" | "segment">,
): ParsedBlock["kind"] {
  if (/^#{1,6}\s+/u.test(text)) {
    return "heading";
  }

  if (/^[-*+]\s+/u.test(text) || /^\d+\.\s+/u.test(text)) {
    return "list_item";
  }

  return fallback;
}

function redactToken(token: string): string {
  const normalized = token.trim();
  if (!normalized) {
    return token;
  }

  const withoutQuotes = normalized.replace(/^['"]|['"]$/gu, "");
  if (USER_PATH_PATTERNS.some((pattern) => pattern.test(withoutQuotes))) {
    return token.replace(withoutQuotes, "<REDACTED_PATH>");
  }

  return token;
}
