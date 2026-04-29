import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";

import { readHostedExecutionEnvironment } from "../env.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_HOSTS } from "../internal-hosts.ts";
import { json } from "../json.ts";
import { requireHostedUserCryptoContextFromEnvironment } from "../user-key-store.js";
import type {
  WorkerBindUserRunnerStubLike,
  WorkerEnvironmentContract,
} from "../worker-contracts.ts";

interface RunnerOutboundUserRunnerStubLike extends WorkerBindUserRunnerStubLike {
  ownsActiveInvocationLease?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean>;
  recordActiveInvocationHeartbeat?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<
    | {
      nextAlarmAt: string | null;
      ok: true;
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
  recordActiveInvocationWorkspaceCheckpoint?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }>;
}

export interface RunnerOutboundEnvironmentSource
  extends WorkerEnvironmentContract<WorkerBindUserRunnerStubLike> {}

const RUNNER_INTERNAL_PROXY_HOSTNAMES = new Set<string>([
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
]);

export async function resolveRunnerOutboundUserCryptoContext(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  userId: string;
}) {
  await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);

  return requireHostedUserCryptoContextFromEnvironment({
    bucket: input.bucket,
    environment: input.environment,
    reason: "runner-outbound-access",
    userId: input.userId,
  });
}

export async function resolveRunnerOutboundUserRunnerStub(
  env: RunnerOutboundEnvironmentSource,
  userId: string,
): Promise<RunnerOutboundUserRunnerStubLike> {
  const stub = env.USER_RUNNER.getByName(userId);
  requireRunnerOutboundUserStubMethod(stub, "bindUser");
  await stub.bindUser(userId);
  return stub;
}

export function requireRunnerOutboundUserStubMethod<TKey extends keyof RunnerOutboundUserRunnerStubLike>(
  stub: RunnerOutboundUserRunnerStubLike,
  key: TKey,
): Exclude<RunnerOutboundUserRunnerStubLike[TKey], undefined> {
  const method = stub[key];

  if (typeof method !== "function") {
    throw new TypeError(`User runner stub does not implement ${String(key)}.`);
  }

  return method as Exclude<RunnerOutboundUserRunnerStubLike[TKey], undefined>;
}

export function decodeRouteParam(value: string): string {
  return decodeURIComponent(value);
}

export function timingSafeEquals(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

export function requireRunnerInternalProxyAuthorization(
  request: Request,
  hostname: string,
  expectedToken: string | null,
): Response | null {
  if (!RUNNER_INTERNAL_PROXY_HOSTNAMES.has(hostname)) {
    return null;
  }

  if (!expectedToken) {
    return json({
      error: "Hosted runner outbound proxy token is not configured.",
    }, 503);
  }

  const providedToken = request.headers.get(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER);
  if (!providedToken || !timingSafeEquals(providedToken, expectedToken)) {
    return json({
      error: "Unauthorized",
    }, 401);
  }

  return null;
}
