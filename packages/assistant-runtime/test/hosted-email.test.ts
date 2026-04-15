import assert from "node:assert/strict";

import { test } from "vitest";

import { gatewayDeliveryTargetKindValues } from "@murphai/gateway-core";

import {
  hostedEmailSendTargetKindValues,
  parseHostedEmailSendRequest,
} from "../src/hosted-email.ts";

test("hosted email send parsing accepts every gateway-owned target kind", () => {
  assert.deepEqual(hostedEmailSendTargetKindValues, gatewayDeliveryTargetKindValues);

  for (const targetKind of hostedEmailSendTargetKindValues) {
    assert.equal(
      parseHostedEmailSendRequest({
        identityId: null,
        message: "hello",
        target: "user@example.com",
        targetKind,
      }).targetKind,
      targetKind,
    );
  }
});

test("hosted email send parsing trims blank optional identity ids to null", () => {
  assert.deepEqual(
    parseHostedEmailSendRequest({
      identityId: "   ",
      message: "hello",
      target: "user@example.com",
      targetKind: "explicit",
    }),
    {
      identityId: null,
      message: "hello",
      target: "user@example.com",
      targetKind: "explicit",
    },
  );
});

test("hosted email send parsing treats an omitted identity id as null", () => {
  assert.deepEqual(
    parseHostedEmailSendRequest({
      message: "hello",
      target: "user@example.com",
      targetKind: "explicit",
    }),
    {
      identityId: null,
      message: "hello",
      target: "user@example.com",
      targetKind: "explicit",
    },
  );
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
      identityId: 123,
      message: "hello",
      target: "user@example.com",
      targetKind: "explicit",
    }),
    /identityId must be a string/u,
  );
  assert.throws(
    () => parseHostedEmailSendRequest({
      identityId: null,
      message: 123,
      target: "user@example.com",
      targetKind: "explicit",
    }),
    /message must be a string/u,
  );
  assert.throws(
    () => parseHostedEmailSendRequest({
      identityId: null,
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
      identityId: null,
      message: "hello",
      target: "user@example.com",
      targetKind: "broadcast",
    }),
    /must be explicit, participant, or thread/u,
  );
});
