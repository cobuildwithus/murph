import { Buffer } from "node:buffer";

import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";

import {
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
  TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
} from "./hosted-execution-fixtures";

type RuntimeCryptoDomain = "ingress" | "runtime";

const TEST_RUNTIME_ROOTS: Record<RuntimeCryptoDomain, Uint8Array> = {
  ingress: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  runtime: Uint8Array.from({ length: 32 }, (_, index) => 101 + index),
};

export function getTestHostedRuntimeRootKey(domain: RuntimeCryptoDomain): Uint8Array {
  return TEST_RUNTIME_ROOTS[domain].slice();
}

export async function createTestHostedRuntimeCryptoContext(userId: string): Promise<{
  envelopes: {
    ingress: HostedDomainRootKeyEnvelopeV1;
    runtime: HostedDomainRootKeyEnvelopeV1;
  };
  schema: "murph.hosted-runtime-crypto-context.v1";
  userId: string;
}> {
  const signer = await importTestAuthoritySigningPrivateKey();
  return {
    envelopes: {
      ingress: await createSignedTestWorkerEnvelope({
        domain: "ingress",
        rootKey: TEST_RUNTIME_ROOTS.ingress,
        signer,
        userId,
      }),
      runtime: await createSignedTestWorkerEnvelope({
        domain: "runtime",
        rootKey: TEST_RUNTIME_ROOTS.runtime,
        signer,
        userId,
      }),
    },
    schema: "murph.hosted-runtime-crypto-context.v1",
    userId,
  };
}

async function createSignedTestWorkerEnvelope(input: {
  domain: RuntimeCryptoDomain;
  rootKey: Uint8Array;
  signer: CryptoKey;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const rootKeyId = `udrk:${input.domain}:test-root`;
  const now = "2026-05-01T00:00:00.000Z";
  const wrap = await wrapHostedDomainRootKeyWithP256Ecdh({
    encryptionContext: buildHostedDomainRootWrapContext({
      domain: input.domain,
      env: "test",
      recipient: "cloudflare-automation-secret",
      rootKeyId,
      userId: input.userId,
    }),
    recipient: "cloudflare-automation-secret",
    recipientKeyId: TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
    recipientPublicJwk: TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    rootKey: input.rootKey,
  });
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: now,
    domain: input.domain,
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: now,
    userId: input.userId,
    wraps: [wrap],
  };
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    input.signer,
    toArrayBuffer(buildHostedDomainRootEnvelopeSigningPayload(body)),
  );
  return attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: now,
  });
}

async function importTestAuthoritySigningPrivateKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    {
      ...TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
      key_ops: ["sign"],
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
