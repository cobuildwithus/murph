import { describe, expect, it } from "vitest";

import {
  chooseHostedLinqConversationRecipientPhone,
  chooseHostedLinqHomeLine,
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

describe("chooseHostedLinqHomeLine", () => {
  it("keeps a preferred DB line when active and daily caps have room", () => {
    expect(
      chooseHostedLinqHomeLine({
        activeMembersByRecipientPhone: new Map([["+15550100001", 1]]),
        lines: [
          buildLine("+15550100001", {
            activeMemberLimit: 3,
            maxNewConversationsPerDay: 2,
          }),
          buildLine("+15550100002", {
            activeMemberLimit: 3,
            maxNewConversationsPerDay: 2,
          }),
        ],
        newAssignmentsByRecipientPhone: new Map([["+15550100001", 1]]),
        preferredRecipientPhone: "+15550100001",
      })?.phoneNumber,
    ).toBe("+15550100001");
  });

  it("skips DB lines that reached their daily new-conversation cap", () => {
    expect(
      chooseHostedLinqHomeLine({
        activeMembersByRecipientPhone: new Map([
          ["+15550100001", 0],
          ["+15550100002", 2],
        ]),
        lines: [
          buildLine("+15550100001", {
            activeMemberLimit: 3,
            maxNewConversationsPerDay: 1,
          }),
          buildLine("+15550100002", {
            activeMemberLimit: 3,
            maxNewConversationsPerDay: 3,
          }),
        ],
        newAssignmentsByRecipientPhone: new Map([
          ["+15550100001", 1],
          ["+15550100002", 0],
        ]),
        preferredRecipientPhone: "+15550100001",
      })?.phoneNumber,
    ).toBe("+15550100002");
  });

  it("fails closed when every DB line is over an assignment cap", () => {
    expect(
      chooseHostedLinqHomeLine({
        activeMembersByRecipientPhone: new Map([["+15550100001", 3]]),
        lines: [
          buildLine("+15550100001", {
            activeMemberLimit: 3,
            maxNewConversationsPerDay: 10,
          }),
          buildLine("+15550100002", {
            activeMemberLimit: 3,
            maxNewConversationsPerDay: 1,
          }),
        ],
        newAssignmentsByRecipientPhone: new Map([["+15550100002", 1]]),
        preferredRecipientPhone: "+15550100001",
      }),
    ).toBeNull();
  });
});

describe("resolveHostedLinqActiveRouteDecision", () => {
  it("keeps using the current home chat when the incoming chat matches it", () => {
    expect(
      resolveHostedLinqActiveRouteDecision({
        homeChatId: "chat_home",
        homeRecipientPhone: "+15550100001",
        incomingChatId: "chat_home",
        // Known chat ids bind without consulting the attestation flag.
        incomingDirectAttested: false,
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
        incomingDirectAttested: false,
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
        incomingDirectAttested: true,
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
        incomingDirectAttested: true,
        incomingRecipientPhone: null,
      }),
    ).toEqual({
      kind: "ignore_unknown_home",
    });
  });

  it("still binds a FIRST home chat without attestation (signup compatibility)", () => {
    // Linq 1:1 payloads are not confirmed to always carry is_group; failing closed on the
    // first bind would break signup. Only rebinds demand the explicit attestation.
    expect(
      resolveHostedLinqActiveRouteDecision({
        homeChatId: null,
        homeRecipientPhone: null,
        incomingChatId: "chat_new",
        incomingDirectAttested: false,
        incomingRecipientPhone: "+15550100001",
      }),
    ).toEqual({
      kind: "bind_home",
    });
  });

  it("binds a first home chat when the payload attests the chat is direct", () => {
    expect(
      resolveHostedLinqActiveRouteDecision({
        homeChatId: null,
        homeRecipientPhone: null,
        incomingChatId: "chat_new",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100001",
      }),
    ).toEqual({
      kind: "bind_home",
    });
  });

  it("refuses to rebind the home chat to a new chat id without an explicit direct attestation", () => {
    expect(
      resolveHostedLinqActiveRouteDecision({
        homeChatId: "chat_home",
        homeRecipientPhone: "+15550100001",
        incomingChatId: "chat_other",
        incomingDirectAttested: false,
        incomingRecipientPhone: "+15550100001",
      }),
    ).toEqual({
      kind: "ignore_unattested_direct",
    });
  });

  it("rebinds to a new chat id when the payload attests the chat is direct", () => {
    expect(
      resolveHostedLinqActiveRouteDecision({
        homeChatId: "chat_home",
        homeRecipientPhone: "+15550100001",
        incomingChatId: "chat_other",
        incomingDirectAttested: true,
        incomingRecipientPhone: "+15550100001",
      }),
    ).toEqual({
      kind: "bind_home",
    });
  });
});

function buildLine(
  phoneNumber: string,
  overrides: Partial<{
    activeMemberLimit: number | null;
    assignmentWeight: number;
    maxNewConversationsPerDay: number | null;
  }> = {},
) {
  return {
    activeMemberLimit: overrides.activeMemberLimit ?? null,
    assignmentWeight: overrides.assignmentWeight ?? 100,
    maxNewConversationsPerDay: overrides.maxNewConversationsPerDay ?? null,
    phoneNumber,
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: `lookup:${phoneNumber}`,
  };
}

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
