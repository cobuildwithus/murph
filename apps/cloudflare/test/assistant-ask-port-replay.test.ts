import { describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeAssistantAskControlRequest,
  HostedRuntimeAssistantAskControlResponse,
} from "@murphai/hosted-execution/runtime-control";

import { createHostedRuntimeAssistantAskPort } from "../src/runtime-platform/assistant-ask-port.ts";
import {
  HostedWebControlPlaneResponseError,
} from "../src/runtime-platform/web-control-transport.ts";

const replaySafeRequests = [
  {
    action: "prepare",
    request: { action: "prepare", requestId: "aask_req_one" },
    response: {
      action: "prepare",
      question: "What is today's workout?",
      status: "ready",
      targetLabel: "100 Club",
    },
  },
  {
    action: "complete",
    request: {
      action: "complete",
      requestId: "aask_req_one",
      result: { answer: "Three sets of squats.", outcome: "answered" },
    },
    response: { action: "complete", status: "completed" },
  },
] as const satisfies readonly {
  action: string;
  request: HostedRuntimeAssistantAskControlRequest;
  response: HostedRuntimeAssistantAskControlResponse;
}[];

describe("hosted Assistant Ask control exact replay", () => {
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
      const port = createHostedRuntimeAssistantAskPort({
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

  it("exact-replays a committed completion after a complete 5xx response", async () => {
    const { request, response } = replaySafeRequests[1];
    const responses = [
      createJsonResponse({ error: "temporarily unavailable" }, 503),
      createJsonResponse(response),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const port = createHostedRuntimeAssistantAskPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(request)).resolves.toEqual(response);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not replay a request rejected by Web authority", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      createJsonResponse({ error: "unauthorized" }, 401)
    );
    const port = createHostedRuntimeAssistantAskPort({
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

  it("does not replay after the caller cancels the request", async () => {
    const abortController = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      abortController.abort(new DOMException("caller cancelled", "AbortError"));
      return createLostBodyResponse(200);
    });
    const port = createHostedRuntimeAssistantAskPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(
      replaySafeRequests[0].request,
      { signal: abortController.signal },
    )).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function createLostBodyResponse(status: number): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new TypeError("Response body lost."));
    },
  }), { status });
}
