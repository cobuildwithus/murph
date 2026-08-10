import { describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeGroupToolRequest,
  HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";

import { createHostedRuntimeGroupToolPort } from "../src/runtime-platform/group-tool-port.ts";
import {
  HostedWebControlPlaneResponseError,
} from "../src/runtime-platform/web-control-transport.ts";

const replaySafeRequests = [
  {
    action: "ask",
    request: {
      action: "ask",
      groupLabel: "100 Club",
      originAssistantInputId: `ain_${"a".repeat(32)}`,
      originSessionId: "session_private",
      question: "What exercises are scheduled today?",
    },
    response: {
      action: "ask",
      result: { status: "accepted", targetLabel: "100 Club" },
    },
  },
  {
    action: "ask_member",
    request: {
      action: "ask_member",
      grantId: "grant_sleep",
      origin: {
        assistantInputId: `ain_${"b".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group",
      },
      question: "How has the grantor been sleeping lately?",
    },
    response: {
      action: "ask_member",
      result: { status: "accepted" },
    },
  },
  {
    action: "ask_current_sender",
    request: {
      action: "ask_current_sender",
      origin: {
        assistantInputId: `ain_${"c".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    },
    response: {
      action: "ask_current_sender",
      result: { status: "accepted" },
    },
  },
] as const satisfies readonly {
  action: string;
  request: HostedRuntimeGroupToolRequest;
  response: HostedRuntimeGroupToolResponse;
}[];

describe("hosted group tool exact replay", () => {
  it.each(replaySafeRequests)(
    "exact-replays the same $action request when a successful response body is lost",
    async ({ request, response }) => {
      const requestBodies: BodyInit[] = [];
      const fetchImpl = vi.fn<typeof fetch>(async (_request, init) => {
        if (init?.body) {
          requestBodies.push(init.body);
        }
        return requestBodies.length === 1
          ? createLostBodyResponse(200)
          : createJsonResponse(response);
      });
      const port = createHostedRuntimeGroupToolPort({
        boundUserId: "member-bound",
        fetchImpl,
        timeoutMs: 5_000,
        transport: { mode: "proxy" },
      });

      await expect(port.request(request)).resolves.toEqual(response);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(requestBodies).toEqual([
        JSON.stringify(request),
        JSON.stringify(request),
      ]);
    },
  );

  it("exact-replays the same Ask after consuming a complete 5xx response", async () => {
    const { request, response } = replaySafeRequests[0];
    const responses = [
      createJsonResponse({ error: "temporarily unavailable" }, 503),
      createJsonResponse(response),
    ];
    const requestBodies: BodyInit[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_request, init) => {
      if (init?.body) {
        requestBodies.push(init.body);
      }
      return responses.shift()!;
    });
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(request)).resolves.toEqual(response);
    expect(requestBodies).toEqual([
      JSON.stringify(request),
      JSON.stringify(request),
    ]);
  });

  it("returns the second post-header failure after exactly one replay", async () => {
    const firstFailure = new TypeError("First response body lost.");
    const secondFailure = new TypeError("Second response body lost.");
    const responses = [
      createLostBodyResponse(200, firstFailure),
      createLostBodyResponse(200, secondFailure),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(replaySafeRequests[0].request)).rejects.toMatchObject({
      cause: secondFailure,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("cancels a stalled body when the original total deadline expires", async () => {
    let canceled = false;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true;
        },
        pull() {
          // Remain pending until the original request deadline cancels the reader.
        },
      }),
      { status: 200 },
    ));
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 50,
      transport: { mode: "proxy" },
    });

    await expect(port.request(replaySafeRequests[0].request)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(canceled).toBe(true);
  });

  it("does not replay an Ask rejected by Web authority", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      createJsonResponse({ error: "unauthorized" }, 401)
    );
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(replaySafeRequests[0].request)).rejects.toBeInstanceOf(
      HostedWebControlPlaneResponseError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not replay an Ask after the initiating turn is canceled", async () => {
    const abortController = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      abortController.abort(new DOMException("turn cancelled", "AbortError"));
      return createJsonResponse({ error: "temporarily unavailable" }, 503);
    });
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(
      replaySafeRequests[0].request,
      { signal: abortController.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not replay an unrelated group action after a lost body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => createLostBodyResponse(200));
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request({ action: "read_current" })).rejects.toMatchObject({
      cause: expect.any(TypeError),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function createLostBodyResponse(
  status: number,
  error: Error = new TypeError("Response body lost."),
): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  }), { status });
}
