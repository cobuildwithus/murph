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

type CompactedPart = { body: { attachmentId?: string; data?: string }; parts: CompactedPart[] };
type CompactedMessage = {
  attachmentList: { attachmentId: string }[];
  messageText: string;
  payload: { headers: { name: string; value: string }[]; parts: CompactedPart[] };
};

describe("connected-app result compaction beyond markup", () => {
  const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");
  const encodeBytes = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
  const segment = "Departs Monday 7:05am, gate B12. ".repeat(30);
  const htmlBody = `<html><body><p>Your flight to Denver is confirmed.</p><p>${segment}</p></body></html>`;
  const plainBody = `Your flight to Denver is confirmed.\n${segment}`;
  const duplicate = "[omitted: same text as messageText]";
  const binary = Buffer.from(Uint8Array.from({ length: 900 }, (_, index) => index % 256)).toString("base64");
  const longAttachmentId = "ANGjdJ8" + "x".repeat(700);
  const transportHeaders = [
    ...Array.from({ length: 6 }, (_, index) => ({ name: "Received", value: `from relay${index}.example.test by mx.example.test` })),
    { name: "DKIM-Signature", value: "v=1; a=rsa-sha256; d=example.test; b=" + "a".repeat(300) },
    { name: "ARC-Seal", value: "i=1; a=rsa-sha256; b=" + "b".repeat(300) },
    { name: "X-Google-Smtp-Source", value: "c".repeat(120) },
    { name: "Return-Path", value: "<bounce@example.test>" },
    { name: "MIME-Version", value: "1.0" },
  ];
  const readableHeaders = [
    { name: "From", value: "Example Air <trips@example.test>" },
    { name: "To", value: "member@example.test" },
    { name: "Subject", value: "Your trip is confirmed" },
    { name: "Date", value: "Fri, 13 Nov 2026 08:00:00 -0500" },
  ];
  const textPart = (mimeType: string, data: string, filename = "") => ({ mimeType, filename, body: { size: data.length, data } });
  const message = (input: { messageText?: string; parts: unknown[]; mimeType?: string }) => ({
    messageId: "msg-1",
    ...(input.messageText === undefined ? {} : { messageText: input.messageText }),
    subject: "Your trip is confirmed",
    attachmentList: [{ attachmentId: longAttachmentId, filename: "itinerary.pdf" }],
    payload: {
      mimeType: input.mimeType ?? "multipart/mixed",
      headers: [...transportHeaders, ...readableHeaders],
      parts: input.parts,
    },
  });
  const compactMessage = (value: unknown) => {
    const compacted = compactHostedConnectedAppsResult({ data: { messages: [value] } }) as { data: { messages: CompactedMessage[] } };
    const serialized = serializeHostedConnectedAppsResult(compacted);
    if (serialized === null) throw new Error("Expected a result inside the budget.");
    return { compacted: compacted.data.messages[0]!, serialized };
  };

  it("drops a proven duplicate body, transport headers and declared binary from a full Gmail message", () => {
    const raw = message({
      messageText: htmlBody,
      parts: [
        { mimeType: "multipart/alternative", parts: [textPart("text/plain", encode(plainBody)), textPart("text/html", encode(htmlBody))] },
        { mimeType: "image/png", filename: "logo.png", body: { size: 900, data: binary } },
        { mimeType: "application/pdf", filename: "itinerary.pdf", body: { attachmentId: longAttachmentId, size: 52_000 } },
      ],
    });
    const result = { data: { messages: [raw], nextPageToken: encode("p".repeat(600)) } };
    const compacted = compactHostedConnectedAppsResult(result) as { data: { messages: CompactedMessage[]; nextPageToken: string } };
    const [compactedMessage] = compacted.data.messages;
    const [alternative, image, pdf] = compactedMessage!.payload.parts;

    expect(compactedMessage!.payload.headers).toEqual(readableHeaders);
    // Both alternatives render to text found verbatim in the retained messageText.
    expect(alternative!.parts.map((part) => part.body.data)).toEqual([duplicate, duplicate]);
    expect(image!.body.data).toBe("[binary data omitted: 900 bytes]");
    expect(pdf!.body.attachmentId).toBe(longAttachmentId);
    expect(compactedMessage!.attachmentList[0]!.attachmentId).toBe(longAttachmentId);
    expect(compacted.data.nextPageToken).toBe(result.data.nextPageToken);
    expect(compactedMessage!.messageText).toContain("Your flight to Denver is confirmed.");
    expect(compactedMessage!.messageText).not.toContain("<p>");
    expect(serializeHostedConnectedAppsResult(compacted)!.length)
      .toBeLessThan(serializeHostedConnectedAppsResult(result)!.length / 2);
  });

  it("keeps a distinct text part of a multipart/mixed message", () => {
    const returnLeg = "Return flight Friday 6:40pm, Denver to Boston, seat 14C. ".repeat(12);
    const { compacted, serialized } = compactMessage(message({
      messageText: plainBody,
      parts: [textPart("text/plain", encode(plainBody)), textPart("text/plain", encode(returnLeg))],
    }));
    expect(compacted.payload.parts.map((part) => part.body.data)).toEqual([duplicate, returnLeg]);
    expect(serialized).toContain("Return flight Friday 6:40pm");
  });

  it("keeps an HTML alternative whose link is missing from the plain messageText", () => {
    const linkedHtml = `<html><body><p>${plainBody}</p>`
      + `<p><a href="https://book.example.test/manage/ABC123">Manage booking</a></p></body></html>`;
    const { compacted, serialized } = compactMessage(message({
      messageText: plainBody,
      mimeType: "multipart/alternative",
      parts: [textPart("text/plain", encode(plainBody)), textPart("text/html", encode(linkedHtml))],
    }));
    expect(compacted.payload.parts[0]!.body.data).toBe(duplicate);
    expect(compacted.payload.parts[1]!.body.data).toContain("Manage booking (https://book.example.test/manage/ABC123)");
    expect(serialized).toContain("https://book.example.test/manage/ABC123");
  });

  it("decodes an encoded UTF-8 body that has no messageText copy", () => {
    const { compacted } = compactMessage(message({
      mimeType: "multipart/alternative",
      parts: [textPart("text/plain", encode(plainBody)), textPart("text/html", encode(htmlBody))],
    }));
    expect(compacted.payload.parts[0]!.body.data).toBe(plainBody);
    expect(compacted.payload.parts[1]!.body.data).toContain("Your flight to Denver is confirmed.");
    expect(compacted.payload.parts[1]!.body.data).not.toContain("<p>");
  });

  it("keeps non-UTF-8 text bodies and named text attachments encoded instead of discarding them", () => {
    const latin1 = encodeBytes(Uint8Array.from(Buffer.from("Réservation confirmée, départ à 7h05. ".repeat(30), "latin1")));
    const utf16 = encodeBytes(Uint8Array.from(Buffer.from("Booking confirmed, departs 7:05am. ".repeat(20), "utf16le")));
    const { compacted } = compactMessage(message({
      parts: [
        textPart("text/plain", latin1),
        textPart("text/plain", utf16),
        textPart("text/plain", latin1, "notes.txt"),
        { mimeType: "application/octet-stream", filename: "blob.bin", body: { data: latin1 } },
      ],
    }));
    expect(compacted.payload.parts.map((part) => part.body.data)).toEqual([
      latin1, utf16, latin1, `[binary data omitted: ${Buffer.from(latin1, "base64url").byteLength} bytes]`,
    ]);
  });

  it("leaves calendar events and name/value lists without mail transport headers alone", () => {
    const events = {
      kind: "calendar#events",
      etag: "\"p33c9\"",
      items: [{
        kind: "calendar#event",
        etag: "\"3381\"",
        id: "evt1",
        summary: "Long run",
        start: { dateTime: "2026-11-14T08:00:00-05:00" },
        attendees: [{ email: "member@example.test", self: true, responseStatus: "accepted" }],
        fields: [{ name: "Pace", value: "8:30" }, { name: "From", value: "Coach" }],
      }],
    };
    expect(compactHostedConnectedAppsResult(events)).toEqual(events);
  });

  it("decodes only encoded-content keys, never identifiers or base64-looking text", () => {
    const opaque = "A".repeat(800);
    const kebab = "private-synthetic-provider-data".repeat(40);
    const value = {
      description: "word ".repeat(200), syncToken: opaque, threadIds: [opaque], note: kebab, attachmentId: kebab,
    };
    expect(compactHostedConnectedAppsResult(value)).toEqual(value);
  });
});
