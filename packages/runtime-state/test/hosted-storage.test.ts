import assert from "node:assert/strict";

import { expect, test } from "vitest";

import {
  buildHostedStorageAad,
  decryptHostedStoragePayload,
  deriveHostedStorageKey,
  deriveHostedStorageOpaqueId,
  encryptHostedStoragePayload,
  HOSTED_CIPHER_ENVELOPE_SCHEMA,
  parseHostedCipherEnvelope,
} from "../src/hosted-storage.ts";

const ROOT_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

test("hosted storage helpers derive stable keys, opaque ids, and canonical aad", async () => {
  const bundleKey = await deriveHostedStorageKey(ROOT_KEY, "bundle");
  const bundleKeyAgain = await deriveHostedStorageKey(ROOT_KEY, "bundle");
  const artifactKey = await deriveHostedStorageKey(ROOT_KEY, "artifact");

  assert.equal(bundleKey.length, 32);
  assert.deepEqual(bundleKeyAgain, bundleKey);
  assert.notDeepEqual(artifactKey, bundleKey);

  const opaqueId = await deriveHostedStorageOpaqueId({
    rootKey: ROOT_KEY,
    scope: "member",
    value: "value-1",
  });
  const opaqueIdAgain = await deriveHostedStorageOpaqueId({
    rootKey: ROOT_KEY,
    scope: "member",
    value: "value-1",
  });
  const shortOpaqueId = await deriveHostedStorageOpaqueId({
    length: 16,
    rootKey: ROOT_KEY,
    scope: "member",
    value: "value-1",
  });

  assert.equal(opaqueId.length, 48);
  assert.equal(opaqueIdAgain, opaqueId);
  assert.equal(shortOpaqueId, opaqueId.slice(0, 16));

  const aad = buildHostedStorageAad({
    alpha: 1,
    bravo: undefined,
    charlie: null,
    delta: true,
  });

  assert.equal(
    new TextDecoder().decode(aad),
    JSON.stringify({
      alpha: 1,
      charlie: null,
      delta: true,
    }),
  );
});

test("hosted storage payloads round-trip with aad and keyring lookup", async () => {
  const plaintext = new TextEncoder().encode("hosted payload");
  const aad = buildHostedStorageAad({
    scope: "bundle",
    userId: "user-1",
  });

  const envelope = await encryptHostedStoragePayload({
    aad,
    key: ROOT_KEY,
    keyId: "key-v1",
    plaintext,
    scope: "bundle",
  });

  assert.equal(envelope.algorithm, "AES-GCM");
  assert.equal(envelope.schema, HOSTED_CIPHER_ENVELOPE_SCHEMA);
  assert.equal(envelope.scope, "bundle");

  const decrypted = await decryptHostedStoragePayload({
    aad,
    envelope,
    expectedKeyId: "key-v1",
    key: Uint8Array.from(ROOT_KEY),
    keysById: {
      "key-v1": ROOT_KEY,
    },
    scope: "bundle",
  });

  assert.deepEqual(decrypted, plaintext);
});

test("hosted cipher key IDs accept portable grammar boundaries", async () => {
  for (const keyId of [
    "a",
    "A0._:-z",
    "k".repeat(256),
  ]) {
    const envelope = await encryptHostedStoragePayload({
      key: ROOT_KEY,
      keyId,
      plaintext: new TextEncoder().encode("payload"),
      scope: "artifact",
    });

    assert.equal(envelope.keyId, keyId);
    assert.equal(parseHostedCipherEnvelope(envelope).keyId, keyId);
  }
});

test("hosted meal photos use a dedicated storage scope", async () => {
  const plaintext = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const aad = buildHostedStorageAad({
    mealPhotoKey: "meal-photo-1",
    userId: "user-1",
  });
  const envelope = await encryptHostedStoragePayload({
    aad,
    key: ROOT_KEY,
    keyId: "key-v1",
    plaintext,
    scope: "meal-photo",
  });

  assert.equal(envelope.scope, "meal-photo");
  assert.deepEqual(
    await decryptHostedStoragePayload({
      aad,
      envelope,
      expectedKeyId: "key-v1",
      key: ROOT_KEY,
      scope: "meal-photo",
    }),
    plaintext,
  );
});

test("hosted storage parsing and decryption fail closed on invalid envelopes", async () => {
  assert.throws(
    () => parseHostedCipherEnvelope(null),
    /Hosted cipher envelope must be an object\./u,
  );
  assert.throws(
    () =>
      parseHostedCipherEnvelope({
        algorithm: "ChaCha20",
        ciphertext: "abc",
        iv: "def",
        keyId: "key-v1",
        schema: HOSTED_CIPHER_ENVELOPE_SCHEMA,
        scope: "bundle",
      }),
    /Hosted cipher envelope\.algorithm must be AES-GCM\./u,
  );
  assert.throws(
    () =>
      parseHostedCipherEnvelope({
        algorithm: "AES-GCM",
        ciphertext: "abc",
        iv: "def",
        keyId: "key-v1",
        schema: "wrong",
        scope: "bundle",
      }),
    /Hosted cipher envelope\.schema must be murph\.hosted-cipher\.v1\./u,
  );
  assert.throws(
    () =>
      parseHostedCipherEnvelope({
        algorithm: "AES-GCM",
        ciphertext: "abc",
        iv: "def",
        keyId: "key-v1",
        schema: HOSTED_CIPHER_ENVELOPE_SCHEMA,
        scope: "wrong",
      }),
    /Hosted cipher envelope\.scope must be a supported hosted storage scope\./u,
  );
  assert.throws(
    () =>
      parseHostedCipherEnvelope({
        algorithm: "AES-GCM",
        ciphertext: "abc",
        iv: "def",
        keyId: "key-v1",
        schema: HOSTED_CIPHER_ENVELOPE_SCHEMA,
        scope: "root-key-recipient",
      }),
    /Hosted cipher envelope\.scope must be a supported hosted storage scope\./u,
  );
  for (const [keyId, message] of [
    [" ", /Hosted cipher envelope\.keyId must be a 1-256 character portable identifier\./u],
    [" key-v1", /Hosted cipher envelope\.keyId must be a 1-256 character portable identifier\./u],
    ["key-v1 ", /Hosted cipher envelope\.keyId must be a 1-256 character portable identifier\./u],
    ["k".repeat(257), /Hosted cipher envelope\.keyId must be a 1-256 character portable identifier\./u],
    ["udrk:runtime:\0bad", /Hosted cipher envelope\.keyId must be a 1-256 character portable identifier\./u],
    ["udrk:runtime:résumé", /Hosted cipher envelope\.keyId must be a 1-256 character portable identifier\./u],
  ] as const) {
    assert.throws(
      () =>
        parseHostedCipherEnvelope({
          algorithm: "AES-GCM",
          ciphertext: "abc",
          iv: "def",
          keyId,
          schema: HOSTED_CIPHER_ENVELOPE_SCHEMA,
          scope: "artifact",
        }),
      message,
    );
  }
  await expect(
    encryptHostedStoragePayload({
      key: ROOT_KEY,
      keyId: "udrk:runtime:\0bad",
      plaintext: new TextEncoder().encode("payload"),
      scope: "artifact",
    }),
  ).rejects.toThrow(
    /Hosted cipher envelope\.keyId must be a 1-256 character portable identifier\./u,
  );
  const aad = buildHostedStorageAad({ scope: "bundle" });
  const envelope = await encryptHostedStoragePayload({
    aad,
    key: ROOT_KEY,
    keyId: "key-v1",
    plaintext: new TextEncoder().encode("payload"),
    scope: "bundle",
  });

  await expect(
    decryptHostedStoragePayload({
      aad,
      envelope,
      key: ROOT_KEY,
      scope: "artifact",
    }),
  ).rejects.toThrow(/scope mismatch: expected artifact, got bundle/u);

  await expect(
    decryptHostedStoragePayload({
      aad,
      envelope,
      expectedKeyId: "key-v1",
      key: ROOT_KEY,
      keysById: {
        "other-key": ROOT_KEY,
      },
      scope: "bundle",
    }),
  ).rejects.toThrow(/expected key-v1, got key-v1/u);

  await expect(
    decryptHostedStoragePayload({
      aad,
      envelope,
      expectedKeyId: "key-v2",
      key: ROOT_KEY,
      scope: "bundle",
    }),
  ).rejects.toThrow(
    /expected key-v2, got key-v1\. No keyring is configured for multi-key decryption\./u,
  );
});
