import type {
  HostedRunnerNudgeRequest,
  HostedRunnerNudgeResult,
  HostedRunnerStatusResponse,
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import type { RuntimeLivenessInstruction } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type {
  HostedCryptoDomain,
} from "@murphai/runtime-state";

import { readHostedExecutionEnvironment } from "../env.ts";
import { readRequestBodyText } from "../json.ts";
import type { HostedRunnerUserDataDeletionResult } from "../user-runner.js";
import type { HostedRunnerStuckInvocationTestResult } from "../user-runner.js";
import type { HostedExecutionContainerNamespaceLike } from "../runner-container.js";
import {
  requireHostedUserCryptoContextFromEnvironment,
} from "../hosted-crypto/runtime-user-crypto-context.ts";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerStubLike,
} from "../worker-contracts.ts";

export interface UserRunnerDurableObjectStubLike extends WorkerUserRunnerStubLike {
  bindUser(userId: string): Promise<{ userId: string }>;
  deleteHostedUserData(userId: string): Promise<HostedRunnerUserDataDeletionResult>;
  nudgeHostedRunner(input?: HostedRunnerNudgeRequest): Promise<HostedRunnerNudgeResult>;
  nudgeHostedRunnerForUser(
    userId: string,
    input?: HostedRunnerNudgeRequest,
  ): Promise<HostedRunnerNudgeResult>;
  scheduleBrowserVaultRefreshForUser?(input: { userId: string }): Promise<unknown>;
  /**
   * @deprecated Compatibility-only Durable Object method for deploy skew.
   * Deletion target: 2026-05-23.
   */
  scheduleDashboardReplicaRefreshForUser?(input: { userId: string }): Promise<unknown>;
  ownsActiveInvocationLease(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean>;
  recordActiveInvocationHeartbeat(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<
    | {
      instruction: RuntimeLivenessInstruction;
      inputAvailable?: boolean;
      nextAlarmAt?: string | null;
      ok: true;
      pendingNudge?: boolean;
    }
    | {
      ok: false;
      reason:
        | "no_active_invocation"
        | "stale_attempt"
        | "stale_generation"
        | "wrong_user";
    }
  >;
  recordActiveInvocationWorkspaceCheckpoint(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }>;
  runUntilIdleOrBudget(input: { reason: HostedWorkspaceInvocationReason }): Promise<HostedWorkspaceInvocationResult>;
  runAlarmForTest(input: { userId: string }): Promise<{ ok: true }>;
  startStuckInvocationForTest?(input: {
    reason?: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult>;
  runnerStatus(input?: { logLimit?: number }): Promise<HostedRunnerStatusResponse>;
}

export interface WorkerEnvironmentSource
  extends WorkerEnvironmentContract<UserRunnerDurableObjectStubLike> {
  RUNNER_CONTAINER: HostedExecutionContainerNamespaceLike;
  RUNNER_CONTAINER_SMOKE: HostedExecutionContainerNamespaceLike;
}

export interface WorkerRouteContext {
  env: WorkerEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  requestText?: Promise<string>;
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
