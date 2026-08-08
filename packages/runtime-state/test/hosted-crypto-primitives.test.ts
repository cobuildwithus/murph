import { Buffer } from "node:buffer";
import assert from "node:assert/strict";

import { expect, test } from "vitest";

import {
  assertHostedCryptoCompleteStandbyKeyringJsons,
  assertHostedCryptoStandbyKeyringJsons,
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  createHostedAuthorityVerifyKeyring,
  createHostedDataKeyEnvelopeWithDomainRoot,
  createHostedRecipientPrivateKeyring,
  createHostedRecipientPublicKeyring,
  generateHostedUserRecipientKeyPair,
  HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
  HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR,
  HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR,
  HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR,
  HOSTED_CRYPTO_COMPLETE_STANDBY_IDENTIFIERS_ERROR,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  parseHostedDataKeyEnvelope,
  selectHostedAuthorityVerifyPublicKeyPem,
  selectHostedRecipientPrivateKeyForDecrypt,
  unwrapHostedDomainRootKeyWithP256Ecdh,
  unwrapHostedDataKeyWithDomainRoot,
  verifyHostedDomainRootEnvelopeSignatureWithPublicKey,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedDomainRootKeyEnvelopeBodyV1,
} from "../src/index.ts";

const ROOT_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const OTHER_ROOT_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 101);
const ACTIVE_AUTHORITY_KEY_VERSION = "authority-v1";
const STANDBY_AUTHORITY_KEY_VERSION = "authority-v2";
const ACTIVE_CLOUDFLARE_KEY_ID = "cloudflare-automation:v1";
const STANDBY_CLOUDFLARE_KEY_ID = "cloudflare-automation:v2";

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
  const activeRecipient = await generateHostedUserRecipientKeyPair();
  const standbyRecipient = await generateHostedUserRecipientKeyPair();
  const activeSigner = await generateP256SigningKeyPair();
  const standbySigner = await generateP256SigningKeyPair();
  const authorityVerifyKeyringJson = JSON.stringify({
    [STANDBY_AUTHORITY_KEY_VERSION]: {
      publicKeyPem: standbySigner.publicKeyPem,
      status: "verify_only",
    },
  });
  const cloudflarePublicKeyringJson = JSON.stringify({
    [STANDBY_CLOUDFLARE_KEY_ID]: {
      publicJwk: standbyRecipient.publicKeyJwk,
      recipient: "cloudflare-automation-secret",
      recipientKeyId: STANDBY_CLOUDFLARE_KEY_ID,
      status: "disabled",
    },
  });
  const cloudflarePrivateKeyringJson = JSON.stringify({
    [STANDBY_CLOUDFLARE_KEY_ID]: {
      privateJwk: standbyRecipient.privateKeyJwk,
      recipient: "cloudflare-automation-secret",
      status: "decrypt_only",
    },
  });

  await expect(assertHostedCryptoCompleteStandbyKeyringJsons({
    activeAuthorityKeyVersionName: ACTIVE_AUTHORITY_KEY_VERSION,
    activeCloudflareRecipientKeyId: ACTIVE_CLOUDFLARE_KEY_ID,
    authorityVerifyKeyringJson,
    cloudflarePrivateKeyringJson,
    cloudflarePublicKeyringJson,
    proposedAuthorityKeyVersionName: STANDBY_AUTHORITY_KEY_VERSION,
    proposedCloudflareRecipientKeyId: STANDBY_CLOUDFLARE_KEY_ID,
  })).resolves.toBeUndefined();

  const authorityKeyring = createHostedAuthorityVerifyKeyring({
    activeKeyVersionName: ACTIVE_AUTHORITY_KEY_VERSION,
    activePublicKeyPem: activeSigner.publicKeyPem,
    keyringJson: authorityVerifyKeyringJson,
  });
  const publicKeyring = createHostedRecipientPublicKeyring({
    activePublicJwk: activeRecipient.publicKeyJwk,
    activeRecipient: "cloudflare-automation-secret",
    activeRecipientKeyId: ACTIVE_CLOUDFLARE_KEY_ID,
    keyringJson: cloudflarePublicKeyringJson,
  });
  const privateKeyring = createHostedRecipientPrivateKeyring({
    activePrivateJwk: activeRecipient.privateKeyJwk,
    activeRecipient: "cloudflare-automation-secret",
    activeRecipientKeyId: ACTIVE_CLOUDFLARE_KEY_ID,
    keyringJson: cloudflarePrivateKeyringJson,
  });
  const standbyAuthorityEntry = authorityKeyring[STANDBY_AUTHORITY_KEY_VERSION];
  const standbyPublicEntry = publicKeyring[STANDBY_CLOUDFLARE_KEY_ID];
  const standbyPrivateEntry = privateKeyring[STANDBY_CLOUDFLARE_KEY_ID];
  assert.ok(standbyAuthorityEntry);
  assert.ok(standbyPublicEntry);
  assert.ok(standbyPrivateEntry);
  assert.equal(
    standbyAuthorityEntry.status,
    "verify_only",
  );
  assert.equal(standbyPublicEntry.status, "disabled");
  assert.equal(standbyPrivateEntry.status, "decrypt_only");

  const wrap = await wrapHostedDomainRootKeyWithP256Ecdh({
    encryptionContext: buildHostedDomainRootWrapContext({
      domain: "ingress",
      env: "test",
      recipient: "cloudflare-automation-secret",
      rootKeyId: "udrk:ingress:standby",
      userId: "user-1",
    }),
    recipient: "cloudflare-automation-secret",
    recipientKeyId: STANDBY_CLOUDFLARE_KEY_ID,
    recipientPublicJwk: standbyPublicEntry.publicJwk,
    rootKey: ROOT_KEY,
  });
  const now = "2026-08-07T00:00:00.000Z";
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: now,
    domain: "ingress",
    generation: 2,
    rootKeyId: "udrk:ingress:standby",
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: now,
    userId: "user-1",
    wraps: [wrap],
  };
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    standbySigner.privateKey,
    toArrayBuffer(buildHostedDomainRootEnvelopeSigningPayload(body)),
  );
  const envelope = attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: STANDBY_AUTHORITY_KEY_VERSION,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: now,
  });
  expect(await verifyHostedDomainRootEnvelopeSignatureWithPublicKey({
    envelope,
    publicKeyPem: selectHostedAuthorityVerifyPublicKeyPem({
      keyVersionName: STANDBY_AUTHORITY_KEY_VERSION,
      keyring: authorityKeyring,
    }),
  })).toBe(true);
  assert.deepEqual(await unwrapHostedDomainRootKeyWithP256Ecdh({
    privateJwk: selectHostedRecipientPrivateKeyForDecrypt({
      keyring: privateKeyring,
      recipient: "cloudflare-automation-secret",
      recipientKeyId: STANDBY_CLOUDFLARE_KEY_ID,
    }).privateJwk,
    wrap,
  }), ROOT_KEY);

  const otherRecipient = await generateHostedUserRecipientKeyPair();
  expect(() => assertHostedCryptoStandbyKeyringJsons({
    activeAuthorityKeyVersionName: ACTIVE_AUTHORITY_KEY_VERSION,
    activeCloudflareRecipientKeyId: ACTIVE_CLOUDFLARE_KEY_ID,
    authorityVerifyKeyringJson,
    cloudflarePrivateKeyringJson: JSON.stringify({
      "cloudflare-automation:v2": {
        privateJwk: otherRecipient.privateKeyJwk,
        recipient: "cloudflare-automation-secret",
        status: "decrypt_only",
      },
    }),
    cloudflarePublicKeyringJson,
    proposedAuthorityKeyVersionName: STANDBY_AUTHORITY_KEY_VERSION,
    proposedCloudflareRecipientKeyId: STANDBY_CLOUDFLARE_KEY_ID,
    requireCompletePreload: true,
  })).toThrow(HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR);
});

test("complete standby acceptance rejects unusable exact key material", async () => {
  const standbyRecipient = await generateHostedUserRecipientKeyPair();
  const otherRecipient = await generateHostedUserRecipientKeyPair();
  const standbySigner = await generateP256SigningKeyPair();
  const authorityVerifyKeyringJson = JSON.stringify({
    [STANDBY_AUTHORITY_KEY_VERSION]: {
      publicKeyPem: standbySigner.publicKeyPem,
      status: "verify_only",
    },
  });
  const cloudflarePublicKeyringJson = JSON.stringify({
    [STANDBY_CLOUDFLARE_KEY_ID]: {
      publicJwk: standbyRecipient.publicKeyJwk,
      recipient: "cloudflare-automation-secret",
      status: "disabled",
    },
  });
  const cloudflarePrivateKeyringJson = JSON.stringify({
    [STANDBY_CLOUDFLARE_KEY_ID]: {
      privateJwk: standbyRecipient.privateKeyJwk,
      recipient: "cloudflare-automation-secret",
      status: "decrypt_only",
    },
  });
  const completeInput = {
    activeAuthorityKeyVersionName: ACTIVE_AUTHORITY_KEY_VERSION,
    activeCloudflareRecipientKeyId: ACTIVE_CLOUDFLARE_KEY_ID,
    authorityVerifyKeyringJson,
    cloudflarePrivateKeyringJson,
    cloudflarePublicKeyringJson,
    proposedAuthorityKeyVersionName: STANDBY_AUTHORITY_KEY_VERSION,
    proposedCloudflareRecipientKeyId: STANDBY_CLOUDFLARE_KEY_ID,
  } as const;

  const unusableInputs = [
    {
      expectedError: HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
      input: {
        ...completeInput,
        authorityVerifyKeyringJson: JSON.stringify({
          [STANDBY_AUTHORITY_KEY_VERSION]: {
            publicKeyPem:
              "-----BEGIN PUBLIC KEY-----\nauthority-private-canary\n-----END PUBLIC KEY-----",
            status: "verify_only",
          },
        }),
      },
    },
    {
      expectedError: HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR,
      input: {
        ...completeInput,
        cloudflarePrivateKeyringJson: JSON.stringify({
          [STANDBY_CLOUDFLARE_KEY_ID]: {
            privateJwk: {
              ...standbyRecipient.privateKeyJwk,
              d: "private-scalar-canary",
            },
            recipient: "cloudflare-automation-secret",
            status: "decrypt_only",
          },
        }),
      },
    },
    {
      expectedError: HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR,
      input: {
        ...completeInput,
        cloudflarePrivateKeyringJson: JSON.stringify({
          [STANDBY_CLOUDFLARE_KEY_ID]: {
            privateJwk: {
              ...standbyRecipient.privateKeyJwk,
              d: otherRecipient.privateKeyJwk.d,
            },
            recipient: "cloudflare-automation-secret",
            status: "decrypt_only",
          },
        }),
      },
    },
    {
      expectedError: HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR,
      input: {
        ...completeInput,
        cloudflarePrivateKeyringJson: JSON.stringify({
          [STANDBY_CLOUDFLARE_KEY_ID]: {
            privateJwk: {
              ...standbyRecipient.privateKeyJwk,
              x: "invalid-public-coordinate-canary",
              y: "invalid-public-coordinate-canary",
            },
            recipient: "cloudflare-automation-secret",
            status: "decrypt_only",
          },
        }),
        cloudflarePublicKeyringJson: JSON.stringify({
          [STANDBY_CLOUDFLARE_KEY_ID]: {
            publicJwk: {
              ...standbyRecipient.publicKeyJwk,
              x: "invalid-public-coordinate-canary",
              y: "invalid-public-coordinate-canary",
            },
            recipient: "cloudflare-automation-secret",
            status: "disabled",
          },
        }),
      },
    },
  ];

  for (const { expectedError, input } of unusableInputs) {
    let message = "";
    try {
      await assertHostedCryptoCompleteStandbyKeyringJsons(input);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe(expectedError);
    expect(message).not.toMatch(/canary/u);
  }
});

test.each([
  ["authority active-id collision", {
    activeAuthorityKeyVersionName: ACTIVE_AUTHORITY_KEY_VERSION,
    authorityVerifyKeyringJson: JSON.stringify({
      [ACTIVE_AUTHORITY_KEY_VERSION]: {
        publicKeyPem: "standby-secret-canary",
        status: "verify_only",
      },
    }),
  }, HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR],
  ["Cloudflare public active-id collision", {
    activeCloudflareRecipientKeyId: ACTIVE_CLOUDFLARE_KEY_ID,
    cloudflarePublicKeyringJson: JSON.stringify({
      [ACTIVE_CLOUDFLARE_KEY_ID]: {
        publicJwk: {
          crv: "P-256",
          kty: "EC",
          x: "standby-public-x",
          y: "standby-public-y",
        },
        recipient: "cloudflare-automation-secret",
        status: "disabled",
      },
    }),
  }, HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR],
  ["Cloudflare private active-id collision", {
    activeCloudflareRecipientKeyId: ACTIVE_CLOUDFLARE_KEY_ID,
    cloudflarePrivateKeyringJson: JSON.stringify({
      [ACTIVE_CLOUDFLARE_KEY_ID]: {
        privateJwk: {
          crv: "P-256",
          d: "standby-secret-canary",
          kty: "EC",
          x: "standby-public-x",
          y: "standby-public-y",
        },
        recipient: "cloudflare-automation-secret",
        status: "decrypt_only",
      },
    }),
  }, HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR],
] as const)("rejects %s", (_name, input, expectedError) => {
  expect(() => assertHostedCryptoStandbyKeyringJsons(input)).toThrow(
    expectedError,
  );
});

test("complete standby acceptance requires intended usable statuses and identifiers", async () => {
  const standbyRecipient = await generateHostedUserRecipientKeyPair();
  const cloudflarePublicKeyringJson = JSON.stringify({
    [STANDBY_CLOUDFLARE_KEY_ID]: {
      publicJwk: standbyRecipient.publicKeyJwk,
      recipient: "cloudflare-automation-secret",
      status: "disabled",
    },
  });
  const cloudflarePrivateKeyringJson = JSON.stringify({
    [STANDBY_CLOUDFLARE_KEY_ID]: {
      privateJwk: standbyRecipient.privateKeyJwk,
      recipient: "cloudflare-automation-secret",
      status: "decrypt_only",
    },
  });
  const validAuthorityJson = JSON.stringify({
    [STANDBY_AUTHORITY_KEY_VERSION]: {
      publicKeyPem:
        "-----BEGIN PUBLIC KEY-----\nstandby\n-----END PUBLIC KEY-----",
      status: "verify_only",
    },
  });
  const completeInput = {
    activeAuthorityKeyVersionName: ACTIVE_AUTHORITY_KEY_VERSION,
    activeCloudflareRecipientKeyId: ACTIVE_CLOUDFLARE_KEY_ID,
    authorityVerifyKeyringJson: validAuthorityJson,
    cloudflarePrivateKeyringJson,
    cloudflarePublicKeyringJson,
    proposedAuthorityKeyVersionName: STANDBY_AUTHORITY_KEY_VERSION,
    proposedCloudflareRecipientKeyId: STANDBY_CLOUDFLARE_KEY_ID,
    requireCompletePreload: true,
  } as const;

  expect(() => assertHostedCryptoStandbyKeyringJsons({
    ...completeInput,
    proposedAuthorityKeyVersionName: undefined,
  })).toThrow(HOSTED_CRYPTO_COMPLETE_STANDBY_IDENTIFIERS_ERROR);
  expect(() => assertHostedCryptoStandbyKeyringJsons({
    ...completeInput,
    authorityVerifyKeyringJson: JSON.stringify({
      [STANDBY_AUTHORITY_KEY_VERSION]: {
        publicKeyPem:
          "-----BEGIN PUBLIC KEY-----\nstandby\n-----END PUBLIC KEY-----",
        status: "disabled",
      },
    }),
  })).toThrow(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
  expect(() => assertHostedCryptoStandbyKeyringJsons({
    ...completeInput,
    cloudflarePrivateKeyringJson: JSON.stringify({
      [STANDBY_CLOUDFLARE_KEY_ID]: {
        privateJwk: standbyRecipient.privateKeyJwk,
        recipient: "cloudflare-automation-secret",
        status: "disabled",
      },
    }),
  })).toThrow(HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR);
  expect(() => assertHostedCryptoStandbyKeyringJsons({
    ...completeInput,
    authorityVerifyKeyringJson: JSON.stringify({
      [STANDBY_AUTHORITY_KEY_VERSION]: {
        publicKeyPem:
          "-----BEGIN PUBLIC KEY-----\nstandby\n-----END PUBLIC KEY-----",
        status: "verify_only",
      },
      [` ${STANDBY_AUTHORITY_KEY_VERSION} `]: {
        publicKeyPem:
          "-----BEGIN PUBLIC KEY-----\ndisabled\n-----END PUBLIC KEY-----",
        status: "disabled",
      },
    }),
  })).toThrow(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
  expect(() => assertHostedCryptoStandbyKeyringJsons({
    ...completeInput,
    cloudflarePrivateKeyringJson: JSON.stringify({
      [STANDBY_CLOUDFLARE_KEY_ID]: {
        privateJwk: standbyRecipient.privateKeyJwk,
        recipient: "cloudflare-automation-secret",
        status: "decrypt_only",
      },
      [` ${STANDBY_CLOUDFLARE_KEY_ID} `]: {
        privateJwk: standbyRecipient.privateKeyJwk,
        recipient: "cloudflare-automation-secret",
        status: "disabled",
      },
    }),
  })).toThrow(HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR);
  expect(() => assertHostedCryptoStandbyKeyringJsons({
    ...completeInput,
    authorityVerifyKeyringJson:
      `{"${STANDBY_AUTHORITY_KEY_VERSION}":{"publicKeyPem":"standby","status":"verify_only"},"${STANDBY_AUTHORITY_KEY_VERSION}":{"publicKeyPem":"disabled","status":"disabled"}}`,
  })).toThrow(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
  expect(() => assertHostedCryptoStandbyKeyringJsons({
    ...completeInput,
    authorityVerifyKeyringJson:
      '{"authority-v2":{"publicKeyPem":"standby","status":"verify_only"},"authority-\\u00762":{"publicKeyPem":"disabled","status":"disabled"}}',
  })).toThrow(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
  const privateEntryJson = JSON.stringify({
    privateJwk: standbyRecipient.privateKeyJwk,
    recipient: "cloudflare-automation-secret",
    status: "decrypt_only",
  });
  expect(() => assertHostedCryptoStandbyKeyringJsons({
    ...completeInput,
    cloudflarePrivateKeyringJson:
      `{"${STANDBY_CLOUDFLARE_KEY_ID}":${privateEntryJson},"${STANDBY_CLOUDFLARE_KEY_ID}":${privateEntryJson}}`,
  })).toThrow(HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR);
});

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
    publicKeyPem: toSpkiPem(
      await crypto.subtle.exportKey("spki", keyPair.publicKey),
    ),
  };
}

function toSpkiPem(value: ArrayBuffer): string {
  const base64 = Buffer.from(new Uint8Array(value)).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

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
