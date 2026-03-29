import assert from "node:assert/strict";

import { test } from "vitest";

import {
  createHostedEmailThreadTarget,
  isHostedEmailInboundSenderAuthorized,
  normalizeHostedEmailAddress,
  resolveHostedEmailAuthorizedSenderAddresses,
  resolveHostedEmailInboundSenderAddress,
} from "../src/index.ts";

test("hosted email sender helpers prefer the parsed header sender and normalize trusted addresses", () => {
  const threadTarget = createHostedEmailThreadTarget({
    cc: [" Friend@example.test "],
    to: ["Teammate@example.test"],
  });

  assert.equal(
    resolveHostedEmailInboundSenderAddress({
      envelopeFrom: "bounce@example.test",
      headerFrom: " Owner@example.test ",
    }),
    normalizeHostedEmailAddress("owner@example.test"),
  );
  assert.deepEqual(
    resolveHostedEmailAuthorizedSenderAddresses({
      threadTarget,
      verifiedEmailAddress: "Owner@Example.Test",
    }),
    ["owner@example.test", "teammate@example.test", "friend@example.test"],
  );
});

test("hosted email sender helpers authorize only the verified email or saved thread participants", () => {
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
    }),
    true,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      envelopeFrom: "teammate@example.test",
      threadTarget,
    }),
    true,
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
