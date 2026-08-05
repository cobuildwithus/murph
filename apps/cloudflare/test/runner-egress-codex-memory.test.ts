import { expect, test } from "vitest";

import {
  hasHostedCodexMemoryBillableUsage,
  parseHostedCodexMemoryClientFrame,
  parseHostedCodexMemoryRequestMetadata,
  parseHostedCodexMemoryServerFrame,
  parseHostedCodexMemoryTerminalResponse,
  readHostedCodexNativeMemoryKind,
} from "../src/runner-egress-codex-memory.ts";

const encoder = new TextEncoder();
const createdAt = 1_775_000_000;

function terminalEvent(input?: {
  type?: "response.completed" | "response.failed" | "response.incomplete";
  usage?: Record<string, unknown> | null;
}): string {
  const usage = input && "usage" in input
    ? input.usage
    : {
        input_tokens: 1_500,
        input_tokens_details: {
          cache_write_tokens: 50,
          cached_tokens: 700,
        },
        output_tokens: 180,
        output_tokens_details: { reasoning_tokens: 40 },
        total_tokens: 1_680,
      };
  return JSON.stringify({
    response: {
      created_at: createdAt,
      id: "resp_memory_123",
      model: "gpt-5.6-terra-2026-07-30",
      service_tier: "flex",
      usage,
    },
    type: input?.type ?? "response.completed",
  });
}

test("classifies both native memory phases without matching ordinary turns", () => {
  const extraction = new Headers({
    "x-codex-turn-metadata": JSON.stringify({ request_kind: "memory" }),
  });
  const consolidation = new Headers({
    "x-codex-turn-metadata": JSON.stringify({ request_kind: "turn" }),
    "x-openai-memgen-request": "true",
  });

  expect(readHostedCodexNativeMemoryKind(extraction)).toBe("extraction");
  expect(readHostedCodexNativeMemoryKind(consolidation)).toBe("consolidation");
  expect(readHostedCodexNativeMemoryKind(new Headers({
    "x-codex-turn-metadata": JSON.stringify({ request_kind: "turn" }),
  }))).toBeNull();
  expect(readHostedCodexNativeMemoryKind(new Headers({
    "x-codex-turn-metadata": "not-json",
  }))).toBeNull();
});

test("reads model, tier, and warmup intent from HTTP and WebSocket requests", () => {
  const body = encoder.encode(JSON.stringify({
    generate: false,
    model: "gpt-5.6-terra",
    service_tier: "flex",
  })).buffer as ArrayBuffer;
  expect(parseHostedCodexMemoryRequestMetadata(body)).toEqual({
    requestedModel: "gpt-5.6-terra",
    serviceTier: "flex",
    usageRequired: false,
  });
  expect(parseHostedCodexMemoryClientFrame(JSON.stringify({
    model: "gpt-5.6-terra",
    type: "response.create",
  }))).toEqual({
    kind: "response-create",
    metadata: {
      requestedModel: "gpt-5.6-terra",
      serviceTier: null,
      usageRequired: true,
    },
  });
  expect(parseHostedCodexMemoryClientFrame(JSON.stringify({
    type: "response.create",
  }))).toEqual({ kind: "invalid-response-create" });
  expect(parseHostedCodexMemoryClientFrame(JSON.stringify({
    type: "response.output_text.delta",
  }))).toEqual({ kind: "other" });
});

test("normalizes exact terminal usage and the provider timestamp", () => {
  const parsed = parseHostedCodexMemoryServerFrame(terminalEvent());
  expect(parsed).toEqual({
    kind: "response-terminal",
    terminal: {
      providerRequestOutcome: "succeeded",
      usage: {
        cacheWriteTokens: 50,
        cachedInputTokens: 700,
        inputTokens: 1_500,
        occurredAt: new Date(createdAt * 1_000).toISOString(),
        outputTokens: 180,
        providerRequestId: "resp_memory_123",
        rawUsageJson: {
          input_tokens: 1_500,
          input_tokens_details: {
            cache_write_tokens: 50,
            cached_tokens: 700,
          },
          output_tokens: 180,
          output_tokens_details: { reasoning_tokens: 40 },
          total_tokens: 1_680,
        },
        reasoningTokens: 40,
        servedModel: "gpt-5.6-terra-2026-07-30",
        serviceTier: "flex",
        totalTokens: 1_680,
      },
    },
  });
  if (parsed.kind !== "response-terminal" || parsed.terminal.usage === null) {
    throw new TypeError("Expected terminal usage.");
  }
  expect(hasHostedCodexMemoryBillableUsage(parsed.terminal.usage)).toBe(true);
});

test("reads the same terminal schema from bounded HTTP SSE", () => {
  const body = encoder.encode([
    "event: response.output_text.delta",
    "data: " + JSON.stringify({
      delta: "memory",
      type: "response.output_text.delta",
    }),
    "",
    "event: response.completed",
    "data: " + terminalEvent(),
    "",
    "data: [DONE]",
    "",
  ].join("\r\n"));

  expect(
    parseHostedCodexMemoryTerminalResponse(body.buffer as ArrayBuffer),
  ).toEqual({
    providerRequestOutcome: "succeeded",
    usage: expect.objectContaining({
      cacheWriteTokens: 50,
      occurredAt: new Date(createdAt * 1_000).toISOString(),
      providerRequestId: "resp_memory_123",
      serviceTier: "flex",
    }),
  });
});

test("meters usage on incomplete and failed terminal responses", () => {
  for (const [type, providerRequestOutcome] of [
    ["response.incomplete", "partial"],
    ["response.failed", "failed"],
  ] as const) {
    const parsed = parseHostedCodexMemoryServerFrame(terminalEvent({ type }));
    expect(parsed.kind).toBe("response-terminal");
    if (parsed.kind !== "response-terminal") {
      throw new TypeError("Expected a terminal response.");
    }
    expect(parsed.terminal.providerRequestOutcome).toBe(providerRequestOutcome);
    expect(parsed.terminal.usage?.totalTokens).toBe(1_680);
  }
});

test("permits usage-free terminals but rejects malformed terminal usage", () => {
  expect(parseHostedCodexMemoryServerFrame(
    terminalEvent({ usage: null }),
  )).toEqual({
    kind: "response-terminal",
    terminal: {
      providerRequestOutcome: "succeeded",
      usage: null,
    },
  });
  expect(parseHostedCodexMemoryServerFrame(JSON.stringify({
    response: {
      created_at: -1,
      id: "resp_bad",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    },
    type: "response.completed",
  }))).toEqual({ kind: "invalid-response-terminal" });
  expect(parseHostedCodexMemoryServerFrame(JSON.stringify({
    response: {
      created_at: createdAt,
      id: "resp_bad",
      usage: {
        input_tokens: 1,
        output_tokens: 0,
        total_tokens: 0,
      },
    },
    type: "response.completed",
  }))).toEqual({ kind: "invalid-response-terminal" });

  for (const usage of [
    {
      input_tokens: 20,
      input_tokens_details: { cached_tokens: -1 },
      output_tokens: 2,
      total_tokens: 22,
    },
    {
      input_tokens: 20,
      input_tokens_details: { cache_write_tokens: "12" },
      output_tokens: 2,
      total_tokens: 22,
    },
    {
      input_tokens: 20,
      input_tokens_details: null,
      output_tokens: 2,
      total_tokens: 22,
    },
    {
      input_tokens: 20,
      output_tokens: 2,
      output_tokens_details: { reasoning_tokens: 2.5 },
      total_tokens: 22,
    },
    {
      input_tokens: 20,
      output_tokens: 2,
      total_tokens: 21,
    },
    {
      input_tokens: 20,
      input_tokens_details: { cached_tokens: 21 },
      output_tokens: 2,
      total_tokens: 22,
    },
    {
      input_tokens: 20,
      output_tokens: 2,
      output_tokens_details: { reasoning_tokens: 3 },
      total_tokens: 22,
    },
  ]) {
    expect(parseHostedCodexMemoryServerFrame(
      terminalEvent({ usage }),
    )).toEqual({ kind: "invalid-response-terminal" });
  }
});
