import assert from "node:assert/strict";

import { expect, test } from "vitest";

import {
  generateHostedUserRecipientKeyPair,
} from "../src/hosted-ecdh-jwk.ts";
import {
  HOSTED_BROWSER_SESSION_KEY_ENVELOPE_SCHEMA,
  HOSTED_BROWSER_SESSION_KEY_RECIPIENT_KIND,
  parseHostedBrowserSessionKeyEnvelope,
  unwrapHostedBrowserSessionKey,
  wrapHostedBrowserSessionKey,
} from "../src/hosted-browser-session-keys.ts";

test("hosted browser session keys wrap, parse, and unwrap for the browser-session recipient", async () => {
  const recipient = await generateHostedUserRecipientKeyPair();
  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const envelope = await wrapHostedBrowserSessionKey({
    keyBytes,
    keyId: "browser-session:v1",
    publicKeyJwk: recipient.publicKeyJwk,
    purpose: "browser-vault-replica",
    userId: "user-123",
  });

  const parsed = parseHostedBrowserSessionKeyEnvelope(envelope);

  assert.equal(parsed.schema, HOSTED_BROWSER_SESSION_KEY_ENVELOPE_SCHEMA);
  assert.equal(parsed.purpose, "browser-vault-replica");
  assert.equal(parsed.recipients[0]?.kind, HOSTED_BROWSER_SESSION_KEY_RECIPIENT_KIND);
  assert.equal(parsed.recipients[0]?.keyId, "browser-session:v1");
  assert.deepEqual(
    await unwrapHostedBrowserSessionKey({
      envelope: parsed,
      recipientPrivateKeyJwk: recipient.privateKeyJwk,
    }),
    keyBytes,
  );
});

test("hosted browser session key helpers reject malformed envelopes, missing recipients, and tampered payloads", async () => {
  const recipient = await generateHostedUserRecipientKeyPair();
  const otherRecipient = await generateHostedUserRecipientKeyPair();
  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
  const envelope = await wrapHostedBrowserSessionKey({
    keyBytes,
    keyId: "browser-session:v2",
    publicKeyJwk: recipient.publicKeyJwk,
    purpose: "browser-vault-replica",
    userId: "user-456",
  });

  await expect(
    wrapHostedBrowserSessionKey({
      keyBytes: new Uint8Array(31),
      keyId: "browser-session:v2",
      publicKeyJwk: recipient.publicKeyJwk,
      purpose: "browser-vault-replica",
      userId: "user-456",
    }),
  ).rejects.toThrow(/Hosted browser session key must be 32 bytes\./u);

  expect(() =>
    parseHostedBrowserSessionKeyEnvelope({
      ...envelope,
      schema: "wrong",
    }),
  ).toThrow(/Hosted browser session key envelope\.schema must be murph\.hosted-browser-session-key-envelope\.v1\./u);
  expect(() =>
    parseHostedBrowserSessionKeyEnvelope({
      ...envelope,
      purpose: "other-purpose",
    }),
  ).toThrow(/Hosted browser session key envelope\.purpose must be browser-vault-replica\./u);
  expect(() =>
    parseHostedBrowserSessionKeyEnvelope({
      ...envelope,
      recipients: "not-an-array",
    }),
  ).toThrow(/Hosted browser session key envelope\.recipients must be an array\./u);
  expect(() =>
    parseHostedBrowserSessionKeyEnvelope({
      ...envelope,
      recipients: [{ ...envelope.recipients[0], kind: "other" }],
    }),
  ).toThrow(/Hosted browser session key envelope\.recipients\[0\]\.kind must be browser-session\./u);

  await expect(
    unwrapHostedBrowserSessionKey({
      envelope: {
        ...envelope,
        recipients: [],
      },
      recipientPrivateKeyJwk: recipient.privateKeyJwk,
    }),
  ).rejects.toThrow(/Hosted browser session key envelope is missing a browser-session recipient\./u);

  await expect(
    unwrapHostedBrowserSessionKey({
      envelope: {
        ...envelope,
        recipients: [{
          ...envelope.recipients[0],
          ciphertext: envelope.recipients[0].ciphertext.slice(0, -2) + "AA",
        }],
      },
      recipientPrivateKeyJwk: recipient.privateKeyJwk,
    }),
  ).rejects.toThrow();

  await expect(
    unwrapHostedBrowserSessionKey({
      envelope,
      recipientPrivateKeyJwk: otherRecipient.privateKeyJwk,
    }),
  ).rejects.toThrow();
});
