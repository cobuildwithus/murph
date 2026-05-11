import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
import type { RuntimeLivenessInstruction } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type {
  HostedCryptoDomain,
} from "@murphai/runtime-state";

import { readHostedExecutionEnvironment } from "../env.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_HOSTS } from "../internal-hosts.ts";
import { json } from "../json.ts";
import { requireHostedUserCryptoContextFromEnvironment } from "../hosted-crypto/runtime-user-crypto-context.ts";
import type {
  HostedUserCryptoContext,
} from "../hosted-crypto/runtime-user-crypto-context.ts";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerStubLike,
} from "../worker-contracts.ts";

interface RunnerOutboundUserRunnerStubLike extends WorkerUserRunnerStubLike {
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
      instruction?: RuntimeLivenessInstruction;
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
  recordActiveInvocationWorkspaceCheckpoint?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }>;
}

export interface RunnerOutboundEnvironmentSource
  extends WorkerEnvironmentContract<RunnerOutboundUserRunnerStubLike> {}

const RUNNER_INTERNAL_PROXY_HOSTNAMES = new Set<string>([
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
]);
const RUNNER_OUTBOUND_CRYPTO_CONTEXT_PENDING_MAX_ENTRIES = 1_024;
const RUNNER_OUTBOUND_CRYPTO_CONTEXT_PENDING_TTL_MS = 30_000;

interface RunnerOutboundCryptoContextPendingLoad {
  expiresAtMs: number;
  promise: Promise<HostedUserCryptoContext>;
  token: object;
}

const runnerOutboundCryptoContextPendingLoads = new Map<
  string,
  RunnerOutboundCryptoContextPendingLoad
>();

export async function resolveRunnerOutboundUserCryptoContext(input: {
  bucket: RunnerOutboundEnvironmentSource["BUNDLES"];
  domain: Extract<HostedCryptoDomain, "ingress" | "runtime">;
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  userId: string;
}) {
  const cacheKey = cryptoContextCacheKey({
    domain: input.domain,
    environment: input.environment,
    userId: input.userId,
  });
  const nowMs = Date.now();
  const existing = runnerOutboundCryptoContextPendingLoads.get(cacheKey);
  if (existing && existing.expiresAtMs > nowMs) {
    return await existing.promise;
  }
  if (existing) {
    runnerOutboundCryptoContextPendingLoads.delete(cacheKey);
  }

  const cacheToken = {};
  const promise = (async (): Promise<HostedUserCryptoContext> => {
    return await requireHostedUserCryptoContextFromEnvironment({
      bucket: input.bucket,
      domain: input.domain,
      environment: input.environment,
      reason: "runner-outbound-access",
      userId: input.userId,
    });
  })();
  runnerOutboundCryptoContextPendingLoads.set(cacheKey, {
    expiresAtMs: nowMs + RUNNER_OUTBOUND_CRYPTO_CONTEXT_PENDING_TTL_MS,
    promise,
    token: cacheToken,
  });
  trimRunnerOutboundCryptoContextPendingLoads();

  try {
    return await promise;
  } finally {
    const cached = runnerOutboundCryptoContextPendingLoads.get(cacheKey);
    if (cached?.token === cacheToken) {
      runnerOutboundCryptoContextPendingLoads.delete(cacheKey);
    }
  }
}

export function resetRunnerOutboundSharedCachesForTest(): void {
  runnerOutboundCryptoContextPendingLoads.clear();
}

export async function resolveRunnerOutboundUserRunnerStub(
  env: RunnerOutboundEnvironmentSource,
  userId: string,
): Promise<RunnerOutboundUserRunnerStubLike> {
  return env.USER_RUNNER.getByName(userId);
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

function cryptoContextCacheKey(input: {
  domain: Extract<HostedCryptoDomain, "ingress" | "runtime">;
  environment: Pick<
    ReturnType<typeof readHostedExecutionEnvironment>,
    "hostedCrypto" | "hostedWebBaseUrl" | "webCallbackSigning"
  >;
  userId: string;
}): string {
  const hostedCrypto = input.environment.hostedCrypto;
  return JSON.stringify([
    "runner-outbound-crypto-context-cache:v1",
    input.environment.hostedWebBaseUrl,
    input.environment.webCallbackSigning.keyId,
    hostedCrypto?.HOSTED_CRYPTO_ENV ?? "",
    hostedCrypto?.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION ?? "",
    hostedCrypto?.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID ?? "",
    input.userId,
    input.domain,
  ]);
}

function trimRunnerOutboundCryptoContextPendingLoads(): void {
  if (
    runnerOutboundCryptoContextPendingLoads.size
      <= RUNNER_OUTBOUND_CRYPTO_CONTEXT_PENDING_MAX_ENTRIES
  ) {
    return;
  }

  const nowMs = Date.now();
  for (const [key, value] of runnerOutboundCryptoContextPendingLoads) {
    if (value.expiresAtMs <= nowMs) {
      runnerOutboundCryptoContextPendingLoads.delete(key);
    }
  }

  while (
    runnerOutboundCryptoContextPendingLoads.size
      > RUNNER_OUTBOUND_CRYPTO_CONTEXT_PENDING_MAX_ENTRIES
  ) {
    const oldestKey = runnerOutboundCryptoContextPendingLoads.keys().next().value;
    if (typeof oldestKey !== "string") {
      return;
    }
    runnerOutboundCryptoContextPendingLoads.delete(oldestKey);
  }
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
