import type {
  AssistantResponseMedia,
  HostedRuntimeProviderFileResponse,
  HostedRuntimeTelegramCleanupMessage,
  HostedRuntimeTelegramDownloadFileRequest,
  HostedRuntimeTelegramFile,
  HostedRuntimeTelegramGetFileRequest,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  parseHostedRuntimeAssistantResponseMedia,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";

export const HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH =
  "/telegram/files/get";
export const HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH =
  "/telegram/files/download";
export const HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH =
  "/generated-images";

const PROVIDER_EFFECT_PATHS = new Set([
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
]);

export interface HostedRunnerProviderEffectErrorResponse {
  cleanupMessages?: HostedRuntimeTelegramCleanupMessage[];
  cleanupTargetAliases?: string[];
  code?: string;
  context?: Record<string, unknown>;
  error: string;
  providerMessageId?: string | null;
  providerMessageIds?: string[];
  target?: string;
}

export interface HostedRunnerGeneratedImageUploadRequest {
  alt: string | null;
  bytesBase64: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  filename: string;
  metadata: Record<string, string>;
  source: string;
}

export interface HostedRunnerGeneratedImageUploadResponse {
  media: AssistantResponseMedia;
}

export function isHostedRunnerProviderEffectPath(pathname: string): boolean {
  return PROVIDER_EFFECT_PATHS.has(pathname);
}

export function parseHostedRunnerTelegramGetFileRequest(
  value: unknown,
): HostedRuntimeTelegramGetFileRequest {
  const record = requireRecord(value, "Hosted Telegram get-file request");
  return {
    fileId: readRequiredString(record.fileId, "fileId"),
  };
}

export function parseHostedRunnerTelegramGetFileResponse(
  value: unknown,
): { file: HostedRuntimeTelegramFile | null } {
  const record = requireRecord(value, "Hosted Telegram get-file response");
  return {
    file: record.file === null || record.file === undefined
      ? null
      : parseTelegramFile(record.file),
  };
}

export function parseHostedRunnerTelegramDownloadFileRequest(
  value: unknown,
): HostedRuntimeTelegramDownloadFileRequest {
  const record = requireRecord(value, "Hosted Telegram download-file request");
  return {
    filePath: readRequiredString(record.filePath, "filePath"),
  };
}

export function parseHostedRunnerTelegramDownloadFileResponse(
  value: unknown,
): { file: HostedRuntimeProviderFileResponse | null } {
  const record = requireRecord(value, "Hosted Telegram download-file response");
  return {
    file: record.file === null || record.file === undefined
      ? null
      : parseProviderFile(record.file),
  };
}

export function parseHostedRunnerProviderEffectErrorResponse(
  value: unknown,
): HostedRunnerProviderEffectErrorResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.error !== "string" || record.error.trim().length === 0) {
    return null;
  }

  const context = record.context && typeof record.context === "object" && !Array.isArray(record.context)
    ? { ...(record.context as Record<string, unknown>) }
    : undefined;
  return {
    error: record.error,
    ...(typeof record.code === "string" && record.code.trim().length > 0
      ? { code: record.code }
      : {}),
    ...(context ? { context } : {}),
    ...(record.providerMessageId === null || typeof record.providerMessageId === "string"
      ? { providerMessageId: record.providerMessageId }
      : {}),
    ...(Array.isArray(record.providerMessageIds)
      ? { providerMessageIds: readRequiredStringArray(record.providerMessageIds, "providerMessageIds") }
      : {}),
    ...(Array.isArray(record.cleanupTargetAliases)
      ? { cleanupTargetAliases: readRequiredStringArray(record.cleanupTargetAliases, "cleanupTargetAliases") }
      : {}),
    ...(Array.isArray(record.cleanupMessages)
      ? { cleanupMessages: parseCleanupMessages(record.cleanupMessages) }
      : {}),
    ...(typeof record.target === "string" && record.target.trim().length > 0
      ? { target: record.target.trim() }
      : {}),
  };
}

export function parseHostedRunnerGeneratedImageUploadRequest(
  value: unknown,
): HostedRunnerGeneratedImageUploadRequest {
  const record = requireRecord(value, "Hosted generated image upload request");
  return {
    alt: readOptionalString(record.alt, "alt"),
    bytesBase64: readRequiredString(record.bytesBase64, "bytesBase64"),
    contentType: readGeneratedImageContentType(record.contentType),
    filename: readRequiredString(record.filename, "filename"),
    metadata: readRequiredStringRecord(record.metadata, "metadata"),
    source: readRequiredString(record.source, "source"),
  };
}

export function parseHostedRunnerGeneratedImageUploadResponse(
  value: unknown,
): HostedRunnerGeneratedImageUploadResponse {
  const record = requireRecord(value, "Hosted generated image upload response");
  return {
    media: parseHostedRuntimeAssistantResponseMedia(record.media),
  };
}

function parseProviderFile(value: unknown): HostedRuntimeProviderFileResponse {
  const record = requireRecord(value, "Hosted provider file response");
  return {
    bytesBase64: readRequiredString(record.bytesBase64, "bytesBase64"),
    contentType: readOptionalString(record.contentType, "contentType"),
    fileName: readOptionalString(record.fileName, "fileName"),
    sha256: readRequiredString(record.sha256, "sha256"),
  };
}

function readGeneratedImageContentType(
  value: unknown,
): HostedRunnerGeneratedImageUploadRequest["contentType"] {
  if (value === "image/jpeg" || value === "image/png" || value === "image/webp") {
    return value;
  }

  throw new TypeError("Hosted generated image contentType is unsupported.");
}

function readRequiredStringRecord(
  value: unknown,
  label: string,
): Record<string, string> {
  const record = requireRecord(value, `Hosted generated image ${label}`);
  const parsed: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const normalizedKey = readRequiredString(key, `${label} key`);
    parsed[normalizedKey] = readRequiredString(entry, `${label}.${normalizedKey}`);
  }
  return parsed;
}

function parseTelegramFile(value: unknown): HostedRuntimeTelegramFile {
  const record = requireRecord(value, "Hosted Telegram file");
  return {
    file_id: readRequiredString(record.file_id, "file_id"),
    ...(record.file_path === undefined
      ? {}
      : { file_path: readRequiredString(record.file_path, "file_path") }),
    ...(record.file_size === undefined
      ? {}
      : { file_size: readNonNegativeInteger(record.file_size, "file_size") }),
    ...(record.file_unique_id === undefined
      ? {}
      : { file_unique_id: readRequiredString(record.file_unique_id, "file_unique_id") }),
  };
}

function parseCleanupMessages(value: readonly unknown[]): HostedRuntimeTelegramCleanupMessage[] {
  return value.map((entry) => {
    const record = requireRecord(entry, "Hosted Telegram cleanup message");
    return {
      messageId: readRequiredString(record.messageId, "cleanup messageId"),
      target: readRequiredString(record.target, "cleanup target"),
    };
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Hosted runner provider effect ${label} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`Hosted runner provider effect ${label} must be a non-empty string.`);
  }
  return normalized;
}

function readOptionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return readRequiredString(value, label);
}

function readRequiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Hosted runner provider effect ${label} must be a string array.`);
  }
  const strings = value.map((entry) => readRequiredString(entry, label));
  return [...new Set(strings)];
}

function readOptionalStringArray(value: unknown, label: string): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  return readRequiredStringArray(value, label);
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`Hosted runner provider effect ${label} must be a non-negative integer.`);
  }
  return value as number;
}
