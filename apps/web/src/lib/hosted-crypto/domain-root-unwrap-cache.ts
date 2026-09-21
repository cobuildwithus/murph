import { AsyncLocalStorage } from "node:async_hooks";

import type { HostedDomainRootKeyEnvelopeV1 } from "@murphai/runtime-state";

export interface CachedUnwrappedHostedDomainRoot {
  envelope: HostedDomainRootKeyEnvelopeV1;
  rootKey: Uint8Array;
}

type HostedDomainRootUnwrapCache = Map<string, Promise<CachedUnwrappedHostedDomainRoot>>;

const hostedDomainRootUnwrapCacheStorage = new AsyncLocalStorage<HostedDomainRootUnwrapCache>();
const hostedDomainRootProviderCallsDisabledStorage = new AsyncLocalStorage<boolean>();

/**
 * Scoped memo for domain-root envelope reads + KMS unwraps. Webhook plan
 * transactions decrypt many fields under the same domain root, and each
 * open/seal re-read the envelope row and re-called KMS. Callers zeroize the
 * root key after each use, so the cache keeps private master copies and the
 * store hands out per-call copies; the masters are wiped when the scope
 * closes, preserving the key-hygiene invariant with a deterministic
 * lifetime. The separate ingress-only process cache below owns no envelopes or authority.
 */
export async function runWithHostedDomainRootUnwrapCache<TResult>(
  run: () => Promise<TResult>,
): Promise<TResult> {
  if (hostedDomainRootUnwrapCacheStorage.getStore()) {
    return run();
  }

  return runWithFreshHostedDomainRootUnwrapCache(run);
}

/**
 * Runs with a child cache even when a broader request cache already exists.
 * Exact-authority retry owners use this after drift so a stale `@active` alias
 * cannot survive into the next full preparation attempt. The child cache is
 * wiped without mutating or zeroizing entries owned by the outer scope.
 */
export async function runWithFreshHostedDomainRootUnwrapCache<TResult>(
  run: () => Promise<TResult>,
): Promise<TResult> {
  const cache: HostedDomainRootUnwrapCache = new Map();
  try {
    return await hostedDomainRootUnwrapCacheStorage.run(cache, run);
  } finally {
    for (const pending of cache.values()) {
      void pending.then(
        (unwrapped) => {
          unwrapped.rootKey.fill(0);
        },
        () => undefined,
      );
    }
    cache.clear();
  }
}

export function getHostedDomainRootUnwrapCache(): HostedDomainRootUnwrapCache | undefined {
  return hostedDomainRootUnwrapCacheStorage.getStore();
}

/**
 * Marks a transaction-local consumer as cache-only. Provider-capable root
 * owners use this after all exact root references have been prepared so a
 * concurrent private-row change becomes a bounded preparation retry instead
 * of a KMS call under database locks.
 */
export async function runWithHostedDomainRootProviderCallsDisabled<TResult>(
  run: () => Promise<TResult>,
): Promise<TResult> {
  return hostedDomainRootProviderCallsDisabledStorage.run(true, run);
}

export function areHostedDomainRootProviderCallsDisabled(): boolean {
  return hostedDomainRootProviderCallsDisabledStorage.getStore() === true;
}

// Non-sliding retention from successful unwrap, not last use. At most 4 KiB of
// process-owned plaintext roots (plus independent request/caller copies).
export const HOSTED_INGRESS_ROOT_CACHE_TTL_MS = 30_000;
export const HOSTED_INGRESS_ROOT_CACHE_MAX_ENTRIES = 128;

interface CachedHostedIngressRootKey {
  expiresAt: number;
  kmsClient: object;
  rootKey: Uint8Array;
  timer: ReturnType<typeof setTimeout>;
}

const hostedIngressRootKeys = new Map<string, CachedHostedIngressRootKey>();

/** Crypto-only digest supplied AFTER current envelope verification/wrap checks. */
export function readCachedHostedIngressRootKey(input: {
  identity: string;
  kmsClient: object;
}): Uint8Array | undefined {
  const cached = hostedIngressRootKeys.get(input.identity);
  if (!cached) return undefined;
  if (cached.kmsClient !== input.kmsClient || performance.now() >= cached.expiresAt) {
    evictHostedIngressRootKey(input.identity);
    return undefined;
  }
  return Uint8Array.from(cached.rootKey);
}

/**
 * Successes only: no cross-request promises, failures, abort signals or aliases.
 * Concurrent cold requests may each unwrap; their provider lifetimes stay
 * independent. The store keeps ownership of its input; this cache copies it.
 */
export function cacheHostedIngressRootKey(input: {
  identity: string;
  kmsClient: object;
  rootKey: Uint8Array;
}): void {
  // FIFO, not LRU: neither a hit nor an overlapping successful miss extends an
  // existing entry's deadline. A new provider/config owner replaces the entry.
  const existing = hostedIngressRootKeys.get(input.identity);
  if (existing?.kmsClient === input.kmsClient && performance.now() < existing.expiresAt) {
    return;
  }
  evictHostedIngressRootKey(input.identity);
  if (hostedIngressRootKeys.size >= HOSTED_INGRESS_ROOT_CACHE_MAX_ENTRIES) {
    const oldest = hostedIngressRootKeys.keys().next().value;
    if (oldest !== undefined) evictHostedIngressRootKey(oldest);
  }
  const timer = setTimeout(
    evictHostedIngressRootKey,
    HOSTED_INGRESS_ROOT_CACHE_TTL_MS,
    input.identity,
  );
  timer.unref();
  hostedIngressRootKeys.set(input.identity, {
    expiresAt: performance.now() + HOSTED_INGRESS_ROOT_CACHE_TTL_MS,
    kmsClient: input.kmsClient,
    rootKey: Uint8Array.from(input.rootKey),
    timer,
  });
}

function evictHostedIngressRootKey(identity: string): void {
  const cached = hostedIngressRootKeys.get(identity);
  if (!cached) return;
  hostedIngressRootKeys.delete(identity);
  clearTimeout(cached.timer);
  cached.rootKey.fill(0);
}
