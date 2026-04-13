import { importSharePackIntoVault } from "@murphai/core";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  restoreHostedExecutionContext,
} from "@murphai/runtime-state/node";
import type {
  ConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
} from "@murphai/hosted-execution/contracts";
import type { HostedExecutionBundleRefState } from "@murphai/hosted-execution/bundles";
import type {
  HostedAssistantDeliveryEffect,
} from "@murphai/hosted-execution/side-effects";

import type {
  HostedRuntimePlatform,
} from "./platform.ts";

export interface HostedAssistantRuntimeChannelCapabilities {
  emailSendReady: boolean;
  telegramBotConfigured: boolean;
}

export interface HostedAssistantRuntimeDeviceSyncConfig {
  providerConfigs: ConfiguredDeviceSyncProviderConfigs;
  publicBaseUrl: string;
  secret: string;
}

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

export interface HostedAssistantRuntimeJobRequest extends HostedExecutionRunnerRequest {
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

export interface HostedAssistantRuntimeCommittedJobResult {
  committedAssistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  committedGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  finalGatewayProjectionSnapshot?: null;
  phase: "committed";
  result: HostedExecutionRunnerResult;
}

export interface HostedAssistantRuntimeCompletedJobResult {
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

export interface HostedDispatchEffect {
  shareImportResult: HostedShareImportResult | null;
  shareImportTitle: string | null;
}

export interface HostedDispatchExecutionMetrics extends HostedDispatchEffect {
  bootstrapResult: HostedBootstrapResult | null;
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

export type HostedDispatchEvent = HostedExecutionDispatchRequest["event"];
export type HostedRestoredExecutionContext = Awaited<ReturnType<typeof restoreHostedExecutionContext>>;
