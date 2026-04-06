import assert from "node:assert/strict";

import { test } from "vitest";

import {
  isHostedEmailInboundSenderAuthorized,
  normalizeHostedEmailAddress,
  normalizeHostedEmailMessageId,
  normalizeHostedEmailSubject,
  resolveHostedEmailAuthorizedSenderAddresses,
  resolveHostedEmailDirectSenderLookupAddress,
  resolveHostedEmailInboundSenderAddress,
} from "../src/index.ts";

test("hosted email sender helpers reject mismatched sender identities and normalize trusted addresses", () => {
  assert.equal(
    resolveHostedEmailInboundSenderAddress({
      envelopeFrom: "bounce@example.test",
      headerFrom: " Owner@example.test ",
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailInboundSenderAddress({
      envelopeFrom: "owner@example.test",
      headerFrom: " Owner@example.test ",
    }),
    normalizeHostedEmailAddress("owner@example.test"),
  );
  assert.deepEqual(
    resolveHostedEmailAuthorizedSenderAddresses({
      verifiedEmailAddress: "Owner@Example.Test",
    }),
    ["owner@example.test"],
  );
});

test("hosted email direct sender lookup requires one matching envelope and header sender", () => {
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      envelopeFrom: "owner@example.com",
      headerFrom: "Owner <owner@example.com>",
    }),
    "owner@example.com",
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      envelopeFrom: "owner@example.com",
      headerFrom: null,
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      envelopeFrom: null,
      headerFrom: "Owner <owner@example.com>",
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: true,
      headerFrom: "Owner <owner@example.com>",
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      envelopeFrom: "owner@example.com",
      headerFrom: "Attacker <attacker@example.com>",
    }),
    null,
  );
});

test("hosted email shared text normalization trims empty message ids and subjects", () => {
  assert.equal(
    normalizeHostedEmailMessageId("  <message@example.test>  "),
    "<message@example.test>",
  );
  assert.equal(normalizeHostedEmailSubject("  Subject line  "), "Subject line");
  assert.equal(normalizeHostedEmailMessageId("   "), null);
  assert.equal(normalizeHostedEmailSubject(undefined), null);
});

test("hosted email shared normalization rejects header-break injection strings", () => {
  assert.equal(
    normalizeHostedEmailAddress("owner@example.test\r\nBcc: attacker@example.test"),
    null,
  );
  assert.equal(
    normalizeHostedEmailMessageId("<message@example.test>\r\nBcc: attacker@example.test"),
    null,
  );
  assert.equal(
    normalizeHostedEmailSubject("Subject line\r\nBcc: attacker@example.test"),
    null,
  );
});

test("hosted email sender helpers authorize only the verified email", () => {
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      headerFrom: "owner@example.test",
      verifiedEmailAddress: "Owner@Example.Test",
    }),
    true,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      headerFrom: "friend@example.test",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      envelopeFrom: "teammate@example.test",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      headerFrom: "intruder@example.test",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      envelopeFrom: "intruder@example.test",
      headerFrom: "Owner <owner@example.test>",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      headerFrom: "Owner <owner@example.test>, Intruder <intruder@example.test>",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      envelopeFrom: "owner@example.test",
      hasRepeatedHeaderFrom: true,
      headerFrom: "owner@example.test",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      envelopeFrom: null,
      headerFrom: null,
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
});
