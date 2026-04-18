import {
  normalizeLinqWebhookEvent,
  type LinqAttachmentDownloadDriver,
} from "@murphai/inboxd/connectors/linq/normalize";
import { parseLinqWebhookEvent } from "@murphai/messaging-ingress/linq-webhook";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";

const HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 5_000;
const HOSTED_LINQ_ATTACHMENT_CDN_HOST = "cdn.linqapp.com";

export async function buildHostedLinqCapture(
  wake: HostedExecutionConversationMessageWake & {
    message: Extract<HostedExecutionConversationMessageWake["message"], { channel: "linq" }>;
  },
) {
  const event = parseLinqWebhookEvent(JSON.stringify(wake.message.linqEvent));
  const capture = await normalizeLinqWebhookEvent({
    attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
    defaultAccountId: wake.message.phoneLookupKey,
    downloadDriver: createHostedLinqAttachmentDownloadDriver(),
    event,
  });
  const hostedCapture = {
    ...capture,
    accountId: wake.message.phoneLookupKey,
    externalId: resolveHostedLinqCaptureExternalId({
      fallbackExternalId: capture.externalId,
      linqMessageId: wake.message.linqMessageId ?? null,
    }),
  };

  return hostedCapture;
}

export function createHostedLinqAttachmentDownloadDriver(): LinqAttachmentDownloadDriver | null {
  if (typeof globalThis.fetch !== "function") {
    return null;
  }

  return {
    downloadUrl: async (url, signal) => {
      const normalizedUrl = normalizeHostedLinqAttachmentUrl(url);
      if (!normalizedUrl) {
        return null;
      }

      const response = await globalThis.fetch(normalizedUrl, {
        method: "GET",
        signal,
      });

      if (!response.ok) {
        throw new Error(
          `Hosted Linq attachment download failed with ${response.status} ${response.statusText}.`,
        );
      }

      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function resolveHostedLinqCaptureExternalId(input: {
  fallbackExternalId: string;
  linqMessageId: string | null;
}): string {
  const linqMessageId = normalizeHostedLinqText(input.linqMessageId);
  if (linqMessageId) {
    return `linq:${linqMessageId}`;
  }

  return normalizeHostedLinqText(input.fallbackExternalId) ?? input.fallbackExternalId;
}

function normalizeHostedLinqText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeHostedLinqAttachmentUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "https:"
      || url.hostname.toLowerCase() !== HOSTED_LINQ_ATTACHMENT_CDN_HOST
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
