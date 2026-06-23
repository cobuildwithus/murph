import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_DYNAMIC_TOOLS,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.ts";
import type { AssistantProgressDelivery } from "../src/assistant/turn-progress.ts";

describe("murph connected-app dynamic tools", () => {
  it("keeps a fixed three-tool surface", () => {
    expect(
      MURPH_DYNAMIC_TOOLS
        .filter((tool) => tool.name.startsWith("connected_apps_"))
        .map((tool) => tool.name),
    ).toEqual([
      "connected_apps_manage",
      "connected_apps_search",
      "connected_apps_execute",
    ]);

    expect(
      resolveMurphDynamicTools({ connectedAppsAvailable: false })
        .some((tool) => tool.name.startsWith("connected_apps_")),
    ).toBe(false);
    expect(
      resolveMurphDynamicTools({ connectedAppsAvailable: true })
        .filter((tool) => tool.name.startsWith("connected_apps_"))
        .map((tool) => tool.name),
    ).toHaveLength(3);
  });

  it("requires explicit account selection for execution", () => {
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        arguments: {},
        toolSlug: "GMAIL_FETCH_EMAILS",
      },
      tool: "connected_apps_execute",
    }));

    expect(request?.kind).toBe("invalid-connected-apps-arguments");
  });

  it("passes search through the signed hosted control-plane transport", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe("http://web-control.worker/api/internal/connected-apps");
      expect(JSON.parse(String(init?.body))).toEqual({
        operation: "search",
        input: {
          query: "find recent email attachments",
          toolkits: ["gmail"],
        },
      });
      return jsonResponse({
        result: {
          success: true,
          tool_schemas: {
            GMAIL_GET_ATTACHMENT: { input_schema: { type: "object" } },
          },
        },
      });
    });
    const request = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        query: "find recent email attachments",
        toolkits: ["gmail"],
      },
      tool: "connected_apps_search",
    }));
    if (!request || request.kind !== "connected-apps-search") {
      throw new Error("Expected connected-apps search request.");
    }

    const result = await executeMurphDynamicToolRequest({
      connectedAppsAvailable: true,
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request,
    });

    expect(result.rpcResult.success).toBe(true);
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toMatchObject({
      success: true,
    });
  });

  it("does not call the control plane when connected apps are unavailable", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse({}));
    const result = await executeMurphDynamicToolRequest({
      connectedAppsAvailable: false,
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: { action: "list" },
        kind: "connected-apps-manage",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed instead of truncating an oversized provider result", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ result: { body: "x".repeat(130_000) } })
    );
    const result = await executeMurphDynamicToolRequest({
      connectedAppsAvailable: true,
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: {
        args: {
          account: "work",
          arguments: {},
          toolSlug: "GMAIL_FETCH_EMAILS",
        },
        kind: "connected-apps-execute",
      },
    });

    expect(result.rpcResult.success).toBe(false);
    expect(result.rpcResult.contentItems[0]!.text).toContain("narrow the query");
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}
