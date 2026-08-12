import type {
  HostedClinicalRecordsConnectLinkRequest,
  HostedClinicalRecordsConnectLinkResponse,
  HostedClinicalRecordsFetchPageRequest,
  HostedClinicalRecordsFetchPageResponse,
  HostedClinicalRecordsRecordOutcomeRequest,
  HostedClinicalRecordsReadRunRequest,
  HostedClinicalRecordsReadRunResponse,
} from "@murphai/hosted-execution/clinical-records";
import type {
  HostedActionApprovalConsumeRequest,
  HostedActionApprovalObservation,
  HostedActionApprovalRequest,
  HostedActionApprovalResult,
} from "@murphai/hosted-execution/action-approval";
import type {
  HostedAssistantDeliveryRecord,
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";
import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
  HostedRuntimeLatencyTraceRequest,
  HostedRuntimeLatencyTraceResponse,
  HostedRuntimeLogRequest,
  HostedRuntimeLogResponse,
  HostedRuntimeIssueExportResponse,
  HostedRuntimeIMessageContactToolRequest,
  HostedRuntimeIMessageContactToolResponse,
  HostedRuntimeFamilyPlanToolRequest,
  HostedRuntimeFamilyPlanToolResponse,
  HostedRuntimeAssistantConfigurationControlRequest,
  HostedRuntimeAssistantConfigurationToolResponse,
  HostedRuntimeAssistantAskControlRequest,
  HostedRuntimeAssistantAskControlResponse,
  HostedRuntimeGroupToolRequest,
  HostedRuntimeGroupToolResponse,
  HostedRuntimeProductFeedbackRecord,
  HostedRuntimeProductFeedbackRecordResponse,
  HostedCodexAuthUpdate,
  HostedCodexAuthUpdateResponse,
  HostedRuntimeUsageNoticeDeliveryTarget,
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
  HostedRuntimeAssistantPersonalizationToolAuthority,
  HostedRuntimeAssistantPersonalizationToolRequest,
  HostedRuntimeAssistantPersonalizationToolResponse,
} from "@murphai/hosted-execution/assistant-personalization";
import {
  assistantResponseMediaSchema,
  type AssistantResponseMedia,
} from "@murphai/operator-config/assistant-cli-contracts";
import type {
  AssistantResponseCard,
} from "@murphai/operator-config/assistant-response-cards";
import type {
  HostedBrowserVaultReplicaRef,
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionResolvedLinqDeliveryRoute,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedExecutionPrivateAssistantAskCompletionDeliveryAuthority,
} from "@murphai/hosted-execution";
import type {
  HostedVaultShareDeliverRequest,
  HostedVaultShareDeliverResponse,
  HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";
import type {
  HostedWorkspaceSnapshotV2Aad,
  HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import type {
  HostedRuntimeLinqDeliveryBlockCode,
  HostedRuntimeLinqDeliveryPosture,
} from "@murphai/hosted-execution/routes";
import type {
  HostedPhoneCallStartRequest,
  HostedPhoneCallStartResponse,
} from "@murphai/hosted-execution/phone-calls";
import type {
  HostedPhysicalNoteSendRequest,
  HostedPhysicalNoteSendResponse,
} from "@murphai/hosted-execution/physical-notes";
import type {
  HostedPlanUsageStatus,
  HostedPlanUsageToolRequest,
} from "@murphai/hosted-execution/plan-usage";
import type {
  HostedRuntimeSubscriptionControlRequest,
  HostedRuntimeSubscriptionToolResponse,
} from "@murphai/hosted-execution/subscription";
import type {
  HostedRuntimeLabsToolRequest,
  HostedRuntimeLabsToolResponse,
} from "@murphai/hosted-execution/labs";
import type {
  HostedExecutionDeviceSyncConnectLinkResponse,
  HostedExecutionDeviceSyncDirtyAckRequest,
  HostedExecutionDeviceSyncDirtyAckResponse,
  HostedExecutionDeviceSyncDirtyPendingRequest,
  HostedExecutionDeviceSyncDirtyPendingResponse,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncReconcileResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedEmailSendRequest,
  HostedEmailSendResult,
} from "../hosted-email.ts";
import type {
  AssistantConnectedAppsPort,
  AssistantHostedPrivateImageUrlPublisher,
} from "@murphai/assistant-engine";
import type {
  RuntimeLivenessPort,
} from "./liveness.ts";

export const HOSTED_RUNTIME_ARTIFACT_READ_PURPOSES = [
  "canonical_write_receipt",
  "legacy_snapshot_materialization",
  "workspace_artifact_materialization",
  "workspace_restore",
] as const;

export type HostedRuntimeArtifactReadPurpose =
  typeof HOSTED_RUNTIME_ARTIFACT_READ_PURPOSES[number];

export interface HostedRuntimeArtifactReadContext {
  purpose: HostedRuntimeArtifactReadPurpose;
  signal?: AbortSignal | null;
}

export interface HostedRuntimeArtifactReader {
  get(
    sha256: string,
    context: HostedRuntimeArtifactReadContext,
  ): Promise<Uint8Array | null>;
}

export class HostedRuntimeArtifactReadError extends Error {
  readonly retryable: boolean;

  constructor(input: { cause: unknown; retryable: boolean }) {
    super(
      input.cause instanceof Error
        ? input.cause.message
        : "Hosted runtime artifact read failed.",
      { cause: input.cause },
    );
    this.name = "HostedRuntimeArtifactReadError";
    this.retryable = input.retryable;
  }
}

export class HostedRuntimeArtifactWriteError extends Error {
  readonly retryable: boolean;

  constructor(input: { cause: unknown; retryable: boolean }) {
    super(
      input.cause instanceof Error
        ? input.cause.message
        : "Hosted runtime artifact write failed.",
      { cause: input.cause },
    );
    this.name = "HostedRuntimeArtifactWriteError";
    this.retryable = input.retryable;
  }
}

export interface HostedRuntimeAssistantConfigurationToolPort {
  request(
    request: HostedRuntimeAssistantConfigurationControlRequest,
  ): Promise<HostedRuntimeAssistantConfigurationToolResponse>;
}

export interface HostedRuntimeAssistantAskPort {
  request(
    request: HostedRuntimeAssistantAskControlRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedRuntimeAssistantAskControlResponse>;
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
    replacedReplicaRef?: HostedBrowserVaultReplicaRef | null;
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
  card?: AssistantResponseCard | null;
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  homeRouteFallbackAllowed?: boolean | null;
  idempotencyKey?: string | null;
  media?: readonly AssistantResponseMedia[] | null;
  message: string;
  nativeReplyRequested?: true;
  replyToMessageId?: string | null;
  target: string;
  targetKind?: HostedRuntimeProviderTargetKind | null;
  threadIsDirect?: boolean | null;
}

export interface HostedRuntimeLinqSendResponse {
  idempotencyKey?: string | null;
  providerMessageId?: string | null;
  providerMessageIds?: string[] | null;
  providerThreadId?: string | null;
  target?: string | null;
  targetKind?: HostedRuntimeProviderTargetKind | null;
}

export interface HostedRuntimeLinqRecentInboundEngagementRequest {
  answeredMailboxItemIds?: readonly string[] | null;
  assistantAskCompletionExpiresAt?: string | null;
  assistantAskFallback?: boolean | null;
  authorityCheckOnly: boolean;
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  homeRouteFallbackAllowed?: boolean | null;
  idempotencyKey?: string | null;
  intentId?: string | null;
  expectedResolvedRoute?: HostedExecutionResolvedLinqDeliveryRoute | null;
  replyToMessageId?: string | null;
  target: string | null;
  targetKind?: HostedRuntimeProviderTargetKind | null;
}

export interface HostedRuntimeLinqRecentInboundEngagementResult {
  assistantAskFallbackRequired?: boolean | null;
  deliveryBlockCode?: HostedRuntimeLinqDeliveryBlockCode | null;
  deliveryPosture?: HostedRuntimeLinqDeliveryPosture | null;
  providerDispatchClaimed?: boolean | null;
  resolvedRoute?: HostedExecutionResolvedLinqDeliveryRoute | null;
}

export interface HostedRuntimeAssistantAskCompletionAuthority {
  answeredMailboxItemIds: readonly string[];
  assistantAskCompletionExpiresAt: string;
  assistantAskFallback: boolean;
  idempotencyKey: string;
}

export type HostedRuntimeAssistantAskPrivateCompletionAuthority =
  HostedExecutionPrivateAssistantAskCompletionDeliveryAuthority;

export interface HostedRuntimeExternalThreadRouteAuthorityResult {
  assistantAskFallbackRequired?: boolean | null;
}

export interface HostedRuntimeLinqDeliveryOutcomeRequest {
  acceptedAt?: string | null;
  answeredMailboxItemIds?: readonly string[] | null;
  attemptedAt: string;
  directRecipientPhoneNumber?: string | null;
  failedAt?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  intentId?: string | null;
  lineLookupKey?: string | null;
  providerMessageId?: string | null;
  providerMessageIds?: string[] | null;
  providerTarget?: string | null;
  providerThreadId?: string | null;
  target: string | null;
  targetKind?: HostedRuntimeProviderTargetKind | null;
  threadIsDirect?: boolean | null;
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
  deleteEnvironmentVoice?(audioKey: string): Promise<void>;
  readEnvironmentVoice?(audioKey: string): Promise<Uint8Array | null>;
  deleteMealPhoto?(mealPhotoKey: string): Promise<void>;
  readMealPhoto?(mealPhotoKey: string): Promise<Uint8Array | null>;
  readRawEmailMessage(rawMessageKey: string): Promise<Uint8Array | null>;
  readAssistantDeliveryRecord?(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<HostedAssistantDeliveryRecord | null>;
  assertLinqRecentInboundEngagement?(
    request: HostedRuntimeLinqRecentInboundEngagementRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedRuntimeLinqRecentInboundEngagementResult | void>;
  assertExternalThreadRouteAuthority?(
    authority: HostedExecutionExternalThreadRouteAuthority,
    context?: {
      assistantAskCompletion?: HostedRuntimeAssistantAskCompletionAuthority | null;
      signal?: AbortSignal | null;
    },
  ): Promise<HostedRuntimeExternalThreadRouteAuthorityResult | void>;
  assertAssistantAskPrivateCompletionAuthority?(
    authority: HostedRuntimeAssistantAskPrivateCompletionAuthority,
    context?: { signal?: AbortSignal | null },
  ): Promise<void>;
  resolveCurrentVerifiedEmailRecipient?(
    context?: { signal?: AbortSignal | null },
  ): Promise<string | null>;
  recordLinqDeliveryOutcome?(
    request: HostedRuntimeLinqDeliveryOutcomeRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<void>;
  sendEmail(request: HostedEmailSendRequest): Promise<HostedEmailSendResult | void>;
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
  reconcileAccount?(input: {
    connectionId: string;
    signal?: AbortSignal | null;
  }): Promise<HostedExecutionDeviceSyncReconcileResponse>;
  fetchSnapshot(input?: {
    connectionId?: string | null;
    includeCredentialMaterial?: boolean | null;
    limit?: number | null;
    provider?: string | null;
    signal?: AbortSignal | null;
    sourceProviderSlug?: string | null;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  fetchDirtyStates(input?: Omit<HostedExecutionDeviceSyncDirtyPendingRequest, "userId"> & {
    signal?: AbortSignal | null;
  }): Promise<HostedExecutionDeviceSyncDirtyPendingResponse>;
  ackDirtyStateProcessed(
    input: Omit<HostedExecutionDeviceSyncDirtyAckRequest, "userId"> & {
      signal?: AbortSignal | null;
    },
  ): Promise<HostedExecutionDeviceSyncDirtyAckResponse>;
}

export interface HostedRuntimeClinicalRecordsPort {
  createConnectLink?(
    options?: HostedClinicalRecordsConnectLinkRequest & {
      signal?: AbortSignal | null
    },
  ): Promise<HostedClinicalRecordsConnectLinkResponse>;
  fetchPage(
    request: HostedClinicalRecordsFetchPageRequest,
    options?: { signal?: AbortSignal | null },
  ): Promise<HostedClinicalRecordsFetchPageResponse>;
  readRun(
    request: HostedClinicalRecordsReadRunRequest,
    options?: { signal?: AbortSignal | null },
  ): Promise<HostedClinicalRecordsReadRunResponse>;
  recordOutcome(
    request: HostedClinicalRecordsRecordOutcomeRequest,
    options?: { signal?: AbortSignal | null },
  ): Promise<void>;
}

export interface HostedRuntimeUsageRecordPort {
  recordUsage(
    record: AssistantUsageRecord,
    noticeDeliveryTarget?: HostedRuntimeUsageNoticeDeliveryTarget | null,
  ): Promise<HostedRuntimeUsageRecordResponse>;
}

export interface HostedRuntimeIssueExportPort {
  recordIssues(issues: readonly object[]): Promise<HostedRuntimeIssueRecordResponse>;
}

export interface HostedRuntimeProductFeedbackPort {
  recordProductFeedback(
    feedback: HostedRuntimeProductFeedbackRecord,
  ): Promise<HostedRuntimeProductFeedbackRecordResponse>;
}

export interface HostedRuntimeFamilyPlanToolPort {
  request(
    request: HostedRuntimeFamilyPlanToolRequest,
  ): Promise<HostedRuntimeFamilyPlanToolResponse>;
}

export interface HostedRuntimePlanUsageToolPort {
  read(request: HostedPlanUsageToolRequest): Promise<HostedPlanUsageStatus>;
}

export interface HostedRuntimeIMessageContactToolPort {
  ensure(
    request: HostedRuntimeIMessageContactToolRequest,
  ): Promise<HostedRuntimeIMessageContactToolResponse>;
}

export interface HostedRuntimeLabsToolPort {
  request(
    request: HostedRuntimeLabsToolRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedRuntimeLabsToolResponse>;
}

export interface HostedRuntimeSubscriptionToolPort {
  request(
    request: HostedRuntimeSubscriptionControlRequest,
  ): Promise<HostedRuntimeSubscriptionToolResponse>;
}

export interface HostedRuntimeAssistantPersonalizationToolPort {
  request(
    request: HostedRuntimeAssistantPersonalizationToolRequest,
    authority?: HostedRuntimeAssistantPersonalizationToolAuthority,
  ): Promise<HostedRuntimeAssistantPersonalizationToolResponse>;
}

export interface HostedRuntimeGroupToolPort {
  request(
    request: HostedRuntimeGroupToolRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedRuntimeGroupToolResponse>;
  /**
   * Trusted-host direct-attachment route eligibility for the current turn.
   * Only the turn-context wrapper knows the resolved route, so ports that are
   * not route-aware omit this and leave post-generation binding as the gate.
   */
  directAttachmentRouteStatus?():
    | { status: "ok" }
    | { status: "unavailable"; unavailableReason: string };
}

export interface HostedRuntimeCodexAuthPort {
  update(update: HostedCodexAuthUpdate): Promise<HostedCodexAuthUpdateResponse>;
}

export interface HostedRuntimePhoneCallPort {
  start(
    request: HostedPhoneCallStartRequest,
    context?: {
      signal?: AbortSignal | null;
    },
  ): Promise<HostedPhoneCallStartResponse>;
}

export interface HostedRuntimePhysicalNotePort {
  send(
    request: HostedPhysicalNoteSendRequest,
    context?: {
      signal?: AbortSignal | null;
    },
  ): Promise<HostedPhysicalNoteSendResponse>;
}

export interface HostedRuntimeMailboxPort {
  fetch(
    request: HostedMailboxFetchRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedMailboxFetchResponse>;
  fetchPayload(
    request: HostedMailboxPayloadFetchRequest,
  ): Promise<HostedMailboxPayloadFetchResponse>;
}

export interface HostedRuntimeWorkspacePort {
  read?(context?: { signal?: AbortSignal | null }): Promise<HostedWorkspaceReadResponse>;
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
  objectFetchResponseHeadersMs?: number;
  objectFetchBodyReadMs?: number;
  decryptMs?: number;
  archiveExtractMs?: number;
  durableRootReplaceMs?: number;
  cleanupMs?: number;
  extractMs?: number;
  encryptedBytes?: number;
  plainBytes?: number;
  replaySafeReadMaxAttempt?: number;
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
    signal?: AbortSignal | null;
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
    signal?: AbortSignal | null;
  }): Promise<HostedRuntimeWorkspaceSnapshotSessionStart>;
}

export interface HostedRuntimeLogPort {
  write(
    request: HostedRuntimeLogRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedRuntimeLogResponse>;
}

export interface HostedRuntimeLatencyTracePort {
  record(request: HostedRuntimeLatencyTraceRequest): Promise<HostedRuntimeLatencyTraceResponse>;
}

export interface HostedRuntimeActionApprovalPort {
  consume(
    input: HostedActionApprovalConsumeRequest,
  ): Promise<HostedActionApprovalResult>;
  read(
    input: HostedActionApprovalRequest,
  ): Promise<HostedActionApprovalObservation>;
  request(
    input: HostedActionApprovalRequest,
  ): Promise<HostedActionApprovalResult>;
}

export interface HostedRuntimeVaultSharePort {
  listActiveProjectionScopes(): Promise<HostedVaultShareProjectionScope[]>;
  deliver(
    request: HostedVaultShareDeliverRequest,
  ): Promise<HostedVaultShareDeliverResponse>;
}

export interface HostedRuntimePlatform {
  actionApprovalPort?: HostedRuntimeActionApprovalPort | null;
  assistantAskPort?: HostedRuntimeAssistantAskPort | null;
  assistantPersonalizationToolPort?: HostedRuntimeAssistantPersonalizationToolPort | null;
  assistantConfigurationToolPort?: HostedRuntimeAssistantConfigurationToolPort | null;
  artifactStore: HostedRuntimeArtifactStore;
  browserVaultReplicaPort?: HostedRuntimeBrowserVaultReplicaPort | null;
  codexAuthPort?: HostedRuntimeCodexAuthPort | null;
  clinicalRecordsPort?: HostedRuntimeClinicalRecordsPort | null;
  connectedApps?: AssistantConnectedAppsPort | null;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  effectsPort: HostedRuntimeEffectsPort;
  familyPlanToolPort?: HostedRuntimeFamilyPlanToolPort | null;
  groupToolPort?: HostedRuntimeGroupToolPort | null;
  providerFetch?: typeof fetch | null;
  publicInternetFetch?: typeof fetch | null;
  issueExportPort?: HostedRuntimeIssueExportPort | null;
  imessageContactToolPort?: HostedRuntimeIMessageContactToolPort | null;
  latencyTracePort?: HostedRuntimeLatencyTracePort | null;
  labsToolPort?: HostedRuntimeLabsToolPort | null;
  logPort?: HostedRuntimeLogPort | null;
  mailboxPort?: HostedRuntimeMailboxPort | null;
  planUsageToolPort?: HostedRuntimePlanUsageToolPort | null;
  physicalNotes?: HostedRuntimePhysicalNotePort | null;
  privateImageUrlPublisher?: AssistantHostedPrivateImageUrlPublisher | null;
  subscriptionToolPort?: HostedRuntimeSubscriptionToolPort | null;
  phoneCalls?: HostedRuntimePhoneCallPort | null;
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
