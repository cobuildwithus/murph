import type {
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import type {
  HostedActionApprovalRequest,
  HostedActionApprovalResult,
} from "@murphai/hosted-execution/action-approval";
import type {
  HostedAssistantDeliveryRecord,
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";
import type {
  HostedMailboxConsumeRequest,
  HostedMailboxConsumeResponse,
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
  HostedRuntimeLatencyTraceRequest,
  HostedRuntimeLatencyTraceResponse,
  HostedRuntimeLogRequest,
  HostedRuntimeLogResponse,
  HostedRuntimeIssueExportResponse,
  HostedRuntimeProductFeedbackRecord,
  HostedRuntimeProductFeedbackRecordResponse,
  HostedCodexAuthUpdate,
  HostedCodexAuthUpdateResponse,
  HostedRuntimeUsageRecordResponse as HostedExecutionRuntimeUsageRecordResponse,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceReadResponse,
  HostedBrowserVaultReplicaPublishResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  assistantResponseMediaSchema,
} from "@murphai/operator-config/assistant-cli-contracts";
import type {
  AssistantResponseMedia,
} from "@murphai/operator-config/assistant-cli-contracts";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedVaultShareDeliverRequest,
  HostedVaultShareDeliverResponse,
} from "@murphai/hosted-execution/vault-share";
import type {
  HostedWorkspaceSnapshotV2Aad,
  HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
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
  HostedEmailSendRequest,
} from "../hosted-email.ts";
import type {
  AssistantConnectedAppsPort,
  AssistantHostedGeneratedImageUploader,
} from "@murphai/assistant-engine";
import type {
  RuntimeLivenessPort,
} from "./liveness.ts";

export interface HostedRuntimeArtifactReader {
  get(sha256: string): Promise<Uint8Array | null>;
}

export interface HostedRuntimeArtifactWriter {
  put(input: {
    bytes: Uint8Array;
    sha256: string;
  }): Promise<void>;
}

export interface HostedRuntimeArtifactStore extends
  HostedRuntimeArtifactReader,
  HostedRuntimeArtifactWriter {}

export interface HostedRuntimeBrowserVaultReplicaPort {
  publishRef?(input: {
    replicaRef: HostedBrowserVaultReplicaRef;
    signal?: AbortSignal | null;
  }): Promise<HostedBrowserVaultReplicaPublishResponse>;
  write(input: {
    replica: unknown;
    signal?: AbortSignal | null;
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

export type {
  AssistantResponseMedia,
};

export function parseHostedRuntimeAssistantResponseMedia(
  value: unknown,
): AssistantResponseMedia {
  return assistantResponseMediaSchema.parse(value);
}

export interface HostedRuntimeLinqSendRequest {
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  media?: readonly AssistantResponseMedia[] | null;
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
  downloadTelegramFile?(
    request: HostedRuntimeTelegramDownloadFileRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedRuntimeProviderFileResponse | null>;
  getTelegramFile?(
    request: HostedRuntimeTelegramGetFileRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedRuntimeTelegramFile | null>;
  readRawEmailMessage(rawMessageKey: string): Promise<Uint8Array | null>;
  readAssistantDeliveryRecord?(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<HostedAssistantDeliveryRecord | null>;
  assertLinqThreadRouteAuthority?(
    authority: HostedExecutionExternalThreadRouteAuthority,
    context?: { signal?: AbortSignal | null },
  ): Promise<void>;
  sendEmail(request: HostedEmailSendRequest): Promise<{ target: string } | void>;
  writeAssistantDeliveryRecord?(
    record: HostedAssistantDeliveryRecord,
  ): Promise<HostedAssistantDeliveryRecord>;
};

export type HostedRuntimeEffectsPort = HostedRuntimeEffectsPortBase;

export type HostedRuntimeDeviceSyncMessagingReturnTarget = "imessage" | "telegram";

export interface HostedRuntimeDeviceSyncPort {
  applyUpdates(input: {
    occurredAt?: string | null;
    signal?: AbortSignal | null;
    updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  createConnectLink(input: {
    connectTarget: string;
    messagingReturnTarget?: HostedRuntimeDeviceSyncMessagingReturnTarget | null;
  }): Promise<HostedExecutionDeviceSyncConnectLinkResponse>;
  fetchSnapshot(input?: {
    connectionId?: string | null;
    provider?: string | null;
    signal?: AbortSignal | null;
    sourceProviderSlug?: string | null;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  fetchDirtyStates(input?: Omit<HostedExecutionDeviceSyncDirtyPendingRequest, "userId"> & {
    signal?: AbortSignal | null;
  }): Promise<HostedExecutionDeviceSyncDirtyPendingResponse>;
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

export interface HostedRuntimeProductFeedbackPort {
  recordProductFeedback(
    feedback: HostedRuntimeProductFeedbackRecord,
  ): Promise<HostedRuntimeProductFeedbackRecordResponse>;
}

export interface HostedRuntimeCodexAuthPort {
  update(update: HostedCodexAuthUpdate): Promise<HostedCodexAuthUpdateResponse>;
}

export interface HostedRuntimeMailboxPort {
  // Optional for deploy-window compatibility with older platform builds.
  // Advances the durable per-lane consumed watermark after a clean pass;
  // idempotent monotonic max on the web side.
  consume?(request: HostedMailboxConsumeRequest): Promise<HostedMailboxConsumeResponse>;
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

export interface HostedRuntimeWorkspaceSnapshotDataKey {
  aad: HostedWorkspaceSnapshotV2Aad;
  dataKeyBase64: string;
  ivBase64: string;
  rootKeyId: string;
  scheme: HostedWorkspaceSnapshotV2Ref["encryption"]["scheme"];
  wrappedDataKey: string;
}

export interface HostedRuntimeWorkspaceSnapshotSessionStart {
  encryption: HostedRuntimeWorkspaceSnapshotDataKey;
  limits: {
    maxSinglePartEncryptedBytes: number;
    warnEncryptedBytes: number;
  };
  objectKey: string;
  snapshotId: string;
}

export interface HostedRuntimeWorkspaceSnapshotSessionCompleteResult {
  checkpoint: HostedWorkspaceCheckpointResponse;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
}

export interface HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails {
  snapshotDirectR2PresignElapsedMs?: number;
  snapshotDirectR2PutElapsedMs?: number;
}

export interface HostedRuntimeWorkspaceSnapshotRestoreTimingDetails {
  sizeGuardMs?: number;
  dataKeyUnwrapMs?: number;
  presignGetMs?: number;
  objectFetchMs?: number;
  decryptMs?: number;
  archiveExtractMs?: number;
  durableRootReplaceMs?: number;
  cleanupMs?: number;
  extractMs?: number;
  encryptedBytes?: number;
  plainBytes?: number;
}

export interface HostedRuntimeWorkspaceSnapshotPort {
  abortSnapshotSession(input: {
    objectKey: string;
    snapshotId: string;
  }): Promise<void>;
  completeSnapshotSession(input: {
    checkpointRequest: HostedWorkspaceCheckpointRequest;
    ref: HostedWorkspaceSnapshotV2Ref;
  }): Promise<HostedRuntimeWorkspaceSnapshotSessionCompleteResult>;
  putSnapshotObjectDirect(input: {
    encryptedByteSize: number;
    encryptedObjectSha256: string;
    objectKey: string;
    sourceFilePath: string;
    snapshotId: string;
  }): Promise<HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails | void>;
  restoreWorkspaceSnapshot(input: {
    durableRoot: string;
    ref: HostedWorkspaceSnapshotV2Ref;
    signal?: AbortSignal | null;
  }): Promise<HostedRuntimeWorkspaceSnapshotRestoreTimingDetails | void>;
  startSnapshotSession(input: {
    expectedWorkspaceVersion: string;
    inboxMediaRetentionWakeAt?: string | null;
    nextWakeAt?: string | null;
    nextWakeReason?: string | null;
    reason: "idle_shutdown";
  }): Promise<HostedRuntimeWorkspaceSnapshotSessionStart>;
}

export interface HostedRuntimeLogPort {
  write(request: HostedRuntimeLogRequest): Promise<HostedRuntimeLogResponse>;
}

export interface HostedRuntimeLatencyTracePort {
  record(request: HostedRuntimeLatencyTraceRequest): Promise<HostedRuntimeLatencyTraceResponse>;
}

export interface HostedRuntimeActionApprovalPort {
  consume(
    input: HostedActionApprovalRequest,
  ): Promise<HostedActionApprovalResult>;
  request(
    input: HostedActionApprovalRequest,
  ): Promise<HostedActionApprovalResult>;
}

export interface HostedRuntimeVaultSharePort {
  deliver(
    request: HostedVaultShareDeliverRequest,
  ): Promise<HostedVaultShareDeliverResponse>;
}

export interface HostedRuntimePlatform {
  actionApprovalPort?: HostedRuntimeActionApprovalPort | null;
  artifactStore: HostedRuntimeArtifactStore;
  browserVaultReplicaPort?: HostedRuntimeBrowserVaultReplicaPort | null;
  codexAuthPort?: HostedRuntimeCodexAuthPort | null;
  connectedApps?: AssistantConnectedAppsPort | null;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  effectsPort: HostedRuntimeEffectsPort;
  generatedImageUploader?: AssistantHostedGeneratedImageUploader | null;
  providerFetch?: typeof fetch | null;
  publicInternetFetch?: typeof fetch | null;
  issueExportPort?: HostedRuntimeIssueExportPort | null;
  latencyTracePort?: HostedRuntimeLatencyTracePort | null;
  logPort?: HostedRuntimeLogPort | null;
  mailboxPort?: HostedRuntimeMailboxPort | null;
  productFeedbackPort?: HostedRuntimeProductFeedbackPort | null;
  runtimeLivenessIntervalMs?: number | null;
  runtimeLivenessPort?: RuntimeLivenessPort | null;
  runtimeLivenessRequired?: boolean | null;
  usageRecordPort?: HostedRuntimeUsageRecordPort | null;
  vaultSharePort?: HostedRuntimeVaultSharePort | null;
  workspacePort?: HostedRuntimeWorkspacePort | null;
  workspaceSnapshotPort?: HostedRuntimeWorkspaceSnapshotPort | null;
}

export type HostedRuntimeIssueRecordResponse = HostedRuntimeIssueExportResponse;
export type HostedRuntimeLatencyTraceRecordResponse = HostedRuntimeLatencyTraceResponse;
export type HostedRuntimeUsageRecordResponse = HostedExecutionRuntimeUsageRecordResponse;

export {
  parseHostedRuntimeIssueExportResponse as parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeLatencyTraceResponse,
  parseHostedRuntimeUsageRecordResponse,
} from "@murphai/hosted-execution/parsers";
