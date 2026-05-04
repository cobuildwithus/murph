import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
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
  extends WorkerEnvironmentContract<WorkerBindUserRunnerStubLike> {}

const RUNNER_INTERNAL_PROXY_HOSTNAMES = new Set<string>([
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane,
]);
const RUNNER_OUTBOUND_CRYPTO_CONTEXT_MAX_ENTRIES = 1_024;
const RUNNER_OUTBOUND_CRYPTO_CONTEXT_MAX_TTL_MS = 5 * 60 * 1000;
const RUNNER_OUTBOUND_CRYPTO_CONTEXT_PENDING_TTL_MS = 30_000;
const RUNNER_OUTBOUND_CRYPTO_CONTEXT_SKEW_MS = 1_000;
const RUNNER_OUTBOUND_BIND_USER_CACHE_SUCCESS_TTL_MS = 60_000;
const RUNNER_OUTBOUND_BIND_USER_CACHE_PENDING_TTL_MS = 30_000;
const RUNNER_OUTBOUND_BIND_USER_CACHE_MAX_ENTRIES = 2_048;

interface RunnerOutboundCryptoContextCacheEntry {
  expiresAtMs: number;
  promise: Promise<HostedUserCryptoContext>;
  token: object;
}

interface RunnerOutboundBindUserCacheEntry {
  expiresAtMs: number;
  promise: Promise<RunnerOutboundUserRunnerStubLike>;
  token: object;
}

const runnerOutboundCryptoContextCache = new Map<
  string,
  RunnerOutboundCryptoContextCacheEntry
>();
let runnerOutboundBindUserCaches = new WeakMap<
  RunnerOutboundEnvironmentSource["USER_RUNNER"],
  Map<string, RunnerOutboundBindUserCacheEntry>
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
  const existing = runnerOutboundCryptoContextCache.get(cacheKey);
  if (existing && existing.expiresAtMs > nowMs) {
    return await existing.promise;
  }
  if (existing) {
    runnerOutboundCryptoContextCache.delete(cacheKey);
  }

  const cacheToken = {};
  const promise = (async (): Promise<HostedUserCryptoContext> => {
    await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
    const context = await requireHostedUserCryptoContextFromEnvironment({
      bucket: input.bucket,
      domain: input.domain,
      environment: input.environment,
      reason: "runner-outbound-access",
      userId: input.userId,
    });
    const cached = runnerOutboundCryptoContextCache.get(cacheKey);
    if (cached?.token === cacheToken) {
      cached.expiresAtMs = resolveRunnerOutboundCryptoContextExpiresAtMs(context, Date.now());
    }
    return context;
  })();
  runnerOutboundCryptoContextCache.set(cacheKey, {
    expiresAtMs: nowMs + RUNNER_OUTBOUND_CRYPTO_CONTEXT_PENDING_TTL_MS,
    promise,
    token: cacheToken,
  });
  trimRunnerOutboundCryptoContextCache();

  try {
    return await promise;
  } catch (error) {
    const cached = runnerOutboundCryptoContextCache.get(cacheKey);
    if (cached?.token === cacheToken) {
      runnerOutboundCryptoContextCache.delete(cacheKey);
    }
    throw error;
  }
}

export function resetRunnerOutboundSharedCachesForTest(): void {
  runnerOutboundCryptoContextCache.clear();
  runnerOutboundBindUserCaches = new WeakMap();
}

export async function resolveRunnerOutboundUserRunnerStub(
  env: RunnerOutboundEnvironmentSource,
  userId: string,
): Promise<RunnerOutboundUserRunnerStubLike> {
  const cache = getRunnerOutboundBindUserCache(env.USER_RUNNER);
  const nowMs = Date.now();
  const existing = cache.get(userId);
  if (existing && existing.expiresAtMs > nowMs) {
    return await existing.promise;
  }
  if (existing) {
    cache.delete(userId);
  }

  const cacheToken = {};
  const promise = (async (): Promise<RunnerOutboundUserRunnerStubLike> => {
    const stub = env.USER_RUNNER.getByName(userId);
    requireRunnerOutboundUserStubMethod(stub, "bindUser");
    await stub.bindUser(userId);
    const cached = cache.get(userId);
    if (cached?.token === cacheToken) {
      cached.expiresAtMs = Date.now() + RUNNER_OUTBOUND_BIND_USER_CACHE_SUCCESS_TTL_MS;
    }
    return stub;
  })();

  cache.set(userId, {
    expiresAtMs: nowMs + RUNNER_OUTBOUND_BIND_USER_CACHE_PENDING_TTL_MS,
    promise,
    token: cacheToken,
  });
  trimRunnerOutboundBindUserCache(cache);

  try {
    return await promise;
  } catch (error) {
    const cached = cache.get(userId);
    if (cached?.token === cacheToken) {
      cache.delete(userId);
    }
    throw error;
  }
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

function resolveRunnerOutboundCryptoContextExpiresAtMs(
  context: Pick<HostedUserCryptoContext, "cacheMaxAgeMs" | "fetchedAtMs">,
  localNowMs: number,
): number {
  const ttlMs = Math.max(
    0,
    Math.min(context.cacheMaxAgeMs, RUNNER_OUTBOUND_CRYPTO_CONTEXT_MAX_TTL_MS),
  );
  const fetchedAtMs = Number.isFinite(context.fetchedAtMs)
    ? context.fetchedAtMs
    : localNowMs;
  const expiresAtMs = Math.min(
    fetchedAtMs + ttlMs - RUNNER_OUTBOUND_CRYPTO_CONTEXT_SKEW_MS,
    localNowMs + ttlMs - RUNNER_OUTBOUND_CRYPTO_CONTEXT_SKEW_MS,
  );
  return Math.max(localNowMs, expiresAtMs);
}

function trimRunnerOutboundCryptoContextCache(): void {
  if (runnerOutboundCryptoContextCache.size <= RUNNER_OUTBOUND_CRYPTO_CONTEXT_MAX_ENTRIES) {
    return;
  }

  const nowMs = Date.now();
  for (const [key, value] of runnerOutboundCryptoContextCache) {
    if (value.expiresAtMs <= nowMs) {
      runnerOutboundCryptoContextCache.delete(key);
    }
  }

  while (runnerOutboundCryptoContextCache.size > RUNNER_OUTBOUND_CRYPTO_CONTEXT_MAX_ENTRIES) {
    const oldestKey = runnerOutboundCryptoContextCache.keys().next().value;
    if (typeof oldestKey !== "string") {
      return;
    }
    runnerOutboundCryptoContextCache.delete(oldestKey);
  }
}

function getRunnerOutboundBindUserCache(
  namespace: RunnerOutboundEnvironmentSource["USER_RUNNER"],
): Map<string, RunnerOutboundBindUserCacheEntry> {
  let cache = runnerOutboundBindUserCaches.get(namespace);

  if (!cache) {
    cache = new Map();
    runnerOutboundBindUserCaches.set(namespace, cache);
  }

  return cache;
}

function trimRunnerOutboundBindUserCache(
  cache: Map<string, RunnerOutboundBindUserCacheEntry>,
): void {
  if (cache.size <= RUNNER_OUTBOUND_BIND_USER_CACHE_MAX_ENTRIES) {
    return;
  }

  const nowMs = Date.now();
  for (const [key, value] of cache) {
    if (value.expiresAtMs <= nowMs) {
      cache.delete(key);
    }
  }

  while (cache.size > RUNNER_OUTBOUND_BIND_USER_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      return;
    }
    cache.delete(oldestKey);
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
