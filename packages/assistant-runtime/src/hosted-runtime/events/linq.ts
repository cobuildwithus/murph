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
const DEFAULT_HOSTED_LINQ_ATTACHMENT_CDN_BASE_URL = "https://cdn.linqapp.com";
const DEFAULT_HOSTED_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const HOSTED_LINQ_ATTACHMENT_METADATA_TIMEOUT_MS = 5_000;
const HOSTED_LINQ_LOCAL_ATTACHMENT_DOWNLOAD_PATH_PREFIX = "/attachment-downloads";
const HOSTED_LINQ_LOCAL_ATTACHMENT_CDN_HOSTNAMES = new Set([
  "::1",
  "127.0.0.1",
  "host.docker.internal",
  "localhost",
]);

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
    const attachmentCdnBaseUrl = resolveHostedLinqAttachmentCdnBaseUrl();
    if (!isHostedLinqAttachmentUrlAllowed(url, attachmentCdnBaseUrl)) {
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
  const normalizedRefreshedUrl = normalizeHostedLinqAttachmentUrl(refreshedUrl)
    ?? normalizeHostedLinqMetadataAttachmentUrl(refreshedUrl, input.apiConfig.apiBaseUrl);

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

function resolveHostedLinqAttachmentCdnBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): URL {
  const normalized = env.LINQ_ATTACHMENT_CDN_BASE_URL?.trim();
  if (normalized && normalized.length > 0) {
    try {
      const candidate = new URL(normalized.replace(/\/+$/u, ""));
      if (isHostedLinqAttachmentCdnOverrideAllowed(candidate)) {
        return candidate;
      }
    } catch {
      // Fall through to the default hosted CDN allowlist.
    }
  }

  return new URL(DEFAULT_HOSTED_LINQ_ATTACHMENT_CDN_BASE_URL);
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

function normalizeHostedLinqMetadataAttachmentUrl(
  value: string | null | undefined,
  apiBaseUrl: string,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const apiUrl = new URL(`${apiBaseUrl.replace(/\/+$/u, "")}/`);
    if (
      url.protocol !== apiUrl.protocol
      || url.host.toLowerCase() !== apiUrl.host.toLowerCase()
      || !HOSTED_LINQ_LOCAL_ATTACHMENT_CDN_HOSTNAMES.has(url.hostname.toLowerCase())
    ) {
      return null;
    }

    const requiredPathPrefix = normalizeHostedLinqAttachmentPathPrefix(
      HOSTED_LINQ_LOCAL_ATTACHMENT_DOWNLOAD_PATH_PREFIX,
    );
    if (!requiredPathPrefix) {
      return null;
    }

    if (
      url.pathname !== requiredPathPrefix
      && !url.pathname.startsWith(`${requiredPathPrefix}/`)
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function isHostedLinqAttachmentUrlAllowed(
  value: URL,
  attachmentCdnBaseUrl: URL,
): boolean {
  if (
    value.protocol !== attachmentCdnBaseUrl.protocol
    || value.host.toLowerCase() !== attachmentCdnBaseUrl.host.toLowerCase()
  ) {
    return false;
  }

  const requiredPathPrefix = normalizeHostedLinqAttachmentPathPrefix(
    attachmentCdnBaseUrl.pathname,
  );
  if (!requiredPathPrefix) {
    return true;
  }

  return (
    value.pathname === requiredPathPrefix
    || value.pathname.startsWith(`${requiredPathPrefix}/`)
  );
}

function isHostedLinqAttachmentCdnOverrideAllowed(value: URL): boolean {
  return HOSTED_LINQ_LOCAL_ATTACHMENT_CDN_HOSTNAMES.has(value.hostname.toLowerCase());
}

function normalizeHostedLinqAttachmentPathPrefix(value: string): string | null {
  const normalized = value.replace(/\/+$/u, "");
  return normalized && normalized !== "/" ? normalized : null;
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
