import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
} from "../src/parsers.ts";

const statusOnlyResponses = [
  { action: "ask", status: "no_groups" },
  { action: "handoff", status: "no_groups" },
  { action: "ask_current_sender", status: "accepted" },
  { action: "record_current_sender_daily_metric", status: "accepted" },
  { action: "record_current_sender_journal_fact", status: "handled" },
  { action: "set_current_sender_journal_capture", status: "handled" },
  { action: "post_disclosure_request", status: "sent" },
  { action: "revoke_disclosure_grant", status: "revoked" },
  { action: "read_next_group", status: "none" },
  { action: "cancel_next_group", status: "canceled" },
  { action: "leave_membership", status: "owner_cannot_leave" },
  { action: "set_chat_avatar", status: "requested" },
  { action: "preflight_set_chat_avatar", status: "ok" },
  { action: "share_contact_card", status: "unconfirmed" },
];

const actionOnlyRequests = [
  "create_signup_referral_link",
  "prepare_next_group",
  "read_current",
  "read_next_group",
  "cancel_next_group",
  "read_chat_name",
  "read_usage",
  "list_memberships",
  "create_join_link",
  "post_join_offer",
  "preflight_set_chat_avatar",
  "read_chat_participants",
  "share_contact_card",
  "revoke_own_email_share",
];

describe("group tool dispatch wire contracts", () => {
  it.each(actionOnlyRequests)("retains omitted options for %s", (action) => {
    expect(parseHostedRuntimeGroupToolRequest({ action })).toEqual({ action });
    expect(() => parseHostedRuntimeGroupToolRequest({ action, extra: true }))
      .toThrow(/not allowed/u);
  });

  it.each(statusOnlyResponses)("preserves $action/$status and rejects extra fields", ({ action, status }) => {
    const response = { action, result: { status } };
    expect(parseHostedRuntimeGroupToolResponse(response)).toEqual(response);
    expect(() => parseHostedRuntimeGroupToolResponse({ ...response, extra: true }))
      .toThrow(/not allowed/u);
    expect(() => parseHostedRuntimeGroupToolResponse({ action, result: { status, extra: true } }))
      .toThrow(/not allowed/u);
  });

  it.each([
    "ask", "handoff", "post_disclosure_request", "revoke_disclosure_grant",
    "read_current", "create_join_link", "update_display_name", "post_join_offer",
    "read_usage", "list_memberships", "create_signup_referral_link",
    "leave_membership", "read_chat_participants", "set_chat_avatar",
    "preflight_set_chat_avatar", "share_contact_card", "revoke_own_email_share",
    "unknown_action",
  ])("retains the shared unsupported-status diagnostic for %s", (action) => {
    expect(() => parseHostedRuntimeGroupToolResponse({ action, result: { status: "unknown_status" } }))
      .toThrow(new TypeError("Hosted runtime group tool response action/status is not supported."));
  });

  it.each([
    ["prepare_next_group", "Hosted runtime group tool prepare_next_group response result status is invalid."],
    ["read_chat_name", "Hosted runtime group tool read_chat_name response status is invalid."],
    ["arm_usage_referral", "Hosted runtime group tool arm_usage_referral response result status is not supported."],
  ])("retains the action-specific unsupported-status diagnostic for %s", (action, message) => {
    expect(() => parseHostedRuntimeGroupToolResponse({ action, result: { status: "unknown_status" } }))
      .toThrow(new TypeError(message));
  });

  it("normalizes the legacy sender response without admitting its extra fields", () => {
    expect(parseHostedRuntimeGroupToolResponse({ action: "message_current_sender", result: { status: "accepted" } }))
      .toEqual({ action: "ask_current_sender", result: { status: "accepted" } });
    expect(() => parseHostedRuntimeGroupToolResponse({ action: "message_current_sender", result: { status: "accepted" }, audience: "group" }))
      .toThrow(/not allowed/u);
  });

  it("preserves defaulted group and membership projection fields", () => {
    expect(parseHostedRuntimeGroupToolResponse({ action: "read_current", result: { status: "none", group: "ignored" } }))
      .toEqual({ action: "read_current", result: { status: "none", group: null } });
    expect(parseHostedRuntimeGroupToolResponse({ action: "list_memberships", result: { status: "ok", memberships: [], truncated: false } }))
      .toEqual({ action: "list_memberships", result: { status: "ok", memberships: [], truncated: false, disclosureGrants: [] } });
  });

  it("keeps legacy usage validation before normalization", () => {
    const usage = { capacityState: "exhausted", periodEnd: "2026-08-30T12:00:00.000Z", fundingUrl: null };
    expect(parseHostedRuntimeGroupToolResponse({ action: "read_usage", result: { status: "ok", usage } }))
      .toEqual({ action: "read_usage", result: { status: "ok", usage: { fundingNeeded: true, fundingUrl: null } } });
    expect(() => parseHostedRuntimeGroupToolResponse({ action: "read_usage", result: { status: "ok", usage: { ...usage, fundingNeeded: true } } }))
      .toThrow(/not allowed/u);
  });

  it("rejects unknown request actions at the public boundary", () => {
    expect(() => parseHostedRuntimeGroupToolRequest({ action: "unknown_action" }))
      .toThrow(new TypeError("Hosted runtime group tool action is not supported."));
  });
});
