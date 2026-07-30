import type {
  HostedCryptoDomain,
} from "@murphai/runtime-state";

import { readHostedExecutionEnvironment } from "../env.ts";
import { requireHostedUserCryptoContextFromEnvironment } from "../hosted-crypto/runtime-user-crypto-context.ts";
import type {
  HostedUserCryptoContext,
} from "../hosted-crypto/runtime-user-crypto-context.ts";
import type {
  WorkerEnvironmentContract,
  WorkerUserRunnerStubLike,
} from "../worker-contracts.ts";

export interface RunnerOutboundEnvironmentSource
  extends WorkerEnvironmentContract {}

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
): Promise<WorkerUserRunnerStubLike> {
  return env.USER_RUNNER.getByName(userId);
}

type WorkerUserRunnerStubWithMethod<
  TKey extends keyof WorkerUserRunnerStubLike,
> = WorkerUserRunnerStubLike & Required<Pick<WorkerUserRunnerStubLike, TKey>>;

export function requireRunnerOutboundUserStubMethod<TKey extends keyof WorkerUserRunnerStubLike>(
  stub: WorkerUserRunnerStubLike,
  key: TKey,
): asserts stub is WorkerUserRunnerStubWithMethod<TKey> {
  if (typeof stub[key] !== "function") {
    throw new TypeError(`User runner stub does not implement ${String(key)}.`);
  }
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
