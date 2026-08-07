import assert from "node:assert/strict";

import { expect, test } from "vitest";

import {
  assertHostedCryptoStandbyKeyringJsons,
  createHostedAuthorityVerifyKeyring,
  createHostedDataKeyEnvelopeWithDomainRoot,
  createHostedRecipientPrivateKeyring,
  generateHostedUserRecipientKeyPair,
  HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
  HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR,
  HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR,
  parseHostedDataKeyEnvelope,
  selectHostedAuthorityVerifyPublicKeyPem,
  selectHostedRecipientPrivateKeyForDecrypt,
  unwrapHostedDataKeyWithDomainRoot,
} from "../src/index.ts";

const ROOT_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const OTHER_ROOT_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 101);

test("hosted data-key envelopes wrap and unwrap random data keys with a domain root", async () => {
  const dataKey = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
  const { dataKey: returnedDataKey, envelope } =
    await createHostedDataKeyEnvelopeWithDomainRoot({
      dataKey,
      dataKeyId: "hdk:browser-vault-replica:test",
      domain: "runtime",
      lane: "browser-vault-replica",
      resource: {
        objectKey: "users/opaque/browser-vault-replicas/replica.json",
        purpose: "browser-vault-replica",
        userId: "user-1",
      },
      rootKey: ROOT_KEY,
      rootKeyId: "udrk:runtime:root-1",
    });

  assert.deepEqual(returnedDataKey, dataKey);
  assert.equal(envelope.schema, "murph.hosted-data-key-envelope.v1");
  assert.equal(envelope.dataKeyId, "hdk:browser-vault-replica:test");
  assert.equal(envelope.rootKeyId, "udrk:runtime:root-1");
  assert.equal(envelope.wraps.length, 1);
  assert.deepEqual(parseHostedDataKeyEnvelope(envelope), envelope);

  await expect(
    unwrapHostedDataKeyWithDomainRoot({
      envelope,
      rootKey: ROOT_KEY,
      rootKeyId: "udrk:runtime:root-1",
    }),
  ).resolves.toEqual(dataKey);

  await expect(
    unwrapHostedDataKeyWithDomainRoot({
      envelope,
      rootKey: OTHER_ROOT_KEY,
      rootKeyId: "udrk:runtime:root-1",
    }),
  ).rejects.toThrow();
});

test("hosted data-key envelopes fail closed on lane/domain and root mismatches", async () => {
  expect(() =>
    parseHostedDataKeyEnvelope({
      alg: "AES-256-GCM-HKDF-SHA256",
      dataKeyId: "hdk:browser-vault-replica:test",
      domain: "ingress",
      lane: "browser-vault-replica",
      resource: {
        purpose: "browser-vault-replica",
        userId: "user-1",
      },
      rootKeyId: "udrk:runtime:root-1",
      schema: "murph.hosted-data-key-envelope.v1",
      wraps: [{
        ciphertext: "abc",
        iv: "def",
        kind: "domain-root",
        rootKeyId: "udrk:runtime:root-1",
      }],
    }),
  ).toThrow(/belongs to runtime, not ingress/u);

  const { envelope } = await createHostedDataKeyEnvelopeWithDomainRoot({
    domain: "runtime",
    lane: "browser-vault-replica",
    resource: {
      purpose: "browser-vault-replica",
      userId: "user-1",
    },
    rootKey: ROOT_KEY,
    rootKeyId: "udrk:runtime:root-1",
  });

  await expect(
    unwrapHostedDataKeyWithDomainRoot({
      envelope,
      rootKey: ROOT_KEY,
      rootKeyId: "udrk:runtime:root-2",
    }),
  ).rejects.toThrow(/missing domain-root wrap udrk:runtime:root-2/u);
});

test("hosted crypto keyrings select old verify and decrypt keys by id", async () => {
  const activeRecipient = await generateHostedUserRecipientKeyPair();
  const oldRecipient = await generateHostedUserRecipientKeyPair();
  const authorityKeyring = createHostedAuthorityVerifyKeyring({
    activeKeyVersionName: "authority-v2",
    activePublicKeyPem: "-----BEGIN PUBLIC KEY-----\\nactive\\n-----END PUBLIC KEY-----",
    keyringJson: JSON.stringify({
      "authority-v1": {
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\\nold\\n-----END PUBLIC KEY-----",
        status: "verify_only",
      },
    }),
  });

  assert.equal(
    selectHostedAuthorityVerifyPublicKeyPem({
      keyring: authorityKeyring,
      keyVersionName: "authority-v1",
    }),
    "-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----",
  );

  const privateKeyring = createHostedRecipientPrivateKeyring({
    activePrivateJwk: activeRecipient.privateKeyJwk,
    activeRecipient: "cloudflare-automation-secret",
    activeRecipientKeyId: "cf-key-v2",
    keyringJson: JSON.stringify({
      "cf-key-v1": {
        privateJwk: oldRecipient.privateKeyJwk,
        recipient: "cloudflare-automation-secret",
        status: "decrypt_only",
      },
    }),
  });

  assert.equal(
    selectHostedRecipientPrivateKeyForDecrypt({
      keyring: privateKeyring,
      recipient: "cloudflare-automation-secret",
      recipientKeyId: "cf-key-v1",
    }).privateJwk.d,
    oldRecipient.privateKeyJwk.d,
  );

  expect(() =>
    selectHostedRecipientPrivateKeyForDecrypt({
      keyring: privateKeyring,
      recipient: "cloudflare-automation-secret",
      recipientKeyId: "cf-key-missing",
    }),
  ).toThrow(/not available for decrypt/u);
});

test("hosted crypto standby acceptance matches complete Cloudflare keypairs", async () => {
  const standbyRecipient = await generateHostedUserRecipientKeyPair();
  const authorityVerifyKeyringJson = JSON.stringify({
    "authority-v2": {
      publicKeyPem:
        "-----BEGIN PUBLIC KEY-----\nstandby\n-----END PUBLIC KEY-----",
      status: "verify_only",
    },
  });
  const cloudflarePublicKeyringJson = JSON.stringify({
    "cloudflare-automation:v2": {
      publicJwk: standbyRecipient.publicKeyJwk,
      recipient: "cloudflare-automation-secret",
      status: "disabled",
    },
  });
  const cloudflarePrivateKeyringJson = JSON.stringify({
    "cloudflare-automation:v2": {
      privateJwk: standbyRecipient.privateKeyJwk,
      recipient: "cloudflare-automation-secret",
      status: "decrypt_only",
    },
  });

  expect(() => assertHostedCryptoStandbyKeyringJsons({
    authorityVerifyKeyringJson,
    cloudflarePrivateKeyringJson,
    cloudflarePublicKeyringJson,
    requireCompletePreload: true,
  })).not.toThrow();

  const otherRecipient = await generateHostedUserRecipientKeyPair();
  expect(() => assertHostedCryptoStandbyKeyringJsons({
    authorityVerifyKeyringJson,
    cloudflarePrivateKeyringJson: JSON.stringify({
      "cloudflare-automation:v2": {
        privateJwk: otherRecipient.privateKeyJwk,
        recipient: "cloudflare-automation-secret",
        status: "decrypt_only",
      },
    }),
    cloudflarePublicKeyringJson,
    requireCompletePreload: true,
  })).toThrow(HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR);
});

test.each([
  [
    "malformed authority JSON",
    {
      authorityVerifyKeyringJson: '{"standby-secret-canary"',
    },
    HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
  ],
  [
    "active authority material",
    {
      authorityVerifyKeyringJson: JSON.stringify({
        "authority-v2": {
          publicKeyPem: "standby-secret-canary",
          status: "active",
        },
      }),
    },
    HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
  ],
  [
    "private material in the public ring",
    {
      cloudflarePublicKeyringJson: JSON.stringify({
        "cloudflare-automation:v2": {
          publicJwk: {
            crv: "P-256",
            d: "standby-secret-canary",
            kty: "EC",
            x: "public-x",
            y: "public-y",
          },
          recipient: "cloudflare-automation-secret",
          status: "disabled",
        },
      }),
    },
    HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR,
  ],
] as const)("rejects %s with a field-only error", (
  _name,
  input,
  expectedError,
) => {
  let message = "";
  try {
    assertHostedCryptoStandbyKeyringJsons(input);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).toBe(expectedError);
  expect(message).not.toContain("standby-secret-canary");
});
