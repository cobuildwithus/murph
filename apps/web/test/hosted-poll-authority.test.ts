import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ wake: vi.fn(), active: vi.fn(), runtime: vi.fn(), route: vi.fn(), policy: vi.fn(), routing: vi.fn(), group: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ $transaction: async (fn: (tx: object) => unknown) => fn({}) }) }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({ readHostedMailboxConversationWakeByAssistantInputId: m.wake }));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: m.active }));
vi.mock("../src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: m.runtime }));
vi.mock("../src/lib/hosted-onboarding/linq-egress-engagement", () => ({ assertHostedLinqRecentInboundEngagementForRuntime: m.route, resolveHostedLinqEgressPolicyForRuntime: m.policy }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-routing-store", () => ({ readHostedMemberRoutingState: m.routing }));
vi.mock("../src/lib/hosted-routing/thread-route-store", () => ({ assertHostedThreadRouteEgressAuthority: m.group }));
import { authorizePollConversation } from "../src/lib/hosted-polls/authority";
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
