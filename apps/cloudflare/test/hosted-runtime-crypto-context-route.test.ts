import { Buffer } from "node:buffer";
import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_CRYPTO_ROOT_PATH,
} from "@murphai/hosted-execution/routes";
import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  requireHostedUserCryptoContextFromEnvironment,
} from "../src/hosted-crypto/runtime-user-crypto-context.ts";

import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

test("runtime user crypto context fetches signed ingress/runtime crypto context from web", async () => {
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const keyVersionName =
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: ingressRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/gu, "\\n"),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      cloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_ENV: "test",
  }));
  const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const [url, init] = args;
    assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, undefined);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-hosted-execution-user-id"), "user-1");
    assert.equal(headers.has("x-hosted-execution-signature"), true);
    return new Response(JSON.stringify({
      envelopes: { ingress },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    });
  });

  const crypto = await requireHostedUserCryptoContextFromEnvironment({
    domain: "ingress",
    environment,
    fetchImpl: fetchMock,
    reason: "test-runtime-context",
    userId: "user-1",
  });

  assert.deepEqual(crypto.rootKey, ingressRoot);
  assert.equal(crypto.domain, "ingress");
  assert.equal(crypto.rootKeyId, "udrk:ingress:test-root");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("runtime user crypto context resolves each root key id once through the exact root fetch path", async () => {
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const keyVersionName =
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const altRootKeyId = "udrk:ingress:alternate-root";
  const altRoot = Uint8Array.from({ length: 32 }, (_, index) => 200 + index);
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: ingressRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const alternate = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: altRoot,
    rootKeyId: altRootKeyId,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/gu, "\\n"),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      cloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_ENV: "test",
  }));
  const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const [url, init] = args;
    const headers = new Headers(init?.headers);

    if (String(url) === `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`) {
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, undefined);
      assert.equal(headers.get("x-hosted-execution-user-id"), "user-1");
      assert.equal(headers.has("x-hosted-execution-signature"), true);
      return new Response(JSON.stringify({
        envelopes: { ingress },
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId: "user-1",
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    }

    assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_ROOT_PATH}`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, JSON.stringify({
      domain: "ingress",
      rootKeyId: altRootKeyId,
    }));
    assert.equal(headers.get("x-hosted-execution-user-id"), "user-1");
    assert.equal(headers.has("x-hosted-execution-signature"), true);
    return new Response(JSON.stringify({
      domain: "ingress",
      envelope: alternate,
      fetchedAt: "2026-05-01T00:00:00.000Z",
      rootKeyId: altRootKeyId,
      schema: "murph.hosted-runtime-crypto-root.v1",
      userId: "user-1",
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    });
  });

  const crypto = await requireHostedUserCryptoContextFromEnvironment({
    domain: "ingress",
    environment,
    fetchImpl: fetchMock,
    reason: "test-runtime-context",
    userId: "user-1",
  });

  assert.deepEqual(crypto.rootKey, ingressRoot);
  expect(await crypto.resolveKeyById(crypto.rootKeyId)).toEqual(ingressRoot);
  expect(await crypto.resolveKeyById(altRootKeyId)).toEqual(altRoot);
  expect(await crypto.resolveKeyById(altRootKeyId)).toEqual(altRoot);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

async function createSignedWorkerEnvelope(input: {
  domain: "ingress" | "runtime";
  keyVersionName: string;
  publicJwk: JsonWebKey;
  rootKey: Uint8Array;
  rootKeyId?: string;
  signer: CryptoKey;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const rootKeyId = input.rootKeyId ?? `udrk:${input.domain}:test-root`;
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
  publicKeyPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: keyPair.privateKey,
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
