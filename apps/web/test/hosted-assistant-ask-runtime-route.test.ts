import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleHostedRuntimeAssistantAskControl: vi.fn(),
  handoffHostedMailboxWake: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));
vi.mock("@/src/lib/hosted-groups/group-assistant-ask", () => ({
  handleHostedRuntimeAssistantAskControl:
    mocks.handleHostedRuntimeAssistantAskControl,
}));
vi.mock("@/src/lib/hosted-orchestration/mailbox-wake", () => ({
  handoffHostedMailboxWake: mocks.handoffHostedMailboxWake,
}));

import { POST } from "@/app/api/internal/hosted-execution/assistant-asks/runtime/route";

function runtimeRequest(body: unknown, input: { includeFence?: boolean } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (input.includeFence !== false) {
    headers.set("x-hosted-runtime-attempt-id", "attempt-one");
    headers.set("x-hosted-runtime-lease-generation", "2");
    headers.set("x-hosted-runtime-workspace-version", "7");
  }
  return new Request(
    "https://web.example.test/api/internal/hosted-execution/assistant-asks/runtime",
    {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    },
  );
}

describe("Hosted Assistant Ask runtime route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handoffHostedMailboxWake.mockResolvedValue(undefined);
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(
      "member-group-runtime",
    );
  });

  it("requires the active runtime write fence before signature verification", async () => {
    const response = await POST(runtimeRequest({
      action: "prepare",
      requestId: "aask_req_one",
    }, { includeFence: false }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_ASSISTANT_ASK_RUNTIME_WRITE_FENCE_REQUIRED" },
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
    expect(mocks.handleHostedRuntimeAssistantAskControl).not.toHaveBeenCalled();
  });

  it("binds prepare to the signed runtime identity", async () => {
    mocks.handleHostedRuntimeAssistantAskControl.mockResolvedValue({
      mailboxWake: null,
      response: {
        action: "prepare",
        question: "What is today's workout?",
        status: "ready",
        targetLabel: "100 Club",
      },
    });

    const request = runtimeRequest({
      action: "prepare",
      requestId: "aask_req_one",
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "prepare",
      question: "What is today's workout?",
      status: "ready",
      targetLabel: "100 Club",
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        maxBodyBytes: 32 * 1_024,
        payloadText: expect.any(String),
      }),
    );
    expect(mocks.handleHostedRuntimeAssistantAskControl).toHaveBeenCalledWith({
      boundRuntimeMemberId: "member-group-runtime",
      request: { action: "prepare", requestId: "aask_req_one" },
    });
  });

  it("wakes only the committed private completion before responding", async () => {
    mocks.handleHostedRuntimeAssistantAskControl.mockResolvedValue({
      mailboxWake: {
        expectedUserId: "member-personal",
        mailboxItemId: "aask_done_one",
      },
      response: { action: "complete", status: "completed" },
    });

    const response = await POST(runtimeRequest({
      action: "complete",
      requestId: "aask_req_one",
      result: { answer: "Three sets of squats.", outcome: "answered" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "complete",
      status: "completed",
    });
    expect(mocks.handoffHostedMailboxWake).toHaveBeenCalledWith({
      directWakeSource: "assistant-ask-completion",
      expectedUserId: "member-personal",
      mailboxItemId: "aask_done_one",
    });
  });

  it("does not acknowledge a committed completion when its durable handoff rejects", async () => {
    mocks.handoffHostedMailboxWake.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );
    mocks.handleHostedRuntimeAssistantAskControl.mockResolvedValue({
      mailboxWake: {
        expectedUserId: "member-personal",
        mailboxItemId: "aask_done_one",
      },
      response: { action: "complete", status: "completed" },
    });

    const response = await POST(runtimeRequest({
      action: "complete",
      requestId: "aask_req_one",
      result: { answer: "Three sets of squats.", outcome: "answered" },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
  });

  it("admits a valid maximum multibyte completion body", async () => {
    const answer = "🧠".repeat(4_000);
    mocks.handleHostedRuntimeAssistantAskControl.mockResolvedValue({
      mailboxWake: null,
      response: { action: "complete", status: "already_completed" },
    });

    const response = await POST(runtimeRequest({
      action: "complete",
      requestId: "aask_req_one",
      result: { answer, outcome: "answered" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.handleHostedRuntimeAssistantAskControl).toHaveBeenCalledWith({
      boundRuntimeMemberId: "member-group-runtime",
      request: {
        action: "complete",
        requestId: "aask_req_one",
        result: { answer, outcome: "answered" },
      },
    });
  });
});
