import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ wake: vi.fn(), active: vi.fn(), runtime: vi.fn(), route: vi.fn(), policy: vi.fn(), routing: vi.fn(), group: vi.fn(), notificationRoute: vi.fn(), linq: vi.fn(), telegram: vi.fn(), question: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ $transaction: async (fn: (tx: object) => unknown) => fn({}) }) }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({ readHostedMailboxConversationWakeByAssistantInputId: m.wake }));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: m.active }));
vi.mock("../src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: m.runtime }));
vi.mock("../src/lib/hosted-onboarding/linq-egress-engagement", () => ({ assertHostedLinqRecentInboundEngagementForRuntime: m.route, resolveHostedLinqEgressPolicyForRuntime: m.policy }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-routing-store", () => ({ readHostedMemberRoutingState: m.routing }));
vi.mock("../src/lib/hosted-routing/thread-route-store", () => ({ assertHostedThreadRouteEgressAuthority: m.group }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", () => ({ assertHostedAssistantNotificationRouteAuthority: m.notificationRoute }));
vi.mock("../src/lib/hosted-polls/provider", () => ({ callLinqPoll: m.linq, callTelegramPoll: m.telegram }));
vi.mock("../src/lib/hosted-onboarding/linq-client", () => ({ sendHostedLinqChatMessage: m.question }));
import { authorizePollConversation } from "../src/lib/hosted-polls/authority";
import { handleHostedConversationPollTool } from "../src/lib/hosted-polls/tool";
import type { ConversationPollAction } from "@murphai/hosted-execution/conversation-polls";
const input = { memberId: "member_synthetic", runtimeIdentity: null, request: { assistantInputId: "ain_" + "a".repeat(32), request: { action: "create" as const, question: "Day?", options: ["Saturday", "Sunday"] } } };
function linq(service = "iMessage", isFromMe = false) {
  return { kind: "conversation.message", message: { channel: "linq", linqMessage: { chatId: "chat", service, isFromMe, threadIsDirect: false } } };
}
function telegram(threadIsDirect = true, threadId = "100") {
  return { kind: "conversation.message", message: { channel: "telegram", telegramMessage: { threadId, threadIsDirect }, ...(threadIsDirect ? {} : { routeAuthority: { channel: "telegram", containerMemberId: input.memberId, threadId } }) } };
}
describe("poll current-conversation authority", () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.wake.mockResolvedValue(linq());
    m.route.mockResolvedValue({ resolvedRoute: { target: "chat", fromPhoneNumber: null }, linePhoneNumberLookupKey: "line" });
    m.policy.mockResolvedValue({ policy: { kind: "allow" } }); m.routing.mockResolvedValue({ telegramThreadId: "100" });
  });
  it("derives iMessage routing from accepted input and checks egress policy", async () => {
    expect(await authorizePollConversation(input)).toEqual({ channel: "linq", target: "chat" });
    expect(m.wake).toHaveBeenCalledWith(expect.objectContaining({ memberId: input.memberId, assistantInputId: input.request.assistantInputId }));
    expect(m.route).toHaveBeenCalledWith(expect.objectContaining({ memberId: input.memberId, target: "chat" }));
    expect(m.policy).toHaveBeenCalledOnce();
  });
  it.each([linq("SMS"), linq("RCS"), linq("iMessage", true), null])("rejects unsupported or self-authored input", async (wake) => {
    m.wake.mockResolvedValue(wake); await expect(authorizePollConversation(input)).rejects.toThrow();
    expect(m.route).not.toHaveBeenCalled();
  });
  it("denies a revoked or blocked Linq route", async () => {
    m.route.mockRejectedValueOnce(new Error("Revoked")); await expect(authorizePollConversation(input)).rejects.toThrow("Revoked");
    m.policy.mockResolvedValueOnce({ policy: { kind: "block", code: "chat_opted_out" } });
    await expect(authorizePollConversation(input)).rejects.toThrow("blocked");
  });
  it("applies the live egress block to votes as well as creation", async () => {
    m.policy.mockResolvedValueOnce({ policy: { kind: "block", code: "chat_opted_out" } });
    await expect(authorizePollConversation({ ...input, request: { ...input.request, request: { action: "vote", pollRef: "poll_" + "a".repeat(32), optionIndex: 0, operation: "add" } } })).rejects.toThrow("blocked");
    expect(m.policy).toHaveBeenCalledOnce();
  });
  it("checks the canonical private Telegram route", async () => {
    m.wake.mockResolvedValue(telegram());
    expect(await authorizePollConversation(input)).toEqual({ channel: "telegram", target: "100" });
    m.routing.mockResolvedValueOnce({ telegramThreadId: "200" });
    await expect(authorizePollConversation(input)).rejects.toThrow("changed");
  });
  it("revalidates Telegram room authority including its exact topic", async () => {
    m.wake.mockResolvedValue(telegram(false, "-100:topic:12"));
    expect(await authorizePollConversation(input)).toEqual({ channel: "telegram", target: "-100:topic:12" });
    expect(m.group).toHaveBeenCalledOnce();
    m.group.mockRejectedValueOnce(new Error("Not owned"));
    await expect(authorizePollConversation(input)).rejects.toThrow("Not owned");
  });
  it("rejects group authority naming another runtime before route lookup", async () => {
    const wake = telegram(false, "-100"); wake.message.routeAuthority = { channel: "telegram", containerMemberId: "other", threadId: "-100" };
    m.wake.mockResolvedValue(wake); await expect(authorizePollConversation(input)).rejects.toThrow("not authorized");
    expect(m.group).not.toHaveBeenCalled();
  });
});

describe("scheduled poll authority", () => {
  function scheduled(channel: "linq" | "telegram" = "linq", target = "chat", request: ConversationPollAction = input.request.request) {
    return { ...input, request: {
      origin: { kind: "automation_occurrence" as const, automationId: "automation_poll", occurrenceAt: "2026-11-02T14:00:00.000Z" },
      route: { channel, target }, request,
    } };
  }
  beforeEach(() => {
    vi.resetAllMocks();
    m.wake.mockResolvedValue(null);
    m.route.mockResolvedValue({ resolvedRoute: { target: "chat", fromPhoneNumber: null }, linePhoneNumberLookupKey: "line" });
    m.policy.mockResolvedValue({ policy: { kind: "allow" }, service: " iMessage " });
  });
  it("uses chat health without retained mailbox content and preserves common admission", async () => {
    expect(await authorizePollConversation(scheduled())).toEqual({ channel: "linq", target: "chat" });
    expect(m.runtime).toHaveBeenCalledExactlyOnceWith(expect.anything(), input.memberId, null);
    expect(m.active).toHaveBeenCalledExactlyOnceWith(input.memberId, expect.anything());
    expect(m.wake).not.toHaveBeenCalled();
    expect(m.route).toHaveBeenCalledWith(expect.objectContaining({ authorityCheckOnly: true, memberId: input.memberId, target: "chat" }));
    expect(m.policy).toHaveBeenCalledWith(expect.objectContaining({ target: "chat", targetKind: "thread", linePhoneNumberLookupKey: "line" }));
  });
  it.each([null, "unknown", "SMS", "RCS"])("refuses service %s before sending question or poll", async (service) => {
    m.policy.mockResolvedValue({ policy: { kind: "allow" }, service });
    await expect(handleHostedConversationPollTool(scheduled())).rejects.toMatchObject({ code: "HOSTED_POLL_UNSUPPORTED_SERVICE" });
    expect(m.question).not.toHaveBeenCalled(); expect(m.linq).not.toHaveBeenCalled(); expect(m.telegram).not.toHaveBeenCalled();
  });
  it.each(["create", "vote"] as const)("refuses blocked %s before provider work", async (action) => {
    m.policy.mockResolvedValue({ policy: { kind: "block" }, service: "imessage" });
    const request: ConversationPollAction = action === "create" ? input.request.request : { action, pollRef: "poll_" + "a".repeat(32), optionIndex: 0, operation: "add" };
    await expect(handleHostedConversationPollTool(scheduled("linq", "chat", request))).rejects.toThrow("blocked");
    expect(m.question).not.toHaveBeenCalled(); expect(m.linq).not.toHaveBeenCalled();
  });
  it.each(["list", "read"] as const)("does not apply send-policy blocks to %s", async (action) => {
    m.policy.mockResolvedValue({ policy: { kind: "block" }, service: "imessage" });
    const request: ConversationPollAction = action === "list" ? { action } : { action, pollRef: "poll_" + "a".repeat(32) };
    expect(await authorizePollConversation(scheduled("linq", "chat", request))).toEqual({ channel: "linq", target: "chat" });
  });
  it("refuses a changed Linq route before service lookup or dispatch", async () => {
    m.route.mockResolvedValueOnce({ resolvedRoute: { target: "other-chat" } });
    await expect(handleHostedConversationPollTool(scheduled())).rejects.toThrow("changed");
    expect(m.policy).not.toHaveBeenCalled(); expect(m.question).not.toHaveBeenCalled(); expect(m.linq).not.toHaveBeenCalled();
  });
  it.each([true, false])("uses notification authority for Telegram direct=%s with the exact target", async (direct) => {
    const target = direct ? "100" : "-100:topic:12";
    m.notificationRoute.mockResolvedValueOnce(direct);
    expect(await authorizePollConversation(scheduled("telegram", target))).toEqual({ channel: "telegram", target });
    expect(m.notificationRoute).toHaveBeenCalledExactlyOnceWith({ authority: { channel: "telegram", containerMemberId: input.memberId, threadId: target }, prisma: expect.anything() });
    expect(m.wake).not.toHaveBeenCalled(); expect(m.routing).not.toHaveBeenCalled(); expect(m.group).not.toHaveBeenCalled();
  });
  it.each(["foreign", "changed", "removed"])("propagates %s Telegram route denial before effects", async (reason) => {
    m.notificationRoute.mockRejectedValueOnce(new Error(reason));
    await expect(handleHostedConversationPollTool(scheduled("telegram", "-100:topic:12"))).rejects.toThrow(reason);
    expect(m.telegram).not.toHaveBeenCalled(); expect(m.routing).not.toHaveBeenCalled();
  });
  it.each(["runtime", "active"] as const)("requires %s admission before route resolution", async (gate) => {
    m[gate].mockRejectedValueOnce(new Error("Revoked"));
    await expect(handleHostedConversationPollTool(scheduled())).rejects.toThrow("Revoked");
    expect(m.route).not.toHaveBeenCalled(); expect(m.question).not.toHaveBeenCalled(); expect(m.linq).not.toHaveBeenCalled();
  });
});
