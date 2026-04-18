import { importSharePackIntoVault } from "@murphai/core";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import type {
  ConfiguredDeviceSyncRuntimeConfig,
} from "@murphai/device-syncd/config";
import type {
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
  HostedExecutionWake,
} from "@murphai/hosted-execution";
import type { HostedExecutionBundleRefState } from "@murphai/hosted-execution/bundles";
import type {
  HostedAssistantDeliveryEffect,
} from "@murphai/hosted-execution/side-effects";

import type {
  HostedRuntimePlatform,
} from "./platform.ts";
import type { BrowserVaultSnapshot } from "@murphai/query";

export interface HostedAssistantRuntimeChannelCapabilities {
  emailSendReady: boolean;
  telegramBotConfigured: boolean;
}

export type HostedAssistantRuntimeDeviceSyncConfig = ConfiguredDeviceSyncRuntimeConfig;

export interface HostedAssistantRuntimeResolvedConfig {
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities;
  deviceSync: HostedAssistantRuntimeDeviceSyncConfig | null;
}

export interface HostedAssistantRuntimeConfig {
  commitTimeoutMs?: number | null;
  forwardedEnv?: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  userEnv?: Readonly<Record<string, string>>;
}

export interface HostedAssistantRuntimeJobRequest
  extends HostedExecutionRunnerRequest {
  currentBundleRef?: HostedExecutionBundleRefState;
  resume?: {
    committedResult: {
      assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
      result: HostedExecutionRunnerResult["result"];
    };
  } | null;
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
  resolvedConfig: HostedAssistantRuntimeResolvedConfig;
  userEnv: Record<string, string>;
}

export interface HostedCommittedExecutionState {
  committedGatewayProjectionSnapshot: GatewayProjectionSnapshot;
  committedAssistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  committedResult: HostedExecutionRunnerResult;
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
  providerMessageId: string | null;
  providerThreadId: string | null;
  retryable: boolean;
  target: string | null;
  targetKind: string | null;
}

export interface HostedAssistantRuntimeCommittedJobResult {
  committedAssistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  committedGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  finalGatewayProjectionSnapshot?: null;
  phase: "committed";
  result: HostedExecutionRunnerResult;
}

export interface HostedAssistantRuntimeCompletedJobResult {
  assistantDeliveryOutcomes?: HostedAssistantDeliveryOutcome[];
  browserVaultSnapshot?: BrowserVaultSnapshot | null;
  committedAssistantDeliveryEffects?: HostedAssistantDeliveryEffect[];
  committedGatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
  finalGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  phase?: "completed";
  result: HostedExecutionRunnerResult;
}

export type HostedAssistantRuntimeJobResult =
  | HostedAssistantRuntimeCommittedJobResult
  | HostedAssistantRuntimeCompletedJobResult;

export type HostedShareImportResult = Awaited<ReturnType<typeof importSharePackIntoVault>>;

export interface HostedWakeEffect {
  shareImportResult: HostedShareImportResult | null;
  shareImportTitle: string | null;
}

export type HostedWakeFollowupExecution =
  | "conversation-message"
  | "system-maintenance";

export interface HostedWakeExecutionMetrics extends HostedWakeEffect {
  bootstrapResult: HostedBootstrapResult | null;
  followupExecution: HostedWakeFollowupExecution;
}

export interface HostedMaintenanceMetrics {
  deviceSyncProcessed: number;
  deviceSyncSkipped: boolean;
  nextWakeAt: string | null;
  parserProcessed: number;
}

export type HostedWorkspaceArtifactMaterializer = (
  relativePaths: readonly string[],
) => Promise<void>;

export type HostedWakeEvent = HostedExecutionWake;
export interface HostedRestoredExecutionContext {
  assistantStateRoot: string;
  operatorHomeRoot: string;
  vaultRoot: string;
}
