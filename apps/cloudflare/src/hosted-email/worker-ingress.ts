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
import {
  createHostedEmailThreadTarget,
  HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH,
  redactHostedGroupEmailPromptText,
  serializeHostedEmailThreadTarget,
  type HostedEmailAuthenticatedSenderVerdict,
} from "@murphai/runtime-state";
import {
  buildParsedEmailThreadTarget,
  resolveParsedEmailThreadKey,
} from "@murphai/inboxd/connectors/email/normalize-parsed";
import {
  inferDirectEmailThreadFromParticipants,
} from "@murphai/inboxd/connectors/email/directness";

import { readHostedExecutionEnvironment } from "../env.ts";
import type {
  HostedEmailWorkerRequest,
} from "../hosted-email.ts";
import {
  readHostedEmailConfig,
  readHostedEmailMessageBytes,
  resolveHostedEmailRawMessageStorageRef,
  resolveHostedEmailIngressRoute,
  shouldRejectHostedEmailIngressFailure,
  writeHostedEmailRawMessage,
  writeHostedEmailRawMessageRecoveryRef,
} from "../hosted-email.ts";
import {
  resolveHostedExecutionUserCryptoContext,
  type WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";
import { asWorkerStringEnvironment } from "../worker-contracts.ts";
import {
  appendHostedEmailIngressWakeInWeb,
} from "../web-control-plane-email-ingress.ts";
import { handleHostedEmailPublicBootstrap } from "./public-bootstrap.ts";
import { isHostedEmailPublicBootstrapAddress } from "./route-addressing.ts";

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
  if (isHostedEmailPublicBootstrapAddress(message.to, config)) {
    const bootstrap = handleHostedEmailPublicBootstrap({
      environment,
      message,
    });
    if (_ctx) {
      _ctx.waitUntil(bootstrap);
    } else {
      // Production always supplies an execution context. Awaiting here keeps
      // local and unit invocations deterministic without changing SMTP output.
      await bootstrap;
    }
    return;
  }

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
  await writeHostedEmailRawMessageRecoveryRef({
    bucket: env.BUNDLES,
    eventId,
    identityId: route.identityId,
    key: userCrypto.rootKey,
    keyId: userCrypto.rootKeyId,
    occurredAt,
    routeAddress: route.routeAddress,
    storageRef: rawMessageStorageRef,
    userId: route.userId,
  }).then(undefined, (error) => {
    emitHostedExecutionStructuredLog({
      component: "hosted.email",
      details: buildHostedEmailIngressLogDetails({
        eventId,
        identityId: route.identityId,
        reason: "raw-message-recovery-ref-write-failed",
        routeAddress: route.routeAddress,
        to: message.to,
      }),
      error,
      level: "warn",
      message: "Hosted email ingress could not write raw message recovery metadata.",
      phase: "outbox",
      userId: route.userId,
    });
  });
  const threadTarget = buildHostedEmailIngressThreadTarget({
    message: parsedMessage,
    route,
  });
  const providerThreadKey = resolveParsedEmailThreadKey({
    message: parsedMessage,
    rawMessageKey,
  });
  const isGroupRoute = route.groupId !== null;
  const threadKey = route.groupId === null
    ? providerThreadKey
    : await deriveHostedEmailGroupThreadKey({
        groupId: route.groupId,
        providerThreadKey,
      });
  const threadIsDirect = isGroupRoute
    ? false
    : inferDirectEmailThreadFromParticipants({
        accountAddress: route.identityId,
        bcc: parsedMessage.bcc,
        cc: parsedMessage.cc,
        from: parsedMessage.from,
        selfAddresses: [route.routeAddress],
        to: parsedMessage.to,
      });
  const promptProjection = buildHostedEmailPromptProjection({
    message: parsedMessage,
    redactedForGroup: isGroupRoute,
  });

  await appendHostedEmailIngressWakeInWeb({
    ...(environment.hostedWebAllowHttpHosts
      ? { allowHttpHosts: environment.hostedWebAllowHttpHosts }
      : {}),
    baseUrl: environment.hostedWebBaseUrl,
    body: {
      ...promptProjection,
      assistantStyleSettingsAuthorized: route.authorization === "direct-public-sender",
      eventId,
      identityId: isGroupRoute ? null : route.identityId,
      ...(isGroupRoute
        ? {}
        : {
            messageId: normalizeHostedEmailPromptMetadataScalar(
              parsedMessage.messageId,
              HOSTED_EMAIL_PROMPT_MESSAGE_ID_MAX_CHARS,
            ),
          }),
      occurredAt,
      rawMessageKey,
      ...(isGroupRoute
        ? {}
        : {
            selfAddress: normalizeHostedEmailPromptMetadataScalar(
              route.routeAddress,
              HOSTED_EMAIL_PROMPT_SELF_ADDRESS_MAX_CHARS,
            ),
          }),
      threadIsDirect,
      threadKey: normalizeHostedEmailPromptMetadataScalar(
        threadKey,
        HOSTED_EMAIL_PROMPT_THREAD_KEY_MAX_CHARS,
      ),
      // Group wakes keep only the exact threadTarget needed for reply
      // threading. Prompt fields above omit To/Cc/self address, summarize From,
      // and redact Subject/body/attachment names before the wake leaves the
      // Worker; the runtime also skips raw group email inbox projection.
      threadTarget: normalizeHostedEmailPromptMetadataScalar(
        threadTarget,
        HOSTED_EMAIL_PROMPT_THREAD_TARGET_MAX_CHARS,
      ),
    },
    boundUserId: route.userId,
    callbackSigning: environment.webCallbackSigning,
    fetchImpl: fetch,
    timeoutMs: environment.webControlTimeoutMs,
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
const HOSTED_EMAIL_PROMPT_THREAD_TARGET_MAX_CHARS =
  HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH;
const HOSTED_EMAIL_GROUP_THREAD_KEY_NAMESPACE =
  "murph.hosted-email.group-thread.v1";

async function deriveHostedEmailGroupThreadKey(input: {
  groupId: string;
  providerThreadKey: string;
}): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode([
      HOSTED_EMAIL_GROUP_THREAD_KEY_NAMESPACE,
      input.groupId,
      input.providerThreadKey,
    ].join("\0")),
  ));
  return `group-thread:${[...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40)}`;
}

function buildHostedEmailIngressThreadTarget(input: {
  message: ParsedEmailMessage;
  route: {
    groupId: string | null;
    identityId: string;
    routeAddress: string;
  };
}): string {
  if (input.route.groupId) {
    return serializeHostedEmailThreadTarget(
      createHostedEmailThreadTarget({
        groupId: input.route.groupId,
        lastMessageId: input.message.messageId,
        references: [
          ...input.message.references,
          input.message.inReplyTo,
          input.message.messageId,
        ].filter((value): value is string => Boolean(value && value.trim())),
        subject: redactHostedGroupEmailPromptText(input.message.subject),
        targetKind: "group",
      }),
    );
  }

  return buildParsedEmailThreadTarget({
    accountAddress: input.route.identityId,
    message: input.message,
    selfAddresses: [input.route.routeAddress],
  });
}

function buildHostedEmailPromptProjection(input: {
  message: ParsedEmailMessage;
  redactedForGroup: boolean;
}): {
  attachmentSummaries?: HostedExecutionEmailAttachmentSummary[];
  cc?: string[];
  from?: string | null;
  subject?: string | null;
  textPreview?: string | null;
  to?: string[];
} {
  const { message } = input;
  const promptText = input.redactedForGroup
    ? redactHostedGroupEmailPromptText(message.text)
    : message.text;
  const promptSubject = input.redactedForGroup
    ? redactHostedGroupEmailPromptText(message.subject)
    : message.subject;
  const textPreview = normalizeHostedEmailPromptScalar(
    promptText,
    HOSTED_EMAIL_PROMPT_TEXT_PREVIEW_MAX_CHARS,
  );

  const attachmentSummaries = message.attachments
    .slice(0, HOSTED_EMAIL_PROMPT_ATTACHMENT_MAX_COUNT)
    .map((attachment): HostedExecutionEmailAttachmentSummary => {
      const promptFileName = input.redactedForGroup
        ? redactHostedGroupEmailPromptText(attachment.fileName)
        : attachment.fileName;
      return {
        contentType: normalizeHostedEmailPromptScalar(
          attachment.contentType,
          HOSTED_EMAIL_PROMPT_CONTENT_TYPE_MAX_CHARS,
        ),
        fileName: normalizeHostedEmailPromptScalar(
          promptFileName,
          HOSTED_EMAIL_PROMPT_FILE_NAME_MAX_CHARS,
        ),
        sizeBytes: null,
      };
    });

  const sharedProjection = {
    ...(attachmentSummaries.length > 0 ? { attachmentSummaries } : {}),
    subject: normalizeHostedEmailPromptScalar(
      promptSubject,
      HOSTED_EMAIL_PROMPT_SUBJECT_MAX_CHARS,
    ),
    ...(textPreview ? { textPreview } : {}),
  };

  if (input.redactedForGroup) {
    return {
      ...sharedProjection,
      from: buildHostedGroupEmailSenderSummary(message.from),
    };
  }

  return {
    ...sharedProjection,
    cc: normalizeHostedEmailPromptList(message.cc, HOSTED_EMAIL_PROMPT_ADDRESS_MAX_COUNT),
    from: normalizeHostedEmailPromptScalar(
      message.from,
      HOSTED_EMAIL_PROMPT_FILE_NAME_MAX_CHARS,
    ),
    to: normalizeHostedEmailPromptList(message.to, HOSTED_EMAIL_PROMPT_ADDRESS_MAX_COUNT),
  };
}

function buildHostedGroupEmailSenderSummary(value: string | null | undefined): string {
  const displayName = normalizeHostedEmailPromptScalar(
    extractHostedEmailDisplayName(value),
    HOSTED_EMAIL_PROMPT_FILE_NAME_MAX_CHARS,
  );
  if (displayName && !HOSTED_EMAIL_ADDRESS_PATTERN.test(displayName)) {
    return `Email reply from group participant: ${displayName}`;
  }
  return "Email reply from group participant";
}

const HOSTED_EMAIL_ADDRESS_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;

function extractHostedEmailDisplayName(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
  const angleIndex = normalized.indexOf("<");
  if (angleIndex <= 0) {
    return null;
  }

  const candidate = normalized.slice(0, angleIndex).trim().replace(/^"|"$/gu, "");
  return candidate.length > 0 ? candidate : null;
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
