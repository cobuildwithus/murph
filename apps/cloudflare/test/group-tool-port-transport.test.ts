import { describe, expect, it, vi } from "vitest";

import { createHostedRuntimeGroupToolPort } from "../src/runtime-platform/group-tool-port.ts";
import {
  HostedWebControlPlaneResponseError,
} from "../src/runtime-platform/web-control-transport.ts";

const askRequest = {
  action: "ask" as const,
  groupLabel: "100 Club",
  originAssistantInputId: `ain_${"a".repeat(32)}`,
  originSessionId: "session_private",
  question: "What exercises are scheduled today?",
};

describe("hosted group tool Web-control transport", () => {
  it("exact-replays the same Ask when a 200 response body is lost", async () => {
    const requestBodies: BodyInit[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_request, init) => {
      if (init?.body) {
        requestBodies.push(init.body);
      }
      return requestBodies.length === 1
        ? createLostBodyResponse(200)
        : createAcceptedAskResponse();
    });
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(askRequest)).resolves.toEqual({
      action: "ask",
      result: {
        status: "accepted",
        targetLabel: "100 Club",
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestBodies).toEqual([
      JSON.stringify(askRequest),
      JSON.stringify(askRequest),
    ]);
  });

  it("exact-replays the same Ask when a 5xx response body is lost", async () => {
    const requestBodies: BodyInit[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_request, init) => {
      if (init?.body) {
        requestBodies.push(init.body);
      }
      return requestBodies.length === 1
        ? createLostBodyResponse(503)
        : createAcceptedAskResponse();
    });
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(askRequest)).resolves.toMatchObject({
      action: "ask",
      result: { status: "accepted" },
    });
    expect(requestBodies).toEqual([
      JSON.stringify(askRequest),
      JSON.stringify(askRequest),
    ]);
  });

  it("exact-replays the same Ask after consuming a complete 5xx response", async () => {
    const responses = [
      new Response(JSON.stringify({ error: "temporarily unavailable" }), {
        headers: { "content-type": "application/json" },
        status: 503,
      }),
      createAcceptedAskResponse(),
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

    await expect(port.request(askRequest)).resolves.toMatchObject({
      action: "ask",
      result: { status: "accepted" },
    });
    expect(requestBodies).toEqual([
      JSON.stringify(askRequest),
      JSON.stringify(askRequest),
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

    await expect(port.request(askRequest)).rejects.toMatchObject({
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
          // Remain pending until the request deadline cancels the reader.
        },
      }),
      { status: 200 },
    ));
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 20,
      transport: { mode: "proxy" },
    });

    await expect(port.request(askRequest)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(canceled).toBe(true);
  });

  it("does not replay an Ask rejected by Web authority", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: "unauthorized" }),
      {
        headers: { "content-type": "application/json" },
        status: 401,
      },
    ));
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(askRequest)).rejects.toBeInstanceOf(
      HostedWebControlPlaneResponseError,
    );
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

function createAcceptedAskResponse(): Response {
  return new Response(JSON.stringify({
    action: "ask",
    result: {
      status: "accepted",
      targetLabel: "100 Club",
    },
  }), {
    headers: { "content-type": "application/json" },
    status: 200,
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
