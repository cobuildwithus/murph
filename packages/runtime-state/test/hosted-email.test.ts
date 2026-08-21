import assert from "node:assert/strict";

import { test } from "vitest";

import {
  HOSTED_EMAIL_THREAD_TARGET_SCHEMA,
  HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH,
  HOSTED_EMAIL_THREAD_TARGET_MESSAGE_ID_MAX_LENGTH,
  HOSTED_EMAIL_THREAD_TARGET_REFERENCE_MAX_COUNT,
  HOSTED_EMAIL_THREAD_TARGET_SUBJECT_MAX_LENGTH,
  appendHostedEmailReferenceChain,
  createHostedEmailThreadTarget,
  ensureHostedEmailReplySubject,
  isHostedEmailInboundSenderAuthorized,
  isHostedEmailAuthenticatedSenderVerdictAccepted,
  normalizeHostedEmailAddress,
  normalizeHostedEmailAddressList,
  normalizeHostedEmailMessageId,
  normalizeHostedEmailSubject,
  parseHostedEmailThreadTarget,
  resolveHostedEmailAuthorizedSenderAddresses,
  resolveHostedEmailBootstrapCandidateAddress,
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

test("public email bootstrap accepts only one matching envelope and header sender hint", () => {
  assert.equal(resolveHostedEmailBootstrapCandidateAddress({
    envelopeFrom: "Member@Example.Test",
    headerFrom: "Member <member@example.test>",
  }), "member@example.test");
  assert.equal(resolveHostedEmailBootstrapCandidateAddress({
    envelopeFrom: "attacker@example.test",
    headerFrom: "member@example.test",
  }), null);
  assert.equal(resolveHostedEmailBootstrapCandidateAddress({
    envelopeFrom: "member@example.test",
    hasRepeatedHeaderFrom: true,
    headerFrom: "member@example.test",
  }), null);
  assert.equal(resolveHostedEmailBootstrapCandidateAddress({
    envelopeFrom: "member@example.test",
    headerFrom: "Member <member@example.test>, Attacker <attacker@example.test>",
  }), null);
});

test("hosted email thread targets serialize, normalize, and parse deterministically", () => {
  const serialized = serializeHostedEmailThreadTarget({
    cc: [" Owner@example.test ", "owner@example.test"],
    lastMessageId: " <last@example.test> ",
    references: ["<older@example.test>", " ", "<older@example.test>"],
    subject: "  Status update ",
    to: ["Friend@example.test", "Friend@example.test", "Team <team@example.test>"],
  });
  const parsed = parseHostedEmailThreadTarget(serialized);

  assert.deepEqual(parsed, createHostedEmailThreadTarget({
    cc: ["owner@example.test"],
    lastMessageId: "<last@example.test>",
    references: ["<older@example.test>", "<last@example.test>"],
    subject: "Status update",
    to: ["friend@example.test", "team@example.test"],
  }));
  assert.equal(parsed?.schema, HOSTED_EMAIL_THREAD_TARGET_SCHEMA);
  assert.equal(
    (parsed as typeof parsed & { targetKind?: string } | null)?.targetKind,
    "explicit",
  );
  assert.equal(
    (parsed as typeof parsed & { groupId?: string | null } | null)?.groupId,
    null,
  );
  assert.equal(parseHostedEmailThreadTarget(""), null);
  assert.equal(parseHostedEmailThreadTarget("not-a-target"), null);
  assert.equal(parseHostedEmailThreadTarget("hostedmail:not-json"), null);
  assert.equal(
    parseHostedEmailThreadTarget(
      "hostedmail:eyJzY2hlbWEiOiJ3cm9uZyIsInRvIjpbIm93bmVyQGV4YW1wbGUudGVzdCJdLCJjYyI6W10sInJlZmVyZW5jZXMiOltdLCJsYXN0TWVzc2FnZUlkIjpudWxsLCJyZXBseUFsaWFzQWRkcmVzcyI6bnVsbCwic3ViamVjdCI6bnVsbH0",
    ),
    null,
  );
  assert.equal(
    parseHostedEmailThreadTarget(
      `hostedmail:${Buffer.from(JSON.stringify({
        cc: [],
        lastMessageId: null,
        references: [],
        schema: "murph.hosted-email-thread-target.v2",
        subject: null,
        to: ["owner@example.test"],
      })).toString("base64url")}`,
    ),
    null,
  );
  const unknownTargetKind = parseHostedEmailThreadTarget(
    `hostedmail:${Buffer.from(JSON.stringify({
      cc: [],
      groupId: "group_legacy",
      lastMessageId: "<last@example.test>",
      references: ["<last@example.test>"],
      schema: HOSTED_EMAIL_THREAD_TARGET_SCHEMA,
      subject: "Legacy fallback",
      targetKind: "not-a-target-kind",
      to: ["Owner@example.test"],
    })).toString("base64url")}`,
  );
  assert.equal(
    (unknownTargetKind as typeof unknownTargetKind & { targetKind?: string } | null)?.targetKind,
    "explicit",
  );
  assert.equal(
    (unknownTargetKind as typeof unknownTargetKind & { groupId?: string | null } | null)?.groupId,
    null,
  );
  assert.deepEqual(unknownTargetKind?.to, ["owner@example.test"]);
});

test("group email thread targets preserve a privacy-blind recipient member id", () => {
  const serialized = serializeHostedEmailThreadTarget({
    groupId: "group_123",
    recipientMemberId: " member_456 ",
    subject: "Group reply",
    targetKind: "group",
  });

  assert.deepEqual(parseHostedEmailThreadTarget(serialized), {
    cc: [],
    groupId: "group_123",
    lastMessageId: null,
    recipientMemberId: "member_456",
    references: [],
    schema: HOSTED_EMAIL_THREAD_TARGET_SCHEMA,
    subject: "Group reply",
    targetKind: "group",
    to: [],
  });
  assert.equal(createHostedEmailThreadTarget({
    recipientMemberId: "member_456",
    to: ["owner@example.test"],
  }).recipientMemberId, null);
});

test("hosted email reference chains and reply subjects normalize edge cases", () => {
  const references = Array.from(
    { length: 25 },
    (_, index) => ` <message-${index}@example.test> `,
  );

  assert.deepEqual(appendHostedEmailReferenceChain({
    lastMessageId: " <message-24@example.test> ",
    references,
  }), [
    "<message-0@example.test>",
    ...Array.from(
      { length: HOSTED_EMAIL_THREAD_TARGET_REFERENCE_MAX_COUNT - 1 },
      (_, index) => `<message-${index + 14}@example.test>`,
    ),
  ]);
  assert.equal(ensureHostedEmailReplySubject("Status update"), "Re: Status update");
  assert.equal(ensureHostedEmailReplySubject("Re: Existing thread"), "Re: Existing thread");
  assert.equal(ensureHostedEmailReplySubject("   ", "  "), "Murph update");
});

test("hosted email direct sender lookup requires one matching envelope and header sender", () => {
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      envelopeFrom: "owner@example.com",
      headerFrom: "Owner <owner@example.com>",
    }),
    "owner@example.com",
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      envelopeFrom: "owner@example.com",
      headerFrom: "Owner <owner@example.com>",
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: false,
        spfAligned: false,
      },
      envelopeFrom: "owner@example.com",
      headerFrom: "Owner <owner@example.com>",
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      envelopeFrom: "owner@example.com",
      headerFrom: null,
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      envelopeFrom: null,
      headerFrom: "Owner <owner@example.com>",
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: true,
      headerFrom: "Owner <owner@example.com>",
    }),
    null,
  );
  assert.equal(
    resolveHostedEmailDirectSenderLookupAddress({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      envelopeFrom: "owner@example.com",
      headerFrom: "Attacker <attacker@example.com>",
    }),
    null,
  );
});

test("hosted email authenticated sender verdict requires explicit accepted provider proof", () => {
  assert.equal(isHostedEmailAuthenticatedSenderVerdictAccepted(null), false);
  assert.equal(
    isHostedEmailAuthenticatedSenderVerdictAccepted({
      dkimAligned: false,
      dmarcPass: false,
      spfAligned: false,
    }),
    false,
  );
  assert.equal(
    isHostedEmailAuthenticatedSenderVerdictAccepted({
      dkimAligned: true,
      dmarcPass: false,
      spfAligned: false,
    }),
    true,
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
  assert.equal(
    normalizeHostedEmailMessageId(
      `<${"m".repeat(HOSTED_EMAIL_THREAD_TARGET_MESSAGE_ID_MAX_LENGTH)}@example.test>`,
    ),
    null,
  );
  assert.equal(
    normalizeHostedEmailSubject(
      ` ${"s".repeat(HOSTED_EMAIL_THREAD_TARGET_SUBJECT_MAX_LENGTH + 25)} `,
    ),
    "s".repeat(HOSTED_EMAIL_THREAD_TARGET_SUBJECT_MAX_LENGTH),
  );
  assert.deepEqual(
    normalizeHostedEmailAddressList(["Owner <owner@example.test>", "owner@example.test", " ", null]),
    ["owner@example.test"],
  );
});

test("hosted email thread targets stay bounded when raw headers are oversized", () => {
  const serialized = serializeHostedEmailThreadTarget({
    cc: Array.from(
      { length: 50 },
      (_, index) => `CC ${index} <cc-${index}@example.test>`,
    ),
    lastMessageId:
      `<${"m".repeat(HOSTED_EMAIL_THREAD_TARGET_MESSAGE_ID_MAX_LENGTH)}@example.test>`,
    references: Array.from(
      { length: 40 },
      (_, index) =>
        `<${"r".repeat(HOSTED_EMAIL_THREAD_TARGET_MESSAGE_ID_MAX_LENGTH)}-${index}@example.test>`,
    ),
    subject: "s".repeat(HOSTED_EMAIL_THREAD_TARGET_SUBJECT_MAX_LENGTH + 100),
    to: Array.from(
      { length: 50 },
      (_, index) => `To ${index} <to-${index}@example.test>`,
    ),
  });
  const parsed = parseHostedEmailThreadTarget(serialized);

  assert.ok(serialized.length <= HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH);
  assert.equal(parsed?.lastMessageId, null);
  assert.deepEqual(parsed?.references, []);
  assert.equal(parsed?.subject?.length, HOSTED_EMAIL_THREAD_TARGET_SUBJECT_MAX_LENGTH);
  assert.equal(parsed?.to.length, 8);
  assert.equal(parsed?.cc.length, 8);
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
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      headerFrom: "owner@example.test",
      verifiedEmailAddress: "Owner@Example.Test",
    }),
    true,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      authenticatedSender: null,
      headerFrom: "owner@example.test",
      verifiedEmailAddress: "Owner@Example.Test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: false,
        spfAligned: false,
      },
      headerFrom: "owner@example.test",
      verifiedEmailAddress: "Owner@Example.Test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      headerFrom: "friend@example.test",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      envelopeFrom: "teammate@example.test",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      headerFrom: "intruder@example.test",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      envelopeFrom: "intruder@example.test",
      headerFrom: "Owner <owner@example.test>",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      headerFrom: "Owner <owner@example.test>, Intruder <intruder@example.test>",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
      envelopeFrom: "owner@example.test",
      hasRepeatedHeaderFrom: true,
      headerFrom: "owner@example.test",
      verifiedEmailAddress: "owner@example.test",
    }),
    false,
  );
  assert.equal(
    isHostedEmailInboundSenderAuthorized({
      authenticatedSender: {
        dkimAligned: false,
        dmarcPass: true,
        spfAligned: false,
      },
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
