import { describe, expect, it } from "vitest";

import {
  chooseHostedLinqHomeLine,
  resolveHostedLinqActiveRouteDecision,
  resolveHostedLinqHomeBindingRecipientPhone,
} from "@/src/lib/hosted-onboarding/linq-routing-policy";

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

  it("preserves a missing saved home recipient phone when the incoming chat already matches", () => {
    expect(
      resolveHostedLinqHomeBindingRecipientPhone({
        homeChatId: "chat_home",
        homeRecipientPhone: null,
        incomingChatId: "chat_home",
        incomingRecipientPhone: "+15550100002",
      }),
    ).toBeNull();
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
