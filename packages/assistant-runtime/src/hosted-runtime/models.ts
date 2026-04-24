import type {
  ImportSharePackIntoVaultResult,
  VaultSyncImportMergeResult,
} from "@murphai/core";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import type {
  ConfiguredDeviceSyncRuntimeConfig,
} from "@murphai/device-syncd/runtime-config";
import type {
  HostedIngressEnvelope,
  HostedExecutionRedactedLogEntry,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
  HostedRunCleanupTarget,
  HostedRunEventResult,
  HostedRuntimeDrainRequest,
} from "@murphai/hosted-execution";
import type {
  HostedAssistantDeliveryEffect,
} from "@murphai/hosted-execution/side-effects";

import type {
  HostedRuntimePlatform,
} from "./platform.ts";
import type { BrowserVaultReplica } from "@murphai/query/browser";

export interface HostedAssistantRuntimeChannelCapabilities {
  emailSendReady: boolean;
  telegramBotConfigured: boolean;
}

export interface HostedAssistantRuntimeManagedAutoReplyChannel {
  capabilityReady: boolean;
  channel: string;
  memberChannel?: string | null;
}

export type HostedAssistantRuntimeDeviceSyncConfig = ConfiguredDeviceSyncRuntimeConfig;

export interface HostedAssistantRuntimeResolvedConfig {
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities;
  deviceSync: HostedAssistantRuntimeDeviceSyncConfig | null;
  managedAutoReplyChannels?: HostedAssistantRuntimeManagedAutoReplyChannel[];
}

export interface HostedAssistantRuntimeConfig {
  commitTimeoutMs?: number | null;
  forwardedEnv?: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  userEnv?: Readonly<Record<string, string>>;
}

export interface HostedAssistantRuntimeJobRequest
  extends Omit<HostedExecutionRunnerRequest, "runDrain"> {
  runDrain: HostedRuntimeDrainRequest;
  runToken?: string | null;
}

export interface HostedAssistantRuntimeJobInput {
  request: HostedAssistantRuntimeJobRequest;
  runtime?: HostedAssistantRuntimeConfig;
}

export interface HostedBootstrapResult {
  assistantConfigStatus:
    | "hosted-env"
    | "invalid"
    | "missing"
    | "saved"
    | "unready";
  assistantConfigured: boolean;
  assistantProvider: "openai-compatible" | null;
  assistantSeeded: boolean;
  emailAutoReplyEnabled: boolean;
  linqAutoReplyEnabled: boolean;
  telegramAutoReplyEnabled: boolean;
  vaultCreated: boolean;
}

export interface NormalizedHostedAssistantRuntimeConfig {
  commitTimeoutMs: number | null;
  forwardedEnv: Record<string, string>;
  platform: HostedRuntimePlatform;
  platformEnv: Record<string, string>;
  resolvedConfig: HostedAssistantRuntimeResolvedConfig;
  userEnv: Record<string, string>;
}

export interface HostedCommittedExecutionState {
  committedGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  committedAssistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  committedResult: HostedExecutionRunnerResult;
}

export interface HostedRunDrainMetrics {
  adoptedCleanupTargets: HostedRunCleanupTarget[];
  adoptedEventResults: HostedRunEventResult[];
  bootstrapResult: HostedBootstrapResult | null;
  deviceSyncProcessed: number;
  deviceSyncSkipped: boolean;
  eventsHandled: number;
  nextWakeAt: string | null;
  parserProcessed: number;
  redactedLogEntries: HostedExecutionRedactedLogEntry[];
  shareImportResult: HostedShareImportResult | null;
  shareImportTitle: string | null;
  vaultSyncImportResults: HostedVaultSyncImportResult[];
}

export type HostedAssistantDeliveryOutcomeStatus =
  | "abandoned"
  | "failed"
  | "failed_ambiguous"
  | "missing-result"
  | "pending"
  | "retryable"
  | "sending"
  | "sent"
  | "threw";

export interface HostedAssistantDeliveryOutcome {
  deliveryChannel: string | null;
  deliveryErrorCode: string | null;
  deliveryErrorMessage: string | null;
  deliveryStatus: HostedAssistantDeliveryOutcomeStatus;
  effectFingerprint: string;
  effectId: string;
  journalMethod: "DELETE" | "GET" | "PUT" | null;
  journalStatus: string | null;
  cleanupMessages?: Array<{ messageId: string; target: string }>;
  cleanupTargetAliases?: string[];
  providerMessageId: string | null;
  providerMessageIds?: string[];
  providerThreadId: string | null;
  retryable: boolean;
  target: string | null;
  targetKind: string | null;
}

export interface HostedAssistantRuntimePreparedJobResult {
  committedAssistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  committedGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  finalGatewayProjectionSnapshot?: null;
  phase: "prepared";
  result: HostedExecutionRunnerResult;
}

export interface HostedAssistantRuntimeCompletedJobResult {
  assistantDeliveryOutcomes?: HostedAssistantDeliveryOutcome[];
  browserVaultReplica?: BrowserVaultReplica | null;
  finalGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  phase?: "completed";
  result: HostedExecutionRunnerResult;
}

export type HostedAssistantRuntimeJobResult =
  | HostedAssistantRuntimePreparedJobResult
  | HostedAssistantRuntimeCompletedJobResult;

export type HostedShareImportResult = ImportSharePackIntoVaultResult;
export type HostedVaultSyncImportResult = VaultSyncImportMergeResult;

export interface HostedIngressEffect {
  adoptedCleanupTargets?: HostedRunCleanupTarget[] | null;
  adoptedEventResults?: HostedRunEventResult[] | null;
  conversationMetrics: HostedConversationWakeMetrics | null;
  redactedLogEntries?: HostedExecutionRedactedLogEntry[] | null;
  shareImportResult: HostedShareImportResult | null;
  shareImportTitle: string | null;
  vaultSyncImportResult: HostedVaultSyncImportResult | null;
}

export interface HostedConversationWakeMetrics {
  nextWakeAt: string | null;
  parserProcessed: number;
}

export type HostedIngressLane =
  | "assistant-notification"
  | "conversation-message"
  | "device-sync"
  | "member-activated"
  | "member-channels-updated"
  | "vault-share-accepted"
  | "vault-sync-import";

export interface HostedIngressExecutionMetrics extends HostedIngressEffect {
  bootstrapResult: HostedBootstrapResult | null;
  ingressLane: HostedIngressLane;
}

export interface HostedMaintenanceMetrics {
  adoptedCleanupTargets?: HostedRunCleanupTarget[] | null;
  adoptedEventResults?: HostedRunEventResult[] | null;
  deviceSyncProcessed: number;
  deviceSyncSkipped: boolean;
  nextWakeAt: string | null;
  parserProcessed: number;
}

export type HostedWorkspaceArtifactMaterializer = (
  relativePaths: readonly string[],
) => Promise<void>;

export interface HostedRestoredExecutionContext {
  assistantStateRoot: string;
  operatorHomeRoot: string;
  vaultRoot: string;
}
