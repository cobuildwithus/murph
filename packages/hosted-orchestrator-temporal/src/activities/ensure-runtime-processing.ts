import type {
  HostedRuntimeEnsureProcessingResponse,
} from "../index.js";
import {
  parseHostedRuntimeEnsureProcessingRequest,
  parseHostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
} from "@murphai/hosted-execution/contracts";

import {
  observeHostedTemporalActivity,
  readHostedOrchestratorTemporalCloudflareEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

export interface EnsureRuntimeProcessingInput {
  orchestrationAttemptId: string;
  processingMode?: "default" | "inbox_media_retention" | null;
  userId: string;
}

const CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_PREFIX = "/internal/users/";
const CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_SUFFIX =
  "/runtime/ensure-processing";

export async function ensureRuntimeProcessing(
  request: EnsureRuntimeProcessingInput,
): Promise<HostedRuntimeEnsureProcessingResponse> {
  const parsedRequest = parseEnsureRuntimeProcessingInput(request);
  const cloudflareEnvironment = readHostedOrchestratorTemporalCloudflareEnvironment();
  const cloudflareRequest = parseHostedRuntimeEnsureProcessingRequest({
    orchestrationAttemptId: parsedRequest.orchestrationAttemptId,
    ...(parsedRequest.processingMode ? { processingMode: parsedRequest.processingMode } : {}),
  });

  return observeHostedTemporalActivity({
    activity: "ensureRuntimeProcessing",
    orchestrationAttemptId: parsedRequest.orchestrationAttemptId,
    userId: parsedRequest.userId,
  }, async () =>
    await requestHostedOrchestratorJson(
      cloudflareEnvironment.cloudflareHostedControlBaseUrl,
      {
        body: JSON.stringify(cloudflareRequest),
        boundUserId: parsedRequest.userId,
        unsignedHeaders: {
          [HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER]:
            String(cloudflareEnvironment.ensureRuntimeProcessingHttpTimeoutMs),
        },
        label: "runtime ensure processing",
        method: "POST",
        parse: parseHostedRuntimeEnsureProcessingResponse,
        path: buildCloudflareRuntimeEnsureProcessingPath(parsedRequest.userId),
        signing: cloudflareEnvironment.cloudflareHostedControlSigning,
        timeoutMs: cloudflareEnvironment.ensureRuntimeProcessingHttpTimeoutMs,
      },
    )
  );
}

function parseEnsureRuntimeProcessingInput(
  value: unknown,
): EnsureRuntimeProcessingInput {
  if (!isRecord(value)) {
    throw new TypeError("Hosted runtime ensure-processing Activity input must be an object.");
  }

  const record = value;
  assertExactKeys(record, "Hosted runtime ensure-processing Activity input", [
    "orchestrationAttemptId",
    "processingMode",
    "userId",
  ]);

  return {
    orchestrationAttemptId: requireOpaqueIdentifier(
      record.orchestrationAttemptId,
      "Hosted runtime ensure-processing Activity input orchestrationAttemptId",
    ),
    ...(record.processingMode === undefined
      ? {}
      : {
          processingMode: parseNullableProcessingMode(
            record.processingMode,
            "Hosted runtime ensure-processing Activity input processingMode",
          ),
        }),
    userId: requireOpaqueIdentifier(
      record.userId,
      "Hosted runtime ensure-processing Activity input userId",
    ),
  };
}

function parseNullableProcessingMode(
  value: unknown,
  label: string,
): "default" | "inbox_media_retention" | null {
  if (value === null) {
    return null;
  }
  if (value === "default" || value === "inbox_media_retention") {
    return value;
  }
  throw new TypeError(`${label} is not supported.`);
}

function buildCloudflareRuntimeEnsureProcessingPath(userId: string): string {
  return `${CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_PREFIX}${encodeURIComponent(userId)}${
    CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_SUFFIX
  }`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
  record: Record<string, unknown>,
  label: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} must not include ${key}.`);
    }
  }
}

function requireOpaqueIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  if (value.length > 192 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    throw new TypeError(`${label} must be a bounded opaque identifier.`);
  }
  return value;
}
