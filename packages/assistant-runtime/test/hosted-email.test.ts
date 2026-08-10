import assert from "node:assert/strict";

import { test } from "vitest";

import {
  hostedEmailSendTargetKindValues,
  parseHostedEmailSendRequest,
} from "../src/hosted-email.ts";

test("hosted email send parsing accepts only hosted-supported target kinds", () => {
  assert.deepEqual(hostedEmailSendTargetKindValues, ["explicit", "group", "thread"]);

  for (const targetKind of hostedEmailSendTargetKindValues) {
    assert.equal(
      parseHostedEmailSendRequest({
        message: "hello",
        target: "user@example.com",
        targetKind,
      }).targetKind,
      targetKind,
    );
  }
});

test("hosted email send parsing ignores the legacy identityId and timeoutMs fields", () => {
  // Regression: older runners sent the session binding's privacy-blinded
  // identity (hid_<hex>) as identityId, plus a dead timeoutMs field. The
  // hosted sender is config-owned, so both fields were removed; legacy
  // payloads still parse and send.
  assert.deepEqual(
    parseHostedEmailSendRequest({
      identityId: "hid_0123456789abcdef0123456789abcdef",
      message: "hello",
      target: "user@example.com",
      targetKind: "explicit",
      timeoutMs: 45_000,
    }),
    {
      html: null,
      idempotencyKey: null,
      message: "hello",
      replyToMessageId: null,
      subject: null,
      target: "user@example.com",
      targetKind: "explicit",
    },
  );

  // Ignored regardless of type: a malformed legacy identityId no longer 400s.
  assert.equal(
    parseHostedEmailSendRequest({
      identityId: 123,
      message: "hello",
      target: "user@example.com",
      targetKind: "explicit",
    }).message,
    "hello",
  );
});

test("hosted email send parsing preserves idempotency and reply target fields", () => {
  assert.deepEqual(
    parseHostedEmailSendRequest({
      idempotencyKey: " email-send-123 ",
      message: "hello",
      replyToMessageId: " message-parent-123 ",
      target: "thread_123",
      targetKind: "thread",
    }),
    {
      html: null,
      idempotencyKey: "email-send-123",
      message: "hello",
      replyToMessageId: "message-parent-123",
      subject: null,
      target: "thread_123",
      targetKind: "thread",
    },
  );
});

test("hosted email send parsing preserves explicit group fanout planning", () => {
  assert.equal(parseHostedEmailSendRequest({
    message: "hello group",
    planGroupFanout: true,
    target: "group_123",
    targetKind: "group",
  }).planGroupFanout, true);
  assert.throws(() => parseHostedEmailSendRequest({
    message: "hello group",
    planGroupFanout: "true",
    target: "group_123",
    targetKind: "group",
  }), /planGroupFanout must be a boolean/u);
});

test("hosted email send parsing validates generic and legacy group-email authorization proof fields", () => {
  const authorizationProof = "a".repeat(64);
  assert.equal(parseHostedEmailSendRequest({
    message: "hello group",
    groupEmailAuthorizationProof: authorizationProof,
    target: "group_123",
    targetKind: "group",
  }).groupEmailAuthorizationProof, authorizationProof);
  assert.throws(() => parseHostedEmailSendRequest({
    message: "hello group",
    groupEmailAuthorizationProof: "not-a-proof",
    target: "group_123",
    targetKind: "group",
  }), /SHA-256 hex digest/u);
  assert.equal(parseHostedEmailSendRequest({
    message: "hello legacy group",
    newsletterAuthorizationProof: authorizationProof,
    target: "group_123",
    targetKind: "group",
  }).groupEmailAuthorizationProof, authorizationProof);
  assert.throws(() => parseHostedEmailSendRequest({
    groupEmailAuthorizationProof: authorizationProof,
    message: "hello mismatched group",
    newsletterAuthorizationProof: "b".repeat(64),
    target: "group_123",
    targetKind: "group",
  }), /authorization proofs must match/u);
});

test("hosted email send parsing rejects non-object payloads", () => {
  assert.throws(
    () => parseHostedEmailSendRequest(null),
    /must be an object/u,
  );
  assert.throws(
    () => parseHostedEmailSendRequest([]),
    /must be an object/u,
  );
});

test("hosted email send parsing rejects non-string field values", () => {
  assert.throws(
    () => parseHostedEmailSendRequest({
      message: 123,
      target: "user@example.com",
      targetKind: "explicit",
    }),
    /message must be a string/u,
  );
  assert.throws(
    () => parseHostedEmailSendRequest({
      message: "hello",
      target: 123,
      targetKind: "explicit",
    }),
    /target must be a string/u,
  );
});

test("hosted email send parsing rejects unsupported target kinds", () => {
  assert.throws(
    () => parseHostedEmailSendRequest({
      message: "hello",
      target: "user@example.com",
      targetKind: "broadcast",
    }),
    /must be explicit, group, or thread/u,
  );
  assert.throws(
    () => parseHostedEmailSendRequest({
      message: "hello",
      target: "user@example.com",
      targetKind: "participant",
    }),
    /must be explicit, group, or thread/u,
  );
});
