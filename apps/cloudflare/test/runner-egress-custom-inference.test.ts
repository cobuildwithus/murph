import { describe, expect, it } from "vitest";

import {
  HostedCustomInferenceRequestError,
  adaptHostedCustomInferenceUpstreamResponse,
  buildHostedCustomInferenceUpstreamRequestBody,
  injectHostedCustomInferenceAuth,
} from "../src/runner-egress-custom-inference.ts";
import {
  HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA,
  type HostedInferenceRuntimeTarget,
} from "../src/hosted-inference-runtime-target.ts";
import {
  openHostedInferenceRuntimeTarget,
  sealHostedInferenceRuntimeTarget,
} from "../src/hosted-inference-target-envelope.ts";

const SIGNING_SOURCE = {
  HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
    "synthetic-provider-egress-signing-secret",
};

describe("hosted custom inference egress", () => {
  it("pins and authenticates an encrypted runtime target without plaintext envelope fields", async () => {
    const target = buildTarget();
    const envelope = await sealHostedInferenceRuntimeTarget({
      source: SIGNING_SOURCE,
      target,
    });

    expect(envelope).not.toContain(target.endpointUrl);
    expect(envelope).not.toContain(target.auth.secret);
    await expect(openHostedInferenceRuntimeTarget({
      envelope,
      source: SIGNING_SOURCE,
    })).resolves.toEqual(target);
    await expect(openHostedInferenceRuntimeTarget({
      envelope: envelope.replace(/.$/u, envelope.endsWith("}") ? "x" : "}"),
      source: SIGNING_SOURCE,
    })).rejects.toThrow();
    await expect(openHostedInferenceRuntimeTarget({
      envelope,
      source: {
        HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
          "different-synthetic-signing-secret",
      },
    })).rejects.toThrow();
  });

  it("normalizes a native Responses request at the final egress boundary", () => {
    const body = buildHostedCustomInferenceUpstreamRequestBody({
      body: encodeJson({
        include: ["reasoning.encrypted_content"],
        input: "hello",
        model: "murph-custom-r7",
        parallel_tool_calls: true,
        prompt_cache_key: "cache-key",
        reasoning: { effort: "high" },
        service_tier: "flex",
        store: true,
        stream: false,
      }),
      target: buildTarget(),
    });

    expect(JSON.parse(body)).toEqual({
      input: "hello",
      model: "upstream-model",
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
  });

  it("translates Responses messages, images, functions, and custom tools into Chat Completions", () => {
    const body = buildHostedCustomInferenceUpstreamRequestBody({
      body: encodeJson({
        input: [
          {
            content: [
              { text: "inspect this", type: "input_text" },
              {
                image_url: "data:image/png;base64,AA==",
                type: "input_image",
              },
            ],
            role: "user",
            type: "message",
          },
          {
            arguments: "{\"path\":\"/tmp\"}",
            call_id: "call_1",
            name: "read_path",
            type: "function_call",
          },
          {
            call_id: "call_1",
            output: "done",
            type: "function_call_output",
          },
        ],
        instructions: "Be precise.",
        max_output_tokens: 512,
        model: "murph-custom-r7",
        tools: [
          {
            description: "Read one path.",
            name: "read_path",
            parameters: {
              properties: { path: { type: "string" } },
              required: ["path"],
              type: "object",
            },
            type: "function",
          },
          {
            description: "Run a synthetic dynamic tool.",
            name: "dynamic_tool",
            type: "custom",
          },
        ],
      }),
      target: buildTarget({ protocol: "chat_completions" }),
    });

    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({
      max_tokens: 512,
      model: "upstream-model",
      parallel_tool_calls: false,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(parsed.messages).toEqual([
      { content: "Be precise.", role: "developer" },
      {
        content: [
          { text: "inspect this", type: "text" },
          {
            image_url: { url: "data:image/png;base64,AA==" },
            type: "image_url",
          },
        ],
        role: "user",
      },
      {
        content: null,
        role: "assistant",
        tool_calls: [{
          function: {
            arguments: "{\"path\":\"/tmp\"}",
            name: "read_path",
          },
          id: "call_1",
          type: "function",
        }],
      },
      { content: "done", role: "tool", tool_call_id: "call_1" },
    ]);
    expect(parsed.tools).toHaveLength(2);
    expect(parsed.tools[1].function.name).toMatch(/^murph_custom_/u);
  });

  it("round-trips namespaced dynamic tools without losing their namespace", async () => {
    const translated = JSON.parse(
      buildHostedCustomInferenceUpstreamRequestBody({
        body: encodeJson({
          input: [{
            content: [{ text: "Use the Murph tool.", type: "input_text" }],
            role: "user",
            type: "message",
          }],
          model: "murph-custom-r7",
          tools: [{
            name: "murph",
            tools: [{
              description: "Return one bounded result.",
              name: "connected_apps_manage",
              parameters: {
                additionalProperties: false,
                properties: {
                  action: { type: "string" },
                },
                required: ["action"],
                type: "object",
              },
            }],
            type: "namespace",
          }],
        }),
        target: buildTarget({ protocol: "chat_completions" }),
      }),
    );
    const encodedName = translated.tools[0].function.name;
    expect(encodedName).toMatch(/^murph_ns_/u);
    expect(translated.tools[0].function.parameters).toMatchObject({
      required: ["action"],
      type: "object",
    });

    const response = await adaptHostedCustomInferenceUpstreamResponse({
      protocol: "chat_completions",
      response: chatStream([
        chatChunk({
          tool_calls: [{
            function: {
              arguments: "{\"action\":\"list\"}",
              name: encodedName,
            },
            id: "call_namespace_1",
            index: 0,
            type: "function",
          }],
        }, "tool_calls"),
      ]),
    });
    const text = await response.text();

    expect(text).toContain('"type":"function_call"');
    expect(text).toContain('"namespace":"murph"');
    expect(text).toContain('"name":"connected_apps_manage"');
    expect(text).not.toContain(encodedName);
  });

  it("fails closed for unknown fields, model drift, and unsupported images", () => {
    expect(() => buildHostedCustomInferenceUpstreamRequestBody({
      body: encodeJson({
        input: "hello",
        model: "murph-custom-r7",
        unknown_provider_field: true,
      }),
      target: buildTarget(),
    })).toThrowError(expect.objectContaining({
      code: "REQUEST_INVALID",
    }));
    expect(() => buildHostedCustomInferenceUpstreamRequestBody({
      body: encodeJson({
        input: "hello",
        model: "murph-custom-r8",
      }),
      target: buildTarget(),
    })).toThrowError(expect.objectContaining({
      code: "MODEL_ALIAS_MISMATCH",
    }));
    expect(() => buildHostedCustomInferenceUpstreamRequestBody({
      body: encodeJson({
        input: [{
          content: [{
            image_url: "data:image/png;base64,AA==",
            type: "input_image",
          }],
          role: "user",
          type: "message",
        }],
        model: "murph-custom-r7",
      }),
      target: buildTarget({ supportsImages: false }),
    })).toThrowError(expect.objectContaining({
      code: "IMAGE_INPUT_UNSUPPORTED",
    }));
  });

  it("validates native Responses event order while preserving a valid stream", async () => {
    const valid = [
      sse("response.created", {
        response: {
          id: "resp_1",
          model: "upstream-model",
          output: [],
          status: "in_progress",
        },
        type: "response.created",
      }),
      sse("response.completed", {
        response: {
          id: "resp_1",
          model: "upstream-model",
          output: [],
          status: "completed",
        },
        type: "response.completed",
      }),
      "data: [DONE]\n\n",
    ].join("");
    const response = await adaptHostedCustomInferenceUpstreamResponse({
      protocol: "responses",
      response: new Response(valid, {
        headers: { "content-type": "text/event-stream" },
      }),
    });

    await expect(response.text()).resolves.toBe(valid);

    const invalid = await adaptHostedCustomInferenceUpstreamResponse({
      protocol: "responses",
      response: new Response(
        sse("response.completed", {
          response: { id: "resp_1", status: "completed" },
          type: "response.completed",
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    });
    await expect(invalid.text()).rejects.toThrow(HostedCustomInferenceRequestError);
  });

  it("rejects an oversized SSE event before parsing it", async () => {
    const response = await adaptHostedCustomInferenceUpstreamResponse({
      protocol: "responses",
      response: new Response(
        `event: response.created\ndata: ${JSON.stringify({
          padding: "x".repeat(1024 * 1024),
          type: "response.created",
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
    });

    await expect(response.text()).rejects.toThrow(
      HostedCustomInferenceRequestError,
    );
  });

  it("translates fragmented Chat text and tool streams into portable Responses events", async () => {
    const textResponse = await adaptHostedCustomInferenceUpstreamResponse({
      protocol: "chat_completions",
      response: chatStream([
        chatChunk({ content: "hel" }),
        chatChunk({ content: "lo" }, "stop"),
        chatChunk({}, null, {
          completion_tokens: 2,
          prompt_tokens: 3,
          total_tokens: 5,
        }),
      ]),
    });
    const text = await textResponse.text();
    expect(text).toContain("event: response.created");
    expect(text).toContain('"delta":"hel"');
    expect(text).toContain('"delta":"lo"');
    expect(text).toContain('"text":"hello"');
    expect(text).toContain('"input_tokens":3');
    expect(text).toContain("event: response.completed");
    expect(text).toContain("data: [DONE]");

    const encodedCustomName = JSON.parse(
      buildHostedCustomInferenceUpstreamRequestBody({
        body: encodeJson({
          input: "use the tool",
          model: "murph-custom-r7",
          tools: [{ name: "dynamic_tool", type: "custom" }],
        }),
        target: buildTarget({ protocol: "chat_completions" }),
      }),
    ).tools[0].function.name;
    const toolResponse = await adaptHostedCustomInferenceUpstreamResponse({
      protocol: "chat_completions",
      response: chatStream([
        chatChunk({
          tool_calls: [{
            function: {
              arguments: "{\"input\":\"syn",
              name: encodedCustomName,
            },
            id: "call_custom_1",
            index: 0,
            type: "function",
          }],
        }),
        chatChunk({
          tool_calls: [{
            function: { arguments: "thetic\"}" },
            index: 0,
          }],
        }, "tool_calls"),
      ]),
    });
    const toolText = await toolResponse.text();
    expect(toolText).toContain('"type":"custom_tool_call"');
    expect(toolText).toContain('"name":"dynamic_tool"');
    expect(toolText).toContain('"input":"synthetic"');
    expect(toolText).not.toContain(encodedCustomName);
  });

  it("preserves the Chat length finish reason as an incomplete Responses result", async () => {
    const response = await adaptHostedCustomInferenceUpstreamResponse({
      protocol: "chat_completions",
      response: chatStream([
        chatChunk({ content: "partial" }, "length"),
      ]),
    });
    const text = await response.text();

    expect(text).toContain("event: response.incomplete");
    expect(text).toContain('"status":"incomplete"');
    expect(text).toContain('"reason":"max_output_tokens"');
    expect(text).not.toContain("event: response.completed");
  });

  it("sanitizes upstream failures and injects exactly one configured auth header", async () => {
    const upstream = new Response("raw private provider failure", {
      headers: { "set-cookie": "private=cookie" },
      status: 500,
    });
    const response = await adaptHostedCustomInferenceUpstreamResponse({
      protocol: "responses",
      response: upstream,
    });
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(text).not.toContain("raw private provider failure");

    const headers = new Headers({
      authorization: "Bearer caller-value",
      "x-api-key": "caller-value",
    });
    injectHostedCustomInferenceAuth(
      headers,
      buildTarget({
        auth: { kind: "x_api_key", secret: "synthetic-upstream-secret" },
      }),
    );
    expect(headers.get("x-api-key")).toBe("synthetic-upstream-secret");
  });
});

function buildTarget(
  overrides: Partial<HostedInferenceRuntimeTarget> = {},
): HostedInferenceRuntimeTarget {
  return {
    auth: { kind: "bearer", secret: "synthetic-upstream-secret" },
    contextWindowTokens: 131_072,
    endpointUrl: overrides.protocol === "chat_completions"
      ? "https://inference.example.com/v1/chat/completions"
      : "https://inference.example.com/v1/responses",
    model: "upstream-model",
    protocol: "responses",
    revision: 7,
    schema: HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA,
    supportsImages: true,
    verificationProfile: "murph-codex-0.145.0-portable-responses-v1",
    ...overrides,
  };
}

function encodeJson(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
}

function sse(event: string, value: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
}

function chatStream(events: Record<string, unknown>[]): Response {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

function chatChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  usage: Record<string, unknown> | null = null,
): Record<string, unknown> {
  return {
    choices: usage
      ? []
      : [{ delta, finish_reason: finishReason, index: 0 }],
    created: 1,
    id: "chatcmpl_synthetic",
    model: "upstream-model",
    object: "chat.completion.chunk",
    usage,
  };
}
