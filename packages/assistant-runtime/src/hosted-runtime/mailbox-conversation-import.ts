import type {
  HostedExecutionConversationMessageWake,
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

const CONVERSATION_CAPTURE_PERSIST_FAILED_REASON =
  "conversation_import.capture_persist_failed";

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
  captureId: string | null;
  deduped: boolean;
  durable?: boolean;
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
  if (imported.durable === false) {
    return {
      reasonCode: CONVERSATION_CAPTURE_PERSIST_FAILED_REASON,
      retryable: true,
      status: "blocked",
    };
  }
  if (imported.deduped) {
    return {
      captureId: imported.captureId,
      metrics: imported.metrics,
      reasonCode: "capture.deduped",
      status: "skipped",
    };
  }

  return {
    captureId: imported.captureId,
    metrics: imported.metrics,
    status: "imported",
  };
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
    captureId: result.capture.captureId,
    deduped: result.capture.deduped,
    durable: result.capturePersistence === "canonical",
    metrics: result.metrics,
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
