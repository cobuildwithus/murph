import type {
  TelegramAttachmentDownloadDriver,
} from "@murphai/inboxd/connectors/hosted-conversation";
import type { TelegramFile } from "@murphai/messaging-ingress/telegram-webhook";
import type {
  HostedRuntimeEffectsPort,
  HostedRuntimePlatform,
} from "../platform.ts";
import {
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "../runtime-logs.ts";

const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const DEFAULT_TELEGRAM_FILE_BASE_URL = "https://api.telegram.org/file";
const DEFAULT_TELEGRAM_ATTACHMENT_DOWNLOAD_RETRY_DELAYS_MS = [100, 500] as const;
export const HOSTED_TELEGRAM_ATTACHMENT_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

type HostedTelegramAttachmentDownloadPlatform = Pick<HostedRuntimePlatform, "logPort">;

export function withHostedTelegramAttachmentDownloadRetry(
  driver: TelegramAttachmentDownloadDriver | null,
  options: {
    retryDelaysMs?: readonly number[];
  } = {},
): TelegramAttachmentDownloadDriver | null {
  if (!driver) {
    return null;
  }

  const retryDelaysMs = options.retryDelaysMs ??
    DEFAULT_TELEGRAM_ATTACHMENT_DOWNLOAD_RETRY_DELAYS_MS;
  return {
    downloadFile: (filePath, signal) => retryHostedTelegramAttachmentDownloadCall({
      retryDelaysMs,
      run: () => driver.downloadFile(filePath, signal),
      signal,
    }),
    getFile: (fileId, signal) => retryHostedTelegramAttachmentDownloadCall({
      retryDelaysMs,
      run: () => driver.getFile(fileId, signal),
      signal,
    }),
  };
}

// Mirrors mailbox.linq_attachment_download_finished: conversation-import
// attachment downloads are otherwise swallowed by the normalizer's
// metadata-only fallback, so every driver call must leave a durable trace.
export function withHostedTelegramAttachmentDownloadLogging(
  driver: TelegramAttachmentDownloadDriver | null,
  platform: HostedTelegramAttachmentDownloadPlatform | null,
): TelegramAttachmentDownloadDriver | null {
  if (!driver) {
    return null;
  }

  return {
    downloadFile: (filePath, signal) => logHostedTelegramAttachmentDownloadCall({
      operation: "downloadFile",
      platform,
      run: () => driver.downloadFile(filePath, signal),
    }),
    getFile: (fileId, signal) => logHostedTelegramAttachmentDownloadCall({
      operation: "getFile",
      platform,
      run: () => driver.getFile(fileId, signal),
    }),
  };
}

export async function logHostedTelegramAttachmentDownloadUnavailable(
  platform: HostedTelegramAttachmentDownloadPlatform | null,
): Promise<void> {
  await writeHostedTelegramAttachmentDownloadLog({
    attempt: {
      failureCode: "driver_unavailable",
      result: "not_downloaded",
    },
    platform,
  });
}

interface HostedTelegramAttachmentDownloadAttemptLog {
  failureCode?: "download_aborted" | "download_fetch_failed" | "driver_unavailable";
  failureStatus?: number;
  operation?: "downloadFile" | "getFile";
  result: "failed" | "not_downloaded" | "succeeded";
}

async function logHostedTelegramAttachmentDownloadCall<T>(input: {
  operation: HostedTelegramAttachmentDownloadAttemptLog["operation"];
  platform: HostedTelegramAttachmentDownloadPlatform | null;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    const result = await input.run();
    await writeHostedTelegramAttachmentDownloadLog({
      attempt: {
        operation: input.operation,
        result: "succeeded",
      },
      platform: input.platform,
    });
    return result;
  } catch (error) {
    await writeHostedTelegramAttachmentDownloadLog({
      attempt: {
        ...classifyHostedTelegramAttachmentDownloadError(error),
        operation: input.operation,
        result: "failed",
      },
      platform: input.platform,
    });
    throw error;
  }
}

async function retryHostedTelegramAttachmentDownloadCall<T>(input: {
  retryDelaysMs: readonly number[];
  run: () => Promise<T>;
  signal?: AbortSignal;
}): Promise<T> {
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    try {
      return await input.run();
    } catch (error) {
      const retryDelayMs = input.retryDelaysMs[attemptIndex];
      if (
        retryDelayMs === undefined
        || !shouldRetryHostedTelegramAttachmentDownloadError(error, input.signal)
      ) {
        throw error;
      }

      await waitHostedTelegramAttachmentDownloadRetryDelay(retryDelayMs, input.signal);
    }
  }
}

async function writeHostedTelegramAttachmentDownloadLog(input: {
  attempt: HostedTelegramAttachmentDownloadAttemptLog;
  platform: HostedTelegramAttachmentDownloadPlatform | null;
}): Promise<void> {
  if (!input.platform?.logPort) {
    return;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "mailbox",
      ...(input.attempt.failureCode
        ? { errorCode: toHostedRuntimeLogCode(input.attempt.failureCode) }
        : {}),
      eventCode: "mailbox.telegram_attachment_download_finished",
      level: input.attempt.result === "succeeded" ? "info" : "warn",
      phase: "import",
      redactedJson: { ...input.attempt },
    },
    platform: input.platform,
  });
}

// Closed failure-code set: arbitrary error codes/names must not reach the
// durable log. The upstream HTTP status carries the discriminating detail.
function classifyHostedTelegramAttachmentDownloadError(
  error: unknown,
): Pick<HostedTelegramAttachmentDownloadAttemptLog, "failureCode" | "failureStatus"> {
  const status = readHostedTelegramAttachmentDownloadErrorStatus(error);
  const aborted = isHostedTelegramAttachmentDownloadAbortError(error);

  return {
    failureCode: aborted ? "download_aborted" : "download_fetch_failed",
    ...(status === null ? {} : { failureStatus: status }),
  };
}

function shouldRetryHostedTelegramAttachmentDownloadError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (signal?.aborted || isHostedTelegramAttachmentDownloadAbortError(error)) {
    return false;
  }

  const record = readHostedTelegramErrorRecord(error);
  const context = readHostedTelegramErrorContext(record);
  const retryable =
    readHostedTelegramBoolean(context?.retryable)
    ?? readHostedTelegramBoolean(record?.retryable);
  if (retryable === false) {
    return false;
  }

  const status = readHostedTelegramAttachmentDownloadErrorStatus(error);
  if (status !== null) {
    return status === 408 || status === 429 || status >= 500;
  }

  return retryable === true || isHostedTelegramTransientTransportError(error);
}

function readHostedTelegramAttachmentDownloadErrorStatus(error: unknown): number | null {
  const record = readHostedTelegramErrorRecord(error);
  const context = readHostedTelegramErrorContext(record);
  return readHostedTelegramStatus(context?.status)
    ?? readHostedTelegramStatus(context?.upstreamStatus)
    ?? readHostedTelegramStatus(record?.status)
    ?? readHostedTelegramStatus(record?.statusCode);
}

function readHostedTelegramErrorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === "object" ? error as Record<string, unknown> : null;
}

function readHostedTelegramErrorContext(
  record: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return record?.context && typeof record.context === "object" && !Array.isArray(record.context)
    ? record.context as Record<string, unknown>
    : null;
}

function readHostedTelegramBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isHostedTelegramAttachmentDownloadAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
    && error.name === "AbortError"
  ) || (
    error instanceof Error
    && error.name === "AbortError"
  );
}

function isHostedTelegramTransientTransportError(error: unknown): boolean {
  const record = readHostedTelegramErrorRecord(error);
  const code = typeof record?.code === "string" ? record.code.toLowerCase() : "";
  const causeKind = typeof record?.hostedRuntimeFetchCauseKind === "string"
    ? record.hostedRuntimeFetchCauseKind.toLowerCase()
    : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return code.includes("network")
    || code.includes("timeout")
    || code.includes("fetch")
    || causeKind === "network"
    || causeKind === "timeout"
    || causeKind === "fetch_failed"
    || message.includes("fetch failed")
    || message.includes("network")
    || message.includes("timed out")
    || message.includes("timeout");
}

async function waitHostedTelegramAttachmentDownloadRetryDelay(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return;
  }
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
  });
}

export function createHostedTelegramAttachmentDownloadDriver(
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    fetchImplementation: typeof fetch | null;
    maxDownloadBytes?: number | null;
  },
): TelegramAttachmentDownloadDriver | null {
  const env = options.env ?? process.env;
  const token = readHostedTelegramString(env, "TELEGRAM_BOT_TOKEN");
  const fetchImplementation = options.fetchImplementation;
  if (!token || !fetchImplementation) {
    return null;
  }

  const apiBaseUrl = normalizeHostedTelegramBaseUrl(
    readHostedTelegramString(env, "TELEGRAM_API_BASE_URL"),
    DEFAULT_TELEGRAM_API_BASE_URL,
  );
  const fileBaseUrl = normalizeHostedTelegramBaseUrl(
    readHostedTelegramString(env, "TELEGRAM_FILE_BASE_URL"),
    DEFAULT_TELEGRAM_FILE_BASE_URL,
  );
  if (!apiBaseUrl || !fileBaseUrl) {
    return null;
  }
  const maxDownloadBytes = normalizeHostedTelegramMaxDownloadBytes(
    options.maxDownloadBytes ?? HOSTED_TELEGRAM_ATTACHMENT_DOWNLOAD_MAX_BYTES,
  );

  return {
    downloadFile: async (filePath, signal) => {
      const response = await fetchImplementation(`${fileBaseUrl}/bot${token}/${stripLeadingSlash(filePath)}`, {
        method: "GET",
        signal,
      });

      if (!response.ok) {
        throw createHostedTelegramStatusError(
          `Hosted Telegram attachment download failed with ${response.status} ${response.statusText}.`,
          response.status,
        );
      }

      return readHostedTelegramResponseBytes(response, maxDownloadBytes);
    },
    getFile: async (fileId, signal) => {
      const url = new URL(`${apiBaseUrl}/bot${token}/getFile`);
      url.searchParams.set("file_id", fileId);
      return readHostedTelegramApiResult<TelegramFile>({
        fetchImplementation,
        signal,
        url,
      });
    },
  };
}

function normalizeHostedTelegramMaxDownloadBytes(value: number | null): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

async function readHostedTelegramResponseBytes(
  response: Response,
  maxBytes: number | null,
): Promise<Uint8Array> {
  const contentLength = readHostedTelegramContentLength(response.headers);
  if (maxBytes !== null && contentLength !== null && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw createHostedTelegramDownloadLimitError(maxBytes);
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (maxBytes !== null && bytes.byteLength > maxBytes) {
      throw createHostedTelegramDownloadLimitError(maxBytes);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    totalBytes += value.byteLength;
    if (maxBytes !== null && totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw createHostedTelegramDownloadLimitError(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function readHostedTelegramContentLength(headers: Headers): number | null {
  const value = headers.get("content-length");
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function createHostedTelegramEffectsAttachmentDownloadDriver(input: {
  effectsPort?: Pick<HostedRuntimeEffectsPort, "downloadTelegramFile" | "getTelegramFile"> | null;
}): TelegramAttachmentDownloadDriver | null {
  const effectsPort = input.effectsPort ?? null;
  const getTelegramFile = effectsPort?.getTelegramFile;
  const downloadTelegramFile = effectsPort?.downloadTelegramFile;
  if (!effectsPort || !getTelegramFile || !downloadTelegramFile) {
    return null;
  }

  return {
    downloadFile: async (filePath, signal) => {
      const file = await downloadTelegramFile.call(
        effectsPort,
        { filePath },
        { signal: signal ?? null },
      );
      if (!file) {
        throw new Error("Hosted Telegram effects attachment download returned no file.");
      }

      return decodeBase64ToBytes(file.bytesBase64);
    },
    getFile: async (fileId, signal) => {
      const file = await getTelegramFile.call(
        effectsPort,
        { fileId },
        { signal: signal ?? null },
      );
      if (!file) {
        throw new Error("Hosted Telegram effects attachment lookup returned no file.");
      }

      return file;
    },
  };
}

function readHostedTelegramString(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | null {
  const value = env[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeHostedTelegramBaseUrl(value: string | null, fallback: string): string | null {
  const candidate = (value ?? fallback).replace(/\/$/u, "");

  try {
    return new URL(candidate).toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

async function readHostedTelegramApiResult<T>(input: {
  fetchImplementation: typeof fetch;
  signal?: AbortSignal;
  url: URL;
}): Promise<T> {
  const response = await input.fetchImplementation(input.url.toString(), {
    method: "GET",
    signal: input.signal,
  });

  if (!response.ok) {
    throw createHostedTelegramStatusError(
      `Hosted Telegram API request failed with ${response.status} ${response.statusText}.`,
      response.status,
    );
  }

  const payload = await response.json() as {
    description?: string;
    error_code?: number;
    ok?: boolean;
    result?: T;
  };

  if (payload.ok !== true || payload.result === undefined) {
    const telegramStatus = readHostedTelegramStatus(payload.error_code);
    const message = payload.description ??
      (telegramStatus
        ? `Hosted Telegram API request failed with Telegram error ${telegramStatus}.`
        : "Hosted Telegram API request returned an invalid response.");
    if (telegramStatus) {
      throw createHostedTelegramStatusError(message, telegramStatus);
    }

    throw new Error(message);
  }

  return payload.result;
}

function createHostedTelegramStatusError(message: string, status: number): Error & {
  status: number;
  statusCode: number;
} {
  return Object.assign(new Error(message), {
    status,
    statusCode: status,
  });
}

function createHostedTelegramDownloadLimitError(maxBytes: number): Error & {
  context: {
    failureStage: "download_limit";
    retryable: false;
    status: 413;
  };
  status: number;
  statusCode: number;
} {
  return Object.assign(
    new Error(`Hosted Telegram attachment exceeds the ${maxBytes} byte download limit.`),
    {
      context: {
        failureStage: "download_limit" as const,
        retryable: false as const,
        status: 413 as const,
      },
      status: 413,
      statusCode: 413,
    },
  );
}

function readHostedTelegramStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/u, "");
}

function decodeBase64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
