import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
  isHostedLinqConversationMessageWake,
} from "@murphai/hosted-execution";

import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  importHostedConversationMessageWakeIntoLocalInbox,
} from "./events/conversation.ts";
import {
  prepareHostedLocalRuntimeForConversationImport,
  requireHostedBootstrapForWake,
} from "./context.ts";
import {
  HostedRawEmailMessageMissingError,
} from "./events/email.ts";
import {
  recordHostedProviderCleanupBeforeCommit,
  type HostedProviderCleanupCheckpoint,
} from "./provider-cleanup.ts";

export type HostedConversationMailboxPayloadDecodeResult =
  | {
      status: "decoded";
      wake: HostedExecutionConversationMessageWake;
    }
  | {
      reasonCode: string;
      retryable: boolean;
      status: "blocked";
    };

export interface HostedConversationMailboxPayloadDecoder {
  decode(
    input: HostedConversationMailboxPayloadDecodeInput,
  ): Promise<HostedConversationMailboxPayloadDecodeResult>;
}

export interface HostedConversationMailboxPayloadDecodeInput {
  itemRef: {
    id: string;
    laneSeq: string;
    userId: string;
  };
  payloadCiphertext: string;
  payloadRequestId: string | null;
  payloadSchema: string;
  payloadSource: "inline" | "sidecar";
}

export interface HostedConversationMailboxLocalImportResult {
  afterCheckpoint?: (() => Promise<void>) | null;
  captureId: string | null;
  deduped: boolean;
  metrics: HostedConversationWakeMetrics;
}

export type HostedConversationMailboxLocalImporter = (input: {
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}) => Promise<HostedConversationMailboxLocalImportResult>;

export type HostedConversationMailboxWakeContextPreparer = (input: {
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}) => Promise<void>;

export type HostedConversationMailboxProviderCleanupRecorder = (input: {
  checkpoint: HostedProviderCleanupCheckpoint;
  linqMessageIds?: readonly string[] | null;
  vaultRoot: string;
}) => Promise<void>;

export type HostedConversationMailboxImportOutcome =
  | {
      afterCheckpoint?: (() => Promise<void>) | null;
      captureId: string | null;
      metrics: HostedConversationWakeMetrics;
      reasonCode?: null;
      status: "imported";
    }
  | {
      afterCheckpoint?: (() => Promise<void>) | null;
      captureId: string | null;
      metrics: HostedConversationWakeMetrics;
      reasonCode: "capture.deduped";
      status: "skipped";
    }
  | {
      reasonCode: string;
      retryable: boolean;
      status: "blocked";
    }
  | {
      reasonCode: string;
      status: "deferred";
    };

export function createHostedConversationMailboxImportItem(input: {
  decodePayload: HostedConversationMailboxPayloadDecoder;
  importConversationWake?: HostedConversationMailboxLocalImporter;
  prepareWakeContext?: HostedConversationMailboxWakeContextPreparer;
  recordProviderCleanupBeforeCommit?: HostedConversationMailboxProviderCleanupRecorder;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
}): (item: HostedMailboxResolvedImportItem) => Promise<HostedMailboxItemImportOutcome> {
  return (item) =>
    importHostedConversationMailboxItem({
      ...input,
      item,
    });
}

export async function importHostedConversationMailboxItem(input: {
  decodePayload: HostedConversationMailboxPayloadDecoder;
  importConversationWake?: HostedConversationMailboxLocalImporter;
  prepareWakeContext?: HostedConversationMailboxWakeContextPreparer;
  recordProviderCleanupBeforeCommit?: HostedConversationMailboxProviderCleanupRecorder;
  item: HostedMailboxResolvedImportItem;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
}): Promise<HostedConversationMailboxImportOutcome> {
  if (
    input.item.route.action !== "import-conversation-message"
    || input.item.item.kind !== "conversation.message"
  ) {
    return {
      reasonCode: "conversation_import.unexpected_route",
      status: "deferred",
    };
  }

  const decoded = await input.decodePayload.decode({
    itemRef: {
      id: input.item.item.id,
      laneSeq: input.item.item.laneSeq,
      userId: input.item.item.userId,
    },
    payloadCiphertext: input.item.payload.payloadCiphertext,
    payloadRequestId: input.item.payload.requestId,
    payloadSchema: input.item.payload.payloadSchema,
    payloadSource: input.item.payload.source,
  });

  if (decoded.status === "blocked") {
    return {
      reasonCode: normalizeConversationMailboxReasonCode(
        decoded.reasonCode,
        "payload.decode_unavailable",
      ),
      retryable: decoded.retryable,
      status: "blocked",
    };
  }

  if (!decodedWakeMatchesMailboxItem(decoded.wake, input.item.item)) {
    return {
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    };
  }

  const importConversationWake =
    input.importConversationWake ?? importHostedConversationWakeWithLocalInbox;
  const prepareWakeContext =
    input.prepareWakeContext ?? prepareHostedConversationMailboxWakeContext;
  await prepareWakeContext({
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
    wake: decoded.wake,
  });
  let imported: HostedConversationMailboxLocalImportResult;
  try {
    imported = await importConversationWake({
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
      wake: decoded.wake,
    });
  } catch (error) {
    if (error instanceof HostedRawEmailMessageMissingError) {
      return {
        reasonCode: "conversation_import.raw_email_missing",
        retryable: true,
        status: "blocked",
      };
    }

    throw error;
  }
  const linqProviderMessageId = resolveHostedConversationProviderCleanupMessageId(decoded.wake);
  const afterCheckpoint = composeHostedConversationMailboxAfterCheckpointEffects(
    imported.afterCheckpoint,
    linqProviderMessageId
      ? async () => {
          try {
            await (input.recordProviderCleanupBeforeCommit ?? recordHostedProviderCleanupBeforeCommit)({
              checkpoint: {
                nextWakeAt: null,
              },
              linqMessageIds: [linqProviderMessageId],
              vaultRoot: input.vaultRoot,
            });
          } catch {
            emitHostedExecutionStructuredLog({
              component: "runtime",
              details: {
                diagnostic: "provider_cleanup_record_failed",
                provider: "linq",
              },
              level: "warn",
              message:
                "Hosted runtime could not record provider-visible Linq cleanup after mailbox checkpoint.",
              phase: "wake.running",
              wake: decoded.wake,
            });
          }
        }
      : null,
  );

  if (imported.deduped) {
    return {
      ...(afterCheckpoint ? { afterCheckpoint } : {}),
      captureId: imported.captureId,
      metrics: imported.metrics,
      reasonCode: "capture.deduped",
      status: "skipped",
    };
  }

  return {
    ...(afterCheckpoint ? { afterCheckpoint } : {}),
    captureId: imported.captureId,
    metrics: imported.metrics,
    status: "imported",
  };
}

function resolveHostedConversationProviderCleanupMessageId(
  wake: HostedExecutionConversationMessageWake,
): string | null {
  if (!isHostedLinqConversationMessageWake(wake)) {
    return null;
  }

  return wake.message.linqMessage.messageId.trim() || null;
}

async function importHostedConversationWakeWithLocalInbox(input: {
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}): Promise<HostedConversationMailboxLocalImportResult> {
  const result = await importHostedConversationMessageWakeIntoLocalInbox(input);
  return {
    afterCheckpoint: result.afterCheckpoint,
    captureId: result.capture.captureId,
    deduped: result.capture.deduped,
    metrics: result.metrics,
  };
}

function composeHostedConversationMailboxAfterCheckpointEffects(
  first: (() => Promise<void>) | null | undefined,
  second: (() => Promise<void>) | null | undefined,
): (() => Promise<void>) | null {
  const effects = [first, second].filter(
    (effect): effect is () => Promise<void> => typeof effect === "function",
  );
  if (effects.length === 0) {
    return null;
  }

  return async () => {
    for (const effect of effects) {
      try {
        await effect();
      } catch {
        // Post-checkpoint conversation effects are enrichment/provider cleanup.
        // They must not affect the accepted capture watermark.
      }
    }
  };
}

function decodedWakeMatchesMailboxItem(
  wake: HostedExecutionConversationMessageWake,
  item: HostedMailboxResolvedImportItem["item"],
): boolean {
  return wake.kind === "conversation.message"
    && wake.userId === item.userId
    && wake.occurredAt === item.occurredAt
    && wake.eventId === item.dedupeKey;
}

async function prepareHostedConversationMailboxWakeContext(input: {
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}): Promise<void> {
  void input.runtime;
  await requireHostedBootstrapForWake(input.vaultRoot, input.wake);
  await prepareHostedLocalRuntimeForConversationImport(
    input.vaultRoot,
    input.wake.eventId,
  );
}

function normalizeConversationMailboxReasonCode(
  value: string,
  fallback: string,
): string {
  const normalized = value.trim();
  return /^[a-z][a-z0-9._-]{0,95}$/u.test(normalized)
    ? normalized
    : fallback;
}
