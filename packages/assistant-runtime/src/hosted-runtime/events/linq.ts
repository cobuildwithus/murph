import type { LinqAttachmentDownloadDriver as HostedConversationLinqAttachmentDownloadDriver } from "@murphai/inboxd/connectors/hosted-conversation";

type HostedLinqAttachmentDownloadPart = {
  attachmentId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  type: "media" | "voice_memo";
  url?: string | null;
};

type HostedLinqAttachmentDownloadDriver =
  HostedConversationLinqAttachmentDownloadDriver & {
    downloadPart?(
      part: HostedLinqAttachmentDownloadPart,
      signal?: AbortSignal,
    ): Promise<Uint8Array | null>;
  };

// Hosted voice memo fetches routinely take longer than image/document fetches,
// especially once the wake has crossed the web -> worker boundary.
export const HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 15_000;
const HOSTED_LINQ_ATTACHMENT_CDN_HOST = "cdn.linqapp.com";
const DEFAULT_HOSTED_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const HOSTED_LINQ_ATTACHMENT_METADATA_TIMEOUT_MS = 5_000;

export function createHostedLinqAttachmentDownloadDriver(): HostedLinqAttachmentDownloadDriver | null {
  if (typeof globalThis.fetch !== "function") {
    return null;
  }

  const apiConfig = resolveHostedLinqAttachmentApiConfig();

  return {
    downloadUrl: async (url: string, signal?: AbortSignal) => {
      const normalizedUrl = normalizeHostedLinqAttachmentUrl(url);
      if (!normalizedUrl) {
        return null;
      }

      return downloadHostedLinqAttachmentBytes(normalizedUrl, signal);
    },
    downloadPart: async (part: HostedLinqAttachmentDownloadPart, signal?: AbortSignal) =>
      downloadHostedLinqAttachmentPart({
        apiConfig,
        part,
        signal,
      }),
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

async function downloadHostedLinqAttachmentPart(input: {
  apiConfig: HostedLinqAttachmentApiConfig | null;
  part: HostedLinqAttachmentDownloadPart;
  signal?: AbortSignal;
}): Promise<Uint8Array | null> {
  const directUrl = normalizeHostedLinqAttachmentUrl(input.part.url);
  let directError: unknown = null;

  if (directUrl) {
    try {
      return await downloadHostedLinqAttachmentBytes(directUrl, input.signal);
    } catch (error) {
      directError = error;
    }
  }

  const attachmentId = normalizeHostedLinqAttachmentId(input.part.attachmentId);
  if (!attachmentId || !input.apiConfig) {
    if (directError) {
      throw directError;
    }

    return null;
  }

  const refreshedUrl = await fetchHostedLinqAttachmentDownloadUrl({
    apiBaseUrl: input.apiConfig.apiBaseUrl,
    apiToken: input.apiConfig.apiToken,
    attachmentId,
    signal: input.signal,
  });
  const normalizedRefreshedUrl = normalizeHostedLinqAttachmentUrl(refreshedUrl);

  if (!normalizedRefreshedUrl) {
    if (directError) {
      throw directError;
    }

    return null;
  }

  return downloadHostedLinqAttachmentBytes(normalizedRefreshedUrl, input.signal);
}

async function downloadHostedLinqAttachmentBytes(
  url: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await globalThis.fetch(url, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `Hosted Linq attachment download failed with ${response.status} ${response.statusText}.`,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

interface HostedLinqAttachmentApiConfig {
  apiBaseUrl: string;
  apiToken: string;
}

function resolveHostedLinqAttachmentApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): HostedLinqAttachmentApiConfig | null {
  const apiToken = normalizeHostedLinqApiToken(env.LINQ_API_TOKEN);
  if (!apiToken) {
    return null;
  }

  return {
    apiBaseUrl: normalizeHostedLinqApiBaseUrl(env.LINQ_API_BASE_URL),
    apiToken,
  };
}

function normalizeHostedLinqApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0
    ? normalized.replace(/\/+$/u, "")
    : DEFAULT_HOSTED_LINQ_API_BASE_URL;
}

function normalizeHostedLinqApiToken(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeHostedLinqAttachmentId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

async function fetchHostedLinqAttachmentDownloadUrl(input: {
  apiBaseUrl: string;
  apiToken: string;
  attachmentId: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, HOSTED_LINQ_ATTACHMENT_METADATA_TIMEOUT_MS);
  const releaseRelay = input.signal ? relayAbortSignal(input.signal, controller) : () => {};

  try {
    const response = await globalThis.fetch(
      new URL(`attachments/${encodeURIComponent(input.attachmentId)}`, `${input.apiBaseUrl}/`),
      {
        headers: {
          authorization: `Bearer ${input.apiToken}`,
        },
        method: "GET",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as { download_url?: unknown; downloadUrl?: unknown };
    return normalizeHostedAttachmentDownloadUrlField(payload.download_url ?? payload.downloadUrl);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    releaseRelay();
  }
}

function normalizeHostedAttachmentDownloadUrlField(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function relayAbortSignal(source: AbortSignal, controller: AbortController): () => void {
  const onAbort = () => {
    controller.abort(source.reason);
  };

  if (source.aborted) {
    controller.abort(source.reason);
    return () => {};
  }

  source.addEventListener("abort", onAbort, { once: true });
  return () => {
    source.removeEventListener("abort", onAbort);
  };
}
