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
  createParsedInboxPipeline,
  type PersistedCapture,
  openInboxRuntime,
} from "@murphai/inboxd";
import { createConfiguredParserRegistry } from "@murphai/parsers";

import {
  buildHostedTelegramChannelEnv,
  markHostedConversationReadBestEffort,
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
  metrics: HostedConversationWakeMetrics;
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
  let parserProcessed = 0;
  let pipeline: Awaited<ReturnType<typeof createParsedInboxPipeline>> | null = null;

  try {
    const configured = await createConfiguredParserRegistry({
      vaultRoot: input.vaultRoot,
    });
    pipeline = await createParsedInboxPipeline({
      ffmpeg: configured.ffmpeg,
      onParserDrain(results) {
        parserProcessed += results.length;
      },
      registry: configured.registry,
      runtime,
      vaultRoot: input.vaultRoot,
    });
    const persistedCapture = await pipeline.processCapture(capture);
    await markHostedConversationReadBestEffort({
      forwardedEnv: input.runtime.forwardedEnv,
      userEnv: input.runtime.userEnv,
      wake: input.wake,
    });

    return {
      capture: persistedCapture,
      metrics: {
        nextWakeAt: null,
        parserProcessed,
      },
    };
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
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
