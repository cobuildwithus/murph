import assert from "node:assert/strict";

import { test } from "vitest";

import {
  appendHostedEmailReferenceChain,
  createHostedEmailThreadTarget,
  ensureHostedEmailReplySubject,
  isHostedEmailInboundSenderAuthorized,
  normalizeHostedEmailAddress,
  normalizeHostedEmailAddressList,
  normalizeHostedEmailMessageId,
  normalizeHostedEmailSubject,
  parseHostedEmailThreadTarget,
  resolveHostedEmailAuthorizedSenderAddresses,
  resolveHostedEmailDirectSenderLookupAddress,
  resolveHostedEmailInboundSenderAddress,
  serializeHostedEmailThreadTarget,
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

test("hosted email thread targets serialize, normalize, and parse deterministically", () => {
  const serialized = serializeHostedEmailThreadTarget({
    cc: [" Owner@example.test ", "owner@example.test"],
    lastMessageId: " <last@example.test> ",
    references: ["<older@example.test>", " ", "<older@example.test>"],
    replyAliasAddress: "Murph <reply@example.test>",
    subject: "  Status update ",
    to: ["Friend@example.test", "Friend@example.test", "Team <team@example.test>"],
  });

  assert.deepEqual(parseHostedEmailThreadTarget(serialized), createHostedEmailThreadTarget({
    cc: ["owner@example.test"],
    lastMessageId: "<last@example.test>",
    references: ["<older@example.test>", "<last@example.test>"],
    replyAliasAddress: "reply@example.test",
    subject: "Status update",
    to: ["friend@example.test", "team@example.test"],
  }));
  assert.equal(parseHostedEmailThreadTarget(""), null);
  assert.equal(parseHostedEmailThreadTarget("not-a-target"), null);
  assert.equal(parseHostedEmailThreadTarget("hostedmail:not-json"), null);
  assert.equal(
    parseHostedEmailThreadTarget(
      "hostedmail:eyJzY2hlbWEiOiJ3cm9uZyIsInRvIjpbIm93bmVyQGV4YW1wbGUudGVzdCJdLCJjYyI6W10sInJlZmVyZW5jZXMiOltdLCJsYXN0TWVzc2FnZUlkIjpudWxsLCJyZXBseUFsaWFzQWRkcmVzcyI6bnVsbCwic3ViamVjdCI6bnVsbH0",
    ),
    null,
  );
});

test("hosted email reference chains and reply subjects normalize edge cases", () => {
  const references = Array.from({ length: 25 }, (_, index) => ` <message-${index}@example.test> `);

  assert.deepEqual(appendHostedEmailReferenceChain({
    lastMessageId: " <message-24@example.test> ",
    references,
  }), Array.from({ length: 20 }, (_, index) => `<message-${index + 5}@example.test>`));
  assert.equal(ensureHostedEmailReplySubject("Status update"), "Re: Status update");
  assert.equal(ensureHostedEmailReplySubject("Re: Existing thread"), "Re: Existing thread");
  assert.equal(ensureHostedEmailReplySubject("   ", "  "), "Murph update");
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
  assert.deepEqual(
    normalizeHostedEmailAddressList(["Owner <owner@example.test>", "owner@example.test", " ", null]),
    ["owner@example.test"],
  );
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
  assert.equal(
    resolveHostedEmailInboundSenderAddress({
      envelopeFrom: "owner@example.test",
      headerFrom: "",
    }),
    "owner@example.test",
  );
  assert.equal(
    resolveHostedEmailInboundSenderAddress({
      headerFrom: "Owner <owner@example.test>, Teammate <teammate@example.test>",
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailInboundSenderAddress({
      headerFrom: "Owner <owner@example.test> Team <owner@example.test>",
    }),
    "owner@example.test",
  );
});
