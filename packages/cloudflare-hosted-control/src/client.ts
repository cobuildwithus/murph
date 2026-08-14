import {
  parseHostedCipherEnvelope,
  parseHostedUserRecipientPublicKeyJwk,
  parseHostedBrowserSessionKeyEnvelope,
  type HostedBrowserSessionKeyEnvelope,
  type HostedCipherEnvelope,
  type HostedUserRecipientPublicKeyJwk,
} from "@murphai/runtime-state";
import {
  HOSTED_EXECUTION_MEAL_PHOTO_MAX_BYTES,
  HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES,
  HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES,
  type HostedExecutionEnvironmentVoiceContentType,
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_DIRECT_REQUEST_STARTED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRuntimeEnsureProcessingResponse,
  parseHostedRunnerStatusResponse,
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  HostedHealthDataConsentState,
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import { normalizeHostedExecutionBaseUrl } from "@murphai/hosted-execution/env";

import {
  parseCloudflareHostedInferenceVerificationRequest,
  parseCloudflareHostedInferenceVerificationResult,
  type CloudflareHostedInferenceVerificationRequest,
  type CloudflareHostedInferenceVerificationResult,
} from "./inference-verification.ts";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
  CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_CAPTURE_ID_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_KEY_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_SHA256_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_CAPTURE_ID_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_KEY_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_SHA256_HEADER,
  buildCloudflareHostedControlBrowserVaultSessionPath,
  buildCloudflareHostedControlEnvironmentVoiceDeletePath,
  buildCloudflareHostedControlEnvironmentVoiceStagePath,
  buildCloudflareHostedControlInferenceVerificationPath,
  buildCloudflareHostedControlMealPhotoDeletePath,
  buildCloudflareHostedControlMealPhotoStagePath,
  buildCloudflareHostedControlRuntimeEnsureProcessingPath,
  buildCloudflareHostedControlRuntimeHealthDataConsentPath,
  buildCloudflareHostedControlRuntimeShellPrewarmPath,
  buildCloudflareHostedControlTelegramUsageLimitNoticePath,
  buildCloudflareHostedControlUserDataDeletionPath,
  buildCloudflareHostedControlUserStatusPath,
} from "./routes.ts";
import { requireCloudflareHostedControlUserId } from "./user-id.ts";
import {
  CLOUDFLARE_HOSTED_CONTROL_DEVICE_WEBHOOK_ENQUEUE_PATH,
  parseDeviceWebhookQueueEnvelope,
  type DeviceWebhookQueueEnvelopeV1,
} from "./device-webhook-queue.ts";

export interface CloudflareHostedControlBrowserVaultSession {
  encryptedReplica: HostedCipherEnvelope;
  replicaAad: CloudflareHostedControlBrowserVaultReplicaAad;
  replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
  replicaRef: HostedBrowserVaultReplicaRef;
  state: "ready";
}

export interface CloudflareHostedControlBrowserVaultReplicaAad {
  dataKeyId?: string;
  dataKeyRootKeyId?: string;
  dataVersion: string;
  objectKey: string;
  purpose: "browser-vault-replica";
  runtimeRootKeyId: string;
  schema: "murph.browser-vault-replica";
  sourceBundleHash: string;
  userId: string;
}

export interface CloudflareHostedControlUserDataDeletionResult {
  durableObject: {
    alarmCleared: boolean;
    deleteAllCompleted: boolean;
    stateDeleted: boolean;
  };
  deletedAt: string;
  ok: true;
  r2: {
    deletedObjectCount: number;
    skippedUserScopedPrefixes: boolean;
    supported: boolean;
    userScopedSkipReason: string | null;
  };
  userId: string;
}

export interface CloudflareHostedControlRuntimeHealthDataConsentResult {
  activeInvocationPreempted: boolean;
  consentState: HostedHealthDataConsentState;
  processingAllowed: boolean;
  runnerContainerDestroyAttempted: boolean;
  runnerContainerDestroyOk: boolean;
  userId: string;
}

export interface CloudflareHostedControlTelegramUsageLimitNoticeRequest {
  message: string;
  replyToMessageId: string;
  target: string;
}

export interface CloudflareHostedControlMealPhotoStageResult {
  byteLength: number;
  mealPhotoKey: string;
  sha256: string;
}

export interface CloudflareHostedControlEnvironmentVoiceStageResult {
  audioKey: string;
  byteLength: number;
  sha256: string;
}

export type CloudflareHostedControlTelegramUsageLimitNoticeResponse =
  | {
    status: "sent";
  }
  | {
    failureCode: string;
    retryAfterSeconds?: number;
    retryable: boolean;
    status: "failed";
  };

export interface CloudflareHostedControlClient {
  enqueueDeviceWebhook(
    envelope: DeviceWebhookQueueEnvelopeV1,
  ): Promise<{ accepted: true; transportId: string }>;
  createBrowserVaultSession(input: {
    browserPublicKeyJwk: HostedUserRecipientPublicKeyJwk;
    replicaRef: HostedBrowserVaultReplicaRef;
    userId: string;
  }): Promise<CloudflareHostedControlBrowserVaultSession>;
  deleteUserData(
    userId: string,
    options?: { signal?: AbortSignal },
  ): Promise<CloudflareHostedControlUserDataDeletionResult>;
  deleteMealPhoto(input: {
    mealPhotoKey: string;
    userId: string;
  }): Promise<void>;
  deleteEnvironmentVoice(input: {
    audioKey: string;
    userId: string;
  }): Promise<void>;
  ensureRuntimeProcessing(input: {
    onTiming?: (timing: CloudflareHostedControlRuntimeEnsureProcessingTiming) => void;
    orchestrationAttemptId: string;
    userId: string;
  }): Promise<CloudflareHostedControlRuntimeEnsureProcessingResponse>;
  prewarmRuntimeShell(input: {
    source: CloudflareHostedControlRuntimeShellPrewarmSource;
    userId: string;
  }): Promise<CloudflareHostedControlRuntimeShellPrewarmAcceptedAck>;
  reconcileRuntimeHealthDataConsent(
    userId: string,
  ): Promise<CloudflareHostedControlRuntimeHealthDataConsentResult>;
  getRunnerStatus(userId: string): Promise<HostedRunnerStatusResponse>;
  verifyInferenceConnection(input: {
    request: CloudflareHostedInferenceVerificationRequest;
    userId: string;
  }): Promise<CloudflareHostedInferenceVerificationResult>;
  sendTelegramUsageLimitNotice(input: {
    onRequestAttempted?: () => Promise<void> | void;
    request: CloudflareHostedControlTelegramUsageLimitNoticeRequest;
    userId: string;
  }): Promise<CloudflareHostedControlTelegramUsageLimitNoticeResponse>;
  stageMealPhoto(input: {
    bytes: Uint8Array;
    captureId: string;
    sha256: string;
    userId: string;
  }): Promise<CloudflareHostedControlMealPhotoStageResult>;
  stageEnvironmentVoice(input: {
    bytes: Uint8Array;
    captureId: string;
    contentType: HostedExecutionEnvironmentVoiceContentType;
    sha256: string;
    userId: string;
  }): Promise<CloudflareHostedControlEnvironmentVoiceStageResult>;
}

export interface CloudflareHostedControlRuntimeEnsureProcessingAcceptedAck {
  accepted: true;
}

export interface CloudflareHostedControlRuntimeShellPrewarmAcceptedAck {
  accepted: true;
}

export type CloudflareHostedControlRuntimeShellPrewarmSource =
  | "linq-instant-start"
  | "linq-typing-started";

export type CloudflareHostedControlRuntimeEnsureProcessingResponse =
  | HostedRuntimeEnsureProcessingResponse
  | CloudflareHostedControlRuntimeEnsureProcessingAcceptedAck;

export interface CloudflareHostedControlRuntimeEnsureProcessingTiming {
  directEnsureRequestStartedAtEpochMs: number;
  directEnsureResponseReceivedAtEpochMs: number;
  orchestrationAttemptId: string;
  tokenAcquiredAtEpochMs: number;
  tokenAcquireStartedAtEpochMs: number;
}

export interface CloudflareHostedControlClientOptions {
  allowHttpHosts?: readonly string[];
  allowHttpLocalhost?: boolean;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getBearerToken: () => Promise<string>;
  timeoutMs?: number;
}

const BROWSER_VAULT_REPLICA_NOT_FOUND_ERROR_MESSAGE = "Hosted execution browser vault replica was not found.";
const HOSTED_MEAL_PHOTO_CAPTURE_ID_PATTERN = /^[a-f0-9]{64}$/u;
const HOSTED_MEAL_PHOTO_KEY_PATTERN = /^[a-f0-9]{40}$/u;
const HOSTED_ENVIRONMENT_VOICE_KEY_PATTERN = /^[a-f0-9]{40}$/u;
const HOSTED_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function parseCloudflareHostedControlTelegramUsageLimitNoticeRequest(
  value: unknown,
): CloudflareHostedControlTelegramUsageLimitNoticeRequest {
  const record = requireRecord(value, "Telegram usage-limit notice request");
  return {
    message: requireString(record.message, "Telegram usage-limit notice request message"),
    replyToMessageId: requireString(
      record.replyToMessageId,
      "Telegram usage-limit notice request replyToMessageId",
    ),
    target: requireString(record.target, "Telegram usage-limit notice request target"),
  };
}

export function createCloudflareHostedControlClient(
  options: CloudflareHostedControlClientOptions,
): CloudflareHostedControlClient {
  const baseUrl = requireHostedExecutionBaseUrl(options.baseUrl, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const getAuthorizationHeader = createHostedExecutionBearerAuthorizationHeaderProvider(
    options.getBearerToken,
  );

  return {
    enqueueDeviceWebhook(envelope) {
      const request = parseDeviceWebhookQueueEnvelope(envelope);
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "device webhook enqueue",
        parse: parseDeviceWebhookEnqueueResponse,
        path: CLOUDFLARE_HOSTED_CONTROL_DEVICE_WEBHOOK_ENQUEUE_PATH,
        request: {
          body: JSON.stringify(request),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    createBrowserVaultSession(input) {
      const userId = requireCloudflareHostedControlUserId(input.userId);
      const browserPublicKeyJwk = parseHostedUserRecipientPublicKeyJwk(input.browserPublicKeyJwk);
      const replicaRef = parseHostedBrowserVaultReplicaRef(
        input.replicaRef,
        "Cloudflare browser vault session request replicaRef",
      );

      if (!replicaRef) {
        throw new TypeError("Cloudflare browser vault session request replicaRef must not be null.");
      }

      const body = JSON.stringify({
        browserPublicKeyJwk,
        replicaRef,
      });

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "browser vault session",
        parse: (value) =>
          parseCloudflareHostedControlBrowserVaultSession(value, {
            replicaRef,
            userId,
          }),
        path: buildCloudflareHostedControlBrowserVaultSessionPath(userId),
        request: {
          body,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      }).catch((error) => {
        if (
          isHostedExecutionHttpError(
            error,
            404,
            CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
          )
        ) {
          throw new Error(BROWSER_VAULT_REPLICA_NOT_FOUND_ERROR_MESSAGE);
        }

        throw error;
      });
    },

    deleteUserData(userId, requestOptions) {
      const expectedUserId = requireCloudflareHostedControlUserId(userId);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: expectedUserId,
        fetchImpl,
        getAuthorizationHeader,
        label: "user data deletion",
        parse: (value) => parseCloudflareHostedControlUserDataDeletionResult(value, expectedUserId),
        path: buildCloudflareHostedControlUserDataDeletionPath(expectedUserId),
        request: {
          body: "{}",
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        signal: requestOptions?.signal,
        timeoutMs: options.timeoutMs,
      });
    },
    async deleteMealPhoto(input) {
      const userId = requireCloudflareHostedControlUserId(input.userId);
      const mealPhotoKey = requireMealPhotoKey(input.mealPhotoKey);

      await requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "meal-photo deletion",
        parse: parseCloudflareHostedControlMealPhotoDeleteResult,
        path: buildCloudflareHostedControlMealPhotoDeletePath(userId),
        request: {
          headers: {
            [CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_KEY_HEADER]: mealPhotoKey,
          },
          method: "DELETE",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    async deleteEnvironmentVoice(input) {
      const userId = requireCloudflareHostedControlUserId(input.userId);
      const audioKey = requireEnvironmentVoiceKey(input.audioKey);

      await requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "environment voice deletion",
        parse: parseCloudflareHostedControlEnvironmentVoiceDeleteResult,
        path: buildCloudflareHostedControlEnvironmentVoiceDeletePath(userId),
        request: {
          headers: {
            [CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_KEY_HEADER]: audioKey,
          },
          method: "DELETE",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    ensureRuntimeProcessing(input) {
      const userId = requireCloudflareHostedControlUserId(input.userId);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "runtime ensure-processing",
        onRuntimeEnsureProcessingTiming: input.onTiming,
        parse: parseCloudflareHostedControlRuntimeEnsureProcessingResponse,
        path: buildCloudflareHostedControlRuntimeEnsureProcessingPath(userId),
        request: {
          body: JSON.stringify({
            orchestrationAttemptId: input.orchestrationAttemptId,
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        runtimeEnsureProcessingOrchestrationAttemptId:
          input.orchestrationAttemptId,
        timeoutMs: options.timeoutMs,
      });
    },
    prewarmRuntimeShell(input) {
      const expectedUserId = requireCloudflareHostedControlUserId(input.userId);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: expectedUserId,
        fetchImpl,
        getAuthorizationHeader,
        label: "runtime shell prewarm",
        parse: parseCloudflareHostedControlRuntimeShellPrewarmResponse,
        path: buildCloudflareHostedControlRuntimeShellPrewarmPath(expectedUserId),
        request: {
          body: JSON.stringify({ source: input.source }),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    reconcileRuntimeHealthDataConsent(userId) {
      const expectedUserId = requireCloudflareHostedControlUserId(userId);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: expectedUserId,
        fetchImpl,
        getAuthorizationHeader,
        label: "runtime health-data consent reconciliation",
        parse: (value) =>
          parseCloudflareHostedControlRuntimeHealthDataConsentResult(
            value,
            expectedUserId,
          ),
        path: buildCloudflareHostedControlRuntimeHealthDataConsentPath(
          expectedUserId,
        ),
        request: {
          body: "{}",
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    getRunnerStatus(userId) {
      const expectedUserId = requireCloudflareHostedControlUserId(userId);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: expectedUserId,
        fetchImpl,
        getAuthorizationHeader,
        label: "runner status",
        parse: (value) => parseHostedRunnerStatusForExpectedUser(value, expectedUserId),
        path: buildCloudflareHostedControlUserStatusPath(expectedUserId),
        request: { method: "GET" },
        timeoutMs: options.timeoutMs,
      });
    },
    verifyInferenceConnection(input) {
      const userId = requireCloudflareHostedControlUserId(input.userId);
      const request = parseCloudflareHostedInferenceVerificationRequest(
        input.request,
      );

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "custom inference verification",
        parse: parseCloudflareHostedInferenceVerificationResult,
        path: buildCloudflareHostedControlInferenceVerificationPath(userId),
        request: {
          body: JSON.stringify(request),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    sendTelegramUsageLimitNotice(input) {
      const request = parseCloudflareHostedControlTelegramUsageLimitNoticeRequest(
        input.request,
      );
      const userId = requireCloudflareHostedControlUserId(input.userId);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "Telegram usage-limit notice",
        onRequestAttempted: input.onRequestAttempted,
        parse: parseCloudflareHostedControlTelegramUsageLimitNoticeResponse,
        path: buildCloudflareHostedControlTelegramUsageLimitNoticePath(userId),
        request: {
          body: JSON.stringify(request),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    async stageMealPhoto(input) {
      const userId = requireCloudflareHostedControlUserId(input.userId);
      const captureId = requireMealPhotoCaptureId(input.captureId);
      const bytes = copyUint8Array(input.bytes, "Cloudflare meal-photo bytes");
      if (
        bytes.byteLength === 0
        || bytes.byteLength > HOSTED_EXECUTION_MEAL_PHOTO_MAX_BYTES
      ) {
        throw new RangeError(
          `Cloudflare meal-photo bytes must contain between 1 and ${HOSTED_EXECUTION_MEAL_PHOTO_MAX_BYTES} bytes.`,
        );
      }
      const sha256 = requireSha256(input.sha256, "Cloudflare meal-photo sha256");
      const actualSha256 = await sha256Hex(bytes);
      if (actualSha256 !== sha256) {
        throw new TypeError("Cloudflare meal-photo sha256 must match bytes.");
      }

      return await requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "meal-photo staging",
        parse: (value) => parseCloudflareHostedControlMealPhotoStageResult(value, {
          byteLength: bytes.byteLength,
          sha256,
        }),
        path: buildCloudflareHostedControlMealPhotoStagePath(userId),
        request: {
          body: copyBytesToArrayBuffer(bytes),
          headers: {
            [CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_CAPTURE_ID_HEADER]: captureId,
            [CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_SHA256_HEADER]: sha256,
            "content-type": "image/jpeg",
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    async stageEnvironmentVoice(input) {
      const userId = requireCloudflareHostedControlUserId(input.userId);
      const captureId = requireMealPhotoCaptureId(input.captureId);
      const bytes = copyUint8Array(
        input.bytes,
        "Cloudflare environment voice bytes",
      );
      if (
        bytes.byteLength === 0
        || bytes.byteLength > HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES
      ) {
        throw new RangeError(
          `Cloudflare environment voice bytes must contain between 1 and ${HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES} bytes.`,
        );
      }
      const contentType = HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES.find(
        (candidate) => candidate === input.contentType,
      );
      if (!contentType) {
        throw new TypeError("Cloudflare environment voice content type is invalid.");
      }
      const sha256 = requireSha256(
        input.sha256,
        "Cloudflare environment voice sha256",
      );
      if (await sha256Hex(bytes) !== sha256) {
        throw new TypeError(
          "Cloudflare environment voice sha256 must match bytes.",
        );
      }

      return await requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "environment voice staging",
        parse: (value) =>
          parseCloudflareHostedControlEnvironmentVoiceStageResult(value, {
            byteLength: bytes.byteLength,
            sha256,
          }),
        path: buildCloudflareHostedControlEnvironmentVoiceStagePath(userId),
        request: {
          body: copyBytesToArrayBuffer(bytes),
          headers: {
            [CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_CAPTURE_ID_HEADER]:
              captureId,
            [CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_SHA256_HEADER]: sha256,
            "content-type": contentType,
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
  };
}

function parseDeviceWebhookEnqueueResponse(
  value: unknown,
): { accepted: true; transportId: string } {
  const record = requireRecord(value, "Device webhook enqueue response");
  if (record.accepted !== true) {
    throw new TypeError("Device webhook enqueue response accepted must be true.");
  }
  const transportId = requireString(
    record.transportId,
    "Device webhook enqueue response transportId",
  );
  return { accepted: true, transportId };
}

function parseCloudflareHostedControlEnvironmentVoiceStageResult(
  value: unknown,
  expected: { byteLength: number; sha256: string },
): CloudflareHostedControlEnvironmentVoiceStageResult {
  const record = requireRecord(value, "Cloudflare environment voice stage result");
  const audioKey = requireString(
    record.audioKey,
    "Cloudflare environment voice stage result audioKey",
  );
  const byteLength = requireNonNegativeInteger(
    record.byteLength,
    "Cloudflare environment voice stage result byteLength",
  );
  const sha256 = requireSha256(
    record.sha256,
    "Cloudflare environment voice stage result sha256",
  );
  if (!HOSTED_ENVIRONMENT_VOICE_KEY_PATTERN.test(audioKey)) {
    throw new TypeError(
      "Cloudflare environment voice stage result audioKey is invalid.",
    );
  }
  assertMatchingNumber(
    byteLength,
    expected.byteLength,
    "Cloudflare environment voice stage result byteLength",
    "the uploaded byte length",
  );
  assertMatchingString(
    sha256,
    expected.sha256,
    "Cloudflare environment voice stage result sha256",
    "the uploaded sha256",
  );
  return { audioKey, byteLength, sha256 };
}

function parseCloudflareHostedControlEnvironmentVoiceDeleteResult(
  value: unknown,
): void {
  const record = requireRecord(value, "Cloudflare environment voice delete result");
  if (record.deleted !== true) {
    throw new TypeError(
      "Cloudflare environment voice delete result deleted must be true.",
    );
  }
}

function parseCloudflareHostedControlMealPhotoStageResult(
  value: unknown,
  expected: { byteLength: number; sha256: string },
): CloudflareHostedControlMealPhotoStageResult {
  const record = requireRecord(value, "Cloudflare meal-photo stage result");
  const byteLength = requireNonNegativeInteger(
    record.byteLength,
    "Cloudflare meal-photo stage result byteLength",
  );
  const mealPhotoKey = requireString(
    record.mealPhotoKey,
    "Cloudflare meal-photo stage result mealPhotoKey",
  );
  const sha256 = requireSha256(
    record.sha256,
    "Cloudflare meal-photo stage result sha256",
  );

  assertMatchingNumber(
    byteLength,
    expected.byteLength,
    "Cloudflare meal-photo stage result byteLength",
    "the uploaded byte length",
  );
  assertMatchingString(
    sha256,
    expected.sha256,
    "Cloudflare meal-photo stage result sha256",
    "the uploaded sha256",
  );
  if (!HOSTED_MEAL_PHOTO_KEY_PATTERN.test(mealPhotoKey)) {
    throw new TypeError(
      "Cloudflare meal-photo stage result mealPhotoKey must be a 40-character lowercase hexadecimal string.",
    );
  }

  return { byteLength, mealPhotoKey, sha256 };
}

function parseCloudflareHostedControlMealPhotoDeleteResult(value: unknown): void {
  const record = requireRecord(value, "Cloudflare meal-photo delete result");
  if (record.deleted !== true) {
    throw new TypeError("Cloudflare meal-photo delete result deleted must be true.");
  }
}

class HostedExecutionHttpResponseError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(input: {
    code: string | undefined;
    label: string;
    status: number;
  }) {
    super(`Hosted execution ${input.label} failed with HTTP ${input.status}.`);
    this.name = "HostedExecutionHttpResponseError";
    this.code = input.code;
    this.status = input.status;
  }
}

export function readCloudflareHostedControlHttpError(
  error: unknown,
): Readonly<{ code: string | undefined; status: number }> | null {
  return error instanceof HostedExecutionHttpResponseError
    ? { code: error.code, status: error.status }
    : null;
}

function isHostedExecutionHttpError(
  error: unknown,
  status: number,
  code?: string,
): error is HostedExecutionHttpResponseError {
  return error instanceof HostedExecutionHttpResponseError &&
    error.status === status &&
    (code === undefined || error.code === code);
}

function parseCloudflareHostedControlBrowserVaultSession(
  value: unknown,
  expected: {
    replicaRef: HostedBrowserVaultReplicaRef;
    userId: string;
  },
): CloudflareHostedControlBrowserVaultSession {
  const record = requireRecord(value, "Cloudflare browser vault session");
  const state = requireString(record.state, "Cloudflare browser vault session state");

  if (state !== "ready") {
    throw new TypeError("Cloudflare browser vault session state must be ready.");
  }

  const replicaRef = parseHostedBrowserVaultReplicaRef(
    record.replicaRef,
    "Cloudflare browser vault session replicaRef",
  );

  if (!replicaRef) {
    throw new TypeError("Cloudflare browser vault session replicaRef must not be null.");
  }

  assertHostedBrowserVaultReplicaRefMatches(
    replicaRef,
    expected.replicaRef,
    "Cloudflare browser vault session replicaRef",
  );

  const encryptedReplica = parseHostedCipherEnvelope(
    record.encryptedReplica,
    "Cloudflare browser vault session encryptedReplica",
  );
  const replicaAad = parseCloudflareHostedControlBrowserVaultReplicaAad(
    record.replicaAad,
    "Cloudflare browser vault session replicaAad",
  );
  const replicaKeyEnvelope = parseHostedBrowserSessionKeyEnvelope(
    record.replicaKeyEnvelope,
    "Cloudflare browser vault session replicaKeyEnvelope",
  );

  assertMatchingString(
    encryptedReplica.keyId,
    getHostedBrowserVaultReplicaStorageKeyId(expected.replicaRef),
    "Cloudflare browser vault session encryptedReplica.keyId",
    "the requested replica storage key id",
  );
  assertMatchingString(
    encryptedReplica.scope,
    "browser-vault-replica",
    "Cloudflare browser vault session encryptedReplica.scope",
    "the browser-vault-replica storage scope",
  );
  assertMatchingString(
    replicaAad.userId,
    expected.userId,
    "Cloudflare browser vault session replicaAad.userId",
    "the requested userId",
  );
  assertMatchingString(
    replicaAad.objectKey,
    expected.replicaRef.objectKey,
    "Cloudflare browser vault session replicaAad.objectKey",
    "the requested replicaRef.objectKey",
  );
  assertMatchingString(
    replicaAad.dataVersion,
    expected.replicaRef.dataVersion,
    "Cloudflare browser vault session replicaAad.dataVersion",
    "the requested replicaRef.dataVersion",
  );
  assertMatchingString(
    replicaAad.sourceBundleHash,
    expected.replicaRef.sourceBundleHash,
    "Cloudflare browser vault session replicaAad.sourceBundleHash",
    "the requested replicaRef.sourceBundleHash",
  );
  assertMatchingString(
    replicaAad.runtimeRootKeyId,
    requireHostedBrowserVaultReplicaRuntimeRootKeyId(expected.replicaRef),
    "Cloudflare browser vault session replicaAad.runtimeRootKeyId",
    "the requested replicaRef.runtimeRootKeyId",
  );
  if (expected.replicaRef.dataKeyEnvelope) {
    assertMatchingString(
      replicaAad.dataKeyId ?? "",
      expected.replicaRef.dataKeyEnvelope.dataKeyId,
      "Cloudflare browser vault session replicaAad.dataKeyId",
      "the requested replicaRef.dataKeyEnvelope.dataKeyId",
    );
    assertMatchingString(
      replicaAad.dataKeyRootKeyId ?? "",
      expected.replicaRef.dataKeyEnvelope.rootKeyId,
      "Cloudflare browser vault session replicaAad.dataKeyRootKeyId",
      "the requested replicaRef.dataKeyEnvelope.rootKeyId",
    );
  }
  assertMatchingString(
    replicaKeyEnvelope.userId,
    expected.userId,
    "Cloudflare browser vault session replicaKeyEnvelope.userId",
    "the requested userId",
  );
  assertMatchingString(
    replicaKeyEnvelope.keyId,
    getHostedBrowserVaultReplicaStorageKeyId(expected.replicaRef),
    "Cloudflare browser vault session replicaKeyEnvelope.keyId",
    "the requested replica storage key id",
  );

  if (replicaKeyEnvelope.recipients.length === 0) {
    throw new TypeError("Cloudflare browser vault session replicaKeyEnvelope.recipients must not be empty.");
  }

  for (const [index, recipient] of replicaKeyEnvelope.recipients.entries()) {
    assertMatchingString(
      recipient.keyId,
      getHostedBrowserVaultReplicaStorageKeyId(expected.replicaRef),
      `Cloudflare browser vault session replicaKeyEnvelope.recipients[${index}].keyId`,
      "the requested replica storage key id",
    );
  }

  return {
    encryptedReplica,
    replicaAad,
    replicaKeyEnvelope,
    replicaRef,
    state,
  };
}

function parseCloudflareHostedControlBrowserVaultReplicaAad(
  value: unknown,
  label: string,
): CloudflareHostedControlBrowserVaultReplicaAad {
  const record = requireRecord(value, label);
  const purpose = requireString(record.purpose, `${label}.purpose`);
  const schema = requireString(record.schema, `${label}.schema`);

  if (purpose !== "browser-vault-replica") {
    throw new TypeError(`${label}.purpose must be browser-vault-replica.`);
  }
  if (schema !== "murph.browser-vault-replica") {
    throw new TypeError(`${label}.schema must be murph.browser-vault-replica.`);
  }

  return {
    ...(record.dataKeyId === undefined
      ? {}
      : { dataKeyId: requireString(record.dataKeyId, `${label}.dataKeyId`) }),
    ...(record.dataKeyRootKeyId === undefined
      ? {}
      : {
          dataKeyRootKeyId: requireString(
            record.dataKeyRootKeyId,
            `${label}.dataKeyRootKeyId`,
          ),
        }),
    dataVersion: requireString(record.dataVersion, `${label}.dataVersion`),
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
    purpose,
    runtimeRootKeyId: requireString(record.runtimeRootKeyId, `${label}.runtimeRootKeyId`),
    schema,
    sourceBundleHash: requireString(record.sourceBundleHash, `${label}.sourceBundleHash`),
    userId: requireString(record.userId, `${label}.userId`),
  };
}

function parseCloudflareHostedControlUserDataDeletionResult(
  value: unknown,
  expectedUserId: string,
): CloudflareHostedControlUserDataDeletionResult {
  const record = requireRecord(value, "Cloudflare user-data deletion result");

  if (record.ok !== true) {
    throw new TypeError("Cloudflare user-data deletion result ok must be true.");
  }

  const userId = requireString(record.userId, "Cloudflare user-data deletion result userId");
  assertMatchingString(
    userId,
    expectedUserId,
    "Cloudflare user-data deletion result userId",
    "the requested userId",
  );

  const durableObject = requireRecord(
    record.durableObject,
    "Cloudflare user-data deletion result durableObject",
  );
  const r2 = requireRecord(record.r2, "Cloudflare user-data deletion result r2");
  const userScopedSkipReason = r2.userScopedSkipReason;

  return {
    deletedAt: requireString(record.deletedAt, "Cloudflare user-data deletion result deletedAt"),
    durableObject: {
      alarmCleared: requireBoolean(
        durableObject.alarmCleared,
        "Cloudflare user-data deletion result durableObject.alarmCleared",
      ),
      deleteAllCompleted: requireBoolean(
        durableObject.deleteAllCompleted,
        "Cloudflare user-data deletion result durableObject.deleteAllCompleted",
      ),
      stateDeleted: requireBoolean(
        durableObject.stateDeleted,
        "Cloudflare user-data deletion result durableObject.stateDeleted",
      ),
    },
    ok: true,
    r2: {
      deletedObjectCount: requireNonNegativeInteger(
        r2.deletedObjectCount,
        "Cloudflare user-data deletion result r2.deletedObjectCount",
      ),
      skippedUserScopedPrefixes: requireBoolean(
        r2.skippedUserScopedPrefixes,
        "Cloudflare user-data deletion result r2.skippedUserScopedPrefixes",
      ),
      supported: requireBoolean(r2.supported, "Cloudflare user-data deletion result r2.supported"),
      userScopedSkipReason: typeof userScopedSkipReason === "string" && userScopedSkipReason.length > 0
        ? userScopedSkipReason
        : null,
    },
    userId,
  };
}

function parseCloudflareHostedControlRuntimeHealthDataConsentResult(
  value: unknown,
  expectedUserId: string,
): CloudflareHostedControlRuntimeHealthDataConsentResult {
  const record = requireRecord(
    value,
    "Cloudflare runtime health-data consent result",
  );
  const userId = requireString(
    record.userId,
    "Cloudflare runtime health-data consent result userId",
  );
  assertMatchingString(
    userId,
    expectedUserId,
    "Cloudflare runtime health-data consent result userId",
    "the requested userId",
  );
  const rawConsentState = requireString(
    record.consentState,
    "Cloudflare runtime health-data consent result consentState",
  );
  if (
    rawConsentState !== "granted"
    && rawConsentState !== "revoked"
    && rawConsentState !== "missing"
  ) {
    throw new TypeError(
      "Cloudflare runtime health-data consent result consentState is invalid.",
    );
  }
  const processingAllowed = requireBoolean(
    record.processingAllowed,
    "Cloudflare runtime health-data consent result processingAllowed",
  );
  if (processingAllowed !== (rawConsentState !== "revoked")) {
    throw new TypeError(
      "Cloudflare runtime health-data consent result processingAllowed did not match consentState.",
    );
  }

  return {
    activeInvocationPreempted: requireBoolean(
      record.activeInvocationPreempted,
      "Cloudflare runtime health-data consent result activeInvocationPreempted",
    ),
    consentState: rawConsentState,
    processingAllowed,
    runnerContainerDestroyAttempted: requireBoolean(
      record.runnerContainerDestroyAttempted,
      "Cloudflare runtime health-data consent result runnerContainerDestroyAttempted",
    ),
    runnerContainerDestroyOk: requireBoolean(
      record.runnerContainerDestroyOk,
      "Cloudflare runtime health-data consent result runnerContainerDestroyOk",
    ),
    userId,
  };
}

function parseHostedRunnerStatusForExpectedUser(
  value: unknown,
  expectedUserId: string,
): HostedRunnerStatusResponse {
  const status = parseHostedRunnerStatusResponse(value);

  assertMatchingString(
    status.userId,
    expectedUserId,
    "Hosted runner status userId",
    "the requested userId",
  );

  if (status.workspace) {
    assertMatchingString(
      status.workspace.userId,
      expectedUserId,
      "Hosted runner status workspace.userId",
      "the requested userId",
    );
  }

  return status;
}

function parseCloudflareHostedControlRuntimeEnsureProcessingResponse(
  value: unknown,
): CloudflareHostedControlRuntimeEnsureProcessingResponse {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.accepted === true) {
      return { accepted: true };
    }
  }

  return parseHostedRuntimeEnsureProcessingResponse(value);
}

function parseCloudflareHostedControlRuntimeShellPrewarmResponse(
  value: unknown,
): CloudflareHostedControlRuntimeShellPrewarmAcceptedAck {
  const record = requireRecord(value, "Cloudflare runtime shell prewarm response");
  if (record.accepted !== true) {
    throw new TypeError(
      "Cloudflare runtime shell prewarm response accepted must be true.",
    );
  }
  return { accepted: true };
}

function parseCloudflareHostedControlTelegramUsageLimitNoticeResponse(
  value: unknown,
): CloudflareHostedControlTelegramUsageLimitNoticeResponse {
  const record = requireRecord(value, "Cloudflare Telegram usage-limit notice response");
  const status = requireString(
    record.status,
    "Cloudflare Telegram usage-limit notice response status",
  );

  if (status === "failed") {
    return {
      failureCode: requireString(
        record.failureCode,
        "Cloudflare Telegram usage-limit notice response failureCode",
      ),
      ...readOptionalPositiveIntegerField(
        record.retryAfterSeconds,
        "retryAfterSeconds",
      ),
      retryable: requireBoolean(
        record.retryable,
        "Cloudflare Telegram usage-limit notice response retryable",
      ),
      status,
    };
  }

  if (status !== "sent") {
    throw new TypeError(
      "Cloudflare Telegram usage-limit notice response status must be sent or failed.",
    );
  }

  return { status };
}

function readOptionalPositiveIntegerField<Key extends string>(
  value: unknown,
  key: Key,
): { [K in Key]?: number } {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(
      `Cloudflare Telegram usage-limit notice response ${key} must be a positive integer.`,
    );
  }
  return { [key]: value } as { [K in Key]?: number };
}

function assertHostedBrowserVaultReplicaRefMatches(
  actual: HostedBrowserVaultReplicaRef,
  expected: HostedBrowserVaultReplicaRef,
  label: string,
): void {
  assertMatchingNumber(
    actual.byteLength,
    expected.byteLength,
    `${label}.byteLength`,
    "the requested replicaRef.byteLength",
  );
  assertMatchingString(
    actual.dataVersion,
    expected.dataVersion,
    `${label}.dataVersion`,
    "the requested replicaRef.dataVersion",
  );
  assertMatchingString(
    actual.generatedAt,
    expected.generatedAt,
    `${label}.generatedAt`,
    "the requested replicaRef.generatedAt",
  );
  assertMatchingString(
    actual.keyId,
    expected.keyId,
    `${label}.keyId`,
    "the requested replicaRef.keyId",
  );
  assertMatchingString(
    actual.objectKey,
    expected.objectKey,
    `${label}.objectKey`,
    "the requested replicaRef.objectKey",
  );
  assertMatchingString(
    actual.sourceBundleHash,
    expected.sourceBundleHash,
    `${label}.sourceBundleHash`,
    "the requested replicaRef.sourceBundleHash",
  );
  assertMatchingOptionalString(
    actual.runtimeRootKeyId,
    expected.runtimeRootKeyId,
    `${label}.runtimeRootKeyId`,
    "the requested replicaRef.runtimeRootKeyId",
  );
  assertMatchingOptionalJson(
    actual.dataKeyEnvelope,
    expected.dataKeyEnvelope,
    `${label}.dataKeyEnvelope`,
    "the requested replicaRef.dataKeyEnvelope",
  );
}

function assertMatchingNumber(
  actual: number,
  expected: number,
  label: string,
  expectedLabel: string,
): void {
  if (actual !== expected) {
    throw new TypeError(`${label} must match ${expectedLabel}.`);
  }
}

function assertMatchingString(
  actual: string,
  expected: string,
  label: string,
  expectedLabel: string,
): void {
  if (actual !== expected) {
    throw new TypeError(`${label} must match ${expectedLabel}.`);
  }
}

function assertMatchingOptionalString(
  actual: string | null | undefined,
  expected: string | null | undefined,
  label: string,
  expectedLabel: string,
): void {
  if ((actual ?? null) !== (expected ?? null)) {
    throw new TypeError(`${label} must match ${expectedLabel}.`);
  }
}

function assertMatchingOptionalJson(
  actual: unknown,
  expected: unknown,
  label: string,
  expectedLabel: string,
): void {
  if (canonicalJson(actual ?? null) !== canonicalJson(expected ?? null)) {
    throw new TypeError(`${label} must match ${expectedLabel}.`);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }

  return value;
}

function getHostedBrowserVaultReplicaStorageKeyId(
  replicaRef: HostedBrowserVaultReplicaRef,
): string {
  return replicaRef.dataKeyEnvelope?.dataKeyId ?? replicaRef.keyId;
}

function requireHostedBrowserVaultReplicaRuntimeRootKeyId(
  replicaRef: HostedBrowserVaultReplicaRef,
): string {
  if (!replicaRef.runtimeRootKeyId) {
    throw new TypeError("Cloudflare browser vault session requested replicaRef.runtimeRootKeyId is required.");
  }
  return replicaRef.runtimeRootKeyId;
}

function requireHostedExecutionBaseUrl(
  value: string,
  options: Pick<CloudflareHostedControlClientOptions, "allowHttpHosts" | "allowHttpLocalhost">,
): string {
  const normalized = normalizeHostedExecutionBaseUrl(value, options);

  if (!normalized) {
    throw new TypeError("Hosted execution baseUrl must be configured.");
  }

  return normalized;
}

function createHostedExecutionBearerAuthorizationHeaderProvider(
  getBearerToken: (() => Promise<string>) | undefined,
): () => Promise<string> {
  if (!getBearerToken) {
    throw new TypeError("Hosted execution getBearerToken must be configured.");
  }

  return async () => {
    const rawToken = (await getBearerToken()).trim();
    const token = rawToken.startsWith("Bearer ")
      ? rawToken.slice("Bearer ".length).trim()
      : rawToken;

    if (!token) {
      throw new TypeError("Hosted execution bearer token must be configured.");
    }

    return `Bearer ${token}`;
  };
}

async function requestHostedExecutionAuthorizedJson<TResponse>(input: {
  baseUrl: string;
  boundUserId?: string;
  fetchImpl: typeof fetch;
  getAuthorizationHeader: () => Promise<string>;
  label: string;
  onRuntimeEnsureProcessingTiming?: (
    timing: CloudflareHostedControlRuntimeEnsureProcessingTiming,
  ) => void;
  onRequestAttempted?: () => Promise<void> | void;
  runtimeEnsureProcessingOrchestrationAttemptId?: string;
  parse: (value: unknown) => TResponse;
  path: string;
  request: {
    body?: BodyInit;
    headers?: HeadersInit;
    method: "DELETE" | "GET" | "POST";
    search?: string | null;
  };
  signal?: AbortSignal;
  timeoutMs: number | undefined;
}): Promise<TResponse> {
  const url = new URL(input.path.replace(/^\/+/, ""), `${input.baseUrl}/`);

  if (input.request.search) {
    url.search = input.request.search;
  }

  const headers = new Headers(input.request.headers);
  const tokenAcquireStartedAtEpochMs = input.onRuntimeEnsureProcessingTiming
    ? Date.now()
    : null;
  headers.set(
    "authorization",
    await waitForHostedExecutionRequest(
      input.getAuthorizationHeader(),
      input.signal,
    ),
  );
  const tokenAcquiredAtEpochMs = tokenAcquireStartedAtEpochMs === null
    ? null
    : Date.now();

  if (input.boundUserId !== undefined) {
    headers.set(
      HOSTED_EXECUTION_USER_ID_HEADER,
      requireCloudflareHostedControlUserId(input.boundUserId),
    );
  }

  const directEnsureRequestStartedAtEpochMs = tokenAcquireStartedAtEpochMs === null
    ? null
    : Date.now();
  if (
    tokenAcquireStartedAtEpochMs !== null
    && tokenAcquiredAtEpochMs !== null
    && directEnsureRequestStartedAtEpochMs !== null
  ) {
    headers.set(
      HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER,
      String(tokenAcquireStartedAtEpochMs),
    );
    headers.set(
      HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER,
      String(tokenAcquiredAtEpochMs),
    );
    headers.set(
      HOSTED_RUNTIME_ENSURE_PROCESSING_DIRECT_REQUEST_STARTED_AT_MS_HEADER,
      String(directEnsureRequestStartedAtEpochMs),
    );
  }

  await input.onRequestAttempted?.();

  const requestSignal = createHostedExecutionRequestSignal({
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });
  const response = await input.fetchImpl(url.toString(), {
    ...(input.request.body === undefined ? {} : { body: input.request.body }),
    headers,
    method: input.request.method,
    redirect: "error",
    signal: requestSignal,
  });
  const directEnsureResponseReceivedAtEpochMs = directEnsureRequestStartedAtEpochMs === null
    ? null
    : Date.now();
  if (
    tokenAcquireStartedAtEpochMs !== null
    && tokenAcquiredAtEpochMs !== null
    && directEnsureRequestStartedAtEpochMs !== null
    && directEnsureResponseReceivedAtEpochMs !== null
    && input.runtimeEnsureProcessingOrchestrationAttemptId !== undefined
  ) {
    try {
      input.onRuntimeEnsureProcessingTiming?.({
        directEnsureRequestStartedAtEpochMs,
        directEnsureResponseReceivedAtEpochMs,
        orchestrationAttemptId:
          input.runtimeEnsureProcessingOrchestrationAttemptId,
        tokenAcquiredAtEpochMs,
        tokenAcquireStartedAtEpochMs,
      });
    } catch {
      // Timing callbacks are diagnostics-only and must not affect control requests.
    }
  }

  if (!response.ok) {
    throw new HostedExecutionHttpResponseError({
      code: await readHostedExecutionStructuredErrorCode(response),
      label: input.label,
      status: response.status,
    });
  }

  return input.parse(await response.json());
}

function createHostedExecutionRequestSignal(input: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): AbortSignal | undefined {
  const signals = [
    input.signal,
    typeof input.timeoutMs === "number"
      ? AbortSignal.timeout(input.timeoutMs)
      : undefined,
  ].filter((signal): signal is AbortSignal => signal !== undefined);

  if (signals.length === 0) {
    return undefined;
  }
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

async function waitForHostedExecutionRequest<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return operation;
  }
  if (signal.aborted) {
    throw signal.reason;
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readHostedExecutionStructuredErrorCode(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("application/json")) {
    return undefined;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const code = (body as Record<string, unknown>).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireMealPhotoCaptureId(value: unknown): string {
  const captureId = requireString(value, "Cloudflare meal-photo captureId").trim();
  if (!HOSTED_MEAL_PHOTO_CAPTURE_ID_PATTERN.test(captureId)) {
    throw new TypeError(
      "Cloudflare meal-photo captureId must be a 64-character lowercase hexadecimal string.",
    );
  }
  return captureId;
}

function requireMealPhotoKey(value: unknown): string {
  const mealPhotoKey = requireString(value, "Cloudflare meal-photo key");
  if (!HOSTED_MEAL_PHOTO_KEY_PATTERN.test(mealPhotoKey)) {
    throw new TypeError(
      "Cloudflare meal-photo key must be a 40-character lowercase hexadecimal string.",
    );
  }
  return mealPhotoKey;
}

function requireEnvironmentVoiceKey(value: unknown): string {
  const audioKey = requireString(value, "Cloudflare environment voice key");
  if (!HOSTED_ENVIRONMENT_VOICE_KEY_PATTERN.test(audioKey)) {
    throw new TypeError(
      "Cloudflare environment voice key must be a 40-character lowercase hexadecimal string.",
    );
  }
  return audioKey;
}

function requireSha256(value: unknown, label: string): string {
  const sha256 = requireString(value, label);
  if (!HOSTED_SHA256_PATTERN.test(sha256)) {
    throw new TypeError(`${label} must be a 64-character lowercase hexadecimal string.`);
  }
  return sha256;
}

function copyUint8Array(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a Uint8Array.`);
  }
  return Uint8Array.from(value);
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = Uint8Array.from(bytes);
  return copy.buffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const numberValue = requireNumber(value, label);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return numberValue;
}
