import {
  HOSTED_EXECUTION_MEMBER_REPORTED_DAILY_METRIC_KEYS,
} from "@murphai/hosted-execution";
import { describe, expect, it } from "vitest";

import {
  listMurphDynamicToolNames,
  MURPH_GROUP_FAMILY_TOOLS,
  MURPH_GROUP_TOOL_FAMILY_ACTIONS,
  MURPH_GROUP_TOOL_NAME,
  readMurphDynamicToolRequest,
} from "../src/assistant-codex/dynamic-tools.ts";

const MESSAGE_REF = `ain_${"1".repeat(32)}`;
const DAILY_METRIC = HOSTED_EXECUTION_MEMBER_REPORTED_DAILY_METRIC_KEYS[0];

if (!DAILY_METRIC) {
  throw new Error("Expected at least one member-reported daily metric.");
}

const GROUP_FAMILY_ACTIONS = MURPH_GROUP_TOOL_FAMILY_ACTIONS;

type GroupFamilyName = keyof typeof GROUP_FAMILY_ACTIONS;
type GroupAction = (typeof GROUP_FAMILY_ACTIONS)[GroupFamilyName][number];

const GROUP_ACTION_FIXTURES = {
  ask: { action: "ask", question: "What changed this week?" },
  handoff: { action: "handoff", context: "The member completed the workout." },
  ask_current_sender: { action: "ask_current_sender", message_ref: MESSAGE_REF },
  clarify_current_sender: {
    action: "clarify_current_sender",
    message_ref: MESSAGE_REF,
  },
  continue_current_sender_in_group: {
    action: "continue_current_sender_in_group",
    message_ref: MESSAGE_REF,
  },
  continue_current_sender_privately: {
    action: "continue_current_sender_privately",
    message_ref: MESSAGE_REF,
  },
  ask_member: {
    action: "ask_member",
    grantId: "grant-test",
    question: "What was your step count?",
  },
  record_current_sender_daily_metric: {
    action: "record_current_sender_daily_metric",
    date: "2026-08-21",
    message_ref: MESSAGE_REF,
    metric: DAILY_METRIC,
    unit: "count",
    value: 1234,
  },
  post_disclosure_request: {
    action: "post_disclosure_request",
    permissionText: "Share daily step counts with this group.",
  },
  revoke_disclosure_grant: {
    action: "revoke_disclosure_grant",
    grantId: "grant-test",
  },
  read_shared: {
    action: "read_shared",
    projectionScopes: [{ projectionKind: "steps-days.v0" }],
  },
  offer_access: { action: "offer_access" },
  revoke_own_email_share: {
    action: "revoke_own_email_share",
    message_ref: MESSAGE_REF,
  },
  read_current: { action: "read_current" },
  prepare_next_group: { action: "prepare_next_group" },
  read_next_group: { action: "read_next_group" },
  cancel_next_group: { action: "cancel_next_group" },
  list_memberships: { action: "list_memberships" },
  leave_membership: {
    action: "leave_membership",
    membershipId: "membership-test",
  },
  read_usage: { action: "read_usage" },
  read_usage_referral: { action: "read_usage_referral" },
  arm_usage_referral: {
    action: "arm_usage_referral",
    policyCodes: ["new_person_activation_v1"],
  },
  cancel_usage_referral: {
    action: "cancel_usage_referral",
    policyCode: "new_person_activation_v1",
  },
  create_signup_referral_link: { action: "create_signup_referral_link" },
  read_chat_name: { action: "read_chat_name" },
  update_display_name: {
    action: "update_display_name",
    displayName: "Morning Miles",
  },
  read_chat_participants: { action: "read_chat_participants" },
  set_chat_avatar: {
    action: "set_chat_avatar",
    avatarSource: "image_ref",
    imageRef: "raw/inbox/group-avatar.png",
  },
  share_contact_card: { action: "share_contact_card" },
  send_email: {
    action: "send_email",
    html: "<p>Weekly update</p>",
    subject: "Weekly update",
  },
} satisfies Record<GroupAction, Record<string, unknown>>;

function groupToolCall(
  tool: string,
  argumentsValue: unknown,
): Record<string, unknown> {
  return {
    id: "request-test",
    method: "item/tool/call",
    params: {
      arguments: argumentsValue,
      callId: "call-test",
      namespace: "murph",
      threadId: "thread-test",
      tool,
      turnId: "turn-test",
    },
  };
}

describe("murph.group parser-first family compatibility", () => {
  it("partitions all 30 advertised actions exactly once", () => {
    const familyActions = Object.values(GROUP_FAMILY_ACTIONS).flat();

    expect(familyActions).toHaveLength(30);
    expect(new Set(familyActions).size).toBe(familyActions.length);
    expect([...familyActions].sort())
      .toEqual(Object.keys(GROUP_ACTION_FIXTURES).sort());
  });

  it("normalizes every family action exactly like the legacy parser", () => {
    for (const [familyName, actions] of Object.entries(GROUP_FAMILY_ACTIONS)) {
      for (const action of actions) {
        const argumentsValue = GROUP_ACTION_FIXTURES[action];
        const legacy = readMurphDynamicToolRequest(
          groupToolCall(MURPH_GROUP_TOOL_NAME, argumentsValue),
        );
        const family = readMurphDynamicToolRequest(
          groupToolCall(familyName, argumentsValue),
        );

        expect(legacy, `${familyName}:${action}:legacy`).toMatchObject({
          kind: "group",
        });
        expect(family, `${familyName}:${action}`).toEqual(legacy);
      }
    }
  });

  it("rejects every valid action through the wrong family", () => {
    for (const [familyName, familyActions] of Object.entries(GROUP_FAMILY_ACTIONS)) {
      const acceptedActions = new Set<string>(familyActions);
      for (const [action, argumentsValue] of Object.entries(GROUP_ACTION_FIXTURES)) {
        if (acceptedActions.has(action)) {
          continue;
        }
        expect(
          readMurphDynamicToolRequest(groupToolCall(familyName, argumentsValue)),
          `${familyName}:${action}`,
        ).toMatchObject({ kind: "invalid-group-arguments" });
      }
    }
  });

  it("keeps current-sender family inputs opaque and authority-free", () => {
    const forbiddenValues = {
      audience: "group",
      memberId: "member-test",
      providerMessageId: "provider-message-test",
      question: "Who sent this?",
      route: "provider-route-test",
      sender: "sender-test",
    };

    for (const action of [
      "ask_current_sender",
      "clarify_current_sender",
      "continue_current_sender_in_group",
      "continue_current_sender_privately",
    ] as const) {
      for (const [field, fieldValue] of Object.entries(forbiddenValues)) {
        expect(readMurphDynamicToolRequest(groupToolCall("group_consult", {
          action,
          message_ref: MESSAGE_REF,
          [field]: fieldValue,
        })), `${action}:${field}`).toMatchObject({
          kind: "invalid-group-arguments",
        });
      }
    }
  });

  it("does not treat unknown or legacy-only actions as read_current", () => {
    expect(readMurphDynamicToolRequest(groupToolCall("group_membership", {
      action: "future_group_action",
    }))).toMatchObject({ kind: "invalid-group-arguments" });

    expect(readMurphDynamicToolRequest(groupToolCall("group_consult", {
      action: "message_current_sender",
      message_ref: MESSAGE_REF,
    }))).toMatchObject({ kind: "invalid-group-arguments" });

    expect(readMurphDynamicToolRequest(groupToolCall("group_membership", {
      action: "read_current",
    }))).toMatchObject({
      kind: "group",
      request: { action: "read_current" },
    });
  });

  it("attributes post-schema validation errors to the focused family", () => {
    expect(readMurphDynamicToolRequest(groupToolCall("group_chat", {
      action: "set_chat_avatar",
      avatarSource: "image_ref",
    }))).toMatchObject({
      kind: "invalid-group-arguments",
      validationDigest: {
        schemaName: "murph.group_chat.input",
        toolName: "murph.group_chat",
      },
    });
  });

  it("advertises the six families without the legacy surface", () => {
    const advertisedNames = listMurphDynamicToolNames();
    for (const familyName of Object.keys(GROUP_FAMILY_ACTIONS)) {
      expect(advertisedNames).toContain(`murph.${familyName}`);
    }
    expect(advertisedNames.filter((name) => name === "murph.group"))
      .toEqual([]);
    expect(MURPH_GROUP_FAMILY_TOOLS.map((tool) => tool.name))
      .toEqual(Object.keys(GROUP_FAMILY_ACTIONS));
  });
});
