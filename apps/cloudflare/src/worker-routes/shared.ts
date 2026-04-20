import type {
  HostedRunDrainResult,
  HostedRunNudgeResult,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";

import { readHostedExecutionEnvironment } from "../env.ts";
import type { HostedExecutionContainerNamespaceLike } from "../runner-container.js";
import {
  createHostedUserKeyStoreFromEnvironment,
} from "../user-key-store.js";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerStubLike,
} from "../worker-contracts.ts";

export interface UserRunnerDurableObjectStubLike extends WorkerUserRunnerStubLike {
  bootstrapUser(userId: string): Promise<{ userId: string }>;
  nudgeHostedRun(): Promise<HostedRunNudgeResult>;
  status(): Promise<HostedExecutionUserStatus>;
  drainHostedRuns(input?: {
    targetSeqHint?: string | null;
  }): Promise<HostedRunDrainResult>;
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
  waitUntil?: (promise: Promise<unknown>) => void;
}

export async function resolveUserRunnerStub(
  env: WorkerEnvironmentSource,
  userId: string,
): Promise<UserRunnerDurableObjectStubLike> {
  const stub = env.USER_RUNNER.getByName(userId);
  await stub.bootstrapUser(userId);
  return stub;
}

export async function resolveHostedExecutionUserCryptoContext(input: {
  bucket: WorkerEnvironmentSource["BUNDLES"];
  environment: WorkerRouteContext["environment"];
  userId: string;
}) {
  return createHostedUserKeyStoreFromEnvironment({
    bucket: input.bucket,
    environment: input.environment,
  }).requireUserCryptoContext(input.userId, {
    reason: "worker-route-access",
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
