import {
  type TelegramAttachmentDownloadDriver,
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

type HostedTelegramAttachmentDownloadPlatform = Pick<HostedRuntimePlatform, "logPort">;

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
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const status = typeof record?.status === "number" ? record.status : null;
  const aborted = (
    error instanceof DOMException
    && error.name === "AbortError"
  ) || (
    error instanceof Error
    && error.name === "AbortError"
  );

  return {
    failureCode: aborted ? "download_aborted" : "download_fetch_failed",
    ...(status === null ? {} : { failureStatus: status }),
  };
}

export function createHostedTelegramAttachmentDownloadDriver(
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    fetchImplementation: typeof fetch | null;
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

      return new Uint8Array(await response.arrayBuffer());
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

export function createHostedTelegramEffectsAttachmentDownloadDriver(input: {
  effectsPort?: Pick<HostedRuntimeEffectsPort, "downloadTelegramFile" | "getTelegramFile"> | null;
}): TelegramAttachmentDownloadDriver | null {
  const getTelegramFile = input.effectsPort?.getTelegramFile;
  const downloadTelegramFile = input.effectsPort?.downloadTelegramFile;
  if (!getTelegramFile || !downloadTelegramFile) {
    return null;
  }

  return {
    downloadFile: async (filePath) => {
      const file = await downloadTelegramFile({ filePath });
      if (!file) {
        throw new Error("Hosted Telegram effects attachment download returned no file.");
      }

      return decodeBase64ToBytes(file.bytesBase64);
    },
    getFile: async (fileId) => {
      const file = await getTelegramFile({ fileId });
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
  const response = await input.fetchImplementation(input.url, {
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
    throw new Error(
      payload.description ??
      (payload.error_code
        ? `Hosted Telegram API request failed with Telegram error ${payload.error_code}.`
        : "Hosted Telegram API request returned an invalid response."),
    );
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
