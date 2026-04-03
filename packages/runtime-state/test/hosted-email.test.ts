import assert from "node:assert/strict";

import { test } from "vitest";

import {
  createHostedEmailThreadTarget,
  isHostedEmailInboundSenderAuthorized,
  normalizeHostedEmailAddress,
  normalizeHostedEmailMessageId,
  normalizeHostedEmailRouteKey,
  normalizeHostedEmailSubject,
  resolveHostedEmailAuthorizedSenderAddresses,
  resolveHostedEmailDirectSenderLookupAddress,
  resolveHostedEmailInboundSenderAddress,
} from "../src/index.ts";

test("hosted email sender helpers reject mismatched sender identities and normalize trusted addresses", () => {
  const threadTarget = createHostedEmailThreadTarget({
    cc: [" Friend@example.test "],
    to: ["Teammate@example.test"],
  });

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
      threadTarget,
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

test("hosted email shared text normalization trims empty message ids, route keys, and subjects", () => {
  assert.equal(
    normalizeHostedEmailMessageId("  <message@example.test>  "),
    "<message@example.test>",
  );
  assert.equal(normalizeHostedEmailRouteKey("  reply-key  "), "reply-key");
  assert.equal(normalizeHostedEmailSubject("  Subject line  "), "Subject line");
  assert.equal(normalizeHostedEmailMessageId("   "), null);
  assert.equal(normalizeHostedEmailRouteKey(null), null);
  assert.equal(normalizeHostedEmailSubject(undefined), null);
});

test("hosted email sender helpers authorize only the verified email by default", () => {
  const threadTarget = createHostedEmailThreadTarget({
    cc: ["friend@example.test"],
    to: ["teammate@example.test"],
  });

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
      threadTarget,
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      envelopeFrom: "teammate@example.test",
      threadTarget,
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      headerFrom: "intruder@example.test",
      threadTarget,
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

test("hosted email sender helpers can opt into saved thread participants", () => {
  const threadTarget = createHostedEmailThreadTarget({
    cc: ["friend@example.test"],
    to: ["teammate@example.test"],
  });

  assert.deepEqual(
    resolveHostedEmailAuthorizedSenderAddresses({
      allowThreadParticipants: true,
      threadTarget,
      verifiedEmailAddress: "owner@example.test",
    }),
    ["owner@example.test", "teammate@example.test", "friend@example.test"],
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      allowThreadParticipants: true,
      envelopeFrom: "teammate@example.test",
      threadTarget,
      verifiedEmailAddress: "owner@example.test",
    }),
    true,
  );
});
