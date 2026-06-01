import {
  downloadHostedProviderTelegramFile,
  getHostedProviderTelegramFile,
  type HostedProviderEffectDependencies,
} from "@murphai/assistant-runtime/hosted-provider-effects";

import { json, jsonError, methodNotAllowed, readJsonObject, unauthorized } from "../json.ts";
import {
  HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
  parseHostedRunnerTelegramDownloadFileRequest,
  parseHostedRunnerTelegramGetFileRequest,
  type HostedRunnerProviderEffectErrorResponse,
} from "../runner-effects-contract.ts";
import { asWorkerStringEnvironment } from "../worker-contracts.ts";
import {
  requireRunnerRuntimeWriteFenceWrite,
  RunnerRuntimeWriteFenceError,
} from "./write-fence.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "./shared.ts";

const PROVIDER_EFFECT_BODY_LIMIT_BYTES = 1024 * 1024;
const TELEGRAM_FILE_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

export async function handleRunnerProviderEffectsRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  pathname: string;
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

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(input.request, {
      limitBytes: PROVIDER_EFFECT_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (
      error instanceof SyntaxError
      || error instanceof TypeError
      || error instanceof RangeError
    ) {
      return jsonError("Malformed provider effect request.", 400);
    }
    throw error;
  }

  try {
    return await dispatchRunnerProviderEffectsRequest({
      body,
      env: input.env,
      pathname: input.pathname,
      requestSignal: input.request.signal,
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) {
      return jsonError("Malformed provider effect request.", 400);
    }
    return json(readHostedProviderEffectErrorResponse(error), 502);
  }
}

async function dispatchRunnerProviderEffectsRequest(input: {
  body: Record<string, unknown>;
  env: RunnerOutboundEnvironmentSource;
  pathname: string;
  requestSignal: AbortSignal;
}): Promise<Response> {
  const dependencies = createProviderEffectDependencies({
    env: input.env,
    requestSignal: input.requestSignal,
  });

  switch (input.pathname) {
    case HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH:
      return json({
        file: await getHostedProviderTelegramFile(
          parseHostedRunnerTelegramGetFileRequest(input.body),
          dependencies,
        ),
      });
    case HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH:
      return await handleTelegramDownloadFileEffect(input.body, dependencies);
    default:
      return jsonError("Not found", 404);
  }
}

function createProviderEffectDependencies(input: {
  env: RunnerOutboundEnvironmentSource;
  requestSignal: AbortSignal;
}): HostedProviderEffectDependencies {
  return {
    env: asWorkerStringEnvironment(input.env) as NodeJS.ProcessEnv,
    fetchImplementation: fetch,
    signal: input.requestSignal,
  };
}

async function handleTelegramDownloadFileEffect(
  body: Record<string, unknown>,
  dependencies: HostedProviderEffectDependencies,
): Promise<Response> {
  const request = parseHostedRunnerTelegramDownloadFileRequest(body);
  const bytes = await downloadHostedProviderTelegramFile(request, dependencies);
  if (!bytes) {
    return json({ file: null });
  }
  if (bytes.byteLength > TELEGRAM_FILE_DOWNLOAD_MAX_BYTES) {
    throw new RangeError("Hosted Telegram file exceeds the download limit.");
  }

  return json({
    file: {
      bytesBase64: encodeBase64(bytes),
      contentType: null,
      fileName: readFileNameFromProviderPath(request.filePath),
      sha256: await sha256Hex(bytes),
    },
  });
}

function readHostedProviderEffectErrorResponse(
  error: unknown,
): HostedRunnerProviderEffectErrorResponse {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const context = record?.context && typeof record.context === "object" && !Array.isArray(record.context)
    ? record.context as Record<string, unknown>
    : null;
  const code = typeof record?.code === "string" ? record.code : null;
  const providerMessageIds =
    readStringArray(record?.providerMessageIds)
    ?? readStringArray(context?.providerMessageIds)
    ?? null;
  const cleanupMessages =
    readCleanupMessages(record?.cleanupMessages)
    ?? readCleanupMessages(context?.cleanupMessages)
    ?? null;
  const cleanupTargetAliases =
    readStringArray(record?.cleanupTargetAliases)
    ?? readStringArray(context?.cleanupTargetAliases)
    ?? null;
  const providerMessageId =
    readOptionalString(record?.providerMessageId)
    ?? providerMessageIds?.at(-1)
    ?? null;
  const target =
    readOptionalString(record?.target)
    ?? readOptionalString(context?.target)
    ?? null;

  return {
    error: code === "ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS"
      ? "Telegram delivery outcome is ambiguous."
      : "Provider effect failed.",
    ...(code ? { code } : {}),
    ...(context ? { context: sanitizeProviderEffectContext(context) } : {}),
    ...(providerMessageId ? { providerMessageId } : {}),
    ...(providerMessageIds ? { providerMessageIds } : {}),
    ...(cleanupMessages ? { cleanupMessages } : {}),
    ...(cleanupTargetAliases ? { cleanupTargetAliases } : {}),
    ...(target ? { target } : {}),
  };
}

function sanitizeProviderEffectContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const cleanupMessages = readCleanupMessages(context.cleanupMessages);
  const cleanupTargetAliases = readStringArray(context.cleanupTargetAliases);
  const providerMessageIds = readStringArray(context.providerMessageIds);
  const originalFailure = readOptionalString(context.originalFailure);
  const operation = readOptionalString(context.operation);
  const provider = readOptionalString(context.provider);
  const rollbackFailure = readOptionalString(context.rollbackFailure);
  const target = readOptionalString(context.target);

  if (cleanupMessages) {
    sanitized.cleanupMessages = cleanupMessages;
  }
  if (cleanupTargetAliases) {
    sanitized.cleanupTargetAliases = cleanupTargetAliases;
  }
  if (originalFailure) {
    sanitized.originalFailure = originalFailure;
  }
  if (providerMessageIds) {
    sanitized.providerMessageIds = providerMessageIds;
  }
  if (provider) {
    sanitized.provider = provider;
  }
  if (operation) {
    sanitized.operation = operation;
  }
  if (rollbackFailure) {
    sanitized.rollbackFailure = rollbackFailure;
  }
  if (target) {
    sanitized.target = target;
  }
  copySafeProviderEffectContextScalar(sanitized, context, "errorCode");
  copySafeProviderEffectContextScalar(sanitized, context, "errorSubcode");
  copySafeProviderEffectContextScalar(sanitized, context, "errorType");
  copySafeProviderEffectContextScalar(sanitized, context, "failureStage");
  copySafeProviderEffectContextScalar(sanitized, context, "retryable");
  copySafeProviderEffectContextScalar(sanitized, context, "status");
  copySafeProviderEffectContextScalar(sanitized, context, "timedOut");
  return sanitized;
}

function copySafeProviderEffectContextScalar(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (
    typeof value === "boolean"
    || typeof value === "number"
    || typeof value === "string"
    || value === null
  ) {
    target[key] = value;
  }
}

function readCleanupMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  const cleanupMessages = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const messageId = readOptionalString((entry as Record<string, unknown>).messageId);
    const target = readOptionalString((entry as Record<string, unknown>).target);
    return messageId && target ? [{ messageId, target }] : [];
  });
  return cleanupMessages.length > 0 ? cleanupMessages : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const values = value
    .map(readOptionalString)
    .filter((entry): entry is string => entry !== null);
  return values.length > 0 ? [...new Set(values)] : null;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readFileNameFromProviderPath(filePath: string): string | null {
  const fileName = filePath.split("/").pop()?.trim() ?? "";
  return fileName.length > 0 ? fileName.slice(0, 240) : null;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : copyBytesToArrayBuffer(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
