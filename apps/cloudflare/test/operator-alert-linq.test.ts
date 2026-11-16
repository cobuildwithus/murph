import { describe, expect, it, vi } from "vitest";

import {
  classifyOperatorLinqAlertFailure,
  sendOperatorLinqAlert,
} from "../src/operator-alert/linq.ts";

describe("operator Linq alert delivery", () => {
  it("preflights and sends one stable message to two distinct healthy direct chats", async () => {
    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname.endsWith("/phone_numbers")) {
        return Response.json(createPhoneNumbersBody());
      }
      if (request.method === "GET") {
        return Response.json(createDirectChatBody(
          url.pathname.endsWith("/chat_secondary")
            ? "+12025550124"
            : "+12025550123",
        ));
      }
      return new Response(null, { status: 202 });
    });

    await sendOperatorLinqAlert({
      apiBaseUrl: "https://api.linqapp.test/api/partner/v3",
      apiToken: "opaque-token",
      chatIds: ["chat_primary", "chat_secondary"],
      fetchImplementation,
      idempotencyKey: "operator-page-1",
      message: "Bounded operational evidence.",
    });

    expect(requests).toHaveLength(6);
    expect(requests.every((request) => request.redirect === "manual")).toBe(true);
    const sends = requests.filter((request) => request.method === "POST");
    // Each page goes into the configured chat the preflight checked, never
    // through Linq's recipient-only route, which picks its own chat and line.
    expect(sends.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/partner/v3/chats/chat_primary/messages",
      "/api/partner/v3/chats/chat_secondary/messages",
    ]);
    const bodies = await Promise.all(sends.map(async (request) =>
      await request.clone().json() as Record<string, unknown> & {
        message: { idempotency_key: string };
      }
    ));
    expect(bodies.map((body) => body.message.idempotency_key)).toEqual([
      "operator-page-1",
      "operator-page-1-recipient-2",
    ]);
    expect(sends.map((request) => request.headers.get("idempotency-key")))
      .toEqual(["operator-page-1", "operator-page-1-recipient-2"]);
    for (const body of bodies) {
      expect(body).not.toHaveProperty("to");
      expect(body).not.toHaveProperty("from");
    }
  });

  it("fails closed when two configured chats resolve to one recipient", async () => {
    const fetchImplementation = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = new Request(input, init);
      return new URL(request.url).pathname.endsWith("/phone_numbers")
        ? Response.json(createPhoneNumbersBody())
        : request.method === "GET"
          ? Response.json(createDirectChatBody("+12025550123"))
          : new Response(null, { status: 202 });
    });

    const failure = await sendOperatorLinqAlert({
      apiBaseUrl: "https://api.linqapp.test/api/partner/v3",
      apiToken: "opaque-token",
      chatIds: ["chat_primary", "chat_secondary"],
      fetchImplementation,
      idempotencyKey: "operator-page-2",
      message: "Bounded operational evidence.",
    }).catch((error: unknown) => error);

    expect(classifyOperatorLinqAlertFailure(failure)).toBe(
      "linq_duplicate_recipient",
    );
  });
});

function createDirectChatBody(recipient: string) {
  return {
    handles: [
      { handle: "+12025550122", is_me: true, status: "active" },
      { handle: recipient, is_me: false, status: "active" },
    ],
    health_status: { status: "HEALTHY" },
    is_group: false,
  };
}

function createPhoneNumbersBody() {
  return {
    phone_numbers: [
      {
        phone_number: "+12025550122",
        reputation: { status: "HEALTHY" },
      },
    ],
  };
}
