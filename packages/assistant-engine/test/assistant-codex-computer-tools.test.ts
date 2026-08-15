import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH,
  HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS,
} from "@murphai/hosted-execution/computer-use";
import {
  executeMurphDynamicToolRequest,
  MURPH_COMPUTER_ACT_TOOL,
  MURPH_DYNAMIC_TOOLS,
  MURPH_PROVIDER_SETUP_TOOL,
  resolveMurphDynamicTools,
  type MurphDynamicToolRequest,
} from "../src/assistant-codex/dynamic-tools.ts";
import type {
  AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.ts";
import type {
  AssistantProgressDelivery,
} from "../src/assistant/turn-progress.ts";
import {
  readTestMurphDynamicToolRequest,
} from "./support/codex-app-server.ts";

describe("murph computer dynamic tools", () => {
  it("advertises the generic provider setup contract beside ordinary computer tools", () => {
    const computerTools = MURPH_DYNAMIC_TOOLS.filter((tool) =>
      tool.name.startsWith("computer_")
    );
    const computerToolNames = computerTools.map((tool) => tool.name);

    expect(computerToolNames).toEqual([
      "computer_open",
      "computer_act",
      "computer_os_control",
      "computer_pause_for_user",
      "computer_finish_run",
    ]);
    expect(MURPH_DYNAMIC_TOOLS.map((tool) => tool.name)).toContain("provider_setup");
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
    expect(actToolSchema).toContain('"code"');
    expect(actToolSchema).toContain('"steps"');
    expect(actToolSchema).toContain('"action"');
    expect(actToolSchema).toContain('"goto"');
    expect(actToolSchema).toContain('"selector"');
    expect(actToolSchema).toContain(`"maxLength":${HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH}`);
    expect(actToolSchema).toContain('"type":"integer"');
    expect(actToolSchema).toContain('"minimum":1000');
    expect(actToolSchema).toContain(
      `"maximum":${HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS}`,
    );
    expect(MURPH_COMPUTER_ACT_TOOL.inputSchema).toBe(actTool?.inputSchema);

    const providerSchema = JSON.stringify(MURPH_PROVIDER_SETUP_TOOL.inputSchema);
    expect(providerSchema).toContain('"begin"');
    expect(providerSchema).toContain('"capture"');
    expect(providerSchema).toContain('"prepare_delete"');
    expect(providerSchema).toContain('"delete"');
    expect(providerSchema).not.toContain('"confirm_missing"');
    expect(providerSchema).not.toContain('"applicationNameSelector"');
    expect(providerSchema).not.toContain('"clientIdSelector"');
    expect(providerSchema).not.toContain('"clientSecretSelector"');
    expect(providerSchema).not.toContain('"revealSecretSelector"');
    expect(providerSchema).not.toContain('"submitSelector"');
    expect(providerSchema).not.toContain('"clientSecret"');
    expect(JSON.stringify(pauseTool?.inputSchema)).toContain("final_confirmation");
    expect(JSON.stringify(pauseTool?.inputSchema)).toContain("managed_login");
    const openTool = computerTools.find((tool) =>
      tool.name === "computer_open"
    );
    expect(JSON.stringify(openTool?.inputSchema)).toContain('"runId"');
    expect(JSON.stringify(openTool?.inputSchema)).not.toContain(
      "resumeAfterUserReply",
    );
    expect(JSON.stringify(openTool?.inputSchema)).not.toContain("resumeEvidence");
    expect(JSON.stringify(openTool?.inputSchema)).not.toContain(
      "resumeAfterMailboxItemId",
    );
    expect(JSON.stringify(openTool?.inputSchema)).not.toContain(
      "resumeDeliveryContext",
    );
    expect(JSON.stringify(openTool?.inputSchema)).not.toContain("profileKey");
    expect(JSON.stringify(pauseTool?.inputSchema)).not.toContain(
      "pauseDeliveryContext",
    );
    expect(JSON.stringify(pauseTool?.inputSchema)).not.toContain("message");
    expect(JSON.stringify(pauseTool?.inputSchema)).not.toContain("awaitingMessage");
  });

  it("states the secret-isolation and trusted-submit browser contract", () => {
    const providerTool = MURPH_DYNAMIC_TOOLS.find((tool) => tool.name === "provider_setup");
    const actTool = MURPH_DYNAMIC_TOOLS.find((tool) => tool.name === "computer_act");
    const openTool = MURPH_DYNAMIC_TOOLS.find((tool) => tool.name === "computer_open");
    const osControlTool = MURPH_DYNAMIC_TOOLS.find((tool) => tool.name === "computer_os_control");
    const pauseTool = MURPH_DYNAMIC_TOOLS.find(
      (tool) => tool.name === "computer_pause_for_user",
    );
    const providerDescription = providerTool?.description ?? "";
    const actDescription = actTool?.description ?? "";
    const openDescription = openTool?.description ?? "";
    const osControlDescription = osControlTool?.description ?? "";
    const pauseDescription = pauseTool?.description ?? "";

    expect(providerDescription).toContain("never enter model context");
    expect(providerDescription).toContain("registration owns application-name");
    expect(providerDescription).toContain("capture takes no runtime selectors");
    expect(providerDescription).toContain("capture");
    expect(actDescription).toContain("typed steps only");
    expect(actDescription).toContain("blocks code");
    expect(actDescription).toContain("network writes");
    expect(actDescription).toContain("provider_setup for capture/deletion");
    expect(openDescription).toContain("provider_setup's exact runId");
    expect(openDescription).toContain("safe page state");
    expect(osControlDescription).toContain("Forbidden for provider_setup");
    expect(osControlDescription).toContain("sensitive data");
    expect(pauseDescription).toContain("persist a checkpoint");
    expect(pauseDescription).toContain("does not prove handoff completion");
  });

  it("advertises computer tools only when execution transport is available", () => {
    const toolNames = resolveMurphDynamicTools({}).map((tool) => tool.name);

    expect(toolNames).toContain("send_progress_update");
    expect(toolNames.some((name) => name.startsWith("computer_"))).toBe(false);

    const availableToolNames = resolveMurphDynamicTools({
      computerToolsAvailable: true,
    }).map((tool) => tool.name);
    expect(availableToolNames).toContain("send_progress_update");
    expect(availableToolNames).toContain("provider_setup");
    expect(availableToolNames.filter((name) => name.startsWith("computer_"))).toEqual([
      "computer_open",
      "computer_act",
      "computer_os_control",
      "computer_pause_for_user",
      "computer_finish_run",
    ]);

    const unavailableProgressToolNames = resolveMurphDynamicTools({
      computerToolsAvailable: true,
      progressUpdatesAvailable: false,
    }).map((tool) => tool.name);
    expect(unavailableProgressToolNames).not.toContain("send_progress_update");
    expect(unavailableProgressToolNames).toContain("computer_open");
  });

  it("keeps open profile keys off the model surface while sending fresh opens", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe("http://web-control.worker/api/internal/computer/runs");
      expect(JSON.parse(String(init?.body))).toEqual({
        goal: "Hosted computer task.",
        resumeAfterMailboxItemId: null,
        resumeDeliveryContext: null,
        runId: null,
        startUrl: null,
      });

      return jsonResponse({
        expiresAt: "2026-06-17T13:00:00.000Z",
        reused: true,
        runId: "run_123",
        status: "running",
        title: null,
        url: null,
        visibleText: "",
      });
    });

    const request = readTestMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        startUrl: null,
      },
      tool: "computer_open",
    }));

    if (!request || request.kind !== "computer-open") {
      throw new Error("Expected computer_open request.");
    }

    expect(request.args).toEqual({
      runId: null,
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
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("sends server-owned resume proof without model resume ids", async () => {
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
          returnContactKind: null,
        },
        runId: null,
        startUrl: "https://shop.example.test/checkout",
      });

      return jsonResponse({
        expiresAt: "2026-06-17T13:00:00.000Z",
        reused: true,
        runId: "run_123",
        status: "running",
        title: "Checkout",
        url: "https://shop.example.test/checkout",
        visibleText: "Ready to check out",
      });
    });

    const request = readTestMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        startUrl: "https://shop.example.test/checkout",
      },
      tool: "computer_open",
    }));

    if (!request || request.kind !== "computer-open") {
      throw new Error("Expected computer_open request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext({
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
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    { profileKey: "appointments" },
    { legacyProfileKey: "appointments" },
    { memberScopedProfileRequired: true },
    { resumeRunId: "hcr_paused_run" },
    { resumeAfterMailboxItemId: "model_supplied_mailbox_item" },
    {
      resumeDeliveryContext: {
        conversationId: "model-authored-conversation",
        recipientKey: "model-authored-recipient",
      },
    },
  ])("rejects stale open profile field %# before execution", async (argumentsValue) => {
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse({}));
    const request = readTestMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue,
      tool: "computer_open",
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
          runId: null,
          startUrl: null,
        },
        kind: "computer-open",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(bodies).toEqual([
      expect.objectContaining({
        resumeAfterMailboxItemId: "hmi_user_reply",
        resumeDeliveryContext: {
          conversationId: "conversation-123",
          recipientKey: "recipient-123",
          returnContactKind: null,
        },
      }),
    ]);
    expect(bodies[0]).not.toHaveProperty("profileKey");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["computer-open", {
      args: {
        runId: null,
        startUrl: null,
      },
      kind: "computer-open" as const,
    } satisfies MurphDynamicToolRequest],
    ["computer-os-control", {
      args: {
        action: "pressKey",
        durationMs: 0,
        keys: ["Return"],
        runId: "run_123",
      },
      kind: "computer-os-control" as const,
    } satisfies MurphDynamicToolRequest],
  ])("rejects %s when hosted computer transport is unavailable", async (_kind, request) => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ status: "running" })
    );

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: null,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer tools are unavailable without hosted computer-use transport",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns opened browser text with sanitized URL and raw visible text", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        runId: "run_123",
        status: "running",
        expiresAt: "2026-06-17T13:00:00.000Z",
        reused: true,
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
        args: { runId: null, startUrl: null },
        kind: "computer-open",
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
    expect(text).not.toContain("token=secret");
    expect(text).not.toContain("#frag");
  });

  it("surfaces coded open configuration failures", async () => {
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
          runId: null,
          startUrl: "https://shop.example.test",
        },
        kind: "computer-open",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toBe(
      "computer API failed with status 502: HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED: Kernel live-view URL is not allowed by hosted computer-use configuration.",
    );
  });

  it("runs raw Playwright and returns the current action URL", async () => {
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
      url: "https://shop.example.test/order",
    });
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("secret=raw");
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
    const request = readTestMurphDynamicToolRequest(dynamicToolCall({
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
      const request = readTestMurphDynamicToolRequest(dynamicToolCall({
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
    const request = readTestMurphDynamicToolRequest(dynamicToolCall({
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
    const request = readTestMurphDynamicToolRequest(dynamicToolCall({
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
      "computer API outcome is unknown after a transport or browser execution failure; call computer_open before retrying Playwright code or taking another step",
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
      `computer API outcome is unknown after a transport or browser execution failure; call computer_open before retrying Playwright code or taking another step; backend error: ${code}: Computer browser evaluation failed.`,
    );
  });

  it("includes redacted browser execution details in unknown-outcome action failures", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        error: {
          code: "HOSTED_COMPUTER_EVAL_FAILED",
          details: {
            codeHash: "abc123",
            kernelError: [
              "Error: strict mode violation: getByRole('button', { name: 'Place your order' }) resolved to 2 elements",
              "    at locator.click (<REDACTED_PATH>:10:5)",
            ].join("\n"),
            kernelErrorPresent: true,
            kernelStderrPresent: true,
            kernelStdoutPresent: false,
            unlistedDetail: "should-not-be-shown",
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
        "computer API outcome is unknown after a transport or browser execution failure; call computer_open before retrying Playwright code or taking another step; backend error: HOSTED_COMPUTER_EVAL_FAILED: Computer browser evaluation failed.",
        "backend details:",
        "codeHash: abc123",
        "timeoutMs: 20000",
        "playwrightError:",
        "Error: strict mode violation: getByRole('button', { name: 'Place your order' }) resolved to 2 elements",
        "    at locator.click (<REDACTED_PATH>:10:5)",
        "kernelErrorPresent: true",
        "kernelStderrPresent: true",
        "kernelStdoutPresent: false",
      ].join("\n"),
    );
    expect(result.rpcResult.contentItems[0]!.text).not.toContain("should-not-be-shown");
  });

  it("parses the generic pause-for-user checkpoint tool", () => {
    const request = readTestMurphDynamicToolRequest(dynamicToolCall({
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

    const legacyMessageRequest = readTestMurphDynamicToolRequest(dynamicToolCall({
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
          returnContactKind: null,
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
            returnContactKind: null,
          },
          reason: "final_confirmation",
          runId: "run_123",
          suggestedReply: "done",
        },
        kind: "computer-pause-for-user",
      },
    });

    expect(result.rpcResult.success).toBe(true);
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      awaitingReason: "final_confirmation",
      handoffCreated: true,
      handoffUrl: "https://web.example.test/computer/handoff/raw-token",
      runId: "run_123",
      status: "awaiting_user",
      suggestedReply: "done",
    });
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
  });

  it("does not cancel the run if pause transport outcome is unknown before user delivery", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
    ): Promise<Response> => {
      if (String(url).endsWith("/pause-for-user")) {
        throw new Error("network timeout");
      }

      throw new Error(`unexpected computer API call: ${String(url)}`);
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
      "computer API outcome is unknown after a transport or browser execution failure; call computer_open before retrying Playwright code or taking another step",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns hosted pause handoff data through the tool result", async () => {
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
    const hostedToolContext = createHostedToolContext();

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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never returns provider credentials from the setup transport to the model", async () => {
    const credentialSentinels = {
      clientId: randomUUID(),
      clientSecret: randomUUID(),
      oauthToken: randomUUID(),
    };
    const fetchImpl = vi.fn(async () => jsonResponse({
      ...credentialSentinels,
      run: {
        awaitingReason: null,
        reused: false,
        runId: "hcr_setup",
        status: "running",
      },
      setup: {
        action: "none",
        applicationRevision: 4,
        connected: false,
        message: "Credentials sealed.",
        provider: "strava",
        setupId: "dps_setup",
        status: "oauth_ready",
        updatedAt: "2026-08-12T12:00:00.000Z",
      },
    }));
    const request = readTestMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: { action: "begin", provider: "strava" },
      tool: "provider_setup",
    }));
    if (!request || request.kind !== "provider-setup") {
      throw new Error("Expected provider_setup request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext(),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request,
    });

    expect(result.rpcResult.success).toBe(true);
    const text = result.rpcResult.contentItems[0]!.text;
    expect(text).not.toContain(credentialSentinels.clientId);
    expect(text).not.toContain(credentialSentinels.clientSecret);
    expect(text).not.toContain(credentialSentinels.oauthToken);
    expect(JSON.parse(text)).toEqual({
      run: {
        awaitingReason: null,
        reused: false,
        runId: "hcr_setup",
        status: "running",
      },
      setup: {
        action: "none",
        applicationRevision: 4,
        connected: false,
        message: "Credentials sealed.",
        provider: "strava",
        setupId: "dps_setup",
        status: "oauth_ready",
        updatedAt: "2026-08-12T12:00:00.000Z",
      },
    });
  });

  it("returns provisioning ownership to the active provider continuation", async () => {
    const retryProviderSetupContinuation = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: {
        code: "HOSTED_COMPUTER_BROWSER_PROVISIONING",
        message: "Computer browser is still starting.",
      },
    }, 409));
    const request = readTestMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: { action: "begin", provider: "strava" },
      tool: "provider_setup",
    }));
    if (!request || request.kind !== "provider-setup") {
      throw new Error("Expected provider_setup request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      hostedToolContext: createHostedToolContext({
        retryProviderSetupContinuation,
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request,
    });

    expect(result.rpcResult.success).toBe(false);
    expect(retryProviderSetupContinuation).toHaveBeenCalledOnce();
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
  computerToolsAvailable?: boolean;
  deliveryContext?: {
    conversationId: string | null;
    recipientKey: string | null;
    returnContactKind?: "text" | "telegram" | "email" | null;
  };
  hostedMailboxItemIds?: string[];
  retryProviderSetupContinuation?: () => Promise<void>;
} = {}): AssistantHostedToolContext {
  return {
    currentHostedDeliveryContext: () => input.deliveryContext
      ? {
          returnContactKind: null,
          ...input.deliveryContext,
        }
      : null,
    currentHostedMailboxItemIds: () => input.hostedMailboxItemIds ?? [],
    computerToolsAvailable: input.computerToolsAvailable ?? true,
    ...(input.retryProviderSetupContinuation
      ? { retryProviderSetupContinuation: input.retryProviderSetupContinuation }
      : {}),
    sendVaultFile: vi.fn(async () => {
      throw new Error("Vault-file sending is unavailable for this turn.");
    }),
    vaultFileSendAvailable: false,
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
