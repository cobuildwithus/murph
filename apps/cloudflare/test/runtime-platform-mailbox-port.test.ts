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
  it("forwards an initial mailbox fetch abort and preserves its exact reason", async () => {
    const fetchController = new AbortController();
    const wakeReason = new Error("Foreground runtime wake interrupted mailbox fetch.");
    let markFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      expect(signal).toBeTruthy();
      markFetchStarted?.();
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(signal?.reason);
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
      });
    });
    const mailboxPort = createHostedWebMailboxPort({
      boundUserId: "member_fetch_abort",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 30_000,
      transport: { mode: "proxy" },
    });

    const fetchResult = mailboxPort.fetch(mailboxRequest, {
      signal: fetchController.signal,
    });
    await fetchStarted;
    fetchController.abort(wakeReason);

    await expect(fetchResult).rejects.toBe(wakeReason);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

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
});
