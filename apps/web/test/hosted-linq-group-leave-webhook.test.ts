import { createHmac } from "node:crypto";
import { APIConnectionTimeoutError, APIError } from "@linqapp/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import { requestHostedLinqGroupLeaveAfterCommit } from "@/src/lib/hosted-routing/linq-group-leave";
import { readHostedLinqGroupLeftWebhookResponse, scheduleHostedLinqGroupLeaveAfterCommit } from "@/src/lib/hosted-onboarding/linq-group-leave-webhook";

const effects = vi.hoisted(() => ({ leave: vi.fn(), roster: vi.fn(), poll: vi.fn(), crypto: vi.fn() }));
vi.mock("@linqapp/sdk", async original => ({ ...await original<typeof import("@linqapp/sdk")>(),
  default: class { chats = { leaveChat: effects.leave, retrieve: effects.roster }; },
}));
vi.mock("@/src/lib/hosted-polls/linq-webhook", () => ({ handleHostedLinqPollWebhook: effects.poll }));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async original => ({ ...await original<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(),
  prepareHostedCryptoDomainRootCandidates: effects.crypto,
}));

describe("left-group webhook admission", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv("LINQ_WEBHOOK_SECRET", "synthetic-leave-secret");
    vi.stubEnv("LINQ_API_TOKEN", "synthetic-token");
    vi.resetAllMocks(); effects.poll.mockResolvedValue(false);
  });
  function request(eventType: string, nested = true, isGroup = true) {
    const rawBody = JSON.stringify({ api_version: "v3", event_id: "synthetic-event", event_type: eventType,
      created_at: new Date().toISOString(), webhook_version: "2026-02-03",
      data: nested ? { chat: { id: "synthetic-room", is_group: isGroup } } : { chat_id: "synthetic-room" },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    return { rawBody, timestamp, signature: createHmac("sha256", "synthetic-leave-secret").update(`${timestamp}.${rawBody}`).digest("hex") };
  }
  it.each([
    ["message.received", true], ["message.received", false], ["message.edited", true],
    ["reaction.added", true], ["reaction.removed", true], ["message.reaction.added", false], ["message.reaction.removed", false],
    ["participant.added", false], ["participant.removed", false], ["chat.typing_indicator.started", false],
    ["poll.vote.added", true], ["poll.vote.removed", true], ["message.delivered", false],
  ])("silently fences %s before fan-out (nested=%s)", async (eventType, nested) => {
    const findFirst = vi.fn().mockResolvedValue({ threadIdentityLookupKey: "synthetic-marker" });
    const transaction = vi.fn();
    expect(await handleHostedOnboardingLinqWebhook({ ...request(String(eventType), Boolean(nested)),
      prisma: { hostedLinqGroupLeave: { findFirst }, $transaction: transaction } as never }))
      .toEqual({ ok: true, ignored: true, reason: "group-left" });
    expect(findFirst).toHaveBeenCalledOnce();
    const query = findFirst.mock.calls[0]![0];
    expect(query.select).toEqual({ threadIdentityLookupKey: true });
    expect(query.where.threadIdentityLookupKey.in.length).toBeLessThanOrEqual(2);
    expect(transaction).not.toHaveBeenCalled();
    expect(effects.roster).not.toHaveBeenCalled(); expect(effects.poll).not.toHaveBeenCalled();
    expect(effects.crypto).not.toHaveBeenCalled(); expect(effects.leave).not.toHaveBeenCalled();
  });
  it("treats a marker database failure as retryable before poll handling", async () => {
    await expect(handleHostedOnboardingLinqWebhook({ ...request("poll.vote.added"),
      prisma: { hostedLinqGroupLeave: { findFirst: vi.fn().mockRejectedValue(new Error("synthetic failure")) } } as never }))
      .rejects.toMatchObject({ httpStatus: 503, retryable: true, code: "HOSTED_LINQ_GROUP_LEAVE_READ_UNAVAILABLE" });
    expect(effects.poll).not.toHaveBeenCalled();
  });
  it("authenticates before consulting markers", async () => {
    const findFirst = vi.fn();
    await expect(handleHostedOnboardingLinqWebhook({ ...request("poll.vote.added"), signature: "invalid",
      prisma: { hostedLinqGroupLeave: { findFirst } } as never })).rejects.toMatchObject({ httpStatus: 401 });
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("keeps an unmarked direct typing event on its ordinary path", async () => {
    expect(await handleHostedOnboardingLinqWebhook({ ...request("chat.typing_indicator.started", false),
      prisma: { hostedLinqGroupLeave: { findFirst: vi.fn().mockResolvedValue(null) } } as never }))
      .toEqual({ ok: true, ignored: true, reason: "typing-ignored" });
    expect(effects.poll).toHaveBeenCalledOnce(); expect(effects.leave).not.toHaveBeenCalled();
  });
  it("skips the marker read for an attested direct chat", async () => {
    const findFirst = vi.fn();
    const event = JSON.parse(request("message.received", true, false).rawBody);
    expect(await readHostedLinqGroupLeftWebhookResponse(event, { hostedLinqGroupLeave: { findFirst } } as never))
      .toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
  it.each([
    { kind: "accepted 202", failure: null, outcome: "accepted" },
    { kind: "conflict 409/2015", failure: new APIError(409, { error: { code: 2015 } }, "synthetic", new Headers()), outcome: "unconfirmed" },
    { kind: "timeout", failure: new APIConnectionTimeoutError(), outcome: "unconfirmed" },
    { kind: "rejected", failure: new APIError(422, {}, "synthetic", new Headers()), outcome: "rejected" },
  ])("preserves local success on $kind, with one bounded attempt", async ({ failure, outcome }) => {
    if (failure) effects.leave.mockRejectedValue(failure); else effects.leave.mockResolvedValue({ status: "queued" });
    expect(await requestHostedLinqGroupLeaveAfterCommit({ chatId: "synthetic-room" })).toBe(outcome);
    expect(effects.leave).toHaveBeenCalledOnce();
  });
  it("does not dispatch a committed target until the response scheduler runs", async () => {
    const tasks: Array<() => Promise<void>> = [];
    scheduleHostedLinqGroupLeaveAfterCommit({ target: { chatId: "synthetic-room" }, scheduleAfterResponse: task => { tasks.push(task); } });
    scheduleHostedLinqGroupLeaveAfterCommit({ scheduleAfterResponse: task => { tasks.push(task); } });
    expect(effects.leave).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1); await tasks[0]!(); expect(effects.leave).toHaveBeenCalledOnce();
  });
});
