import { importSharePackIntoVault } from "@murphai/core";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  restoreHostedExecutionContext,
} from "@murphai/runtime-state/node";
import type {
  HostedExecutionBundleRefState,
  HostedExecutionDispatchRequest,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
  HostedExecutionSideEffect,
  HostedExecutionWebControlPlaneEnvironment,
} from "@murphai/hosted-execution";

export interface HostedExecutionCommitCallback {
  bundleRef: HostedExecutionBundleRefState;
}

export interface HostedAssistantRuntimeConfig {
  commitTimeoutMs?: number | null;
  internalWorkerProxyToken?: string | null;
  forwardedEnv?: Readonly<Record<string, string>>;
  userEnv?: Readonly<Record<string, string>>;
}

export interface HostedAssistantRuntimeJobRequest extends HostedExecutionRunnerRequest {
  commit?: HostedExecutionCommitCallback | null;
  resume?: {
    committedResult: {
      result: HostedExecutionRunnerResult["result"];
      sideEffects: HostedExecutionSideEffect[];
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
  artifactsBaseUrl: string;
  commitBaseUrl: string;
  commitTimeoutMs: number | null;
  emailBaseUrl: string;
  internalWorkerProxyToken: string | null;
  forwardedEnv: Record<string, string>;
  sideEffectsBaseUrl: string;
  userEnv: Record<string, string>;
  webControlPlane: HostedExecutionWebControlPlaneEnvironment;
}

export interface HostedCommittedExecutionState {
  committedGatewayProjectionSnapshot: GatewayProjectionSnapshot;
  committedResult: HostedExecutionRunnerResult;
  committedSideEffects: HostedExecutionSideEffect[];
}

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
