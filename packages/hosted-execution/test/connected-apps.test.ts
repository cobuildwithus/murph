import { describe, expect, it } from "vitest";

import {
  compactHostedConnectedAppsResult,
  HOSTED_CONNECTED_APPS_PATH,
  hostedConnectedAppsExecuteInputSchema,
  hostedConnectedAppsRequestSchema,
  serializeHostedConnectedAppsResult,
} from "../src/connected-apps.ts";

describe("hosted connected-app contracts", () => {
  it("strips HTML from Gmail-style message bodies while preserving link URLs, alt text, and inline content", () => {
    // Production Gmail responses ship the full HTML envelope under
    // `data.messageText`. The compactor must rewrite the email body to
    // plain text but must NOT silently drop link URLs (tracking links,
    // unsubscribe, calendar invites) or image alt text — those are the
    // bits a user typically asks Murph to act on.
    const htmlBody = `<!doctype html><html><head><style>.x{color:red}</style></head>`
      + `<body><table><tr><td><p>Hello&nbsp;<strong>Alex</strong>,</p>`
      + `<p>Thanks for your order #1234. Subtotal: $42.00</p>`
      + `<p>Track it here: <a href="https://orders.example.com/1234">View order</a>.</p>`
      + `<p>To stop these emails, <a href='https://example.com/unsub?u=42'>unsubscribe</a>.</p>`
      + `<p><img src="https://cdn.example.com/logo.png" alt="Example Co logo"></p>`
      + `<p>— Murph &amp; Co.</p></td></tr></table></body></html>`;
    const result = compactHostedConnectedAppsResult({
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
    expect(compactedBody).toContain("Alex");
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

  it("preserves anchor hrefs whose opening tag has a literal `>` inside an attribute value", () => {
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
    const result = compactHostedConnectedAppsResult({
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

  it("survives a second pass so mixed-version callers cannot corrupt content", () => {
    // A deployment window can leave an older caller compacting a result the web
    // tier already compacted. That second pass must not read the member's own
    // quoted markup as structure and delete it.
    const quoted = `<!doctype html><html><body><p>Use this exact block:</p>`
      + `<p>&lt;p class="warning"&gt;Do not cancel&lt;/p&gt;</p>`
      + `<p>And this one: &#60;span&#62;keep me&#60;/span&#62;</p>`
      + `<p>Paste it verbatim.</p>${"<p>filler copy for length</p>".repeat(20)}</body></html>`;
    const once = compactHostedConnectedAppsResult({ body: quoted }) as { body: string };

    expect(once.body).toContain("Do not cancel");
    expect(once.body).toContain("keep me");
    expect(once.body).toContain("Paste it verbatim.");

    const twice = compactHostedConnectedAppsResult(once) as { body: string };
    expect(twice.body).toBe(once.body);
  });

  it("bounds a compacted result to the assistant budget", () => {
    expect(serializeHostedConnectedAppsResult({ body: "x".repeat(10) })).not.toBeNull();
    expect(serializeHostedConnectedAppsResult({ body: "x".repeat(130_000) })).toBeNull();
  });

  it("keeps a markup-heavy mailbox read inside the budget after compaction", () => {
    // A mailbox read whose raw envelopes exceed the old 512 KB wire ceiling
    // still has to reach the model: the markup, not the content, is what makes
    // it large. Rejecting it on wire size discarded a result that fits.
    const envelope = `<!doctype html><html><head><style>${".pad{color:red}".repeat(400)}</style></head>`
      + `<body><table><tr><td><p>Order confirmed. Total: $42.00</p>`
      + `<p>Details: <a href="https://orders.example.com/1">View</a></p></td></tr></table></body></html>`;
    const raw = {
      data: {
        messages: Array.from({ length: 90 }, (_item, index) => ({
          messageId: `msg_${index}`,
          messageText: envelope,
          subject: `Order ${index}`,
        })),
      },
    };

    expect(JSON.stringify(raw).length).toBeGreaterThan(512 * 1024);
    expect(serializeHostedConnectedAppsResult(compactHostedConnectedAppsResult(raw))).not.toBeNull();
  });

  it("keeps one stable internal route", () => {
    expect(HOSTED_CONNECTED_APPS_PATH).toBe("/api/internal/connected-apps");
  });

  it("accepts accountless service execution while preserving account selectors", () => {
    expect(
      hostedConnectedAppsExecuteInputSchema.parse({
        arguments: { query: "pharmacy" },
        toolSlug: "COMPOSIO_SEARCH_GOOGLE_MAPS",
      }),
    ).toEqual({
      arguments: { query: "pharmacy" },
      toolSlug: "COMPOSIO_SEARCH_GOOGLE_MAPS",
    });

    expect(
      hostedConnectedAppsExecuteInputSchema.parse({
        account: "work",
        arguments: { query: "newer_than:7d" },
        toolSlug: "GMAIL_FETCH_EMAILS",
      }),
    ).toEqual({
      account: "work",
      arguments: { query: "newer_than:7d" },
      toolSlug: "GMAIL_FETCH_EMAILS",
    });

    expect(
      hostedConnectedAppsExecuteInputSchema.parse({
        account: "calendar",
        arguments: {
          event_duration_hour: 0,
          event_duration_minutes: 30,
          start_datetime: "2026-07-01T10:00:00-04:00",
          summary: "Annual physical",
          timezone: "America/New_York",
        },
        agentApproved: true,
        toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
      }),
    ).toMatchObject({
      account: "calendar",
      agentApproved: true,
      toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
    });
    expect(
      hostedConnectedAppsExecuteInputSchema.safeParse({
        account: "calendar",
        agentApproved: false,
        arguments: {},
        toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
      }).success,
    ).toBe(false);
  });

  it("accepts the bounded management, search, and execution operations", () => {
    expect(
      hostedConnectedAppsRequestSchema.parse({
        operation: "manage",
        input: { action: "connect", alias: "work", toolkit: "gmail" },
      }).operation,
    ).toBe("manage");
    expect(
      hostedConnectedAppsRequestSchema.parse({
        operation: "search",
        input: { query: "find messages with PDF attachments", toolkits: ["gmail"] },
      }).operation,
    ).toBe("search");
    expect(
      hostedConnectedAppsRequestSchema.parse({
        operation: "execute",
        input: {
          account: "work",
          arguments: { message_id: "m_123" },
          toolSlug: "GMAIL_GET_ATTACHMENT",
        },
      }).operation,
    ).toBe("execute");
  });
});
