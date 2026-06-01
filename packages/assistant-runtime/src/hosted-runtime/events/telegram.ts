import {
  type TelegramAttachmentDownloadDriver,
} from "@murphai/inboxd/connectors/hosted-conversation";
import type { TelegramFile } from "@murphai/messaging-ingress/telegram-webhook";
import type {
  HostedRuntimeEffectsPort,
} from "../platform.ts";

const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const DEFAULT_TELEGRAM_FILE_BASE_URL = "https://api.telegram.org/file";

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
        throw new Error(
          `Hosted Telegram attachment download failed with ${response.status} ${response.statusText}.`,
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
    throw new Error(
      `Hosted Telegram API request failed with ${response.status} ${response.statusText}.`,
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
