import type {
  HostedRunnerNudgeResult,
  HostedRunnerStatusResponse,
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";

import { readHostedExecutionEnvironment } from "../env.ts";
import type { HostedRunnerUserDataDeletionResult } from "../user-runner.js";
import type { HostedExecutionContainerNamespaceLike } from "../runner-container.js";
import {
  requireHostedUserCryptoContextFromEnvironment,
} from "../user-key-store.js";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerStubLike,
} from "../worker-contracts.ts";

export interface UserRunnerDurableObjectStubLike extends WorkerUserRunnerStubLike {
  bindUser(userId: string): Promise<{ userId: string }>;
  deleteHostedUserData(userId: string): Promise<HostedRunnerUserDataDeletionResult>;
  nudgeHostedRunner(): Promise<HostedRunnerNudgeResult>;
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
      inputAvailable: boolean;
      nextAlarmAt: string | null;
      ok: true;
      pendingNudge: boolean;
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
  runWhenIdleOrBudget(input: { reason: HostedWorkspaceInvocationReason }): Promise<HostedWorkspaceInvocationResult>;
  runnerStatus(): Promise<HostedRunnerStatusResponse>;
}

export interface WorkerEnvironmentSource
  extends WorkerEnvironmentContract<UserRunnerDurableObjectStubLike> {
  RUNNER_CONTAINER: HostedExecutionContainerNamespaceLike;
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
  environment: WorkerRouteContext["environment"];
  userId: string;
}) {
  return requireHostedUserCryptoContextFromEnvironment({
    bucket: input.bucket,
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
): Promise<string> {
  context.requestText ??= context.request.text();
  return context.requestText;
}
