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
  HostedRuntimeIssueExportResponse,
  HostedRuntimeUsageRecordResponse as HostedExecutionRuntimeUsageRecordResponse,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceReadResponse,
  HostedBrowserVaultReplicaPublishResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
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
  publishRef?(input: {
    replicaRef: HostedBrowserVaultReplicaRef;
  }): Promise<HostedBrowserVaultReplicaPublishResponse>;
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

export interface HostedRuntimeWhatsAppSendRequest {
  message: string;
  replyToMessageId?: string | null;
  target: string;
}

export interface HostedRuntimeWhatsAppSendResponse {
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
  sendWhatsApp?(
    request: HostedRuntimeWhatsAppSendRequest,
  ): Promise<HostedRuntimeWhatsAppSendResponse | void>;
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
    sourceProviderSlug?: string | null;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  fetchDirtyStates(input?: Omit<HostedExecutionDeviceSyncDirtyPendingRequest, "userId">): Promise<
    HostedExecutionDeviceSyncDirtyPendingResponse
  >;
  ackDirtyStateProcessed(input: Omit<HostedExecutionDeviceSyncDirtyAckRequest, "userId">): Promise<
    HostedExecutionDeviceSyncDirtyAckResponse
  >;
}

export interface HostedRuntimeUsageRecordPort {
  recordUsage(record: AssistantUsageRecord): Promise<HostedRuntimeUsageRecordResponse>;
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
  usageRecordPort?: HostedRuntimeUsageRecordPort | null;
  workspacePort?: HostedRuntimeWorkspacePort | null;
}

export type HostedRuntimeIssueRecordResponse = HostedRuntimeIssueExportResponse;
export type HostedRuntimeUsageRecordResponse = HostedExecutionRuntimeUsageRecordResponse;

export {
  parseHostedRuntimeIssueExportResponse as parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeUsageRecordResponse,
} from "@murphai/hosted-execution/parsers";
