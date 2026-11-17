import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostedConnectedAppsReadResultSchema, hostedConnectedAppsResponseSchema, hostedConnectedAppsRequestSchema } from "@murphai/hosted-execution/connected-apps";
import { executeHostedConnectedAppsRequest } from "@/src/lib/connected-apps/service";

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
const fixtures = [
  ["GOOGLECALENDAR_LIST_CALENDARS", "googlecalendar", "20261111_00", { items: [{ id: "calendar", accessRole: "owner" }] }],
  ["GOOGLECALENDAR_EVENTS_LIST", "googlecalendar", "20261111_00", { items: [{ id: "event", status: "cancelled" }], nextPageToken: "opaque" }],
  ["GOOGLECALENDAR_EVENTS_GET", "googlecalendar", "20261111_00", { id: "event", status: "cancelled" }],
  ["OUTLOOK_LIST_CALENDARS", "outlook", "20261112_00", { value: [{ id: "calendar", isDefaultCalendar: true }] }],
  ["OUTLOOK_GET_CALENDAR_VIEW", "outlook", "20261112_00", { value: [], next_page_token: "opaque" }],
  ["OUTLOOK_GET_EVENT", "outlook", "20261112_00", { id: "event", isCancelled: true }],
  ["OUTLOOK_GET_CALENDAR_EVENT", "outlook", "20261112_00", { id: "event", isCancelled: true }],
  ["OUTLOOK_SEARCH_MESSAGES", "outlook", "20261112_00", { value: [{ hitsContainers: [{ hits: [], moreResultsAvailable: false }] }] }],
  ["OUTLOOK_GET_MESSAGE", "outlook", "20261112_00", { id: "message", subject: "Booking", body: { contentType: "html", content: `<div>${"Travel confirmation. ".repeat(30)}</div>` } }],
  ["GMAIL_FETCH_EMAILS", "gmail", "20261105_00", { messages: [], nextPageToken: "opaque" }],
  ["GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "gmail", "20261105_00", { messageId: "message", subject: "Booking", messageText: `<div>${"Travel confirmation. ".repeat(30)}</div>` }],
] as const;

describe("engine connected-app read lane", () => {
  beforeEach(() => {
    vi.stubEnv("COMPOSIO_API_KEY", "synthetic-test-key");
    vi.stubEnv("COMPOSIO_BASE_URL", "https://backend.composio.test");
    vi.stubEnv("COMPOSIO_CONNECTED_APP_TOOLKITS", "gmail,googlecalendar,outlook");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(fixtures)("pins %s and composes direct execution, decoding, compaction and the engine envelope", async (toolSlug, toolkit, version, data) => {
    for (const stringData of [false, true]) {
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/api/v3.1/connected_accounts") {
          expect(parsed.searchParams.getAll("user_ids")).toEqual(["synthetic-member"]);
          expect(parsed.searchParams.getAll("toolkit_slugs")).toEqual([toolkit]);
          return json({ items: [{ id: "account", status: "ACTIVE", is_disabled: false, toolkit: { slug: toolkit } }], next_cursor: null });
        }
        expect(parsed.pathname).toBe(`/api/v3.1/tools/execute/${toolSlug}`);
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ connected_account_id: "account", user_id: "synthetic-member", version });
        if (toolkit !== "googlecalendar") expect(body.arguments.user_id).toBe("me");
        if (toolSlug === "GMAIL_FETCH_EMAILS") expect(body.arguments).toMatchObject({ include_payload: false, verbose: false, ids_only: false });
        if (toolSlug === "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID") expect(body.arguments.format).toBe("full");
        if (toolSlug === "OUTLOOK_SEARCH_MESSAGES") expect(body.arguments.enable_top_results).toBe(false);
        if (toolSlug === "OUTLOOK_GET_MESSAGE") expect(body.arguments.select).toContain("body");
        return json({ successful: true, data: stringData ? JSON.stringify(data) : data });
      });
      const request = hostedConnectedAppsRequestSchema.parse({ operation: "read", input: { account: "account", toolSlug,
        arguments: { user_id: "other", include_payload: true, verbose: true, ids_only: true, format: "raw", enable_top_results: true } } });
      const result = await executeHostedConnectedAppsRequest({ memberId: "synthetic-member", prisma: {} as never, fetchImpl, request });
      const wire = hostedConnectedAppsResponseSchema.parse({ result });
      const parsed = hostedConnectedAppsReadResultSchema.parse(wire.result);
      expect(typeof parsed.data).toBe("object");
      expect(JSON.stringify(parsed.data)).not.toContain("<div>");
      if (JSON.stringify(data).includes("Travel confirmation")) expect(JSON.stringify(parsed.data)).toContain("Travel confirmation");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it.each(["GMAIL_SEND_EMAIL", "GOOGLECALENDAR_DELETE_EVENT", "toString", "__proto__"])("rejects non-allowlisted %s before egress", async toolSlug => {
    const fetchImpl = vi.fn();
    await expect(executeHostedConnectedAppsRequest({ memberId: "synthetic-member", prisma: {} as never, fetchImpl,
      request: { operation: "read", input: { account: "account", toolSlug, arguments: {} } } })).rejects.toMatchObject({ code: "CONNECTED_APPS_READ_NOT_ALLOWED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["missing", "disabled", "wrong-toolkit"])("rejects a %s account before execution", async state => {
    const fetchImpl = vi.fn(async () => json({ items: state === "missing" ? [] : [{ id: "account", status: "ACTIVE", is_disabled: state === "disabled", toolkit: { slug: state === "wrong-toolkit" ? "outlook" : "gmail" } }], next_cursor: null }));
    await expect(executeHostedConnectedAppsRequest({ memberId: "synthetic-member", prisma: {} as never, fetchImpl,
      request: { operation: "read", input: { account: "account", toolSlug: "GMAIL_FETCH_EMAILS", arguments: {} } } })).rejects.toMatchObject({ httpStatus: expect.any(Number) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps oversized reads to the existing 413 contract and never reports unsuccessful data as not-found', async () => {
    for (const unsuccessful of [false, true]) {
      const fetchImpl = vi.fn(async (url: string | URL | Request) => new URL(String(url)).pathname.endsWith('/connected_accounts')
        ? json({ items: [{ id: 'account', status: 'ACTIVE', toolkit: { slug: 'gmail' } }], next_cursor: null })
        : json({ successful: !unsuccessful, data: { messageText: 'x'.repeat(121_000) } }));
      await expect(executeHostedConnectedAppsRequest({ memberId: 'synthetic-member', prisma: {} as never, fetchImpl,
        request: { operation: 'read', input: { account: 'account', toolSlug: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', arguments: { message_id: 'message' } } },
      })).rejects.toMatchObject(unsuccessful ? { code: 'CONNECTED_APPS_PROVIDER_UNAVAILABLE' } : { code: 'CONNECTED_APPS_RESULT_TOO_LARGE', httpStatus: 413 });
    }
  });

  it('keeps only the fields the engine reads from Outlook search hits, so a busy mailbox fits the cap', async () => {
    const recipients = Array.from({ length: 40 }, (_, index) => ({ emailAddress: { name: `Person ${index}`, address: `person${index}@example.test` } }));
    const hit = (index: number) => ({
      hitId: `hit-${index}`, rank: index, summary: 'Your booking reference',
      resource: {
        '@odata.type': '#microsoft.graph.message', subject: `Booking ${index}`, receivedDateTime: '2026-11-16T09:00:00Z',
        sender: { emailAddress: { name: 'Airline', address: 'news@airline.test' } }, from: { emailAddress: { name: 'Airline', address: 'news@airline.test' } },
        bodyPreview: 'Trip details', toRecipients: recipients, ccRecipients: recipients,
        body: { contentType: 'text', content: 'Fare rules and travel conditions. '.repeat(60) },
      },
    });
    const busy = { value: [{ hitsContainers: [{ hits: Array.from({ length: 25 }, (_, index) => hit(index)), total: 900, moreResultsAvailable: true }] }], next_page_token: 'opaque' };
    expect(Buffer.byteLength(JSON.stringify(busy))).toBeGreaterThan(120_000);
    const read = async (data: unknown) => {
      const fetchImpl = vi.fn(async (url: string | URL | Request) => new URL(String(url)).pathname.endsWith('/connected_accounts')
        ? json({ items: [{ id: 'account', status: 'ACTIVE', toolkit: { slug: 'outlook' } }], next_cursor: null })
        : json({ successful: true, data }));
      const result = await executeHostedConnectedAppsRequest({ memberId: 'synthetic-member', prisma: {} as never, fetchImpl,
        request: { operation: 'read', input: { account: 'account', toolSlug: 'OUTLOOK_SEARCH_MESSAGES', arguments: { query: 'booking', size: 25 } } } });
      return hostedConnectedAppsReadResultSchema.parse(result).data;
    };

    const page = await read(busy) as typeof busy;
    expect(Object.keys(page).sort()).toEqual(['next_page_token', 'value']);
    expect(page.value[0]!.hitsContainers[0]).toEqual({ hits: expect.any(Array), moreResultsAvailable: true });
    expect(page.value[0]!.hitsContainers[0]!.hits[3]).toEqual({
      hitId: 'hit-3', summary: 'Your booking reference',
      resource: { subject: 'Booking 3', receivedDateTime: '2026-11-16T09:00:00Z', sender: hit(3).resource.sender, from: hit(3).resource.from, bodyPreview: 'Trip details' },
    });
    expect(page.value[0]!.hitsContainers[0]!.hits).toHaveLength(25);

    // A shape the projection does not recognize reaches the engine unchanged.
    const unknownShape = { value: [{ hitsContainers: 'unexpected' }] };
    await expect(read(unknownShape)).resolves.toEqual(unknownShape);
  });
});
