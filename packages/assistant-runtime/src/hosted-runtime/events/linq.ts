import type { LinqAttachmentDownloadDriver as HostedConversationLinqAttachmentDownloadDriver } from "@murphai/inboxd/connectors/hosted-conversation";
import {
  buildHostedExecutionSafeErrorDiagnostics,
} from "@murphai/hosted-execution";
import type { HostedRuntimeRedactedJson } from "@murphai/hosted-execution/runtime-control";

import type { NormalizedHostedAssistantRuntimeConfig } from "../models.ts";
import {
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "../runtime-logs.ts";

type HostedLinqAttachmentDownloadPart = {
  attachmentId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
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

type HostedLinqAttachmentDownloadPlatform =
  Pick<
    NormalizedHostedAssistantRuntimeConfig["platform"],
    "logPort" | "providerFetch" | "publicInternetFetch"
  >;
type HostedLinqAttachmentDownloadEnv = Readonly<Record<string, string | undefined>>;

type HostedLinqAttachmentDownloadResult = "failed" | "not_downloaded" | "succeeded";

interface HostedLinqAttachmentDownloadAttemptLog {
  apiBaseKind?: string | null;
  apiConfigured?: boolean | null;
  attachmentKeyPresent?: boolean | null;
  byteCountBucket?: string | null;
  cdnBaseKind?: string | null;
  declaredSizeBucket?: string | null;
  directFetchAttempted?: boolean | null;
  directFetchSucceeded?: boolean | null;
  directLocatorAllowed?: boolean | null;
  directLocatorPresent?: boolean | null;
  downloadStatus?: number | null;
  errorCause?: string | null;
  errorCodeDetail?: string | null;
  errorDetail?: string | null;
  errorDetailPresent?: boolean | null;
  errorMessage?: string | null;
  errorName?: string | null;
  errorRetryable?: boolean | null;
  errorStatus?: number | null;
  failureCode?: string | null;
  metadataByteFetchAttempted?: boolean | null;
  metadataByteFetchSucceeded?: boolean | null;
  metadataLocatorAllowed?: boolean | null;
  metadataLocatorPresent?: boolean | null;
  metadataLookupAttempted?: boolean | null;
  metadataStatus?: number | null;
  mimeCategory?: string | null;
  operation: "downloadPart" | "downloadUrl";
  partKind?: string | null;
  result: HostedLinqAttachmentDownloadResult;
}

// Hosted voice memo fetches routinely take longer than image/document fetches,
// especially once the wake has crossed the web -> worker boundary.
export const HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 15_000;
const DEFAULT_HOSTED_LINQ_ATTACHMENT_DOWNLOAD_RETRY_DELAYS_MS = [250, 1_000] as const;
export const HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const HOSTED_LINQ_ATTACHMENT_DIRECT_DOWNLOAD_TIMEOUT_MS = 5_000;
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

export function createHostedLinqAttachmentDownloadDriver(
  options: {
    env?: HostedLinqAttachmentDownloadEnv;
    platform: HostedLinqAttachmentDownloadPlatform | null;
  },
): HostedLinqAttachmentDownloadDriver | null {
  const platform = options.platform;
  const env = options.env ?? process.env;
  const fetchImplementation = resolveHostedLinqAttachmentFetchImplementation({
    platform,
  });
  const downloadFetch = fetchImplementation?.downloadFetch ?? null;
  if (!downloadFetch) {
    return null;
  }
  const metadataFetch = fetchImplementation?.metadataFetch ?? null;

  const apiConfig = metadataFetch
    ? resolveHostedLinqAttachmentApiConfig(env)
    : null;

  return {
    downloadUrl: async (url: string, signal?: AbortSignal) => {
      const locatorPresent = typeof url === "string" && url.trim().length > 0;
      const normalizedUrl = normalizeHostedLinqAttachmentUrl(url, env);
      if (!normalizedUrl) {
        await writeHostedLinqAttachmentDownloadAttemptLog({
          attempt: {
            cdnBaseKind: resolveHostedLinqAttachmentCdnBaseKind(env),
            directLocatorAllowed: false,
            directLocatorPresent: locatorPresent,
            failureCode: "url_not_allowed",
            operation: "downloadUrl",
            result: "not_downloaded",
          },
          platform,
        });
        return null;
      }

      try {
        const bytes = await downloadHostedLinqAttachmentBytes(normalizedUrl, {
          fetchImplementation: downloadFetch,
          signal,
          timeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
        });
        await writeHostedLinqAttachmentDownloadAttemptLog({
          attempt: {
            byteCountBucket: bucketHostedLinqAttachmentByteCount(bytes.byteLength),
            cdnBaseKind: resolveHostedLinqAttachmentCdnBaseKind(env),
            directFetchAttempted: true,
            directFetchSucceeded: true,
            directLocatorAllowed: true,
            directLocatorPresent: true,
            operation: "downloadUrl",
            result: "succeeded",
          },
          platform,
        });
        return bytes;
      } catch (error) {
        const failure = classifyHostedLinqAttachmentDownloadError(error);
        await writeHostedLinqAttachmentDownloadAttemptLog({
          attempt: appendHostedLinqAttachmentDownloadErrorDiagnostics({
            cdnBaseKind: resolveHostedLinqAttachmentCdnBaseKind(env),
            directFetchAttempted: true,
            directFetchSucceeded: false,
            directLocatorAllowed: true,
            directLocatorPresent: true,
            downloadStatus: failure.status,
            failureCode: failure.code,
            operation: "downloadUrl",
            result: "failed",
          }, error, shouldRetryHostedLinqAttachmentDownloadError(error, signal)),
          platform,
        });
        throw error;
      }
    },
    downloadPart: async (part: HostedLinqAttachmentDownloadPart, signal?: AbortSignal) =>
      downloadHostedLinqAttachmentPart({
        apiConfig,
        downloadFetch,
        env,
        metadataFetch,
        part,
        platform,
        signal,
      }),
  };
}

export function withHostedLinqAttachmentDownloadRetry(
  driver: HostedLinqAttachmentDownloadDriver | null,
  options: {
    retryDelaysMs?: readonly number[];
  } = {},
): HostedLinqAttachmentDownloadDriver | null {
  if (!driver) {
    return null;
  }

  const retryDelaysMs = options.retryDelaysMs
    ?? DEFAULT_HOSTED_LINQ_ATTACHMENT_DOWNLOAD_RETRY_DELAYS_MS;
  const downloadPart = driver.downloadPart;
  return {
    downloadUrl: (url, signal) => retryHostedLinqAttachmentDownloadCall({
      retryDelaysMs,
      run: () => driver.downloadUrl(url, signal),
      signal,
    }),
    ...(downloadPart
      ? {
          downloadPart: (part, signal) => retryHostedLinqAttachmentDownloadCall({
            retryDelaysMs,
            run: () => downloadPart(part, signal),
            signal,
          }),
        }
      : {}),
  };
}

async function retryHostedLinqAttachmentDownloadCall<T>(input: {
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
        || !shouldRetryHostedLinqAttachmentDownloadError(error, input.signal)
      ) {
        throw error;
      }

      await waitHostedLinqAttachmentDownloadRetryDelay(retryDelayMs, input.signal);
    }
  }
}

export function normalizeHostedLinqAttachmentUrl(
  value: string | null | undefined,
  env: HostedLinqAttachmentDownloadEnv = process.env,
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
    const attachmentCdnBaseUrl = resolveHostedLinqAttachmentCdnBaseUrl(env);
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
  downloadFetch: typeof fetch;
  env: HostedLinqAttachmentDownloadEnv;
  metadataFetch: typeof fetch | null;
  part: HostedLinqAttachmentDownloadPart;
  platform: HostedLinqAttachmentDownloadPlatform | null;
  signal?: AbortSignal;
}): Promise<Uint8Array | null> {
  const declaredSize = normalizeHostedLinqAttachmentDeclaredSize(input.part.size);
  const baseAttempt: Omit<HostedLinqAttachmentDownloadAttemptLog, "result"> = {
    apiBaseKind: input.apiConfig ? classifyHostedLinqApiBaseUrl(input.apiConfig.apiBaseUrl) : null,
    apiConfigured: input.apiConfig !== null,
    attachmentKeyPresent: Boolean(normalizeHostedLinqAttachmentId(input.part.attachmentId)),
    cdnBaseKind: resolveHostedLinqAttachmentCdnBaseKind(input.env),
    declaredSizeBucket: bucketHostedLinqAttachmentByteCount(declaredSize),
    directLocatorAllowed: false,
    directLocatorPresent: typeof input.part.url === "string" && input.part.url.trim().length > 0,
    metadataLookupAttempted: false,
    mimeCategory: normalizeHostedLinqAttachmentMimeCategory(input.part.mimeType),
    operation: "downloadPart",
    partKind: input.part.type,
  };

  try {
    assertHostedLinqAttachmentWithinByteLimit(declaredSize);
  } catch (error) {
    const failure = classifyHostedLinqAttachmentDownloadError(error);
    await writeHostedLinqAttachmentDownloadAttemptLog({
      attempt: appendHostedLinqAttachmentDownloadErrorDiagnostics({
        ...baseAttempt,
        failureCode: failure.code,
        result: "failed",
      }, error, false),
      platform: input.platform,
    });
    throw error;
  }

  const directUrl = normalizeHostedLinqAttachmentUrl(input.part.url, input.env);
  let directError: unknown = null;
  let directFailure: HostedLinqAttachmentFailureSummary | null = null;

  if (directUrl) {
    try {
      const bytes = await downloadHostedLinqAttachmentBytes(directUrl, {
        declaredSize,
        fetchImplementation: input.downloadFetch,
        signal: input.signal,
        timeoutMs: HOSTED_LINQ_ATTACHMENT_DIRECT_DOWNLOAD_TIMEOUT_MS,
      });
      await writeHostedLinqAttachmentDownloadAttemptLog({
        attempt: {
          ...baseAttempt,
          byteCountBucket: bucketHostedLinqAttachmentByteCount(bytes.byteLength),
          directFetchAttempted: true,
          directFetchSucceeded: true,
          directLocatorAllowed: true,
          result: "succeeded",
        },
        platform: input.platform,
      });
      return bytes;
    } catch (error) {
      directError = error;
      directFailure = classifyHostedLinqAttachmentDownloadError(error);
    }
  }

  const attachmentId = normalizeHostedLinqAttachmentId(input.part.attachmentId);
  if (!attachmentId || !input.apiConfig || !input.metadataFetch) {
    const attempt: HostedLinqAttachmentDownloadAttemptLog = {
      ...baseAttempt,
      directFetchAttempted: Boolean(directUrl),
      directFetchSucceeded: false,
      directLocatorAllowed: Boolean(directUrl),
      downloadStatus: directFailure?.status ?? null,
      failureCode: directFailure?.code
        ?? (!attachmentId
          ? "missing_attachment_key"
          : !input.apiConfig
            ? "api_not_configured"
            : "metadata_fetch_unavailable"),
      result: directError ? "failed" : "not_downloaded",
    };
    await writeHostedLinqAttachmentDownloadAttemptLog({
      attempt: directError
        ? appendHostedLinqAttachmentDownloadErrorDiagnostics(
            attempt,
            directError,
            shouldRetryHostedLinqAttachmentDownloadError(directError, input.signal),
          )
        : attempt,
      platform: input.platform,
    });
    if (directError) {
      throw directError;
    }

    return null;
  }

  let metadataResult: HostedLinqAttachmentMetadataLookupResult;
  try {
    metadataResult = await fetchHostedLinqAttachmentDownloadUrl({
      apiBaseUrl: input.apiConfig.apiBaseUrl,
      apiToken: input.apiConfig.apiToken,
      attachmentId,
      fetchImplementation: input.metadataFetch,
      signal: input.signal,
    });
  } catch (error) {
    const failure = classifyHostedLinqAttachmentDownloadError(error);
    await writeHostedLinqAttachmentDownloadAttemptLog({
      attempt: appendHostedLinqAttachmentDownloadErrorDiagnostics({
        ...baseAttempt,
        directFetchAttempted: Boolean(directUrl),
        directFetchSucceeded: false,
        directLocatorAllowed: Boolean(directUrl),
        downloadStatus: directFailure?.status ?? null,
        failureCode: failure.code,
        metadataLocatorAllowed: false,
        metadataLocatorPresent: false,
        metadataLookupAttempted: true,
        metadataStatus: failure.status,
        result: "failed",
      }, error, shouldRetryHostedLinqAttachmentDownloadError(error, input.signal)),
      platform: input.platform,
    });
    throw error;
  }
  const normalizedRefreshedUrl = normalizeHostedLinqAttachmentUrl(metadataResult.downloadLocator, input.env)
    ?? normalizeHostedLinqMetadataAttachmentUrl(metadataResult.downloadLocator, input.apiConfig.apiBaseUrl);

  if (!normalizedRefreshedUrl) {
    const attempt: HostedLinqAttachmentDownloadAttemptLog = {
      ...baseAttempt,
      directFetchAttempted: Boolean(directUrl),
      directFetchSucceeded: false,
      directLocatorAllowed: Boolean(directUrl),
      downloadStatus: directFailure?.status ?? null,
      failureCode: directFailure?.code
        ?? metadataResult.failureCode
        ?? "metadata_locator_not_allowed",
      metadataLocatorAllowed: false,
      metadataLocatorPresent: metadataResult.downloadLocator !== null,
      metadataLookupAttempted: true,
      metadataStatus: metadataResult.status,
      result: directError ? "failed" : "not_downloaded",
    };
    await writeHostedLinqAttachmentDownloadAttemptLog({
      attempt: directError
        ? appendHostedLinqAttachmentDownloadErrorDiagnostics(
            attempt,
            directError,
            shouldRetryHostedLinqAttachmentDownloadError(directError, input.signal),
          )
        : attempt,
      platform: input.platform,
    });
    if (directError) {
      throw directError;
    }

    return null;
  }

  try {
    const bytes = await downloadHostedLinqAttachmentBytes(normalizedRefreshedUrl, {
      declaredSize,
      fetchImplementation: input.downloadFetch,
      signal: input.signal,
      timeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
    });
    await writeHostedLinqAttachmentDownloadAttemptLog({
      attempt: {
        ...baseAttempt,
        byteCountBucket: bucketHostedLinqAttachmentByteCount(bytes.byteLength),
        directFetchAttempted: Boolean(directUrl),
        directFetchSucceeded: false,
        directLocatorAllowed: Boolean(directUrl),
        downloadStatus: directFailure?.status ?? null,
        metadataByteFetchAttempted: true,
        metadataByteFetchSucceeded: true,
        metadataLocatorAllowed: true,
        metadataLocatorPresent: true,
        metadataLookupAttempted: true,
        metadataStatus: metadataResult.status,
        result: "succeeded",
      },
      platform: input.platform,
    });
    return bytes;
  } catch (error) {
    const failure = classifyHostedLinqAttachmentDownloadError(error);
    await writeHostedLinqAttachmentDownloadAttemptLog({
      attempt: appendHostedLinqAttachmentDownloadErrorDiagnostics({
        ...baseAttempt,
        directFetchAttempted: Boolean(directUrl),
        directFetchSucceeded: false,
        directLocatorAllowed: Boolean(directUrl),
        downloadStatus: failure.status ?? directFailure?.status ?? null,
        failureCode: failure.code,
        metadataByteFetchAttempted: true,
        metadataByteFetchSucceeded: false,
        metadataLocatorAllowed: true,
        metadataLocatorPresent: true,
        metadataLookupAttempted: true,
        metadataStatus: metadataResult.status,
        result: "failed",
      }, error, shouldRetryHostedLinqAttachmentDownloadError(error, input.signal)),
      platform: input.platform,
    });
    throw error;
  }
}

async function downloadHostedLinqAttachmentBytes(
  url: string,
  input: {
    declaredSize?: number | null;
    fetchImplementation: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number | null;
  },
): Promise<Uint8Array> {
  assertHostedLinqAttachmentWithinByteLimit(input.declaredSize ?? null);

  return await runHostedLinqAttachmentByteFetchWithTimeout(
    async (signal) => {
      const response = await input.fetchImplementation(url, {
        method: "GET",
        signal,
      });

      if (!response.ok) {
        throw new HostedLinqAttachmentDownloadError(
          "download_http_status",
          `Hosted Linq attachment download failed with ${response.status} ${response.statusText}.`,
          response.status,
        );
      }

      assertHostedLinqAttachmentWithinByteLimit(
        parseHostedLinqAttachmentContentLength(response.headers.get("content-length")),
      );

      const reader = response.body?.getReader();
      if (reader) {
        return readHostedLinqAttachmentBodyWithLimit(reader);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      assertHostedLinqAttachmentWithinByteLimit(bytes.byteLength);
      return bytes;
    },
    {
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? null,
    },
  );
}

async function runHostedLinqAttachmentByteFetchWithTimeout(
  operation: (signal?: AbortSignal) => Promise<Uint8Array>,
  input: {
    signal?: AbortSignal;
    timeoutMs: number | null;
  },
): Promise<Uint8Array> {
  if (
    input.timeoutMs === null
    || !Number.isFinite(input.timeoutMs)
    || input.timeoutMs < 0
  ) {
    return await operation(input.signal);
  }

  const timeoutMs = Math.floor(input.timeoutMs);
  const controller = new AbortController();
  const releaseRelay = input.signal ? relayAbortSignal(input.signal, controller) : () => {};
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const timeoutError = (cause?: unknown) => new HostedLinqAttachmentDownloadError(
    "download_timeout",
    `Hosted Linq attachment download timed out after ${timeoutMs}ms.`,
    null,
    { cause },
  );

  try {
    const operationPromise = operation(controller.signal).catch((error: unknown) => {
      if (timedOut && !input.signal?.aborted) {
        throw timeoutError(error);
      }
      throw error;
    });
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(timeoutError());
      }, timeoutMs);
    });

    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    releaseRelay();
  }
}

async function readHostedLinqAttachmentBodyWithLimit(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => undefined);
        assertHostedLinqAttachmentWithinByteLimit(totalBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function normalizeHostedLinqAttachmentDeclaredSize(
  value: number | null | undefined,
): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function parseHostedLinqAttachmentContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function assertHostedLinqAttachmentWithinByteLimit(byteSize: number | null): void {
  if (
    byteSize !== null
    && byteSize > HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES
  ) {
    throw new HostedLinqAttachmentDownloadError(
      "download_exceeds_limit",
      `Hosted Linq attachment download exceeds ${HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES} bytes.`,
    );
  }
}

function shouldRetryHostedLinqAttachmentDownloadError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (signal?.aborted || isAbortLikeHostedLinqAttachmentError(error)) {
    return false;
  }

  const failure = classifyHostedLinqAttachmentDownloadError(error);
  if (failure.status !== null) {
    // Linq audio URLs can be visible in the message event before the backing
    // CDN/metadata object is readable. A tiny bounded retry avoids converting
    // that short provider lag into permanent descriptor-only audio.
    return isRetryableHostedLinqAttachmentDownloadStatus(failure.status);
  }

  return isHostedLinqTransientTransportError(error);
}

function isRetryableHostedLinqAttachmentDownloadStatus(status: number): boolean {
  return status === 403
    || status === 404
    || status === 408
    || status === 425
    || status === 429
    || status >= 500;
}

function isHostedLinqTransientTransportError(error: unknown): boolean {
  const record = error && typeof error === "object"
    ? error as Record<string, unknown>
    : null;
  const code = typeof record?.code === "string"
    ? record.code.toLowerCase()
    : "";
  const causeKind = typeof record?.hostedRuntimeFetchCauseKind === "string"
    ? record.hostedRuntimeFetchCauseKind.toLowerCase()
    : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return code.includes("network")
    || code.includes("timeout")
    || code.includes("fetch")
    || code.includes("econnreset")
    || code.includes("eai_again")
    || causeKind === "network"
    || causeKind === "timeout"
    || causeKind === "fetch_failed"
    || message.includes("fetch failed")
    || message.includes("network")
    || message.includes("timed out")
    || message.includes("timeout");
}

async function waitHostedLinqAttachmentDownloadRetryDelay(
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

function appendHostedLinqAttachmentDownloadErrorDiagnostics(
  attempt: HostedLinqAttachmentDownloadAttemptLog,
  error: unknown,
  retryable: boolean,
): HostedLinqAttachmentDownloadAttemptLog {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  if (!diagnostics) {
    return {
      ...attempt,
      errorRetryable: retryable,
    };
  }

  return {
    ...attempt,
    errorCause: readHostedLinqAttachmentDiagnosticString(diagnostics.errorCause),
    errorCodeDetail: readHostedLinqAttachmentDiagnosticString(diagnostics.errorCodeDetail),
    errorDetail: readHostedLinqAttachmentDiagnosticString(diagnostics.errorDetail),
    errorDetailPresent: typeof diagnostics.errorDetail === "string",
    errorMessage: readHostedLinqAttachmentDiagnosticString(diagnostics.errorMessage),
    errorName: readHostedLinqAttachmentDiagnosticString(diagnostics.errorName),
    errorRetryable: retryable,
    errorStatus: readHostedLinqAttachmentDiagnosticNumber(diagnostics.errorStatus),
  };
}

function readHostedLinqAttachmentDiagnosticString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function readHostedLinqAttachmentDiagnosticNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

class HostedLinqAttachmentDownloadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "HostedLinqAttachmentDownloadError";
  }
}

interface HostedLinqAttachmentFailureSummary {
  code: string;
  status: number | null;
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

interface HostedLinqAttachmentMetadataLookupResult {
  downloadLocator: string | null;
  failureCode: string | null;
  status: number | null;
}

async function fetchHostedLinqAttachmentDownloadUrl(input: {
  apiBaseUrl: string;
  apiToken: string;
  attachmentId: string;
  fetchImplementation: typeof fetch;
  signal?: AbortSignal;
}): Promise<HostedLinqAttachmentMetadataLookupResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, HOSTED_LINQ_ATTACHMENT_METADATA_TIMEOUT_MS);
  const releaseRelay = input.signal ? relayAbortSignal(input.signal, controller) : () => {};

  try {
    const response = await input.fetchImplementation(
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
      if (isRetryableHostedLinqAttachmentDownloadStatus(response.status)) {
        throw new HostedLinqAttachmentDownloadError(
          "metadata_http_status",
          `Hosted Linq attachment metadata lookup failed with ${response.status} ${response.statusText}.`,
          response.status,
        );
      }

      return {
        downloadLocator: null,
        failureCode: "metadata_http_status",
        status: response.status,
      };
    }

    const payload = await response.json() as { download_url?: unknown; downloadUrl?: unknown };
    const downloadLocator = normalizeHostedAttachmentDownloadUrlField(
      payload.download_url ?? payload.downloadUrl,
    );
    return {
      downloadLocator,
      failureCode: downloadLocator ? null : "metadata_empty_locator",
      status: response.status,
    };
  } catch (error) {
    if (error instanceof HostedLinqAttachmentDownloadError) {
      throw error;
    }
    if (
      timedOut
      && !input.signal?.aborted
      && isAbortLikeHostedLinqAttachmentError(error)
    ) {
      throw new HostedLinqAttachmentDownloadError(
        "metadata_timeout",
        "Hosted Linq attachment metadata lookup timed out.",
        408,
        { cause: error },
      );
    }
    if (
      !isAbortLikeHostedLinqAttachmentError(error)
      && isHostedLinqTransientTransportError(error)
    ) {
      throw new HostedLinqAttachmentDownloadError(
        "metadata_fetch_failed",
        "Hosted Linq attachment metadata lookup failed.",
        null,
        { cause: error },
      );
    }

    return {
      downloadLocator: null,
      failureCode: classifyHostedLinqAttachmentMetadataError(error),
      status: null,
    };
  } finally {
    clearTimeout(timeout);
    releaseRelay();
  }
}

function resolveHostedLinqAttachmentFetchImplementation(input: {
  platform: HostedLinqAttachmentDownloadPlatform | null;
}): {
  downloadFetch: typeof fetch | null;
  metadataFetch: typeof fetch | null;
} | null {
  const metadataFetch = typeof input.platform?.providerFetch === "function"
    ? input.platform.providerFetch
    : null;
  const downloadFetch = typeof input.platform?.publicInternetFetch === "function"
    ? input.platform.publicInternetFetch
    : null;

  if (!downloadFetch && !metadataFetch) {
    return null;
  }

  return {
    downloadFetch,
    metadataFetch,
  };
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

function classifyHostedLinqAttachmentDownloadError(
  error: unknown,
): HostedLinqAttachmentFailureSummary {
  if (error instanceof HostedLinqAttachmentDownloadError) {
    return {
      code: toHostedRuntimeLogCode(error.code),
      status: error.status,
    };
  }

  if (isAbortLikeHostedLinqAttachmentError(error)) {
    return {
      code: "download_aborted",
      status: null,
    };
  }

  return {
    code: "download_fetch_failed",
    status: null,
  };
}

function classifyHostedLinqAttachmentMetadataError(error: unknown): string {
  return isAbortLikeHostedLinqAttachmentError(error)
    ? "metadata_aborted"
    : "metadata_fetch_failed";
}

function isAbortLikeHostedLinqAttachmentError(error: unknown): boolean {
  return (
    error instanceof DOMException
    && error.name === "AbortError"
  ) || (
    error instanceof Error
    && error.name === "AbortError"
  );
}

function normalizeHostedLinqAttachmentMimeCategory(
  value: string | null | undefined,
): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(normalized)
    ? normalized
    : "unknown";
}

function bucketHostedLinqAttachmentByteCount(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  if (value === 0) {
    return "0";
  }
  if (value < 100_000) {
    return "1-99k";
  }
  if (value < 1_000_000) {
    return "100k-999k";
  }
  if (value < HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES) {
    return "1m-19m";
  }
  return "20m+";
}

function resolveHostedLinqAttachmentCdnBaseKind(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const normalized = env.LINQ_ATTACHMENT_CDN_BASE_URL?.trim();
  if (!normalized) {
    return "default";
  }

  try {
    const candidate = new URL(normalized.replace(/\/+$/u, ""));
    return isHostedLinqAttachmentCdnOverrideAllowed(candidate)
      ? "local_override"
      : "default";
  } catch {
    return "default";
  }
}

function classifyHostedLinqApiBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    return HOSTED_LINQ_LOCAL_ATTACHMENT_CDN_HOSTNAMES.has(url.hostname.toLowerCase())
      ? "local"
      : url.origin === new URL(DEFAULT_HOSTED_LINQ_API_BASE_URL).origin
        ? "default"
        : "custom";
  } catch {
    return "custom";
  }
}

async function writeHostedLinqAttachmentDownloadAttemptLog(input: {
  attempt: HostedLinqAttachmentDownloadAttemptLog;
  platform: HostedLinqAttachmentDownloadPlatform | null;
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
      eventCode: "mailbox.linq_attachment_download_finished",
      level: "info",
      phase: "import",
      redactedJson: toHostedLinqAttachmentDownloadRedactedJson(input.attempt),
    },
    platform: input.platform,
  });
}

function toHostedLinqAttachmentDownloadRedactedJson(
  attempt: HostedLinqAttachmentDownloadAttemptLog,
): HostedRuntimeRedactedJson {
  const output: HostedRuntimeRedactedJson = {};
  for (const [key, value] of Object.entries(attempt)) {
    if (value === undefined) {
      continue;
    }

    output[key] = value;
  }

  return output;
}
