import type {
  ConfiguredDeviceSyncRuntimeConfig,
} from "@murphai/device-syncd/runtime-config";
import type {
  HostedExecutionWake,
  HostedExecutionRedactedLogEntry,
} from "@murphai/hosted-execution";
import type {
  HostedWorkspaceInvocationRequest,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimePlatform,
} from "./platform.ts";

export interface HostedAssistantRuntimeChannelCapabilities {
  emailSendReady: boolean;
  telegramBotConfigured: boolean;
  whatsappCloudApiConfigured?: boolean;
}

export interface HostedAssistantRuntimeManagedAutoReplyChannel {
  capabilityReady: boolean;
  channel: string;
  memberChannel?: string | null;
}

export type HostedAssistantRuntimeParserToolName =
  | "ffmpeg"
  | "pdfinfo"
  | "pdftotext"
  | "whisper";

export interface HostedAssistantRuntimeParserToolConfig {
  command?: string;
  modelPath?: string;
}

export interface HostedAssistantRuntimeParserToolchainConfig {
  tools: Partial<
    Record<HostedAssistantRuntimeParserToolName, HostedAssistantRuntimeParserToolConfig>
  >;
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
  parserToolchain?: HostedAssistantRuntimeParserToolchainConfig;
  platformEnv?: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  userEnv?: Readonly<Record<string, string>>;
}

export interface HostedAssistantWorkspaceRuntimeJobInput {
  request: HostedWorkspaceInvocationRequest;
  runtime?: HostedAssistantRuntimeConfig;
}

export type HostedAssistantWorkspaceRuntimeJobResult = HostedWorkspaceInvocationResult;

export interface HostedBootstrapResult {
  assistantConfigStatus:
    | "hosted-env"
    | "invalid"
    | "missing"
    | "saved"
    | "unready";
  assistantConfigured: boolean;
  assistantProvider: "codex-cli" | null;
  assistantSeeded: boolean;
  emailAutoReplyEnabled: boolean;
  linqAutoReplyEnabled: boolean;
  telegramAutoReplyEnabled: boolean;
  vaultCreated: boolean;
}

export interface NormalizedHostedAssistantRuntimeConfig {
  commitTimeoutMs: number | null;
  forwardedEnv: Record<string, string>;
  parserToolchain: HostedAssistantRuntimeParserToolchainConfig | null;
  platform: HostedRuntimePlatform;
  platformEnv: Record<string, string>;
  resolvedConfig: HostedAssistantRuntimeResolvedConfig;
  userEnv: Record<string, string>;
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

export interface HostedMailboxEffect {
  conversationMetrics: HostedConversationWakeMetrics | null;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  postCheckpointRecord?: HostedSystemMailboxPostCheckpointRecord | null;
  redactedLogEntries?: HostedExecutionRedactedLogEntry[] | null;
}

export interface HostedDeviceSyncDirtyProcessedPostCheckpointRecord {
  connectionId: string;
  nextWakeAt?: string | null;
  processedDirtyPayloadIds?: string[];
  processedRevision: string;
}

export type HostedSystemMailboxPostCheckpointRecord =
  | (HostedDeviceSyncDirtyProcessedPostCheckpointRecord & {
      kind: "device-sync.dirty-processed";
    })
  | {
      kind: "device-sync.dirty-processed-batch";
      nextWakeAt?: string | null;
      records: HostedDeviceSyncDirtyProcessedPostCheckpointRecord[];
    };

export interface HostedConversationWakeMetrics {
  nextWakeAt: string | null;
  parserProcessed: number;
}

export type HostedMailboxLane =
  | "assistant-notification"
  | "conversation-message"
  | "device-sync"
  | "member-activated"
  | "member-channels-updated"
  | "runtime-control";

export interface HostedMailboxExecutionMetrics extends HostedMailboxEffect {
  bootstrapResult: HostedBootstrapResult | null;
  mailboxLane: HostedMailboxLane;
}

export interface HostedMaintenanceMetrics {
  activeTurnInputIngested?: boolean | null;
  assistantAutomationAfterStateElapsedMs?: number | null;
  assistantAutomationBeforeStateElapsedMs?: number | null;
  assistantAutomationCurrentTurnDeliveryIntentIds?: string[] | null;
  assistantAutomationElapsedMs?: number | null;
  assistantAutomationPassElapsedMs?: number | null;
  assistantAutomationProgressed?: boolean | null;
  assistantAutomationTotalElapsedMs?: number | null;
  assistantInputCandidateListed?: boolean | null;
  assistantInputCandidateQueryCount?: number | null;
  deviceSyncElapsedMs?: number | null;
  deviceSyncProcessed: number;
  deviceSyncSkipped: boolean;
  nextWakeAt: string | null;
  nextWakeReason?: string | null;
  parserProcessed: number;
  postCheckpointRecord?: HostedSystemMailboxPostCheckpointRecord | null;
  readinessElapsedMs?: number | null;
  redactedLogEntries?: HostedExecutionRedactedLogEntry[] | null;
  stagedDirtyAcks?: HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
  totalElapsedMs?: number | null;
}

export type HostedAssistantAutomationLaneMetrics = Omit<
  HostedMaintenanceMetrics,
  | "deviceSyncElapsedMs"
  | "deviceSyncProcessed"
  | "deviceSyncSkipped"
  | "parserProcessed"
  | "postCheckpointRecord"
  | "stagedDirtyAcks"
>;

export interface HostedWorkspaceArtifactMaterializationResult {
  materializedArtifactPaths: ReadonlySet<string>;
  missingArtifactPaths: ReadonlySet<string>;
}

export type HostedWorkspaceArtifactMaterializer = (
  relativePaths: readonly string[],
) => Promise<HostedWorkspaceArtifactMaterializationResult>;

export interface HostedRestoredExecutionContext {
  assistantStateRoot: string;
  operatorHomeRoot: string;
  vaultRoot: string;
}
