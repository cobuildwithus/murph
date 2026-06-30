import { describe, expect, it } from "vitest";

import {
  parseHostedActionApprovalRequest,
  serializeHostedActionApprovalRequest,
} from "../src/action-approval.js";

const VALID_ACTION_APPROVAL_REQUEST = {
  actionFingerprint: "a".repeat(64),
  actionId: "send-vault-file:user-summary",
  actionKind: "send_vault_file",
  presentation: {
    body: "Send this file to the current conversation.",
    title: "Send file?",
  },
};

describe("hosted action approval contracts", () => {
  it("accepts deploy-skew requests that omit returnContactKind", () => {
    expect(parseHostedActionApprovalRequest(VALID_ACTION_APPROVAL_REQUEST))
      .toEqual({
        ...VALID_ACTION_APPROVAL_REQUEST,
        returnContactKind: null,
      });
  });

  it("serializes absent returnContactKind as the canonical null value", () => {
    expect(serializeHostedActionApprovalRequest({
      ...VALID_ACTION_APPROVAL_REQUEST,
      returnContactKind: null,
    })).toBe(JSON.stringify([
      "murph.hosted-action-approval-request.v1",
      VALID_ACTION_APPROVAL_REQUEST.actionId,
      VALID_ACTION_APPROVAL_REQUEST.actionKind,
      VALID_ACTION_APPROVAL_REQUEST.actionFingerprint,
      VALID_ACTION_APPROVAL_REQUEST.presentation.title,
      VALID_ACTION_APPROVAL_REQUEST.presentation.body,
      null,
    ]));
  });

  it.each([
    null,
    "email",
    "telegram",
    "text",
  ] as const)("accepts explicit returnContactKind %#", (returnContactKind) => {
    expect(parseHostedActionApprovalRequest({
      ...VALID_ACTION_APPROVAL_REQUEST,
      returnContactKind,
    }).returnContactKind).toBe(returnContactKind);
  });
});
