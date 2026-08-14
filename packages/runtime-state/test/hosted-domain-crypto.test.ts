import { Buffer } from "node:buffer";
import assert from "node:assert/strict";

import { expect, test } from "vitest";

import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  buildHostedSecureBoxAad,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  openHostedSecureBox,
  parseHostedDomainRootKeyEnvelope,
  sealHostedSecureBox,
  serializeAdditionalAuthenticatedData,
  verifyHostedDomainRootEnvelopeSignatureWithPublicKey,
  wrapHostedDomainRootKeyWithP256Ecdh,
  unwrapHostedDomainRootKeyWithP256Ecdh,
  type HostedDomainRootKeyEnvelopeBodyV1,
} from "../src/hosted-domain-crypto.ts";

test("hosted domain roots sign, verify, wrap, and unwrap by Cloudflare recipient", async () => {
  const recipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const rootKeyId = "udrk:ingress:test-root";
  const encryptionContext = buildHostedDomainRootWrapContext({
    domain: "ingress",
    env: "test",
    recipient: "cloudflare-automation-secret",
    rootKeyId,
    userId: "user-1",
  });

  const wrap = await wrapHostedDomainRootKeyWithP256Ecdh({
    encryptionContext,
    recipient: "cloudflare-automation-secret",
    recipientKeyId: "cf-key-v1",
    recipientPublicJwk: recipient.publicJwk,
    rootKey,
  });
  const now = "2026-05-01T00:00:00.000Z";
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: now,
    domain: "ingress",
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: now,
    userId: "user-1",
    wraps: [wrap],
  };
  const signature = await signHostedDomainRootBody(signer.privateKey, body);
  const envelope = attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    signature,
    signedAt: now,
  });

  const parsed = parseHostedDomainRootKeyEnvelope(envelope);
  assert.equal(parsed.wraps[0]?.recipient, "cloudflare-automation-secret");
  assert.equal(
    serializeAdditionalAuthenticatedData(encryptionContext),
    serializeAdditionalAuthenticatedData(wrap.encryptionContext),
  );
  assert.equal(
    await verifyHostedDomainRootEnvelopeSignatureWithPublicKey({
      envelope: parsed,
      publicKeyPem: signer.publicKeyPem,
    }),
    true,
  );
  assert.deepEqual(
    await unwrapHostedDomainRootKeyWithP256Ecdh({
      privateJwk: recipient.privateJwk,
      wrap,
    }),
    rootKey,
  );

  assert.equal(
    await verifyHostedDomainRootEnvelopeSignatureWithPublicKey({
      envelope: { ...parsed, updatedAt: "2026-05-01T00:01:00.000Z" },
      publicKeyPem: signer.publicKeyPem,
    }),
    false,
  );
  const malformedSignatureEnvelope = {
    ...parsed,
    authoritySignature: {
      ...parsed.authoritySignature,
      signature: "AA==",
    },
  };
  assert.equal(
    await verifyHostedDomainRootEnvelopeSignatureWithPublicKey({
      envelope: malformedSignatureEnvelope,
      publicKeyPem: signer.publicKeyPem,
    }),
    false,
  );
});

test("hosted domain crypto helpers fail closed for wrong lanes, private public keys, and aad", async () => {
  const recipient = await generateP256EcdhKeyPair();
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
  const aad = buildHostedSecureBoxAad({
    domain: "ingress",
    lane: "mailbox-payload",
    purpose: "test",
    scope: "mailbox:item-1",
    userId: "user-1",
  });

  expect(() =>
    buildHostedSecureBoxAad({
      domain: "runtime",
      lane: "mailbox-payload",
      purpose: "test",
      scope: "mailbox:item-1",
      userId: "user-1",
    }),
  ).toThrow(/mailbox-payload belongs to ingress, not runtime/u);

  await expect(
    wrapHostedDomainRootKeyWithP256Ecdh({
      encryptionContext: buildHostedDomainRootWrapContext({
        domain: "runtime",
        env: "test",
        recipient: "cloudflare-automation-secret",
        rootKeyId: "udrk:runtime:test-root",
        userId: "user-1",
      }),
      recipient: "cloudflare-automation-secret",
      recipientKeyId: "cf-key-v1",
      recipientPublicJwk: { ...recipient.publicJwk, d: "private" },
      rootKey,
    }),
  ).rejects.toThrow(/must be a public P-256 EC JWK/u);

  const envelope = await sealHostedSecureBox({
    aad,
    domain: "ingress",
    lane: "mailbox-payload",
    plaintext: new TextEncoder().encode("payload"),
    rootKey,
    rootKeyId: "udrk:ingress:test-root",
    scope: "mailbox:item-1",
  });

  assert.equal(
    new TextDecoder().decode(
      await openHostedSecureBox({
        aad,
        envelope,
        expectedDomain: "ingress",
        expectedLane: "mailbox-payload",
        rootKey,
      }),
    ),
    "payload",
  );

  const wrongAad = buildHostedSecureBoxAad({
    domain: "ingress",
    lane: "mailbox-payload",
    purpose: "other",
    scope: "mailbox:item-1",
    userId: "user-1",
  });
  await expect(
    openHostedSecureBox({
      aad: wrongAad,
      envelope,
      expectedDomain: "ingress",
      expectedLane: "mailbox-payload",
      rootKey,
    }),
  ).rejects.toThrow();
});

test("hosted meal-photo crypto is owned by the ingress domain", () => {
  expect(() =>
    buildHostedSecureBoxAad({
      domain: "runtime",
      lane: "meal-photo",
      purpose: "meal-photo",
      scope: "meal-photo:item-1",
      userId: "user-1",
    }),
  ).toThrow(/meal-photo belongs to ingress, not runtime/u);

  expect(
    buildHostedSecureBoxAad({
      domain: "ingress",
      lane: "meal-photo",
      purpose: "meal-photo",
      scope: "meal-photo:item-1",
      userId: "user-1",
    }),
  ).toBeInstanceOf(Uint8Array);
});

test("clinical page cursors use the device domain and round-trip through their dedicated lane", async () => {
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 7);
  const aad = buildHostedSecureBoxAad({
    domain: "device",
    lane: "clinical-records-page-cursor",
    purpose: "clinical-records-fhir-page:Observation",
    scope: "clinical-records:run-1:Observation:pageCursor",
    userId: "user-1",
  });
  const envelope = await sealHostedSecureBox({
    aad,
    domain: "device",
    lane: "clinical-records-page-cursor",
    plaintext: new TextEncoder().encode("opaque-page-cursor"),
    rootKey,
    rootKeyId: "udrk:device:test-root",
    scope: "clinical-records:run-1:Observation:pageCursor",
  });

  expect(new TextDecoder().decode(await openHostedSecureBox({
    aad,
    envelope,
    expectedDomain: "device",
    expectedLane: "clinical-records-page-cursor",
    rootKey,
  }))).toBe("opaque-page-cursor");
});

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

async function signHostedDomainRootBody(
  privateKey: CryptoKey,
  body: HostedDomainRootKeyEnvelopeBodyV1,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    privateKey,
    toArrayBuffer(buildHostedDomainRootEnvelopeSigningPayload(body)),
  );
  return Buffer.from(new Uint8Array(signature)).toString("base64");
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function toSpkiPem(value: ArrayBuffer): string {
  const base64 = Buffer.from(new Uint8Array(value)).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}
