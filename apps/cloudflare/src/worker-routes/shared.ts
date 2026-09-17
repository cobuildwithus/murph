import type {
  HostedCryptoDomain,
} from "@murphai/runtime-state";

import { readHostedExecutionEnvironment } from "../env.ts";
import { readRequestBodyText } from "../json.ts";

import type { HostedExecutionContainerNamespaceLike } from "../runner-container.js";
import type {
  HostedStandbyCoordinatorNamespaceLike,
  HostedStandbyRunnerContainerNamespaceLike,
} from "../standby-runner-contract.js";

import {
  requireHostedUserCryptoContextFromEnvironment,
} from "../hosted-crypto/runtime-user-crypto-context.ts";
import type {
  WorkerEnvironmentContract,
} from "../worker-contracts.ts";

export interface WorkerEnvironmentSource
  extends WorkerEnvironmentContract {
  RUNNER_CONTAINER: HostedExecutionContainerNamespaceLike;
  NEXT_RUNNER_CONTAINER?: HostedExecutionContainerNamespaceLike;
  RUNNER_CONTAINER_SMOKE: HostedExecutionContainerNamespaceLike;
  STANDBY_COORDINATOR?: HostedStandbyCoordinatorNamespaceLike;
  STANDBY_RUNNER_CONTAINER?: HostedStandbyRunnerContainerNamespaceLike;
  SMALL_RUNNER_CONTAINER?: HostedStandbyRunnerContainerNamespaceLike;
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
