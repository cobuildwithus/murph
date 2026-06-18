import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_DYNAMIC_TOOLS,
  readMurphDynamicToolRequest,
} from "../src/assistant-codex/dynamic-tools.ts";
import type {
  AssistantProgressDelivery,
} from "../src/assistant/turn-progress.ts";

describe("murph computer dynamic tools", () => {
  it("advertises final confirmation through the generic pause primitive only", () => {
    const computerTools = MURPH_DYNAMIC_TOOLS.filter((tool) =>
      tool.name.startsWith("computer_")
    );
    const computerToolNames = computerTools.map((tool) => tool.name);

    expect(computerToolNames).toEqual([
      "computer_start_run",
      "computer_observe",
      "computer_act",
      "computer_eval",
      "computer_pause_for_user",
      "computer_finish_run",
    ]);
    expect(
      computerToolNames.filter((name) => /approval|confirm/u.test(name)),
    ).toEqual([]);

    const pauseTool = computerTools.find((tool) =>
      tool.name === "computer_pause_for_user"
    );
    expect(JSON.stringify(pauseTool?.inputSchema)).toContain("final_confirmation");
    const startTool = computerTools.find((tool) =>
      tool.name === "computer_start_run"
    );
    expect(JSON.stringify(startTool?.inputSchema)).not.toContain(
      "resumeAfterUserReply",
    );
    expect(JSON.stringify(startTool?.inputSchema)).not.toContain("resumeEvidence");
  });

  it("sends start-run requests without model-supplied resume evidence", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe("http://web-control.worker/api/internal/computer/runs");
      expect(JSON.parse(String(init?.body))).toEqual({
        goal: "Book a dentist appointment.",
        profileKey: "appointments",
        startUrl: null,
        taskKind: "appointment",
      });

      return jsonResponse({
        awaitingReason: null,
        expiresAt: "2026-06-17T13:00:00.000Z",
        lastTitle: null,
        lastUrl: null,
        reused: true,
        runId: "run_123",
        status: "running",
      });
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        args: {
          goal: "Book a dentist appointment.",
          profileKey: "appointments",
          startUrl: null,
          taskKind: "appointment",
        },
        kind: "computer-start-run",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("sanitizes observe output before returning it to Codex", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        runId: "run_123",
        status: "running",
        title: "Checkout",
        url: "https://shop.example.test/checkout?token=secret#frag",
        visibleText: [
          "Contact shopper@example.test",
          "Cookie: session=secret",
          "Reference 4111 1111 1111 1111",
          "Ready to submit",
        ].join("\n"),
      })
    );

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        args: { runId: "run_123" },
        kind: "computer-observe",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    const text = result.rpcResult.contentItems[0]!.text;
    expect(text).toContain("https://shop.example.test/checkout");
    expect(text).toContain("Ready to submit");
    expect(text).toContain("[redacted-email]");
    expect(text).toContain("[redacted-sensitive-line]");
    expect(text).toContain("[redacted-number]");
    expect(text).not.toContain("token=secret");
    expect(text).not.toContain("shopper@example.test");
    expect(text).not.toContain("4111");
  });

  it("does not return raw eval or action results to Codex", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        result: {
          cookie: "session=secret",
          liveViewUrl: "https://kernel.example.test/live/raw-token",
        },
        title: "Checkout",
        url: "https://shop.example.test/order?secret=raw",
      })
    );

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        args: {
          code: "return await context.cookies()",
          runId: "run_123",
          timeoutMs: 1000,
        },
        kind: "computer-eval",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      resultPreview: null,
      resultType: "object",
    });
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("session=secret");
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("raw-token");
  });

  it("parses the generic pause-for-user checkpoint tool", () => {
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        message: "Should I book this appointment?",
        reason: "final_confirmation",
        runId: "run_123",
        suggestedReply: "yes",
      },
      tool: "computer_pause_for_user",
    }));

    expect(request).toEqual({
      args: {
        handoffPurpose: null,
        message: "Should I book this appointment?",
        reason: "final_confirmation",
        runId: "run_123",
        suggestedReply: "yes",
      },
      kind: "computer-pause-for-user",
    });
  });

  it("pauses through web-control and sends the returned message through progress delivery", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe(
        "http://web-control.worker/api/internal/computer/runs/run_123/pause-for-user",
      );
      expect(init?.method).toBe("POST");
      expect(readHeader(init?.headers, "content-type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({
        handoffPurpose: null,
        message: "Should I book this appointment?",
        reason: "final_confirmation",
        suggestedReply: "yes",
      });

      return jsonResponse({
        awaitingReason: "final_confirmation",
        handoffUrl: null,
        message: "Should I book this appointment?",
        runId: "run_123",
        status: "awaiting_user",
      });
    });
    const progressDelivery = createProgressDelivery();

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery,
      request: {
        args: {
          handoffPurpose: null,
          message: "Should I book this appointment?",
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "yes",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(progressDelivery.send).toHaveBeenCalledWith(
      "Should I book this appointment?",
      { source: "model" },
    );
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      awaitingReason: "final_confirmation",
      channelMessageSent: true,
      handoffCreated: false,
      runId: "run_123",
      status: "awaiting_user",
    });
  });

  it("does not return handoff URLs to Codex after sending them through progress delivery", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        awaitingReason: "login_needed",
        handoffUrl: "https://web.example.test/computer/handoff/raw-token",
        message: "Can you log in here?\n\nhttps://web.example.test/computer/handoff/raw-token",
        runId: "run_123",
        status: "awaiting_user",
      })
    );
    const progressDelivery = createProgressDelivery();

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery,
      request: {
        args: {
          handoffPurpose: "login",
          message: "Can you log in here?",
          reason: "login_needed",
          runId: "run_123",
          suggestedReply: "done",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(progressDelivery.send).toHaveBeenCalledWith(
      "Can you log in here?\n\nhttps://web.example.test/computer/handoff/raw-token",
      { source: "model" },
    );
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("raw-token");
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      awaitingReason: "login_needed",
      channelMessageSent: true,
      handoffCreated: true,
      runId: "run_123",
      status: "awaiting_user",
    });
  });

  it("cancels the run if a saved pause cannot be delivered to the user channel", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      if (String(url).endsWith("/pause-for-user")) {
        return jsonResponse({
          awaitingReason: "final_confirmation",
          handoffUrl: null,
          message: "Should I book this appointment?",
          runId: "run_123",
          status: "awaiting_user",
        });
      }

      expect(String(url)).toBe(
        "http://web-control.worker/api/internal/computer/runs/run_123/finish",
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        outcome: "failed",
        summary: "Computer pause channel delivery failed.",
      });
      return jsonResponse({
        ok: true,
        runId: "run_123",
        status: "failed",
      });
    });
    const progressDelivery: AssistantProgressDelivery = {
      send: vi.fn(async () => ({ kind: "failed" as const, source: "model" as const })),
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery,
      request: {
        args: {
          handoffPurpose: null,
          message: "Should I book this appointment?",
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "yes",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer pause saved but channel delivery failed; computer run was canceled",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function dynamicToolCall(input: {
  argumentsValue: unknown;
  tool: string;
}): Record<string, unknown> {
  return {
    method: "item/tool/call",
    params: {
      arguments: input.argumentsValue,
      namespace: "murph",
      tool: input.tool,
    },
  };
}

function createProgressDelivery(): AssistantProgressDelivery {
  return {
    send: vi.fn(async (_text: string, options) => ({
      kind: "sent" as const,
      source: options?.source ?? "model",
    })),
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  });
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}
