import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startHostedLinqIngressTypingHint } from "@/src/lib/hosted-onboarding/linq-ingress-typing";
import { getPrisma } from "@/src/lib/prisma";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(), start: vi.fn(), stop: vi.fn(),
}));
vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", () => ({
  hostedRuntimeUsageMemberSelect: { billingStatus: true },
  resolveHostedRuntimeAiUsageGate: mocks.gate,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  startHostedLinqChatTypingIndicator: mocks.start,
  stopHostedLinqChatTypingIndicator: mocks.stop,
}));

const member = {
  billingStatus: "active", suspendedAt: null,
  accountGroupMemberships: [], threadContainer: null,
};
function fixture(): Parameters<typeof startHostedLinqIngressTypingHint>[0] {
  return {
    currentInboundReply: { chatId: "chat-synthetic" },
    eventType: "message.received",
    prisma: getPrisma(),
    plan: {
      desiredSideEffects: [],
      response: { ok: true, reason: "wake-appended-active-member" },
      wakeHandoffs: [{
        eventId: "event-synthetic", linqChatId: "chat-synthetic",
        mailboxItemId: "mailbox-synthetic", source: "linq", userId: "member-synthetic",
        wakeMailboxCheckpoint: { lane: "conversation", laneSeq: "1" },
      }],
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  vi.spyOn(getPrisma().hostedMember, "findUnique").mockImplementation(vi.fn().mockResolvedValue(member));
  mocks.gate.mockReset().mockResolvedValue({ status: "allowed" });
  mocks.start.mockReset().mockResolvedValue({ ok: true, status: 204 });
  mocks.stop.mockReset().mockResolvedValue({ ok: true, status: 204 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("admitted direct Linq ingress typing", () => {
  it("returns immediately and records actual provider acceptance, not request start", async () => {
    const provider = deferred<{ ok: boolean; status: number }>();
    mocks.start.mockReturnValue(provider.promise);
    const input = fixture();
    const hint = startHostedLinqIngressTypingHint(input);
    expect(hint).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.gate).toHaveBeenCalledWith(expect.objectContaining({ mode: "read_only", memberState: member }));
    expect(mocks.start).toHaveBeenCalledWith({ chatId: "chat-synthetic", timeoutMs: 2500 });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.400Z"));
    provider.resolve({ ok: true, status: 204 });
    await expect(hint!.started).resolves.toEqual(new Date("2030-01-01T00:00:00.400Z"));
  });

  it.each([
    "duplicate", "group", "wrong-chat", "no-checkpoint", "already-replied", "reaction", "ignored", "aborted", "web-owned",
  ])("does not start or read admission for %s", (scenario) => {
    const input = fixture();
    const wake = input.plan.wakeHandoffs![0]!;
    if (scenario === "duplicate") input.plan.response.duplicate = true;
    if (scenario === "group") input.plan.response.reason = "wake-appended-thread-container";
    if (scenario === "wrong-chat") input.currentInboundReply = { chatId: "other-chat" };
    if (scenario === "no-checkpoint") delete wake.wakeMailboxCheckpoint;
    if (scenario === "already-replied") wake.acceptedLinqDeliveryId = "delivery-synthetic";
    if (scenario === "reaction") input.eventType = "message.reaction.added";
    if (scenario === "ignored") input.plan.response.ignored = true;
    if (scenario === "aborted") input.signal = AbortSignal.abort();
    if (scenario === "web-owned") input.webOwnsReply = true;
    expect(startHostedLinqIngressTypingHint(input)).toBeNull();
    expect(input.prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("retains the existing signup hint without another start", () => {
    const existingHint = { chatId: "signup-chat", started: Promise.resolve(null),
      cancelPendingStart: vi.fn(), stop: vi.fn().mockResolvedValue(null) };
    expect(startHostedLinqIngressTypingHint({ ...fixture(), existingHint })).toBe(existingHint);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([null, { ...member, suspendedAt: new Date() }, { ...member, billingStatus: "inactive" },
    { ...member, threadContainer: { owner: member } },
  ])("rejects absent, inactive, suspended, or synthetic members", async (state) => {
    vi.mocked(getPrisma().hostedMember.findUnique).mockImplementation(vi.fn().mockResolvedValue(state));
    const hint = startHostedLinqIngressTypingHint(fixture())!;
    await expect(hint.started).resolves.toBeNull();
    expect(mocks.gate).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each(["denied", "health_data_consent_withdrawn"])("does not promise a reply for %s", async (status) => {
    mocks.gate.mockResolvedValue({ status });
    const hint = startHostedLinqIngressTypingHint(fixture())!;
    await expect(hint.started).resolves.toBeNull();
    await hint.stop();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it.each(["cancel", "deadline", "abort"])("does not dispatch after %s during admission", async (scenario) => {
    const gate = deferred<{ status: string }>();
    mocks.gate.mockReturnValue(gate.promise);
    const controller = new AbortController();
    const hint = startHostedLinqIngressTypingHint({ ...fixture(), signal: controller.signal })!;
    await vi.advanceTimersByTimeAsync(0);
    const stopped = scenario === "cancel" ? hint.stop() : null;
    if (scenario === "deadline") await vi.advanceTimersByTimeAsync(1000);
    if (scenario === "abort") controller.abort();
    gate.resolve({ status: "allowed" });
    await expect(hint.started).resolves.toBeNull();
    await stopped;
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("clears an issued hint after its pending start settles when handoff fails", async () => {
    const provider = deferred<{ ok: boolean; status: number }>();
    mocks.start.mockReturnValue(provider.promise);
    const hint = startHostedLinqIngressTypingHint(fixture())!;
    await vi.advanceTimersByTimeAsync(0);
    const stopped = hint.stop();
    expect(mocks.stop).not.toHaveBeenCalled();
    provider.resolve({ ok: true, status: 204 });
    await stopped;
    expect(mocks.stop).toHaveBeenCalledWith({ chatId: "chat-synthetic", timeoutMs: 2500 });
  });

  it.each(["admission", "provider", "rejected-response"])("contains %s failure without inventing acceptance", async (failure) => {
    if (failure === "admission") mocks.gate.mockRejectedValue(new Error("synthetic failure"));
    else if (failure === "provider") mocks.start.mockRejectedValue(new Error("synthetic failure"));
    else mocks.start.mockResolvedValue({ ok: false, status: 503 });
    const hint = startHostedLinqIngressTypingHint(fixture())!;
    await expect(hint.started).resolves.toBeNull();
  });
});
