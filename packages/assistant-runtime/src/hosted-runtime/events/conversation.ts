import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  resolveHostedEmailSelfAddresses,
} from "@murphai/hosted-execution";
import {
  normalizeParsedEmailMessage,
} from "@murphai/inboxd/connectors/email/normalize-parsed";
import {
  parseRawEmailMessage,
} from "@murphai/inboxd/connectors/email/parsed";
import {
  normalizeHostedLinqConversationMessage,
} from "@murphai/inboxd/connectors/linq/normalize";
import {
  normalizeHostedTelegramMessage,
} from "@murphai/inboxd/connectors/telegram/normalize";
import {
  createParsedInboxPipeline,
  openInboxRuntime,
} from "@murphai/inboxd";
import { createConfiguredParserRegistry } from "@murphai/parsers";

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
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "platform">;
  vaultRoot: string;
}): Promise<HostedConversationWakeMetrics> {
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
    await pipeline.processCapture(capture);

    return {
      nextWakeAt: null,
      parserProcessed,
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
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "platform">;
}) {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    return normalizeHostedLinqConversationMessage({
      accountId: input.wake.message.phoneLookupKey,
      attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
      downloadDriver: createHostedLinqAttachmentDownloadDriver(),
      linqEvent: input.wake.message.linqEvent,
      linqMessageId: input.wake.message.linqMessageId ?? null,
    });
  }

  if (isHostedTelegramConversationMessageWake(input.wake)) {
    return normalizeHostedTelegramMessage({
      accountId: "bot",
      downloadDriver: createHostedTelegramAttachmentDownloadDriver(),
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
    const parsedMessage = parseRawEmailMessage(bytes);

    return normalizeParsedEmailMessage({
      accountAddress: input.wake.message.identityId,
      accountId: input.wake.message.identityId,
      message: parsedMessage,
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
