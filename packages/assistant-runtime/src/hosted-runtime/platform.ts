import type {
  HostedAssistantDeliveryRecord,
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";
import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
  HostedRuntimeLogRequest,
  HostedRuntimeLogResponse,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedExecutionDeviceSyncConnectLinkResponse,
  HostedExecutionDeviceSyncDirtyAckRequest,
  HostedExecutionDeviceSyncDirtyAckResponse,
  HostedExecutionDeviceSyncDirtyPendingRequest,
  HostedExecutionDeviceSyncDirtyPendingResponse,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  AssistantActiveTurnInputCheckpointInput,
  AssistantTurnInputRefreshResult,
} from "@murphai/assistant-engine";
import type {
  HostedEmailSendRequest,
} from "../hosted-email.ts";
import type {
  RuntimeLivenessPort,
} from "./liveness.ts";

export interface HostedRuntimeArtifactStore {
  get(sha256: string): Promise<Uint8Array | null>;
  put(input: {
    bytes: Uint8Array;
    sha256: string;
  }): Promise<void>;
}

export interface HostedRuntimeBrowserVaultReplicaPort {
  write(input: {
    replica: unknown;
  }): Promise<HostedBrowserVaultReplicaRef>;
}

export type HostedRuntimeProviderTargetKind = "explicit" | "participant" | "thread";

export interface HostedRuntimeTelegramSendRequest {
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  target: string;
}

export interface HostedRuntimeTelegramCleanupMessage {
  messageId: string;
  target: string;
}

export interface HostedRuntimeTelegramSendResponse {
  cleanupMessages?: HostedRuntimeTelegramCleanupMessage[] | null;
  cleanupTargetAliases?: string[] | null;
  providerMessageId?: string | null;
  providerMessageIds?: string[] | null;
  providerThreadId?: string | null;
  target?: string | null;
  targetKind?: HostedRuntimeProviderTargetKind | null;
}

export interface HostedRuntimeTelegramChatActionRequest {
  action: "typing";
  target: string;
}

export interface HostedRuntimeTelegramFile {
  file_id: string;
  file_path?: string;
  file_size?: number;
  file_unique_id?: string;
  [key: string]: unknown;
}

export interface HostedRuntimeTelegramGetFileRequest {
  fileId: string;
}

export interface HostedRuntimeTelegramDownloadFileRequest {
  filePath: string;
}

export interface HostedRuntimeProviderFileResponse {
  bytesBase64: string;
  contentType: string | null;
  fileName: string | null;
  sha256: string;
}

export interface HostedRuntimeLinqSendRequest {
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  target: string;
  targetKind?: HostedRuntimeProviderTargetKind | null;
}

export interface HostedRuntimeLinqSendResponse {
  providerMessageId?: string | null;
  providerMessageIds?: string[] | null;
  providerThreadId?: string | null;
  target?: string | null;
  targetKind?: HostedRuntimeProviderTargetKind | null;
}

export interface HostedRuntimeLinqChatActionRequest {
  action: "typing" | "typing_stop";
  target: string;
}

export interface HostedRuntimeLinqMarkReadRequest {
  chatId: string;
}

export interface HostedRuntimeLinqDeleteMessagesRequest {
  messageIds: readonly string[];
}

type HostedRuntimeEffectsPortBase = {
  deletePreparedAssistantDelivery?(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<void>;
  deleteLinqMessages?(
    request: HostedRuntimeLinqDeleteMessagesRequest,
  ): Promise<void>;
  downloadTelegramFile?(
    request: HostedRuntimeTelegramDownloadFileRequest,
  ): Promise<HostedRuntimeProviderFileResponse | null>;
  getTelegramFile?(
    request: HostedRuntimeTelegramGetFileRequest,
  ): Promise<HostedRuntimeTelegramFile | null>;
  markLinqRead?(
    request: HostedRuntimeLinqMarkReadRequest,
  ): Promise<void>;
  readRawEmailMessage(rawMessageKey: string): Promise<Uint8Array | null>;
  readAssistantDeliveryRecord?(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<HostedAssistantDeliveryRecord | null>;
  sendEmail(request: HostedEmailSendRequest): Promise<{ target: string } | void>;
  sendLinq?(
    request: HostedRuntimeLinqSendRequest,
  ): Promise<HostedRuntimeLinqSendResponse | void>;
  sendLinqChatAction?(
    request: HostedRuntimeLinqChatActionRequest,
  ): Promise<void>;
  sendTelegram?(
    request: HostedRuntimeTelegramSendRequest,
  ): Promise<HostedRuntimeTelegramSendResponse | void>;
  sendTelegramChatAction?(
    request: HostedRuntimeTelegramChatActionRequest,
  ): Promise<void>;
  writeAssistantDeliveryRecord?(
    record: HostedAssistantDeliveryRecord,
  ): Promise<HostedAssistantDeliveryRecord>;
};

export type HostedRuntimeEffectsPort = HostedRuntimeEffectsPortBase;

export type HostedRuntimeDeviceSyncMessagingReturnTarget = "imessage" | "telegram";

export interface HostedRuntimeDeviceSyncPort {
  applyUpdates(input: {
    occurredAt?: string | null;
    updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  createConnectLink(input: {
    connectTarget: string;
    messagingReturnTarget?: HostedRuntimeDeviceSyncMessagingReturnTarget | null;
  }): Promise<HostedExecutionDeviceSyncConnectLinkResponse>;
  fetchSnapshot(input?: {
    connectionId?: string | null;
    provider?: string | null;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  fetchDirtyStates(input?: Omit<HostedExecutionDeviceSyncDirtyPendingRequest, "userId">): Promise<
    HostedExecutionDeviceSyncDirtyPendingResponse
  >;
  ackDirtyStateProcessed(input: Omit<HostedExecutionDeviceSyncDirtyAckRequest, "userId">): Promise<
    HostedExecutionDeviceSyncDirtyAckResponse
  >;
}

export interface HostedRuntimeBillingPort {
  resolveVercelAiGatewayStripeCustomerId(): Promise<HostedRuntimeBillingStripeCustomerResponse>;
}

export interface HostedRuntimeUsageExportPort {
  recordUsage(usage: readonly object[]): Promise<HostedRuntimeUsageRecordResponse>;
}

export interface HostedRuntimeIssueExportPort {
  recordIssues(issues: readonly object[]): Promise<HostedRuntimeIssueRecordResponse>;
}

export interface HostedRuntimeMailboxPort {
  fetch(request: HostedMailboxFetchRequest): Promise<HostedMailboxFetchResponse>;
  fetchPayload(
    request: HostedMailboxPayloadFetchRequest,
  ): Promise<HostedMailboxPayloadFetchResponse>;
}

export interface HostedRuntimeWorkspacePort {
  read?(): Promise<HostedWorkspaceReadResponse>;
  checkpoint(
    request: HostedWorkspaceCheckpointRequest,
  ): Promise<HostedWorkspaceCheckpointResponse>;
}

export interface HostedRuntimeLogPort {
  write(request: HostedRuntimeLogRequest): Promise<HostedRuntimeLogResponse>;
}

export interface HostedRuntimeActiveTurnInputMailboxRefreshInput {
  requestId: string;
}

export type HostedRuntimeActiveTurnInputMailboxRefresh = (
  input: HostedRuntimeActiveTurnInputMailboxRefreshInput,
) => Promise<AssistantTurnInputRefreshResult>;

export interface HostedRuntimeActiveTurnInputCheckpointInput
  extends AssistantActiveTurnInputCheckpointInput {
  requestId: string;
}

export type HostedRuntimeActiveTurnInputCheckpoint = (
  input: HostedRuntimeActiveTurnInputCheckpointInput,
) => Promise<void>;

export interface HostedRuntimePlatform {
  artifactStore: HostedRuntimeArtifactStore;
  billingPort?: HostedRuntimeBillingPort | null;
  browserVaultReplicaPort?: HostedRuntimeBrowserVaultReplicaPort | null;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  effectsPort: HostedRuntimeEffectsPort;
  issueExportPort?: HostedRuntimeIssueExportPort | null;
  logPort?: HostedRuntimeLogPort | null;
  mailboxPort?: HostedRuntimeMailboxPort | null;
  checkpointActiveTurnInput?: HostedRuntimeActiveTurnInputCheckpoint | null;
  refreshMailboxForActiveTurnInput?: HostedRuntimeActiveTurnInputMailboxRefresh | null;
  runtimeLivenessIntervalMs?: number | null;
  runtimeLivenessPort?: RuntimeLivenessPort | null;
  usageExportPort?: HostedRuntimeUsageExportPort | null;
  workspacePort?: HostedRuntimeWorkspacePort | null;
}

export interface HostedRuntimeBillingStripeCustomerResponse {
  stripeCustomerId: string | null;
}

export interface HostedRuntimeUsageRecordResponse {
  recorded: number;
  usageIds: string[];
}

export interface HostedRuntimeIssueRecordResponse {
  issueIds: string[];
  recorded: number;
}

export function parseHostedRuntimeUsageRecordResponse(
  value: unknown,
): HostedRuntimeUsageRecordResponse {
  const response = parseHostedRuntimeRecordResponse(value, "usageIds");
  return {
    recorded: response.recorded,
    usageIds: response.ids,
  };
}

export const HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV =
  "HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED";
export const HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV =
  "HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY";

export function parseHostedRuntimeBillingStripeCustomerResponse(
  value: unknown,
): HostedRuntimeBillingStripeCustomerResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime Stripe customer response must be an object.");
  }

  const stripeCustomerId = (value as { stripeCustomerId?: unknown }).stripeCustomerId;

  if (stripeCustomerId !== null && stripeCustomerId !== undefined && typeof stripeCustomerId !== "string") {
    throw new TypeError(
      "Hosted runtime Stripe customer response.stripeCustomerId must be a string or null.",
    );
  }

  if (typeof stripeCustomerId === "string") {
    const normalizedStripeCustomerId = stripeCustomerId.trim();
    if (normalizedStripeCustomerId.length === 0) {
      throw new TypeError(
        "Hosted runtime Stripe customer response.stripeCustomerId must be a non-empty string or null.",
      );
    }

    return {
      stripeCustomerId: normalizedStripeCustomerId,
    };
  }

  return {
    stripeCustomerId: null,
  };
}

function parseHostedRuntimeRecordResponse(
  value: unknown,
  idsFieldName: "issueIds" | "usageIds",
): { ids: string[]; recorded: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime record response must be an object.");
  }

  const recorded = (value as { recorded?: unknown }).recorded;
  const ids = (value as Record<string, unknown>)[idsFieldName];

  if (typeof recorded !== "number" || !Number.isSafeInteger(recorded) || recorded < 0) {
    throw new TypeError("Hosted runtime record response.recorded must be a non-negative integer.");
  }

  if (!Array.isArray(ids)) {
    throw new TypeError(`Hosted runtime record response.${idsFieldName} must be a string array of non-empty values.`);
  }

  const normalizedIds: string[] = []
  for (const entry of ids) {
    if (typeof entry !== "string") {
      throw new TypeError(`Hosted runtime record response.${idsFieldName} must be a string array of non-empty values.`);
    }
    const trimmedEntry = entry.trim()
    if (trimmedEntry.length === 0) {
      throw new TypeError(`Hosted runtime record response.${idsFieldName} must be a string array of non-empty values.`);
    }
    normalizedIds.push(trimmedEntry)
  }

  if (recorded !== normalizedIds.length) {
    throw new TypeError(
      `Hosted runtime record response.recorded must equal ${idsFieldName}.length.`,
    );
  }

  return {
    ids: normalizedIds,
    recorded,
  };
}


export function parseHostedRuntimeIssueRecordResponse(
  value: unknown,
): HostedRuntimeIssueRecordResponse {
  const response = parseHostedRuntimeRecordResponse(value, "issueIds");
  return {
    issueIds: response.ids,
    recorded: response.recorded,
  };
}
