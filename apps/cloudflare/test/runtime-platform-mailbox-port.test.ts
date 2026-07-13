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
  it("binds inactive system maintenance purpose at port construction", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        consumedSeqByLane: [{ consumedSeq: "4", lane: "system" }],
        fetchedAt: "2026-07-13T00:00:00.000Z",
        items: [],
        maxSeqByLane: [{ lane: "system", maxSeq: "4" }],
        userId: "member_maintenance",
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const mailboxPort = createHostedWebMailboxPort({
      accessPurpose: "inactive_system_maintenance",
      boundUserId: "member_maintenance",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await mailboxPort.fetch({
      cursorMode: "imported_seq",
      lanes: [{ importedSeq: "4", lane: "system" }],
      limitPerLane: 10,
      purpose: null,
      requestId: "request_maintenance",
    });

    expect(requestBody).toMatchObject({
      purpose: "inactive_system_maintenance",
      requestId: "request_maintenance",
    });
  });

  it("strips a caller-supplied maintenance purpose from an ordinary port", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        consumedSeqByLane: [{ consumedSeq: "7", lane: "conversation" }],
        fetchedAt: "2026-07-13T00:00:00.000Z",
        items: [],
        maxSeqByLane: [{ lane: "conversation", maxSeq: "7" }],
        userId: "member_default",
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const mailboxPort = createHostedWebMailboxPort({
      boundUserId: "member_default",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await mailboxPort.fetch({
      ...mailboxRequest,
      purpose: "inactive_system_maintenance",
    });

    expect(requestBody).not.toHaveProperty("purpose");
  });

  it("binds inactive system maintenance purpose to sidecar fetches", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        fetchedAt: "2026-07-13T00:00:00.000Z",
        payload: {
          createdAt: "2026-07-13T00:00:00.000Z",
          mailboxItemId: "mailbox_system_sidecar",
          payloadCiphertext: "ciphertext",
          payloadSchema: "murph.hosted-mailbox-payload.v1",
          userId: "member_maintenance",
        },
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    });
    const mailboxPort = createHostedWebMailboxPort({
      accessPurpose: "inactive_system_maintenance",
      boundUserId: "member_maintenance",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await mailboxPort.fetchPayload({
      dedupeKey: "dedupe_system_sidecar",
      mailboxItemId: "mailbox_system_sidecar",
      payloadRef: "hosted-mailbox-payload:mailbox_system_sidecar",
      requestId: "request_system_sidecar",
    });

    expect(requestBody).toMatchObject({
      purpose: "inactive_system_maintenance",
      requestId: "request_system_sidecar",
    });
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
