import type {
  HostedRuntimeLinqChatActionRequest,
  HostedRuntimeLinqDeleteMessagesRequest,
  HostedRuntimeLinqMarkReadRequest,
  HostedRuntimeLinqSendRequest,
  HostedRuntimeLinqSendResponse,
  HostedRuntimeProviderFileResponse,
  HostedRuntimeProviderTargetKind,
  HostedRuntimeTelegramChatActionRequest,
  HostedRuntimeTelegramCleanupMessage,
  HostedRuntimeTelegramDownloadFileRequest,
  HostedRuntimeTelegramFile,
  HostedRuntimeTelegramGetFileRequest,
  HostedRuntimeTelegramSendRequest,
  HostedRuntimeTelegramSendResponse,
  HostedRuntimeWhatsAppSendRequest,
  HostedRuntimeWhatsAppSendResponse,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";

export const HOSTED_EXECUTION_RUNNER_TELEGRAM_SEND_PATH =
  "/telegram/send";
export const HOSTED_EXECUTION_RUNNER_TELEGRAM_CHAT_ACTION_PATH =
  "/telegram/chat-action";
export const HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH =
  "/telegram/files/get";
export const HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH =
  "/telegram/files/download";
export const HOSTED_EXECUTION_RUNNER_LINQ_SEND_PATH =
  "/linq/send";
export const HOSTED_EXECUTION_RUNNER_LINQ_CHAT_ACTION_PATH =
  "/linq/chat-action";
export const HOSTED_EXECUTION_RUNNER_LINQ_MARK_READ_PATH =
  "/linq/chats/mark-read";
export const HOSTED_EXECUTION_RUNNER_LINQ_DELETE_MESSAGES_PATH =
  "/linq/messages/delete";
export const HOSTED_EXECUTION_RUNNER_WHATSAPP_SEND_PATH =
  "/whatsapp/send";

const PROVIDER_EFFECT_PATHS = new Set([
  HOSTED_EXECUTION_RUNNER_TELEGRAM_SEND_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_CHAT_ACTION_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_LINQ_SEND_PATH,
  HOSTED_EXECUTION_RUNNER_LINQ_CHAT_ACTION_PATH,
  HOSTED_EXECUTION_RUNNER_LINQ_MARK_READ_PATH,
  HOSTED_EXECUTION_RUNNER_LINQ_DELETE_MESSAGES_PATH,
  HOSTED_EXECUTION_RUNNER_WHATSAPP_SEND_PATH,
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

export function isHostedRunnerProviderEffectPath(pathname: string): boolean {
  return PROVIDER_EFFECT_PATHS.has(pathname);
}

export function parseHostedRunnerTelegramSendRequest(
  value: unknown,
): HostedRuntimeTelegramSendRequest {
  const record = requireRecord(value, "Hosted Telegram send request");
  return {
    idempotencyKey: readOptionalString(record.idempotencyKey, "idempotencyKey"),
    message: readRequiredString(record.message, "message"),
    replyToMessageId: readOptionalString(record.replyToMessageId, "replyToMessageId"),
    target: readRequiredString(record.target, "target"),
  };
}

export function parseHostedRunnerTelegramSendResponse(
  value: unknown,
): HostedRuntimeTelegramSendResponse | void {
  if (value === null || value === undefined) {
    return undefined;
  }
  const record = requireRecord(value, "Hosted Telegram send response");
  return parseTelegramSendResponseRecord(record);
}

export function parseHostedRunnerTelegramChatActionRequest(
  value: unknown,
): HostedRuntimeTelegramChatActionRequest {
  const record = requireRecord(value, "Hosted Telegram chat action request");
  return {
    action: parseTypingAction(record.action, "action"),
    target: readRequiredString(record.target, "target"),
  };
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

export function parseHostedRunnerLinqSendRequest(
  value: unknown,
): HostedRuntimeLinqSendRequest {
  const record = requireRecord(value, "Hosted Linq send request");
  return {
    directRecipientPhoneNumber: readOptionalString(
      record.directRecipientPhoneNumber,
      "directRecipientPhoneNumber",
    ),
    fromPhoneNumber: readOptionalString(record.fromPhoneNumber, "fromPhoneNumber"),
    idempotencyKey: readOptionalString(record.idempotencyKey, "idempotencyKey"),
    message: readRequiredString(record.message, "message"),
    replyToMessageId: readOptionalString(record.replyToMessageId, "replyToMessageId"),
    target: readRequiredString(record.target, "target"),
    targetKind: parseOptionalTargetKind(record.targetKind, "targetKind"),
  };
}

export function parseHostedRunnerLinqSendResponse(
  value: unknown,
): HostedRuntimeLinqSendResponse | void {
  if (value === null || value === undefined) {
    return undefined;
  }
  const record = requireRecord(value, "Hosted Linq send response");
  return {
    providerMessageId: readOptionalString(record.providerMessageId, "providerMessageId"),
    providerMessageIds: readOptionalStringArray(record.providerMessageIds, "providerMessageIds"),
    providerThreadId: readOptionalString(record.providerThreadId, "providerThreadId"),
    target: readOptionalString(record.target, "target"),
    targetKind: parseOptionalTargetKind(record.targetKind, "targetKind"),
  };
}

export function parseHostedRunnerLinqChatActionRequest(
  value: unknown,
): HostedRuntimeLinqChatActionRequest {
  const record = requireRecord(value, "Hosted Linq chat action request");
  return {
    action: parseLinqChatAction(record.action, "action"),
    target: readRequiredString(record.target, "target"),
  };
}

export function parseHostedRunnerLinqMarkReadRequest(
  value: unknown,
): HostedRuntimeLinqMarkReadRequest {
  const record = requireRecord(value, "Hosted Linq mark-read request");
  return {
    chatId: readRequiredString(record.chatId, "chatId"),
  };
}

export function parseHostedRunnerLinqDeleteMessagesRequest(
  value: unknown,
): HostedRuntimeLinqDeleteMessagesRequest {
  const record = requireRecord(value, "Hosted Linq delete-messages request");
  return {
    messageIds: readRequiredStringArray(record.messageIds, "messageIds"),
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

export function parseHostedRunnerWhatsAppSendRequest(
  value: unknown,
): HostedRuntimeWhatsAppSendRequest {
  const record = requireRecord(value, "Hosted WhatsApp send request");
  return {
    message: readRequiredString(record.message, "message"),
    replyToMessageId: readOptionalString(record.replyToMessageId, "replyToMessageId"),
    target: readRequiredString(record.target, "target"),
  };
}

export function parseHostedRunnerWhatsAppSendResponse(
  value: unknown,
): HostedRuntimeWhatsAppSendResponse | void {
  if (value === null || value === undefined) {
    return undefined;
  }
  const record = requireRecord(value, "Hosted WhatsApp send response");
  return {
    providerMessageId: readOptionalString(record.providerMessageId, "providerMessageId"),
    providerMessageIds: readOptionalStringArray(record.providerMessageIds, "providerMessageIds"),
    providerThreadId: readOptionalString(record.providerThreadId, "providerThreadId"),
    target: readOptionalString(record.target, "target"),
    targetKind: parseOptionalTargetKind(record.targetKind, "targetKind"),
  };
}

function parseTelegramSendResponseRecord(
  record: Record<string, unknown>,
): HostedRuntimeTelegramSendResponse {
  const response: HostedRuntimeTelegramSendResponse = {
    cleanupTargetAliases: record.cleanupTargetAliases === null
      ? null
      : readOptionalStringArray(record.cleanupTargetAliases, "cleanupTargetAliases"),
    providerMessageId: readOptionalString(record.providerMessageId, "providerMessageId"),
    providerMessageIds: readOptionalStringArray(record.providerMessageIds, "providerMessageIds"),
    providerThreadId: readOptionalString(record.providerThreadId, "providerThreadId"),
    target: readOptionalString(record.target, "target"),
    targetKind: parseOptionalTargetKind(record.targetKind, "targetKind"),
  };
  if (record.cleanupMessages === null) {
    response.cleanupMessages = null;
  } else if (Array.isArray(record.cleanupMessages)) {
    response.cleanupMessages = parseCleanupMessages(record.cleanupMessages);
  }
  return response;
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

function parseOptionalTargetKind(
  value: unknown,
  label: string,
): HostedRuntimeProviderTargetKind | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === "explicit" || value === "participant" || value === "thread") {
    return value;
  }
  throw new TypeError(`Hosted runner provider effect ${label} is invalid.`);
}

function parseTypingAction(value: unknown, label: string): "typing" {
  if (value === "typing") {
    return value;
  }
  throw new TypeError(`Hosted runner provider effect ${label} must be typing.`);
}

function parseLinqChatAction(
  value: unknown,
  label: string,
): HostedRuntimeLinqChatActionRequest["action"] {
  if (value === "typing" || value === "typing_stop") {
    return value;
  }
  throw new TypeError(`Hosted runner Linq provider effect ${label} must be typing or typing_stop.`);
}
