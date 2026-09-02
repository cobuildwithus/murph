import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleHostedRuntimeAssistantAskControl: vi.fn(),
  handoffHostedMailboxWake: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  tryHandleHostedOperatorDiagnosticControl: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));
vi.mock("@/src/lib/hosted-groups/group-assistant-ask", () => ({
  handleHostedRuntimeAssistantAskControl:
    mocks.handleHostedRuntimeAssistantAskControl,
}));
vi.mock("@/src/lib/hosted-ops/operator-task", () => ({
  tryHandleHostedOperatorDiagnosticControl:
    mocks.tryHandleHostedOperatorDiagnosticControl,
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
    mocks.tryHandleHostedOperatorDiagnosticControl.mockResolvedValue(null);
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

  it("routes an operator diagnostic through its private result owner", async () => {
    mocks.tryHandleHostedOperatorDiagnosticControl.mockResolvedValue({
      mailboxWake: null,
      response: {
        action: "prepare",
        disclosure: { permissionText: "Read only." },
        question: "Inspect the selected automation.",
        status: "ready",
        targetLabel: null,
      },
    });

    const response = await POST(runtimeRequest({
      action: "prepare",
      requestId: `aask_req_${"a".repeat(64)}`,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "prepare",
      question: "Inspect the selected automation.",
      status: "ready",
    });
    expect(mocks.handleHostedRuntimeAssistantAskControl).not.toHaveBeenCalled();
  });

  it("completes a group-runtime operator diagnostic without delivery", async () => {
    const result = {
      answer: "Synthetic group-runtime diagnostic.",
      outcome: "answered" as const,
    };
    mocks.tryHandleHostedOperatorDiagnosticControl.mockResolvedValue({
      mailboxWake: null,
      response: { action: "complete", status: "completed" },
    });

    const response = await POST(runtimeRequest({
      action: "complete",
      requestId: `aask_req_${"b".repeat(64)}`,
      result,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "complete",
      status: "completed",
    });
    expect(mocks.tryHandleHostedOperatorDiagnosticControl).toHaveBeenCalledWith({
      boundRuntimeMemberId: "member-group-runtime",
      request: {
        action: "complete",
        requestId: `aask_req_${"b".repeat(64)}`,
        result,
      },
    });
    expect(mocks.handleHostedRuntimeAssistantAskControl).not.toHaveBeenCalled();
    expect(mocks.handoffHostedMailboxWake).not.toHaveBeenCalled();
  });

  it("wakes only the committed private completion before responding", async () => {
    mocks.handleHostedRuntimeAssistantAskControl.mockResolvedValue({
      mailboxWake: {
        expectedUserId: "member-personal",
        mailboxItemId: "aask_done_one",
      },
      response: { action: "complete", status: "completed" },
    });

    const request = runtimeRequest({
      action: "complete",
      requestId: "aask_req_one",
      result: { answer: "Three sets of squats.", outcome: "answered" },
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "complete",
      status: "completed",
    });
    expect(mocks.handoffHostedMailboxWake).toHaveBeenCalledWith({
      directWakeSource: "assistant-ask-completion",
      expectedUserId: "member-personal",
      mailboxItemId: "aask_done_one",
      signal: request.signal,
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
