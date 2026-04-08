import assert from "node:assert/strict";

import { describe, expect, it, test } from "vitest";

import {
  createHostedUserRootKeyEnvelope,
  createHostedUserRootKeyId,
  findHostedWrappedRootKeyRecipient,
  generateHostedUserRecipientKeyPair,
  HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA,
  isHostedUserManagedRootKeyRecipientKind,
  parseHostedUserRootKeyEnvelope,
  parseHostedUserRecipientPrivateKeyJwk,
  parseHostedUserRecipientPublicKeyJwk,
  parseHostedWrappedRootKeyRecipient,
  unwrapHostedUserRootKeyForKind,
  unwrapHostedUserRootKeyRecipient,
  wrapHostedUserRootKeyRecipient,
} from "../src/hosted-user-keys.ts";

describe("parseHostedUserRootKeyEnvelope", () => {
  it("rejects duplicate recipient kinds", async () => {
    const automation = await generateHostedUserRecipientKeyPair();
    const { envelope } = await createHostedUserRootKeyEnvelope({
      recipients: [
        {
          keyId: "automation:v1",
          kind: "automation",
          publicKeyJwk: automation.publicKeyJwk,
        },
      ],
      userId: "user-1",
    });

    expect(() =>
      parseHostedUserRootKeyEnvelope({
        ...envelope,
        recipients: [envelope.recipients[0], envelope.recipients[0]],
      }),
    ).toThrow(/duplicate automation recipients/u);
  });
});

test("hosted user root key envelopes round-trip wrapping, parsing, and recipient lookup", async () => {
  const automation = await generateHostedUserRecipientKeyPair();
  const recovery = await generateHostedUserRecipientKeyPair();
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index);
  const { envelope } = await createHostedUserRootKeyEnvelope({
    createdAt: "2026-04-09T00:00:00.000Z",
    recipients: [
      {
        keyId: "automation:v1",
        kind: "automation",
        metadata: { priority: 1, primary: true, note: "bot", reserved: null },
        publicKeyJwk: automation.publicKeyJwk,
      },
      {
        keyId: "recovery:v1",
        kind: "recovery",
        publicKeyJwk: recovery.publicKeyJwk,
      },
    ],
    rootKey,
    rootKeyId: "urk:test",
    userId: "user-1",
  });

  const parsed = parseHostedUserRootKeyEnvelope(envelope);
  assert.equal(parsed.schema, HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA);
  assert.deepEqual(await unwrapHostedUserRootKeyForKind({
    envelope: parsed,
    kind: "automation",
    recipientPrivateKeyJwk: automation.privateKeyJwk,
  }), rootKey);

  const recoveryRecipient = findHostedWrappedRootKeyRecipient(parsed, "recovery");
  assert.ok(recoveryRecipient);
  assert.deepEqual(await unwrapHostedUserRootKeyRecipient({
    envelope: parsed,
    recipient: recoveryRecipient,
    recipientPrivateKeyJwk: recovery.privateKeyJwk,
  }), rootKey);
  assert.equal(findHostedWrappedRootKeyRecipient(parsed, "tee-automation"), null);
});

test("hosted user root key helpers validate recipient kinds and parse errors", async () => {
  const automation = await generateHostedUserRecipientKeyPair();
  const wrapped = await wrapHostedUserRootKeyRecipient({
    recipient: {
      keyId: "automation:v1",
      kind: "automation",
      publicKeyJwk: automation.publicKeyJwk,
    },
    rootKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    rootKeyId: "urk:test",
    userId: "user-1",
  });

  assert.match(createHostedUserRootKeyId(), /^urk:/u);
  assert.equal(isHostedUserManagedRootKeyRecipientKind("recovery"), true);
  assert.equal(isHostedUserManagedRootKeyRecipientKind("automation"), false);
  assert.deepEqual(parseHostedWrappedRootKeyRecipient(wrapped), wrapped);
  assert.deepEqual(parseHostedUserRecipientPublicKeyJwk({
    ...automation.publicKeyJwk,
    ext: true,
    key_ops: ["deriveBits"],
  }), {
    ...automation.publicKeyJwk,
    ext: true,
    key_ops: ["deriveBits"],
  });
  assert.deepEqual(parseHostedUserRecipientPrivateKeyJwk(automation.privateKeyJwk), automation.privateKeyJwk);

  assert.throws(
    () => parseHostedWrappedRootKeyRecipient({ ...wrapped, metadata: { bad: [] } }, "recipient"),
    /recipient\.metadata\.bad must be a scalar JSON value\./u,
  );
  assert.throws(
    () => parseHostedUserRecipientPublicKeyJwk({ ...automation.publicKeyJwk, ext: "yes" }, "publicKey"),
    /publicKey\.ext must be a boolean\./u,
  );
  assert.throws(
    () => parseHostedUserRecipientPublicKeyJwk({ ...automation.publicKeyJwk, key_ops: "deriveBits" }, "publicKey"),
    /publicKey\.key_ops must be an array\./u,
  );
  assert.throws(
    () => parseHostedUserRecipientPublicKeyJwk({ ...automation.publicKeyJwk, crv: "P-384" }, "publicKey"),
    /publicKey must be an EC P-256 public JWK\./u,
  );
  assert.throws(
    () => parseHostedUserRecipientPrivateKeyJwk({ ...automation.publicKeyJwk, d: "" }, "privateKey"),
    /privateKey\.d must be a non-empty string\./u,
  );
  assert.throws(
    () => parseHostedUserRootKeyEnvelope({
      createdAt: "2026-04-09T00:00:00.000Z",
      recipients: [wrapped],
      rootKeyId: "urk:test",
      schema: "wrong",
      updatedAt: "2026-04-09T00:00:00.000Z",
      userId: "user-1",
    }, "envelope"),
    /envelope\.schema must be murph\.hosted-user-root-key-envelope\.v2\./u,
  );
});

test("hosted user root key helpers fail closed on missing recipients and tampered payloads", async () => {
  const automation = await generateHostedUserRecipientKeyPair();
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
  const { envelope } = await createHostedUserRootKeyEnvelope({
    recipients: [
      {
        keyId: "automation:v1",
        kind: "automation",
        publicKeyJwk: automation.publicKeyJwk,
      },
    ],
    rootKey,
    rootKeyId: "urk:test",
    userId: "user-1",
  });

  await expect(unwrapHostedUserRootKeyForKind({
    envelope,
    kind: "recovery",
    recipientPrivateKeyJwk: automation.privateKeyJwk,
  })).rejects.toThrow(/missing a recovery recipient/u);

  await expect(wrapHostedUserRootKeyRecipient({
    recipient: {
      keyId: "automation:v1",
      kind: "automation",
      publicKeyJwk: automation.publicKeyJwk,
    },
    rootKey: new Uint8Array(31),
    rootKeyId: "urk:test",
    userId: "user-1",
  })).rejects.toThrow(/Hosted user root key must be 32 bytes\./u);

  await expect(unwrapHostedUserRootKeyRecipient({
    envelope,
    recipient: {
      ...envelope.recipients[0],
      ciphertext: envelope.recipients[0].ciphertext.slice(0, -2) + "AA",
    },
    recipientPrivateKeyJwk: automation.privateKeyJwk,
  })).rejects.toThrow();
});
