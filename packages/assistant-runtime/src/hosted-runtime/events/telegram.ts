import {
  normalizeTelegramUpdate,
  type TelegramAttachmentDownloadDriver,
  type TelegramFile,
  type TelegramUpdateLike,
} from "@murphai/inboxd";
import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution";

import { withHostedInboxPipeline } from "./inbox-pipeline.ts";

export async function ingestHostedTelegramMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "telegram.message.received" }>;
  },
): Promise<void> {
  const capture = await normalizeTelegramUpdate({
    accountId: "bot",
    botUserId: dispatch.event.botUserId,
    downloadDriver: createHostedTelegramAttachmentDownloadDriver(),
    update: dispatch.event.telegramUpdate as TelegramUpdateLike,
  });

  await withHostedInboxPipeline(vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });
}

const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const DEFAULT_TELEGRAM_FILE_BASE_URL = "https://api.telegram.org/file";

function createHostedTelegramAttachmentDownloadDriver(): TelegramAttachmentDownloadDriver | null {
  const token = readHostedTelegramString("TELEGRAM_BOT_TOKEN");
  if (!token || typeof globalThis.fetch !== "function") {
    return null;
  }

  const apiBaseUrl = normalizeHostedTelegramBaseUrl(
    readHostedTelegramString("TELEGRAM_API_BASE_URL"),
    DEFAULT_TELEGRAM_API_BASE_URL,
  );
  const fileBaseUrl = normalizeHostedTelegramBaseUrl(
    readHostedTelegramString("TELEGRAM_FILE_BASE_URL"),
    DEFAULT_TELEGRAM_FILE_BASE_URL,
  );
  if (!apiBaseUrl || !fileBaseUrl) {
    return null;
  }

  return {
    downloadFile: async (filePath, signal) => {
      const response = await globalThis.fetch(`${fileBaseUrl}/bot${token}/${stripLeadingSlash(filePath)}`, {
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
      return readHostedTelegramApiResult<TelegramFile>(url, signal);
    },
  };
}

function readHostedTelegramString(key: string): string | null {
  const value = process.env[key];
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

async function readHostedTelegramApiResult<T>(url: URL, signal?: AbortSignal): Promise<T> {
  const response = await globalThis.fetch(url, {
    method: "GET",
    signal,
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
