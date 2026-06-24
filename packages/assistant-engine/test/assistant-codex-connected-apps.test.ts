import { describe, expect, it, vi } from "vitest";

import { compactConnectedAppsResult } from "../src/assistant-codex/dynamic-tools/connected-apps.ts";
import {
  executeMurphDynamicToolRequest,
  MURPH_DYNAMIC_TOOLS,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.ts";
import type { AssistantConnectedAppsPort } from "../src/assistant/connected-apps-port.ts";
import type { AssistantHostedToolContext } from "../src/assistant/hosted-tool-context.ts";
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
    const connectedApps: AssistantConnectedAppsPort = {
      request: vi.fn(async (input) => {
        expect(input).toEqual({
          operation: "search",
          input: {
            query: "find recent email attachments",
            toolkits: ["gmail"],
          },
        });
        return {
          result: {
            success: true,
            tool_schemas: {
              GMAIL_GET_ATTACHMENT: { input_schema: { type: "object" } },
            },
          },
        };
      }),
    };
    const toolRequest = readMurphDynamicToolRequest(dynamicToolCall({
      argumentsValue: {
        query: "find recent email attachments",
        toolkits: ["gmail"],
      },
      tool: "connected_apps_search",
    }));
    if (!toolRequest || toolRequest.kind !== "connected-apps-search") {
      throw new Error("Expected connected-apps search request.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext(connectedApps),
      nextUsageOrdinal: () => 1,
      progressDelivery: createProgressDelivery(),
      request: toolRequest,
    });

    expect(connectedApps.request).toHaveBeenCalledTimes(1);
    expect(result.rpcResult.success).toBe(true);
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toMatchObject({
      success: true,
    });
  });

  it("does not call the control plane when connected apps are unavailable", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => new Response());
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetchImpl as typeof fetch,
      hostedToolContext: createHostedToolContext(null),
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

  it("strips HTML from Gmail-style message bodies while preserving link URLs, alt text, and inline content", async () => {
    // Production Gmail responses ship the full HTML envelope under
    // `data.messageText`. The compactor must rewrite the email body to
    // plain text but must NOT silently drop link URLs (tracking links,
    // unsubscribe, calendar invites) or image alt text — those are the
    // bits a user typically asks Murph to act on.
    const htmlBody = `<!doctype html><html><head><style>.x{color:red}</style></head>`
      + `<body><table><tr><td><p>Hello&nbsp;<strong>Will</strong>,</p>`
      + `<p>Thanks for your order #1234. Subtotal: $42.00</p>`
      + `<p>Track it here: <a href="https://orders.example.com/1234">View order</a>.</p>`
      + `<p>To stop these emails, <a href='https://example.com/unsub?u=42'>unsubscribe</a>.</p>`
      + `<p><img src="https://cdn.example.com/logo.png" alt="Example Co logo"></p>`
      + `<p>— Murph &amp; Co.</p></td></tr></table></body></html>`;
    const result = compactConnectedAppsResult({
      data: {
        attachmentList: [],
        labelIds: ["INBOX"],
        messageId: "abc123",
        messageText: htmlBody,
        sender: "store@example.com",
        subject: "Order #1234",
      },
      tool_schemas: {
        // Schema description happens to mention `<p>` literally; under 200
        // chars so the length gate skips it. Must remain untouched.
        GMAIL_FETCH_EMAILS: {
          description: "Fetch emails. Returns body with <p> tags when raw=true.",
        },
      },
    }) as { data: { messageText: string }; tool_schemas: Record<string, { description: string }> };

    const compactedBody = result.data.messageText;
    // All structural HTML and the style block are stripped.
    expect(compactedBody).not.toMatch(/<\/?(html|body|table|td|tr|p|strong|style|head|img)\b/iu);
    expect(compactedBody).not.toMatch(/color:red/u);
    // Email prose, link text, and link URLs all survive.
    expect(compactedBody).toContain("Hello");
    expect(compactedBody).toContain("Will");
    expect(compactedBody).toContain("Thanks for your order #1234");
    expect(compactedBody).toContain("View order (https://orders.example.com/1234)");
    expect(compactedBody).toContain("unsubscribe (https://example.com/unsub?u=42)");
    expect(compactedBody).toContain("[image: Example Co logo]");
    expect(compactedBody).toContain("Murph & Co.");
    // The strip cuts roughly half of an HTML envelope at minimum; this
    // particular fixture should land well under the original byte length.
    expect(compactedBody.length).toBeLessThan(htmlBody.length / 2);
    expect(result.tool_schemas.GMAIL_FETCH_EMAILS.description).toBe(
      "Fetch emails. Returns body with <p> tags when raw=true.",
    );
  });

  it("preserves anchor hrefs whose opening tag has a literal `>` inside an attribute value", async () => {
    // Real Gmail/marketing HTML regularly emits anchors like
    // `<a title="Reply >>" href="...">` where the attribute value contains
    // a literal `>`. A naive `[^>]*` attribute-skip pattern aborts at the
    // first `>` and the generic tag stripper then erases the opening tag,
    // silently losing the href — which is exactly the data this compactor
    // is meant to preserve. The quote-aware tokenizer in the stripper must
    // handle this without dropping the URL or eating the surrounding prose.
    const htmlBody = `<!doctype html><html><body>`
      + `<p>Hi! See more:</p>`
      + `<p><a title="Reply >>" href="https://example.com/track?id=abc&n=1">View update</a> for details.</p>`
      + `<p>Or <a href='https://example.com/inline-quote/"q"'>this one</a>.</p>`
      + `<p><img src="https://cdn.example.com/x.png" alt="Status: green > yellow"></p>`
      + `</body></html>`;
    const result = compactConnectedAppsResult({
      data: { messageText: htmlBody },
    }) as { data: { messageText: string } };
    const compactedBody = result.data.messageText;
    // The link's label, the href, AND the surrounding prose all survive.
    expect(compactedBody).toContain("View update (https://example.com/track?id=abc&n=1)");
    expect(compactedBody).toContain("Hi! See more:");
    expect(compactedBody).toContain("for details.");
    // The single-quoted anchor with a quote-bearing href still works.
    expect(compactedBody).toContain('this one (https://example.com/inline-quote/"q")');
    // Image alt with `>` inside survives.
    expect(compactedBody).toContain("[image: Status: green > yellow]");
    // None of the opening-tag attribute text leaked through as bare text.
    expect(compactedBody).not.toMatch(/title=|src=/u);
  });

  it("fails closed instead of truncating an oversized provider result", async () => {
    const connectedApps: AssistantConnectedAppsPort = {
      request: vi.fn(async () => ({ result: { body: "x".repeat(130_000) } })),
    };
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext(connectedApps),
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

function createHostedToolContext(
  connectedApps: AssistantConnectedAppsPort | null,
): AssistantHostedToolContext {
  return {
    connectedApps,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    requiredUserMessageDeliveryAvailable: false,
    sendRequiredUserMessage: async () => ({
      kind: "failed",
      source: "model",
    }),
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
