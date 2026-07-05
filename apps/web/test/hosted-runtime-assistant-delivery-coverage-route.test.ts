import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  advanceHostedMailboxConsumedSeqByLane: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  requireHostedRuntimeMailboxActiveAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeMailboxActiveAccess: mocks.requireHostedRuntimeMailboxActiveAccess,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  advanceHostedMailboxConsumedSeqByLane: mocks.advanceHostedMailboxConsumedSeqByLane,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-runtime/assistant-delivery/coverage-record/route"
);

let route: RouteModule;

describe("hosted runtime assistant delivery coverage route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-runtime/assistant-delivery/coverage-record/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.advanceHostedMailboxConsumedSeqByLane.mockResolvedValue([
      {
        consumedSeq: "42",
        lane: "conversation",
      },
    ]);
  });

  it("advances mailbox coverage for an accepted assistant delivery", async () => {
    const response = await route.POST(buildCoverageRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredCoverage: {
        lane: "conversation",
        laneSeq: "42",
      },
      deliveryChannel: "email",
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      providerMessageId: "email_message_sent",
      target: "thread-email",
      targetKind: "thread",
    }));

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 8 * 1024 },
    );
    expect(mocks.requireHostedRuntimeMailboxActiveAccess).toHaveBeenCalledWith(
      "member_123",
    );
    expect(mocks.advanceHostedMailboxConsumedSeqByLane).toHaveBeenCalledWith({
      lanes: [{
        consumedSeq: "42",
        lane: "conversation",
      }],
      userId: "member_123",
    });
    await expect(response.json()).resolves.toEqual({
      consumedSeqByLane: [{
        consumedSeq: "42",
        lane: "conversation",
      }],
      ok: true,
    });
  });

  it("rejects coverage without a delivery identity", async () => {
    const response = await route.POST(buildCoverageRequest({
      acceptedAt: "2026-04-26T00:00:04.000Z",
      answeredCoverage: {
        lane: "conversation",
        laneSeq: "42",
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.advanceHostedMailboxConsumedSeqByLane).not.toHaveBeenCalled();
  });
});

function buildCoverageRequest(body: unknown): Request {
  return new Request(
    "https://join.example.test/api/internal/hosted-runtime/assistant-delivery/coverage-record",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
