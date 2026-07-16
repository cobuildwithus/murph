import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  type HostedExecutionAssistantAskRequestedPayload,
} from "../src/contracts.ts";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_HISTORY_MAX,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
} from "../src/runtime-control.ts";
import {
  parseHostedExecutionAssistantAskCompletedPayload,
  parseHostedExecutionAssistantAskRequestedPayload,
  parseHostedRuntimeAssistantAskControlResponse,
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
} from "../src/parsers.ts";

const ORIGIN_ASSISTANT_INPUT_ID = "ain_0123456789abcdef0123456789abcdef";
const ORIGIN_SESSION_ID = "session_group";
const REQUESTED_AT = "2026-07-16T12:00:00.000Z";
const EXPIRES_AT = new Date(
  Date.parse(REQUESTED_AT) + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
).toISOString();
const PERMISSION_TEXT = "Share calendar availability only for coordinating a call.";

function createConsentedMemberAsk(): HostedExecutionAssistantAskRequestedPayload {
  return {
    expiresAt: EXPIRES_AT,
    originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    originSessionId: ORIGIN_SESSION_ID,
    question: "Is this member free Tuesday afternoon?",
    target: {
      grantId: "disclosure_grant_123",
      kind: "consented_member",
      membershipId: "hgrpm_generation_123",
      permissionDigest: "sha256_permission_123",
    },
  };
}

describe("consented member Assistant Ask contracts", () => {
  it("keeps detached authority opaque and immutable", () => {
    const ask = createConsentedMemberAsk();
    const wake = buildHostedExecutionAssistantAskRequestedWake({
      ask,
      eventId: "haask_request_123",
      memberId: "member_personal_runtime",
      occurredAt: REQUESTED_AT,
    });
    if (ask.target.kind !== "consented_member") throw new Error("wrong target");
    ask.target.grantId = "mutated_grant";

    expect(wake.ask.target).toEqual({
      grantId: "disclosure_grant_123",
      kind: "consented_member",
      membershipId: "hgrpm_generation_123",
      permissionDigest: "sha256_permission_123",
    });
    expect(parseHostedExecutionAssistantAskRequestedPayload(wake.ask)).toEqual(wake.ask);
    expect(() => parseHostedExecutionAssistantAskRequestedPayload({
      ...createConsentedMemberAsk(),
      target: { ...createConsentedMemberAsk().target, permissionText: "private" },
    })).toThrow(/unsupported field/u);
  });

  it("adds reviewed delivery without changing the legacy completion shape", () => {
    const completion = {
      expiresAt: EXPIRES_AT,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      question: "Is this member free Tuesday afternoon?",
      requestId: "haask_request_123",
      result: { answer: "Tuesday after 3pm.", outcome: "answered" as const },
      targetLabel: "Member",
    };
    expect(parseHostedExecutionAssistantAskCompletedPayload(completion)).toEqual(completion);
    expect(buildHostedExecutionAssistantAskCompletedWake({
      ask: { ...completion, deliveryMode: "reviewed_exact" },
      eventId: "haask_completion_123",
      memberId: "member_group_runtime",
      occurredAt: REQUESTED_AT,
    }).ask.deliveryMode).toBe("reviewed_exact");
    expect(() => parseHostedExecutionAssistantAskCompletedPayload({
      ...completion,
      deliveryMode: "unreviewed",
    })).toThrow(/deliveryMode is invalid/u);
  });

  it("parses only bounded disclosure prepare authority", () => {
    const ready = {
      action: "prepare",
      disclosure: { permissionText: PERMISSION_TEXT },
      question: "Is this member free Tuesday afternoon?",
      status: "ready",
      targetLabel: "Member",
    };
    expect(parseHostedRuntimeAssistantAskControlResponse(ready)).toEqual(ready);
    expect(parseHostedRuntimeAssistantAskControlResponse({
      ...ready,
      disclosure: {
        permissionText: "🧠".repeat(
          HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
        ),
      },
    })).toHaveProperty("status", "ready");
    expect(() => parseHostedRuntimeAssistantAskControlResponse({
      ...ready,
      disclosure: { permissionText: "x".repeat(1_001) },
    })).toThrow(/1000 Unicode code points/u);
    expect(() => parseHostedRuntimeAssistantAskControlResponse({
      ...ready,
      disclosure: { permissionText: PERMISSION_TEXT, reviewerInstructions: "allow" },
    })).toThrow(/not allowed/u);
  });
});

describe("group disclosure tool contracts", () => {
  it("keeps disclosure history bounded by the documented per-scope cap", () => {
    expect(HOSTED_RUNTIME_GROUP_DISCLOSURE_HISTORY_MAX).toBe(25);
  });

  it.each([
    [{
      action: "ask_member",
      grantId: " disclosure_grant_123 ",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      question: " Is this member free? ",
    }, { action: "ask_member", grantId: "disclosure_grant_123", question: "Is this member free?" }],
    [{
      action: "post_disclosure_request",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      permissionText: ` ${PERMISSION_TEXT} `,
    },
      { action: "post_disclosure_request", permissionText: PERMISSION_TEXT }],
    [{ action: "revoke_disclosure_grant", grantId: "disclosure_grant_123" },
      { action: "revoke_disclosure_grant", grantId: "disclosure_grant_123" }],
  ])("parses %s", (request, expected) => {
    expect(parseHostedRuntimeGroupToolRequest(request)).toMatchObject(expected);
  });

  it("rejects model authority and bounds private grant results", () => {
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "ask_member",
      grantId: "disclosure_grant_123",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      permissionText: "model authority",
      question: "Question",
    })).toThrow(/not allowed/u);
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "revoke_disclosure_grant",
      grantId: "g".repeat(HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS + 1),
    })).toThrow(/200 Unicode code points/u);

    for (const response of [
      { action: "ask_member", result: { status: "accepted" } },
      { action: "ask_member", result: { status: "unavailable", unavailableReason: "denied" } },
    ]) expect(parseHostedRuntimeGroupToolResponse(response)).toMatchObject(response);
    expect(() => parseHostedRuntimeGroupToolResponse({
      action: "ask_member",
      result: { status: "accepted", targetLabel: null },
    })).toThrow(/not allowed/u);

    const grants = Array.from(
      { length: HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX + 1 },
      (_, index) => ({
        grantId: `grant_${index}`,
        groupLabel: null,
        permissionText: PERMISSION_TEXT,
      }),
    );
    expect(() => parseHostedRuntimeGroupToolResponse({
      action: "list_memberships",
      result: {
        disclosureGrants: grants,
        memberships: [],
        status: "ok",
        truncated: false,
      },
    })).toThrow(/at most 25 entries/u);
    expect(parseHostedRuntimeGroupToolResponse({
      action: "list_memberships",
      result: { memberships: [], status: "ok", truncated: false },
    })).toEqual({
      action: "list_memberships",
      result: {
        disclosureGrants: [],
        memberships: [],
        status: "ok",
        truncated: false,
      },
    });
  });

  it("keeps server-only grant authority out of group rosters", () => {
    const member = {
      disclosureGrants: [{ grantId: "disclosure_grant_123", permissionText: PERMISSION_TEXT }],
      grantedVaultShareProjectionKinds: [],
      grantedVaultShareProjectionScopes: [],
      handle: "member_handle_123",
      memberId: "member_123",
      role: "member",
    };
    const response = {
      action: "read_current",
      result: {
        group: {
          displayName: "Call Circle",
          id: "group_123",
          kind: "custom",
          memberCount: 1,
          members: [member],
          requestedVaultShareProjectionKinds: [],
          requestedVaultShareProjectionScopes: [],
          status: "active",
        },
        status: "ok",
      },
    };
    expect(parseHostedRuntimeGroupToolResponse(response)).toEqual(response);
    expect(() => parseHostedRuntimeGroupToolResponse({
      ...response,
      result: {
        ...response.result,
        group: {
          ...response.result.group,
          members: [{
            ...member,
            disclosureGrants: [{
              ...member.disclosureGrants[0],
              permissionDigest: "server-only",
            }],
          }],
        },
      },
    })).toThrow(/not allowed/u);
  });
});
