import { describe, expect, it } from "vitest";

import {
  chooseHostedLinqConversationRecipientPhone,
  normalizeHostedLinqConversationRecipientPhones,
  resolveHostedLinqActiveRouteDecision,
  resolveHostedLinqHomeBindingRecipientPhone,
} from "@/src/lib/hosted-onboarding/linq-routing-policy";

describe("normalizeHostedLinqConversationRecipientPhones", () => {
  it("normalizes, drops invalid values, and deduplicates the pool", () => {
    expect(
      normalizeHostedLinqConversationRecipientPhones([
        "+1 (555) 010-0001",
        "15550100001",
        "+1 555 010 0002",
        "invalid",
      ]),
    ).toEqual([
      "+15550100001",
      "+15550100002",
    ]);
  });
});

describe("chooseHostedLinqConversationRecipientPhone", () => {
  it("keeps the preferred recipient phone when it is still under capacity", () => {
    expect(
      chooseHostedLinqConversationRecipientPhone({
        activeMembersByRecipientPhone: new Map([
          ["+15550100001", 2],
          ["+15550100002", 1],
        ]),
        maxActiveMembersPerPhoneNumber: 3,
        preferredRecipientPhone: "+1 555 010 0001",
        recipientPhones: [
          "+15550100001",
          "+15550100002",
        ],
      }),
    ).toBe("+15550100001");
  });

  it("chooses another pooled line when the preferred line is over capacity", () => {
    expect(
      chooseHostedLinqConversationRecipientPhone({
        activeMembersByRecipientPhone: new Map([
          ["+15550100001", 3],
          ["+15550100002", 2],
        ]),
        maxActiveMembersPerPhoneNumber: 3,
        preferredRecipientPhone: "+15550100001",
        recipientPhones: [
          "+15550100001",
          "+15550100002",
        ],
      }),
    ).toBe("+15550100002");
  });

  it("falls back to the preferred line when every pooled line is already at capacity", () => {
    expect(
      chooseHostedLinqConversationRecipientPhone({
        activeMembersByRecipientPhone: new Map([
          ["+15550100001", 3],
          ["+15550100002", 3],
        ]),
        maxActiveMembersPerPhoneNumber: 3,
        preferredRecipientPhone: "+15550100001",
        recipientPhones: [
          "+15550100001",
          "+15550100002",
        ],
      }),
    ).toBe("+15550100001");
  });

  it("falls back to the preferred line when the configured pool is empty", () => {
    expect(
      chooseHostedLinqConversationRecipientPhone({
        activeMembersByRecipientPhone: new Map(),
        maxActiveMembersPerPhoneNumber: 3,
        preferredRecipientPhone: "+1 555 010 0009",
        recipientPhones: [],
      }),
    ).toBe("+15550100009");
  });
});

describe("resolveHostedLinqActiveRouteDecision", () => {
  it("keeps using the current home chat when the incoming chat matches it", () => {
    expect(
      resolveHostedLinqActiveRouteDecision({
        homeChatId: "chat_home",
        homeRecipientPhone: "+15550100001",
        incomingChatId: "chat_home",
        incomingRecipientPhone: "+15550100002",
      }),
    ).toEqual({
      kind: "bind_home",
    });
  });

  it("redirects active users who text a different Murph line", () => {
    expect(
      resolveHostedLinqActiveRouteDecision({
        homeChatId: "chat_home",
        homeRecipientPhone: "+15550100001",
        incomingChatId: "chat_other",
        incomingRecipientPhone: "+15550100002",
      }),
    ).toEqual({
      homeRecipientPhone: "+15550100001",
      kind: "redirect_to_home",
    });
  });

  it("fails closed when the saved home line is unknown and the incoming chat does not match it", () => {
    expect(
      resolveHostedLinqActiveRouteDecision({
        homeChatId: "chat_home",
        homeRecipientPhone: null,
        incomingChatId: "chat_other",
        incomingRecipientPhone: "+15550100002",
      }),
    ).toEqual({
      kind: "ignore_unknown_home",
    });
  });

  it("fails closed when a different chat arrives without recipient metadata", () => {
    expect(
      resolveHostedLinqActiveRouteDecision({
        homeChatId: "chat_home",
        homeRecipientPhone: "+15550100001",
        incomingChatId: "chat_other",
        incomingRecipientPhone: null,
      }),
    ).toEqual({
      kind: "ignore_unknown_home",
    });
  });
});

describe("resolveHostedLinqHomeBindingRecipientPhone", () => {
  it("keeps the saved home recipient phone when the incoming chat already matches the durable home chat", () => {
    expect(
      resolveHostedLinqHomeBindingRecipientPhone({
        homeChatId: "chat_home",
        homeRecipientPhone: "+15550100001",
        incomingChatId: "chat_home",
        incomingRecipientPhone: "+15550100002",
      }),
    ).toBe("+15550100001");
  });

  it("fills the saved home recipient phone from inbound metadata when the matching home chat is missing one", () => {
    expect(
      resolveHostedLinqHomeBindingRecipientPhone({
        homeChatId: "chat_home",
        homeRecipientPhone: null,
        incomingChatId: "chat_home",
        incomingRecipientPhone: "+15550100002",
      }),
    ).toBe("+15550100002");
  });

  it("prefers the inbound recipient phone when rebinding onto a different chat", () => {
    expect(
      resolveHostedLinqHomeBindingRecipientPhone({
        homeChatId: "chat_home",
        homeRecipientPhone: "+15550100001",
        incomingChatId: "chat_other",
        incomingRecipientPhone: "+15550100002",
      }),
    ).toBe("+15550100002");
  });
});
