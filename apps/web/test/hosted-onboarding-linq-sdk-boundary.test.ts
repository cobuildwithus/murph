import { describe, expect, it, vi } from "vitest";

import {
  createLinqApiClient,
  isLinqApiResponseUnreadableError,
  readLinqApiErrorPayload,
  readLinqApiErrorStatus,
  runLinqApiRequest,
} from "@/src/lib/linq/api";

describe("hosted Linq SDK boundary", () => {
  it("maps generated resources onto the configured root without composing retries", async () => {
    const fetchImplementation = vi.fn(async (
      _request: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({
      error: { message: "provider unavailable" },
    }), {
      headers: { "content-type": "application/json" },
      status: 503,
    }));
    const client = createLinqApiClient({
      apiBaseUrl: "https://linq.example.test/custom/partner/v3/",
      apiToken: "linq-test-token",
      fetchImplementation,
    });

    await expect(client.phoneNumbers.list()).rejects.toMatchObject({
      status: 503,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [request, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(request).toBeInstanceOf(URL);
    expect(String(request)).toBe(
      "https://linq.example.test/custom/partner/v3/phone_numbers",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer linq-test-token");
    expect([...headers.keys()]).toEqual(["authorization"]);
  });

  it("caps streamed SDK responses before provider JSON parsing", async () => {
    const fetchImplementation = vi.fn(async (
      _request: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({
      phone_numbers: [],
      padding: "x".repeat(512),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    const client = createLinqApiClient({
      apiBaseUrl: "https://linq.example.test/api/partner/v3",
      apiToken: "linq-test-token",
      fetchImplementation,
      maxResponseBytes: 64,
    });

    let failure: unknown;
    try {
      await client.phoneNumbers.list();
    } catch (error) {
      failure = error;
    }

    expect(isLinqApiResponseUnreadableError(failure)).toBe(true);
    expect(readLinqApiErrorStatus(failure)).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("uses the generated chat paginator across a configured API root", async () => {
    const responses = [
      {
        chats: [{ id: "chat-page-1" }],
        next_cursor: "cursor /?&",
      },
      {
        chats: [{ id: "chat-page-2" }],
        next_cursor: null,
      },
    ];
    const fetchImplementation = vi.fn(async (
      _request: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(JSON.stringify(responses.shift()), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    const client = createLinqApiClient({
      apiBaseUrl: "https://linq.example.test/custom/partner/v3/",
      apiToken: "linq-test-token",
      fetchImplementation,
    });

    const firstPage = await client.chats.listChats({ limit: 100 });
    expect(firstPage.hasNextPage()).toBe(true);
    const secondPage = await firstPage.getNextPage();

    expect(firstPage.chats).toEqual([{ id: "chat-page-1" }]);
    expect(secondPage.chats).toEqual([{ id: "chat-page-2" }]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const requestUrls = fetchImplementation.mock.calls.map(([request]) =>
      new URL(String(request))
    );
    expect(requestUrls.map((url) => url.pathname)).toEqual([
      "/custom/partner/v3/chats",
      "/custom/partner/v3/chats",
    ]);
    expect(requestUrls[0]?.searchParams.get("limit")).toBe("100");
    expect(requestUrls[0]?.searchParams.get("cursor")).toBeNull();
    expect(requestUrls[1]?.searchParams.get("limit")).toBe("100");
    expect(requestUrls[1]?.searchParams.get("cursor")).toBe("cursor /?&");
  });

  it("keeps provider error payloads out of enumerable and cause chains", async () => {
    const privateMarker = "provider-echo-private-marker";
    const providerPayload = {
      error: {
        code: "VALIDATION_FAILED",
        message: privateMarker,
      },
      echoed_input: privateMarker,
    };
    let failure: unknown;
    try {
      await runLinqApiRequest({
        apiBaseUrl: "https://linq.example.test/api/partner/v3",
        apiToken: "linq-test-token",
        fetchImplementation: async () =>
          new Response(JSON.stringify(providerPayload), {
            headers: { "content-type": "application/json" },
            status: 400,
          }),
        request: (client) => client.phoneNumbers.list(),
        timeoutMessage: "Linq request timed out.",
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(readLinqApiErrorStatus(failure)).toBe(400);
    expect(readLinqApiErrorPayload(failure)).toEqual(providerPayload);
    expect(failure).not.toHaveProperty("cause");
    expect(Object.keys(failure as object)).not.toContain("payload");
    expect(JSON.stringify(failure)).not.toContain(privateMarker);
  });
});
