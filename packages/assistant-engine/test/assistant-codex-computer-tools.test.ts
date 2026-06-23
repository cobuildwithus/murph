import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH,
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
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.ts";
import type {
  AssistantProgressDelivery,
} from "../src/assistant/turn-progress.ts";

describe("murph computer dynamic tools", () => {
  it("advertises raw Playwright act and generic pause primitives", () => {
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
    expect(actToolSchema).toContain("\"code\"");
    expect(actToolSchema).not.toContain("steps");
    expect(actToolSchema).not.toContain("\"action\"");
    expect(actToolSchema).not.toContain('"const":"goto"');
    expect(actToolSchema).not.toContain('"const":"css"');
    expect(actToolSchema).not.toContain('"locator"');
    expect(actToolSchema).not.toContain('"selector"');
    expect(actToolSchema).toContain(`"maxLength":${HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH}`);
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
    expect(JSON.stringify(startTool?.inputSchema)).not.toContain("resumeRunId");
    expect(JSON.stringify(startTool?.inputSchema)).not.toContain("profileKey");
    expect(JSON.stringify(pauseTool?.inputSchema)).not.toContain(
      "pauseDeliveryContext",
    );
    expect(JSON.stringify(pauseTool?.inputSchema)).not.toContain("message");
    expect(JSON.stringify(pauseTool?.inputSchema)).not.toContain("awaitingMessage");
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

  it("keeps start-run profile keys off the model surface while sending fresh starts", async () => {
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
        startUrl: null,
      },
      tool: "computer_start_run",
    }));

    if (!request || request.kind !== "computer-start-run") {
      throw new Error("Expected computer_start_run request.");
    }

    expect(request.args).toEqual({
      startUrl: null,
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext(),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(result.computerResumeConsumed).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("sends server-owned resume proof from hosted context without exposing resume ids", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe("http://web-control.worker/api/internal/computer/runs");
      expect(JSON.parse(String(init?.body))).toEqual({
        goal: "Hosted computer task.",
        resumeAfterMailboxItemId: "hmi_latest_user_reply",
        resumeDeliveryContext: {
          conversationId: "conversation-123",
          recipientKey: "recipient-123",
        },
        resumeRunId: "hcr_paused_run",
        startUrl: "https://shop.example.test/checkout",
      });

      return jsonResponse({
        awaitingReason: null,
        expiresAt: "2026-06-17T13:00:00.000Z",
        lastTitle: "Checkout",
        lastUrl: "https://shop.example.test/checkout",
        reused: true,
        runId: "run_123",
        status: "running",
      });
    });

    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        startUrl: "https://shop.example.test/checkout",
      },
      tool: "computer_start_run",
    }));

    if (!request || request.kind !== "computer-start-run") {
      throw new Error("Expected computer_start_run request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext({
        computerResumeRunId: "hcr_paused_run",
        deliveryContext: {
          conversationId: "conversation-123",
          recipientKey: "recipient-123",
        },
        hostedMailboxItemIds: ["hmi_prior_context", "hmi_latest_user_reply"],
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(result.computerResumeConsumed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps pending resume state when a resume start still returns awaiting_user", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        awaitingReason: "final_confirmation",
        expiresAt: "2026-06-17T13:00:00.000Z",
        lastTitle: "Checkout",
        lastUrl: "https://shop.example.test/checkout",
        reused: true,
        runId: "hcr_paused_run",
        status: "awaiting_user",
      })
    );
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        startUrl: null,
      },
      tool: "computer_start_run",
    }));

    if (!request || request.kind !== "computer-start-run") {
      throw new Error("Expected computer_start_run request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext({
        computerResumeRunId: "hcr_paused_run",
        hostedMailboxItemIds: ["hmi_latest_user_reply"],
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(result.computerResumeConsumed).toBeUndefined();
  });

  it.each([
    { profileKey: "appointments" },
    { legacyProfileKey: "appointments" },
    { memberScopedProfileRequired: true },
    { resumeAfterMailboxItemId: "model_supplied_mailbox_item" },
    {
      resumeDeliveryContext: {
        conversationId: "model-authored-conversation",
        recipientKey: "model-authored-recipient",
      },
    },
    { resumeRunId: "hcr_run123" },
  ])("rejects stale start-run profile field %# before execution", async (argumentsValue) => {
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse({}));
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue,
      tool: "computer_start_run",
    }));

    if (!request) {
      throw new Error("Expected a parsed dynamic tool request.");
    }
    expect(request.kind).toBe("invalid-computer-arguments");

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: null,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not retry when web returns an old profile-mismatch error", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return jsonResponse({
        error: {
          code: "HOSTED_COMPUTER_RUN_PROFILE_MISMATCH",
          message: "Computer run belongs to a different browser profile.",
        },
      }, 409);
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext({
        deliveryContext: {
          conversationId: "conversation-123",
          recipientKey: "recipient-123",
        },
        hostedMailboxItemIds: ["hmi_user_reply"],
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          startUrl: null,
        },
        kind: "computer-start-run",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(bodies).toEqual([
      expect.objectContaining({
        resumeAfterMailboxItemId: null,
        resumeDeliveryContext: null,
        resumeRunId: null,
      }),
    ]);
    expect(bodies[0]).not.toHaveProperty("profileKey");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects computer requests when hosted computer transport is unavailable", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ status: "running" })
    );

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: null,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        args: {
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
      hostedToolContext: createHostedToolContext(),
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

  it("surfaces coded start-run configuration failures", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        error: {
          code: "HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED",
          message: "Kernel live-view URL is not allowed by hosted computer-use configuration.",
        },
      }, 502)
    );

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext(),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          startUrl: "https://shop.example.test",
        },
        kind: "computer-start-run",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer API failed with status 502: HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED: Kernel live-view URL is not allowed by hosted computer-use configuration.",
    );
  });

  it("runs raw Playwright and returns the current action URL and result", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe(
        "http://web-control.worker/api/internal/computer/runs/run_123/act",
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        code: "await page.getByRole('button', { name: 'Add to cart' }).click(); return { clicked: true };",
        timeoutMs: 1000,
      });

      return jsonResponse({
        result: { clicked: true },
        title: "Checkout",
        url: "https://shop.example.test/order?secret=raw",
        visibleText: "Cart updated https://shop.example.test/order?session_id=opaque#step",
      });
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext(),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          code: "await page.getByRole('button', { name: 'Add to cart' }).click(); return { clicked: true };",
          runId: "run_123",
          timeoutMs: 1000,
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    const payload = JSON.parse(result.rpcResult.contentItems[0]!.text);
    expect(payload).toEqual({
      result: { clicked: true },
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
      hostedToolContext: createHostedToolContext(),
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
          code: "await page.getByRole('button', { name: 'Add to cart' }).click();",
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

  it("parses raw Playwright actions", () => {
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        code: "await page.goto('https://shop.example.test/checkout'); return { ok: true };",
        runId: "run_123",
        timeoutMs: 1000,
      },
      tool: "computer_act",
    }));

    if (!request) {
      throw new Error("Expected a parsed dynamic tool request.");
    }
    expect(request).toEqual({
      args: {
        code: "await page.goto('https://shop.example.test/checkout'); return { ok: true };",
        runId: "run_123",
        timeoutMs: 1000,
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
      hostedToolContext: createHostedToolContext(),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          code: "await page.goto('https://shop.example.test/checkout');",
          runId: "run_123",
          timeoutMs: 1000,
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying Playwright code or taking another step",
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
      hostedToolContext: createHostedToolContext(),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          code: "await page.goto('https://shop.example.test/checkout');",
          runId: "run_123",
          timeoutMs: 1000,
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      `computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying Playwright code or taking another step; backend error: ${code}: Computer browser evaluation failed.`,
    );
  });

  it("includes metadata-only browser execution details in unknown-outcome action failures", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        error: {
          code: "HOSTED_COMPUTER_EVAL_FAILED",
          details: {
            codeHash: "abc123",
            kernelErrorPresent: true,
            kernelStderrPresent: true,
            kernelStdoutPresent: false,
            timeoutMs: 20000,
          },
          message: "Computer browser evaluation failed.",
        },
      }, 502)
    );

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext(),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          code: "await page.getByRole('button', { name: 'Place your order', exact: true }).click();",
          runId: "run_123",
          timeoutMs: 20000,
        },
        kind: "computer-act",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      [
        "computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying Playwright code or taking another step; backend error: HOSTED_COMPUTER_EVAL_FAILED: Computer browser evaluation failed.",
        "backend details:",
        "codeHash: abc123",
        "timeoutMs: 20000",
        "kernelErrorPresent: true",
        "kernelStderrPresent: true",
        "kernelStdoutPresent: false",
      ].join("\n"),
    );
  });

  it("parses the generic pause-for-user checkpoint tool", () => {
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        handoffPurpose: "manual_browser_help",
        reason: "final_confirmation",
        runId: "run_123",
        suggestedReply: "done",
      },
      tool: "computer_pause_for_user",
    }));

    expect(request).toEqual({
      args: {
        handoffPurpose: "manual_browser_help",
        pauseDeliveryContext: null,
        reason: "final_confirmation",
        runId: "run_123",
        suggestedReply: "done",
      },
      kind: "computer-pause-for-user",
    });

    const legacyMessageRequest = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        handoffPurpose: "manual_browser_help",
        message: "Should I book this appointment?",
        reason: "final_confirmation",
        runId: "run_123",
        suggestedReply: "done",
      },
      tool: "computer_pause_for_user",
    }));
    expect(legacyMessageRequest).toEqual({
      args: {
        handoffPurpose: "manual_browser_help",
        pauseDeliveryContext: null,
        reason: "final_confirmation",
        runId: "run_123",
        suggestedReply: "done",
      },
      kind: "computer-pause-for-user",
    });
  });

  it("pauses through web-control and returns the hosted handoff URL to the model", async () => {
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
        runId: "run_123",
        status: "awaiting_user",
        suggestedReply: "done",
      });
    });
    const hostedToolContext = createHostedToolContext({
      deliveryContext: {
        conversationId: "conversation-123",
        recipientKey: "recipient-123",
      },
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          handoffPurpose: "manual_browser_help",
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
    expect(result.computerResumeConsumed).toBeUndefined();
    expect(hostedToolContext.sendRequiredUserMessage).not.toHaveBeenCalled();
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      awaitingReason: "final_confirmation",
      handoffCreated: true,
      handoffUrl: "https://web.example.test/computer/handoff/raw-token",
      runId: "run_123",
      status: "awaiting_user",
      suggestedReply: "done",
    });
    expect(result.computerRunPausedForUser).toBe(true);
    expect(result.computerPausedRunId).toBe("run_123");
  });

  it("returns hosted handoff URLs to Codex without using progress delivery", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        awaitingReason: "login_needed",
        handoffUrl: "https://web.example.test/computer/handoff/raw-token",
        runId: "run_123",
        status: "awaiting_user",
      })
    );
    const hostedToolContext = createHostedToolContext();

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          handoffPurpose: "login",
          pauseDeliveryContext: null,
          reason: "login_needed",
          runId: "run_123",
          suggestedReply: "done",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(hostedToolContext.sendRequiredUserMessage).not.toHaveBeenCalled();
    expect(result.rpcResult.contentItems[0]!.text).toContain("raw-token");
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      awaitingReason: "login_needed",
      handoffCreated: true,
      handoffUrl: "https://web.example.test/computer/handoff/raw-token",
      runId: "run_123",
      status: "awaiting_user",
    });
  });

  it("does not pause when hosted computer-use transport is unavailable", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ status: "awaiting_user" })
    );
    const hostedToolContext = createHostedToolContext({
      computerToolsAvailable: false,
      requiredUserMessageDeliveryAvailable: false,
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          handoffPurpose: "manual_browser_help",
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
    expect(hostedToolContext.sendRequiredUserMessage).not.toHaveBeenCalled();
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
    const hostedToolContext = createHostedToolContext();

    const result = await executeMurphDynamicToolRequest({
      abortSignal: controller.signal,
      env: {},
      fetchImpl,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          handoffPurpose: "manual_browser_help",
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
      "computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying Playwright code or taking another step; computer run was canceled",
    );
    expect(hostedToolContext.sendRequiredUserMessage).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("pauses even when required user-message delivery is unavailable", async () => {
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
          runId: "run_123",
          status: "awaiting_user",
        });
      }

      throw new Error("unexpected finish call");
    });
    const hostedToolContext = createHostedToolContext({
      requiredUserMessageDeliveryAvailable: false,
    });

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          handoffPurpose: "manual_browser_help",
          pauseDeliveryContext: null,
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "done",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(result.rpcResult.contentItems[0]!.text).toContain("raw-token");
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      awaitingReason: "final_confirmation",
      handoffCreated: true,
      handoffUrl: "https://web.example.test/computer/handoff/raw-token",
      runId: "run_123",
      status: "awaiting_user",
    });
    expect(hostedToolContext.sendRequiredUserMessage).not.toHaveBeenCalled();
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

function createHostedToolContext(input: {
  computerResumeRunId?: string | null;
  computerToolsAvailable?: boolean;
  deliveryContext?: {
    conversationId: string | null;
    recipientKey: string | null;
  };
  hostedMailboxItemIds?: string[];
  requiredUserMessageDeliveryAvailable?: boolean;
  sendResult?: Awaited<ReturnType<AssistantHostedToolContext["sendRequiredUserMessage"]>>;
} = {}): AssistantHostedToolContext {
  return {
    currentHostedComputerResumeRunId: () => input.computerResumeRunId ?? null,
    currentHostedDeliveryContext: () => input.deliveryContext ?? null,
    currentHostedMailboxItemIds: () => input.hostedMailboxItemIds ?? [],
    computerToolsAvailable: input.computerToolsAvailable ?? true,
    requiredUserMessageDeliveryAvailable:
      input.requiredUserMessageDeliveryAvailable ?? true,
    sendRequiredUserMessage: vi.fn(async () =>
      input.sendResult ?? { kind: "sent" as const, source: "model" as const }
    ),
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
