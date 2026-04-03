import {
  normalizeLinqWebhookEvent,
  type LinqAttachmentDownloadDriver,
} from "@murphai/inboxd/linq";
import { parseLinqWebhookEvent } from "@murphai/messaging-ingress/linq-webhook";
import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution";

import { withHostedInboxPipeline } from "./inbox-pipeline.ts";

const HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 5_000;
const HOSTED_LINQ_ATTACHMENT_CDN_HOST = "cdn.linqapp.com";

export async function ingestHostedLinqMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "linq.message.received" }>;
  },
): Promise<void> {
  const event = parseLinqWebhookEvent(JSON.stringify(dispatch.event.linqEvent));
  const capture = await normalizeLinqWebhookEvent({
    attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
    defaultAccountId: dispatch.event.phoneLookupKey,
    downloadDriver: createHostedLinqAttachmentDownloadDriver(),
    event,
  });

  await withHostedInboxPipeline(vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });
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
