import type {
  HostedRuntimeEnsureProcessingResponse,
} from "../index.js";
import {
  parseHostedRuntimeEnsureProcessingRequest,
  parseHostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ENSURE_PROCESSING_ACTIVITY_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_REQUEST_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
} from "@murphai/hosted-execution/contracts";

import {
  observeHostedTemporalActivity,
  readHostedOrchestratorTemporalCloudflareEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

export interface EnsureRuntimeProcessingInput {
  orchestrationAttemptId: string;
  userId: string;
}

const CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_PREFIX = "/internal/users/";
const CLOUDFLARE_RUNTIME_ENSURE_PROCESSING_PATH_SUFFIX =
  "/runtime/ensure-processing";

export async function ensureRuntimeProcessing(
  request: EnsureRuntimeProcessingInput,
): Promise<HostedRuntimeEnsureProcessingResponse> {
  const activityStartedAtEpochMs = Date.now();
  const parsedRequest = parseEnsureRuntimeProcessingInput(request);
  const cloudflareEnvironment = readHostedOrchestratorTemporalCloudflareEnvironment();
  const cloudflareRequest = parseHostedRuntimeEnsureProcessingRequest({
    orchestrationAttemptId: parsedRequest.orchestrationAttemptId,
  });

  return observeHostedTemporalActivity({
    activity: "ensureRuntimeProcessing",
    orchestrationAttemptId: parsedRequest.orchestrationAttemptId,
    userId: parsedRequest.userId,
  }, async () => {
    const requestStartedAtEpochMs = Date.now();
    return await requestHostedOrchestratorJson(
      cloudflareEnvironment.cloudflareHostedControlBaseUrl,
      {
        body: JSON.stringify(cloudflareRequest),
        boundUserId: parsedRequest.userId,
        unsignedHeaders: {
          [HOSTED_RUNTIME_ENSURE_PROCESSING_ACTIVITY_STARTED_AT_MS_HEADER]:
            String(activityStartedAtEpochMs),
          [HOSTED_RUNTIME_ENSURE_PROCESSING_REQUEST_STARTED_AT_MS_HEADER]:
            String(requestStartedAtEpochMs),
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
    );
  });
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
    "userId",
  ]);

  return {
    orchestrationAttemptId: requireOpaqueIdentifier(
      record.orchestrationAttemptId,
      "Hosted runtime ensure-processing Activity input orchestrationAttemptId",
    ),
    userId: requireOpaqueIdentifier(
      record.userId,
      "Hosted runtime ensure-processing Activity input userId",
    ),
  };
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
