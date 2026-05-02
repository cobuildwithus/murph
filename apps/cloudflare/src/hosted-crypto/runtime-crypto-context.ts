import {
  buildHostedDomainRootWrapContext,
  findHostedDomainRootWrap,
  parseHostedDomainRootKeyEnvelope,
  serializeAdditionalAuthenticatedData,
  unwrapHostedDomainRootKeyWithP256Ecdh,
  verifyHostedDomainRootEnvelopeSignatureWithPublicKey,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";

import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_CRYPTO_ROOT_PATH,
} from "@murphai/hosted-execution/routes";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";
import type {
  HostedWebCallbackSigningEnvironment,
} from "../web-callback-auth.ts";

export interface HostedWorkerCryptoEnv {
  HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION?: string;
  HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: string;
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: string;
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: string;
  HOSTED_CRYPTO_ENV: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

export interface HostedRuntimeCryptoContextResponse {
  envelopes: {
    ingress?: unknown;
    runtime?: unknown;
  };
  fetchedAt?: string;
  schema: "murph.hosted-runtime-crypto-context.v1";
  userId: string;
}

export interface HostedRuntimeCryptoRootResponse {
  domain: "ingress" | "runtime";
  envelope: unknown;
  fetchedAt?: string;
  rootKeyId: string;
  schema: "murph.hosted-runtime-crypto-root.v1";
  userId: string;
}

export interface UnwrappedHostedWorkerRuntimeRoots {
  ingress: {
    envelope: HostedDomainRootKeyEnvelopeV1;
    rootKey: Uint8Array;
  };
  runtime: {
    envelope: HostedDomainRootKeyEnvelopeV1;
    rootKey: Uint8Array;
  };
}

export async function fetchHostedWorkerRuntimeRoots(input: {
  baseUrl: string;
  callbackSigning: HostedWebCallbackSigningEnvironment;
  cryptoEnv: HostedWorkerCryptoEnv;
  allowHttpHosts?: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
  userId: string;
}): Promise<UnwrappedHostedWorkerRuntimeRoots> {
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    boundUserId: input.userId,
    allowHttpHosts: input.allowHttpHosts,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    timeoutMs: input.timeoutMs,
  });
  if (!response.ok) {
    throw new Error(`Hosted runtime crypto context fetch failed with HTTP ${response.status}.`);
  }
  const context = await response.json() as HostedRuntimeCryptoContextResponse;
  return unwrapHostedWorkerRuntimeRoots({
    context,
    env: input.cryptoEnv,
  });
}

export async function fetchHostedWorkerRuntimeRoot(input: {
  baseUrl: string;
  callbackSigning: HostedWebCallbackSigningEnvironment;
  cryptoEnv: HostedWorkerCryptoEnv;
  domain: "ingress" | "runtime";
  allowHttpHosts?: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
  userId: string;
}): Promise<{ envelope: HostedDomainRootKeyEnvelopeV1; rootKey: Uint8Array }> {
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    boundUserId: input.userId,
    allowHttpHosts: input.allowHttpHosts,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    timeoutMs: input.timeoutMs,
  });
  if (!response.ok) {
    throw new Error(`Hosted runtime crypto context fetch failed with HTTP ${response.status}.`);
  }
  return unwrapHostedWorkerRuntimeRoot({
    context: await response.json() as HostedRuntimeCryptoContextResponse,
    domain: input.domain,
    env: input.cryptoEnv,
  });
}

export async function fetchHostedWorkerRuntimeRootByRootKeyId(input: {
  baseUrl: string;
  callbackSigning: HostedWebCallbackSigningEnvironment;
  cryptoEnv: HostedWorkerCryptoEnv;
  domain: "ingress" | "runtime";
  rootKeyId: string;
  allowHttpHosts?: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
  userId: string;
}): Promise<{ envelope: HostedDomainRootKeyEnvelopeV1; rootKey: Uint8Array }> {
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body: JSON.stringify({
      domain: input.domain,
      rootKeyId: input.rootKeyId,
    }),
    boundUserId: input.userId,
    allowHttpHosts: input.allowHttpHosts,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_RUNTIME_CRYPTO_ROOT_PATH,
    timeoutMs: input.timeoutMs,
  });
  if (!response.ok) {
    throw new Error(`Hosted runtime crypto root fetch failed with HTTP ${response.status}.`);
  }
  const context = await response.json() as HostedRuntimeCryptoRootResponse;
  assertHostedRuntimeCryptoRootContext(context, {
    domain: input.domain,
    rootKeyId: input.rootKeyId,
    userId: input.userId,
  });
  return unwrapHostedWorkerRuntimeRootEnvelope({
    domain: input.domain,
    envelope: parseHostedDomainRootKeyEnvelope(context.envelope),
    env: input.cryptoEnv,
    userId: input.userId,
  });
}

export async function unwrapHostedWorkerRuntimeRoots(input: {
  context: HostedRuntimeCryptoContextResponse;
  env: HostedWorkerCryptoEnv;
}): Promise<UnwrappedHostedWorkerRuntimeRoots> {
  const ingressEnvelope = requireHostedRuntimeCryptoContextEnvelope(input.context, "ingress");
  const runtimeEnvelope = requireHostedRuntimeCryptoContextEnvelope(input.context, "runtime");
  const privateJwk = parseP256PrivateJwk(input.env.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK);
  const [ingress, runtime] = await Promise.all([
    unwrapWorkerDomainRoot({
      domain: "ingress",
      envelope: parseHostedDomainRootKeyEnvelope(ingressEnvelope),
      env: input.env,
      privateJwk,
      userId: input.context.userId,
    }),
    unwrapWorkerDomainRoot({
      domain: "runtime",
      envelope: parseHostedDomainRootKeyEnvelope(runtimeEnvelope),
      env: input.env,
      privateJwk,
      userId: input.context.userId,
    }),
  ]);
  return { ingress, runtime };
}

export async function unwrapHostedWorkerRuntimeRoot(input: {
  context: HostedRuntimeCryptoContextResponse;
  domain: "ingress" | "runtime";
  env: HostedWorkerCryptoEnv;
}): Promise<{ envelope: HostedDomainRootKeyEnvelopeV1; rootKey: Uint8Array }> {
  const envelope = requireHostedRuntimeCryptoContextEnvelope(input.context, input.domain);
  return unwrapHostedWorkerRuntimeRootEnvelope({
    domain: input.domain,
    envelope: parseHostedDomainRootKeyEnvelope(envelope),
    env: input.env,
    userId: input.context.userId,
  });
}

async function unwrapHostedWorkerRuntimeRootEnvelope(input: {
  domain: "ingress" | "runtime";
  envelope: HostedDomainRootKeyEnvelopeV1;
  env: HostedWorkerCryptoEnv;
  userId: string;
}): Promise<{ envelope: HostedDomainRootKeyEnvelopeV1; rootKey: Uint8Array }> {
  const privateJwk = parseP256PrivateJwk(input.env.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK);
  return await unwrapWorkerDomainRoot({
    domain: input.domain,
    envelope: input.envelope,
    env: input.env,
    privateJwk,
    userId: input.userId,
  });
}

async function unwrapWorkerDomainRoot(input: {
  domain: "ingress" | "runtime";
  envelope: HostedDomainRootKeyEnvelopeV1;
  env: HostedWorkerCryptoEnv;
  privateJwk: JsonWebKey;
  userId: string;
}): Promise<{ envelope: HostedDomainRootKeyEnvelopeV1; rootKey: Uint8Array }> {
  assertEnvelopeMatches({
    domain: input.domain,
    envelope: input.envelope,
    userId: input.userId,
  });
  if (!input.env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION && isHostedCryptoProductionEnv(input.env)) {
    throw new Error("HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION is required in production.");
  }
  if (
    input.env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION
    && input.envelope.authoritySignature.keyVersionName
      !== input.env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION
  ) {
    throw new Error(`Hosted ${input.domain} root envelope uses an unexpected authority signing key.`);
  }
  const valid = await verifyHostedDomainRootEnvelopeSignatureWithPublicKey({
    envelope: input.envelope,
    publicKeyPem: input.env.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM.replace(/\\n/g, "\n"),
  });
  if (!valid) {
    throw new Error(`Hosted ${input.domain} root envelope authority signature is invalid.`);
  }
  const wrap = findHostedDomainRootWrap({
    envelope: input.envelope,
    recipient: "cloudflare-automation-secret",
  });
  if (!wrap || wrap.kind !== "p256-ecdh-aesgcm") {
    throw new Error(`Hosted ${input.domain} root envelope is missing Cloudflare automation wrap.`);
  }
  if (wrap.recipientKeyId !== input.env.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID) {
    throw new Error(`Hosted ${input.domain} root envelope uses an unexpected Cloudflare automation key.`);
  }
  const expectedContext = buildHostedDomainRootWrapContext({
    domain: input.domain,
    env: input.env.HOSTED_CRYPTO_ENV,
    recipient: "cloudflare-automation-secret",
    rootKeyId: input.envelope.rootKeyId,
    userId: input.envelope.userId,
  });
  if (serializeAdditionalAuthenticatedData(expectedContext) !== serializeAdditionalAuthenticatedData(wrap.encryptionContext)) {
    throw new Error(`Hosted ${input.domain} root envelope wrap context mismatch.`);
  }
  const rootKey = await unwrapHostedDomainRootKeyWithP256Ecdh({
    privateJwk: input.privateJwk,
    wrap,
  });
  if (rootKey.byteLength !== 32) {
    throw new Error(`Hosted ${input.domain} root envelope decrypted to an invalid root length.`);
  }
  return { envelope: input.envelope, rootKey };
}

function isHostedCryptoProductionEnv(env: HostedWorkerCryptoEnv): boolean {
  const hostedCryptoEnv = normalizeProductionEnvValue(env.HOSTED_CRYPTO_ENV);
  return normalizeProductionEnvValue(env.NODE_ENV) === "production"
    || normalizeProductionEnvValue(env.VERCEL_ENV) === "production"
    || hostedCryptoEnv === "prod"
    || hostedCryptoEnv === "production";
}

function normalizeProductionEnvValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function assertEnvelopeMatches(input: {
  domain: "ingress" | "runtime";
  envelope: HostedDomainRootKeyEnvelopeV1;
  userId: string;
}): void {
  if (input.envelope.userId !== input.userId) {
    throw new Error("Hosted worker runtime crypto context userId mismatch.");
  }
  if (input.envelope.domain !== input.domain) {
    throw new Error(`Hosted worker runtime crypto context expected ${input.domain} envelope.`);
  }
}

function assertHostedRuntimeCryptoContext(value: HostedRuntimeCryptoContextResponse): void {
  if (value.schema !== "murph.hosted-runtime-crypto-context.v1") {
    throw new TypeError("Hosted runtime crypto context schema mismatch.");
  }
  if (!value.userId) {
    throw new TypeError("Hosted runtime crypto context userId is required.");
  }
  if (!value.envelopes || typeof value.envelopes !== "object") {
    throw new TypeError("Hosted runtime crypto context envelopes must be an object.");
  }
}

function assertHostedRuntimeCryptoRootContext(
  value: HostedRuntimeCryptoRootResponse,
  expected: { domain: "ingress" | "runtime"; rootKeyId: string; userId: string },
): void {
  if (value.schema !== "murph.hosted-runtime-crypto-root.v1") {
    throw new TypeError("Hosted runtime crypto root schema mismatch.");
  }
  if (value.userId !== expected.userId) {
    throw new TypeError("Hosted runtime crypto root userId mismatch.");
  }
  if (value.domain !== expected.domain) {
    throw new TypeError(`Hosted runtime crypto root expected ${expected.domain} envelope.`);
  }
  if (value.rootKeyId !== expected.rootKeyId) {
    throw new TypeError("Hosted runtime crypto root rootKeyId mismatch.");
  }
  if (!value.envelope) {
    throw new TypeError("Hosted runtime crypto root envelope is required.");
  }
}

function requireHostedRuntimeCryptoContextEnvelope(
  value: HostedRuntimeCryptoContextResponse,
  domain: "ingress" | "runtime",
): unknown {
  assertHostedRuntimeCryptoContext(value);
  const envelope = value.envelopes[domain];
  if (!envelope) {
    throw new TypeError(`Hosted runtime crypto context must include ${domain} envelope.`);
  }
  return envelope;
}

function parseP256PrivateJwk(value: string): JsonWebKey {
  const jwk = JSON.parse(value) as JsonWebKey;
  if (
    jwk.kty !== "EC"
    || jwk.crv !== "P-256"
    || typeof jwk.d !== "string"
    || typeof jwk.x !== "string"
    || typeof jwk.y !== "string"
    || jwk.d.length === 0
    || jwk.x.length === 0
    || jwk.y.length === 0
  ) {
    throw new TypeError("Cloudflare automation private JWK must be a P-256 EC private JWK with x, y, and d.");
  }
  return { crv: "P-256", d: jwk.d, kty: "EC", x: jwk.x, y: jwk.y };
}
