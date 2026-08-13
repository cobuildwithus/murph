import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  createHostedDomainRootKeyId,
  findHostedDomainRootWrap,
  generateHostedDomainRootKey,
  parseHostedDomainRootKeyEnvelope,
  serializeAdditionalAuthenticatedData,
  selectHostedAuthorityVerifyPublicKeyPem,
  verifyHostedDomainRootEnvelopeSignatureWithPublicKey,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedCryptoDomain,
  type HostedCryptoKmsRecipientKind,
  type HostedCryptoRecipientKind,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
  type HostedDomainRootKeyWrap,
  type HostedEcdhWrappedDomainRootKey,
  type HostedGcpKmsWrappedDomainRootKey,
} from "@murphai/runtime-state";

import { getPrisma } from "../prisma";
import {
  areHostedDomainRootProviderCallsDisabled,
  getHostedDomainRootUnwrapCache,
  type CachedUnwrappedHostedDomainRoot,
} from "./domain-root-unwrap-cache";
import { getHostedWebCryptoConfig, selectActiveHostedCloudflareAutomationRecipient } from "./env";

type HostedCryptoTx = Prisma.TransactionClient;
type HostedCryptoClient = PrismaClient | Prisma.TransactionClient;
type HostedCryptoTransactionRoot = {
  $transaction<T>(fn: (tx: HostedCryptoTx) => Promise<T>): Promise<T>;
};

const ALL_DOMAINS: readonly HostedCryptoDomain[] = ["control", "device", "ingress", "runtime"];
const WEB_UNWRAP_DOMAINS = new Set<HostedCryptoDomain>(["control", "device", "ingress"]);
const WEB_BATCH_UNWRAP_CONCURRENCY = 4;
const HOSTED_RUNTIME_CRYPTO_CONTEXT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const HOSTED_RUNTIME_CRYPTO_CONTEXT_POLICY_VERSION = "hosted-runtime-crypto-context-policy:v1";

export class HostedDomainRootEnvelopeUnavailableError extends Error {
  constructor(input: { domain: HostedCryptoDomain }) {
    super(`Hosted ${input.domain} domain root envelope is not available for decrypt.`);
    this.name = "HostedDomainRootEnvelopeUnavailableError";
  }
}

export class HostedCryptoDomainRootCandidateRequiredError extends Error {
  readonly domain: HostedCryptoDomain;

  constructor(input: { domain: HostedCryptoDomain }) {
    super(
      `Prepared hosted ${input.domain} domain root candidate is required.`,
    );
    this.name = "HostedCryptoDomainRootCandidateRequiredError";
    this.domain = input.domain;
  }
}

export function isHostedDomainRootEnvelopeUnavailableError(
  error: unknown,
): error is HostedDomainRootEnvelopeUnavailableError {
  return error instanceof HostedDomainRootEnvelopeUnavailableError;
}

interface HostedUserCryptoEnvelopeRow {
  id: string;
  userId: string;
  domain: HostedCryptoDomain;
  rootKeyId: string;
  status: string;
  signedEnvelopeJson: unknown;
  updatedAt: Date | string;
}

interface VerifiedHostedDomainRootEnvelopeRecord {
  envelope: HostedDomainRootKeyEnvelopeV1;
  rootKeyId: string;
  status: string;
  updatedAt: string;
}

export interface UnwrappedHostedDomainRoot {
  envelope: HostedDomainRootKeyEnvelopeV1;
  rootKey: Uint8Array;
}

export interface HostedDomainRootReference {
  domain: HostedCryptoDomain;
  rootKeyId: string;
  userId: string;
}

export interface UnwrappedHostedDomainRootReference
  extends HostedDomainRootReference, UnwrappedHostedDomainRoot {}

export type PreparedHostedCryptoDomainRootCandidates =
  ReadonlyMap<HostedCryptoDomain, HostedDomainRootKeyEnvelopeV1>;

export interface PreparedHostedDomainRootForWeb {
  readonly domain: HostedCryptoDomain;
  readonly rootKeyId: string;
  readonly userId: string;
}

interface PreparedHostedDomainRootForWebDetails {
  preparedCandidates: PreparedHostedCryptoDomainRootCandidates;
  reason: string;
  root: Promise<CachedUnwrappedHostedDomainRoot>;
}

const preparedHostedDomainRootsForWeb = new WeakMap<
  PreparedHostedDomainRootForWeb,
  PreparedHostedDomainRootForWebDetails
>();

export class HostedDomainRootPreparationMismatchError extends Error {
  readonly code = "HOSTED_DOMAIN_ROOT_PREPARATION_MISMATCH";

  constructor() {
    super("Hosted domain root preparation is stale.");
    this.name = "HostedDomainRootPreparationMismatchError";
  }
}

/**
 * Provider-capable preparation for one Web-readable domain root. A missing
 * root is signed and prewarmed as an ephemeral candidate; an existing root is
 * unwrapped directly. The returned token contains crypto identity only.
 */
export async function prepareHostedDomainRootForWeb(input: {
  domain: HostedCryptoDomain;
  prepareMissing?: boolean;
  prisma?: HostedCryptoClient;
  reason: string;
  signal?: AbortSignal;
  userId: string;
}): Promise<PreparedHostedDomainRootForWeb> {
  if (!WEB_UNWRAP_DOMAINS.has(input.domain)) {
    throw new Error(
      `Web is not allowed to prepare hosted ${input.domain} domain roots.`,
    );
  }
  const cache = getHostedDomainRootUnwrapCache();
  if (!cache) {
    throw new Error(
      "Hosted domain-root preparation requires a request-scoped unwrap cache.",
    );
  }
  const preparedCandidates = input.prepareMissing === false
    ? new Map<HostedCryptoDomain, HostedDomainRootKeyEnvelopeV1>()
    : await prepareHostedCryptoDomainRootCandidates({
        domains: [input.domain],
        prisma: input.prisma,
        userId: input.userId,
      });
  const candidate = preparedCandidates.get(input.domain);
  let rootKeyId: string;
  if (candidate) {
    await prewarmPreparedHostedCryptoDomainRootForWeb({
      domain: input.domain,
      prepared: preparedCandidates,
      signal: input.signal,
      userId: input.userId,
    });
    rootKeyId = candidate.rootKeyId;
  } else {
    const unwrapped = await unwrapHostedDomainRootForWeb({
      domain: input.domain,
      prisma: input.prisma,
      retainFailureInScopedCache: true,
      signal: input.signal,
      userId: input.userId,
    });
    try {
      rootKeyId = unwrapped.envelope.rootKeyId;
    } finally {
      unwrapped.rootKey.fill(0);
    }
  }

  const root = cache.get(
    createHostedDomainRootReferenceKey({
      domain: input.domain,
      rootKeyId,
      userId: input.userId,
    }),
  );
  if (!root) {
    throw new Error(
      "Hosted domain-root preparation was not retained in the scoped cache.",
    );
  }
  const cached = await root;
  if (
    cached.envelope.domain !== input.domain
    || cached.envelope.rootKeyId !== rootKeyId
    || cached.envelope.userId !== input.userId
  ) {
    throw new Error(
      "Hosted domain-root prepared cache entry does not match its identity.",
    );
  }

  const prepared = Object.freeze({
    domain: input.domain,
    rootKeyId,
    userId: input.userId,
  });
  preparedHostedDomainRootsForWeb.set(prepared, {
    preparedCandidates,
    reason: input.reason,
    root,
  });
  return prepared;
}

export function readPreparedHostedDomainRootForWebLocal(
  prepared: PreparedHostedDomainRootForWeb,
): {
  root: Promise<CachedUnwrappedHostedDomainRoot>;
  rootKeyId: string;
} {
  const details = preparedHostedDomainRootsForWeb.get(prepared);
  const root = getHostedDomainRootUnwrapCache()?.get(
    createHostedDomainRootReferenceKey(prepared),
  );
  if (!details || !root || root !== details.root) {
    throw new TypeError(
      "Hosted domain root is not the exact prepared scoped cache entry.",
    );
  }
  return {
    root,
    rootKeyId: prepared.rootKeyId,
  };
}

/**
 * Database-only commit/revalidation for a prepared root. It inserts the
 * prepared candidate or reads the existing winner under the canonical root
 * lock, then requires exact root identity.
 */
export async function revalidatePreparedHostedDomainRootForWebTx(input: {
  prepared: PreparedHostedDomainRootForWeb;
  tx: HostedCryptoTx;
}): Promise<{
  root: Promise<CachedUnwrappedHostedDomainRoot>;
  rootKeyId: string;
}> {
  const local = readPreparedHostedDomainRootForWebLocal(input.prepared);
  const details = preparedHostedDomainRootsForWeb.get(input.prepared);
  if (!details) {
    throw new TypeError("Hosted domain root preparation is missing.");
  }
  const active = await provisionActiveHostedDomainRootEnvelopeForUserOnlyTx({
    candidate: details.preparedCandidates.get(input.prepared.domain),
    domain: input.prepared.domain,
    reason: details.reason,
    tx: input.tx,
    userId: input.prepared.userId,
  });
  if (active.rootKeyId !== input.prepared.rootKeyId) {
    throw new HostedDomainRootPreparationMismatchError();
  }
  return local;
}

/**
 * Seeds the request-scoped unwrap cache from a prepared envelope that has not
 * been inserted yet. This lets a caller seal values and warm a later
 * transaction's local encryption path without retaining another plaintext-key
 * owner. The cache keeps its own copy and wipes it when the request scope
 * closes; this helper wipes the caller copy immediately.
 */
export async function prewarmPreparedHostedCryptoDomainRootForWeb(input: {
  domain: HostedCryptoDomain;
  prepared: PreparedHostedCryptoDomainRootCandidates;
  signal?: AbortSignal;
  userId: string;
}): Promise<void> {
  const envelope = input.prepared.get(input.domain);
  if (!envelope) {
    throw new HostedCryptoDomainRootCandidateRequiredError({
      domain: input.domain,
    });
  }
  if (envelope.domain !== input.domain || envelope.userId !== input.userId) {
    throw new TypeError("Prepared hosted domain root does not match its prewarm target.");
  }

  const cache = getHostedDomainRootUnwrapCache();
  if (!cache) {
    throw new Error(
      "Prepared hosted domain-root prewarm requires a request-scoped unwrap cache.",
    );
  }
  const activeCacheKey = `${input.userId}|${input.domain}|@active`;
  const unwrapped = await unwrapWithScopedCache(
    activeCacheKey,
    async () => ({
      envelope,
      rootKey: await unwrapEnvelopeForWeb({
        envelope,
        signal: input.signal,
      }),
    }),
    true,
  );
  try {
    if (unwrapped.envelope.rootKeyId !== envelope.rootKeyId) {
      throw new Error("Prepared hosted domain root conflicts with the scoped active root.");
    }
    const active = cache.get(activeCacheKey);
    const concreteCacheKey = `${input.userId}|${input.domain}|${envelope.rootKeyId}`;
    if (active && !cache.has(concreteCacheKey)) {
      cache.set(concreteCacheKey, active);
    }
  } finally {
    unwrapped.rootKey.fill(0);
  }
}

async function unwrapWithScopedCache(
  cacheKey: string,
  compute: () => Promise<UnwrappedHostedDomainRoot>,
  retainFailureInScopedCache = false,
): Promise<UnwrappedHostedDomainRoot> {
  const cache = getHostedDomainRootUnwrapCache();
  if (!cache) {
    return compute();
  }

  let pending = cache.get(cacheKey);
  if (!pending) {
    if (areHostedDomainRootProviderCallsDisabled()) {
      throw new HostedDomainRootPreparationMismatchError();
    }
    pending = compute();
    cache.set(cacheKey, pending);
    if (!retainFailureInScopedCache) {
      pending.catch(() => {
        cache.delete(cacheKey);
      });
    }
  }
  const unwrapped = await pending;
  return {
    envelope: unwrapped.envelope,
    // Uint8Array.from copies; Buffer#slice would alias the cached master,
    // which callers zeroize after use.
    rootKey: Uint8Array.from(unwrapped.rootKey),
  };
}

/**
 * Phase one of domain-root provisioning. Signing one envelope costs up to three
 * GCP KMS round trips, so the candidates are built here, before any transaction
 * or advisory lock is taken. Candidates are ephemeral: one that loses the
 * insert race is discarded, and a root key that was never persisted decrypts
 * nothing and is referenced by nothing.
 */
export async function prepareHostedCryptoDomainRootCandidates(input: {
  domains?: readonly HostedCryptoDomain[];
  prisma?: HostedCryptoClient;
  userId: string;
}): Promise<PreparedHostedCryptoDomainRootCandidates> {
  const prisma = input.prisma ?? getPrisma();
  const activeDomains = await readActiveHostedCryptoDomains({
    prisma,
    userId: input.userId,
  });
  const missing = (input.domains ?? ALL_DOMAINS).filter(
    (domain) => !activeDomains.has(domain),
  );
  if (missing.length === 0) {
    return new Map();
  }
  let firstError: unknown;
  let hasError = false;
  const settled = await Promise.allSettled(missing.map(async (domain) => {
    try {
      return [
        domain,
        await createSignedHostedDomainRootEnvelope({ domain, userId: input.userId }),
      ] as const;
    } catch (error) {
      if (!hasError) {
        firstError = error;
        hasError = true;
      }
      throw error;
    }
  }));
  if (hasError) {
    throw firstError;
  }
  return new Map(settled.map((result) => {
    if (result.status === "rejected") {
      throw result.reason;
    }
    return result.value;
  }));
}

export async function provisionHostedCryptoDomainRootsForUser(input: {
  prisma?: PrismaClient;
  reason?: string;
  userId: string;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  const prepared = await prepareHostedCryptoDomainRootCandidates({
    prisma,
    userId: input.userId,
  });
  await prisma.$transaction(async (tx) => {
    await provisionPreparedHostedCryptoDomainRootsTx({
      prepared,
      reason: input.reason,
      tx,
      userId: input.userId,
    });
  });
}

/**
 * Transaction-only commit phase. This API has no signing fallback: callers
 * must prepare candidates before opening their transaction. An empty map is
 * valid when every root already exists.
 */
export async function provisionPreparedHostedCryptoDomainRootsTx(input: {
  prepared: PreparedHostedCryptoDomainRootCandidates;
  reason?: string;
  tx: HostedCryptoTx;
  userId: string;
}): Promise<void> {
  for (const domain of ALL_DOMAINS) {
    await provisionActiveHostedDomainRootEnvelopeForUserOnlyTx({
      candidate: input.prepared.get(domain),
      domain,
      reason: input.reason ?? "hosted-crypto.provision",
      tx: input.tx,
      userId: input.userId,
    });
  }
}

/**
 * Legacy all-domain bridge for inbound Family member activation, whose member
 * id may still be created after `BEGIN`. Candidate signing happens before the
 * first per-domain lock, but
 * the caller retains its outer connection and every `pg_advisory_xact_lock`
 * remains held until that outer transaction ends. New transaction code must
 * use the prepared-only commit API above.
 *
 * Signup/Privy identity reconciliation uses the separate single-domain legacy
 * surface below. Active Family Stripe reconciliation prepares every bounded
 * member candidate before opening its owner transaction.
 */
export async function provisionHostedCryptoDomainRootsForUserTx(input: {
  reason?: string;
  tx: HostedCryptoTx;
  userId: string;
}): Promise<void> {
  const prepared = await prepareHostedCryptoDomainRootCandidates({
    prisma: input.tx,
    userId: input.userId,
  });
  await provisionPreparedHostedCryptoDomainRootsTx({
    prepared,
    reason: input.reason,
    tx: input.tx,
    userId: input.userId,
  });
}

export async function hasActiveHostedCryptoDomainRootsForUserTx(input: {
  tx: HostedCryptoClient;
  userId: string;
}): Promise<boolean> {
  const rows = await input.tx.$queryRaw<Array<{ domainCount: number }>>`
    SELECT COUNT(DISTINCT domain)::int AS "domainCount"
    FROM hosted_user_crypto_envelope
    WHERE user_id = ${input.userId}
      AND status = 'active'::hosted_crypto_envelope_status
      AND domain IN (
        'control'::hosted_crypto_domain,
        'device'::hosted_crypto_domain,
        'ingress'::hosted_crypto_domain,
        'runtime'::hosted_crypto_domain
      )
  `;

  return (rows[0]?.domainCount ?? 0) >= ALL_DOMAINS.length;
}

/**
 * Provider-capable single-domain legacy surface for identity owners that can
 * create the durable member id only inside their transaction. Callers that
 * know the member id before `BEGIN` must prepare and use the commit-only API.
 */
export async function provisionActiveHostedDomainRootEnvelopeForUserOnly(input: {
  domain: HostedCryptoDomain;
  prisma?: HostedCryptoClient;
  reason?: string;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const prisma = input.prisma ?? getPrisma();
  const reason = input.reason ?? "hosted-crypto.provision-domain-root";
  const prepared = await prepareHostedCryptoDomainRootCandidates({
    domains: [input.domain],
    prisma,
    userId: input.userId,
  });
  if (hasPrismaTransactionRoot(prisma)) {
    return prisma.$transaction((tx) =>
      provisionActiveHostedDomainRootEnvelopeForUserOnlyTx({
        candidate: prepared.get(input.domain),
        domain: input.domain,
        reason,
        tx,
        userId: input.userId,
      }),
    );
  }
  return provisionActiveHostedDomainRootEnvelopeForUserOnlyTx({
    candidate: prepared.get(input.domain),
    domain: input.domain,
    reason,
    tx: prisma,
    userId: input.userId,
  });
}

export async function unwrapHostedDomainRootForWeb(input: {
  domain: HostedCryptoDomain;
  prisma?: HostedCryptoClient;
  /**
   * Retains a rejected unwrap only until the current scoped cache closes.
   * Preflight callers use this when retrying inside the immediately following
   * transaction would repeat the same provider request while holding a
   * connection. Ordinary callers continue to evict failures for later retry.
   */
  retainFailureInScopedCache?: boolean;
  signal?: AbortSignal;
  userId: string;
}): Promise<UnwrappedHostedDomainRoot> {
  if (!WEB_UNWRAP_DOMAINS.has(input.domain)) {
    throw new Error(`Web is not allowed to unwrap hosted ${input.domain} domain roots.`);
  }
  const activeCacheKey = `${input.userId}|${input.domain}|@active`;
  const unwrapped = await unwrapWithScopedCache(
    activeCacheKey,
    async () => {
      const envelope = await readActiveHostedDomainRootEnvelopeOrThrow({
        domain: input.domain,
        prisma: input.prisma,
        userId: input.userId,
      });
      const rootKey = await unwrapEnvelopeForWeb({ envelope, signal: input.signal });
      return { envelope, rootKey };
    },
    input.retainFailureInScopedCache,
  );
  const cache = getHostedDomainRootUnwrapCache();
  const active = cache?.get(activeCacheKey);
  const concreteCacheKey = `${input.userId}|${input.domain}|${unwrapped.envelope.rootKeyId}`;
  if (active && !cache?.has(concreteCacheKey)) {
    cache?.set(concreteCacheKey, active);
  }
  return unwrapped;
}

export async function unwrapHostedDomainRootForWebByRootKeyId(input: {
  domain: HostedCryptoDomain;
  prisma?: HostedCryptoClient;
  rootKeyId: string;
  signal?: AbortSignal;
  userId: string;
}): Promise<UnwrappedHostedDomainRoot> {
  if (!WEB_UNWRAP_DOMAINS.has(input.domain)) {
    throw new Error(`Web is not allowed to unwrap hosted ${input.domain} domain roots.`);
  }
  return unwrapWithScopedCache(
    `${input.userId}|${input.domain}|${input.rootKeyId}`,
    async () => {
      const envelope = await readHostedDomainRootEnvelopeByRootKeyIdOrThrow(input);
      const rootKey = await unwrapEnvelopeForWeb({ envelope, signal: input.signal });
      return { envelope, rootKey };
    },
  );
}

export async function unwrapHostedDomainRootsForWebByRootKeyIds(input: {
  prisma?: HostedCryptoClient;
  references: readonly HostedDomainRootReference[];
  /** Retains provider failures only for the lifetime of the active request scope. */
  retainFailureInScopedCache?: boolean;
  signal?: AbortSignal;
}): Promise<UnwrappedHostedDomainRootReference[]> {
  const referencesByKey = new Map<string, HostedDomainRootReference>();
  for (const reference of input.references) {
    if (!WEB_UNWRAP_DOMAINS.has(reference.domain)) {
      throw new Error(`Web is not allowed to unwrap hosted ${reference.domain} domain roots.`);
    }
    referencesByKey.set(createHostedDomainRootReferenceKey(reference), reference);
  }
  const references = [...referencesByKey.values()];
  if (references.length === 0) {
    return [];
  }

  const scopedCache = getHostedDomainRootUnwrapCache();
  const cachedBeforeMetadata = references.flatMap((reference) => {
    const cached = scopedCache?.get(createHostedDomainRootReferenceKey(reference));
    return cached ? [cached] : [];
  });
  if (cachedBeforeMetadata.length > 0) {
    const settledCached = await Promise.allSettled(cachedBeforeMetadata);
    const failedCached = settledCached.find((result) => result.status === "rejected");
    if (failedCached) {
      throw failedCached.reason;
    }
  }
  const cachedByKey = new Map(
    references.flatMap((reference) => {
      const key = createHostedDomainRootReferenceKey(reference);
      const cached = scopedCache?.get(key);
      return cached ? [[key, cached] as const] : [];
    }),
  );
  const uncachedReferences = references.filter((reference) =>
    !cachedByKey.has(createHostedDomainRootReferenceKey(reference))
  );
  const prisma = input.prisma ?? getPrisma();
  let rows: HostedUserCryptoEnvelopeRow[];
  try {
    rows = uncachedReferences.length > 0
      ? await readDecryptableHostedDomainRootEnvelopeRows({
          prisma,
          references: uncachedReferences,
        })
      : [];
  } catch (error) {
    retainHostedDomainRootReferenceFailure({
      cache: scopedCache,
      error,
      references: uncachedReferences,
      retain: input.retainFailureInScopedCache === true,
    });
    throw error;
  }
  const rowsByKey = new Map(
    rows.map((row) => [createHostedDomainRootReferenceKey(row), row] as const),
  );
  const verifiedByKey = new Map<string, HostedDomainRootKeyEnvelopeV1>();
  for (const reference of uncachedReferences) {
    try {
      const row = rowsByKey.get(createHostedDomainRootReferenceKey(reference));
      if (!row) {
        throw new HostedDomainRootEnvelopeUnavailableError({
          domain: reference.domain,
        });
      }
      verifiedByKey.set(
        createHostedDomainRootReferenceKey(reference),
        await parseAssertAndVerifyEnvelope(row, reference),
      );
    } catch (error) {
      retainHostedDomainRootReferenceFailure({
        cache: scopedCache,
        error,
        references: [reference],
        retain: input.retainFailureInScopedCache === true,
      });
      throw error;
    }
  }

  const unwrapped: UnwrappedHostedDomainRootReference[] = [];
  try {
    for (let offset = 0; offset < references.length; offset += WEB_BATCH_UNWRAP_CONCURRENCY) {
      const chunk = references.slice(offset, offset + WEB_BATCH_UNWRAP_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (reference) => {
          const cacheKey = createHostedDomainRootReferenceKey(reference);
          const cachedPromise = cachedByKey.get(cacheKey);
          if (cachedPromise) {
            const unwrappedRoot = await cachedPromise;
            return {
              ...reference,
              envelope: unwrappedRoot.envelope,
              rootKey: Uint8Array.from(unwrappedRoot.rootKey),
            };
          }
          const envelope = verifiedByKey.get(cacheKey);
          if (!envelope) {
            throw new HostedDomainRootEnvelopeUnavailableError({
              domain: reference.domain,
            });
          }
          const cached = await unwrapWithScopedCache(
            cacheKey,
            async () => ({
              envelope,
              rootKey: await unwrapEnvelopeForWeb({
                envelope,
                signal: input.signal,
              }),
            }),
            input.retainFailureInScopedCache,
          );
          return {
            ...reference,
            envelope,
            rootKey: cached.rootKey,
          };
        }),
      );
      let hasError = false;
      let firstError: unknown;
      for (const result of results) {
        if (result.status === "fulfilled") {
          unwrapped.push(result.value);
        } else if (!hasError) {
          hasError = true;
          firstError = result.reason;
        }
      }
      if (hasError) {
        throw firstError;
      }
    }
    return unwrapped;
  } catch (error) {
    for (const root of unwrapped) {
      root.rootKey.fill(0);
    }
    throw error;
  }
}

function retainHostedDomainRootReferenceFailure(input: {
  cache: ReturnType<typeof getHostedDomainRootUnwrapCache>;
  error: unknown;
  references: readonly HostedDomainRootReference[];
  retain: boolean;
}): void {
  if (!input.cache || !input.retain || input.references.length === 0) {
    return;
  }
  const rejected = Promise.reject<UnwrappedHostedDomainRoot>(input.error);
  void rejected.catch(() => undefined);
  for (const reference of input.references) {
    const cacheKey = createHostedDomainRootReferenceKey(reference);
    if (!input.cache.has(cacheKey)) {
      input.cache.set(cacheKey, rejected);
    }
  }
}

export async function readHostedRuntimeCryptoContextForWorker(input: {
  prisma?: HostedCryptoClient;
  userId: string;
}): Promise<{
  cacheMaxAgeMs: number;
  cryptoContextVersion: string;
  envelopes: {
    ingress: HostedDomainRootKeyEnvelopeV1;
    runtime: HostedDomainRootKeyEnvelopeV1;
  };
  schema: "murph.hosted-runtime-crypto-context.v1";
  userId: string;
}> {
  const prisma = input.prisma ?? getPrisma();
  const ingress = await readActiveHostedDomainRootEnvelopeRecordOrThrow({
    domain: "ingress",
    prisma,
    userId: input.userId,
  });
  const runtime = await readActiveHostedDomainRootEnvelopeRecordOrThrow({
    domain: "runtime",
    prisma,
    userId: input.userId,
  });
  return {
    cacheMaxAgeMs: HOSTED_RUNTIME_CRYPTO_CONTEXT_CACHE_MAX_AGE_MS,
    cryptoContextVersion: createHostedRuntimeCryptoContextVersion({
      ingress,
      runtime,
      userId: input.userId,
    }),
    envelopes: { ingress: ingress.envelope, runtime: runtime.envelope },
    schema: "murph.hosted-runtime-crypto-context.v1",
    userId: input.userId,
  };
}

async function provisionActiveHostedDomainRootEnvelopeForUserOnlyTx(input: {
  candidate?: HostedDomainRootKeyEnvelopeV1 | undefined;
  domain: HostedCryptoDomain;
  reason: string;
  tx: HostedCryptoTx;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  if (
    input.candidate
    && (input.candidate.domain !== input.domain || input.candidate.userId !== input.userId)
  ) {
    throw new Error("Prepared hosted domain root candidate does not match the requested user/domain.");
  }

  // The advisory lock orders contenders before the re-read, while the partial
  // unique active-envelope index is the database backstop. Because this is a
  // transaction-scoped lock, it remains held until the caller's outer
  // transaction ends. A prepared candidate is inserted here or discarded
  // here; it is never a reason to skip either boundary.
  await acquireHostedDomainRootAuthorityLockTx({
    domain: input.domain,
    tx: input.tx,
    userId: input.userId,
  });

  const existing = await readActiveHostedDomainRootEnvelopeRow({
    domain: input.domain,
    tx: input.tx,
    userId: input.userId,
  });
  if (existing) {
    return parseAssertAndVerifyEnvelope(existing, input);
  }

  if (!input.candidate) {
    throw new HostedCryptoDomainRootCandidateRequiredError({
      domain: input.domain,
    });
  }
  const created = input.candidate;
  const id = crypto.randomUUID();
  await input.tx.$executeRaw`
    INSERT INTO hosted_user_crypto_envelope (
      id,
      user_id,
      domain,
      root_key_id,
      status,
      signed_envelope_json,
      activated_at,
      updated_at
    ) VALUES (
      ${id},
      ${input.userId},
      ${input.domain}::hosted_crypto_domain,
      ${created.rootKeyId},
      'active'::hosted_crypto_envelope_status,
      ${JSON.stringify(created)}::jsonb,
      NOW(),
      NOW()
    )
  `;
  await recordHostedCryptoAuditTx({
    action: "domain-root.provisioned",
    actor: "web",
    domain: input.domain,
    reason: input.reason,
    recipientKinds: created.wraps.map((wrap) => wrap.recipient),
    rootKeyId: created.rootKeyId,
    tx: input.tx,
    userId: input.userId,
  });
  return created;
}

async function createSignedHostedDomainRootEnvelope(input: {
  domain: HostedCryptoDomain;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const config = getHostedWebCryptoConfig();
  const rootKey = generateHostedDomainRootKey();

  try {
    const rootKeyId = createHostedDomainRootKeyId(input.domain);
    const nowIso = new Date().toISOString();
    const wraps: HostedDomainRootKeyWrap[] = [];

    const kmsRecipient = kmsRecipientForDomain(input.domain);
    if (kmsRecipient) {
      const encryptionContext = buildHostedDomainRootWrapContext({
        domain: input.domain,
        env: config.env,
        recipient: kmsRecipient,
        rootKeyId,
        userId: input.userId,
      });
      const additionalAuthenticatedData = serializeAdditionalAuthenticatedData(encryptionContext);
      const encrypted = await config.gcpKms.encrypt({
        additionalAuthenticatedData,
        keyName: config.webWrapKmsKeyName,
        plaintext: rootKey,
      });
      wraps.push({
        additionalAuthenticatedData,
        ciphertextBlob: encrypted.ciphertext,
        encryptionContext,
        kind: "gcp-kms",
        kmsKeyName: config.webWrapKmsKeyName,
        recipient: kmsRecipient,
      });
    }

    if (input.domain === "ingress" || input.domain === "runtime") {
      const cloudflareAutomation = selectActiveHostedCloudflareAutomationRecipient(config);
      wraps.push(
        await createEcdhWrap({
          domain: input.domain,
          publicJwk: cloudflareAutomation.publicJwk,
          recipient: "cloudflare-automation-secret",
          recipientKeyId: cloudflareAutomation.recipientKeyId,
          rootKey,
          rootKeyId,
          userId: input.userId,
        }),
      );
    }

    if (
      (input.domain === "ingress" || input.domain === "runtime") &&
      config.teeRuntimePublicJwk &&
      config.teeRuntimeRecipientKeyId &&
      config.teeRuntimeAttestedPolicyId
    ) {
      wraps.push(
        await createEcdhWrap({
          domain: input.domain,
          publicJwk: config.teeRuntimePublicJwk,
          recipient: "tee-runtime-attested",
          recipientKeyId: config.teeRuntimeRecipientKeyId,
          rootKey,
          rootKeyId,
          teePolicyId: config.teeRuntimeAttestedPolicyId,
          userId: input.userId,
        }),
      );
    }

    if (config.recoveryPublicJwk && config.recoveryRecipientKeyId) {
      wraps.push(
        await createEcdhWrap({
          domain: input.domain,
          publicJwk: config.recoveryPublicJwk,
          recipient: "recovery-offline",
          recipientKeyId: config.recoveryRecipientKeyId,
          rootKey,
          rootKeyId,
          userId: input.userId,
        }),
      );
    }

    const body: HostedDomainRootKeyEnvelopeBodyV1 = {
      createdAt: nowIso,
      domain: input.domain,
      generation: 1,
      rootKeyId,
      schema: "murph.hosted-domain-root-key-envelope.v1",
      updatedAt: nowIso,
      userId: input.userId,
      wraps,
    };
    const signature = await config.gcpKms.asymmetricSign({
      keyVersionName: config.authoritySignKeyVersionName,
      message: buildHostedDomainRootEnvelopeSigningPayload(body),
    });
    return attachHostedDomainRootEnvelopeSignature({
      body,
      keyVersionName: signature.keyVersionName,
      signature: signature.signature,
      signedAt: nowIso,
    });
  } finally {
    rootKey.fill(0);
  }
}

async function createEcdhWrap(input: {
  domain: HostedCryptoDomain;
  publicJwk: JsonWebKey;
  recipient: "cloudflare-automation-secret" | "tee-runtime-attested" | "recovery-offline";
  recipientKeyId: string;
  rootKey: Uint8Array;
  rootKeyId: string;
  teePolicyId?: string | null;
  userId: string;
}): Promise<HostedEcdhWrappedDomainRootKey> {
  const config = getHostedWebCryptoConfig();
  const encryptionContext = buildHostedDomainRootWrapContext({
    domain: input.domain,
    env: config.env,
    recipient: input.recipient,
    rootKeyId: input.rootKeyId,
    userId: input.userId,
  });
  return wrapHostedDomainRootKeyWithP256Ecdh({
    encryptionContext,
    recipient: input.recipient,
    recipientKeyId: input.recipientKeyId,
    recipientPublicJwk: input.publicJwk,
    rootKey: input.rootKey,
    teePolicyId: input.teePolicyId ?? null,
  });
}

async function unwrapEnvelopeForWeb(input: {
  envelope: HostedDomainRootKeyEnvelopeV1;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const config = getHostedWebCryptoConfig();
  await verifyEnvelopeAuthoritySignature(input.envelope);
  const recipient = kmsRecipientForDomain(input.envelope.domain);
  if (!recipient) {
    throw new Error(`Web has no KMS recipient for hosted ${input.envelope.domain} roots.`);
  }
  const wrap = findHostedDomainRootWrap({ envelope: input.envelope, recipient });
  if (!wrap || wrap.kind !== "gcp-kms") {
    throw new Error(`Hosted ${input.envelope.domain} root envelope is missing ${recipient} wrap.`);
  }
  assertExpectedGcpKmsWrap({ envelope: input.envelope, recipient, wrap });
  const decrypted = await config.gcpKms.decrypt({
    additionalAuthenticatedData: wrap.additionalAuthenticatedData,
    ciphertext: wrap.ciphertextBlob,
    keyName: wrap.kmsKeyName,
    signal: input.signal,
  });
  if (decrypted.plaintext.byteLength !== 32) {
    decrypted.plaintext.fill(0);
    throw new Error(`Hosted ${input.envelope.domain} root GCP KMS decrypt returned invalid root length.`);
  }
  return decrypted.plaintext;
}

async function verifyEnvelopeAuthoritySignature(envelope: HostedDomainRootKeyEnvelopeV1): Promise<void> {
  const config = getHostedWebCryptoConfig();
  const publicKeyPem = selectHostedAuthorityVerifyPublicKeyPem({
    keyring: config.authorityVerifyKeyring,
    keyVersionName: envelope.authoritySignature.keyVersionName,
  });
  const valid = await verifyHostedDomainRootEnvelopeSignatureWithPublicKey({
    envelope,
    publicKeyPem,
  });
  if (!valid) {
    throw new Error("Hosted domain root envelope authority signature verification failed.");
  }
}

function assertExpectedGcpKmsWrap(input: {
  envelope: HostedDomainRootKeyEnvelopeV1;
  recipient: HostedCryptoKmsRecipientKind;
  wrap: HostedGcpKmsWrappedDomainRootKey;
}): void {
  const config = getHostedWebCryptoConfig();
  if (input.wrap.kmsKeyName !== config.webWrapKmsKeyName) {
    throw new Error(`Hosted ${input.envelope.domain} root envelope uses an unexpected GCP KMS key.`);
  }
  const expectedContext = buildHostedDomainRootWrapContext({
    domain: input.envelope.domain,
    env: config.env,
    recipient: input.recipient,
    rootKeyId: input.envelope.rootKeyId,
    userId: input.envelope.userId,
  });
  const expectedAad = serializeAdditionalAuthenticatedData(expectedContext);
  if (input.wrap.additionalAuthenticatedData !== expectedAad) {
    throw new Error("Hosted domain root KMS AAD mismatch.");
  }
  if (
    serializeAdditionalAuthenticatedData(input.wrap.encryptionContext)
    !== serializeAdditionalAuthenticatedData(expectedContext)
  ) {
    throw new Error("Hosted domain root KMS encryption context mismatch.");
  }
}

async function readActiveHostedCryptoDomains(input: {
  prisma: HostedCryptoClient;
  userId: string;
}): Promise<Set<HostedCryptoDomain>> {
  const rows = await input.prisma.$queryRaw<Array<{ domain: HostedCryptoDomain }>>`
    SELECT DISTINCT domain::text AS domain
    FROM hosted_user_crypto_envelope
    WHERE user_id = ${input.userId}
      AND status = 'active'::hosted_crypto_envelope_status
  `;
  return new Set(rows.map((row) => row.domain));
}

async function acquireHostedDomainRootAuthorityLockTx(input: {
  domain: HostedCryptoDomain;
  tx: Pick<Prisma.TransactionClient, "$executeRaw">;
  userId: string;
}): Promise<void> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${input.userId}), hashtext(${input.domain}))
  `;
}

async function readActiveHostedDomainRootEnvelopeRow(input: {
  domain: HostedCryptoDomain;
  tx: HostedCryptoClient;
  userId: string;
}): Promise<HostedUserCryptoEnvelopeRow | null> {
  const rows = await input.tx.$queryRaw<HostedUserCryptoEnvelopeRow[]>`
    SELECT
      id,
      user_id AS "userId",
      domain::text AS domain,
      root_key_id AS "rootKeyId",
      status::text AS status,
      signed_envelope_json AS "signedEnvelopeJson",
      updated_at AS "updatedAt"
    FROM hosted_user_crypto_envelope
    WHERE user_id = ${input.userId}
      AND domain = ${input.domain}::hosted_crypto_domain
      AND status = 'active'::hosted_crypto_envelope_status
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Holds the same transaction-scoped authority lock used by root provisioning,
 * then returns the exact active root id. This is a metadata-only revalidation
 * boundary: it performs no envelope verification, provider request, or KMS
 * unwrap and is intended for callers that already prepared the verified root
 * before opening their transaction.
 */
export async function lockAndReadActiveHostedDomainRootKeyIdTx(input: {
  domain: HostedCryptoDomain;
  tx: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;
  userId: string;
}): Promise<string | null> {
  await acquireHostedDomainRootAuthorityLockTx(input);
  const rows = await input.tx.$queryRaw<Array<{ rootKeyId: string }>>`
    SELECT root_key_id AS "rootKeyId"
    FROM hosted_user_crypto_envelope
    WHERE user_id = ${input.userId}
      AND domain = ${input.domain}::hosted_crypto_domain
      AND status = 'active'::hosted_crypto_envelope_status
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0]?.rootKeyId ?? null;
}

async function readDecryptableHostedDomainRootEnvelopeRow(input: {
  domain: HostedCryptoDomain;
  rootKeyId: string;
  tx: HostedCryptoClient;
  userId: string;
}): Promise<HostedUserCryptoEnvelopeRow | null> {
  const rows = await input.tx.$queryRaw<HostedUserCryptoEnvelopeRow[]>`
    SELECT
      id,
      user_id AS "userId",
      domain::text AS domain,
      root_key_id AS "rootKeyId",
      status::text AS status,
      signed_envelope_json AS "signedEnvelopeJson",
      updated_at AS "updatedAt"
    FROM hosted_user_crypto_envelope
    WHERE user_id = ${input.userId}
      AND domain = ${input.domain}::hosted_crypto_domain
      AND root_key_id = ${input.rootKeyId}
      AND status IN ('active'::hosted_crypto_envelope_status, 'decrypt_only'::hosted_crypto_envelope_status)
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function readDecryptableHostedDomainRootEnvelopeRows(input: {
  prisma: HostedCryptoClient;
  references: readonly HostedDomainRootReference[];
}): Promise<HostedUserCryptoEnvelopeRow[]> {
  return input.prisma.hostedUserCryptoEnvelope.findMany({
    where: {
      OR: input.references.map((reference) => ({
        domain: reference.domain,
        rootKeyId: reference.rootKeyId,
        userId: reference.userId,
      })),
      status: {
        in: ["active", "decrypt_only"],
      },
    },
    select: {
      domain: true,
      id: true,
      rootKeyId: true,
      signedEnvelopeJson: true,
      status: true,
      updatedAt: true,
      userId: true,
    },
  });
}

export async function readActiveHostedDomainRootEnvelopeOrThrow(input: {
  domain: HostedCryptoDomain;
  prisma?: HostedCryptoClient;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  return (await readActiveHostedDomainRootEnvelopeRecordOrThrow(input)).envelope;
}

async function readActiveHostedDomainRootEnvelopeRecordOrThrow(input: {
  domain: HostedCryptoDomain;
  prisma?: HostedCryptoClient;
  userId: string;
}): Promise<VerifiedHostedDomainRootEnvelopeRecord> {
  const prisma = input.prisma ?? getPrisma();
  const row = await readActiveHostedDomainRootEnvelopeRow({
    domain: input.domain,
    tx: prisma,
    userId: input.userId,
  });
  if (!row) {
    throw new HostedDomainRootEnvelopeUnavailableError({
      domain: input.domain,
    });
  }
  return {
    envelope: await parseAssertAndVerifyEnvelope(row, input),
    rootKeyId: row.rootKeyId,
    status: row.status,
    updatedAt: normalizeHostedCryptoRowTimestamp(row.updatedAt, "Hosted domain root envelope updatedAt"),
  };
}

export async function readHostedDomainRootEnvelopeByRootKeyIdOrThrow(input: {
  domain: HostedCryptoDomain;
  prisma?: HostedCryptoClient;
  rootKeyId: string;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const prisma = input.prisma ?? getPrisma();
  const row = await readDecryptableHostedDomainRootEnvelopeRow({
    domain: input.domain,
    rootKeyId: input.rootKeyId,
    tx: prisma,
    userId: input.userId,
  });
  if (!row) {
    throw new HostedDomainRootEnvelopeUnavailableError({
      domain: input.domain,
    });
  }
  return parseAssertAndVerifyEnvelope(row, input);
}

async function parseAssertAndVerifyEnvelope(
  row: HostedUserCryptoEnvelopeRow,
  expected: { domain: HostedCryptoDomain; rootKeyId?: string | null; userId: string },
): Promise<HostedDomainRootKeyEnvelopeV1> {
  const envelope = parseHostedDomainRootKeyEnvelope(row.signedEnvelopeJson);
  if (envelope.userId !== expected.userId || envelope.domain !== expected.domain) {
    throw new Error("Hosted domain root envelope row does not match requested user/domain.");
  }
  if (expected.rootKeyId && envelope.rootKeyId !== expected.rootKeyId) {
    throw new Error("Hosted domain root envelope row does not match requested rootKeyId.");
  }
  if (envelope.rootKeyId !== row.rootKeyId) {
    throw new Error("Hosted domain root envelope row rootKeyId mismatch.");
  }
  await verifyEnvelopeAuthoritySignature(envelope);
  return envelope;
}

function createHostedDomainRootReferenceKey(
  reference: Pick<HostedDomainRootReference, "domain" | "rootKeyId" | "userId">,
): string {
  return `${reference.userId}|${reference.domain}|${reference.rootKeyId}`;
}

async function recordHostedCryptoAuditTx(input: {
  action: string;
  actor: string;
  domain: HostedCryptoDomain;
  reason: string;
  recipientKinds: readonly HostedCryptoRecipientKind[];
  rootKeyId: string;
  tx: HostedCryptoTx;
  userId: string;
}): Promise<void> {
  await input.tx.$executeRaw`
    INSERT INTO hosted_user_crypto_audit (
      id,
      user_id,
      domain,
      root_key_id,
      action,
      actor,
      reason,
      recipient_kinds_json
    ) VALUES (
      ${crypto.randomUUID()},
      ${input.userId},
      ${input.domain}::hosted_crypto_domain,
      ${input.rootKeyId},
      ${input.action},
      ${input.actor},
      ${input.reason},
      ${JSON.stringify(input.recipientKinds)}::jsonb
    )
  `;
}

function kmsRecipientForDomain(domain: HostedCryptoDomain): HostedCryptoKmsRecipientKind | null {
  switch (domain) {
    case "control":
      return "web-control-kms";
    case "device":
      return "web-device-kms";
    case "ingress":
      return "web-ingress-kms";
    case "runtime":
      return null;
  }
}

function createHostedRuntimeCryptoContextVersion(input: {
  ingress: VerifiedHostedDomainRootEnvelopeRecord;
  runtime: VerifiedHostedDomainRootEnvelopeRecord;
  userId: string;
}): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    cryptoPolicyVersion: HOSTED_RUNTIME_CRYPTO_CONTEXT_POLICY_VERSION,
    ingressRootKeyId: input.ingress.envelope.rootKeyId,
    ingressSignedAt: input.ingress.envelope.authoritySignature.signedAt,
    ingressStatus: input.ingress.status,
    ingressUpdatedAt: input.ingress.updatedAt,
    runtimeRootKeyId: input.runtime.envelope.rootKeyId,
    runtimeSignedAt: input.runtime.envelope.authoritySignature.signedAt,
    runtimeStatus: input.runtime.status,
    runtimeUpdatedAt: input.runtime.updatedAt,
    schema: "murph.hosted-runtime-crypto-context.version.v1",
    userId: input.userId,
  }));
  return `hccv_${hash.digest("hex").slice(0, 32)}`;
}

function normalizeHostedCryptoRowTimestamp(value: Date | string, label: string): string {
  const timestampMs = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`${label} is invalid.`);
  }
  return new Date(timestampMs).toISOString();
}

function hasPrismaTransactionRoot(
  value: HostedCryptoClient,
): value is HostedCryptoClient & HostedCryptoTransactionRoot {
  const record = value as Record<string, unknown>;
  return typeof record.$transaction === "function";
}
