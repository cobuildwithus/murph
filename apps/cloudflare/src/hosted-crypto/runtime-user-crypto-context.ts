import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedCryptoDomain,
  HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";

import type { R2BucketLike } from "../bundle-store.js";
import type { HostedExecutionEnvironment } from "../env.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";
import {
  fetchHostedWorkerRuntimeRootByRootKeyId,
  HostedRuntimeCryptoRootUnavailableError,
  unwrapHostedWorkerRuntimeRoot,
  type HostedRuntimeCryptoContextResponse,
  type HostedWorkerCryptoEnv,
} from "./runtime-crypto-context.ts";

type HostedWorkerRuntimeDomain = Extract<HostedCryptoDomain, "ingress" | "runtime">;

const HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_AGE_MS = 60_000;
const HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_ENTRIES = 512;
const HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_ENTRY_BYTES = 64 * 1024;
const HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_FUTURE_SKEW_MS = 10_000;
const hostedRuntimeCryptoContextEnvelopeCacheTextEncoder = new TextEncoder();

interface HostedRuntimeCryptoContextEnvelopeCacheEntry {
  readonly byteLength: number;
  readonly expiresAtMs: number;
  readonly jsonText: string;
}

interface HostedRuntimeCryptoContextLoadResult {
  readonly cacheHit: boolean;
  readonly context: HostedRuntimeCryptoContextResponse;
}

const hostedRuntimeCryptoContextEnvelopeCache =
  new Map<string, HostedRuntimeCryptoContextEnvelopeCacheEntry>();
let hostedRuntimeCryptoContextEnvelopeCacheTotalBytes = 0;

export interface HostedUserCryptoContext {
  cacheMaxAgeMs: number;
  cryptoContextVersion: string | null;
  domain: HostedWorkerRuntimeDomain;
  envelope: HostedDomainRootKeyEnvelopeV1;
  fetchedAtMs: number;
  keysById: Readonly<Record<string, Uint8Array>>;
  resolveKeyById(rootKeyId: string): Promise<Uint8Array | null>;
  rootKey: Uint8Array;
  rootKeyId: string;
}

export class HostedUserCryptoRepairNeededError extends Error {
  readonly reason: string;
  readonly status: number | null;
  readonly userId: string;

  constructor(input: {
    message: string;
    reason: string;
    status?: number | null;
    userId: string;
  }) {
    super(input.message);
    this.name = "HostedUserCryptoRepairNeededError";
    this.reason = input.reason;
    this.status = input.status ?? null;
    this.userId = input.userId;
  }
}

export function isHostedUserCryptoContextExpired(
  context: Pick<HostedUserCryptoContext, "cacheMaxAgeMs" | "fetchedAtMs">,
  nowMs = Date.now(),
): boolean {
  if (!Number.isFinite(context.fetchedAtMs) || context.cacheMaxAgeMs <= 0) {
    return true;
  }

  return nowMs - context.fetchedAtMs >= context.cacheMaxAgeMs;
}

export function clearHostedRuntimeCryptoContextEnvelopeCacheForTests(): void {
  hostedRuntimeCryptoContextEnvelopeCache.clear();
  hostedRuntimeCryptoContextEnvelopeCacheTotalBytes = 0;
}

export async function requireHostedUserCryptoContextFromEnvironment(input: {
  bucket?: R2BucketLike;
  domain?: HostedWorkerRuntimeDomain;
  environment: HostedExecutionEnvironment;
  fetchImpl?: typeof fetch;
  reason: string;
  userId: string;
}): Promise<HostedUserCryptoContext> {
  void input.bucket;
  return fetchAndUnwrapRuntimeCryptoContext({
    domain: input.domain,
    environment: input.environment,
    fetchImpl: input.fetchImpl,
    reason: input.reason,
    userId: input.userId,
  });
}

async function fetchAndUnwrapRuntimeCryptoContext(input: {
  domain?: HostedWorkerRuntimeDomain;
  environment: HostedExecutionEnvironment;
  fetchImpl?: typeof fetch;
  reason: string;
  userId: string;
}): Promise<HostedUserCryptoContext> {
  const domain = input.domain ?? "runtime";
  const hostedCryptoEnv = hostedWorkerCryptoEnvFromExecutionEnvironment({
    env: input.environment,
    userId: input.userId,
  });

  const loaded = await loadHostedRuntimeCryptoContextEnvelope({
    cryptoEnv: hostedCryptoEnv,
    domain,
    environment: input.environment,
    fetchImpl: input.fetchImpl,
    reason: input.reason,
    userId: input.userId,
  });

  try {
    return await buildHostedUserCryptoContextFromLoadResult({
      cryptoEnv: hostedCryptoEnv,
      domain,
      environment: input.environment,
      fetchImpl: input.fetchImpl,
      loaded,
      userId: input.userId,
    });
  } catch (error) {
    if (!loaded.cacheHit) {
      throw error;
    }

    deleteHostedRuntimeCryptoContextEnvelopeCacheEntry({
      cryptoEnv: hostedCryptoEnv,
      domain,
      environment: input.environment,
      userId: input.userId,
    });

    const freshLoaded = await loadHostedRuntimeCryptoContextEnvelope({
      bypassCache: true,
      cryptoEnv: hostedCryptoEnv,
      domain,
      environment: input.environment,
      fetchImpl: input.fetchImpl,
      reason: input.reason,
      userId: input.userId,
    });

    return await buildHostedUserCryptoContextFromLoadResult({
      cryptoEnv: hostedCryptoEnv,
      domain,
      environment: input.environment,
      fetchImpl: input.fetchImpl,
      loaded: freshLoaded,
      userId: input.userId,
    });
  }
}

async function buildHostedUserCryptoContextFromLoadResult(input: {
  cryptoEnv: HostedWorkerCryptoEnv;
  domain: HostedWorkerRuntimeDomain;
  environment: HostedExecutionEnvironment;
  fetchImpl?: typeof fetch;
  loaded: HostedRuntimeCryptoContextLoadResult;
  userId: string;
}): Promise<HostedUserCryptoContext> {
  const userCryptoContext = await buildHostedUserCryptoContextFromResponse({
    context: input.loaded.context,
    domain: input.domain,
    environment: input.environment,
    fetchImpl: input.fetchImpl,
    hostedCryptoEnv: input.cryptoEnv,
    userId: input.userId,
  });

  if (!input.loaded.cacheHit) {
    maybeStoreHostedRuntimeCryptoContextEnvelopeCacheEntry({
      context: input.loaded.context,
      cryptoEnv: input.cryptoEnv,
      domain: input.domain,
      environment: input.environment,
      nowMs: Date.now(),
      userId: input.userId,
      verifiedEnvelope: userCryptoContext.envelope,
    });
  }

  return userCryptoContext;
}

async function buildHostedUserCryptoContextFromResponse(input: {
  context: HostedRuntimeCryptoContextResponse;
  domain: HostedWorkerRuntimeDomain;
  environment: HostedExecutionEnvironment;
  fetchImpl?: typeof fetch;
  hostedCryptoEnv: HostedWorkerCryptoEnv;
  userId: string;
}): Promise<HostedUserCryptoContext> {
  const root = await unwrapHostedWorkerRuntimeRoot({
    context: input.context,
    domain: input.domain,
    env: input.hostedCryptoEnv,
  });
  const keysById = new Map<string, Uint8Array>([[root.envelope.rootKeyId, root.rootKey]]);
  const nowMs = Date.now();
  const fetchedAtMs = resolveHostedRuntimeCryptoContextFetchedAtMs({
    context: input.context,
    nowMs,
  });
  const cacheMaxAgeMs = resolveHostedRuntimeCryptoContextMaxAgeMs(input.context);

  return {
    cacheMaxAgeMs,
    cryptoContextVersion: typeof input.context.cryptoContextVersion === "string"
      ? input.context.cryptoContextVersion
      : null,
    domain: input.domain,
    envelope: root.envelope,
    fetchedAtMs,
    get keysById() {
      return Object.fromEntries(keysById.entries());
    },
    async resolveKeyById(rootKeyId) {
      const existing = keysById.get(rootKeyId);
      if (existing) {
        return existing;
      }
      let resolved;
      try {
        resolved = await fetchHostedWorkerRuntimeRootByRootKeyId({
          ...(input.environment.hostedWebAllowHttpHosts
            ? { allowHttpHosts: input.environment.hostedWebAllowHttpHosts }
            : {}),
          baseUrl: input.environment.hostedWebBaseUrl,
          callbackSigning: input.environment.webCallbackSigning,
          cryptoEnv: input.hostedCryptoEnv,
          domain: input.domain,
          fetchImpl: input.fetchImpl,
          rootKeyId,
          timeoutMs: input.environment.webControlTimeoutMs,
          userId: input.userId,
        });
      } catch (error) {
        if (error instanceof HostedRuntimeCryptoRootUnavailableError) {
          return null;
        }
        throw error;
      }
      keysById.set(resolved.envelope.rootKeyId, resolved.rootKey);
      return resolved.rootKey;
    },
    rootKey: root.rootKey,
    rootKeyId: root.envelope.rootKeyId,
  };
}

async function loadHostedRuntimeCryptoContextEnvelope(input: {
  bypassCache?: boolean;
  cryptoEnv: HostedWorkerCryptoEnv;
  domain: HostedWorkerRuntimeDomain;
  environment: HostedExecutionEnvironment;
  fetchImpl?: typeof fetch;
  reason: string;
  userId: string;
}): Promise<HostedRuntimeCryptoContextLoadResult> {
  if (!input.bypassCache) {
    const cached = readHostedRuntimeCryptoContextEnvelopeCacheEntry({
      cryptoEnv: input.cryptoEnv,
      domain: input.domain,
      environment: input.environment,
      nowMs: Date.now(),
      userId: input.userId,
    });

    if (cached) {
      try {
        return {
          cacheHit: true,
          context: parseAndNormalizeHostedRuntimeCryptoContextJson(
            cached.jsonText,
            input.userId,
            input.domain,
          ),
        };
      } catch {
        deleteHostedRuntimeCryptoContextEnvelopeCacheEntry({
          cryptoEnv: input.cryptoEnv,
          domain: input.domain,
          environment: input.environment,
          userId: input.userId,
        });
      }
    }
  }

  const response = await fetchHostedExecutionWebControlPlaneResponse({
    ...(input.environment.hostedWebAllowHttpHosts
      ? { allowHttpHosts: input.environment.hostedWebAllowHttpHosts }
      : {}),
    baseUrl: input.environment.hostedWebBaseUrl,
    boundUserId: input.userId,
    callbackSigning: input.environment.webCallbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    timeoutMs: input.environment.webControlTimeoutMs,
  });

  if (!response.ok) {
    throw new HostedUserCryptoRepairNeededError({
      message: `Hosted runtime crypto context fetch failed with HTTP ${response.status}.`,
      reason: input.reason,
      status: response.status,
      userId: input.userId,
    });
  }

  return {
    cacheHit: false,
    context: parseAndNormalizeHostedRuntimeCryptoContextJson(
      await response.text(),
      input.userId,
      input.domain,
    ),
  };
}

function hostedWorkerCryptoEnvFromExecutionEnvironment(input: {
  env: HostedExecutionEnvironment;
  userId: string;
}): HostedWorkerCryptoEnv {
  if (!input.env.hostedCrypto) {
    throw new HostedUserCryptoRepairNeededError({
      message: "Hosted runtime crypto context is not configured.",
      reason: "missing-hosted-crypto-env",
      userId: input.userId,
    });
  }
  return input.env.hostedCrypto;
}

function parseHostedRuntimeCryptoContextResponse(
  value: unknown,
  expectedUserId: string,
  requiredDomain: HostedWorkerRuntimeDomain,
): HostedRuntimeCryptoContextResponse {
  if (!value || typeof value !== "object") {
    throw new TypeError("Hosted runtime crypto context response must be an object.");
  }
  const record = value as Partial<HostedRuntimeCryptoContextResponse>;
  if (record.schema !== "murph.hosted-runtime-crypto-context.v1") {
    throw new TypeError("Hosted runtime crypto context response schema mismatch.");
  }
  if (record.userId !== expectedUserId) {
    throw new TypeError("Hosted runtime crypto context response user mismatch.");
  }
  if (!record.envelopes || typeof record.envelopes !== "object") {
    throw new TypeError("Hosted runtime crypto context response envelopes must be an object.");
  }
  if (!(requiredDomain in record.envelopes)) {
    throw new TypeError(
      `Hosted runtime crypto context response must include ${requiredDomain} envelope.`,
    );
  }
  return record as HostedRuntimeCryptoContextResponse;
}

function parseHostedRuntimeCryptoContextJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new TypeError(
      `Hosted runtime crypto context response must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function parseAndNormalizeHostedRuntimeCryptoContextJson(
  value: string,
  userId: string,
  domain: HostedWorkerRuntimeDomain,
): HostedRuntimeCryptoContextResponse {
  return normalizeHostedRuntimeCryptoContextForCache(
    parseHostedRuntimeCryptoContextResponse(
      parseHostedRuntimeCryptoContextJson(value),
      userId,
      domain,
    ),
  );
}

function normalizeHostedRuntimeCryptoContextForCache(
  value: HostedRuntimeCryptoContextResponse,
  verifiedEnvelope?: {
    domain: HostedWorkerRuntimeDomain;
    envelope: HostedDomainRootKeyEnvelopeV1;
  },
): HostedRuntimeCryptoContextResponse {
  const envelopes: HostedRuntimeCryptoContextResponse["envelopes"] = {};

  if (verifiedEnvelope) {
    envelopes[verifiedEnvelope.domain] = verifiedEnvelope.envelope;
  } else {
    if (value.envelopes.ingress !== undefined) {
      envelopes.ingress = value.envelopes.ingress;
    }
    if (value.envelopes.runtime !== undefined) {
      envelopes.runtime = value.envelopes.runtime;
    }
  }

  return {
    ...(typeof value.cacheMaxAgeMs === "number" && Number.isFinite(value.cacheMaxAgeMs)
      ? { cacheMaxAgeMs: value.cacheMaxAgeMs }
      : {}),
    ...(typeof value.cryptoContextVersion === "string"
      ? { cryptoContextVersion: value.cryptoContextVersion }
      : {}),
    envelopes,
    ...(typeof value.fetchedAt === "string" ? { fetchedAt: value.fetchedAt } : {}),
    schema: value.schema,
    userId: value.userId,
  };
}

function readHostedRuntimeCryptoContextEnvelopeCacheEntry(input: {
  cryptoEnv: HostedWorkerCryptoEnv;
  domain: HostedWorkerRuntimeDomain;
  environment: Pick<HostedExecutionEnvironment, "hostedWebBaseUrl" | "webCallbackSigning">;
  nowMs: number;
  userId: string;
}): HostedRuntimeCryptoContextEnvelopeCacheEntry | null {
  const key = createHostedRuntimeCryptoContextEnvelopeCacheKey(input);
  const entry = hostedRuntimeCryptoContextEnvelopeCache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAtMs <= input.nowMs) {
    deleteHostedRuntimeCryptoContextEnvelopeCacheEntryByKey(key);
    return null;
  }

  return entry;
}

function maybeStoreHostedRuntimeCryptoContextEnvelopeCacheEntry(input: {
  context: HostedRuntimeCryptoContextResponse;
  cryptoEnv: HostedWorkerCryptoEnv;
  domain: HostedWorkerRuntimeDomain;
  environment: Pick<HostedExecutionEnvironment, "hostedWebBaseUrl" | "webCallbackSigning">;
  nowMs: number;
  userId: string;
  verifiedEnvelope: HostedDomainRootKeyEnvelopeV1;
}): void {
  const expiresAtMs = resolveHostedRuntimeCryptoContextEnvelopeCacheExpiresAtMs({
    context: input.context,
    nowMs: input.nowMs,
  });

  if (expiresAtMs === null) {
    return;
  }

  let jsonText: string;

  try {
    jsonText = JSON.stringify(
      normalizeHostedRuntimeCryptoContextForCache(input.context, {
        domain: input.domain,
        envelope: input.verifiedEnvelope,
      }),
    );
  } catch {
    return;
  }

  const byteLength = hostedRuntimeCryptoContextEnvelopeCacheTextEncoder
    .encode(jsonText).byteLength;

  if (
    byteLength <= 0
    || byteLength > HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_ENTRY_BYTES
    || byteLength > HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_TOTAL_BYTES
  ) {
    return;
  }

  const key = createHostedRuntimeCryptoContextEnvelopeCacheKey(input);

  deleteHostedRuntimeCryptoContextEnvelopeCacheEntryByKey(key);
  pruneHostedRuntimeCryptoContextEnvelopeCacheForInsert({
    incomingByteLength: byteLength,
    nowMs: input.nowMs,
  });

  hostedRuntimeCryptoContextEnvelopeCache.set(key, {
    byteLength,
    expiresAtMs,
    jsonText,
  });
  hostedRuntimeCryptoContextEnvelopeCacheTotalBytes += byteLength;
}

function deleteHostedRuntimeCryptoContextEnvelopeCacheEntry(input: {
  cryptoEnv: HostedWorkerCryptoEnv;
  domain: HostedWorkerRuntimeDomain;
  environment: Pick<HostedExecutionEnvironment, "hostedWebBaseUrl" | "webCallbackSigning">;
  userId: string;
}): void {
  deleteHostedRuntimeCryptoContextEnvelopeCacheEntryByKey(
    createHostedRuntimeCryptoContextEnvelopeCacheKey(input),
  );
}

function deleteHostedRuntimeCryptoContextEnvelopeCacheEntryByKey(key: string): void {
  const existing = hostedRuntimeCryptoContextEnvelopeCache.get(key);

  if (!existing) {
    return;
  }

  hostedRuntimeCryptoContextEnvelopeCache.delete(key);
  hostedRuntimeCryptoContextEnvelopeCacheTotalBytes = Math.max(
    0,
    hostedRuntimeCryptoContextEnvelopeCacheTotalBytes - existing.byteLength,
  );
}

function createHostedRuntimeCryptoContextEnvelopeCacheKey(input: {
  cryptoEnv: HostedWorkerCryptoEnv;
  domain: HostedWorkerRuntimeDomain;
  environment: Pick<HostedExecutionEnvironment, "hostedWebBaseUrl" | "webCallbackSigning">;
  userId: string;
}): string {
  return JSON.stringify([
    "hosted-runtime-crypto-context-envelope-cache:v1",
    input.environment.hostedWebBaseUrl,
    input.environment.webCallbackSigning.keyId,
    input.cryptoEnv.HOSTED_CRYPTO_ENV,
    input.cryptoEnv.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION ?? "",
    input.cryptoEnv.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
    input.domain,
    input.userId,
  ]);
}

function resolveHostedRuntimeCryptoContextMaxAgeMs(
  context: HostedRuntimeCryptoContextResponse,
): number {
  const advertisedMaxAgeMs =
    typeof context.cacheMaxAgeMs === "number" && Number.isFinite(context.cacheMaxAgeMs)
      ? Math.max(0, context.cacheMaxAgeMs)
      : 5 * 60 * 1000;

  return Math.min(
    advertisedMaxAgeMs,
    HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_AGE_MS,
  );
}

function resolveHostedRuntimeCryptoContextFetchedAtMs(input: {
  context: HostedRuntimeCryptoContextResponse;
  nowMs: number;
}): number {
  if (typeof input.context.fetchedAt !== "string") {
    return input.nowMs;
  }

  const parsedFetchedAtMs = Date.parse(input.context.fetchedAt);

  if (
    !Number.isFinite(parsedFetchedAtMs)
    || parsedFetchedAtMs
      > input.nowMs + HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_FUTURE_SKEW_MS
  ) {
    return input.nowMs;
  }

  return parsedFetchedAtMs;
}

function resolveHostedRuntimeCryptoContextEnvelopeCacheExpiresAtMs(input: {
  context: HostedRuntimeCryptoContextResponse;
  nowMs: number;
}): number | null {
  if (
    typeof input.context.cryptoContextVersion !== "string"
    || input.context.cryptoContextVersion.trim().length === 0
  ) {
    return null;
  }

  if (
    typeof input.context.cacheMaxAgeMs !== "number"
    || !Number.isFinite(input.context.cacheMaxAgeMs)
    || input.context.cacheMaxAgeMs <= 0
  ) {
    return null;
  }

  if (typeof input.context.fetchedAt !== "string") {
    return null;
  }

  const fetchedAtMs = Date.parse(input.context.fetchedAt);

  if (!Number.isFinite(fetchedAtMs)) {
    return null;
  }

  if (fetchedAtMs > input.nowMs + HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_FUTURE_SKEW_MS) {
    return null;
  }

  const cappedMaxAgeMs = Math.min(
    input.context.cacheMaxAgeMs,
    HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_AGE_MS,
  );
  const expiresAtMs = Math.min(
    input.nowMs + cappedMaxAgeMs,
    fetchedAtMs + cappedMaxAgeMs,
  );

  return expiresAtMs > input.nowMs ? expiresAtMs : null;
}

function pruneHostedRuntimeCryptoContextEnvelopeCacheForInsert(input: {
  incomingByteLength: number;
  nowMs: number;
}): void {
  for (const [key, entry] of hostedRuntimeCryptoContextEnvelopeCache) {
    if (entry.expiresAtMs <= input.nowMs) {
      deleteHostedRuntimeCryptoContextEnvelopeCacheEntryByKey(key);
    }
  }

  while (
    hostedRuntimeCryptoContextEnvelopeCache.size
      >= HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_ENTRIES
    || hostedRuntimeCryptoContextEnvelopeCacheTotalBytes + input.incomingByteLength
      > HOSTED_RUNTIME_CRYPTO_CONTEXT_ENVELOPE_CACHE_MAX_TOTAL_BYTES
  ) {
    const oldestKey = hostedRuntimeCryptoContextEnvelopeCache.keys().next().value;

    if (typeof oldestKey !== "string") {
      return;
    }

    deleteHostedRuntimeCryptoContextEnvelopeCacheEntryByKey(oldestKey);
  }
}
