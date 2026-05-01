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
  unwrapHostedWorkerRuntimeRoots,
  type HostedRuntimeCryptoContextResponse,
  type HostedWorkerCryptoEnv,
} from "./runtime-crypto-context.ts";

type HostedWorkerRuntimeDomain = Extract<HostedCryptoDomain, "ingress" | "runtime">;

export interface HostedUserCryptoContext {
  envelope: HostedDomainRootKeyEnvelopeV1;
  keysById: Readonly<Record<string, Uint8Array>>;
  rootKey: Uint8Array;
  rootKeyId: string;
  ingressEnvelope: HostedDomainRootKeyEnvelopeV1;
  ingressKeysById: Readonly<Record<string, Uint8Array>>;
  ingressRootKey: Uint8Array;
  ingressRootKeyId: string;
  runtimeEnvelope: HostedDomainRootKeyEnvelopeV1;
  runtimeKeysById: Readonly<Record<string, Uint8Array>>;
  runtimeRootKey: Uint8Array;
  runtimeRootKeyId: string;
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

  const context = parseHostedRuntimeCryptoContextResponse(await response.json(), input.userId);
  const roots = await unwrapHostedWorkerRuntimeRoots({
    context,
    env: hostedWorkerCryptoEnvFromExecutionEnvironment({
      env: input.environment,
      userId: input.userId,
    }),
  });
  const selected = input.domain === "ingress" ? roots.ingress : roots.runtime;

  return {
    envelope: selected.envelope,
    keysById: { [selected.envelope.rootKeyId]: selected.rootKey },
    rootKey: selected.rootKey,
    rootKeyId: selected.envelope.rootKeyId,
    ingressEnvelope: roots.ingress.envelope,
    ingressKeysById: { [roots.ingress.envelope.rootKeyId]: roots.ingress.rootKey },
    ingressRootKey: roots.ingress.rootKey,
    ingressRootKeyId: roots.ingress.envelope.rootKeyId,
    runtimeEnvelope: roots.runtime.envelope,
    runtimeKeysById: { [roots.runtime.envelope.rootKeyId]: roots.runtime.rootKey },
    runtimeRootKey: roots.runtime.rootKey,
    runtimeRootKeyId: roots.runtime.envelope.rootKeyId,
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
  if (!("ingress" in record.envelopes) || !("runtime" in record.envelopes)) {
    throw new TypeError(
      "Hosted runtime crypto context response must include ingress and runtime envelopes.",
    );
  }
  return record as HostedRuntimeCryptoContextResponse;
}
