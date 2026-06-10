import {
  importHostedVaultShareDeliveryWake,
} from "./vault-share-import.ts";
import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionConversationMessageWake,
  type HostedExecutionSystemWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";

import {
  createHostedConversationMailboxImportItem,
} from "./mailbox-conversation-import.ts";
import type {
  HostedRuntimeDeviceSyncMessagingReturnTarget,
} from "./platform.ts";
import {
  enqueueHostedSystemMailboxItem,
} from "./system-mailbox.ts";
import type {
  HostedWorkspaceRuntimeJobOptions,
} from "../hosted-runtime.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";

type HostedWorkspaceRuntimeBridgeImportItem =
  HostedWorkspaceRuntimeJobOptions["importItem"];
type HostedWorkspaceRuntimeBridgeImportItemInput =
  Parameters<HostedWorkspaceRuntimeBridgeImportItem>[0];
type HostedWorkspaceRuntimeBridgeImportItemContext =
  Parameters<HostedWorkspaceRuntimeBridgeImportItem>[1];
type HostedRuntimeBridgeNormalizedRuntime = Pick<
  NormalizedHostedAssistantRuntimeConfig,
  | "commitTimeoutMs"
  | "forwardedEnv"
  | "parserToolchain"
  | "platform"
  | "platformEnv"
  | "resolvedConfig"
  | "userEnv"
>;

export interface HostedMailboxPayloadDecodeItemRef {
  dedupeKey: string;
  id: string;
  kind: string;
  lane: string;
  laneSeq: string;
  occurredAt: string;
  userId: string;
}

export interface HostedMailboxPayloadDecodeInput {
  itemRef: HostedMailboxPayloadDecodeItemRef;
  payloadCiphertext: string;
  payloadRequestId: string | null;
  payloadSchema: string;
  payloadSource: "inline" | "sidecar";
}

export type HostedMailboxPayloadDecodeResult =
  | {
      status: "decoded";
      wake: HostedExecutionWake;
    }
  | {
      status: "blocked";
      reasonCode: string;
      retryable: boolean;
    };

export type HostedWorkspaceMailboxPayloadDecodeInput =
  HostedMailboxPayloadDecodeInput;
export type HostedWorkspaceMailboxPayloadDecodeResult =
  HostedMailboxPayloadDecodeResult;

export interface HostedWorkspaceMailboxPayloadDecoder {
  decode(
    input: HostedWorkspaceMailboxPayloadDecodeInput,
  ): Promise<HostedWorkspaceMailboxPayloadDecodeResult>;
}

export function createHostedWorkspaceBridgeMailboxImporter(input: {
  decodeMailboxPayload: HostedWorkspaceMailboxPayloadDecoder;
  runtime: HostedRuntimeBridgeNormalizedRuntime;
  vaultRoot: string;
}): HostedWorkspaceRuntimeBridgeImportItem {
  return async (item, context) => {
    const importConversationItem = createHostedConversationMailboxImportItem({
      decodePayload: {
        decode: async (decodeInput) => {
          const decoded = await input.decodeMailboxPayload.decode({
            itemRef: decodeInput.itemRef,
            payloadCiphertext: decodeInput.payloadCiphertext,
            payloadRequestId: decodeInput.payloadRequestId,
            payloadSchema: decodeInput.payloadSchema,
            payloadSource: decodeInput.payloadSource,
          });

          if (decoded.status === "blocked") {
            return decoded;
          }

          if (decoded.wake.kind !== "conversation.message") {
            return {
              reasonCode: "payload.decode_mismatch",
              retryable: false,
              status: "blocked",
            };
          }

          return {
            status: "decoded",
            wake: decoded.wake,
          };
        },
      },
      onDecodedConversationWake: (wake) => {
        context?.recordMessagingReturnTarget?.(
          resolveHostedCliBridgeMessagingReturnTarget(wake),
        );
      },
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
    });

    return importHostedWorkspaceBridgeMailboxItem({
      ...input,
      context,
      importConversationItem,
      item,
    });
  };
}

async function importHostedWorkspaceBridgeMailboxItem(input: {
  importConversationItem: HostedWorkspaceRuntimeBridgeImportItem;
  item: HostedWorkspaceRuntimeBridgeImportItemInput;
  context?: HostedWorkspaceRuntimeBridgeImportItemContext;
  decodeMailboxPayload: HostedWorkspaceMailboxPayloadDecoder;
  runtime: HostedRuntimeBridgeNormalizedRuntime;
  vaultRoot: string;
}): ReturnType<HostedWorkspaceRuntimeBridgeImportItem> {
  if (
    input.item.route.action === "import-conversation-message"
    && input.item.item.kind === "conversation.message"
  ) {
    return await input.importConversationItem(input.item, input.context);
  }

  if (
    input.item.route.action === "import-conversation-message"
    || input.item.item.kind === "conversation.message"
  ) {
    return {
      reasonCode: "cloudflare_bridge.unhandled_mailbox_route",
      status: "deferred",
    };
  }

  const decoded = await input.decodeMailboxPayload.decode({
    itemRef: {
      dedupeKey: input.item.item.dedupeKey,
      id: input.item.item.id,
      kind: input.item.item.kind,
      lane: input.item.item.lane,
      laneSeq: input.item.item.laneSeq,
      occurredAt: input.item.item.occurredAt,
      userId: input.item.item.userId,
    },
    payloadCiphertext: input.item.payload.payloadCiphertext,
    payloadRequestId: input.item.payload.requestId,
    payloadSchema: input.item.payload.payloadSchema,
    payloadSource: input.item.payload.source,
  });

  if (decoded.status === "blocked") {
    return decoded;
  }

  const wake = decoded.wake;

  if (!decodedSystemWakeMatchesMailboxItem(wake, input.item)) {
    return {
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    };
  }

  if (wake.kind === "vault-share.delivery") {
    return await importHostedVaultShareDeliveryWake({
      vaultRoot: input.vaultRoot,
      wake,
    });
  }

  return await enqueueHostedSystemMailboxItem({
    item: input.item,
    vaultRoot: input.vaultRoot,
    wake,
  });
}

function resolveHostedCliBridgeMessagingReturnTarget(
  wake: HostedExecutionConversationMessageWake,
): HostedRuntimeDeviceSyncMessagingReturnTarget | null {
  if (isHostedTelegramConversationMessageWake(wake)) {
    return "telegram";
  }

  if (isHostedLinqConversationMessageWake(wake)) {
    return "imessage";
  }

  return null;
}

function decodedSystemWakeMatchesMailboxItem(
  wake: HostedExecutionWake,
  item: HostedWorkspaceRuntimeBridgeImportItemInput,
): wake is HostedExecutionSystemWake {
  return wake.kind !== "conversation.message"
    && wake.userId === item.item.userId
    && wake.occurredAt === item.item.occurredAt
    && wake.eventId === item.item.dedupeKey
    && wake.kind === item.item.kind;
}
