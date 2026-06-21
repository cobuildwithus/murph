import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS,
} from "@murphai/hosted-execution/computer-use";
import {
  executeMurphDynamicToolRequest,
  MURPH_COMPUTER_ACT_TOOL,
  MURPH_DYNAMIC_TOOLS,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.ts";
import type {
  AssistantProgressDelivery,
} from "../src/assistant/turn-progress.ts";

describe("murph computer dynamic tools", () => {
  it("advertises single-action act and generic pause primitives", () => {
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
    const actTool = computerTools.find((tool) =>
      tool.name === "computer_act"
    );
    const actToolSchema = JSON.stringify(actTool?.inputSchema);
    expect(actToolSchema).toContain("\"action\"");
    expect(actToolSchema).not.toContain("steps");
    expect(actToolSchema).not.toContain("\"code\"");
    expect(actToolSchema).toContain('"const":"goto"');
    expect(actToolSchema).not.toContain('"const":"css"');
    expect(actToolSchema).not.toContain('"selector"');
    expect(actToolSchema).toContain('"type":"integer"');
    expect(actToolSchema).toContain('"minimum":1000');
    expect(actToolSchema).toContain(
      `"maximum":${HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS}`,
    );
    expect(MURPH_COMPUTER_ACT_TOOL.inputSchema).toBe(actTool?.inputSchema);
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
    expect(JSON.stringify(startTool?.inputSchema)).not.toContain("profileKey");
    expect(JSON.stringify(pauseTool?.inputSchema)).not.toContain(
      "pauseDeliveryContext",
    );
  });

  it("advertises computer tools only when execution transport is available", () => {
    const toolNames = resolveMurphDynamicTools({}).map((tool) => tool.name);

    expect(toolNames).toContain("send_progress_update");
    expect(toolNames.some((name) => name.startsWith("computer_"))).toBe(false);

    const availableToolNames = resolveMurphDynamicTools({
      computerToolsAvailable: true,
    }).map((tool) => tool.name);
    expect(availableToolNames).toContain("send_progress_update");
    expect(availableToolNames.filter((name) => name.startsWith("computer_"))).toEqual([
      "computer_start_run",
      "computer_observe",
      "computer_act",
      "computer_pause_for_user",
      "computer_finish_run",
    ]);
  });

  it("strips stale start-run profile keys and model-supplied resume evidence", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe("http://web-control.worker/api/internal/computer/runs");
      expect(JSON.parse(String(init?.body))).toEqual({
        goal: "Hosted computer task.",
        resumeAfterMailboxItemId: null,
        resumeDeliveryContext: null,
        resumeRunId: null,
        startUrl: null,
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

    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        profileKey: "appointments",
        resumeAfterMailboxItemId: null,
        resumeDeliveryContext: {
          conversationId: "model-authored-conversation",
          recipientKey: "model-authored-recipient",
        },
        resumeRunId: null,
        startUrl: null,
      },
      tool: "computer_start_run",
    }));

    if (!request || request.kind !== "computer-start-run") {
      throw new Error("Expected stale profileKey to be stripped from start-run input.");
    }

    expect(request.args).toEqual({
      resumeAfterMailboxItemId: null,
      resumeDeliveryContext: {
        conversationId: "model-authored-conversation",
        recipientKey: "model-authored-recipient",
      },
      resumeRunId: null,
      startUrl: null,
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request,
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
        goal: "Hosted computer task.",
        profileKey: "default",
        resumeAfterMailboxItemId: "hmi_user_reply",
        resumeDeliveryContext: {
          conversationId: "conversation-123",
          recipientKey: "recipient-123",
        },
        resumeRunId: "hcr_run123",
        startUrl: null,
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
          resumeAfterMailboxItemId: "model_supplied_mailbox_item",
          resumeDeliveryContext: {
            conversationId: "model-authored-conversation",
            recipientKey: "model-authored-recipient",
          },
          resumeRunId: "hcr_run123",
          startUrl: null,
        },
        kind: "computer-start-run",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries legacy profile keys when old web rejects a resume mismatch", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.profileKey !== "commerce") {
        return jsonResponse({
          error: {
            code: "HOSTED_COMPUTER_RUN_PROFILE_MISMATCH",
            message: "Computer run belongs to a different browser profile.",
          },
        }, 409);
      }

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
        hostedMailboxItemIds: ["hmi_user_reply"],
      }),
      request: {
        args: {
          resumeAfterMailboxItemId: null,
          resumeDeliveryContext: null,
          resumeRunId: "hcr_run123",
          startUrl: null,
        },
        kind: "computer-start-run",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(bodies).toEqual([
      expect.objectContaining({
        profileKey: "default",
        resumeAfterMailboxItemId: "hmi_user_reply",
        resumeRunId: "hcr_run123",
      }),
      expect.objectContaining({
        profileKey: "commerce",
        resumeAfterMailboxItemId: "hmi_user_reply",
        resumeRunId: "hcr_run123",
      }),
    ]);
    expect(bodies[0]).not.toHaveProperty("memberScopedProfileRequired");
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
          resumeAfterMailboxItemId: null,
          resumeDeliveryContext: null,
          resumeRunId: null,
          startUrl: null,
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

  it("returns observed browser text without content redaction", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        runId: "run_123",
        status: "running",
        title: "API key: visible-title-canary",
        url: "https://shop.example.test/checkout?token=secret#frag",
        visibleText: [
          "Contact shopper@example.test",
          "Cookie: session=visible-cookie-canary",
          "API key: visible-api-key-canary",
          "Verification code: 123456",
          "Loose secret prefix visible-loose-canary",
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
    expect(text).toContain("shopper@example.test");
    expect(text).toContain("Cookie: session=visible-cookie-canary");
    expect(text).toContain("API key: visible-api-key-canary");
    expect(text).toContain("Verification code: 123456");
    expect(text).toContain("Loose secret prefix visible-loose-canary");
    expect(text).toContain("visible-title-canary");
    expect(text).toContain("token=secret");
    expect(text).toContain("#frag");
  });

  it("runs a browser action and returns the current action URL", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe(
        "http://web-control.worker/api/internal/computer/runs/run_123/act",
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        action: "click",
        locator: {
          by: "role",
          exact: false,
          name: "Add to cart",
          role: "button",
        },
        timeoutMs: 1000,
      });

      return jsonResponse({
        title: "Checkout",
        url: "https://shop.example.test/order?secret=raw",
        visibleText: "Cart updated https://shop.example.test/order?session_id=opaque#step",
      });
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          action: "click",
          locator: {
            by: "role",
            exact: false,
            name: "Add to cart",
            role: "button",
          },
          runId: "run_123",
          timeoutMs: 1000,
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    const payload = JSON.parse(result.rpcResult.contentItems[0]!.text);
    expect(payload).toEqual({
      title: "Checkout",
      url: "https://shop.example.test/order?secret=raw",
    });
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("session_id");
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("#step");
  });

  it("sends finish-run compatibility fields only to the finish endpoint", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe(
        "http://web-control.worker/api/internal/computer/runs/run_123/finish",
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        outcome: "completed",
        summary: null,
      });

      return jsonResponse({
        ok: true,
        runId: "run_123",
        status: "completed",
      });
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          outcome: "completed",
          runId: "run_123",
        },
        kind: "computer-finish-run",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      ok: true,
      runId: "run_123",
      status: "completed",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not parse old structured click actions", () => {
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        action: "click",
        runId: "run_123",
        selector: "button[type=submit]",
        timeoutMs: 1000,
      },
      tool: "computer_act",
    }));

    if (!request) {
      throw new Error("Expected a parsed dynamic tool request.");
    }
    expect(request.kind).toBe("invalid-computer-arguments");
  });

  it("rejects action timeout values outside the shared runtime contract", () => {
    for (const timeoutMs of [999, 1000.5]) {
      const request = readMurphDynamicToolRequest(dynamicToolCall({
        argumentsValue: {
          action: "click",
          locator: {
            by: "role",
            exact: false,
            name: "Add to cart",
            role: "button",
          },
          runId: "run_123",
          timeoutMs,
        },
        tool: "computer_act",
      }));

      if (!request) {
        throw new Error("Expected a parsed dynamic tool request.");
      }
      expect(request.kind).toBe("invalid-computer-arguments");
    }
  });

  it("parses goto actions for rollout compatibility", () => {
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        action: "goto",
        runId: "run_123",
        timeoutMs: 1000,
        url: "https://shop.example.test/checkout",
      },
      tool: "computer_act",
    }));

    if (!request) {
      throw new Error("Expected a parsed dynamic tool request.");
    }
    expect(request).toEqual({
      args: {
        action: "goto",
        runId: "run_123",
        timeoutMs: 1000,
        url: "https://shop.example.test/checkout",
      },
      kind: "computer-act",
    });
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

  it("treats computer action transport failures as unknown outcome", async () => {
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
          action: "goto",
          runId: "run_123",
          timeoutMs: 1000,
          url: "https://shop.example.test/checkout",
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying a browser action or taking another step",
    );
  });

  it.each([
    "HOSTED_COMPUTER_EVAL_FAILED",
    "HOSTED_COMPUTER_ACTION_STATE_INVALID",
  ])("treats server-side browser execution failures as unknown outcome: %s", async (code) => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        error: {
          code,
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
          action: "goto",
          runId: "run_123",
          timeoutMs: 1000,
          url: "https://shop.example.test/checkout",
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying a browser action or taking another step",
    );
  });

  it("parses the generic pause-for-user checkpoint tool", () => {
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        handoffPurpose: "manual_browser_help",
        message: "Should I book this appointment?",
        reason: "final_confirmation",
        runId: "run_123",
        suggestedReply: "done",
      },
      tool: "computer_pause_for_user",
    }));

    expect(request).toEqual({
      args: {
        handoffPurpose: "manual_browser_help",
        message: "Should I book this appointment?",
        pauseDeliveryContext: null,
        reason: "final_confirmation",
        runId: "run_123",
        suggestedReply: "done",
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
        handoffPurpose: "manual_browser_help",
        message: "Should I book this appointment?",
        pauseDeliveryContext: {
          conversationId: "conversation-123",
          recipientKey: "recipient-123",
        },
        reason: "final_confirmation",
        suggestedReply: "done",
      });

      return jsonResponse({
        awaitingReason: "final_confirmation",
        handoffUrl: "https://web.example.test/computer/handoff/raw-token",
        message: "Should I book this appointment?\n\nhttps://web.example.test/computer/handoff/raw-token",
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
          handoffPurpose: "manual_browser_help",
          message: "Should I book this appointment?",
          pauseDeliveryContext: {
            conversationId: "model-authored-conversation",
            recipientKey: "model-authored-recipient",
          },
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "done",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(progressDelivery.send).toHaveBeenCalledWith(
      "Should I book this appointment?\n\nhttps://web.example.test/computer/handoff/raw-token",
      { required: true, source: "model" },
    );
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      awaitingReason: "final_confirmation",
      channelMessageSent: true,
      handoffCreated: true,
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
          handoffPurpose: "manual_browser_help",
          message: "Should I book this appointment?",
          pauseDeliveryContext: null,
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "done",
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
      expect(JSON.parse(String(init?.body))).toEqual({
        outcome: "failed",
        summary: null,
      });
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
          handoffPurpose: "manual_browser_help",
          message: "Should I book this appointment?",
          pauseDeliveryContext: null,
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "done",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying a browser action or taking another step; computer run was canceled",
    );
    expect(progressDelivery.send).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps a saved pause when channel delivery fails after the checkpoint commits", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
    ): Promise<Response> => {
      expect(String(url)).toBe(
        "http://web-control.worker/api/internal/computer/runs/run_123/pause-for-user",
      );
      if (String(url).endsWith("/pause-for-user")) {
        return jsonResponse({
          awaitingReason: "final_confirmation",
          handoffUrl: "https://web.example.test/computer/handoff/raw-token",
          message: "Should I book this appointment?\n\nhttps://web.example.test/computer/handoff/raw-token",
          runId: "run_123",
          status: "awaiting_user",
        });
      }

      throw new Error("unexpected finish call");
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
          handoffPurpose: "manual_browser_help",
          message: "Should I book this appointment?",
          pauseDeliveryContext: null,
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "done",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("raw-token");
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      awaitingReason: "final_confirmation",
      channelMessageSent: false,
      deliveryError: "computer pause saved but channel delivery failed",
      handoffCreated: true,
      runId: "run_123",
      status: "awaiting_user",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
