import { describe, expect, it } from "vitest";

import {
  buildHostedActionApprovalCycleOwnerKey,
  buildHostedActionApprovalOutcomeEffectId,
  parseHostedActionApprovalCycleOwnerKey,
  parseHostedActionApprovalObservation,
  parseHostedActionApprovalRequest,
  parseHostedActionApprovalOutcomeEffectId,
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

  it("round-trips an exact approval-cycle owner pointer", () => {
    const approvalId = `haa_${"a".repeat(32)}`;
    const expiresAt = "2026-06-25T16:15:00.000Z";
    const approvalGeneration = "b".repeat(64);
    const effectId = buildHostedActionApprovalOutcomeEffectId({
      approvalGeneration,
      approvalId,
      expiresAt,
    });

    expect(parseHostedActionApprovalOutcomeEffectId(effectId)).toEqual({
      approvalGeneration,
      approvalId,
      expiresAt,
      ownerKey: buildHostedActionApprovalCycleOwnerKey({ approvalId, expiresAt }),
    });
    expect(parseHostedActionApprovalOutcomeEffectId(`${effectId}x`)).toBeNull();
  });

  it("parses an approval observation only for its exact cycle owner", () => {
    const approvalId = `haa_${"a".repeat(32)}`;
    const cycleOwnerKey = buildHostedActionApprovalCycleOwnerKey({
      approvalId,
      expiresAt: "2026-06-25T16:15:00.000Z",
    });
    expect(parseHostedActionApprovalCycleOwnerKey(cycleOwnerKey)).toEqual({
      approvalId,
      expiresAt: "2026-06-25T16:15:00.000Z",
      ownerKey: cycleOwnerKey,
    });
    expect(parseHostedActionApprovalObservation({
      cycleOwnerKey,
      result: {
        approvalGeneration: "b".repeat(64),
        approvalId,
        status: "approved",
      },
    })).toEqual({
      approvalGeneration: "b".repeat(64),
      approvalId,
      cycleOwnerKey,
      status: "approved",
    });
    expect(() => parseHostedActionApprovalObservation({
      cycleOwnerKey,
      result: {
        approvalId: `haa_${"c".repeat(32)}`,
        status: "denied",
      },
    })).toThrow(/does not match approvalId/u);
  });
});
