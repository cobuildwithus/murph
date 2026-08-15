import type {
  HostedRuntimeLatencyPhaseBreakdown,
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  CloudflareHostedControlRuntimeShellPrewarmSource,
} from "@murphai/cloudflare-hosted-control/client";
import type {
  HostedCryptoDomain,
} from "@murphai/runtime-state";

import { readHostedExecutionEnvironment } from "../env.ts";
import { readRequestBodyText } from "../json.ts";
import type {
  HostedRunnerUserDataDeletionResult,
  HostedRuntimeHealthDataConsentReconcileResult,
} from "../user-runner.js";
import type { HostedExecutionContainerNamespaceLike } from "../runner-container.js";
import type {
  HostedWorkspaceSnapshotOrphanCandidate,
  HostedWorkspaceSnapshotUploadSession,
} from "../workspace-snapshot-store.ts";
import {
  requireHostedUserCryptoContextFromEnvironment,
} from "../hosted-crypto/runtime-user-crypto-context.ts";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerStubLike,
} from "../worker-contracts.ts";
import type {
  HostedPrivateMediaPublishInput,
  HostedPrivateMediaPublishResult,
} from "../private-media.ts";

export interface UserRunnerDurableObjectStubLike extends WorkerUserRunnerStubLike {
  bindUser(userId: string): Promise<{ userId: string }>;
  deleteHostedUserData(userId: string): Promise<HostedRunnerUserDataDeletionResult>;
  reconcileRuntimeHealthDataConsentForUser?(
    userId: string,
  ): Promise<HostedRuntimeHealthDataConsentReconcileResult>;
  publishHostedPrivateMedia(
    input: HostedPrivateMediaPublishInput,
  ): Promise<HostedPrivateMediaPublishResult>;
  ensureRuntimeProcessingForUser(
    input: HostedRuntimeEnsureProcessingRequest & {
      commandStartedAtEpochMs?: number;
      commandTimeoutMs?: number;
      orchestration?: NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]> | null;
      userId: string;
    },
  ): Promise<HostedRuntimeEnsureProcessingResponse>;
  prewarmRuntimeShellForUser?(
    userId: string,
    source?: CloudflareHostedControlRuntimeShellPrewarmSource,
  ): Promise<void>;
  validateRuntimeWriteFence?(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<boolean>;
  createHostedWorkspaceSnapshotUploadSession?(
    input: HostedWorkspaceSnapshotUploadSession,
  ): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  heartbeatHostedWorkspaceSnapshotUploadSession?(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean>;
  completeHostedWorkspaceSnapshotUploadSession?(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean>;
  rememberHostedWorkspaceSnapshotReplacedRef?(input: {
    expectedSession: HostedWorkspaceSnapshotUploadSession;
    replacedSnapshotRef: NonNullable<HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"]>;
  }): Promise<boolean>;
  deleteHostedWorkspaceSnapshotUploadSession?(input: {
    snapshotId: string;
    userId: string;
  }): Promise<{ deleted: boolean }>;
  readHostedWorkspaceSnapshotUploadSession?(input: {
    snapshotId: string;
    userId: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  recordHostedWorkspaceSnapshotOrphanCandidate?(
    input: HostedWorkspaceSnapshotOrphanCandidate,
  ): Promise<HostedWorkspaceSnapshotOrphanCandidate>;
  runnerStatus(input?: { logLimit?: number }): Promise<HostedRunnerStatusResponse>;
}

export interface WorkerEnvironmentSource
  extends WorkerEnvironmentContract<UserRunnerDurableObjectStubLike> {
  RUNNER_CONTAINER: HostedExecutionContainerNamespaceLike;
  RUNNER_CONTAINER_SMOKE: HostedExecutionContainerNamespaceLike;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface WorkerRouteContext {
  env: WorkerEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  executionCtx?: WorkerExecutionContext;
  request: Request;
  requestText?: Promise<string>;
  runtimeControlAuthTiming?: {
    runtimeControlAuthFinishedAtEpochMs: number;
    runtimeControlAuthStartedAtEpochMs: number;
  };
  url: URL;
}

export async function resolveUserRunnerStub(
  env: WorkerEnvironmentSource,
  userId: string,
): Promise<UserRunnerDurableObjectStubLike> {
  const stub = env.USER_RUNNER.getByName(userId);
  await stub.bindUser(userId);
  return stub;
}

export async function resolveHostedExecutionUserCryptoContext(input: {
  bucket: WorkerEnvironmentSource["BUNDLES"];
  domain: Extract<HostedCryptoDomain, "ingress" | "runtime">;
  environment: WorkerRouteContext["environment"];
  userId: string;
}) {
  return requireHostedUserCryptoContextFromEnvironment({
    bucket: input.bucket,
    domain: input.domain,
    environment: input.environment,
    reason: "worker-route-access",
    userId: input.userId,
  });
}

export function decodeRouteParam(value: string): string {
  return decodeURIComponent(value);
}

export async function readCachedRequestText(
  context: Pick<WorkerRouteContext, "request" | "requestText">,
  options: {
    limitBytes?: number;
  } = {},
): Promise<string> {
  context.requestText ??= readRequestBodyText(context.request, {
    limitBytes: options.limitBytes,
  });
  return context.requestText;
}
