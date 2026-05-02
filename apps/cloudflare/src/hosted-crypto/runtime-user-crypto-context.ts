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
  unwrapHostedWorkerRuntimeRoot,
  type HostedRuntimeCryptoContextResponse,
  type HostedWorkerCryptoEnv,
} from "./runtime-crypto-context.ts";

type HostedWorkerRuntimeDomain = Extract<HostedCryptoDomain, "ingress" | "runtime">;

export interface HostedUserCryptoContext {
  domain: HostedWorkerRuntimeDomain;
  envelope: HostedDomainRootKeyEnvelopeV1;
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
  const response = await fetchHostedExecutionWebControlPlaneResponse({
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

  const domain = input.domain ?? "runtime";
  const hostedCryptoEnv = hostedWorkerCryptoEnvFromExecutionEnvironment({
    env: input.environment,
    userId: input.userId,
  });
  const context = parseHostedRuntimeCryptoContextResponse(
    await response.json(),
    input.userId,
    domain,
  );
  const root = await unwrapHostedWorkerRuntimeRoot({
    context,
    domain,
    env: hostedCryptoEnv,
  });
  const keysById = new Map<string, Uint8Array>([[root.envelope.rootKeyId, root.rootKey]]);

  return {
    domain,
    envelope: root.envelope,
    get keysById() {
      return Object.fromEntries(keysById.entries());
    },
    async resolveKeyById(rootKeyId) {
      const existing = keysById.get(rootKeyId);
      if (existing) {
        return existing;
      }
      const resolved = await fetchHostedWorkerRuntimeRootByRootKeyId({
        baseUrl: input.environment.hostedWebBaseUrl,
        callbackSigning: input.environment.webCallbackSigning,
        cryptoEnv: hostedCryptoEnv,
        domain,
        fetchImpl: input.fetchImpl,
        rootKeyId,
        timeoutMs: input.environment.webControlTimeoutMs,
        userId: input.userId,
      });
      keysById.set(resolved.envelope.rootKeyId, resolved.rootKey);
      return resolved.rootKey;
    },
    rootKey: root.rootKey,
    rootKeyId: root.envelope.rootKeyId,
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
