import { Buffer } from "node:buffer";
import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

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
  fetchHostedWorkerRuntimeRoots,
  unwrapHostedWorkerRuntimeRoots,
} from "../src/hosted-crypto/runtime-crypto-context.ts";
import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
} from "../src/hosted-crypto/routes.ts";

test("Cloudflare hosted runtime crypto context verifies signatures and unwraps ingress/runtime roots", async () => {
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const env = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      cloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_ENV: "test",
  };
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 100 + index);
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: ingressRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const runtime = await createSignedWorkerEnvelope({
    domain: "runtime",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: runtimeRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });

  const unwrapped = await unwrapHostedWorkerRuntimeRoots({
    context: {
      envelopes: { ingress, runtime },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    },
    env,
  });

  assert.deepEqual(unwrapped.ingress.rootKey, ingressRoot);
  assert.deepEqual(unwrapped.runtime.rootKey, runtimeRoot);

  await expect(
    unwrapHostedWorkerRuntimeRoots({
      context: {
        envelopes: { ingress: { ...ingress, updatedAt: "2026-05-01T00:01:00.000Z" }, runtime },
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId: "user-1",
      },
      env,
    }),
  ).rejects.toThrow(/authority signature is invalid/u);

  await expect(
    unwrapHostedWorkerRuntimeRoots({
      context: {
        envelopes: { ingress, runtime },
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId: "user-1",
      },
      env: { ...env, HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "other-key" },
    }),
  ).rejects.toThrow(/unexpected Cloudflare automation key/u);
});

test("Cloudflare hosted runtime crypto context is fetched from signed web control", async () => {
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const callbackSigner = await generateP256SigningKeyPair();
  const env = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      cloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_ENV: "test",
  };
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => 10 + index);
  const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 150 + index);
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: ingressRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const runtime = await createSignedWorkerEnvelope({
    domain: "runtime",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: runtimeRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const [url, init] = args;
    assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, undefined);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-hosted-execution-user-id"), "user-1");
    assert.equal(headers.has("x-hosted-execution-signature"), true);
    return new Response(JSON.stringify({
      envelopes: { ingress, runtime },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    });
  });

  const unwrapped = await fetchHostedWorkerRuntimeRoots({
    baseUrl: "https://web.example.test",
    callbackSigning: {
      keyId: "callback:v1",
      privateKeyJwkJson: JSON.stringify(callbackSigner.privateJwk),
    },
    cryptoEnv: env,
    fetchImpl: fetchMock,
    timeoutMs: null,
    userId: "user-1",
  });

  assert.deepEqual(unwrapped.ingress.rootKey, ingressRoot);
  assert.deepEqual(unwrapped.runtime.rootKey, runtimeRoot);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

async function createSignedWorkerEnvelope(input: {
  domain: "ingress" | "runtime";
  keyVersionName: string;
  publicJwk: JsonWebKey;
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
    recipientKeyId: "cf-key-v1",
    recipientPublicJwk: input.publicJwk,
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
    keyVersionName: input.keyVersionName,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: now,
  });
}

async function generateP256EcdhKeyPair(): Promise<{
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
  };
}

async function generateP256SigningKeyPair(): Promise<{
  privateKey: CryptoKey;
  privateJwk: JsonWebKey;
  publicKeyPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: keyPair.privateKey,
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicKeyPem: toSpkiPem(await crypto.subtle.exportKey("spki", keyPair.publicKey)),
  };
}

function toSpkiPem(value: ArrayBuffer): string {
  const base64 = Buffer.from(new Uint8Array(value)).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
