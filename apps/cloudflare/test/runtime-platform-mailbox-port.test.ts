import { describe, expect, it, vi } from "vitest";

import { createHostedWebMailboxPort } from "../src/runtime-platform/mailbox-port.ts";

const mailboxRequest = {
  cursorMode: "imported_seq" as const,
  lanes: [
    {
      importedSeq: "7",
      lane: "conversation" as const,
    },
  ],
  limitPerLane: 10,
  requestId: "request_usage_denied",
};

describe("createHostedWebMailboxPort", () => {
  it("turns an explicit AI usage denial into an empty unchanged mailbox prefix", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED",
        message: "Hosted runtime mailbox AI usage is denied.",
        retryable: false,
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 403,
    }));
    const mailboxPort = createHostedWebMailboxPort({
      boundUserId: "member_usage_denied",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(mailboxPort.fetch(mailboxRequest)).resolves.toMatchObject({
      consumedSeqByLane: [
        {
          consumedSeq: "7",
          lane: "conversation",
        },
      ],
      items: [],
      maxSeqByLane: [
        {
          lane: "conversation",
          maxSeq: "7",
        },
      ],
      userId: "member_usage_denied",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves unrelated mailbox rejections", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "HOSTED_RUNTIME_MEMBER_INACTIVE",
        message: "Hosted runtime member is inactive.",
        retryable: false,
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 403,
    }));
    const mailboxPort = createHostedWebMailboxPort({
      boundUserId: "member_inactive",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(mailboxPort.fetch(mailboxRequest)).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_MEMBER_INACTIVE",
      status: 403,
    });
  });

  it("recognizes an exact AI usage denial preserved as a transport cause", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("Hosted mailbox fetch request failed.", {
        cause: Object.assign(new Error("Hosted runtime mailbox AI usage is denied."), {
          code: "HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED",
          status: 403,
        }),
      });
    });
    const mailboxPort = createHostedWebMailboxPort({
      boundUserId: "member_usage_denied",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(mailboxPort.fetch(mailboxRequest)).resolves.toMatchObject({
      items: [],
      userId: "member_usage_denied",
    });
  });

  it("forwards only replay authority bound by the invocation", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      await expect(request.clone().json()).resolves.toMatchObject({
        replayAuthority: {
          acceptedConversationAt: "2026-04-26T00:00:01.000Z",
          acceptedConversationSeq: "8",
          bootstrapActivationAllowed: true,
          processingMode: "conversation_replay",
        },
      });
      expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("attempt-replay");
      return new Response(JSON.stringify({
        consumedSeqByLane: [{ consumedSeq: "7", lane: "conversation" }],
        fetchedAt: "2026-04-26T00:00:02.000Z",
        items: [],
        maxSeqByLane: [{ lane: "conversation", maxSeq: "8" }],
        userId: "member_replay",
      }), { headers: { "content-type": "application/json" } });
    });
    const mailboxPort = createHostedWebMailboxPort({
      boundUserId: "member_replay",
      fetchImpl: fetchImpl as typeof fetch,
      replayAuthority: {
        acceptedConversationAt: "2026-04-26T00:00:01.000Z",
        acceptedConversationSeq: "8",
        bootstrapActivationAllowed: true,
        processingMode: "conversation_replay",
      },
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
      workspaceCheckpointBridge: {
        readCurrentLease: () => ({
          attemptId: "attempt-replay",
          leaseGeneration: "3",
          userId: "member_replay",
          workspaceVersion: "9",
        }),
      },
    });

    await expect(mailboxPort.fetch({
      ...mailboxRequest,
      lanes: [
        ...mailboxRequest.lanes,
        { importedSeq: "0", lane: "system" },
      ],
      limitPerLane: 1,
      replayAuthority: {
        acceptedConversationAt: "2026-04-26T00:00:01.000Z",
        acceptedConversationSeq: "8",
        bootstrapActivationAllowed: true,
        processingMode: "conversation_replay",
      },
    })).resolves.toMatchObject({ userId: "member_replay" });
  });

  it("rejects runtime-supplied replay authority that differs from the invocation", async () => {
    const fetchImpl = vi.fn();
    const mailboxPort = createHostedWebMailboxPort({
      boundUserId: "member_replay",
      fetchImpl: fetchImpl as typeof fetch,
      replayAuthority: {
        acceptedConversationAt: "2026-04-26T00:00:01.000Z",
        acceptedConversationSeq: "8",
        bootstrapActivationAllowed: false,
        processingMode: "conversation_replay",
      },
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(mailboxPort.fetch({
      ...mailboxRequest,
      limitPerLane: 1,
      replayAuthority: {
        acceptedConversationAt: null,
        acceptedConversationSeq: "9",
        bootstrapActivationAllowed: false,
        processingMode: "conversation_replay_usage_limit",
      },
    })).rejects.toThrow("does not match the runtime invocation");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
