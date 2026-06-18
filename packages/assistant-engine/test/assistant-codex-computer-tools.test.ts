import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_DYNAMIC_TOOLS,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
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
    expect(JSON.stringify(startTool?.inputSchema)).not.toContain(
      "resumeAfterMailboxItemId",
    );
    expect(JSON.stringify(startTool?.inputSchema)).not.toContain(
      "resumeDeliveryContext",
    );
    expect(JSON.stringify(pauseTool?.inputSchema)).not.toContain(
      "pauseDeliveryContext",
    );
  });

  it("can hide computer tools when required user-message delivery is unavailable", () => {
    const toolNames = resolveMurphDynamicTools({
      computerToolsAvailable: false,
    }).map((tool) => tool.name);

    expect(toolNames).toContain("send_progress_update");
    expect(toolNames.some((name) => name.startsWith("computer_"))).toBe(false);
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
        resumeAfterMailboxItemId: null,
        resumeDeliveryContext: null,
        resumeRunId: null,
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
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          goal: "Book a dentist appointment.",
          profileKey: "appointments",
          resumeAfterMailboxItemId: null,
          resumeDeliveryContext: {
            conversationId: "model-authored-conversation",
            recipientKey: "model-authored-recipient",
          },
          resumeRunId: null,
          startUrl: null,
          taskKind: "appointment",
        },
        kind: "computer-start-run",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("adds current hosted mailbox proof only for explicit resume requests", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(JSON.parse(String(init?.body))).toEqual({
        goal: "Resume appointment booking.",
        profileKey: "appointments",
        resumeAfterMailboxItemId: "hmi_user_reply",
        resumeDeliveryContext: {
          conversationId: "conversation-123",
          recipientKey: "recipient-123",
        },
        resumeRunId: "hcr_run123",
        startUrl: null,
        taskKind: "appointment",
      });

      return jsonResponse({
        awaitingReason: null,
        expiresAt: "2026-06-17T13:00:00.000Z",
        lastTitle: null,
        lastUrl: null,
        reused: true,
        runId: "hcr_run123",
        status: "running",
      });
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery({
        deliveryContext: {
          conversationId: "conversation-123",
          recipientKey: "recipient-123",
        },
        hostedMailboxItemIds: ["hmi_old", "hmi_user_reply"],
      }),
      request: {
        args: {
          goal: "Resume appointment booking.",
          profileKey: "appointments",
          resumeAfterMailboxItemId: "model_supplied_mailbox_item",
          resumeDeliveryContext: {
            conversationId: "model-authored-conversation",
            recipientKey: "model-authored-recipient",
          },
          resumeRunId: "hcr_run123",
          startUrl: null,
          taskKind: "appointment",
        },
        kind: "computer-start-run",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects computer requests when hosted computer transport is unavailable", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ status: "running" })
    );

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        args: {
          goal: "Book a dentist appointment.",
          profileKey: "appointments",
          resumeAfterMailboxItemId: null,
          resumeDeliveryContext: null,
          resumeRunId: null,
          startUrl: null,
          taskKind: "appointment",
        },
        kind: "computer-start-run",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer tools are unavailable without hosted computer-use transport",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
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
      progressDelivery: createProgressDelivery(),
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

  it("does not return raw action results to Codex", async () => {
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
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          action: "click",
          runId: "run_123",
          selector: "button[type=submit]",
          timeoutMs: 1000,
          url: null,
          value: null,
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      resultType: "object",
      title: "Checkout",
      url: "https://shop.example.test/order",
    });
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("session=secret");
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("raw-token");
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("secret=raw");
  });

  it("does not parse the removed eval tool", () => {
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        code: "return await context.cookies()",
        runId: "run_123",
        timeoutMs: 1000,
      },
      tool: "computer_eval",
    }));

    expect(request).toEqual({
      kind: "unsupported-dynamic-tool",
      namespace: "murph",
      tool: "computer_eval",
    });
  });

  it("treats mutating computer transport failures as unknown outcome", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw new Error("network timeout");
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          action: "click",
          runId: "run_123",
          selector: "button[type=submit]",
          timeoutMs: 1000,
          url: null,
          value: null,
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying any mutating browser action",
    );
  });

  it("treats server-side browser execution failures as unknown outcome", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        error: {
          code: "HOSTED_COMPUTER_EVAL_FAILED",
          message: "Computer browser evaluation failed.",
        },
      }, 502)
    );

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          action: "click",
          runId: "run_123",
          selector: "button[type=submit]",
          timeoutMs: 1000,
          url: null,
          value: null,
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying any mutating browser action",
    );
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
        pauseDeliveryContext: null,
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
        pauseDeliveryContext: {
          conversationId: "conversation-123",
          recipientKey: "recipient-123",
        },
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
    const progressDelivery = createProgressDelivery({
      deliveryContext: {
        conversationId: "conversation-123",
        recipientKey: "recipient-123",
      },
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery,
      request: {
        args: {
          handoffPurpose: null,
          message: "Should I book this appointment?",
          pauseDeliveryContext: {
            conversationId: "model-authored-conversation",
            recipientKey: "model-authored-recipient",
          },
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
      { required: true, source: "model" },
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
          pauseDeliveryContext: null,
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
      { required: true, source: "model" },
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

  it("does not persist a pause when required user-message delivery cannot be sent", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ status: "awaiting_user" })
    );
    const progressDelivery: AssistantProgressDelivery = {
      hostedComputerToolsAvailable: false,
      requiredUserMessageDeliveryAvailable: false,
      send: vi.fn(async () => ({ kind: "sent" as const, source: "model" as const })),
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
          pauseDeliveryContext: null,
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "yes",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer tools are unavailable without hosted computer-use transport",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(progressDelivery.send).not.toHaveBeenCalled();
  });

  it("cancels the run if pause transport outcome is unknown before user delivery", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      if (String(url).endsWith("/pause-for-user")) {
        throw new Error("network timeout");
      }

      expect(String(url)).toBe(
        "http://web-control.worker/api/internal/computer/runs/run_123/finish",
      );
      expect(init?.signal).not.toBe(controller.signal);
      expect(init?.signal?.aborted).toBe(false);
      return jsonResponse({
        ok: true,
        runId: "run_123",
        status: "failed",
      });
    });
    const progressDelivery = createProgressDelivery();

    const result = await executeMurphDynamicToolRequest({
      abortSignal: controller.signal,
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery,
      request: {
        args: {
          handoffPurpose: null,
          message: "Should I book this appointment?",
          pauseDeliveryContext: null,
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "yes",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying any mutating browser action; computer run was canceled",
    );
    expect(progressDelivery.send).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
      hostedComputerToolsAvailable: true,
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
          pauseDeliveryContext: null,
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

function createProgressDelivery(input: {
  deliveryContext?: {
    conversationId: string | null;
    recipientKey: string | null;
  };
  hostedMailboxItemIds?: string[];
} = {}): AssistantProgressDelivery {
  return {
    currentHostedDeliveryContext: () => input.deliveryContext ?? null,
    currentHostedMailboxItemIds: () => input.hostedMailboxItemIds ?? [],
    hostedComputerToolsAvailable: true,
    send: vi.fn(async (_text: string, options) => ({
      kind: "sent" as const,
      source: options?.source ?? "model",
    })),
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}
