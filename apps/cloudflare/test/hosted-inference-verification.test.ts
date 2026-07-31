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
  it("proves the synthetic tool loop, final text, and cancellation", async () => {
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
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: response.created\ndata: {"type":"response.created"}\n\n',
              ),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;

    await expect(verifyHostedInferenceConnection({
      request: REQUEST,
      upstreamFetchImpl,
    })).resolves.toEqual({
      verificationProfile: "murph-codex-0.145.0-portable-responses-v1",
      verified: true,
    });

    expect(upstreamFetchImpl).toHaveBeenCalledTimes(3);
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
