import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  isHostedWhatsAppConversationMessageWake,
  readHostedLinqConversationMessageAccountLookupKey,
} from "@murphai/hosted-execution";
import {
  resolveHostedEmailSelfAddresses,
} from "@murphai/hosted-execution/hosted-email";
import {
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import {
  normalizeHostedEmailConversationCapture,
  normalizeHostedLinqConversationCapture,
  normalizeHostedTelegramConversationCapture,
  normalizeHostedWhatsAppConversationCapture,
} from "@murphai/inboxd/connectors/hosted-conversation";
import {
  createInboxPipeline,
  type PersistedCapture,
  openInboxRuntime,
} from "@murphai/inboxd/runtime";

import {
  buildHostedLinqChannelEnv,
  buildHostedTelegramChannelEnv,
} from "../channel-activity.ts";
import { readHostedRawEmailMessage } from "./email.ts";
import {
  createHostedLinqAttachmentDownloadDriver,
  HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  withHostedLinqAttachmentDownloadRetry,
} from "./linq.ts";
import {
  createHostedTelegramAttachmentDownloadDriver,
  createHostedTelegramEffectsAttachmentDownloadDriver,
  logHostedTelegramAttachmentDownloadUnavailable,
  withHostedTelegramAttachmentDownloadLogging,
  withHostedTelegramAttachmentDownloadRetry,
} from "./telegram.ts";
import type {
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "../models.ts";

const HOSTED_LINQ_INTERNAL_STAGING_NOTE_PREFIX = "Internal staging note:";

export interface HostedConversationWakeLocalImportResult {
  capture: PersistedCapture | null;
  metrics: HostedConversationWakeMetrics;
  requiresTerminalMediaParserEvidence: boolean;
}

export class HostedConversationInboxProjectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HostedConversationInboxProjectionError";
  }
}

export async function importHostedConversationMessageWakeIntoLocalInbox(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv" | "userEnv">;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedConversationWakeLocalImportResult> {
  if (shouldSkipHostedEmailRawInboxProjection(input.wake)) {
    return {
      capture: null,
      metrics: createHostedConversationParserMetrics(),
      requiresTerminalMediaParserEvidence:
        requiresTerminalHostedEmailMediaParserEvidenceFromWake(input.wake),
    };
  }

  const capture = await normalizeHostedConversationMessageWake(input);
  const runtime = await openInboxRuntime({
    vaultRoot: input.vaultRoot,
  });
  assertHostedConversationProjectionLive(input.signal ?? null);
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;

  try {
    pipeline = await createInboxPipeline({
      runtime,
      vaultRoot: input.vaultRoot,
    });
    assertHostedConversationProjectionLive(input.signal ?? null);
    let persistedCapture: PersistedCapture;
    try {
      persistedCapture = await pipeline.processCapture(capture);
    } catch (error) {
      if (isHostedConversationProjectionAbortError(error, input.signal ?? null)) {
        throw readHostedConversationProjectionAbortReason(error, input.signal ?? null);
      }
      throw new HostedConversationInboxProjectionError(
        "Canonical inbox capture projection failed.",
        { cause: error },
      );
    }
    assertHostedConversationProjectionLive(input.signal ?? null);

    return {
      capture: persistedCapture,
      metrics: createHostedConversationParserMetrics(),
      requiresTerminalMediaParserEvidence:
        requiresTerminalHostedConversationMediaParserEvidence({
          capture,
          wake: input.wake,
        }),
    };
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
  }
}

function assertHostedConversationProjectionLive(signal: AbortSignal | null): void {
  if (signal?.aborted) {
    throw readHostedConversationProjectionAbortReason(
      new DOMException("Aborted", "AbortError"),
      signal,
    );
  }
}

function isHostedConversationProjectionAbortError(
  error: unknown,
  signal: AbortSignal | null,
): boolean {
  return signal?.aborted === true
    || (
      error instanceof DOMException
      && error.name === "AbortError"
    )
    || (
      error instanceof Error
      && error.name === "AbortError"
    );
}

function readHostedConversationProjectionAbortReason(
  error: unknown,
  signal: AbortSignal | null,
): unknown {
  return signal?.reason ?? error;
}

function createHostedConversationParserMetrics(): HostedConversationWakeMetrics {
  return {
    nextWakeAt: null,
    parserProcessed: 0,
  };
}

function requiresTerminalHostedConversationMediaParserEvidence(input: {
  capture: {
    attachments: readonly { kind: string }[];
    text: string | null;
  };
  wake: HostedExecutionConversationMessageWake;
}): boolean {
  if (
    !isHostedLinqConversationMessageWake(input.wake)
    && !isHostedTelegramConversationMessageWake(input.wake)
    && !isHostedEmailConversationMessageWake(input.wake)
  ) {
    return false;
  }
  return !hasHostedConversationUserAuthoredText(input)
    && input.capture.attachments.some((attachment) =>
      attachment.kind === "audio" || attachment.kind === "video"
    );
}

function hasHostedConversationUserAuthoredText(input: {
  capture: { text: string | null };
  wake: HostedExecutionConversationMessageWake;
}): boolean {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    return input.wake.message.linqMessage.parts.some((part) =>
      (part.type === "text" || part.type === "link")
      && part.value.trim().length > 0
      && !part.value.trimStart().startsWith(HOSTED_LINQ_INTERNAL_STAGING_NOTE_PREFIX)
    );
  }
  if (isHostedTelegramConversationMessageWake(input.wake)) {
    return (input.wake.message.telegramMessage.text?.trim() ?? "").length > 0;
  }
  if (isHostedEmailConversationMessageWake(input.wake)) {
    return [input.wake.message.subject, input.wake.message.textPreview]
      .some((value) => (value?.trim() ?? "").length > 0);
  }
  return (input.capture.text?.trim() ?? "").length > 0;
}

function requiresTerminalHostedEmailMediaParserEvidenceFromWake(
  wake: HostedExecutionConversationMessageWake,
): boolean {
  if (!isHostedEmailConversationMessageWake(wake)) {
    return false;
  }
  // Group-routed email intentionally skips raw projection for privacy. Any
  // audio/video attachment therefore needs terminal unavailable evidence,
  // even when the redacted subject/body gives the assistant useful text.
  return (wake.message.attachmentSummaries ?? []).some((attachment) =>
    isHostedConversationAudioVideoAttachment({
      contentType: attachment.contentType,
      fileName: attachment.fileName,
    })
  );
}

function isHostedConversationAudioVideoAttachment(input: {
  contentType?: string | null;
  fileName?: string | null;
}): boolean {
  const contentType = input.contentType?.trim().toLowerCase() ?? "";
  if (contentType.startsWith("audio/") || contentType.startsWith("video/")) {
    return true;
  }
  const fileName = input.fileName?.trim().toLowerCase() ?? "";
  return /\.(?:aac|aiff?|amr|avi|flac|m4a|m4v|mkv|mov|mp3|mp4|mpeg|mpg|oga|ogg|opus|wav|webm|wma|wmv)$/u
    .test(fileName);
}

async function normalizeHostedConversationMessageWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv" | "userEnv">;
  signal?: AbortSignal | null;
}) {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    return normalizeHostedLinqConversationCapture({
      accountId: readHostedLinqConversationMessageAccountLookupKey(input.wake.message),
      attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
      downloadDriver: withHostedLinqAttachmentDownloadRetry(
        createHostedLinqAttachmentDownloadDriver({
          env: buildHostedLinqAttachmentDownloadEnv(input.runtime),
          platform: input.runtime.platform,
        }),
      ),
      linqMessage: input.wake.message.linqMessage,
      occurredAt: input.wake.occurredAt,
      signal: input.signal ?? undefined,
    });
  }

  if (isHostedTelegramConversationMessageWake(input.wake)) {
    const downloadDriver =
      createHostedTelegramEffectsAttachmentDownloadDriver({
        effectsPort: input.runtime.platform.effectsPort,
      })
      ?? createHostedTelegramAttachmentDownloadDriver({
        env: buildHostedTelegramChannelEnv({
          forwardedEnv: input.runtime.forwardedEnv,
          platformEnv: input.runtime.platformEnv,
        }),
        fetchImplementation: input.runtime.platform.providerFetch ?? null,
      });
    if (
      !downloadDriver
      && (input.wake.message.telegramMessage.attachments?.length ?? 0) > 0
    ) {
      await logHostedTelegramAttachmentDownloadUnavailable(input.runtime.platform);
    }

    return normalizeHostedTelegramConversationCapture({
      accountId: "bot",
      downloadDriver: withHostedTelegramAttachmentDownloadLogging(
        withHostedTelegramAttachmentDownloadRetry(downloadDriver),
        input.runtime.platform,
      ),
      externalId: input.wake.eventId,
      message: input.wake.message.telegramMessage,
      occurredAt: input.wake.occurredAt,
      receivedAt: input.wake.occurredAt,
      signal: input.signal ?? undefined,
    });
  }

  if (isHostedEmailConversationMessageWake(input.wake)) {
    const bytes = await readHostedRawEmailMessage(
      input.wake,
      input.runtime.platform.effectsPort,
    );

    return normalizeHostedEmailConversationCapture({
      accountAddress: input.wake.message.identityId,
      accountId: input.wake.message.identityId,
      rawMessage: bytes,
      selfAddresses: resolveHostedEmailSelfAddresses({
        extra: [input.wake.message.selfAddress],
        senderIdentity: input.wake.message.identityId,
      }),
      source: "email",
      threadIsDirect: input.wake.message.threadIsDirect,
      threadTarget: input.wake.message.threadTarget ?? null,
    });
  }

  if (isHostedWhatsAppConversationMessageWake(input.wake)) {
    return normalizeHostedWhatsAppConversationCapture({
      accountId: input.wake.message.whatsappMessage.phoneNumberId ?? "cloud-api",
      externalId: input.wake.eventId,
      message: input.wake.message.whatsappMessage,
      occurredAt: input.wake.occurredAt,
      receivedAt: input.wake.occurredAt,
    });
  }

  throw new TypeError("Unsupported hosted conversation message wake kind.");
}

function shouldSkipHostedEmailRawInboxProjection(
  wake: HostedExecutionConversationMessageWake,
): boolean {
  if (!isHostedEmailConversationMessageWake(wake)) {
    return false;
  }

  const threadTarget = wake.message.threadTarget?.trim() ?? "";
  if (!threadTarget) {
    return false;
  }

  // Group email prompt fields are already minimized on the Worker path; raw
  // .eml bytes can carry group addresses, subjects, bodies, and quoted
  // headers. Threading uses threadTarget, so the runtime vault does not need a
  // raw inbox projection for group-routed email wakes.
  return parseHostedEmailThreadTarget(threadTarget)?.targetKind === "group";
}

function buildHostedLinqAttachmentDownloadEnv(input: Pick<
  NormalizedHostedAssistantRuntimeConfig,
  "forwardedEnv" | "platformEnv" | "userEnv"
>): Record<string, string> {
  const env = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv,
    userEnv: input.userEnv,
  });
  const cdnBaseUrl =
    readHostedLinqAttachmentEnvValue(input.forwardedEnv, "LINQ_ATTACHMENT_CDN_BASE_URL")
    ?? readHostedLinqAttachmentEnvValue(input.platformEnv, "LINQ_ATTACHMENT_CDN_BASE_URL");
  if (cdnBaseUrl) {
    env.LINQ_ATTACHMENT_CDN_BASE_URL = cdnBaseUrl;
  }
  return env;
}

function readHostedLinqAttachmentEnvValue(
  env: Readonly<Record<string, string>> | undefined,
  key: string,
): string | null {
  const value = env?.[key]?.trim();
  return value ? value : null;
}
