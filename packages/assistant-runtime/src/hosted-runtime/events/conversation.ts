import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  resolveHostedEmailSelfAddresses,
} from "@murphai/hosted-execution/hosted-email";
import {
  normalizeHostedEmailConversationCapture,
  normalizeHostedLinqConversationCapture,
  normalizeHostedTelegramConversationCapture,
} from "@murphai/inboxd/connectors/hosted-conversation";
import {
  createInboxPipeline,
  type PersistedCapture,
  openInboxRuntime,
} from "@murphai/inboxd";
import {
  createConfiguredParserRegistry,
  createInboxParserService,
} from "@murphai/parsers";

import {
  buildHostedTelegramChannelEnv,
} from "../channel-activity.ts";
import { readHostedRawEmailMessage } from "./email.ts";
import {
  createHostedLinqAttachmentDownloadDriver,
  HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
} from "./linq.ts";
import { createHostedTelegramAttachmentDownloadDriver } from "./telegram.ts";
import type {
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "../models.ts";

export async function ingestHostedConversationMessageWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv" | "userEnv">;
  vaultRoot: string;
}): Promise<HostedConversationWakeMetrics> {
  const result = await importHostedConversationMessageWakeIntoLocalInbox(input);
  return result.metrics;
}

export interface HostedConversationWakeLocalImportResult {
  capture: PersistedCapture;
  capturePersistence: "canonical";
  metrics: HostedConversationWakeMetrics;
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
  vaultRoot: string;
}): Promise<HostedConversationWakeLocalImportResult> {
  const capture = await normalizeHostedConversationMessageWake(input);
  const runtime = await openInboxRuntime({
    vaultRoot: input.vaultRoot,
  });
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;

  try {
    pipeline = await createInboxPipeline({
      runtime,
      vaultRoot: input.vaultRoot,
    });
    let persistedCapture: PersistedCapture;
    try {
      persistedCapture = await pipeline.processCapture(capture);
    } catch (error) {
      throw new HostedConversationInboxProjectionError(
        "Canonical inbox capture projection failed.",
        { cause: error },
      );
    }
    const parserProcessed = await drainHostedConversationParsers({
      captureId: persistedCapture.captureId,
      runtime,
      vaultRoot: input.vaultRoot,
    });

    const metrics: HostedConversationWakeMetrics = {
      nextWakeAt: null,
      parserProcessed,
    };
    return {
      capture: persistedCapture,
      capturePersistence: "canonical",
      metrics,
    };
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
  }
}

async function drainHostedConversationParsers(input: {
  captureId: string;
  runtime: Awaited<ReturnType<typeof openInboxRuntime>>;
  vaultRoot: string;
}): Promise<number> {
  try {
    const parserConfig = await createConfiguredParserRegistry({
      vaultRoot: input.vaultRoot,
    });
    const parserService = createInboxParserService({
      ffmpeg: parserConfig.ffmpeg,
      registry: parserConfig.registry,
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
    });
    const results = await parserService.drain({
      captureId: input.captureId,
    });
    return results.length;
  } catch {
    return 0;
  }
}

async function normalizeHostedConversationMessageWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv" | "userEnv">;
}) {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    return normalizeHostedLinqConversationCapture({
      accountId: input.wake.message.phoneLookupKey,
      attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
      downloadDriver: createHostedLinqAttachmentDownloadDriver(),
      linqMessage: input.wake.message.linqMessage,
      occurredAt: input.wake.occurredAt,
    });
  }

  if (isHostedTelegramConversationMessageWake(input.wake)) {
    return normalizeHostedTelegramConversationCapture({
      accountId: "bot",
      downloadDriver: createHostedTelegramAttachmentDownloadDriver(
        buildHostedTelegramChannelEnv({
          forwardedEnv: input.runtime.forwardedEnv,
          platformEnv: input.runtime.platformEnv,
        }),
      ),
      externalId: input.wake.eventId,
      message: input.wake.message.telegramMessage,
      occurredAt: input.wake.occurredAt,
      receivedAt: input.wake.occurredAt,
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
      threadTarget: null,
    });
  }

  throw new TypeError("Unsupported hosted conversation message wake kind.");
}
