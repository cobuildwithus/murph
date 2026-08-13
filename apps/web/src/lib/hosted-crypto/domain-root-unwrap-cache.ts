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
 * lifetime. Outside a scope every unwrap behaves exactly as before.
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
