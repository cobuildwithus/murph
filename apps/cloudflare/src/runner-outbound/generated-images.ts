import {
  parseHostedRuntimeAssistantResponseMedia,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  readHostedRuntimeSafeErrorText,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_ISSUE_RECORD_PATH,
} from "@murphai/hosted-execution/routes";

import type { HostedExecutionEnvironment } from "../env.ts";
import { json, jsonError, methodNotAllowed, readJsonObject, unauthorized } from "../json.ts";
import {
  parseHostedRunnerGeneratedImageUploadRequest,
} from "../runner-effects-contract.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";
import { normalizeCloudflareWorkerFetch } from "../worker-fetch.ts";
import {
  requireRunnerRuntimeWriteFenceWrite,
  RunnerRuntimeWriteFenceError,
} from "./write-fence.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "./shared.ts";

const CLOUDFLARE_IMAGES_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const GENERATED_IMAGE_UPLOAD_BODY_LIMIT_BYTES = 14 * 1024 * 1024;
const GENERATED_IMAGE_FILE_LIMIT_BYTES = 10 * 1024 * 1024;
const GENERATED_IMAGE_METADATA_LIMIT_BYTES = 1024;
const GENERATED_IMAGE_UPLOAD_TIMEOUT_MS = 30_000;
const GENERATED_IMAGE_UPLOAD_ISSUE_TIMEOUT_MS = 5_000;
const GENERATED_IMAGE_UPLOAD_ISSUE_SCHEMA = "murph.assistant-runtime-issue.v1";
const GENERATED_IMAGE_UPLOAD_ISSUE_COMPONENT = "assistant.generated-image";
const GENERATED_IMAGE_UPLOAD_ISSUE_OPERATION = "generated_image_upload";
const GENERATED_IMAGE_UPLOAD_ISSUE_SUMMARY =
  "Assistant runtime issue: tool error during tool_call (generated_image_upload).";

export async function handleRunnerGeneratedImageUploadRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  environment?: HostedExecutionEnvironment;
  fetchImpl?: typeof fetch;
  issueFetchImpl?: typeof fetch;
  request: Request;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "POST") {
    return methodNotAllowed();
  }

  try {
    await requireRunnerRuntimeWriteFenceWrite({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return unauthorized();
    }
    throw error;
  }

  let request;
  try {
    request = parseHostedRunnerGeneratedImageUploadRequest(
      await readJsonObject(input.request, {
        limitBytes: GENERATED_IMAGE_UPLOAD_BODY_LIMIT_BYTES,
      }),
    );
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return jsonError("Malformed generated image upload request.", 400);
    }
    throw error;
  }

  const accountId = readRequiredEnvString(
    input.env,
    "CLOUDFLARE_IMAGES_ACCOUNT_ID",
  );
  const apiToken = readRequiredEnvString(
    input.env,
    "CLOUDFLARE_IMAGES_API_KEY",
  );
  if (!accountId || !apiToken) {
    return jsonError("Generated image upload is not configured.", 503);
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Image(request.bytesBase64);
    assertGeneratedImageBytes({
      bytes,
      contentType: request.contentType,
    });
    assertGeneratedImageMetadata(request.metadata);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return jsonError("Malformed generated image upload request.", 400);
    }
    throw error;
  }

  let uploadResponse: Response;
  try {
    uploadResponse = await uploadCloudflareImage({
      accountId,
      apiToken,
      bytes,
      contentType: request.contentType,
      filename: request.filename,
      fetchImpl: input.fetchImpl,
      metadata: request.metadata,
    });
  } catch (error) {
    await recordGeneratedImageUploadIssueBestEffort({
      environment: input.environment,
      error,
      fetchImpl: input.issueFetchImpl,
      status: null,
      userId: input.userId,
    });
    emitGeneratedImageUploadFailureLog({
      error,
      status: null,
      userId: input.userId,
    });
    return jsonError("Generated image upload failed.", 502);
  }
  if (!uploadResponse.ok) {
    await recordGeneratedImageUploadIssueBestEffort({
      environment: input.environment,
      error: null,
      fetchImpl: input.issueFetchImpl,
      status: uploadResponse.status,
      userId: input.userId,
    });
    emitGeneratedImageUploadFailureLog({
      error: null,
      status: uploadResponse.status,
      userId: input.userId,
    });
    return jsonError("Generated image upload failed.", 502);
  }

  const payload = await uploadResponse.json().catch(() => null);
  let url: string;
  try {
    url = readCloudflareImageVariantUrl(
      payload,
      readOptionalEnvString(input.env, "CLOUDFLARE_IMAGES_VARIANT") ?? "public",
    );
  } catch {
    return jsonError("Generated image upload failed.", 502);
  }

  return json({
    media: parseHostedRuntimeAssistantResponseMedia({
      kind: "image",
      url,
      alt: request.alt,
      source: request.source,
    }),
  });
}

async function uploadCloudflareImage(input: {
  accountId: string;
  apiToken: string;
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  filename: string;
  fetchImpl?: typeof fetch;
  metadata: Record<string, string>;
}): Promise<Response> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([copyBytesToArrayBuffer(input.bytes)], { type: input.contentType }),
    normalizeGeneratedImageFilename(input.filename, input.contentType),
  );
  form.set("metadata", JSON.stringify(input.metadata));
  form.set("requireSignedURLs", "false");

  const fetchImpl = normalizeCloudflareWorkerFetch(input.fetchImpl);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, GENERATED_IMAGE_UPLOAD_TIMEOUT_MS);
  try {
    return await fetchImpl(
      `${CLOUDFLARE_IMAGES_API_BASE_URL}/accounts/${encodeURIComponent(input.accountId)}/images/v1`,
      {
        body: form,
        headers: {
          authorization: `Bearer ${input.apiToken}`,
        },
        method: "POST",
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function recordGeneratedImageUploadIssueBestEffort(input: {
  environment: HostedExecutionEnvironment | undefined;
  error: unknown;
  fetchImpl: typeof fetch | undefined;
  status: number | null;
  userId: string;
}): Promise<void> {
  if (!input.environment) {
    return;
  }

  try {
    const issue = await createGeneratedImageUploadIssueRecord({
      error: input.error,
      status: input.status,
    });
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      allowHttpHosts: input.environment.hostedWebAllowHttpHosts,
      baseUrl: input.environment.hostedWebBaseUrl,
      body: JSON.stringify({
        issues: [issue],
      }),
      boundUserId: input.userId,
      callbackSigning: input.environment.webCallbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_RUNTIME_ISSUE_RECORD_PATH,
      timeoutMs: Math.min(
        input.environment.webControlTimeoutMs,
        GENERATED_IMAGE_UPLOAD_ISSUE_TIMEOUT_MS,
      ),
    });
    if (response.ok) {
      return;
    }
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        operation: GENERATED_IMAGE_UPLOAD_ISSUE_OPERATION,
        responseStatus: response.status,
      },
      level: "warn",
      message: "Hosted generated-image upload issue export returned non-OK.",
      phase: "wake.running",
      userId: input.userId,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        errorCode: readGeneratedImageUploadIssueErrorCode(error, null),
        errorName: readHostedExecutionSafeErrorName(error) ?? "unknown",
        operation: GENERATED_IMAGE_UPLOAD_ISSUE_OPERATION,
      },
      level: "warn",
      message: "Hosted generated-image upload issue export failed.",
      phase: "wake.running",
      userId: input.userId,
    });
  }
}

async function createGeneratedImageUploadIssueRecord(input: {
  error: unknown;
  status: number | null;
}) {
  const occurredAt = new Date().toISOString();
  const errorCode = readGeneratedImageUploadIssueErrorCode(input.error, input.status);
  const fingerprint = await createGeneratedImageUploadIssueFingerprint(errorCode);
  return {
    component: GENERATED_IMAGE_UPLOAD_ISSUE_COMPONENT,
    details: {
      errorCode,
      ...(readHostedExecutionSafeErrorName(input.error)
        ? { errorName: readHostedExecutionSafeErrorName(input.error) }
        : {}),
      ...(readHostedRuntimeSafeErrorText(input.error)
        ? { errorMessage: readHostedRuntimeSafeErrorText(input.error) }
        : {}),
      failureKind: input.status === null ? "thrown" : "http_status",
      provider: "cloudflare_images",
      ...(input.status === null ? {} : { responseStatus: input.status }),
      timeoutMs: GENERATED_IMAGE_UPLOAD_TIMEOUT_MS,
    },
    environment: "hosted",
    errorCode,
    fingerprint,
    issueId: await createGeneratedImageUploadIssueId({
      fingerprint,
      occurredAt,
    }),
    issueKind: "tool_error",
    occurredAt,
    operation: GENERATED_IMAGE_UPLOAD_ISSUE_OPERATION,
    phase: "tool_call",
    schema: GENERATED_IMAGE_UPLOAD_ISSUE_SCHEMA,
    severity: "error",
    summary: GENERATED_IMAGE_UPLOAD_ISSUE_SUMMARY,
    surface: "hosted.runner-outbound",
  };
}

async function createGeneratedImageUploadIssueFingerprint(
  errorCode: string,
): Promise<string> {
  return (await sha256Hex(JSON.stringify({
    component: GENERATED_IMAGE_UPLOAD_ISSUE_COMPONENT,
    errorCode,
    issueKind: "tool_error",
    operation: GENERATED_IMAGE_UPLOAD_ISSUE_OPERATION,
    phase: "tool_call",
    summary: GENERATED_IMAGE_UPLOAD_ISSUE_SUMMARY,
  }))).slice(0, 24);
}

async function createGeneratedImageUploadIssueId(input: {
  fingerprint: string;
  occurredAt: string;
}): Promise<string> {
  const nonce = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random()}`;
  return [
    "ari",
    (await sha256Hex(`${input.occurredAt}:${nonce}`)).slice(0, 16),
    input.fingerprint,
  ].join("_");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readGeneratedImageUploadIssueErrorCode(
  error: unknown,
  status: number | null,
): string {
  if (status !== null) {
    return `http_${status}`;
  }
  if (error instanceof TypeError) {
    return "type_error";
  }
  return deriveHostedExecutionErrorCode(error);
}

function emitGeneratedImageUploadFailureLog(input: {
  error: unknown;
  status: number | null;
  userId: string;
}): void {
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      errorCode: readGeneratedImageUploadIssueErrorCode(input.error, input.status),
      ...(readHostedExecutionSafeErrorName(input.error)
        ? { errorName: readHostedExecutionSafeErrorName(input.error) }
        : {}),
      operation: GENERATED_IMAGE_UPLOAD_ISSUE_OPERATION,
      ...(input.status === null ? {} : { responseStatus: input.status }),
    },
    level: "warn",
    message: "Hosted generated-image upload failed.",
    phase: "wake.running",
    userId: input.userId,
  });
}

function decodeBase64Image(value: string): Uint8Array {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) || normalized.length === 0) {
    throw new TypeError("Generated image bytes must be base64.");
  }

  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw new TypeError("Generated image bytes must be base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function assertGeneratedImageBytes(input: {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}): void {
  if (
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > GENERATED_IMAGE_FILE_LIMIT_BYTES
  ) {
    throw new RangeError("Generated image size is invalid.");
  }
  if (!generatedImageBytesMatchContentType(input.bytes, input.contentType)) {
    throw new TypeError("Generated image content type is invalid.");
  }
}

function generatedImageBytesMatchContentType(
  bytes: Uint8Array,
  contentType: "image/jpeg" | "image/png" | "image/webp",
): boolean {
  switch (contentType) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 &&
        bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    case "image/png":
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
        bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
        bytes[6] === 0x1a && bytes[7] === 0x0a;
    case "image/webp":
      return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
        bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
        bytes[10] === 0x42 && bytes[11] === 0x50;
  }
}

function assertGeneratedImageMetadata(metadata: Record<string, string>): void {
  const metadataJson = JSON.stringify(metadata);
  if (new TextEncoder().encode(metadataJson).byteLength > GENERATED_IMAGE_METADATA_LIMIT_BYTES) {
    throw new RangeError("Generated image metadata is too large.");
  }
}

function normalizeGeneratedImageFilename(
  filename: string,
  contentType: "image/jpeg" | "image/png" | "image/webp",
): string {
  const fallback = `generated.${contentType === "image/jpeg" ? "jpg" : contentType.slice(6)}`;
  const normalized = filename.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(normalized)) {
    return fallback;
  }
  return normalized;
}

function readCloudflareImageVariantUrl(payload: unknown, variant: string): string {
  const result = asRecord(asRecord(payload)?.result);
  const variants = Array.isArray(result?.variants) ? result.variants : [];
  const preferred = variants.find((entry) =>
    typeof entry === "string" && entry.endsWith(`/${variant}`)
  );
  const fallback = variants.find((entry): entry is string => typeof entry === "string");
  const url = typeof preferred === "string" ? preferred : fallback;
  if (!url) {
    throw new TypeError("Cloudflare Images upload did not return a delivery URL.");
  }
  return url;
}

function readRequiredEnvString(
  env: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = readOptionalEnvString(env, key);
  return value && value.length > 0 ? value : null;
}

function readOptionalEnvString(
  env: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
