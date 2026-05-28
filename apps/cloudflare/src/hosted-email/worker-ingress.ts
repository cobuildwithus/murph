import {
  emitHostedExecutionStructuredLog,
  HOSTED_EMAIL_PROMPT_SELF_ADDRESS_MAX_CHARS,
  type HostedExecutionEmailAttachmentSummary,
} from "@murphai/hosted-execution";
import { readHostedEmailCapabilities } from "@murphai/hosted-execution/hosted-email";
import {
  parseRawEmailMessage,
  readRawEmailHeaderValue,
  type ParsedEmailMessage,
} from "@murphai/inboxd/connectors/email/parsed";
import type { HostedEmailAuthenticatedSenderVerdict } from "@murphai/runtime-state";
import {
  buildParsedEmailThreadTarget,
  resolveParsedEmailThreadKey,
} from "@murphai/inboxd/connectors/email/normalize-parsed";

import { readHostedExecutionEnvironment } from "../env.ts";
import type {
  HostedEmailWorkerRequest,
} from "../hosted-email.ts";
import {
  deleteHostedEmailRawMessage,
  readHostedEmailConfig,
  readHostedEmailMessageBytes,
  resolveHostedEmailRawMessageStorageRef,
  resolveHostedEmailIngressRoute,
  shouldRejectHostedEmailIngressFailure,
  writeHostedEmailRawMessage,
} from "../hosted-email.ts";
import {
  resolveHostedExecutionUserCryptoContext,
  type WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";
import { asWorkerStringEnvironment } from "../worker-contracts.ts";
import {
  appendHostedEmailIngressWakeInWeb,
} from "../web-control-plane-email-ingress.ts";

export interface HostedEmailIngressExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface HostedEmailTrustedSenderVerificationInput {
  envelopeFrom: string;
  headerFrom: string | null;
  message: HostedEmailWorkerRequest;
  parsedMessage: ParsedEmailMessage;
  rawBytes: Uint8Array;
  to: string;
}

export type HostedEmailTrustedSenderVerifier = (
  input: HostedEmailTrustedSenderVerificationInput,
) => Promise<HostedEmailAuthenticatedSenderVerdict | null> | HostedEmailAuthenticatedSenderVerdict | null;

export interface HostedEmailIngressOptions {
  trustedSenderVerifier?: HostedEmailTrustedSenderVerifier;
}

export function verifyHostedEmailTrustedSender(
  _input: HostedEmailTrustedSenderVerificationInput,
): HostedEmailAuthenticatedSenderVerdict | null {
  return null;
}

export async function handleHostedEmailIngress(
  message: HostedEmailWorkerRequest,
  env: WorkerEnvironmentSource,
  _ctx?: HostedEmailIngressExecutionContext,
  options: HostedEmailIngressOptions = {},
): Promise<void> {
  const stringEnv = asWorkerStringEnvironment(env);
  const environment = readHostedExecutionEnvironment(stringEnv);
  const capabilities = readHostedEmailCapabilities(stringEnv);
  if (!capabilities.ingressReady) {
    emitHostedExecutionStructuredLog({
      component: "hosted.email",
      details: buildHostedEmailIngressLogDetails({
        ingressReady: false,
        to: message.to,
      }),
      level: "warn",
      message: "Hosted email ingress rejected a message because ingress is not configured.",
      phase: "failed",
    });
    message.setReject?.("Hosted email ingress is not configured.");
    return;
  }

  const config = readHostedEmailConfig(stringEnv);
  let rawBytes: Uint8Array;

  try {
    rawBytes = await readHostedEmailMessageBytes(message.raw, {
      rawSize: typeof message.rawSize === "number" ? message.rawSize : null,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      emitHostedExecutionStructuredLog({
        component: "hosted.email",
        details: buildHostedEmailIngressLogDetails({
          rawSize: typeof message.rawSize === "number" ? String(message.rawSize) : null,
          reason: "raw-message-too-large",
          to: message.to,
        }),
        error,
        level: "warn",
        message: "Hosted email ingress rejected an oversized raw message.",
        phase: "failed",
      });
      message.setReject?.("Hosted email message exceeded the maximum accepted size.");
      return;
    }

    throw error;
  }

  const parsedMessage = parseRawEmailMessage(rawBytes);
  const headerFrom = readRawEmailHeaderValue(rawBytes, "from");
  const resolvedHeaderFrom = headerFrom.value ?? parsedMessage.from;
  const authenticatedSender = await (options.trustedSenderVerifier ?? verifyHostedEmailTrustedSender)({
    envelopeFrom: message.from,
    headerFrom: resolvedHeaderFrom,
    message,
    parsedMessage,
    rawBytes,
    to: message.to,
  });
  const rejectReason = "Hosted email message was not accepted.";
  const shouldRejectOnIngressFailure = shouldRejectHostedEmailIngressFailure({
    config,
    to: message.to,
  });
  const rejectIngressFailure = () => {
    if (shouldRejectOnIngressFailure) {
      message.setReject?.(rejectReason);
    }
  };
  const route = await resolveHostedEmailIngressRoute({
    authenticatedSender,
    config,
    envelopeFrom: message.from,
    fetchImpl: fetch,
    hasRepeatedHeaderFrom: headerFrom.repeated,
    headerFrom: resolvedHeaderFrom,
    to: message.to,
    webCallbackSigning: environment.webCallbackSigning,
    ...(environment.hostedWebAllowHttpHosts
      ? { webControlAllowHttpHosts: environment.hostedWebAllowHttpHosts }
      : {}),
    webControlBaseUrl: environment.hostedWebBaseUrl,
  });

  if (!route) {
    emitHostedExecutionStructuredLog({
      component: "hosted.email",
      details: buildHostedEmailIngressLogDetails({
        from: message.from,
        headerFrom: resolvedHeaderFrom,
        reason: shouldRejectOnIngressFailure ? "ingress-route-miss-rejected" : "ingress-route-miss-accepted-drop",
        to: message.to,
      }),
      level: "warn",
      message: shouldRejectOnIngressFailure
        ? "Hosted email ingress rejected a message because no authorized ingress route matched."
        : "Hosted email ingress dropped a message because no authorized ingress route matched.",
      phase: "failed",
    });
    rejectIngressFailure();
    return;
  }

  const userCrypto = await resolveHostedExecutionUserCryptoContext({
    bucket: env.BUNDLES,
    domain: "ingress",
    environment,
    userId: route.userId,
  });
  const rawMessageStorageRef = await resolveHostedEmailRawMessageStorageRef({
    plaintext: rawBytes,
    userId: route.userId,
  });
  const rawMessageObjectExistedBeforeWrite =
    (await env.BUNDLES.get(rawMessageStorageRef.objectKey)) !== null;

  const rawMessageKey = await writeHostedEmailRawMessage({
    bucket: env.BUNDLES,
    key: userCrypto.rootKey,
    keyId: userCrypto.rootKeyId,
    plaintext: rawBytes,
    storageRef: rawMessageStorageRef,
    userId: route.userId,
  });
  const eventId = `email:${rawMessageKey}`;
  const occurredAt = new Date().toISOString();
  const threadTarget = buildParsedEmailThreadTarget({
    accountAddress: route.identityId,
    message: parsedMessage,
    selfAddresses: [route.routeAddress],
  });
  const threadKey = resolveParsedEmailThreadKey({
    message: parsedMessage,
    rawMessageKey,
  });
  const promptProjection = buildHostedEmailPromptProjection(parsedMessage);

  await appendHostedEmailIngressWakeInWeb({
    ...(environment.hostedWebAllowHttpHosts
      ? { allowHttpHosts: environment.hostedWebAllowHttpHosts }
      : {}),
    baseUrl: environment.hostedWebBaseUrl,
    body: {
      ...promptProjection,
      eventId,
      identityId: route.identityId,
      messageId: normalizeHostedEmailPromptMetadataScalar(
        parsedMessage.messageId,
        HOSTED_EMAIL_PROMPT_MESSAGE_ID_MAX_CHARS,
      ),
      occurredAt,
      rawMessageKey,
      selfAddress: normalizeHostedEmailPromptMetadataScalar(
        route.routeAddress,
        HOSTED_EMAIL_PROMPT_SELF_ADDRESS_MAX_CHARS,
      ),
      threadKey: normalizeHostedEmailPromptMetadataScalar(
        threadKey,
        HOSTED_EMAIL_PROMPT_THREAD_KEY_MAX_CHARS,
      ),
      threadTarget: normalizeHostedEmailPromptMetadataScalar(
        threadTarget,
        HOSTED_EMAIL_PROMPT_THREAD_TARGET_MAX_CHARS,
      ),
    },
    boundUserId: route.userId,
    callbackSigning: environment.webCallbackSigning,
    fetchImpl: fetch,
    timeoutMs: environment.webControlTimeoutMs,
  }).catch(async (error: unknown) => {
    if (
      !rawMessageObjectExistedBeforeWrite
      && isDefinitiveHostedEmailIngressAppendFailure(error)
    ) {
      try {
        await deleteHostedEmailRawMessage({
          bucket: env.BUNDLES,
          rawMessageKey,
          userId: route.userId,
        });
      } catch (cleanupError) {
        emitHostedExecutionStructuredLog({
          component: "hosted.email",
          details: buildHostedEmailIngressLogDetails({
            eventId,
            identityId: route.identityId,
            reason: "raw-message-append-cleanup-failed",
            routeAddress: route.routeAddress,
            to: message.to,
          }),
          error: cleanupError,
          level: "warn",
          message: "Hosted email append cleanup failed after the canonical ingress append was rejected.",
          phase: "failed",
          userId: route.userId,
        });
      }
    }

    throw error;
  });
}

const HOSTED_EMAIL_PROMPT_ADDRESS_MAX_COUNT = 8;
const HOSTED_EMAIL_PROMPT_ATTACHMENT_MAX_COUNT = 12;
const HOSTED_EMAIL_PROMPT_SUBJECT_MAX_CHARS = 240;
const HOSTED_EMAIL_PROMPT_TEXT_PREVIEW_MAX_CHARS = 4_000;
const HOSTED_EMAIL_PROMPT_FILE_NAME_MAX_CHARS = 160;
const HOSTED_EMAIL_PROMPT_CONTENT_TYPE_MAX_CHARS = 120;
const HOSTED_EMAIL_PROMPT_MESSAGE_ID_MAX_CHARS = 512;
const HOSTED_EMAIL_PROMPT_THREAD_KEY_MAX_CHARS = 512;
const HOSTED_EMAIL_PROMPT_THREAD_TARGET_MAX_CHARS = 2_048;

function buildHostedEmailPromptProjection(
  message: ParsedEmailMessage,
): {
  attachmentSummaries?: HostedExecutionEmailAttachmentSummary[];
  cc?: string[];
  from?: string | null;
  subject?: string | null;
  textPreview?: string | null;
  to?: string[];
} {
  const textPreview = normalizeHostedEmailPromptScalar(
    message.text,
    HOSTED_EMAIL_PROMPT_TEXT_PREVIEW_MAX_CHARS,
  );
  if (!textPreview) {
    return {};
  }

  const attachmentSummaries = message.attachments
    .slice(0, HOSTED_EMAIL_PROMPT_ATTACHMENT_MAX_COUNT)
    .map((attachment): HostedExecutionEmailAttachmentSummary => ({
      contentType: normalizeHostedEmailPromptScalar(
        attachment.contentType,
        HOSTED_EMAIL_PROMPT_CONTENT_TYPE_MAX_CHARS,
      ),
      fileName: normalizeHostedEmailPromptScalar(
        attachment.fileName,
        HOSTED_EMAIL_PROMPT_FILE_NAME_MAX_CHARS,
      ),
      sizeBytes: null,
    }));

  return {
    ...(attachmentSummaries.length > 0 ? { attachmentSummaries } : {}),
    cc: normalizeHostedEmailPromptList(message.cc, HOSTED_EMAIL_PROMPT_ADDRESS_MAX_COUNT),
    from: normalizeHostedEmailPromptScalar(
      message.from,
      HOSTED_EMAIL_PROMPT_FILE_NAME_MAX_CHARS,
    ),
    subject: normalizeHostedEmailPromptScalar(
      message.subject,
      HOSTED_EMAIL_PROMPT_SUBJECT_MAX_CHARS,
    ),
    textPreview,
    to: normalizeHostedEmailPromptList(message.to, HOSTED_EMAIL_PROMPT_ADDRESS_MAX_COUNT),
  };
}

function normalizeHostedEmailPromptList(
  values: readonly string[],
  maxCount: number,
): string[] {
  return values
    .map((value) => normalizeHostedEmailPromptScalar(value, HOSTED_EMAIL_PROMPT_FILE_NAME_MAX_CHARS))
    .filter((value): value is string => value !== null)
    .slice(0, maxCount);
}

function normalizeHostedEmailPromptScalar(
  value: string | null | undefined,
  maxChars: number,
): string | null {
  const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (!normalized) {
    return null;
  }
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function normalizeHostedEmailPromptMetadataScalar(
  value: string | null | undefined,
  maxChars: number,
): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function isDefinitiveHostedEmailIngressAppendFailure(
  error: unknown,
): error is Error & { status: number } {
  if (
    !(error instanceof Error)
    || !("status" in error)
    || typeof error.status !== "number"
    || !Number.isFinite(error.status)
  ) {
    return false;
  }

  return error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 409
    && error.status !== 413
    && error.status !== 429;
}

function buildHostedEmailIngressLogDetails(input: {
  eventId?: string | null;
  from?: string | null;
  headerFrom?: string | null;
  identityId?: string | null;
  ingressReady?: boolean | null;
  rawSize?: string | null;
  reason?: string | null;
  routeAddress?: string | null;
  to: string;
}): Record<string, string | boolean> {
  return {
    ...(input.eventId ? { hasEventId: true } : {}),
    ...(input.from ? { hasEnvelopeFrom: true } : {}),
    ...(input.headerFrom ? { hasHeaderFrom: true } : {}),
    ...(input.identityId ? { hasIdentityId: true } : {}),
    ...(input.ingressReady === null || input.ingressReady === undefined
      ? {}
      : { ingressReady: String(input.ingressReady) }),
    ...(input.rawSize ? { rawSize: input.rawSize } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.routeAddress ? { hasRouteAddress: true } : {}),
    hasRecipientAddress: input.to.trim().length > 0,
  };
}
