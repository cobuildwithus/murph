import { describe, expect, it, vi } from "vitest";

import {
  HostedInferenceVerificationError,
  verifyHostedInferenceConnection,
} from "../src/hosted-inference-verification.ts";

const REQUEST = {
  auth: { kind: "bearer" as const, secret: "synthetic-secret" },
  contextWindowTokens: 131_072,
  endpointUrl: "https://inference.example.test/v1/responses",
  model: "example-model",
  protocol: "responses" as const,
  supportsImages: false,
};

describe("hosted inference verification", () => {
  it("proves the synthetic tool loop and final text", async () => {
    const observed: Request[] = [];
    const upstreamFetchImpl = vi.fn(async (request: RequestInfo | URL) => {
      const normalized = request instanceof Request
        ? request
        : new Request(request);
      observed.push(normalized);
      const body = await normalized.clone().json() as Record<string, unknown>;
      if (observed.length === 1) {
        return eventStream([
          {
            response: {
              id: "resp_tool",
              model: "example-model",
              output: [{
                arguments: JSON.stringify({
                  nonce: "murph_connection_probe_v1",
                }),
                call_id: "call_verify",
                name: "murph_verify_connection",
                status: "completed",
                type: "function_call",
              }],
              status: "completed",
            },
            type: "response.completed",
          },
        ]);
      }
      if (observed.length === 2) {
        expect(body.input).toEqual(expect.arrayContaining([
          expect.objectContaining({
            call_id: "call_verify",
            type: "function_call_output",
          }),
        ]));
        return eventStream([
          {
            response: {
              id: "resp_final",
              model: "example-model",
              output: [{
                content: [{
                  text: "murph_connection_verified_v1",
                  type: "output_text",
                }],
                role: "assistant",
                status: "completed",
                type: "message",
              }],
              status: "completed",
            },
            type: "response.completed",
          },
        ]);
      }
      throw new Error("Unexpected verification request.");
    }) as typeof fetch;

    await expect(verifyHostedInferenceConnection({
      request: REQUEST,
      upstreamFetchImpl,
    })).resolves.toEqual({
      verificationProfile: "murph-codex-0.147.0-portable-responses-v1",
      verified: true,
    });

    expect(upstreamFetchImpl).toHaveBeenCalledTimes(2);
    expect(observed.every((request) => request.redirect === "manual")).toBe(
      true,
    );
    expect(
      observed.every((request) =>
        request.headers.get("authorization") === "Bearer synthetic-secret"
      ),
    ).toBe(true);
    await expect(observed[0].clone().json()).resolves.toMatchObject({
      model: "example-model",
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
  });

  it("propagates caller cancellation and does not start another probe", async () => {
    const controller = new AbortController();
    const observed: Request[] = [];
    const upstreamFetchImpl = vi.fn(async (request: RequestInfo | URL) => {
      const normalized = request instanceof Request
        ? request
        : new Request(request);
      observed.push(normalized);
      controller.abort();
      return eventStream([
        {
          response: {
            id: "resp_tool",
            model: "example-model",
            output: [{
              arguments: JSON.stringify({
                nonce: "murph_connection_probe_v1",
              }),
              call_id: "call_verify",
              name: "murph_verify_connection",
              status: "completed",
              type: "function_call",
            }],
            status: "completed",
          },
          type: "response.completed",
        },
      ]);
    }) as typeof fetch;

    await expect(verifyHostedInferenceConnection({
      request: REQUEST,
      signal: controller.signal,
      upstreamFetchImpl,
    })).rejects.toEqual(new HostedInferenceVerificationError());

    expect(upstreamFetchImpl).toHaveBeenCalledTimes(1);
    expect(observed[0]?.signal.aborted).toBe(true);
  });

  it("keeps three slow logical probes inside one aggregate deadline", async () => {
    let now = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const timeoutDurations: number[] = [];
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(
      (duration) => {
        timeoutDurations.push(duration);
        return realTimeout(duration);
      },
    );
    let requestCount = 0;
    const upstreamFetchImpl = vi.fn(async () => {
      requestCount += 1;
      now += 19_000;
      if (requestCount === 1) {
        return eventStream([{
          response: {
            id: "resp_tool",
            model: "example-model",
            output: [{
              arguments: JSON.stringify({
                nonce: "murph_connection_probe_v1",
              }),
              call_id: "call_verify",
              name: "murph_verify_connection",
              status: "completed",
              type: "function_call",
            }],
            status: "completed",
          },
          type: "response.completed",
        }]);
      }
      const text = requestCount === 2
        ? "murph_connection_verified_v1"
        : "murph_image_verified_v1";
      return eventStream([{
        response: {
          id: `resp_${requestCount}`,
          model: "example-model",
          output: [{
            content: [{ type: "output_text", text }],
            role: "assistant",
            status: "completed",
            type: "message",
          }],
          status: "completed",
        },
        type: "response.completed",
      }]);
    }) as typeof fetch;

    try {
      await expect(verifyHostedInferenceConnection({
        request: { ...REQUEST, supportsImages: true },
        upstreamFetchImpl,
      })).resolves.toMatchObject({ verified: true });
    } finally {
      nowSpy.mockRestore();
      timeoutSpy.mockRestore();
    }

    expect(upstreamFetchImpl).toHaveBeenCalledTimes(3);
    expect(timeoutDurations).toEqual([60_000, 20_000, 20_000, 20_000]);
  });

  it("fails closed without exposing an upstream error body", async () => {
    const upstreamFetchImpl = vi.fn(async () =>
      new Response("private upstream details", {
        headers: { "content-type": "text/plain" },
        status: 401,
      })
    ) as typeof fetch;

    await expect(verifyHostedInferenceConnection({
      request: REQUEST,
      upstreamFetchImpl,
    })).rejects.toEqual(new HostedInferenceVerificationError());
  });

  it("maps a streamed provider failure to the fixed verification error", async () => {
    const upstreamFetchImpl = vi.fn(async () => eventStream([
      {
        response: {
          error: { message: "private streamed provider failure" },
          id: "resp_failed",
          model: "example-model",
          output: [],
          status: "failed",
        },
        type: "response.failed",
      },
    ])) as typeof fetch;

    await expect(verifyHostedInferenceConnection({
      request: REQUEST,
      upstreamFetchImpl,
    })).rejects.toEqual(new HostedInferenceVerificationError());
  });
});

function eventStream(
  completedEvents: readonly Record<string, unknown>[],
): Response {
  const created = {
    response: {
      id: "resp_created",
      model: "example-model",
      output: [],
      status: "in_progress",
    },
    type: "response.created",
  };
  const events = [created, ...completedEvents]
    .map((event) =>
      `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`
    )
    .join("");
  return new Response(`${events}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}
