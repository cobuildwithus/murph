import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER,
  HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER_VALUE,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import { createHostedRuntimeGroupToolPort } from "../src/runtime-platform/group-tool-port.ts";
import {
  type HostedWebControlTransport,
  HostedWebControlPlaneResponseError,
} from "../src/runtime-platform/web-control-transport.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

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
    wireRequest: undefined,
    wireResponse: undefined,
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
    wireRequest: undefined,
    wireResponse: undefined,
  },
  {
    action: "ask_current_sender",
    request: {
      action: "ask_current_sender",
      audience: "group",
      mode: "new",
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
    wireRequest: {
      action: "ask_current_sender",
      audience: "group",
      [HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER]:
        HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER_VALUE,
      mode: "new",
      origin: {
        assistantInputId: `ain_${"c".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    },
    wireResponse: undefined,
  },
  {
    action: "ask_current_sender clarification",
    request: {
      action: "ask_current_sender",
      mode: "clarification",
      origin: {
        assistantInputId: `ain_${"d".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    },
    response: {
      action: "ask_current_sender",
      result: { status: "clarification_required" },
    },
    wireRequest: {
      action: "ask_current_sender",
      [HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER]:
        HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER_VALUE,
      mode: "clarification",
      origin: {
        assistantInputId: `ain_${"d".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    },
    wireResponse: undefined,
  },
  {
    action: "record_current_sender_daily_metric",
    request: {
      action: "record_current_sender_daily_metric",
      dailyMetric: {
        date: "2026-08-13",
        metric: "steps",
        unit: "count",
        value: 8_000,
      },
      origin: {
        assistantInputId: `ain_${"e".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group",
      },
    },
    response: {
      action: "record_current_sender_daily_metric",
      result: { status: "accepted" },
    },
    wireRequest: undefined,
    wireResponse: undefined,
  },
] as const satisfies readonly {
  action: string;
  request: HostedRuntimeGroupToolRequest;
  response: HostedRuntimeGroupToolResponse;
  wireRequest?: unknown;
  wireResponse?: unknown;
}[];

const hostedGroupToolTransports = [
  {
    create: (): HostedWebControlTransport => ({ mode: "proxy" }),
    mode: "proxy",
  },
  {
    create: (): HostedWebControlTransport => {
      const environment = readHostedExecutionEnvironment(
        createHostedExecutionTestEnv({
          HOSTED_WEB_BASE_URL: "https://web.example.test",
        }),
      );
      if (!environment.webCallbackSigning) {
        throw new Error("expected hosted Web callback signing fixture");
      }
      return {
        callbackSigning: environment.webCallbackSigning,
        mode: "direct",
        webControlBaseUrl: "https://web.example.test",
        workspaceCheckpointBridge: null,
      };
    },
    mode: "direct",
  },
] as const;
const dailyMetricReplay = replaySafeRequests.at(-1)!;

describe("hosted group tool exact replay", () => {
  it.each(replaySafeRequests)(
    "exact-replays the same $action request when a successful response body is lost",
    async ({
      request,
      response,
      wireRequest,
      wireResponse,
    }: (typeof replaySafeRequests)[number]) => {
      const requestBodies: BodyInit[] = [];
      const requestUrls: string[] = [];
      const fetchImpl = vi.fn<typeof fetch>(async (fetchRequest, init) => {
        requestUrls.push(readFetchRequestUrl(fetchRequest));
        if (init?.body) {
          requestBodies.push(init.body);
        }
        return requestBodies.length === 1
          ? createLostBodyResponse(200)
          : createJsonResponse(wireResponse ?? response);
      });
      const port = createHostedRuntimeGroupToolPort({
        boundUserId: "member-bound",
        fetchImpl,
        timeoutMs: 5_000,
        transport: { mode: "proxy" },
      });

      await expect(port.request(request)).resolves.toEqual(response);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(requestBodies.map((body) => JSON.parse(String(body)))).toEqual([
        wireRequest ?? request,
        wireRequest ?? request,
      ]);
      for (const requestUrl of requestUrls) {
        expect(new URL(requestUrl).searchParams.has(
          HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER,
        )).toBe(false);
      }
    },
  );

  it.each(hostedGroupToolTransports)(
    "exact-replays a committed daily metric after a lost $mode response body",
    async ({ create }) => {
      const { request, response } = dailyMetricReplay;
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
        transport: create(),
      });

      await expect(port.request(request)).resolves.toEqual(response);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(requestBodies).toEqual([
        JSON.stringify(request),
        JSON.stringify(request),
      ]);
    },
  );

  it("exact-replays the daily metric after consuming a complete 5xx response", async () => {
    const { request, response } = dailyMetricReplay;
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

  it("exact-replays the same Ask after consuming a complete 5xx response", async () => {
    const { request, response, wireRequest, wireResponse } = replaySafeRequests[0];
    const responses = [
      createJsonResponse({ error: "temporarily unavailable" }, 503),
      createJsonResponse(wireResponse ?? response),
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
      JSON.stringify(wireRequest ?? request),
      JSON.stringify(wireRequest ?? request),
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

    await expect(port.request(dailyMetricReplay.request)).rejects.toMatchObject({
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

    await expect(port.request(dailyMetricReplay.request)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(canceled).toBe(true);
  });

  it("does not replay a daily metric rejected by Web authority", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      createJsonResponse({ error: "unauthorized" }, 401)
    );
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(dailyMetricReplay.request)).rejects.toBeInstanceOf(
      HostedWebControlPlaneResponseError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not replay a daily metric after the initiating turn is canceled", async () => {
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
      dailyMetricReplay.request,
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

function readFetchRequestUrl(request: RequestInfo | URL): string {
  if (typeof request === "string") {
    return request;
  }
  return request instanceof URL ? request.href : request.url;
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
