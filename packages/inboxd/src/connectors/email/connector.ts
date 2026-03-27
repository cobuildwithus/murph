import type { InboundCapture, PersistedCapture } from "../../contracts/capture.ts";
import { createCaptureCheckpoint, waitForAbortOrTimeout } from "../../shared.ts";
import type { Cursor, EmitCapture, PollConnector } from "../types.ts";
import { normalizeAgentmailMessage } from "./normalize.ts";
import type {
  AgentmailAttachmentDownload,
  AgentmailListMessagesResponse,
  AgentmailMessageLike,
  AgentmailThreadLike,
} from "./types.ts";

const DEFAULT_AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0";
const DEFAULT_EMAIL_POLL_INTERVAL_MS = 15_000;

export interface AgentmailFetchResponse {
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type AgentmailFetch = (
  input: string,
  init: {
    body?: string;
    headers?: Record<string, string>;
    method: string;
    signal?: AbortSignal;
  },
) => Promise<AgentmailFetchResponse>;

export interface AgentmailPollDriver {
  inboxId: string;
  listUnreadMessages(input?: {
    limit?: number;
    signal?: AbortSignal;
  }): Promise<AgentmailMessageLike[]>;
  getMessage?(input: {
    messageId: string;
    signal?: AbortSignal;
  }): Promise<AgentmailMessageLike>;
  markProcessed(input: {
    messageId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  downloadAttachment(input: {
    attachmentId: string;
    messageId: string;
    signal?: AbortSignal;
  }): Promise<Uint8Array | null>;
  getThread?(input: {
    threadId: string;
    signal?: AbortSignal;
  }): Promise<AgentmailThreadLike>;
}

export interface CreateAgentmailApiPollDriverInput {
  apiKey: string;
  inboxId: string;
  baseUrl?: string;
  fetchImplementation?: AgentmailFetch;
}

export interface EmailConnectorOptions {
  driver: AgentmailPollDriver;
  id?: string;
  source?: string;
  accountId?: string | null;
  accountAddress?: string | null;
  backfillLimit?: number;
  pollIntervalMs?: number;
}

export function createAgentmailApiPollDriver({
  apiKey,
  inboxId,
  baseUrl = DEFAULT_AGENTMAIL_BASE_URL,
  fetchImplementation = globalThis.fetch?.bind(globalThis),
}: CreateAgentmailApiPollDriverInput): AgentmailPollDriver {
  const normalizedApiKey = normalizeNullableString(apiKey);
  const normalizedInboxId = normalizeNullableString(inboxId);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (!normalizedApiKey) {
    throw new TypeError("AgentMail polling requires a non-empty API key.");
  }
  if (!normalizedInboxId) {
    throw new TypeError("AgentMail polling requires a non-empty inbox id.");
  }
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("AgentMail polling requires fetch support in the current runtime.");
  }

  const requestJson = async <T>(input: {
    path: string;
    method: "GET" | "PATCH";
    query?: URLSearchParams | null;
    body?: Record<string, unknown> | null;
    signal?: AbortSignal;
  }): Promise<T> => {
    const url = new URL(input.path.replace(/^\//u, ""), `${normalizedBaseUrl}/`);
    if (input.query) {
      url.search = input.query.toString();
    }

    const response = await fetchImplementation(url.toString(), {
      method: input.method,
      headers: {
        authorization: `Bearer ${normalizedApiKey}`,
        ...(input.body ? { "content-type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: input.signal,
    });

    if (!response.ok) {
      throw await createAgentmailHttpError(response, input.method, input.path);
    }

    return await response.json() as T;
  };

  const downloadUrl = async (
    url: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array | null> => {
    const response = await fetchImplementation(url, {
      method: "GET",
      signal,
    });

    if (!response.ok) {
      throw await createAgentmailHttpError(response, "GET", url);
    }

    return new Uint8Array(await response.arrayBuffer());
  };

  return {
    inboxId: normalizedInboxId,
    async listUnreadMessages({ limit = 50, signal } = {}) {
      const query = new URLSearchParams();
      query.set("limit", String(Math.max(1, Math.floor(limit))));
      query.set("ascending", "true");
      query.append("labels", "unread");

      const response = await requestJson<AgentmailListMessagesResponse>({
        path: `/inboxes/${encodeURIComponent(normalizedInboxId)}/messages`,
        method: "GET",
        query,
        signal,
      });

      return response.messages ?? [];
    },
    async getMessage({ messageId, signal }) {
      return requestJson<AgentmailMessageLike>({
        path: `/inboxes/${encodeURIComponent(normalizedInboxId)}/messages/${encodeURIComponent(messageId)}`,
        method: "GET",
        signal,
      });
    },
    async markProcessed({ messageId, signal }) {
      await requestJson<AgentmailMessageLike>({
        path: `/inboxes/${encodeURIComponent(normalizedInboxId)}/messages/${encodeURIComponent(messageId)}`,
        method: "PATCH",
        body: {
          add_labels: ["read", "processed"],
          remove_labels: ["unread"],
        },
        signal,
      });
    },
    async downloadAttachment({ attachmentId, messageId, signal }) {
      const metadata = await requestJson<AgentmailAttachmentDownload>({
        path: `/inboxes/${encodeURIComponent(normalizedInboxId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        method: "GET",
        signal,
      });

      const download = normalizeNullableString(metadata.download_url);
      if (!download) {
        return null;
      }

      return downloadUrl(download, signal);
    },
    async getThread({ threadId, signal }) {
      return requestJson<AgentmailThreadLike>({
        path: `/threads/${encodeURIComponent(threadId)}`,
        method: "GET",
        signal,
      });
    },
  };
}

export function createEmailPollConnector({
  driver,
  id,
  source = "email",
  accountId,
  accountAddress = null,
  backfillLimit = 500,
  pollIntervalMs = DEFAULT_EMAIL_POLL_INTERVAL_MS,
}: EmailConnectorOptions): PollConnector {
  const normalizedAccountId = normalizeNullableString(accountId) ?? driver.inboxId;
  const connectorId = id ?? `${source}:${normalizedAccountId ?? "default"}`;
  const normalizedAccountAddress = normalizeNullableString(accountAddress);
  const normalizedPollIntervalMs = normalizePollInterval(pollIntervalMs);

  const processUnreadBatch = async (input: {
    emit: EmitCapture;
    limit: number;
    signal?: AbortSignal;
  }): Promise<{
    lastCheckpoint: Cursor | null;
    processedCount: number;
  }> => {
    if (input.limit <= 0) {
      return {
        lastCheckpoint: null,
        processedCount: 0,
      };
    }

    const messages = await driver.listUnreadMessages({
      limit: input.limit,
      signal: input.signal,
    });

    let processedCount = 0;
    let lastCheckpoint: Cursor | null = null;

    for (const summary of messages) {
      if (input.signal?.aborted) {
        break;
      }

      const message = driver.getMessage
        ? await driver.getMessage({
            messageId: summary.message_id,
            signal: input.signal,
          })
        : summary;
      const capture = await normalizeAgentmailMessage({
        message,
        source,
        accountId: normalizedAccountId,
        accountAddress: normalizedAccountAddress,
        downloadDriver: {
          downloadAttachment: ({ attachmentId, messageId, signal }) =>
            driver.downloadAttachment({
              attachmentId,
              messageId,
              signal,
            }),
        },
        signal: input.signal,
      });
      const checkpoint = createAgentmailCheckpoint(message, capture);
      const persisted = await input.emit(capture, checkpoint);
      await markMessageProcessed(driver, message.message_id, persisted, input.signal);
      lastCheckpoint = checkpoint;
      processedCount += 1;
    }

    return {
      lastCheckpoint,
      processedCount,
    };
  };

  return {
    id: connectorId,
    source,
    accountId: normalizedAccountId,
    kind: "poll",
    capabilities: {
      backfill: true,
      watch: true,
      webhooks: false,
      attachments: true,
      ownMessages: true,
    },
    async backfill(_cursor, emit) {
      let remaining = backfillLimit;
      let lastCheckpoint: Cursor | null = null;

      while (remaining > 0) {
        const batch = await processUnreadBatch({
          emit,
          limit: remaining,
        });
        if (batch.processedCount === 0) {
          break;
        }

        remaining -= batch.processedCount;
        lastCheckpoint = batch.lastCheckpoint ?? lastCheckpoint;
      }

      return lastCheckpoint;
    },
    async watch(cursor, emit, signal) {
      let lastCheckpoint = cursor;

      while (!signal.aborted) {
        const batch = await processUnreadBatch({
          emit,
          limit: Math.min(backfillLimit, 100),
          signal,
        });
        lastCheckpoint = batch.lastCheckpoint ?? lastCheckpoint;

        if (signal.aborted) {
          break;
        }

        if (batch.processedCount === 0) {
          await waitForAbortOrTimeout(signal, normalizedPollIntervalMs);
        }
      }
    },
    async close() {
      return
    },
  };
}

function createAgentmailCheckpoint(
  message: AgentmailMessageLike,
  capture: InboundCapture,
): Cursor {
  return {
    ...createCaptureCheckpoint(capture),
    messageId: message.message_id,
    threadId: message.thread_id,
  };
}

async function markMessageProcessed(
  driver: AgentmailPollDriver,
  messageId: string,
  _persisted: PersistedCapture,
  signal?: AbortSignal,
): Promise<void> {
  await driver.markProcessed({ messageId, signal });
}

async function createAgentmailHttpError(
  response: AgentmailFetchResponse,
  method: string,
  path: string,
): Promise<Error> {
  let payload: unknown = null;
  let rawText: string | null = null;

  try {
    payload = await response.json();
  } catch {
    try {
      rawText = await response.text();
    } catch {}
  }

  return new Error(
    extractAgentmailErrorMessage(payload, rawText) ??
      `AgentMail request ${method} ${path} failed with HTTP ${response.status}.`,
  );
}

function extractAgentmailErrorMessage(
  payload: unknown,
  rawText: string | null,
): string | null {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return (
      normalizeNullableString(typeof record.message === "string" ? record.message : null) ??
      normalizeNullableString(typeof record.error === "string" ? record.error : null) ??
      normalizeNullableString(typeof record.detail === "string" ? record.detail : null)
    );
  }

  return normalizeNullableString(rawText);
}

function normalizeBaseUrl(value: string): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new TypeError("AgentMail polling requires a non-empty base URL.");
  }

  return normalized.replace(/\/+$/u, "");
}

function normalizePollInterval(value: number): number {
  if (!Number.isFinite(value) || value < 250) {
    throw new TypeError("AgentMail poll interval must be at least 250ms.");
  }

  return Math.floor(value);
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
