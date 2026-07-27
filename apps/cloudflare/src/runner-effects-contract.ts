import type {
  HostedRuntimeProviderFileResponse,
  HostedRuntimeTelegramCleanupMessage,
  HostedRuntimeTelegramDownloadFileRequest,
  HostedRuntimeTelegramFile,
  HostedRuntimeTelegramGetFileRequest,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  isHostedRuntimePrivateImageDeliveryUrl,
} from "@murphai/hosted-execution/runtime-control";

export const HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH =
  "/telegram/files/get";
export const HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH =
  "/telegram/files/download";
export const HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH =
  "/generated-images";
export const HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH =
  "/private-image-urls";

const PROVIDER_EFFECT_PATHS = new Set([
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
]);

export interface HostedRunnerProviderEffectErrorResponse {
  cleanupMessages?: HostedRuntimeTelegramCleanupMessage[];
  cleanupTargetAliases?: string[];
  code?: string;
  context?: Record<string, unknown>;
  deliveryMayHaveSucceeded?: boolean;
  error: string;
  providerMessageId?: string | null;
  providerMessageIds?: string[];
  retryable?: boolean;
  target?: string;
}

export interface HostedRunnerPrivateImageUrlPublishRequest {
  bytesBase64: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

export interface HostedRunnerPrivateImageUrlPublishResponse {
  expiresAt: string;
  url: string;
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

export function parseHostedRunnerPrivateImageUrlPublishRequest(
  value: unknown,
): HostedRunnerPrivateImageUrlPublishRequest {
  const record = requireRecord(value, "Hosted private image URL publish request");
  const contentType = readRequiredString(record.contentType, "contentType");
  if (
    contentType !== "image/jpeg"
    && contentType !== "image/png"
    && contentType !== "image/webp"
  ) {
    throw new TypeError(
      "Hosted runner private image URL publish contentType is unsupported.",
    );
  }
  return {
    bytesBase64: readRequiredString(record.bytesBase64, "bytesBase64"),
    contentType,
  };
}

export function parseHostedRunnerPrivateImageUrlPublishResponse(
  value: unknown,
): HostedRunnerPrivateImageUrlPublishResponse {
  const record = requireRecord(value, "Hosted private image URL publish response");
  const expiresAt = readRequiredString(record.expiresAt, "expiresAt");
  const urlString = readRequiredString(record.url, "url");
  const expiresAtMs = Date.parse(expiresAt);
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new TypeError("Hosted private image URL publish response URL is invalid.");
  }
  if (
    !Number.isFinite(expiresAtMs)
    || !isHostedRuntimePrivateImageDeliveryUrl(url)
    || Number(url.searchParams.get("exp")) * 1_000 !== expiresAtMs
  ) {
    throw new TypeError(
      "Hosted private image URL publish response is invalid.",
    );
  }
  return {
    expiresAt: new Date(expiresAtMs).toISOString(),
    url: url.toString(),
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
    ...(typeof record.deliveryMayHaveSucceeded === "boolean"
      ? { deliveryMayHaveSucceeded: record.deliveryMayHaveSucceeded }
      : {}),
    ...(record.providerMessageId === null || typeof record.providerMessageId === "string"
      ? { providerMessageId: record.providerMessageId }
      : {}),
    ...(Array.isArray(record.providerMessageIds)
      ? { providerMessageIds: readRequiredStringArray(record.providerMessageIds, "providerMessageIds") }
      : {}),
    ...(Array.isArray(record.cleanupTargetAliases)
      ? { cleanupTargetAliases: readRequiredStringArray(record.cleanupTargetAliases, "cleanupTargetAliases") }
      : {}),
    ...(typeof record.retryable === "boolean" ? { retryable: record.retryable } : {}),
    ...(Array.isArray(record.cleanupMessages)
      ? { cleanupMessages: parseCleanupMessages(record.cleanupMessages) }
      : {}),
    ...(typeof record.target === "string" && record.target.trim().length > 0
      ? { target: record.target.trim() }
      : {}),
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

function readRequiredStringRecord(
  value: unknown,
  label: string,
): Record<string, string> {
  const record = requireRecord(
    value,
    `Hosted runner provider effect ${label}`,
  );
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new TypeError(
        `Hosted runner provider effect ${label} keys must not be blank.`,
      );
    }
    result[normalizedKey] = readRequiredString(entry, `${label}.${normalizedKey}`);
  }
  return result;
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
