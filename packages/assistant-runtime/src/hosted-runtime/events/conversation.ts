import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
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

const HOSTED_CONVERSATION_PARSER_DRAIN_MAX_JOBS = 4;

export async function ingestHostedConversationMessageWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv" | "userEnv">;
  vaultRoot: string;
}): Promise<HostedConversationWakeMetrics> {
  const result = await importHostedConversationMessageWakeIntoLocalInbox(input);
  return result.metrics;
}

export interface HostedConversationWakeLocalImportResult {
  afterCheckpoint?: (() => Promise<void>) | null;
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
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;

  try {
    pipeline = await createInboxPipeline({
      runtime,
      vaultRoot: input.vaultRoot,
    });
    const persistedCapture = await pipeline.processCapture(capture);

    const metrics: HostedConversationWakeMetrics = {
      nextWakeAt: null,
      parserProcessed: 0,
    };
    return {
      afterCheckpoint: async () => {
        await markHostedConversationReadBestEffort({
          forwardedEnv: input.runtime.forwardedEnv,
          userEnv: input.runtime.userEnv,
          wake: input.wake,
        });
        await drainHostedConversationParsersBestEffort({
          captureId: persistedCapture.captureId,
          input,
        });
      },
      capture: persistedCapture,
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

async function drainHostedConversationParsersBestEffort(input: {
  captureId: string;
  input: {
    wake: HostedExecutionConversationMessageWake;
    vaultRoot: string;
  };
}): Promise<number> {
  let phase: "parser_registry_unavailable" | "parser_drain_failed" =
    "parser_registry_unavailable";

  try {
    let runtime: Awaited<ReturnType<typeof openInboxRuntime>> | null = null;
    const configured = await createConfiguredParserRegistry({
      vaultRoot: input.input.vaultRoot,
    });
    phase = "parser_drain_failed";
    try {
      runtime = await openInboxRuntime({
        vaultRoot: input.input.vaultRoot,
      });
      const parserService = createInboxParserService({
        ffmpeg: configured.ffmpeg,
        registry: configured.registry,
        runtime,
        vaultRoot: input.input.vaultRoot,
      });
      const results = await parserService.drain({
        captureId: input.captureId,
        maxJobs: HOSTED_CONVERSATION_PARSER_DRAIN_MAX_JOBS,
      });

      if (results.length > 0) {
        const failed = results.filter((result) => result.status === "failed").length;
        emitHostedExecutionStructuredLog({
          component: "runtime",
          details: {
            captureId: input.captureId,
            diagnostic: "parser_drain_completed",
            failed,
            processed: results.length,
            succeeded: results.length - failed,
          },
          message: "Hosted conversation parser drain completed after mailbox checkpoint.",
          phase: "wake.running",
          wake: input.input.wake,
        });
      }
      return results.length;
    } finally {
      runtime?.close();
    }
  } catch {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        captureId: input.captureId,
        diagnostic: phase,
      },
      message: "Hosted conversation parser drain failed after mailbox checkpoint.",
      phase: "wake.running",
      wake: input.input.wake,
    });
    return 0;
  }
}
