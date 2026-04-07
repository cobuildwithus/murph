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
